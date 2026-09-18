"""
FastAPI Server for AIRA Universal Voice Agent.
Provides REST and WebSocket endpoints for the Chrome Extension to communicate
with the LangGraph voice-form orchestration loop.
"""

import os
import uuid
import json
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

from aira_agent.state import FormAgentState, FormField, DOMField
from aira_agent.nodes import (
    orient_page_node,
    synthesize_question_node,
    listen_and_extract_node,
    guardrail_node,
    error_guidance_node,
    advance_queue_node,
    review_summary_node,
    handle_review_confirmation_node,
    select_field_for_correction_node,
    sync_dom_node
)
from aira_agent.edges import (
    route_after_validation,
    route_after_advance,
    route_after_confirmation
)

app = FastAPI(
    title="AIRA Voice Agent Server",
    description="Backend API powering eyes-free voice form completion for blind users via LangGraph",
    version="1.0.0"
)

# Enable CORS for Chrome Extension origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory active session store (for 24h hackathon speed & stability)
sessions: Dict[str, FormAgentState] = {}

# =====================================================================
# REQUEST & RESPONSE SCHEMAS
# =====================================================================

class StartSessionRequest(BaseModel):
    page_title: Optional[str] = Field(default="Formulir Layanan Publik", json_schema_extra={"example": "Pendaftaran Pasien RSUD"})
    page_url: Optional[str] = Field(default="", json_schema_extra={"example": "https://rsud.go.id/daftar"})
    fields: Optional[List[Dict[str, Any]]] = Field(default=None, description="Daftar input FormFieldMetadata hasil pindaian DOM")
    form: Optional[Dict[str, Any]] = Field(default=None, description="Objek FormContainerMetadata lengkap dari ekstensi")

class InteractRequest(BaseModel):
    session_id: str
    user_speech: str = Field(..., json_schema_extra={"example": "tiga dua nol satu..."})

class ConfirmRequest(BaseModel):
    session_id: str
    confirmation_response: str = Field(..., json_schema_extra={"example": "Ya kirim sekarang"})

class AgentStepResponse(BaseModel):
    session_id: str
    status: str
    spoken_prompt: str
    audio_cue: Optional[str] = "question"
    is_valid: Optional[bool] = True
    current_field: Optional[Dict[str, Any]] = None
    answers: Optional[Dict[str, Any]] = None
    sync_payload: Optional[Dict[str, Any]] = None


# =====================================================================
# REST ENDPOINTS
# =====================================================================

@app.get("/")
def root():
    return {
        "status": "online",
        "service": "AIRA Universal Voice Agent Server",
        "version": "1.0.0",
        "active_sessions": len(sessions)
    }

@app.post("/session/start", response_model=AgentStepResponse)
def start_session(req: StartSessionRequest):
    """Initializes a new eyes-free session from scanned DOM fields or FormContainer."""
    session_id = str(uuid.uuid4())
    
    # 1. Resolve raw fields from either `fields` or `form.fields`
    raw_fields: List[Dict[str, Any]] = []
    page_title = req.page_title or "Formulir Layanan Publik"
    if req.fields:
        raw_fields = req.fields
    elif req.form and isinstance(req.form, dict) and "fields" in req.form:
        raw_fields = req.form.get("fields", [])
        if req.form.get("title") and page_title == "Formulir Layanan Publik":
            page_title = req.form.get("title")

    # 2. Canonical normalization for id and domId + pre-fill existing values
    normalized_fields: List[FormField] = []
    initial_answers: Dict[str, Any] = {}
    for idx, f in enumerate(raw_fields):
        f_copy = dict(f)
        field_id = f_copy.get("id") or f_copy.get("domId") or f_copy.get("name") or f"field-{idx+1}"
        field_id = str(field_id)
        f_copy["id"] = field_id
        f_copy["domId"] = field_id # Dual-binding for seamless compatibility
        
        # Pre-populate if web page already had values
        cur_val = f_copy.get("currentValue")
        if cur_val:
            initial_answers[field_id] = cur_val
            
        normalized_fields.append(f_copy)

    initial_state: FormAgentState = {
        "session_id": session_id,
        "page_title": page_title,
        "page_url": req.page_url or "",
        "fields_queue": normalized_fields,
        "current_field": normalized_fields[0] if normalized_fields else None,
        "filled_fields": [],
        "answers": initial_answers,
        "retry_count": 0,
        "status": "INTERVIEWING",
        "is_correcting": False
    }
    
    # 3. Jalankan orientasi
    res_orient = orient_page_node(initial_state)
    initial_state.update(res_orient)
    
    # 4. Sintesis pertanyaan pertama jika ada field
    if initial_state.get("current_field"):
        res_q = synthesize_question_node(initial_state)
        combined_prompt = f"{res_orient['spoken_prompt']} {res_q['spoken_prompt']}"
        initial_state.update(res_q)
        initial_state["spoken_prompt"] = combined_prompt
    
    sessions[session_id] = initial_state
    
    return AgentStepResponse(
        session_id=session_id,
        status=initial_state.get("status", "INTERVIEWING"),
        spoken_prompt=initial_state.get("spoken_prompt", ""),
        audio_cue=initial_state.get("audio_cue", "orientation"),
        current_field=initial_state.get("current_field"),
        answers=initial_state.get("answers", {})
    )

@app.post("/session/interact", response_model=AgentStepResponse)
def interact(req: InteractRequest):
    """Processes user voice response, validates guardrails, and advances graph."""
    state = sessions.get(req.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
        
    state["user_speech"] = req.user_speech.strip()
    
    # If currently waiting for user to specify which field to correct
    if state.get("status") == "AWAITING_FIELD_CHOICE":
        res_sel = select_field_for_correction_node(state)
        state.update(res_sel)
        return AgentStepResponse(
            session_id=req.session_id,
            status="INTERVIEWING",
            spoken_prompt=state.get("spoken_prompt", ""),
            audio_cue="question",
            is_valid=True,
            current_field=state.get("current_field")
        )
    
    # 1. Ekstraksi semantik suara
    res_ext = listen_and_extract_node(state)
    state.update(res_ext)
    
    # 2. Validasi deterministik
    res_guard = guardrail_node(state)
    state.update(res_guard)
    
    # 3. Evaluasi routing conditional edge
    route = route_after_validation(state)
    
    if route == "error_guidance":
        res_err = error_guidance_node(state)
        state.update(res_err)
        return AgentStepResponse(
            session_id=req.session_id,
            status="RETRY_REQUIRED",
            spoken_prompt=state.get("spoken_prompt", ""),
            audio_cue=state.get("audio_cue", "error"),
            is_valid=False,
            current_field=state.get("current_field")
        )
    else:
        # Valid! Maju ke antrean berikutnya
        res_adv = advance_queue_node(state)
        state.update(res_adv)
        
        # Cek apakah masih ada field berikutnya atau masuk ke review summary
        next_route = route_after_advance(state)
        if next_route == "review_summary":
            res_rev = review_summary_node(state)
            state.update(res_rev)
            return AgentStepResponse(
                session_id=req.session_id,
                status="AWAITING_CONFIRMATION",
                spoken_prompt=state.get("spoken_prompt", ""),
                audio_cue="review",
                is_valid=True,
                answers=state.get("answers")
            )
        else:
            # Buat pertanyaan untuk field selanjutnya
            res_q = synthesize_question_node(state)
            state.update(res_q)
            return AgentStepResponse(
                session_id=req.session_id,
                status="INTERVIEWING",
                spoken_prompt=state.get("spoken_prompt", ""),
                audio_cue="question",
                is_valid=True,
                current_field=state.get("current_field"),
                answers=state.get("answers")
            )

@app.post("/session/confirm", response_model=AgentStepResponse)
def confirm_submission(req: ConfirmRequest):
    """Processes final confirmation from user and produces DOM synchronization payload."""
    state = sessions.get(req.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
        
    state["confirmation_response"] = req.confirmation_response
    
    # Process confirmation response with correction loop support
    res_conf = handle_review_confirmation_node(state)
    state.update(res_conf)
    decision = state.get("review_decision")
    
    if decision == "CONFIRMED":
        res_sync = sync_dom_node(state)
        state.update(res_sync)
        return AgentStepResponse(
            session_id=req.session_id,
            status="COMPLETED",
            spoken_prompt=state.get("spoken_prompt", ""),
            audio_cue="complete",
            sync_payload=state.get("answers", {})
        )
    elif decision == "CORRECT_FIELD":
        return AgentStepResponse(
            session_id=req.session_id,
            status="INTERVIEWING",
            spoken_prompt=state.get("spoken_prompt", ""),
            audio_cue="question",
            current_field=state.get("current_field")
        )
    elif decision == "ASK_WHICH_FIELD":
        return AgentStepResponse(
            session_id=req.session_id,
            status="AWAITING_FIELD_CHOICE",
            spoken_prompt=state.get("spoken_prompt", ""),
            audio_cue="question"
        )
    else:
        return AgentStepResponse(
            session_id=req.session_id,
            status="CANCELLED",
            spoken_prompt="Pengisian formulir dibatalkan oleh pengguna.",
            audio_cue="error"
        )


# =====================================================================
# WEBSOCKET ENDPOINT (LOW-LATENCY DUPLEX)
# =====================================================================

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    WebSocket channel for instant turn-taking between Chrome Extension and AIRA Agent.
    """
    await websocket.accept()
    try:
        while True:
            data_text = await websocket.receive_text()
            message = json.loads(data_text)
            msg_type = message.get("type")
            
            if msg_type == "START":
                req = StartSessionRequest(**message.get("payload", {}))
                resp = start_session(req)
                await websocket.send_text(resp.model_dump_json())
                
            elif msg_type == "SPEECH":
                req = InteractRequest(session_id=session_id, user_speech=message.get("speech", ""))
                resp = interact(req)
                await websocket.send_text(resp.model_dump_json())
                
            elif msg_type == "CONFIRM":
                req = ConfirmRequest(session_id=session_id, confirmation_response=message.get("confirmation", ""))
                resp = confirm_submission(req)
                await websocket.send_text(resp.model_dump_json())
                
    except WebSocketDisconnect:
        print(f"[WebSocket] Client disconnected for session: {session_id}")

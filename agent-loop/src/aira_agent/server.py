"""
FastAPI Server for AIRA Universal Voice Agent.
Provides REST and WebSocket endpoints for the Chrome Extension to communicate
with the LangGraph voice-form orchestration loop.
"""

import os
import re
import uuid
import json
import time
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form
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
    sync_dom_node,
    step_back_node,
    jump_to_field_node,
    explain_field_node,
    summarize_page_node,
    classify_intent_node,
    parse_form_dom_with_llm,
    get_field_id
)
from aira_agent.edges import (
    route_after_validation,
    route_after_advance,
    route_after_confirmation
)
from aira_agent.graph import aira_turn_graph, aira_review_graph, aira_agent_app

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
    compact_dom: Optional[str] = Field(default=None, description="Pruned compact semantic HTML representation of form for LLM structuring")
    deterministic: bool = Field(default=False, description="True for Google Forms parsed structurally from FB_PUBLIC_LOAD_DATA_ (skip LLM form parsing)")
    answers: Optional[Dict[str, Any]] = Field(default=None, description="Jawaban terkumpul (untuk melanjutkan sesi setelah server reload)")
    step_index: Optional[int] = Field(default=None, description="Indeks pertanyaan aktif saat sesi dipulihkan")

class InteractRequest(BaseModel):
    session_id: str
    user_speech: Optional[str] = None
    user_input: Optional[str] = None
    already_extracted: bool = False

    @property
    def text(self) -> str:
        return (self.user_speech or self.user_input or "").strip()

class ConfirmRequest(BaseModel):
    session_id: str
    confirmation_response: Optional[str] = None
    confirmation: Optional[str] = None

    @property
    def text(self) -> str:
        return (self.confirmation_response or self.confirmation or "").strip()

class SessionActionRequest(BaseModel):
    session_id: str

class JumpToFieldRequest(BaseModel):
    session_id: str
    field_id: str

class PageIntentRequest(BaseModel):
    user_input: str
    dom_overview: Dict[str, Any]

class PageSummarizeRequest(BaseModel):
    dom_overview: Dict[str, Any]

class FieldExplainRequest(BaseModel):
    field: Dict[str, Any]

class AgentStepResponse(BaseModel):
    session_id: str
    status: str
    spoken_prompt: str
    audio_cue: Optional[str] = "question"
    is_valid: Optional[bool] = True
    current_field: Optional[Dict[str, Any]] = None
    answers: Optional[Dict[str, Any]] = None
    sync_payload: Optional[Dict[str, Any]] = None
    
    # Client Wizard Progress Metadata
    step_index: int = 0
    total_steps: int = 1
    progress_percent: int = 0
    field_hint: Optional[str] = None
    parser_mode: Optional[str] = "llm"
    parser_details: Optional[Dict[str, Any]] = None


def make_step_response(
    state: FormAgentState,
    override_prompt: Optional[str] = None,
    override_status: Optional[str] = None,
    override_cue: Optional[str] = None,
    sync_payload: Optional[Dict[str, Any]] = None,
    is_valid: Optional[bool] = None
) -> AgentStepResponse:
    """Constructs a consistent AgentStepResponse with calculated step progress and field hint."""
    total = state.get("total_fields_count") or (len(state.get("filled_fields", [])) + (1 if state.get("current_field") else 0) + len(state.get("fields_queue", [])))
    total = max(1, total)
    
    filled_count = len(state.get("filled_fields", []))
    if state.get("is_correcting"):
        cur_idx = state.get("current_step_index", filled_count)
    else:
        cur_idx = state.get("current_step_index")
        if cur_idx is None:
            cur_idx = filled_count
    cur_idx = min(cur_idx, total - 1)
    
    status = override_status or state.get("status", "INTERVIEWING")
    
    if status in ["COMPLETED", "AWAITING_CONFIRMATION"]:
        progress = 100
    else:
        progress = min(100, int((cur_idx + 1) / total * 100)) if total > 0 else 0
        
    hint = state.get("field_hint")
    if not hint and state.get("current_field"):
        hint = explain_field_node(state["current_field"])
        
    return AgentStepResponse(
        session_id=state.get("session_id", ""),
        status=status,
        spoken_prompt=override_prompt or state.get("spoken_prompt", ""),
        audio_cue=override_cue or state.get("audio_cue", "question"),
        is_valid=is_valid if is_valid is not None else state.get("is_valid", True),
        current_field=state.get("current_field"),
        answers=state.get("answers", {}),
        sync_payload=sync_payload if sync_payload is not None else state.get("answers", {}),
        step_index=cur_idx,
        total_steps=total,
        progress_percent=progress,
        field_hint=hint,
        parser_mode=state.get("parser_mode", "llm"),
        parser_details=state.get("parser_details")
    )


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
    start_time = time.time()
    
    # 1. Resolve raw fields:
    #    Priority 1 = deterministic Google Forms fields (FB_PUBLIC_LOAD_DATA_)
    #    Priority 2 = LLM semantic parsing from compact_dom (non-Google forms)
    raw_fields: List[Dict[str, Any]] = []
    page_title = req.page_title or "Formulir Layanan Publik"
    parser_mode = "fallback"
    parser_reason = "No compact_dom provided in request"

    if req.deterministic:
        if req.fields:
            raw_fields = req.fields
        elif req.form and isinstance(req.form, dict):
            raw_fields = req.form.get("fields", []) or []
        parser_mode = "deterministic"
        parser_reason = "Google Forms structural parser (FB_PUBLIC_LOAD_DATA_) — LLM form parsing skipped"
    elif req.compact_dom and len(req.compact_dom.strip()) > 10:
        try:
            llm_parsed = parse_form_dom_with_llm(req.compact_dom)
            if llm_parsed and len(llm_parsed) > 0:
                raw_fields = llm_parsed
                parser_mode = "llm"
                parser_reason = "Successfully extracted via LLM Semantic Perception"
            else:
                parser_reason = "LLM returned empty or unparseable response"
        except Exception as e:
            parser_reason = f"Exception during LLM form parsing: {e}"

    duration = time.time() - start_time

    # Fallback to client-scanned heuristic fields if LLM parser yielded no fields
    if not raw_fields:
        parser_mode = "fallback"
        if req.fields:
            raw_fields = req.fields
        elif req.form and isinstance(req.form, dict) and "fields" in req.form:
            raw_fields = req.form.get("fields", [])
            if req.form.get("title") and page_title == "Formulir Layanan Publik":
                page_title = req.form.get("title")

    # Prominent Perception Logging
    print("\n" + "=" * 80)
    if parser_mode == "deterministic":
        print(f"🔵 [AIRA FORM PERCEPTION - MODE: DETERMINISTIC GOOGLE FORMS]")
        print(f"Sumber: {parser_reason}")
        print(f"Hasil: {len(raw_fields)} field terstruktur dari parser FB_PUBLIC_LOAD_DATA_:")
        for i, f in enumerate(raw_fields, 1):
            opts_desc = f" | Opsi: {', '.join(f.get('options', []))}" if f.get("options") else ""
            grid_desc = ""
            if f.get("gridQuestion") and f.get("gridRowLabel"):
                grid_desc = f" | Grid: '{f.get('gridQuestion')}' baris '{f.get('gridRowLabel')}'"
            other_desc = " (hasOther)" if f.get("hasOther") or f.get("otherAllowed") else ""
            print(f"  {i}. [{f.get('type', 'text')}] {f.get('label', 'Field')}{opts_desc}{grid_desc}{other_desc}")
    elif parser_mode == "llm":
        model_name = os.getenv("ROUTER_MODEL") or os.getenv("GEMINI_MODEL") or "Active LLM"
        print(f"🟢 [AIRA FORM PERCEPTION - MODE: LLM]")
        print(f"Model: {model_name} | Durasi: {duration:.2f}s")
        print(f"Hasil: Berhasil mengekstrak {len(raw_fields)} field terstruktur dari compact DOM:")
        for i, f in enumerate(raw_fields, 1):
            opts_desc = f" | Opsi: {', '.join(f.get('options', []))}" if f.get("options") else ""
            other_desc = " (hasOther)" if f.get("hasOther") else ""
            print(f"  {i}. [{f.get('type', 'text')}] {f.get('label', 'Field')}{opts_desc}{other_desc}")
    else:
        print(f"🟡 [AIRA FORM PERCEPTION - MODE: FALLBACK HEURISTIK]")
        print(f"Penyebab: {parser_reason}")
        print(f"Tindakan: Beralih menggunakan {len(raw_fields)} field hasil scanning lokal client:")
        for i, f in enumerate(raw_fields, 1):
            opts_desc = f" | Opsi: {', '.join(f.get('options', []))}" if f.get("options") else ""
            print(f"  {i}. [{f.get('type', 'text')}] {f.get('label', 'Field')}{opts_desc}")
    print("=" * 80 + "\n")

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
            if f_copy.get("domId") and str(f_copy["domId"]) != field_id:
                initial_answers[str(f_copy["domId"])] = cur_val
            
        normalized_fields.append(f_copy)

    # Resume support: merge previously collected answers and jump to the active step.
    merged_answers: Dict[str, Any] = dict(initial_answers)
    if req.answers:
        valid_field_ids = {str(f.get("id")) for f in normalized_fields} | {str(f.get("domId")) for f in normalized_fields if f.get("domId")}
        for key, value in req.answers.items():
            if str(key) in valid_field_ids:
                merged_answers[str(key)] = value

    start_index = 0
    if req.step_index is not None:
        start_index = max(0, min(int(req.step_index), len(normalized_fields)))
    elif req.answers:
        for i, f in enumerate(normalized_fields):
            fid = get_field_id(f)
            if fid not in merged_answers or str(merged_answers.get(fid, "")).strip() == "":
                start_index = i
                break
        else:
            start_index = len(normalized_fields)

    resumed_filled: List[FormField] = []
    for f in normalized_fields[:start_index]:
        fid = get_field_id(f)
        if fid in merged_answers:
            resumed_filled.append(dict(f, value=merged_answers[fid]))

    fields_queue = normalized_fields[start_index:]
    current_field = fields_queue[0] if fields_queue else None

    initial_state: FormAgentState = {
        "session_id": session_id,
        "page_title": page_title,
        "page_url": req.page_url or "",
        "compact_dom": req.compact_dom,
        "fields_queue": fields_queue,
        "current_field": current_field,
        "filled_fields": resumed_filled,
        "answers": merged_answers,
        "retry_count": 0,
        "status": "INTERVIEWING",
        "is_correcting": False,
        "total_fields_count": len(normalized_fields),
        "current_step_index": start_index,
        "parser_mode": parser_mode,
        "parser_details": {
            "mode": parser_mode,
            "reason": parser_reason,
            "duration_sec": round(duration, 2),
            "fields_count": len(normalized_fields),
            "resumed": bool(req.answers or req.step_index is not None),
            "start_index": start_index
        }
    }
    
    # 3. Orientation + first question synthesis (or straight to review when resuming at the end)
    if current_field:
        res_orient = orient_page_node(initial_state)
        initial_state.update(res_orient)
        res_q = synthesize_question_node(initial_state)
        combined_prompt = f"{res_orient['spoken_prompt']} {res_q['spoken_prompt']}"
        initial_state.update(res_q)
        initial_state["spoken_prompt"] = combined_prompt
        initial_state["status"] = "INTERVIEWING"
    else:
        initial_state["status"] = "REVIEWING"
        res_rev = review_summary_node(initial_state)
        initial_state.update(res_rev)
    
    sessions[session_id] = initial_state
    
    # Fresh sessions keep the orientation cue; resumed ones go straight to the question cue.
    return make_step_response(initial_state, override_cue="orientation" if start_index == 0 and not req.answers else None)

@app.post("/session/interact", response_model=AgentStepResponse)
def interact(req: InteractRequest):
    """Processes user voice response, validates guardrails, and advances graph."""
    state = sessions.get(req.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
        
    input_text = req.text
    state["user_speech"] = input_text

    # If currently on review / confirmation screen or all fields completed
    if state.get("status") in ["AWAITING_CONFIRMATION", "REVIEWING", "COMPLETED"] or state.get("current_field") is None:
        req_conf = ConfirmRequest(session_id=req.session_id, confirmation_response=input_text)
        return confirm_submission(req_conf)

    # If currently waiting for user to specify which field to correct
    if state.get("status") == "AWAITING_FIELD_CHOICE":
        res_sel = select_field_for_correction_node(state)
        state.update(res_sel)
        return make_step_response(state, is_valid=True)
    
    state["already_extracted"] = req.already_extracted
    # Reset any previous turn intent so it is cleanly evaluated by detect_intent_node
    state.pop("turn_intent", None)

    # 100% Executed through True LangGraph StateGraph (detect_intent -> extract -> guardrail -> advance/guidance)
    final_state = aira_turn_graph.invoke(state)
    sessions[req.session_id] = final_state
    return make_step_response(final_state)


# Whisper hallucinates these phrases on silence/noise audio (large-v3 especially).
WHISPER_HALLUCINATIONS = {
    "terima kasih telah menonton",
    "terima kasih",
    "terima kasih banyak",
    "selamat menonton",
    "thank you for watching",
    "thanks for watching",
    "thank you",
    "please subscribe",
    "subscribe",
    "subtitle by",
    "subtitles by",
    "amaraorg",
    "wwwyoutubecom"
}


def clean_transcript(text: str) -> str:
    """Drops empty transcripts and known Whisper silence hallucinations."""
    cleaned = re.sub(r"\s+", " ", (text or "")).strip()
    normalized = re.sub(r"[^\w\s]", "", cleaned.lower()).strip()
    if len(normalized) < 2:
        return ""
    if normalized in WHISPER_HALLUCINATIONS:
        print(f"[AIRA STT] Discarded Whisper hallucination: '{cleaned}'")
        return ""
    return cleaned


def build_stt_context_prompt(field: Optional[Dict[str, Any]]) -> str:
    """Bias context for STT: the current question and its allowed/expected options."""
    if not field:
        return ""
    parts: List[str] = []
    label = field.get("label") or ""
    if label:
        parts.append(f"Pertanyaan: {label}")
    options = field.get("options") or field.get("columns") or []
    if options:
        parts.append("Pilihan jawaban: " + ", ".join(str(o) for o in options))
    if field.get("hasOther") or field.get("otherAllowed"):
        parts.append("Jawaban lain di luar pilihan juga diperbolehkan")
    return ". ".join(parts) + ("." if parts else "")


async def transcribe_audio_via_9router(file_bytes: bytes, filename: str = "audio.webm", prompt: str = "") -> str:
    """Transcribes user speech audio bytes via 9Router Whisper-compatible endpoint."""
    router_base_url = os.getenv("ROUTER_BASE_URL", "https://9r.disra.net/v1")
    normalized_url = router_base_url.strip().rstrip("/")
    if normalized_url.endswith("/chat/completions"):
        normalized_url = normalized_url[:-len("/chat/completions")].rstrip("/")
    
    stt_endpoint = f"{normalized_url}/audio/transcriptions"
    api_key = os.getenv("ROUTER_API_KEY", "9router")
    model = os.getenv("ROUTER_STT_MODEL", "whisper-1")

    print(f"[AIRA STT] Active service: 9Router Whisper STT -> {stt_endpoint} (Model: {model}, Timeout: 30.0s)")
    if prompt:
        print(f"[AIRA STT] Context prompt: {prompt}")
    
    headers = {
        "Authorization": f"Bearer {api_key}"
    }
    
    files = {
        "file": (filename, file_bytes, "audio/webm")
    }
    data = {
        "model": model,
        "language": "id",
        "temperature": "0"
    }
    if prompt:
        data["prompt"] = prompt
    
    try:
        import httpx
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(stt_endpoint, headers=headers, files=files, data=data)
            if resp.status_code == 200:
                result_json = resp.json()
                transcript = clean_transcript(result_json.get("text", "").strip())
                print(f"[9Router STT Transcribed]: '{transcript}'")
                return transcript
            else:
                print(f"[9Router STT Error {resp.status_code}]: {resp.text}")
                return ""
    except Exception as e:
        print(f"[9Router STT Exception]: {e}")
        return ""


@app.post("/audio/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Transcribes an audio file into text using 9Router Whisper-compatible STT."""
    file_bytes = await file.read()
    transcript = await transcribe_audio_via_9router(file_bytes, file.filename or "speech.webm")
    return {"text": transcript}


@app.post("/session/transcribe")
async def session_transcribe(
    session_id: str = Form(...),
    file: UploadFile = File(...),
    duration_ms: Optional[int] = Form(None)
):
    """Transcribes audio for the session's current field WITHOUT advancing it.

    Used by the extension confirmation flow: server Whisper produces the transcript,
    the user confirms it (or asks to retry), and only then is the answer submitted
    via /session/interact.
    """
    state = sessions.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")

    context = build_stt_context_prompt(state.get("current_field"))

    # Silent/too-short recordings make Whisper hallucinate; skip them entirely.
    if duration_ms is not None and duration_ms < 800:
        print(f"[AIRA STT] Recording too short ({duration_ms} ms); skipping transcription.")
        return {"transcript": "", "prompt": context, "skipped": "too_short"}

    file_bytes = await file.read()
    transcript = await transcribe_audio_via_9router(file_bytes, file.filename or "speech.webm", prompt=context)

    # Parse the raw transcript into the expected value for this field (digits,
    # closest allowed option, ...) so the user confirms the parsed answer.
    normalized = transcript
    field = state.get("current_field")
    if transcript and field:
        try:
            extraction = listen_and_extract_node({"current_field": field, "user_speech": transcript})
            normalized = str(extraction.get("extracted_value") or transcript).strip()
        except Exception as e:
            print(f"[AIRA STT] Normalization failed, using raw transcript: {e}")

    if normalized and normalized != transcript:
        print(f"[AIRA STT] Normalized transcript: '{transcript}' -> '{normalized}'")

    return {"transcript": transcript, "normalized": normalized, "prompt": context}


@app.post("/session/interact-audio", response_model=AgentStepResponse)
async def interact_audio(session_id: str = Form(...), file: UploadFile = File(...)):
    """Processes user voice response from audio file: transcribes via 9Router STT, then runs LangGraph."""
    state = sessions.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
        
    file_bytes = await file.read()
    stt_context = build_stt_context_prompt(state.get("current_field"))
    transcript = await transcribe_audio_via_9router(file_bytes, file.filename or "speech.webm", prompt=stt_context)
    if not transcript:
        return make_step_response(
            state,
            override_status="RETRY_REQUIRED",
            override_prompt="Suara tidak terdengar jelas. Mohon ucapkan kembali.",
            override_cue="error",
            is_valid=False
        )
        
    req = InteractRequest(session_id=session_id, user_speech=transcript)
    return interact(req)


@app.post("/session/confirm", response_model=AgentStepResponse)
def confirm_submission(req: ConfirmRequest):
    """Processes final confirmation from user and produces DOM synchronization payload via LangGraph."""
    state = sessions.get(req.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
        
    state["confirmation_response"] = req.text
    
    # 100% Executed through True LangGraph Review StateGraph (handle_confirmation -> sync_dom/jump_to/choice)
    final_state = aira_review_graph.invoke(state)
    sessions[req.session_id] = final_state
    return make_step_response(final_state)

@app.post("/session/step-back", response_model=AgentStepResponse)
def step_back(req: SessionActionRequest):
    """Handles '< Kembali' button click: moves back to previous question via LangGraph."""
    state = sessions.get(req.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
        
    # Set explicit turn intent and invoke LangGraph StateGraph (detect_intent -> step_back -> synthesize_question)
    state["turn_intent"] = "NAVIGATE_BACK"
    final_state = aira_turn_graph.invoke(state)
    sessions[req.session_id] = final_state
    return make_step_response(final_state)

@app.post("/session/jump-to", response_model=AgentStepResponse)
def jump_to_field(req: JumpToFieldRequest):
    """Handles 'Ubah' button click next to a specific field on the review screen."""
    state = sessions.get(req.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
        
    res_jump = jump_to_field_node(state, req.field_id)
    state.update(res_jump)
    return make_step_response(state)

@app.post("/session/cancel")
def cancel_session(req: SessionActionRequest):
    """Cleans up active form session when user presses Esc or closes modal."""
    if req.session_id in sessions:
        sessions.pop(req.session_id, None)
        return {"status": "CANCELLED", "message": "Sesi formulir berhasil ditutup."}
    return {"status": "NOT_FOUND", "message": "Sesi tidak ditemukan atau sudah ditutup."}


# =====================================================================
# SUBSCRIPTION-BASED AI PROXY ENDPOINTS
# =====================================================================

@app.post("/page/intent")
def classify_page_intent(req: PageIntentRequest):
    """Classifies user voice query into AIRAIntentResult (NAVIGATE, FILL_FORM, SUMMARIZE, etc.)."""
    result = classify_intent_node(req.user_input, req.dom_overview)
    return result

@app.post("/page/summarize")
def summarize_page(req: PageSummarizeRequest):
    """Generates polite, concise 3-4 sentence page summary for blind & elderly users."""
    summary = summarize_page_node(req.dom_overview)
    return {"summary": summary}

@app.post("/field/explain")
def explain_field(req: FieldExplainRequest):
    """Generates accessibility documentation reference (KTP, KK, BPJS) for a field."""
    hint = explain_field_node(req.field)
    return {"hint": hint}


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
                
            elif msg_type == "STEP_BACK":
                req = SessionActionRequest(session_id=session_id)
                resp = step_back(req)
                await websocket.send_text(resp.model_dump_json())
                
            elif msg_type == "JUMP_TO":
                req = JumpToFieldRequest(session_id=session_id, field_id=message.get("field_id", ""))
                resp = jump_to_field(req)
                await websocket.send_text(resp.model_dump_json())
                
            elif msg_type == "CANCEL":
                req = SessionActionRequest(session_id=session_id)
                cancel_session(req)
                await websocket.send_text(json.dumps({"status": "CANCELLED"}))
                
    except WebSocketDisconnect:
        print(f"[WebSocket] Client disconnected for session: {session_id}")

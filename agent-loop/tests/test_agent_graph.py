"""
Unit and Integration Tests for AIRA LangGraph Agent Loop.
Verifies normalization, deterministic guardrails, cyclical error recovery,
and FastAPI communication.
"""

import pytest
from fastapi.testclient import TestClient

from aira_agent.state import FormAgentState, DOMField
from aira_agent.nodes import (
    clean_indonesian_spoken_digits,
    orient_page_node,
    synthesize_question_node,
    listen_and_extract_node,
    guardrail_node,
    error_guidance_node,
    advance_queue_node,
    review_summary_node
)
from aira_agent.edges import route_after_validation, route_after_advance, route_after_confirmation
from aira_agent.server import app

client = TestClient(app)

# =====================================================================
# 1. UNIT TESTS: NORMALISASI SUARA & GUARDRAILS
# =====================================================================

def test_spoken_digits_normalization():
    raw_speech = "tiga dua nol satu satu dua tiga empat lima enam tujuh delapan nol nol nol satu"
    cleaned = clean_indonesian_spoken_digits(raw_speech)
    assert cleaned == "3201123456780001"
    assert len(cleaned) == 16


def test_guardrail_nik_invalid_length():
    field: DOMField = {
        "domId": "nik_input",
        "tag": "input",
        "type": "text",
        "label": "NIK Pasien",
        "required": True,
        "maxLength": 16
    }
    state: FormAgentState = {
        "current_field": field,
        "extracted_value": "320112345" # Only 9 digits
    }
    
    result = guardrail_node(state)
    assert result["is_valid"] is False
    assert "16 digit" in result["validation_error"]
    assert result["audio_cue"] == "error"
    
    # Test routing
    state.update(result)
    assert route_after_validation(state) == "error_guidance"


def test_guardrail_nik_valid_success():
    field: DOMField = {
        "domId": "nik_input",
        "tag": "input",
        "type": "text",
        "label": "NIK Pasien",
        "required": True,
        "maxLength": 16
    }
    state: FormAgentState = {
        "current_field": field,
        "extracted_value": "3201123456780001",
        "answers": {},
        "filled_fields": []
    }
    
    result = guardrail_node(state)
    assert result["is_valid"] is True
    assert result["answers"]["nik_input"] == "3201123456780001"
    assert result["audio_cue"] == "success"
    
    state.update(result)
    assert route_after_validation(state) == "advance_queue"


def test_select_fuzzy_matching():
    field: DOMField = {
        "domId": "sel_poli",
        "tag": "select",
        "type": "select-one",
        "label": "Poli Tujuan",
        "options": ["Poli Umum", "Poli Mata", "Poli Gigi"]
    }
    state: FormAgentState = {
        "current_field": field,
        "user_speech": "Saya mau daftar ke Poli Gigi saja"
    }
    
    result = listen_and_extract_node(state)
    assert result["extracted_value"] == "Poli Gigi"


def test_checkbox_normalization():
    field: DOMField = {
        "domId": "chk_agree",
        "tag": "input",
        "type": "checkbox",
        "label": "Syarat Ketentuan"
    }
    state_yes: FormAgentState = {
        "current_field": field,
        "user_speech": "Iya saya setuju sekali"
    }
    res_yes = listen_and_extract_node(state_yes)
    assert res_yes["extracted_value"] is True
    
    state_no: FormAgentState = {
        "current_field": field,
        "user_speech": "Tidak mau"
    }
    res_no = listen_and_extract_node(state_no)
    assert res_no["extracted_value"] is False


# =====================================================================
# 2. INTEGRATION TESTS: FASTAPI REST ENDPOINTS
# =====================================================================

def test_api_session_lifecycle():
    # 1. Start session
    payload = {
        "page_title": "Portal Pendaftaran RSUD",
        "page_url": "https://rsud.go.id/register",
        "fields": [
            {
                "domId": "txt_nik",
                "tag": "input",
                "type": "text",
                "label": "NIK KTP",
                "required": True,
                "maxLength": 16
            },
            {
                "domId": "txt_nama",
                "tag": "input",
                "type": "text",
                "label": "Nama Lengkap",
                "required": True
            }
        ]
    }
    res_start = client.post("/session/start", json=payload)
    assert res_start.status_code == 200
    data_start = res_start.json()
    session_id = data_start["session_id"]
    assert "Selamat datang" in data_start["spoken_prompt"]
    assert data_start["current_field"]["domId"] == "txt_nik"
    
    # 2. Interact with wrong NIK (too short)
    res_err = client.post("/session/interact", json={
        "session_id": session_id,
        "user_speech": "tiga dua nol satu lima"
    })
    assert res_err.status_code == 200
    data_err = res_err.json()
    assert data_err["status"] == "RETRY_REQUIRED"
    assert data_err["is_valid"] is False
    assert "16 digit" in data_err["spoken_prompt"]
    
    # 3. Correct NIK
    res_correct_nik = client.post("/session/interact", json={
        "session_id": session_id,
        "user_speech": "tiga dua nol satu satu dua tiga empat lima enam tujuh delapan nol nol nol satu"
    })
    assert res_correct_nik.status_code == 200
    data_nik = res_correct_nik.json()
    assert data_nik["status"] == "INTERVIEWING"
    assert data_nik["current_field"]["domId"] == "txt_nama"
    
    # 4. Fill Nama
    res_nama = client.post("/session/interact", json={
        "session_id": session_id,
        "user_speech": "Samantha Laqueena Ginting"
    })
    assert res_nama.status_code == 200
    data_nama = res_nama.json()
    assert data_nama["status"] == "AWAITING_CONFIRMATION"
    assert "Samantha Laqueena Ginting" in data_nama["spoken_prompt"]
    
    # 5. Confirm Submission
    res_confirm = client.post("/session/confirm", json={
        "session_id": session_id,
        "confirmation_response": "Ya, kirimkan sekarang"
    })
    assert res_confirm.status_code == 200
    data_confirm = res_confirm.json()
    assert data_confirm["status"] == "COMPLETED"
    assert data_confirm["sync_payload"]["txt_nik"] == "3201123456780001"
    assert data_confirm["sync_payload"]["txt_nama"] == "Samantha Laqueena Ginting"


def test_client_form_container_and_field_metadata_compatibility():
    """Verifies that the server accepts client-side FormContainerMetadata using 'id' and 'validationKey'."""
    container_payload = {
        "form": {
            "id": "form-pendaftaran-beasiswa",
            "title": "Pendaftaran Beasiswa Unggulan",
            "fields": [
                {
                    "id": "field-1",
                    "label": "Nomor WhatsApp",
                    "type": "tel",
                    "placeholder": "08xxxxxxxxxx",
                    "required": True,
                    "currentValue": "",
                    "validationKey": "phone",
                    "hint": "Nomor WhatsApp aktif"
                },
                {
                    "id": "field-2",
                    "label": "Email Penerima",
                    "type": "email",
                    "placeholder": "nama@email.com",
                    "required": True,
                    "currentValue": "budi.santoso@univ.ac.id",
                    "validationKey": "email"
                }
            ]
        }
    }
    
    # 1. Start session with FormContainer payload
    res_start = client.post("/session/start", json=container_payload)
    assert res_start.status_code == 200
    data_start = res_start.json()
    session_id = data_start["session_id"]
    
    # Check id canonical binding & pre-filled currentValue
    assert data_start["current_field"]["id"] == "field-1"
    assert data_start["current_field"]["domId"] == "field-1"
    assert data_start["answers"]["field-2"] == "budi.santoso@univ.ac.id"
    
    # 2. Test Phone validationKey failure
    res_bad_phone = client.post("/session/interact", json={
        "session_id": session_id,
        "user_speech": "satu dua tiga empat lima"
    })
    assert res_bad_phone.status_code == 200
    data_bad_phone = res_bad_phone.json()
    assert data_bad_phone["status"] == "RETRY_REQUIRED"
    assert data_bad_phone["is_valid"] is False
    assert "08 atau +62" in data_bad_phone["spoken_prompt"]
    
    # 3. Test Phone validationKey success
    res_good_phone = client.post("/session/interact", json={
        "session_id": session_id,
        "user_speech": "nol delapan satu dua delapan delapan sembilan sembilan nol nol satu dua"
    })
    assert res_good_phone.status_code == 200
    data_good_phone = res_good_phone.json()
    # Next field (field-2 Email)
    assert data_good_phone["current_field"]["id"] == "field-2"
    
    # 4. Fill Email
    res_email = client.post("/session/interact", json={
        "session_id": session_id,
        "user_speech": "budi dot baru at gmail dot com"
    })
    assert res_email.status_code == 200
    data_email = res_email.json()
    assert data_email["status"] == "AWAITING_CONFIRMATION"
    
    # 5. Confirm and verify sync_payload using canonical 'id'
    res_conf = client.post("/session/confirm", json={
        "session_id": session_id,
        "confirmation_response": "Ya data sudah sesuai kirim"
    })
    assert res_conf.status_code == 200
    data_conf = res_conf.json()
    assert data_conf["status"] == "COMPLETED"
    assert "field-1" in data_conf["sync_payload"]
    assert "field-2" in data_conf["sync_payload"]
    assert data_conf["sync_payload"]["field-1"] == "081288990012"
    assert data_conf["sync_payload"]["field-2"] == "budi.baru@gmail.com"


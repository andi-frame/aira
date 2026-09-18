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


def test_ui_progress_and_navigation_actions():
    """Verifies step_index, total_steps, progress_percent, step-back, jump-to, and cancel."""
    payload = {
        "page_title": "Pendaftaran KTP Baru",
        "fields": [
            {"id": "nik", "label": "Nomor NIK", "validationKey": "nik", "required": True},
            {"id": "nama", "label": "Nama Lengkap", "required": True},
            {"id": "telp", "label": "Nomor WhatsApp", "validationKey": "phone", "required": True}
        ]
    }
    # 1. Start session & verify progress metadata
    res_start = client.post("/session/start", json=payload)
    assert res_start.status_code == 200
    data_start = res_start.json()
    session_id = data_start["session_id"]
    assert data_start["step_index"] == 0
    assert data_start["total_steps"] == 3
    assert data_start["progress_percent"] == 33
    assert data_start["field_hint"] is not None
    assert "16 digit" in data_start["field_hint"]

    # 2. Fill step 1 (NIK)
    res_step1 = client.post("/session/interact", json={
        "session_id": session_id,
        "user_speech": "3201123456780001"
    })
    assert res_step1.status_code == 200
    data_step1 = res_step1.json()
    assert data_step1["step_index"] == 1
    assert data_step1["current_field"]["id"] == "nama"
    assert data_step1["progress_percent"] == 66

    # 3. Test Step-Back (< Kembali button)
    res_back = client.post("/session/step-back", json={"session_id": session_id})
    assert res_back.status_code == 200
    data_back = res_back.json()
    assert data_back["current_field"]["id"] == "nik"
    assert data_back["step_index"] == 0

    # 4. Test Jump-To (Ubah button on specific field)
    res_jump = client.post("/session/jump-to", json={"session_id": session_id, "field_id": "telp"})
    assert res_jump.status_code == 200
    data_jump = res_jump.json()
    assert data_jump["current_field"]["id"] == "telp"
    assert "Nomor WhatsApp" in data_jump["spoken_prompt"]

    # 5. Test Cancel (Modal closed / Esc)
    res_cancel = client.post("/session/cancel", json={"session_id": session_id})
    assert res_cancel.status_code == 200
    assert res_cancel.json()["status"] == "CANCELLED"

    # Confirm session is removed
    res_after = client.post("/session/interact", json={"session_id": session_id, "user_speech": "halo"})
    assert res_after.status_code == 404


def test_subscription_ai_proxy_endpoints():
    """Verifies centralized AI proxy endpoints for subscription-based extension mode."""
    dom_overview = {
        "pageTitle": "Portal Layanan Administrasi Kependudukan",
        "headings": [{"tag": "h1", "text": "Pendaftaran Kartu Tanda Penduduk"}],
        "actionElements": [
            {"id": "btn-daftar", "tag": "button", "text": "Buka Pendaftaran Online", "role": "button"}
        ],
        "forms": [
            {
                "id": "form-ktp",
                "title": "Formulir Permohonan KTP",
                "fields": [{"id": "nik", "label": "NIK", "type": "text"}]
            }
        ],
        "snippets": ["Pelayanan buka setiap hari kerja pukul 08.00 hingga 15.00 WIB."]
    }

    # 1. Test /page/summarize
    res_sum = client.post("/page/summarize", json={"dom_overview": dom_overview})
    assert res_sum.status_code == 200
    assert "summary" in res_sum.json()
    assert len(res_sum.json()["summary"]) > 10

    # 2. Test /page/intent for FILL_FORM
    res_intent = client.post("/page/intent", json={
        "user_input": "Tolong bantu isi formulir ini",
        "dom_overview": dom_overview
    })
    assert res_intent.status_code == 200
    intent_data = res_intent.json()
    assert intent_data["intent"] == "FILL_FORM"
    assert intent_data["targetId"] == "form-ktp"

    # 3. Test /field/explain
    res_explain = client.post("/field/explain", json={
        "field": {"label": "Nomor NIK Pemohon", "validationKey": "nik"}
    })
    assert res_explain.status_code == 200
    assert "16 digit" in res_explain.json()["hint"]


def test_audio_stt_endpoints(monkeypatch):
    """Verifies audio upload endpoints (/audio/transcribe and /session/interact-audio) with 9Router mock."""
    from unittest.mock import AsyncMock
    import aira_agent.server as srv
    
    # Mock transcribe_audio_via_9router
    mock_transcribe = AsyncMock(return_value="tiga dua nol satu satu dua tiga empat lima enam tujuh delapan nol nol nol satu")
    monkeypatch.setattr(srv, "transcribe_audio_via_9router", mock_transcribe)

    # 1. Test /audio/transcribe
    fake_audio_bytes = b"RIFF....WAVEfmt ...."
    res_stt = client.post(
        "/audio/transcribe",
        files={"file": ("speech.wav", fake_audio_bytes, "audio/wav")}
    )
    assert res_stt.status_code == 200
    assert res_stt.json()["text"] == "tiga dua nol satu satu dua tiga empat lima enam tujuh delapan nol nol nol satu"

    # 2. Test /session/interact-audio
    res_start = client.post("/session/start", json={
        "page_title": "Form NIK Pasien",
        "fields": [{"id": "nik", "label": "NIK KTP", "validationKey": "nik", "required": True}]
    })
    session_id = res_start.json()["session_id"]

    res_audio_interact = client.post(
        "/session/interact-audio",
        data={"session_id": session_id},
        files={"file": ("speech.webm", fake_audio_bytes, "audio/webm")}
    )
    assert res_audio_interact.status_code == 200
    data_audio = res_audio_interact.json()
    assert data_audio["status"] == "AWAITING_CONFIRMATION"
    assert data_audio["answers"]["nik"] == "3201123456780001"


def test_review_confirmation_and_cyclical_correction():
    """Verifies that saying 'belum' triggers correction loop rather than premature confirmation."""
    payload = {
        "page_title": "Form Pendaftaran Uji",
        "fields": [
            {"id": "nik", "label": "NIK", "validationKey": "nik", "required": True},
            {"id": "nama", "label": "Nama Lengkap", "required": True}
        ]
    }
    res_start = client.post("/session/start", json=payload)
    session_id = res_start.json()["session_id"]
    
    # Fill NIK
    client.post("/session/interact", json={"session_id": session_id, "user_speech": "3201123456780001"})
    # Fill Nama
    res_nama = client.post("/session/interact", json={"session_id": session_id, "user_speech": "Budi"})
    assert res_nama.json()["status"] == "AWAITING_CONFIRMATION"
    
    # User says "Belum, ada yang belum benar" -> should ask which field, NOT confirm!
    res_belum = client.post("/session/confirm", json={"session_id": session_id, "confirmation_response": "Belum, ada yang belum benar"})
    assert res_belum.json()["status"] == "AWAITING_FIELD_CHOICE"
    assert "data mana yang ingin Anda perbaiki" in res_belum.json()["spoken_prompt"]
    
    # User specifies "Nama Lengkap"
    res_pilih = client.post("/session/interact", json={"session_id": session_id, "user_speech": "Nama Lengkap"})
    assert res_pilih.json()["status"] == "INTERVIEWING"
    assert res_pilih.json()["current_field"]["id"] == "nama"
    
    # User inputs new name "Budi Santoso"
    res_new_name = client.post("/session/interact", json={"session_id": session_id, "user_speech": "Budi Santoso"})
    assert res_new_name.json()["status"] == "AWAITING_CONFIRMATION"
    assert "Budi Santoso" in res_new_name.json()["spoken_prompt"]
    
    # User confirms "Ya sudah benar tolong kirim"
    res_final = client.post("/session/confirm", json={"session_id": session_id, "confirmation_response": "Ya sudah benar tolong kirim"})
    assert res_final.json()["status"] == "COMPLETED"
    assert res_final.json()["sync_payload"]["nama"] == "Budi Santoso"
    assert res_final.json()["sync_payload"]["nik"] == "3201123456780001"





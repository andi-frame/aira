"""
Universal Terminal Simulator for AIRA Voice Agent.
Demonstrates arbitrary form handling (Scholarship, Kelurahan, RSUD)
and the full cyclical review-correction loop.
"""

import sys
import json
from typing import Dict, List, Any
from aira_agent.state import FormAgentState, DOMField
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

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# =====================================================================
# MULTIPLE PRESETS PROVING ARBITRARY FORM AGILITY
# =====================================================================

PRESETS: Dict[str, Dict[str, Any]] = {
    "beasiswa": {
        "title": "Portal Pendaftaran Beasiswa Talenta Unggul",
        "url": "https://beasiswa.kemdikbud.go.id/daftar",
        "fields": [
            {
                "id": "txt_nama_siswa",
                "domId": "txt_nama_siswa",
                "tag": "input",
                "type": "text",
                "name": "fullname",
                "label": "Nama Lengkap Calon Penerima",
                "required": True
            },
            {
                "id": "num_usia",
                "domId": "num_usia",
                "tag": "input",
                "type": "number",
                "name": "age",
                "label": "Usia Calon Mahasiswa",
                "required": True
            },
            {
                "id": "sel_jenjang",
                "domId": "sel_jenjang",
                "tag": "select",
                "type": "select-one",
                "name": "degree",
                "label": "Jenjang Program Beasiswa",
                "required": True,
                "options": ["Diploma Tiga", "Sarjana S1", "Magister S2"]
            },
            {
                "id": "chk_komitmen",
                "domId": "chk_komitmen",
                "tag": "input",
                "type": "checkbox",
                "name": "commitment",
                "label": "Komitmen Pengabdian Pasca Studi",
                "required": True
            }
        ]
    },
    "kelurahan": {
        "title": "Layanan Pengajuan Surat Domisili Kelurahan",
        "url": "https://pelayanan.kelurahan.go.id/domisili",
        "fields": [
            {
                "id": "in_nik",
                "domId": "in_nik",
                "tag": "input",
                "type": "text",
                "name": "nik",
                "label": "Nomor Induk Kependudukan (NIK)",
                "validationKey": "nik",
                "required": True,
                "maxLength": 16
            },
            {
                "id": "in_nama",
                "domId": "in_nama",
                "tag": "input",
                "type": "text",
                "name": "nama",
                "label": "Nama Pemohon",
                "required": True
            },
            {
                "id": "in_keperluan",
                "domId": "in_keperluan",
                "tag": "input",
                "type": "text",
                "name": "tujuan",
                "label": "Keperluan Pembuatan Surat",
                "required": True
            }
        ]
    },
    "rsud": {
        "title": "Pendaftaran Rawat Jalan RSUD",
        "url": "https://rsud.go.id/daftar",
        "fields": [
            {
                "id": "input_nik_pasien",
                "domId": "input_nik_pasien",
                "tag": "input",
                "type": "text",
                "name": "nik",
                "label": "Nomor Induk Kependudukan (NIK)",
                "validationKey": "nik",
                "required": True,
                "maxLength": 16
            },
            {
                "id": "txt_nama_lengkap",
                "domId": "txt_nama_lengkap",
                "tag": "input",
                "type": "text",
                "name": "nama",
                "label": "Nama Lengkap Pasien",
                "required": True
            },
            {
                "id": "sel_poli_tujuan",
                "domId": "sel_poli_tujuan",
                "tag": "select",
                "type": "select-one",
                "name": "poli",
                "label": "Poli Tujuan Layanan",
                "required": True,
                "options": ["Poli Umum", "Poli Mata", "Poli Gigi", "Poli Anak"]
            },
            {
                "id": "chk_setuju_syarat",
                "domId": "chk_setuju_syarat",
                "tag": "input",
                "type": "checkbox",
                "name": "agree",
                "label": "Persetujuan Syarat & Ketentuan",
                "required": True
            }
        ]
    }
}

def print_aira(cue: str, speech: str):
    icon = {
        "orientation": "[AIRA ORIENTASI]",
        "question": "[AIRA BERTANYA]",
        "success": "[AIRA TERCATAT]",
        "error": "[AIRA KOREKSI]",
        "review": "[AIRA REVIEW]",
        "complete": "[AIRA SUKSES]"
    }.get(cue, "[AIRA]")
    
    print(f"\n{icon}: {speech}")

def run_universal_simulation(preset_name: str = "beasiswa", auto_inputs: list[str] = None):
    preset = PRESETS.get(preset_name, PRESETS["beasiswa"])
    
    print("=" * 70)
    print(f"  AIRA UNIVERSAL VOICE AGENT - FORM: {preset['title'].upper()}")
    print("=" * 70)
    
    # 1. Inisialisasi State Awal
    state: FormAgentState = {
        "session_id": f"session-{preset_name}-001",
        "page_title": preset["title"],
        "page_url": preset["url"],
        "fields_queue": list(preset["fields"]),
        "filled_fields": [],
        "answers": {},
        "retry_count": 0,
        "is_correcting": False
    }
    
    # 2. Orientasi Halaman
    res_orient = orient_page_node(state)
    state.update(res_orient)
    print_aira(state.get("audio_cue"), state.get("spoken_prompt"))
    
    input_idx = 0
    
    def get_user_input(prompt_label: str) -> str:
        nonlocal input_idx
        if auto_inputs and input_idx < len(auto_inputs):
            val = auto_inputs[input_idx]
            input_idx += 1
            print(f"[{prompt_label} (SIMULASI SUARA)]: {val}")
            return val
        else:
            try:
                return input(f"[{prompt_label} (BICARA DI MIC)]: ").strip()
            except EOFError:
                return ""

    # 3. Main Loop
    while state.get("status") != "COMPLETED":
        
        # --- SUB-LOOP A: Mengisi Field Aktif ---
        while state.get("status") == "INTERVIEWING" and state.get("current_field"):
            res_q = synthesize_question_node(state)
            state.update(res_q)
            print_aira(state.get("audio_cue"), state.get("spoken_prompt"))
            
            user_speech = get_user_input("USER")
            if not user_speech:
                break
            state["user_speech"] = user_speech
            
            res_ext = listen_and_extract_node(state)
            state.update(res_ext)
            
            res_guard = guardrail_node(state)
            state.update(res_guard)
            
            route = route_after_validation(state)
            if route == "error_guidance":
                res_err = error_guidance_node(state)
                state.update(res_err)
                print_aira(state.get("audio_cue"), state.get("spoken_prompt"))
                continue
            else:
                cur_field = state["current_field"]
                val = state["answers"].get(cur_field.get("id") or cur_field.get("domId"))
                print_aira("success", f"Data '{cur_field['label']}' berhasil divalidasi: {val}")
                
                res_adv = advance_queue_node(state)
                state.update(res_adv)
                
        # --- SUB-LOOP B: Review Summary & Confirmation Gate ---
        if state.get("status") == "REVIEWING":
            res_rev = review_summary_node(state)
            state.update(res_rev)
            print_aira(state.get("audio_cue"), state.get("spoken_prompt"))
            
            confirm = get_user_input("USER KONFIRMASI")
            if not confirm:
                break
                
            state["confirmation_response"] = confirm
            
            res_conf = handle_review_confirmation_node(state)
            state.update(res_conf)
            
            decision = state.get("review_decision")
            
            if decision == "CONFIRMED":
                res_sync = sync_dom_node(state)
                state.update(res_sync)
                print_aira(state.get("audio_cue"), state.get("spoken_prompt"))
                print("\n[DOM SYNCHRONIZATION PAYLOAD FOR CHROME EXTENSION]:")
                print(json.dumps(state.get("answers"), indent=2))
                break
                
            elif decision == "CANCELLED":
                print_aira("error", state.get("spoken_prompt", "Pengisian dibatalkan."))
                break
                
            elif decision == "CORRECT_FIELD":
                print_aira("question", state.get("spoken_prompt"))
                state["status"] = "INTERVIEWING"
                
            elif decision == "ASK_WHICH_FIELD":
                print_aira("question", state.get("spoken_prompt"))
                choice = get_user_input("USER PILIH KOLOM")
                state["user_speech"] = choice
                
                res_sel = select_field_for_correction_node(state)
                state.update(res_sel)

    print("\n" + "=" * 70)
    print("  SIMULASI ALUR AIRA SELESAI")
    print("=" * 70)

if __name__ == "__main__":
    preset_arg = "beasiswa"
    is_demo = False
    
    for arg in sys.argv[1:]:
        if arg.startswith("--preset="):
            preset_arg = arg.split("=")[1].strip()
        elif arg == "--demo":
            is_demo = True

    if is_demo:
        demo_script = [
            "Gunawan",
            "dua puluh satu",
            "Saya pilih Sarjana S1",
            "Ya saya bersedia",
            "belum",
            "Nama Lengkap",
            "Gunawan Wibisono",
            "Ya, sekarang sudah benar, tolong kirim"
        ]
        run_universal_simulation(preset_arg, demo_script)
    else:
        run_universal_simulation(preset_arg)

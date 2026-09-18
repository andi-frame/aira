"""
Node implementations for the AIRA LangGraph Voice Agent.
Combines deterministic guardrails, Indonesian audio normalization,
and LLM semantic reasoning via Gemini.
"""

import os
import re
from typing import Dict, Any, Optional, List
from dotenv import load_dotenv

load_dotenv()

from aira_agent.state import FormAgentState, FormField, DOMField

def get_field_id(field: Dict[str, Any]) -> str:
    """Extract canonical element ID from field, prioritizing 'id' with fallback to 'domId'."""
    return field.get("id") or field.get("domId", "unknown")
_llm_instance = None

def get_llm():
    global _llm_instance
    if _llm_instance is None:
        # 1. Priority 1: 9Router AI Gateway (OpenAI-compatible localhost / remote)
        router_base_url = os.getenv("NINEROUTER_BASE_URL") or os.getenv("ROUTER_BASE_URL")
        if router_base_url:
            try:
                from langchain_openai import ChatOpenAI
                # Normalisasi cerdas: jika pengguna memasukkan hingga .../chat/completions,
                # pangkas ekornya karena ChatOpenAI secara otomatis menyematkan /chat/completions.
                normalized_url = router_base_url.strip()
                if normalized_url.endswith("/chat/completions"):
                    normalized_url = normalized_url[:-len("/chat/completions")]
                elif normalized_url.endswith("/chat/completions/"):
                    normalized_url = normalized_url[:-len("/chat/completions/")]
                normalized_url = normalized_url.rstrip("/")

                api_key = os.getenv("NINEROUTER_API_KEY") or os.getenv("ROUTER_API_KEY", "9router")
                model = os.getenv("NINEROUTER_MODEL") or os.getenv("ROUTER_MODEL", "gemini-2.5-flash")
                _llm_instance = ChatOpenAI(
                    base_url=normalized_url,
                    api_key=api_key,
                    model=model,
                    temperature=0.1,
                    timeout=15.0,
                    max_retries=1
                )
                print(f"[AIRA LLM] Connected via 9Router Gateway: {normalized_url} -> /chat/completions (Model: {model})")
                return _llm_instance
            except Exception as e:
                print(f"[AIRA Node] Warning initializing 9Router ChatOpenAI: {e}")

        # 2. Priority 2: Direct Google Gemini API
        api_key = os.getenv("GEMINI_API_KEY")
        if api_key and api_key != "your_gemini_api_key_here":
            try:
                from langchain_google_genai import ChatGoogleGenerativeAI
                model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
                _llm_instance = ChatGoogleGenerativeAI(
                    model=model,
                    google_api_key=api_key,
                    temperature=0.1
                )
                print(f"[AIRA LLM] Connected via Direct Gemini API (Model: {model})")
                return _llm_instance
            except Exception as e:
                print(f"[AIRA Node] Warning initializing ChatGoogleGenerativeAI: {e}")
                _llm_instance = None
    return _llm_instance

# Indonesian spoken number map for deterministic normalization fallback
SPOKEN_DIGITS = {
    "nol": "0", "kosong": "0",
    "satu": "1", "dua": "2", "tiga": "3", "empat": "4",
    "lima": "5", "enam": "6", "tujuh": "7", "delapan": "8", "sembilan": "9"
}

def clean_indonesian_spoken_digits(text: str) -> str:
    """Converts spoken Indonesian digits like 'tiga dua nol satu' into '3201'"""
    tokens = text.lower().replace("-", " ").replace(",", " ").split()
    result = []
    for t in tokens:
        if t in SPOKEN_DIGITS:
            result.append(SPOKEN_DIGITS[t])
        elif t.isdigit():
            result.append(t)
    if result:
        return "".join(result)
    digits_only = re.sub(r'\D', '', text)
    return digits_only if digits_only else text.strip()


# =====================================================================
# NODES
# =====================================================================

def orient_page_node(state: FormAgentState) -> Dict[str, Any]:
    """Provides verbal orientation for blind users upon detecting a form."""
    title = state.get("page_title", "Layanan Web")
    queue = list(state.get("fields_queue", []))
    count = len(queue)
    
    first_field = queue[0] if queue else None
    
    speech = (
        f"Selamat datang. Anda berada di laman {title}. "
        f"Saya mendeteksi ada {count} data yang perlu diisi. "
        f"Mari kita mulai dari data pertama."
    )
    
    return {
        "status": "INTERVIEWING",
        "current_field": first_field,
        "spoken_prompt": speech,
        "audio_cue": "orientation",
        "filled_fields": list(state.get("filled_fields", [])),
        "answers": dict(state.get("answers", {})),
        "retry_count": 0,
        "is_correcting": False
    }


def synthesize_question_node(state: FormAgentState) -> Dict[str, Any]:
    """Synthesizes an accessible, spoken Indonesian prompt for current field using LLM."""
    field = state.get("current_field")
    if not field:
        return {"spoken_prompt": "Tidak ada kolom yang aktif.", "audio_cue": "error"}
    
    raw_label = field.get("label", "")
    field_type = field.get("type", "text")
    options = field.get("options", [])
    
    llm = get_llm()
    prompt = None
    
    if llm:
        try:
            options_text = f"Pilihan opsi yang tersedia: {', '.join(options)}." if options else ""
            res = llm.invoke(
                f"Anda adalah AIRA, asisten suara ramah untuk tunanetra yang sedang mengisi formulir web.\n"
                f"Ubah kolom berikut menjadi 1 kalimat tanya yang santun, ramah, dan ringkas dalam Bahasa Indonesia:\n"
                f"- Nama Kolom: '{raw_label}'\n"
                f"- Tipe Input: '{field_type}'\n"
                f"{options_text}\n"
                f"Keluarkan HANYA kalimat tanya yang siap diucapkan ke pengguna tanpa tanda petik atau pengantar."
            )
            prompt = res.content.strip().strip('"').strip("'")
            print(f"[LLM 9Router Generated Question]: {prompt}")
        except Exception as e:
            print(f"[LLM Question Fallback]: {e}")
            prompt = None

    # Fallback template if LLM is offline
    if not prompt:
        if options:
            prompt = f"Pilih salah satu untuk {raw_label}: {', '.join(options[:5])}."
        elif "nik" in raw_label.lower() or field.get("maxLength") == 16:
            prompt = f"Sebutkan 16 digit {raw_label} Anda."
        elif field_type == "date" or "tanggal" in raw_label.lower():
            prompt = f"Sebutkan {raw_label}, sebutkan tanggal, bulan, dan tahun lahir Anda."
        elif field_type == "checkbox":
            prompt = f"Apakah Anda menyetujui {raw_label}? Katakan setuju atau ya."
        else:
            prompt = f"Sebutkan {raw_label} Anda."
            
    return {
        "spoken_prompt": prompt,
        "audio_cue": "question",
        "validation_error": None
    }


def listen_and_extract_node(state: FormAgentState) -> Dict[str, Any]:
    """Normalizes raw user speech into the target field value using LLM reasoning."""
    field = state.get("current_field", {})
    speech = state.get("user_speech", "").strip()
    field_type = field.get("type", "text")
    raw_label = field.get("label", "").lower()
    options = field.get("options", [])
    
    extracted = None
    llm = get_llm()
    
    if llm:
        try:
            options_hint = f"Pilihan yang sah: {', '.join(options)}. Cocokkan ke salah satu opsi ini." if options else ""
            res = llm.invoke(
                f"Anda adalah parser pengisian formulir untuk pengguna tunanetra.\n"
                f"Kolom target: '{raw_label}' (Tipe data: {field_type}).\n"
                f"{options_hint}\n"
                f"Ucapan pengguna: '{speech}'.\n"
                f"Tugas: Ekstrak HANYA nilai bersihnya yang sesuai dimasukkan ke input HTML.\n"
                f"- Jika angka terbilang ('tiga puluh dua' atau 'nol delapan satu'), ubah menjadi digit angka.\n"
                f"- Jika persetujuan/checkbox ('ya', 'bersedia', 'setuju'), jawab 'true'. Jika menolak, jawab 'false'.\n"
                f"Keluarkan HANYA nilai akhir tanpa penjelasan tambahan atau tanda baca berlebih."
            )
            val = res.content.strip().strip('"').strip("'")
            print(f"[LLM 9Router Extracted]: '{speech}' -> '{val}'")
            
            # Post-process boolean for checkbox
            if field_type == "checkbox":
                extracted = True if val.lower() in ["true", "ya", "setuju", "benar", "bersedia"] else False
            else:
                extracted = val
        except Exception as e:
            print(f"[LLM Extraction Fallback]: {e}")
            extracted = None

    # Fallback heuristic if LLM is offline or failed
    if extracted is None:
        if field_type in ["number", "tel"] or "nik" in raw_label or field.get("maxLength") == 16:
            extracted = clean_indonesian_spoken_digits(speech)
        elif options:
            speech_lower = speech.lower()
            matched = None
            for opt in options:
                if opt.lower() in speech_lower or speech_lower in opt.lower():
                    matched = opt
                    break
            extracted = matched if matched else speech
        elif field_type == "checkbox":
            extracted = any(w in speech.lower() for w in ["ya", "setuju", "centang", "benar", "iya", "bersedia"])
        else:
            extracted = speech

    return {
        "extracted_value": extracted
    }


def guardrail_node(state: FormAgentState) -> Dict[str, Any]:
    """Deterministic validation of extracted value against HTML5 rules, validationKey, and domain constraints."""
    field = state.get("current_field", {})
    val = state.get("extracted_value")
    raw_label = field.get("label", "Kolom")
    val_key = (field.get("validationKey") or "").lower()
    field_id = get_field_id(field)
    
    # Rule 1: Required check
    if field.get("required", False):
        if val is None or (isinstance(val, str) and not val.strip()):
            return {
                "is_valid": False,
                "validation_error": f"{raw_label} wajib diisi.",
                "audio_cue": "error"
            }
            
    # Rule 2: NIK validation (16 digits)
    if val_key == "nik" or "nik" in raw_label.lower() or field.get("maxLength") == 16:
        val_str = str(val or "")
        digits = re.sub(r'\D', '', val_str)
        if len(digits) != 16:
            return {
                "is_valid": False,
                "validation_error": f"NIK harus 16 digit angka, saat ini terdeteksi {len(digits)} digit.",
                "audio_cue": "error"
            }
        val = digits # Store clean 16 digits

    # Rule 3: Phone validation
    elif val_key == "phone" or any(kw in raw_label.lower() for kw in ["telepon", "whatsapp", "wa", "nomor hp", "no hp"]):
        val_str = re.sub(r'[^\d+]', '', str(val or "").strip())
        phone_pattern = r'^(\+62|62|0)8[1-9][0-9]{6,10}$'
        if not re.match(phone_pattern, val_str):
            return {
                "is_valid": False,
                "validation_error": "Nomor telepon harus diawali 08 atau +62 dengan 10-13 digit angka.",
                "audio_cue": "error"
            }
        val = val_str

    # Rule 4: Email validation
    elif val_key == "email" or field.get("type") == "email":
        val_str = str(val or "").strip()
        email_pattern = r'^[^\s@]+@[^\s@]+\.[^\s@]+$'
        if not re.match(email_pattern, val_str):
            return {
                "is_valid": False,
                "validation_error": f"Format email {raw_label} belum valid (contoh: nama@email.com).",
                "audio_cue": "error"
            }
        val = val_str

    # Rule 5: Date validation
    elif val_key == "date" or field.get("type") == "date":
        val_str = str(val or "").strip()
        date_pattern = r'^\d{4}-\d{2}-\d{2}$|^\d{2}/\d{2}/\d{4}$'
        if not re.match(date_pattern, val_str):
            return {
                "is_valid": False,
                "validation_error": f"Format tanggal {raw_label} belum valid (contoh: 1995-08-17).",
                "audio_cue": "error"
            }
        val = val_str
        
    # Rule 6: HTML5 Pattern check
    pattern = field.get("pattern")
    if pattern and val:
        try:
            if not re.match(pattern, str(val)):
                return {
                    "is_valid": False,
                    "validation_error": f"Format {raw_label} belum sesuai ketentuan.",
                    "audio_cue": "error"
                }
        except Exception:
            pass

    # Rule 7: Select options validity
    options = field.get("options")
    if options and val not in options:
        return {
            "is_valid": False,
            "validation_error": f"Pilihan '{val}' tidak ada di daftar opsi {raw_label}.",
            "audio_cue": "error"
        }

    # Passed all guardrails!
    answers = dict(state.get("answers", {}))
    answers[field_id] = val
    # Keep backward-compatible domId alias if provided
    if field.get("domId") and field.get("domId") != field_id:
        answers[field["domId"]] = val
    
    filled = list(state.get("filled_fields", []))
    updated = False
    for i, item in enumerate(filled):
        if get_field_id(item) == field_id:
            filled[i] = dict(item, value=val)
            updated = True
            break
    if not updated:
        filled_field_copy = dict(field)
        filled_field_copy["value"] = val
        filled.append(filled_field_copy)
    
    return {
        "is_valid": True,
        "validation_error": None,
        "answers": answers,
        "filled_fields": filled,
        "audio_cue": "success",
        "retry_count": 0
    }


def error_guidance_node(state: FormAgentState) -> Dict[str, Any]:
    """Generates verbal corrective feedback for blind users."""
    err = state.get("validation_error", "Data yang dimasukkan belum tepat.")
    retries = state.get("retry_count", 0) + 1
    
    spoken = f"{err} Mohon sebutkan kembali."
    if retries >= 2:
        spoken = f"{err} Anda bisa menyebutkannya perlahan-lahan angka per angka."
        
    return {
        "spoken_prompt": spoken,
        "audio_cue": "error",
        "retry_count": retries
    }


def advance_queue_node(state: FormAgentState) -> Dict[str, Any]:
    """Moves to next field in the queue or triggers review."""
    if state.get("is_correcting"):
        return {
            "current_field": None,
            "status": "REVIEWING",
            "is_correcting": False
        }

    queue = list(state.get("fields_queue", []))
    if queue:
        queue.pop(0) # Remove completed field
        
    if queue:
        return {
            "fields_queue": queue,
            "current_field": queue[0],
            "status": "INTERVIEWING"
        }
    else:
        return {
            "fields_queue": [],
            "current_field": None,
            "status": "REVIEWING"
        }


def review_summary_node(state: FormAgentState) -> Dict[str, Any]:
    """Prepares verbal review summary of all collected form data."""
    filled = state.get("filled_fields", [])
    
    summary_parts = []
    for f in filled:
        lbl = f.get("label", "Data")
        val = f.get("value", "-")
        summary_parts.append(f"{lbl}: {val}")
        
    summary_text = ", ".join(summary_parts)
    prompt = (
        f"Semua data telah terisi. Berikut ringkasannya: {summary_text}. "
        f"Apakah seluruh data ini sudah benar dan siap untuk saya kirimkan ke website?"
    )
    
    return {
        "status": "AWAITING_CONFIRMATION",
        "spoken_prompt": prompt,
        "audio_cue": "review"
    }


def find_field_by_keyword(keyword: str, fields: List[FormField]) -> Optional[FormField]:
    """Helper to match spoken field names with registered fields by label, name, or id."""
    kw = keyword.lower()
    for f in fields:
        lbl = f.get("label", "").lower()
        nm = f.get("name", "").lower()
        fid = get_field_id(f).lower()
        if kw in lbl or (nm and kw in nm) or (fid and kw in fid):
            return f
    for f in fields:
        tokens = f.get("label", "").lower().split()
        for t in tokens:
            if len(t) > 2 and t in kw:
                return f
    return None


def handle_review_confirmation_node(state: FormAgentState) -> Dict[str, Any]:
    """
    Evaluates user confirmation at the review stage.
    Supports affirmative confirmation, specific field corrections, and general rejections.
    """
    response = str(state.get("confirmation_response", "")).lower().strip()
    filled = state.get("filled_fields", [])
    
    # 1. Affirmative: user confirms submission
    if any(w in response for w in ["ya", "kirim", "lanjut", "benar", "sudah", "oke", "setuju", "betul", "siap"]):
        return {
            "review_decision": "CONFIRMED"
        }
        
    # 2. Cancellation: user explicitly aborts
    if "batal" in response and "koreksi" not in response and "ubah" not in response:
        return {
            "review_decision": "CANCELLED",
            "status": "COMPLETED",
            "spoken_prompt": "Pengisian formulir dibatalkan oleh pengguna.",
            "audio_cue": "error"
        }
        
    # 3. User mentions a specific field directly (e.g. "ubah nama", "nik salah")
    matched_field = find_field_by_keyword(response, filled)
    if matched_field:
        return {
            "review_decision": "CORRECT_FIELD",
            "current_field": matched_field,
            "is_correcting": True,
            "status": "INTERVIEWING",
            "spoken_prompt": f"Baik, kita perbaiki data {matched_field.get('label')}.",
            "audio_cue": "question"
        }
        
    # 4. User said "belum" / "tidak" without naming the field
    labels = [f.get("label", "Kolom") for f in filled]
    options_str = ", ".join(labels)
    return {
        "review_decision": "ASK_WHICH_FIELD",
        "status": "AWAITING_FIELD_CHOICE",
        "spoken_prompt": f"Baik, data mana yang ingin Anda perbaiki? Pilihan kolom: {options_str}.",
        "audio_cue": "question"
    }


def select_field_for_correction_node(state: FormAgentState) -> Dict[str, Any]:
    """Selects target field to correct after user names it."""
    speech = str(state.get("user_speech", "")).lower().strip()
    filled = state.get("filled_fields", [])
    matched_field = find_field_by_keyword(speech, filled)
    
    if matched_field:
        return {
            "current_field": matched_field,
            "is_correcting": True,
            "status": "INTERVIEWING",
            "spoken_prompt": f"Baik, silakan sebutkan {matched_field.get('label')} yang baru.",
            "audio_cue": "question"
        }
    else:
        fallback = filled[0] if filled else None
        return {
            "current_field": fallback,
            "is_correcting": True,
            "status": "INTERVIEWING",
            "spoken_prompt": f"Saya belum mengenali kolom tersebut. Mari kita perbaiki dari {fallback.get('label') if fallback else 'data pertama'}.",
            "audio_cue": "question"
        }


def sync_dom_node(state: FormAgentState) -> Dict[str, Any]:
    """Prepares payload for the browser extension to inject and submit into host DOM."""
    answers = dict(state.get("answers", {}))
    
    return {
        "status": "COMPLETED",
        "spoken_prompt": "Formulir telah berhasil disinkronkan dan dikirimkan ke sistem layanan.",
        "audio_cue": "complete",
        "sync_payload": answers
    }

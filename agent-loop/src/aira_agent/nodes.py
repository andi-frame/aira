"""
Node implementations for the AIRA LangGraph Voice Agent.
Combines deterministic guardrails, Indonesian audio normalization,
and LLM semantic reasoning via Gemini.
"""

import os
import re
import difflib
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
        router_base_url = os.getenv("ROUTER_BASE_URL")
        if router_base_url:
            try:
                from langchain_openai import ChatOpenAI
                # Normalisasi cerdas: jika pengguna memasukkan hingga .../chat/completions,
                # pangkas ekornya karena ChatOpenAI secara otomatis menyematkan /chat/completions.
                normalized_url = router_base_url.strip().rstrip("/")
                if normalized_url.endswith("/chat/completions"):
                    normalized_url = normalized_url[:-len("/chat/completions")].rstrip("/")

                api_key = os.getenv("ROUTER_API_KEY", "9router")
                model = os.getenv("ROUTER_MODEL", "gemini-2.5-flash")
                router_timeout = float(os.getenv("ROUTER_TIMEOUT", "45.0"))
                _llm_instance = ChatOpenAI(
                    base_url=normalized_url,
                    api_key=api_key,
                    model=model,
                    temperature=0.1,
                    timeout=router_timeout,
                    max_retries=1
                )
                print(f"[AIRA LLM] Connected via 9Router Gateway: {normalized_url} -> /chat/completions (Model: {model}, Timeout: {router_timeout}s)")
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


def normalize_spoken_email(text: str) -> str:
    """Convert common spoken email separators into a value HTML can validate."""
    normalized = text.strip().lower()
    normalized = re.sub(r"\b(?:at|arroba|di)\b", "@", normalized)
    normalized = re.sub(r"\b(?:dot|titik)\b", ".", normalized)
    normalized = re.sub(r"\s*([@.])\s*", r"\1", normalized)
    return re.sub(r"\s+", "", normalized)


# =====================================================================
# HYBRID SEMANTIC DOM PARSING (GOOGLE FORMS, ARIA & NATIVE)
# =====================================================================

def parse_form_dom_with_llm(compact_html: str) -> Optional[List[Dict[str, Any]]]:
    """
    Parses compact pruned HTML (from Google Forms, ARIA, or native forms) into structured FormField schemas.
    Groups radio buttons, checkbox groups, star rating scales, and links optionBindings to data-aira-ref.
    """
    if not compact_html or len(compact_html.strip()) < 10:
        return None

    llm = get_llm()
    if not llm:
        return None

    system_prompt = (
        "Anda adalah AIRA Semantic Form Perception Engine.\n"
        "Tugas: Analisis representasi ringkas HTML formulir (termasuk pola Google Forms, ARIA roles, dan elemen native).\n"
        "Ekstrak dan kelompokkan elemen-elemen tersebut menjadi daftar pertanyaan formulir yang terstruktur.\n\n"
        "Aturan Pengelompokan Penting:\n"
        "1. Multiple Choice / Radio:\n"
        "   Jika beberapa elemen memiliki role='radio', type='radio', atau grup/name yang sama, "
        "   satukan menjadi 1 field tunggal dengan type='radio'.\n"
        "   Kumpulkan semua pilihan teks ke dalam array 'options'.\n"
        "   Sertakan 'optionBindings': [ { 'option': 'Pilihan A', 'ref': 'f_1' }, { 'option': 'Pilihan B', 'ref': 'f_2' } ].\n"
        "2. Skala Penilaian / Rating Bintang (Star Rating / Linear Scale):\n"
        "   Jika elemen berupa penilaian bertingkat (misal rating bintang 1 s/d 5 atau 1 s/d 10), "
        "   satukan menjadi 1 field dengan type='rating'.\n"
        "   Sertakan 'options': ['1', '2', '3', '4', '5'], 'ratingScale': { 'min': 1, 'max': 5 }, "
        "   dan 'optionBindings' memetakan setiap angka ke ref elemennya.\n"
        "3. Checkbox Group (Pilihan Centang Lebih dari Satu):\n"
        "   Jika beberapa kotak centang berada dalam 1 kelompok pertanyaan, "
        "   satukan menjadi 1 field dengan type='checkbox_group' dan sertakan 'optionBindings'.\n"
        "4. Dropdown / Listbox (Pilihan Dropdown):\n"
        "   Jika elemen memiliki role='listbox', type='select', atau tag='select', "
        "   buat field dengan type='select'. Masukkan semua pilihan ke dalam 'options'.\n"
        "   PENTING: Jangan gunakan teks placeholder seperti 'Choose' atau 'Pilih' sebagai label; gunakan nama pertanyaan di grupnya.\n"
        "5. Pertanyaan Kisi / Grid / Matriks (Multiple Choice Grid atau Checkbox Grid):\n"
        "   Jika pertanyaan memiliki beberapa baris dan kolom (misal: group mengandung '- Baris: X' atau terdapat baris sub-pertanyaan): "
        "   Pecah menjadi sub-pertanyaan terpisah untuk SETIAP BARIS!\n"
        "   - label: Nama pertanyaan lengkap beserta barisnya (contoh: 'Pilih aja - Baris: Keren').\n"
        "   - type: 'radio' (jika multiple choice grid) atau 'checkbox_group' (jika checkbox grid).\n"
        "   - options: Daftar nama kolom (contoh: ['Kolom Keren', 'Kolom Bagus']).\n"
        "   - optionBindings: Petakan setiap nama kolom ke ref elemen pada baris tersebut.\n"
        "6. Opsi 'Other' / 'Lainnya' dan Input Pendamping (Companion Input):\n"
        "   Jika sebuah grup radio atau checkbox memiliki pilihan 'Other:' / 'Lainnya:' dan terdapat elemen pendamping (companionFor='...'):\n"
        "   - JANGAN membuat field terpisah untuk input teks companion tersebut!\n"
        "   - Tambahkan 'Other' ke dalam 'options'.\n"
        "   - Set 'hasOther': true, 'otherRef': '<ref checkbox/radio other>', dan 'otherInputRef': '<ref companion input>'.\n"
        "7. Single Checkbox (Persetujuan / Disclaimer):\n"
        "   Jika kotak centang berdiri sendiri (misal menyetujui syarat), buat 1 field dengan type='checkbox'.\n"
        "8. Teks, Email, Telepon, Tanggal:\n"
        "   Deteksi label yang jelas dan tentukan type ('text', 'tel', 'email', 'date', 'number', 'textarea').\n"
        "   Jika NIK atau KTP, set validationKey='nik'. Jika telepon/WA, validationKey='phone'.\n\n"
        "Format Output KETAT JSON (array of objects):\n"
        "[\n"
        "  {\n"
        "    \"id\": \"string id unik (gunakan ref pertama)\",\n"
        "    \"label\": \"Label pertanyaan yang ramah dan jelas dalam Bahasa Indonesia\",\n"
        "    \"type\": \"text\" | \"tel\" | \"email\" | \"number\" | \"date\" | \"radio\" | \"checkbox\" | \"checkbox_group\" | \"rating\" | \"select\" | \"textarea\",\n"
        "    \"required\": true,\n"
        "    \"options\": [\"Opsi 1\", \"Opsi 2\"],\n"
        "    \"validationKey\": \"nik\" | \"phone\" | \"email\" | \"date\" | null,\n"
        "    \"domRefs\": [\"f_1\", \"f_2\"],\n"
        "    \"optionBindings\": [ { \"option\": \"Opsi 1\", \"ref\": \"f_1\" } ],\n"
        "    \"ratingScale\": { \"min\": 1, \"max\": 5 },\n"
        "    \"hasOther\": true,\n"
        "    \"otherRef\": \"f_5\",\n"
        "    \"otherInputRef\": \"f_6\"\n"
        "  }\n"
        "]\n"
        "Keluarkan HANYA array JSON tanpa pembuka/penutup markdown."
    )

    try:
        import json
        res = llm.invoke(f"{system_prompt}\n\nCompact HTML:\n{compact_html}")
        content = res.content.strip()

        # Robust JSON Array extraction (handles leading/trailing text and markdown codeblocks)
        json_match = re.search(r'\[\s*\{[\s\S]*\}\s*\]', content)
        if json_match:
            clean_json = json_match.group(0)
        elif "```" in content:
            clean_json = re.sub(r"^```(?:json)?\n?", "", content)
            clean_json = re.sub(r"\n?```$", "", clean_json).strip()
        else:
            clean_json = content

        parsed = json.loads(clean_json)
        if isinstance(parsed, list) and len(parsed) > 0:
            print(f"[AIRA LLM Form Parser] Successfully extracted {len(parsed)} structured fields from compact DOM.")
            for f in parsed:
                fid = f.get("id") or (f.get("domRefs") and f["domRefs"][0]) or "field"
                f["id"] = str(fid)
                f["domId"] = str(fid)
            return parsed
        else:
            print(f"[AIRA LLM Form Parser] Parsed response is not a non-empty list: {parsed}")
            return None
    except Exception as e:
        print(f"[AIRA LLM Form Parser Error]: {type(e).__name__}: {e}")
        # Attach error to state/server log
        raise e


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
        f"Jika Anda bingung mengisi kolom apa pun, Anda bisa menekan tombol Bantuan atau tekan Alt+C kapan saja. "
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


GENERIC_TAUTOLOGICAL_HINTS = {
    "ketik atau ucapkan jawaban anda.",
    "ketik atau ucapkan jawaban anda",
    "pilih salah satu opsi yang sesuai.",
    "pilih salah satu opsi yang sesuai",
    "pilih satu atau lebih opsi yang sesuai.",
    "pilih satu atau beberapa opsi.",
    "pilih satu opsi.",
    "sebutkan atau ketik tanggal yang diminta.",
    "sebutkan atau ketik waktu yang diminta.",
    "ketik atau ucapkan alamat email anda."
}


def get_field_explanation(field: Optional[Dict[str, Any]]) -> str:
    """Provides warm, elderly-friendly accessibility explanation & concrete examples for a field using LLM with heuristic fallback."""
    if not field:
        return "Silakan masukkan data sesuai formulir."
    
    # 1. Instant Cache Hit: Return previously cached explanation (< 1ms)
    if field.get("cached_hint"):
        return str(field["cached_hint"])
    
    lbl = field.get("label", "")
    lbl_lower = lbl.lower()
    field_type = field.get("type", "text")
    options = field.get("options", [])
    val_key = (field.get("validationKey") or "").lower()
    allows_other = bool(field.get("hasOther") or field.get("otherAllowed"))
    existing_hint = str(field.get("hint") or "").strip()
    is_generic_hint = existing_hint.lower() in GENERIC_TAUTOLOGICAL_HINTS or "ketik atau ucapkan" in existing_hint.lower()

    # Dynamic LLM explanation for contextual, empathetic guidance (tailored for elderly / confused users)
    llm = get_llm()
    if llm:
        try:
            opts_str = f"Pilihan opsi: {', '.join(options)}." if options else ""
            if allows_other:
                opts_str += " Kolom ini juga mengizinkan jawaban bebas di luar opsi."
            hint_str = f"Petunjuk formulir: {existing_hint}." if (existing_hint and not is_generic_hint) else ""
            res = llm.invoke(
                f"Anda adalah AIRA, asisten aksesibilitas suara ramah untuk pengguna lansia dan tunanetra yang sedang mengisi formulir web.\n"
                f"Pengguna sedang bingung cara mengisi kolom ini. Berikan penjelasan singkat (1-2 kalimat saja) dalam Bahasa Indonesia yang sangat ramah, hangat, jelas, dan mudah dipahami oleh orang tua tentang kolom ini, apa maksudnya, dan contoh konkrit cara menjawabnya:\n"
                f"- Nama/Pertanyaan Kolom: '{lbl}'\n"
                f"- Tipe Kolom: '{field_type}'\n"
                f"{opts_str}\n"
                f"{hint_str}\n"
                f"Keluarkan HANYA kalimat penjelasan langsung tanpa tanda kutip dan tanpa kata pengantar."
            )
            explanation = res.content.strip().strip('"').strip("'")
            if explanation and len(explanation) > 10:
                field["cached_hint"] = explanation
                return explanation
        except Exception as e:
            print(f"[LLM Field Explain Fallback]: {e}")

    # If the form author provided a genuine custom instruction/hint (not generic boilerplate), use it
    if existing_hint and not is_generic_hint:
        field["cached_hint"] = existing_hint
        return existing_hint
        
    # Heuristic domain-knowledge fallback for common Indonesian web form fields
    if val_key == "nik" or "nik" in lbl_lower or "kependudukan" in lbl_lower or "no ktp" in lbl_lower:
        exp = "Nomor Induk Kependudukan terdiri dari 16 digit angka, tertera di bagian atas KTP atau Kartu Keluarga Anda."
    elif any(w in lbl_lower for w in ["nim", "mahasiswa", "npm", "nisn", "nomor siswa"]):
        exp = "Nomor Induk Mahasiswa atau pelajar Anda, tertera pada kartu tanda mahasiswa atau kartu pelajar Anda."
    elif any(w in lbl_lower for w in ["angkatan", "tahun masuk"]):
        exp = "Tahun Anda mulai masuk perkuliahan atau sekolah, contohnya 2022 atau 2023."
    elif any(w in lbl_lower for w in ["jurusan", "program studi", "prodi", "fakultas"]):
        exp = "Nama program studi atau jurusan yang Anda tempuh, misalnya Teknik Informatika atau Sistem Informasi."
    elif "bpjs" in lbl_lower or "peserta" in lbl_lower or "kis" in lbl_lower or "asuransi" in lbl_lower:
        exp = "Nomor kartu BPJS Anda, tertera pada kartu fisik BPJS atau aplikasi Mobile JKN."
    elif "nama" in lbl_lower:
        exp = "Nama lengkap Anda sesuai dengan yang tertulis pada dokumen resmi seperti KTP atau akta lahir."
    elif val_key == "phone" or any(w in lbl_lower for w in ["telepon", "wa", "whatsapp", "hp", "seluler"]):
        exp = "Nomor telepon atau WhatsApp aktif Anda yang dapat menerima pesan atau SMS konfirmasi."
    elif val_key == "date" or any(w in lbl_lower for w in ["lahir", "tanggal"]):
        exp = "Tanggal yang diminta. Anda dapat menyebutkan tanggal, bulan, dan tahun, contohnya 17 Agustus 1995."
    elif "alamat" in lbl_lower or "domisili" in lbl_lower or "tempat tinggal" in lbl_lower:
        exp = "Alamat tempat tinggal Anda saat ini, mencakup nama jalan, nomor rumah, RT/RW, dan kelurahan."
    elif val_key == "email" or field_type == "email" or "email" in lbl_lower or "surel" in lbl_lower:
        exp = "Alamat email aktif Anda, contohnya nama@gmail.com."
    elif any(w in lbl_lower for w in ["github", "repository", "repo", "tautan", "link"]):
        exp = "Tautan profil GitHub atau repositori proyek Anda, contohnya github.com/username."
    elif any(w in lbl_lower for w in ["kesan", "pesan", "kritik", "saran", "catatan"]):
        exp = "Pendapat, kesan, saran, atau masukan bebas Anda terkait kegiatan atau formulir ini."
    elif options:
        opt_sample = ", ".join(options[:5])
        suffix = ", dan lainnya" if len(options) > 5 else ""
        if allows_other:
            exp = f"Kolom ini menyediakan pilihan: {opt_sample}{suffix}. Anda juga boleh menyebutkan jawaban Anda sendiri di luar daftar tersebut."
        else:
            exp = f"Kolom ini menyediakan pilihan: {opt_sample}{suffix}. Silakan sebutkan atau pilih salah satu opsi yang tersedia."
    else:
        exp = f"Kolom {lbl or 'ini'} meminta data {lbl or 'Anda'}. Silakan sebutkan atau ketik jawaban Anda sesuai dokumen resmi."
        
    field["cached_hint"] = exp
    return exp


def answer_field_question(field: Optional[Dict[str, Any]], user_question: str) -> str:
    """Answers user's specific follow-up question regarding a form field using LLM, with domain heuristic fallback."""
    if not field:
        return "Silakan masukkan data sesuai formulir."

    lbl = field.get("label", "kolom ini")
    lbl_lower = lbl.lower()
    field_type = field.get("type", "text")
    options = field.get("options", [])
    q_clean = (user_question or "").strip()
    q_lower = q_clean.lower()

    if not q_clean:
        return get_field_explanation(field)

    # 1. LLM Contextual Answering
    llm = get_llm()
    if llm:
        try:
            opts_str = f"Pilihan opsi yang tersedia: {', '.join(options)}." if options else ""
            res = llm.invoke(
                f"Anda adalah AIRA, asisten aksesibilitas suara yang ramah dan empatis untuk lansia dan tunanetra.\n"
                f"Pengguna sedang berada di kolom formulir: '{lbl}' (Tipe: {field_type}).\n"
                f"{opts_str}\n"
                f"Pengguna menanyakan pertanyaan berikut tentang kolom ini:\n"
                f"'{q_clean}'\n\n"
                f"Berikan jawaban langsung yang sangat ramah, hangat, jelas, dan padat (1-2 kalimat saja) dalam Bahasa Indonesia untuk menjawab pertanyaan tersebut secara tepat.\n"
                f"Keluarkan HANYA kalimat jawaban tanpa tanda kutip dan tanpa kata pengantar."
            )
            answer = res.content.strip().strip('"').strip("'")
            if answer and len(answer) > 5:
                return answer
        except Exception as e:
            print(f"[LLM Field QA Error]: {e}")

    # 2. Heuristic Pattern Matching Fallback (Offline / Low-Latency)
    is_location = any(w in q_lower for w in ["lihat di mana", "lihat dimana", "di mana", "dimana", "nyari di mana", "nyari dimana", "nemu", "mencari"])
    is_what = any(w in q_lower for w in ["apa itu", "maksudnya", "artinya", "apa sih", "kenapa", "buat apa"])
    is_format = any(w in q_lower for w in ["contoh", "format", "cara mengisi", "berapa digit", "huruf apa angka"])

    if "nik" in lbl_lower or "kependudukan" in lbl_lower or "no ktp" in lbl_lower:
        if is_location:
            return "Nomor NIK tertera di baris paling atas KTP elektronik Anda, atau di lembar Kartu Keluarga di samping nama Anda."
        elif is_format:
            return "Format NIK berupa 16 digit angka tanpa spasi atau tanda baca."
        elif is_what:
            return "NIK adalah Nomor Induk Kependudukan sebagai nomor identitas resmi kependudukan Anda."
        return "NIK terdiri dari 16 digit angka yang tercantum pada KTP atau Kartu Keluarga Anda."

    if any(w in lbl_lower for w in ["nim", "mahasiswa", "npm", "nisn", "nomor siswa"]):
        if is_location:
            return "Nomor tersebut tertera pada Kartu Tanda Mahasiswa (KTM) atau kartu pelajar Anda."
        elif is_format:
            return "Silakan masukkan nomor induk Anda sesuai dengan yang tertera di kartu mahasiswa atau kartu pelajar."
        return "Nomor ini adalah identitas resmi Anda yang tertera di kartu mahasiswa atau pelajar."

    if any(w in lbl_lower for w in ["angkatan", "tahun masuk"]):
        if is_location or is_what:
            return "Angkatan adalah tahun pertama kali Anda diterima atau mulai masuk sekolah atau kampus, contohnya tahun 2022 atau 2023."
        return "Contoh pengisian angkatan adalah tahun 4 digit, misalnya 2022 atau 2023."

    if any(w in lbl_lower for w in ["jurusan", "program studi", "prodi", "fakultas"]):
        return "Silakan sebutkan nama jurusan atau program studi Anda, misalnya Teknik Informatika atau Sistem Informasi."

    if any(w in lbl_lower for w in ["bpjs", "kis", "asuransi"]):
        if is_location:
            return "Nomor kartu BPJS tertera pada kartu fisik BPJS Kesehatan Anda atau pada aplikasi Mobile JKN di ponsel."
        return "Nomor BPJS terdiri dari 13 digit angka yang ada di kartu BPJS Kesehatan Anda."

    if any(w in lbl_lower for w in ["telepon", "wa", "whatsapp", "hp", "seluler"]):
        if is_format:
            return "Contoh nomor telepon diawali 08, misalnya 081234567890."
        return "Nomor telepon yang diminta adalah nomor aktif Anda yang dapat menerima SMS atau panggilan konfirmasi."

    if any(w in lbl_lower for w in ["tanggal", "lahir"]):
        if is_location:
            return "Tanggal lahir dapat Anda lihat pada KTP, akta kelahiran, atau Kartu Keluarga."
        return "Anda dapat menyebutkan tanggal, bulan, dan tahun, contohnya 17 Agustus 1995."

    if any(w in lbl_lower for w in ["email", "surel"]):
        if is_format:
            return "Contoh alamat email yang valid adalah nama@gmail.com."
        return "Alamat email adalah akun surat elektronik aktif Anda, misalnya akun Gmail yang Anda gunakan."

    if any(w in lbl_lower for w in ["github", "repo", "repository", "link", "tautan"]):
        if is_location:
            return "Tautan profil GitHub dapat Anda salin dari bilah alamat browser Anda, contohnya github.com/username."
        return "Masukkan tautan atau alamat web repositori proyek Anda di GitHub."

    if options:
        return f"Untuk pertanyaan ini, pilihan yang tersedia adalah: {', '.join(options[:5])}. Anda bisa memilih salah satu di antaranya."

    return get_field_explanation(field)


def explain_field_node(field_or_state: Any) -> Any:
    """Provides accessibility explanation & answers questions for a field using LLM.
    Supports being called as a LangGraph node with state dict or standalone with field dict.
    """
    if isinstance(field_or_state, dict) and "session_id" in field_or_state:
        state = field_or_state
        field = state.get("current_field")
        user_speech = str(state.get("user_speech", "")).strip()
        lbl = field.get("label", "kolom ini") if field else "kolom ini"

        if user_speech and user_speech.lower() not in ["bantuan", "jelaskan", "alt+c", "help", "apa ini"]:
            answer = answer_field_question(field, user_speech)
            return {
                "spoken_prompt": answer,
                "field_hint": answer,
                "audio_cue": "question",
                "status": "INTERVIEWING",
                "is_valid": True
            }

        explanation = get_field_explanation(field)
        return {
            "spoken_prompt": f"Penjelasan untuk {lbl}: {explanation} Nah, sekarang silakan sebutkan atau ketik jawaban Anda.",
            "field_hint": explanation,
            "audio_cue": "question",
            "status": "INTERVIEWING",
            "is_valid": True
        }
    return get_field_explanation(field_or_state)


def detect_intent_node(state: FormAgentState) -> Dict[str, Any]:
    """Detects user turn intent: NAVIGATE_BACK, EXPLAIN, or standard ANSWER."""
    # 1. Pre-assigned turn intent (e.g. from explicit client button click)
    if state.get("turn_intent") in ["NAVIGATE_BACK", "EXPLAIN"]:
        return {"turn_intent": state["turn_intent"]}

    speech = str(state.get("user_speech", "")).strip()
    clean = speech.lower()

    field = state.get("current_field") or {}
    options = [str(o).lower() for o in field.get("options", [])]

    # 2. Voice navigation back: "kembali", "sebelumnya", "mundur", "balik"
    # Guard: only navigate back if the user's utterance is not one of the literal field options
    is_back = clean in [
        "kembali", "sebelumnya", "balik", "back", 
        "ke pertanyaan sebelumnya", "langkah sebelumnya", "mundur"
    ]
    if is_back and clean not in options:
        return {"turn_intent": "NAVIGATE_BACK"}

    # 3. Field explanation request: "jelaskan", "maksudnya", "bantuan"
    is_explain = any(phrase in clean for phrase in [
        "jelaskan", "maksudnya apa", "bantuan", "apa itu", 
        "tolong jelaskan", "maksud pertanyaan", "petunjuk"
    ])
    if is_explain and clean not in options:
        return {"turn_intent": "EXPLAIN"}

    return {"turn_intent": "ANSWER"}


def synthesize_question_node(state: FormAgentState) -> Dict[str, Any]:
    """Synthesizes an accessible, spoken Indonesian prompt for current field using LLM, with prompt caching."""
    # If the previous node already set a terminal message (e.g. boundary error at first question)
    if state.get("spoken_prompt") and state.get("audio_cue") == "error":
        return {
            "spoken_prompt": state["spoken_prompt"],
            "audio_cue": "error",
            "field_hint": state.get("field_hint")
        }

    field = state.get("current_field")
    if not field:
        return {"spoken_prompt": "Tidak ada kolom yang aktif.", "audio_cue": "error", "field_hint": None}
    
    is_back = bool(state.get("is_step_back"))
    
    # 1. Instant Cache Hit: Return cached prompt & hint immediately (< 1ms)
    if field.get("cached_prompt"):
        cached = field["cached_prompt"]
        prompt = f"Kembali ke langkah sebelumnya. {cached}" if (is_back and not cached.startswith("Kembali")) else cached
        hint = field.get("cached_hint") or field.get("hint") or get_field_explanation(field)
        return {
            "spoken_prompt": prompt,
            "audio_cue": "question",
            "validation_error": None,
            "field_hint": hint,
            "is_step_back": False
        }

    raw_label = field.get("label", "")
    field_type = field.get("type", "text")
    options = field.get("options", [])
    canonical = str(field.get("canonicalType") or "").lower()
    grid_question = field.get("gridQuestion")
    grid_row = field.get("gridRowLabel")
    hint = get_field_explanation(field)
    
    # Deterministic Google Forms fields use the local templates (no LLM round-trip).
    llm = None if field.get("canonicalType") else get_llm()
    prompt = None
    
    if llm:
        try:
            options_text = f"Pilihan opsi yang tersedia: {', '.join(options)}." if options else ""
            grid_text = ""
            if grid_question and grid_row:
                grid_text = (
                    f"- Konteks kisi (grid): ini adalah baris '{grid_row}' dari pertanyaan '{grid_question}'.\n"
                    f"  Sebutkan baris tersebut agar pengguna tahu bagian mana yang sedang ditanyakan.\n"
                )
            res = llm.invoke(
                f"Anda adalah AIRA, asisten suara ramah untuk tunanetra yang sedang mengisi formulir web.\n"
                f"Ubah kolom berikut menjadi 1 kalimat tanya yang santun, ramah, dan ringkas dalam Bahasa Indonesia:\n"
                f"- Nama Kolom: '{raw_label}'\n"
                f"- Tipe Input: '{field_type}'\n"
                f"{grid_text}"
                f"{options_text}\n"
                f"Aturan penting:\n"
                f"1. Tanyakan hanya data untuk kolom ini.\n"
                f"2. Jika tipe input adalah checkbox atau persetujuan, tanyakan apakah pengguna menyetujui pernyataan tersebut (contoh: 'Apakah Anda menyetujui ketentuan ini? Katakan setuju atau ya'). JANGAN bertanya apakah ingin mengisi lagi atau mengulang.\n"
                f"Keluarkan HANYA kalimat tanya yang siap diucapkan ke pengguna tanpa tanda petik atau pengantar."
            )
            prompt = res.content.strip().strip('"').strip("'")
            print(f"[LLM 9Router Generated Question]: {prompt}")
        except Exception as e:
            print(f"[LLM Question Fallback]: {e}")
            prompt = None

    # Fallback template if LLM is offline
    if not prompt:
        opts_text = ", ".join(options[:6]) if options else ""
        if canonical == "multiple_choice_grid" and grid_question and grid_row:
            prompt = f"Untuk pertanyaan '{grid_question}', baris '{grid_row}', pilih salah satu: {opts_text}."
        elif canonical == "checkbox_grid" and grid_question and grid_row:
            prompt = f"Untuk pertanyaan '{grid_question}', baris '{grid_row}', pilih satu atau beberapa opsi: {opts_text}."
        elif canonical == "grid_unknown" and grid_question and grid_row:
            prompt = f"Untuk pertanyaan '{grid_question}', baris '{grid_row}', pilih kolom: {opts_text}."
        elif field_type == "rating":
            r_scale = field.get("ratingScale") or {"min": 1, "max": 5}
            prompt = f"Berapa rating nilai Anda untuk {raw_label}, dari {r_scale.get('min', 1)} sampai {r_scale.get('max', 5)} bintang?"
        elif field_type == "checkbox_group":
            prompt = f"Pilih satu atau beberapa opsi untuk {raw_label}: {', '.join(options[:5])}."
        elif options:
            prompt = f"Pilih salah satu untuk {raw_label}: {', '.join(options[:5])}."
        elif "nik" in raw_label.lower() or field.get("maxLength") == 16:
            prompt = f"Sebutkan 16 digit {raw_label} Anda."
        elif field_type == "date" or "tanggal" in raw_label.lower():
            prompt = f"Sebutkan {raw_label}, sebutkan tanggal, bulan, dan tahun lahir Anda."
        elif field_type == "checkbox":
            prompt = f"Apakah Anda menyetujui {raw_label}? Katakan setuju atau ya."
        else:
            prompt = f"Sebutkan {raw_label} Anda."
            
    # Save to cache on the field object for zero-latency step-back / re-visitation
    field["cached_prompt"] = prompt
    field["cached_hint"] = hint
    
    spoken = f"Kembali ke langkah sebelumnya. {prompt}" if (is_back and not prompt.startswith("Kembali")) else prompt
    
    return {
        "spoken_prompt": spoken,
        "audio_cue": "question",
        "validation_error": None,
        "field_hint": hint,
        "is_step_back": False
    }


def normalize_for_match(text: str) -> str:
    return re.sub(r"[^\w\s]", "", (text or "").lower()).strip()


def closest_option(text: str, options: List[str], cutoff: float = 0.75) -> Optional[str]:
    """Fuzzy-matches a spoken transcript to the allowed options (e.g. 'Fahiz' -> 'Faiz')."""
    normalized = normalize_for_match(text)
    if not normalized or not options:
        return None
    lookup = {normalize_for_match(opt): opt for opt in options if normalize_for_match(opt)}
    close = difflib.get_close_matches(normalized, list(lookup.keys()), n=1, cutoff=cutoff)
    return lookup.get(close[0]) if close else None


def listen_and_extract_node(state: FormAgentState) -> Dict[str, Any]:
    """Normalizes raw user speech into the target field value using LLM reasoning."""
    field = state.get("current_field") or {}
    speech = state.get("user_speech", "").strip()
    if not field:
        return {"extracted_value": speech}

    field_type = field.get("type", "text")
    raw_label = field.get("label", "").lower()
    validation_key = (field.get("validationKey") or "").lower()
    options = field.get("options", [])

    # Fast path: exact or fuzzy option match needs no LLM round-trip.
    speech_lower = speech.lower()
    if options and field_type in ["select", "radio"]:
        for opt in options:
            if opt.lower() == speech_lower:
                print(f"[AIRA STT] Exact option match, skipping LLM extraction: '{opt}'")
                return {"extracted_value": opt}
        fuzzy = closest_option(speech, options)
        if fuzzy:
            print(f"[AIRA STT] Fuzzy option match: '{speech}' -> '{fuzzy}'")
            return {"extracted_value": fuzzy}
    if options and field_type == "checkbox_group":
        parts = [p.strip() for p in re.split(r'[,|]', speech) if p.strip()]
        mapped = []
        for part in parts:
            exact = next((opt for opt in options if opt.lower() == part.lower()), None)
            mapped.append(exact or closest_option(part, options))
        if mapped and all(mapped):
            print(f"[AIRA STT] Exact/fuzzy checkbox options match, skipping LLM extraction: {mapped}")
            return {"extracted_value": ", ".join(mapped)}

    extracted = None
    llm = get_llm()
    
    if llm:
        try:
            allows_other = bool(field.get("hasOther") or field.get("otherAllowed"))
            if options and allows_other:
                options_hint = (
                    f"Pilihan yang disarankan: {', '.join(options)}. "
                    f"Namun pertanyaan ini memiliki opsi 'Other', jadi jawaban bebas di luar daftar itu SAH — "
                    f"kembalikan jawaban pengguna apa adanya bila tidak ada yang cocok."
                )
            elif options:
                options_hint = f"Pilihan yang sah: {', '.join(options)}. Cocokkan ke salah satu opsi ini."
            else:
                options_hint = ""
            res = llm.invoke(
                f"Anda adalah parser pengisian formulir untuk pengguna tunanetra.\n"
                f"Kolom target: '{raw_label}' (Tipe data: {field_type}).\n"
                f"{options_hint}\n"
                f"Ucapan pengguna: '{speech}'.\n"
                f"Tugas: Ekstrak HANYA nilai bersihnya yang sesuai dimasukkan ke input HTML.\n"
                f"- Jika angka terbilang ('tiga puluh dua' atau 'nol delapan satu'), ubah menjadi digit angka.\n"
                f"- Jika kolom bertipe rating / skala bintang, ekstrak HANYA digit angkanya (contoh: '4').\n"
                f"- Jika kolom bertipe checkbox_group, ekstrak daftar opsi yang dipilih dipisahkan koma.\n"
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
        if field_type == "rating":
            extracted = clean_indonesian_spoken_digits(speech)
        elif field_type == "checkbox_group" and options:
            chosen = []
            speech_lower = speech.lower()
            for opt in options:
                if opt.lower() in speech_lower or speech_lower in opt.lower():
                    chosen.append(opt)
            extracted = ", ".join(chosen) if chosen else speech
        elif field_type in ["number", "tel"] or "nik" in raw_label or field.get("maxLength") == 16:
            extracted = clean_indonesian_spoken_digits(speech)
        elif field_type == "email" or validation_key == "email":
            extracted = normalize_spoken_email(speech)
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
    field = state.get("current_field") or {}
    if not field:
        return {
            "is_valid": True,
            "validation_error": None,
            "answers": state.get("answers", {}),
            "filled_fields": state.get("filled_fields", []),
            "audio_cue": "question",
            "retry_count": 0
        }

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

    # Rule 7: Rating scale and Options validity
    field_type = field.get("type", "text")
    options = field.get("options")
    
    if field_type == "rating":
        r_scale = field.get("ratingScale") or {"min": 1, "max": 5}
        digits = re.sub(r'\D', '', str(val or ""))
        if digits:
            r_int = int(digits)
            if r_scale.get("min", 1) <= r_int <= r_scale.get("max", 5):
                val = str(r_int)
            else:
                return {
                    "is_valid": False,
                    "validation_error": f"Rating harus antara {r_scale.get('min', 1)} sampai {r_scale.get('max', 5)} bintang.",
                    "audio_cue": "error"
                }
        elif field.get("required", False):
            return {
                "is_valid": False,
                "validation_error": f"Mohon sebutkan angka rating dari {r_scale.get('min', 1)} sampai {r_scale.get('max', 5)} bintang.",
                "audio_cue": "error"
            }
    elif options and field_type in ["select", "radio"]:
        val_lower = str(val or "").lower().strip()
        matched_opt = None
        for opt in options:
            if opt.lower() == val_lower or opt.lower() in val_lower or val_lower in opt.lower():
                matched_opt = opt
                break
        if matched_opt:
            val = matched_opt
        elif field.get("hasOther") or field.get("otherAllowed") or any("other" in str(o).lower() or "lainnya" in str(o).lower() for o in options):
            # Valid custom answer under the "Other" option
            val = str(val or "").strip()
        elif field.get("required", False):
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
    """Moves to next field in the queue or triggers review, updating current_step_index."""
    filled = list(state.get("filled_fields", []))
    if state.get("is_correcting"):
        return {
            "current_field": None,
            "status": "REVIEWING",
            "is_correcting": False,
            "current_step_index": len(filled)
        }

    queue = list(state.get("fields_queue", []))
    if queue:
        queue.pop(0) # Remove completed field
        
    if queue:
        return {
            "fields_queue": queue,
            "current_field": queue[0],
            "status": "INTERVIEWING",
            "current_step_index": len(filled)
        }
    else:
        return {
            "fields_queue": [],
            "current_field": None,
            "status": "REVIEWING",
            "current_step_index": len(filled)
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
    
    # 1. Cancellation: user explicitly aborts
    if any(w in response for w in ["batal", "batalkan", "keluar", "tutup"]) and not any(w in response for w in ["ubah", "koreksi", "ganti", "revisi"]):
        return {
            "review_decision": "CANCELLED",
            "status": "COMPLETED",
            "spoken_prompt": "Pengisian formulir dibatalkan oleh pengguna.",
            "audio_cue": "error"
        }

    # 2. Check if user explicitly wants correction or expresses rejection/negation
    has_negation = any(neg in response for neg in [
        "belum", "tidak", "bukan", "salah", "kurang", "ubah", "ganti", 
        "koreksi", "revisi", "jangan", "ralat", "edit", "perbaiki"
    ])
    matched_field = find_field_by_keyword(response, filled)
    
    # 3. User specifically mentions a field to correct (e.g. "ubah nama", "nik salah", "perbaiki alamat")
    if matched_field and (has_negation or any(w in response for w in ["ubah", "ganti", "koreksi", "revisi", "edit", "perbaiki"])):
        idx = 0
        for i, f in enumerate(filled):
            if get_field_id(f) == get_field_id(matched_field):
                idx = i
                break
        return {
            "review_decision": "CORRECT_FIELD",
            "current_field": matched_field,
            "is_correcting": True,
            "status": "INTERVIEWING",
            "current_step_index": idx,
            "spoken_prompt": f"Baik, silakan sebutkan {matched_field.get('label')} yang baru.",
            "audio_cue": "question"
        }

    # 4. User said "belum" / "tidak" / "ada yang salah" without naming the specific field
    if has_negation:
        labels = [f.get("label", "Kolom") for f in filled]
        options_str = ", ".join(labels)
        return {
            "review_decision": "ASK_WHICH_FIELD",
            "status": "AWAITING_FIELD_CHOICE",
            "spoken_prompt": f"Baik, data mana yang ingin Anda perbaiki? Pilihan kolom: {options_str}.",
            "audio_cue": "question"
        }

    # 5. Affirmative: user confirms submission
    if any(w in response for w in ["ya", "kirim", "lanjut", "benar", "sudah", "oke", "setuju", "betul", "siap"]):
        return {
            "review_decision": "CONFIRMED"
        }

    # 6. Fallback if user mentions field name directly (e.g. "nama lengkap")
    if matched_field:
        idx = 0
        for i, f in enumerate(filled):
            if get_field_id(f) == get_field_id(matched_field):
                idx = i
                break
        return {
            "review_decision": "CORRECT_FIELD",
            "current_field": matched_field,
            "is_correcting": True,
            "status": "INTERVIEWING",
            "current_step_index": idx,
            "spoken_prompt": f"Baik, silakan sebutkan {matched_field.get('label')} yang baru.",
            "audio_cue": "question"
        }

    # 7. Unclear response fallback: prompt guidance
    labels = [f.get("label", "Kolom") for f in filled]
    options_str = ", ".join(labels)
    return {
        "review_decision": "ASK_WHICH_FIELD",
        "status": "AWAITING_FIELD_CHOICE",
        "spoken_prompt": f"Apakah Anda ingin mengirimkan formulir sekarang? Katakan 'Ya, kirim', atau sebutkan kolom yang ingin diubah ({options_str}).",
        "audio_cue": "question"
    }


def select_field_for_correction_node(state: FormAgentState) -> Dict[str, Any]:
    """Selects target field to correct after user names it."""
    speech = str(state.get("user_speech", "")).lower().strip()
    filled = state.get("filled_fields", [])
    matched_field = find_field_by_keyword(speech, filled)
    
    if matched_field:
        idx = 0
        for i, f in enumerate(filled):
            if get_field_id(f) == get_field_id(matched_field):
                idx = i
                break
        return {
            "current_field": matched_field,
            "is_correcting": True,
            "status": "INTERVIEWING",
            "current_step_index": idx,
            "spoken_prompt": f"Baik, silakan sebutkan {matched_field.get('label')} yang baru.",
            "audio_cue": "question"
        }
    else:
        fallback = filled[0] if filled else None
        return {
            "current_field": fallback,
            "is_correcting": True,
            "status": "INTERVIEWING",
            "current_step_index": 0,
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


def step_back_node(state: FormAgentState) -> Dict[str, Any]:
    """Moves one step backward in the questionnaire queue and marks step-back transition."""
    filled = list(state.get("filled_fields", []))
    if not filled:
        return {
            "spoken_prompt": "Anda sudah berada pada pertanyaan pertama.",
            "audio_cue": "error",
            "is_step_back": False
        }
        
    prev_field = filled.pop()
    queue = list(state.get("fields_queue", []))
    cur = state.get("current_field")
    if cur and get_field_id(cur) != get_field_id(prev_field):
        queue.insert(0, cur)
        
    cached = prev_field.get("cached_prompt")
    prompt = f"Kembali ke langkah sebelumnya. {cached}" if cached else "Kembali ke langkah sebelumnya."
    
    return {
        "filled_fields": filled,
        "fields_queue": queue,
        "current_field": prev_field,
        "status": "INTERVIEWING",
        "is_correcting": False,
        "is_step_back": True,
        "current_step_index": len(filled),
        "spoken_prompt": prompt,
        "audio_cue": "question",
        "field_hint": prev_field.get("cached_hint") or prev_field.get("hint")
    }


def jump_to_field_node(state: FormAgentState, target_field_id: Optional[str] = None) -> Dict[str, Any]:
    """Jumps directly to a specific field for in-place correction (triggered by UI 'Ubah' button or review graph)."""
    # If target_field_id was not passed explicitly, use current_field already selected by handle_review_confirmation_node
    if not target_field_id and state.get("current_field"):
        lbl = state["current_field"].get("label", "kolom ini")
        hint = get_field_explanation(state["current_field"])
        return {
            "is_correcting": True,
            "status": "INTERVIEWING",
            "spoken_prompt": f"Baik, silakan perbarui data {lbl} Anda.",
            "audio_cue": "question",
            "field_hint": hint
        }
        
    candidates = []
    if state.get("current_field"):
        candidates.append(state["current_field"])
    candidates.extend(state.get("filled_fields", []))
    candidates.extend(state.get("fields_queue", []))
    
    matched = None
    target_clean = str(target_field_id or "").lower()
    for f in candidates:
        if f and (get_field_id(f).lower() == target_clean or str(f.get("domId", "")).lower() == target_clean):
            matched = f
            break
            
    if not matched and target_clean:
        # Fallback keyword match
        matched = find_field_by_keyword(target_clean, candidates)
        
    if matched:
        lbl = matched.get("label", "kolom ini")
        hint = get_field_explanation(matched)
        return {
            "current_field": matched,
            "is_correcting": True,
            "status": "INTERVIEWING",
            "spoken_prompt": f"Baik, silakan perbarui data {lbl} Anda.",
            "audio_cue": "question",
            "field_hint": hint
        }
    else:
        return {
            "spoken_prompt": f"Kolom {target_field_id} tidak ditemukan.",
            "audio_cue": "error"
        }


def prompt_field_choice_node(state: FormAgentState) -> Dict[str, Any]:
    """Sets state to awaiting field choice when user wants to correct a field from review."""
    filled = state.get("filled_fields", [])
    labels = [f.get("label", "Kolom") for f in filled]
    options_str = ", ".join(labels)
    return {
        "status": "AWAITING_FIELD_CHOICE",
        "spoken_prompt": f"Baik, data mana yang ingin Anda perbaiki? Pilihan kolom: {options_str}.",
        "audio_cue": "question"
    }


def cancel_session_node(state: FormAgentState) -> Dict[str, Any]:
    """Marks session as cancelled."""
    return {
        "status": "CANCELLED",
        "spoken_prompt": "Pengisian formulir dibatalkan oleh pengguna.",
        "audio_cue": "error"
    }


def summarize_page_node(dom_overview: Dict[str, Any]) -> str:
    """Generates polite, concise 3-4 sentence summary of the page for subscription-based AI proxy."""
    page_title = dom_overview.get("pageTitle") or "Portal Layanan Publik"
    headings = dom_overview.get("headings", [])
    actions = dom_overview.get("actionElements", [])
    forms = dom_overview.get("forms", [])
    snippets = dom_overview.get("snippets", [])
    
    llm = get_llm()
    if llm:
        try:
            h_text = ", ".join([h.get("text", "") for h in headings[:4]])
            act_text = ", ".join([a.get("text", "") for a in actions[:5]])
            form_text = f"{len(forms)} formulir tersedia" if forms else "Tidak ada formulir"
            
            prompt = (
                f"Judul Halaman: {page_title}\n"
                f"Topik Utama: {h_text}\n"
                f"Tombol/Menu Penting: {act_text}\n"
                f"Formulir: {form_text}\n"
                f"Kutipan Informasi: {' '.join(snippets[:2])}"
            )
            
            res = llm.invoke(
                f"Anda adalah AIRA, asisten aksesibilitas ramah untuk tunanetra dan lansia di Indonesia.\n"
                f"Tugas: Buat ringkasan isi halaman web ini secara padat, santun, dan jelas (maksimal 3-4 kalimat).\n"
                f"Sebutkan nama halaman, fungsi/layanan utama, dan saran langkah berikutnya bagi pengguna.\n"
                f"Gunakan Bahasa Indonesia awam tanpa istilah birokrasi rumit.\n\n"
                f"{prompt}"
            )
            return res.content.strip()
        except Exception as e:
            print(f"[LLM Summarize Fallback]: {e}")
            
    # Rule-based fallback
    total_fields = sum(len(f.get("fields", [])) for f in forms)
    summary = f"Halo! Anda saat ini berada di halaman '{page_title}'. "
    if forms:
        summary += f"Terdapat formulir online dengan {total_fields} pertanyaan isian yang dapat saya bantu pandu pengisiannya secara bertahap. "
    if actions:
        top_acts = ", ".join([f'"{a.get("text")}"' for a in actions[:3]])
        summary += f"Menu yang dapat Anda pilih antara lain: {top_acts}. "
    summary += "Silakan katakan 'Bantu isi form' atau sebutkan menu yang ingin Anda buka!"
    return summary


def classify_intent_node(user_input: str, dom_overview: Dict[str, Any]) -> Dict[str, Any]:
    """Analyzes user voice/text command into structured AIRAIntentResult for subscription-based AI proxy."""
    query = user_input.strip()
    actions = dom_overview.get("actionElements", [])
    forms = dom_overview.get("forms", [])
    
    llm = get_llm()
    if llm:
        try:
            import json
            act_summary = "\n".join([f"- ID: {a.get('id')} | Tombol: '{a.get('text')}'" for a in actions[:10]])
            form_summary = "\n".join([f"- ID: {f.get('id')} | Form: '{f.get('title')}'" for f in forms[:3]])
            
            system_prompt = (
                "Anda adalah AIRA Action Engine.\n"
                "Analisis perintah pengguna dan daftar elemen tombol serta form di halaman.\n"
                "Keluarkan output JSON dengan format ketat:\n"
                "{\n"
                '  "intent": "NAVIGATE" | "FILL_FORM" | "SUMMARIZE" | "SETTINGS" | "CHAT",\n'
                '  "targetId": "string ID elemen dari daftar, atau null",\n'
                '  "explanation": "Penjelasan singkat santun dalam Bahasa Indonesia",\n'
                '  "actionName": "Nama aksi misalnya \'Formulir Pendaftaran\'",\n'
                '  "confidence": 0.0 - 1.0\n'
                "}\n"
                "Hanya rujuk targetId yang ada pada daftar."
            )
            user_prompt = f'Input Pengguna: "{query}"\n\nDaftar Form:\n{form_summary}\n\nDaftar Tombol:\n{act_summary}'
            
            res = llm.invoke(f"{system_prompt}\n\n{user_prompt}")
            content = res.content.strip()
            if content.startswith("```"):
                content = re.sub(r"^```(?:json)?\n?", "", content)
                content = re.sub(r"\n?```$", "", content)
            parsed = json.loads(content)
            return parsed
        except Exception as e:
            print(f"[LLM Intent Fallback]: {e}")
            
    # Deterministic rule-based fallback
    q = query.lower()
    if any(w in q for w in ["ringkas", "rangkum", "isi halaman", "ada apa"]):
        return {
            "intent": "SUMMARIZE",
            "targetId": None,
            "explanation": "Saya akan membacakan ringkasan halaman ini untuk Anda.",
            "actionName": "Ringkas Halaman",
            "confidence": 0.95
        }
    if any(w in q for w in ["isi form", "formulir", "daftar", "input", "bantu isi"]):
        target_form = forms[0] if forms else None
        return {
            "intent": "FILL_FORM",
            "targetId": target_form.get("id") if target_form else None,
            "explanation": "Saya siap memandu Anda mengisi formulir satu per satu.",
            "actionName": "Bantu Isi Formulir",
            "confidence": 0.9
        }
    if any(w in q for w in ["kontras", "suara", "font", "pengaturan"]):
        return {
            "intent": "SETTINGS",
            "targetId": None,
            "explanation": "Membuka pengaturan aksesibilitas.",
            "actionName": "Pengaturan",
            "confidence": 0.9
        }
    return {
        "intent": "CHAT",
        "targetId": None,
        "explanation": f"Saya mendengar: '{query}'. Anda dapat meminta saya merangkum halaman, mencari menu, atau memandu pengisian formulir.",
        "actionName": "Bantuan Umum",
        "confidence": 0.5
    }

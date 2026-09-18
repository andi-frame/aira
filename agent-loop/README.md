# AIRA Universal Agent Loop (LangGraph & uv)

> **Adaptive Interface and Responsive Assistance (AIRA)**  
> *Subtema 2: Accessibility & Subtema 3: Receiver & Provider — IFEST 2026 Hackathon (Institut Teknologi Bandung)*  
> Disusun oleh Tim: **Kapal Lawut**

---

## 📖 Ringkasan Proyek

`agent-loop/` adalah fondasi mesin agentik cerdas (*Brain*) dari AIRA yang beroperasi secara **Server-Side**. Modul ini dirancang khusus untuk memandu pengguna **tunanetra (*blind users*)** bernavigasi dan mengisi **sembarang formulir web (*Universal Arbitrary Forms*)** secara mandiri tanpa melihat layar (*100% Eyes-Free Voice Navigation*).

Sistem ini memadukan **LangGraph StateGraph** (alur kendali siklis & human-in-the-loop), **Google Gemini 2.5 Flash** (ekstraksi semantik percakapan), dan **Deterministic Guardrails** (validasi format data tanpa halusinasi).

---

## 🧠 Arsitektur Alur Agen (LangGraph StateGraph)

```
               ┌────────────────────────┐
               │    Node: Start /       │
               │   DOM Orientation      │
               └───────────┬────────────┘
                           │
                           ▼
               ┌────────────────────────┐
               │ Node: Formulate Prompt │ ◄──────────────────────┐
               │ (Bikin Pertanyaan Awam)│                        │
               └───────────┬────────────┘                        │
                           │                                     │
                           ▼                                     │
               ┌────────────────────────┐                        │
               │ Node: Listen & Extract │                        │
               │ (STT -> LLM Normalizer)│                        │
               └───────────┬────────────┘                        │
                           │                                     │
                           ▼                                     │
               ┌────────────────────────┐                        │
               │ Node: Deterministic    │                        │
               │       Guardrail        │                        │
               └───────────┬────────────┘                        │
                           │                                     │
            [Conditional Edge: Apakah Valid?]                     │
              /                          \                       │
       (Tidak Valid)                    (Valid & Masih ada field)│
            /                              \─────────────────────┘
           ▼                                
┌─────────────────────┐                     
│ Node: Spoken Error  │                     
│ & Guidance (Tegur)  │                     
└──────────┬──────────┘                     
           │                                
           └───────────────► (Kembali ke Listen & Extract)
                           
                           │ (Valid & Semua Field Lengkap)
                           ▼
               ┌────────────────────────┐
               │ Node: Spoken Review    │ ◄──────────────────────┐
               │ (Bacakan Ringkasan)    │                        │
               └───────────┬────────────┘                        │
                           │                                     │
                           ▼                                     │
               ┌────────────────────────┐                        │
               │ Node: Interrupt Gate   │                        │
               │ (Tunggu "Ya, Kirim!")  │                        │
               └───────────┬────────────┘                        │
                           │                                     │
               [Apakah Disetujui User?]                          │
                 /                  \                            │
       (User: "Belum" / Koreksi)   (User: "Ya, Kirim")           │
               /                      \                          │
              ▼                        ▼                         │
   ┌──────────────────────┐   ┌────────────────────────┐         │
   │ Dialog Pilih Kolom & │   │ Node: Sync & Submit    │         │
   │ Input Nilai Baru     │   │ (Injeksi ke DOM Asli)  │         │
   └──────────┬───────────┘   └────────────────────────┘         │
              │                                                  │
              └──────────────────────────────────────────────────┘
```

### Dua Siklus Koreksi Kunci (*Cyclic Self-Healing Loops*):
1. **In-Flight Validation Retry**: Jika pengguna salah menyebut format (misal NIK hanya 8 digit), agen menegur via suara dan meminta sisa digit tanpa merusak progres field lainnya.
2. **Review & Correction Loop**: Pada akhir wawancara, jika pengguna menjawab **"belum"**, sistem **tidak berhenti**. Agen bertanya kolom mana yang ingin diperbaiki, mengambil nilai baru, memvalidasinya, dan menyajikan kembali ringkasan yang telah diperbarui.

---

## 🌐 Bersifat Agnostik & Universal (Bisa untuk Form Apa Saja)

AIRA tidak mengunci skema form secara kaku. Content Script browser memindai input DOM apa pun dan mengirimkan antrean field dinamis (`fields_queue`) ke agen.

Simulator menyediakan beberapa preset formulir nyata:
* **`beasiswa`**: Pendaftaran Beasiswa Talenta Unggul (Nama, Usia, Jenjang S1/S2, Komitmen).
* **`kelurahan`**: Layanan Pengajuan Surat Keterangan Domisili (NIK, Nama, Keperluan).
* **`rsud`**: Formulir Rawat Jalan Rumah Sakit (NIK, Nama, Poli Spesialis, Persetujuan).

---

## 🚀 Panduan Menjalankan dengan `uv`

Proyek ini dikelola menggunakan [uv](https://github.com/astral-sh/uv). Anda **tidak perlu mengaktifkan virtual environment secara manual**.

### 1. Sinkronisasi Dependensi
```bash
uv sync
```

### 2. Jalankan Simulator Suara Terminal

#### A. Mode Demo Otomatis (Menguji Form Beasiswa + Correction Loop "Belum"):
```bash
uv run python examples/mock_runner.py --preset=beasiswa --demo
```

#### B. Mode Interaktif (Bicara / Ketik Sendiri):
```bash
# Form Beasiswa
uv run python examples/mock_runner.py --preset=beasiswa

# Form Surat Kelurahan
uv run python examples/mock_runner.py --preset=kelurahan

# Form Pendaftaran RSUD
uv run python examples/mock_runner.py --preset=rsud
```

### 3. Menjalankan Server Backend API & WebSocket
```bash
uv run uvicorn aira_agent.server:app --reload --port 8000
```
* **API Documentation (Swagger UI)**: `http://localhost:8000/docs`
* **Health Check**: `http://localhost:8000/health`
* **WebSocket Endpoint**: `ws://localhost:8000/ws/{session_id}`
* **REST Endpoints**:
  * `POST /session/start`: Inisialisasi sesi dari scan DOM.
  * `POST /session/interact`: Mengirim transkrip suara pengguna & menerima arahan audio berikutnya.
  * `POST /session/confirm`: Konfirmasi final & menghasilkan payload DOM sinkronisasi.

### 4. Menjalankan Test Suite (Pytest)
```bash
uv run pytest tests/test_agent_graph.py -v
```
*(Seluruh 6 unit & integration tests lulus 100%)*

---

## 📂 Struktur File (Clean Standard Architecture)

```
agent-loop/
├── pyproject.toml              # Konfigurasi dependensi uv & hatchling build
├── uv.lock                     # Lockfile dependensi deterministik
├── .env.example                # Template API Key (Gemini & LangSmith)
├── README.md                   # Dokumentasi teknis & cara menjalankan
│
├── src/
│   └── aira_agent/             # Core Production Package
│       ├── __init__.py         # Package exports
│       ├── state.py            # Universal FormAgentState schema
│       ├── nodes.py            # LangGraph Nodes (Logic, Normalizer, Guardrails)
│       ├── edges.py            # Conditional Routing & Cyclic Loops
│       ├── graph.py            # Compiled LangGraph StateGraph
│       └── server.py           # FastAPI Server REST & WebSocket
│
├── examples/                   # Mock Scripts & Testbeds
│   ├── mock_runner.py          # Interactive Terminal Voice Simulator
│   └── mock_portal.html        # Web RSUD untuk uji coba injeksi DOM
│
└── tests/                      # Automated Test Suite
    └── test_agent_graph.py     # Suite pengujian unit & integrasi
```

## 🐳 Deploy dengan Docker / Dokploy

Folder ini sudah menyediakan `Dockerfile`, `.dockerignore`, dan `docker-compose.yml`.
Untuk deployment di Dokploy:

1. Buat aplikasi dari repository ini dan gunakan **Docker Compose** dengan path `agent-loop/docker-compose.yml`, atau gunakan **Dockerfile** dengan build path `agent-loop` dan Dockerfile path `agent-loop/Dockerfile`.
2. Set domain ke service `aira-backend` pada port internal `8000`.
3. Isi environment variable yang diperlukan di Dokploy, minimal `ROUTER_API_KEY` atau `GEMINI_API_KEY` sesuai provider LLM yang digunakan.
4. Health check aplikasi menggunakan `GET /health`.

Untuk test lokal:

```bash
cd agent-loop
docker build -t aira-backend:local .
docker run --rm -p 8000:8000 --env-file .env aira-backend:local
```

Jangan menjalankan lebih dari satu replica sebelum session store dipindahkan dari memory ke storage bersama, karena sesi aktif saat ini disimpan di process memory.

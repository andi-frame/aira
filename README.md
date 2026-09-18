# AIRA: Adaptive Interface and Responsive Assistance for Web Navigation and Form Completion

> **Proposal Hackathon Informatics Festival (IFEST) 2026**  
> **Tema**: *Tech for Human Connections*  
> **Subtema**: Accessibility, Receiver & Provider  
> **Tim Pengembang**: Kapal Lawut (Institut Teknologi Bandung)

---

## 🌟 Tentang AIRA

**AIRA** adalah ekstensi peramban cerdas (Chromium Manifest V3) yang beroperasi sebagai lapisan asistensi adaptif di sisi pengguna (*browser-side assistance layer*). AIRA dirancang khusus untuk memfasilitasi interaksi web secara mandiri bagi kelompok rentan, khususnya **penyandang disabilitas (tunanetra, disabilitas motorik)** dan **lansia**, dalam mengakses layanan publik digital di Indonesia (seperti pendaftaran BPJS, antrian faskes, dan administrasi kependudukan).

AIRA dibangun menggunakan **Bun (v1.3.2)** dan **TypeScript** murni untuk menjamin keamanan tipe (*type safety*), performa tinggi, dan struktur kode *enterprise-grade*.

---

## ✨ Fitur-Fitur Utama

1. **Dua Antarmuka Terpadu (Synced UI)**:
   - **Navbar Popup**: Tampilan khusus pengaturan komprehensif saat menekan icon ekstensi di browser toolbar (pengaturan endpoint LLM, API Key, ElevenLabs key, voice-only, dan profil aksesibilitas).
   - **Floating Shortcut (Kanan Bawah)**: Tombol melayang di pojok kanan bawah halaman web. Menampilkan asisten percakapan (*chat assistant*) interaktif dan tab pengaturan yang tersinkronisasi 2 arah via `chrome.storage`.

2. **Mode Suara Penuh (Voice-Only Mode & Tunanetra Accessibility)**:
   - Seluruh alur (navigasi, pemahaman halaman, pengisian formulir, hingga pengiriman) dapat dijalankan hanya menggunakan suara tanpa mouse.
   - **Shortcut Push to Talk: `Alt + S`**: Tahan `Alt + S` saat berbicara dan lepaskan untuk langsung mengirim instruksi/isian suara. Dilengkapi deteksi ketukan singkat untuk ramah disabilitas motorik.
   - **Shortcut Toggle Suara: `Alt + A`**: Mengaktifkan atau menonaktifkan asisten suara AIRA secara instan dari halaman mana saja.
   - **Earcons Audio Cues (Web Audio API)**: Sintesis nada harmonis offline untuk feedback saat mikrofon aktif, suara tertangkap, langkah sukses, atau peringatan error.
   - Kompatibel dengan pembaca layar (*screen reader*) via kontainer `aria-live="assertive"`.

3. **DOM Perception & Token Minimization**:
   - Mengekstrak elemen penting halaman (heading, formulir, input, tombol, label) dan membuang elemen sampah (script, style, svg, iklan).
   - Menghasilkan payload padat (<500 tokens) sehingga hemat kuota token LLM tanpa mengorbankan ketepatan aksi.

4. **1-per-1 Guided Form Wizard & Deterministic Sync**:
   - Mengurai formulir birokrasi yang rumit menjadi dialog tanya-jawab santun satu per satu di tengah layar.
   - Menjelaskan istilah rumit dalam bahasa awam (misal: penjelasan apa itu NIK dan dokumen rujukannya).
   - **Validasi Klien Deterministik**: Memeriksa format NIK (16 digit angka), nomor WhatsApp/telepon, tanggal lahir, dan email.
   - **Kartu Rangkuman Pengisian**: Menampilkan ringkasan isian lengkap dengan tombol *Ubah* per butir data sebelum disinkronkan ke website host.
   - Memasukkan data ke formulir asli halaman dengan memicu event `focus`, `input`, `change`, dan `blur`.

5. **Pencatatan Riwayat Interaksi Lengkap (Full Chat Log)**:
   - Setiap dialog langkah pengisian formulir, hasil transkripsi suara, navigasi spotlight, maupun perangkuman dicatat secara kronologis ke dalam riwayat chat panel.

6. **Transkripsi Suara Real-Time (Live STT Feedback)**:
   - Saat pengguna berbicara, teks hasil inferensi suara langsung tampil seketika (*interim results*) pada bar visualizer audio.

7. **Tiered TTS (ElevenLabs & Fallback Google/Microsoft)**:
   - Utama: ElevenLabs Text-to-Speech API dengan suara alami Bahasa Indonesia.
   - Fallback Otomatis: Jika API key belum diisi, sistem otomatis beralih ke Web Speech Synthesis Google Bahasa Indonesia atau Microsoft Gadis/Ardi (`id-ID`).

8. **Aksesibilitas Adaptif (WCAG 2.1 AAA)**:
   - Mode Kontras Tinggi: Latar hitam pekat (`#000000`) dan teks kuning kontras (`#FFE600`) dengan rasio kontras 19.5:1.
   - Penskalaan Teks: Normal (100%), Lansia (125%), Ekstra Besar (150%).
   - Target Sentuh: Standar (44px), Lansia (52px), Ramah Motorik (64px).
   - Sensory Shield: Mematikan animasi dan transisi yang berpotensi memicu distraksi.

9. **Graceful Degradation (Offline / No-LLM Mode)**:
   - Jika API Key LLM tidak tersedia atau dinonaktifkan, AIRA tetap beroperasi menggunakan algoritma *Rule-Based DOM Parsing*, panduan formulir berbasis label, dan pencocokan navigasi berbasis kata kunci.

---

## 📁 Struktur Direktori Proyek

```
c:\ITB\Competition\aira\
├── package.json              // Konfigurasi Bun & scripts
├── tsconfig.json             // Konfigurasi TypeScript
├── build.ts                  // Script build otomatis Bun.build
├── public/
│   ├── manifest.json         // Chrome Manifest V3
│   ├── popup/
│   │   ├── popup.html        // UI Pengaturan Navbar
│   │   └── popup.css         // Style Pengaturan
│   └── demo/
│       ├── portal_layanan_publik.html // Portal simulasi pengujian interaktif
│       └── portal.css
├── src/
│   ├── types/                // Definisi tipe TypeScript
│   ├── shared/
│   │   ├── constants.ts      // Konfigurasi & aturan validasi
│   │   ├── storage.ts        // Sinkronisasi chrome.storage (2-way sync)
│   │   └── sound_effects.ts  // Sintesis audio cues (earcons)
│   ├── services/
│   │   ├── dom_pruner.ts     // Ekstraksi & peringkasan struktur DOM
│   │   ├── llm_service.ts    // Client OpenAI-compatible & fallback
│   │   ├── tts_service.ts    // ElevenLabs + WebSpeech id-ID
│   │   ├── stt_service.ts    // Speech-to-text dengan transkripsi langsung
│   │   └── form_orchestrator.ts // Wizard 1-per-1 & sinkronisasi DOM
│   ├── content/
│   │   ├── content_script.ts // Entrypoint Content Script & Shadow DOM host
│   │   ├── content_style.css // Design system WCAG 2.1 AAA & Figma Hi-Fi
│   │   ├── chat_panel.ts     // Asisten Chat & live audio visualizer
│   │   ├── settings_panel.ts // Tampilan pengaturan in-page
│   │   ├── form_wizard.ts    // Modal dialog formulir terpandu
│   │   └── spotlight.ts      // Navigation spotlight & beacon pointer
│   ├── popup/
│   │   └── popup.ts          // Logika popup navbar
│   └── background/
│       └── service_worker.ts // Service worker Manifest V3
└── dist/                     // Direktori siap dimuat di Chrome Extensions
```

---

## 🚀 Panduan Memasang Ekstensi di Browser

1. Buka browser berbasis Chromium (Google Chrome, Microsoft Edge, atau Brave).
2. Ketik `chrome://extensions` pada address bar dan tekan **Enter**.
3. Di pojok kanan atas, aktifkan toggle **Developer mode** (Mode Pengembang).
4. Klik tombol **Load unpacked** (Muat yang belum dibongkar) di pojok kiri atas.
5. Pilih folder hasil build:  
   `c:\ITB\Competition\aira\dist`
6. Ekstensi **AIRA** akan langsung muncul di daftar ekstensi peramban Anda!

---

## 🧪 Panduan Menguji Fitur (Testing Walkthrough)

### 1. Membuka Portal Pengujian Demo
Buka file demo interaktif di browser Anda:
```
c:\ITB\Competition\aira\dist\demo\portal_layanan_publik.html
```
*(Atau Anda juga dapat membuka file ini langsung dengan menekan dua kali file HTML tersebut di file explorer).*

### 2. Memeriksa Sinkronisasi Pengaturan (Navbar Popup vs In-Page Panel)
- Klik icon **AIRA** di toolbar atas browser.
- Anda dapat mengonfigurasi API Key LLM (contoh endpoint: `https://9r.disra.net/v1/chat/completions`, model `cx/gpt-5.6-luna`), ElevenLabs Key, atau mencoba toggle **Mode Kontras Tinggi**.
- Buka panel AIRA di halaman web (klik tombol melayang AIRA di pojok kanan bawah), lalu pilih tab **Pengaturan**.
- Perhatikan bahwa setiap perubahan di navbar langsung berubah seketika di panel halaman web, dan sebaliknya!

### 3. Menguji Fitur Suara Manual (Khusus untuk Anda)
> [!NOTE]
> Karena input mikrofon membutuhkan hardware fisik dan izin peramban (*permission prompt*), silakan lakukan langkah berikut di browser Anda:

1. **Izinkan Akses Mikrofon**:
   - Saat pertama kali menekan tombol mikrofon atau menekan `Alt + A`, browser akan menampilkan pop-up *"Use your microphone"*. Klik **Allow** (Izinkan).
2. **Uji Transkripsi Live (Point 10)**:
   - Tekan icon mikrofon di panel chat AIRA atau tombol *"Berikan pesan dengan suara"* di formulir.
   - Mulailah berbicara Bahasa Indonesia (misal: *"Saya ingin daftar antrian"* atau *"3204012345670001"*).
   - Perhatikan bar transkripsi biru dengan animasi gelombang suara akan **langsung menampilkan kata demi kata yang Anda ucapkan secara real-time** sebelum selesai diinferensikan.
3. **Uji Navigasi Suara**:
   - Katakan: *"Cari menu pendaftaran"* atau *"Ke antrian online"*.
   - AIRA akan menyorot tombol target dengan lingkaran beacon spotlight bersinar, mengumumkan melalui suara, dan memberikan tombol konfirmasi.
4. **Uji Panduan Formulir 1-per-1**:
   - Katakan: *"Bantu isi formulir"* atau tekan tombol chip *✍️ Bantu Isi Formulir*.
   - Modal dialog ramah akan muncul di tengah layar.
   - Dengarkan pertanyaan yang dibacakan, atau tekan tombol suara besar untuk menyebutkan NIK Anda.
   - Ucapkan NIK 16 digit: *"3204011212980005"*. AIRA akan memvalidasi formatnya dan otomatis melangkah ke nama lengkap, tanggal lahir, dan nomor WhatsApp.
   - Di langkah akhir, kartu **Rangkuman Pengisian** akan dibacakan, dan Anda dapat menekan *"Kirim Formulir Sekarang"*. Seluruh data akan otomatis terisi rapi ke dalam formulir asli website host!
5. **Uji Mode Suara & Push to Talk (`Alt + S` / `Alt + A`)**:
   - **Uji Push to Talk (`Alt + S`)**: Tekan dan tahan tombol `Alt + S` pada keyboard, ucapkan *"Tolong rangkum halaman ini"*, lalu lepaskan tombol. AIRA akan seketika memproses ucapan Anda dan membacakan jawabannya!
   - Pada modal formulir: Tahan `Alt + S`, sebutkan NIK Anda, lalu lepaskan. Data langsung terisi dan formulir otomatis maju ke langkah berikutnya.
   - **Uji Toggle Asisten (`Alt + A`)**: Tekan `Alt + A` untuk membuka panel asisten suara secara langsung dari halaman web manapun.

---

## 🛠️ Perintah Pengembangan (Development Commands)

- **Kompilasi Ulang**:
  ```bash
  bun run build
  ```
- **Mode Watch (Auto-rebuild saat edit kode)**:
  ```bash
  bun run dev
  ```
- **Pengecekan Tipe TypeScript**:
  ```bash
  bun run typecheck
  ```

## 🌐 Landing Page & Distribusi Demo

Landing page Astro berada di folder `landing/` dan dideploy sebagai static assets melalui Cloudflare Workers.

```bash
# Pasang dependensi landing page satu kali
cd landing && bun install && cd ..

# Build ekstensi, buat ZIP unduhan, salin portal demo, dan build Astro
bun run site:build

# Cek Wrangler lokal (dependency repo)
bun run wrangler -- --version

# Deploy ke Cloudflare Workers (memerlukan autentikasi Cloudflare)
bun run deploy

# Alternatif one-off tanpa dependency lokal
bunx wrangler deploy --config wrangler.jsonc
```

Hasil build landing tersedia di `landing/dist/`, sedangkan arsip ekstensi dibuat di `landing/public/downloads/aira-extension.zip` saat pipeline build berjalan. Workflow GitHub Actions tersedia di `.github/workflows/deploy-landing.yml` dan menggunakan secrets `CLOUDFLARE_API_TOKEN` serta `CLOUDFLARE_ACCOUNT_ID`.

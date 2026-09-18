# Integration Plan: PR #1 + PR #2

## Tujuan

Menyatukan PR #1 (`fix/configuration`) dan PR #2 (`integration`) ke dalam satu PR pengganti berbasis `main`, tanpa mengubah atau men-stage perubahan lokal yang sedang ada di worktree utama.

Worktree dan branch rencana:

- Worktree: `.worktrees/integrate-pr-1-2`
- Branch: `supersede-pr-1-2`
- Base: `origin/main` (`cc880d0`)

## Strategi riwayat

Gunakan cherry-pick linear agar dua merge-main redundan dari PR #2 tidak ikut terbawa:

1. `f0d9f45` — `feat: agent-loop`
2. `5271cf3` — `feat: enhance session management with navigation actions and accessibility hints`
3. `748e70b` — `feat: Integrate 9Router Whisper STT and enhance agent service`
4. `76f7184` — `fix: configuration (blm semua)`

Tambahkan `/.worktrees/` pada `.gitignore` branch ini sebagai commit terpisah. Jangan memasukkan perubahan lokal lain dari worktree utama.

## Perbaikan wajib sebelum PR

### Integrasi frontend

- Selaraskan default STT: Web Speech tetap fallback/default sisi klien; 9Router Whisper dipakai pada alur audio server dan tetap menjadi opsi konfigurasi.
- Selaraskan fallback, label popup/settings, endpoint Whisper, dan `DEFAULT_SETTINGS` agar tidak ada klaim default yang saling bertentangan.
- Normalisasi akses `id`/`domId` pada `FormWizard` agar lolos TypeScript tanpa memperlebar tipe secara tidak perlu.
- Selaraskan `AgentStatus` frontend dengan status backend uppercase: `INTERVIEWING`, `RETRY_REQUIRED`, `REVIEWING`, `AWAITING_CONFIRMATION`, `AWAITING_FIELD_CHOICE`, `COMPLETED`, dan `CANCELLED`.

### Alt+S dan voice flow

- Ukur durasi tekan pada saat keyup sebelum debounce 120 ms.
- Cegah perekaman ganda ketika wizard sudah aktif merekam; bersihkan state/timer pada stop, blur, error, dan safety timeout.
- Pertahankan quick tap sebagai mode toggle dan hold sebagai push-to-talk.
- Pada mode toggle chat, Enter menghentikan capture dan mengirim satu kali setelah transkrip final; Alt+S kedua tetap menjadi kontrol stop. Wizard tetap mempertahankan konfirmasi jawaban form.

### Accessibility dan fallback agent

- Tambahkan label terhubung (`for`) untuk slider font scale dan control scale.
- Ganti warna error host-page menjadi `#FF8080` (rasio kontras minimal 7:1 pada latar gelap) dan tambahkan indikator nonwarna seperti outline/border.
- Tambahkan normalisasi deterministic untuk ucapan email seperti `dot` dan `at`, sehingga alur backend tidak bergantung pada LLM.

## Build, test, dan acceptance criteria

Jalankan dari worktree baru:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run build
uv sync --frozen
uv run pytest -q
```

Acceptance criteria:

- TypeScript typecheck lulus.
- Build ekstensi lulus dan `dist/` diregenerasi dari source.
- Seluruh 12 test backend lulus; test metadata field dan spoken-email menghasilkan payload kanonis yang benar.
- Smoke test Alt+S mencakup quick tap, hold, Enter, blur, timeout, serta wizard yang sudah aktif.
- Slider dapat dikenali pembaca layar; mode kontras memenuhi rasio yang diklaim dan tidak hanya mengandalkan warna.
- Build kedua tidak menghasilkan diff tambahan.

## Publikasi PR

- Push branch `supersede-pr-1-2`.
- Buat PR baru ke `main`, misalnya berjudul `feat: integrate accessibility configuration and agent loop`.
- Body PR mencantumkan `Supersedes #1 and #2`, asal commit, perbaikan review, dan hasil validasi.
- Setelah URL PR baru tersedia, beri komentar tautan tersebut pada PR #1 dan #2 lalu tutup keduanya. Jangan menghapus branch lama.

## Hasil eksplorasi saat ini

- PR #1 dan #2 sama-sama bersih terhadap `main`, tetapi memiliki overlap pada sembilan file.
- Simulasi cherry-pick ke clone sementara tidak menghasilkan konflik tekstual.
- Sebelum hardening, build lulus; typecheck gagal pada akses `fieldData.domId`; backend test menghasilkan 10 lulus dan 1 gagal pada normalisasi email spoken.

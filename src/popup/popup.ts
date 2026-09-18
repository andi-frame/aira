/**
 * AIRA - Navbar Popup Logic (TypeScript)
 * Dedicated to settings setup (Point 1), STT selection, LLM transparency, and 2-way sync.
 */

import { storageManager } from '../shared/storage';
import { AiraSettings, FontSizeOption, ControlSizeOption, TTSProvider, STTProvider } from '../types/index';
import { ttsService } from '../services/tts_service';

class PopupController {
  private saveTimeout: number | null = null;

  public async init(): Promise<void> {
    const settings = await storageManager.getSettings();
    this.populateForm(settings);
    this.updateLLMFeatureBanner(settings);
    this.bindEvents();
  }

  private $(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  private populateForm(s: AiraSettings): void {
    const setChecked = (id: string, val: boolean) => {
      const el = this.$(id) as HTMLInputElement | null;
      if (el) el.checked = val;
    };

    const setValue = (id: string, val: string) => {
      const el = this.$(id) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = val;
    };

    setChecked('voiceOnlyMode', s.voiceOnlyMode);
    setChecked('llmEnabled', s.llmEnabled);
    setValue('llmEndpoint', s.llmEndpoint || 'https://9r.disra.net/v1/chat/completions');
    setValue('llmApiKey', s.llmApiKey || '');
    setValue('llmModel', s.llmModel || 'cx/gpt-5.6-luna');

    setValue('sttProvider', s.sttProvider || 'whisper');
    setValue('whisperApiKey', s.whisperApiKey || '9router');
    setValue('whisperEndpoint', s.whisperEndpoint || 'https://9r.disra.net/v1/audio/transcriptions');

    setValue('ttsProvider', s.ttsProvider || 'elevenlabs');
    setValue('elevenlabsApiKey', s.elevenlabsApiKey || '');
    setValue('elevenlabsVoiceId', s.elevenlabsVoiceId || 'pNInz6obpgDQGcFmaJgB');

    setChecked('highContrast', s.highContrast);
    
    // Resolve fontScale and controlScale with fallback from legacy fontSize / controlSize
    let fontScale = s.fontScale ?? 100;
    if (s.fontScale === undefined && s.fontSize) {
      fontScale = s.fontSize === 'large' ? 125 : s.fontSize === 'xlarge' ? 150 : 100;
    }

    let controlScale = s.controlScale ?? 100;
    if (s.controlScale === undefined && s.controlSize) {
      controlScale = s.controlSize === 'large' ? 125 : s.controlSize === 'xlarge' ? 150 : 100;
    }

    setValue('fontScale', String(fontScale));
    const fontBadge = this.$('fontScaleBadge');
    if (fontBadge) fontBadge.innerText = `${fontScale}%`;

    setValue('controlScale', String(controlScale));
    const ctrlBadge = this.$('controlScaleBadge');
    if (ctrlBadge) ctrlBadge.innerText = `${controlScale}%`;

    setChecked('reduceMotion', s.reduceMotion);
    setChecked('soundCues', s.soundCues);

    this.toggleElevenLabsSection(s.ttsProvider === 'elevenlabs');
    this.toggleWhisperSection(s.sttProvider === 'whisper');
  }

  private toggleElevenLabsSection(show: boolean): void {
    const area = this.$('elevenlabsConfigArea');
    if (area) {
      area.style.display = show ? 'block' : 'none';
    }
  }

  private toggleWhisperSection(show: boolean): void {
    const area = this.$('whisperConfigArea');
    if (area) {
      area.style.display = show ? 'block' : 'none';
    }
  }

  private updateLLMFeatureBanner(s: AiraSettings): void {
    const banner = this.$('llmFeatureStatusBanner');
    const desc = this.$('llmInfoDesc');
    if (!banner || !desc) return;

    if (!s.llmEnabled || !s.llmApiKey) {
      banner.className = 'llm-info-box is-fallback';
      desc.innerHTML = `
        <strong>⚠️ Mode Fallback Lokal (Tanpa API Key LLM) Aktif:</strong><br/>
        • <em>Berjalan Normal</em>: Form Wizard 1-per-1, validasi format lokal (NIK 16 digit, No HP, Tanggal), navigasi berbasis kata kunci, pembaca suara TTS, dan adaptasi kontras tinggi.<br/>
        • <em>Fitur yang Berjalan Terbatas Tanpa LLM</em>:
        <ul style="margin-left: 18px; margin-top: 4px;">
          <li><strong>Pemahaman Bahasa Santai</strong>: Navigasi suara hanya mengenali kata kunci tombol yang ada, bukan maksud kalimat bebas/tidak baku.</li>
          <li><strong>Penjelasan Istilah Birokrasi</strong>: Menggunakan kamus template standar untuk NIK/BPJS/Nama/Alamat, bukan penjelasan dinamis dari teks halaman.</li>
          <li><strong>Perangkuman Halaman</strong>: Menggunakan ringkasan statistik struktur (jumlah formulir dan tombol), bukan intisari pemahaman konteks mendalam.</li>
        </ul>
      `;
    } else {
      banner.className = 'llm-info-box is-active';
      desc.innerHTML = `
        <strong>✓ Mode AI Lengkap (${s.llmModel || 'cx/gpt-5.6-luna'} Aktif):</strong><br/>
        Seluruh penalaran semantik aktif penuh: pemahaman maksud suara santai, terjemahan istilah rumit secara dinamis, dan perangkuman halaman adaptif.
      `;
    }
  }

  private bindEvents(): void {
    this.setupPasswordToggle('toggleLlmKey', 'llmApiKey');
    this.setupPasswordToggle('toggleElevenKey', 'elevenlabsApiKey');
    this.setupPasswordToggle('toggleWhisperKey', 'whisperApiKey');

    const inputs = document.querySelectorAll('input, select');
    inputs.forEach((input) => {
      input.addEventListener('change', () => this.handleSave());
      if (input.tagName === 'INPUT' && (input as HTMLInputElement).type === 'text') {
        input.addEventListener('input', () => this.handleSaveDebounced());
      }
    });

    this.$('ttsProvider')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      this.toggleElevenLabsSection(val === 'elevenlabs');
    });

    this.$('sttProvider')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      this.toggleWhisperSection(val === 'whisper');
    });

    this.$('btnTestLlm')?.addEventListener('click', () => this.testLlmConnection());

    this.$('btnTestTts')?.addEventListener('click', () => {
      ttsService.speak('Halo! Ini adalah uji coba suara asisten AIRA dalam Bahasa Indonesia.');
    });

    // Font Scale & Control Scale Slider Listeners
    const fontScaleInput = this.$('fontScale') as HTMLInputElement | null;
    const fontBadge = this.$('fontScaleBadge');
    if (fontScaleInput) {
      fontScaleInput.addEventListener('input', () => {
        if (fontBadge) fontBadge.innerText = `${fontScaleInput.value}%`;
        this.handleSaveDebounced();
      });
    }

    const controlScaleInput = this.$('controlScale') as HTMLInputElement | null;
    const ctrlBadge = this.$('controlScaleBadge');
    if (controlScaleInput) {
      controlScaleInput.addEventListener('input', () => {
        if (ctrlBadge) ctrlBadge.innerText = `${controlScaleInput.value}%`;
        this.handleSaveDebounced();
      });
    }

    this.$('btnResetFont')?.addEventListener('click', () => {
      if (fontScaleInput) fontScaleInput.value = '100';
      if (fontBadge) fontBadge.innerText = '100%';
      this.handleSave();
    });

    this.$('btnResetControl')?.addEventListener('click', () => {
      if (controlScaleInput) controlScaleInput.value = '100';
      if (ctrlBadge) ctrlBadge.innerText = '100%';
      this.handleSave();
    });
  }

  private setupPasswordToggle(btnId: string, inputId: string): void {
    const btn = this.$(btnId);
    const input = this.$(inputId) as HTMLInputElement | null;
    if (btn && input) {
      btn.addEventListener('click', () => {
        if (input.type === 'password') {
          input.type = 'text';
          btn.innerText = '🔒';
        } else {
          input.type = 'password';
          btn.innerText = '👁️';
        }
      });
    }
  }

  private handleSaveDebounced(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = window.setTimeout(() => this.handleSave(), 400);
  }

  private async handleSave(): Promise<void> {
    const isChecked = (id: string): boolean => {
      const el = this.$(id) as HTMLInputElement | null;
      return el ? el.checked : false;
    };

    const getValue = (id: string): string => {
      const el = this.$(id) as HTMLInputElement | HTMLSelectElement | null;
      return el ? el.value.trim() : '';
    };

    const fontScaleNum = parseInt(getValue('fontScale'), 10) || 100;
    const controlScaleNum = parseInt(getValue('controlScale'), 10) || 100;

    const updated: Partial<AiraSettings> = {
      voiceOnlyMode: isChecked('voiceOnlyMode'),
      llmEnabled: isChecked('llmEnabled'),
      llmEndpoint: getValue('llmEndpoint') || 'https://9r.disra.net/v1/chat/completions',
      llmApiKey: getValue('llmApiKey'),
      llmModel: getValue('llmModel') || 'cx/gpt-5.6-luna',

      sttProvider: (getValue('sttProvider') as STTProvider) || 'whisper',
      whisperApiKey: getValue('whisperApiKey') || '9router',
      whisperEndpoint: getValue('whisperEndpoint') || 'https://9r.disra.net/v1/audio/transcriptions',

      ttsProvider: (getValue('ttsProvider') as TTSProvider) || 'elevenlabs',
      elevenlabsApiKey: getValue('elevenlabsApiKey'),
      elevenlabsVoiceId: getValue('elevenlabsVoiceId') || 'pNInz6obpgDQGcFmaJgB',

      highContrast: isChecked('highContrast'),
      fontScale: fontScaleNum,
      controlScale: controlScaleNum,
      fontSize: (fontScaleNum >= 140 ? 'xlarge' : fontScaleNum >= 120 ? 'large' : 'normal') as FontSizeOption,
      controlSize: (controlScaleNum >= 140 ? 'xlarge' : controlScaleNum >= 120 ? 'large' : 'default') as ControlSizeOption,
      reduceMotion: isChecked('reduceMotion'),
      soundCues: isChecked('soundCues')
    };

    const merged = await storageManager.saveSettings(updated);
    this.updateLLMFeatureBanner(merged);
    this.showSaveStatus();
  }

  private showSaveStatus(): void {
    const status = this.$('saveStatus');
    if (status) {
      status.innerText = '✓ Pengaturan tersimpan dan tersinkronisasi';
      status.style.opacity = '1';
      setTimeout(() => {
        status.style.opacity = '0.7';
      }, 2000);
    }
  }

  private async testLlmConnection(): Promise<void> {
    const btn = this.$('btnTestLlm') as HTMLButtonElement | null;
    const msg = this.$('llmStatusMessage');
    if (!btn || !msg) return;

    const endpoint = (this.$('llmEndpoint') as HTMLInputElement).value.trim() || 'https://9r.disra.net/v1/chat/completions';
    const apiKey = (this.$('llmApiKey') as HTMLInputElement).value.trim();
    const model = (this.$('llmModel') as HTMLInputElement).value.trim() || 'cx/gpt-5.6-luna';

    if (!apiKey) {
      msg.className = 'status-msg status-error';
      msg.style.display = 'block';
      msg.innerText = 'Harap isi LLM API Key terlebih dahulu untuk menguji koneksi.';
      return;
    }

    btn.disabled = true;
    btn.innerText = '⏳ Menguji ke ' + model + '...';
    msg.style.display = 'none';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: 'Halo, jelaskan AIRA dalam satu kalimat singkat Bahasa Indonesia.'
            }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || 'Koneksi sukses!';

      msg.className = 'status-msg status-success';
      msg.style.display = 'block';
      msg.innerText = `✓ Terhubung Sukses! Respon: "${reply}"`;
    } catch (err: unknown) {
      const errorStr = err instanceof Error ? err.message : String(err);
      msg.className = 'status-msg status-error';
      msg.style.display = 'block';
      msg.innerText = `✗ Gagal terhubung: ${errorStr}`;
    } finally {
      btn.disabled = false;
      btn.innerText = '⚡ Uji Koneksi LLM';
    }
  }
}

const popup = new PopupController();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => popup.init());
} else {
  popup.init();
}

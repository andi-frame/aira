/**
 * AIRA - In-Page Settings Panel View (TypeScript)
 * 100% synchronized with the Navbar Extension Popup via StorageManager
 */

import { storageManager } from '../shared/storage';
import { AiraSettings, FontSizeOption, ControlSizeOption, TTSProvider, STTProvider } from '../types/index';
import { ttsService } from '../services/tts_service';
import { soundEffects } from '../shared/sound_effects';

export class SettingsPanelComponent {
  private container: HTMLElement | null = null;
  private settings: AiraSettings | null = null;

  public async init(container: HTMLElement): Promise<void> {
    this.container = container;
    this.settings = await storageManager.getSettings();

    // Subscribe to external updates from popup
    storageManager.subscribe((newSettings) => {
      this.settings = newSettings;
      this.updateViewValues(newSettings);
    });
  }

  public render(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'aira-settings-view';
    wrap.style.cssText = 'padding: 16px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto;';

    const s = this.settings!;

    wrap.innerHTML = `
      <div style="font-size: 1.1em; font-weight: 800; color: var(--aira-primary);">
        ⚙️ Pengaturan Asistensi AIRA
      </div>

      <!-- Mode Suara Penuh (Voice Only) -->
      <div style="background: var(--aira-accent-soft); border: 1px solid var(--aira-border); padding: 12px; border-radius: var(--aira-radius-md); display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-weight: 700;">🎙️ Mode Suara Penuh (Voice Only)</div>
          <div style="font-size: 0.8em; color: var(--aira-text-muted);">Kontrol seluruh web hanya lewat suara tanpa mouse (Alt+A)</div>
        </div>
        <input type="checkbox" id="aira-set-voiceonly" style="width: 20px; height: 20px;" ${s.voiceOnlyMode ? 'checked' : ''} />
      </div>

      <!-- STT Provider (Item 5) -->
      <div style="border: 1px solid var(--aira-border); padding: 14px; border-radius: var(--aira-radius-md); display: flex; flex-direction: column; gap: 10px;">
        <div style="font-weight: 700; color: var(--aira-primary);">🎙️ Pengenalan Suara (STT)</div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size: 0.8em; font-weight: 600;">Penyedia Pengenalan Suara:</label>
          <select id="aira-set-sttprovider" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;">
            <option value="webspeech" ${s.sttProvider === 'webspeech' ? 'selected' : ''}>Google Web Speech API Chrome (Default Cepat)</option>
            <option value="whisper" ${s.sttProvider === 'whisper' ? 'selected' : ''}>OpenAI Whisper API</option>
          </select>
        </div>

        <div id="aira-whisper-fields" style="display: ${s.sttProvider === 'whisper' ? 'flex' : 'none'}; flex-direction: column; gap: 8px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.8em; font-weight: 600;">Whisper API Key:</label>
            <input type="password" id="aira-set-whisperkey" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.whisperApiKey || ''}" placeholder="sk-..." />
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.8em; font-weight: 600;">Whisper Endpoint:</label>
            <input type="text" id="aira-set-whisperendpoint" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.whisperEndpoint || 'https://api.openai.com/v1/audio/transcriptions'}" />
          </div>
        </div>
      </div>

      <!-- Aksesibilitas WCAG (Berlaku pada halaman web) -->
      <div style="border: 1px solid var(--aira-border); padding: 14px; border-radius: var(--aira-radius-md); display: flex; flex-direction: column; gap: 12px;">
        <div style="font-weight: 700; color: var(--aira-primary);">👓 Aksesibilitas Halaman Web (WCAG)</div>

        <!-- High Contrast -->
        <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
          <div>
            <div style="font-weight: 600;">Mode Kontras Tinggi (WCAG AAA)</div>
            <div style="font-size: 0.78em; color: var(--aira-text-muted);">Ubah website menjadi hitam pekat & teks kuning kontras 19.5:1</div>
          </div>
          <input type="checkbox" id="aira-set-contrast" style="width: 20px; height: 20px;" ${s.highContrast ? 'checked' : ''} />
        </label>

        <!-- Font Size -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="font-weight: 600; font-size: 0.9em;">Ukuran Teks Halaman Web:</div>
          <select id="aira-set-fontsize" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.9em;">
            <option value="normal" ${s.fontSize === 'normal' ? 'selected' : ''}>Normal (100%)</option>
            <option value="large" ${s.fontSize === 'large' ? 'selected' : ''}>Lansia / Besar (125%)</option>
            <option value="xlarge" ${s.fontSize === 'xlarge' ? 'selected' : ''}>Ekstra Besar (150%)</option>
          </select>
        </div>

        <!-- Control Size -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="font-weight: 600; font-size: 0.9em;">Ukuran Tombol & Input Web:</div>
          <select id="aira-set-ctrlsize" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.9em;">
            <option value="default" ${s.controlSize === 'default' ? 'selected' : ''}>Standar (44px)</option>
            <option value="large" ${s.controlSize === 'large' ? 'selected' : ''}>Lansia (52px)</option>
            <option value="xlarge" ${s.controlSize === 'xlarge' ? 'selected' : ''}>Ramah Motorik (64px)</option>
          </select>
        </div>

        <!-- Reduce Motion -->
        <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
          <div>
            <div style="font-weight: 600;">Sensory Shield (Redam Animasi)</div>
            <div style="font-size: 0.78em; color: var(--aira-text-muted);">Meredam kedipan dan animasi pada website</div>
          </div>
          <input type="checkbox" id="aira-set-motion" style="width: 20px; height: 20px;" ${s.reduceMotion ? 'checked' : ''} />
        </label>
      </div>

      <!-- Konfigurasi LLM -->
      <div style="border: 1px solid var(--aira-border); padding: 14px; border-radius: var(--aira-radius-md); display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-weight: 700; color: var(--aira-primary);">🤖 Model AI (LLM)</div>
          <input type="checkbox" id="aira-set-llmenabled" style="width: 18px; height: 18px;" ${s.llmEnabled ? 'checked' : ''} title="Aktifkan LLM" />
        </div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size: 0.8em; font-weight: 600;">Endpoint / Base URL:</label>
          <input type="text" id="aira-set-endpoint" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.llmEndpoint || ''}" placeholder="https://9r.disra.net/v1/chat/completions" />
        </div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size: 0.8em; font-weight: 600;">API Key LLM:</label>
          <input type="password" id="aira-set-apikey" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.llmApiKey || ''}" placeholder="sk-..." />
        </div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size: 0.8em; font-weight: 600;">Model Name:</label>
          <input type="text" id="aira-set-model" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.llmModel || 'cx/gpt-5.6-luna'}" placeholder="cx/gpt-5.6-luna" />
        </div>
      </div>

      <!-- Konfigurasi Suara (TTS) -->
      <div style="border: 1px solid var(--aira-border); padding: 14px; border-radius: var(--aira-radius-md); display: flex; flex-direction: column; gap: 10px;">
        <div style="font-weight: 700; color: var(--aira-primary);">🔊 Suara Pembaca (TTS)</div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size: 0.8em; font-weight: 600;">Penyedia Suara:</label>
          <select id="aira-set-ttsprovider" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;">
            <option value="elevenlabs" ${s.ttsProvider === 'elevenlabs' ? 'selected' : ''}>ElevenLabs (Utama - Alami)</option>
            <option value="google" ${s.ttsProvider === 'google' ? 'selected' : ''}>Google TTS Indonesia (Default Fallback)</option>
            <option value="microsoft" ${s.ttsProvider === 'microsoft' ? 'selected' : ''}>Microsoft TTS Indonesia</option>
          </select>
        </div>

        <div id="aira-elevenlabs-fields" style="display: ${s.ttsProvider === 'elevenlabs' ? 'flex' : 'none'}; flex-direction: column; gap: 8px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.8em; font-weight: 600;">ElevenLabs API Key:</label>
            <input type="password" id="aira-set-elevenkey" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.elevenlabsApiKey || ''}" placeholder="xi-..." />
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.8em; font-weight: 600;">Voice ID:</label>
            <input type="text" id="aira-set-elevenvoice" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.elevenlabsVoiceId || 'pNInz6obpgDQGcFmaJgB'}" />
          </div>
        </div>

        <button type="button" class="aira-btn aira-btn-outline" id="aira-btn-test-tts" style="min-height: 38px; font-size: 0.85em;">
          🔊 Uji Coba Suara
        </button>
      </div>
    `;

    this.bindEvents(wrap);
    return wrap;
  }

  private bindEvents(wrap: HTMLElement): void {
    const save = async () => {
      const voiceOnly = (wrap.querySelector('#aira-set-voiceonly') as HTMLInputElement).checked;
      const contrast = (wrap.querySelector('#aira-set-contrast') as HTMLInputElement).checked;
      const fontSize = (wrap.querySelector('#aira-set-fontsize') as HTMLSelectElement).value as FontSizeOption;
      const controlSize = (wrap.querySelector('#aira-set-ctrlsize') as HTMLSelectElement).value as ControlSizeOption;
      const reduceMotion = (wrap.querySelector('#aira-set-motion') as HTMLInputElement).checked;

      const sttProvider = (wrap.querySelector('#aira-set-sttprovider') as HTMLSelectElement).value as STTProvider;
      const whisperKey = (wrap.querySelector('#aira-set-whisperkey') as HTMLInputElement)?.value.trim() || '';
      const whisperEndpoint = (wrap.querySelector('#aira-set-whisperendpoint') as HTMLInputElement)?.value.trim() || '';

      const llmEnabled = (wrap.querySelector('#aira-set-llmenabled') as HTMLInputElement).checked;
      const endpoint = (wrap.querySelector('#aira-set-endpoint') as HTMLInputElement).value.trim();
      const apiKey = (wrap.querySelector('#aira-set-apikey') as HTMLInputElement).value.trim();
      const model = (wrap.querySelector('#aira-set-model') as HTMLInputElement).value.trim();

      const ttsProvider = (wrap.querySelector('#aira-set-ttsprovider') as HTMLSelectElement).value as TTSProvider;
      const elevenKey = (wrap.querySelector('#aira-set-elevenkey') as HTMLInputElement)?.value.trim() || '';
      const elevenVoice = (wrap.querySelector('#aira-set-elevenvoice') as HTMLInputElement)?.value.trim() || '';

      await storageManager.saveSettings({
        voiceOnlyMode: voiceOnly,
        highContrast: contrast,
        fontSize,
        controlSize,
        reduceMotion,
        sttProvider,
        whisperApiKey: whisperKey,
        whisperEndpoint: whisperEndpoint,
        llmEnabled,
        llmEndpoint: endpoint,
        llmApiKey: apiKey,
        llmModel: model,
        ttsProvider,
        elevenlabsApiKey: elevenKey,
        elevenlabsVoiceId: elevenVoice
      });

      soundEffects.playStep();
    };

    wrap.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('change', () => {
        const providerSel = wrap.querySelector('#aira-set-ttsprovider') as HTMLSelectElement;
        const elevenFields = wrap.querySelector('#aira-elevenlabs-fields') as HTMLElement;
        if (elevenFields) {
          elevenFields.style.display = providerSel.value === 'elevenlabs' ? 'flex' : 'none';
        }

        const sttSel = wrap.querySelector('#aira-set-sttprovider') as HTMLSelectElement;
        const whisperFields = wrap.querySelector('#aira-whisper-fields') as HTMLElement;
        if (whisperFields) {
          whisperFields.style.display = sttSel.value === 'whisper' ? 'flex' : 'none';
        }

        save();
      });
    });

    wrap.querySelector('#aira-btn-test-tts')?.addEventListener('click', () => {
      ttsService.speak('Halo! Ini adalah contoh suara asisten AIRA dalam Bahasa Indonesia.');
    });
  }

  private updateViewValues(s: AiraSettings): void {
    if (!this.container) return;
    const q = (sel: string) => this.container!.querySelector(sel);

    const voiceOnly = q('#aira-set-voiceonly') as HTMLInputElement | null;
    if (voiceOnly) voiceOnly.checked = s.voiceOnlyMode;

    const contrast = q('#aira-set-contrast') as HTMLInputElement | null;
    if (contrast) contrast.checked = s.highContrast;

    const font = q('#aira-set-fontsize') as HTMLSelectElement | null;
    if (font) font.value = s.fontSize;

    const ctrl = q('#aira-set-ctrlsize') as HTMLSelectElement | null;
    if (ctrl) ctrl.value = s.controlSize;

    const motion = q('#aira-set-motion') as HTMLInputElement | null;
    if (motion) motion.checked = s.reduceMotion;

    const stt = q('#aira-set-sttprovider') as HTMLSelectElement | null;
    if (stt) stt.value = s.sttProvider;

    const whKey = q('#aira-set-whisperkey') as HTMLInputElement | null;
    if (whKey) whKey.value = s.whisperApiKey;

    const whEnd = q('#aira-set-whisperendpoint') as HTMLInputElement | null;
    if (whEnd) whEnd.value = s.whisperEndpoint;

    const whisperFields = q('#aira-whisper-fields') as HTMLElement | null;
    if (whisperFields && stt) {
      whisperFields.style.display = stt.value === 'whisper' ? 'flex' : 'none';
    }

    const llmEnabled = q('#aira-set-llmenabled') as HTMLInputElement | null;
    if (llmEnabled) llmEnabled.checked = s.llmEnabled;

    const endpoint = q('#aira-set-endpoint') as HTMLInputElement | null;
    if (endpoint) endpoint.value = s.llmEndpoint;

    const key = q('#aira-set-apikey') as HTMLInputElement | null;
    if (key) key.value = s.llmApiKey;

    const model = q('#aira-set-model') as HTMLInputElement | null;
    if (model) model.value = s.llmModel;

    const prov = q('#aira-set-ttsprovider') as HTMLSelectElement | null;
    if (prov) prov.value = s.ttsProvider;

    const elvKey = q('#aira-set-elevenkey') as HTMLInputElement | null;
    if (elvKey) elvKey.value = s.elevenlabsApiKey;

    const elvVoice = q('#aira-set-elevenvoice') as HTMLInputElement | null;
    if (elvVoice) elvVoice.value = s.elevenlabsVoiceId;

    const elevenFields = q('#aira-elevenlabs-fields') as HTMLElement | null;
    if (elevenFields && prov) {
      elevenFields.style.display = prov.value === 'elevenlabs' ? 'flex' : 'none';
    }
  }
}

export const settingsPanel = new SettingsPanelComponent();

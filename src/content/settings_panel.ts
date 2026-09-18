/**
 * AIRA - Settings Panel View (TypeScript)
 * Advanced settings panel matching IFEST-DESIGN design system.
 * Contains:
 * - Accessible Keyboard Shortcuts
 * - Speech-to-Text (STT) Provider configuration
 * - LLM / AI Model parameters
 * - Text-to-Speech (TTS) Voice options & test speech
 */

import { storageManager } from '../shared/storage';
import { AiraSettings, TTSProvider, STTProvider } from '../types/index';
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
    wrap.style.cssText = 'padding: 20px 18px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto;';

    const s = this.settings!;

    wrap.innerHTML = `
      <div style="margin-bottom: 6px;">
        <h3 style="font-size: 18px; font-weight: 600; color: #1A1D20; margin: 0 0 4px 0; display: flex; align-items: center; gap: 8px;">
          <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 22px;">tune</span>
          <span>Pengaturan Layanan <span class="brand-aira"><em>A</em>IRA</span></span>
        </h3>
        <p style="font-size: 13px; color: #545454; margin: 0;">Konfigurasi suara, model kecerdasan buatan, dan pintasan sistem.</p>
      </div>

      <!-- CARD 1: Pintasan Keyboard Aksesibel -->
      <div class="aira-settings-card">
        <div style="font-size: 14.5px; font-weight: 600; color: #000000; display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
          <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 19px;">keyboard</span>
          <span>Pintasan Keyboard Aksesibel</span>
        </div>

        <div class="aira-kbd-item">
          <div>
            <div style="font-weight: 600; font-size: 13.5px; color: #2D3238;">Push to Talk (Bicara Cepat)</div>
            <div style="font-size: 12px; color: #6C757D;">Tahan untuk merekam suara, lepaskan untuk mengirim</div>
          </div>
          <span class="aira-keycap">Alt + S</span>
        </div>

        <div class="aira-kbd-item">
          <div>
            <div style="font-weight: 600; font-size: 13.5px; color: #2D3238;">Buka / Tutup Sidebar</div>
            <div style="font-size: 12px; color: #6C757D;">Toggle cepat tampilan sidebar asistensi AIRA</div>
          </div>
          <span class="aira-keycap">Alt + A</span>
        </div>

        <div class="aira-kbd-item" style="margin-bottom: 0;">
          <div>
            <div style="font-weight: 600; font-size: 13.5px; color: #2D3238;">Tutup Modal & Spotlight</div>
            <div style="font-size: 12px; color: #6C757D;">Batalkan fokus navigasi atau wizard formulir</div>
          </div>
          <span class="aira-keycap">Esc</span>
        </div>
      </div>

      <!-- CARD 2: Pengenalan Suara (STT) -->
      <div class="aira-settings-card">
        <div style="font-size: 14.5px; font-weight: 600; color: #000000; display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 19px;">mic</span>
          <span>Pengenalan Suara (Speech-to-Text)</span>
        </div>

        <div class="aira-form-group">
          <label class="aira-form-label" for="aira-set-sttprovider">Penyedia Pengenalan Suara:</label>
          <select id="aira-set-sttprovider" class="aira-form-control">
            <option value="whisper" ${!s.sttProvider || s.sttProvider === 'whisper' ? 'selected' : ''}>9Router Whisper STT (Akurat & Cepat)</option>
            <option value="webspeech" ${s.sttProvider === 'webspeech' ? 'selected' : ''}>Google Web Speech API Chrome (Fallback Offline)</option>
          </select>
        </div>

        <div id="aira-whisper-fields" style="display: ${s.sttProvider === 'whisper' ? 'flex' : 'none'}; flex-direction: column; gap: 8px;">
          <div class="aira-form-group">
            <label class="aira-form-label" for="aira-set-whisperkey">Whisper API Key:</label>
            <input type="password" id="aira-set-whisperkey" class="aira-form-control" value="${s.whisperApiKey || '9router'}" placeholder="9router" />
          </div>
          <div class="aira-form-group" style="margin-bottom: 0;">
            <label class="aira-form-label" for="aira-set-whisperendpoint">Whisper Endpoint:</label>
            <input type="text" id="aira-set-whisperendpoint" class="aira-form-control" value="${s.whisperEndpoint || 'https://9r.disra.net/v1/audio/transcriptions'}" />
          </div>
        </div>
      </div>

      <!-- CARD 3: Model AI (LLM) -->
      <div class="aira-settings-card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <div style="font-size: 14.5px; font-weight: 600; color: #000000; display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 19px;">smart_toy</span>
            <span>Model Kecerdasan Buatan (LLM)</span>
          </div>
          <div class="aira-switch" title="Aktifkan LLM">
            <input type="checkbox" id="aira-set-llmenabled" ${s.llmEnabled ? 'checked' : ''} />
            <span class="aira-switch-slider"></span>
          </div>
        </div>

        <div class="aira-form-group">
          <label class="aira-form-label" for="aira-set-endpoint">Base URL / Endpoint:</label>
          <input type="text" id="aira-set-endpoint" class="aira-form-control" value="${s.llmEndpoint || ''}" placeholder="https://9r.disra.net/v1/chat/completions" />
        </div>

        <div class="aira-form-group">
          <label class="aira-form-label" for="aira-set-apikey">API Key LLM:</label>
          <input type="password" id="aira-set-apikey" class="aira-form-control" value="${s.llmApiKey || ''}" placeholder="sk-..." />
        </div>

        <div class="aira-form-group" style="margin-bottom: 0;">
          <label class="aira-form-label" for="aira-set-model">Nama Model:</label>
          <input type="text" id="aira-set-model" class="aira-form-control" value="${s.llmModel || 'cx/gpt-5.6-luna'}" placeholder="cx/gpt-5.6-luna" />
        </div>
      </div>

      <!-- CARD 4: Suara Pembaca (TTS) -->
      <div class="aira-settings-card">
        <div style="font-size: 14.5px; font-weight: 600; color: #000000; display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 19px;">volume_up</span>
          <span>Suara Pembaca Teks (TTS)</span>
        </div>

        <div class="aira-form-group">
          <label class="aira-form-label" for="aira-set-ttsprovider">Penyedia Suara:</label>
          <select id="aira-set-ttsprovider" class="aira-form-control">
            <option value="elevenlabs" ${s.ttsProvider === 'elevenlabs' ? 'selected' : ''}>ElevenLabs (Sangat Natural & Ramah)</option>
            <option value="google" ${s.ttsProvider === 'google' ? 'selected' : ''}>Google TTS Indonesia (Cepat & Ringan)</option>
            <option value="microsoft" ${s.ttsProvider === 'microsoft' ? 'selected' : ''}>Microsoft TTS Indonesia</option>
          </select>
        </div>

        <div id="aira-elevenlabs-fields" style="display: ${s.ttsProvider === 'elevenlabs' ? 'flex' : 'none'}; flex-direction: column; gap: 8px;">
          <div class="aira-form-group">
            <label class="aira-form-label" for="aira-set-elevenkey">ElevenLabs API Key:</label>
            <input type="password" id="aira-set-elevenkey" class="aira-form-control" value="${s.elevenlabsApiKey || ''}" placeholder="xi-..." />
          </div>
          <div class="aira-form-group">
            <label class="aira-form-label" for="aira-set-elevenvoice">Voice ID:</label>
            <input type="text" id="aira-set-elevenvoice" class="aira-form-control" value="${s.elevenlabsVoiceId || 'pNInz6obpgDQGcFmaJgB'}" />
          </div>
        </div>

        <button type="button" class="aira-btn aira-btn-outline" id="aira-btn-test-tts" style="width: 100%; min-height: 44px; margin-top: 6px; font-size: 14px;">
          <span class="material-symbols-rounded" style="font-size: 18px;">volume_up</span>
          <span>Uji Coba Suara Asisten</span>
        </button>
      </div>
    `;

    this.bindEvents(wrap);
    return wrap;
  }

  private bindEvents(wrap: HTMLElement): void {
    const save = async () => {
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

    const stt = q('#aira-set-sttprovider') as HTMLSelectElement | null;
    if (stt) stt.value = s.sttProvider || 'whisper';

    const whKey = q('#aira-set-whisperkey') as HTMLInputElement | null;
    if (whKey) whKey.value = s.whisperApiKey || '9router';

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

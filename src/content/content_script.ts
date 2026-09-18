/**
 * AIRA - Main Content Script Orchestrator (TypeScript)
 * Injects isolated Shadow DOM, applies accessibility directly to host webpage, and manages Voice-Only loop.
 */

import { storageManager } from '../shared/storage';
import { soundEffects } from '../shared/sound_effects';
import { domPruner } from '../services/dom_pruner';
import { llmService } from '../services/llm_service';
import { ttsService } from '../services/tts_service';
import { sttService } from '../services/stt_service';
import { formOrchestrator } from '../services/form_orchestrator';
import { hostAccessibilityEngine } from '../services/host_accessibility';
import { chatPanel } from './chat_panel';
import { formWizard } from './form_wizard';
import { spotlightManager } from './spotlight';
import { AiraSettings } from '../types/index';

class AiraContentCoordinator {
  private shadowHost: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private srAnnouncer: HTMLElement | null = null;
  private currentSettings: AiraSettings | null = null;
  private isPttActive: boolean = false;
  private pttStartTime: number = 0;
  private pttToastEl: HTMLElement | null = null;
  private isVoiceConfirmationPending: boolean = false;
  private pendingVoiceTranscript: string = '';
  private pendingVoiceTarget: 'chat' | 'form' = 'chat';
  private confirmCardEl: HTMLElement | null = null;

  public async init(): Promise<void> {
    if (document.getElementById('aira-root')) return;

    this.currentSettings = await storageManager.getSettings();

    const target = document.body || document.documentElement;
    if (!target) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init(), { once: true });
      }
      return;
    }

    // 1. Create Shadow Host
    this.shadowHost = document.createElement('div');
    this.shadowHost.id = 'aira-root';
    this.shadowRoot = this.shadowHost.attachShadow({ mode: 'open' });
    target.appendChild(this.shadowHost);

    // 2. Load Stylesheet into Shadow Root
    await this.injectStyles();

    // 3. Screen Reader Announcer
    this.srAnnouncer = document.createElement('div');
    this.srAnnouncer.className = 'aira-sr-only';
    this.srAnnouncer.setAttribute('aria-live', 'assertive');
    this.shadowRoot.appendChild(this.srAnnouncer);

    // 4. Initialize UI Subcomponents inside Shadow Root
    this.createFloatingTrigger();
    spotlightManager.init(this.shadowRoot as unknown as HTMLElement);

    chatPanel.init(
      this.shadowRoot as unknown as HTMLElement,
      (userText) => this.handleUserMessage(userText),
      () => this.toggleVoiceOnlyMode(),
      () => this.toggleVoiceInput()
    );

    formWizard.init(
      this.shadowRoot as unknown as HTMLElement,
      (prompt, answer) => {
        // Record all wizard questions & answers into chat log (Point 9)
        chatPanel.addMessage('assistant', prompt, false);
        if (answer) {
          chatPanel.addMessage('user', answer, false);
        }
      },
      (isListening, interim) => {
        chatPanel.setListeningState(isListening, interim);
        if (isListening) {
          if (interim && interim !== 'Mendengarkan isian formulir...') {
            this.showPttToast(interim, true);
          } else {
            this.showPttToast('Mendengarkan isian formulir...', false);
          }
        } else {
          this.hidePttToast();
        }
      },
      (finalText) => {
        this.enterVoiceConfirmation(finalText, 'form');
      }
    );

    // 5. Apply Accessibility Settings to both Host Page and AIRA UI
    this.applySettingsToUI(this.currentSettings);

    // 6. Subscribe to settings updates
    storageManager.subscribe((newSettings) => {
      this.currentSettings = newSettings;
      this.applySettingsToUI(newSettings);
    });

    // 7. Global Keyboard Shortcuts:
    // - Alt + A: Toggle Voice Assistant (buka/tutup mode suara)
    // - Alt + S: Push-to-Talk (Tahan Alt+S untuk bicara, lepaskan untuk konfirmasi)
    // - Enter: Konfirmasi kirim pesan suara jika konfirmasi aktif
    // - Escape: Batalkan pesan suara jika konfirmasi aktif
    window.addEventListener('keydown', (e) => {
      // Intercept Enter and Escape ONLY when voice confirmation gate is active
      if (this.isVoiceConfirmationPending) {
        if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          e.stopPropagation();
          this.confirmVoiceInput();
          return;
        }
        if (e.key === 'Escape' || e.code === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.cancelVoiceInput();
          return;
        }
      }

      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleVoiceAssistantShortcut();
      } else if (e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat && !this.isPttActive) {
          if (this.isVoiceConfirmationPending) {
            this.cancelVoiceInput(true);
          }
          this.startPushToTalk();
        }
      }
    }, true);

    window.addEventListener('keyup', (e) => {
      if (this.isPttActive) {
        if (e.key === 's' || e.key === 'S' || e.code === 'KeyS' || e.key === 'Alt' || !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          this.stopPushToTalk();
        }
      }
    }, true);

    window.addEventListener('blur', () => {
      if (this.isPttActive) {
        this.stopPushToTalk();
      }
    });

    // 8. Listen for message triggers from service worker
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.action === 'TOGGLE_VOICE_SHORTCUT') {
          this.toggleVoiceAssistantShortcut();
          sendResponse?.({ status: 'ok' });
        }
        return false;
      });
    }

    // 9. Auto-continuous voice loop for Voice-Only Mode (only when form wizard and confirmation are not active)
    ttsService.onEnd(() => {
      if (this.currentSettings?.voiceOnlyMode && !formWizard.isOpen() && !this.isVoiceConfirmationPending) {
        this.listenInVoiceOnlyMode();
      }
    });
  }

  private async injectStyles(): Promise<void> {
    if (!this.shadowRoot) return;

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        const styleEl = document.createElement('link');
        styleEl.rel = 'stylesheet';
        styleEl.href = chrome.runtime.getURL('content/content_style.css');
        this.shadowRoot.appendChild(styleEl);
      }
    } catch (e) {
      console.warn('[AIRA] Stylesheet URL retrieval error:', e);
    }

    const inlineStyle = document.createElement('style');
    inlineStyle.textContent = `
      :host { position: relative; z-index: 2147483640; }
    `;
    this.shadowRoot.appendChild(inlineStyle);
  }

  private createFloatingTrigger(): void {
    if (!this.shadowRoot) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aira-trigger-btn';
    btn.setAttribute('aria-label', 'Buka Asisten AIRA (Tekan Alt+A atau tahan Alt+S untuk bicara)');
    btn.title = 'Buka Asisten AIRA (Alt+A) | Push to Talk (Alt+S)';

    btn.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
      <span>AIRA</span>
      <span class="aira-trigger-voice-badge" id="aira-badge-voice" style="display: none;">Suara</span>
    `;

    btn.addEventListener('click', () => {
      chatPanel.toggle();
    });

    this.shadowRoot.appendChild(btn);
  }

  private applySettingsToUI(s: AiraSettings | null): void {
    if (!this.shadowHost || !s) return;

    soundEffects.setEnabled(s.soundCues);

    // Apply scoped attributes to Shadow DOM UI
    this.shadowHost.setAttribute('data-font-size', s.fontSize);
    this.shadowHost.setAttribute('data-control-size', s.controlSize);
    this.shadowHost.setAttribute('data-high-contrast', String(s.highContrast));
    this.shadowHost.setAttribute('data-reduce-motion', String(s.reduceMotion));

    chatPanel.updateVoiceOnlyBadge(s.voiceOnlyMode);

    const voiceBadge = this.shadowRoot?.querySelector('#aira-badge-voice') as HTMLElement | null;
    if (voiceBadge) {
      voiceBadge.style.display = s.voiceOnlyMode ? 'inline-flex' : 'none';
    }

    // Apply Accessibility Directly to Host Web Page Content (Item 1)
    hostAccessibilityEngine.apply(s);
  }

  public announceScreenReader(message: string): void {
    if (this.srAnnouncer) {
      this.srAnnouncer.textContent = '';
      setTimeout(() => {
        if (this.srAnnouncer) this.srAnnouncer.textContent = message;
      }, 50);
    }
  }

  public async toggleVoiceOnlyMode(): Promise<void> {
    if (!this.currentSettings) return;
    const next = !this.currentSettings.voiceOnlyMode;
    await storageManager.saveSettings({ voiceOnlyMode: next });

    const msg = next
      ? 'Mode Suara Penuh (Voice Only) telah diaktifkan. Anda dapat berinteraksi sepenuhnya dengan suara tanpa mouse.'
      : 'Mode Suara Penuh dinonaktifkan.';

    this.announceScreenReader(msg);
    chatPanel.addMessage('system', msg, true);
    soundEffects.playStep();
  }

  public toggleVoiceAssistantShortcut(): void {
    soundEffects.playStep();
    if (!chatPanel.isOpen()) {
      chatPanel.toggle(true);
    }
    this.toggleVoiceInput();
  }

  public async toggleVoiceInput(): Promise<void> {
    if (this.isPttActive || sttService.isListening() || formWizard.isVoiceActive()) {
      this.stopPushToTalk();
    } else {
      await this.startPushToTalk(false);
    }
  }

  public stopListeningAll(): void {
    if (this.isVoiceConfirmationPending) {
      this.cancelVoiceInput(true);
    }
    this.isPttActive = false;
    this.hidePttToast();
    chatPanel.setListeningState(false);
    if (formWizard.isOpen()) {
      formWizard.stopVoiceInput();
    }
    if (sttService.isListening()) {
      sttService.stopListening();
    }
  }

  private showPttToast(text: string, isLiveText: boolean = false): void {
    if (!this.shadowRoot) return;
    if (!this.pttToastEl) {
      this.pttToastEl = document.createElement('div');
      this.pttToastEl.className = 'aira-ptt-badge';
      this.shadowRoot.appendChild(this.pttToastEl);
    }

    const htmlContent = isLiveText
      ? `<span>Mendengar:</span> <strong style="color: #60A5FA; margin-left: 6px;">"${text}"</strong>`
      : `<span>${text}</span>`;

    this.pttToastEl.innerHTML = `
      <div class="aira-ptt-dot"></div>
      <div class="aira-ptt-content">${htmlContent}</div>
    `;
    this.pttToastEl.style.display = 'flex';
  }

  private hidePttToast(): void {
    if (this.pttToastEl) {
      this.pttToastEl.style.display = 'none';
    }
  }

  public async startPushToTalk(isPureHold: boolean = true): Promise<void> {
    if (this.isPttActive || sttService.isListening() || formWizard.isVoiceActive()) return;
    this.isPttActive = true;
    this.pttStartTime = Date.now();

    // Hentikan suara pembaca jika sedang berbicara
    ttsService.stop();

    // Jika Form Wizard sedang aktif, alihkan suara ke kolom pertanyaan aktif
    if (formWizard.isOpen()) {
      this.showPttToast(isPureHold ? 'Mendengarkan isian formulir (Lepaskan Alt+S untuk mengirim)...' : 'Mendengarkan isian formulir...', false);
      this.announceScreenReader('Mendengarkan isian formulir. Silakan bicara.');
      chatPanel.setListeningState(true, 'Mendengarkan isian formulir...');
      await formWizard.startVoiceInput();
      return;
    }

    // Konteks umum: Pastikan chat panel terbuka
    if (!chatPanel.isOpen()) {
      chatPanel.toggle(true);
    }

    this.showPttToast(isPureHold ? 'Mendengarkan ucapan... (Lepaskan Alt+S untuk mengirim)' : 'Mendengarkan ucapan Anda...', false);
    this.announceScreenReader('Mendengarkan ucapan Anda. Silakan bicara.');
    chatPanel.setListeningState(true, 'Mendengarkan ucapan Anda...');

    await sttService.startListening({
      manualStopOnly: true,
      onInterim: (text) => {
        chatPanel.setListeningState(true, text);
        this.showPttToast(text, true);
      },
      onFinal: (finalText) => {
        this.hidePttToast();
        chatPanel.setListeningState(false);
        this.isPttActive = false;
        if (finalText && finalText.trim()) {
          this.enterVoiceConfirmation(finalText.trim(), 'chat');
        }
      },
      onError: (err) => {
        this.hidePttToast();
        chatPanel.setListeningState(false);
        this.isPttActive = false;
        console.warn('[AIRA PTT] Listening error:', err);
      }
    });
  }

  public stopPushToTalk(): void {
    if (!this.isPttActive) return;
    this.isPttActive = false;
    this.hidePttToast();

    // Matikan status mikrofon di Chat Panel seketika
    chatPanel.setListeningState(false);

    // Hentikan STT (akan mendispatch transcript jika ada)
    sttService.stopListening();

    // Jika Form Wizard sedang aktif
    if (formWizard.isOpen()) {
      formWizard.stopVoiceInput();
    }
  }

  private async listenInVoiceOnlyMode(): Promise<void> {
    if (sttService.isListening() || formWizard.isOpen()) return;

    chatPanel.setListeningState(true, 'Mode suara penuh: Mendengarkan perintah...');

    await sttService.startListening({
      manualStopOnly: false,
      onInterim: (text) => {
        chatPanel.setListeningState(true, text);
      },
      onFinal: (finalText) => {
        chatPanel.setListeningState(false);
        if (finalText && finalText.trim()) {
          this.enterVoiceConfirmation(finalText.trim(), 'chat');
        }
      },
      onError: (err) => {
        chatPanel.setListeningState(false);
        console.warn('[AIRA Voice] Listening error:', err);
      }
    });
  }

  /**
   * Enter Voice Confirmation Phase:
   * 1. Displays confirmation card
   * 2. Echoes back the transcribed voice via TTS and Screen Reader
   * 3. Awaits Enter (Confirm) or Escape (Cancel)
   */
  public enterVoiceConfirmation(transcript: string, target: 'chat' | 'form' = 'chat'): void {
    if (!transcript || !transcript.trim()) return;

    this.isVoiceConfirmationPending = true;
    this.pendingVoiceTranscript = transcript.trim();
    this.pendingVoiceTarget = target;

    this.renderVoiceConfirmCard(this.pendingVoiceTranscript);

    const promptText = `Anda mengatakan: "${this.pendingVoiceTranscript}". Tekan Enter untuk mengirim, atau tekan Escape untuk membatalkan.`;
    this.announceScreenReader(promptText);

    // Stop previous TTS and speak read-back prompt
    ttsService.stop();
    ttsService.speak(promptText);
  }

  private renderVoiceConfirmCard(text: string): void {
    if (!this.shadowRoot) return;

    if (!this.confirmCardEl) {
      this.confirmCardEl = document.createElement('div');
      this.confirmCardEl.className = 'aira-voice-confirm-card';
      this.confirmCardEl.setAttribute('role', 'alertdialog');
      this.confirmCardEl.setAttribute('aria-modal', 'true');
      this.confirmCardEl.setAttribute('aria-label', 'Konfirmasi Suara AIRA');
      this.shadowRoot.appendChild(this.confirmCardEl);
    }

    this.confirmCardEl.innerHTML = `
      <div class="aira-confirm-header">
        <div class="aira-confirm-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <span>Konfirmasi Suara</span>
        </div>
        <div class="aira-confirm-speaking-indicator">
          <span>Membacakan ulang...</span>
        </div>
      </div>
      <div class="aira-confirm-text-box">
        "${text}"
      </div>
      <div class="aira-confirm-prompt">
        Tekan <kbd class="aira-kbd-hint">Enter</kbd> untuk mengirim, atau <kbd class="aira-kbd-hint">Esc</kbd> untuk membatalkan.
      </div>
      <div class="aira-confirm-actions">
        <button type="button" class="aira-confirm-btn aira-confirm-btn-cancel" id="aira-btn-confirm-cancel" title="Batalkan (Esc)">
          <span>✕ Batal</span>
          <kbd class="aira-kbd-hint">Esc</kbd>
        </button>
        <button type="button" class="aira-confirm-btn aira-confirm-btn-primary" id="aira-btn-confirm-send" title="Kirim (Enter)">
          <span>✓ Kirim</span>
          <kbd class="aira-kbd-hint">Enter</kbd>
        </button>
      </div>
    `;

    const cancelBtn = this.confirmCardEl.querySelector('#aira-btn-confirm-cancel') as HTMLElement | null;
    const sendBtn = this.confirmCardEl.querySelector('#aira-btn-confirm-send') as HTMLElement | null;

    cancelBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cancelVoiceInput();
    });

    sendBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.confirmVoiceInput();
    });

    this.confirmCardEl.style.display = 'flex';
  }

  private hideVoiceConfirmCard(): void {
    if (this.confirmCardEl) {
      this.confirmCardEl.style.display = 'none';
    }
  }

  /**
   * Case 1: User Confirms (Enter pressed or Kirim clicked)
   */
  public confirmVoiceInput(): void {
    if (!this.isVoiceConfirmationPending) return;

    const transcript = this.pendingVoiceTranscript;
    const target = this.pendingVoiceTarget;

    // Reset confirmation state
    this.isVoiceConfirmationPending = false;
    this.pendingVoiceTranscript = '';
    this.hideVoiceConfirmCard();

    // Immediately stop echo TTS read-back
    ttsService.stop();
    soundEffects.playConfirmation();

    if (!transcript) return;

    if (target === 'chat') {
      chatPanel.clearInput();
      chatPanel.addMessage('user', transcript, false);
      this.handleUserMessage(transcript);
    } else if (target === 'form') {
      formWizard.commitVoiceAnswer(transcript);
    }
  }

  /**
   * Case 2: User Rejects/Cancels (Escape pressed or Batal clicked)
   */
  public cancelVoiceInput(silent: boolean = false): void {
    if (!this.isVoiceConfirmationPending) return;

    this.isVoiceConfirmationPending = false;
    this.pendingVoiceTranscript = '';
    this.hideVoiceConfirmCard();
    chatPanel.clearInput();

    // Immediately stop echo TTS read-back
    ttsService.stop();

    if (!silent) {
      soundEffects.playStep();
      this.announceScreenReader('Input suara dibatalkan.');
      chatPanel.addMessage('system', 'Input suara dibatalkan.', false);
    }
  }

  /**
   * Central User Intent Dispatcher
   */
  public async handleUserMessage(userInput: string): Promise<void> {
    this.announceScreenReader(`Memproses: ${userInput}`);

    // If wizard is open and user says "kirim" or "submit"
    const lower = userInput.toLowerCase();
    if (formWizard.isOpen() && (lower.includes('kirim') || lower.includes('submit') || lower.includes('selesai'))) {
      const submitRes = formOrchestrator.submitHostForm();
      formWizard.close();
      const finishMsg = submitRes.success ? 'Pengajuan formulir berhasil dikirimkan ke portal!' : submitRes.message;
      chatPanel.addMessage('assistant', finishMsg, true);
      this.announceScreenReader(finishMsg);
      return;
    }

    // Extract pruned context (<500 tokens)
    const prunedContext = domPruner.getPrunedContextForLLM();

    // Process intent
    const intentResult = await llmService.processUserIntent(userInput, prunedContext);

    switch (intentResult.intent) {
      case 'SUMMARIZE': {
        const summary = await llmService.summarizePage(prunedContext);
        chatPanel.addMessage('assistant', summary, true);
        this.announceScreenReader(summary);
        break;
      }

      case 'NAVIGATE': {
        if (intentResult.targetId) {
          const targetEl = domPruner.getElement(intentResult.targetId);
          if (targetEl) {
            spotlightManager.show(
              targetEl,
              intentResult.explanation,
              () => {
                chatPanel.addMessage('system', `Tombol "${intentResult.actionName}" berhasil ditekan.`, false);
              },
              () => {
                chatPanel.addMessage('system', 'Navigasi dibatalkan.', false);
              }
            );
            chatPanel.addMessage('assistant', intentResult.explanation, true);
            this.announceScreenReader(intentResult.explanation);
            return;
          }
        }
        chatPanel.addMessage('assistant', intentResult.explanation || 'Saya tidak menemukan elemen tersebut di halaman.', true);
        break;
      }

      case 'FILL_FORM': {
        if (prunedContext.data.forms.length > 0) {
          const form = prunedContext.data.forms[0];
          // Open both form wizard AND ensure chat panel is visible side-by-side
          if (!chatPanel.isOpen()) {
            chatPanel.toggle(true);
          }
          formWizard.open(form);
          const startMsg = `Formulir "${form.title}" ditemukan dengan ${form.fields.length} kolom pertanyaan. Mari kita mulai!`;
          chatPanel.addMessage('assistant', startMsg, false);
          this.announceScreenReader(startMsg);
        } else {
          chatPanel.addMessage('assistant', 'Tidak ada formulir isian yang terdeteksi pada halaman ini.', true);
        }
        break;
      }

      case 'SETTINGS': {
        chatPanel.toggle(true);
        const settingsTab = this.shadowRoot?.querySelector('#aira-tab-settings') as HTMLElement | null;
        settingsTab?.click();
        chatPanel.addMessage('assistant', 'Ini adalah tab pengaturan aksesibilitas AIRA.', true);
        break;
      }

      case 'CHAT':
      default: {
        chatPanel.addMessage('assistant', intentResult.explanation, true);
        this.announceScreenReader(intentResult.explanation);
        break;
      }
    }
  }
}

const airaCoordinator = new AiraContentCoordinator();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => airaCoordinator.init());
} else {
  airaCoordinator.init();
}

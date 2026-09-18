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

  public async init(): Promise<void> {
    if (document.getElementById('aira-root')) return;

    this.currentSettings = await storageManager.getSettings();

    // 1. Create Shadow Host
    this.shadowHost = document.createElement('div');
    this.shadowHost.id = 'aira-root';
    this.shadowRoot = this.shadowHost.attachShadow({ mode: 'open' });
    document.body.appendChild(this.shadowHost);

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
      () => this.toggleVoiceOnlyMode()
    );

    formWizard.init(
      this.shadowRoot as unknown as HTMLElement,
      (prompt, answer) => {
        // Record all wizard questions & answers into chat log (Point 9)
        chatPanel.addMessage('assistant', prompt, false);
        if (answer) {
          chatPanel.addMessage('user', answer, false);
        }
      }
    );

    // 5. Apply Accessibility Settings to both Host Page and AIRA UI
    this.applySettingsToUI(this.currentSettings);

    // 6. Subscribe to settings updates
    storageManager.subscribe((newSettings) => {
      this.currentSettings = newSettings;
      this.applySettingsToUI(newSettings);
    });

    // 7. Global Keyboard Shortcut: Alt + A (Toggle Voice Assistant)
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        this.toggleVoiceAssistantShortcut();
      }
    });

    // 8. Auto-continuous voice loop for Voice-Only Mode (only when form wizard is not active)
    ttsService.onEnd(() => {
      if (this.currentSettings?.voiceOnlyMode && !formWizard.isOpen()) {
        this.listenInVoiceOnlyMode();
      }
    });
  }

  private async injectStyles(): Promise<void> {
    if (!this.shadowRoot) return;

    const styleEl = document.createElement('link');
    styleEl.rel = 'stylesheet';
    styleEl.href = chrome.runtime.getURL('content/content_style.css');
    this.shadowRoot.appendChild(styleEl);

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
    btn.setAttribute('aria-label', 'Buka Asisten AIRA (Tekan Alt+A)');
    btn.title = 'Buka Asisten AIRA (Alt+A)';

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

  private applySettingsToUI(s: AiraSettings): void {
    if (!this.shadowHost) return;

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
    this.listenInVoiceOnlyMode();
  }

  private async listenInVoiceOnlyMode(): Promise<void> {
    if (sttService.isListening() || formWizard.isOpen()) return;

    chatPanel.setLiveTranscription('Mendengarkan ucapan Anda...');

    await sttService.startListening({
      onInterim: (text) => {
        chatPanel.setLiveTranscription(text);
      },
      onFinal: (finalText) => {
        chatPanel.setLiveTranscription('');
        chatPanel.addMessage('user', finalText, false);
        this.handleUserMessage(finalText);
      },
      onError: (err) => {
        chatPanel.setLiveTranscription('');
        console.warn('[AIRA Voice] Listening error:', err);
      }
    });
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

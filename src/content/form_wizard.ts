/**
 * AIRA - Injected Form Wizard Component (TypeScript)
 * Implements 1-per-1 guided form completion, seamless step transitions, and end-to-end host submission.
 */

import { formOrchestrator, FormProgressState } from '../services/form_orchestrator';
import { FormContainerMetadata } from '../types/dom';
import { ttsService } from '../services/tts_service';
import { sttService } from '../services/stt_service';
import { llmService } from '../services/llm_service';

export class FormWizardComponent {
  private container: HTMLElement | null = null;
  private modalEl: HTMLElement | null = null;
  private onInteractionCallback: ((prompt: string, answer?: string) => void) | null = null;
  private onVoiceStateCallback: ((isListening: boolean, interim?: string) => void) | null = null;
  private escKeyListener: ((e: KeyboardEvent) => void) | null = null;
  private isProcessingVoiceInput: boolean = false;

  public init(
    container: HTMLElement, 
    onInteraction: (prompt: string, answer?: string) => void,
    onVoiceState?: (isListening: boolean, interim?: string) => void
  ): void {
    this.container = container;
    this.onInteractionCallback = onInteraction;
    this.onVoiceStateCallback = onVoiceState || null;

    formOrchestrator.onStateChange((state) => {
      if (state) {
        this.render(state);
      } else {
        this.destroy();
      }
    });

    this.escKeyListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    };
    window.addEventListener('keydown', this.escKeyListener);
  }

  public isOpen(): boolean {
    return !!this.modalEl && !!this.container?.contains(this.modalEl);
  }

  public isVoiceActive(): boolean {
    return this.isProcessingVoiceInput || sttService.isListening();
  }

  public async startVoiceInput(): Promise<void> {
    if (!this.isOpen() || this.isProcessingVoiceInput) return;
    const card = this.modalEl?.querySelector('.aira-wizard-card');
    const voiceBtn = card?.querySelector('#aira-wizard-voice-btn') as HTMLElement | null;
    const inputEl = card?.querySelector('#aira-step-input') as HTMLInputElement | null;
    const errorSlot = card?.querySelector('#aira-wizard-error-slot') as HTMLElement | null;
    const voiceText = voiceBtn?.querySelector('.aira-voice-btn-text') as HTMLElement | null;
    const state = formOrchestrator.getCurrentState();
    if (!state || state.isComplete || !voiceBtn || !inputEl || !errorSlot || !voiceText) return;

    voiceBtn.classList.add('aira-listening');
    voiceText.innerText = 'Mendengarkan ucapan (Alt+S)...';
    errorSlot.innerHTML = '';
    this.isProcessingVoiceInput = true;
    this.onVoiceStateCallback?.(true, 'Mendengarkan isian formulir...');

    await sttService.startListening({
      onInterim: (interim) => {
        inputEl.value = interim;
        voiceText.innerText = `Mendengarkan: "${interim}"`;
        this.onVoiceStateCallback?.(true, interim);
      },
      onFinal: (finalText) => {
        inputEl.value = finalText;
        voiceBtn.classList.remove('aira-listening');
        voiceText.innerText = 'Berikan pesan dengan suara (Alt+S)';
        this.isProcessingVoiceInput = false;
        this.onVoiceStateCallback?.(false);

        const advRes = formOrchestrator.saveAndAdvance(state.currentField.id, finalText);
        if (!advRes.success) {
          this.showError(errorSlot, inputEl, advRes.error || 'Format tidak valid');
          ttsService.speak(`Periksa kembali isian Anda. ${advRes.error}`);
        } else {
          this.clearError(errorSlot, inputEl);
          if (this.onInteractionCallback) {
            this.onInteractionCallback(`Jawaban ${state.currentField.label}: ${finalText}`);
          }
        }
      },
      onError: (err) => {
        this.isProcessingVoiceInput = false;
        voiceBtn.classList.remove('aira-listening');
        voiceText.innerText = 'Coba lagi (Alt+S)';
        this.onVoiceStateCallback?.(false);
      }
    });
  }

  public stopVoiceInput(): void {
    if (this.isProcessingVoiceInput || sttService.isListening()) {
      sttService.stopListening();
    }
    this.isProcessingVoiceInput = false;
    this.onVoiceStateCallback?.(false);
  }

  public open(form: FormContainerMetadata): void {
    formOrchestrator.startForm(form);
  }

  public close(): void {
    this.isProcessingVoiceInput = false;
    this.onVoiceStateCallback?.(false);
    sttService.stopListening();
    ttsService.stop();
    formOrchestrator.closeForm();
    this.destroy();
  }

  private destroy(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

  public async render(state: FormProgressState): Promise<void> {
    if (!this.container) return;
    this.destroy();

    const overlay = document.createElement('div');
    overlay.className = 'aira-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    // Click backdrop outside card to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });

    if (state.isComplete) {
      this.renderSummaryView(overlay, state);
    } else {
      await this.renderStepView(overlay, state);
    }

    this.modalEl = overlay;
    this.container.appendChild(overlay);
  }

  /**
   * Render individual step (Figma Examples 1, 2, 3)
   */
  private async renderStepView(overlay: HTMLElement, state: FormProgressState): Promise<void> {
    const field = state.currentField;
    const stepNum = state.currentStepIndex + 1;
    const progressPercent = Math.round((stepNum / state.totalSteps) * 100);

    const hint = field.hint || await llmService.explainFormField(field);

    const card = document.createElement('div');
    card.className = 'aira-wizard-card';

    card.innerHTML = `
      <div class="aira-wizard-header">
        <div class="aira-brand">
          <span class="aira-brand-title">AIRA</span>
          <span class="aira-brand-badge">${state.formTitle}</span>
        </div>
        <button type="button" class="aira-icon-btn aira-close-wizard" title="Tutup Formulir (Esc)" aria-label="Tutup Formulir">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="aira-wizard-step-info">
        <span>Langkah ${stepNum} dari ${state.totalSteps}</span>
        <span>${progressPercent}% Selesai</span>
      </div>
      <div class="aira-progress-bar-wrap">
        <div class="aira-progress-bar-fill" style="width: ${progressPercent}%;"></div>
      </div>

      <div class="aira-wizard-body">
        <div class="aira-wizard-title-wrap">
          <div class="aira-wizard-title" id="aira-q-title">
            Masukkan ${field.label} Anda
          </div>
          <button type="button" class="aira-read-aloud-btn" title="Bacakan pertanyaan" aria-label="Bacakan pertanyaan">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          </button>
        </div>

        <div class="aira-wizard-hint">
          ${hint}
        </div>

        <div id="aira-wizard-error-slot"></div>

        <div class="aira-wizard-input-wrap">
          <input 
            type="${field.type === 'number' ? 'tel' : (field.type || 'text')}"
            class="aira-wizard-input" 
            id="aira-step-input" 
            placeholder="${field.placeholder || `Ketik atau ucapkan ${field.label}...`}" 
            value="${state.answers[field.id] || ''}"
            autocomplete="off"
          />
        </div>

        <button type="button" class="aira-big-voice-btn" id="aira-wizard-voice-btn" title="Klik atau tahan Alt+S untuk bicara">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          <span class="aira-voice-btn-text">Berikan pesan dengan suara (Alt+S)</span>
        </button>
      </div>

      <div class="aira-wizard-footer">
        <button type="button" class="aira-btn aira-btn-outline" id="aira-wizard-prev" ${stepNum === 1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
          &lt; Kembali
        </button>
        <button type="button" class="aira-btn aira-btn-primary" id="aira-wizard-next">
          Lanjut ke ${stepNum < state.totalSteps ? `Langkah ${stepNum + 1}` : 'Rangkuman'} &gt;
        </button>
      </div>
    `;

    overlay.appendChild(card);

    // Speak prompt once per step
    const promptText = `Langkah ${stepNum}. Masukkan ${field.label} Anda. ${hint}`;
    ttsService.speak(promptText);

    if (this.onInteractionCallback) {
      this.onInteractionCallback(promptText);
    }

    const inputEl = card.querySelector('#aira-step-input') as HTMLInputElement;
    const voiceBtn = card.querySelector('#aira-wizard-voice-btn') as HTMLElement;
    const voiceText = voiceBtn.querySelector('.aira-voice-btn-text') as HTMLElement;
    const errorSlot = card.querySelector('#aira-wizard-error-slot') as HTMLElement;

    setTimeout(() => inputEl.focus(), 150);

    card.querySelector('.aira-read-aloud-btn')?.addEventListener('click', () => {
      ttsService.speak(promptText);
    });

    card.querySelector('.aira-close-wizard')?.addEventListener('click', () => {
      this.close();
    });

    // Voice button handler (supports click toggle or Alt+S Push-to-Talk)
    voiceBtn.addEventListener('click', async () => {
      if (this.isVoiceActive()) {
        this.stopVoiceInput();
        voiceBtn.classList.remove('aira-listening');
        voiceText.innerText = 'Berikan pesan dengan suara (Alt+S)';
      } else {
        await this.startVoiceInput();
      }
    });

    // Next step button (saveAndAdvance)
    card.querySelector('#aira-wizard-next')?.addEventListener('click', () => {
      const val = inputEl.value;
      const advRes = formOrchestrator.saveAndAdvance(field.id, val);
      if (!advRes.success) {
        this.showError(errorSlot, inputEl, advRes.error || 'Format tidak valid');
        ttsService.speak(advRes.error || 'Format tidak valid');
      } else {
        this.clearError(errorSlot, inputEl);
        if (this.onInteractionCallback) {
          this.onInteractionCallback(`Jawaban ${field.label}: ${val}`);
        }
      }
    });

    // Prev step button
    card.querySelector('#aira-wizard-prev')?.addEventListener('click', () => {
      formOrchestrator.previousStep();
    });

    // Enter key advances
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        (card.querySelector('#aira-wizard-next') as HTMLElement)?.click();
      }
    });
  }

  private showError(errorSlot: HTMLElement, inputEl: HTMLInputElement, errorMsg: string): void {
    inputEl.classList.add('aira-input-error');
    errorSlot.innerHTML = `
      <div class="aira-error-card">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span>${errorMsg}</span>
      </div>
    `;
  }

  private clearError(errorSlot: HTMLElement, inputEl: HTMLInputElement): void {
    inputEl.classList.remove('aira-input-error');
    errorSlot.innerHTML = '';
  }

  /**
   * Render Review & Summary (Figma Example 4 - Summary)
   */
  private renderSummaryView(overlay: HTMLElement, state: FormProgressState): void {
    const card = document.createElement('div');
    card.className = 'aira-wizard-card';

    let summaryItemsHtml = '';
    const entries = Object.entries(state.answers);

    entries.forEach(([fieldId, val]) => {
      const field = formOrchestrator['activeForm']?.fields.find(f => f.id === fieldId);
      const label = field ? field.label : fieldId;
      const idx = formOrchestrator['activeForm']?.fields.findIndex(f => f.id === fieldId) ?? 0;

      summaryItemsHtml += `
        <div class="aira-summary-item">
          <div class="aira-summary-info">
            <span class="aira-summary-label">${label}</span>
            <span class="aira-summary-val">${val || '-'}</span>
          </div>
          <button type="button" class="aira-summary-edit-btn" data-step="${idx}">
            Ubah
          </button>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="aira-wizard-header">
        <div class="aira-brand">
          <span class="aira-brand-title">AIRA</span>
          <span class="aira-brand-badge">Rangkuman Pengisian</span>
        </div>
        <button type="button" class="aira-icon-btn aira-close-wizard" title="Tutup (Esc)" aria-label="Tutup">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="aira-wizard-body">
        <div class="aira-wizard-title-wrap">
          <div class="aira-wizard-title">
            Periksa data Anda di bawah ini
          </div>
          <button type="button" class="aira-read-aloud-btn" id="aira-summary-read" title="Bacakan rangkuman" aria-label="Bacakan rangkuman">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          </button>
        </div>

        <div class="aira-wizard-hint">
          Jika seluruh data sudah sesuai, tekan "Kirim Formulir Sekarang". Jika ada yang salah, tekan tombol "Ubah" pada data yang bersangkutan.
        </div>

        <div class="aira-summary-list">
          ${summaryItemsHtml}
        </div>
      </div>

      <div class="aira-wizard-footer">
        <button type="button" class="aira-btn aira-btn-outline" id="aira-summary-back">
          &lt; Kembali Edit
        </button>
        <button type="button" class="aira-btn aira-btn-primary" id="aira-summary-submit">
          Kirim Formulir Sekarang
        </button>
      </div>
    `;

    overlay.appendChild(card);

    const summarySpeech = `Seluruh pertanyaan formulir telah selesai. Silakan periksa kembali data Anda. Jika sudah benar, tekan tombol Kirim Formulir Sekarang.`;
    ttsService.speak(summarySpeech);

    if (this.onInteractionCallback) {
      this.onInteractionCallback(summarySpeech);
    }

    card.querySelector('#aira-summary-read')?.addEventListener('click', () => {
      ttsService.speak(summarySpeech);
    });

    card.querySelector('.aira-close-wizard')?.addEventListener('click', () => {
      this.close();
    });

    card.querySelector('#aira-summary-back')?.addEventListener('click', () => {
      formOrchestrator.goToStep(state.totalSteps - 1);
    });

    // "Ubah" buttons
    card.querySelectorAll('.aira-summary-edit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const step = parseInt((e.currentTarget as HTMLElement).getAttribute('data-step') || '0', 10);
        formOrchestrator.goToStep(step);
      });
    });

    // Submit button: executes deterministic sync AND triggers real host submission end-to-end!
    card.querySelector('#aira-summary-submit')?.addEventListener('click', () => {
      const submitRes = formOrchestrator.submitHostForm();
      this.close(); // Closes the popup immediately!

      const successMsg = submitRes.success
        ? 'Data formulir berhasil diisi dan dikirimkan secara langsung ke portal!'
        : submitRes.message;

      ttsService.speak(successMsg);
      if (this.onInteractionCallback) {
        this.onInteractionCallback(successMsg);
      }
    });
  }
}

export const formWizard = new FormWizardComponent();

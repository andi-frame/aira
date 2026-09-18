/**
 * AIRA - Injected Form Wizard Component (TypeScript)
 * Implements 1-per-1 guided form completion, seamless step transitions, and end-to-end host submission.
 * Connects to AIRA Agent Server with automatic local fallback.
 */

import { formOrchestrator, FormProgressState } from '../services/form_orchestrator';
import { domPruner } from '../services/dom_pruner';
import { FormContainerMetadata, FormFieldMetadata } from '../types/dom';
import { ttsService } from '../services/tts_service';
import { sttService } from '../services/stt_service';
import { llmService } from '../services/llm_service';
import { agentService } from '../services/agent_service';
import { soundEffects } from '../shared/sound_effects';
import { AgentStepResponse } from '../types/llm';

export class FormWizardComponent {
  private container: HTMLElement | null = null;
  private modalEl: HTMLElement | null = null;
  private onInteractionCallback: ((prompt: string, answer?: string) => void) | null = null;
  private onVoiceStateCallback: ((isListening: boolean, interim?: string) => void) | null = null;
  private onVoiceFinalCallback: ((finalText: string) => void) | null = null;
  private escKeyListener: ((e: KeyboardEvent) => void) | null = null;
  private isProcessingVoiceInput: boolean = false;

  // Agent Server State
  private activeSessionId: string | null = null;
  private activeForm: FormContainerMetadata | null = null;
  private activeCompactDom?: string;
  private isServerMode: boolean = false;
  private lastAgentResponse: AgentStepResponse | null = null;

  public init(
    container: HTMLElement, 
    onInteraction: (prompt: string, answer?: string) => void,
    onVoiceState?: (isListening: boolean, interim?: string) => void,
    onVoiceFinal?: (finalText: string) => void
  ): void {
    this.container = container;
    this.onInteractionCallback = onInteraction;
    this.onVoiceStateCallback = onVoiceState || null;
    this.onVoiceFinalCallback = onVoiceFinal || null;

    formOrchestrator.onStateChange((state) => {
      // In server mode, server drives the UI updates
      if (this.isServerMode) return;

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

  /** True when an agent session is driving validation and submission. */
  public isServerDriven(): boolean {
    return this.isServerMode && !!this.activeSessionId;
  }

  public async startVoiceInput(): Promise<void> {
    if (!this.isOpen() || this.isProcessingVoiceInput) return;
    const card = this.modalEl?.querySelector('.aira-wizard-card');
    const voiceBtn = (card?.querySelector('#aira-wizard-voice-btn') || card?.querySelector('#aira-summary-voice-btn')) as HTMLElement | null;
    const inputEl = (card?.querySelector('#aira-step-input') || card?.querySelector('#aira-summary-input')) as HTMLInputElement | null;
    const controlEl = card?.querySelector('#aira-field-control') as HTMLElement | null;
    const errorSlot = (card?.querySelector('#aira-wizard-error-slot') || card?.querySelector('#aira-summary-error-slot')) as HTMLElement | null;
    const voiceText = voiceBtn?.querySelector('.aira-voice-btn-text') as HTMLElement | null;

    if (!voiceBtn || !voiceText) return;

    // Server-side audio recording
    if (this.isServerMode && this.activeSessionId) {
      voiceBtn.classList.add('aira-listening');
      voiceText.innerText = 'Merekam suara... (Lepas/Klik lagi untuk kirim)';
      if (errorSlot) errorSlot.innerHTML = '';
      this.isProcessingVoiceInput = true;
      this.onVoiceStateCallback?.(true, 'Merekam suara untuk AIRA Agent...');

      const started = await sttService.startAudioCapture();
      if (!started) {
        this.isProcessingVoiceInput = false;
        voiceBtn.classList.remove('aira-listening');
        voiceText.innerText = 'Gagal mengakses mikrofon (Alt+S)';
        this.onVoiceStateCallback?.(false);
      }
      return;
    }

    // Local STT fallback
    const state = formOrchestrator.getCurrentState();
    if (!state || (!inputEl && !controlEl) || !errorSlot) return;

    voiceBtn.classList.add('aira-listening');
    voiceText.innerText = 'Mendengarkan ucapan (Alt+S)...';
    errorSlot.innerHTML = '';
    this.isProcessingVoiceInput = true;
    this.onVoiceStateCallback?.(true, 'Mendengarkan isian formulir...');

    // Give the STT engine the question context + allowed options to bias recognition.
    const field = state.currentField;
    const fieldOptions = (field.options || []).filter(Boolean);
    const allowOther = !!(field.hasOther || field.otherAllowed);
    const contextParts = [`Pertanyaan: ${field.label}`];
    if (fieldOptions.length) contextParts.push(`Pilihan jawaban: ${fieldOptions.join(', ')}`);
    if (allowOther) contextParts.push('Pengguna boleh menjawab lain di luar pilihan tersebut');
    const sttContext = contextParts.join('. ') + '.';

    await sttService.startListening({
      vocabulary: allowOther ? [] : fieldOptions,
      prompt: sttContext,
      onInterim: (interim) => {
        if (controlEl) this.writeFieldControl(controlEl, interim);
        else if (inputEl) inputEl.value = interim;
        voiceText.innerText = `Mendengarkan: "${interim}"`;
        this.onVoiceStateCallback?.(true, interim);
      },
      onFinal: (finalText) => {
        if (controlEl) this.writeFieldControl(controlEl, finalText);
        else if (inputEl) inputEl.value = finalText;
        voiceBtn.classList.remove('aira-listening');
        voiceText.innerText = 'Berikan pesan dengan suara (Alt+S)';
        this.isProcessingVoiceInput = false;
        this.onVoiceStateCallback?.(false);

        if (this.onVoiceFinalCallback && finalText && finalText.trim()) {
          this.onVoiceFinalCallback(finalText.trim());
        } else if (finalText && finalText.trim()) {
          this.commitVoiceAnswer(finalText.trim());
        }
      },
      onError: () => {
        this.isProcessingVoiceInput = false;
        voiceBtn.classList.remove('aira-listening');
        voiceText.innerText = 'Coba lagi (Alt+S)';
        this.onVoiceStateCallback?.(false);
      }
    });
  }

  public commitVoiceAnswer(answer: string): void {
    const card = this.modalEl?.querySelector('.aira-wizard-card');
    const inputEl = (card?.querySelector('#aira-step-input') || card?.querySelector('#aira-summary-input')) as HTMLInputElement | null;
    const controlEl = card?.querySelector('#aira-field-control') as HTMLElement | null;
    const errorSlot = (card?.querySelector('#aira-wizard-error-slot') || card?.querySelector('#aira-summary-error-slot')) as HTMLElement | null;

    if (this.isServerMode && this.activeSessionId) {
      if (controlEl) this.writeFieldControl(controlEl, answer);
      else if (inputEl) inputEl.value = answer;
      this.handleServerTextInput(answer);
      return;
    }

    const state = formOrchestrator.getCurrentState();
    if (!state || (!inputEl && !controlEl) || !errorSlot) return;

    if (controlEl) this.writeFieldControl(controlEl, answer);
    else if (inputEl) inputEl.value = answer;
    if (state.isComplete) {
      // Confirmation on summary screen in local mode
      const lower = answer.toLowerCase();
      if (lower.includes('ya') || lower.includes('kirim') || lower.includes('benar') || lower.includes('setuju')) {
        (card?.querySelector('#aira-summary-submit') as HTMLElement)?.click();
      } else {
        ttsService.speak('Silakan tekan tombol Kirim Formulir atau klik Ubah pada data yang ingin diperbaiki.');
      }
      return;
    }

    const advRes = formOrchestrator.saveAndAdvance(state.currentField.id, answer);
    if (!advRes.success) {
      this.showError(errorSlot, (controlEl || inputEl) as HTMLElement, advRes.error || 'Format tidak valid');
      ttsService.speak(`Periksa kembali isian Anda. ${advRes.error}`);
    } else {
      this.clearError(errorSlot, (controlEl || inputEl) as HTMLElement);
      if (this.onInteractionCallback) {
        this.onInteractionCallback(`Jawaban ${state.currentField.label}: ${answer}`);
      }
    }
  }

  public async stopVoiceInput(): Promise<void> {
    if (!this.isProcessingVoiceInput && !sttService.isListening()) return;

    if (this.isServerMode && this.activeSessionId) {
      const card = this.modalEl?.querySelector('.aira-wizard-card');
      const voiceBtn = (card?.querySelector('#aira-wizard-voice-btn') || card?.querySelector('#aira-summary-voice-btn')) as HTMLElement | null;
      const voiceText = voiceBtn?.querySelector('.aira-voice-btn-text') as HTMLElement | null;

      if (voiceBtn && voiceText) {
        voiceBtn.classList.remove('aira-listening');
        voiceText.innerText = 'Memproses rekaman suara...';
      }

      this.isProcessingVoiceInput = false;
      this.onVoiceStateCallback?.(false);

      const audioBlob = await sttService.stopAudioCapture();
      if (audioBlob && this.activeSessionId) {
        let res = await agentService.interactWithAudio(this.activeSessionId, audioBlob);
        if (!res && this.activeForm) {
          console.warn('[AIRA Wizard] Session expired or server reloaded, re-initiating session...');
          const newSession = await agentService.startSession(this.activeForm, this.activeCompactDom);
          if (newSession && newSession.session_id) {
            this.activeSessionId = newSession.session_id;
            res = await agentService.interactWithAudio(this.activeSessionId, audioBlob);
          }
        }
        if (res) {
          await this.handleAgentStepResponse(res);
          return;
        }
      }
      if (voiceText) voiceText.innerText = 'Berikan pesan dengan suara (Alt+S)';
      return;
    }

    // Local STT fallback
    if (this.isProcessingVoiceInput || sttService.isListening()) {
      sttService.stopListening();
    }
    this.isProcessingVoiceInput = false;
    this.onVoiceStateCallback?.(false);
  }

  public async open(form: FormContainerMetadata): Promise<void> {
    this.activeForm = form;
    this.isProcessingVoiceInput = false;

    // Google Forms (deterministic FB_PUBLIC_LOAD_DATA_ fields) never use the LLM
    // structural parser, so compact-DOM pruning is skipped for them.
    const isDeterministic = (form.fields || []).some((f) => !!f.canonicalType);
    let compactDom: string | undefined;
    if (!isDeterministic) {
      // Prune DOM for LLM semantic structuring (supports ARIA & native forms)
      try {
        const targetContainer = (form && form.id ? domPruner.getElement(form.id) : null) || undefined;
        const pruned = domPruner.pruneFormForLLM(targetContainer);
        compactDom = pruned.compactHtml;
        this.activeCompactDom = compactDom;
        console.log(`[AIRA Wizard] Compact DOM prepared: ${pruned.elementCount} elements, ${compactDom ? compactDom.length : 0} chars`);
      } catch (e) {
        console.error('[AIRA Wizard] Failed to prune DOM for LLM:', e);
      }
    } else {
      this.activeCompactDom = undefined;
      console.log('[AIRA Wizard] Google Forms deterministic fields detected; skipping LLM form parsing.');
    }

    // 1. Try starting session on Python agent server
    try {
      const session = await agentService.startSession(form, compactDom);
      if (session && session.session_id) {
        this.activeSessionId = session.session_id;
        this.isServerMode = true;
        this.lastAgentResponse = session;
        // Keep activeForm in orchestrator for DOM binding & final host submission
        formOrchestrator['activeForm'] = form;
        formOrchestrator['answers'] = { ...(session.answers || {}) };
        await this.handleAgentStepResponse(session);
        return;
      }
    } catch (err) {
      console.warn('[AIRA Wizard] Server session start error, fallback to local orchestrator:', err);
    }

    // 2. Fallback to local deterministic orchestrator
    this.activeSessionId = null;
    this.isServerMode = false;
    formOrchestrator.startForm(form);
  }

  public close(): void {
    if (this.activeSessionId) {
      agentService.cancelSession(this.activeSessionId).catch(() => {});
      this.activeSessionId = null;
    }
    this.isServerMode = false;
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

  /**
   * Central processor for responses returned from the server Agent
   */
  private async handleAgentStepResponse(res: AgentStepResponse): Promise<void> {
    this.lastAgentResponse = res;

    // 1. Sound Cue
    soundEffects.playServerCue(res.audio_cue);

    // 2. Spoken Prompt
    if (res.spoken_prompt) {
      ttsService.speak(res.spoken_prompt);
      this.onInteractionCallback?.(res.spoken_prompt);
    }

    // 3. Validation error on current step
    if (!res.is_valid) {
      const card = this.modalEl?.querySelector('.aira-wizard-card');
      const inputEl = card?.querySelector('#aira-step-input') as HTMLInputElement | null;
      const errorSlot = card?.querySelector('#aira-wizard-error-slot') as HTMLElement | null;
      if (errorSlot && inputEl) {
        if (res.current_field && res.answers && res.answers[res.current_field.id]) {
          inputEl.value = String(res.answers[res.current_field.id]);
        }
        this.showError(errorSlot, inputEl, res.spoken_prompt || 'Data tidak valid');
      }
      return;
    }

    // 4. Always sync host DOM with latest answers / sync_payload on every turn
    const answersToSync = res.sync_payload || res.answers;
    if (answersToSync && Object.keys(answersToSync).length > 0) {
      formOrchestrator.syncToHostDOM(answersToSync);
    }

    // 5. Route by status (case-insensitive for robust server-client compatibility)
    const normStatus = (res.status || '').toLowerCase();
    if (normStatus === 'review' || normStatus === 'awaiting_confirmation' || normStatus === 'reviewing') {
      this.renderServerSummary(res);
    } else if (normStatus === 'completed') {
      formOrchestrator.submitHostForm({ skipValidation: true });
      this.close();
    } else {
      await this.renderServerStep(res);
    }
  }

  private async handleServerTextInput(val: string): Promise<void> {
    if (!this.activeSessionId) return;
    const card = this.modalEl?.querySelector('.aira-wizard-card');
    const nextBtn = card?.querySelector('#aira-wizard-next') as HTMLButtonElement | null;
    if (nextBtn) nextBtn.disabled = true;

    try {
      let res = await agentService.interactWithText(this.activeSessionId, val);
      if (!res && this.activeForm) {
        console.warn('[AIRA Wizard] Session expired or server reloaded, re-initiating session...');
        const newSession = await agentService.startSession(this.activeForm, this.activeCompactDom);
        if (newSession && newSession.session_id) {
          this.activeSessionId = newSession.session_id;
          res = await agentService.interactWithText(this.activeSessionId, val);
        }
      }

      if (res) {
        await this.handleAgentStepResponse(res);
      } else {
        soundEffects.playError();
        ttsService.speak('Gagal berkomunikasi dengan server.');
      }
    } finally {
      if (nextBtn) nextBtn.disabled = false;
    }
  }

  /**
   * Render server-driven step view
   */
  private async renderServerStep(res: AgentStepResponse): Promise<void> {
    if (!this.container) return;
    this.destroy();

    const overlay = this.createOverlay();
    const fieldData = res.current_field || (this.activeForm?.fields[res.step_index]);
    const fieldDataDomId = fieldData && 'domId' in fieldData ? fieldData.domId : undefined;
    const field: FormFieldMetadata = {
      id: fieldData?.id || fieldDataDomId || `field_${res.step_index + 1}`,
      label: fieldData?.label || 'Kolom Isian',
      type: fieldData?.type || 'text',
      placeholder: fieldData?.placeholder || '',
      required: fieldData?.required ?? true,
      currentValue: fieldData?.currentValue || '',
      options: fieldData?.options || [],
      hint: res.field_hint || fieldData?.hint || ''
    };

    const formTitle = this.activeForm?.title || 'Formulir';
    const currentValue = (res.answers && res.answers[field.id]) ? String(res.answers[field.id]) : '';

    this.buildStepDOM(overlay, {
      field,
      stepNum: res.step_index + 1,
      totalSteps: res.total_steps,
      progressPercent: res.progress_percent,
      hint: res.field_hint || field.hint || `Masukkan ${field.label} Anda`,
      formTitle,
      currentValue,
      isServerMode: true
    });

    this.modalEl = overlay;
    this.container.appendChild(overlay);
  }

  /**
   * Render server-driven summary view
   */
  private renderServerSummary(res: AgentStepResponse): void {
    if (!this.container) return;
    this.destroy();

    const overlay = this.createOverlay();
    const formTitle = this.activeForm?.title || 'Formulir';

    this.buildSummaryDOM(overlay, {
      formTitle,
      answers: res.answers || {},
      isServerMode: true
    });

    this.modalEl = overlay;
    this.container.appendChild(overlay);
  }

  /**
   * Local fallback render method (when server is offline)
   */
  public async render(state: FormProgressState): Promise<void> {
    if (!this.container) return;
    this.destroy();

    const overlay = this.createOverlay();

    if (state.isComplete) {
      this.buildSummaryDOM(overlay, {
        formTitle: state.formTitle,
        answers: state.answers,
        isServerMode: false
      });
    } else {
      const field = state.currentField;
      const stepNum = state.currentStepIndex + 1;
      const progressPercent = Math.round((stepNum / state.totalSteps) * 100);
      const hint = field.hint || (field.canonicalType ? this.defaultHintForField(field) : await llmService.explainFormField(field));
      const currentValue = state.answers[field.id] || '';

      this.buildStepDOM(overlay, {
        field,
        stepNum,
        totalSteps: state.totalSteps,
        progressPercent,
        hint,
        formTitle: state.formTitle,
        currentValue,
        isServerMode: false
      });

      // Speak prompt in local mode
      const promptText = field.canonicalType
        ? `Langkah ${stepNum}. ${field.label}. ${hint}`
        : `Langkah ${stepNum}. Masukkan ${field.label} Anda. ${hint}`;
      ttsService.speak(promptText);
      this.onInteractionCallback?.(promptText);
    }

    this.modalEl = overlay;
    this.container.appendChild(overlay);
  }

  /** Deterministic prompt for structural Google Forms fields (no LLM inference). */
  private defaultHintForField(field: FormFieldMetadata): string {
    const canonical = field.canonicalType || '';
    const rowSuffix = field.gridRowLabel ? ` untuk baris "${field.gridRowLabel}"` : '';

    if (canonical === 'multiple_choice_grid') return `Pilih satu opsi${rowSuffix}.`;
    if (canonical === 'checkbox_grid') return `Pilih satu atau beberapa opsi${rowSuffix}.`;
    if (canonical === 'grid_unknown') return `Pilih kolom${rowSuffix}.`;

    const isSingleChoice =
      ['radio', 'linear_scale', 'rating'].includes(field.type) ||
      ['multiple_choice', 'dropdown', 'linear_scale', 'rating'].includes(canonical);
    if (isSingleChoice) return 'Pilih salah satu opsi yang sesuai.';

    const isMultiChoice =
      ['checkbox_group', 'checkboxes'].includes(field.type) || ['checkboxes'].includes(canonical);
    if (isMultiChoice) return 'Pilih satu atau lebih opsi yang sesuai.';

    if (field.type === 'date' || canonical === 'date') return 'Sebutkan atau ketik tanggal yang diminta.';
    if (field.type === 'time' || canonical === 'time') return 'Sebutkan atau ketik waktu yang diminta.';
    return 'Ketik atau ucapkan jawaban Anda.';
  }

  private createOverlay(): HTMLElement {    const overlay = document.createElement('div');
    overlay.className = 'aira-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });

    return overlay;
  }

  /**
   * Unified Step DOM Builder
   */
  private buildStepDOM(
    overlay: HTMLElement,
    params: {
      field: FormFieldMetadata;
      stepNum: number;
      totalSteps: number;
      progressPercent: number;
      hint: string;
      formTitle: string;
      currentValue: string;
      isServerMode: boolean;
    }
  ): void {
    const { field, stepNum, totalSteps, progressPercent, hint, formTitle, currentValue, isServerMode } = params;
    const isCanonical = !!field.canonicalType;
    const titleText = isCanonical ? field.label : `Masukkan ${field.label} Anda`;

    const card = document.createElement('div');
    card.className = 'aira-wizard-card';

    card.innerHTML = `
      <div class="aira-wizard-header">
        <div class="aira-brand">
          <span class="aira-brand-title">AIRA</span>
          <span class="aira-brand-badge">${formTitle}</span>
        </div>
        <button type="button" class="aira-icon-btn aira-close-wizard" title="Tutup Formulir (Esc)" aria-label="Tutup Formulir">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="aira-wizard-step-info">
        <span>Langkah ${stepNum} dari ${totalSteps}</span>
        <span>${progressPercent}% Selesai</span>
      </div>
      <div class="aira-progress-bar-wrap">
        <div class="aira-progress-bar-fill" style="width: ${progressPercent}%;"></div>
      </div>

      <div class="aira-wizard-body">
        <div class="aira-wizard-title-wrap">
          <div class="aira-wizard-title" id="aira-q-title">
            ${titleText}
          </div>
          <button type="button" class="aira-read-aloud-btn" title="Bacakan pertanyaan" aria-label="Bacakan pertanyaan">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          </button>
        </div>

        <div class="aira-wizard-hint">
          ${hint}
        </div>

        <div id="aira-wizard-error-slot"></div>

        <div id="aira-field-control-slot"></div>

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
          Lanjut ke ${stepNum < totalSteps ? `Langkah ${stepNum + 1}` : 'Rangkuman'} &gt;
        </button>
      </div>
    `;

    const controlSlot = card.querySelector('#aira-field-control-slot') as HTMLElement;
    controlSlot.replaceWith(this.buildFieldControl(field, currentValue));

    overlay.appendChild(card);

    const controlEl = card.querySelector('#aira-field-control') as HTMLElement;
    const inputEl = (
      controlEl.querySelector('#aira-step-input') ||
      controlEl.querySelector('input:not([type="hidden"]), select, textarea')
    ) as HTMLElement | null;
    const voiceBtn = card.querySelector('#aira-wizard-voice-btn') as HTMLElement;
    const voiceText = voiceBtn.querySelector('.aira-voice-btn-text') as HTMLElement;
    const errorSlot = card.querySelector('#aira-wizard-error-slot') as HTMLElement;

    setTimeout(() => inputEl?.focus(), 150);

    card.querySelector('.aira-read-aloud-btn')?.addEventListener('click', () => {
      const promptText = `Langkah ${stepNum}. Masukkan ${field.label} Anda. ${hint}`;
      ttsService.speak(promptText);
    });

    card.querySelector('.aira-close-wizard')?.addEventListener('click', () => {
      this.close();
    });

    // Voice button handler
    voiceBtn.addEventListener('click', async () => {
      if (this.isVoiceActive()) {
        await this.stopVoiceInput();
        voiceBtn.classList.remove('aira-listening');
        voiceText.innerText = 'Berikan pesan dengan suara (Alt+S)';
      } else {
        await this.startVoiceInput();
      }
    });

    // Next step button
    card.querySelector('#aira-wizard-next')?.addEventListener('click', async () => {
      const val = this.readFieldControl(controlEl);

      if (isServerMode && this.activeSessionId) {
        await this.handleServerTextInput(val);
        return;
      }

      // Local mode
      const advRes = formOrchestrator.saveAndAdvance(field.id, val);
      if (!advRes.success) {
        this.showError(errorSlot, controlEl, advRes.error || 'Format tidak valid');
        ttsService.speak(advRes.error || 'Format tidak valid');
      } else {
        this.clearError(errorSlot, controlEl);
        this.onInteractionCallback?.(`Jawaban ${field.label}: ${val}`);
      }
    });

    // Prev step button
    card.querySelector('#aira-wizard-prev')?.addEventListener('click', async () => {
      if (isServerMode && this.activeSessionId) {
        const res = await agentService.stepBack(this.activeSessionId);
        if (res) {
          await this.handleAgentStepResponse(res);
        }
        return;
      }

      formOrchestrator.previousStep();
    });

    // Enter key advances (except inside a textarea)
    controlEl.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (e.key === 'Enter' && target.tagName.toLowerCase() !== 'textarea') {
        e.preventDefault();
        (card.querySelector('#aira-wizard-next') as HTMLElement)?.click();
      }
    });
  }

  /**
   * Builds the correct input control for a field's structural type:
   * radio group, checkbox group, select, textarea or text-like input.
   */
  private buildFieldControl(field: FormFieldMetadata, currentValue: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'aira-wizard-input-wrap';
    wrap.id = 'aira-field-control';

    const options = Array.from(
      new Set((field.options || []).filter((option) => typeof option === 'string' && option !== ''))
    ).slice(0, 30);
    const canonical = field.canonicalType || '';

    const isSingleChoice =
      ['radio', 'linear_scale', 'rating'].includes(field.type) ||
      ['multiple_choice', 'linear_scale', 'rating', 'multiple_choice_grid'].includes(canonical);
    const isMultiChoice =
      ['checkbox_group', 'checkboxes'].includes(field.type) ||
      ['checkboxes', 'checkbox_grid'].includes(canonical);
    const isSelect = field.type === 'select' || canonical === 'dropdown';
    const isParagraph = field.type === 'textarea' || canonical === 'paragraph';
    const hasOther = !!(field.hasOther || field.otherAllowed);

    if ((isSingleChoice || isMultiChoice) && options.length > 0) {
      const list = document.createElement('div');
      list.className = 'aira-choice-list';
      list.setAttribute('role', isMultiChoice ? 'group' : 'radiogroup');
      list.setAttribute('aria-label', field.label);

      const selected = this.parseMultiValue(currentValue);

      options.forEach((option, index) => {
        const item = document.createElement('label');
        item.className = 'aira-choice-item';

        const input = document.createElement('input');
        input.type = isMultiChoice ? 'checkbox' : 'radio';
        input.name = 'aira-choice';
        input.className = 'aira-choice-input';
        input.value = option;
        if (index === 0) input.id = 'aira-step-input';
        if (selected.includes(option.toLowerCase())) input.checked = true;

        const text = document.createElement('span');
        text.className = 'aira-choice-label';
        text.textContent = option;

        item.appendChild(input);
        item.appendChild(text);
        list.appendChild(item);
      });

      if (hasOther) {
        const item = document.createElement('label');
        item.className = 'aira-choice-item aira-choice-other';

        const input = document.createElement('input');
        input.type = isMultiChoice ? 'checkbox' : 'radio';
        input.name = 'aira-choice';
        input.className = 'aira-choice-input';
        input.value = '__other_option__';

        const text = document.createElement('span');
        text.className = 'aira-choice-label';
        text.textContent = 'Lainnya:';

        const otherInput = document.createElement('input');
        otherInput.type = 'text';
        otherInput.className = 'aira-other-input';
        otherInput.placeholder = 'Ketik jawaban lain...';
        otherInput.setAttribute('aria-label', `${field.label} lainnya`);

        otherInput.addEventListener('input', () => {
          if (otherInput.value.trim()) input.checked = true;
        });

        item.appendChild(input);
        item.appendChild(text);
        item.appendChild(otherInput);
        list.appendChild(item);
      }

      wrap.appendChild(list);
      return wrap;
    }

    if (isSelect && options.length > 0) {
      const select = document.createElement('select');
      select.className = 'aira-wizard-input';
      select.id = 'aira-step-input';

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = field.placeholder || 'Pilih...';
      select.appendChild(placeholder);

      options.forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        select.appendChild(opt);
      });

      if (currentValue) {
        const match = options.find((option) => option.toLowerCase() === currentValue.toLowerCase());
        if (match) select.value = match;
      }

      wrap.appendChild(select);
      return wrap;
    }

    if (isParagraph) {
      const textarea = document.createElement('textarea');
      textarea.className = 'aira-wizard-input';
      textarea.id = 'aira-step-input';
      textarea.rows = 3;
      textarea.placeholder = field.placeholder || `Ketik jawaban ${field.label}...`;
      textarea.value = currentValue || '';
      wrap.appendChild(textarea);
      return wrap;
    }

    const input = document.createElement('input');
    const safeTypes = ['text', 'tel', 'email', 'number', 'date', 'time'];
    const rawType = (field.type || 'text').toLowerCase();
    input.type = safeTypes.includes(rawType) ? rawType : 'text';
    input.className = 'aira-wizard-input';
    input.id = 'aira-step-input';
    input.placeholder = field.placeholder || `Ketik atau ucapkan ${field.label}...`;
    input.value = currentValue || '';
    input.autocomplete = 'off';
    wrap.appendChild(input);
    return wrap;
  }

  private parseMultiValue(value: string): string[] {
    return (value || '')
      .split(/[,|]/)
      .map((part) => part.toLowerCase().trim())
      .filter(Boolean);
  }

  /** Reads the answered value from any control produced by buildFieldControl. */
  private readFieldControl(control: HTMLElement): string {
    const select = control.querySelector('select') as HTMLSelectElement | null;
    if (select) return select.value.trim();

    const textarea = control.querySelector('textarea') as HTMLTextAreaElement | null;
    if (textarea) return textarea.value.trim();

    const choices = Array.from(control.querySelectorAll('input[type="radio"], input[type="checkbox"]')) as HTMLInputElement[];
    if (choices.length > 0) {
      const selected = choices.filter((choice) => choice.checked);
      if (selected.length === 0) return '';
      const otherInput = control.querySelector('.aira-other-input') as HTMLInputElement | null;
      return selected
        .map((choice) => {
          if (choice.value === '__other_option__') {
            return otherInput?.value.trim() || 'Other';
          }
          return choice.value;
        })
        .join(', ')
        .trim();
    }

    const input = control.querySelector('input') as HTMLInputElement | null;
    return input ? input.value.trim() : '';
  }

  /** Writes a value into any control produced by buildFieldControl (used by voice). */
  private writeFieldControl(control: HTMLElement, value: string): void {
    const select = control.querySelector('select') as HTMLSelectElement | null;
    if (select) {
      const match = Array.from(select.options).find(
        (option) => option.value.toLowerCase() === value.toLowerCase() || option.text.toLowerCase().includes(value.toLowerCase())
      );
      if (match) select.value = match.value;
      return;
    }

    const textarea = control.querySelector('textarea') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = value;
      return;
    }

    const choices = Array.from(control.querySelectorAll('input[type="radio"], input[type="checkbox"]')) as HTMLInputElement[];
    if (choices.length > 0) {
      const parts = this.parseMultiValue(value);
      let matched = false;
      choices.forEach((choice) => {
        if (choice.value === '__other_option__') return;
        const option = choice.value.toLowerCase();
        if (parts.some((part) => option === part || option.includes(part) || part.includes(option))) {
          choice.checked = true;
          matched = true;
        } else {
          choice.checked = false;
        }
      });

      const otherInput = control.querySelector('.aira-other-input') as HTMLInputElement | null;
      if (!matched && otherInput && value.trim()) {
        const otherChoice = choices.find((choice) => choice.value === '__other_option__');
        if (otherChoice) otherChoice.checked = true;
        otherInput.value = value;
      } else if (otherInput && matched) {
        otherInput.value = '';
      }
      return;
    }

    const input = control.querySelector('input') as HTMLInputElement | null;
    if (input) input.value = value;
  }

  private showError(errorSlot: HTMLElement, controlEl: HTMLElement, errorMsg: string): void {
    controlEl.classList.add('aira-input-error');
    const focusable = controlEl.querySelector('input, select, textarea') as HTMLElement | null;
    focusable?.classList.add('aira-input-error');
    errorSlot.innerHTML = `
      <div class="aira-error-card">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span>${errorMsg}</span>
      </div>
    `;
  }

  private clearError(errorSlot: HTMLElement, controlEl: HTMLElement): void {
    controlEl.classList.remove('aira-input-error');
    const focusable = controlEl.querySelector('input, select, textarea') as HTMLElement | null;
    focusable?.classList.remove('aira-input-error');
    errorSlot.innerHTML = '';
  }

  /**
   * Unified Summary DOM Builder
   */
  private buildSummaryDOM(
    overlay: HTMLElement,
    params: {
      formTitle: string;
      answers: Record<string, any>;
      isServerMode: boolean;
    }
  ): void {
    const { formTitle, answers, isServerMode } = params;

    const card = document.createElement('div');
    card.className = 'aira-wizard-card';

    let summaryItemsHtml = '';
    const entries = Object.entries(answers);

    entries.forEach(([fieldId, val]) => {
      const field = this.activeForm?.fields.find((f) => f.id === fieldId) || formOrchestrator['activeForm']?.fields.find((f) => f.id === fieldId);
      const label = field ? field.label : fieldId;
      const idx = this.activeForm?.fields.findIndex((f) => f.id === fieldId) ?? 0;

      summaryItemsHtml += `
        <div class="aira-summary-item">
          <div class="aira-summary-info">
            <span class="aira-summary-label">${label}</span>
            <span class="aira-summary-val">${val || '-'}</span>
          </div>
          <button type="button" class="aira-summary-edit-btn" data-step="${idx}" data-field-id="${fieldId}">
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

        <div id="aira-summary-error-slot"></div>

        <div class="aira-wizard-input-wrap" style="margin-top: 10px;">
          <input 
            type="text" 
            class="aira-wizard-input" 
            id="aira-summary-input" 
            placeholder="Ketik atau ucapkan 'Ya, kirim' atau 'Belum, ubah [kolom]'..." 
            autocomplete="off"
          />
        </div>

        <button type="button" class="aira-big-voice-btn" id="aira-summary-voice-btn" title="Klik atau tahan Alt+S untuk bicara konfirmasi / koreksi">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          <span class="aira-voice-btn-text">Konfirmasi Suara / Koreksi (Alt+S)</span>
        </button>
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
    if (!isServerMode) {
      ttsService.speak(summarySpeech);
      this.onInteractionCallback?.(summarySpeech);
    }

    card.querySelector('#aira-summary-read')?.addEventListener('click', () => {
      ttsService.speak(summarySpeech);
    });

    // Voice button on summary screen
    card.querySelector('#aira-summary-voice-btn')?.addEventListener('click', async () => {
      const voiceBtn = card.querySelector('#aira-summary-voice-btn') as HTMLElement | null;
      const voiceText = voiceBtn?.querySelector('.aira-voice-btn-text') as HTMLElement | null;

      if (this.isProcessingVoiceInput || sttService.isListening()) {
        await this.stopVoiceInput();
        if (voiceBtn && voiceText) {
          voiceBtn.classList.remove('aira-listening');
          voiceText.innerText = 'Konfirmasi Suara / Koreksi (Alt+S)';
        }
      } else {
        await this.startVoiceInput();
      }
    });

    // Text input on summary screen (Enter to submit confirmation / request correction)
    const summaryInput = card.querySelector('#aira-summary-input') as HTMLInputElement | null;
    summaryInput?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = summaryInput.value.trim();
        if (!val) return;
        if (isServerMode && this.activeSessionId) {
          await this.handleServerTextInput(val);
        } else {
          this.commitVoiceAnswer(val);
        }
      }
    });

    card.querySelector('.aira-close-wizard')?.addEventListener('click', () => {
      this.close();
    });

    card.querySelector('#aira-summary-back')?.addEventListener('click', async () => {
      if (isServerMode && this.activeSessionId) {
        const res = await agentService.stepBack(this.activeSessionId);
        if (res) {
          await this.handleAgentStepResponse(res);
        }
        return;
      }

      const total = this.activeForm?.fields.length || 1;
      formOrchestrator.goToStep(total - 1);
    });

    // "Ubah" buttons
    card.querySelectorAll('.aira-summary-edit-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget as HTMLElement;
        const fieldId = target.getAttribute('data-field-id') || '';
        const step = parseInt(target.getAttribute('data-step') || '0', 10);

        if (isServerMode && this.activeSessionId && fieldId) {
          const res = await agentService.jumpToField(this.activeSessionId, fieldId);
          if (res) {
            await this.handleAgentStepResponse(res);
          }
          return;
        }

        formOrchestrator.goToStep(step);
      });
    });

    // Submit button: executes sync AND triggers real host submission end-to-end!
    card.querySelector('#aira-summary-submit')?.addEventListener('click', async () => {
      if (isServerMode && this.activeSessionId) {
        const res = await agentService.confirmSubmission(this.activeSessionId, 'ya');
        if (res) {
          if (res.sync_payload) {
            formOrchestrator.syncToHostDOM(res.sync_payload);
          }
          const submitRes = formOrchestrator.submitHostForm({ skipValidation: true });
          this.close();

          soundEffects.playServerCue(res.audio_cue || 'complete');
          const finalMsg = res.spoken_prompt || (submitRes.success ? 'Data formulir berhasil diisi dan dikirimkan!' : submitRes.message);
          ttsService.speak(finalMsg);
          this.onInteractionCallback?.(finalMsg);
          return;
        }
      }

      // Local mode submit
      const submitRes = formOrchestrator.submitHostForm();
      this.close();

      const successMsg = submitRes.success
        ? 'Data formulir berhasil diisi dan dikirimkan secara langsung ke portal!'
        : submitRes.message;

      ttsService.speak(successMsg);
      this.onInteractionCallback?.(successMsg);
    });
  }
}

export const formWizard = new FormWizardComponent();

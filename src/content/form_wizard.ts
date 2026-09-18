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
  private editingFromSummary: boolean = false;
  private confirmationActive: boolean = false;
  private confirmApprove: (() => void) | null = null;

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
      if (!this.isOpen()) return;

      // Escape is strictly reserved for closing the wizard dialog
      if (e.key === 'Escape' || e.code === 'Escape') {
        this.close();
        return;
      }

      // If confirmation bar is active: Enter = Benar, Backspace = Ulangi
      if (this.confirmationActive) {
        if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          e.stopPropagation();
          this.confirmApprove?.();
          return;
        }

        if (e.key === 'Backspace' || e.code === 'Backspace') {
          e.preventDefault();
          e.stopPropagation();
          const card = this.modalEl?.querySelector('.aira-wizard-card') as HTMLElement | null;
          if (card) {
            this.retryAnswerInput(card);
          }
          return;
        }
      }
    };
    window.addEventListener('keydown', this.escKeyListener, true);
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

    if (this.confirmationActive && card) {
      this.confirmationActive = false;
      this.confirmApprove = null;
      const confirmBar = card.querySelector('#aira-confirm-bar') as HTMLElement | null;
      const nextBtn = card.querySelector('#aira-wizard-next') as HTMLButtonElement | null;
      if (confirmBar) confirmBar.style.display = 'none';
      if (nextBtn) nextBtn.disabled = false;
      ttsService.stop();
    }

    // Server mode: record audio locally, transcribe via the AIRA server (9Router STT),
    // then confirm the transcript before it is submitted.
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
      manualStopOnly: false,
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

  public commitVoiceAnswer(answer: string, options: { confirmed?: boolean } = {}): void {
    const card = this.modalEl?.querySelector('.aira-wizard-card') as HTMLElement | null;
    const inputEl = (card?.querySelector('#aira-step-input') || card?.querySelector('#aira-summary-input')) as HTMLInputElement | null;
    const controlEl = card?.querySelector('#aira-field-control') as HTMLElement | null;
    const errorSlot = (card?.querySelector('#aira-wizard-error-slot') || card?.querySelector('#aira-summary-error-slot')) as HTMLElement | null;

    const state = formOrchestrator.getCurrentState();

    // Summary screen: interpret confirmation / correction commands
    if (state?.isComplete) {
      if (controlEl) this.writeFieldControl(controlEl, answer);
      else if (inputEl) inputEl.value = answer;
      const lower = answer.toLowerCase();
      if (lower.includes('ya') || lower.includes('kirim') || lower.includes('benar') || lower.includes('setuju')) {
        (card?.querySelector('#aira-summary-submit') as HTMLElement)?.click();
      } else {
        ttsService.speak('Silakan tekan tombol Kirim Formulir atau klik Ubah pada data yang ingin diperbaiki.');
      }
      return;
    }

    if (this.isServerMode && this.activeSessionId) {
      if (controlEl) this.writeFieldControl(controlEl, answer);
      else if (inputEl) inputEl.value = answer;
      if (!options.confirmed && state && card) {
        void this.askAnswerConfirmation(card, state.currentField, answer, true);
        return;
      }
      void this.handleServerTextInput(answer);
      return;
    }

    if (!state || (!inputEl && !controlEl) || !errorSlot) return;
    if (controlEl) this.writeFieldControl(controlEl, answer);
    else if (inputEl) inputEl.value = answer;

    if (!options.confirmed && card) {
      void this.askAnswerConfirmation(card, state.currentField, answer, true);
      return;
    }
    void this.applyAnswer(state.currentField, answer, card, errorSlot, controlEl);
  }

  public async stopVoiceInput(): Promise<void> {
    if (!this.isProcessingVoiceInput && !sttService.isListening()) return;

    // Server mode: transcribe only, then run the normal answer confirmation.
    if (this.isServerMode && this.activeSessionId) {
      const card = this.modalEl?.querySelector('.aira-wizard-card') as HTMLElement | null;
      const voiceBtn = (card?.querySelector('#aira-wizard-voice-btn') || card?.querySelector('#aira-summary-voice-btn')) as HTMLElement | null;
      const voiceText = voiceBtn?.querySelector('.aira-voice-btn-text') as HTMLElement | null;

      if (voiceBtn && voiceText) {
        voiceBtn.classList.remove('aira-listening');
        voiceText.innerText = 'Memproses rekaman suara...';
      }

      this.isProcessingVoiceInput = false;
      this.onVoiceStateCallback?.(false);

      const audioBlob = await sttService.stopAudioCapture();
      const durationMs = sttService.lastCaptureDurationMs;
      const state = formOrchestrator.getCurrentState();

      if (audioBlob && durationMs > 0 && durationMs < 900) {
        if (voiceText) voiceText.innerText = 'Berikan pesan dengan suara (Alt+S)';
        soundEffects.playError();
        ttsService.speak('Rekaman terlalu singkat. Silakan bicara setelah nada, lalu tekan lagi untuk mengirim.');
        return;
      }

      if (audioBlob && this.activeSessionId) {
        const result = await agentService.transcribeForSession(this.activeSessionId, audioBlob, durationMs);
        if (!result && this.activeForm) {
          // Session lost (server reload/multi-worker): recover, then ask the user to repeat.
          const recovered = await this.recoverServerSession();
          if (recovered) {
            if (voiceText) voiceText.innerText = 'Sesi dipulihkan. Silakan coba lagi (Alt+S).';
            return;
          }
        }

        if (result) {
          // Confirm the parsed value (digits cleaned, option matched), not the raw transcript.
          const value = result.normalized || result.transcript;
          if (voiceText) voiceText.innerText = 'Berikan pesan dengan suara (Alt+S)';
          if (state && card && !state.isComplete) {
            void this.askAnswerConfirmation(card, state.currentField, value, true, true);
          } else {
            void this.handleServerTextInput(value, true);
          }
          return;
        }
      }

      if (voiceText) voiceText.innerText = 'Berikan pesan dengan suara (Alt+S)';
      if (sttService.isListening()) sttService.stopListening();
      soundEffects.playError();
      ttsService.speak('Suara tidak terdengar jelas. Silakan coba lagi.');
      return;
    }

    if (sttService.isListening()) {
      sttService.stopListening();
    }
    this.isProcessingVoiceInput = false;
    this.onVoiceStateCallback?.(false);
  }

  public async open(form: FormContainerMetadata): Promise<void> {
    this.activeForm = form;
    this.isProcessingVoiceInput = false;
    this.editingFromSummary = false;

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
      // Pre-collect any pre-filled answers from host DOM fields
      const prePopulatedAnswers: Record<string, any> = {};
      (form.fields || []).forEach((f) => {
        if (f.currentValue) {
          prePopulatedAnswers[f.id] = f.currentValue;
          if (f.domId && f.domId !== f.id) prePopulatedAnswers[f.domId] = f.currentValue;
        }
      });

      const session = await agentService.startSession(form, compactDom, {
        answers: Object.keys(prePopulatedAnswers).length > 0 ? prePopulatedAnswers : undefined,
        stepIndex: 0
      });
      if (session && session.session_id) {
        this.activeSessionId = session.session_id;
        this.isServerMode = true;
        this.lastAgentResponse = session;
        // Keep activeForm in orchestrator for DOM binding & final host submission
        formOrchestrator['activeForm'] = form;
        formOrchestrator['answers'] = { ...prePopulatedAnswers, ...(session.answers || {}) };
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
    this.editingFromSummary = false;
    this.confirmationActive = false;
    this.confirmApprove = null;
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
      await formOrchestrator.syncToHostDOM(answersToSync);
    }

    // 5. Route by status (case-insensitive for robust server-client compatibility)
    const normStatus = (res.status || '').toLowerCase();
    if (normStatus === 'review' || normStatus === 'awaiting_confirmation' || normStatus === 'reviewing') {
      this.renderServerSummary(res);
    } else if (normStatus === 'completed') {
      await formOrchestrator.submitHostForm({ skipValidation: true });
      this.close();
    } else {
      await this.renderServerStep(res);
    }
  }

  /**
   * Recovers when the server session is gone (server reloaded / multiple workers):
   * re-initiates the agent session, or degrades to the local deterministic flow.
   */
  private async recoverServerSession(): Promise<boolean> {
    if (!this.activeForm) {
      this.isServerMode = false;
      this.activeSessionId = null;
      return false;
    }

    console.warn('[AIRA Wizard] Server session lost, re-initiating session...');
    try {
      const resumeState = formOrchestrator.getCurrentState();
      const session = await agentService.startSession(this.activeForm, this.activeCompactDom, {
        answers: resumeState?.answers,
        stepIndex: resumeState?.currentStepIndex
      });
      if (session && session.session_id) {
        this.activeSessionId = session.session_id;
        this.isServerMode = true;
        this.lastAgentResponse = session;
        formOrchestrator['activeForm'] = this.activeForm;
        formOrchestrator['answers'] = { ...(session.answers || {}) };
        await this.handleAgentStepResponse(session);
        return true;
      }
    } catch (e) {
      console.warn('[AIRA Wizard] Session recovery failed:', e);
    }

    this.isServerMode = false;
    this.activeSessionId = null;
    ttsService.speak('Koneksi ke server terputus. Beralih ke mode pengisian lokal.');
    formOrchestrator.startForm(this.activeForm);
    return false;
  }

  private async handleServerTextInput(val: string, alreadyExtracted: boolean = false): Promise<void> {
    if (!this.activeSessionId) return;
    const card = this.modalEl?.querySelector('.aira-wizard-card');
    const nextBtn = card?.querySelector('#aira-wizard-next') as HTMLButtonElement | null;
    if (nextBtn) nextBtn.disabled = true;

    try {
      let res = await agentService.interactWithText(this.activeSessionId, val, alreadyExtracted);
      if (!res && this.activeForm) {
        console.warn('[AIRA Wizard] Session expired or server reloaded, re-initiating session...');
        const resumeState = formOrchestrator.getCurrentState();
        const newSession = await agentService.startSession(this.activeForm, this.activeCompactDom, {
          answers: resumeState?.answers,
          stepIndex: resumeState?.currentStepIndex
        });
        if (newSession && newSession.session_id) {
          this.activeSessionId = newSession.session_id;
          res = await agentService.interactWithText(this.activeSessionId, val, alreadyExtracted);
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
      // Preserve all structural metadata from the server/client field (hasOther,
      // otherAllowed, canonicalType, grid context, ratingScale, ...).
      ...(fieldData || {}),
      id: fieldData?.id || fieldDataDomId || `field_${res.step_index + 1}`,
      label: fieldData?.label || 'Kolom Isian',
      type: fieldData?.type || 'text',
      placeholder: fieldData?.placeholder || '',
      required: fieldData?.required ?? true,
      currentValue: (res.answers && fieldData?.id && res.answers[fieldData.id]) || fieldData?.currentValue || '',
      options: fieldData?.options || [],
      hint: res.field_hint || fieldData?.hint || ''
    };

    const formTitle = this.activeForm?.title || 'Formulir';
    const getValidVal = (...candidates: any[]): string => {
      for (const c of candidates) {
        if (c !== undefined && c !== null && String(c).trim() !== '') {
          return String(c).trim();
        }
      }
      return '';
    };

    const currentValue = getValidVal(
      res.answers?.[field.id],
      field.domId ? res.answers?.[field.domId] : undefined,
      field.entryKeys?.[0] ? res.answers?.[field.entryKeys[0]] : undefined,
      field.currentValue,
      fieldData?.currentValue,
      this.activeForm?.fields[res.step_index]?.currentValue
    );
    console.log(`[AIRA Wizard Step] 🎯 Step ${res.step_index + 1} ("${field.label}") -> final currentValue: "${currentValue}" (from res.answers: "${res.answers?.[field.id] || ''}", field.currentValue: "${field.currentValue || ''}")`);

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
      const currentValue = state.answers[field.id] || (field.domId ? state.answers[field.domId] : '') || (field.entryKeys?.[0] ? state.answers[field.entryKeys[0]] : '') || field.currentValue || '';

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

    const toast = document.createElement('div');
    toast.className = 'aira-portal-toast';
    toast.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px;">task_alt</span><span>Formulir Terdeteksi: ${formTitle}</span>`;
    overlay.appendChild(toast);

    const card = document.createElement('div');
    card.className = 'aira-wizard-card';

    card.innerHTML = `
      <div class="aira-wizard-header">
        <div class="aira-brand">
          <span class="aira-logotype aira-logotype--gradient aira-brand-title" aria-label="AIRA">
            <span class="letter-a">A</span><span class="letters-ira">IRA</span>
          </span>
          <span class="aira-brand-badge">${formTitle}</span>
        </div>
        <button type="button" class="aira-icon-btn aira-close-wizard" title="Tutup Formulir (Esc)" aria-label="Tutup Formulir">
          <span class="material-symbols-rounded">close</span>
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
            <span class="material-symbols-rounded">volume_up</span>
          </button>
        </div>

        <div class="aira-wizard-hint">
          ${hint}
        </div>

        <div id="aira-wizard-error-slot"></div>

        <div id="aira-field-control-slot"></div>

        <button type="button" class="aira-big-voice-btn aira-voice-bar-btn" id="aira-wizard-voice-btn" title="Klik atau tahan Alt+S untuk bicara">
          <span class="material-symbols-rounded">mic</span>
          <span class="aira-voice-btn-text">Berikan pesan dengan suara (Alt+S)</span>
        </button>
      </div>

      <div class="aira-confirm-bar" id="aira-confirm-bar" style="display: none;">
        <div class="aira-confirm-text" id="aira-confirm-text"></div>
        <div class="aira-confirm-actions">
          <button type="button" class="aira-btn aira-btn-outline" id="aira-confirm-retry" title="Tekan Backspace untuk mengulangi">
            &#8635; Ulangi (Backspace)
          </button>
          <button type="button" class="aira-btn aira-btn-primary" id="aira-confirm-yes" title="Tekan Enter jika sudah benar">
            &#10003; Benar (Enter)
          </button>
        </div>
      </div>

      <div class="aira-wizard-footer">
        <button type="button" class="aira-btn aira-btn-outline" id="aira-wizard-prev" ${stepNum === 1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
          <span>← Kembali</span>
        </button>
        <button type="button" class="aira-btn aira-btn-primary" id="aira-wizard-next">
          <span>Lanjut ke ${stepNum < totalSteps ? `Langkah ${stepNum + 1}` : 'Rangkuman'} →</span>
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

    // Next step button: ask the user to confirm the answer before advancing
    card.querySelector('#aira-wizard-next')?.addEventListener('click', async () => {
      const val = this.readFieldControl(controlEl);
      if (this.confirmationActive) return;
      await this.askAnswerConfirmation(card, field, val, false);
    });

    // Confirmation bar buttons
    card.querySelector('#aira-confirm-yes')?.addEventListener('click', () => {
      this.confirmApprove?.();
    });
    card.querySelector('#aira-confirm-retry')?.addEventListener('click', () => {
      this.retryAnswerInput(card);
    });

    // Prev step button
    card.querySelector('#aira-wizard-prev')?.addEventListener('click', async () => {
      if (this.confirmationActive) return;
      if (isServerMode && this.activeSessionId) {
        const res = await agentService.stepBack(this.activeSessionId);
        if (res) {
          await this.handleAgentStepResponse(res);
        } else {
          await this.recoverServerSession();
        }
        return;
      }

      // Preserve the current input before navigating back
      formOrchestrator.stageAnswer(field.id, this.readFieldControl(controlEl));
      formOrchestrator.previousStep();
    });

    // Enter key advances (except inside a textarea)
    controlEl.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (e.key === 'Enter' && target.tagName.toLowerCase() !== 'textarea') {
        e.preventDefault();
        if (this.confirmationActive) {
          this.confirmApprove?.();
        } else {
          (card.querySelector('#aira-wizard-next') as HTMLElement)?.click();
        }
      }
    });
  }

  /**
   * Shows the answer-confirmation bar and speaks the captured answer back.
   * Voice answers (and Voice-Only mode) also listen for a spoken yes/no decision.
   */
  private async askAnswerConfirmation(
    card: HTMLElement,
    field: FormFieldMetadata,
    value: string,
    fromVoice: boolean,
    alreadyExtracted: boolean = false
  ): Promise<void> {
    if (this.confirmationActive) return;

    const confirmBar = card.querySelector('#aira-confirm-bar') as HTMLElement | null;
    const confirmText = card.querySelector('#aira-confirm-text') as HTMLElement | null;
    const nextBtn = card.querySelector('#aira-wizard-next') as HTMLButtonElement | null;
    const errorSlot = card.querySelector('#aira-wizard-error-slot') as HTMLElement | null;
    const controlEl = card.querySelector('#aira-field-control') as HTMLElement | null;

    // No confirmation UI available (e.g. summary screen) → proceed directly
    if (!confirmBar || !confirmText) {
      await this.applyAnswer(field, value, card, errorSlot, controlEl, alreadyExtracted);
      return;
    }

    this.confirmationActive = true;
    confirmText.innerText = `${field.label}: "${value}" — apakah sudah benar?`;
    confirmBar.style.display = 'flex';
    if (nextBtn) nextBtn.disabled = true;
    soundEffects.playStep();

    const prompt = `Anda mengisi ${field.label}: ${value}. Apakah sudah benar? Tekan Enter jika benar, atau tekan Backspace untuk mengulangi.`;
    ttsService.speak(prompt);

    const approve = () => {
      if (!this.confirmationActive) return;
      this.confirmationActive = false;
      this.confirmApprove = null;
      confirmBar.style.display = 'none';
      if (nextBtn) nextBtn.disabled = false;
      soundEffects.playConfirmation();
      void this.applyAnswer(field, value, card, errorSlot, controlEl, alreadyExtracted);
    };

    this.confirmApprove = approve;
  }

  /** Dismisses confirmation and focuses back on the input for correction without auto-mic. */
  private retryAnswerInput(card: HTMLElement): void {
    this.confirmationActive = false;
    this.confirmApprove = null;
    sttService.stopListening();

    const confirmBar = card.querySelector('#aira-confirm-bar') as HTMLElement | null;
    const nextBtn = card.querySelector('#aira-wizard-next') as HTMLButtonElement | null;
    const inputEl = (
      card.querySelector('#aira-step-input') ||
      card.querySelector('#aira-field-control input:not([type="hidden"]), #aira-field-control select, #aira-field-control textarea')
    ) as HTMLElement | null;

    if (confirmBar) confirmBar.style.display = 'none';
    if (nextBtn) nextBtn.disabled = false;

    ttsService.stop();
    soundEffects.playStep();
    ttsService.speak('Silakan isi kembali.');

    setTimeout(() => {
      inputEl?.focus();
      if (inputEl instanceof HTMLInputElement) {
        inputEl.select();
      }
    }, 100);
  }

  /** Applies a confirmed answer: advances locally or sends it to the agent. */
  private async applyAnswer(
    field: FormFieldMetadata,
    value: string,
    card: HTMLElement | null,
    errorSlot: HTMLElement | null,
    controlEl: HTMLElement | null,
    alreadyExtracted: boolean = false
  ): Promise<void> {
    if (this.isServerMode && this.activeSessionId) {
      await this.handleServerTextInput(value, alreadyExtracted);
      return;
    }

    if (!errorSlot || !controlEl) return;

    // Editing from the summary: save this field and return directly to the summary
    if (this.editingFromSummary) {
      const setRes = formOrchestrator.setAnswer(field.id, value, false);
      if (!setRes.success) {
        this.showError(errorSlot, controlEl, setRes.error || 'Format tidak valid');
        ttsService.speak(setRes.error || 'Format tidak valid');
        return;
      }
      this.clearError(errorSlot, controlEl);
      this.onInteractionCallback?.(`Jawaban ${field.label}: ${value}`);
      this.editingFromSummary = false;
      const state = formOrchestrator.getCurrentState();
      formOrchestrator.goToStep(state ? state.totalSteps : 0);
      return;
    }

    const advRes = formOrchestrator.saveAndAdvance(field.id, value);
    if (!advRes.success) {
      this.showError(errorSlot, controlEl, advRes.error || 'Format tidak valid');
      ttsService.speak(advRes.error || 'Format tidak valid');
    } else {
      this.clearError(errorSlot, controlEl);
      this.onInteractionCallback?.(`Jawaban ${field.label}: ${value}`);
    }
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

        // If currentValue is not one of the standard options, it's the "Other" value!
        const matchedStandard = options.some((opt) => selected.includes(opt.toLowerCase()));
        if (!matchedStandard && currentValue && currentValue.trim()) {
          input.checked = true;
          otherInput.value = currentValue.trim();
        }

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
      placeholder.textContent = field.placeholder || 'Pilih salah satu opsi...';
      select.appendChild(placeholder);

      options.forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        select.appendChild(opt);
      });

      if (currentValue) {
        const curLower = currentValue.toLowerCase().trim();
        const match = options.find((opt) => {
          const optLower = opt.toLowerCase().trim();
          return optLower === curLower || optLower.includes(curLower) || curLower.includes(optLower);
        });
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
    input.placeholder = field.placeholder || (input.type === 'date' ? 'YYYY-MM-DD' : `Ketik atau ucapkan ${field.label}...`);

    if (input.type === 'date' && currentValue) {
      const iso = this.parseDateToISO(currentValue);
      input.value = iso || currentValue;
    } else {
      input.value = currentValue || '';
    }
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

  private static levenshtein(a: string, b: string): number {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    for (let i = 0; i < rows; i++) dp[i][0] = i;
    for (let j = 0; j < cols; j++) dp[0][j] = j;
    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[a.length][b.length];
  }

  /** Fuzzy-matches a spoken value to an allowed option (e.g. "Fahiz" -> "Faiz"). */
  private fuzzyChoiceMatch(value: string, options: string[], cutoff: number = 0.75): string | null {
    const normalize = (text: string) => text.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const normalized = normalize(value);
    if (!normalized) return null;

    let best: string | null = null;
    let bestScore = 0;
    for (const option of options) {
      const target = normalize(option);
      if (!target) continue;
      const distance = FormWizardComponent.levenshtein(normalized, target);
      const score = 1 - distance / Math.max(normalized.length, target.length);
      if (score > bestScore) {
        bestScore = score;
        best = option;
      }
    }
    return bestScore >= cutoff ? best : null;
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

  public parseDateToISO(valStr: string): string | null {
    if (!valStr) return null;
    const trimmed = valStr.trim();

    // Check if previous buggy concatenation occurred: "2026-09-18-2026-09-18-2026-09-18"
    const multiMatch = trimmed.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
    if (multiMatch) {
      const year = multiMatch[1];
      const month = multiMatch[2].padStart(2, '0');
      const day = multiMatch[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    const monthMap: Record<string, string> = {
      jan: '01', januari: '01', january: '01',
      feb: '02', februari: '02', february: '02',
      mar: '03', maret: '03', march: '03',
      apr: '04', april: '04',
      mei: '05', may: '05',
      jun: '06', juni: '06', june: '06',
      jul: '07', juli: '07', july: '07',
      agu: '08', agt: '08', agustus: '08', aug: '08', august: '08',
      sep: '09', september: '09',
      okt: '10', oktober: '10', oct: '10', october: '10',
      nov: '11', november: '11',
      des: '12', desember: '12', dec: '12', december: '12'
    };

    // 1. DD/MM/YYYY or DD-MM-YYYY
    const dmy = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (dmy) {
      return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }

    // 2. Textual DD Month YYYY (e.g. 18 September 2026)
    const textDmy = trimmed.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/);
    if (textDmy) {
      const day = textDmy[1].padStart(2, '0');
      const mStr = textDmy[2].toLowerCase();
      const month = monthMap[mStr];
      const year = textDmy[3];
      if (month) return `${year}-${month}-${day}`;
    }

    return null;
  }

  /** Writes a value into any control produced by buildFieldControl (used by voice). */
  private writeFieldControl(control: HTMLElement, value: string): void {
    const select = control.querySelector('select') as HTMLSelectElement | null;
    if (select) {
      const valLower = value.toLowerCase().trim();
      const match = Array.from(select.options).find(
        (opt) => {
          const optVal = opt.value.toLowerCase().trim();
          const optText = opt.text.toLowerCase().trim();
          return optVal === valLower || optText === valLower || optText.includes(valLower) || valLower.includes(optText);
        }
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
      const selectableOptions = choices.filter((choice) => choice.value !== '__other_option__').map((choice) => choice.value);
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

      // Fuzzy fallback: snap near-miss transcripts to the closest allowed option.
      if (!matched) {
        for (const part of parts) {
          const fuzzy = this.fuzzyChoiceMatch(part, selectableOptions);
          const el = fuzzy ? choices.find((choice) => choice.value === fuzzy) : null;
          if (el) {
            el.checked = true;
            matched = true;
          }
        }
      }

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
    if (input) {
      if (input.type === 'date' && value) {
        const iso = this.parseDateToISO(value);
        input.value = iso || value;
      } else {
        input.value = value;
      }
    }
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
    const fields = this.activeForm?.fields || formOrchestrator['activeForm']?.fields || [];

    if (fields.length > 0) {
      fields.forEach((field, idx) => {
        const val = answers[field.id] ?? (field.domId ? answers[field.domId] : undefined) ?? field.currentValue ?? '';
        summaryItemsHtml += `
          <div class="aira-summary-item">
            <div class="aira-summary-info">
              <span class="aira-summary-label">${field.label}</span>
              <span class="aira-summary-val">${val || '-'}</span>
            </div>
            <button type="button" class="aira-summary-edit-btn" data-step="${idx}" data-field-id="${field.id}">
              Ubah
            </button>
          </div>
        `;
      });
    } else {
      const entries = Object.entries(answers).filter(([k]) => !k.startsWith('entry.') && !k.endsWith('_sentinel'));
      entries.forEach(([fieldId, val], idx) => {
        summaryItemsHtml += `
          <div class="aira-summary-item">
            <div class="aira-summary-info">
              <span class="aira-summary-label">${fieldId}</span>
              <span class="aira-summary-val">${val || '-'}</span>
            </div>
            <button type="button" class="aira-summary-edit-btn" data-step="${idx}" data-field-id="${fieldId}">
              Ubah
            </button>
          </div>
        `;
      });
    }

    const toast = document.createElement('div');
    toast.className = 'aira-portal-toast';
    toast.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px;">fact_check</span><span>Rangkuman Pengisian: Periksa Data</span>`;
    overlay.appendChild(toast);

    card.innerHTML = `
      <div class="aira-wizard-header">
        <div class="aira-brand">
          <span class="aira-logotype aira-logotype--gradient aira-brand-title" aria-label="AIRA">
            <span class="letter-a">A</span><span class="letters-ira">IRA</span>
          </span>
          <span class="aira-brand-badge">Rangkuman Pengisian</span>
        </div>
        <button type="button" class="aira-icon-btn aira-close-wizard" title="Tutup (Esc)" aria-label="Tutup">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>

      <div class="aira-wizard-body">
        <div class="aira-wizard-title-wrap">
          <div class="aira-wizard-title">
            Periksa data Anda di bawah ini
          </div>
          <button type="button" class="aira-read-aloud-btn" id="aira-summary-read" title="Bacakan rangkuman" aria-label="Bacakan rangkuman">
            <span class="material-symbols-rounded">volume_up</span>
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

        <button type="button" class="aira-big-voice-btn aira-voice-bar-btn" id="aira-summary-voice-btn" title="Klik atau tahan Alt+S untuk bicara konfirmasi / koreksi">
          <span class="material-symbols-rounded">mic</span>
          <span class="aira-voice-btn-text">Konfirmasi Suara / Koreksi (Alt+S)</span>
        </button>
      </div>

      <div class="aira-wizard-footer">
        <button type="button" class="aira-btn aira-btn-outline" id="aira-summary-back">
          <span>← Kembali Edit</span>
        </button>
        <button type="button" class="aira-btn aira-btn-primary" id="aira-summary-submit">
          <span>Kirim Formulir Sekarang ✔</span>
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
        } else {
          await this.recoverServerSession();
        }
        return;
      }

      this.editingFromSummary = false;
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
          } else {
            await this.recoverServerSession();
          }
          return;
        }

        this.editingFromSummary = true;
        formOrchestrator.goToStep(step);
      });
    });

    // Submit button: executes sync AND triggers real host submission end-to-end!
    card.querySelector('#aira-summary-submit')?.addEventListener('click', async () => {
      if (isServerMode && this.activeSessionId) {
        const res = await agentService.confirmSubmission(this.activeSessionId, 'ya');
        if (res) {
          if (res.sync_payload) {
            await formOrchestrator.syncToHostDOM(res.sync_payload);
          }
          const submitRes = await formOrchestrator.submitHostForm({ skipValidation: true });
          this.close();

          soundEffects.playServerCue(res.audio_cue || 'complete');
          const finalMsg = res.spoken_prompt || (submitRes.success ? 'Data formulir berhasil diisi dan dikirimkan!' : submitRes.message);
          ttsService.speak(finalMsg);
          this.onInteractionCallback?.(finalMsg);
          return;
        }
      }

      // Local mode submit
      const submitRes = await formOrchestrator.submitHostForm();
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

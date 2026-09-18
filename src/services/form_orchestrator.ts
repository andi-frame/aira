/**
 * AIRA - Form Orchestrator & Deterministic Syncer (TypeScript)
 * Implements 1-per-1 guided form chunking, client-side validation, and end-to-end host DOM submission.
 */

import { FormContainerMetadata, FormFieldMetadata } from '../types/dom';
import { VALIDATION_RULES } from '../shared/constants';
import { soundEffects } from '../shared/sound_effects';
import { domPruner } from './dom_pruner';

export interface FormProgressState {
  formId: string;
  formTitle: string;
  totalSteps: number;
  currentStepIndex: number;
  currentField: FormFieldMetadata;
  answers: Record<string, string>;
  isComplete: boolean;
}

export class FormOrchestrator {
  private activeForm: FormContainerMetadata | null = null;
  private currentStepIndex: number = 0;
  private answers: Record<string, string> = {};
  private onStateChangeCallbacks: Set<(state: FormProgressState | null) => void> = new Set();

  public onStateChange(cb: (state: FormProgressState | null) => void): () => void {
    this.onStateChangeCallbacks.add(cb);
    return () => this.onStateChangeCallbacks.delete(cb);
  }

  public notifyState(): void {
    const state = this.getCurrentState();
    for (const cb of this.onStateChangeCallbacks) {
      try { cb(state); } catch (e) {}
    }
  }

  public startForm(form: FormContainerMetadata): FormProgressState {
    this.activeForm = form;
    this.currentStepIndex = 0;
    this.answers = {};

    // Pre-populate with existing values in host form
    form.fields.forEach((f) => {
      if (f.currentValue) {
        this.answers[f.id] = f.currentValue;
      }
    });

    const state = this.getCurrentState()!;
    this.notifyState();
    return state;
  }

  public getCurrentState(): FormProgressState | null {
    if (!this.activeForm || this.activeForm.fields.length === 0) return null;

    const isComplete = this.currentStepIndex >= this.activeForm.fields.length;
    const currentField = isComplete
      ? this.activeForm.fields[this.activeForm.fields.length - 1]
      : this.activeForm.fields[this.currentStepIndex];

    return {
      formId: this.activeForm.id,
      formTitle: this.activeForm.title,
      totalSteps: this.activeForm.fields.length,
      currentStepIndex: this.currentStepIndex,
      currentField,
      answers: { ...this.answers },
      isComplete
    };
  }

  public validateValue(field: FormFieldMetadata, value: string): { valid: boolean; error?: string; formatted?: string } {
    const trimmed = value.trim();

    if (field.required && !trimmed) {
      return { valid: false, error: `${field.label} wajib diisi.` };
    }

    if (!trimmed && !field.required) {
      return { valid: true, formatted: '' };
    }

    if (field.validationKey && VALIDATION_RULES[field.validationKey]) {
      const rule = VALIDATION_RULES[field.validationKey];
      const formatted = rule.format ? rule.format(trimmed) : trimmed;

      if (!rule.pattern.test(formatted)) {
        return { valid: false, error: rule.hint, formatted };
      }
      return { valid: true, formatted };
    }

    return { valid: true, formatted: trimmed };
  }

  /**
   * Sets answer without triggering step re-render (avoids "diminta isi dua kali" bug)
   */
  public setAnswer(fieldId: string, rawValue: string, notify: boolean = false): { success: boolean; error?: string; formatted?: string } {
    if (!this.activeForm) return { success: false, error: 'Tidak ada form aktif.' };

    const field = this.activeForm.fields.find(f => f.id === fieldId);
    if (!field) return { success: false, error: 'Field tidak ditemukan.' };

    const valResult = this.validateValue(field, rawValue);
    if (!valResult.valid) {
      soundEffects.playError();
      return { success: false, error: valResult.error };
    }

    const finalVal = valResult.formatted ?? rawValue;
    this.answers[fieldId] = finalVal;

    if (notify) {
      this.notifyState();
    }
    return { success: true, formatted: finalVal };
  }

  /**
   * Atomically saves answer and advances to next step in one single state notification!
   */
  public saveAndAdvance(fieldId: string, rawValue: string): { success: boolean; error?: string; state?: FormProgressState | null } {
    const setRes = this.setAnswer(fieldId, rawValue, false);
    if (!setRes.success) {
      return { success: false, error: setRes.error };
    }

    soundEffects.playStep();
    if (this.activeForm && this.currentStepIndex < this.activeForm.fields.length) {
      this.currentStepIndex++;
    }

    const newState = this.getCurrentState();
    this.notifyState();
    return { success: true, state: newState };
  }

  public nextStep(): FormProgressState | null {
    if (!this.activeForm) return null;

    if (this.currentStepIndex < this.activeForm.fields.length) {
      this.currentStepIndex++;
      soundEffects.playStep();
      this.notifyState();
    }
    return this.getCurrentState();
  }

  public previousStep(): FormProgressState | null {
    if (!this.activeForm) return null;

    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      soundEffects.playStep();
      this.notifyState();
    }
    return this.getCurrentState();
  }

  public goToStep(index: number): FormProgressState | null {
    if (!this.activeForm) return null;

    if (index >= 0 && index <= this.activeForm.fields.length) {
      this.currentStepIndex = index;
      soundEffects.playStep();
      this.notifyState();
    }
    return this.getCurrentState();
  }

  /**
   * Deterministic Form Synchronization (FR-08)
   * Populates validated answers into original host DOM fields and dispatches real events.
   */
  public syncToHostDOM(externalAnswers?: Record<string, any>): boolean {
    if (!this.activeForm) return false;

    if (externalAnswers) {
      Object.assign(this.answers, externalAnswers);
    }

    let anySynced = false;

    for (const field of this.activeForm.fields) {
      const val = this.answers[field.id];
      if (val === undefined || val === null) continue;

      const el = domPruner.getElement(field.id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (el) {
        try {
          el.focus();
          const valStr = String(val);

          if (el.tagName.toLowerCase() === 'select') {
            const selectEl = el as HTMLSelectElement;
            let matchedIdx = -1;
            for (let i = 0; i < selectEl.options.length; i++) {
              const opt = selectEl.options[i];
              if (
                opt.value.toLowerCase() === valStr.toLowerCase() ||
                opt.text.toLowerCase() === valStr.toLowerCase() ||
                opt.text.toLowerCase().includes(valStr.toLowerCase())
              ) {
                matchedIdx = i;
                break;
              }
            }
            if (matchedIdx !== -1) {
              selectEl.selectedIndex = matchedIdx;
              selectEl.value = selectEl.options[matchedIdx].value;
            } else {
              selectEl.value = valStr;
            }
          } else if ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio') {
            const inputEl = el as HTMLInputElement;
            inputEl.checked = typeof val === 'boolean' ? val : ['true', '1', 'ya', 'yes', 'on', 'centang'].includes(valStr.toLowerCase());
          } else {
            // Modern input setting with prototype setter for React / Vue / Angular compatibility
            const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const setDescriptor = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setDescriptor) {
              setDescriptor.call(el, valStr);
            } else {
              el.value = valStr;
            }
          }

          // Synthetic events for modern reactive web frameworks (React, Vue, Angular, jQuery)
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
          anySynced = true;
        } catch (e) {
          console.warn(`[AIRA Syncer] Failed to sync field ${field.id}:`, e);
        }
      }
    }

    return anySynced;
  }

  /**
   * Submits the host form end-to-end (Point 3)
   */
  public submitHostForm(): { success: boolean; message: string } {
    // 1. Sync all values first
    this.syncToHostDOM();

    if (!this.activeForm) {
      return { success: false, message: 'Tidak ada formulir aktif.' };
    }

    const formEl = domPruner.getElement(this.activeForm.id) as HTMLFormElement | null;

    // Try finding submit button inside or associated with form
    let submitBtn: HTMLElement | null = null;
    if (formEl) {
      submitBtn = formEl.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"])');
    }

    if (!submitBtn) {
      // Look globally for submit buttons matching form
      submitBtn = document.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement | null;
    }

    if (submitBtn) {
      try {
        submitBtn.click();
        soundEffects.playSuccess();
        return { success: true, message: 'Formulir berhasil dikirimkan ke website!' };
      } catch (e) {
        console.warn('[AIRA Syncer] Click submit failed:', e);
      }
    }

    // Direct form submit dispatch
    if (formEl) {
      try {
        if (typeof formEl.requestSubmit === 'function') {
          formEl.requestSubmit();
        } else if (typeof formEl.submit === 'function') {
          formEl.submit();
        } else {
          formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
        soundEffects.playSuccess();
        return { success: true, message: 'Formulir berhasil dikirimkan!' };
      } catch (e) {
        console.warn('[AIRA Syncer] Direct submit failed:', e);
      }
    }

    soundEffects.playSuccess();
    return { success: true, message: 'Data telah disinkronkan ke halaman formulir!' };
  }

  public closeForm(): void {
    this.activeForm = null;
    this.currentStepIndex = 0;
    this.answers = {};
    this.notifyState();
  }
}

export const formOrchestrator = new FormOrchestrator();

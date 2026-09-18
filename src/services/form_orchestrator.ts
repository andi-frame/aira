/**
 * AIRA - Form Orchestrator & Deterministic Syncer (TypeScript)
 * Implements 1-per-1 guided form chunking, client-side validation, and end-to-end host DOM submission.
 */

import { FormContainerMetadata, FormFieldMetadata } from '../types/dom';
import { VALIDATION_RULES } from '../shared/constants';
import { soundEffects } from '../shared/sound_effects';
import { domPruner } from './dom_pruner';
import { validateFieldAnswer } from './response_validation';

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
        if (f.domId && f.domId !== f.id) this.answers[f.domId] = f.currentValue;
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

    // Deterministic Google Forms constraints (options, scale, date/time, ...)
    if (field.canonicalType || (field.entryIds && field.entryIds.length > 0)) {
      const structural = validateFieldAnswer(field, trimmed);
      if (!structural.valid) {
        return { valid: false, error: structural.error, formatted: trimmed };
      }
    }

    return { valid: true, formatted: trimmed };
  }

  /**
   * Stores a draft answer without validation. Used when navigating back so the
   * user's in-progress input is not lost (validation happens on forward/Next).
   */
  public stageAnswer(fieldId: string, rawValue: string): void {
    if (!this.activeForm) return;
    if (!this.activeForm.fields.some((f) => f.id === fieldId)) return;
    this.answers[fieldId] = rawValue;
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
  public async syncToHostDOM(externalAnswers?: Record<string, any>): Promise<boolean> {
    if (!this.activeForm) return false;

    if (externalAnswers) {
      Object.assign(this.answers, externalAnswers);
    }

    // Clean up any rogue inputs dynamically injected directly into <form> or <body> in previous runs
    try {
      const rogueInputs = document.querySelectorAll<HTMLInputElement>(
        'form > input[type="hidden"][name^="entry."], body > input[type="hidden"][name^="entry."], input[data-aira-injected="true"]'
      );
      rogueInputs.forEach((h) => {
        if (!h.name.endsWith('_sentinel') && !h.closest('.Qr7Oae, [role="listitem"]')) {
          h.remove();
        }
      });
    } catch (e) {
      console.warn('[AIRA Syncer] Cleanup rogue inputs error:', e);
    }

    let anySynced = false;

    for (const field of this.activeForm.fields) {
      const val = this.answers[field.id] ?? 
        (field.domId ? this.answers[field.domId] : undefined) ?? 
        (field.entryKeys?.[0] ? this.answers[field.entryKeys[0]] : undefined);
      if (val === undefined || val === null) continue;

      try {
        const valStr = String(val).trim();

        // 1. Handling Option Bindings (Radio groups, Google Forms ARIA radios, Rating scales, Checkbox groups)
        if (field.optionBindings && field.optionBindings.length > 0) {
          const valLower = valStr.toLowerCase();
          
          if (field.type === 'checkbox_group') {
            // Multiple selections: can be array or comma/pipe separated
            const chosenList = Array.isArray(val) ? val.map(v => String(v).toLowerCase().trim()) : valLower.split(/[,|]/).map(s => s.trim());
            let matchedAny = false;
            for (const binding of field.optionBindings) {
              const optLower = binding.option.toLowerCase();
              const isOtherOption = optLower.includes('other') || optLower.includes('lainnya');
              const isChosen = chosenList.some(c => optLower.includes(c) || c.includes(optLower));
              const el = domPruner.getElement(binding.ref);
              if (el && !isOtherOption) {
                const isAlreadyChecked = (el as HTMLInputElement).checked || el.getAttribute('aria-checked') === 'true';
                if (isChosen) {
                  matchedAny = true;
                  if (!isAlreadyChecked) {
                    this.triggerSyntheticSelection(el);
                  }
                } else if (isAlreadyChecked) {
                  this.triggerSyntheticSelection(el);
                }
              }
            }

            // If user's answer is a custom answer not matching predefined options, or if user explicitly chose Other
            if (!matchedAny || chosenList.some(c => c.includes('other') || c.includes('lainnya'))) {
              const otherBinding = field.optionBindings.find(b => b.option.toLowerCase().includes('other') || b.option.toLowerCase().includes('lainnya'));
              if (otherBinding) {
                const otherEl = domPruner.getElement(otherBinding.ref);
                if (otherEl) {
                  const isChecked = (otherEl as HTMLInputElement).checked || otherEl.getAttribute('aria-checked') === 'true';
                  if (!isChecked) this.triggerSyntheticSelection(otherEl);
                }
              }
              let otherInput = field.otherInputRef ? (domPruner.getElement(field.otherInputRef) as HTMLInputElement | null) : null;
              if (!otherInput) {
                const fieldCard = (domPruner.getElement(field.id) as HTMLElement | null)?.closest<HTMLElement>('.Qr7Oae, [role="listitem"]');
                if (fieldCard) {
                  otherInput = fieldCard.querySelector<HTMLInputElement>('input.whsOnd, input[type="text"]:not([type="hidden"])');
                }
              }
              if (otherInput) {
                const customText = chosenList.filter(c => !c.includes('other') && !c.includes('lainnya')).join(', ') || valStr;
                this.setNativeInputValue(otherInput, customText);
              }
            } else {
              // Predefined options chosen: ensure companion other input is cleared
              let otherInput = field.otherInputRef ? (domPruner.getElement(field.otherInputRef) as HTMLInputElement | null) : null;
              if (!otherInput) {
                const fieldCard = (domPruner.getElement(field.id) as HTMLElement | null)?.closest<HTMLElement>('.Qr7Oae, [role="listitem"]');
                if (fieldCard) {
                  otherInput = fieldCard.querySelector<HTMLInputElement>('input.whsOnd, input[type="text"]:not([type="hidden"])');
                }
              }
              if (otherInput) {
                this.setNativeInputValue(otherInput, '');
              }
            }

            anySynced = true;
            continue;
          }

          // Single selection (Radio, Star Rating, or Select)
          let matchedBinding = field.optionBindings.find(b => 
            b.option.toLowerCase() === valLower || 
            (b.value && b.value.toLowerCase() === valLower)
          );
          if (!matchedBinding) {
            matchedBinding = field.optionBindings.find(b => 
              (!b.option.toLowerCase().includes('other') && !b.option.toLowerCase().includes('lainnya')) &&
              (b.option.toLowerCase().includes(valLower) || valLower.includes(b.option.toLowerCase()))
            );
          }

          if (matchedBinding) {
            const targetEl = domPruner.getElement(matchedBinding.ref);
            if (targetEl) {
              this.triggerSyntheticSelection(targetEl);
              // Clear other text input if user selected a predefined option
              let otherInput = field.otherInputRef ? (domPruner.getElement(field.otherInputRef) as HTMLInputElement | null) : null;
              if (!otherInput) {
                const fieldCard = targetEl.closest<HTMLElement>('.Qr7Oae, [role="listitem"]');
                if (fieldCard) {
                  otherInput = fieldCard.querySelector<HTMLInputElement>('input.whsOnd, input[type="text"]:not([type="hidden"])');
                }
              }
              if (otherInput) {
                this.setNativeInputValue(otherInput, '');
              }
              anySynced = true;
              continue;
            }
          } else {
            // No predefined option matched: check if field has "Other" option
            const otherBinding = field.optionBindings.find(b => b.option.toLowerCase().includes('other') || b.option.toLowerCase().includes('lainnya'));
            if (otherBinding) {
              const targetEl = domPruner.getElement(otherBinding.ref);
              if (targetEl) {
                this.triggerSyntheticSelection(targetEl);
                let otherInput = field.otherInputRef ? (domPruner.getElement(field.otherInputRef) as HTMLInputElement | null) : null;
                if (!otherInput) {
                  const fieldCard = targetEl.closest<HTMLElement>('.Qr7Oae, [role="listitem"]');
                  if (fieldCard) {
                    otherInput = fieldCard.querySelector<HTMLInputElement>('input.whsOnd, input[type="text"]:not([type="hidden"])');
                  }
                }
                if (otherInput) {
                  this.setNativeInputValue(otherInput, valStr);
                }
                anySynced = true;
                continue;
              }
            }
          }
        }

        // 2. Direct Element Lookup & Context Resolution
        let el = domPruner.getElement(field.id) as HTMLElement | null;
        if (!el && field.domId) {
          el = document.getElementById(field.domId) as HTMLElement | null;
        }
        if (!el && field.entryKeys && field.entryKeys.length > 0) {
          el = document.querySelector<HTMLElement>(
            `[name="${field.entryKeys[0]}"]:not([type="hidden"]):not([name$="_sentinel"])`
          );
        }
        if (!el && (field.type === 'email' || field.entryKeys?.includes('emailAddress'))) {
          el = document.querySelector<HTMLElement>(
            'input[type="email"], input[autocomplete="email"], input[name="emailAddress"]'
          );
        }

        // If el resolved to a container/card rather than an input itself, find the inner editable input
        if (el && !['input', 'textarea', 'select'].includes(el.tagName.toLowerCase()) && !el.hasAttribute('role')) {
          const innerInput = el.querySelector<HTMLElement>(
            'input.whsOnd:not([type="hidden"]), textarea.KHxj8b, [role="listbox"], [role="radio"], [role="checkbox"], input:not([type="hidden"]), textarea, select'
          );
          if (innerInput) el = innerInput;
        }

        let card = el ? (el.closest('.Qr7Oae, [role="listitem"], .freebirdFormviewerComponentsQuestionBase, fieldset, .form-card, .form-group') as HTMLElement | null) : null;
        if (!card && field.entryKeys && field.entryKeys.length > 0) {
          const sentinel = document.querySelector<HTMLElement>(`[name="${field.entryKeys[0]}_sentinel"], [name="${field.entryKeys[0]}"]`);
          if (sentinel) {
            card = sentinel.closest<HTMLElement>('.Qr7Oae, [role="listitem"], .freebirdFormviewerComponentsQuestionBase, fieldset, .form-card, .form-group');
          }
        }
        if (!card && field.label) {
          const cleanTitle = field.label.toLowerCase().replace(/[*?:!]/g, '').trim();
          const allCards = Array.from(document.querySelectorAll<HTMLElement>('.Qr7Oae, [role="listitem"], .freebirdFormviewerComponentsQuestionBase, fieldset'));
          for (const c of allCards) {
            const titleEl = c.querySelector('.M7eMe, [role="heading"], .freebirdFormviewerComponentsQuestionBaseTitle, .question-title');
            const text = (titleEl?.textContent || c.textContent || '').toLowerCase().replace(/[*?:!]/g, '').trim();
            if (text && cleanTitle && (text.includes(cleanTitle) || cleanTitle.includes(text))) {
              card = c;
              break;
            }
          }
        }

        if (card && !el) {
          el = card.querySelector<HTMLElement>('[role="listbox"], input:not([type="hidden"]), textarea, select');
        }

        // 3. Composite Time Field Handler (HH:MM split for Google Forms / segmented inputs)
        if (field.type === 'time' || field.canonicalType === 'time') {
          const timeMatch = valStr.match(/(\d{1,2})[:.](\d{1,2})(?:\s*(am|pm))?/i);
          if (timeMatch) {
            const hour = timeMatch[1].padStart(2, '0');
            const minute = timeMatch[2].padStart(2, '0');
            const ampmStr = timeMatch[3]?.toUpperCase();

            const hourInput = (card ? card.querySelector<HTMLElement>('input[name$="_hour"], input[aria-label*="Jam" i], input[aria-label*="Hour" i]') : null) ||
              (field.entryKeys?.[0] ? document.querySelector<HTMLElement>(`[name="${field.entryKeys[0]}_hour"]`) : null);
            const minuteInput = (card ? card.querySelector<HTMLElement>('input[name$="_minute"], input[aria-label*="Menit" i], input[aria-label*="Minute" i]') : null) ||
              (field.entryKeys?.[0] ? document.querySelector<HTMLElement>(`[name="${field.entryKeys[0]}_minute"]`) : null);

            if (hourInput && minuteInput) {
              this.setNativeInputValue(hourInput, hour);
              this.setNativeInputValue(minuteInput, minute);

              const ampmEl = card ? card.querySelector<HTMLElement>('[role="listbox"][aria-label*="AM" i], [role="listbox"][aria-label*="PM" i], select[name$="_ampm"]') : null;
              if (ampmEl) {
                let targetPeriod = ampmStr;
                if (!targetPeriod) {
                  const hNum = parseInt(hour, 10);
                  targetPeriod = hNum >= 12 ? 'PM' : 'AM';
                }
                if (ampmEl.tagName.toLowerCase() === 'select') {
                  (ampmEl as HTMLSelectElement).value = targetPeriod;
                  ampmEl.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                  await this.selectListboxOption(ampmEl, targetPeriod);
                }
              }
              anySynced = true;
              continue;
            }
          }
        }

        // 4. Date Field Handler (ISO, DMY, textual Indonesian dates for Google Forms & native inputs)
        if (field.type === 'date' || field.canonicalType === 'date') {
          const parsed = this.parseDateParts(valStr);
          const iso = parsed ? parsed.iso : valStr;
          const day = parsed ? parsed.day : '';
          const month = parsed ? parsed.month : '';
          const year = parsed ? parsed.year : '';

          // 4a. Single HTML5 date input or combined Google Forms text input
          const nativeDateInput = (card ? card.querySelector<HTMLInputElement>('input[type="date"]') : null) ||
            (el instanceof HTMLInputElement && el.type === 'date' ? el : null);
          if (nativeDateInput) {
            this.setNativeInputValue(nativeDateInput, iso);
          }

          const combinedTextInput = card ? card.querySelector<HTMLInputElement>(
            'input[type="text"].whsOnd[aria-label*="Hari, bulan, tahun" i], input[type="text"].whsOnd[aria-label*="Day, month, year" i]'
          ) : null;
          if (combinedTextInput) {
            this.setNativeInputValue(combinedTextInput, iso);
          }

          // 4b. Segmented day/month/year inputs (explicitly excluding combined input)
          const dayInput = (card ? card.querySelector<HTMLElement>(
            'input[name$="_day"], input[placeholder*="dd" i], input[aria-label*="Hari" i]:not([aria-label*="bulan" i])'
          ) : null) || (field.entryKeys?.[0] ? document.querySelector<HTMLElement>(`[name="${field.entryKeys[0]}_day"]`) : null);

          const monthInput = (card ? card.querySelector<HTMLElement>(
            'input[name$="_month"], input[placeholder*="mm" i], input[aria-label*="Bulan" i]:not([aria-label*="tahun" i])'
          ) : null) || (field.entryKeys?.[0] ? document.querySelector<HTMLElement>(`[name="${field.entryKeys[0]}_month"]`) : null);

          const yearInput = (card ? card.querySelector<HTMLElement>(
            'input[name$="_year"], input[placeholder*="yyyy" i], input[aria-label*="Tahun" i]:not([aria-label*="bulan" i])'
          ) : null) || (field.entryKeys?.[0] ? document.querySelector<HTMLElement>(`[name="${field.entryKeys[0]}_year"]`) : null);

          if (dayInput && day) this.setNativeInputValue(dayInput, day);
          if (monthInput && month) this.setNativeInputValue(monthInput, month);
          if (yearInput && year) this.setNativeInputValue(yearInput, year);

          // 4c. Update existing hidden entries for Google Forms date submission if present
          if (field.entryKeys && field.entryKeys[0]) {
            const ek = field.entryKeys[0];
            this.updateExistingHiddenEntry(ek, iso);
            if (year) this.updateExistingHiddenEntry(`${ek}_year`, year);
            if (month) this.updateExistingHiddenEntry(`${ek}_month`, month);
            if (day) this.updateExistingHiddenEntry(`${ek}_day`, day);
          }

          anySynced = true;
          continue;
        }

        // 5. Dropdown / Select Field Handler (Google Forms ARIA Listbox & Native Select)
        if (field.type === 'select' || field.canonicalType === 'dropdown' || el?.getAttribute('role') === 'listbox' || el?.getAttribute('aria-haspopup') === 'listbox') {
          const targetListbox = (card ? card.querySelector<HTMLElement>('[role="listbox"]') : null) ||
            (el?.getAttribute('role') === 'listbox' || el?.getAttribute('aria-haspopup') === 'listbox' ? el : null);

          if (targetListbox) {
            await this.selectListboxOption(targetListbox, valStr);
          } else if (el && el.tagName.toLowerCase() === 'select') {
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
            if (matchedIdx >= 0) {
              selectEl.selectedIndex = matchedIdx;
              selectEl.dispatchEvent(new Event('input', { bubbles: true }));
              selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }

          if (field.entryKeys && field.entryKeys[0]) {
            this.updateExistingHiddenEntry(field.entryKeys[0], valStr);
          }
          anySynced = true;
          continue;
        }

        if (el) {
          el.focus();

          const role = el.getAttribute('role');
          const isAriaCheckbox = role === 'checkbox' || role === 'switch';
          const isAriaRadio = role === 'radio';

          if (isAriaCheckbox) {
            const shouldBeTrue = typeof val === 'boolean' ? val : ['true', '1', 'ya', 'yes', 'on', 'centang'].includes(valStr.toLowerCase());
            const isCurrentlyTrue = el.getAttribute('aria-checked') === 'true';
            if (shouldBeTrue !== isCurrentlyTrue) {
              this.triggerSyntheticSelection(el);
            }
          } else if (isAriaRadio) {
            this.triggerSyntheticSelection(el);
          } else if (role === 'listbox' || el.getAttribute('aria-haspopup') === 'listbox') {
            await this.selectListboxOption(el, valStr);
          } else if (el.tagName.toLowerCase() === 'select') {
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
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          } else if ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio') {
            const inputEl = el as HTMLInputElement;
            inputEl.checked = typeof val === 'boolean' ? val : ['true', '1', 'ya', 'yes', 'on', 'centang'].includes(valStr.toLowerCase());
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            // Unblock disabled attribute if present (e.g. Google Forms unauthenticated or auto-collected email input)
            if (el.hasAttribute('disabled')) {
              (el as HTMLInputElement).disabled = false;
              el.removeAttribute('disabled');
              el.setAttribute('aria-disabled', 'false');
            }

            // Text / Textarea / Number / Email input
            this.setNativeInputValue(el, valStr);

            // Update existing hidden entry if one already exists natively
            if (field.entryKeys && field.entryKeys.length > 0) {
              for (const entryKey of field.entryKeys) {
                this.updateExistingHiddenEntry(entryKey, valStr);
              }
            } else if (card) {
              const hiddenInputs = card.querySelectorAll<HTMLInputElement>('input[type="hidden"]');
              hiddenInputs.forEach((h) => {
                if (h.name && h.name.startsWith('entry.') && !h.name.endsWith('_sentinel')) {
                  this.setNativeInputValue(h, valStr);
                }
              });
            }
          }

          el.blur();
          anySynced = true;
        }
      } catch (e) {
        console.warn(`[AIRA Syncer] Failed to sync field ${field.id}:`, e);
      }
    }

    return anySynced;
  }

  /**
   * Universal date parser for Google Forms & web forms.
   * Supports ISO (YYYY-MM-DD), DMY, Indonesian month names, and sanitizes multi-concatenated strings.
   */
  public parseDateParts(valStr: string): { day: string; month: string; year: string; iso: string } | null {
    if (!valStr) return null;
    const trimmed = valStr.trim();

    // Check if previous buggy concatenation occurred: "2026-09-18-2026-09-18-2026-09-18"
    const multiMatch = trimmed.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
    if (multiMatch) {
      const year = multiMatch[1];
      const month = multiMatch[2].padStart(2, '0');
      const day = multiMatch[3].padStart(2, '0');
      return { day, month, year, iso: `${year}-${month}-${day}` };
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
      const day = dmy[1].padStart(2, '0');
      const month = dmy[2].padStart(2, '0');
      const year = dmy[3];
      return { day, month, year, iso: `${year}-${month}-${day}` };
    }

    // 2. Textual DD Month YYYY (e.g. 18 September 2026)
    const textDmy = trimmed.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/);
    if (textDmy) {
      const day = textDmy[1].padStart(2, '0');
      const mStr = textDmy[2].toLowerCase();
      const month = monthMap[mStr];
      const year = textDmy[3];
      if (month) return { day, month, year, iso: `${year}-${month}-${day}` };
    }

    return null;
  }

  /**
   * Universal selector for custom ARIA listboxes (Google Forms, Material, Headless UI, Radix).
   * Async to handle Google Forms rendering dropdown options after a click (async popup).
   */
  private async selectListboxOption(listboxEl: HTMLElement, targetText: string): Promise<boolean> {
    try {
      const targetLower = targetText.toLowerCase().trim();

      // If listbox is closed, simulate click WITHOUT blur to expand options
      const isExpanded = listboxEl.getAttribute('aria-expanded') === 'true';
      if (!isExpanded) {
        listboxEl.focus();
        listboxEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        listboxEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        listboxEl.click();
        await new Promise((r) => setTimeout(r, 120));
      }

      // Try to find and click the matching option, with a retry after another frame
      let clicked = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        // Query option items from the entire document (Google Forms portals popups to body)
        const optEls = Array.from(
          document.querySelectorAll('[role="option"], .MocG8c[data-value], .OA00nd .MocG8c, .exportSelectPopup [role="option"]')
        ) as HTMLElement[];

        let matchedOpt = optEls.find((opt) => {
          const val = (opt.getAttribute('data-value') || '').toLowerCase().trim();
          const text = (opt.textContent || '').toLowerCase().trim();
          return val === targetLower || text === targetLower;
        });

        if (!matchedOpt) {
          matchedOpt = optEls.find((opt) => {
            const val = (opt.getAttribute('data-value') || '').toLowerCase().trim();
            const text = (opt.textContent || '').toLowerCase().trim();
            return (val && (val.includes(targetLower) || targetLower.includes(val))) ||
                   (text && (text.includes(targetLower) || targetLower.includes(text)));
          });
        }

        if (matchedOpt) {
          matchedOpt.focus();
          matchedOpt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          matchedOpt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          matchedOpt.click();
          clicked = true;
          break;
        }

        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      // ALWAYS update listbox UI display & attributes directly
      listboxEl.setAttribute('data-value', targetText);
      const textEl = listboxEl.querySelector<HTMLElement>('.vR13fe, .quantumWizMenuPaperselectDropDownText, span');
      if (textEl) {
        textEl.textContent = targetText;
      }
      listboxEl.classList.remove('placeholder');
      listboxEl.setAttribute('aria-expanded', 'false');

      return clicked;
    } catch (e) {
      console.warn('[AIRA Syncer] Listbox selection error:', e);
    }
    return false;
  }

  /**
   * Safely updates an ALREADY-EXISTING hidden input in the host DOM (e.g. native Google Forms dropdown/date hidden inputs).
   * NEVER creates or injects new <input> elements into the host DOM, as rogue hidden inputs
   * corrupt Google Forms' internal component schema and trigger "The question has changed".
   */
  private updateExistingHiddenEntry(entryKey: string, value: string): void {
    if (!entryKey) return;
    try {
      // Strictly target input[type="hidden"] so we NEVER touch text inputs (like the "Other" option input)
      const hidden = document.querySelector<HTMLInputElement>(`input[type="hidden"][name="${entryKey}"]`);
      if (hidden && !hidden.name.endsWith('_sentinel')) {
        hidden.value = value;
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (e) {
      console.warn(`[AIRA Syncer] updateExistingHiddenEntry failed for ${entryKey}:`, e);
    }
  }

  /**
   * Waits for the next animation frame + microtask, allowing async DOM updates
   * (e.g. Google Forms dropdown popup rendering) to complete before querying.
   */
  private waitForFrame(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 50));
    });
  }

  /**
   * Dispatches realistic synthetic pointer and mouse events for Google Forms & virtual DOM frameworks.
   */
  private triggerSyntheticSelection(el: HTMLElement): void {
    try {
      el.focus();
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.click();
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
      if ('checked' in el) {
        (el as HTMLInputElement).checked = true;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    } catch (e) {
      try { el.click(); } catch (err) {}
    }
  }

  /**
   * Sets native input value safely using prototype setters for React / Angular / Google Forms Paper Inputs.
   */
  private setNativeInputValue(el: HTMLElement, valStr: string): void {
    try {
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setDescriptor = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setDescriptor) {
        setDescriptor.call(el, valStr);
      } else {
        (el as HTMLInputElement).value = valStr;
      }
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: valStr }));
      } catch {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (e) {
      try {
        (el as HTMLInputElement).value = valStr;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      } catch (err) {}
    }
  }

  /**
   * Submits the host form end-to-end (Point 3)
   */
  public async submitHostForm(options: { skipValidation?: boolean } = {}): Promise<{ success: boolean; message: string }> {
    // Final validation pass: never submit an answer that violates structural rules.
    // Server-driven submissions were already validated by the agent.
    if (!options.skipValidation && this.activeForm) {
      for (const field of this.activeForm.fields) {
        const raw = this.answers[field.id] ??
          (field.domId ? this.answers[field.domId] : undefined) ??
          (field.entryKeys?.[0] ? this.answers[field.entryKeys[0]] : undefined);
        const validation = this.validateValue(field, raw === undefined || raw === null ? '' : String(raw));
        if (!validation.valid) {
          soundEffects.playError();
          return {
            success: false,
            message: validation.error || `Isian "${field.label}" belum valid.`
          };
        }
      }
    }

    // 1. Sync all values first (await async listbox & animation frames)
    await this.syncToHostDOM();

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
      // Look globally for standard submit buttons
      submitBtn = document.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement | null;
    }

    if (!submitBtn) {
      // Google Forms and modern web forms use role="button" with Kirim / Submit / Selesai text
      const roleButtons = Array.from(document.querySelectorAll<HTMLElement>('[role="button"], button, .uArJbe, .l4EATb'));
      submitBtn = roleButtons.find((b) => {
        const text = (b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
        return (
          text === 'kirim' || text === 'submit' || text === 'selesai' || text === 'kirimkan' ||
          aria === 'kirim' || aria === 'submit' ||
          b.classList.contains('freebirdFormviewerViewNavigationSubmitButton')
        );
      }) || null;
    }

    if (submitBtn) {
      try {
        this.triggerSyntheticSelection(submitBtn);
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

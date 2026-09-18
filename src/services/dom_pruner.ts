/**
 * AIRA - DOM Perceiver & Context Pruner (TypeScript)
 * Minimizes token consumption (<500 tokens) while retaining critical semantic structure.
 */

import { PageDOMOverview, InteractiveActionElement, FormContainerMetadata, FormFieldMetadata, PageHeading, FormFieldOptionBinding } from '../types/dom';
import { parseGoogleFormDocument, CanonicalQuestion, CanonicalGridRow } from './google_forms_parser';

export class DOMPruner {
  private elementMap: Map<string, HTMLElement> = new Map();
  private counter: number = 0;

  public reset(): void {
    this.elementMap.clear();
    this.counter = 0;
  }

  public isElementVisible(el: HTMLElement | null): boolean {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    if (el.hasAttribute('aria-hidden') && el.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    // Avoid our own extension host
    if (el.closest('#aira-root') || el.id === 'aira-root') return false;
    return true;
  }

  private cleanText(str: string | null | undefined): string {
    if (!str) return '';
    return str.replace(/\s+/g, ' ').trim();
  }

  public registerElement(el: HTMLElement, prefix: string = 'target'): string {
    let id = el.getAttribute('data-aira-id');
    if (!id) {
      this.counter++;
      id = `${prefix}-${this.counter}`;
      el.setAttribute('data-aira-id', id);
    }
    this.elementMap.set(id, el);
    return id;
  }

  public getElement(id: string): HTMLElement | null {
    return this.elementMap.get(id) || document.querySelector(`[data-aira-id="${id}"]`) as HTMLElement | null;
  }

  public findLabelForInput(input: HTMLElement): string {
    if (!input) return 'Kolom Isian';
    try {
      // If listbox or dropdown, do not use placeholder text "Choose" or "Pilih" as the label
      const role = input.getAttribute('role');
      if (role === 'listbox' || input.getAttribute('aria-haspopup') === 'listbox') {
        const cardTitle = this.findQuestionContext(input);
        if (cardTitle) return cardTitle;
      }

      // If in a grid row, extract column header
      const row = input.closest ? input.closest('[role="row"], .freebirdFormviewerComponentsQuestionGridRow, tr') : null;
      if (row) {
        const ariaLabel = input.getAttribute('aria-label');
        const rowHeader = row.querySelector('[role="rowheader"], .freebirdFormviewerComponentsQuestionGridRowHeader, th, td:first-child');
        const rowText = rowHeader ? this.cleanText(rowHeader.textContent) : '';
        if (ariaLabel) {
          let clean = this.cleanText(ariaLabel);
          if (rowText) {
            clean = clean.replace(new RegExp(`,?\\s*${rowText}\\s*,?`, 'gi'), '').trim();
          }
          if (clean) return clean;
        }
      }

      // 1. label[for]
      if (input.id) {
        try {
          const safeId = input.id.replace(/["\\]/g, '\\$&');
          const label = document.querySelector(`label[for="${safeId}"]`);
          if (label && this.cleanText(label.textContent)) {
            return this.cleanText(label.textContent);
          }
        } catch (e) {}
      }

      // 2. Parent label
      try {
        const parentLabel = input.closest ? input.closest('label') : null;
        if (parentLabel && this.cleanText(parentLabel.textContent)) {
          return this.cleanText(parentLabel.textContent);
        }
      } catch (e) {}

      // 3. aria-label or aria-labelledby
      try {
        const ariaLabel = input.getAttribute('aria-label');
        if (ariaLabel && this.cleanText(ariaLabel)) {
          const text = this.cleanText(ariaLabel);
          if (text.toLowerCase() !== 'choose' && text.toLowerCase() !== 'pilih') {
            return text;
          }
        }

        const labelledBy = input.getAttribute('aria-labelledby');
        if (labelledBy) {
          const ids = labelledBy.trim().split(/\s+/);
          const texts = ids.map(id => document.getElementById(id)?.textContent).filter(Boolean);
          const combined = this.cleanText(texts.join(' '));
          if (combined && combined.toLowerCase() !== 'choose' && combined.toLowerCase() !== 'pilih') {
            return combined;
          }
        }
      } catch (e) {}

      // 4. placeholder
      try {
        if ('placeholder' in input && (input as HTMLInputElement).placeholder && this.cleanText((input as HTMLInputElement).placeholder)) {
          const ph = this.cleanText((input as HTMLInputElement).placeholder);
          if (ph.toLowerCase() !== 'choose' && ph.toLowerCase() !== 'pilih') {
            return ph;
          }
        }
      } catch (e) {}

      // 5. Preceding label-like sibling
      try {
        const prev = input.previousElementSibling;
        if (prev) {
          const prevText = this.cleanText(prev.textContent);
          if (prevText && prevText.length < 50 && prevText.toLowerCase() !== 'choose' && prevText.toLowerCase() !== 'pilih') {
            return prevText;
          }
        }
      } catch (e) {}

      // 6. Name attribute fallback
      const named = (input as HTMLInputElement).name || input.id;
      return named || 'Kolom Isian';
    } catch (err) {
      return 'Kolom Isian';
    }
  }

  public extractPageOverview(): PageDOMOverview {
    this.reset();

    const pageTitle = document.title || 'Portal Layanan';
    const headings: PageHeading[] = [];

    document.querySelectorAll('h1, h2, h3').forEach((h) => {
      const el = h as HTMLElement;
      if (this.isElementVisible(el)) {
        const text = this.cleanText(el.textContent);
        if (text && text.length > 2 && text.length < 120) {
          headings.push({ tag: el.tagName.toLowerCase(), text });
        }
      }
    });

    const actionElements: InteractiveActionElement[] = [];
    const candidates = document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]');

    candidates.forEach((elNode) => {
      const el = elNode as HTMLElement;
      if (!this.isElementVisible(el)) return;

      const text = this.cleanText(el.innerText || el.textContent || (el as HTMLInputElement).value || el.getAttribute('aria-label') || el.title);
      if (!text || text.length < 2 || text.length > 80) return;

      const id = this.registerElement(el, 'btn');
      actionElements.push({
        id,
        tag: el.tagName.toLowerCase(),
        text,
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        href: el.tagName.toLowerCase() === 'a' ? (el.getAttribute('href') || '') : undefined
      });
    });

    const forms: FormContainerMetadata[] = [];
    const formEls = document.querySelectorAll('form');
    const containers = formEls.length > 0 ? Array.from(formEls) : [document.body];

    containers.forEach((container, formIdx) => {
      const candidateElements = container.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="radiogroup"], [role="listbox"], [role="group"]'
      );
      const validFields: FormFieldMetadata[] = [];
      const handledElements = new Set<Element>();

      candidateElements.forEach((inputNode) => {
        const input = inputNode as HTMLElement;
        if (!this.isElementVisible(input) && input.getAttribute('role') !== 'listbox') return;
        if (handledElements.has(input)) return;

        const role = input.getAttribute('role');
        const tag = input.tagName.toLowerCase();

        // 1. Radio groups & Linear scales
        if (role === 'radiogroup' || input.hasAttribute('data-rating')) {
          handledElements.add(input);
          const fieldId = this.registerElement(input, 'field');
          const label = this.findQuestionContext(input) || this.findLabelForInput(input);
          const radios = Array.from(input.querySelectorAll('[role="radio"]')) as HTMLElement[];
          radios.forEach(r => handledElements.add(r));
          const options = radios.map(r => this.cleanText(r.getAttribute('aria-label') || r.getAttribute('data-value') || r.textContent)).filter(Boolean);
          const isRating = input.hasAttribute('data-rating') || radios.length >= 3 && radios.every(r => /^\d+$/.test(r.textContent?.trim() || ''));

          validFields.push({
            id: fieldId,
            label,
            type: isRating ? 'rating' : 'radio',
            required: input.getAttribute('aria-required') === 'true',
            options: options.slice(0, 20),
            ratingScale: isRating ? { min: 1, max: radios.length } : undefined
          });
          return;
        }

        // 2. Custom Listbox / Dropdown
        if (role === 'listbox' || input.getAttribute('aria-haspopup') === 'listbox') {
          handledElements.add(input);
          const fieldId = this.registerElement(input, 'field');
          const label = this.findQuestionContext(input) || this.findLabelForInput(input);
          const card = input.closest('.Qr7Oae, [role="listitem"], fieldset, .form-card, .form-group') || input;
          const optEls = Array.from(card.querySelectorAll('[role="option"], .MocG8c[data-value]'));
          const options = Array.from(new Set(optEls.map(o => this.cleanText(o.getAttribute('data-value') || o.textContent)).filter(t => t && t.toLowerCase() !== 'choose' && t.toLowerCase() !== 'pilih'))).slice(0, 20);

          validFields.push({
            id: fieldId,
            label,
            type: 'select',
            required: input.getAttribute('aria-required') === 'true',
            options
          });
          return;
        }

        // 3. Checkbox groups
        if (role === 'group') {
          const checkboxes = Array.from(input.querySelectorAll('[role="checkbox"]')) as HTMLElement[];
          if (checkboxes.length > 0) {
            handledElements.add(input);
            checkboxes.forEach(c => handledElements.add(c));
            const fieldId = this.registerElement(input, 'field');
            const label = this.findQuestionContext(input) || this.findLabelForInput(input);
            const options = checkboxes.map(c => this.cleanText(c.getAttribute('aria-label') || c.getAttribute('data-value') || c.textContent)).filter(Boolean);

            validFields.push({
              id: fieldId,
              label,
              type: 'checkbox_group',
              required: input.getAttribute('aria-required') === 'true',
              options: options.slice(0, 20)
            });
            return;
          }
        }

        // 4. Native input, select, textarea
        const fieldId = this.registerElement(input, 'field');
        const label = this.findLabelForInput(input);
        const type = tag === 'select'
          ? 'select'
          : tag === 'textarea'
            ? 'textarea'
            : ((input as HTMLInputElement).type || 'text');

        let options: string[] | undefined;
        if (type === 'select') {
          const select = input as HTMLSelectElement;
          options = Array.from(select.options).map((opt) => opt.text.trim()).filter(Boolean).slice(0, 15);
        }

        let validationKey: 'nik' | 'phone' | 'email' | 'date' | undefined;
        const lowerLabel = label.toLowerCase();
        if (lowerLabel.includes('nik') || lowerLabel.includes('kependudukan')) validationKey = 'nik';
        else if (lowerLabel.includes('telepon') || lowerLabel.includes('wa') || lowerLabel.includes('whatsapp') || lowerLabel.includes('hp')) validationKey = 'phone';
        else if (lowerLabel.includes('email') || type === 'email') validationKey = 'email';
        else if (lowerLabel.includes('lahir') || lowerLabel.includes('tanggal') || type === 'date') validationKey = 'date';

        validFields.push({
          id: fieldId,
          label,
          type,
          placeholder: ('placeholder' in input ? (input as HTMLInputElement).placeholder : '') || '',
          required: (input as HTMLInputElement).required || input.getAttribute('aria-required') === 'true',
          currentValue: (input as HTMLInputElement).value || '',
          options,
          validationKey
        });
      });

      if (validFields.length > 0) {
        const formId = container !== document.body ? this.registerElement(container as HTMLElement, 'form') : 'main-page-form';
        forms.push({
          id: formId,
          title: container.getAttribute('aria-label') || (container as HTMLElement).title || `Formulir ${formIdx + 1}`,
          fields: validFields
        });
      }
    });

    // Deterministic Google Forms path: when FB_PUBLIC_LOAD_DATA_ is embedded,
    // structural classification replaces DOM heuristics entirely.
    const googleForm = this.extractGoogleFormsForm();
    if (googleForm && googleForm.fields.length > 0) {
      forms.length = 0;
      forms.push(googleForm);
    }

    const snippets: string[] = [];
    const mainSection = document.querySelector('main, [role="main"], article, #content') || document.body;
    const paragraphs = mainSection.querySelectorAll('p, li');
    let collectedLength = 0;

    for (const p of Array.from(paragraphs)) {
      if (collectedLength > 400) break;
      const el = p as HTMLElement;
      if (this.isElementVisible(el)) {
        const text = this.cleanText(el.textContent);
        if (text && text.length > 25 && text.length < 250) {
          snippets.push(text);
          collectedLength += text.length;
        }
      }
    }

    return {
      pageTitle,
      headings: headings.slice(0, 8),
      actionElements: actionElements.slice(0, 20),
      forms,
      snippets: snippets.slice(0, 3)
    };
  }

  public getPrunedContextForLLM(): { rawSummary: string; data: PageDOMOverview } {
    const data = this.extractPageOverview();

    let promptText = `Halaman: "${data.pageTitle}"\n`;

    if (data.headings.length > 0) {
      promptText += `Struktur Judul:\n` + data.headings.map(h => `- [${h.tag}] ${h.text}`).join('\n') + `\n`;
    }

    if (data.snippets.length > 0) {
      promptText += `Ringkasan Konten: ${data.snippets.join(' | ')}\n`;
    }

    if (data.actionElements.length > 0) {
      promptText += `Tombol/Aksi Tersedia:\n` +
        data.actionElements.map(a => `- [ID:${a.id}] "${a.text}"`).join(', ') + `\n`;
    }

    if (data.forms.length > 0) {
      promptText += `Formulir Terdeteksi (${data.forms.length}):\n`;
      data.forms.forEach((f) => {
        promptText += `Form [${f.id}]: ${f.fields.map(fl => `[ID:${fl.id}] ${fl.label} (${fl.type}${fl.required ? ', wajib' : ''})`).join('; ')}\n`;
      });
    }

    return {
      rawSummary: promptText,
      data
    };
  }

  public findQuestionContext(el: HTMLElement): string {
    try {
      const card = el.closest('.Qr7Oae, [role="listitem"], fieldset, .form-card, .form-group, .form-field');
      let baseTitle = '';
      if (card) {
        const titleEl = card.querySelector('.M7eMe, .freebirdFormviewerComponentsQuestionBaseTitle, [role="heading"], legend, .form-title, .question-title, label:first-child');
        if (titleEl && this.cleanText(titleEl.textContent)) {
          baseTitle = this.cleanText(titleEl.textContent);
        }
      }

      // Check if element is inside a Grid / Matrix Question Row
      const row = el.closest ? el.closest('[role="row"], .freebirdFormviewerComponentsQuestionGridRow, .E2Du2c, .jvy6Gd, tr') : null;
      if (row) {
        const rowHeader = row.querySelector('[role="rowheader"], .freebirdFormviewerComponentsQuestionGridRowHeader, .V4d7Ke, th, td:first-child, .row-label');
        if (rowHeader) {
          const rowText = this.cleanText(rowHeader.textContent);
          if (rowText && rowText !== baseTitle) {
            return baseTitle ? `${baseTitle} - Baris: ${rowText}` : `Baris: ${rowText}`;
          }
        }
      }

      return baseTitle;
    } catch (e) {}
    return '';
  }

  /**
   * Maps a canonical Google Forms question type to the internal wizard field type.
   * Grid rows reuse the radio / checkbox-group handling of the orchestrator.
   */
  private mapCanonicalTypeToFieldType(question: CanonicalQuestion): string {
    switch (question.type) {
      case 'short_answer': return 'text';
      case 'paragraph': return 'textarea';
      case 'multiple_choice': return 'radio';
      case 'dropdown': return 'select';
      case 'checkboxes': return 'checkbox_group';
      case 'linear_scale': return 'linear_scale';
      case 'rating': return 'rating';
      case 'date': return 'date';
      case 'time': return 'time';
      case 'file_upload': return 'file';
      case 'multiple_choice_grid': return 'radio';
      case 'checkbox_grid': return 'checkbox_group';
      case 'grid_unknown': return 'grid_unknown';
      default: return 'unknown';
    }
  }

  /** DOM binding label for a choice control: data-value, aria-label, value, text. */
  private optionLabelForElement(el: HTMLElement): string {
    const dataValue = el.getAttribute('data-value');
    if (dataValue && this.cleanText(dataValue)) return this.cleanText(dataValue);
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && this.cleanText(ariaLabel)) return this.cleanText(ariaLabel);
    const value = (el as HTMLInputElement).value;
    if (value && this.cleanText(value)) return this.cleanText(value);
    return this.cleanText(el.textContent);
  }

  /**
   * Google Forms renders option controls as ARIA divs (role="radio"/"checkbox")
   * with no `name`, while the entry id only appears on a hidden sentinel input
   * (`name="entry.<id>_sentinel"`). Match both shapes.
   */
  private findEntryElements(entryId: number): HTMLElement[] {
    try {
      return Array.from(
        document.querySelectorAll(`[name="entry.${entryId}"], [name="entry.${entryId}_sentinel"]`)
      ) as HTMLElement[];
    } catch (e) {
      return [];
    }
  }

  private findQuestionCard(anchor: HTMLElement | null): HTMLElement | null {
    if (!anchor) return null;
    return (
      anchor.closest('.Qr7Oae, [role="listitem"], .freebirdFormviewerComponentsQuestionBase, fieldset') as HTMLElement | null
    ) || anchor.parentElement;
  }

  /**
   * Builds one wizard field from a canonical question (or one flattened grid row).
   * DOM bindings are matched strictly by `name="entry.<id>"`; when the control is
   * not rendered, the field keeps its deterministic metadata but no binding.
   */
  /** Deterministic prompt hint for canonical Google Forms fields (grid-aware). */
  private defaultCanonicalHint(question: CanonicalQuestion, rowLabel: string): string {
    const isGridRow = rowLabel.length > 0 || (rowLabel === '' && question.rows !== null);
    const rowSuffix = rowLabel ? ` untuk baris "${rowLabel}"` : '';

    switch (question.type) {
      case 'multiple_choice_grid':
        return `Pilih satu opsi${rowSuffix}.`;
      case 'checkbox_grid':
        return `Pilih satu atau beberapa opsi${rowSuffix}.`;
      case 'multiple_choice':
      case 'dropdown':
      case 'linear_scale':
      case 'rating':
        return 'Pilih salah satu opsi yang sesuai.';
      case 'checkboxes':
        return 'Pilih satu atau lebih opsi yang sesuai.';
      case 'date':
        return 'Sebutkan atau ketik tanggal yang diminta.';
      case 'time':
        return 'Sebutkan atau ketik waktu yang diminta.';
      case 'paragraph':
        return 'Ketik atau ucapkan jawaban Anda.';
      case 'grid_unknown':
        return isGridRow ? `Pilih kolom${rowSuffix}.` : 'Pilih opsi yang sesuai.';
      default:
        return 'Ketik atau ucapkan jawaban Anda.';
    }
  }

  private buildGoogleFormsField(question: CanonicalQuestion, row: CanonicalGridRow | null): FormFieldMetadata {
    const entryId = row ? row.entry_id : (question.entry_ids[0] ?? null);
    const isGridRow = !!row;
    const rowLabel = row?.label || '';
    const label = isGridRow
      ? (rowLabel ? `${question.title} — ${rowLabel}` : `${question.title} — Baris`)
      : (question.title || 'Pertanyaan');
    const fieldType = this.mapCanonicalTypeToFieldType(question);
    const options = row ? (question.columns || []) : (question.options || []);
    const required = row ? row.required : question.required;

    const entryElements = entryId !== null ? this.findEntryElements(entryId) : [];
    const card = this.findQuestionCard(entryElements[0] || null);
    const visibleAnchor =
      entryElements.find((el) => !(el.getAttribute('name') || '').endsWith('_sentinel')) || null;

    let optionBindings: FormFieldOptionBinding[] | undefined;
    const bindingTypes = [
      'multiple_choice',
      'checkboxes',
      'linear_scale',
      'rating',
      'multiple_choice_grid',
      'checkbox_grid',
      'grid_unknown'
    ];
    if (bindingTypes.includes(question.type)) {
      const optionEls: HTMLElement[] = [];

      if (card) {
        optionEls.push(
          ...(Array.from(card.querySelectorAll('[role="radio"], [role="checkbox"]')) as HTMLElement[])
        );
      }
      entryElements.forEach((el) => {
        const type = (el as HTMLInputElement).type;
        const role = el.getAttribute('role');
        if (role === 'radio' || role === 'checkbox' || type === 'radio' || type === 'checkbox') {
          optionEls.push(el);
        }
      });

      optionBindings = Array.from(new Set(optionEls))
        .map((el) => ({
          option: this.optionLabelForElement(el),
          ref: this.registerElement(el, 'opt')
        }))
        .filter((binding) => binding.option.length > 0);
    }

    if (question.type === 'dropdown' && card) {
      const optionEls = Array.from(card.querySelectorAll('[role="option"]')) as HTMLElement[];
      if (optionEls.length > 0) {
        optionBindings = optionEls
          .map((el) => ({
            option: this.cleanText(el.getAttribute('data-value') || el.textContent),
            ref: this.registerElement(el, 'opt')
          }))
          .filter((binding) => binding.option.length > 0);
      }
    }

    let otherInputRef: string | undefined;
    if (question.other_allowed && card) {
      const candidates = Array.from(
        card.querySelectorAll('input[type="text"], input[type="email"], textarea')
      ) as HTMLInputElement[];
      const companion = candidates.find((el) => !(el.name || '').startsWith('entry.'));
      if (companion) otherInputRef = this.registerElement(companion, 'other');
    }

    const fieldId = visibleAnchor
      ? this.registerElement(visibleAnchor, 'field')
      : card
        ? this.registerElement(card, 'field')
        : (entryId !== null ? `gf-entry-${entryId}` : `gf-item-${question.item_id ?? 'unknown'}`);

    let ratingScale: FormFieldMetadata['ratingScale'];
    if ((question.type === 'linear_scale' || question.type === 'rating') && options.length > 0) {
      ratingScale = { min: 1, max: options.length };
    }

    const currentValue = visibleAnchor && 'value' in visibleAnchor ? (visibleAnchor as HTMLInputElement).value : '';

    return {
      id: fieldId,
      domId: visibleAnchor?.id || undefined,
      label,
      type: fieldType,
      placeholder: visibleAnchor?.getAttribute('placeholder') || undefined,
      required,
      currentValue: currentValue || undefined,
      options: options.length > 0 ? options : undefined,
      optionBindings,
      hasOther: question.other_allowed || undefined,
      otherInputRef,
      ratingScale,
      typeCode: question.type_code,
      canonicalType: question.type,
      entryIds: row ? [row.entry_id] : question.entry_ids,
      entryKeys: row ? [row.entry_key] : question.entry_keys,
      otherAllowed: question.other_allowed,
      columns: question.columns,
      rows: row ? null : question.rows,
      diagnostic: question.diagnostic,
      validation: question.validation,
      hint: question.description || this.defaultCanonicalHint(question, rowLabel),
      gridQuestion: row ? question.title : undefined,
      gridRowLabel: row ? rowLabel || undefined : undefined
    };
  }

  /**
   * Builds a deterministic FormContainerMetadata from FB_PUBLIC_LOAD_DATA_.
   * Returns null for non-Google-Forms pages or unusable payloads.
   */
  public extractGoogleFormsForm(): FormContainerMetadata | null {
    if (typeof document === 'undefined') return null;

    let parsed: ReturnType<typeof parseGoogleFormDocument> = null;
    try {
      parsed = parseGoogleFormDocument(document);
    } catch (e) {
      console.warn('[AIRA Google Forms] Payload parse error:', e);
      return null;
    }
    if (!parsed || parsed.questions.length === 0) return null;

    const fields: FormFieldMetadata[] = [];
    for (const question of parsed.questions) {
      if (question.rows && question.rows.length > 0) {
        for (const row of question.rows) {
          fields.push(this.buildGoogleFormsField(question, row));
        }
        continue;
      }
      // Skip structural items (section headers, images, page breaks) without entries.
      if (question.entry_ids.length === 0) continue;
      fields.push(this.buildGoogleFormsField(question, null));
    }

    if (fields.length === 0) return null;

    const container = (
      document.querySelector('.freebirdFormviewerViewFormContent') ||
      document.querySelector('form') ||
      document.body
    ) as HTMLElement;
    const formId = container && container !== document.body
      ? this.registerElement(container, 'form')
      : 'google-forms';

    return {
      id: formId,
      title: parsed.form_title || document.title || 'Formulir Google',
      fields
    };
  }

  /**
   * Universal Form Pruner for LLM Structuring (Google Forms, ARIA, & Native Forms)
   * Tags interactive elements with 'data-aira-ref' and generates compact semantic XML.
   */
  public pruneFormForLLM(targetContainer?: HTMLElement): { compactHtml: string; elementCount: number } {
    let container = targetContainer || document.querySelector('form, [role="form"], .freebirdFormviewerViewFormContent') as HTMLElement || document.body;

    const candidateSelector = [
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
      'select',
      'textarea',
      '[role="radio"]',
      '[role="checkbox"]',
      '[role="radiogroup"]',
      '[role="listbox"]',
      '[role="option"]',
      '[role="combobox"]',
      '[role="slider"]',
      '[role="switch"]',
      '[data-rating]',
      '[aria-valuenow]'
    ].join(', ');

    let elements = Array.from(container.querySelectorAll(candidateSelector)) as HTMLElement[];
    if (elements.length === 0 && container !== document.body) {
      container = document.body;
      elements = Array.from(container.querySelectorAll(candidateSelector)) as HTMLElement[];
    }

    const visibleElements = elements.filter(el => {
      if (el.getAttribute('role') === 'option') return true;
      return this.isElementVisible(el);
    });

    let refCounter = 1;
    const taggedItems: Array<{
      ref: string;
      tag: string;
      type: string;
      role?: string;
      group?: string;
      name?: string;
      label: string;
      placeholder?: string;
      required: boolean;
      value?: string;
      options?: string[];
      checked?: boolean;
      companionFor?: string;
    }> = [];

    // Pre-pass: Tag all elements and register them
    visibleElements.forEach((el) => {
      try {
        let ref = el.getAttribute('data-aira-ref');
        if (!ref) {
          ref = `f_${refCounter++}`;
          el.setAttribute('data-aira-ref', ref);
        }
        this.elementMap.set(ref, el);
      } catch (e) {}
    });

    visibleElements.forEach((el) => {
      try {
        const ref = el.getAttribute('data-aira-ref')!;
        const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || undefined;
      const type = (el as HTMLInputElement).type || (tag === 'select' ? 'select' : (tag === 'textarea' ? 'textarea' : (role || 'text')));
      const name = (el as HTMLInputElement).name || undefined;
      const label = this.findLabelForInput(el as any);
      const group = this.findQuestionContext(el) || undefined;
      const placeholder = (el as HTMLInputElement).placeholder || undefined;
      const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
      const value = (el as HTMLInputElement).value || el.getAttribute('data-value') || el.getAttribute('aria-valuenow') || undefined;
      const checked = (el as HTMLInputElement).checked || el.getAttribute('aria-checked') === 'true';

      let options: string[] | undefined;
      if (tag === 'select') {
        const sel = el as HTMLSelectElement;
        options = Array.from(sel.options).map(o => o.text.trim()).filter(Boolean).slice(0, 20);
      } else if (role === 'listbox' || el.getAttribute('aria-haspopup') === 'listbox') {
        const card = el.closest('.Qr7Oae, [role="listitem"], fieldset, .form-card, .form-group') || container;
        const optEls = Array.from(card.querySelectorAll('[role="option"], .MocG8c[data-value], .quantumWizMenuPaperselectOption'));
        const optTexts = optEls
          .map(opt => this.cleanText(opt.getAttribute('data-value') || opt.textContent))
          .filter(t => t && t.toLowerCase() !== 'choose' && t.toLowerCase() !== 'pilih');
        if (optTexts.length > 0) {
          options = Array.from(new Set(optTexts)).slice(0, 20);
        }
      }

      // Check if this is a companion text input for an "Other:" option
      let companionFor: string | undefined;
      if (tag === 'input' && (type === 'text' || type === '')) {
        const isOtherPlaceholder = placeholder && (placeholder.toLowerCase().includes('other') || placeholder.toLowerCase().includes('lainnya'));
        const isOtherAria = label && (label.toLowerCase().includes('other') || label.toLowerCase().includes('lainnya'));
        const isOtherClass = el.className && (el.className.includes('quantumWizTextinputPaperinputInput') || el.className.includes('Other'));
        if (isOtherPlaceholder || isOtherAria || isOtherClass) {
          const card = el.closest('.Qr7Oae, [role="listitem"], fieldset, .form-card, .form-group') || el.parentElement;
          if (card) {
            const otherOpt = card.querySelector('[role="checkbox"][aria-label*="Other"], [role="radio"][aria-label*="Other"], [role="checkbox"][aria-label*="Lainnya"], [role="radio"][aria-label*="Lainnya"], [data-value="__other_option__"]');
            if (otherOpt) {
              companionFor = otherOpt.getAttribute('data-aira-ref') || undefined;
            }
          }
        }
      }

      taggedItems.push({
        ref,
        tag,
        type,
        role,
        group,
        name,
        label,
        placeholder,
        required,
        value,
        options,
        checked,
        companionFor
      });
      } catch (err) {
        console.warn('[AIRA DOM Pruner] Element tagging error:', err);
      }
    });

    const lines: string[] = [];
    taggedItems.forEach(item => {
      let line = `<elem ref="${item.ref}" tag="${item.tag}" type="${item.type}"`;
      if (item.role) line += ` role="${item.role}"`;
      if (item.companionFor) line += ` companionFor="${item.companionFor}"`;
      if (item.group) line += ` group="${item.group.replace(/"/g, "'")}"`;
      if (item.label && item.label !== item.group) line += ` text="${item.label.replace(/"/g, "'")}"`;
      if (item.name) line += ` name="${item.name}"`;
      if (item.placeholder) line += ` placeholder="${item.placeholder.replace(/"/g, "'")}"`;
      if (item.required) line += ` required="true"`;
      if (item.value) line += ` value="${item.value.replace(/"/g, "'")}"`;
      if (item.checked) line += ` checked="true"`;
      if (item.options && item.options.length > 0) line += ` options="${item.options.join('|')}"`;
      line += ` />`;
      lines.push(line);
    });

    const formTitle = container.getAttribute('aria-label') || container.title || document.title || 'Formulir Web';
    const compactHtml = `<form title="${formTitle.replace(/"/g, "'")}">\n  ` + lines.join('\n  ') + `\n</form>`;

    return {
      compactHtml,
      elementCount: taggedItems.length
    };
  }
}

export const domPruner = new DOMPruner();

/**
 * AIRA - DOM Perceiver & Context Pruner (TypeScript)
 * Minimizes token consumption (<500 tokens) while retaining critical semantic structure.
 */

import { PageDOMOverview, InteractiveActionElement, FormContainerMetadata, FormFieldMetadata, PageHeading } from '../types/dom';

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

  public findLabelForInput(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
    if (!input) return 'Kolom Isian';

    try {
      // 1. label[for="id"]
      if (input.id) {
        try {
          const safeId = input.id.replace(/["\\]/g, '\\$&');
          const label = document.querySelector(`label[for="${safeId}"]`);
          if (label && this.cleanText(label.textContent)) {
            return this.cleanText(label.textContent);
          }
        } catch (e) {
          // Ignore invalid querySelector syntax
        }
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
          return this.cleanText(ariaLabel);
        }

        const labelledBy = input.getAttribute('aria-labelledby');
        if (labelledBy) {
          const ids = labelledBy.trim().split(/\s+/);
          const texts = ids.map(id => document.getElementById(id)?.textContent).filter(Boolean);
          const combined = this.cleanText(texts.join(' '));
          if (combined) return combined;
        }
      } catch (e) {}

      // 4. placeholder
      try {
        if ('placeholder' in input && input.placeholder && this.cleanText(input.placeholder)) {
          return this.cleanText(input.placeholder);
        }
      } catch (e) {}

      // 5. Preceding label-like sibling
      try {
        const prev = input.previousElementSibling;
        if (prev) {
          const prevText = this.cleanText(prev.textContent);
          if (prevText && prevText.length < 50) {
            return prevText;
          }
        }
      } catch (e) {}

      // 6. Name attribute fallback
      return input.name || input.id || 'Kolom Isian';
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
      const inputs = container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
      const validFields: FormFieldMetadata[] = [];

      inputs.forEach((inputNode) => {
        const input = inputNode as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        if (!this.isElementVisible(input)) return;

        const fieldId = this.registerElement(input, 'field');
        const label = this.findLabelForInput(input);
        const type = input.tagName.toLowerCase() === 'select'
          ? 'select'
          : input.tagName.toLowerCase() === 'textarea'
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
          placeholder: ('placeholder' in input ? input.placeholder : '') || '',
          required: input.required || input.getAttribute('aria-required') === 'true',
          currentValue: input.value || '',
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
}

export const domPruner = new DOMPruner();

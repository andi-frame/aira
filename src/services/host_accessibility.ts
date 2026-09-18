/**
 * AIRA - Host Page Accessibility Engine (TypeScript)
 * Applies accessibility adaptations (WCAG 2.1 AAA high-contrast, font scaling, touch targets, spacing)
 * directly to the active webpage DOM being browsed.
 */

import { AiraSettings } from '../types/index';

export class HostAccessibilityEngine {
  private styleEl: HTMLStyleElement | null = null;
  private readonly STYLE_ID = 'aira-host-accessibility-style';

  public apply(settings: AiraSettings): void {
    if (typeof document === 'undefined') return;

    if (!this.styleEl) {
      let el = document.getElementById(this.STYLE_ID) as HTMLStyleElement | null;
      if (!el) {
        el = document.createElement('style');
        el.id = this.STYLE_ID;
        (document.head || document.documentElement).appendChild(el);
      }
      this.styleEl = el;
    }

    const cssRules: string[] = [];

    // 1. High Contrast Mode (WCAG 2.1 AAA - 19.5:1 ratio)
    if (settings.highContrast) {
      cssRules.push(`
        /* AIRA High Contrast Host Adaptations */
        html, body {
          background-color: #000000 !important;
          color: #FFE600 !important;
          border-color: #FFE600 !important;
        }

        /* Headings & Text */
        p, span, h1, h2, h3, h4, h5, h6, li, dt, dd, td, th, label, small, strong, em, b, i, blockquote {
          color: #FFE600 !important;
          text-shadow: none !important;
        }

        /* Structural Containers */
        header, nav, main, footer, section, article, aside, .card, .container, table, form {
          background-color: #070707 !important;
          border-color: #FFE600 !important;
        }

        /* Interactive Buttons & Action Links */
        a, button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"] {
          background-color: #FFE600 !important;
          color: #000000 !important;
          border: 2px solid #FFE600 !important;
          font-weight: 800 !important;
          text-decoration: none !important;
        }

        a:hover, button:hover, [role="button"]:hover {
          background-color: #FFFF55 !important;
          color: #000000 !important;
        }

        /* Focus Ring */
        a:focus, button:focus, [role="button"]:focus, input:focus, select:focus, textarea:focus {
          outline: 4px solid #FFFFFF !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px #000000 !important;
        }

        /* Form Controls */
        input:not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea {
          background-color: #000000 !important;
          color: #FFE600 !important;
          border: 2px solid #FFE600 !important;
        }

        /* Media */
        img, video {
          filter: contrast(115%) brightness(95%);
        }
      `);
    }

    // 2. Font Size Scaling (Lansia / Ramah Baca)
    if (settings.fontSize === 'large') {
      cssRules.push(`
        html {
          font-size: 118% !important;
        }
        body, p, span, li, a, label, input, select, textarea, td, th {
          font-size: 1.15em !important;
          line-height: 1.65 !important;
        }
        h1 { font-size: 2.2em !important; line-height: 1.3 !important; }
        h2 { font-size: 1.8em !important; line-height: 1.3 !important; }
        h3 { font-size: 1.5em !important; line-height: 1.3 !important; }
      `);
    } else if (settings.fontSize === 'xlarge') {
      cssRules.push(`
        html {
          font-size: 135% !important;
        }
        body, p, span, li, a, label, input, select, textarea, td, th {
          font-size: 1.3em !important;
          line-height: 1.8 !important;
          letter-spacing: 0.02em !important;
        }
        h1 { font-size: 2.6em !important; line-height: 1.3 !important; }
        h2 { font-size: 2.1em !important; line-height: 1.3 !important; }
        h3 { font-size: 1.7em !important; line-height: 1.3 !important; }
      `);
    }

    // 3. Control Touch Target Size & Separation Margins
    if (settings.controlSize === 'large') {
      cssRules.push(`
        button, a[role="button"], input[type="button"], input[type="submit"], input[type="reset"],
        input:not([type="checkbox"]):not([type="radio"]), select, textarea {
          min-height: 52px !important;
          padding-top: 10px !important;
          padding-bottom: 10px !important;
        }
      `);
    } else if (settings.controlSize === 'xlarge') {
      cssRules.push(`
        button, a[role="button"], input[type="button"], input[type="submit"], input[type="reset"],
        input:not([type="checkbox"]):not([type="radio"]), select, textarea {
          min-height: 64px !important;
          padding-top: 14px !important;
          padding-bottom: 14px !important;
          margin-top: 6px !important;
          margin-bottom: 6px !important;
        }
      `);
    }

    // 4. Sensory Shield (Reduce Motion)
    if (settings.reduceMotion) {
      cssRules.push(`
        *, *::before, *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
          scroll-behavior: auto !important;
        }
      `);
    }

    // Ensure #aira-root Shadow DOM container itself is never distorted by host CSS
    cssRules.push(`
      #aira-root {
        all: initial !important;
        position: relative !important;
        z-index: 2147483640 !important;
      }
    `);

    this.styleEl.textContent = cssRules.join('\n');
  }

  public clear(): void {
    if (this.styleEl) {
      this.styleEl.textContent = '';
    }
  }
}

export const hostAccessibilityEngine = new HostAccessibilityEngine();

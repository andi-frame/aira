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

    // Resolve fontScale and controlScale with backward compatibility
    let fontScale = settings.fontScale ?? 100;
    if (settings.fontScale === undefined && settings.fontSize) {
      fontScale = settings.fontSize === 'large' ? 125 : settings.fontSize === 'xlarge' ? 150 : 100;
    }

    let controlScale = settings.controlScale ?? 100;
    if (settings.controlScale === undefined && settings.controlSize) {
      controlScale = settings.controlSize === 'large' ? 125 : settings.controlSize === 'xlarge' ? 150 : 100;
    }

    // 1. High Contrast Mode (WCAG 2.1 AAA - 21:1 & 19.5:1 ratio)
    if (settings.highContrast) {
      cssRules.push(`
        /* AIRA WCAG 2.1 AAA High Contrast Host Adaptations */
        html, body {
          background-color: #000000 !important;
          background-image: none !important;
          color: #FFFFFF !important;
        }

        /* 1. Universal Neutralization: remove ALL light/white container backgrounds */
        div:not([role="button"]):not([role="radio"]):not([role="checkbox"]):not([role="listitem"]):not([role="dialog"]):not([role="menu"]):not([role="listbox"]):not([role="option"]):not([role="alert"]):not(input):not(textarea):not(select):not(button),
        section, article, main, header, footer, nav, aside,
        ul, ol, li, dl, dt, dd,
        p, span:not([role="button"]):not([role="radio"]):not([role="checkbox"]),
        label, small, b, strong, em, i, [dir="auto"],
        table, thead, tbody, tfoot, tr, td, th, form {
          background-color: transparent !important;
          background-image: none !important;
        }

        /* 2. Elevated Cards & Structural Surfaces (Google Forms Cards, Panels, Modals) */
        [role="listitem"], .card, .container, [role="region"],
        .Qr7Oae, .freebirdFormviewerViewFormCard, .N9Q2ih, .geS5n,
        .freebirdFormviewerViewHeaderHeader,
        fieldset, dialog, [role="dialog"], [role="alertdialog"],
        pre, code, blockquote {
          background-color: #0D0D0D !important;
          background-image: none !important;
          border: 1px solid #383838 !important;
          border-radius: 8px !important;
        }

        /* Active / focused question card */
        [role="listitem"]:focus-within, .Qr7Oae:focus-within, .card:focus-within, .geS5n:focus-within {
          border: 2px solid #FFE600 !important;
          box-shadow: 0 0 0 2px #FFE600 !important;
        }

        /* 3. Headings, Section Titles & Question Titles: Vivid Yellow (19.5:1 ratio) */
        h1, h2, h3, h4, h5, h6, [role="heading"],
        .F9yp7e, .ahS7Le, .M7eMe, .jhEkRc, .snByac, .z12JJ {
          color: #FFE600 !important;
          font-weight: 700 !important;
          text-shadow: none !important;
        }
        h1 *, h2 *, h3 *, h4 *, h5 *, h6 *, [role="heading"] *,
        .M7eMe *, .F9yp7e * {
          color: #FFE600 !important;
        }

        /* 4. Required Field Indicator Asterisk */
        .c2gzEf, span[aria-label*="wajib"], span[aria-label*="required"], .required-asterisk {
          color: #FF5555 !important;
          font-weight: bold !important;
        }

        /* 5. Body Text, Descriptions & Option Labels: Crisp Pure White (21:1 on black, 18.5:1 on cards) */
        body, p, li, dt, dd, td, th, label, small, blockquote, figcaption, time, cite,
        .aDTYNe, .vR13fe, .docssharedWizToggleLabeledLabelText, .YEVVod, .O1fdcb {
          color: #FFFFFF !important;
          text-shadow: none !important;
        }
        div:not([role="button"]):not(button):not(a):not([role="heading"]):not(.uArJbe):not(.whsOnd):not(.KHxj8b),
        span:not([role="button"]):not(button):not(a):not(.c2gzEf):not([role="heading"]):not(.uArJbe) {
          color: #FFFFFF !important;
          text-shadow: none !important;
        }

        /* 6. Regular Inline Links: Vivid Electric Cyan (13.5:1 ratio against black) */
        a:not([role="button"]):not(.btn):not([class*="button"]):not([class*="btn"]):not(.uArJbe) {
          background-color: transparent !important;
          color: #00E5FF !important;
          text-decoration: underline !important;
          font-weight: 600 !important;
        }
        a:not([role="button"]):not(.btn):not([class*="button"]):not([class*="btn"]):not(.uArJbe) * {
          color: #00E5FF !important;
          text-decoration: underline !important;
        }
        a:not([role="button"]):not(.btn):not([class*="button"]):not([class*="btn"]):not(.uArJbe):hover {
          color: #FFE600 !important;
        }

        /* 7. Action Buttons & Submit Buttons (e.g. Google Forms "Kirim" / .uArJbe) */
        button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"],
        a.btn, a[class*="button"], a[class*="btn"], .uArJbe {
          background-color: #FFE600 !important;
          background-image: none !important;
          color: #000000 !important;
          border: 2px solid #FFE600 !important;
          font-weight: 800 !important;
          text-decoration: none !important;
          border-radius: 6px !important;
        }

        /* CRITICAL: Enforce pure black text and transparent background on ALL button children */
        button *, [role="button"] *, input[type="button"] *, input[type="submit"] *,
        a.btn *, a[class*="button"] *, a[class*="btn"] *, .uArJbe *,
        .uArJbe div, .uArJbe span, .uArJbe [dir="auto"], .uArJbe .NPEfkd, .uArJbe .l4V7wb,
        [role="button"] div, [role="button"] span, [role="button"] [dir="auto"],
        button div, button span, button [dir="auto"] {
          color: #000000 !important;
          fill: #000000 !important;
          stroke: #000000 !important;
          background-color: transparent !important;
          text-shadow: none !important;
        }

        button:hover, [role="button"]:hover, .uArJbe:hover {
          background-color: #FFFFFF !important;
          border-color: #FFFFFF !important;
        }
        button:hover *, [role="button"]:hover *, .uArJbe:hover *,
        .uArJbe:hover span, .uArJbe:hover div, [role="button"]:hover span, button:hover span {
          color: #000000 !important;
          fill: #000000 !important;
        }

        /* Secondary Buttons (e.g. "Kosongkan formulir") */
        .uArJbe:not(.M9Bg4d) {
          background-color: #000000 !important;
          color: #FFE600 !important;
          border: 2px solid #FFE600 !important;
        }
        .uArJbe:not(.M9Bg4d) *, .uArJbe:not(.M9Bg4d) span, .uArJbe:not(.M9Bg4d) div, .uArJbe:not(.M9Bg4d) [dir="auto"] {
          color: #FFE600 !important;
          fill: #FFE600 !important;
        }

        /* 8. Radio Buttons (Material Design & Native) */
        div[role="radio"], [role="radio"] {
          border: 2px solid #FFFFFF !important;
          border-radius: 50% !important;
          background-color: #000000 !important;
          box-sizing: border-box !important;
        }
        div[role="radio"][aria-checked="true"], [role="radio"][aria-checked="true"],
        div[role="radio"].isChecked, [role="radio"].isChecked {
          background-color: #FFE600 !important;
          border-color: #FFE600 !important;
          box-shadow: 0 0 0 2px #000000, 0 0 0 4px #00E5FF !important;
        }
        div[role="radio"][aria-checked="true"] *, [role="radio"][aria-checked="true"] *,
        div[role="radio"].isChecked *, [role="radio"].isChecked * {
          background-color: #000000 !important;
          border-color: #000000 !important;
        }
        input[type="radio"] {
          accent-color: #FFE600 !important;
        }

        /* 9. Checkboxes (Material Design & Native) */
        div[role="checkbox"], [role="checkbox"] {
          border: 2px solid #FFFFFF !important;
          border-radius: 4px !important;
          background-color: #000000 !important;
          box-sizing: border-box !important;
        }
        div[role="checkbox"][aria-checked="true"], [role="checkbox"][aria-checked="true"],
        div[role="checkbox"].isChecked, [role="checkbox"].isChecked {
          background-color: #FFE600 !important;
          border-color: #FFE600 !important;
          box-shadow: 0 0 0 2px #000000, 0 0 0 4px #00E5FF !important;
        }
        div[role="checkbox"][aria-checked="true"] *, [role="checkbox"][aria-checked="true"] *,
        div[role="checkbox"].isChecked *, [role="checkbox"].isChecked * {
          border-color: #000000 !important;
          fill: #000000 !important;
        }
        input[type="checkbox"] {
          accent-color: #FFE600 !important;
        }

        /* Option row hover in forms */
        .docssharedWizToggleLabeledContainer {
          padding: 6px 10px !important;
          border-radius: 6px !important;
          transition: background-color 0.15s ease !important;
        }
        .docssharedWizToggleLabeledContainer:hover {
          background-color: rgba(255, 230, 0, 0.12) !important;
        }

        /* 10. Form Inputs, Textareas, Selects & Google Forms Answers */
        input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),
        select, textarea, .whsOnd, .KHxj8b {
          background-color: #121212 !important;
          background-image: none !important;
          color: #FFFFFF !important;
          border: 2px solid #FFE600 !important;
          border-radius: 6px !important;
          padding: 8px 12px !important;
          box-sizing: border-box !important;
          caret-color: #FFE600 !important;
        }
        input:focus, textarea:focus, select:focus, .whsOnd:focus, .KHxj8b:focus {
          outline: 3px solid #00E5FF !important;
          outline-offset: 2px !important;
          background-color: #1A1A1A !important;
          border-color: #00E5FF !important;
          color: #FFFFFF !important;
        }
        input::placeholder, textarea::placeholder, .whsOnd::placeholder {
          color: #AAAAAA !important;
          opacity: 1 !important;
        }
        .nd91id, .YDVdrb {
          color: #AAAAAA !important;
          background-color: transparent !important;
        }
        .m2vVea, .whsOnd::after, .whsOnd::before {
          display: none !important;
        }

        /* 11. Dropdowns, Menus & Dialog Popups */
        [role="listbox"], [role="menu"], .OA00ne, .exportSelectPopup, .quantumWizMenuPaperselectPopup {
          background-color: #121212 !important;
          border: 2px solid #FFE600 !important;
          border-radius: 8px !important;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.95) !important;
        }
        [role="option"], [role="menuitem"], .MocG8c {
          background-color: #121212 !important;
          color: #FFFFFF !important;
        }
        [role="option"] *, [role="menuitem"] *, .MocG8c * {
          color: #FFFFFF !important;
          background-color: transparent !important;
        }
        [role="option"]:hover, [role="option"][aria-selected="true"],
        [role="menuitem"]:hover, .MocG8c.KKjvXb {
          background-color: #FFE600 !important;
          color: #000000 !important;
        }
        [role="option"]:hover *, [role="option"][aria-selected="true"] *,
        [role="menuitem"]:hover *, .MocG8c.KKjvXb * {
          color: #000000 !important;
        }

        /* 12. Disabled Form Elements */
        button:disabled, [role="button"][aria-disabled="true"],
        input:disabled, textarea:disabled, select:disabled, .uArJbe.is-disabled {
          background-color: #262626 !important;
          color: #888888 !important;
          border-color: #555555 !important;
          cursor: not-allowed !important;
          box-shadow: none !important;
        }
        button:disabled *, [role="button"][aria-disabled="true"] *, .uArJbe.is-disabled * {
          color: #888888 !important;
          fill: #888888 !important;
        }

        /* 13. Form Errors & Validation Feedback */
        [role="alert"], .RHiGIb, .error-message, [aria-invalid="true"] {
          color: #FF5555 !important;
          font-weight: 700 !important;
        }
        [role="alert"] *, .RHiGIb * {
          color: #FF5555 !important;
        }

        /* 14. Form Progress Bar */
        [role="progressbar"] {
          background-color: #222222 !important;
          border: 1px solid #555555 !important;
        }
        [role="progressbar"] > * {
          background-color: #FFE600 !important;
        }

        /* 15. Tables & Grids (e.g. Likert Scale / Grid Questions) */
        table, thead, tbody, tfoot, tr, td, th {
          background-color: transparent !important;
          border-color: #444444 !important;
          color: #FFFFFF !important;
        }
        th, [role="columnheader"], [role="rowheader"] {
          color: #FFE600 !important;
          font-weight: 700 !important;
        }

        /* 16. Google Forms Background Decor Neutralization */
        .I35ICe, .TE328e, .R30eSc {
          display: none !important;
        }
        .freebirdLightBackground, .m2, .D15tUd, .kFwPee, .teQ2e {
          background-color: #000000 !important;
          background-image: none !important;
        }

        /* 17. High Visibility Focus Ring for Tab Navigation */
        :focus-visible, a:focus, button:focus, [role="button"]:focus, .uArJbe:focus {
          outline: 3px solid #00E5FF !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 5px #000000 !important;
        }

        /* 18. Media & Vector Icons */
        img, video, canvas {
          filter: contrast(110%) brightness(95%);
        }
        body svg:not(#aira-root svg):not(#aira-root *) {
          fill: currentColor !important;
        }
        body svg:not(#aira-root svg):not(#aira-root *) path {
          fill: inherit !important;
        }
      `);
    }

    // 2. Dynamic Percentage Font Scaling (Works across pixel-based frameworks & rem-based sites)
    if (fontScale !== 100) {
      cssRules.push(`
        /* Zoom the host body so all pixel-based frameworks (Google Forms, React, etc.) scale proportionally */
        body {
          zoom: ${fontScale / 100} !important;
        }

        /* Root font-size scaling for rem/em-based frameworks */
        html {
          font-size: ${fontScale}% !important;
        }

        /* Explicit font scaling for form fields, labels, questions, and content */
        input, textarea, select, .whsOnd, .KHxj8b {
          font-size: calc(1rem * ${fontScale / 100}) !important;
        }
      `);
    }

    // 3. Dynamic Percentage Control & Touch Target Scaling
    if (controlScale !== 100) {
      const minHeight = Math.round(44 * (controlScale / 100));
      const padY = Math.round(10 * (controlScale / 100));
      const radioSize = Math.round(20 * (controlScale / 100));
      const scaleMultiplier = controlScale / 100;
      cssRules.push(`
        button, a[role="button"], input[type="button"], input[type="submit"], input[type="reset"],
        input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea,
        .whsOnd, .KHxj8b, .uArJbe {
          min-height: ${minHeight}px !important;
          padding-top: ${padY}px !important;
          padding-bottom: ${padY}px !important;
          font-size: calc(1rem * ${scaleMultiplier}) !important;
        }
        button *, [role="button"] *, .uArJbe * {
          font-size: calc(1rem * ${scaleMultiplier}) !important;
        }
        /* Scale radio and checkbox size proportionally without distorting circular / square shape */
        div[role="radio"], [role="radio"],
        div[role="checkbox"], [role="checkbox"] {
          width: ${radioSize}px !important;
          height: ${radioSize}px !important;
          min-width: ${radioSize}px !important;
          min-height: ${radioSize}px !important;
        }
        input[type="radio"], input[type="checkbox"] {
          transform: scale(${scaleMultiplier}) !important;
          transform-origin: center center !important;
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

/**
 * AIRA - Navigation Spotlight & Beacon Pointer (TypeScript)
 * Highlights and beacons target DOM elements on host page with guided confirmation.
 */

import { soundEffects } from '../shared/sound_effects';
import { ttsService } from '../services/tts_service';

export class SpotlightManager {
  private hostContainer: HTMLElement | null = null;
  private spotlightEl: HTMLElement | null = null;
  private tooltipEl: HTMLElement | null = null;
  private currentTarget: HTMLElement | null = null;

  public init(container: HTMLElement): void {
    this.hostContainer = container;
  }

  public show(targetEl: HTMLElement, explanation: string, onConfirm: () => void, onCancel: () => void): void {
    this.hide();

    if (!this.hostContainer || !targetEl) return;
    this.currentTarget = targetEl;

    // Scroll target into view smoothly
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    soundEffects.playStep();

    const rect = targetEl.getBoundingClientRect();

    // 1. Create spotlight overlay frame (halo)
    const box = document.createElement('div');
    box.className = 'aira-spotlight-box';
    box.style.top = `${rect.top - 6}px`;
    box.style.left = `${rect.left - 6}px`;
    box.style.width = `${rect.width + 12}px`;
    box.style.height = `${rect.height + 12}px`;
    this.spotlightEl = box;
    this.hostContainer.appendChild(box);

    // 2. Create interactive tooltip (IFEST-DESIGN Callout Container)
    const tooltip = document.createElement('div');
    tooltip.className = 'aira-spotlight-tooltip';

    // Position tooltip above or below target
    let tooltipTop = rect.bottom + 16;
    if (tooltipTop + 160 > window.innerHeight) {
      tooltipTop = Math.max(10, rect.top - 120);
    }
    let tooltipLeft = Math.max(10, Math.min(rect.left, window.innerWidth - 460));

    tooltip.style.top = `${tooltipTop}px`;
    tooltip.style.left = `${tooltipLeft}px`;

    tooltip.innerHTML = `
      <div class="aira-spotlight-callout-brand">
        <span class="aira-logotype aira-logotype--gradient" aria-label="AIRA">
          <span class="letter-a">A</span><span class="letters-ira">IRA</span>
        </span>
      </div>
      <div class="aira-spotlight-callout-row">
        <button type="button" class="aira-spotlight-icon-circle aira-cancel-btn" title="Tutup Petunjuk (Esc)" aria-label="Tutup">
          <span class="material-symbols-rounded">close</span>
        </button>
        <button type="button" class="aira-spotlight-icon-circle aira-audio-btn" title="Dengarkan Suara" aria-label="Dengarkan">
          <span class="material-symbols-rounded">volume_up</span>
        </button>
        <div class="aira-spotlight-bubble">
          <span>${explanation}</span>
          <button type="button" class="aira-spotlight-confirm-btn aira-confirm-btn">
            Buka Sekarang →
          </button>
        </div>
      </div>
    `;

    tooltip.querySelector('.aira-audio-btn')?.addEventListener('click', () => {
      ttsService.speak(explanation);
    });

    tooltip.querySelector('.aira-confirm-btn')?.addEventListener('click', () => {
      soundEffects.playClick();
      this.hide();
      targetEl.click();
      onConfirm();
    });

    tooltip.querySelector('.aira-cancel-btn')?.addEventListener('click', () => {
      this.hide();
      onCancel();
    });

    this.tooltipEl = tooltip;
    this.hostContainer.appendChild(tooltip);

    // Update positions on window resize or scroll
    const updatePosition = () => {
      if (!this.currentTarget || !this.spotlightEl || !this.tooltipEl) return;
      const r = this.currentTarget.getBoundingClientRect();
      this.spotlightEl.style.top = `${r.top - 6}px`;
      this.spotlightEl.style.left = `${r.left - 6}px`;
      this.spotlightEl.style.width = `${r.width + 12}px`;
      this.spotlightEl.style.height = `${r.height + 12}px`;
    };

    window.addEventListener('scroll', updatePosition, { passive: true, once: false });
  }

  public hide(): void {
    if (this.spotlightEl) {
      this.spotlightEl.remove();
      this.spotlightEl = null;
    }
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
    this.currentTarget = null;
  }
}

export const spotlightManager = new SpotlightManager();

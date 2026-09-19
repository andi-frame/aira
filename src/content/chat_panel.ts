/**
 * AIRA - Docked Sidebar Component (TypeScript)
 * In-Page Docked Sidebar (Helperbird-style) adhering strictly to IFEST-DESIGN.
 * Features:
 * - Extension Top Bar: Dark #2D3238 bar with circular AIRA logo, gradient logotype, voice-only toggle, mute & close.
 * - Viewport Card: Inner white rounded card (20px radius).
 * - 3 Navigation Tabs: Beranda (Home / Aksi Cepat), Percakapan (AIRA Chat), and Pengaturan (Settings).
 * - Action Cards: "Temukan halaman yang kamu cari", "Bantu isi formulir", "Jelaskan & Ringkas Situs Ini".
 * - Accessibility Stepper: Real-time web page text scale adjustment (80% - 180%).
 * - Content Reflow: Smoothly pushes host web page documentElement margin-right by 400px when open.
 */

import { ChatMessage, AiraSettings } from '../types/index';
import { FormFieldMetadata } from '../types/dom';
import { ttsService } from '../services/tts_service';
import { sttService } from '../services/stt_service';
import { agentService } from '../services/agent_service';
import { soundEffects } from '../shared/sound_effects';
import { storageManager } from '../shared/storage';
import { settingsPanel } from './settings_panel';

export class ChatPanelComponent {
  private container: HTMLElement | null = null;
  private drawerEl: HTMLElement | null = null;
  private messages: ChatMessage[] = [];
  private activeTab: 'home' | 'chat' | 'settings' = 'home';
  private onSendMessageCallback: ((text: string) => void) | null = null;
  private onToggleVoiceOnlyCallback: (() => void) | null = null;
  private onToggleVoiceInputCallback: (() => void) | null = null;
  private onReturnToFormCallback: (() => void) | null = null;
  private activeHelpField: FormFieldMetadata | null = null;
  private currentFontScale: number = 100;
  private currentControlScale: number = 100;
  private unsubscribeStorage: (() => void) | null = null;

  public init(
    container: HTMLElement, 
    onSendMessage: (text: string) => void,
    onToggleVoiceOnly: () => void,
    onToggleVoiceInput?: () => void
  ): void {
    this.container = container;
    this.onSendMessageCallback = onSendMessage;
    this.onToggleVoiceOnlyCallback = onToggleVoiceOnly;
    this.onToggleVoiceInputCallback = onToggleVoiceInput || null;

    this.render();
  }

  public setListeningState(isListening: boolean, interimText?: string): void {
    if (!this.drawerEl) return;
    const micBtn = this.drawerEl.querySelector('#aira-mic-btn') as HTMLElement | null;
    if (micBtn) {
      if (isListening) {
        micBtn.classList.add('aira-listening');
        micBtn.title = 'Sedang mendengarkan... (Klik atau lepas Alt+S untuk selesai)';
      } else {
        micBtn.classList.remove('aira-listening');
        micBtn.title = 'Bicara (Klik atau tahan Alt+S)';
      }
    }

    if (isListening) {
      if (this.activeTab !== 'chat') {
        this.switchToTab('chat');
      }
      this.setLiveTranscription(interimText || 'Mendengarkan ucapan Anda...');
    } else {
      this.setLiveTranscription('');
    }
  }

  public toggle(open?: boolean): void {
    if (!this.drawerEl) return;
    const shouldOpen = open !== undefined ? open : this.drawerEl.classList.contains('aira-hidden');
    const triggerBtn = (this.container?.querySelector('.aira-trigger-btn') ||
      (typeof document !== 'undefined' ? document.querySelector('#aira-root')?.shadowRoot?.querySelector('.aira-trigger-btn') : null)) as HTMLElement | null;
    const rootHost = typeof document !== 'undefined' ? document.querySelector('#aira-root') as HTMLElement | null : null;

    if (shouldOpen) {
      this.drawerEl.classList.remove('aira-hidden');
      soundEffects.playStep();

      if (rootHost) {
        rootHost.setAttribute('data-sidebar-open', 'true');
      }

      if (triggerBtn) {
        triggerBtn.classList.add('aira-hidden');
        triggerBtn.style.setProperty('display', 'none', 'important');
      }

      // Smooth in-page document content reflow (Helperbird-style docking)
      try {
        document.documentElement.style.transition = 'margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        document.documentElement.style.marginRight = '400px';
      } catch (e) {
        // Safe fallback
      }

      if (this.activeTab === 'chat') {
        const input = this.drawerEl.querySelector('#aira-chat-text-input') as HTMLInputElement | null;
        setTimeout(() => input?.focus(), 150);
      }
    } else {
      this.drawerEl.classList.add('aira-hidden');
      sttService.stopListening();

      if (rootHost) {
        rootHost.setAttribute('data-sidebar-open', 'false');
      }

      if (triggerBtn) {
        triggerBtn.classList.remove('aira-hidden');
        triggerBtn.style.removeProperty('display');
      }

      try {
        document.documentElement.style.marginRight = '0px';
      } catch (e) {
        // Safe fallback
      }
    }
  }

  public isOpen(): boolean {
    return !!this.drawerEl && !this.drawerEl.classList.contains('aira-hidden');
  }

  public switchToTab(tab: 'home' | 'chat' | 'settings'): void {
    this.activeTab = tab;
    if (!this.drawerEl) return;

    const homeTabBtn = this.drawerEl.querySelector('#aira-tab-home') as HTMLElement | null;
    const chatTabBtn = this.drawerEl.querySelector('#aira-tab-chat') as HTMLElement | null;
    const settingsTabBtn = this.drawerEl.querySelector('#aira-tab-settings') as HTMLElement | null;

    const homeView = this.drawerEl.querySelector('#aira-home-view') as HTMLElement | null;
    const chatView = this.drawerEl.querySelector('#aira-chat-view') as HTMLElement | null;
    const settingsWrap = this.drawerEl.querySelector('#aira-settings-view-wrap') as HTMLElement | null;

    homeTabBtn?.classList.toggle('aira-active', tab === 'home');
    chatTabBtn?.classList.toggle('aira-active', tab === 'chat');
    settingsTabBtn?.classList.toggle('aira-active', tab === 'settings');

    if (homeView) homeView.style.display = tab === 'home' ? 'flex' : 'none';
    if (chatView) chatView.style.display = tab === 'chat' ? 'flex' : 'none';
    if (settingsWrap) settingsWrap.style.display = tab === 'settings' ? 'block' : 'none';

    if (tab === 'chat') {
      const stream = this.drawerEl.querySelector('#aira-messages-stream') as HTMLElement | null;
      if (stream) stream.scrollTop = stream.scrollHeight;
      const input = this.drawerEl.querySelector('#aira-chat-text-input') as HTMLInputElement | null;
      setTimeout(() => input?.focus(), 150);
    } else if (tab === 'settings' && settingsWrap) {
      if (settingsWrap.children.length === 0) {
        settingsPanel.init(settingsWrap).then(() => {
          settingsWrap.appendChild(settingsPanel.render());
        });
      }
    }

    soundEffects.playStep();
  }

  public addMessage(role: 'user' | 'assistant' | 'system', content: string, autoSpeak: boolean = true): void {
    const msg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      role,
      content,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    };

    this.messages.push(msg);
    this.appendMessageElement(msg);

    // If receiving message and currently on home tab, transition to chat view
    if (this.activeTab !== 'chat') {
      this.switchToTab('chat');
    }

    if (role === 'assistant' && autoSpeak) {
      ttsService.speak(content);
    }
  }

  private appendMessageElement(msg: ChatMessage): void {
    const stream = this.drawerEl?.querySelector('#aira-messages-stream') as HTMLElement | null;
    if (!stream) return;

    const el = document.createElement('div');
    el.className = `aira-msg aira-msg-${msg.role}`;
    el.setAttribute('data-msg-id', msg.id);

    el.innerHTML = `
      <div class="aira-bubble">${msg.content}</div>
      <div class="aira-msg-meta">
        <span>${msg.timestamp}</span>
        ${msg.role === 'assistant' ? `
          <button type="button" class="aira-speak-btn" title="Dengarkan suara">
            <span class="material-symbols-rounded" style="font-size: 16px;">volume_up</span>
            <span>Dengarkan</span>
          </button>
        ` : ''}
      </div>
    `;

    if (msg.role === 'assistant') {
      el.querySelector('.aira-speak-btn')?.addEventListener('click', () => {
        ttsService.speak(msg.content);
      });
    }

    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
  }

  public setLiveTranscription(text: string): void {
    const bar = this.drawerEl?.querySelector('#aira-live-stt-bar') as HTMLElement | null;
    const textSpan = this.drawerEl?.querySelector('#aira-live-stt-text') as HTMLElement | null;
    if (!bar || !textSpan) return;

    if (text) {
      bar.style.display = 'flex';
      textSpan.innerText = `"${text}"`;
    } else {
      bar.style.display = 'none';
      textSpan.innerText = '';
    }
  }

  public clearInput(): void {
    const inputEl = this.drawerEl?.querySelector('#aira-chat-text-input') as HTMLInputElement | null;
    if (inputEl) {
      inputEl.value = '';
    }
  }

  public render(): void {
    if (!this.container) return;

    const drawer = document.createElement('div');
    drawer.className = 'aira-chat-drawer aira-sidebar-frame aira-hidden';

    // Indonesian date format
    const dateStr = new Date().toLocaleDateString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    drawer.innerHTML = `
      <!-- Extension Top Bar (Dark Bar #2D3238) -->
      <div class="aira-sidebar-topbar">
        <div class="aira-topbar-brand">
          <span class="aira-logotype aira-logotype--gradient aira-brand-title" aria-label="AIRA">
            <span class="letter-a">A</span><span class="letters-ira">IRA</span>
          </span>
        </div>
        <div class="aira-topbar-actions">
          <button type="button" class="aira-topbar-icon-btn" id="aira-btn-toggle-voiceonly" title="Toggle Mode Suara Penuh (Alt+A) | Push to Talk (Alt+S)" aria-label="Toggle Voice Only">
            <span class="material-symbols-rounded">mic</span>
          </button>
          <button type="button" class="aira-topbar-icon-btn" id="aira-btn-mute" title="Mute Suara / Berhenti Bicara" aria-label="Stop Voice">
            <span class="material-symbols-rounded">volume_up</span>
          </button>
          <button type="button" class="aira-topbar-icon-btn" id="aira-btn-minimize" title="Tutup Sidebar" aria-label="Tutup Sidebar">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      </div>

      <!-- Inner Viewport Card -->
      <div class="aira-sidebar-viewport">
        <!-- 3 Tabs Navigation -->
        <div class="aira-tabs-nav">
          <button type="button" class="aira-tab-btn aira-active" id="aira-tab-home">
            <span class="material-symbols-rounded" style="font-size: 18px;">home</span>
            <span>Beranda</span>
          </button>
          <button type="button" class="aira-tab-btn" id="aira-tab-chat">
            <span class="material-symbols-rounded" style="font-size: 18px;">chat</span>
            <span>Percakapan</span>
          </button>
          <button type="button" class="aira-tab-btn" id="aira-tab-settings">
            <span class="material-symbols-rounded" style="font-size: 18px;">settings</span>
            <span>Pengaturan</span>
          </button>
        </div>

        <!-- Tab Body Container -->
        <div id="aira-tab-content" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative;">

          <!-- TAB 1: HOME VIEW (Aksi Cepat) -->
          <div id="aira-home-view" class="aira-panel-home" style="display: flex;">
            <h2 class="aira-panel-hero-title">
              <span class="aira-hero-line-1"><span class="letter-a">A</span>IRA Siap</span><br>
              <span class="aira-hero-line-2">Membantu!</span>
            </h2>

            <div class="aira-info-header">
              <span class="material-symbols-rounded aira-info-icon" style="font-size: 20px;">info</span>
              <span>Bagaimana <span class="brand-aira"><em>A</em>IRA</span> dapat membantumu?</span>
            </div>

            <!-- Action Card 1: Navigasi Cepat -->
            <button type="button" class="aira-action-card" data-action="nav">
              <div class="aira-action-card__title">Temukan halaman yang kamu cari</div>
              <div class="aira-action-card__desc">Navigasi cepat ke menu, artikel, atau layanan penting di situs ini.</div>
            </button>

            <!-- Action Card 2: Form Assistant -->
            <button type="button" class="aira-action-card" data-action="form">
              <div class="aira-action-card__title">Bantu isi formulir</div>
              <div class="aira-action-card__desc">Bimbingan suara otomatis untuk mengisi kolom input satu per satu.</div>
            </button>

            <!-- Action Card 3: Summary -->
            <button type="button" class="aira-action-card" data-action="summary">
              <div class="aira-action-card__title">Jelaskan & Ringkas Situs Ini</div>
              <div class="aira-action-card__desc">Dapatkan ringkasan poin-poin penting isi halaman web saat ini.</div>
            </button>

            <!-- CARD: Mode Suara Penuh (Voice Only) -->
            <div class="aira-settings-card aira-settings-card--highlight" style="margin-top: 4px;">
              <label class="aira-switch-row" for="aira-home-voiceonly">
                <div class="aira-switch-info">
                  <div class="aira-switch-title">
                    <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 20px;">mic</span>
                    <span>Mode Suara Penuh (Voice Only)</span>
                  </div>
                  <p class="aira-switch-desc">Kontrol seluruh web hanya lewat suara tanpa mouse (Alt+A / Alt+S)</p>
                </div>
                <div class="aira-switch">
                  <input type="checkbox" id="aira-home-voiceonly" />
                  <span class="aira-switch-slider"></span>
                </div>
              </label>
            </div>

            <!-- CARD: Aksesibilitas Halaman Web (WCAG) -->
            <div class="aira-settings-card">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 20px;">accessibility_new</span>
                <span style="font-size: 15px; font-weight: 600; color: #000000;">Aksesibilitas Halaman Web (WCAG)</span>
              </div>

              <!-- Ukuran Teks Halaman -->
              <div style="font-size: 13.5px; font-weight: 600; color: #2D3238; margin-bottom: 6px;">Ukuran Teks Halaman</div>
              <div class="aira-stepper-control">
                <button type="button" class="aira-stepper-btn" id="aira-step-decrease-font" title="Perkecil Ukuran Teks">
                  <span class="material-symbols-rounded" style="font-size: 18px;">remove</span> Perkecil
                </button>
                <span class="aira-stepper-value" id="aira-step-font-value">100%</span>
                <button type="button" class="aira-stepper-btn" id="aira-step-increase-font" title="Perbesar Ukuran Teks">
                  <span class="material-symbols-rounded" style="font-size: 18px;">add</span> Perbesar
                </button>
              </div>

              <!-- Ukuran Tombol & Kontrol Web -->
              <div style="font-size: 13.5px; font-weight: 600; color: #2D3238; margin: 10px 0 6px 0;">Ukuran Tombol & Input Web</div>
              <div class="aira-stepper-control">
                <button type="button" class="aira-stepper-btn" id="aira-step-decrease-ctrl" title="Perkecil Tombol & Input">
                  <span class="material-symbols-rounded" style="font-size: 18px;">remove</span> Perkecil
                </button>
                <span class="aira-stepper-value" id="aira-step-ctrl-value">100%</span>
                <button type="button" class="aira-stepper-btn" id="aira-step-increase-ctrl" title="Perbesar Tombol & Input">
                  <span class="material-symbols-rounded" style="font-size: 18px;">add</span> Perbesar
                </button>
              </div>

              <!-- Mode Kontras Tinggi -->
              <div style="border-top: 1px solid #ECEFF3; margin: 12px 0 10px 0;"></div>
              <label class="aira-switch-row" for="aira-home-contrast" style="margin-bottom: 12px;">
                <div class="aira-switch-info">
                  <div class="aira-switch-title">
                    <span class="material-symbols-rounded" style="font-size: 19px; color: #545454;">contrast</span>
                    <span>Kontras Tinggi (WCAG AAA)</span>
                  </div>
                  <p class="aira-switch-desc">Ubah latar hitam pekat & teks kuning kontras 19.5:1</p>
                </div>
                <div class="aira-switch">
                  <input type="checkbox" id="aira-home-contrast" />
                  <span class="aira-switch-slider"></span>
                </div>
              </label>

              <!-- Sensory Shield / Redam Animasi -->
              <label class="aira-switch-row" for="aira-home-motion">
                <div class="aira-switch-info">
                  <div class="aira-switch-title">
                    <span class="material-symbols-rounded" style="font-size: 19px; color: #545454;">motion_photos_off</span>
                    <span>Sensory Shield (Redam Animasi)</span>
                  </div>
                  <p class="aira-switch-desc">Meredam kedipan dan animasi berlebih di situs web</p>
                </div>
                <div class="aira-switch">
                  <input type="checkbox" id="aira-home-motion" />
                  <span class="aira-switch-slider"></span>
                </div>
              </label>
            </div>
          </div>

          <!-- TAB 2: CHAT VIEW -->
          <div id="aira-chat-view" style="flex: 1; display: none; flex-direction: column; overflow: hidden; width: 100%; max-width: 100%; box-sizing: border-box;">
            <div class="aira-messages-stream" id="aira-messages-stream">
              <div class="aira-date-divider">${dateStr}</div>
            </div>

            <!-- Quick Action Chips -->
            <div class="aira-quick-chips">
              <button type="button" class="aira-chip-btn" data-action="summary">
                <span class="material-symbols-rounded" style="font-size: 17px;">description</span>
                <span>Ringkas Halaman</span>
              </button>
              <button type="button" class="aira-chip-btn" data-action="form">
                <span class="material-symbols-rounded" style="font-size: 17px;">edit_document</span>
                <span>Bantu Isi Formulir</span>
              </button>
              <button type="button" class="aira-chip-btn" data-action="nav">
                <span class="material-symbols-rounded" style="font-size: 17px;">explore</span>
                <span>Cari Menu Layanan</span>
              </button>
            </div>

            <!-- Real-Time Speech Bar -->
            <div class="aira-live-stt-bar" id="aira-live-stt-bar" style="display: none;">
              <div class="aira-wave-bars">
                <div class="aira-wave-bar"></div>
                <div class="aira-wave-bar"></div>
                <div class="aira-wave-bar"></div>
                <div class="aira-wave-bar"></div>
              </div>
              <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <span style="font-weight: 700;">Mendengar:</span> <span id="aira-live-stt-text"></span>
              </div>
            </div>

            <!-- Field Help Mode Banner -->
            <div class="aira-field-help-bar" id="aira-field-help-bar" style="display: none;">
              <div class="aira-field-help-info">
                <span class="aira-field-help-icon">💡</span>
                <span class="aira-field-help-title">Bantuan: <strong id="aira-field-help-label"></strong></span>
              </div>
              <button type="button" class="aira-field-help-done-btn" id="aira-field-help-done" title="Selesai bertanya, kembali mengisi formulir (Alt+C)">
                ✍️ Siap Mengisi (Alt+C)
              </button>
            </div>

            <!-- Input Bar -->
            <div class="aira-input-bar">
              <button type="button" class="aira-mic-btn" id="aira-mic-btn" title="Bicara (Klik atau tahan Alt+S)">
                <span class="material-symbols-rounded">mic</span>
              </button>
              <input
                type="text"
                class="aira-text-input"
                id="aira-chat-text-input"
                placeholder="Tanyakan atau tahan Alt+S untuk bicara..."
                autocomplete="off"
              />
              <button type="button" class="aira-send-btn" id="aira-send-btn">
                Kirim
              </button>
            </div>
          </div>

          <!-- TAB 3: SETTINGS VIEW -->
          <div id="aira-settings-view-wrap" style="display: none; flex: 1; overflow-y: auto;"></div>
        </div>
      </div>
    `;

    this.drawerEl = drawer;
    this.container.appendChild(drawer);

    this.bindEvents();
    this.initAccessibilityControls();

    // Default friendly assistant greeting in stream
    this.addMessage('assistant', 'Halo! Saya AIRA, asisten adaptif Anda. Anda dapat mengetik pertanyaan, mengklik tombol mikrofon, atau menahan tombol Alt + S (Push to Talk) untuk berbicara kapan saja.', false);
    // Keep initial tab on Beranda
    this.switchToTab('home');
  }

  private async initAccessibilityControls(): Promise<void> {
    if (!this.drawerEl) return;
    const fontValueEl = this.drawerEl.querySelector('#aira-step-font-value') as HTMLElement | null;
    const fontDecBtn = this.drawerEl.querySelector('#aira-step-decrease-font') as HTMLElement | null;
    const fontIncBtn = this.drawerEl.querySelector('#aira-step-increase-font') as HTMLElement | null;

    const ctrlValueEl = this.drawerEl.querySelector('#aira-step-ctrl-value') as HTMLElement | null;
    const ctrlDecBtn = this.drawerEl.querySelector('#aira-step-decrease-ctrl') as HTMLElement | null;
    const ctrlIncBtn = this.drawerEl.querySelector('#aira-step-increase-ctrl') as HTMLElement | null;

    const voiceOnlySwitch = this.drawerEl.querySelector('#aira-home-voiceonly') as HTMLInputElement | null;
    const contrastSwitch = this.drawerEl.querySelector('#aira-home-contrast') as HTMLInputElement | null;
    const motionSwitch = this.drawerEl.querySelector('#aira-home-motion') as HTMLInputElement | null;

    const updateUIFromSettings = (s: AiraSettings) => {
      this.currentFontScale = s.fontScale ?? (s.fontSize === 'large' ? 125 : s.fontSize === 'xlarge' ? 150 : 100);
      this.currentControlScale = s.controlScale ?? (s.controlSize === 'large' ? 125 : s.controlSize === 'xlarge' ? 150 : 100);

      if (fontValueEl) fontValueEl.innerText = `${this.currentFontScale}%`;
      if (ctrlValueEl) ctrlValueEl.innerText = `${this.currentControlScale}%`;
      if (voiceOnlySwitch) voiceOnlySwitch.checked = !!s.voiceOnlyMode;
      if (contrastSwitch) contrastSwitch.checked = !!s.highContrast;
      if (motionSwitch) motionSwitch.checked = !!s.reduceMotion;
      this.updateVoiceOnlyBadge(!!s.voiceOnlyMode);
    };

    try {
      const s = await storageManager.getSettings();
      updateUIFromSettings(s);
    } catch (e) {
      // Fallback
    }

    this.unsubscribeStorage = storageManager.subscribe((newSettings) => {
      updateUIFromSettings(newSettings);
    });

    // Font Steppers
    fontDecBtn?.addEventListener('click', async () => {
      const newScale = Math.max(80, this.currentFontScale - 10);
      this.currentFontScale = newScale;
      if (fontValueEl) fontValueEl.innerText = `${newScale}%`;
      await storageManager.saveSettings({ fontScale: newScale });
      soundEffects.playStep();
    });

    fontIncBtn?.addEventListener('click', async () => {
      const newScale = Math.min(180, this.currentFontScale + 10);
      this.currentFontScale = newScale;
      if (fontValueEl) fontValueEl.innerText = `${newScale}%`;
      await storageManager.saveSettings({ fontScale: newScale });
      soundEffects.playStep();
    });

    // Control Steppers
    ctrlDecBtn?.addEventListener('click', async () => {
      const newScale = Math.max(100, this.currentControlScale - 10);
      this.currentControlScale = newScale;
      if (ctrlValueEl) ctrlValueEl.innerText = `${newScale}%`;
      await storageManager.saveSettings({ controlScale: newScale });
      soundEffects.playStep();
    });

    ctrlIncBtn?.addEventListener('click', async () => {
      const newScale = Math.min(200, this.currentControlScale + 10);
      this.currentControlScale = newScale;
      if (ctrlValueEl) ctrlValueEl.innerText = `${newScale}%`;
      await storageManager.saveSettings({ controlScale: newScale });
      soundEffects.playStep();
    });

    // Switches
    voiceOnlySwitch?.addEventListener('change', async () => {
      const isChecked = voiceOnlySwitch.checked;
      await storageManager.saveSettings({ voiceOnlyMode: isChecked });
      this.updateVoiceOnlyBadge(isChecked);
      soundEffects.playStep();
    });

    contrastSwitch?.addEventListener('change', async () => {
      await storageManager.saveSettings({ highContrast: contrastSwitch.checked });
      soundEffects.playStep();
    });

    motionSwitch?.addEventListener('change', async () => {
      await storageManager.saveSettings({ reduceMotion: motionSwitch.checked });
      soundEffects.playStep();
    });
  }

  private bindEvents(): void {
    if (!this.drawerEl) return;

    // Tabs navigation click handlers
    this.drawerEl.querySelector('#aira-tab-home')?.addEventListener('click', () => {
      this.switchToTab('home');
    });

    this.drawerEl.querySelector('#aira-tab-chat')?.addEventListener('click', () => {
      this.switchToTab('chat');
    });

    this.drawerEl.querySelector('#aira-tab-settings')?.addEventListener('click', () => {
      this.switchToTab('settings');
    });

    // Action cards click handlers
    this.drawerEl.querySelectorAll('.aira-action-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const action = (e.currentTarget as HTMLElement).getAttribute('data-action');
        if (action === 'nav') {
          this.executeQuickAction('Tunjukkan menu atau tombol utama di halaman ini');
        } else if (action === 'form') {
          this.executeQuickAction('Bantu saya mengisi formulir di halaman ini');
        } else if (action === 'summary') {
          this.executeQuickAction('Tolong rangkum isi halaman ini');
        }
      });
    });

    // Close button
    this.drawerEl.querySelector('#aira-btn-minimize')?.addEventListener('click', () => {
      this.toggle(false);
    });

    // Mute button
    this.drawerEl.querySelector('#aira-btn-mute')?.addEventListener('click', () => {
      ttsService.stop();
      soundEffects.playStep();
    });

    // Voice Only button
    this.drawerEl.querySelector('#aira-btn-toggle-voiceonly')?.addEventListener('click', () => {
      if (this.onToggleVoiceOnlyCallback) {
        this.onToggleVoiceOnlyCallback();
      }
    });

    // Wire field help done button
    this.drawerEl.querySelector('#aira-field-help-done')?.addEventListener('click', () => {
      this.closeFieldHelp(true);
    });

    // Send text
    const textInput = this.drawerEl.querySelector('#aira-chat-text-input') as HTMLInputElement;
    const sendBtn = this.drawerEl.querySelector('#aira-send-btn') as HTMLElement;

    const doSend = () => {
      const val = textInput.value.trim();
      if (!val) return;
      textInput.value = '';
      this.addMessage('user', val, false);
      if (this.isFieldHelpActive()) {
        void this.handleFieldQuestion(val);
      } else if (this.onSendMessageCallback) {
        this.onSendMessageCallback(val);
      }
    };

    sendBtn.addEventListener('click', doSend);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSend();
      }
    });

    // Mic button
    const micBtn = this.drawerEl.querySelector('#aira-mic-btn') as HTMLElement;
    micBtn.addEventListener('click', () => {
      if (this.onToggleVoiceInputCallback) {
        this.onToggleVoiceInputCallback();
      } else {
        if (sttService.isListening()) {
          sttService.stopListening();
          this.setListeningState(false);
        } else {
          this.setListeningState(true);
          sttService.startListening({
            onInterim: (text) => {
              this.setLiveTranscription(text);
            },
            onFinal: (finalText) => {
              this.setListeningState(false);
              this.addMessage('user', finalText, false);
              if (this.isFieldHelpActive()) {
                void this.handleFieldQuestion(finalText);
              } else if (this.onSendMessageCallback) {
                this.onSendMessageCallback(finalText);
              }
            },
            onError: (err) => {
              this.setListeningState(false);
              this.addMessage('system', `Peringatan mikrofon: ${err}`, false);
            }
          });
        }
      }
    });

    this.bindQuickChips();
  }

  private bindQuickChips(): void {
    if (!this.drawerEl) return;
    this.drawerEl.querySelectorAll('.aira-chip-btn').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        const action = (e.currentTarget as HTMLElement).getAttribute('data-action');
        if (action === 'summary') {
          this.doSendWithText('Tolong rangkum isi halaman ini');
        } else if (action === 'form') {
          this.doSendWithText('Bantu saya mengisi formulir di halaman ini');
        } else if (action === 'nav') {
          this.doSendWithText('Tunjukkan menu atau tombol utama di halaman ini');
        }
      });
    });
  }

  private doSendWithText(txt: string): void {
    this.addMessage('user', txt, false);
    if (this.isFieldHelpActive()) {
      void this.handleFieldQuestion(txt);
    } else if (this.onSendMessageCallback) {
      this.onSendMessageCallback(txt);
    }
  }

  public setOnReturnToFormCallback(cb: () => void): void {
    this.onReturnToFormCallback = cb;
  }

  public isFieldHelpActive(): boolean {
    return !!this.activeHelpField;
  }

  public getActiveHelpField(): FormFieldMetadata | null {
    return this.activeHelpField;
  }

  public openFieldHelp(field: FormFieldMetadata): void {
    this.activeHelpField = field;
    this.toggle(true);

    // Switch to chat tab if currently on settings tab
    if (this.activeTab !== 'chat') {
      const chatTabBtn = this.drawerEl?.querySelector('#aira-tab-chat') as HTMLElement | null;
      chatTabBtn?.click();
    }

    // Show field help mode header bar
    const helpBar = this.drawerEl?.querySelector('#aira-field-help-bar') as HTMLElement | null;
    const helpLabel = this.drawerEl?.querySelector('#aira-field-help-label') as HTMLElement | null;
    if (helpBar && helpLabel) {
      helpLabel.innerText = field.label || 'Kolom Isian';
      helpBar.style.display = 'flex';
    }

    // Render quick suggestion chips tailored to this field
    this.renderFieldHelpChips(field);

    // Post contextual guidance message
    const greeting = `💡 **Mode Bantuan Kolom: ${field.label}**\n\nSilakan tanyakan apa saja tentang kolom ini (misalnya: apa artinya, bisa lihat di mana, atau contoh formatnya). Anda bisa menahan **Alt+S** untuk bicara atau mengetik pertanyaan di bawah.`;
    this.addMessage('assistant', greeting, false);

    // Stop any ongoing speech first so the transition voice cue is crystal clear
    ttsService.stop();

    // Spoken prompt / Voice cue
    const fieldName = field.label || 'kolom formulir';
    const spokenGreeting = `Anda sekarang di kolom chat tanya-jawab untuk bantuan ${fieldName}. Silakan tanyakan apa saja tentang kolom ini menggunakan suara Alt+S atau ketik pertanyaan Anda. Tekan Alt+C lagi jika Anda sudah siap untuk mengisi formulir kembali.`;
    ttsService.speak(spokenGreeting);

    // Focus input
    const input = this.drawerEl?.querySelector('#aira-chat-text-input') as HTMLInputElement | null;
    if (input) {
      input.placeholder = `Tanyakan apa saja tentang ${field.label}...`;
      setTimeout(() => input.focus(), 150);
    }
  }

  private renderFieldHelpChips(field: FormFieldMetadata): void {
    const chipsContainer = this.drawerEl?.querySelector('.aira-quick-chips') as HTMLElement | null;
    if (!chipsContainer) return;

    chipsContainer.innerHTML = `
      <button type="button" class="aira-chip-btn aira-help-chip" data-q="Bisa lihat di mana ya?">📍 Bisa lihat di mana?</button>
      <button type="button" class="aira-chip-btn aira-help-chip" data-q="Maksud pertanyaan ${field.label} ini apa ya?">❓ Apa maksudnya?</button>
      <button type="button" class="aira-chip-btn aira-help-chip" data-q="Contoh cara mengisinya seperti apa?">💡 Contoh format?</button>
      <button type="button" class="aira-chip-btn aira-help-chip aira-chip-finish" data-q="__FINISH__">✍️ Siap Mengisi (Alt+C)</button>
    `;

    chipsContainer.querySelectorAll('.aira-help-chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        const q = (e.currentTarget as HTMLElement).getAttribute('data-q') || '';
        if (q === '__FINISH__') {
          this.closeFieldHelp(true);
        } else {
          this.addMessage('user', q, false);
          void this.handleFieldQuestion(q);
        }
      });
    });
  }

  private restoreDefaultChips(): void {
    const chipsContainer = this.drawerEl?.querySelector('.aira-quick-chips') as HTMLElement | null;
    if (!chipsContainer) return;

    chipsContainer.innerHTML = `
      <button type="button" class="aira-chip-btn" data-action="summary">📖 Ringkas Halaman</button>
      <button type="button" class="aira-chip-btn" data-action="form">✍️ Bantu Isi Formulir</button>
      <button type="button" class="aira-chip-btn" data-action="nav">🎯 Cari Menu Layanan</button>
    `;

    this.bindQuickChips();
  }

  public async handleFieldQuestion(questionText: string): Promise<void> {
    const q = (questionText || '').trim();
    if (!q) return;

    const qLower = q.toLowerCase();
    if (['siap mengisi', 'sudah siap', 'selesai', 'kembali ke form', 'tutup bantuan'].some(w => qLower.includes(w))) {
      this.closeFieldHelp(true);
      return;
    }

    if (!this.activeHelpField) return;

    soundEffects.playServerCue('question');
    const answer = await agentService.askFieldQuestion(null, this.activeHelpField, q);
    this.addMessage('assistant', answer, true);
  }

  public closeFieldHelp(returnFocusToWizard: boolean = true): void {
    if (!this.activeHelpField) return;
    this.activeHelpField = null;

    const helpBar = this.drawerEl?.querySelector('#aira-field-help-bar') as HTMLElement | null;
    if (helpBar) helpBar.style.display = 'none';

    const input = this.drawerEl?.querySelector('#aira-chat-text-input') as HTMLInputElement | null;
    if (input) input.placeholder = 'Tanyakan atau tahan Alt+S untuk bicara...';

    this.restoreDefaultChips();
    this.addMessage('system', 'Mode Bantuan Kolom selesai. Kursor diarahkan kembali ke kolom formulir.', false);

    if (returnFocusToWizard) {
      ttsService.speak('Silakan sebutkan atau ketik jawaban Anda.');
      this.onReturnToFormCallback?.();
    }
  }

  private executeQuickAction(text: string): void {
    this.switchToTab('chat');
    this.doSendWithText(text);
  }

  public updateVoiceOnlyBadge(isActive: boolean): void {
    const btn = this.drawerEl?.querySelector('#aira-btn-toggle-voiceonly') as HTMLElement | null;
    const badge = this.drawerEl?.querySelector('#aira-header-status-badge') as HTMLElement | null;

    if (btn) {
      if (isActive) btn.classList.add('aira-active');
      else btn.classList.remove('aira-active');
    }

    if (badge) {
      badge.innerText = isActive ? '🎙️ Voice Only Aktif' : 'Asisten Siap';
    }
  }

  public destroy(): void {
    if (this.unsubscribeStorage) {
      this.unsubscribeStorage();
      this.unsubscribeStorage = null;
    }
  }
}

export const chatPanel = new ChatPanelComponent();

/**
 * AIRA - Chat Panel Component (TypeScript)
 * Interactive chat assistant matching Figma Chat Panel 1 & 2.
 * Includes live speech transcription feedback (Point 10) and full interaction logs (Point 9).
 */

import { ChatMessage, AiraSettings } from '../types/index';
import { ttsService } from '../services/tts_service';
import { sttService } from '../services/stt_service';
import { soundEffects } from '../shared/sound_effects';
import { settingsPanel } from './settings_panel';

export class ChatPanelComponent {
  private container: HTMLElement | null = null;
  private drawerEl: HTMLElement | null = null;
  private messages: ChatMessage[] = [];
  private activeTab: 'chat' | 'settings' = 'chat';
  private onSendMessageCallback: ((text: string) => void) | null = null;
  private onToggleVoiceOnlyCallback: (() => void) | null = null;
  private onToggleVoiceInputCallback: (() => void) | null = null;

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
      this.setLiveTranscription(interimText || 'Mendengarkan ucapan Anda...');
    } else {
      this.setLiveTranscription('');
    }
  }

  public toggle(open?: boolean): void {
    if (!this.drawerEl) return;
    const shouldOpen = open !== undefined ? open : this.drawerEl.classList.contains('aira-hidden');
    if (shouldOpen) {
      this.drawerEl.classList.remove('aira-hidden');
      soundEffects.playStep();
      const input = this.drawerEl.querySelector('#aira-chat-text-input') as HTMLInputElement | null;
      setTimeout(() => input?.focus(), 150);
    } else {
      this.drawerEl.classList.add('aira-hidden');
      sttService.stopListening();
    }
  }

  public isOpen(): boolean {
    return !!this.drawerEl && !this.drawerEl.classList.contains('aira-hidden');
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
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

  public setLiveTranscription(text: string, isFinal: boolean = false): void {
    const bar = this.drawerEl?.querySelector('#aira-live-stt-bar') as HTMLElement | null;
    const textSpan = this.drawerEl?.querySelector('#aira-live-stt-text') as HTMLElement | null;
    if (!bar || !textSpan) return;

    if (text) {
      bar.style.display = 'flex';
      textSpan.innerText = text;
    } else {
      bar.style.display = 'none';
      textSpan.innerText = '';
    }
  }

  public render(): void {
    if (!this.container) return;

    const drawer = document.createElement('div');
    drawer.className = 'aira-chat-drawer aira-hidden';

    // Format current Indonesian date
    const dateStr = new Date().toLocaleDateString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    drawer.innerHTML = `
      <!-- Header -->
      <div class="aira-drawer-header">
        <div class="aira-brand">
          <span class="aira-brand-title">AIRA</span>
          <span class="aira-brand-badge" id="aira-header-status-badge">Asisten Siap</span>
        </div>
        <div class="aira-header-actions">
          <button type="button" class="aira-icon-btn" id="aira-btn-toggle-voiceonly" title="Toggle Mode Suara Penuh (Alt+A) | Push to Talk (Tahan Alt+S)" aria-label="Toggle Voice Only">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          </button>
          <button type="button" class="aira-icon-btn" id="aira-btn-mute" title="Mute Suara / Berhenti Bicara" aria-label="Stop Voice">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          </button>
          <button type="button" class="aira-icon-btn" id="aira-btn-minimize" title="Tutup Panel" aria-label="Tutup Panel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      <!-- Navigation Tabs (Chat vs Settings) -->
      <div class="aira-tabs-nav">
        <button type="button" class="aira-tab-btn aira-active" id="aira-tab-chat">💬 Percakapan & Bantuan</button>
        <button type="button" class="aira-tab-btn" id="aira-tab-settings">⚙️ Pengaturan</button>
      </div>

      <!-- Main Body Container -->
      <div id="aira-tab-content" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
        <!-- Chat View Area -->
        <div id="aira-chat-view" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
          <div class="aira-messages-stream" id="aira-messages-stream">
            <div class="aira-date-divider">${dateStr}</div>
          </div>

          <!-- Quick Action Chips -->
          <div class="aira-quick-chips">
            <button type="button" class="aira-chip-btn" data-action="summary">📖 Ringkas Halaman</button>
            <button type="button" class="aira-chip-btn" data-action="form">✍️ Bantu Isi Formulir</button>
            <button type="button" class="aira-chip-btn" data-action="nav">🎯 Cari Menu Layanan</button>
          </div>

          <!-- Real-Time Speech Bar (Point 10) -->
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

          <!-- Input Bar -->
          <div class="aira-input-bar">
            <button type="button" class="aira-mic-btn" id="aira-mic-btn" title="Bicara (Klik atau tahan Alt+S)">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
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

        <!-- Settings View Area -->
        <div id="aira-settings-view-wrap" style="display: none; flex: 1; overflow-y: auto;"></div>
      </div>
    `;

    this.drawerEl = drawer;
    this.container.appendChild(drawer);

    this.bindEvents();

    // Populate default greeting
    this.addMessage('assistant', 'Halo! Saya AIRA, asisten adaptif Anda. Anda dapat mengetik, mengklik tombol mikrofon, atau menahan tombol Alt + S (Push to Talk) untuk berbicara langsung kapan saja.', false);
  }

  private bindEvents(): void {
    if (!this.drawerEl) return;

    // Tabs switching
    const chatTabBtn = this.drawerEl.querySelector('#aira-tab-chat') as HTMLElement;
    const settingsTabBtn = this.drawerEl.querySelector('#aira-tab-settings') as HTMLElement;
    const chatView = this.drawerEl.querySelector('#aira-chat-view') as HTMLElement;
    const settingsWrap = this.drawerEl.querySelector('#aira-settings-view-wrap') as HTMLElement;

    chatTabBtn.addEventListener('click', () => {
      this.activeTab = 'chat';
      chatTabBtn.classList.add('aira-active');
      settingsTabBtn.classList.remove('aira-active');
      chatView.style.display = 'flex';
      settingsWrap.style.display = 'none';
      soundEffects.playStep();
    });

    settingsTabBtn.addEventListener('click', async () => {
      this.activeTab = 'settings';
      settingsTabBtn.classList.add('aira-active');
      chatTabBtn.classList.remove('aira-active');
      chatView.style.display = 'none';
      settingsWrap.style.display = 'block';

      if (settingsWrap.children.length === 0) {
        await settingsPanel.init(settingsWrap);
        settingsWrap.appendChild(settingsPanel.render());
      }
      soundEffects.playStep();
    });

    // Minimize button
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

    // Send text
    const textInput = this.drawerEl.querySelector('#aira-chat-text-input') as HTMLInputElement;
    const sendBtn = this.drawerEl.querySelector('#aira-send-btn') as HTMLElement;

    const doSend = () => {
      const val = textInput.value.trim();
      if (!val) return;
      textInput.value = '';
      this.addMessage('user', val, false);
      if (this.onSendMessageCallback) {
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
              this.setLiveTranscription(text, false);
            },
            onFinal: (finalText) => {
              this.setListeningState(false);
              this.addMessage('user', finalText, false);
              if (this.onSendMessageCallback) {
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

    // Quick chips
    this.drawerEl.querySelectorAll('.aira-chip-btn').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        const action = (e.currentTarget as HTMLElement).getAttribute('data-action');
        if (action === 'summary') {
          doSendWithText('Tolong rangkum isi halaman ini');
        } else if (action === 'form') {
          doSendWithText('Bantu saya mengisi formulir di halaman ini');
        } else if (action === 'nav') {
          doSendWithText('Tunjukkan menu atau tombol utama di halaman ini');
        }
      });
    });

    const doSendWithText = (txt: string) => {
      this.addMessage('user', txt, false);
      if (this.onSendMessageCallback) {
        this.onSendMessageCallback(txt);
      }
    };
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
}

export const chatPanel = new ChatPanelComponent();

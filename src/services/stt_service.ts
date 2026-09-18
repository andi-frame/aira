/**
 * AIRA - Speech-to-Text (STT) Service (TypeScript)
 * Default: Chrome Web Speech API (Real-time live interim transcription)
 * Secondary: OpenAI Whisper API (when configured in settings)
 */

import { soundEffects } from '../shared/sound_effects';
import { storageManager } from '../shared/storage';
import { AiraSettings } from '../types/index';

interface IWindowSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: IWindowSpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: IWindowSpeechRecognition, ev: ISpeechRecognitionEvent) => void) | null;
  onerror: ((this: IWindowSpeechRecognition, ev: ISpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: IWindowSpeechRecognition, ev: Event) => void) | null;
}

interface ISpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [index: number]: {
        transcript: string;
        confidence: number;
      };
    };
  };
}

interface ISpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

export class STTService {
  private recognition: IWindowSpeechRecognition | null = null;
  private isListeningFlag: boolean = false;
  private manualStopOnly: boolean = true;
  private onInterimCallback: ((text: string) => void) | null = null;
  private onFinalCallback: ((text: string) => void) | null = null;
  private onErrorCallback: ((err: string) => void) | null = null;

  // MediaRecorder state for Whisper
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedAudioChunks: Blob[] = [];
  private sessionBaseTranscript: string = '';
  private currentSessionTranscript: string = '';
  private latestTranscript: string = '';
  private hasDispatchedFinal: boolean = false;
  private stopGraceTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.initRecognition();
  }

  private initRecognition(): void {
    if (typeof window === 'undefined') return;

    const win = window as unknown as {
      SpeechRecognition?: new () => IWindowSpeechRecognition;
      webkitSpeechRecognition?: new () => IWindowSpeechRecognition;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      console.warn('[AIRA STT] SpeechRecognition not supported in this browser.');
      return;
    }

    try {
      this.recognition = new SpeechRec();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'id-ID';
    } catch (e) {
      console.warn('[AIRA STT] SpeechRecognition cannot be instantiated in this context:', e);
      this.recognition = null;
      return;
    }

    if (!this.recognition) return;

    this.recognition.onstart = () => {
      this.isListeningFlag = true;
      if (!this.sessionBaseTranscript) {
        soundEffects.playListenStart();
      }
    };

    this.recognition.onresult = (event: ISpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = 0; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item.isFinal) {
          finalTranscript += item[0].transcript + ' ';
        } else {
          interimTranscript += item[0].transcript;
        }
      }

      const sessionText = (finalTranscript + interimTranscript).trim();
      this.currentSessionTranscript = sessionText;

      const fullTranscript = (this.sessionBaseTranscript ? `${this.sessionBaseTranscript} ${sessionText}` : sessionText).trim();

      if (fullTranscript) {
        this.latestTranscript = fullTranscript;
      }

      if (this.onInterimCallback && fullTranscript) {
        this.onInterimCallback(fullTranscript);
      }

      // Only dispatch onFinal during onresult if manualStopOnly is false
      if (!this.manualStopOnly && finalTranscript.trim() && this.onFinalCallback) {
        this.dispatchFinalTranscript();
      }
    };

    this.recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
      console.warn('[AIRA STT] WebSpeech error:', event.error);

      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      this.isListeningFlag = false;

      let userFriendlyMsg = '';
      if (event.error === 'not-allowed') {
        userFriendlyMsg = 'Izin akses mikrofon belum diaktifkan. Klik ikon gembok/kamera pada address bar Chrome untuk mengizinkan mikrofon.';
      } else if (event.error === 'network') {
        userFriendlyMsg = 'Koneksi pengenalan suara terputus. Pastikan koneksi internet Anda aktif.';
      } else {
        userFriendlyMsg = `Pengenalan suara: ${event.error}`;
      }

      if (this.onErrorCallback && userFriendlyMsg) {
        this.onErrorCallback(userFriendlyMsg);
      }
    };

    this.recognition.onend = () => {
      // If manualStopOnly is active and user is still holding Alt+S, auto-restart session seamlessly
      if (this.manualStopOnly && this.isListeningFlag) {
        if (this.currentSessionTranscript) {
          this.sessionBaseTranscript = (this.sessionBaseTranscript ? `${this.sessionBaseTranscript} ${this.currentSessionTranscript}` : this.currentSessionTranscript).trim();
          this.currentSessionTranscript = '';
        }
        try {
          this.recognition?.start();
          return;
        } catch (e) {
          console.warn('[AIRA STT] Recognition auto-restart failed:', e);
        }
      }

      this.isListeningFlag = false;
      this.dispatchFinalTranscript();
    };
  }

  public isListening(): boolean {
    return this.isListeningFlag;
  }

  public async startListening(callbacks: {
    onInterim?: (text: string) => void;
    onFinal?: (text: string) => void;
    onError?: (err: string) => void;
    manualStopOnly?: boolean;
  }): Promise<boolean> {
    const settings = await storageManager.getSettings();

    this.onInterimCallback = callbacks.onInterim || null;
    this.onFinalCallback = callbacks.onFinal || null;
    this.onErrorCallback = callbacks.onError || null;
    this.manualStopOnly = callbacks.manualStopOnly !== false;

    this.sessionBaseTranscript = '';
    this.currentSessionTranscript = '';
    this.latestTranscript = '';
    this.hasDispatchedFinal = false;

    if (this.stopGraceTimeout) {
      clearTimeout(this.stopGraceTimeout);
      this.stopGraceTimeout = null;
    }

    if (this.isListeningFlag) {
      this.stopListening();
    }

    // Check if Whisper provider is chosen and API key is set
    if (settings.sttProvider === 'whisper' && settings.whisperApiKey) {
      return this.startWhisperRecording(settings);
    }

    // Default: Chrome Web Speech API
    return this.startWebSpeechListening(settings);
  }

  private startWebSpeechListening(settings?: AiraSettings): boolean {
    if (!this.recognition) {
      this.initRecognition();
      if (!this.recognition) {
        if (this.onErrorCallback) this.onErrorCallback('Browser tidak mendukung Speech Recognition.');
        return false;
      }
    }

    this.latestTranscript = '';
    this.hasDispatchedFinal = false;
    this.recognition.lang = settings?.ttsVoiceLang || 'id-ID';

    try {
      this.recognition.start();
      return true;
    } catch (e: unknown) {
      try {
        this.recognition.abort();
        this.recognition.start();
        return true;
      } catch (e2) {
        console.warn('[AIRA STT] WebSpeech start failed:', e2);
        return false;
      }
    }
  }

  private async startWhisperRecording(settings: AiraSettings): Promise<boolean> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('[AIRA Whisper] getUserMedia not available, falling back to Web Speech.');
      return this.startWebSpeechListening();
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordedAudioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.mediaStream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.recordedAudioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.recordedAudioChunks, { type: 'audio/webm' });
        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach(t => t.stop());
          this.mediaStream = null;
        }

        if (audioBlob.size > 1000) {
          if (this.onInterimCallback) {
            this.onInterimCallback('Mengirim rekaman ke Whisper AI...');
          }
          await this.transcribeWithWhisper(audioBlob, settings);
        } else {
          if (this.onInterimCallback) this.onInterimCallback('');
        }
      };

      this.mediaRecorder.start();
      this.isListeningFlag = true;
      soundEffects.playListenStart();
      if (this.onInterimCallback) {
        this.onInterimCallback('Merekam suara (Whisper)...');
      }
      return true;
    } catch (err: unknown) {
      console.warn('[AIRA Whisper] Recording init failed, fallback to WebSpeech:', err);
      return this.startWebSpeechListening();
    }
  }

  private async transcribeWithWhisper(audioBlob: Blob, settings: AiraSettings): Promise<void> {
    const endpoint = settings.whisperEndpoint || 'https://api.openai.com/v1/audio/transcriptions';
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', settings.whisperModel || 'whisper-1');
    formData.append('language', 'id');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.whisperApiKey}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Whisper API HTTP ${response.status}`);
      }

      const data = await response.json();
      const text = (data.text || '').trim();

      soundEffects.playListenStop();
      if (this.onFinalCallback && text) {
        this.onFinalCallback(text);
      }
    } catch (e: unknown) {
      console.warn('[AIRA Whisper] Transcription failed, fallback error:', e);
      if (this.onErrorCallback) {
        this.onErrorCallback('Gagal mentranskripsi suara dengan Whisper API.');
      }
    }
  }

  public stopListening(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
    }

    const wasListening = this.isListeningFlag;
    this.isListeningFlag = false;

    if (this.recognition && wasListening) {
      try {
        this.recognition.stop();
      } catch (e) {
        this.dispatchFinalTranscript();
        return;
      }

      // Small grace period (200ms) for recognition to flush final result
      this.stopGraceTimeout = setTimeout(() => {
        this.dispatchFinalTranscript();
      }, 200);
    } else {
      this.dispatchFinalTranscript();
    }
  }

  private dispatchFinalTranscript(): void {
    if (this.stopGraceTimeout) {
      clearTimeout(this.stopGraceTimeout);
      this.stopGraceTimeout = null;
    }
    if (this.hasDispatchedFinal) return;

    const final = this.latestTranscript.trim();
    if (final && this.onFinalCallback) {
      this.hasDispatchedFinal = true;
      soundEffects.playListenStop();
      this.onFinalCallback(final);
    }
  }
}

export const sttService = new STTService();

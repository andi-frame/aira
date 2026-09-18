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

  // Direct Audio Capture for Server-Side STT
  private captureStream: MediaStream | null = null;
  private captureRecorder: MediaRecorder | null = null;
  private captureChunks: Blob[] = [];
  private captureStartedAt: number = 0;
  /** Duration of the last server-side capture (used to reject silent/short recordings). */
  public lastCaptureDurationMs: number = 0;

  // Allowed-answer context biasing the STT engine (options/vocabulary)
  private vocabularyContext: string[] = [];
  private sttContextPrompt: string = '';

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
    /** Expected/allowed answers, biases the STT engine (Whisper prompt, Web Speech phrases). */
    vocabulary?: string[];
    /** Full context prompt (question + allowed options) for the STT engine. */
    prompt?: string;
  }): Promise<boolean> {
    const settings = await storageManager.getSettings();

    this.onInterimCallback = callbacks.onInterim || null;
    this.onFinalCallback = callbacks.onFinal || null;
    this.onErrorCallback = callbacks.onError || null;
    this.manualStopOnly = callbacks.manualStopOnly !== false;

    this.vocabularyContext = (callbacks.vocabulary || []).map((v) => v.trim()).filter(Boolean);
    this.sttContextPrompt = (callbacks.prompt || '').trim() ||
      (this.vocabularyContext.length ? `Pilihan jawaban: ${this.vocabularyContext.join(', ')}.` : '');
    if (this.sttContextPrompt) {
      console.log(`[AIRA STT] Context sent to STT: ${this.sttContextPrompt}`);
    }

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

    // 1. Primary: 9Router Whisper STT (default)
    if (settings.sttProvider === 'whisper') {
      console.log(
        `[AIRA STT] Active service: 9Router Whisper -> ${settings.whisperEndpoint || 'https://api.openai.com/v1/audio/transcriptions'} (model: ${settings.whisperModel || 'whisper-1'})`
      );
      const ok = await this.startWhisperRecording(settings);
      if (ok) return true;
      console.warn('[AIRA STT] Whisper recording could not start, falling back to Web Speech API');
    }

    // 2. Fallback: Client-side Chrome Web Speech API
    console.log(`[AIRA STT] Active service: Browser Web Speech API (lang: ${settings.ttsVoiceLang || 'id-ID'})`);
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

    // Bias the browser engine with the expected answers when supported.
    this.applyWebSpeechContext();

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

  /** Sends the allowed-answer vocabulary to the Web Speech engine (best effort). */
  private applyWebSpeechContext(): void {
    if (!this.recognition || this.vocabularyContext.length === 0) return;

    try {
      const recognitionAny = this.recognition as unknown as Record<string, unknown>;
      const PhraseList = (window as unknown as { SpeechRecognitionPhraseList?: new (phrases: Array<{ text: string; boost: number }>) => unknown }).SpeechRecognitionPhraseList;
      if (typeof PhraseList === 'function') {
        recognitionAny.phrases = new PhraseList(this.vocabularyContext.map((text) => ({ text, boost: 2 })));
        console.log(`[AIRA STT] Web Speech phrases (${this.vocabularyContext.length}): ${this.vocabularyContext.join(', ')}`);
        return;
      }

      const GrammarList = (window as unknown as {
        SpeechGrammarList?: new () => { addFromString: (grammar: string, weight: number) => void };
        webkitSpeechGrammarList?: new () => { addFromString: (grammar: string, weight: number) => void };
      });
      const GrammarListCtor = GrammarList.SpeechGrammarList || GrammarList.webkitSpeechGrammarList;
      if (typeof GrammarListCtor === 'function') {
        const words = this.vocabularyContext.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(' | ');
        const list = new GrammarListCtor();
        list.addFromString(`#JSGF V1.0; grammar aira_options; public <option> = ${words} ;`, 1);
        recognitionAny.grammars = list;
        console.log(`[AIRA STT] Web Speech grammar (${this.vocabularyContext.length}): ${this.vocabularyContext.join(', ')}`);
      }
    } catch (e) {
      console.warn('[AIRA STT] Could not attach Web Speech context:', e);
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
    const endpoint = settings.whisperEndpoint || 'https://9r.disra.net/v1/audio/transcriptions';
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', settings.whisperModel || 'whisper-1');
    formData.append('language', 'id');
    if (this.sttContextPrompt) {
      formData.append('prompt', this.sttContextPrompt);
      console.log(`[AIRA STT] Whisper prompt (allowed options): ${this.sttContextPrompt}`);
    }

    const apiKey = settings.whisperApiKey || '9router';
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: formData
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`9Router STT HTTP ${response.status}: ${errBody}`);
      }

      const data = await response.json();
      const text = (data.text || '').trim();

      soundEffects.playListenStop();
      if (this.onFinalCallback && text) {
        this.onFinalCallback(text);
      }
    } catch (e: unknown) {
      console.warn('[AIRA Whisper] 9Router transcription failed, notifying client fallback:', e);
      soundEffects.playError();
      if (this.onErrorCallback) {
        this.onErrorCallback('Transkripsi 9Router tidak dapat diakses. Mengalihkan ke pengenalan suara internal...');
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

  public async startAudioCapture(): Promise<boolean> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('[AIRA STT] getUserMedia not available for audio capture');
      return false;
    }

    try {
      this.captureStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.captureChunks = [];
      const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus' }
        : undefined;

      this.captureRecorder = new MediaRecorder(this.captureStream, options);
      this.captureRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.captureChunks.push(e.data);
        }
      };

      this.captureRecorder.start();
      this.captureStartedAt = Date.now();
      this.lastCaptureDurationMs = 0;
      soundEffects.playListenStart();
      return true;
    } catch (err) {
      console.warn('[AIRA STT] startAudioCapture failed:', err);
      return false;
    }
  }

  public async stopAudioCapture(): Promise<Blob | null> {
    if (!this.captureRecorder || this.captureRecorder.state === 'inactive') {
      return null;
    }

    return new Promise((resolve) => {
      if (!this.captureRecorder) {
        resolve(null);
        return;
      }

      this.captureRecorder.onstop = () => {
        const mimeType = this.captureRecorder?.mimeType || 'audio/webm';
        const blob = new Blob(this.captureChunks, { type: mimeType });
        this.captureChunks = [];
        this.lastCaptureDurationMs = this.captureStartedAt ? Date.now() - this.captureStartedAt : 0;

        if (this.captureStream) {
          this.captureStream.getTracks().forEach((track) => track.stop());
          this.captureStream = null;
        }
        this.captureRecorder = null;
        soundEffects.playListenStop();
        resolve(blob.size > 0 ? blob : null);
      };

      try {
        this.captureRecorder.stop();
      } catch (e) {
        resolve(null);
      }
    });
  }
}

export const sttService = new STTService();

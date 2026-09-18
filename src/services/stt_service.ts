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
  private onInterimCallback: ((text: string) => void) | null = null;
  private onFinalCallback: ((text: string) => void) | null = null;
  private onErrorCallback: ((err: string) => void) | null = null;

  // MediaRecorder state for Whisper
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedAudioChunks: Blob[] = [];

  constructor() {
    this.initRecognition();
  }

  private initRecognition(): void {
    if (typeof window === 'undefined') return;

    const SpeechRec = (window as unknown as { SpeechRecognition?: new () => IWindowSpeechRecognition; webkitSpeechRecognition?: new () => IWindowSpeechRecognition }).SpeechRecognition ||
                      (window as unknown as { SpeechRecognition?: new () => IWindowSpeechRecognition; webkitSpeechRecognition?: new () => IWindowSpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRec) {
      console.warn('[AIRA STT] SpeechRecognition not supported in this browser.');
      return;
    }

    this.recognition = new SpeechRec();
    this.recognition.continuous = false;
    this.recognition.interimResults = true; // Crucial for real-time live display (Point 10)
    this.recognition.lang = 'id-ID';

    this.recognition.onstart = () => {
      this.isListeningFlag = true;
      soundEffects.playListenStart();
    };

    this.recognition.onresult = (event: ISpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item.isFinal) {
          finalTranscript += item[0].transcript;
        } else {
          interimTranscript += item[0].transcript;
        }
      }

      if (interimTranscript && this.onInterimCallback) {
        this.onInterimCallback(interimTranscript);
      }

      if (finalTranscript && this.onFinalCallback) {
        soundEffects.playListenStop();
        const cleaned = finalTranscript.trim();
        this.onFinalCallback(cleaned);
      }
    };

    this.recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
      console.warn('[AIRA STT] WebSpeech error:', event.error);
      this.isListeningFlag = false;
      if (this.onErrorCallback) {
        this.onErrorCallback(event.error);
      }
    };

    this.recognition.onend = () => {
      this.isListeningFlag = false;
    };
  }

  public isListening(): boolean {
    return this.isListeningFlag;
  }

  public async startListening(callbacks: {
    onInterim?: (text: string) => void;
    onFinal?: (text: string) => void;
    onError?: (err: string) => void;
  }): Promise<boolean> {
    const settings = await storageManager.getSettings();

    this.onInterimCallback = callbacks.onInterim || null;
    this.onFinalCallback = callbacks.onFinal || null;
    this.onErrorCallback = callbacks.onError || null;

    if (this.isListeningFlag) {
      this.stopListening();
    }

    // Check if Whisper provider is chosen and API key is set
    if (settings.sttProvider === 'whisper' && settings.whisperApiKey) {
      return this.startWhisperRecording(settings);
    }

    // Default: Chrome Web Speech API
    return this.startWebSpeechListening();
  }

  private startWebSpeechListening(): boolean {
    if (!this.recognition) {
      this.initRecognition();
      if (!this.recognition) {
        if (this.onErrorCallback) this.onErrorCallback('Browser tidak mendukung Speech Recognition.');
        return false;
      }
    }

    try {
      this.recognition.start();
      return true;
    } catch (e: unknown) {
      console.warn('[AIRA STT] WebSpeech start failed:', e);
      return false;
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

    if (this.recognition && this.isListeningFlag) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
    this.isListeningFlag = false;
  }
}

export const sttService = new STTService();

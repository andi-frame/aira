/**
 * AIRA - Tiered TTS Engine (TypeScript)
 * Primary: ElevenLabs API (Indonesian multilingual)
 * Fallback: Google / Microsoft Web Speech Synthesis (id-ID)
 */

import { storageManager } from '../shared/storage';
import { AiraSettings } from '../types/index';

export class TTSService {
  private currentAudio: HTMLAudioElement | null = null;
  private isSpeakingFlag: boolean = false;
  private onEndCallbacks: Set<() => void> = new Set();

  public isSpeaking(): boolean {
    return this.isSpeakingFlag || (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking);
  }

  public stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.isSpeakingFlag = false;
  }

  public onEnd(cb: () => void): () => void {
    this.onEndCallbacks.add(cb);
    return () => this.onEndCallbacks.delete(cb);
  }

  private notifyEnd(): void {
    for (const cb of this.onEndCallbacks) {
      try { cb(); } catch (e) {}
    }
  }

  public async speak(text: string): Promise<void> {
    const wasSpeaking = this.isSpeaking();
    this.stop();
    if (!text || !text.trim()) return;

    // Allow Chrome speech synthesis cancel IPC to settle before speaking new utterance
    if (wasSpeaking) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const settings = await storageManager.getSettings();

    // Try ElevenLabs if provider is elevenlabs and key is provided
    if (settings.ttsProvider === 'elevenlabs' && settings.elevenlabsApiKey) {
      const success = await this.speakElevenLabs(text, settings);
      if (success) return;
      console.warn('[AIRA TTS] ElevenLabs playback failed, falling back to Web Speech Synthesis.');
    }

    // Fallback: Web Speech Synthesis (Google / Microsoft Indonesian)
    this.speakWebSpeech(text, settings);
  }

  private async speakElevenLabs(text: string, settings: AiraSettings): Promise<boolean> {
    const voiceId = settings.elevenlabsVoiceId || 'pNInz6obpgDQGcFmaJgB';
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    try {
      this.isSpeakingFlag = true;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'xi-api-key': settings.elevenlabsApiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      });

      if (!response.ok) {
        throw new Error(`ElevenLabs error status: ${response.status}`);
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;

      return new Promise<boolean>((resolve) => {
        audio.onended = () => {
          this.isSpeakingFlag = false;
          URL.revokeObjectURL(audioUrl);
          this.notifyEnd();
          resolve(true);
        };
        audio.onerror = (e) => {
          console.warn('[AIRA TTS] Audio error:', e);
          this.isSpeakingFlag = false;
          URL.revokeObjectURL(audioUrl);
          resolve(false);
        };
        audio.play().catch((err) => {
          console.warn('[AIRA TTS] Play error:', err);
          this.isSpeakingFlag = false;
          resolve(false);
        });
      });
    } catch (err) {
      console.warn('[AIRA TTS] ElevenLabs call failed:', err);
      this.isSpeakingFlag = false;
      return false;
    }
  }

  private speakWebSpeech(text: string, settings: AiraSettings): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      console.warn('[AIRA TTS] Web Speech Synthesis not supported in this environment.');
      return;
    }

    this.isSpeakingFlag = true;
    // Ensure natural breathing pause between "Anda" and "mengatakan"
    const cleanText = text
      .replace(/\b(anda)\s*(\.{2,3}|,)?\s*(mengatakan)\b/gi, 'Anda... mengatakan,')
      .replace(/["“”«»]/g, '')
      .replace(/:\s*/g, ', ');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = settings.ttsVoiceLang || 'id-ID';
    utterance.rate = (settings.ttsRate && settings.ttsRate !== 1.0) ? settings.ttsRate : 0.95;
    utterance.pitch = settings.ttsPitch || 1.0;

    const voices = window.speechSynthesis.getVoices();
    const idVoices = voices.filter(v => v.lang.startsWith('id') || v.lang.includes('ID') || v.name.toLowerCase().includes('indonesia'));

    let selectedVoice = null;

    if (settings.ttsProvider === 'microsoft') {
      selectedVoice = idVoices.find(v => v.name.toLowerCase().includes('microsoft') || v.name.toLowerCase().includes('gadis') || v.name.toLowerCase().includes('ardi'));
    } else {
      // Default: Google
      selectedVoice = idVoices.find(v => v.name.toLowerCase().includes('google'));
    }

    // Fallback to any id voice or first available
    if (!selectedVoice && idVoices.length > 0) {
      selectedVoice = idVoices[0];
    }

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.onend = () => {
      this.isSpeakingFlag = false;
      this.notifyEnd();
    };

    utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
      if (e.error === 'interrupted' || e.error === 'canceled') {
        this.isSpeakingFlag = false;
        this.notifyEnd();
        return;
      }
      console.warn('[AIRA TTS] WebSpeech error:', e.error || e);
      this.isSpeakingFlag = false;
      this.notifyEnd();
    };

    window.speechSynthesis.speak(utterance);
  }
}

export const ttsService = new TTSService();

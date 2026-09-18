/**
 * AIRA - Core Type Definitions
 */

export type TTSProvider = 'elevenlabs' | 'google' | 'microsoft';
export type STTProvider = 'webspeech' | 'whisper';
export type FontSizeOption = 'normal' | 'large' | 'xlarge';
export type ControlSizeOption = 'default' | 'large' | 'xlarge';

export interface AiraSettings {
  // LLM Configuration
  llmEndpoint: string;
  llmModel: string;
  llmApiKey: string;
  llmEnabled: boolean;

  // TTS Configuration
  ttsProvider: TTSProvider;
  elevenlabsApiKey: string;
  elevenlabsVoiceId: string;
  ttsVoiceLang: string;
  ttsRate: number;
  ttsPitch: number;

  // STT Configuration
  sttProvider: STTProvider;
  whisperApiKey: string;
  whisperEndpoint: string;
  whisperModel: string;

  // STT & Voice-Only Interaction
  voiceOnlyMode: boolean;
  soundCues: boolean;
  autoRead: boolean;

  // Accessibility Adaptations (WCAG 2.1 AAA on Host Page & Extension)
  highContrast: boolean;
  fontSize: FontSizeOption;
  controlSize: ControlSizeOption;
  reduceMotion: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  action?: {
    type: 'NAVIGATE' | 'FORM_GUIDE' | 'SUMMARY' | 'SETTINGS';
    targetId?: string;
    label?: string;
  };
  audioStatus?: 'idle' | 'speaking' | 'spoken';
}

export type EarconType = 
  | 'LISTEN_START' 
  | 'LISTEN_STOP' 
  | 'SUCCESS' 
  | 'ERROR' 
  | 'STEP' 
  | 'CLICK';

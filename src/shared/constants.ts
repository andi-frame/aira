/**
 * AIRA - Shared Constants & System Configurations
 */

import { AiraSettings } from '../types/index';

export const DEFAULT_SETTINGS: AiraSettings = {
  // AIRA Backend Server Configuration
  agentServerUrl: 'http://localhost:8000',

  // LLM Configuration
  llmEndpoint: 'https://9r.disra.net/v1/chat/completions',
  llmModel: 'cx/gpt-5.6-luna',
  llmApiKey: '',
  llmEnabled: true,

  // TTS Configuration
  ttsProvider: 'elevenlabs',
  elevenlabsApiKey: '',
  elevenlabsVoiceId: 'pNInz6obpgDQGcFmaJgB', // Indonesian/multilingual voice default
  ttsVoiceLang: 'id-ID',
  ttsRate: 1.0,
  ttsPitch: 1.0,

  // STT Configuration (Default Client-Side: Chrome Web Speech API; Server handles 9Router STT)
  sttProvider: 'webspeech',
  whisperApiKey: '',
  whisperEndpoint: 'https://9r.disra.net/v1/audio/transcriptions',
  whisperModel: 'whisper-1',

  // STT & Interaction Configuration
  voiceOnlyMode: false,
  soundCues: true,
  autoRead: true,

  // Accessibility Adaptations
  highContrast: false,
  fontSize: 'normal',
  controlSize: 'default',
  fontScale: 100,
  controlScale: 100,
  reduceMotion: false
};

export const STORAGE_KEYS = {
  SETTINGS: 'aira_settings',
  CHAT_HISTORY: 'aira_chat_history',
  ACTIVE_SESSION: 'aira_active_session'
};

export const VALIDATION_RULES: Record<string, { pattern: RegExp; label: string; hint: string; format?: (val: string) => string }> = {
  nik: {
    pattern: /^[0-9]{16}$/,
    label: 'Nomor Induk Kependudukan (NIK)',
    hint: 'Nomor NIK terdiri dari 16 digit angka, tertera di bagian atas KTP atau Kartu Keluarga Anda.',
    format: (val: string) => val.replace(/\D/g, '').slice(0, 16)
  },
  phone: {
    pattern: /^(\+62|62|0)8[1-9][0-9]{6,10}$/,
    label: 'Nomor WhatsApp / Telepon',
    hint: 'Nomor telepon diawali 08 atau +62 dengan panjang 10-13 digit angka.',
    format: (val: string) => val.replace(/[^\d+]/g, '')
  },
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    label: 'Alamat Email',
    hint: 'Format email harus valid, contoh: nama@email.com.',
    format: (val: string) => val.trim()
  },
  date: {
    pattern: /^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$/,
    label: 'Tanggal',
    hint: 'Format tanggal harus valid (contoh: YYYY-MM-DD atau DD/MM/YYYY).'
  }
};

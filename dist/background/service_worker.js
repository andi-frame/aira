// src/shared/constants.ts
var DEFAULT_SETTINGS = {
  agentServerUrl: "http://localhost:8000",
  llmEndpoint: "https://9r.disra.net/v1/chat/completions",
  llmModel: "cx/gpt-5.6-luna",
  llmApiKey: "",
  llmEnabled: true,
  ttsProvider: "elevenlabs",
  elevenlabsApiKey: "",
  elevenlabsVoiceId: "pNInz6obpgDQGcFmaJgB",
  ttsVoiceLang: "id-ID",
  ttsRate: 1,
  ttsPitch: 1,
  sttProvider: "webspeech",
  whisperApiKey: "",
  whisperEndpoint: "https://9r.disra.net/v1/audio/transcriptions",
  whisperModel: "whisper-1",
  voiceOnlyMode: false,
  soundCues: true,
  autoRead: true,
  highContrast: false,
  fontSize: "normal",
  controlSize: "default",
  fontScale: 100,
  controlScale: 100,
  reduceMotion: false
};
var STORAGE_KEYS = {
  SETTINGS: "aira_settings",
  CHAT_HISTORY: "aira_chat_history",
  ACTIVE_SESSION: "aira_active_session"
};

// src/background/service_worker.ts
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[AIRA Background] Ekstensi AIRA berhasil dipasang.");
  chrome.storage.sync.get([STORAGE_KEYS.SETTINGS], (result) => {
    if (!result[STORAGE_KEYS.SETTINGS]) {
      chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
    }
  });
});
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://") && !tab.url.startsWith("about:")) {
        if (command === "toggle-voice-assistant") {
          chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_VOICE_SHORTCUT" }, () => {
            const err = chrome.runtime.lastError;
          });
        }
      }
    } catch (err) {}
  });
}

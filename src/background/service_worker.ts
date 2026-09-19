/**
 * AIRA - Background Service Worker (Manifest V3 TypeScript)
 */

import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants';

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[AIRA Background] Ekstensi AIRA berhasil dipasang.');

  // Initialize storage with defaults if not present, or migrate legacy localhost default
  chrome.storage.sync.get([STORAGE_KEYS.SETTINGS], (result) => {
    if (!result[STORAGE_KEYS.SETTINGS]) {
      chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
    } else if (
      result[STORAGE_KEYS.SETTINGS].agentServerUrl === 'http://localhost:8000' ||
      result[STORAGE_KEYS.SETTINGS].agentServerUrl === 'http://127.0.0.1:8000'
    ) {
      chrome.storage.sync.set({
        [STORAGE_KEYS.SETTINGS]: {
          ...result[STORAGE_KEYS.SETTINGS],
          agentServerUrl: DEFAULT_SETTINGS.agentServerUrl
        }
      });
    }
  });
});

// Listen for keyboard command triggers from manifest
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
        if (command === 'toggle-voice-assistant') {
          chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_VOICE_SHORTCUT' }, () => {
            const err = chrome.runtime.lastError; // Consume safely
          });
        }
      }
    } catch (err) {
      // Ignore background query errors
    }
  });
}

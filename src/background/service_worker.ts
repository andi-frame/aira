/**
 * AIRA - Background Service Worker (Manifest V3 TypeScript)
 */

import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants';

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[AIRA Background] Ekstensi AIRA berhasil dipasang.');

  // Initialize storage with defaults if not present
  chrome.storage.sync.get([STORAGE_KEYS.SETTINGS], (result) => {
    if (!result[STORAGE_KEYS.SETTINGS]) {
      chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
    }
  });
});

// Listen for keyboard command triggers from manifest
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-voice-assistant') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_VOICE_SHORTCUT' }).catch(() => {
          // Tab might not have content script injected yet
        });
      }
    }
  });
}

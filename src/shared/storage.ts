/**
 * AIRA - Storage Manager (TypeScript)
 * Synchronizes settings seamlessly across Navbar Popup and In-Page Overlay
 */

import { AiraSettings } from '../types/index';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants';

export class StorageManager {
  private listeners: Set<(settings: AiraSettings) => void> = new Set();

  constructor() {
    this.initStorageListener();
  }

  private isChromeStorageAvailable(): boolean {
    try {
      return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  private getStorageArea(): chrome.storage.StorageArea | null {
    if (this.isChromeStorageAvailable()) {
      try {
        return chrome.storage.sync || chrome.storage.local;
      } catch {
        return null;
      }
    }
    return null;
  }

  private initStorageListener(): void {
    if (this.isChromeStorageAvailable() && chrome.storage.onChanged) {
      try {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (changes[STORAGE_KEYS.SETTINGS]) {
            const newSettings = changes[STORAGE_KEYS.SETTINGS].newValue as AiraSettings;
            if (newSettings) {
              this.notifyListeners(newSettings);
            }
          }
        });
      } catch {
        // Context might be invalidating
      }
    } else if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event: StorageEvent) => {
        if (event.key === STORAGE_KEYS.SETTINGS && event.newValue) {
          try {
            const newSettings = JSON.parse(event.newValue) as AiraSettings;
            this.notifyListeners(newSettings);
          } catch (e) {
            // Ignore JSON parse error
          }
        }
      });
    }
  }

  public async getSettings(): Promise<AiraSettings> {
    return new Promise((resolve) => {
      try {
        const storage = this.getStorageArea();
        if (storage && typeof chrome !== 'undefined' && chrome.runtime?.id) {
          storage.get([STORAGE_KEYS.SETTINGS], (result) => {
            if (chrome.runtime?.lastError) {
              console.warn('[AIRA Storage] Error, using fallback:', chrome.runtime.lastError);
              resolve(this.getFallbackSettings());
            } else {
              const val = result ? (result[STORAGE_KEYS.SETTINGS] as Partial<AiraSettings> | undefined) : undefined;
              resolve({ ...DEFAULT_SETTINGS, ...(val || {}) });
            }
          });
        } else {
          resolve(this.getFallbackSettings());
        }
      } catch (e) {
        resolve(this.getFallbackSettings());
      }
    });
  }

  private getFallbackSettings(): AiraSettings {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const item = window.localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (item) return { ...DEFAULT_SETTINGS, ...JSON.parse(item) };
      } catch (e) {
        console.warn('[AIRA Storage] LocalStorage read failed:', e);
      }
    }
    return { ...DEFAULT_SETTINGS };
  }

  public async saveSettings(updatedFields: Partial<AiraSettings>): Promise<AiraSettings> {
    const current = await this.getSettings();
    const merged: AiraSettings = { ...current, ...updatedFields };

    return new Promise((resolve) => {
      try {
        const storage = this.getStorageArea();
        if (storage && typeof chrome !== 'undefined' && chrome.runtime?.id) {
          storage.set({ [STORAGE_KEYS.SETTINGS]: merged }, () => {
            this.notifyListeners(merged);
            resolve(merged);
          });
        } else {
          if (typeof window !== 'undefined' && window.localStorage) {
            try {
              window.localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
            } catch (e) {
              console.warn('[AIRA Storage] LocalStorage save failed:', e);
            }
          }
          this.notifyListeners(merged);
          resolve(merged);
        }
      } catch (e) {
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
          } catch {}
        }
        this.notifyListeners(merged);
        resolve(merged);
      }
    });
  }

  public subscribe(callback: (settings: AiraSettings) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(settings: AiraSettings): void {
    for (const callback of this.listeners) {
      try {
        callback(settings);
      } catch (e) {
        console.error('[AIRA Storage] Listener callback error:', e);
      }
    }
  }
}

export const storageManager = new StorageManager();

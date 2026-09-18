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
  sttProvider: "whisper",
  whisperApiKey: "9router",
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

// src/shared/storage.ts
class StorageManager {
  listeners = new Set;
  constructor() {
    this.initStorageListener();
  }
  isChromeStorageAvailable() {
    try {
      return typeof chrome !== "undefined" && !!chrome.storage && !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }
  getStorageArea() {
    if (this.isChromeStorageAvailable()) {
      try {
        return chrome.storage.sync || chrome.storage.local;
      } catch {
        return null;
      }
    }
    return null;
  }
  initStorageListener() {
    if (this.isChromeStorageAvailable() && chrome.storage.onChanged) {
      try {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (changes[STORAGE_KEYS.SETTINGS]) {
            const newSettings = changes[STORAGE_KEYS.SETTINGS].newValue;
            if (newSettings) {
              this.notifyListeners(newSettings);
            }
          }
        });
      } catch {}
    } else if (typeof window !== "undefined") {
      window.addEventListener("storage", (event) => {
        if (event.key === STORAGE_KEYS.SETTINGS && event.newValue) {
          try {
            const newSettings = JSON.parse(event.newValue);
            this.notifyListeners(newSettings);
          } catch (e) {}
        }
      });
    }
  }
  async getSettings() {
    return new Promise((resolve) => {
      try {
        const storage = this.getStorageArea();
        if (storage && typeof chrome !== "undefined" && chrome.runtime?.id) {
          storage.get([STORAGE_KEYS.SETTINGS], (result) => {
            if (chrome.runtime?.lastError) {
              console.warn("[AIRA Storage] Error, using fallback:", chrome.runtime.lastError);
              resolve(this.getFallbackSettings());
            } else {
              const val = result ? result[STORAGE_KEYS.SETTINGS] : undefined;
              resolve({ ...DEFAULT_SETTINGS, ...val || {} });
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
  getFallbackSettings() {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const item = window.localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (item)
          return { ...DEFAULT_SETTINGS, ...JSON.parse(item) };
      } catch (e) {
        console.warn("[AIRA Storage] LocalStorage read failed:", e);
      }
    }
    return { ...DEFAULT_SETTINGS };
  }
  async saveSettings(updatedFields) {
    const current = await this.getSettings();
    const merged = { ...current, ...updatedFields };
    return new Promise((resolve) => {
      try {
        const storage = this.getStorageArea();
        if (storage && typeof chrome !== "undefined" && chrome.runtime?.id) {
          storage.set({ [STORAGE_KEYS.SETTINGS]: merged }, () => {
            this.notifyListeners(merged);
            resolve(merged);
          });
        } else {
          if (typeof window !== "undefined" && window.localStorage) {
            try {
              window.localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
            } catch (e) {
              console.warn("[AIRA Storage] LocalStorage save failed:", e);
            }
          }
          this.notifyListeners(merged);
          resolve(merged);
        }
      } catch (e) {
        if (typeof window !== "undefined" && window.localStorage) {
          try {
            window.localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
          } catch {}
        }
        this.notifyListeners(merged);
        resolve(merged);
      }
    });
  }
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  notifyListeners(settings) {
    for (const callback of this.listeners) {
      try {
        callback(settings);
      } catch (e) {
        console.error("[AIRA Storage] Listener callback error:", e);
      }
    }
  }
}
var storageManager = new StorageManager;

// src/services/tts_service.ts
class TTSService {
  currentAudio = null;
  isSpeakingFlag = false;
  onEndCallbacks = new Set;
  isSpeaking() {
    return this.isSpeakingFlag || typeof window !== "undefined" && window.speechSynthesis && window.speechSynthesis.speaking;
  }
  stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.isSpeakingFlag = false;
  }
  onEnd(cb) {
    this.onEndCallbacks.add(cb);
    return () => this.onEndCallbacks.delete(cb);
  }
  notifyEnd() {
    for (const cb of this.onEndCallbacks) {
      try {
        cb();
      } catch (e) {}
    }
  }
  async speak(text) {
    const wasSpeaking = this.isSpeaking();
    this.stop();
    if (!text || !text.trim())
      return;
    if (wasSpeaking) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const settings = await storageManager.getSettings();
    if (settings.ttsProvider === "elevenlabs" && settings.elevenlabsApiKey) {
      const success = await this.speakElevenLabs(text, settings);
      if (success)
        return;
      console.warn("[AIRA TTS] ElevenLabs playback failed, falling back to Web Speech Synthesis.");
    }
    this.speakWebSpeech(text, settings);
  }
  async speakElevenLabs(text, settings) {
    const voiceId = settings.elevenlabsVoiceId || "pNInz6obpgDQGcFmaJgB";
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    try {
      this.isSpeakingFlag = true;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "xi-api-key": settings.elevenlabsApiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
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
      return new Promise((resolve) => {
        audio.onended = () => {
          this.isSpeakingFlag = false;
          URL.revokeObjectURL(audioUrl);
          this.notifyEnd();
          resolve(true);
        };
        audio.onerror = (e) => {
          console.warn("[AIRA TTS] Audio error:", e);
          this.isSpeakingFlag = false;
          URL.revokeObjectURL(audioUrl);
          resolve(false);
        };
        audio.play().catch((err) => {
          console.warn("[AIRA TTS] Play error:", err);
          this.isSpeakingFlag = false;
          resolve(false);
        });
      });
    } catch (err) {
      console.warn("[AIRA TTS] ElevenLabs call failed:", err);
      this.isSpeakingFlag = false;
      return false;
    }
  }
  speakWebSpeech(text, settings) {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      console.warn("[AIRA TTS] Web Speech Synthesis not supported in this environment.");
      return;
    }
    this.isSpeakingFlag = true;
    const cleanText = text.replace(/\b(anda)\s*(\.{2,3}|,)?\s*(mengatakan)\b/gi, "Anda... mengatakan,").replace(/["“”«»]/g, "").replace(/:\s*/g, ", ");
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = settings.ttsVoiceLang || "id-ID";
    utterance.rate = settings.ttsRate && settings.ttsRate !== 1 ? settings.ttsRate : 0.95;
    utterance.pitch = settings.ttsPitch || 1;
    const voices = window.speechSynthesis.getVoices();
    const idVoices = voices.filter((v) => v.lang.startsWith("id") || v.lang.includes("ID") || v.name.toLowerCase().includes("indonesia"));
    let selectedVoice = null;
    if (settings.ttsProvider === "microsoft") {
      selectedVoice = idVoices.find((v) => v.name.toLowerCase().includes("microsoft") || v.name.toLowerCase().includes("gadis") || v.name.toLowerCase().includes("ardi"));
    } else {
      selectedVoice = idVoices.find((v) => v.name.toLowerCase().includes("google"));
    }
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
    utterance.onerror = (e) => {
      if (e.error === "interrupted" || e.error === "canceled") {
        this.isSpeakingFlag = false;
        this.notifyEnd();
        return;
      }
      console.warn("[AIRA TTS] WebSpeech error:", e.error || e);
      this.isSpeakingFlag = false;
      this.notifyEnd();
    };
    window.speechSynthesis.speak(utterance);
  }
}
var ttsService = new TTSService;

// src/popup/popup.ts
class PopupController {
  saveTimeout = null;
  async init() {
    const settings = await storageManager.getSettings();
    this.populateForm(settings);
    this.updateLLMFeatureBanner(settings);
    this.bindEvents();
  }
  $(id) {
    return document.getElementById(id);
  }
  populateForm(s) {
    const setChecked = (id, val) => {
      const el = this.$(id);
      if (el)
        el.checked = val;
    };
    const setValue = (id, val) => {
      const el = this.$(id);
      if (el)
        el.value = val;
    };
    setChecked("voiceOnlyMode", s.voiceOnlyMode);
    setChecked("llmEnabled", s.llmEnabled);
    setValue("llmEndpoint", s.llmEndpoint || "https://9r.disra.net/v1/chat/completions");
    setValue("llmApiKey", s.llmApiKey || "");
    setValue("llmModel", s.llmModel || "cx/gpt-5.6-luna");
    setValue("sttProvider", s.sttProvider || "whisper");
    setValue("whisperApiKey", s.whisperApiKey || "9router");
    setValue("whisperEndpoint", s.whisperEndpoint || "https://9r.disra.net/v1/audio/transcriptions");
    setValue("ttsProvider", s.ttsProvider || "elevenlabs");
    setValue("elevenlabsApiKey", s.elevenlabsApiKey || "");
    setValue("elevenlabsVoiceId", s.elevenlabsVoiceId || "pNInz6obpgDQGcFmaJgB");
    setChecked("highContrast", s.highContrast);
    let fontScale = s.fontScale ?? 100;
    if (s.fontScale === undefined && s.fontSize) {
      fontScale = s.fontSize === "large" ? 125 : s.fontSize === "xlarge" ? 150 : 100;
    }
    let controlScale = s.controlScale ?? 100;
    if (s.controlScale === undefined && s.controlSize) {
      controlScale = s.controlSize === "large" ? 125 : s.controlSize === "xlarge" ? 150 : 100;
    }
    setValue("fontScale", String(fontScale));
    const fontBadge = this.$("fontScaleBadge");
    if (fontBadge)
      fontBadge.innerText = `${fontScale}%`;
    setValue("controlScale", String(controlScale));
    const ctrlBadge = this.$("controlScaleBadge");
    if (ctrlBadge)
      ctrlBadge.innerText = `${controlScale}%`;
    setChecked("reduceMotion", s.reduceMotion);
    setChecked("soundCues", s.soundCues);
    this.toggleElevenLabsSection(s.ttsProvider === "elevenlabs");
    this.toggleWhisperSection(s.sttProvider === "whisper");
  }
  toggleElevenLabsSection(show) {
    const area = this.$("elevenlabsConfigArea");
    if (area) {
      area.style.display = show ? "block" : "none";
    }
  }
  toggleWhisperSection(show) {
    const area = this.$("whisperConfigArea");
    if (area) {
      area.style.display = show ? "block" : "none";
    }
  }
  updateLLMFeatureBanner(s) {
    const banner = this.$("llmFeatureStatusBanner");
    const desc = this.$("llmInfoDesc");
    if (!banner || !desc)
      return;
    if (!s.llmEnabled || !s.llmApiKey) {
      banner.className = "llm-info-box is-fallback";
      desc.innerHTML = `
        <strong>⚠️ Mode Fallback Lokal (Tanpa API Key LLM) Aktif:</strong><br/>
        • <em>Berjalan Normal</em>: Form Wizard 1-per-1, validasi format lokal (NIK 16 digit, No HP, Tanggal), navigasi berbasis kata kunci, pembaca suara TTS, dan adaptasi kontras tinggi.<br/>
        • <em>Fitur yang Berjalan Terbatas Tanpa LLM</em>:
        <ul style="margin-left: 18px; margin-top: 4px;">
          <li><strong>Pemahaman Bahasa Santai</strong>: Navigasi suara hanya mengenali kata kunci tombol yang ada, bukan maksud kalimat bebas/tidak baku.</li>
          <li><strong>Penjelasan Istilah Birokrasi</strong>: Menggunakan kamus template standar untuk NIK/BPJS/Nama/Alamat, bukan penjelasan dinamis dari teks halaman.</li>
          <li><strong>Perangkuman Halaman</strong>: Menggunakan ringkasan statistik struktur (jumlah formulir dan tombol), bukan intisari pemahaman konteks mendalam.</li>
        </ul>
      `;
    } else {
      banner.className = "llm-info-box is-active";
      desc.innerHTML = `
        <strong>✓ Mode AI Lengkap (${s.llmModel || "cx/gpt-5.6-luna"} Aktif):</strong><br/>
        Seluruh penalaran semantik aktif penuh: pemahaman maksud suara santai, terjemahan istilah rumit secara dinamis, dan perangkuman halaman adaptif.
      `;
    }
  }
  bindEvents() {
    this.setupPasswordToggle("toggleLlmKey", "llmApiKey");
    this.setupPasswordToggle("toggleElevenKey", "elevenlabsApiKey");
    this.setupPasswordToggle("toggleWhisperKey", "whisperApiKey");
    const inputs = document.querySelectorAll("input, select");
    inputs.forEach((input) => {
      input.addEventListener("change", () => this.handleSave());
      if (input.tagName === "INPUT" && input.type === "text") {
        input.addEventListener("input", () => this.handleSaveDebounced());
      }
    });
    this.$("ttsProvider")?.addEventListener("change", (e) => {
      const val = e.target.value;
      this.toggleElevenLabsSection(val === "elevenlabs");
    });
    this.$("sttProvider")?.addEventListener("change", (e) => {
      const val = e.target.value;
      this.toggleWhisperSection(val === "whisper");
    });
    this.$("btnTestLlm")?.addEventListener("click", () => this.testLlmConnection());
    this.$("btnTestTts")?.addEventListener("click", () => {
      ttsService.speak("Halo! Ini adalah uji coba suara asisten AIRA dalam Bahasa Indonesia.");
    });
    const fontScaleInput = this.$("fontScale");
    const fontBadge = this.$("fontScaleBadge");
    if (fontScaleInput) {
      fontScaleInput.addEventListener("input", () => {
        if (fontBadge)
          fontBadge.innerText = `${fontScaleInput.value}%`;
        this.handleSaveDebounced();
      });
    }
    const controlScaleInput = this.$("controlScale");
    const ctrlBadge = this.$("controlScaleBadge");
    if (controlScaleInput) {
      controlScaleInput.addEventListener("input", () => {
        if (ctrlBadge)
          ctrlBadge.innerText = `${controlScaleInput.value}%`;
        this.handleSaveDebounced();
      });
    }
    this.$("btnResetFont")?.addEventListener("click", () => {
      if (fontScaleInput)
        fontScaleInput.value = "100";
      if (fontBadge)
        fontBadge.innerText = "100%";
      this.handleSave();
    });
    this.$("btnResetControl")?.addEventListener("click", () => {
      if (controlScaleInput)
        controlScaleInput.value = "100";
      if (ctrlBadge)
        ctrlBadge.innerText = "100%";
      this.handleSave();
    });
  }
  setupPasswordToggle(btnId, inputId) {
    const btn = this.$(btnId);
    const input = this.$(inputId);
    if (btn && input) {
      btn.addEventListener("click", () => {
        if (input.type === "password") {
          input.type = "text";
          btn.innerText = "\uD83D\uDD12";
        } else {
          input.type = "password";
          btn.innerText = "\uD83D\uDC41️";
        }
      });
    }
  }
  handleSaveDebounced() {
    if (this.saveTimeout)
      clearTimeout(this.saveTimeout);
    this.saveTimeout = window.setTimeout(() => this.handleSave(), 400);
  }
  async handleSave() {
    const isChecked = (id) => {
      const el = this.$(id);
      return el ? el.checked : false;
    };
    const getValue = (id) => {
      const el = this.$(id);
      return el ? el.value.trim() : "";
    };
    const fontScaleNum = parseInt(getValue("fontScale"), 10) || 100;
    const controlScaleNum = parseInt(getValue("controlScale"), 10) || 100;
    const updated = {
      voiceOnlyMode: isChecked("voiceOnlyMode"),
      llmEnabled: isChecked("llmEnabled"),
      llmEndpoint: getValue("llmEndpoint") || "https://9r.disra.net/v1/chat/completions",
      llmApiKey: getValue("llmApiKey"),
      llmModel: getValue("llmModel") || "cx/gpt-5.6-luna",
      sttProvider: getValue("sttProvider") || "whisper",
      whisperApiKey: getValue("whisperApiKey") || "9router",
      whisperEndpoint: getValue("whisperEndpoint") || "https://9r.disra.net/v1/audio/transcriptions",
      ttsProvider: getValue("ttsProvider") || "elevenlabs",
      elevenlabsApiKey: getValue("elevenlabsApiKey"),
      elevenlabsVoiceId: getValue("elevenlabsVoiceId") || "pNInz6obpgDQGcFmaJgB",
      highContrast: isChecked("highContrast"),
      fontScale: fontScaleNum,
      controlScale: controlScaleNum,
      fontSize: fontScaleNum >= 140 ? "xlarge" : fontScaleNum >= 120 ? "large" : "normal",
      controlSize: controlScaleNum >= 140 ? "xlarge" : controlScaleNum >= 120 ? "large" : "default",
      reduceMotion: isChecked("reduceMotion"),
      soundCues: isChecked("soundCues")
    };
    const merged = await storageManager.saveSettings(updated);
    this.updateLLMFeatureBanner(merged);
    this.showSaveStatus();
  }
  showSaveStatus() {
    const status = this.$("saveStatus");
    if (status) {
      status.innerText = "✓ Pengaturan tersimpan dan tersinkronisasi";
      status.style.opacity = "1";
      setTimeout(() => {
        status.style.opacity = "0.7";
      }, 2000);
    }
  }
  async testLlmConnection() {
    const btn = this.$("btnTestLlm");
    const msg = this.$("llmStatusMessage");
    if (!btn || !msg)
      return;
    const endpoint = this.$("llmEndpoint").value.trim() || "https://9r.disra.net/v1/chat/completions";
    const apiKey = this.$("llmApiKey").value.trim();
    const model = this.$("llmModel").value.trim() || "cx/gpt-5.6-luna";
    if (!apiKey) {
      msg.className = "status-msg status-error";
      msg.style.display = "block";
      msg.innerText = "Harap isi LLM API Key terlebih dahulu untuk menguji koneksi.";
      return;
    }
    btn.disabled = true;
    btn.innerText = "⏳ Menguji ke " + model + "...";
    msg.style.display = "none";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: "Halo, jelaskan AIRA dalam satu kalimat singkat Bahasa Indonesia."
            }
          ]
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || "Koneksi sukses!";
      msg.className = "status-msg status-success";
      msg.style.display = "block";
      msg.innerText = `✓ Terhubung Sukses! Respon: "${reply}"`;
    } catch (err) {
      const errorStr = err instanceof Error ? err.message : String(err);
      msg.className = "status-msg status-error";
      msg.style.display = "block";
      msg.innerText = `✗ Gagal terhubung: ${errorStr}`;
    } finally {
      btn.disabled = false;
      btn.innerText = "⚡ Uji Koneksi LLM";
    }
  }
}
var popup = new PopupController;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => popup.init());
} else {
  popup.init();
}

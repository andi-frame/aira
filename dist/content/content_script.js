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
var VALIDATION_RULES = {
  nik: {
    pattern: /^[0-9]{16}$/,
    label: "Nomor Induk Kependudukan (NIK)",
    hint: "Nomor NIK terdiri dari 16 digit angka, tertera di bagian atas KTP atau Kartu Keluarga Anda.",
    format: (val) => val.replace(/\D/g, "").slice(0, 16)
  },
  phone: {
    pattern: /^(\+62|62|0)8[1-9][0-9]{6,10}$/,
    label: "Nomor WhatsApp / Telepon",
    hint: "Nomor telepon diawali 08 atau +62 dengan panjang 10-13 digit angka.",
    format: (val) => val.replace(/[^\d+]/g, "")
  },
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    label: "Alamat Email",
    hint: "Format email harus valid, contoh: nama@email.com.",
    format: (val) => val.trim()
  },
  date: {
    pattern: /^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$/,
    label: "Tanggal",
    hint: "Format tanggal harus valid (contoh: YYYY-MM-DD atau DD/MM/YYYY)."
  }
};

// src/shared/storage.ts
class StorageManager {
  listeners = new Set;
  constructor() {
    this.initStorageListener();
  }
  isChromeStorageAvailable() {
    return typeof chrome !== "undefined" && !!chrome.storage;
  }
  getStorageArea() {
    if (this.isChromeStorageAvailable()) {
      return chrome.storage.sync || chrome.storage.local;
    }
    return null;
  }
  initStorageListener() {
    if (this.isChromeStorageAvailable() && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (changes[STORAGE_KEYS.SETTINGS]) {
          const newSettings = changes[STORAGE_KEYS.SETTINGS].newValue;
          if (newSettings) {
            this.notifyListeners(newSettings);
          }
        }
      });
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
      const storage = this.getStorageArea();
      if (storage) {
        storage.get([STORAGE_KEYS.SETTINGS], (result) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.warn("[AIRA Storage] Error, using fallback:", chrome.runtime.lastError);
            resolve(this.getFallbackSettings());
          } else {
            const val = result[STORAGE_KEYS.SETTINGS];
            resolve({ ...DEFAULT_SETTINGS, ...val || {} });
          }
        });
      } else {
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
      const storage = this.getStorageArea();
      if (storage) {
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

// src/shared/sound_effects.ts
class SoundEffectsEngine {
  ctx = null;
  enabled = true;
  setEnabled(val) {
    this.enabled = !!val;
  }
  getAudioContext() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }
  playListenStart() {
    if (!this.enabled)
      return;
    const ctx = this.getAudioContext();
    if (!ctx)
      return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  }
  playListenStop() {
    if (!this.enabled)
      return;
    const ctx = this.getAudioContext();
    if (!ctx)
      return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(700, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.12);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }
  playSuccess() {
    if (!this.enabled)
      return;
    const ctx = this.getAudioContext();
    if (!ctx)
      return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const now = ctx.currentTime;
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.01, now + idx * 0.08);
      gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.08 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.4);
    });
  }
  playError() {
    if (!this.enabled)
      return;
    const ctx = this.getAudioContext();
    if (!ctx)
      return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.linearRampToValueAtTime(190, now + 0.25);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);
  }
  playStep() {
    if (!this.enabled)
      return;
    const ctx = this.getAudioContext();
    if (!ctx)
      return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, now);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }
  playClick() {
    if (!this.enabled)
      return;
    const ctx = this.getAudioContext();
    if (!ctx)
      return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.04);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  }
  playConfirmation() {
    if (!this.enabled)
      return;
    const ctx = this.getAudioContext();
    if (!ctx)
      return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.setValueAtTime(880, now + 0.08);
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  }
  playServerCue(cue) {
    if (!cue)
      return;
    switch (cue.toLowerCase()) {
      case "error":
        this.playError();
        break;
      case "complete":
      case "success":
        this.playSuccess();
        break;
      case "review":
        this.playConfirmation();
        break;
      case "orientation":
        this.playListenStart();
        break;
      case "question":
      default:
        this.playStep();
        break;
    }
  }
}
var soundEffects = new SoundEffectsEngine;

// src/services/dom_pruner.ts
class DOMPruner {
  elementMap = new Map;
  counter = 0;
  reset() {
    this.elementMap.clear();
    this.counter = 0;
  }
  isElementVisible(el) {
    if (!el)
      return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0)
      return false;
    if (el.hasAttribute("aria-hidden") && el.getAttribute("aria-hidden") === "true") {
      return false;
    }
    if (el.closest("#aira-root") || el.id === "aira-root")
      return false;
    return true;
  }
  cleanText(str) {
    if (!str)
      return "";
    return str.replace(/\s+/g, " ").trim();
  }
  registerElement(el, prefix = "target") {
    let id = el.getAttribute("data-aira-id");
    if (!id) {
      this.counter++;
      id = `${prefix}-${this.counter}`;
      el.setAttribute("data-aira-id", id);
    }
    this.elementMap.set(id, el);
    return id;
  }
  getElement(id) {
    return this.elementMap.get(id) || document.querySelector(`[data-aira-id="${id}"]`);
  }
  findLabelForInput(input) {
    if (!input)
      return "Kolom Isian";
    try {
      if (input.id) {
        try {
          const safeId = input.id.replace(/["\\]/g, "\\$&");
          const label = document.querySelector(`label[for="${safeId}"]`);
          if (label && this.cleanText(label.textContent)) {
            return this.cleanText(label.textContent);
          }
        } catch (e) {}
      }
      try {
        const parentLabel = input.closest ? input.closest("label") : null;
        if (parentLabel && this.cleanText(parentLabel.textContent)) {
          return this.cleanText(parentLabel.textContent);
        }
      } catch (e) {}
      try {
        const ariaLabel = input.getAttribute("aria-label");
        if (ariaLabel && this.cleanText(ariaLabel)) {
          return this.cleanText(ariaLabel);
        }
        const labelledBy = input.getAttribute("aria-labelledby");
        if (labelledBy) {
          const ids = labelledBy.trim().split(/\s+/);
          const texts = ids.map((id) => document.getElementById(id)?.textContent).filter(Boolean);
          const combined = this.cleanText(texts.join(" "));
          if (combined)
            return combined;
        }
      } catch (e) {}
      try {
        if ("placeholder" in input && input.placeholder && this.cleanText(input.placeholder)) {
          return this.cleanText(input.placeholder);
        }
      } catch (e) {}
      try {
        const prev = input.previousElementSibling;
        if (prev) {
          const prevText = this.cleanText(prev.textContent);
          if (prevText && prevText.length < 50) {
            return prevText;
          }
        }
      } catch (e) {}
      return input.name || input.id || "Kolom Isian";
    } catch (err) {
      return "Kolom Isian";
    }
  }
  extractPageOverview() {
    this.reset();
    const pageTitle = document.title || "Portal Layanan";
    const headings = [];
    document.querySelectorAll("h1, h2, h3").forEach((h) => {
      const el = h;
      if (this.isElementVisible(el)) {
        const text = this.cleanText(el.textContent);
        if (text && text.length > 2 && text.length < 120) {
          headings.push({ tag: el.tagName.toLowerCase(), text });
        }
      }
    });
    const actionElements = [];
    const candidates = document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]');
    candidates.forEach((elNode) => {
      const el = elNode;
      if (!this.isElementVisible(el))
        return;
      const text = this.cleanText(el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || el.title);
      if (!text || text.length < 2 || text.length > 80)
        return;
      const id = this.registerElement(el, "btn");
      actionElements.push({
        id,
        tag: el.tagName.toLowerCase(),
        text,
        role: el.getAttribute("role") || el.tagName.toLowerCase(),
        href: el.tagName.toLowerCase() === "a" ? el.getAttribute("href") || "" : undefined
      });
    });
    const forms = [];
    const formEls = document.querySelectorAll("form");
    const containers = formEls.length > 0 ? Array.from(formEls) : [document.body];
    containers.forEach((container, formIdx) => {
      const inputs = container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
      const validFields = [];
      inputs.forEach((inputNode) => {
        const input = inputNode;
        if (!this.isElementVisible(input))
          return;
        const fieldId = this.registerElement(input, "field");
        const label = this.findLabelForInput(input);
        const type = input.tagName.toLowerCase() === "select" ? "select" : input.tagName.toLowerCase() === "textarea" ? "textarea" : input.type || "text";
        let options;
        if (type === "select") {
          const select = input;
          options = Array.from(select.options).map((opt) => opt.text.trim()).filter(Boolean).slice(0, 15);
        }
        let validationKey;
        const lowerLabel = label.toLowerCase();
        if (lowerLabel.includes("nik") || lowerLabel.includes("kependudukan"))
          validationKey = "nik";
        else if (lowerLabel.includes("telepon") || lowerLabel.includes("wa") || lowerLabel.includes("whatsapp") || lowerLabel.includes("hp"))
          validationKey = "phone";
        else if (lowerLabel.includes("email") || type === "email")
          validationKey = "email";
        else if (lowerLabel.includes("lahir") || lowerLabel.includes("tanggal") || type === "date")
          validationKey = "date";
        validFields.push({
          id: fieldId,
          label,
          type,
          placeholder: ("placeholder" in input ? input.placeholder : "") || "",
          required: input.required || input.getAttribute("aria-required") === "true",
          currentValue: input.value || "",
          options,
          validationKey
        });
      });
      if (validFields.length > 0) {
        const formId = container !== document.body ? this.registerElement(container, "form") : "main-page-form";
        forms.push({
          id: formId,
          title: container.getAttribute("aria-label") || container.title || `Formulir ${formIdx + 1}`,
          fields: validFields
        });
      }
    });
    const snippets = [];
    const mainSection = document.querySelector('main, [role="main"], article, #content') || document.body;
    const paragraphs = mainSection.querySelectorAll("p, li");
    let collectedLength = 0;
    for (const p of Array.from(paragraphs)) {
      if (collectedLength > 400)
        break;
      const el = p;
      if (this.isElementVisible(el)) {
        const text = this.cleanText(el.textContent);
        if (text && text.length > 25 && text.length < 250) {
          snippets.push(text);
          collectedLength += text.length;
        }
      }
    }
    return {
      pageTitle,
      headings: headings.slice(0, 8),
      actionElements: actionElements.slice(0, 20),
      forms,
      snippets: snippets.slice(0, 3)
    };
  }
  getPrunedContextForLLM() {
    const data = this.extractPageOverview();
    let promptText = `Halaman: "${data.pageTitle}"
`;
    if (data.headings.length > 0) {
      promptText += `Struktur Judul:
` + data.headings.map((h) => `- [${h.tag}] ${h.text}`).join(`
`) + `
`;
    }
    if (data.snippets.length > 0) {
      promptText += `Ringkasan Konten: ${data.snippets.join(" | ")}
`;
    }
    if (data.actionElements.length > 0) {
      promptText += `Tombol/Aksi Tersedia:
` + data.actionElements.map((a) => `- [ID:${a.id}] "${a.text}"`).join(", ") + `
`;
    }
    if (data.forms.length > 0) {
      promptText += `Formulir Terdeteksi (${data.forms.length}):
`;
      data.forms.forEach((f) => {
        promptText += `Form [${f.id}]: ${f.fields.map((fl) => `[ID:${fl.id}] ${fl.label} (${fl.type}${fl.required ? ", wajib" : ""})`).join("; ")}
`;
      });
    }
    return {
      rawSummary: promptText,
      data
    };
  }
}
var domPruner = new DOMPruner;

// src/services/agent_service.ts
class AgentService {
  defaultServerUrl = "http://localhost:8000";
  async getServerUrl() {
    try {
      const settings = await storageManager.getSettings();
      return (settings.agentServerUrl || this.defaultServerUrl).replace(/\/+$/, "");
    } catch {
      return this.defaultServerUrl;
    }
  }
  async startSession(form) {
    const baseUrl = await this.getServerUrl();
    try {
      const payload = {
        form: {
          id: form.id,
          domId: form.id,
          title: form.title || "Formulir",
          fields: (form.fields || []).map((f) => ({
            id: f.id,
            domId: f.id,
            label: f.label || "",
            type: f.type || "text",
            required: !!f.required,
            options: f.options || [],
            placeholder: f.placeholder || "",
            currentValue: f.currentValue || "",
            validationKey: f.validationKey
          }))
        }
      };
      const res = await fetch(`${baseUrl}/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        console.warn(`[AIRA AgentService] startSession failed with status ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn("[AIRA AgentService] startSession network error:", err);
      return null;
    }
  }
  async interactWithText(sessionId, text) {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/interact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          user_speech: text,
          user_input: text
        })
      });
      if (!res.ok) {
        console.warn(`[AIRA AgentService] interactWithText failed with status ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn("[AIRA AgentService] interactWithText network error:", err);
      return null;
    }
  }
  async interactWithAudio(sessionId, audioBlob) {
    const baseUrl = await this.getServerUrl();
    try {
      const formData = new FormData;
      formData.append("file", audioBlob, "speech.webm");
      formData.append("session_id", sessionId);
      const res = await fetch(`${baseUrl}/session/interact-audio`, {
        method: "POST",
        body: formData
      });
      if (!res.ok) {
        console.warn(`[AIRA AgentService] interactWithAudio failed with status ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn("[AIRA AgentService] interactWithAudio network error:", err);
      return null;
    }
  }
  async confirmSubmission(sessionId, confirmation = "ya") {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          confirmation_response: confirmation,
          confirmation
        })
      });
      if (!res.ok) {
        console.warn(`[AIRA AgentService] confirmSubmission failed with status ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn("[AIRA AgentService] confirmSubmission network error:", err);
      return null;
    }
  }
  async stepBack(sessionId) {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/step-back`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId })
      });
      if (!res.ok) {
        console.warn(`[AIRA AgentService] stepBack failed with status ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn("[AIRA AgentService] stepBack network error:", err);
      return null;
    }
  }
  async jumpToField(sessionId, fieldId) {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/jump-to`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          field_id: fieldId
        })
      });
      if (!res.ok) {
        console.warn(`[AIRA AgentService] jumpToField failed with status ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn("[AIRA AgentService] jumpToField network error:", err);
      return null;
    }
  }
  async cancelSession(sessionId) {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId })
      });
      return res.ok;
    } catch (err) {
      console.warn("[AIRA AgentService] cancelSession network error:", err);
      return false;
    }
  }
  async transcribeAudio(audioBlob) {
    const baseUrl = await this.getServerUrl();
    try {
      const formData = new FormData;
      formData.append("file", audioBlob, "speech.webm");
      const res = await fetch(`${baseUrl}/audio/transcribe`, {
        method: "POST",
        body: formData
      });
      if (!res.ok) {
        console.warn(`[AIRA AgentService] transcribeAudio failed with status ${res.status}`);
        return null;
      }
      const data = await res.json();
      return data && typeof data.text === "string" ? data.text : null;
    } catch (err) {
      console.warn("[AIRA AgentService] transcribeAudio network error:", err);
      return null;
    }
  }
  async classifyIntent(userInput, domOverview) {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/page/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: userInput,
          dom_overview: domOverview
        })
      });
      if (!res.ok) {
        console.warn(`[AIRA AgentService] classifyIntent failed with status ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn("[AIRA AgentService] classifyIntent network error:", err);
      return null;
    }
  }
  async summarizePage(domOverview) {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/page/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dom_overview: domOverview
        })
      });
      if (!res.ok) {
        console.warn(`[AIRA AgentService] summarizePage failed with status ${res.status}`);
        return null;
      }
      const data = await res.json();
      return data && typeof data.summary === "string" ? data.summary : null;
    } catch (err) {
      console.warn("[AIRA AgentService] summarizePage network error:", err);
      return null;
    }
  }
  async explainField(field) {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/field/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: {
            id: field.id,
            domId: field.id,
            label: field.label || "",
            type: field.type || "text",
            required: !!field.required,
            options: field.options || [],
            placeholder: field.placeholder || "",
            currentValue: field.currentValue || "",
            validationKey: field.validationKey
          }
        })
      });
      if (!res.ok) {
        console.warn(`[AIRA AgentService] explainField failed with status ${res.status}`);
        return null;
      }
      const data = await res.json();
      return data && typeof data.explanation === "string" ? data.explanation : null;
    } catch (err) {
      console.warn("[AIRA AgentService] explainField network error:", err);
      return null;
    }
  }
}
var agentService = new AgentService;

// src/services/llm_service.ts
class LLMService {
  settings = null;
  async getActiveSettings() {
    this.settings = await storageManager.getSettings();
    return this.settings;
  }
  async callChatCompletion(messages, options = {}) {
    const settings = await this.getActiveSettings();
    if (!settings.llmEnabled || !settings.llmApiKey) {
      return null;
    }
    const endpoint = settings.llmEndpoint || "https://9r.disra.net/v1/chat/completions";
    const model = settings.llmModel || "cx/gpt-5.6-luna";
    const payload = {
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? 600
    };
    if (options.jsonMode) {
      payload.response_format = { type: "json_object" };
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.llmApiKey}`
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[AIRA LLM] API error (${response.status}):`, errorText);
        return null;
      }
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      return content.trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[AIRA LLM] Request failed, switching to local fallback:", msg);
      return null;
    }
  }
  async summarizePage(prunedContext) {
    const agentSummary = await agentService.summarizePage(prunedContext.data);
    if (agentSummary)
      return agentSummary;
    const systemPrompt = `Anda adalah AIRA, asisten aksesibilitas ramah untuk tunanetra dan lansia di Indonesia.
Tugas: Buat ringkasan isi halaman web ini secara padat, santun, dan jelas (maksimal 3-4 kalimat).
Sebutkan nama halaman, fungsi/layanan utama, dan saran langkah berikutnya bagi pengguna.
Gunakan Bahasa Indonesia awam tanpa istilah birokrasi rumit.`;
    const userPrompt = `Struktur Halaman:
${prunedContext.rawSummary}

Berikan ringkasan ramah.`;
    const result = await this.callChatCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]);
    if (result)
      return result;
    return this.generateRuleBasedSummary(prunedContext.data);
  }
  generateRuleBasedSummary(domData) {
    const title = domData.pageTitle || "Portal Layanan Publik";
    const formCount = domData.forms.length;
    const actionCount = domData.actionElements.length;
    let summary = `Halo! Anda saat ini berada di halaman "${title}". `;
    if (formCount > 0) {
      const totalFields = domData.forms.reduce((acc, f) => acc + f.fields.length, 0);
      summary += `Terdapat formulir online dengan ${totalFields} pertanyaan isian yang dapat saya bantu pandu pengisiannya secara bertahap. `;
    }
    if (actionCount > 0) {
      const topActions = domData.actionElements.slice(0, 3).map((a) => `"${a.text}"`).join(", ");
      summary += `Menu yang dapat Anda pilih antara lain: ${topActions}. `;
    }
    summary += `Silakan katakan "Bantu isi form" atau sebutkan menu yang ingin Anda buka!`;
    return summary;
  }
  async processUserIntent(userInput, prunedContext) {
    const agentIntent = await agentService.classifyIntent(userInput, prunedContext.data);
    if (agentIntent)
      return agentIntent;
    const settings = await this.getActiveSettings();
    const systemPrompt = `Anda adalah AIRA Action Engine.
Analisis perintah pengguna dan daftar elemen tombol serta form di halaman.
Keluarkan output JSON dengan format ketat:
{
  "intent": "NAVIGATE" | "FILL_FORM" | "SUMMARIZE" | "SETTINGS" | "CHAT",
  "targetId": "string ID elemen dari daftar, atau null",
  "explanation": "Penjelasan singkat santun dalam Bahasa Indonesia",
  "actionName": "Nama aksi misalnya 'Formulir Pendaftaran'",
  "confidence": 0.0 - 1.0
}
Hanya rujuk targetId yang ada pada daftar.`;
    const userPrompt = `Input Pengguna: "${userInput}"

Daftar Elemen:
${prunedContext.rawSummary}`;
    if (settings.llmEnabled && settings.llmApiKey) {
      const result = await this.callChatCompletion([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ], { jsonMode: true, temperature: 0.1 });
      if (result) {
        try {
          const parsed = JSON.parse(result);
          return parsed;
        } catch (e) {
          console.warn("[AIRA LLM] JSON parse fallback:", e);
        }
      }
    }
    return this.generateRuleBasedIntent(userInput, prunedContext.data);
  }
  generateRuleBasedIntent(query, domData) {
    const q = query.toLowerCase().trim();
    if (q.includes("ringkas") || q.includes("rangkum") || q.includes("isi halaman") || q.includes("ada apa")) {
      return {
        intent: "SUMMARIZE",
        targetId: null,
        explanation: "Saya akan membacakan ringkasan halaman ini untuk Anda.",
        actionName: "Ringkas Halaman",
        confidence: 0.95
      };
    }
    if (q.includes("isi form") || q.includes("formulir") || q.includes("daftar") || q.includes("input") || q.includes("bantu isi")) {
      const form = domData.forms[0];
      return {
        intent: "FILL_FORM",
        targetId: form ? form.id : null,
        explanation: "Saya siap memandu Anda mengisi formulir satu per satu.",
        actionName: "Bantu Isi Formulir",
        confidence: 0.9
      };
    }
    if (q.includes("kontras") || q.includes("suara") || q.includes("font") || q.includes("pengaturan")) {
      return {
        intent: "SETTINGS",
        targetId: null,
        explanation: "Membuka pengaturan aksesibilitas.",
        actionName: "Pengaturan",
        confidence: 0.9
      };
    }
    let bestMatch = null;
    let highestScore = 0;
    const words = q.replace(/buka|tampilkan|ke|cari|menu|tombol|klik|pergi/g, "").trim().split(/\s+/).filter((w) => w.length > 2);
    for (const item of domData.actionElements) {
      const itemText = item.text.toLowerCase();
      let matchCount = 0;
      for (const w of words) {
        if (itemText.includes(w))
          matchCount++;
      }
      if (matchCount > highestScore) {
        highestScore = matchCount;
        bestMatch = item;
      }
    }
    if (bestMatch && highestScore > 0) {
      return {
        intent: "NAVIGATE",
        targetId: bestMatch.id,
        explanation: `Saya menemukan "${bestMatch.text}". Ingin saya sorot dan bantu klik?`,
        actionName: bestMatch.text,
        confidence: 0.8
      };
    }
    return {
      intent: "CHAT",
      targetId: null,
      explanation: `Saya mendengar: "${query}". Anda dapat meminta saya merangkum halaman, mencari menu tertentu, atau memandu pengisian formulir.`,
      actionName: "Bantuan Umum",
      confidence: 0.5
    };
  }
  async explainFormField(field) {
    const agentExplanation = await agentService.explainField(field);
    if (agentExplanation)
      return agentExplanation;
    const settings = await this.getActiveSettings();
    const systemPrompt = `Anda adalah AIRA. Jelaskan satu kolom formulir kepada lansia atau penyandang disabilitas dalam 1-2 kalimat ramah.
Sebutkan arti kolom ini dan dokumen rujukan untuk melihat data tersebut (misal KTP, KK).`;
    const userPrompt = `Kolom: "${field.label}" (Tipe: ${field.type}, Placeholder: "${field.placeholder}")`;
    if (settings.llmEnabled && settings.llmApiKey) {
      const result = await this.callChatCompletion([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ], { temperature: 0.2 });
      if (result)
        return result;
    }
    const lbl = field.label.toLowerCase();
    if (lbl.includes("nik") || lbl.includes("kependudukan")) {
      return "Nomor NIK terdiri dari 16 digit angka, tertera di bagian atas KTP atau Kartu Keluarga Anda.";
    }
    if (lbl.includes("bpjs") || lbl.includes("peserta")) {
      return "Nomor kartu BPJS Anda, tertera pada kartu fisik BPJS atau aplikasi Mobile JKN.";
    }
    if (lbl.includes("nama")) {
      return "Nama lengkap Anda sesuai dengan yang tertulis pada dokumen resmi KTP.";
    }
    if (lbl.includes("telepon") || lbl.includes("wa") || lbl.includes("whatsapp") || lbl.includes("hp")) {
      return "Nomor telepon atau WhatsApp aktif Anda yang dapat menerima pesan konfirmasi.";
    }
    if (lbl.includes("lahir") || lbl.includes("tanggal")) {
      return "Tanggal lahir Anda sesuai dokumen resmi KTP atau akta kelahiran.";
    }
    if (lbl.includes("alamat")) {
      return "Alamat tempat tinggal Anda saat ini sesuai KTP atau domisili.";
    }
    return `Silakan masukkan informasi ${field.label} Anda sesuai data yang diminta.`;
  }
}
var llmService = new LLMService;

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
      console.warn("[AIRA TTS] WebSpeech error:", e);
      this.isSpeakingFlag = false;
      this.notifyEnd();
    };
    window.speechSynthesis.speak(utterance);
  }
}
var ttsService = new TTSService;

// src/services/stt_service.ts
class STTService {
  recognition = null;
  isListeningFlag = false;
  manualStopOnly = true;
  onInterimCallback = null;
  onFinalCallback = null;
  onErrorCallback = null;
  mediaStream = null;
  mediaRecorder = null;
  recordedAudioChunks = [];
  sessionBaseTranscript = "";
  currentSessionTranscript = "";
  latestTranscript = "";
  hasDispatchedFinal = false;
  stopGraceTimeout = null;
  captureStream = null;
  captureRecorder = null;
  captureChunks = [];
  constructor() {
    this.initRecognition();
  }
  initRecognition() {
    if (typeof window === "undefined")
      return;
    const win = window;
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn("[AIRA STT] SpeechRecognition not supported in this browser.");
      return;
    }
    try {
      this.recognition = new SpeechRec;
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = "id-ID";
    } catch (e) {
      console.warn("[AIRA STT] SpeechRecognition cannot be instantiated in this context:", e);
      this.recognition = null;
      return;
    }
    if (!this.recognition)
      return;
    this.recognition.onstart = () => {
      this.isListeningFlag = true;
      if (!this.sessionBaseTranscript) {
        soundEffects.playListenStart();
      }
    };
    this.recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";
      for (let i = 0;i < event.results.length; ++i) {
        const item = event.results[i];
        if (item.isFinal) {
          finalTranscript += item[0].transcript + " ";
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
      if (!this.manualStopOnly && finalTranscript.trim() && this.onFinalCallback) {
        this.dispatchFinalTranscript();
      }
    };
    this.recognition.onerror = (event) => {
      console.warn("[AIRA STT] WebSpeech error:", event.error);
      if (event.error === "no-speech" || event.error === "aborted") {
        return;
      }
      this.isListeningFlag = false;
      let userFriendlyMsg = "";
      if (event.error === "not-allowed") {
        userFriendlyMsg = "Izin akses mikrofon belum diaktifkan. Klik ikon gembok/kamera pada address bar Chrome untuk mengizinkan mikrofon.";
      } else if (event.error === "network") {
        userFriendlyMsg = "Koneksi pengenalan suara terputus. Pastikan koneksi internet Anda aktif.";
      } else {
        userFriendlyMsg = `Pengenalan suara: ${event.error}`;
      }
      if (this.onErrorCallback && userFriendlyMsg) {
        this.onErrorCallback(userFriendlyMsg);
      }
    };
    this.recognition.onend = () => {
      if (this.manualStopOnly && this.isListeningFlag) {
        if (this.currentSessionTranscript) {
          this.sessionBaseTranscript = (this.sessionBaseTranscript ? `${this.sessionBaseTranscript} ${this.currentSessionTranscript}` : this.currentSessionTranscript).trim();
          this.currentSessionTranscript = "";
        }
        try {
          this.recognition?.start();
          return;
        } catch (e) {
          console.warn("[AIRA STT] Recognition auto-restart failed:", e);
        }
      }
      this.isListeningFlag = false;
      this.dispatchFinalTranscript();
    };
  }
  isListening() {
    return this.isListeningFlag;
  }
  async startListening(callbacks) {
    const settings = await storageManager.getSettings();
    this.onInterimCallback = callbacks.onInterim || null;
    this.onFinalCallback = callbacks.onFinal || null;
    this.onErrorCallback = callbacks.onError || null;
    this.manualStopOnly = callbacks.manualStopOnly !== false;
    this.sessionBaseTranscript = "";
    this.currentSessionTranscript = "";
    this.latestTranscript = "";
    this.hasDispatchedFinal = false;
    if (this.stopGraceTimeout) {
      clearTimeout(this.stopGraceTimeout);
      this.stopGraceTimeout = null;
    }
    if (this.isListeningFlag) {
      this.stopListening();
    }
    if (settings.sttProvider === "whisper") {
      const ok = await this.startWhisperRecording(settings);
      if (ok)
        return true;
      console.warn("[AIRA STT] Whisper recording could not start, falling back to Web Speech API");
    }
    return this.startWebSpeechListening(settings);
  }
  startWebSpeechListening(settings) {
    if (!this.recognition) {
      this.initRecognition();
      if (!this.recognition) {
        if (this.onErrorCallback)
          this.onErrorCallback("Browser tidak mendukung Speech Recognition.");
        return false;
      }
    }
    this.latestTranscript = "";
    this.hasDispatchedFinal = false;
    this.recognition.lang = settings?.ttsVoiceLang || "id-ID";
    try {
      this.recognition.start();
      return true;
    } catch (e) {
      try {
        this.recognition.abort();
        this.recognition.start();
        return true;
      } catch (e2) {
        console.warn("[AIRA STT] WebSpeech start failed:", e2);
        return false;
      }
    }
  }
  async startWhisperRecording(settings) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn("[AIRA Whisper] getUserMedia not available, falling back to Web Speech.");
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
        const audioBlob = new Blob(this.recordedAudioChunks, { type: "audio/webm" });
        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach((t) => t.stop());
          this.mediaStream = null;
        }
        if (audioBlob.size > 1000) {
          if (this.onInterimCallback) {
            this.onInterimCallback("Mengirim rekaman ke Whisper AI...");
          }
          await this.transcribeWithWhisper(audioBlob, settings);
        } else {
          if (this.onInterimCallback)
            this.onInterimCallback("");
        }
      };
      this.mediaRecorder.start();
      this.isListeningFlag = true;
      soundEffects.playListenStart();
      if (this.onInterimCallback) {
        this.onInterimCallback("Merekam suara (Whisper)...");
      }
      return true;
    } catch (err) {
      console.warn("[AIRA Whisper] Recording init failed, fallback to WebSpeech:", err);
      return this.startWebSpeechListening();
    }
  }
  async transcribeWithWhisper(audioBlob, settings) {
    const endpoint = settings.whisperEndpoint || "https://9r.disra.net/v1/audio/transcriptions";
    const formData = new FormData;
    formData.append("file", audioBlob, "audio.webm");
    formData.append("model", settings.whisperModel || "whisper-1");
    formData.append("language", "id");
    const apiKey = settings.whisperApiKey || "9router";
    const headers = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: formData
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`9Router STT HTTP ${response.status}: ${errBody}`);
      }
      const data = await response.json();
      const text = (data.text || "").trim();
      soundEffects.playListenStop();
      if (this.onFinalCallback && text) {
        this.onFinalCallback(text);
      }
    } catch (e) {
      console.warn("[AIRA Whisper] 9Router transcription failed, notifying client fallback:", e);
      soundEffects.playError();
      if (this.onErrorCallback) {
        this.onErrorCallback("Transkripsi 9Router tidak dapat diakses. Mengalihkan ke pengenalan suara internal...");
      }
    }
  }
  stopListening() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
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
      this.stopGraceTimeout = setTimeout(() => {
        this.dispatchFinalTranscript();
      }, 200);
    } else {
      this.dispatchFinalTranscript();
    }
  }
  dispatchFinalTranscript() {
    if (this.stopGraceTimeout) {
      clearTimeout(this.stopGraceTimeout);
      this.stopGraceTimeout = null;
    }
    if (this.hasDispatchedFinal)
      return;
    const final = this.latestTranscript.trim();
    if (final && this.onFinalCallback) {
      this.hasDispatchedFinal = true;
      soundEffects.playListenStop();
      this.onFinalCallback(final);
    }
  }
  async startAudioCapture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn("[AIRA STT] getUserMedia not available for audio capture");
      return false;
    }
    try {
      this.captureStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.captureChunks = [];
      const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined;
      this.captureRecorder = new MediaRecorder(this.captureStream, options);
      this.captureRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.captureChunks.push(e.data);
        }
      };
      this.captureRecorder.start();
      soundEffects.playListenStart();
      return true;
    } catch (err) {
      console.warn("[AIRA STT] startAudioCapture failed:", err);
      return false;
    }
  }
  async stopAudioCapture() {
    if (!this.captureRecorder || this.captureRecorder.state === "inactive") {
      return null;
    }
    return new Promise((resolve) => {
      if (!this.captureRecorder) {
        resolve(null);
        return;
      }
      this.captureRecorder.onstop = () => {
        const mimeType = this.captureRecorder?.mimeType || "audio/webm";
        const blob = new Blob(this.captureChunks, { type: mimeType });
        this.captureChunks = [];
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
var sttService = new STTService;

// src/services/form_orchestrator.ts
class FormOrchestrator {
  activeForm = null;
  currentStepIndex = 0;
  answers = {};
  onStateChangeCallbacks = new Set;
  onStateChange(cb) {
    this.onStateChangeCallbacks.add(cb);
    return () => this.onStateChangeCallbacks.delete(cb);
  }
  notifyState() {
    const state = this.getCurrentState();
    for (const cb of this.onStateChangeCallbacks) {
      try {
        cb(state);
      } catch (e) {}
    }
  }
  startForm(form) {
    this.activeForm = form;
    this.currentStepIndex = 0;
    this.answers = {};
    form.fields.forEach((f) => {
      if (f.currentValue) {
        this.answers[f.id] = f.currentValue;
      }
    });
    const state = this.getCurrentState();
    this.notifyState();
    return state;
  }
  getCurrentState() {
    if (!this.activeForm || this.activeForm.fields.length === 0)
      return null;
    const isComplete = this.currentStepIndex >= this.activeForm.fields.length;
    const currentField = isComplete ? this.activeForm.fields[this.activeForm.fields.length - 1] : this.activeForm.fields[this.currentStepIndex];
    return {
      formId: this.activeForm.id,
      formTitle: this.activeForm.title,
      totalSteps: this.activeForm.fields.length,
      currentStepIndex: this.currentStepIndex,
      currentField,
      answers: { ...this.answers },
      isComplete
    };
  }
  validateValue(field, value) {
    const trimmed = value.trim();
    if (field.required && !trimmed) {
      return { valid: false, error: `${field.label} wajib diisi.` };
    }
    if (!trimmed && !field.required) {
      return { valid: true, formatted: "" };
    }
    if (field.validationKey && VALIDATION_RULES[field.validationKey]) {
      const rule = VALIDATION_RULES[field.validationKey];
      const formatted = rule.format ? rule.format(trimmed) : trimmed;
      if (!rule.pattern.test(formatted)) {
        return { valid: false, error: rule.hint, formatted };
      }
      return { valid: true, formatted };
    }
    return { valid: true, formatted: trimmed };
  }
  setAnswer(fieldId, rawValue, notify = false) {
    if (!this.activeForm)
      return { success: false, error: "Tidak ada form aktif." };
    const field = this.activeForm.fields.find((f) => f.id === fieldId);
    if (!field)
      return { success: false, error: "Field tidak ditemukan." };
    const valResult = this.validateValue(field, rawValue);
    if (!valResult.valid) {
      soundEffects.playError();
      return { success: false, error: valResult.error };
    }
    const finalVal = valResult.formatted ?? rawValue;
    this.answers[fieldId] = finalVal;
    if (notify) {
      this.notifyState();
    }
    return { success: true, formatted: finalVal };
  }
  saveAndAdvance(fieldId, rawValue) {
    const setRes = this.setAnswer(fieldId, rawValue, false);
    if (!setRes.success) {
      return { success: false, error: setRes.error };
    }
    soundEffects.playStep();
    if (this.activeForm && this.currentStepIndex < this.activeForm.fields.length) {
      this.currentStepIndex++;
    }
    const newState = this.getCurrentState();
    this.notifyState();
    return { success: true, state: newState };
  }
  nextStep() {
    if (!this.activeForm)
      return null;
    if (this.currentStepIndex < this.activeForm.fields.length) {
      this.currentStepIndex++;
      soundEffects.playStep();
      this.notifyState();
    }
    return this.getCurrentState();
  }
  previousStep() {
    if (!this.activeForm)
      return null;
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      soundEffects.playStep();
      this.notifyState();
    }
    return this.getCurrentState();
  }
  goToStep(index) {
    if (!this.activeForm)
      return null;
    if (index >= 0 && index <= this.activeForm.fields.length) {
      this.currentStepIndex = index;
      soundEffects.playStep();
      this.notifyState();
    }
    return this.getCurrentState();
  }
  syncToHostDOM(externalAnswers) {
    if (!this.activeForm)
      return false;
    if (externalAnswers) {
      Object.assign(this.answers, externalAnswers);
    }
    let anySynced = false;
    for (const field of this.activeForm.fields) {
      const val = this.answers[field.id];
      if (val === undefined || val === null)
        continue;
      const el = domPruner.getElement(field.id);
      if (el) {
        try {
          el.focus();
          const valStr = String(val);
          if (el.tagName.toLowerCase() === "select") {
            const selectEl = el;
            let matchedIdx = -1;
            for (let i = 0;i < selectEl.options.length; i++) {
              const opt = selectEl.options[i];
              if (opt.value.toLowerCase() === valStr.toLowerCase() || opt.text.toLowerCase() === valStr.toLowerCase() || opt.text.toLowerCase().includes(valStr.toLowerCase())) {
                matchedIdx = i;
                break;
              }
            }
            if (matchedIdx !== -1) {
              selectEl.selectedIndex = matchedIdx;
              selectEl.value = selectEl.options[matchedIdx].value;
            } else {
              selectEl.value = valStr;
            }
          } else if (el.type === "checkbox" || el.type === "radio") {
            const inputEl = el;
            inputEl.checked = typeof val === "boolean" ? val : ["true", "1", "ya", "yes", "on", "centang"].includes(valStr.toLowerCase());
          } else {
            const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const setDescriptor = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (setDescriptor) {
              setDescriptor.call(el, valStr);
            } else {
              el.value = valStr;
            }
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.blur();
          anySynced = true;
        } catch (e) {
          console.warn(`[AIRA Syncer] Failed to sync field ${field.id}:`, e);
        }
      }
    }
    return anySynced;
  }
  submitHostForm() {
    this.syncToHostDOM();
    if (!this.activeForm) {
      return { success: false, message: "Tidak ada formulir aktif." };
    }
    const formEl = domPruner.getElement(this.activeForm.id);
    let submitBtn = null;
    if (formEl) {
      submitBtn = formEl.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"])');
    }
    if (!submitBtn) {
      submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
    }
    if (submitBtn) {
      try {
        submitBtn.click();
        soundEffects.playSuccess();
        return { success: true, message: "Formulir berhasil dikirimkan ke website!" };
      } catch (e) {
        console.warn("[AIRA Syncer] Click submit failed:", e);
      }
    }
    if (formEl) {
      try {
        if (typeof formEl.requestSubmit === "function") {
          formEl.requestSubmit();
        } else if (typeof formEl.submit === "function") {
          formEl.submit();
        } else {
          formEl.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
        soundEffects.playSuccess();
        return { success: true, message: "Formulir berhasil dikirimkan!" };
      } catch (e) {
        console.warn("[AIRA Syncer] Direct submit failed:", e);
      }
    }
    soundEffects.playSuccess();
    return { success: true, message: "Data telah disinkronkan ke halaman formulir!" };
  }
  closeForm() {
    this.activeForm = null;
    this.currentStepIndex = 0;
    this.answers = {};
    this.notifyState();
  }
}
var formOrchestrator = new FormOrchestrator;

// src/services/host_accessibility.ts
class HostAccessibilityEngine {
  styleEl = null;
  STYLE_ID = "aira-host-accessibility-style";
  apply(settings) {
    if (typeof document === "undefined")
      return;
    if (!this.styleEl) {
      let el = document.getElementById(this.STYLE_ID);
      if (!el) {
        el = document.createElement("style");
        el.id = this.STYLE_ID;
        (document.head || document.documentElement).appendChild(el);
      }
      this.styleEl = el;
    }
    const cssRules = [];
    let fontScale = settings.fontScale ?? 100;
    if (settings.fontScale === undefined && settings.fontSize) {
      fontScale = settings.fontSize === "large" ? 125 : settings.fontSize === "xlarge" ? 150 : 100;
    }
    let controlScale = settings.controlScale ?? 100;
    if (settings.controlScale === undefined && settings.controlSize) {
      controlScale = settings.controlSize === "large" ? 125 : settings.controlSize === "xlarge" ? 150 : 100;
    }
    if (settings.highContrast) {
      cssRules.push(`
        /* AIRA WCAG 2.1 AAA High Contrast Host Adaptations */
        html, body {
          background-color: #000000 !important;
          background-image: none !important;
          color: #FFFFFF !important;
        }

        /* 1. Universal Neutralization: remove ALL light/white container backgrounds */
        div:not([role="button"]):not([role="radio"]):not([role="checkbox"]):not([role="listitem"]):not([role="dialog"]):not([role="menu"]):not([role="listbox"]):not([role="option"]):not([role="alert"]):not(input):not(textarea):not(select):not(button),
        section, article, main, header, footer, nav, aside,
        ul, ol, li, dl, dt, dd,
        p, span:not([role="button"]):not([role="radio"]):not([role="checkbox"]),
        label, small, b, strong, em, i, [dir="auto"],
        table, thead, tbody, tfoot, tr, td, th, form {
          background-color: transparent !important;
          background-image: none !important;
        }

        /* 2. Elevated Cards & Structural Surfaces (Google Forms Cards, Panels, Modals) */
        [role="listitem"], .card, .container, [role="region"],
        .Qr7Oae, .freebirdFormviewerViewFormCard, .N9Q2ih, .geS5n,
        .freebirdFormviewerViewHeaderHeader,
        fieldset, dialog, [role="dialog"], [role="alertdialog"],
        pre, code, blockquote {
          background-color: #0D0D0D !important;
          background-image: none !important;
          border: 1px solid #383838 !important;
          border-radius: 8px !important;
        }

        /* Active / focused question card */
        [role="listitem"]:focus-within, .Qr7Oae:focus-within, .card:focus-within, .geS5n:focus-within {
          border: 2px solid #FFE600 !important;
          box-shadow: 0 0 0 2px #FFE600 !important;
        }

        /* 3. Headings, Section Titles & Question Titles: Vivid Yellow (19.5:1 ratio) */
        h1, h2, h3, h4, h5, h6, [role="heading"],
        .F9yp7e, .ahS7Le, .M7eMe, .jhEkRc, .snByac, .z12JJ {
          color: #FFE600 !important;
          font-weight: 700 !important;
          text-shadow: none !important;
        }
        h1 *, h2 *, h3 *, h4 *, h5 *, h6 *, [role="heading"] *,
        .M7eMe *, .F9yp7e * {
          color: #FFE600 !important;
        }

        /* 4. Required Field Indicator Asterisk */
        .c2gzEf, span[aria-label*="wajib"], span[aria-label*="required"], .required-asterisk {
          color: #FF8080 !important;
          font-weight: bold !important;
        }

        /* 5. Body Text, Descriptions & Option Labels: Crisp Pure White (21:1 on black, 18.5:1 on cards) */
        body, p, li, dt, dd, td, th, label, small, blockquote, figcaption, time, cite,
        .aDTYNe, .vR13fe, .docssharedWizToggleLabeledLabelText, .YEVVod, .O1fdcb {
          color: #FFFFFF !important;
          text-shadow: none !important;
        }
        div:not([role="button"]):not(button):not(a):not([role="heading"]):not(.uArJbe):not(.whsOnd):not(.KHxj8b),
        span:not([role="button"]):not(button):not(a):not(.c2gzEf):not([role="heading"]):not(.uArJbe) {
          color: #FFFFFF !important;
          text-shadow: none !important;
        }

        /* 6. Regular Inline Links: Vivid Electric Cyan (13.5:1 ratio against black) */
        a:not([role="button"]):not(.btn):not([class*="button"]):not([class*="btn"]):not(.uArJbe) {
          background-color: transparent !important;
          color: #00E5FF !important;
          text-decoration: underline !important;
          font-weight: 600 !important;
        }
        a:not([role="button"]):not(.btn):not([class*="button"]):not([class*="btn"]):not(.uArJbe) * {
          color: #00E5FF !important;
          text-decoration: underline !important;
        }
        a:not([role="button"]):not(.btn):not([class*="button"]):not([class*="btn"]):not(.uArJbe):hover {
          color: #FFE600 !important;
        }

        /* 7. Action Buttons & Submit Buttons (e.g. Google Forms "Kirim" / .uArJbe) */
        button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"],
        a.btn, a[class*="button"], a[class*="btn"], .uArJbe {
          background-color: #FFE600 !important;
          background-image: none !important;
          color: #000000 !important;
          border: 2px solid #FFE600 !important;
          font-weight: 800 !important;
          text-decoration: none !important;
          border-radius: 6px !important;
        }

        /* CRITICAL: Enforce pure black text and transparent background on ALL button children */
        button *, [role="button"] *, input[type="button"] *, input[type="submit"] *,
        a.btn *, a[class*="button"] *, a[class*="btn"] *, .uArJbe *,
        .uArJbe div, .uArJbe span, .uArJbe [dir="auto"], .uArJbe .NPEfkd, .uArJbe .l4V7wb,
        [role="button"] div, [role="button"] span, [role="button"] [dir="auto"],
        button div, button span, button [dir="auto"] {
          color: #000000 !important;
          fill: #000000 !important;
          stroke: #000000 !important;
          background-color: transparent !important;
          text-shadow: none !important;
        }

        button:hover, [role="button"]:hover, .uArJbe:hover {
          background-color: #FFFFFF !important;
          border-color: #FFFFFF !important;
        }
        button:hover *, [role="button"]:hover *, .uArJbe:hover *,
        .uArJbe:hover span, .uArJbe:hover div, [role="button"]:hover span, button:hover span {
          color: #000000 !important;
          fill: #000000 !important;
        }

        /* Secondary Buttons (e.g. "Kosongkan formulir") */
        .uArJbe:not(.M9Bg4d) {
          background-color: #000000 !important;
          color: #FFE600 !important;
          border: 2px solid #FFE600 !important;
        }
        .uArJbe:not(.M9Bg4d) *, .uArJbe:not(.M9Bg4d) span, .uArJbe:not(.M9Bg4d) div, .uArJbe:not(.M9Bg4d) [dir="auto"] {
          color: #FFE600 !important;
          fill: #FFE600 !important;
        }

        /* 8. Radio Buttons (Material Design & Native) */
        div[role="radio"], [role="radio"] {
          border: 2px solid #FFFFFF !important;
          border-radius: 50% !important;
          background-color: #000000 !important;
          box-sizing: border-box !important;
        }
        div[role="radio"][aria-checked="true"], [role="radio"][aria-checked="true"],
        div[role="radio"].isChecked, [role="radio"].isChecked {
          background-color: #FFE600 !important;
          border-color: #FFE600 !important;
          box-shadow: 0 0 0 2px #000000, 0 0 0 4px #00E5FF !important;
        }
        div[role="radio"][aria-checked="true"] *, [role="radio"][aria-checked="true"] *,
        div[role="radio"].isChecked *, [role="radio"].isChecked * {
          background-color: #000000 !important;
          border-color: #000000 !important;
        }
        input[type="radio"] {
          accent-color: #FFE600 !important;
        }

        /* 9. Checkboxes (Material Design & Native) */
        div[role="checkbox"], [role="checkbox"] {
          border: 2px solid #FFFFFF !important;
          border-radius: 4px !important;
          background-color: #000000 !important;
          box-sizing: border-box !important;
        }
        div[role="checkbox"][aria-checked="true"], [role="checkbox"][aria-checked="true"],
        div[role="checkbox"].isChecked, [role="checkbox"].isChecked {
          background-color: #FFE600 !important;
          border-color: #FFE600 !important;
          box-shadow: 0 0 0 2px #000000, 0 0 0 4px #00E5FF !important;
        }
        div[role="checkbox"][aria-checked="true"] *, [role="checkbox"][aria-checked="true"] *,
        div[role="checkbox"].isChecked *, [role="checkbox"].isChecked * {
          border-color: #000000 !important;
          fill: #000000 !important;
        }
        input[type="checkbox"] {
          accent-color: #FFE600 !important;
        }

        /* Option row hover in forms */
        .docssharedWizToggleLabeledContainer {
          padding: 6px 10px !important;
          border-radius: 6px !important;
          transition: background-color 0.15s ease !important;
        }
        .docssharedWizToggleLabeledContainer:hover {
          background-color: rgba(255, 230, 0, 0.12) !important;
        }

        /* 10. Form Inputs, Textareas, Selects & Google Forms Answers */
        input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),
        select, textarea, .whsOnd, .KHxj8b {
          background-color: #121212 !important;
          background-image: none !important;
          color: #FFFFFF !important;
          border: 2px solid #FFE600 !important;
          border-radius: 6px !important;
          padding: 8px 12px !important;
          box-sizing: border-box !important;
          caret-color: #FFE600 !important;
        }
        input:focus, textarea:focus, select:focus, .whsOnd:focus, .KHxj8b:focus {
          outline: 3px solid #00E5FF !important;
          outline-offset: 2px !important;
          background-color: #1A1A1A !important;
          border-color: #00E5FF !important;
          color: #FFFFFF !important;
        }
        input::placeholder, textarea::placeholder, .whsOnd::placeholder {
          color: #AAAAAA !important;
          opacity: 1 !important;
        }
        .nd91id, .YDVdrb {
          color: #AAAAAA !important;
          background-color: transparent !important;
        }
        .m2vVea, .whsOnd::after, .whsOnd::before {
          display: none !important;
        }

        /* 11. Dropdowns, Menus & Dialog Popups */
        [role="listbox"], [role="menu"], .OA00ne, .exportSelectPopup, .quantumWizMenuPaperselectPopup {
          background-color: #121212 !important;
          border: 2px solid #FFE600 !important;
          border-radius: 8px !important;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.95) !important;
        }
        [role="option"], [role="menuitem"], .MocG8c {
          background-color: #121212 !important;
          color: #FFFFFF !important;
        }
        [role="option"] *, [role="menuitem"] *, .MocG8c * {
          color: #FFFFFF !important;
          background-color: transparent !important;
        }
        [role="option"]:hover, [role="option"][aria-selected="true"],
        [role="menuitem"]:hover, .MocG8c.KKjvXb {
          background-color: #FFE600 !important;
          color: #000000 !important;
        }
        [role="option"]:hover *, [role="option"][aria-selected="true"] *,
        [role="menuitem"]:hover *, .MocG8c.KKjvXb * {
          color: #000000 !important;
        }

        /* 12. Disabled Form Elements */
        button:disabled, [role="button"][aria-disabled="true"],
        input:disabled, textarea:disabled, select:disabled, .uArJbe.is-disabled {
          background-color: #262626 !important;
          color: #888888 !important;
          border-color: #555555 !important;
          cursor: not-allowed !important;
          box-shadow: none !important;
        }
        button:disabled *, [role="button"][aria-disabled="true"] *, .uArJbe.is-disabled * {
          color: #888888 !important;
          fill: #888888 !important;
        }

        /* 13. Form Errors & Validation Feedback (AAA contrast + non-color cue) */
        [role="alert"], .RHiGIb, .error-message, [aria-invalid="true"] {
          color: #FF8080 !important;
          font-weight: 700 !important;
          text-decoration: underline wavy !important;
          text-decoration-thickness: 2px !important;
          text-underline-offset: 3px !important;
          outline: 2px solid #FF8080 !important;
          outline-offset: 2px !important;
        }
        [role="alert"] *, .RHiGIb * {
          color: #FF8080 !important;
        }

        /* 14. Form Progress Bar */
        [role="progressbar"] {
          background-color: #222222 !important;
          border: 1px solid #555555 !important;
        }
        [role="progressbar"] > * {
          background-color: #FFE600 !important;
        }

        /* 15. Tables & Grids (e.g. Likert Scale / Grid Questions) */
        table, thead, tbody, tfoot, tr, td, th {
          background-color: transparent !important;
          border-color: #444444 !important;
          color: #FFFFFF !important;
        }
        th, [role="columnheader"], [role="rowheader"] {
          color: #FFE600 !important;
          font-weight: 700 !important;
        }

        /* 16. Google Forms Background Decor Neutralization */
        .I35ICe, .TE328e, .R30eSc {
          display: none !important;
        }
        .freebirdLightBackground, .m2, .D15tUd, .kFwPee, .teQ2e {
          background-color: #000000 !important;
          background-image: none !important;
        }

        /* 17. High Visibility Focus Ring for Tab Navigation */
        :focus-visible, a:focus, button:focus, [role="button"]:focus, .uArJbe:focus {
          outline: 3px solid #00E5FF !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 5px #000000 !important;
        }

        /* 18. Media & Vector Icons */
        img, video, canvas {
          filter: contrast(110%) brightness(95%);
        }
        body svg:not(#aira-root svg):not(#aira-root *) {
          fill: currentColor !important;
        }
        body svg:not(#aira-root svg):not(#aira-root *) path {
          fill: inherit !important;
        }
      `);
    }
    if (fontScale !== 100) {
      cssRules.push(`
        /* Zoom the host body so all pixel-based frameworks (Google Forms, React, etc.) scale proportionally */
        body {
          zoom: ${fontScale / 100} !important;
        }

        /* Root font-size scaling for rem/em-based frameworks */
        html {
          font-size: ${fontScale}% !important;
        }

        /* Explicit font scaling for form fields, labels, questions, and content */
        input, textarea, select, .whsOnd, .KHxj8b {
          font-size: calc(1rem * ${fontScale / 100}) !important;
        }
      `);
    }
    if (controlScale !== 100) {
      const minHeight = Math.round(44 * (controlScale / 100));
      const padY = Math.round(10 * (controlScale / 100));
      const radioSize = Math.round(20 * (controlScale / 100));
      const scaleMultiplier = controlScale / 100;
      cssRules.push(`
        button, a[role="button"], input[type="button"], input[type="submit"], input[type="reset"],
        input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea,
        .whsOnd, .KHxj8b, .uArJbe {
          min-height: ${minHeight}px !important;
          padding-top: ${padY}px !important;
          padding-bottom: ${padY}px !important;
          font-size: calc(1rem * ${scaleMultiplier}) !important;
        }
        button *, [role="button"] *, .uArJbe * {
          font-size: calc(1rem * ${scaleMultiplier}) !important;
        }
        /* Scale radio and checkbox size proportionally without distorting circular / square shape */
        div[role="radio"], [role="radio"],
        div[role="checkbox"], [role="checkbox"] {
          width: ${radioSize}px !important;
          height: ${radioSize}px !important;
          min-width: ${radioSize}px !important;
          min-height: ${radioSize}px !important;
        }
        input[type="radio"], input[type="checkbox"] {
          transform: scale(${scaleMultiplier}) !important;
          transform-origin: center center !important;
        }
      `);
    }
    if (settings.reduceMotion) {
      cssRules.push(`
        *, *::before, *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
          scroll-behavior: auto !important;
        }
      `);
    }
    cssRules.push(`
      #aira-root {
        all: initial !important;
        position: relative !important;
        z-index: 2147483640 !important;
      }
    `);
    this.styleEl.textContent = cssRules.join(`
`);
  }
  clear() {
    if (this.styleEl) {
      this.styleEl.textContent = "";
    }
  }
}
var hostAccessibilityEngine = new HostAccessibilityEngine;

// src/content/settings_panel.ts
class SettingsPanelComponent {
  container = null;
  settings = null;
  async init(container) {
    this.container = container;
    this.settings = await storageManager.getSettings();
    storageManager.subscribe((newSettings) => {
      this.settings = newSettings;
      this.updateViewValues(newSettings);
    });
  }
  render() {
    const wrap = document.createElement("div");
    wrap.className = "aira-settings-view";
    wrap.style.cssText = "padding: 16px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto;";
    const s = this.settings;
    wrap.innerHTML = `
      <div style="font-size: 1.1em; font-weight: 800; color: var(--aira-primary);">
        ⚙️ Pengaturan Asistensi AIRA
      </div>

      <!-- Mode Suara Penuh (Voice Only) -->
      <div style="background: var(--aira-accent-soft); border: 1px solid var(--aira-border); padding: 12px; border-radius: var(--aira-radius-md); display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-weight: 700;">\uD83C\uDF99️ Mode Suara Penuh (Voice Only)</div>
          <div style="font-size: 0.8em; color: var(--aira-text-muted);">Kontrol seluruh web hanya lewat suara tanpa mouse (Alt+A / Alt+S)</div>
        </div>
        <input type="checkbox" id="aira-set-voiceonly" style="width: 20px; height: 20px;" ${s.voiceOnlyMode ? "checked" : ""} />
      </div>

      <!-- Pintasan Keyboard Aksesibel -->
      <div style="background: var(--aira-bg-surface); border: 1px solid var(--aira-border); padding: 12px; border-radius: var(--aira-radius-md); display: flex; flex-direction: column; gap: 8px;">
        <div style="font-weight: 700; font-size: 0.9em; color: var(--aira-primary);">⌨️ Pintasan Keyboard Aksesibel</div>
        <div style="display: flex; align-items: center; justify-content: space-between; background: var(--aira-bg-card); padding: 8px 10px; border-radius: var(--aira-radius-sm); border: 1px solid var(--aira-border);">
          <div>
            <div style="font-weight: 700; font-size: 0.85em;">Alt + S (Push to Talk)</div>
            <div style="font-size: 0.75em; color: var(--aira-text-muted);">Tahan untuk bicara, lepaskan untuk mengirim</div>
          </div>
          <span style="background: var(--aira-primary); color: #FFFFFF; font-size: 0.75em; font-weight: 700; padding: 2px 6px; border-radius: 4px;">PTT</span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; background: var(--aira-bg-card); padding: 8px 10px; border-radius: var(--aira-radius-sm); border: 1px solid var(--aira-border);">
          <div>
            <div style="font-weight: 700; font-size: 0.85em;">Alt + A (Toggle Asisten)</div>
            <div style="font-size: 0.75em; color: var(--aira-text-muted);">Buka/tutup asisten suara AIRA</div>
          </div>
          <span style="background: var(--aira-text-muted); color: #FFFFFF; font-size: 0.75em; font-weight: 700; padding: 2px 6px; border-radius: 4px;">Toggle</span>
        </div>
      </div>

      <!-- STT Provider (Item 5) -->
      <div style="border: 1px solid var(--aira-border); padding: 14px; border-radius: var(--aira-radius-md); display: flex; flex-direction: column; gap: 10px;">
        <div style="font-weight: 700; color: var(--aira-primary);">\uD83C\uDF99️ Pengenalan Suara (STT)</div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size: 0.8em; font-weight: 600;">Penyedia Pengenalan Suara:</label>
          <select id="aira-set-sttprovider" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;">
            <option value="webspeech" ${!s.sttProvider || s.sttProvider === "webspeech" ? "selected" : ""}>Google Web Speech API Chrome (Default - Client)</option>
            <option value="whisper" ${s.sttProvider === "whisper" ? "selected" : ""}>9Router Whisper STT (Remote/Server)</option>
          </select>
        </div>

        <div id="aira-whisper-fields" style="display: ${s.sttProvider === "whisper" ? "flex" : "none"}; flex-direction: column; gap: 8px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.8em; font-weight: 600;">Whisper API Key:</label>
            <input type="password" id="aira-set-whisperkey" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.whisperApiKey || ""}" placeholder="9router" />
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.8em; font-weight: 600;">Whisper Endpoint:</label>
            <input type="text" id="aira-set-whisperendpoint" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.whisperEndpoint || "https://9r.disra.net/v1/audio/transcriptions"}" />
          </div>
        </div>
      </div>

      <!-- Aksesibilitas WCAG (Berlaku pada halaman web) -->
      <div style="border: 1px solid var(--aira-border); padding: 14px; border-radius: var(--aira-radius-md); display: flex; flex-direction: column; gap: 12px;">
        <div style="font-weight: 700; color: var(--aira-primary);">\uD83D\uDC53 Aksesibilitas Halaman Web (WCAG)</div>

        <!-- High Contrast -->
        <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
          <div>
            <div style="font-weight: 600;">Mode Kontras Tinggi (WCAG AAA)</div>
            <div style="font-size: 0.78em; color: var(--aira-text-muted);">Ubah website menjadi hitam pekat & teks kuning kontras 19.5:1</div>
          </div>
          <input type="checkbox" id="aira-set-contrast" style="width: 20px; height: 20px;" ${s.highContrast ? "checked" : ""} />
        </label>

        <!-- Font Size Scale -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <label for="aira-set-fontscale" style="font-weight: 600; font-size: 0.9em;">Ukuran Font Halaman Web:</label>
            <span id="aira-set-fontscale-val" style="font-size: 0.8em; font-weight: 700; color: var(--aira-primary);">${s.fontScale ?? 100}%</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="range" id="aira-set-fontscale" min="80" max="200" step="5" value="${s.fontScale ?? 100}" style="flex: 1; accent-color: var(--aira-primary); cursor: pointer;" />
            <button type="button" id="aira-btn-reset-font" style="font-size: 0.75em; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--aira-border); background: var(--aira-bg-surface); cursor: pointer;">100%</button>
          </div>
        </div>

        <!-- Control Size Scale -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <label for="aira-set-ctrlscale" style="font-weight: 600; font-size: 0.9em;">Ukuran Tombol & Input Web:</label>
            <span id="aira-set-ctrlscale-val" style="font-size: 0.8em; font-weight: 700; color: var(--aira-primary);">${s.controlScale ?? 100}%</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="range" id="aira-set-ctrlscale" min="100" max="200" step="5" value="${s.controlScale ?? 100}" style="flex: 1; accent-color: var(--aira-primary); cursor: pointer;" />
            <button type="button" id="aira-btn-reset-ctrl" style="font-size: 0.75em; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--aira-border); background: var(--aira-bg-surface); cursor: pointer;">100%</button>
          </div>
        </div>

        <!-- Reduce Motion -->
        <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
          <div>
            <div style="font-weight: 600;">Sensory Shield (Redam Animasi)</div>
            <div style="font-size: 0.78em; color: var(--aira-text-muted);">Meredam kedipan dan animasi pada website</div>
          </div>
          <input type="checkbox" id="aira-set-motion" style="width: 20px; height: 20px;" ${s.reduceMotion ? "checked" : ""} />
        </label>
      </div>

      <!-- Konfigurasi LLM -->
      <div style="border: 1px solid var(--aira-border); padding: 14px; border-radius: var(--aira-radius-md); display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-weight: 700; color: var(--aira-primary);">\uD83E\uDD16 Model AI (LLM)</div>
          <input type="checkbox" id="aira-set-llmenabled" style="width: 18px; height: 18px;" ${s.llmEnabled ? "checked" : ""} title="Aktifkan LLM" />
        </div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size: 0.8em; font-weight: 600;">Endpoint / Base URL:</label>
          <input type="text" id="aira-set-endpoint" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.llmEndpoint || ""}" placeholder="https://9r.disra.net/v1/chat/completions" />
        </div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size: 0.8em; font-weight: 600;">API Key LLM:</label>
          <input type="password" id="aira-set-apikey" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.llmApiKey || ""}" placeholder="sk-..." />
        </div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size: 0.8em; font-weight: 600;">Model Name:</label>
          <input type="text" id="aira-set-model" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.llmModel || "cx/gpt-5.6-luna"}" placeholder="cx/gpt-5.6-luna" />
        </div>
      </div>

      <!-- Konfigurasi Suara (TTS) -->
      <div style="border: 1px solid var(--aira-border); padding: 14px; border-radius: var(--aira-radius-md); display: flex; flex-direction: column; gap: 10px;">
        <div style="font-weight: 700; color: var(--aira-primary);">\uD83D\uDD0A Suara Pembaca (TTS)</div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size: 0.8em; font-weight: 600;">Penyedia Suara:</label>
          <select id="aira-set-ttsprovider" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;">
            <option value="elevenlabs" ${s.ttsProvider === "elevenlabs" ? "selected" : ""}>ElevenLabs (Utama - Alami)</option>
            <option value="google" ${s.ttsProvider === "google" ? "selected" : ""}>Google TTS Indonesia (Default Fallback)</option>
            <option value="microsoft" ${s.ttsProvider === "microsoft" ? "selected" : ""}>Microsoft TTS Indonesia</option>
          </select>
        </div>

        <div id="aira-elevenlabs-fields" style="display: ${s.ttsProvider === "elevenlabs" ? "flex" : "none"}; flex-direction: column; gap: 8px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.8em; font-weight: 600;">ElevenLabs API Key:</label>
            <input type="password" id="aira-set-elevenkey" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.elevenlabsApiKey || ""}" placeholder="xi-..." />
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.8em; font-weight: 600;">Voice ID:</label>
            <input type="text" id="aira-set-elevenvoice" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.elevenlabsVoiceId || "pNInz6obpgDQGcFmaJgB"}" />
          </div>
        </div>

        <button type="button" class="aira-btn aira-btn-outline" id="aira-btn-test-tts" style="min-height: 38px; font-size: 0.85em;">
          \uD83D\uDD0A Uji Coba Suara
        </button>
      </div>
    `;
    this.bindEvents(wrap);
    return wrap;
  }
  bindEvents(wrap) {
    const save = async () => {
      const voiceOnly = wrap.querySelector("#aira-set-voiceonly").checked;
      const contrast = wrap.querySelector("#aira-set-contrast").checked;
      const fontScale = parseInt(wrap.querySelector("#aira-set-fontscale")?.value, 10) || 100;
      const controlScale = parseInt(wrap.querySelector("#aira-set-ctrlscale")?.value, 10) || 100;
      const fontSize = fontScale >= 140 ? "xlarge" : fontScale >= 120 ? "large" : "normal";
      const controlSize = controlScale >= 140 ? "xlarge" : controlScale >= 120 ? "large" : "default";
      const reduceMotion = wrap.querySelector("#aira-set-motion").checked;
      const sttProvider = wrap.querySelector("#aira-set-sttprovider").value;
      const whisperKey = wrap.querySelector("#aira-set-whisperkey")?.value.trim() || "";
      const whisperEndpoint = wrap.querySelector("#aira-set-whisperendpoint")?.value.trim() || "";
      const llmEnabled = wrap.querySelector("#aira-set-llmenabled").checked;
      const endpoint = wrap.querySelector("#aira-set-endpoint").value.trim();
      const apiKey = wrap.querySelector("#aira-set-apikey").value.trim();
      const model = wrap.querySelector("#aira-set-model").value.trim();
      const ttsProvider = wrap.querySelector("#aira-set-ttsprovider").value;
      const elevenKey = wrap.querySelector("#aira-set-elevenkey")?.value.trim() || "";
      const elevenVoice = wrap.querySelector("#aira-set-elevenvoice")?.value.trim() || "";
      await storageManager.saveSettings({
        voiceOnlyMode: voiceOnly,
        highContrast: contrast,
        fontScale,
        controlScale,
        fontSize,
        controlSize,
        reduceMotion,
        sttProvider,
        whisperApiKey: whisperKey,
        whisperEndpoint,
        llmEnabled,
        llmEndpoint: endpoint,
        llmApiKey: apiKey,
        llmModel: model,
        ttsProvider,
        elevenlabsApiKey: elevenKey,
        elevenlabsVoiceId: elevenVoice
      });
      soundEffects.playStep();
    };
    const fontScaleInput = wrap.querySelector("#aira-set-fontscale");
    const fontScaleVal = wrap.querySelector("#aira-set-fontscale-val");
    if (fontScaleInput) {
      fontScaleInput.addEventListener("input", () => {
        if (fontScaleVal)
          fontScaleVal.innerText = `${fontScaleInput.value}%`;
      });
    }
    const ctrlScaleInput = wrap.querySelector("#aira-set-ctrlscale");
    const ctrlScaleVal = wrap.querySelector("#aira-set-ctrlscale-val");
    if (ctrlScaleInput) {
      ctrlScaleInput.addEventListener("input", () => {
        if (ctrlScaleVal)
          ctrlScaleVal.innerText = `${ctrlScaleInput.value}%`;
      });
    }
    wrap.querySelector("#aira-btn-reset-font")?.addEventListener("click", () => {
      if (fontScaleInput)
        fontScaleInput.value = "100";
      if (fontScaleVal)
        fontScaleVal.innerText = "100%";
      save();
    });
    wrap.querySelector("#aira-btn-reset-ctrl")?.addEventListener("click", () => {
      if (ctrlScaleInput)
        ctrlScaleInput.value = "100";
      if (ctrlScaleVal)
        ctrlScaleVal.innerText = "100%";
      save();
    });
    wrap.querySelectorAll("input, select").forEach((el) => {
      el.addEventListener("change", () => {
        const providerSel = wrap.querySelector("#aira-set-ttsprovider");
        const elevenFields = wrap.querySelector("#aira-elevenlabs-fields");
        if (elevenFields) {
          elevenFields.style.display = providerSel.value === "elevenlabs" ? "flex" : "none";
        }
        const sttSel = wrap.querySelector("#aira-set-sttprovider");
        const whisperFields = wrap.querySelector("#aira-whisper-fields");
        if (whisperFields) {
          whisperFields.style.display = sttSel.value === "whisper" ? "flex" : "none";
        }
        save();
      });
    });
    wrap.querySelector("#aira-btn-test-tts")?.addEventListener("click", () => {
      ttsService.speak("Halo! Ini adalah contoh suara asisten AIRA dalam Bahasa Indonesia.");
    });
  }
  updateViewValues(s) {
    if (!this.container)
      return;
    const q = (sel) => this.container.querySelector(sel);
    const voiceOnly = q("#aira-set-voiceonly");
    if (voiceOnly)
      voiceOnly.checked = s.voiceOnlyMode;
    const contrast = q("#aira-set-contrast");
    if (contrast)
      contrast.checked = s.highContrast;
    const fontSlider = q("#aira-set-fontscale");
    const fontBadge = q("#aira-set-fontscale-val");
    const fontVal = s.fontScale ?? (s.fontSize === "large" ? 125 : s.fontSize === "xlarge" ? 150 : 100);
    if (fontSlider)
      fontSlider.value = String(fontVal);
    if (fontBadge)
      fontBadge.innerText = `${fontVal}%`;
    const ctrlSlider = q("#aira-set-ctrlscale");
    const ctrlBadge = q("#aira-set-ctrlscale-val");
    const ctrlVal = s.controlScale ?? (s.controlSize === "large" ? 125 : s.controlSize === "xlarge" ? 150 : 100);
    if (ctrlSlider)
      ctrlSlider.value = String(ctrlVal);
    if (ctrlBadge)
      ctrlBadge.innerText = `${ctrlVal}%`;
    const motion = q("#aira-set-motion");
    if (motion)
      motion.checked = s.reduceMotion;
    const stt = q("#aira-set-sttprovider");
    if (stt)
      stt.value = s.sttProvider || "webspeech";
    const whKey = q("#aira-set-whisperkey");
    if (whKey)
      whKey.value = s.whisperApiKey || "";
    const whEnd = q("#aira-set-whisperendpoint");
    if (whEnd)
      whEnd.value = s.whisperEndpoint;
    const whisperFields = q("#aira-whisper-fields");
    if (whisperFields && stt) {
      whisperFields.style.display = stt.value === "whisper" ? "flex" : "none";
    }
    const llmEnabled = q("#aira-set-llmenabled");
    if (llmEnabled)
      llmEnabled.checked = s.llmEnabled;
    const endpoint = q("#aira-set-endpoint");
    if (endpoint)
      endpoint.value = s.llmEndpoint;
    const key = q("#aira-set-apikey");
    if (key)
      key.value = s.llmApiKey;
    const model = q("#aira-set-model");
    if (model)
      model.value = s.llmModel;
    const prov = q("#aira-set-ttsprovider");
    if (prov)
      prov.value = s.ttsProvider;
    const elvKey = q("#aira-set-elevenkey");
    if (elvKey)
      elvKey.value = s.elevenlabsApiKey;
    const elvVoice = q("#aira-set-elevenvoice");
    if (elvVoice)
      elvVoice.value = s.elevenlabsVoiceId;
    const elevenFields = q("#aira-elevenlabs-fields");
    if (elevenFields && prov) {
      elevenFields.style.display = prov.value === "elevenlabs" ? "flex" : "none";
    }
  }
}
var settingsPanel = new SettingsPanelComponent;

// src/content/chat_panel.ts
class ChatPanelComponent {
  container = null;
  drawerEl = null;
  messages = [];
  activeTab = "chat";
  onSendMessageCallback = null;
  onToggleVoiceOnlyCallback = null;
  onToggleVoiceInputCallback = null;
  init(container, onSendMessage, onToggleVoiceOnly, onToggleVoiceInput) {
    this.container = container;
    this.onSendMessageCallback = onSendMessage;
    this.onToggleVoiceOnlyCallback = onToggleVoiceOnly;
    this.onToggleVoiceInputCallback = onToggleVoiceInput || null;
    this.render();
  }
  setListeningState(isListening, interimText) {
    if (!this.drawerEl)
      return;
    const micBtn = this.drawerEl.querySelector("#aira-mic-btn");
    if (micBtn) {
      if (isListening) {
        micBtn.classList.add("aira-listening");
        micBtn.title = "Sedang mendengarkan... (Klik atau lepas Alt+S untuk selesai)";
      } else {
        micBtn.classList.remove("aira-listening");
        micBtn.title = "Bicara (Klik atau tahan Alt+S)";
      }
    }
    if (isListening) {
      this.setLiveTranscription(interimText || "Mendengarkan ucapan Anda...");
    } else {
      this.setLiveTranscription("");
    }
  }
  toggle(open) {
    if (!this.drawerEl)
      return;
    const shouldOpen = open !== undefined ? open : this.drawerEl.classList.contains("aira-hidden");
    if (shouldOpen) {
      this.drawerEl.classList.remove("aira-hidden");
      soundEffects.playStep();
      const input = this.drawerEl.querySelector("#aira-chat-text-input");
      setTimeout(() => input?.focus(), 150);
    } else {
      this.drawerEl.classList.add("aira-hidden");
      sttService.stopListening();
    }
  }
  isOpen() {
    return !!this.drawerEl && !this.drawerEl.classList.contains("aira-hidden");
  }
  addMessage(role, content, autoSpeak = true) {
    const msg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      role,
      content,
      timestamp: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
    };
    this.messages.push(msg);
    this.appendMessageElement(msg);
    if (role === "assistant" && autoSpeak) {
      ttsService.speak(content);
    }
  }
  appendMessageElement(msg) {
    const stream = this.drawerEl?.querySelector("#aira-messages-stream");
    if (!stream)
      return;
    const el = document.createElement("div");
    el.className = `aira-msg aira-msg-${msg.role}`;
    el.setAttribute("data-msg-id", msg.id);
    el.innerHTML = `
      <div class="aira-bubble">${msg.content}</div>
      <div class="aira-msg-meta">
        <span>${msg.timestamp}</span>
        ${msg.role === "assistant" ? `
          <button type="button" class="aira-speak-btn" title="Dengarkan suara">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
            <span>Dengarkan</span>
          </button>
        ` : ""}
      </div>
    `;
    if (msg.role === "assistant") {
      el.querySelector(".aira-speak-btn")?.addEventListener("click", () => {
        ttsService.speak(msg.content);
      });
    }
    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
  }
  setLiveTranscription(text) {
    const bar = this.drawerEl?.querySelector("#aira-live-stt-bar");
    const textSpan = this.drawerEl?.querySelector("#aira-live-stt-text");
    if (!bar || !textSpan)
      return;
    if (text) {
      bar.style.display = "flex";
      textSpan.innerText = `"${text}"`;
    } else {
      bar.style.display = "none";
      textSpan.innerText = "";
    }
  }
  clearInput() {
    const inputEl = this.drawerEl?.querySelector("#aira-chat-text-input");
    if (inputEl) {
      inputEl.value = "";
    }
  }
  render() {
    if (!this.container)
      return;
    const drawer = document.createElement("div");
    drawer.className = "aira-chat-drawer aira-hidden";
    const dateStr = new Date().toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
    drawer.innerHTML = `
      <!-- Header -->
      <div class="aira-drawer-header">
        <div class="aira-brand">
          <span class="aira-brand-title">AIRA</span>
          <span class="aira-brand-badge" id="aira-header-status-badge">Asisten Siap</span>
        </div>
        <div class="aira-header-actions">
          <button type="button" class="aira-icon-btn" id="aira-btn-toggle-voiceonly" title="Toggle Mode Suara Penuh (Alt+A) | Push to Talk (Tahan Alt+S)" aria-label="Toggle Voice Only">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          </button>
          <button type="button" class="aira-icon-btn" id="aira-btn-mute" title="Mute Suara / Berhenti Bicara" aria-label="Stop Voice">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          </button>
          <button type="button" class="aira-icon-btn" id="aira-btn-minimize" title="Tutup Panel" aria-label="Tutup Panel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      <!-- Navigation Tabs (Chat vs Settings) -->
      <div class="aira-tabs-nav">
        <button type="button" class="aira-tab-btn aira-active" id="aira-tab-chat">\uD83D\uDCAC Percakapan & Bantuan</button>
        <button type="button" class="aira-tab-btn" id="aira-tab-settings">⚙️ Pengaturan</button>
      </div>

      <!-- Main Body Container -->
      <div id="aira-tab-content" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
        <!-- Chat View Area -->
        <div id="aira-chat-view" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
          <div class="aira-messages-stream" id="aira-messages-stream">
            <div class="aira-date-divider">${dateStr}</div>
          </div>

          <!-- Quick Action Chips -->
          <div class="aira-quick-chips">
            <button type="button" class="aira-chip-btn" data-action="summary">\uD83D\uDCD6 Ringkas Halaman</button>
            <button type="button" class="aira-chip-btn" data-action="form">✍️ Bantu Isi Formulir</button>
            <button type="button" class="aira-chip-btn" data-action="nav">\uD83C\uDFAF Cari Menu Layanan</button>
          </div>

          <!-- Real-Time Speech Bar (Point 10) -->
          <div class="aira-live-stt-bar" id="aira-live-stt-bar" style="display: none;">
            <div class="aira-wave-bars">
              <div class="aira-wave-bar"></div>
              <div class="aira-wave-bar"></div>
              <div class="aira-wave-bar"></div>
              <div class="aira-wave-bar"></div>
            </div>
            <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <span style="font-weight: 700;">Mendengar:</span> <span id="aira-live-stt-text"></span>
            </div>
          </div>

          <!-- Input Bar -->
          <div class="aira-input-bar">
            <button type="button" class="aira-mic-btn" id="aira-mic-btn" title="Bicara (Klik atau tahan Alt+S)">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </button>
            <input 
              type="text" 
              class="aira-text-input" 
              id="aira-chat-text-input" 
              placeholder="Tanyakan atau tahan Alt+S untuk bicara..." 
              autocomplete="off"
            />
            <button type="button" class="aira-send-btn" id="aira-send-btn">
              Kirim
            </button>
          </div>
        </div>

        <!-- Settings View Area -->
        <div id="aira-settings-view-wrap" style="display: none; flex: 1; overflow-y: auto;"></div>
      </div>
    `;
    this.drawerEl = drawer;
    this.container.appendChild(drawer);
    this.bindEvents();
    this.addMessage("assistant", "Halo! Saya AIRA, asisten adaptif Anda. Anda dapat mengetik, mengklik tombol mikrofon, atau menahan tombol Alt + S (Push to Talk) untuk berbicara langsung kapan saja.", false);
  }
  bindEvents() {
    if (!this.drawerEl)
      return;
    const chatTabBtn = this.drawerEl.querySelector("#aira-tab-chat");
    const settingsTabBtn = this.drawerEl.querySelector("#aira-tab-settings");
    const chatView = this.drawerEl.querySelector("#aira-chat-view");
    const settingsWrap = this.drawerEl.querySelector("#aira-settings-view-wrap");
    chatTabBtn.addEventListener("click", () => {
      this.activeTab = "chat";
      chatTabBtn.classList.add("aira-active");
      settingsTabBtn.classList.remove("aira-active");
      chatView.style.display = "flex";
      settingsWrap.style.display = "none";
      soundEffects.playStep();
    });
    settingsTabBtn.addEventListener("click", async () => {
      this.activeTab = "settings";
      settingsTabBtn.classList.add("aira-active");
      chatTabBtn.classList.remove("aira-active");
      chatView.style.display = "none";
      settingsWrap.style.display = "block";
      if (settingsWrap.children.length === 0) {
        await settingsPanel.init(settingsWrap);
        settingsWrap.appendChild(settingsPanel.render());
      }
      soundEffects.playStep();
    });
    this.drawerEl.querySelector("#aira-btn-minimize")?.addEventListener("click", () => {
      this.toggle(false);
    });
    this.drawerEl.querySelector("#aira-btn-mute")?.addEventListener("click", () => {
      ttsService.stop();
      soundEffects.playStep();
    });
    this.drawerEl.querySelector("#aira-btn-toggle-voiceonly")?.addEventListener("click", () => {
      if (this.onToggleVoiceOnlyCallback) {
        this.onToggleVoiceOnlyCallback();
      }
    });
    const textInput = this.drawerEl.querySelector("#aira-chat-text-input");
    const sendBtn = this.drawerEl.querySelector("#aira-send-btn");
    const doSend = () => {
      const val = textInput.value.trim();
      if (!val)
        return;
      textInput.value = "";
      this.addMessage("user", val, false);
      if (this.onSendMessageCallback) {
        this.onSendMessageCallback(val);
      }
    };
    sendBtn.addEventListener("click", doSend);
    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doSend();
      }
    });
    const micBtn = this.drawerEl.querySelector("#aira-mic-btn");
    micBtn.addEventListener("click", () => {
      if (this.onToggleVoiceInputCallback) {
        this.onToggleVoiceInputCallback();
      } else {
        if (sttService.isListening()) {
          sttService.stopListening();
          this.setListeningState(false);
        } else {
          this.setListeningState(true);
          sttService.startListening({
            onInterim: (text) => {
              this.setLiveTranscription(text);
            },
            onFinal: (finalText) => {
              this.setListeningState(false);
              this.addMessage("user", finalText, false);
              if (this.onSendMessageCallback) {
                this.onSendMessageCallback(finalText);
              }
            },
            onError: (err) => {
              this.setListeningState(false);
              this.addMessage("system", `Peringatan mikrofon: ${err}`, false);
            }
          });
        }
      }
    });
    this.drawerEl.querySelectorAll(".aira-chip-btn").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        const action = e.currentTarget.getAttribute("data-action");
        if (action === "summary") {
          doSendWithText("Tolong rangkum isi halaman ini");
        } else if (action === "form") {
          doSendWithText("Bantu saya mengisi formulir di halaman ini");
        } else if (action === "nav") {
          doSendWithText("Tunjukkan menu atau tombol utama di halaman ini");
        }
      });
    });
    const doSendWithText = (txt) => {
      this.addMessage("user", txt, false);
      if (this.onSendMessageCallback) {
        this.onSendMessageCallback(txt);
      }
    };
  }
  updateVoiceOnlyBadge(isActive) {
    const btn = this.drawerEl?.querySelector("#aira-btn-toggle-voiceonly");
    const badge = this.drawerEl?.querySelector("#aira-header-status-badge");
    if (btn) {
      if (isActive)
        btn.classList.add("aira-active");
      else
        btn.classList.remove("aira-active");
    }
    if (badge) {
      badge.innerText = isActive ? "\uD83C\uDF99️ Voice Only Aktif" : "Asisten Siap";
    }
  }
}
var chatPanel = new ChatPanelComponent;

// src/content/form_wizard.ts
class FormWizardComponent {
  container = null;
  modalEl = null;
  onInteractionCallback = null;
  onVoiceStateCallback = null;
  onVoiceFinalCallback = null;
  escKeyListener = null;
  isProcessingVoiceInput = false;
  activeSessionId = null;
  activeForm = null;
  isServerMode = false;
  lastAgentResponse = null;
  init(container, onInteraction, onVoiceState, onVoiceFinal) {
    this.container = container;
    this.onInteractionCallback = onInteraction;
    this.onVoiceStateCallback = onVoiceState || null;
    this.onVoiceFinalCallback = onVoiceFinal || null;
    formOrchestrator.onStateChange((state) => {
      if (this.isServerMode)
        return;
      if (state) {
        this.render(state);
      } else {
        this.destroy();
      }
    });
    this.escKeyListener = (e) => {
      if (e.key === "Escape" && this.isOpen()) {
        this.close();
      }
    };
    window.addEventListener("keydown", this.escKeyListener);
  }
  isOpen() {
    return !!this.modalEl && !!this.container?.contains(this.modalEl);
  }
  isVoiceActive() {
    return this.isProcessingVoiceInput || sttService.isListening();
  }
  async startVoiceInput() {
    if (!this.isOpen() || this.isProcessingVoiceInput)
      return;
    const card = this.modalEl?.querySelector(".aira-wizard-card");
    const voiceBtn = card?.querySelector("#aira-wizard-voice-btn") || card?.querySelector("#aira-summary-voice-btn");
    const inputEl = card?.querySelector("#aira-step-input") || card?.querySelector("#aira-summary-input");
    const errorSlot = card?.querySelector("#aira-wizard-error-slot") || card?.querySelector("#aira-summary-error-slot");
    const voiceText = voiceBtn?.querySelector(".aira-voice-btn-text");
    if (!voiceBtn || !voiceText)
      return;
    if (this.isServerMode && this.activeSessionId) {
      voiceBtn.classList.add("aira-listening");
      voiceText.innerText = "Merekam suara... (Lepas/Klik lagi untuk kirim)";
      if (errorSlot)
        errorSlot.innerHTML = "";
      this.isProcessingVoiceInput = true;
      this.onVoiceStateCallback?.(true, "Merekam suara untuk AIRA Agent...");
      const started = await sttService.startAudioCapture();
      if (!started) {
        this.isProcessingVoiceInput = false;
        voiceBtn.classList.remove("aira-listening");
        voiceText.innerText = "Gagal mengakses mikrofon (Alt+S)";
        this.onVoiceStateCallback?.(false);
      }
      return;
    }
    const state = formOrchestrator.getCurrentState();
    if (!state || !inputEl || !errorSlot)
      return;
    voiceBtn.classList.add("aira-listening");
    voiceText.innerText = "Mendengarkan ucapan (Alt+S)...";
    errorSlot.innerHTML = "";
    this.isProcessingVoiceInput = true;
    this.onVoiceStateCallback?.(true, "Mendengarkan isian formulir...");
    await sttService.startListening({
      onInterim: (interim) => {
        inputEl.value = interim;
        voiceText.innerText = `Mendengarkan: "${interim}"`;
        this.onVoiceStateCallback?.(true, interim);
      },
      onFinal: (finalText) => {
        inputEl.value = finalText;
        voiceBtn.classList.remove("aira-listening");
        voiceText.innerText = "Berikan pesan dengan suara (Alt+S)";
        this.isProcessingVoiceInput = false;
        this.onVoiceStateCallback?.(false);
        if (this.onVoiceFinalCallback && finalText && finalText.trim()) {
          this.onVoiceFinalCallback(finalText.trim());
        } else if (finalText && finalText.trim()) {
          this.commitVoiceAnswer(finalText.trim());
        }
      },
      onError: () => {
        this.isProcessingVoiceInput = false;
        voiceBtn.classList.remove("aira-listening");
        voiceText.innerText = "Coba lagi (Alt+S)";
        this.onVoiceStateCallback?.(false);
      }
    });
  }
  commitVoiceAnswer(answer) {
    const card = this.modalEl?.querySelector(".aira-wizard-card");
    const inputEl = card?.querySelector("#aira-step-input") || card?.querySelector("#aira-summary-input");
    const errorSlot = card?.querySelector("#aira-wizard-error-slot") || card?.querySelector("#aira-summary-error-slot");
    if (this.isServerMode && this.activeSessionId) {
      if (inputEl)
        inputEl.value = answer;
      this.handleServerTextInput(answer);
      return;
    }
    const state = formOrchestrator.getCurrentState();
    if (!state || !inputEl || !errorSlot)
      return;
    inputEl.value = answer;
    if (state.isComplete) {
      const lower = answer.toLowerCase();
      if (lower.includes("ya") || lower.includes("kirim") || lower.includes("benar") || lower.includes("setuju")) {
        card?.querySelector("#aira-summary-submit")?.click();
      } else {
        ttsService.speak("Silakan tekan tombol Kirim Formulir atau klik Ubah pada data yang ingin diperbaiki.");
      }
      return;
    }
    const advRes = formOrchestrator.saveAndAdvance(state.currentField.id, answer);
    if (!advRes.success) {
      this.showError(errorSlot, inputEl, advRes.error || "Format tidak valid");
      ttsService.speak(`Periksa kembali isian Anda. ${advRes.error}`);
    } else {
      this.clearError(errorSlot, inputEl);
      if (this.onInteractionCallback) {
        this.onInteractionCallback(`Jawaban ${state.currentField.label}: ${answer}`);
      }
    }
  }
  async stopVoiceInput() {
    if (!this.isProcessingVoiceInput && !sttService.isListening())
      return;
    if (this.isServerMode && this.activeSessionId) {
      const card = this.modalEl?.querySelector(".aira-wizard-card");
      const voiceBtn = card?.querySelector("#aira-wizard-voice-btn") || card?.querySelector("#aira-summary-voice-btn");
      const voiceText = voiceBtn?.querySelector(".aira-voice-btn-text");
      if (voiceBtn && voiceText) {
        voiceBtn.classList.remove("aira-listening");
        voiceText.innerText = "Memproses rekaman suara...";
      }
      this.isProcessingVoiceInput = false;
      this.onVoiceStateCallback?.(false);
      const audioBlob = await sttService.stopAudioCapture();
      if (audioBlob && this.activeSessionId) {
        let res = await agentService.interactWithAudio(this.activeSessionId, audioBlob);
        if (!res && this.activeForm) {
          console.warn("[AIRA Wizard] Session expired or server reloaded, re-initiating session...");
          const newSession = await agentService.startSession(this.activeForm);
          if (newSession && newSession.session_id) {
            this.activeSessionId = newSession.session_id;
            res = await agentService.interactWithAudio(this.activeSessionId, audioBlob);
          }
        }
        if (res) {
          await this.handleAgentStepResponse(res);
          return;
        }
      }
      if (voiceText)
        voiceText.innerText = "Berikan pesan dengan suara (Alt+S)";
      return;
    }
    if (this.isProcessingVoiceInput || sttService.isListening()) {
      sttService.stopListening();
    }
    this.isProcessingVoiceInput = false;
    this.onVoiceStateCallback?.(false);
  }
  async open(form) {
    this.activeForm = form;
    this.isProcessingVoiceInput = false;
    try {
      const session = await agentService.startSession(form);
      if (session && session.session_id) {
        this.activeSessionId = session.session_id;
        this.isServerMode = true;
        this.lastAgentResponse = session;
        formOrchestrator["activeForm"] = form;
        formOrchestrator["answers"] = { ...session.answers || {} };
        await this.handleAgentStepResponse(session);
        return;
      }
    } catch (err) {
      console.warn("[AIRA Wizard] Server session start error, fallback to local orchestrator:", err);
    }
    this.activeSessionId = null;
    this.isServerMode = false;
    formOrchestrator.startForm(form);
  }
  close() {
    if (this.activeSessionId) {
      agentService.cancelSession(this.activeSessionId).catch(() => {});
      this.activeSessionId = null;
    }
    this.isServerMode = false;
    this.isProcessingVoiceInput = false;
    this.onVoiceStateCallback?.(false);
    sttService.stopListening();
    ttsService.stop();
    formOrchestrator.closeForm();
    this.destroy();
  }
  destroy() {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
  async handleAgentStepResponse(res) {
    this.lastAgentResponse = res;
    soundEffects.playServerCue(res.audio_cue);
    if (res.spoken_prompt) {
      ttsService.speak(res.spoken_prompt);
      this.onInteractionCallback?.(res.spoken_prompt);
    }
    if (!res.is_valid) {
      const card = this.modalEl?.querySelector(".aira-wizard-card");
      const inputEl = card?.querySelector("#aira-step-input");
      const errorSlot = card?.querySelector("#aira-wizard-error-slot");
      if (errorSlot && inputEl) {
        if (res.current_field && res.answers && res.answers[res.current_field.id]) {
          inputEl.value = String(res.answers[res.current_field.id]);
        }
        this.showError(errorSlot, inputEl, res.spoken_prompt || "Data tidak valid");
      }
      return;
    }
    const answersToSync = res.sync_payload || res.answers;
    if (answersToSync && Object.keys(answersToSync).length > 0) {
      formOrchestrator.syncToHostDOM(answersToSync);
    }
    const normStatus = (res.status || "").toLowerCase();
    if (normStatus === "review" || normStatus === "awaiting_confirmation" || normStatus === "reviewing") {
      this.renderServerSummary(res);
    } else if (normStatus === "completed") {
      formOrchestrator.submitHostForm();
      this.close();
    } else {
      await this.renderServerStep(res);
    }
  }
  async handleServerTextInput(val) {
    if (!this.activeSessionId)
      return;
    const card = this.modalEl?.querySelector(".aira-wizard-card");
    const nextBtn = card?.querySelector("#aira-wizard-next");
    if (nextBtn)
      nextBtn.disabled = true;
    try {
      let res = await agentService.interactWithText(this.activeSessionId, val);
      if (!res && this.activeForm) {
        console.warn("[AIRA Wizard] Session expired or server reloaded, re-initiating session...");
        const newSession = await agentService.startSession(this.activeForm);
        if (newSession && newSession.session_id) {
          this.activeSessionId = newSession.session_id;
          res = await agentService.interactWithText(this.activeSessionId, val);
        }
      }
      if (res) {
        await this.handleAgentStepResponse(res);
      } else {
        soundEffects.playError();
        ttsService.speak("Gagal berkomunikasi dengan server.");
      }
    } finally {
      if (nextBtn)
        nextBtn.disabled = false;
    }
  }
  async renderServerStep(res) {
    if (!this.container)
      return;
    this.destroy();
    const overlay = this.createOverlay();
    const fieldData = res.current_field || this.activeForm?.fields[res.step_index];
    const fieldDataDomId = fieldData && "domId" in fieldData ? fieldData.domId : undefined;
    const field = {
      id: fieldData?.id || fieldDataDomId || `field_${res.step_index + 1}`,
      label: fieldData?.label || "Kolom Isian",
      type: fieldData?.type || "text",
      placeholder: fieldData?.placeholder || "",
      required: fieldData?.required ?? true,
      currentValue: fieldData?.currentValue || "",
      options: fieldData?.options || [],
      hint: res.field_hint || fieldData?.hint || ""
    };
    const formTitle = this.activeForm?.title || "Formulir";
    const currentValue = res.answers && res.answers[field.id] ? String(res.answers[field.id]) : "";
    this.buildStepDOM(overlay, {
      field,
      stepNum: res.step_index + 1,
      totalSteps: res.total_steps,
      progressPercent: res.progress_percent,
      hint: res.field_hint || field.hint || `Masukkan ${field.label} Anda`,
      formTitle,
      currentValue,
      isServerMode: true
    });
    this.modalEl = overlay;
    this.container.appendChild(overlay);
  }
  renderServerSummary(res) {
    if (!this.container)
      return;
    this.destroy();
    const overlay = this.createOverlay();
    const formTitle = this.activeForm?.title || "Formulir";
    this.buildSummaryDOM(overlay, {
      formTitle,
      answers: res.answers || {},
      isServerMode: true
    });
    this.modalEl = overlay;
    this.container.appendChild(overlay);
  }
  async render(state) {
    if (!this.container)
      return;
    this.destroy();
    const overlay = this.createOverlay();
    if (state.isComplete) {
      this.buildSummaryDOM(overlay, {
        formTitle: state.formTitle,
        answers: state.answers,
        isServerMode: false
      });
    } else {
      const field = state.currentField;
      const stepNum = state.currentStepIndex + 1;
      const progressPercent = Math.round(stepNum / state.totalSteps * 100);
      const hint = field.hint || await llmService.explainFormField(field);
      const currentValue = state.answers[field.id] || "";
      this.buildStepDOM(overlay, {
        field,
        stepNum,
        totalSteps: state.totalSteps,
        progressPercent,
        hint,
        formTitle: state.formTitle,
        currentValue,
        isServerMode: false
      });
      const promptText = `Langkah ${stepNum}. Masukkan ${field.label} Anda. ${hint}`;
      ttsService.speak(promptText);
      this.onInteractionCallback?.(promptText);
    }
    this.modalEl = overlay;
    this.container.appendChild(overlay);
  }
  createOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "aira-modal-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });
    return overlay;
  }
  buildStepDOM(overlay, params) {
    const { field, stepNum, totalSteps, progressPercent, hint, formTitle, currentValue, isServerMode } = params;
    const card = document.createElement("div");
    card.className = "aira-wizard-card";
    card.innerHTML = `
      <div class="aira-wizard-header">
        <div class="aira-brand">
          <span class="aira-brand-title">AIRA</span>
          <span class="aira-brand-badge">${formTitle}</span>
        </div>
        <button type="button" class="aira-icon-btn aira-close-wizard" title="Tutup Formulir (Esc)" aria-label="Tutup Formulir">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="aira-wizard-step-info">
        <span>Langkah ${stepNum} dari ${totalSteps}</span>
        <span>${progressPercent}% Selesai</span>
      </div>
      <div class="aira-progress-bar-wrap">
        <div class="aira-progress-bar-fill" style="width: ${progressPercent}%;"></div>
      </div>

      <div class="aira-wizard-body">
        <div class="aira-wizard-title-wrap">
          <div class="aira-wizard-title" id="aira-q-title">
            Masukkan ${field.label} Anda
          </div>
          <button type="button" class="aira-read-aloud-btn" title="Bacakan pertanyaan" aria-label="Bacakan pertanyaan">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          </button>
        </div>

        <div class="aira-wizard-hint">
          ${hint}
        </div>

        <div id="aira-wizard-error-slot"></div>

        <div class="aira-wizard-input-wrap">
          <input 
            type="${field.type === "number" ? "tel" : field.type || "text"}"
            class="aira-wizard-input" 
            id="aira-step-input" 
            placeholder="${field.placeholder || `Ketik atau ucapkan ${field.label}...`}" 
            value="${currentValue}"
            autocomplete="off"
          />
        </div>

        <button type="button" class="aira-big-voice-btn" id="aira-wizard-voice-btn" title="Klik atau tahan Alt+S untuk bicara">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          <span class="aira-voice-btn-text">Berikan pesan dengan suara (Alt+S)</span>
        </button>
      </div>

      <div class="aira-wizard-footer">
        <button type="button" class="aira-btn aira-btn-outline" id="aira-wizard-prev" ${stepNum === 1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ""}>
          &lt; Kembali
        </button>
        <button type="button" class="aira-btn aira-btn-primary" id="aira-wizard-next">
          Lanjut ke ${stepNum < totalSteps ? `Langkah ${stepNum + 1}` : "Rangkuman"} &gt;
        </button>
      </div>
    `;
    overlay.appendChild(card);
    const inputEl = card.querySelector("#aira-step-input");
    const voiceBtn = card.querySelector("#aira-wizard-voice-btn");
    const voiceText = voiceBtn.querySelector(".aira-voice-btn-text");
    const errorSlot = card.querySelector("#aira-wizard-error-slot");
    setTimeout(() => inputEl.focus(), 150);
    card.querySelector(".aira-read-aloud-btn")?.addEventListener("click", () => {
      const promptText = `Langkah ${stepNum}. Masukkan ${field.label} Anda. ${hint}`;
      ttsService.speak(promptText);
    });
    card.querySelector(".aira-close-wizard")?.addEventListener("click", () => {
      this.close();
    });
    voiceBtn.addEventListener("click", async () => {
      if (this.isVoiceActive()) {
        await this.stopVoiceInput();
        voiceBtn.classList.remove("aira-listening");
        voiceText.innerText = "Berikan pesan dengan suara (Alt+S)";
      } else {
        await this.startVoiceInput();
      }
    });
    card.querySelector("#aira-wizard-next")?.addEventListener("click", async () => {
      const val = inputEl.value;
      if (isServerMode && this.activeSessionId) {
        await this.handleServerTextInput(val);
        return;
      }
      const advRes = formOrchestrator.saveAndAdvance(field.id, val);
      if (!advRes.success) {
        this.showError(errorSlot, inputEl, advRes.error || "Format tidak valid");
        ttsService.speak(advRes.error || "Format tidak valid");
      } else {
        this.clearError(errorSlot, inputEl);
        this.onInteractionCallback?.(`Jawaban ${field.label}: ${val}`);
      }
    });
    card.querySelector("#aira-wizard-prev")?.addEventListener("click", async () => {
      if (isServerMode && this.activeSessionId) {
        const res = await agentService.stepBack(this.activeSessionId);
        if (res) {
          await this.handleAgentStepResponse(res);
        }
        return;
      }
      formOrchestrator.previousStep();
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        card.querySelector("#aira-wizard-next")?.click();
      }
    });
  }
  showError(errorSlot, inputEl, errorMsg) {
    inputEl.classList.add("aira-input-error");
    errorSlot.innerHTML = `
      <div class="aira-error-card">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span>${errorMsg}</span>
      </div>
    `;
  }
  clearError(errorSlot, inputEl) {
    inputEl.classList.remove("aira-input-error");
    errorSlot.innerHTML = "";
  }
  buildSummaryDOM(overlay, params) {
    const { formTitle, answers, isServerMode } = params;
    const card = document.createElement("div");
    card.className = "aira-wizard-card";
    let summaryItemsHtml = "";
    const entries = Object.entries(answers);
    entries.forEach(([fieldId, val]) => {
      const field = this.activeForm?.fields.find((f) => f.id === fieldId) || formOrchestrator["activeForm"]?.fields.find((f) => f.id === fieldId);
      const label = field ? field.label : fieldId;
      const idx = this.activeForm?.fields.findIndex((f) => f.id === fieldId) ?? 0;
      summaryItemsHtml += `
        <div class="aira-summary-item">
          <div class="aira-summary-info">
            <span class="aira-summary-label">${label}</span>
            <span class="aira-summary-val">${val || "-"}</span>
          </div>
          <button type="button" class="aira-summary-edit-btn" data-step="${idx}" data-field-id="${fieldId}">
            Ubah
          </button>
        </div>
      `;
    });
    card.innerHTML = `
      <div class="aira-wizard-header">
        <div class="aira-brand">
          <span class="aira-brand-title">AIRA</span>
          <span class="aira-brand-badge">Rangkuman Pengisian</span>
        </div>
        <button type="button" class="aira-icon-btn aira-close-wizard" title="Tutup (Esc)" aria-label="Tutup">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="aira-wizard-body">
        <div class="aira-wizard-title-wrap">
          <div class="aira-wizard-title">
            Periksa data Anda di bawah ini
          </div>
          <button type="button" class="aira-read-aloud-btn" id="aira-summary-read" title="Bacakan rangkuman" aria-label="Bacakan rangkuman">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          </button>
        </div>

        <div class="aira-wizard-hint">
          Jika seluruh data sudah sesuai, tekan "Kirim Formulir Sekarang". Jika ada yang salah, tekan tombol "Ubah" pada data yang bersangkutan.
        </div>

        <div class="aira-summary-list">
          ${summaryItemsHtml}
        </div>

        <div id="aira-summary-error-slot"></div>

        <div class="aira-wizard-input-wrap" style="margin-top: 10px;">
          <input 
            type="text" 
            class="aira-wizard-input" 
            id="aira-summary-input" 
            placeholder="Ketik atau ucapkan 'Ya, kirim' atau 'Belum, ubah [kolom]'..." 
            autocomplete="off"
          />
        </div>

        <button type="button" class="aira-big-voice-btn" id="aira-summary-voice-btn" title="Klik atau tahan Alt+S untuk bicara konfirmasi / koreksi">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          <span class="aira-voice-btn-text">Konfirmasi Suara / Koreksi (Alt+S)</span>
        </button>
      </div>

      <div class="aira-wizard-footer">
        <button type="button" class="aira-btn aira-btn-outline" id="aira-summary-back">
          &lt; Kembali Edit
        </button>
        <button type="button" class="aira-btn aira-btn-primary" id="aira-summary-submit">
          Kirim Formulir Sekarang
        </button>
      </div>
    `;
    overlay.appendChild(card);
    const summarySpeech = `Seluruh pertanyaan formulir telah selesai. Silakan periksa kembali data Anda. Jika sudah benar, tekan tombol Kirim Formulir Sekarang.`;
    if (!isServerMode) {
      ttsService.speak(summarySpeech);
      this.onInteractionCallback?.(summarySpeech);
    }
    card.querySelector("#aira-summary-read")?.addEventListener("click", () => {
      ttsService.speak(summarySpeech);
    });
    card.querySelector("#aira-summary-voice-btn")?.addEventListener("click", async () => {
      const voiceBtn = card.querySelector("#aira-summary-voice-btn");
      const voiceText = voiceBtn?.querySelector(".aira-voice-btn-text");
      if (this.isProcessingVoiceInput || sttService.isListening()) {
        await this.stopVoiceInput();
        if (voiceBtn && voiceText) {
          voiceBtn.classList.remove("aira-listening");
          voiceText.innerText = "Konfirmasi Suara / Koreksi (Alt+S)";
        }
      } else {
        await this.startVoiceInput();
      }
    });
    const summaryInput = card.querySelector("#aira-summary-input");
    summaryInput?.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = summaryInput.value.trim();
        if (!val)
          return;
        if (isServerMode && this.activeSessionId) {
          await this.handleServerTextInput(val);
        } else {
          this.commitVoiceAnswer(val);
        }
      }
    });
    card.querySelector(".aira-close-wizard")?.addEventListener("click", () => {
      this.close();
    });
    card.querySelector("#aira-summary-back")?.addEventListener("click", async () => {
      if (isServerMode && this.activeSessionId) {
        const res = await agentService.stepBack(this.activeSessionId);
        if (res) {
          await this.handleAgentStepResponse(res);
        }
        return;
      }
      const total = this.activeForm?.fields.length || 1;
      formOrchestrator.goToStep(total - 1);
    });
    card.querySelectorAll(".aira-summary-edit-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const target = e.currentTarget;
        const fieldId = target.getAttribute("data-field-id") || "";
        const step = parseInt(target.getAttribute("data-step") || "0", 10);
        if (isServerMode && this.activeSessionId && fieldId) {
          const res = await agentService.jumpToField(this.activeSessionId, fieldId);
          if (res) {
            await this.handleAgentStepResponse(res);
          }
          return;
        }
        formOrchestrator.goToStep(step);
      });
    });
    card.querySelector("#aira-summary-submit")?.addEventListener("click", async () => {
      if (isServerMode && this.activeSessionId) {
        const res = await agentService.confirmSubmission(this.activeSessionId, "ya");
        if (res) {
          if (res.sync_payload) {
            formOrchestrator.syncToHostDOM(res.sync_payload);
          }
          const submitRes2 = formOrchestrator.submitHostForm();
          this.close();
          soundEffects.playServerCue(res.audio_cue || "complete");
          const finalMsg = res.spoken_prompt || (submitRes2.success ? "Data formulir berhasil diisi dan dikirimkan!" : submitRes2.message);
          ttsService.speak(finalMsg);
          this.onInteractionCallback?.(finalMsg);
          return;
        }
      }
      const submitRes = formOrchestrator.submitHostForm();
      this.close();
      const successMsg = submitRes.success ? "Data formulir berhasil diisi dan dikirimkan secara langsung ke portal!" : submitRes.message;
      ttsService.speak(successMsg);
      this.onInteractionCallback?.(successMsg);
    });
  }
}
var formWizard = new FormWizardComponent;

// src/content/spotlight.ts
class SpotlightManager {
  hostContainer = null;
  spotlightEl = null;
  tooltipEl = null;
  currentTarget = null;
  init(container) {
    this.hostContainer = container;
  }
  show(targetEl, explanation, onConfirm, onCancel) {
    this.hide();
    if (!this.hostContainer || !targetEl)
      return;
    this.currentTarget = targetEl;
    targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    soundEffects.playStep();
    const rect = targetEl.getBoundingClientRect();
    const box = document.createElement("div");
    box.className = "aira-spotlight-box";
    box.style.top = `${rect.top - 6}px`;
    box.style.left = `${rect.left - 6}px`;
    box.style.width = `${rect.width + 12}px`;
    box.style.height = `${rect.height + 12}px`;
    this.spotlightEl = box;
    this.hostContainer.appendChild(box);
    const tooltip = document.createElement("div");
    tooltip.className = "aira-spotlight-tooltip";
    let tooltipTop = rect.bottom + 14;
    if (tooltipTop + 160 > window.innerHeight) {
      tooltipTop = Math.max(10, rect.top - 170);
    }
    let tooltipLeft = Math.max(10, Math.min(rect.left, window.innerWidth - 340));
    tooltip.style.top = `${tooltipTop}px`;
    tooltip.style.left = `${tooltipLeft}px`;
    tooltip.innerHTML = `
      <div class="aira-spotlight-tooltip-title">\uD83D\uDCA1 Petunjuk Navigasi AIRA</div>
      <div class="aira-spotlight-tooltip-desc">${explanation}</div>
      <div class="aira-spotlight-actions">
        <button type="button" class="aira-btn aira-btn-primary aira-confirm-btn" style="flex: 1;">
          Klik Sekarang
        </button>
        <button type="button" class="aira-btn aira-btn-outline aira-cancel-btn">
          Tutup
        </button>
      </div>
    `;
    tooltip.querySelector(".aira-confirm-btn")?.addEventListener("click", () => {
      soundEffects.playClick();
      this.hide();
      targetEl.click();
      onConfirm();
    });
    tooltip.querySelector(".aira-cancel-btn")?.addEventListener("click", () => {
      this.hide();
      onCancel();
    });
    this.tooltipEl = tooltip;
    this.hostContainer.appendChild(tooltip);
    const updatePosition = () => {
      if (!this.currentTarget || !this.spotlightEl || !this.tooltipEl)
        return;
      const r = this.currentTarget.getBoundingClientRect();
      this.spotlightEl.style.top = `${r.top - 6}px`;
      this.spotlightEl.style.left = `${r.left - 6}px`;
      this.spotlightEl.style.width = `${r.width + 12}px`;
      this.spotlightEl.style.height = `${r.height + 12}px`;
    };
    window.addEventListener("scroll", updatePosition, { passive: true, once: false });
  }
  hide() {
    if (this.spotlightEl) {
      this.spotlightEl.remove();
      this.spotlightEl = null;
    }
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
    this.currentTarget = null;
  }
}
var spotlightManager = new SpotlightManager;

// src/content/content_script.ts
class AiraContentCoordinator {
  shadowHost = null;
  shadowRoot = null;
  srAnnouncer = null;
  currentSettings = null;
  isPttActive = false;
  pttMode = "idle";
  pttStartTime = 0;
  pttPressTimestamp = 0;
  pttKeyupDebounceTimer = null;
  pttSafetyMaxTimer = null;
  pttSubmitAfterStop = false;
  pttToastEl = null;
  isVoiceConfirmationPending = false;
  pendingVoiceTranscript = "";
  pendingVoiceTarget = "chat";
  confirmCardEl = null;
  confirmTtsTimeout = null;
  async init() {
    if (document.getElementById("aira-root"))
      return;
    this.currentSettings = await storageManager.getSettings();
    const target = document.documentElement || document.body;
    if (!target) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => this.init(), { once: true });
      }
      return;
    }
    this.shadowHost = document.createElement("div");
    this.shadowHost.id = "aira-root";
    this.shadowRoot = this.shadowHost.attachShadow({ mode: "open" });
    target.appendChild(this.shadowHost);
    await this.injectStyles();
    this.srAnnouncer = document.createElement("div");
    this.srAnnouncer.className = "aira-sr-only";
    this.srAnnouncer.setAttribute("aria-live", "assertive");
    this.shadowRoot.appendChild(this.srAnnouncer);
    this.createFloatingTrigger();
    spotlightManager.init(this.shadowRoot);
    chatPanel.init(this.shadowRoot, (userText) => this.handleUserMessage(userText), () => this.toggleVoiceOnlyMode(), () => this.toggleVoiceInput());
    formWizard.init(this.shadowRoot, (prompt, answer) => {
      chatPanel.addMessage("assistant", prompt, false);
      if (answer) {
        chatPanel.addMessage("user", answer, false);
      }
    }, (isListening, interim) => {
      chatPanel.setListeningState(isListening, interim);
      if (isListening) {
        if (interim && interim !== "Mendengarkan isian formulir...") {
          this.showPttToast(interim, true);
        } else {
          this.showPttToast("Mendengarkan isian formulir...", false);
        }
      } else {
        this.hidePttToast();
      }
    }, (finalText) => {
      const submitAfterStop = this.pttSubmitAfterStop;
      this.pttSubmitAfterStop = false;
      if (submitAfterStop) {
        formWizard.commitVoiceAnswer(finalText);
      } else {
        this.enterVoiceConfirmation(finalText, "form");
      }
    });
    this.applySettingsToUI(this.currentSettings);
    storageManager.subscribe((newSettings) => {
      this.currentSettings = newSettings;
      this.applySettingsToUI(newSettings);
    });
    window.addEventListener("keydown", (e) => {
      if (this.isVoiceConfirmationPending) {
        if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          e.stopPropagation();
          this.confirmVoiceInput();
          return;
        }
        if (e.key === "Escape" || e.code === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.cancelVoiceInput();
          return;
        }
      }
      if (e.altKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleVoiceAssistantShortcut();
      } else if (e.altKey && (e.key === "s" || e.key === "S" || e.code === "KeyS")) {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat)
          return;
        if (this.pttKeyupDebounceTimer) {
          clearTimeout(this.pttKeyupDebounceTimer);
          this.pttKeyupDebounceTimer = null;
          return;
        }
        if (this.isVoiceConfirmationPending) {
          this.cancelVoiceInput(true);
        }
        if (!this.isPttActive && formWizard.isOpen() && formWizard.isVoiceActive()) {
          this.pttMode = "idle";
          formWizard.stopVoiceInput();
          return;
        }
        if (this.isPttActive && this.pttMode === "toggled") {
          this.pttSubmitAfterStop = false;
          this.stopPushToTalk();
          return;
        }
        if (!this.isPttActive) {
          this.pttMode = "holding";
          this.pttPressTimestamp = Date.now();
          this.pttSubmitAfterStop = false;
          this.startPushToTalk(true);
        }
      } else if (this.isPttActive && this.pttMode === "toggled") {
        if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          e.stopPropagation();
          this.pttSubmitAfterStop = !formWizard.isOpen();
          this.stopPushToTalk();
        }
      }
    }, true);
    window.addEventListener("keyup", (e) => {
      if (this.isPttActive && this.pttMode === "holding") {
        const isSKey = e.key === "s" || e.key === "S" || e.code === "KeyS";
        const isAltKey = e.key === "Alt" || !e.altKey;
        if (isSKey || isAltKey) {
          e.preventDefault();
          e.stopPropagation();
          if (this.pttKeyupDebounceTimer) {
            clearTimeout(this.pttKeyupDebounceTimer);
          }
          this.pttKeyupDebounceTimer = setTimeout(() => {
            this.pttKeyupDebounceTimer = null;
            if (!this.isPttActive || this.pttMode !== "holding")
              return;
            const holdDuration = Date.now() - this.pttPressTimestamp;
            if (holdDuration < 300) {
              this.pttMode = "toggled";
              this.showPttToast("Mendengarkan... Tekan Alt+S lagi untuk selesai, atau Enter untuk kirim.", false);
              chatPanel.setListeningState(true, "Mendengarkan... Tekan Alt+S lagi untuk selesai.");
            } else {
              this.pttSubmitAfterStop = false;
              this.stopPushToTalk();
            }
          }, 120);
        }
      }
    }, true);
    window.addEventListener("blur", () => {
      if (this.isPttActive) {
        this.stopPushToTalk();
      }
    });
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.action === "TOGGLE_VOICE_SHORTCUT") {
          this.toggleVoiceAssistantShortcut();
          sendResponse?.({ status: "ok" });
        }
        return false;
      });
    }
    ttsService.onEnd(() => {
      if (this.currentSettings?.voiceOnlyMode && !formWizard.isOpen() && !this.isVoiceConfirmationPending) {
        this.listenInVoiceOnlyMode();
      }
    });
  }
  async injectStyles() {
    if (!this.shadowRoot)
      return;
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
        const styleEl = document.createElement("link");
        styleEl.rel = "stylesheet";
        styleEl.href = chrome.runtime.getURL("content/content_style.css");
        this.shadowRoot.appendChild(styleEl);
      }
    } catch (e) {
      console.warn("[AIRA] Stylesheet URL retrieval error:", e);
    }
    const inlineStyle = document.createElement("style");
    inlineStyle.textContent = `
      :host { position: relative; z-index: 2147483640; }
    `;
    this.shadowRoot.appendChild(inlineStyle);
  }
  createFloatingTrigger() {
    if (!this.shadowRoot)
      return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "aira-trigger-btn";
    btn.setAttribute("aria-label", "Buka Asisten AIRA (Tekan Alt+A atau tahan Alt+S untuk bicara)");
    btn.title = "Buka Asisten AIRA (Alt+A) | Push to Talk (Alt+S)";
    btn.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
      <span>AIRA</span>
      <span class="aira-trigger-voice-badge" id="aira-badge-voice" style="display: none;">Suara</span>
    `;
    btn.addEventListener("click", () => {
      chatPanel.toggle();
    });
    this.shadowRoot.appendChild(btn);
  }
  applySettingsToUI(s) {
    if (!this.shadowHost || !s)
      return;
    soundEffects.setEnabled(s.soundCues);
    const fontScale = s.fontScale ?? (s.fontSize === "large" ? 125 : s.fontSize === "xlarge" ? 150 : 100);
    const controlScale = s.controlScale ?? (s.controlSize === "large" ? 125 : s.controlSize === "xlarge" ? 150 : 100);
    this.shadowHost.setAttribute("data-font-size", s.fontSize || "normal");
    this.shadowHost.setAttribute("data-control-size", s.controlSize || "default");
    this.shadowHost.setAttribute("data-high-contrast", String(s.highContrast));
    this.shadowHost.setAttribute("data-reduce-motion", String(s.reduceMotion));
    this.shadowHost.style.setProperty("--aira-font-scale", `${fontScale / 100}`);
    this.shadowHost.style.setProperty("--aira-control-scale", `${controlScale / 100}`);
    chatPanel.updateVoiceOnlyBadge(s.voiceOnlyMode);
    const voiceBadge = this.shadowRoot?.querySelector("#aira-badge-voice");
    if (voiceBadge) {
      voiceBadge.style.display = s.voiceOnlyMode ? "inline-flex" : "none";
    }
    hostAccessibilityEngine.apply(s);
  }
  announceScreenReader(message) {
    if (this.srAnnouncer) {
      this.srAnnouncer.textContent = "";
      setTimeout(() => {
        if (this.srAnnouncer)
          this.srAnnouncer.textContent = message;
      }, 50);
    }
  }
  async toggleVoiceOnlyMode() {
    if (!this.currentSettings)
      return;
    const next = !this.currentSettings.voiceOnlyMode;
    await storageManager.saveSettings({ voiceOnlyMode: next });
    const msg = next ? "Mode Suara Penuh (Voice Only) telah diaktifkan. Anda dapat berinteraksi sepenuhnya dengan suara tanpa mouse." : "Mode Suara Penuh dinonaktifkan.";
    this.announceScreenReader(msg);
    chatPanel.addMessage("system", msg, true);
    soundEffects.playStep();
  }
  toggleVoiceAssistantShortcut() {
    soundEffects.playStep();
    if (!chatPanel.isOpen()) {
      chatPanel.toggle(true);
    }
    this.toggleVoiceInput();
  }
  async toggleVoiceInput() {
    if (this.isPttActive || sttService.isListening() || formWizard.isVoiceActive()) {
      this.stopPushToTalk();
    } else {
      this.pttMode = "toggled";
      await this.startPushToTalk(false);
    }
  }
  stopListeningAll() {
    if (this.confirmTtsTimeout) {
      clearTimeout(this.confirmTtsTimeout);
      this.confirmTtsTimeout = null;
    }
    if (this.pttKeyupDebounceTimer) {
      clearTimeout(this.pttKeyupDebounceTimer);
      this.pttKeyupDebounceTimer = null;
    }
    if (this.pttSafetyMaxTimer) {
      clearTimeout(this.pttSafetyMaxTimer);
      this.pttSafetyMaxTimer = null;
    }
    this.pttMode = "idle";
    this.pttSubmitAfterStop = false;
    if (this.isVoiceConfirmationPending) {
      this.cancelVoiceInput(true);
    }
    this.isPttActive = false;
    this.hidePttToast();
    chatPanel.setListeningState(false);
    if (formWizard.isOpen() && formWizard.isVoiceActive()) {
      formWizard.stopVoiceInput();
    } else if (sttService.isListening()) {
      sttService.stopListening();
    }
  }
  showPttToast(text, isLiveText = false) {
    if (!this.shadowRoot)
      return;
    if (!this.pttToastEl) {
      this.pttToastEl = document.createElement("div");
      this.pttToastEl.className = "aira-ptt-badge";
      this.shadowRoot.appendChild(this.pttToastEl);
    }
    const htmlContent = isLiveText ? `<span>Mendengar:</span> <strong style="color: #60A5FA; margin-left: 6px;">"${text}"</strong>` : `<span>${text}</span>`;
    this.pttToastEl.innerHTML = `
      <div class="aira-ptt-dot"></div>
      <div class="aira-ptt-content">${htmlContent}</div>
    `;
    this.pttToastEl.style.display = "flex";
  }
  hidePttToast() {
    if (this.pttToastEl) {
      this.pttToastEl.style.display = "none";
    }
  }
  async startPushToTalk(isPureHold = true) {
    if (this.confirmTtsTimeout) {
      clearTimeout(this.confirmTtsTimeout);
      this.confirmTtsTimeout = null;
    }
    this.pttSubmitAfterStop = false;
    if (this.isPttActive)
      return;
    this.isPttActive = true;
    this.pttStartTime = Date.now();
    if (this.pttSafetyMaxTimer) {
      clearTimeout(this.pttSafetyMaxTimer);
      this.pttSafetyMaxTimer = null;
    }
    this.pttSafetyMaxTimer = setTimeout(() => {
      if (this.isPttActive) {
        this.stopPushToTalk();
      }
    }, 60000);
    ttsService.stop();
    if (sttService.isListening()) {
      sttService.stopListening();
      await new Promise((r) => setTimeout(r, 60));
    }
    if (formWizard.isOpen()) {
      const toastMsg2 = isPureHold ? "Mendengarkan isian formulir (Lepaskan Alt+S untuk mengirim)..." : "Mendengarkan isian formulir (Tekan Alt+S lagi untuk selesai)...";
      this.showPttToast(toastMsg2, false);
      this.announceScreenReader("Mendengarkan isian formulir. Silakan bicara.");
      chatPanel.setListeningState(true, "Mendengarkan isian formulir...");
      await formWizard.startVoiceInput();
      if (!formWizard.isVoiceActive()) {
        this.isPttActive = false;
        this.pttMode = "idle";
        if (this.pttSafetyMaxTimer) {
          clearTimeout(this.pttSafetyMaxTimer);
          this.pttSafetyMaxTimer = null;
        }
        this.hidePttToast();
        chatPanel.setListeningState(false);
      }
      return;
    }
    if (!chatPanel.isOpen()) {
      chatPanel.toggle(true);
    }
    const toastMsg = isPureHold ? "Mendengarkan ucapan... (Lepaskan Alt+S untuk mengirim)" : "Mendengarkan ucapan Anda... (Tekan Alt+S lagi untuk selesai)";
    this.showPttToast(toastMsg, false);
    this.announceScreenReader("Mendengarkan ucapan Anda. Silakan bicara.");
    chatPanel.setListeningState(true, "Mendengarkan ucapan Anda...");
    await sttService.startListening({
      manualStopOnly: true,
      onInterim: (text) => {
        chatPanel.setListeningState(true, text);
        this.showPttToast(text, true);
      },
      onFinal: (finalText) => {
        this.hidePttToast();
        chatPanel.setListeningState(false);
        this.isPttActive = false;
        this.pttMode = "idle";
        if (this.pttSafetyMaxTimer) {
          clearTimeout(this.pttSafetyMaxTimer);
          this.pttSafetyMaxTimer = null;
        }
        if (finalText && finalText.trim()) {
          const submitAfterStop = this.pttSubmitAfterStop;
          this.pttSubmitAfterStop = false;
          if (submitAfterStop) {
            soundEffects.playConfirmation();
            this.dispatchVoiceTranscript(finalText.trim(), "chat");
          } else {
            this.enterVoiceConfirmation(finalText.trim(), "chat");
          }
        }
      },
      onError: (err) => {
        this.hidePttToast();
        chatPanel.setListeningState(false);
        this.isPttActive = false;
        this.pttMode = "idle";
        this.pttSubmitAfterStop = false;
        if (this.pttSafetyMaxTimer) {
          clearTimeout(this.pttSafetyMaxTimer);
          this.pttSafetyMaxTimer = null;
        }
        console.warn("[AIRA PTT] Listening error:", err);
      }
    });
  }
  stopPushToTalk() {
    if (this.pttKeyupDebounceTimer) {
      clearTimeout(this.pttKeyupDebounceTimer);
      this.pttKeyupDebounceTimer = null;
    }
    if (this.pttSafetyMaxTimer) {
      clearTimeout(this.pttSafetyMaxTimer);
      this.pttSafetyMaxTimer = null;
    }
    this.pttMode = "idle";
    const wizardVoiceActive = formWizard.isOpen() && formWizard.isVoiceActive();
    const genericSttActive = sttService.isListening() && !wizardVoiceActive;
    if (!this.isPttActive && !wizardVoiceActive && !genericSttActive)
      return;
    this.isPttActive = false;
    this.hidePttToast();
    chatPanel.setListeningState(false);
    if (wizardVoiceActive) {
      formWizard.stopVoiceInput();
    } else if (genericSttActive || this.isPttActive) {
      sttService.stopListening();
    }
  }
  dispatchVoiceTranscript(transcript, target) {
    const value = transcript.trim();
    if (!value)
      return;
    if (target === "chat") {
      chatPanel.clearInput();
      chatPanel.addMessage("user", value, false);
      this.handleUserMessage(value);
    } else {
      formWizard.commitVoiceAnswer(value);
    }
  }
  async listenInVoiceOnlyMode() {
    if (sttService.isListening() || formWizard.isOpen())
      return;
    chatPanel.setListeningState(true, "Mode suara penuh: Mendengarkan perintah...");
    await sttService.startListening({
      manualStopOnly: false,
      onInterim: (text) => {
        chatPanel.setListeningState(true, text);
      },
      onFinal: (finalText) => {
        chatPanel.setListeningState(false);
        if (finalText && finalText.trim()) {
          this.enterVoiceConfirmation(finalText.trim(), "chat");
        }
      },
      onError: (err) => {
        chatPanel.setListeningState(false);
        console.warn("[AIRA Voice] Listening error:", err);
      }
    });
  }
  enterVoiceConfirmation(transcript, target = "chat") {
    if (!transcript || !transcript.trim())
      return;
    if (this.confirmTtsTimeout) {
      clearTimeout(this.confirmTtsTimeout);
      this.confirmTtsTimeout = null;
    }
    this.isVoiceConfirmationPending = true;
    this.pendingVoiceTranscript = transcript.trim();
    this.pendingVoiceTarget = target;
    this.renderVoiceConfirmCard(this.pendingVoiceTranscript);
    const promptText = `Anda mengatakan: "${this.pendingVoiceTranscript}". Tekan Enter untuk mengirim, atau tekan Escape untuk membatalkan.`;
    this.announceScreenReader(promptText);
    ttsService.stop();
    const spokenPrompt = `Anda... mengatakan, ${this.pendingVoiceTranscript}. Tekan Enter untuk mengirim, atau tekan Escape untuk membatalkan.`;
    this.confirmTtsTimeout = setTimeout(() => {
      this.confirmTtsTimeout = null;
      if (this.isVoiceConfirmationPending) {
        ttsService.speak(spokenPrompt);
      }
    }, 350);
  }
  renderVoiceConfirmCard(text) {
    if (!this.shadowRoot)
      return;
    if (!this.confirmCardEl) {
      this.confirmCardEl = document.createElement("div");
      this.confirmCardEl.className = "aira-voice-confirm-card";
      this.confirmCardEl.setAttribute("role", "alertdialog");
      this.confirmCardEl.setAttribute("aria-modal", "true");
      this.confirmCardEl.setAttribute("aria-label", "Konfirmasi Suara AIRA");
      this.shadowRoot.appendChild(this.confirmCardEl);
    }
    this.confirmCardEl.innerHTML = `
      <div class="aira-confirm-header">
        <div class="aira-confirm-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <span>Konfirmasi Suara</span>
        </div>
        <div class="aira-confirm-speaking-indicator">
          <span>Membacakan ulang...</span>
        </div>
      </div>
      <div class="aira-confirm-text-box">
        "${text}"
      </div>
      <div class="aira-confirm-prompt">
        Tekan <kbd class="aira-kbd-hint">Enter</kbd> untuk mengirim, atau <kbd class="aira-kbd-hint">Esc</kbd> untuk membatalkan.
      </div>
      <div class="aira-confirm-actions">
        <button type="button" class="aira-confirm-btn aira-confirm-btn-cancel" id="aira-btn-confirm-cancel" title="Batalkan (Esc)">
          <span>✕ Batal</span>
          <kbd class="aira-kbd-hint">Esc</kbd>
        </button>
        <button type="button" class="aira-confirm-btn aira-confirm-btn-primary" id="aira-btn-confirm-send" title="Kirim (Enter)">
          <span>✓ Kirim</span>
          <kbd class="aira-kbd-hint">Enter</kbd>
        </button>
      </div>
    `;
    const cancelBtn = this.confirmCardEl.querySelector("#aira-btn-confirm-cancel");
    const sendBtn = this.confirmCardEl.querySelector("#aira-btn-confirm-send");
    cancelBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.cancelVoiceInput();
    });
    sendBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.confirmVoiceInput();
    });
    this.confirmCardEl.style.display = "flex";
  }
  hideVoiceConfirmCard() {
    if (this.confirmCardEl) {
      this.confirmCardEl.style.display = "none";
    }
  }
  confirmVoiceInput() {
    if (this.confirmTtsTimeout) {
      clearTimeout(this.confirmTtsTimeout);
      this.confirmTtsTimeout = null;
    }
    if (!this.isVoiceConfirmationPending)
      return;
    const transcript = this.pendingVoiceTranscript;
    const target = this.pendingVoiceTarget;
    this.isVoiceConfirmationPending = false;
    this.pendingVoiceTranscript = "";
    this.hideVoiceConfirmCard();
    ttsService.stop();
    soundEffects.playConfirmation();
    if (!transcript)
      return;
    this.dispatchVoiceTranscript(transcript, target);
  }
  cancelVoiceInput(silent = false) {
    if (this.confirmTtsTimeout) {
      clearTimeout(this.confirmTtsTimeout);
      this.confirmTtsTimeout = null;
    }
    if (!this.isVoiceConfirmationPending)
      return;
    this.isVoiceConfirmationPending = false;
    this.pendingVoiceTranscript = "";
    this.hideVoiceConfirmCard();
    chatPanel.clearInput();
    ttsService.stop();
    if (!silent) {
      soundEffects.playStep();
      this.announceScreenReader("Input suara dibatalkan.");
      chatPanel.addMessage("system", "Input suara dibatalkan.", false);
    }
  }
  async handleUserMessage(userInput) {
    this.announceScreenReader(`Memproses: ${userInput}`);
    const lower = userInput.toLowerCase();
    if (formWizard.isOpen() && (lower.includes("kirim") || lower.includes("submit") || lower.includes("selesai"))) {
      const submitRes = formOrchestrator.submitHostForm();
      formWizard.close();
      const finishMsg = submitRes.success ? "Pengajuan formulir berhasil dikirimkan ke portal!" : submitRes.message;
      chatPanel.addMessage("assistant", finishMsg, true);
      this.announceScreenReader(finishMsg);
      return;
    }
    const prunedContext = domPruner.getPrunedContextForLLM();
    const intentResult = await llmService.processUserIntent(userInput, prunedContext);
    switch (intentResult.intent) {
      case "SUMMARIZE": {
        const summary = await llmService.summarizePage(prunedContext);
        chatPanel.addMessage("assistant", summary, true);
        this.announceScreenReader(summary);
        break;
      }
      case "NAVIGATE": {
        if (intentResult.targetId) {
          const targetEl = domPruner.getElement(intentResult.targetId);
          if (targetEl) {
            spotlightManager.show(targetEl, intentResult.explanation, () => {
              chatPanel.addMessage("system", `Tombol "${intentResult.actionName}" berhasil ditekan.`, false);
            }, () => {
              chatPanel.addMessage("system", "Navigasi dibatalkan.", false);
            });
            chatPanel.addMessage("assistant", intentResult.explanation, true);
            this.announceScreenReader(intentResult.explanation);
            return;
          }
        }
        chatPanel.addMessage("assistant", intentResult.explanation || "Saya tidak menemukan elemen tersebut di halaman.", true);
        break;
      }
      case "FILL_FORM": {
        if (prunedContext.data.forms.length > 0) {
          const form = prunedContext.data.forms[0];
          if (!chatPanel.isOpen()) {
            chatPanel.toggle(true);
          }
          formWizard.open(form);
          const startMsg = `Formulir "${form.title}" ditemukan dengan ${form.fields.length} kolom pertanyaan. Mari kita mulai!`;
          chatPanel.addMessage("assistant", startMsg, false);
          this.announceScreenReader(startMsg);
        } else {
          chatPanel.addMessage("assistant", "Tidak ada formulir isian yang terdeteksi pada halaman ini.", true);
        }
        break;
      }
      case "SETTINGS": {
        chatPanel.toggle(true);
        const settingsTab = this.shadowRoot?.querySelector("#aira-tab-settings");
        settingsTab?.click();
        chatPanel.addMessage("assistant", "Ini adalah tab pengaturan aksesibilitas AIRA.", true);
        break;
      }
      case "CHAT":
      default: {
        chatPanel.addMessage("assistant", intentResult.explanation, true);
        this.announceScreenReader(intentResult.explanation);
        break;
      }
    }
  }
}
var airaCoordinator = new AiraContentCoordinator;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => airaCoordinator.init());
} else {
  airaCoordinator.init();
}

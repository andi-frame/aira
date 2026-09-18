// src/shared/constants.ts
var DEFAULT_SETTINGS = {
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
  whisperEndpoint: "https://api.openai.com/v1/audio/transcriptions",
  whisperModel: "whisper-1",
  voiceOnlyMode: false,
  soundCues: true,
  autoRead: true,
  highContrast: false,
  fontSize: "normal",
  controlSize: "default",
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
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label && this.cleanText(label.textContent)) {
        return this.cleanText(label.textContent);
      }
    }
    const parentLabel = input.closest("label");
    if (parentLabel && this.cleanText(parentLabel.textContent)) {
      return this.cleanText(parentLabel.textContent);
    }
    if (input.getAttribute("aria-label")) {
      return this.cleanText(input.getAttribute("aria-label"));
    }
    if (input.getAttribute("aria-labelledby")) {
      const ref = document.getElementById(input.getAttribute("aria-labelledby") || "");
      if (ref && this.cleanText(ref.textContent)) {
        return this.cleanText(ref.textContent);
      }
    }
    if ("placeholder" in input && input.placeholder) {
      return this.cleanText(input.placeholder);
    }
    const prev = input.previousElementSibling;
    if (prev && this.cleanText(prev.textContent).length < 50) {
      return this.cleanText(prev.textContent);
    }
    return input.name || input.id || "Kolom Isian";
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
    this.notifyEnd();
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
    this.stop();
    if (!text || !text.trim())
      return;
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
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = settings.ttsVoiceLang || "id-ID";
    utterance.rate = settings.ttsRate || 1;
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
  onInterimCallback = null;
  onFinalCallback = null;
  onErrorCallback = null;
  mediaStream = null;
  mediaRecorder = null;
  recordedAudioChunks = [];
  constructor() {
    this.initRecognition();
  }
  initRecognition() {
    if (typeof window === "undefined")
      return;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn("[AIRA STT] SpeechRecognition not supported in this browser.");
      return;
    }
    this.recognition = new SpeechRec;
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = "id-ID";
    this.recognition.onstart = () => {
      this.isListeningFlag = true;
      soundEffects.playListenStart();
    };
    this.recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";
      for (let i = event.resultIndex;i < event.results.length; ++i) {
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
    this.recognition.onerror = (event) => {
      console.warn("[AIRA STT] WebSpeech error:", event.error);
      this.isListeningFlag = false;
      if (this.onErrorCallback) {
        this.onErrorCallback(event.error);
      }
    };
    this.recognition.onend = () => {
      this.isListeningFlag = false;
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
    if (this.isListeningFlag) {
      this.stopListening();
    }
    if (settings.sttProvider === "whisper" && settings.whisperApiKey) {
      return this.startWhisperRecording(settings);
    }
    return this.startWebSpeechListening();
  }
  startWebSpeechListening() {
    if (!this.recognition) {
      this.initRecognition();
      if (!this.recognition) {
        if (this.onErrorCallback)
          this.onErrorCallback("Browser tidak mendukung Speech Recognition.");
        return false;
      }
    }
    try {
      this.recognition.start();
      return true;
    } catch (e) {
      console.warn("[AIRA STT] WebSpeech start failed:", e);
      return false;
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
    const endpoint = settings.whisperEndpoint || "https://api.openai.com/v1/audio/transcriptions";
    const formData = new FormData;
    formData.append("file", audioBlob, "audio.webm");
    formData.append("model", settings.whisperModel || "whisper-1");
    formData.append("language", "id");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.whisperApiKey}`
        },
        body: formData
      });
      if (!response.ok) {
        throw new Error(`Whisper API HTTP ${response.status}`);
      }
      const data = await response.json();
      const text = (data.text || "").trim();
      soundEffects.playListenStop();
      if (this.onFinalCallback && text) {
        this.onFinalCallback(text);
      }
    } catch (e) {
      console.warn("[AIRA Whisper] Transcription failed, fallback error:", e);
      if (this.onErrorCallback) {
        this.onErrorCallback("Gagal mentranskripsi suara dengan Whisper API.");
      }
    }
  }
  stopListening() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
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
  syncToHostDOM() {
    if (!this.activeForm)
      return false;
    let anySynced = false;
    for (const field of this.activeForm.fields) {
      const val = this.answers[field.id];
      if (val === undefined)
        continue;
      const el = domPruner.getElement(field.id);
      if (el) {
        try {
          el.focus();
          el.value = val;
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
    if (settings.highContrast) {
      cssRules.push(`
        /* AIRA High Contrast Host Adaptations */
        html, body {
          background-color: #000000 !important;
          color: #FFE600 !important;
          border-color: #FFE600 !important;
        }

        /* Headings & Text */
        p, span, h1, h2, h3, h4, h5, h6, li, dt, dd, td, th, label, small, strong, em, b, i, blockquote {
          color: #FFE600 !important;
          text-shadow: none !important;
        }

        /* Structural Containers */
        header, nav, main, footer, section, article, aside, .card, .container, table, form {
          background-color: #070707 !important;
          border-color: #FFE600 !important;
        }

        /* Interactive Buttons & Action Links */
        a, button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"] {
          background-color: #FFE600 !important;
          color: #000000 !important;
          border: 2px solid #FFE600 !important;
          font-weight: 800 !important;
          text-decoration: none !important;
        }

        a:hover, button:hover, [role="button"]:hover {
          background-color: #FFFF55 !important;
          color: #000000 !important;
        }

        /* Focus Ring */
        a:focus, button:focus, [role="button"]:focus, input:focus, select:focus, textarea:focus {
          outline: 4px solid #FFFFFF !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px #000000 !important;
        }

        /* Form Controls */
        input:not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea {
          background-color: #000000 !important;
          color: #FFE600 !important;
          border: 2px solid #FFE600 !important;
        }

        /* Media */
        img, video {
          filter: contrast(115%) brightness(95%);
        }
      `);
    }
    if (settings.fontSize === "large") {
      cssRules.push(`
        html {
          font-size: 118% !important;
        }
        body, p, span, li, a, label, input, select, textarea, td, th {
          font-size: 1.15em !important;
          line-height: 1.65 !important;
        }
        h1 { font-size: 2.2em !important; line-height: 1.3 !important; }
        h2 { font-size: 1.8em !important; line-height: 1.3 !important; }
        h3 { font-size: 1.5em !important; line-height: 1.3 !important; }
      `);
    } else if (settings.fontSize === "xlarge") {
      cssRules.push(`
        html {
          font-size: 135% !important;
        }
        body, p, span, li, a, label, input, select, textarea, td, th {
          font-size: 1.3em !important;
          line-height: 1.8 !important;
          letter-spacing: 0.02em !important;
        }
        h1 { font-size: 2.6em !important; line-height: 1.3 !important; }
        h2 { font-size: 2.1em !important; line-height: 1.3 !important; }
        h3 { font-size: 1.7em !important; line-height: 1.3 !important; }
      `);
    }
    if (settings.controlSize === "large") {
      cssRules.push(`
        button, a[role="button"], input[type="button"], input[type="submit"], input[type="reset"],
        input:not([type="checkbox"]):not([type="radio"]), select, textarea {
          min-height: 52px !important;
          padding-top: 10px !important;
          padding-bottom: 10px !important;
        }
      `);
    } else if (settings.controlSize === "xlarge") {
      cssRules.push(`
        button, a[role="button"], input[type="button"], input[type="submit"], input[type="reset"],
        input:not([type="checkbox"]):not([type="radio"]), select, textarea {
          min-height: 64px !important;
          padding-top: 14px !important;
          padding-bottom: 14px !important;
          margin-top: 6px !important;
          margin-bottom: 6px !important;
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
          <div style="font-size: 0.8em; color: var(--aira-text-muted);">Kontrol seluruh web hanya lewat suara tanpa mouse (Alt+A)</div>
        </div>
        <input type="checkbox" id="aira-set-voiceonly" style="width: 20px; height: 20px;" ${s.voiceOnlyMode ? "checked" : ""} />
      </div>

      <!-- STT Provider (Item 5) -->
      <div style="border: 1px solid var(--aira-border); padding: 14px; border-radius: var(--aira-radius-md); display: flex; flex-direction: column; gap: 10px;">
        <div style="font-weight: 700; color: var(--aira-primary);">\uD83C\uDF99️ Pengenalan Suara (STT)</div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size: 0.8em; font-weight: 600;">Penyedia Pengenalan Suara:</label>
          <select id="aira-set-sttprovider" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;">
            <option value="webspeech" ${s.sttProvider === "webspeech" ? "selected" : ""}>Google Web Speech API Chrome (Default Cepat)</option>
            <option value="whisper" ${s.sttProvider === "whisper" ? "selected" : ""}>OpenAI Whisper API</option>
          </select>
        </div>

        <div id="aira-whisper-fields" style="display: ${s.sttProvider === "whisper" ? "flex" : "none"}; flex-direction: column; gap: 8px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.8em; font-weight: 600;">Whisper API Key:</label>
            <input type="password" id="aira-set-whisperkey" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.whisperApiKey || ""}" placeholder="sk-..." />
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 0.8em; font-weight: 600;">Whisper Endpoint:</label>
            <input type="text" id="aira-set-whisperendpoint" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.85em;" value="${s.whisperEndpoint || "https://api.openai.com/v1/audio/transcriptions"}" />
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

        <!-- Font Size -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="font-weight: 600; font-size: 0.9em;">Ukuran Teks Halaman Web:</div>
          <select id="aira-set-fontsize" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.9em;">
            <option value="normal" ${s.fontSize === "normal" ? "selected" : ""}>Normal (100%)</option>
            <option value="large" ${s.fontSize === "large" ? "selected" : ""}>Lansia / Besar (125%)</option>
            <option value="xlarge" ${s.fontSize === "xlarge" ? "selected" : ""}>Ekstra Besar (150%)</option>
          </select>
        </div>

        <!-- Control Size -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="font-weight: 600; font-size: 0.9em;">Ukuran Tombol & Input Web:</div>
          <select id="aira-set-ctrlsize" class="aira-wizard-input" style="min-height: 38px; padding: 6px 10px; font-size: 0.9em;">
            <option value="default" ${s.controlSize === "default" ? "selected" : ""}>Standar (44px)</option>
            <option value="large" ${s.controlSize === "large" ? "selected" : ""}>Lansia (52px)</option>
            <option value="xlarge" ${s.controlSize === "xlarge" ? "selected" : ""}>Ramah Motorik (64px)</option>
          </select>
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
      const fontSize = wrap.querySelector("#aira-set-fontsize").value;
      const controlSize = wrap.querySelector("#aira-set-ctrlsize").value;
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
    const font = q("#aira-set-fontsize");
    if (font)
      font.value = s.fontSize;
    const ctrl = q("#aira-set-ctrlsize");
    if (ctrl)
      ctrl.value = s.controlSize;
    const motion = q("#aira-set-motion");
    if (motion)
      motion.checked = s.reduceMotion;
    const stt = q("#aira-set-sttprovider");
    if (stt)
      stt.value = s.sttProvider;
    const whKey = q("#aira-set-whisperkey");
    if (whKey)
      whKey.value = s.whisperApiKey;
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
  init(container, onSendMessage, onToggleVoiceOnly) {
    this.container = container;
    this.onSendMessageCallback = onSendMessage;
    this.onToggleVoiceOnlyCallback = onToggleVoiceOnly;
    this.render();
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
  setLiveTranscription(text, isFinal = false) {
    const bar = this.drawerEl?.querySelector("#aira-live-stt-bar");
    const textSpan = this.drawerEl?.querySelector("#aira-live-stt-text");
    if (!bar || !textSpan)
      return;
    if (text) {
      bar.style.display = "flex";
      textSpan.innerText = text;
    } else {
      bar.style.display = "none";
      textSpan.innerText = "";
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
          <button type="button" class="aira-icon-btn" id="aira-btn-toggle-voiceonly" title="Toggle Mode Suara Penuh (Alt+A)" aria-label="Toggle Voice Only">
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
            <button type="button" class="aira-mic-btn" id="aira-mic-btn" title="Bicara (Tekan dan Ucapkan)">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </button>
            <input 
              type="text" 
              class="aira-text-input" 
              id="aira-chat-text-input" 
              placeholder="Tanyakan atau instruksikan AIRA..." 
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
    this.addMessage("assistant", "Halo! Saya AIRA, asisten adaptif Anda. Saya siap membantu Anda memahami informasi halaman, mencari menu layanan, dan memandu pengisian formulir online.", false);
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
      if (sttService.isListening()) {
        sttService.stopListening();
        micBtn.classList.remove("aira-listening");
        this.setLiveTranscription("");
      } else {
        micBtn.classList.add("aira-listening");
        this.setLiveTranscription("Mendengarkan ucapan Anda...");
        sttService.startListening({
          onInterim: (text) => {
            this.setLiveTranscription(text, false);
          },
          onFinal: (finalText) => {
            micBtn.classList.remove("aira-listening");
            this.setLiveTranscription("");
            this.addMessage("user", finalText, false);
            if (this.onSendMessageCallback) {
              this.onSendMessageCallback(finalText);
            }
          },
          onError: (err) => {
            micBtn.classList.remove("aira-listening");
            this.setLiveTranscription("");
            this.addMessage("system", `Peringatan mikrofon: ${err}`, false);
          }
        });
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
  escKeyListener = null;
  isProcessingVoiceInput = false;
  init(container, onInteraction) {
    this.container = container;
    this.onInteractionCallback = onInteraction;
    formOrchestrator.onStateChange((state) => {
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
  open(form) {
    formOrchestrator.startForm(form);
  }
  close() {
    this.isProcessingVoiceInput = false;
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
  async render(state) {
    if (!this.container)
      return;
    this.destroy();
    const overlay = document.createElement("div");
    overlay.className = "aira-modal-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });
    if (state.isComplete) {
      this.renderSummaryView(overlay, state);
    } else {
      await this.renderStepView(overlay, state);
    }
    this.modalEl = overlay;
    this.container.appendChild(overlay);
  }
  async renderStepView(overlay, state) {
    const field = state.currentField;
    const stepNum = state.currentStepIndex + 1;
    const progressPercent = Math.round(stepNum / state.totalSteps * 100);
    const hint = field.hint || await llmService.explainFormField(field);
    const card = document.createElement("div");
    card.className = "aira-wizard-card";
    card.innerHTML = `
      <div class="aira-wizard-header">
        <div class="aira-brand">
          <span class="aira-brand-title">AIRA</span>
          <span class="aira-brand-badge">${state.formTitle}</span>
        </div>
        <button type="button" class="aira-icon-btn aira-close-wizard" title="Tutup Formulir (Esc)" aria-label="Tutup Formulir">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="aira-wizard-step-info">
        <span>Langkah ${stepNum} dari ${state.totalSteps}</span>
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
            value="${state.answers[field.id] || ""}"
            autocomplete="off"
          />
        </div>

        <button type="button" class="aira-big-voice-btn" id="aira-wizard-voice-btn">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          <span class="aira-voice-btn-text">Berikan pesan dengan suara</span>
        </button>
      </div>

      <div class="aira-wizard-footer">
        <button type="button" class="aira-btn aira-btn-outline" id="aira-wizard-prev" ${stepNum === 1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ""}>
          &lt; Kembali
        </button>
        <button type="button" class="aira-btn aira-btn-primary" id="aira-wizard-next">
          Lanjut ke ${stepNum < state.totalSteps ? `Langkah ${stepNum + 1}` : "Rangkuman"} &gt;
        </button>
      </div>
    `;
    overlay.appendChild(card);
    const promptText = `Langkah ${stepNum}. Masukkan ${field.label} Anda. ${hint}`;
    ttsService.speak(promptText);
    if (this.onInteractionCallback) {
      this.onInteractionCallback(promptText);
    }
    const inputEl = card.querySelector("#aira-step-input");
    const voiceBtn = card.querySelector("#aira-wizard-voice-btn");
    const voiceText = voiceBtn.querySelector(".aira-voice-btn-text");
    const errorSlot = card.querySelector("#aira-wizard-error-slot");
    setTimeout(() => inputEl.focus(), 150);
    card.querySelector(".aira-read-aloud-btn")?.addEventListener("click", () => {
      ttsService.speak(promptText);
    });
    card.querySelector(".aira-close-wizard")?.addEventListener("click", () => {
      this.close();
    });
    voiceBtn.addEventListener("click", async () => {
      if (sttService.isListening()) {
        sttService.stopListening();
        voiceBtn.classList.remove("aira-listening");
        voiceText.innerText = "Berikan pesan dengan suara";
      } else {
        voiceBtn.classList.add("aira-listening");
        voiceText.innerText = "Mendengarkan... (Silakan bicara)";
        errorSlot.innerHTML = "";
        this.isProcessingVoiceInput = true;
        await sttService.startListening({
          onInterim: (interim) => {
            inputEl.value = interim;
            voiceText.innerText = `Mendengarkan: "${interim}"`;
          },
          onFinal: (finalText) => {
            inputEl.value = finalText;
            voiceBtn.classList.remove("aira-listening");
            voiceText.innerText = "Berikan pesan dengan suara";
            this.isProcessingVoiceInput = false;
            const advRes = formOrchestrator.saveAndAdvance(field.id, finalText);
            if (!advRes.success) {
              this.showError(errorSlot, inputEl, advRes.error || "Format tidak valid");
              ttsService.speak(`Periksa kembali isian Anda. ${advRes.error}`);
            } else {
              this.clearError(errorSlot, inputEl);
              if (this.onInteractionCallback) {
                this.onInteractionCallback(`Jawaban ${field.label}: ${finalText}`);
              }
            }
          },
          onError: (err) => {
            this.isProcessingVoiceInput = false;
            voiceBtn.classList.remove("aira-listening");
            voiceText.innerText = "Coba lagi";
          }
        });
      }
    });
    card.querySelector("#aira-wizard-next")?.addEventListener("click", () => {
      const val = inputEl.value;
      const advRes = formOrchestrator.saveAndAdvance(field.id, val);
      if (!advRes.success) {
        this.showError(errorSlot, inputEl, advRes.error || "Format tidak valid");
        ttsService.speak(advRes.error || "Format tidak valid");
      } else {
        this.clearError(errorSlot, inputEl);
        if (this.onInteractionCallback) {
          this.onInteractionCallback(`Jawaban ${field.label}: ${val}`);
        }
      }
    });
    card.querySelector("#aira-wizard-prev")?.addEventListener("click", () => {
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
  renderSummaryView(overlay, state) {
    const card = document.createElement("div");
    card.className = "aira-wizard-card";
    let summaryItemsHtml = "";
    const entries = Object.entries(state.answers);
    entries.forEach(([fieldId, val]) => {
      const field = formOrchestrator["activeForm"]?.fields.find((f) => f.id === fieldId);
      const label = field ? field.label : fieldId;
      const idx = formOrchestrator["activeForm"]?.fields.findIndex((f) => f.id === fieldId) ?? 0;
      summaryItemsHtml += `
        <div class="aira-summary-item">
          <div class="aira-summary-info">
            <span class="aira-summary-label">${label}</span>
            <span class="aira-summary-val">${val || "-"}</span>
          </div>
          <button type="button" class="aira-summary-edit-btn" data-step="${idx}">
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
    ttsService.speak(summarySpeech);
    if (this.onInteractionCallback) {
      this.onInteractionCallback(summarySpeech);
    }
    card.querySelector("#aira-summary-read")?.addEventListener("click", () => {
      ttsService.speak(summarySpeech);
    });
    card.querySelector(".aira-close-wizard")?.addEventListener("click", () => {
      this.close();
    });
    card.querySelector("#aira-summary-back")?.addEventListener("click", () => {
      formOrchestrator.goToStep(state.totalSteps - 1);
    });
    card.querySelectorAll(".aira-summary-edit-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const step = parseInt(e.currentTarget.getAttribute("data-step") || "0", 10);
        formOrchestrator.goToStep(step);
      });
    });
    card.querySelector("#aira-summary-submit")?.addEventListener("click", () => {
      const submitRes = formOrchestrator.submitHostForm();
      this.close();
      const successMsg = submitRes.success ? "Data formulir berhasil diisi dan dikirimkan secara langsung ke portal!" : submitRes.message;
      ttsService.speak(successMsg);
      if (this.onInteractionCallback) {
        this.onInteractionCallback(successMsg);
      }
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
  async init() {
    if (document.getElementById("aira-root"))
      return;
    this.currentSettings = await storageManager.getSettings();
    this.shadowHost = document.createElement("div");
    this.shadowHost.id = "aira-root";
    this.shadowRoot = this.shadowHost.attachShadow({ mode: "open" });
    document.body.appendChild(this.shadowHost);
    await this.injectStyles();
    this.srAnnouncer = document.createElement("div");
    this.srAnnouncer.className = "aira-sr-only";
    this.srAnnouncer.setAttribute("aria-live", "assertive");
    this.shadowRoot.appendChild(this.srAnnouncer);
    this.createFloatingTrigger();
    spotlightManager.init(this.shadowRoot);
    chatPanel.init(this.shadowRoot, (userText) => this.handleUserMessage(userText), () => this.toggleVoiceOnlyMode());
    formWizard.init(this.shadowRoot, (prompt, answer) => {
      chatPanel.addMessage("assistant", prompt, false);
      if (answer) {
        chatPanel.addMessage("user", answer, false);
      }
    });
    this.applySettingsToUI(this.currentSettings);
    storageManager.subscribe((newSettings) => {
      this.currentSettings = newSettings;
      this.applySettingsToUI(newSettings);
    });
    window.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        this.toggleVoiceAssistantShortcut();
      }
    });
    ttsService.onEnd(() => {
      if (this.currentSettings?.voiceOnlyMode && !formWizard.isOpen()) {
        this.listenInVoiceOnlyMode();
      }
    });
  }
  async injectStyles() {
    if (!this.shadowRoot)
      return;
    const styleEl = document.createElement("link");
    styleEl.rel = "stylesheet";
    styleEl.href = chrome.runtime.getURL("content/content_style.css");
    this.shadowRoot.appendChild(styleEl);
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
    btn.setAttribute("aria-label", "Buka Asisten AIRA (Tekan Alt+A)");
    btn.title = "Buka Asisten AIRA (Alt+A)";
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
    if (!this.shadowHost)
      return;
    soundEffects.setEnabled(s.soundCues);
    this.shadowHost.setAttribute("data-font-size", s.fontSize);
    this.shadowHost.setAttribute("data-control-size", s.controlSize);
    this.shadowHost.setAttribute("data-high-contrast", String(s.highContrast));
    this.shadowHost.setAttribute("data-reduce-motion", String(s.reduceMotion));
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
    this.listenInVoiceOnlyMode();
  }
  async listenInVoiceOnlyMode() {
    if (sttService.isListening() || formWizard.isOpen())
      return;
    chatPanel.setLiveTranscription("Mendengarkan ucapan Anda...");
    await sttService.startListening({
      onInterim: (text) => {
        chatPanel.setLiveTranscription(text);
      },
      onFinal: (finalText) => {
        chatPanel.setLiveTranscription("");
        chatPanel.addMessage("user", finalText, false);
        this.handleUserMessage(finalText);
      },
      onError: (err) => {
        chatPanel.setLiveTranscription("");
        console.warn("[AIRA Voice] Listening error:", err);
      }
    });
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

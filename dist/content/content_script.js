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

// src/services/google_forms_parser.ts
var TYPE_CODE_MAP = {
  0: "short_answer",
  1: "paragraph",
  2: "multiple_choice",
  3: "dropdown",
  4: "checkboxes",
  5: "linear_scale",
  9: "date",
  10: "time",
  13: "file_upload",
  18: "rating"
};
var UNRECOGNIZED_TYPE_DIAGNOSTIC = "Unrecognized FB_PUBLIC_LOAD_DATA_ question type code";
var GRID_DISCRIMINATOR_DIAGNOSTIC = "Grid subtype discriminator missing or inconsistent";
var GRID_DOM_CONFLICT_DIAGNOSTIC = "Structural conflict: payload grid discriminator disagrees with DOM control roles";
function normalizeRequired(raw) {
  if (raw === 1 || raw === true)
    return true;
  if (raw === 0 || raw === false)
    return false;
  return false;
}
function toEntryId(raw) {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}
function toEntryKey(entryId) {
  return entryId === null ? null : `entry.${entryId}`;
}
function extractBalancedArray(source, startIndex) {
  if (source[startIndex] !== "[")
    return null;
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (let i = startIndex;i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) {
        return { raw: source.slice(startIndex, i + 1), endIndex: i };
      }
    }
  }
  return null;
}
function sanitizeSparseArray(raw) {
  let result = "";
  let inString = null;
  let escaped = false;
  let prev = "";
  for (let i = 0;i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      result += ch;
      prev = ch;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === `
`) {
      result += ch;
      continue;
    }
    if (ch === ",") {
      if (prev === "[" || prev === ",") {
        result += "null,";
      } else {
        result += ",";
      }
      prev = ",";
      continue;
    }
    if (ch === "]") {
      if (prev === "[" || prev === ",") {
        result += "null]";
      } else {
        result += "]";
      }
      prev = "]";
      continue;
    }
    result += ch;
    prev = ch;
  }
  return result;
}
function extractPublicLoadData(source) {
  const marker = "FB_PUBLIC_LOAD_DATA_";
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    return { value: null, raw: null, diagnostic: "FB_PUBLIC_LOAD_DATA_ not found" };
  }
  const equalsIndex = source.indexOf("=", markerIndex + marker.length);
  if (equalsIndex === -1) {
    return { value: null, raw: null, diagnostic: "FB_PUBLIC_LOAD_DATA_ assignment not found" };
  }
  const arrayStart = source.indexOf("[", equalsIndex + 1);
  if (arrayStart === -1) {
    return { value: null, raw: null, diagnostic: "FB_PUBLIC_LOAD_DATA_ array not found" };
  }
  const extracted = extractBalancedArray(source, arrayStart);
  if (!extracted) {
    return { value: null, raw: null, diagnostic: "FB_PUBLIC_LOAD_DATA_ array is not balanced" };
  }
  try {
    const sanitized = sanitizeSparseArray(extracted.raw);
    const parsed = JSON.parse(sanitized);
    if (!Array.isArray(parsed)) {
      return { value: null, raw: extracted.raw, diagnostic: "FB_PUBLIC_LOAD_DATA_ is not an array" };
    }
    return { value: parsed, raw: extracted.raw, diagnostic: null };
  } catch (e) {
    return {
      value: null,
      raw: extracted.raw,
      diagnostic: "Failed to parse FB_PUBLIC_LOAD_DATA_ payload as JSON"
    };
  }
}
function extractQuestionItems(data) {
  const form = data[1];
  if (!Array.isArray(form))
    return null;
  const items = form[1];
  return Array.isArray(items) ? items : null;
}
function extractFormTitle(data) {
  const form = data[1];
  if (!Array.isArray(form))
    return null;
  const title = form[8];
  return typeof title === "string" && title.trim() ? title : null;
}
function isOtherOption(option, label) {
  if (label !== "")
    return false;
  return option.some((value, index) => {
    if (index === 0)
      return false;
    if (value === true || value === 1)
      return true;
    return Array.isArray(value) && value.length > 0 && (value[0] === 1 || value[0] === true);
  });
}
function parseOptions(rawChoices) {
  if (!Array.isArray(rawChoices))
    return { options: [], otherAllowed: false };
  const options = [];
  let otherAllowed = false;
  for (const rawOption of rawChoices) {
    if (!Array.isArray(rawOption))
      continue;
    const label = typeof rawOption[0] === "string" ? rawOption[0] : "";
    if (isOtherOption(rawOption, label)) {
      otherAllowed = true;
      continue;
    }
    if (label !== "")
      options.push(label);
  }
  return { options, otherAllowed };
}
function parseColumns(rawColumns) {
  if (!Array.isArray(rawColumns))
    return null;
  return rawColumns.map((column) => {
    if (Array.isArray(column) && typeof column[0] === "string")
      return column[0];
    return "";
  });
}
function parseGrid(entries) {
  const rows = [];
  const modes = [];
  let columns = null;
  for (const rawRow of entries) {
    if (!Array.isArray(rawRow))
      continue;
    const entryId = toEntryId(rawRow[0]);
    const required = normalizeRequired(rawRow[2]);
    const label = Array.isArray(rawRow[3]) && typeof rawRow[3][0] === "string" ? rawRow[3][0] : "";
    if (columns === null) {
      const parsedColumns = parseColumns(rawRow[1]);
      if (parsedColumns && parsedColumns.length)
        columns = parsedColumns;
    }
    const discriminator = Array.isArray(rawRow[11]) ? rawRow[11][0] : undefined;
    if (discriminator === 0 || discriminator === false)
      modes.push(0);
    else if (discriminator === 1 || discriminator === true)
      modes.push(1);
    if (entryId !== null) {
      rows.push({
        label,
        entry_id: entryId,
        entry_key: `entry.${entryId}`,
        required
      });
    }
  }
  if (rows.length === 0) {
    return { type: "grid_unknown", rows: [], columns, diagnostic: GRID_DISCRIMINATOR_DIAGNOSTIC };
  }
  if (modes.length > 0 && modes.every((mode) => mode === 0)) {
    return { type: "multiple_choice_grid", rows, columns, diagnostic: null };
  }
  if (modes.length > 0 && modes.every((mode) => mode === 1)) {
    return { type: "checkbox_grid", rows, columns, diagnostic: null };
  }
  return { type: "grid_unknown", rows, columns, diagnostic: GRID_DISCRIMINATOR_DIAGNOSTIC };
}
function parseQuestionItem(item) {
  if (!Array.isArray(item))
    return null;
  const itemId = toEntryId(item[0]);
  const title = typeof item[1] === "string" ? item[1] : "";
  const description = typeof item[2] === "string" && item[2].trim() ? item[2] : null;
  const typeCode = typeof item[3] === "number" ? item[3] : null;
  const entries = Array.isArray(item[4]) ? item[4] : [];
  const base = {
    item_id: itemId,
    title,
    description,
    type_code: typeCode,
    entry_ids: [],
    entry_keys: [],
    required: false,
    options: null,
    other_allowed: false,
    rows: null,
    columns: null,
    validation: null,
    diagnostic: null
  };
  if (typeCode === 7) {
    const grid = parseGrid(entries);
    const entryIds = grid.rows.map((row) => row.entry_id);
    return {
      ...base,
      type: grid.type,
      entry_ids: entryIds,
      entry_keys: entryIds.map((id) => `entry.${id}`),
      required: grid.rows.some((row) => row.required),
      rows: grid.rows,
      columns: grid.columns,
      diagnostic: grid.diagnostic
    };
  }
  const entry = entries.length > 0 && Array.isArray(entries[0]) ? entries[0] : null;
  const entryId = entry ? toEntryId(entry[0]) : null;
  const entryIds = entryId !== null ? [entryId] : [];
  const entryKey = toEntryKey(entryId);
  const required = entry ? normalizeRequired(entry[2]) : false;
  const validation = entry && Array.isArray(entry[3]) ? entry[3] : null;
  const mappedType = typeCode !== null ? TYPE_CODE_MAP[typeCode] : undefined;
  if (mappedType === undefined) {
    return {
      ...base,
      type: "unknown",
      entry_ids: entryIds,
      entry_keys: entryKey ? [entryKey] : [],
      required,
      validation,
      diagnostic: typeCode === null ? "Missing numeric question type code" : UNRECOGNIZED_TYPE_DIAGNOSTIC
    };
  }
  let options = null;
  let otherAllowed = false;
  if (mappedType === "multiple_choice" || mappedType === "dropdown" || mappedType === "checkboxes" || mappedType === "linear_scale" || mappedType === "rating") {
    const parsed = parseOptions(entry ? entry[1] : undefined);
    options = parsed.options;
    otherAllowed = parsed.otherAllowed;
  }
  return {
    ...base,
    type: mappedType,
    entry_ids: entryIds,
    entry_keys: entryKey ? [entryKey] : [],
    required,
    options,
    other_allowed: otherAllowed,
    validation
  };
}
function verifyGridWithDom(question, root) {
  if (!root)
    return "unavailable";
  if (question.type !== "multiple_choice_grid" && question.type !== "checkbox_grid" && question.type !== "grid_unknown") {
    return "unavailable";
  }
  if (question.type === "grid_unknown")
    return "unavailable";
  const rowIds = (question.rows || []).map((row) => row.entry_id);
  if (!rowIds.length)
    return "unavailable";
  let sawRadio = false;
  let sawCheckbox = false;
  for (const entryId of rowIds) {
    const elements = root.querySelectorAll(`[name="entry.${entryId}"]`);
    elements.forEach((el) => {
      const role = el.getAttribute("role");
      const type = el.type;
      if (role === "checkbox" || type === "checkbox")
        sawCheckbox = true;
      else if (role === "radio" || type === "radio")
        sawRadio = true;
    });
  }
  if (!sawRadio && !sawCheckbox)
    return "unavailable";
  if (sawRadio && sawCheckbox)
    return "unavailable";
  const domType = sawCheckbox ? "checkbox_grid" : "multiple_choice_grid";
  return domType === question.type ? "match" : "conflict";
}
function parseGoogleFormPayload(data, root) {
  const questions = [];
  const diagnostics = [];
  const items = extractQuestionItems(data);
  if (!items) {
    return {
      form_title: extractFormTitle(data),
      questions: [],
      diagnostic: "FB_PUBLIC_LOAD_DATA_ question item array (data[1][1]) not found"
    };
  }
  for (const item of items) {
    const question = parseQuestionItem(item);
    if (!question)
      continue;
    if (root && (question.type === "multiple_choice_grid" || question.type === "checkbox_grid")) {
      const consistency = verifyGridWithDom(question, root);
      if (consistency === "conflict") {
        question.type = "grid_unknown";
        question.diagnostic = GRID_DOM_CONFLICT_DIAGNOSTIC;
        diagnostics.push(GRID_DOM_CONFLICT_DIAGNOSTIC);
      }
    }
    questions.push(question);
  }
  return {
    form_title: extractFormTitle(data),
    questions,
    diagnostic: diagnostics.length ? diagnostics.join("; ") : null
  };
}
function parseGoogleFormDocument(doc = document) {
  let source = null;
  const scripts = Array.from(doc.scripts || []);
  for (const script of scripts) {
    const text = script.textContent || "";
    if (text.includes("FB_PUBLIC_LOAD_DATA_")) {
      source = text;
      break;
    }
  }
  if (source === null)
    return null;
  const extraction = extractPublicLoadData(source);
  if (!extraction.value) {
    return { form_title: null, questions: [], diagnostic: extraction.diagnostic };
  }
  return parseGoogleFormPayload(extraction.value, doc);
}

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
      const role = input.getAttribute("role");
      if (role === "listbox" || input.getAttribute("aria-haspopup") === "listbox") {
        const cardTitle = this.findQuestionContext(input);
        if (cardTitle)
          return cardTitle;
      }
      const row = input.closest ? input.closest('[role="row"], .freebirdFormviewerComponentsQuestionGridRow, tr') : null;
      if (row) {
        const ariaLabel = input.getAttribute("aria-label");
        const rowHeader = row.querySelector('[role="rowheader"], .freebirdFormviewerComponentsQuestionGridRowHeader, th, td:first-child');
        const rowText = rowHeader ? this.cleanText(rowHeader.textContent) : "";
        if (ariaLabel) {
          let clean = this.cleanText(ariaLabel);
          if (rowText) {
            clean = clean.replace(new RegExp(`,?\\s*${rowText}\\s*,?`, "gi"), "").trim();
          }
          if (clean)
            return clean;
        }
      }
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
          const text = this.cleanText(ariaLabel);
          if (text.toLowerCase() !== "choose" && text.toLowerCase() !== "pilih") {
            return text;
          }
        }
        const labelledBy = input.getAttribute("aria-labelledby");
        if (labelledBy) {
          const ids = labelledBy.trim().split(/\s+/);
          const texts = ids.map((id) => document.getElementById(id)?.textContent).filter(Boolean);
          const combined = this.cleanText(texts.join(" "));
          if (combined && combined.toLowerCase() !== "choose" && combined.toLowerCase() !== "pilih") {
            return combined;
          }
        }
      } catch (e) {}
      try {
        if ("placeholder" in input && input.placeholder && this.cleanText(input.placeholder)) {
          const ph = this.cleanText(input.placeholder);
          if (ph.toLowerCase() !== "choose" && ph.toLowerCase() !== "pilih") {
            return ph;
          }
        }
      } catch (e) {}
      try {
        const prev = input.previousElementSibling;
        if (prev) {
          const prevText = this.cleanText(prev.textContent);
          if (prevText && prevText.length < 50 && prevText.toLowerCase() !== "choose" && prevText.toLowerCase() !== "pilih") {
            return prevText;
          }
        }
      } catch (e) {}
      const named = input.name || input.id;
      return named || "Kolom Isian";
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
      const candidateElements = container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="radiogroup"], [role="listbox"], [role="group"]');
      const validFields = [];
      const handledElements = new Set;
      candidateElements.forEach((inputNode) => {
        const input = inputNode;
        if (!this.isElementVisible(input) && input.getAttribute("role") !== "listbox")
          return;
        if (handledElements.has(input))
          return;
        const role = input.getAttribute("role");
        const tag = input.tagName.toLowerCase();
        if (role === "radiogroup" || input.hasAttribute("data-rating")) {
          handledElements.add(input);
          const fieldId = this.registerElement(input, "field");
          const label = this.findQuestionContext(input) || this.findLabelForInput(input);
          const radios = Array.from(input.querySelectorAll('[role="radio"]'));
          radios.forEach((r) => handledElements.add(r));
          const card = input.closest('.Qr7Oae, [role="listitem"], fieldset, .form-card, .form-group') || input;
          const companionInputs = Array.from(card.querySelectorAll('input:not([type="hidden"]):not([type="radio"])'));
          companionInputs.forEach((ci) => handledElements.add(ci));
          const options = radios.map((r) => this.cleanText(r.getAttribute("aria-label") || r.getAttribute("data-value") || r.textContent)).filter(Boolean);
          const isRating = input.hasAttribute("data-rating") || radios.length >= 3 && radios.every((r) => /^\d+$/.test(r.textContent?.trim() || ""));
          const checkedRadio = radios.find((r) => r.getAttribute("aria-checked") === "true" || r.checked);
          const currentValue = checkedRadio ? this.cleanText(checkedRadio.getAttribute("aria-label") || checkedRadio.getAttribute("data-value") || checkedRadio.textContent) : undefined;
          validFields.push({
            id: fieldId,
            label,
            type: isRating ? "rating" : "radio",
            required: input.getAttribute("aria-required") === "true",
            currentValue,
            options: options.slice(0, 20),
            ratingScale: isRating ? { min: 1, max: radios.length } : undefined
          });
          return;
        }
        if (role === "listbox" || input.getAttribute("aria-haspopup") === "listbox") {
          handledElements.add(input);
          const fieldId = this.registerElement(input, "field");
          const label = this.findQuestionContext(input) || this.findLabelForInput(input);
          const card = input.closest('.Qr7Oae, [role="listitem"], fieldset, .form-card, .form-group') || input;
          const optEls = Array.from(card.querySelectorAll('[role="option"], .MocG8c[data-value]'));
          const options = Array.from(new Set(optEls.map((o) => this.cleanText(o.getAttribute("data-value") || o.textContent)).filter((t) => t && t.toLowerCase() !== "choose" && t.toLowerCase() !== "pilih"))).slice(0, 20);
          const selectedOpt = card.querySelector('[role="option"][aria-selected="true"], .MocG8c[aria-selected="true"]');
          const selectedText = this.cleanText(selectedOpt?.getAttribute("data-value") || selectedOpt?.textContent);
          const currentValue = selectedText && selectedText.toLowerCase() !== "choose" && selectedText.toLowerCase() !== "pilih" ? selectedText : undefined;
          validFields.push({
            id: fieldId,
            label,
            type: "select",
            required: input.getAttribute("aria-required") === "true",
            currentValue,
            options
          });
          return;
        }
        if (role === "group") {
          const checkboxes = Array.from(input.querySelectorAll('[role="checkbox"]'));
          if (checkboxes.length > 0) {
            handledElements.add(input);
            checkboxes.forEach((c) => handledElements.add(c));
            const card = input.closest('.Qr7Oae, [role="listitem"], fieldset, .form-card, .form-group') || input;
            const companionInputs = Array.from(card.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"])'));
            companionInputs.forEach((ci) => handledElements.add(ci));
            const fieldId = this.registerElement(input, "field");
            const label = this.findQuestionContext(input) || this.findLabelForInput(input);
            const options = checkboxes.map((c) => this.cleanText(c.getAttribute("aria-label") || c.getAttribute("data-value") || c.textContent)).filter(Boolean);
            const checkedBoxes = checkboxes.filter((c) => c.getAttribute("aria-checked") === "true" || c.checked);
            const currentValue = checkedBoxes.length > 0 ? checkedBoxes.map((c) => this.cleanText(c.getAttribute("aria-label") || c.getAttribute("data-value") || c.textContent)).filter(Boolean).join(", ") : undefined;
            validFields.push({
              id: fieldId,
              label,
              type: "checkbox_group",
              required: input.getAttribute("aria-required") === "true",
              currentValue,
              options: options.slice(0, 20)
            });
            return;
          }
        }
        const nameAttr = input.name || "";
        const ariaLabel = (input.getAttribute("aria-label") || "").toLowerCase();
        if (nameAttr.endsWith("_sentinel") || nameAttr.includes(".other_option_response") || ariaLabel.includes("other response") || ariaLabel.includes("jawaban lainnya")) {
          handledElements.add(input);
          return;
        }
        const parentCard = input.closest('.Qr7Oae, [role="listitem"], fieldset, .form-card, .form-group');
        if (parentCard && parentCard.querySelector('[role="radiogroup"], [role="group"], [role="radio"], [role="checkbox"]')) {
          handledElements.add(input);
          return;
        }
        const fieldId = this.registerElement(input, "field");
        const label = this.findLabelForInput(input);
        if (label.startsWith("entry.") && parentCard) {
          handledElements.add(input);
          return;
        }
        const type = tag === "select" ? "select" : tag === "textarea" ? "textarea" : input.type || "text";
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
        let currentValue = "";
        if (tag === "select") {
          const select = input;
          const opt = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
          currentValue = opt ? opt.text.trim() : select.value.trim();
        } else if (input.type === "checkbox") {
          currentValue = input.checked ? "true" : "";
        } else if (input.type === "radio") {
          currentValue = input.checked ? input.value || "true" : "";
        } else {
          currentValue = input.value || "";
        }
        validFields.push({
          id: fieldId,
          label,
          type,
          placeholder: ("placeholder" in input ? input.placeholder : "") || "",
          required: input.required || input.getAttribute("aria-required") === "true",
          currentValue: currentValue || undefined,
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
    const googleForm = this.extractGoogleFormsForm();
    if (googleForm && googleForm.fields.length > 0) {
      forms.length = 0;
      forms.push(googleForm);
    }
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
  findQuestionContext(el) {
    try {
      const card = el.closest('.Qr7Oae, [role="listitem"], fieldset, .form-card, .form-group, .form-field');
      let baseTitle = "";
      if (card) {
        const titleEl = card.querySelector('.M7eMe, .freebirdFormviewerComponentsQuestionBaseTitle, [role="heading"], legend, .form-title, .question-title, label:first-child');
        if (titleEl && this.cleanText(titleEl.textContent)) {
          baseTitle = this.cleanText(titleEl.textContent);
        }
      }
      const row = el.closest ? el.closest('[role="row"], .freebirdFormviewerComponentsQuestionGridRow, .E2Du2c, .jvy6Gd, tr') : null;
      if (row) {
        const rowHeader = row.querySelector('[role="rowheader"], .freebirdFormviewerComponentsQuestionGridRowHeader, .V4d7Ke, th, td:first-child, .row-label');
        if (rowHeader) {
          const rowText = this.cleanText(rowHeader.textContent);
          if (rowText && rowText !== baseTitle) {
            return baseTitle ? `${baseTitle} - Baris: ${rowText}` : `Baris: ${rowText}`;
          }
        }
      }
      return baseTitle;
    } catch (e) {}
    return "";
  }
  mapCanonicalTypeToFieldType(question) {
    switch (question.type) {
      case "short_answer":
        return "text";
      case "paragraph":
        return "textarea";
      case "multiple_choice":
        return "radio";
      case "dropdown":
        return "select";
      case "checkboxes":
        return "checkbox_group";
      case "linear_scale":
        return "linear_scale";
      case "rating":
        return "rating";
      case "date":
        return "date";
      case "time":
        return "time";
      case "file_upload":
        return "file";
      case "multiple_choice_grid":
        return "radio";
      case "checkbox_grid":
        return "checkbox_group";
      case "grid_unknown":
        return "grid_unknown";
      default:
        return "unknown";
    }
  }
  optionLabelForElement(el) {
    const dataValue = el.getAttribute("data-value");
    if (dataValue && this.cleanText(dataValue))
      return this.cleanText(dataValue);
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && this.cleanText(ariaLabel))
      return this.cleanText(ariaLabel);
    const value = el.value;
    if (value && this.cleanText(value))
      return this.cleanText(value);
    return this.cleanText(el.textContent);
  }
  findEntryElements(entryId) {
    try {
      return Array.from(document.querySelectorAll(`[name="entry.${entryId}"], [name="entry.${entryId}_sentinel"], [name^="entry.${entryId}_"]`));
    } catch (e) {
      return [];
    }
  }
  findQuestionCard(anchor, itemId) {
    if (anchor) {
      const found = anchor.closest('.Qr7Oae, [role="listitem"], .freebirdFormviewerComponentsQuestionBase, fieldset');
      if (found)
        return found;
    }
    if (itemId) {
      const byItemId = document.querySelector(`[data-item-id="${itemId}"]`);
      if (byItemId)
        return byItemId;
    }
    return null;
  }
  findGoogleFormsCard(question, questionIndex) {
    for (const entryId of question.entry_ids) {
      const entryEls = this.findEntryElements(entryId);
      if (entryEls.length > 0) {
        const card = this.findQuestionCard(entryEls[0], question.item_id);
        if (card)
          return card;
      }
    }
    for (const entryId of question.entry_ids) {
      const byParams = document.querySelector(`[data-params*="${entryId}"]`);
      if (byParams) {
        const card = byParams.closest('.Qr7Oae, [role="listitem"], fieldset') || byParams;
        if (card)
          return card;
      }
    }
    if (question.title) {
      const cleanTitle = this.cleanText(question.title).toLowerCase().replace(/[*?:!]/g, "").trim();
      const allCards = Array.from(document.querySelectorAll('.Qr7Oae, [role="listitem"], .freebirdFormviewerComponentsQuestionBase, fieldset'));
      for (const c of allCards) {
        const titleEl = c.querySelector('.M7eMe, [role="heading"], .freebirdFormviewerComponentsQuestionBaseTitle, .question-title');
        const text = this.cleanText(titleEl?.textContent || c.textContent || "").toLowerCase().replace(/[*?:!]/g, "").trim();
        if (text && cleanTitle && (text.includes(cleanTitle) || cleanTitle.includes(text))) {
          return c;
        }
      }
    }
    if (questionIndex !== undefined) {
      const allCards = Array.from(document.querySelectorAll('.Qr7Oae, [role="listitem"], .freebirdFormviewerComponentsQuestionBase'));
      const questionCards = allCards.filter((c) => !c.querySelector('input[type="email"], input[name="emailAddress"], input[autocomplete="email"]'));
      if (questionCards[questionIndex]) {
        return questionCards[questionIndex];
      }
      if (allCards[questionIndex]) {
        return allCards[questionIndex];
      }
    }
    return null;
  }
  defaultCanonicalHint(question, rowLabel) {
    const isGridRow = rowLabel.length > 0 || rowLabel === "" && question.rows !== null;
    const rowSuffix = rowLabel ? ` untuk baris "${rowLabel}"` : "";
    switch (question.type) {
      case "multiple_choice_grid":
        return `Pilih satu opsi${rowSuffix}.`;
      case "checkbox_grid":
        return `Pilih satu atau beberapa opsi${rowSuffix}.`;
      case "multiple_choice":
      case "dropdown":
      case "linear_scale":
      case "rating":
        return "Pilih salah satu opsi yang sesuai.";
      case "checkboxes":
        return "Pilih satu atau lebih opsi yang sesuai.";
      case "date":
        return "Sebutkan atau ketik tanggal yang diminta.";
      case "time":
        return "Sebutkan atau ketik waktu yang diminta.";
      case "paragraph":
        return "Ketik atau ucapkan jawaban Anda.";
      case "grid_unknown":
        return isGridRow ? `Pilih kolom${rowSuffix}.` : "Pilih opsi yang sesuai.";
      default:
        return "Ketik atau ucapkan jawaban Anda.";
    }
  }
  extractCurrentValueForGoogleForms(question, row, card, visibleAnchor, scopeContainer, fieldType, entryId) {
    try {
      if (["radio", "linear_scale", "rating"].includes(fieldType) || ["multiple_choice", "linear_scale", "rating", "multiple_choice_grid"].includes(question.type)) {
        const container = scopeContainer || card;
        if (container) {
          const checkedAria = container.querySelector('[role="radio"][aria-checked="true"]');
          if (checkedAria) {
            let val = this.optionLabelForElement(checkedAria);
            const otherInput = container.querySelector('input[type="text"].whsOnd, input[type="text"]:not([name^="entry."])');
            if (otherInput && otherInput.value && otherInput.value.trim() && (val.toLowerCase().includes("lain") || val.toLowerCase().includes("other") || !val)) {
              val = otherInput.value.trim();
            }
            if (val)
              return val;
          }
          const checkedInput = container.querySelector('input[type="radio"]:checked');
          if (checkedInput) {
            let val = this.optionLabelForElement(checkedInput);
            const otherInput = container.querySelector('input[type="text"].whsOnd, input[type="text"]:not([name^="entry."])');
            if (otherInput && otherInput.value && otherInput.value.trim() && (val.toLowerCase().includes("lain") || val.toLowerCase().includes("other") || !val)) {
              val = otherInput.value.trim();
            }
            if (val)
              return val;
          }
        }
      }
      if (fieldType === "checkbox_group" || ["checkboxes", "checkbox_grid"].includes(question.type)) {
        const container = scopeContainer || card;
        if (container) {
          const checkedArias = Array.from(container.querySelectorAll('[role="checkbox"][aria-checked="true"]'));
          const checkedInputs = Array.from(container.querySelectorAll('input[type="checkbox"]:checked'));
          const allChecked = Array.from(new Set([...checkedArias, ...checkedInputs]));
          if (allChecked.length > 0) {
            const otherInput = container.querySelector('input[type="text"].whsOnd, input[type="text"]:not([name^="entry."])');
            const otherCustomVal = otherInput && otherInput.value && otherInput.value.trim() ? otherInput.value.trim() : "";
            const vals = allChecked.map((el) => {
              const label = this.optionLabelForElement(el);
              if (otherCustomVal && (label.toLowerCase().includes("lain") || label.toLowerCase().includes("other") || !label)) {
                return otherCustomVal;
              }
              return label;
            }).filter(Boolean);
            if (vals.length > 0)
              return vals.join(", ");
          }
        }
      }
      if (fieldType === "dropdown" || fieldType === "select" || question.type === "dropdown") {
        if (card) {
          const nativeSelect = card.querySelector("select");
          if (nativeSelect && nativeSelect.value) {
            const opt = nativeSelect.options[nativeSelect.selectedIndex];
            const text = opt ? opt.text.trim() : nativeSelect.value.trim();
            if (text && text.toLowerCase() !== "choose" && text.toLowerCase() !== "pilih") {
              return text;
            }
          }
          const selectedOption = card.querySelector('[role="option"][aria-selected="true"], .MocG8c[aria-selected="true"]');
          if (selectedOption) {
            const text = this.cleanText(selectedOption.getAttribute("data-value") || selectedOption.textContent);
            if (text && text.toLowerCase() !== "choose" && text.toLowerCase() !== "pilih") {
              return text;
            }
          }
          const listbox = card.querySelector('[role="listbox"]');
          if (listbox) {
            const dataVal = listbox.getAttribute("data-value");
            if (dataVal && dataVal.toLowerCase() !== "choose" && dataVal.toLowerCase() !== "pilih") {
              return this.cleanText(dataVal);
            }
            const textEl = listbox.querySelector(".vR13fe, .quantumWizMenuPaperselectDropDownText");
            const text = this.cleanText(textEl?.textContent || listbox.textContent);
            if (text && text.toLowerCase() !== "choose" && text.toLowerCase() !== "pilih") {
              return text;
            }
          }
        }
      }
      if (fieldType === "time" || question.type === "time") {
        if (card) {
          const hourEl = card.querySelector('input[name$="_hour"], input[aria-label*="Jam" i], input[aria-label*="Hour" i]');
          const minEl = card.querySelector('input[name$="_minute"], input[aria-label*="Menit" i], input[aria-label*="Minute" i]');
          if (hourEl?.value && minEl?.value) {
            return `${hourEl.value.padStart(2, "0")}:${minEl.value.padStart(2, "0")}`;
          }
        }
      }
      if (fieldType === "date" || question.type === "date") {
        if (card) {
          const singleDate = card.querySelector('input[type="date"], input[aria-label*="Hari, bulan, tahun" i], input[aria-label*="Day, month, year" i]');
          if (singleDate && singleDate.value && singleDate.value.trim()) {
            const trimmed = singleDate.value.trim();
            const m = trimmed.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
            if (m)
              return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
            return trimmed;
          }
          const dayEl = card.querySelector('input[name$="_day"], input[placeholder*="dd" i], input[aria-label*="Hari" i]:not([aria-label*="bulan" i])');
          const monthEl = card.querySelector('input[name$="_month"], input[placeholder*="mm" i], input[aria-label*="Bulan" i]:not([aria-label*="tahun" i])');
          const yearEl = card.querySelector('input[name$="_year"], input[placeholder*="yyyy" i], input[aria-label*="Tahun" i]:not([aria-label*="bulan" i])');
          if (dayEl?.value && monthEl?.value && yearEl?.value) {
            return `${yearEl.value}-${monthEl.value.padStart(2, "0")}-${dayEl.value.padStart(2, "0")}`;
          }
        }
        if (entryId !== null) {
          const y = document.querySelector(`input[name="entry.${entryId}_year"]`)?.value?.trim();
          const m = document.querySelector(`input[name="entry.${entryId}_month"]`)?.value?.trim();
          const d = document.querySelector(`input[name="entry.${entryId}_day"]`)?.value?.trim();
          if (y && m && d) {
            return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
          }
        }
      }
      let textEl = null;
      if (visibleAnchor && "value" in visibleAnchor && visibleAnchor.value?.trim()) {
        textEl = visibleAnchor;
      }
      if (!textEl && card) {
        textEl = card.querySelector('input.whsOnd, textarea.KHxj8b, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea');
      }
      if (textEl && "value" in textEl) {
        const val = (textEl.value || textEl.getAttribute("value") || "").trim();
        if (val)
          return val;
      }
      if (entryId !== null) {
        const hidden = document.querySelector(`input[name="entry.${entryId}"]:not([name$="_sentinel"])`);
        if (hidden && hidden.value && hidden.value.trim()) {
          return hidden.value.trim();
        }
      }
    } catch (e) {
      console.warn("[AIRA DOMPruner] Error extracting current value:", e);
    }
    return "";
  }
  buildGoogleFormsField(question, row, questionIndex) {
    const entryId = row ? row.entry_id : question.entry_ids[0] ?? null;
    const isGridRow = !!row;
    const rowLabel = row?.label || "";
    const label = isGridRow ? rowLabel ? `${question.title} — ${rowLabel}` : `${question.title} — Baris` : question.title || "Pertanyaan";
    const fieldType = this.mapCanonicalTypeToFieldType(question);
    const options = row ? question.columns || [] : question.options || [];
    const required = row ? row.required : question.required;
    const entryElements = entryId !== null ? this.findEntryElements(entryId) : [];
    const card = this.findGoogleFormsCard(question, questionIndex);
    let scopeContainer = card;
    if (isGridRow) {
      if (entryElements.length > 0) {
        const rowContainer = entryElements[0].closest('tr, [role="row"], .freebirdFormviewerComponentsQuestionGridRow, [role="radiogroup"], [data-row-index]');
        if (rowContainer)
          scopeContainer = rowContainer;
      }
      if (scopeContainer === card && card && rowLabel) {
        const allRowEls = card.querySelectorAll('tr, [role="row"], .freebirdFormviewerComponentsQuestionGridRow');
        for (const rEl of Array.from(allRowEls)) {
          if (rEl.textContent?.includes(rowLabel)) {
            scopeContainer = rEl;
            break;
          }
        }
      }
    }
    let visibleAnchor = null;
    if (card) {
      if (fieldType === "textarea") {
        visibleAnchor = card.querySelector("textarea.KHxj8b, textarea");
      } else if (fieldType === "text") {
        visibleAnchor = card.querySelector('input.whsOnd:not([aria-label*="Other" i]):not([aria-label*="lain" i]), input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="radio"]):not([type="checkbox"])');
      } else if (fieldType === "dropdown" || fieldType === "select") {
        visibleAnchor = card.querySelector('[role="listbox"], [aria-haspopup="listbox"], select');
      } else if (fieldType === "time" || fieldType === "date") {
        visibleAnchor = card.querySelector('input:not([type="hidden"])');
      } else if (fieldType === "radio" || fieldType === "linear_scale" || fieldType === "rating") {
        const targetContainer = scopeContainer || card;
        visibleAnchor = targetContainer?.querySelector('[role="radiogroup"]') || targetContainer?.querySelector('[role="radio"]') || null;
      } else if (fieldType === "checkbox_group") {
        const targetContainer = scopeContainer || card;
        visibleAnchor = targetContainer?.querySelector('[role="group"]') || targetContainer?.querySelector('[role="checkbox"]') || null;
      }
    }
    if (!visibleAnchor && entryElements.length > 0) {
      visibleAnchor = entryElements.find((el) => {
        const name = el.getAttribute("name") || "";
        const type = el.type || "";
        return !name.endsWith("_sentinel") && type !== "hidden";
      }) || null;
    }
    let optionBindings;
    const bindingTypes = [
      "multiple_choice",
      "checkboxes",
      "linear_scale",
      "rating",
      "multiple_choice_grid",
      "checkbox_grid",
      "grid_unknown"
    ];
    if (bindingTypes.includes(question.type)) {
      const optionEls = [];
      if (scopeContainer) {
        optionEls.push(...Array.from(scopeContainer.querySelectorAll('[role="radio"], [role="checkbox"]')));
      }
      entryElements.forEach((el) => {
        const type = el.type;
        const role = el.getAttribute("role");
        if (role === "radio" || role === "checkbox" || type === "radio" || type === "checkbox") {
          optionEls.push(el);
        }
      });
      optionBindings = Array.from(new Set(optionEls)).map((el) => ({
        option: this.optionLabelForElement(el),
        ref: this.registerElement(el, "opt")
      })).filter((binding) => binding.option.length > 0);
    }
    if (question.type === "dropdown" && card) {
      const optionEls = Array.from(card.querySelectorAll('[role="option"]'));
      if (optionEls.length > 0) {
        optionBindings = optionEls.map((el) => ({
          option: this.cleanText(el.getAttribute("data-value") || el.textContent),
          ref: this.registerElement(el, "opt")
        })).filter((binding) => binding.option.length > 0);
      }
    }
    let otherInputRef;
    if (question.other_allowed && card) {
      const candidates = Array.from(card.querySelectorAll('input[type="text"], input.whsOnd, textarea'));
      const companion = candidates.find((el) => el.type !== "hidden") || candidates[0];
      if (companion)
        otherInputRef = this.registerElement(companion, "other");
    }
    const targetAnchor = visibleAnchor || card;
    const fieldId = targetAnchor ? this.registerElement(targetAnchor, "field") : entryId !== null ? `gf-entry-${entryId}` : `gf-item-${question.item_id ?? "unknown"}`;
    let ratingScale;
    if ((question.type === "linear_scale" || question.type === "rating") && options.length > 0) {
      ratingScale = { min: 1, max: options.length };
    }
    const currentValue = this.extractCurrentValueForGoogleForms(question, row, card, visibleAnchor, scopeContainer, fieldType, entryId);
    if (currentValue) {
      console.log(`[AIRA PreFill] ✅ Extracted currentValue for "${label}": "${currentValue}"`);
    } else {
      console.log(`[AIRA PreFill] ℹ️ No currentValue found for "${label}" (card: ${!!card}, anchor: ${!!visibleAnchor}, type: ${fieldType})`);
    }
    return {
      id: fieldId,
      domId: visibleAnchor?.id || undefined,
      label,
      type: fieldType,
      placeholder: visibleAnchor?.getAttribute("placeholder") || undefined,
      required,
      currentValue: currentValue || undefined,
      options: options.length > 0 ? options : undefined,
      optionBindings,
      hasOther: question.other_allowed || undefined,
      otherInputRef,
      ratingScale,
      typeCode: question.type_code,
      canonicalType: question.type,
      entryIds: row ? [row.entry_id] : question.entry_ids,
      entryKeys: row ? [row.entry_key] : question.entry_keys,
      otherAllowed: question.other_allowed,
      columns: question.columns,
      rows: row ? null : question.rows,
      diagnostic: question.diagnostic,
      validation: question.validation,
      hint: question.description || this.defaultCanonicalHint(question, rowLabel),
      gridQuestion: row ? question.title : undefined,
      gridRowLabel: row ? rowLabel || undefined : undefined
    };
  }
  extractGoogleFormsForm() {
    if (typeof document === "undefined")
      return null;
    let parsed = null;
    try {
      parsed = parseGoogleFormDocument(document);
    } catch (e) {
      console.warn("[AIRA Google Forms] Payload parse error:", e);
      return null;
    }
    if (!parsed || parsed.questions.length === 0)
      return null;
    const fields = [];
    let qIdx = 0;
    for (const question of parsed.questions) {
      if (question.rows && question.rows.length > 0) {
        for (const row of question.rows) {
          fields.push(this.buildGoogleFormsField(question, row, qIdx));
        }
        qIdx++;
        continue;
      }
      if (question.entry_ids.length === 0)
        continue;
      fields.push(this.buildGoogleFormsField(question, null, qIdx));
      qIdx++;
    }
    try {
      const emailInput = document.querySelector('input[type="email"], input[name="emailAddress"], input[autocomplete="email"]');
      if (emailInput) {
        const isAlreadyMapped = fields.some((f) => {
          const el = this.getElement(f.id);
          return el === emailInput;
        });
        if (!isAlreadyMapped) {
          const emailCard = emailInput.closest('.Qr7Oae, [role="listitem"], .geS5n, fieldset') || emailInput.parentElement;
          const titleEl = emailCard?.querySelector('.M7eMe, [role="heading"], .freebirdFormviewerComponentsQuestionBaseTitle');
          const emailLabel = this.cleanText(titleEl?.textContent || emailInput.getAttribute("aria-label") || "Email").replace(/[*?:!]/g, "").trim() || "Email";
          const isRequired = emailInput.required || emailInput.getAttribute("aria-required") === "true" || !!emailCard?.querySelector('.vnumgf, [aria-label*="wajib" i], [aria-label*="required" i]');
          let currentEmail = (emailInput.value || emailInput.getAttribute("data-initial-value") || "").trim();
          if (!currentEmail) {
            const userEmailHolder = document.querySelector("[data-user-email-address]");
            currentEmail = (userEmailHolder?.getAttribute("data-user-email-address") || "").trim();
          }
          const emailFieldId = this.registerElement(emailInput, "field");
          const emailField = {
            id: emailFieldId,
            domId: emailInput.id || undefined,
            label: emailLabel,
            type: "email",
            placeholder: emailInput.placeholder || emailInput.getAttribute("aria-label") || "nama@email.com",
            required: isRequired,
            currentValue: currentEmail || undefined,
            canonicalType: "short_answer",
            entryKeys: ["emailAddress"],
            validationKey: "email",
            hint: "Ketik atau ucapkan alamat email Anda."
          };
          fields.unshift(emailField);
          console.log(`[AIRA Google Forms] ✉️ Detected Google Forms system email collection field: "${emailLabel}" (prefilled: "${currentEmail}")`);
        }
      }
    } catch (e) {
      console.warn("[AIRA Google Forms] Error detecting system email field:", e);
    }
    if (fields.length === 0)
      return null;
    const container = document.querySelector(".freebirdFormviewerViewFormContent") || document.querySelector("form") || document.body;
    const formId = container && container !== document.body ? this.registerElement(container, "form") : "google-forms";
    return {
      id: formId,
      title: parsed.form_title || document.title || "Formulir Google",
      fields
    };
  }
  pruneFormForLLM(targetContainer) {
    let container = targetContainer || document.querySelector('form, [role="form"], .freebirdFormviewerViewFormContent') || document.body;
    const candidateSelector = [
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
      "select",
      "textarea",
      '[role="radio"]',
      '[role="checkbox"]',
      '[role="radiogroup"]',
      '[role="listbox"]',
      '[role="option"]',
      '[role="combobox"]',
      '[role="slider"]',
      '[role="switch"]',
      "[data-rating]",
      "[aria-valuenow]"
    ].join(", ");
    let elements = Array.from(container.querySelectorAll(candidateSelector));
    if (elements.length === 0 && container !== document.body) {
      container = document.body;
      elements = Array.from(container.querySelectorAll(candidateSelector));
    }
    const visibleElements = elements.filter((el) => {
      if (el.getAttribute("role") === "option")
        return true;
      return this.isElementVisible(el);
    });
    let refCounter = 1;
    const taggedItems = [];
    visibleElements.forEach((el) => {
      try {
        let ref = el.getAttribute("data-aira-ref");
        if (!ref) {
          ref = `f_${refCounter++}`;
          el.setAttribute("data-aira-ref", ref);
        }
        this.elementMap.set(ref, el);
      } catch (e) {}
    });
    visibleElements.forEach((el) => {
      try {
        const ref = el.getAttribute("data-aira-ref");
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") || undefined;
        const type = el.type || (tag === "select" ? "select" : tag === "textarea" ? "textarea" : role || "text");
        const name = el.name || undefined;
        const label = this.findLabelForInput(el);
        const group = this.findQuestionContext(el) || undefined;
        const placeholder = el.placeholder || undefined;
        const required = el.hasAttribute("required") || el.getAttribute("aria-required") === "true";
        const value = el.value || el.getAttribute("data-value") || el.getAttribute("aria-valuenow") || undefined;
        const checked = el.checked || el.getAttribute("aria-checked") === "true";
        let options;
        if (tag === "select") {
          const sel = el;
          options = Array.from(sel.options).map((o) => o.text.trim()).filter(Boolean).slice(0, 20);
        } else if (role === "listbox" || el.getAttribute("aria-haspopup") === "listbox") {
          const card = el.closest('.Qr7Oae, [role="listitem"], fieldset, .form-card, .form-group') || container;
          const optEls = Array.from(card.querySelectorAll('[role="option"], .MocG8c[data-value], .quantumWizMenuPaperselectOption'));
          const optTexts = optEls.map((opt) => this.cleanText(opt.getAttribute("data-value") || opt.textContent)).filter((t) => t && t.toLowerCase() !== "choose" && t.toLowerCase() !== "pilih");
          if (optTexts.length > 0) {
            options = Array.from(new Set(optTexts)).slice(0, 20);
          }
        }
        let companionFor;
        if (tag === "input" && (type === "text" || type === "")) {
          const isOtherPlaceholder = placeholder && (placeholder.toLowerCase().includes("other") || placeholder.toLowerCase().includes("lainnya"));
          const isOtherAria = label && (label.toLowerCase().includes("other") || label.toLowerCase().includes("lainnya"));
          const isOtherClass = el.className && (el.className.includes("quantumWizTextinputPaperinputInput") || el.className.includes("Other"));
          if (isOtherPlaceholder || isOtherAria || isOtherClass) {
            const card = el.closest('.Qr7Oae, [role="listitem"], fieldset, .form-card, .form-group') || el.parentElement;
            if (card) {
              const otherOpt = card.querySelector('[role="checkbox"][aria-label*="Other"], [role="radio"][aria-label*="Other"], [role="checkbox"][aria-label*="Lainnya"], [role="radio"][aria-label*="Lainnya"], [data-value="__other_option__"]');
              if (otherOpt) {
                companionFor = otherOpt.getAttribute("data-aira-ref") || undefined;
              }
            }
          }
        }
        taggedItems.push({
          ref,
          tag,
          type,
          role,
          group,
          name,
          label,
          placeholder,
          required,
          value,
          options,
          checked,
          companionFor
        });
      } catch (err) {
        console.warn("[AIRA DOM Pruner] Element tagging error:", err);
      }
    });
    const lines = [];
    taggedItems.forEach((item) => {
      let line = `<elem ref="${item.ref}" tag="${item.tag}" type="${item.type}"`;
      if (item.role)
        line += ` role="${item.role}"`;
      if (item.companionFor)
        line += ` companionFor="${item.companionFor}"`;
      if (item.group)
        line += ` group="${item.group.replace(/"/g, "'")}"`;
      if (item.label && item.label !== item.group)
        line += ` text="${item.label.replace(/"/g, "'")}"`;
      if (item.name)
        line += ` name="${item.name}"`;
      if (item.placeholder)
        line += ` placeholder="${item.placeholder.replace(/"/g, "'")}"`;
      if (item.required)
        line += ` required="true"`;
      if (item.value)
        line += ` value="${item.value.replace(/"/g, "'")}"`;
      if (item.checked)
        line += ` checked="true"`;
      if (item.options && item.options.length > 0)
        line += ` options="${item.options.join("|")}"`;
      line += ` />`;
      lines.push(line);
    });
    const formTitle = container.getAttribute("aria-label") || container.title || document.title || "Formulir Web";
    const compactHtml = `<form title="${formTitle.replace(/"/g, "'")}">
  ` + lines.join(`
  `) + `
</form>`;
    return {
      compactHtml,
      elementCount: taggedItems.length
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
  async startSession(form, compactDom, resume) {
    const baseUrl = await this.getServerUrl();
    try {
      const deterministic = (form.fields || []).some((f) => !!f.canonicalType);
      const payload = {
        deterministic,
        compact_dom: deterministic ? undefined : compactDom || undefined,
        answers: resume?.answers,
        step_index: resume?.stepIndex,
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
            validationKey: f.validationKey,
            domRefs: f.domRefs,
            optionBindings: f.optionBindings,
            ratingScale: f.ratingScale,
            hint: f.hint,
            typeCode: f.typeCode ?? null,
            canonicalType: f.canonicalType ?? null,
            entryIds: f.entryIds ?? [],
            entryKeys: f.entryKeys ?? [],
            otherAllowed: !!f.otherAllowed,
            hasOther: !!f.hasOther,
            columns: f.columns ?? null,
            rows: f.rows ?? null,
            diagnostic: f.diagnostic ?? null,
            validation: f.validation ?? null,
            gridQuestion: f.gridQuestion ?? null,
            gridRowLabel: f.gridRowLabel ?? null
          }))
        }
      };
      console.log(`[AIRA AgentService] Calling /session/start (deterministic: ${deterministic}, compact_dom: ${compactDom ? compactDom.length : 0} chars)`);
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
  async interactWithText(sessionId, text, alreadyExtracted = false) {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/interact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          user_speech: text,
          user_input: text,
          already_extracted: alreadyExtracted
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
  async transcribeForSession(sessionId, audioBlob, durationMs) {
    const baseUrl = await this.getServerUrl();
    try {
      const formData = new FormData;
      formData.append("session_id", sessionId);
      formData.append("file", audioBlob, "speech.webm");
      if (typeof durationMs === "number" && durationMs > 0) {
        formData.append("duration_ms", String(Math.round(durationMs)));
      }
      const res = await fetch(`${baseUrl}/session/transcribe`, {
        method: "POST",
        body: formData
      });
      if (!res.ok) {
        console.warn(`[AIRA AgentService] transcribeForSession failed with status ${res.status}`);
        return null;
      }
      const data = await res.json();
      const transcript = data && typeof data.transcript === "string" ? data.transcript.trim() : "";
      const normalized = data && typeof data.normalized === "string" && data.normalized.trim() ? data.normalized.trim() : transcript;
      if (!transcript && !normalized)
        return null;
      return { transcript, normalized };
    } catch (err) {
      console.warn("[AIRA AgentService] transcribeForSession network error:", err);
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
  captureStartedAt = 0;
  lastCaptureDurationMs = 0;
  vocabularyContext = [];
  sttContextPrompt = "";
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
    this.vocabularyContext = (callbacks.vocabulary || []).map((v) => v.trim()).filter(Boolean);
    this.sttContextPrompt = (callbacks.prompt || "").trim() || (this.vocabularyContext.length ? `Pilihan jawaban: ${this.vocabularyContext.join(", ")}.` : "");
    if (this.sttContextPrompt) {
      console.log(`[AIRA STT] Context sent to STT: ${this.sttContextPrompt}`);
    }
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
      console.log(`[AIRA STT] Active service: 9Router Whisper -> ${settings.whisperEndpoint || "https://api.openai.com/v1/audio/transcriptions"} (model: ${settings.whisperModel || "whisper-1"})`);
      const ok = await this.startWhisperRecording(settings);
      if (ok)
        return true;
      console.warn("[AIRA STT] Whisper recording could not start, falling back to Web Speech API");
    }
    console.log(`[AIRA STT] Active service: Browser Web Speech API (lang: ${settings.ttsVoiceLang || "id-ID"})`);
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
    this.applyWebSpeechContext();
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
  applyWebSpeechContext() {
    if (!this.recognition || this.vocabularyContext.length === 0)
      return;
    try {
      const recognitionAny = this.recognition;
      const PhraseList = window.SpeechRecognitionPhraseList;
      if (typeof PhraseList === "function") {
        recognitionAny.phrases = new PhraseList(this.vocabularyContext.map((text) => ({ text, boost: 2 })));
        console.log(`[AIRA STT] Web Speech phrases (${this.vocabularyContext.length}): ${this.vocabularyContext.join(", ")}`);
        return;
      }
      const GrammarList = window;
      const GrammarListCtor = GrammarList.SpeechGrammarList || GrammarList.webkitSpeechGrammarList;
      if (typeof GrammarListCtor === "function") {
        const words = this.vocabularyContext.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(" | ");
        const list = new GrammarListCtor;
        list.addFromString(`#JSGF V1.0; grammar aira_options; public <option> = ${words} ;`, 1);
        recognitionAny.grammars = list;
        console.log(`[AIRA STT] Web Speech grammar (${this.vocabularyContext.length}): ${this.vocabularyContext.join(", ")}`);
      }
    } catch (e) {
      console.warn("[AIRA STT] Could not attach Web Speech context:", e);
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
    if (this.sttContextPrompt) {
      formData.append("prompt", this.sttContextPrompt);
      console.log(`[AIRA STT] Whisper prompt (allowed options): ${this.sttContextPrompt}`);
    }
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
      this.captureStartedAt = Date.now();
      this.lastCaptureDurationMs = 0;
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
        this.lastCaptureDurationMs = this.captureStartedAt ? Date.now() - this.captureStartedAt : 0;
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

// src/services/response_validation.ts
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var DATE_PATTERN = /^(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})$/;
var TIME_PATTERN = /^([01]?\d|2[0-3])[:.][0-5]\d$/;
function isSingleChoice(field) {
  return ["radio", "select", "linear_scale", "rating"].includes(field.type) || ["multiple_choice", "dropdown", "linear_scale", "rating", "multiple_choice_grid"].includes(field.canonicalType || "");
}
function isMultiChoice(field) {
  return ["checkbox_group", "checkboxes"].includes(field.type) || ["checkboxes", "checkbox_grid"].includes(field.canonicalType || "");
}
function isGridUnknown(field) {
  return field.canonicalType === "grid_unknown";
}
function splitSelections(value) {
  return value.split(/[,|]/).map((part) => part.trim()).filter(Boolean);
}
function matchesOption(value, options) {
  const lowered = value.toLowerCase().trim();
  return options.some((option) => {
    const optLower = option.toLowerCase().trim();
    return optLower === lowered || optLower.includes(lowered) || lowered.includes(optLower);
  });
}
function validateFieldAnswer(field, rawValue) {
  const value = (rawValue ?? "").trim();
  if (!value) {
    if (field.required) {
      return { valid: false, error: `${field.label} wajib diisi.` };
    }
    return { valid: true };
  }
  const canonical = field.canonicalType || "";
  const options = (field.options || []).filter((option) => option !== "");
  const otherAllowed = !!(field.hasOther || field.otherAllowed);
  if (field.type === "email" || canonical === "email") {
    if (!EMAIL_PATTERN.test(value)) {
      return { valid: false, error: `Format email pada "${field.label}" tidak valid.` };
    }
  }
  if (field.type === "number") {
    if (!Number.isFinite(Number(value))) {
      return { valid: false, error: `"${field.label}" harus berupa angka.` };
    }
  }
  if (field.type === "date" || field.typeCode === 9 || canonical === "date") {
    const isIsoOrDmy = DATE_PATTERN.test(value);
    const isTextualDate = /^\d{1,2}\s+[a-zA-Z]+\s+\d{4}$/.test(value) || /^[a-zA-Z]+\s+\d{1,2},?\s+\d{4}$/.test(value);
    const isMultiConcat = /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/.test(value);
    if (!isIsoOrDmy && !isTextualDate && !isMultiConcat) {
      return { valid: false, error: `Format tanggal "${field.label}" tidak valid (contoh: 2026-12-31 atau 31/12/2026).` };
    }
  }
  if (field.type === "time" || field.typeCode === 10 || canonical === "time") {
    if (!TIME_PATTERN.test(value)) {
      return { valid: false, error: `Format waktu "${field.label}" tidak valid (contoh: 14:30).` };
    }
  }
  if (isSingleChoice(field) && options.length > 0) {
    if (!matchesOption(value, options) && !otherAllowed) {
      return {
        valid: false,
        error: `Pilih salah satu opsi untuk "${field.label}": ${options.slice(0, 5).join(", ")}.`
      };
    }
  }
  if (isMultiChoice(field) && options.length > 0) {
    const selections = splitSelections(value);
    const invalid = selections.find((selection) => !matchesOption(selection, options));
    if (invalid && !otherAllowed) {
      return { valid: false, error: `Opsi "${invalid}" tidak tersedia untuk "${field.label}".` };
    }
  }
  if (isGridUnknown(field) && options.length > 0) {
    const selections = splitSelections(value);
    const invalid = selections.find((selection) => !matchesOption(selection, options));
    if (invalid) {
      return { valid: false, error: `Kolom "${invalid}" tidak tersedia untuk "${field.label}".` };
    }
  }
  if ((field.type === "linear_scale" || field.type === "rating") && options.length === 0 && field.ratingScale) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < field.ratingScale.min || numeric > field.ratingScale.max) {
      return {
        valid: false,
        error: `Nilai "${field.label}" harus antara ${field.ratingScale.min} dan ${field.ratingScale.max}.`
      };
    }
  }
  return { valid: true };
}

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
        if (f.domId && f.domId !== f.id)
          this.answers[f.domId] = f.currentValue;
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
    if (field.canonicalType || field.entryIds && field.entryIds.length > 0) {
      const structural = validateFieldAnswer(field, trimmed);
      if (!structural.valid) {
        return { valid: false, error: structural.error, formatted: trimmed };
      }
    }
    return { valid: true, formatted: trimmed };
  }
  stageAnswer(fieldId, rawValue) {
    if (!this.activeForm)
      return;
    if (!this.activeForm.fields.some((f) => f.id === fieldId))
      return;
    this.answers[fieldId] = rawValue;
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
  async syncToHostDOM(externalAnswers) {
    if (!this.activeForm)
      return false;
    if (externalAnswers) {
      Object.assign(this.answers, externalAnswers);
    }
    try {
      const rogueInputs = document.querySelectorAll('form > input[type="hidden"][name^="entry."], body > input[type="hidden"][name^="entry."], input[data-aira-injected="true"]');
      rogueInputs.forEach((h) => {
        if (!h.name.endsWith("_sentinel") && !h.closest('.Qr7Oae, [role="listitem"]')) {
          h.remove();
        }
      });
    } catch (e) {
      console.warn("[AIRA Syncer] Cleanup rogue inputs error:", e);
    }
    let anySynced = false;
    for (const field of this.activeForm.fields) {
      const val = this.answers[field.id] ?? (field.domId ? this.answers[field.domId] : undefined) ?? (field.entryKeys?.[0] ? this.answers[field.entryKeys[0]] : undefined);
      if (val === undefined || val === null)
        continue;
      try {
        const valStr = String(val).trim();
        if (field.optionBindings && field.optionBindings.length > 0) {
          const valLower = valStr.toLowerCase();
          if (field.type === "checkbox_group") {
            const chosenList = Array.isArray(val) ? val.map((v) => String(v).toLowerCase().trim()) : valLower.split(/[,|]/).map((s) => s.trim());
            let matchedAny = false;
            for (const binding of field.optionBindings) {
              const optLower = binding.option.toLowerCase();
              const isOtherOption = optLower.includes("other") || optLower.includes("lainnya");
              const isChosen = chosenList.some((c) => optLower.includes(c) || c.includes(optLower));
              const el = domPruner.getElement(binding.ref);
              if (el && !isOtherOption) {
                const isAlreadyChecked = el.checked || el.getAttribute("aria-checked") === "true";
                if (isChosen) {
                  matchedAny = true;
                  if (!isAlreadyChecked) {
                    this.triggerSyntheticSelection(el);
                  }
                } else if (isAlreadyChecked) {
                  this.triggerSyntheticSelection(el);
                }
              }
            }
            if (!matchedAny || chosenList.some((c) => c.includes("other") || c.includes("lainnya"))) {
              const otherBinding = field.optionBindings.find((b) => b.option.toLowerCase().includes("other") || b.option.toLowerCase().includes("lainnya"));
              if (otherBinding) {
                const otherEl = domPruner.getElement(otherBinding.ref);
                if (otherEl) {
                  const isChecked = otherEl.checked || otherEl.getAttribute("aria-checked") === "true";
                  if (!isChecked)
                    this.triggerSyntheticSelection(otherEl);
                }
              }
              let otherInput = field.otherInputRef ? domPruner.getElement(field.otherInputRef) : null;
              if (!otherInput) {
                const fieldCard = domPruner.getElement(field.id)?.closest('.Qr7Oae, [role="listitem"]');
                if (fieldCard) {
                  otherInput = fieldCard.querySelector('input.whsOnd, input[type="text"]:not([type="hidden"])');
                }
              }
              if (otherInput) {
                const customText = chosenList.filter((c) => !c.includes("other") && !c.includes("lainnya")).join(", ") || valStr;
                this.setNativeInputValue(otherInput, customText);
              }
            } else {
              let otherInput = field.otherInputRef ? domPruner.getElement(field.otherInputRef) : null;
              if (!otherInput) {
                const fieldCard = domPruner.getElement(field.id)?.closest('.Qr7Oae, [role="listitem"]');
                if (fieldCard) {
                  otherInput = fieldCard.querySelector('input.whsOnd, input[type="text"]:not([type="hidden"])');
                }
              }
              if (otherInput) {
                this.setNativeInputValue(otherInput, "");
              }
            }
            anySynced = true;
            continue;
          }
          let matchedBinding = field.optionBindings.find((b) => b.option.toLowerCase() === valLower || b.value && b.value.toLowerCase() === valLower);
          if (!matchedBinding) {
            matchedBinding = field.optionBindings.find((b) => !b.option.toLowerCase().includes("other") && !b.option.toLowerCase().includes("lainnya") && (b.option.toLowerCase().includes(valLower) || valLower.includes(b.option.toLowerCase())));
          }
          if (matchedBinding) {
            const targetEl = domPruner.getElement(matchedBinding.ref);
            if (targetEl) {
              this.triggerSyntheticSelection(targetEl);
              let otherInput = field.otherInputRef ? domPruner.getElement(field.otherInputRef) : null;
              if (!otherInput) {
                const fieldCard = targetEl.closest('.Qr7Oae, [role="listitem"]');
                if (fieldCard) {
                  otherInput = fieldCard.querySelector('input.whsOnd, input[type="text"]:not([type="hidden"])');
                }
              }
              if (otherInput) {
                this.setNativeInputValue(otherInput, "");
              }
              anySynced = true;
              continue;
            }
          } else {
            const otherBinding = field.optionBindings.find((b) => b.option.toLowerCase().includes("other") || b.option.toLowerCase().includes("lainnya"));
            if (otherBinding) {
              const targetEl = domPruner.getElement(otherBinding.ref);
              if (targetEl) {
                this.triggerSyntheticSelection(targetEl);
                let otherInput = field.otherInputRef ? domPruner.getElement(field.otherInputRef) : null;
                if (!otherInput) {
                  const fieldCard = targetEl.closest('.Qr7Oae, [role="listitem"]');
                  if (fieldCard) {
                    otherInput = fieldCard.querySelector('input.whsOnd, input[type="text"]:not([type="hidden"])');
                  }
                }
                if (otherInput) {
                  this.setNativeInputValue(otherInput, valStr);
                }
                anySynced = true;
                continue;
              }
            }
          }
        }
        let el = domPruner.getElement(field.id);
        if (!el && field.domId) {
          el = document.getElementById(field.domId);
        }
        if (!el && field.entryKeys && field.entryKeys.length > 0) {
          el = document.querySelector(`[name="${field.entryKeys[0]}"]:not([type="hidden"]):not([name$="_sentinel"])`);
        }
        if (!el && (field.type === "email" || field.entryKeys?.includes("emailAddress"))) {
          el = document.querySelector('input[type="email"], input[autocomplete="email"], input[name="emailAddress"]');
        }
        if (el && !["input", "textarea", "select"].includes(el.tagName.toLowerCase()) && !el.hasAttribute("role")) {
          const innerInput = el.querySelector('input.whsOnd:not([type="hidden"]), textarea.KHxj8b, [role="listbox"], [role="radio"], [role="checkbox"], input:not([type="hidden"]), textarea, select');
          if (innerInput)
            el = innerInput;
        }
        let card = el ? el.closest('.Qr7Oae, [role="listitem"], .freebirdFormviewerComponentsQuestionBase, fieldset, .form-card, .form-group') : null;
        if (!card && field.entryKeys && field.entryKeys.length > 0) {
          const sentinel = document.querySelector(`[name="${field.entryKeys[0]}_sentinel"], [name="${field.entryKeys[0]}"]`);
          if (sentinel) {
            card = sentinel.closest('.Qr7Oae, [role="listitem"], .freebirdFormviewerComponentsQuestionBase, fieldset, .form-card, .form-group');
          }
        }
        if (!card && field.label) {
          const cleanTitle = field.label.toLowerCase().replace(/[*?:!]/g, "").trim();
          const allCards = Array.from(document.querySelectorAll('.Qr7Oae, [role="listitem"], .freebirdFormviewerComponentsQuestionBase, fieldset'));
          for (const c of allCards) {
            const titleEl = c.querySelector('.M7eMe, [role="heading"], .freebirdFormviewerComponentsQuestionBaseTitle, .question-title');
            const text = (titleEl?.textContent || c.textContent || "").toLowerCase().replace(/[*?:!]/g, "").trim();
            if (text && cleanTitle && (text.includes(cleanTitle) || cleanTitle.includes(text))) {
              card = c;
              break;
            }
          }
        }
        if (card && !el) {
          el = card.querySelector('[role="listbox"], input:not([type="hidden"]), textarea, select');
        }
        if (field.type === "time" || field.canonicalType === "time") {
          const timeMatch = valStr.match(/(\d{1,2})[:.](\d{1,2})(?:\s*(am|pm))?/i);
          if (timeMatch) {
            const hour = timeMatch[1].padStart(2, "0");
            const minute = timeMatch[2].padStart(2, "0");
            const ampmStr = timeMatch[3]?.toUpperCase();
            const hourInput = (card ? card.querySelector('input[name$="_hour"], input[aria-label*="Jam" i], input[aria-label*="Hour" i]') : null) || (field.entryKeys?.[0] ? document.querySelector(`[name="${field.entryKeys[0]}_hour"]`) : null);
            const minuteInput = (card ? card.querySelector('input[name$="_minute"], input[aria-label*="Menit" i], input[aria-label*="Minute" i]') : null) || (field.entryKeys?.[0] ? document.querySelector(`[name="${field.entryKeys[0]}_minute"]`) : null);
            if (hourInput && minuteInput) {
              this.setNativeInputValue(hourInput, hour);
              this.setNativeInputValue(minuteInput, minute);
              const ampmEl = card ? card.querySelector('[role="listbox"][aria-label*="AM" i], [role="listbox"][aria-label*="PM" i], select[name$="_ampm"]') : null;
              if (ampmEl) {
                let targetPeriod = ampmStr;
                if (!targetPeriod) {
                  const hNum = parseInt(hour, 10);
                  targetPeriod = hNum >= 12 ? "PM" : "AM";
                }
                if (ampmEl.tagName.toLowerCase() === "select") {
                  ampmEl.value = targetPeriod;
                  ampmEl.dispatchEvent(new Event("change", { bubbles: true }));
                } else {
                  await this.selectListboxOption(ampmEl, targetPeriod);
                }
              }
              anySynced = true;
              continue;
            }
          }
        }
        if (field.type === "date" || field.canonicalType === "date") {
          const parsed = this.parseDateParts(valStr);
          const iso = parsed ? parsed.iso : valStr;
          const day = parsed ? parsed.day : "";
          const month = parsed ? parsed.month : "";
          const year = parsed ? parsed.year : "";
          const nativeDateInput = (card ? card.querySelector('input[type="date"]') : null) || (el instanceof HTMLInputElement && el.type === "date" ? el : null);
          if (nativeDateInput) {
            this.setNativeInputValue(nativeDateInput, iso);
          }
          const combinedTextInput = card ? card.querySelector('input[type="text"].whsOnd[aria-label*="Hari, bulan, tahun" i], input[type="text"].whsOnd[aria-label*="Day, month, year" i]') : null;
          if (combinedTextInput) {
            this.setNativeInputValue(combinedTextInput, iso);
          }
          const dayInput = (card ? card.querySelector('input[name$="_day"], input[placeholder*="dd" i], input[aria-label*="Hari" i]:not([aria-label*="bulan" i])') : null) || (field.entryKeys?.[0] ? document.querySelector(`[name="${field.entryKeys[0]}_day"]`) : null);
          const monthInput = (card ? card.querySelector('input[name$="_month"], input[placeholder*="mm" i], input[aria-label*="Bulan" i]:not([aria-label*="tahun" i])') : null) || (field.entryKeys?.[0] ? document.querySelector(`[name="${field.entryKeys[0]}_month"]`) : null);
          const yearInput = (card ? card.querySelector('input[name$="_year"], input[placeholder*="yyyy" i], input[aria-label*="Tahun" i]:not([aria-label*="bulan" i])') : null) || (field.entryKeys?.[0] ? document.querySelector(`[name="${field.entryKeys[0]}_year"]`) : null);
          if (dayInput && day)
            this.setNativeInputValue(dayInput, day);
          if (monthInput && month)
            this.setNativeInputValue(monthInput, month);
          if (yearInput && year)
            this.setNativeInputValue(yearInput, year);
          if (field.entryKeys && field.entryKeys[0]) {
            const ek = field.entryKeys[0];
            this.updateExistingHiddenEntry(ek, iso);
            if (year)
              this.updateExistingHiddenEntry(`${ek}_year`, year);
            if (month)
              this.updateExistingHiddenEntry(`${ek}_month`, month);
            if (day)
              this.updateExistingHiddenEntry(`${ek}_day`, day);
          }
          anySynced = true;
          continue;
        }
        if (field.type === "select" || field.canonicalType === "dropdown" || el?.getAttribute("role") === "listbox" || el?.getAttribute("aria-haspopup") === "listbox") {
          const targetListbox = (card ? card.querySelector('[role="listbox"]') : null) || (el?.getAttribute("role") === "listbox" || el?.getAttribute("aria-haspopup") === "listbox" ? el : null);
          if (targetListbox) {
            await this.selectListboxOption(targetListbox, valStr);
          } else if (el && el.tagName.toLowerCase() === "select") {
            const selectEl = el;
            let matchedIdx = -1;
            for (let i = 0;i < selectEl.options.length; i++) {
              const opt = selectEl.options[i];
              if (opt.value.toLowerCase() === valStr.toLowerCase() || opt.text.toLowerCase() === valStr.toLowerCase() || opt.text.toLowerCase().includes(valStr.toLowerCase())) {
                matchedIdx = i;
                break;
              }
            }
            if (matchedIdx >= 0) {
              selectEl.selectedIndex = matchedIdx;
              selectEl.dispatchEvent(new Event("input", { bubbles: true }));
              selectEl.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
          if (field.entryKeys && field.entryKeys[0]) {
            this.updateExistingHiddenEntry(field.entryKeys[0], valStr);
          }
          anySynced = true;
          continue;
        }
        if (el) {
          el.focus();
          const role = el.getAttribute("role");
          const isAriaCheckbox = role === "checkbox" || role === "switch";
          const isAriaRadio = role === "radio";
          if (isAriaCheckbox) {
            const shouldBeTrue = typeof val === "boolean" ? val : ["true", "1", "ya", "yes", "on", "centang"].includes(valStr.toLowerCase());
            const isCurrentlyTrue = el.getAttribute("aria-checked") === "true";
            if (shouldBeTrue !== isCurrentlyTrue) {
              this.triggerSyntheticSelection(el);
            }
          } else if (isAriaRadio) {
            this.triggerSyntheticSelection(el);
          } else if (role === "listbox" || el.getAttribute("aria-haspopup") === "listbox") {
            await this.selectListboxOption(el, valStr);
          } else if (el.tagName.toLowerCase() === "select") {
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
            selectEl.dispatchEvent(new Event("change", { bubbles: true }));
          } else if (el.type === "checkbox" || el.type === "radio") {
            const inputEl = el;
            inputEl.checked = typeof val === "boolean" ? val : ["true", "1", "ya", "yes", "on", "centang"].includes(valStr.toLowerCase());
            inputEl.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            if (el.hasAttribute("disabled")) {
              el.disabled = false;
              el.removeAttribute("disabled");
              el.setAttribute("aria-disabled", "false");
            }
            this.setNativeInputValue(el, valStr);
            if (field.entryKeys && field.entryKeys.length > 0) {
              for (const entryKey of field.entryKeys) {
                this.updateExistingHiddenEntry(entryKey, valStr);
              }
            } else if (card) {
              const hiddenInputs = card.querySelectorAll('input[type="hidden"]');
              hiddenInputs.forEach((h) => {
                if (h.name && h.name.startsWith("entry.") && !h.name.endsWith("_sentinel")) {
                  this.setNativeInputValue(h, valStr);
                }
              });
            }
          }
          el.blur();
          anySynced = true;
        }
      } catch (e) {
        console.warn(`[AIRA Syncer] Failed to sync field ${field.id}:`, e);
      }
    }
    return anySynced;
  }
  parseDateParts(valStr) {
    if (!valStr)
      return null;
    const trimmed = valStr.trim();
    const multiMatch = trimmed.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
    if (multiMatch) {
      const year = multiMatch[1];
      const month = multiMatch[2].padStart(2, "0");
      const day = multiMatch[3].padStart(2, "0");
      return { day, month, year, iso: `${year}-${month}-${day}` };
    }
    const monthMap = {
      jan: "01",
      januari: "01",
      january: "01",
      feb: "02",
      februari: "02",
      february: "02",
      mar: "03",
      maret: "03",
      march: "03",
      apr: "04",
      april: "04",
      mei: "05",
      may: "05",
      jun: "06",
      juni: "06",
      june: "06",
      jul: "07",
      juli: "07",
      july: "07",
      agu: "08",
      agt: "08",
      agustus: "08",
      aug: "08",
      august: "08",
      sep: "09",
      september: "09",
      okt: "10",
      oktober: "10",
      oct: "10",
      october: "10",
      nov: "11",
      november: "11",
      des: "12",
      desember: "12",
      dec: "12",
      december: "12"
    };
    const dmy = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (dmy) {
      const day = dmy[1].padStart(2, "0");
      const month = dmy[2].padStart(2, "0");
      const year = dmy[3];
      return { day, month, year, iso: `${year}-${month}-${day}` };
    }
    const textDmy = trimmed.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/);
    if (textDmy) {
      const day = textDmy[1].padStart(2, "0");
      const mStr = textDmy[2].toLowerCase();
      const month = monthMap[mStr];
      const year = textDmy[3];
      if (month)
        return { day, month, year, iso: `${year}-${month}-${day}` };
    }
    return null;
  }
  async selectListboxOption(listboxEl, targetText) {
    try {
      const targetLower = targetText.toLowerCase().trim();
      const isExpanded = listboxEl.getAttribute("aria-expanded") === "true";
      if (!isExpanded) {
        listboxEl.focus();
        listboxEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        listboxEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        listboxEl.click();
        await new Promise((r) => setTimeout(r, 120));
      }
      let clicked = false;
      for (let attempt = 0;attempt < 2; attempt++) {
        const optEls = Array.from(document.querySelectorAll('[role="option"], .MocG8c[data-value], .OA00nd .MocG8c, .exportSelectPopup [role="option"]'));
        let matchedOpt = optEls.find((opt) => {
          const val = (opt.getAttribute("data-value") || "").toLowerCase().trim();
          const text = (opt.textContent || "").toLowerCase().trim();
          return val === targetLower || text === targetLower;
        });
        if (!matchedOpt) {
          matchedOpt = optEls.find((opt) => {
            const val = (opt.getAttribute("data-value") || "").toLowerCase().trim();
            const text = (opt.textContent || "").toLowerCase().trim();
            return val && (val.includes(targetLower) || targetLower.includes(val)) || text && (text.includes(targetLower) || targetLower.includes(text));
          });
        }
        if (matchedOpt) {
          matchedOpt.focus();
          matchedOpt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          matchedOpt.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
          matchedOpt.click();
          clicked = true;
          break;
        }
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      listboxEl.setAttribute("data-value", targetText);
      const textEl = listboxEl.querySelector(".vR13fe, .quantumWizMenuPaperselectDropDownText, span");
      if (textEl) {
        textEl.textContent = targetText;
      }
      listboxEl.classList.remove("placeholder");
      listboxEl.setAttribute("aria-expanded", "false");
      return clicked;
    } catch (e) {
      console.warn("[AIRA Syncer] Listbox selection error:", e);
    }
    return false;
  }
  updateExistingHiddenEntry(entryKey, value) {
    if (!entryKey)
      return;
    try {
      const hidden = document.querySelector(`input[type="hidden"][name="${entryKey}"]`);
      if (hidden && !hidden.name.endsWith("_sentinel")) {
        hidden.value = value;
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (e) {
      console.warn(`[AIRA Syncer] updateExistingHiddenEntry failed for ${entryKey}:`, e);
    }
  }
  waitForFrame() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 50));
    });
  }
  triggerSyntheticSelection(el) {
    try {
      el.focus();
      el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      el.click();
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
      if ("checked" in el) {
        el.checked = true;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
    } catch (e) {
      try {
        el.click();
      } catch (err) {}
    }
  }
  setNativeInputValue(el, valStr) {
    try {
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setDescriptor = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setDescriptor) {
        setDescriptor.call(el, valStr);
      } else {
        el.value = valStr;
      }
      try {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: valStr }));
      } catch {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    } catch (e) {
      try {
        el.value = valStr;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      } catch (err) {}
    }
  }
  async submitHostForm(options = {}) {
    if (!options.skipValidation && this.activeForm) {
      for (const field of this.activeForm.fields) {
        const raw = this.answers[field.id] ?? (field.domId ? this.answers[field.domId] : undefined) ?? (field.entryKeys?.[0] ? this.answers[field.entryKeys[0]] : undefined);
        const validation = this.validateValue(field, raw === undefined || raw === null ? "" : String(raw));
        if (!validation.valid) {
          soundEffects.playError();
          return {
            success: false,
            message: validation.error || `Isian "${field.label}" belum valid.`
          };
        }
      }
    }
    await this.syncToHostDOM();
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
    if (!submitBtn) {
      const roleButtons = Array.from(document.querySelectorAll('[role="button"], button, .uArJbe, .l4EATb'));
      submitBtn = roleButtons.find((b) => {
        const text = (b.textContent || "").trim().toLowerCase();
        const aria = (b.getAttribute("aria-label") || "").trim().toLowerCase();
        return text === "kirim" || text === "submit" || text === "selesai" || text === "kirimkan" || aria === "kirim" || aria === "submit" || b.classList.contains("freebirdFormviewerViewNavigationSubmitButton");
      }) || null;
    }
    if (submitBtn) {
      try {
        this.triggerSyntheticSelection(submitBtn);
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
    wrap.style.cssText = "padding: 20px 18px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto;";
    const s = this.settings;
    wrap.innerHTML = `
      <div style="margin-bottom: 6px;">
        <h3 style="font-size: 18px; font-weight: 600; color: #1A1D20; margin: 0 0 4px 0; display: flex; align-items: center; gap: 8px;">
          <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 22px;">tune</span>
          <span>Pengaturan Layanan <span class="brand-aira"><em>A</em>IRA</span></span>
        </h3>
        <p style="font-size: 13px; color: #545454; margin: 0;">Konfigurasi suara, model kecerdasan buatan, dan pintasan sistem.</p>
      </div>

      <!-- CARD 1: Pintasan Keyboard Aksesibel -->
      <div class="aira-settings-card">
        <div style="font-size: 14.5px; font-weight: 600; color: #000000; display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
          <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 19px;">keyboard</span>
          <span>Pintasan Keyboard Aksesibel</span>
        </div>

        <div class="aira-kbd-item">
          <div>
            <div style="font-weight: 600; font-size: 13.5px; color: #2D3238;">Push to Talk (Bicara Cepat)</div>
            <div style="font-size: 12px; color: #6C757D;">Tahan untuk merekam suara, lepaskan untuk mengirim</div>
          </div>
          <span class="aira-keycap">Alt + S</span>
        </div>

        <div class="aira-kbd-item">
          <div>
            <div style="font-weight: 600; font-size: 13.5px; color: #2D3238;">Buka / Tutup Sidebar</div>
            <div style="font-size: 12px; color: #6C757D;">Toggle cepat tampilan sidebar asistensi AIRA</div>
          </div>
          <span class="aira-keycap">Alt + A</span>
        </div>

        <div class="aira-kbd-item" style="margin-bottom: 0;">
          <div>
            <div style="font-weight: 600; font-size: 13.5px; color: #2D3238;">Tutup Modal & Spotlight</div>
            <div style="font-size: 12px; color: #6C757D;">Batalkan fokus navigasi atau wizard formulir</div>
          </div>
          <span class="aira-keycap">Esc</span>
        </div>
      </div>

      <!-- CARD 2: Pengenalan Suara (STT) -->
      <div class="aira-settings-card">
        <div style="font-size: 14.5px; font-weight: 600; color: #000000; display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 19px;">mic</span>
          <span>Pengenalan Suara (Speech-to-Text)</span>
        </div>

        <div class="aira-form-group">
          <label class="aira-form-label" for="aira-set-sttprovider">Penyedia Pengenalan Suara:</label>
          <select id="aira-set-sttprovider" class="aira-form-control">
            <option value="whisper" ${!s.sttProvider || s.sttProvider === "whisper" ? "selected" : ""}>9Router Whisper STT (Akurat & Cepat)</option>
            <option value="webspeech" ${s.sttProvider === "webspeech" ? "selected" : ""}>Google Web Speech API Chrome (Fallback Offline)</option>
          </select>
        </div>

        <div id="aira-whisper-fields" style="display: ${s.sttProvider === "whisper" ? "flex" : "none"}; flex-direction: column; gap: 8px;">
          <div class="aira-form-group">
            <label class="aira-form-label" for="aira-set-whisperkey">Whisper API Key:</label>
            <input type="password" id="aira-set-whisperkey" class="aira-form-control" value="${s.whisperApiKey || "9router"}" placeholder="9router" />
          </div>
          <div class="aira-form-group" style="margin-bottom: 0;">
            <label class="aira-form-label" for="aira-set-whisperendpoint">Whisper Endpoint:</label>
            <input type="text" id="aira-set-whisperendpoint" class="aira-form-control" value="${s.whisperEndpoint || "https://9r.disra.net/v1/audio/transcriptions"}" />
          </div>
        </div>
      </div>

      <!-- CARD 3: Model AI (LLM) -->
      <div class="aira-settings-card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <div style="font-size: 14.5px; font-weight: 600; color: #000000; display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 19px;">smart_toy</span>
            <span>Model Kecerdasan Buatan (LLM)</span>
          </div>
          <div class="aira-switch" title="Aktifkan LLM">
            <input type="checkbox" id="aira-set-llmenabled" ${s.llmEnabled ? "checked" : ""} />
            <span class="aira-switch-slider"></span>
          </div>
        </div>

        <div class="aira-form-group">
          <label class="aira-form-label" for="aira-set-endpoint">Base URL / Endpoint:</label>
          <input type="text" id="aira-set-endpoint" class="aira-form-control" value="${s.llmEndpoint || ""}" placeholder="https://9r.disra.net/v1/chat/completions" />
        </div>

        <div class="aira-form-group">
          <label class="aira-form-label" for="aira-set-apikey">API Key LLM:</label>
          <input type="password" id="aira-set-apikey" class="aira-form-control" value="${s.llmApiKey || ""}" placeholder="sk-..." />
        </div>

        <div class="aira-form-group" style="margin-bottom: 0;">
          <label class="aira-form-label" for="aira-set-model">Nama Model:</label>
          <input type="text" id="aira-set-model" class="aira-form-control" value="${s.llmModel || "cx/gpt-5.6-luna"}" placeholder="cx/gpt-5.6-luna" />
        </div>
      </div>

      <!-- CARD 4: Suara Pembaca (TTS) -->
      <div class="aira-settings-card">
        <div style="font-size: 14.5px; font-weight: 600; color: #000000; display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 19px;">volume_up</span>
          <span>Suara Pembaca Teks (TTS)</span>
        </div>

        <div class="aira-form-group">
          <label class="aira-form-label" for="aira-set-ttsprovider">Penyedia Suara:</label>
          <select id="aira-set-ttsprovider" class="aira-form-control">
            <option value="elevenlabs" ${s.ttsProvider === "elevenlabs" ? "selected" : ""}>ElevenLabs (Sangat Natural & Ramah)</option>
            <option value="google" ${s.ttsProvider === "google" ? "selected" : ""}>Google TTS Indonesia (Cepat & Ringan)</option>
            <option value="microsoft" ${s.ttsProvider === "microsoft" ? "selected" : ""}>Microsoft TTS Indonesia</option>
          </select>
        </div>

        <div id="aira-elevenlabs-fields" style="display: ${s.ttsProvider === "elevenlabs" ? "flex" : "none"}; flex-direction: column; gap: 8px;">
          <div class="aira-form-group">
            <label class="aira-form-label" for="aira-set-elevenkey">ElevenLabs API Key:</label>
            <input type="password" id="aira-set-elevenkey" class="aira-form-control" value="${s.elevenlabsApiKey || ""}" placeholder="xi-..." />
          </div>
          <div class="aira-form-group">
            <label class="aira-form-label" for="aira-set-elevenvoice">Voice ID:</label>
            <input type="text" id="aira-set-elevenvoice" class="aira-form-control" value="${s.elevenlabsVoiceId || "pNInz6obpgDQGcFmaJgB"}" />
          </div>
        </div>

        <button type="button" class="aira-btn aira-btn-outline" id="aira-btn-test-tts" style="width: 100%; min-height: 44px; margin-top: 6px; font-size: 14px;">
          <span class="material-symbols-rounded" style="font-size: 18px;">volume_up</span>
          <span>Uji Coba Suara Asisten</span>
        </button>
      </div>
    `;
    this.bindEvents(wrap);
    return wrap;
  }
  bindEvents(wrap) {
    const save = async () => {
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
    const stt = q("#aira-set-sttprovider");
    if (stt)
      stt.value = s.sttProvider || "whisper";
    const whKey = q("#aira-set-whisperkey");
    if (whKey)
      whKey.value = s.whisperApiKey || "9router";
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
  activeTab = "home";
  onSendMessageCallback = null;
  onToggleVoiceOnlyCallback = null;
  onToggleVoiceInputCallback = null;
  currentFontScale = 100;
  currentControlScale = 100;
  unsubscribeStorage = null;
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
      if (this.activeTab !== "chat") {
        this.switchToTab("chat");
      }
      this.setLiveTranscription(interimText || "Mendengarkan ucapan Anda...");
    } else {
      this.setLiveTranscription("");
    }
  }
  toggle(open) {
    if (!this.drawerEl)
      return;
    const shouldOpen = open !== undefined ? open : this.drawerEl.classList.contains("aira-hidden");
    const triggerBtn = this.container?.querySelector(".aira-trigger-btn") || (typeof document !== "undefined" ? document.querySelector("#aira-root")?.shadowRoot?.querySelector(".aira-trigger-btn") : null);
    const rootHost = typeof document !== "undefined" ? document.querySelector("#aira-root") : null;
    if (shouldOpen) {
      this.drawerEl.classList.remove("aira-hidden");
      soundEffects.playStep();
      if (rootHost) {
        rootHost.setAttribute("data-sidebar-open", "true");
      }
      if (triggerBtn) {
        triggerBtn.classList.add("aira-hidden");
        triggerBtn.style.setProperty("display", "none", "important");
      }
      try {
        document.documentElement.style.transition = "margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)";
        document.documentElement.style.marginRight = "400px";
      } catch (e) {}
      if (this.activeTab === "chat") {
        const input = this.drawerEl.querySelector("#aira-chat-text-input");
        setTimeout(() => input?.focus(), 150);
      }
    } else {
      this.drawerEl.classList.add("aira-hidden");
      sttService.stopListening();
      if (rootHost) {
        rootHost.setAttribute("data-sidebar-open", "false");
      }
      if (triggerBtn) {
        triggerBtn.classList.remove("aira-hidden");
        triggerBtn.style.removeProperty("display");
      }
      try {
        document.documentElement.style.marginRight = "0px";
      } catch (e) {}
    }
  }
  isOpen() {
    return !!this.drawerEl && !this.drawerEl.classList.contains("aira-hidden");
  }
  switchToTab(tab) {
    this.activeTab = tab;
    if (!this.drawerEl)
      return;
    const homeTabBtn = this.drawerEl.querySelector("#aira-tab-home");
    const chatTabBtn = this.drawerEl.querySelector("#aira-tab-chat");
    const settingsTabBtn = this.drawerEl.querySelector("#aira-tab-settings");
    const homeView = this.drawerEl.querySelector("#aira-home-view");
    const chatView = this.drawerEl.querySelector("#aira-chat-view");
    const settingsWrap = this.drawerEl.querySelector("#aira-settings-view-wrap");
    homeTabBtn?.classList.toggle("aira-active", tab === "home");
    chatTabBtn?.classList.toggle("aira-active", tab === "chat");
    settingsTabBtn?.classList.toggle("aira-active", tab === "settings");
    if (homeView)
      homeView.style.display = tab === "home" ? "flex" : "none";
    if (chatView)
      chatView.style.display = tab === "chat" ? "flex" : "none";
    if (settingsWrap)
      settingsWrap.style.display = tab === "settings" ? "block" : "none";
    if (tab === "chat") {
      const stream = this.drawerEl.querySelector("#aira-messages-stream");
      if (stream)
        stream.scrollTop = stream.scrollHeight;
      const input = this.drawerEl.querySelector("#aira-chat-text-input");
      setTimeout(() => input?.focus(), 150);
    } else if (tab === "settings" && settingsWrap) {
      if (settingsWrap.children.length === 0) {
        settingsPanel.init(settingsWrap).then(() => {
          settingsWrap.appendChild(settingsPanel.render());
        });
      }
    }
    soundEffects.playStep();
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
    if (this.activeTab !== "chat") {
      this.switchToTab("chat");
    }
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
            <span class="material-symbols-rounded" style="font-size: 16px;">volume_up</span>
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
    drawer.className = "aira-chat-drawer aira-sidebar-frame aira-hidden";
    const dateStr = new Date().toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
    drawer.innerHTML = `
      <!-- Extension Top Bar (Dark Bar #2D3238) -->
      <div class="aira-sidebar-topbar">
        <div class="aira-topbar-brand">
          <span class="aira-logotype aira-logotype--gradient aira-brand-title" aria-label="AIRA">
            <span class="letter-a">A</span><span class="letters-ira">IRA</span>
          </span>
        </div>
        <div class="aira-topbar-actions">
          <button type="button" class="aira-topbar-icon-btn" id="aira-btn-toggle-voiceonly" title="Toggle Mode Suara Penuh (Alt+A) | Push to Talk (Alt+S)" aria-label="Toggle Voice Only">
            <span class="material-symbols-rounded">mic</span>
          </button>
          <button type="button" class="aira-topbar-icon-btn" id="aira-btn-mute" title="Mute Suara / Berhenti Bicara" aria-label="Stop Voice">
            <span class="material-symbols-rounded">volume_up</span>
          </button>
          <button type="button" class="aira-topbar-icon-btn" id="aira-btn-minimize" title="Tutup Sidebar" aria-label="Tutup Sidebar">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      </div>

      <!-- Inner Viewport Card -->
      <div class="aira-sidebar-viewport">
        <!-- 3 Tabs Navigation -->
        <div class="aira-tabs-nav">
          <button type="button" class="aira-tab-btn aira-active" id="aira-tab-home">
            <span class="material-symbols-rounded" style="font-size: 18px;">home</span>
            <span>Beranda</span>
          </button>
          <button type="button" class="aira-tab-btn" id="aira-tab-chat">
            <span class="material-symbols-rounded" style="font-size: 18px;">chat</span>
            <span>Percakapan</span>
          </button>
          <button type="button" class="aira-tab-btn" id="aira-tab-settings">
            <span class="material-symbols-rounded" style="font-size: 18px;">settings</span>
            <span>Pengaturan</span>
          </button>
        </div>

        <!-- Tab Body Container -->
        <div id="aira-tab-content" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative;">
          
          <!-- TAB 1: HOME VIEW (Aksi Cepat) -->
          <div id="aira-home-view" class="aira-panel-home" style="display: flex;">
            <h2 class="aira-panel-hero-title">
              <span class="aira-hero-line-1"><span class="letter-a">A</span>IRA Siap</span><br>
              <span class="aira-hero-line-2">Membantu!</span>
            </h2>

            <div class="aira-info-header">
              <span class="material-symbols-rounded aira-info-icon" style="font-size: 20px;">info</span>
              <span>Bagaimana <span class="brand-aira"><em>A</em>IRA</span> dapat membantumu?</span>
            </div>

            <!-- Action Card 1: Navigasi Cepat -->
            <button type="button" class="aira-action-card" data-action="nav">
              <div class="aira-action-card__title">Temukan halaman yang kamu cari</div>
              <div class="aira-action-card__desc">Navigasi cepat ke menu, artikel, atau layanan penting di situs ini.</div>
            </button>

            <!-- Action Card 2: Form Assistant -->
            <button type="button" class="aira-action-card" data-action="form">
              <div class="aira-action-card__title">Bantu isi formulir</div>
              <div class="aira-action-card__desc">Bimbingan suara otomatis untuk mengisi kolom input satu per satu.</div>
            </button>

            <!-- Action Card 3: Summary -->
            <button type="button" class="aira-action-card" data-action="summary">
              <div class="aira-action-card__title">Jelaskan & Ringkas Situs Ini</div>
              <div class="aira-action-card__desc">Dapatkan ringkasan poin-poin penting isi halaman web saat ini.</div>
            </button>

            <!-- CARD: Mode Suara Penuh (Voice Only) -->
            <div class="aira-settings-card aira-settings-card--highlight" style="margin-top: 4px;">
              <label class="aira-switch-row" for="aira-home-voiceonly">
                <div class="aira-switch-info">
                  <div class="aira-switch-title">
                    <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 20px;">mic</span>
                    <span>Mode Suara Penuh (Voice Only)</span>
                  </div>
                  <p class="aira-switch-desc">Kontrol seluruh web hanya lewat suara tanpa mouse (Alt+A / Alt+S)</p>
                </div>
                <div class="aira-switch">
                  <input type="checkbox" id="aira-home-voiceonly" />
                  <span class="aira-switch-slider"></span>
                </div>
              </label>
            </div>

            <!-- CARD: Aksesibilitas Halaman Web (WCAG) -->
            <div class="aira-settings-card">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                <span class="material-symbols-rounded" style="color: var(--figma-active-blue); font-size: 20px;">accessibility_new</span>
                <span style="font-size: 15px; font-weight: 600; color: #000000;">Aksesibilitas Halaman Web (WCAG)</span>
              </div>

              <!-- Ukuran Teks Halaman -->
              <div style="font-size: 13.5px; font-weight: 600; color: #2D3238; margin-bottom: 6px;">Ukuran Teks Halaman</div>
              <div class="aira-stepper-control">
                <button type="button" class="aira-stepper-btn" id="aira-step-decrease-font" title="Perkecil Ukuran Teks">
                  <span class="material-symbols-rounded" style="font-size: 18px;">remove</span> Perkecil
                </button>
                <span class="aira-stepper-value" id="aira-step-font-value">100%</span>
                <button type="button" class="aira-stepper-btn" id="aira-step-increase-font" title="Perbesar Ukuran Teks">
                  <span class="material-symbols-rounded" style="font-size: 18px;">add</span> Perbesar
                </button>
              </div>

              <!-- Ukuran Tombol & Kontrol Web -->
              <div style="font-size: 13.5px; font-weight: 600; color: #2D3238; margin: 10px 0 6px 0;">Ukuran Tombol & Input Web</div>
              <div class="aira-stepper-control">
                <button type="button" class="aira-stepper-btn" id="aira-step-decrease-ctrl" title="Perkecil Tombol & Input">
                  <span class="material-symbols-rounded" style="font-size: 18px;">remove</span> Perkecil
                </button>
                <span class="aira-stepper-value" id="aira-step-ctrl-value">100%</span>
                <button type="button" class="aira-stepper-btn" id="aira-step-increase-ctrl" title="Perbesar Tombol & Input">
                  <span class="material-symbols-rounded" style="font-size: 18px;">add</span> Perbesar
                </button>
              </div>

              <!-- Mode Kontras Tinggi -->
              <div style="border-top: 1px solid #ECEFF3; margin: 12px 0 10px 0;"></div>
              <label class="aira-switch-row" for="aira-home-contrast" style="margin-bottom: 12px;">
                <div class="aira-switch-info">
                  <div class="aira-switch-title">
                    <span class="material-symbols-rounded" style="font-size: 19px; color: #545454;">contrast</span>
                    <span>Kontras Tinggi (WCAG AAA)</span>
                  </div>
                  <p class="aira-switch-desc">Ubah latar hitam pekat & teks kuning kontras 19.5:1</p>
                </div>
                <div class="aira-switch">
                  <input type="checkbox" id="aira-home-contrast" />
                  <span class="aira-switch-slider"></span>
                </div>
              </label>

              <!-- Sensory Shield / Redam Animasi -->
              <label class="aira-switch-row" for="aira-home-motion">
                <div class="aira-switch-info">
                  <div class="aira-switch-title">
                    <span class="material-symbols-rounded" style="font-size: 19px; color: #545454;">motion_photos_off</span>
                    <span>Sensory Shield (Redam Animasi)</span>
                  </div>
                  <p class="aira-switch-desc">Meredam kedipan dan animasi berlebih di situs web</p>
                </div>
                <div class="aira-switch">
                  <input type="checkbox" id="aira-home-motion" />
                  <span class="aira-switch-slider"></span>
                </div>
              </label>
            </div>
          </div>

          <!-- TAB 2: CHAT VIEW -->
          <div id="aira-chat-view" style="flex: 1; display: none; flex-direction: column; overflow: hidden;">
            <div class="aira-messages-stream" id="aira-messages-stream">
              <div class="aira-date-divider">${dateStr}</div>
            </div>

            <!-- Quick Action Chips -->
            <div class="aira-quick-chips">
              <button type="button" class="aira-chip-btn" data-action="summary">
                <span class="material-symbols-rounded" style="font-size: 17px;">description</span>
                <span>Ringkas Halaman</span>
              </button>
              <button type="button" class="aira-chip-btn" data-action="form">
                <span class="material-symbols-rounded" style="font-size: 17px;">edit_document</span>
                <span>Bantu Isi Formulir</span>
              </button>
              <button type="button" class="aira-chip-btn" data-action="nav">
                <span class="material-symbols-rounded" style="font-size: 17px;">explore</span>
                <span>Cari Menu Layanan</span>
              </button>
            </div>

            <!-- Real-Time Speech Bar -->
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
                <span class="material-symbols-rounded">mic</span>
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

          <!-- TAB 3: SETTINGS VIEW -->
          <div id="aira-settings-view-wrap" style="display: none; flex: 1; overflow-y: auto;"></div>
        </div>
      </div>
    `;
    this.drawerEl = drawer;
    this.container.appendChild(drawer);
    this.bindEvents();
    this.initAccessibilityControls();
    this.addMessage("assistant", "Halo! Saya AIRA, asisten adaptif Anda. Anda dapat mengetik pertanyaan, mengklik tombol mikrofon, atau menahan tombol Alt + S (Push to Talk) untuk berbicara kapan saja.", false);
    this.switchToTab("home");
  }
  async initAccessibilityControls() {
    if (!this.drawerEl)
      return;
    const fontValueEl = this.drawerEl.querySelector("#aira-step-font-value");
    const fontDecBtn = this.drawerEl.querySelector("#aira-step-decrease-font");
    const fontIncBtn = this.drawerEl.querySelector("#aira-step-increase-font");
    const ctrlValueEl = this.drawerEl.querySelector("#aira-step-ctrl-value");
    const ctrlDecBtn = this.drawerEl.querySelector("#aira-step-decrease-ctrl");
    const ctrlIncBtn = this.drawerEl.querySelector("#aira-step-increase-ctrl");
    const voiceOnlySwitch = this.drawerEl.querySelector("#aira-home-voiceonly");
    const contrastSwitch = this.drawerEl.querySelector("#aira-home-contrast");
    const motionSwitch = this.drawerEl.querySelector("#aira-home-motion");
    const updateUIFromSettings = (s) => {
      this.currentFontScale = s.fontScale ?? (s.fontSize === "large" ? 125 : s.fontSize === "xlarge" ? 150 : 100);
      this.currentControlScale = s.controlScale ?? (s.controlSize === "large" ? 125 : s.controlSize === "xlarge" ? 150 : 100);
      if (fontValueEl)
        fontValueEl.innerText = `${this.currentFontScale}%`;
      if (ctrlValueEl)
        ctrlValueEl.innerText = `${this.currentControlScale}%`;
      if (voiceOnlySwitch)
        voiceOnlySwitch.checked = !!s.voiceOnlyMode;
      if (contrastSwitch)
        contrastSwitch.checked = !!s.highContrast;
      if (motionSwitch)
        motionSwitch.checked = !!s.reduceMotion;
      this.updateVoiceOnlyBadge(!!s.voiceOnlyMode);
    };
    try {
      const s = await storageManager.getSettings();
      updateUIFromSettings(s);
    } catch (e) {}
    this.unsubscribeStorage = storageManager.subscribe((newSettings) => {
      updateUIFromSettings(newSettings);
    });
    fontDecBtn?.addEventListener("click", async () => {
      const newScale = Math.max(80, this.currentFontScale - 10);
      this.currentFontScale = newScale;
      if (fontValueEl)
        fontValueEl.innerText = `${newScale}%`;
      await storageManager.saveSettings({ fontScale: newScale });
      soundEffects.playStep();
    });
    fontIncBtn?.addEventListener("click", async () => {
      const newScale = Math.min(180, this.currentFontScale + 10);
      this.currentFontScale = newScale;
      if (fontValueEl)
        fontValueEl.innerText = `${newScale}%`;
      await storageManager.saveSettings({ fontScale: newScale });
      soundEffects.playStep();
    });
    ctrlDecBtn?.addEventListener("click", async () => {
      const newScale = Math.max(100, this.currentControlScale - 10);
      this.currentControlScale = newScale;
      if (ctrlValueEl)
        ctrlValueEl.innerText = `${newScale}%`;
      await storageManager.saveSettings({ controlScale: newScale });
      soundEffects.playStep();
    });
    ctrlIncBtn?.addEventListener("click", async () => {
      const newScale = Math.min(200, this.currentControlScale + 10);
      this.currentControlScale = newScale;
      if (ctrlValueEl)
        ctrlValueEl.innerText = `${newScale}%`;
      await storageManager.saveSettings({ controlScale: newScale });
      soundEffects.playStep();
    });
    voiceOnlySwitch?.addEventListener("change", async () => {
      const isChecked = voiceOnlySwitch.checked;
      await storageManager.saveSettings({ voiceOnlyMode: isChecked });
      this.updateVoiceOnlyBadge(isChecked);
      soundEffects.playStep();
    });
    contrastSwitch?.addEventListener("change", async () => {
      await storageManager.saveSettings({ highContrast: contrastSwitch.checked });
      soundEffects.playStep();
    });
    motionSwitch?.addEventListener("change", async () => {
      await storageManager.saveSettings({ reduceMotion: motionSwitch.checked });
      soundEffects.playStep();
    });
  }
  bindEvents() {
    if (!this.drawerEl)
      return;
    this.drawerEl.querySelector("#aira-tab-home")?.addEventListener("click", () => {
      this.switchToTab("home");
    });
    this.drawerEl.querySelector("#aira-tab-chat")?.addEventListener("click", () => {
      this.switchToTab("chat");
    });
    this.drawerEl.querySelector("#aira-tab-settings")?.addEventListener("click", () => {
      this.switchToTab("settings");
    });
    this.drawerEl.querySelectorAll(".aira-action-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        const action = e.currentTarget.getAttribute("data-action");
        if (action === "nav") {
          this.executeQuickAction("Tunjukkan menu atau tombol utama di halaman ini");
        } else if (action === "form") {
          this.executeQuickAction("Bantu saya mengisi formulir di halaman ini");
        } else if (action === "summary") {
          this.executeQuickAction("Tolong rangkum isi halaman ini");
        }
      });
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
          this.executeQuickAction("Tolong rangkum isi halaman ini");
        } else if (action === "form") {
          this.executeQuickAction("Bantu saya mengisi formulir di halaman ini");
        } else if (action === "nav") {
          this.executeQuickAction("Tunjukkan menu atau tombol utama di halaman ini");
        }
      });
    });
  }
  executeQuickAction(text) {
    this.switchToTab("chat");
    this.addMessage("user", text, false);
    if (this.onSendMessageCallback) {
      this.onSendMessageCallback(text);
    }
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
  destroy() {
    if (this.unsubscribeStorage) {
      this.unsubscribeStorage();
      this.unsubscribeStorage = null;
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
  editingFromSummary = false;
  confirmationActive = false;
  confirmApprove = null;
  activeSessionId = null;
  activeForm = null;
  activeCompactDom;
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
      if (!this.isOpen())
        return;
      if (e.key === "Escape" || e.code === "Escape") {
        this.close();
        return;
      }
      if (this.confirmationActive) {
        if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          e.stopPropagation();
          this.confirmApprove?.();
          return;
        }
        if (e.key === "Backspace" || e.code === "Backspace") {
          e.preventDefault();
          e.stopPropagation();
          const card = this.modalEl?.querySelector(".aira-wizard-card");
          if (card) {
            this.retryAnswerInput(card);
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", this.escKeyListener, true);
  }
  isOpen() {
    return !!this.modalEl && !!this.container?.contains(this.modalEl);
  }
  isVoiceActive() {
    return this.isProcessingVoiceInput || sttService.isListening();
  }
  isServerDriven() {
    return this.isServerMode && !!this.activeSessionId;
  }
  async startVoiceInput() {
    if (!this.isOpen() || this.isProcessingVoiceInput)
      return;
    const card = this.modalEl?.querySelector(".aira-wizard-card");
    const voiceBtn = card?.querySelector("#aira-wizard-voice-btn") || card?.querySelector("#aira-summary-voice-btn");
    const inputEl = card?.querySelector("#aira-step-input") || card?.querySelector("#aira-summary-input");
    const controlEl = card?.querySelector("#aira-field-control");
    const errorSlot = card?.querySelector("#aira-wizard-error-slot") || card?.querySelector("#aira-summary-error-slot");
    const voiceText = voiceBtn?.querySelector(".aira-voice-btn-text");
    if (!voiceBtn || !voiceText)
      return;
    if (this.confirmationActive && card) {
      this.confirmationActive = false;
      this.confirmApprove = null;
      const confirmBar = card.querySelector("#aira-confirm-bar");
      const nextBtn = card.querySelector("#aira-wizard-next");
      if (confirmBar)
        confirmBar.style.display = "none";
      if (nextBtn)
        nextBtn.disabled = false;
      ttsService.stop();
    }
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
    if (!state || !inputEl && !controlEl || !errorSlot)
      return;
    voiceBtn.classList.add("aira-listening");
    voiceText.innerText = "Mendengarkan ucapan (Alt+S)...";
    errorSlot.innerHTML = "";
    this.isProcessingVoiceInput = true;
    this.onVoiceStateCallback?.(true, "Mendengarkan isian formulir...");
    const field = state.currentField;
    const fieldOptions = (field.options || []).filter(Boolean);
    const allowOther = !!(field.hasOther || field.otherAllowed);
    const contextParts = [`Pertanyaan: ${field.label}`];
    if (fieldOptions.length)
      contextParts.push(`Pilihan jawaban: ${fieldOptions.join(", ")}`);
    if (allowOther)
      contextParts.push("Pengguna boleh menjawab lain di luar pilihan tersebut");
    const sttContext = contextParts.join(". ") + ".";
    await sttService.startListening({
      manualStopOnly: false,
      vocabulary: allowOther ? [] : fieldOptions,
      prompt: sttContext,
      onInterim: (interim) => {
        if (controlEl)
          this.writeFieldControl(controlEl, interim);
        else if (inputEl)
          inputEl.value = interim;
        voiceText.innerText = `Mendengarkan: "${interim}"`;
        this.onVoiceStateCallback?.(true, interim);
      },
      onFinal: (finalText) => {
        if (controlEl)
          this.writeFieldControl(controlEl, finalText);
        else if (inputEl)
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
  commitVoiceAnswer(answer, options = {}) {
    const card = this.modalEl?.querySelector(".aira-wizard-card");
    const inputEl = card?.querySelector("#aira-step-input") || card?.querySelector("#aira-summary-input");
    const controlEl = card?.querySelector("#aira-field-control");
    const errorSlot = card?.querySelector("#aira-wizard-error-slot") || card?.querySelector("#aira-summary-error-slot");
    const state = formOrchestrator.getCurrentState();
    if (state?.isComplete) {
      if (controlEl)
        this.writeFieldControl(controlEl, answer);
      else if (inputEl)
        inputEl.value = answer;
      const lower = answer.toLowerCase();
      if (lower.includes("ya") || lower.includes("kirim") || lower.includes("benar") || lower.includes("setuju")) {
        card?.querySelector("#aira-summary-submit")?.click();
      } else {
        ttsService.speak("Silakan tekan tombol Kirim Formulir atau klik Ubah pada data yang ingin diperbaiki.");
      }
      return;
    }
    if (this.isServerMode && this.activeSessionId) {
      if (controlEl)
        this.writeFieldControl(controlEl, answer);
      else if (inputEl)
        inputEl.value = answer;
      if (!options.confirmed && state && card) {
        this.askAnswerConfirmation(card, state.currentField, answer, true);
        return;
      }
      this.handleServerTextInput(answer);
      return;
    }
    if (!state || !inputEl && !controlEl || !errorSlot)
      return;
    if (controlEl)
      this.writeFieldControl(controlEl, answer);
    else if (inputEl)
      inputEl.value = answer;
    if (!options.confirmed && card) {
      this.askAnswerConfirmation(card, state.currentField, answer, true);
      return;
    }
    this.applyAnswer(state.currentField, answer, card, errorSlot, controlEl);
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
      const durationMs = sttService.lastCaptureDurationMs;
      const state = formOrchestrator.getCurrentState();
      if (audioBlob && durationMs > 0 && durationMs < 900) {
        if (voiceText)
          voiceText.innerText = "Berikan pesan dengan suara (Alt+S)";
        soundEffects.playError();
        ttsService.speak("Rekaman terlalu singkat. Silakan bicara setelah nada, lalu tekan lagi untuk mengirim.");
        return;
      }
      if (audioBlob && this.activeSessionId) {
        const result = await agentService.transcribeForSession(this.activeSessionId, audioBlob, durationMs);
        if (!result && this.activeForm) {
          const recovered = await this.recoverServerSession();
          if (recovered) {
            if (voiceText)
              voiceText.innerText = "Sesi dipulihkan. Silakan coba lagi (Alt+S).";
            return;
          }
        }
        if (result) {
          const value = result.normalized || result.transcript;
          if (voiceText)
            voiceText.innerText = "Berikan pesan dengan suara (Alt+S)";
          if (state && card && !state.isComplete) {
            this.askAnswerConfirmation(card, state.currentField, value, true, true);
          } else {
            this.handleServerTextInput(value, true);
          }
          return;
        }
      }
      if (voiceText)
        voiceText.innerText = "Berikan pesan dengan suara (Alt+S)";
      if (sttService.isListening())
        sttService.stopListening();
      soundEffects.playError();
      ttsService.speak("Suara tidak terdengar jelas. Silakan coba lagi.");
      return;
    }
    if (sttService.isListening()) {
      sttService.stopListening();
    }
    this.isProcessingVoiceInput = false;
    this.onVoiceStateCallback?.(false);
  }
  async open(form) {
    this.activeForm = form;
    this.isProcessingVoiceInput = false;
    this.editingFromSummary = false;
    const isDeterministic = (form.fields || []).some((f) => !!f.canonicalType);
    let compactDom;
    if (!isDeterministic) {
      try {
        const targetContainer = (form && form.id ? domPruner.getElement(form.id) : null) || undefined;
        const pruned = domPruner.pruneFormForLLM(targetContainer);
        compactDom = pruned.compactHtml;
        this.activeCompactDom = compactDom;
        console.log(`[AIRA Wizard] Compact DOM prepared: ${pruned.elementCount} elements, ${compactDom ? compactDom.length : 0} chars`);
      } catch (e) {
        console.error("[AIRA Wizard] Failed to prune DOM for LLM:", e);
      }
    } else {
      this.activeCompactDom = undefined;
      console.log("[AIRA Wizard] Google Forms deterministic fields detected; skipping LLM form parsing.");
    }
    try {
      const prePopulatedAnswers = {};
      (form.fields || []).forEach((f) => {
        if (f.currentValue) {
          prePopulatedAnswers[f.id] = f.currentValue;
          if (f.domId && f.domId !== f.id)
            prePopulatedAnswers[f.domId] = f.currentValue;
        }
      });
      const session = await agentService.startSession(form, compactDom, {
        answers: Object.keys(prePopulatedAnswers).length > 0 ? prePopulatedAnswers : undefined,
        stepIndex: 0
      });
      if (session && session.session_id) {
        this.activeSessionId = session.session_id;
        this.isServerMode = true;
        this.lastAgentResponse = session;
        formOrchestrator["activeForm"] = form;
        formOrchestrator["answers"] = { ...prePopulatedAnswers, ...session.answers || {} };
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
    this.editingFromSummary = false;
    this.confirmationActive = false;
    this.confirmApprove = null;
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
      await formOrchestrator.syncToHostDOM(answersToSync);
    }
    const normStatus = (res.status || "").toLowerCase();
    if (normStatus === "review" || normStatus === "awaiting_confirmation" || normStatus === "reviewing") {
      this.renderServerSummary(res);
    } else if (normStatus === "completed") {
      await formOrchestrator.submitHostForm({ skipValidation: true });
      this.close();
    } else {
      await this.renderServerStep(res);
    }
  }
  async recoverServerSession() {
    if (!this.activeForm) {
      this.isServerMode = false;
      this.activeSessionId = null;
      return false;
    }
    console.warn("[AIRA Wizard] Server session lost, re-initiating session...");
    try {
      const resumeState = formOrchestrator.getCurrentState();
      const session = await agentService.startSession(this.activeForm, this.activeCompactDom, {
        answers: resumeState?.answers,
        stepIndex: resumeState?.currentStepIndex
      });
      if (session && session.session_id) {
        this.activeSessionId = session.session_id;
        this.isServerMode = true;
        this.lastAgentResponse = session;
        formOrchestrator["activeForm"] = this.activeForm;
        formOrchestrator["answers"] = { ...session.answers || {} };
        await this.handleAgentStepResponse(session);
        return true;
      }
    } catch (e) {
      console.warn("[AIRA Wizard] Session recovery failed:", e);
    }
    this.isServerMode = false;
    this.activeSessionId = null;
    ttsService.speak("Koneksi ke server terputus. Beralih ke mode pengisian lokal.");
    formOrchestrator.startForm(this.activeForm);
    return false;
  }
  async handleServerTextInput(val, alreadyExtracted = false) {
    if (!this.activeSessionId)
      return;
    const card = this.modalEl?.querySelector(".aira-wizard-card");
    const nextBtn = card?.querySelector("#aira-wizard-next");
    if (nextBtn)
      nextBtn.disabled = true;
    try {
      let res = await agentService.interactWithText(this.activeSessionId, val, alreadyExtracted);
      if (!res && this.activeForm) {
        console.warn("[AIRA Wizard] Session expired or server reloaded, re-initiating session...");
        const resumeState = formOrchestrator.getCurrentState();
        const newSession = await agentService.startSession(this.activeForm, this.activeCompactDom, {
          answers: resumeState?.answers,
          stepIndex: resumeState?.currentStepIndex
        });
        if (newSession && newSession.session_id) {
          this.activeSessionId = newSession.session_id;
          res = await agentService.interactWithText(this.activeSessionId, val, alreadyExtracted);
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
      ...fieldData || {},
      id: fieldData?.id || fieldDataDomId || `field_${res.step_index + 1}`,
      label: fieldData?.label || "Kolom Isian",
      type: fieldData?.type || "text",
      placeholder: fieldData?.placeholder || "",
      required: fieldData?.required ?? true,
      currentValue: res.answers && fieldData?.id && res.answers[fieldData.id] || fieldData?.currentValue || "",
      options: fieldData?.options || [],
      hint: res.field_hint || fieldData?.hint || ""
    };
    const formTitle = this.activeForm?.title || "Formulir";
    const getValidVal = (...candidates) => {
      for (const c of candidates) {
        if (c !== undefined && c !== null && String(c).trim() !== "") {
          return String(c).trim();
        }
      }
      return "";
    };
    const currentValue = getValidVal(res.answers?.[field.id], field.domId ? res.answers?.[field.domId] : undefined, field.entryKeys?.[0] ? res.answers?.[field.entryKeys[0]] : undefined, field.currentValue, fieldData?.currentValue, this.activeForm?.fields[res.step_index]?.currentValue);
    console.log(`[AIRA Wizard Step] \uD83C\uDFAF Step ${res.step_index + 1} ("${field.label}") -> final currentValue: "${currentValue}" (from res.answers: "${res.answers?.[field.id] || ""}", field.currentValue: "${field.currentValue || ""}")`);
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
      const hint = field.hint || (field.canonicalType ? this.defaultHintForField(field) : await llmService.explainFormField(field));
      const currentValue = state.answers[field.id] || (field.domId ? state.answers[field.domId] : "") || (field.entryKeys?.[0] ? state.answers[field.entryKeys[0]] : "") || field.currentValue || "";
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
      const promptText = field.canonicalType ? `Langkah ${stepNum}. ${field.label}. ${hint}` : `Langkah ${stepNum}. Masukkan ${field.label} Anda. ${hint}`;
      ttsService.speak(promptText);
      this.onInteractionCallback?.(promptText);
    }
    this.modalEl = overlay;
    this.container.appendChild(overlay);
  }
  defaultHintForField(field) {
    const canonical = field.canonicalType || "";
    const rowSuffix = field.gridRowLabel ? ` untuk baris "${field.gridRowLabel}"` : "";
    if (canonical === "multiple_choice_grid")
      return `Pilih satu opsi${rowSuffix}.`;
    if (canonical === "checkbox_grid")
      return `Pilih satu atau beberapa opsi${rowSuffix}.`;
    if (canonical === "grid_unknown")
      return `Pilih kolom${rowSuffix}.`;
    const isSingleChoice = ["radio", "linear_scale", "rating"].includes(field.type) || ["multiple_choice", "dropdown", "linear_scale", "rating"].includes(canonical);
    if (isSingleChoice)
      return "Pilih salah satu opsi yang sesuai.";
    const isMultiChoice = ["checkbox_group", "checkboxes"].includes(field.type) || ["checkboxes"].includes(canonical);
    if (isMultiChoice)
      return "Pilih satu atau lebih opsi yang sesuai.";
    if (field.type === "date" || canonical === "date")
      return "Sebutkan atau ketik tanggal yang diminta.";
    if (field.type === "time" || canonical === "time")
      return "Sebutkan atau ketik waktu yang diminta.";
    return "Ketik atau ucapkan jawaban Anda.";
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
    const isCanonical = !!field.canonicalType;
    const titleText = isCanonical ? field.label : `Masukkan ${field.label} Anda`;
    const toast = document.createElement("div");
    toast.className = "aira-portal-toast";
    toast.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px;">task_alt</span><span>Formulir Terdeteksi: ${formTitle}</span>`;
    overlay.appendChild(toast);
    const card = document.createElement("div");
    card.className = "aira-wizard-card";
    card.innerHTML = `
      <div class="aira-wizard-header">
        <div class="aira-brand">
          <span class="aira-logotype aira-logotype--gradient aira-brand-title" aria-label="AIRA">
            <span class="letter-a">A</span><span class="letters-ira">IRA</span>
          </span>
          <span class="aira-brand-badge">${formTitle}</span>
        </div>
        <button type="button" class="aira-icon-btn aira-close-wizard" title="Tutup Formulir (Esc)" aria-label="Tutup Formulir">
          <span class="material-symbols-rounded">close</span>
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
            ${titleText}
          </div>
          <button type="button" class="aira-read-aloud-btn" title="Bacakan pertanyaan" aria-label="Bacakan pertanyaan">
            <span class="material-symbols-rounded">volume_up</span>
          </button>
        </div>

        <div class="aira-wizard-hint">
          ${hint}
        </div>

        <div id="aira-wizard-error-slot"></div>

        <div id="aira-field-control-slot"></div>

        <button type="button" class="aira-big-voice-btn aira-voice-bar-btn" id="aira-wizard-voice-btn" title="Klik atau tahan Alt+S untuk bicara">
          <span class="material-symbols-rounded">mic</span>
          <span class="aira-voice-btn-text">Berikan pesan dengan suara (Alt+S)</span>
        </button>
      </div>

      <div class="aira-confirm-bar" id="aira-confirm-bar" style="display: none;">
        <div class="aira-confirm-text" id="aira-confirm-text"></div>
        <div class="aira-confirm-actions">
          <button type="button" class="aira-btn aira-btn-outline" id="aira-confirm-retry" title="Tekan Backspace untuk mengulangi">
            &#8635; Ulangi (Backspace)
          </button>
          <button type="button" class="aira-btn aira-btn-primary" id="aira-confirm-yes" title="Tekan Enter jika sudah benar">
            &#10003; Benar (Enter)
          </button>
        </div>
      </div>

      <div class="aira-wizard-footer">
        <button type="button" class="aira-btn aira-btn-outline" id="aira-wizard-prev" ${stepNum === 1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ""}>
          <span>← Kembali</span>
        </button>
        <button type="button" class="aira-btn aira-btn-primary" id="aira-wizard-next">
          <span>Lanjut ke ${stepNum < totalSteps ? `Langkah ${stepNum + 1}` : "Rangkuman"} →</span>
        </button>
      </div>
    `;
    const controlSlot = card.querySelector("#aira-field-control-slot");
    controlSlot.replaceWith(this.buildFieldControl(field, currentValue));
    overlay.appendChild(card);
    const controlEl = card.querySelector("#aira-field-control");
    const inputEl = controlEl.querySelector("#aira-step-input") || controlEl.querySelector('input:not([type="hidden"]), select, textarea');
    const voiceBtn = card.querySelector("#aira-wizard-voice-btn");
    const voiceText = voiceBtn.querySelector(".aira-voice-btn-text");
    const errorSlot = card.querySelector("#aira-wizard-error-slot");
    setTimeout(() => inputEl?.focus(), 150);
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
      const val = this.readFieldControl(controlEl);
      if (this.confirmationActive)
        return;
      await this.askAnswerConfirmation(card, field, val, false);
    });
    card.querySelector("#aira-confirm-yes")?.addEventListener("click", () => {
      this.confirmApprove?.();
    });
    card.querySelector("#aira-confirm-retry")?.addEventListener("click", () => {
      this.retryAnswerInput(card);
    });
    card.querySelector("#aira-wizard-prev")?.addEventListener("click", async () => {
      if (this.confirmationActive)
        return;
      if (isServerMode && this.activeSessionId) {
        const res = await agentService.stepBack(this.activeSessionId);
        if (res) {
          await this.handleAgentStepResponse(res);
        } else {
          await this.recoverServerSession();
        }
        return;
      }
      formOrchestrator.stageAnswer(field.id, this.readFieldControl(controlEl));
      formOrchestrator.previousStep();
    });
    controlEl.addEventListener("keydown", (e) => {
      const target = e.target;
      if (e.key === "Enter" && target.tagName.toLowerCase() !== "textarea") {
        e.preventDefault();
        if (this.confirmationActive) {
          this.confirmApprove?.();
        } else {
          card.querySelector("#aira-wizard-next")?.click();
        }
      }
    });
  }
  async askAnswerConfirmation(card, field, value, fromVoice, alreadyExtracted = false) {
    if (this.confirmationActive)
      return;
    const confirmBar = card.querySelector("#aira-confirm-bar");
    const confirmText = card.querySelector("#aira-confirm-text");
    const nextBtn = card.querySelector("#aira-wizard-next");
    const errorSlot = card.querySelector("#aira-wizard-error-slot");
    const controlEl = card.querySelector("#aira-field-control");
    if (!confirmBar || !confirmText) {
      await this.applyAnswer(field, value, card, errorSlot, controlEl, alreadyExtracted);
      return;
    }
    this.confirmationActive = true;
    confirmText.innerText = `${field.label}: "${value}" — apakah sudah benar?`;
    confirmBar.style.display = "flex";
    if (nextBtn)
      nextBtn.disabled = true;
    soundEffects.playStep();
    const prompt = `Anda mengisi ${field.label}: ${value}. Apakah sudah benar? Tekan Enter jika benar, atau tekan Backspace untuk mengulangi.`;
    ttsService.speak(prompt);
    const approve = () => {
      if (!this.confirmationActive)
        return;
      this.confirmationActive = false;
      this.confirmApprove = null;
      confirmBar.style.display = "none";
      if (nextBtn)
        nextBtn.disabled = false;
      soundEffects.playConfirmation();
      this.applyAnswer(field, value, card, errorSlot, controlEl, alreadyExtracted);
    };
    this.confirmApprove = approve;
  }
  retryAnswerInput(card) {
    this.confirmationActive = false;
    this.confirmApprove = null;
    sttService.stopListening();
    const confirmBar = card.querySelector("#aira-confirm-bar");
    const nextBtn = card.querySelector("#aira-wizard-next");
    const inputEl = card.querySelector("#aira-step-input") || card.querySelector('#aira-field-control input:not([type="hidden"]), #aira-field-control select, #aira-field-control textarea');
    if (confirmBar)
      confirmBar.style.display = "none";
    if (nextBtn)
      nextBtn.disabled = false;
    ttsService.stop();
    soundEffects.playStep();
    ttsService.speak("Silakan isi kembali.");
    setTimeout(() => {
      inputEl?.focus();
      if (inputEl instanceof HTMLInputElement) {
        inputEl.select();
      }
    }, 100);
  }
  async applyAnswer(field, value, card, errorSlot, controlEl, alreadyExtracted = false) {
    if (this.isServerMode && this.activeSessionId) {
      await this.handleServerTextInput(value, alreadyExtracted);
      return;
    }
    if (!errorSlot || !controlEl)
      return;
    if (this.editingFromSummary) {
      const setRes = formOrchestrator.setAnswer(field.id, value, false);
      if (!setRes.success) {
        this.showError(errorSlot, controlEl, setRes.error || "Format tidak valid");
        ttsService.speak(setRes.error || "Format tidak valid");
        return;
      }
      this.clearError(errorSlot, controlEl);
      this.onInteractionCallback?.(`Jawaban ${field.label}: ${value}`);
      this.editingFromSummary = false;
      const state = formOrchestrator.getCurrentState();
      formOrchestrator.goToStep(state ? state.totalSteps : 0);
      return;
    }
    const advRes = formOrchestrator.saveAndAdvance(field.id, value);
    if (!advRes.success) {
      this.showError(errorSlot, controlEl, advRes.error || "Format tidak valid");
      ttsService.speak(advRes.error || "Format tidak valid");
    } else {
      this.clearError(errorSlot, controlEl);
      this.onInteractionCallback?.(`Jawaban ${field.label}: ${value}`);
    }
  }
  buildFieldControl(field, currentValue) {
    const wrap = document.createElement("div");
    wrap.className = "aira-wizard-input-wrap";
    wrap.id = "aira-field-control";
    const options = Array.from(new Set((field.options || []).filter((option) => typeof option === "string" && option !== ""))).slice(0, 30);
    const canonical = field.canonicalType || "";
    const isSingleChoice = ["radio", "linear_scale", "rating"].includes(field.type) || ["multiple_choice", "linear_scale", "rating", "multiple_choice_grid"].includes(canonical);
    const isMultiChoice = ["checkbox_group", "checkboxes"].includes(field.type) || ["checkboxes", "checkbox_grid"].includes(canonical);
    const isSelect = field.type === "select" || canonical === "dropdown";
    const isParagraph = field.type === "textarea" || canonical === "paragraph";
    const hasOther = !!(field.hasOther || field.otherAllowed);
    if ((isSingleChoice || isMultiChoice) && options.length > 0) {
      const list = document.createElement("div");
      list.className = "aira-choice-list";
      list.setAttribute("role", isMultiChoice ? "group" : "radiogroup");
      list.setAttribute("aria-label", field.label);
      const selected = this.parseMultiValue(currentValue);
      options.forEach((option, index) => {
        const item = document.createElement("label");
        item.className = "aira-choice-item";
        const input = document.createElement("input");
        input.type = isMultiChoice ? "checkbox" : "radio";
        input.name = "aira-choice";
        input.className = "aira-choice-input";
        input.value = option;
        if (index === 0)
          input.id = "aira-step-input";
        if (selected.includes(option.toLowerCase()))
          input.checked = true;
        const text = document.createElement("span");
        text.className = "aira-choice-label";
        text.textContent = option;
        item.appendChild(input);
        item.appendChild(text);
        list.appendChild(item);
      });
      if (hasOther) {
        const item = document.createElement("label");
        item.className = "aira-choice-item aira-choice-other";
        const input = document.createElement("input");
        input.type = isMultiChoice ? "checkbox" : "radio";
        input.name = "aira-choice";
        input.className = "aira-choice-input";
        input.value = "__other_option__";
        const text = document.createElement("span");
        text.className = "aira-choice-label";
        text.textContent = "Lainnya:";
        const otherInput = document.createElement("input");
        otherInput.type = "text";
        otherInput.className = "aira-other-input";
        otherInput.placeholder = "Ketik jawaban lain...";
        otherInput.setAttribute("aria-label", `${field.label} lainnya`);
        const matchedStandard = options.some((opt) => selected.includes(opt.toLowerCase()));
        if (!matchedStandard && currentValue && currentValue.trim()) {
          input.checked = true;
          otherInput.value = currentValue.trim();
        }
        otherInput.addEventListener("input", () => {
          if (otherInput.value.trim())
            input.checked = true;
        });
        item.appendChild(input);
        item.appendChild(text);
        item.appendChild(otherInput);
        list.appendChild(item);
      }
      wrap.appendChild(list);
      return wrap;
    }
    if (isSelect && options.length > 0) {
      const select = document.createElement("select");
      select.className = "aira-wizard-input";
      select.id = "aira-step-input";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = field.placeholder || "Pilih salah satu opsi...";
      select.appendChild(placeholder);
      options.forEach((option) => {
        const opt = document.createElement("option");
        opt.value = option;
        opt.textContent = option;
        select.appendChild(opt);
      });
      if (currentValue) {
        const curLower = currentValue.toLowerCase().trim();
        const match = options.find((opt) => {
          const optLower = opt.toLowerCase().trim();
          return optLower === curLower || optLower.includes(curLower) || curLower.includes(optLower);
        });
        if (match)
          select.value = match;
      }
      wrap.appendChild(select);
      return wrap;
    }
    if (isParagraph) {
      const textarea = document.createElement("textarea");
      textarea.className = "aira-wizard-input";
      textarea.id = "aira-step-input";
      textarea.rows = 3;
      textarea.placeholder = field.placeholder || `Ketik jawaban ${field.label}...`;
      textarea.value = currentValue || "";
      wrap.appendChild(textarea);
      return wrap;
    }
    const input = document.createElement("input");
    const safeTypes = ["text", "tel", "email", "number", "date", "time"];
    const rawType = (field.type || "text").toLowerCase();
    input.type = safeTypes.includes(rawType) ? rawType : "text";
    input.className = "aira-wizard-input";
    input.id = "aira-step-input";
    input.placeholder = field.placeholder || (input.type === "date" ? "YYYY-MM-DD" : `Ketik atau ucapkan ${field.label}...`);
    if (input.type === "date" && currentValue) {
      const iso = this.parseDateToISO(currentValue);
      input.value = iso || currentValue;
    } else {
      input.value = currentValue || "";
    }
    input.autocomplete = "off";
    wrap.appendChild(input);
    return wrap;
  }
  parseMultiValue(value) {
    return (value || "").split(/[,|]/).map((part) => part.toLowerCase().trim()).filter(Boolean);
  }
  static levenshtein(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 0;i < rows; i++)
      dp[i][0] = i;
    for (let j = 0;j < cols; j++)
      dp[0][j] = j;
    for (let i = 1;i < rows; i++) {
      for (let j = 1;j < cols; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[a.length][b.length];
  }
  fuzzyChoiceMatch(value, options, cutoff = 0.75) {
    const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, "").trim();
    const normalized = normalize(value);
    if (!normalized)
      return null;
    let best = null;
    let bestScore = 0;
    for (const option of options) {
      const target = normalize(option);
      if (!target)
        continue;
      const distance = FormWizardComponent.levenshtein(normalized, target);
      const score = 1 - distance / Math.max(normalized.length, target.length);
      if (score > bestScore) {
        bestScore = score;
        best = option;
      }
    }
    return bestScore >= cutoff ? best : null;
  }
  readFieldControl(control) {
    const select = control.querySelector("select");
    if (select)
      return select.value.trim();
    const textarea = control.querySelector("textarea");
    if (textarea)
      return textarea.value.trim();
    const choices = Array.from(control.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    if (choices.length > 0) {
      const selected = choices.filter((choice) => choice.checked);
      if (selected.length === 0)
        return "";
      const otherInput = control.querySelector(".aira-other-input");
      return selected.map((choice) => {
        if (choice.value === "__other_option__") {
          return otherInput?.value.trim() || "Other";
        }
        return choice.value;
      }).join(", ").trim();
    }
    const input = control.querySelector("input");
    return input ? input.value.trim() : "";
  }
  parseDateToISO(valStr) {
    if (!valStr)
      return null;
    const trimmed = valStr.trim();
    const multiMatch = trimmed.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
    if (multiMatch) {
      const year = multiMatch[1];
      const month = multiMatch[2].padStart(2, "0");
      const day = multiMatch[3].padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    const monthMap = {
      jan: "01",
      januari: "01",
      january: "01",
      feb: "02",
      februari: "02",
      february: "02",
      mar: "03",
      maret: "03",
      march: "03",
      apr: "04",
      april: "04",
      mei: "05",
      may: "05",
      jun: "06",
      juni: "06",
      june: "06",
      jul: "07",
      juli: "07",
      july: "07",
      agu: "08",
      agt: "08",
      agustus: "08",
      aug: "08",
      august: "08",
      sep: "09",
      september: "09",
      okt: "10",
      oktober: "10",
      oct: "10",
      october: "10",
      nov: "11",
      november: "11",
      des: "12",
      desember: "12",
      dec: "12",
      december: "12"
    };
    const dmy = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (dmy) {
      return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    }
    const textDmy = trimmed.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/);
    if (textDmy) {
      const day = textDmy[1].padStart(2, "0");
      const mStr = textDmy[2].toLowerCase();
      const month = monthMap[mStr];
      const year = textDmy[3];
      if (month)
        return `${year}-${month}-${day}`;
    }
    return null;
  }
  writeFieldControl(control, value) {
    const select = control.querySelector("select");
    if (select) {
      const valLower = value.toLowerCase().trim();
      const match = Array.from(select.options).find((opt) => {
        const optVal = opt.value.toLowerCase().trim();
        const optText = opt.text.toLowerCase().trim();
        return optVal === valLower || optText === valLower || optText.includes(valLower) || valLower.includes(optText);
      });
      if (match)
        select.value = match.value;
      return;
    }
    const textarea = control.querySelector("textarea");
    if (textarea) {
      textarea.value = value;
      return;
    }
    const choices = Array.from(control.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    if (choices.length > 0) {
      const parts = this.parseMultiValue(value);
      const selectableOptions = choices.filter((choice) => choice.value !== "__other_option__").map((choice) => choice.value);
      let matched = false;
      choices.forEach((choice) => {
        if (choice.value === "__other_option__")
          return;
        const option = choice.value.toLowerCase();
        if (parts.some((part) => option === part || option.includes(part) || part.includes(option))) {
          choice.checked = true;
          matched = true;
        } else {
          choice.checked = false;
        }
      });
      if (!matched) {
        for (const part of parts) {
          const fuzzy = this.fuzzyChoiceMatch(part, selectableOptions);
          const el = fuzzy ? choices.find((choice) => choice.value === fuzzy) : null;
          if (el) {
            el.checked = true;
            matched = true;
          }
        }
      }
      const otherInput = control.querySelector(".aira-other-input");
      if (!matched && otherInput && value.trim()) {
        const otherChoice = choices.find((choice) => choice.value === "__other_option__");
        if (otherChoice)
          otherChoice.checked = true;
        otherInput.value = value;
      } else if (otherInput && matched) {
        otherInput.value = "";
      }
      return;
    }
    const input = control.querySelector("input");
    if (input) {
      if (input.type === "date" && value) {
        const iso = this.parseDateToISO(value);
        input.value = iso || value;
      } else {
        input.value = value;
      }
    }
  }
  showError(errorSlot, controlEl, errorMsg) {
    controlEl.classList.add("aira-input-error");
    const focusable = controlEl.querySelector("input, select, textarea");
    focusable?.classList.add("aira-input-error");
    errorSlot.innerHTML = `
      <div class="aira-error-card">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span>${errorMsg}</span>
      </div>
    `;
  }
  clearError(errorSlot, controlEl) {
    controlEl.classList.remove("aira-input-error");
    const focusable = controlEl.querySelector("input, select, textarea");
    focusable?.classList.remove("aira-input-error");
    errorSlot.innerHTML = "";
  }
  buildSummaryDOM(overlay, params) {
    const { formTitle, answers, isServerMode } = params;
    const card = document.createElement("div");
    card.className = "aira-wizard-card";
    let summaryItemsHtml = "";
    const fields = this.activeForm?.fields || formOrchestrator["activeForm"]?.fields || [];
    if (fields.length > 0) {
      fields.forEach((field, idx) => {
        const val = answers[field.id] ?? (field.domId ? answers[field.domId] : undefined) ?? field.currentValue ?? "";
        summaryItemsHtml += `
          <div class="aira-summary-item">
            <div class="aira-summary-info">
              <span class="aira-summary-label">${field.label}</span>
              <span class="aira-summary-val">${val || "-"}</span>
            </div>
            <button type="button" class="aira-summary-edit-btn" data-step="${idx}" data-field-id="${field.id}">
              Ubah
            </button>
          </div>
        `;
      });
    } else {
      const entries = Object.entries(answers).filter(([k]) => !k.startsWith("entry.") && !k.endsWith("_sentinel"));
      entries.forEach(([fieldId, val], idx) => {
        summaryItemsHtml += `
          <div class="aira-summary-item">
            <div class="aira-summary-info">
              <span class="aira-summary-label">${fieldId}</span>
              <span class="aira-summary-val">${val || "-"}</span>
            </div>
            <button type="button" class="aira-summary-edit-btn" data-step="${idx}" data-field-id="${fieldId}">
              Ubah
            </button>
          </div>
        `;
      });
    }
    const toast = document.createElement("div");
    toast.className = "aira-portal-toast";
    toast.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px;">fact_check</span><span>Rangkuman Pengisian: Periksa Data</span>`;
    overlay.appendChild(toast);
    card.innerHTML = `
      <div class="aira-wizard-header">
        <div class="aira-brand">
          <span class="aira-logotype aira-logotype--gradient aira-brand-title" aria-label="AIRA">
            <span class="letter-a">A</span><span class="letters-ira">IRA</span>
          </span>
          <span class="aira-brand-badge">Rangkuman Pengisian</span>
        </div>
        <button type="button" class="aira-icon-btn aira-close-wizard" title="Tutup (Esc)" aria-label="Tutup">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>

      <div class="aira-wizard-body">
        <div class="aira-wizard-title-wrap">
          <div class="aira-wizard-title">
            Periksa data Anda di bawah ini
          </div>
          <button type="button" class="aira-read-aloud-btn" id="aira-summary-read" title="Bacakan rangkuman" aria-label="Bacakan rangkuman">
            <span class="material-symbols-rounded">volume_up</span>
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

        <button type="button" class="aira-big-voice-btn aira-voice-bar-btn" id="aira-summary-voice-btn" title="Klik atau tahan Alt+S untuk bicara konfirmasi / koreksi">
          <span class="material-symbols-rounded">mic</span>
          <span class="aira-voice-btn-text">Konfirmasi Suara / Koreksi (Alt+S)</span>
        </button>
      </div>

      <div class="aira-wizard-footer">
        <button type="button" class="aira-btn aira-btn-outline" id="aira-summary-back">
          <span>← Kembali Edit</span>
        </button>
        <button type="button" class="aira-btn aira-btn-primary" id="aira-summary-submit">
          <span>Kirim Formulir Sekarang ✔</span>
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
        } else {
          await this.recoverServerSession();
        }
        return;
      }
      this.editingFromSummary = false;
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
          } else {
            await this.recoverServerSession();
          }
          return;
        }
        this.editingFromSummary = true;
        formOrchestrator.goToStep(step);
      });
    });
    card.querySelector("#aira-summary-submit")?.addEventListener("click", async () => {
      if (isServerMode && this.activeSessionId) {
        const res = await agentService.confirmSubmission(this.activeSessionId, "ya");
        if (res) {
          if (res.sync_payload) {
            await formOrchestrator.syncToHostDOM(res.sync_payload);
          }
          const submitRes = await formOrchestrator.submitHostForm({ skipValidation: true });
          this.close();
          soundEffects.playServerCue(res.audio_cue || "complete");
          const finalMsg = res.spoken_prompt || (submitRes.success ? "Data formulir berhasil diisi dan dikirimkan!" : submitRes.message);
          ttsService.speak(finalMsg);
          this.onInteractionCallback?.(finalMsg);
          return;
        }
      }
      const submitRes = await formOrchestrator.submitHostForm();
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
    let tooltipTop = rect.bottom + 16;
    if (tooltipTop + 160 > window.innerHeight) {
      tooltipTop = Math.max(10, rect.top - 120);
    }
    let tooltipLeft = Math.max(10, Math.min(rect.left, window.innerWidth - 460));
    tooltip.style.top = `${tooltipTop}px`;
    tooltip.style.left = `${tooltipLeft}px`;
    tooltip.innerHTML = `
      <div class="aira-spotlight-callout-brand">
        <span class="aira-logotype aira-logotype--gradient" aria-label="AIRA">
          <span class="letter-a">A</span><span class="letters-ira">IRA</span>
        </span>
      </div>
      <div class="aira-spotlight-callout-row">
        <button type="button" class="aira-spotlight-icon-circle aira-cancel-btn" title="Tutup Petunjuk (Esc)" aria-label="Tutup">
          <span class="material-symbols-rounded">close</span>
        </button>
        <button type="button" class="aira-spotlight-icon-circle aira-audio-btn" title="Dengarkan Suara" aria-label="Dengarkan">
          <span class="material-symbols-rounded">volume_up</span>
        </button>
        <div class="aira-spotlight-bubble">
          <span>${explanation}</span>
          <button type="button" class="aira-spotlight-confirm-btn aira-confirm-btn">
            Buka Sekarang →
          </button>
        </div>
      </div>
    `;
    tooltip.querySelector(".aira-audio-btn")?.addEventListener("click", () => {
      ttsService.speak(explanation);
    });
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
    this.shadowHost.setAttribute("data-sidebar-open", "false");
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
      formWizard.commitVoiceAnswer(finalText, { confirmed: submitAfterStop });
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
    const fontUrl = "https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400;500;600;700;800&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap";
    if (typeof document !== "undefined" && document.head && !document.getElementById("aira-google-fonts")) {
      const docFontLink = document.createElement("link");
      docFontLink.id = "aira-google-fonts";
      docFontLink.rel = "stylesheet";
      docFontLink.href = fontUrl;
      document.head.appendChild(docFontLink);
    }
    const shadowFontLink = document.createElement("link");
    shadowFontLink.rel = "stylesheet";
    shadowFontLink.href = fontUrl;
    this.shadowRoot.appendChild(shadowFontLink);
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
    btn.className = "aira-trigger-btn aira-logo-btn aira-logo-btn--active-blue";
    btn.setAttribute("aria-label", "Buka Asisten AIRA (Tekan Alt+A atau tahan Alt+S untuk bicara)");
    btn.title = "Buka Asisten AIRA (Alt+A) | Push to Talk (Alt+S)";
    btn.innerHTML = `
      <span class="btn-letter-a" aria-hidden="true">A</span>
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
      const toastMsg = isPureHold ? "Mendengarkan isian formulir (Lepaskan Alt+S untuk mengirim)..." : "Mendengarkan isian formulir (Tekan Alt+S lagi untuk selesai)...";
      this.showPttToast(toastMsg, false);
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
      formWizard.commitVoiceAnswer(value, { confirmed: true });
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
      const submitRes = await formOrchestrator.submitHostForm({ skipValidation: formWizard.isServerDriven() });
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
window.__AIRA_DIAGNOSTIC__ = () => {
  const forms = domPruner.extractPageOverview().forms;
  console.log("=== AIRA EXTENSION DIAGNOSTIC ===");
  if (!forms || forms.length === 0) {
    console.log("❌ Tidak ada form terdeteksi oleh AIRA");
    return;
  }
  console.log(`\uD83D\uDCCB Form: "${forms[0].title}" (${forms[0].fields.length} fields)`);
  forms[0].fields.forEach((f, i) => {
    const val = f.currentValue ? `✅ "${f.currentValue}"` : `❌ (kosong)`;
    console.log(`[Q${i + 1}] "${f.label}" (${f.type}) -> currentValue: ${val}`);
  });
};

/**
 * AIRA - Google Forms Deterministic Parser
 *
 * Parses the embedded `FB_PUBLIC_LOAD_DATA_` payload from Google Forms pages and
 * classifies questions exclusively from structural data (numeric type codes and
 * the nested grid discriminator). Question wording, option labels and semantic
 * meaning are never used to determine a type.
 *
 * Fail-closed policy: unknown/inconsistent structures produce `unknown` /
 * `grid_unknown` with a diagnostic while preserving the original `type_code`.
 */

export type CanonicalQuestionType =
  | 'short_answer'
  | 'paragraph'
  | 'multiple_choice'
  | 'dropdown'
  | 'checkboxes'
  | 'linear_scale'
  | 'date'
  | 'time'
  | 'file_upload'
  | 'rating'
  | 'multiple_choice_grid'
  | 'checkbox_grid'
  | 'grid_unknown'
  | 'unknown';

export interface CanonicalGridRow {
  label: string;
  entry_id: number;
  entry_key: string;
  required: boolean;
}

export interface CanonicalQuestion {
  item_id: number | null;
  title: string;
  description: string | null;
  type_code: number | null;
  type: CanonicalQuestionType;
  entry_ids: number[];
  entry_keys: string[];
  required: boolean;
  options: string[] | null;
  other_allowed: boolean;
  rows: CanonicalGridRow[] | null;
  columns: string[] | null;
  validation: unknown;
  diagnostic: string | null;
}

export interface GoogleFormsParseResult {
  form_title: string | null;
  questions: CanonicalQuestion[];
  diagnostic: string | null;
}

export type GridDomConsistency = 'match' | 'conflict' | 'unavailable';

const TYPE_CODE_MAP: Record<number, CanonicalQuestionType> = {
  0: 'short_answer',
  1: 'paragraph',
  2: 'multiple_choice',
  3: 'dropdown',
  4: 'checkboxes',
  5: 'linear_scale',
  9: 'date',
  10: 'time',
  13: 'file_upload',
  18: 'rating'
};

const UNRECOGNIZED_TYPE_DIAGNOSTIC = 'Unrecognized FB_PUBLIC_LOAD_DATA_ question type code';
const GRID_DISCRIMINATOR_DIAGNOSTIC = 'Grid subtype discriminator missing or inconsistent';
const GRID_DOM_CONFLICT_DIAGNOSTIC =
  'Structural conflict: payload grid discriminator disagrees with DOM control roles';

function normalizeRequired(raw: unknown): boolean {
  if (raw === 1 || raw === true) return true;
  if (raw === 0 || raw === false) return false;
  return false;
}

function toEntryId(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function toEntryKey(entryId: number | null): string | null {
  return entryId === null ? null : `entry.${entryId}`;
}

/**
 * String-aware balanced bracket extraction. Never uses a lazy regex because the
 * payload contains nested arrays and bracket characters inside string literals.
 */
export function extractBalancedArray(
  source: string,
  startIndex: number
): { raw: string; endIndex: number } | null {
  if (source[startIndex] !== '[') return null;

  let depth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return { raw: source.slice(startIndex, i + 1), endIndex: i };
      }
    }
  }

  return null;
}

/**
 * Locates `var FB_PUBLIC_LOAD_DATA_ = [...]` and returns the parsed array.
 */
export function extractPublicLoadData(source: string): {
  value: unknown[] | null;
  raw: string | null;
  diagnostic: string | null;
} {
  const marker = 'FB_PUBLIC_LOAD_DATA_';
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    return { value: null, raw: null, diagnostic: 'FB_PUBLIC_LOAD_DATA_ not found' };
  }

  const equalsIndex = source.indexOf('=', markerIndex + marker.length);
  if (equalsIndex === -1) {
    return { value: null, raw: null, diagnostic: 'FB_PUBLIC_LOAD_DATA_ assignment not found' };
  }

  const arrayStart = source.indexOf('[', equalsIndex + 1);
  if (arrayStart === -1) {
    return { value: null, raw: null, diagnostic: 'FB_PUBLIC_LOAD_DATA_ array not found' };
  }

  const extracted = extractBalancedArray(source, arrayStart);
  if (!extracted) {
    return { value: null, raw: null, diagnostic: 'FB_PUBLIC_LOAD_DATA_ array is not balanced' };
  }

  try {
    const parsed = JSON.parse(extracted.raw);
    if (!Array.isArray(parsed)) {
      return { value: null, raw: extracted.raw, diagnostic: 'FB_PUBLIC_LOAD_DATA_ is not an array' };
    }
    return { value: parsed, raw: extracted.raw, diagnostic: null };
  } catch (e) {
    return {
      value: null,
      raw: extracted.raw,
      diagnostic: 'Failed to parse FB_PUBLIC_LOAD_DATA_ payload as JSON'
    };
  }
}

/** Returns the question-item array, normally `data[1][1]`. */
export function extractQuestionItems(data: unknown[]): unknown[] | null {
  const form = data[1];
  if (!Array.isArray(form)) return null;
  const items = form[1];
  return Array.isArray(items) ? items : null;
}

/** Form title lives at the structural slot `data[1][8]` when present. */
function extractFormTitle(data: unknown[]): string | null {
  const form = data[1];
  if (!Array.isArray(form)) return null;
  const title = form[8];
  return typeof title === 'string' && title.trim() ? title : null;
}

function isOtherOption(option: unknown[], label: string): boolean {
  if (label !== '') return false;
  // Google encodes "Other" as an empty-label option carrying a structural flag:
  // modern payloads use `["", null, null, null, true]`, older ones nest `[1, 0]`.
  return option.some((value, index) => {
    if (index === 0) return false;
    if (value === true || value === 1) return true;
    return Array.isArray(value) && value.length > 0 && (value[0] === 1 || value[0] === true);
  });
}

function parseOptions(rawChoices: unknown): { options: string[]; otherAllowed: boolean } {
  if (!Array.isArray(rawChoices)) return { options: [], otherAllowed: false };

  const options: string[] = [];
  let otherAllowed = false;

  for (const rawOption of rawChoices) {
    if (!Array.isArray(rawOption)) continue;
    const label = typeof rawOption[0] === 'string' ? rawOption[0] : '';
    if (isOtherOption(rawOption, label)) {
      otherAllowed = true;
      continue;
    }
    if (label !== '') options.push(label);
  }

  return { options, otherAllowed };
}

function parseColumns(rawColumns: unknown): string[] | null {
  if (!Array.isArray(rawColumns)) return null;
  return rawColumns.map((column) => {
    if (Array.isArray(column) && typeof column[0] === 'string') return column[0];
    return '';
  });
}

interface GridParse {
  type: CanonicalQuestionType;
  rows: CanonicalGridRow[];
  columns: string[] | null;
  diagnostic: string | null;
}

/**
 * Resolves type code 7 (grid) using the nested `row[11][0]` discriminator:
 * 0 -> multiple_choice_grid, 1 -> checkbox_grid. All discriminated rows must agree.
 */
function parseGrid(entries: unknown[]): GridParse {
  const rows: CanonicalGridRow[] = [];
  const modes: number[] = [];
  let columns: string[] | null = null;

  for (const rawRow of entries) {
    if (!Array.isArray(rawRow)) continue;

    const entryId = toEntryId(rawRow[0]);
    const required = normalizeRequired(rawRow[2]);
    const label = Array.isArray(rawRow[3]) && typeof rawRow[3][0] === 'string' ? rawRow[3][0] : '';

    if (columns === null) {
      const parsedColumns = parseColumns(rawRow[1]);
      if (parsedColumns && parsedColumns.length) columns = parsedColumns;
    }

    const discriminator = Array.isArray(rawRow[11]) ? rawRow[11][0] : undefined;
    if (discriminator === 0 || discriminator === false) modes.push(0);
    else if (discriminator === 1 || discriminator === true) modes.push(1);

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
    return { type: 'grid_unknown', rows: [], columns, diagnostic: GRID_DISCRIMINATOR_DIAGNOSTIC };
  }

  if (modes.length > 0 && modes.every((mode) => mode === 0)) {
    return { type: 'multiple_choice_grid', rows, columns, diagnostic: null };
  }
  if (modes.length > 0 && modes.every((mode) => mode === 1)) {
    return { type: 'checkbox_grid', rows, columns, diagnostic: null };
  }
  return { type: 'grid_unknown', rows, columns, diagnostic: GRID_DISCRIMINATOR_DIAGNOSTIC };
}

/**
 * Classifies a single `data[1][1]` item. Returns null for non-array items.
 */
export function parseQuestionItem(item: unknown): CanonicalQuestion | null {
  if (!Array.isArray(item)) return null;

  const itemId = toEntryId(item[0]);
  const title = typeof item[1] === 'string' ? item[1] : '';
  const description = typeof item[2] === 'string' && item[2].trim() ? item[2] : null;
  const typeCode = typeof item[3] === 'number' ? item[3] : null;
  const entries = Array.isArray(item[4]) ? item[4] : [];

  const base = {
    item_id: itemId,
    title,
    description,
    type_code: typeCode,
    entry_ids: [] as number[],
    entry_keys: [] as string[],
    required: false,
    options: null as string[] | null,
    other_allowed: false,
    rows: null as CanonicalGridRow[] | null,
    columns: null as string[] | null,
    validation: null as unknown,
    diagnostic: null as string | null
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

  const entry = entries.length > 0 && Array.isArray(entries[0]) ? (entries[0] as unknown[]) : null;
  const entryId = entry ? toEntryId(entry[0]) : null;
  const entryIds = entryId !== null ? [entryId] : [];
  const entryKey = toEntryKey(entryId);
  const required = entry ? normalizeRequired(entry[2]) : false;
  const validation = entry && Array.isArray(entry[3]) ? entry[3] : null;

  const mappedType = typeCode !== null ? TYPE_CODE_MAP[typeCode] : undefined;

  if (mappedType === undefined) {
    return {
      ...base,
      type: 'unknown',
      entry_ids: entryIds,
      entry_keys: entryKey ? [entryKey] : [],
      required,
      validation,
      diagnostic: typeCode === null ? 'Missing numeric question type code' : UNRECOGNIZED_TYPE_DIAGNOSTIC
    };
  }

  let options: string[] | null = null;
  let otherAllowed = false;

  if (
    mappedType === 'multiple_choice' ||
    mappedType === 'dropdown' ||
    mappedType === 'checkboxes' ||
    mappedType === 'linear_scale' ||
    mappedType === 'rating'
  ) {
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

/**
 * Optionally verifies a grid classification against the rendered DOM control
 * roles. DOM roles are only a consistency check; they never select the type.
 */
export function verifyGridWithDom(question: CanonicalQuestion, root: ParentNode | null): GridDomConsistency {
  if (!root) return 'unavailable';
  if (
    question.type !== 'multiple_choice_grid' &&
    question.type !== 'checkbox_grid' &&
    question.type !== 'grid_unknown'
  ) {
    return 'unavailable';
  }
  if (question.type === 'grid_unknown') return 'unavailable';

  const rowIds = (question.rows || []).map((row) => row.entry_id);
  if (!rowIds.length) return 'unavailable';

  let sawRadio = false;
  let sawCheckbox = false;

  for (const entryId of rowIds) {
    const elements = root.querySelectorAll(`[name="entry.${entryId}"]`);
    elements.forEach((el) => {
      const role = el.getAttribute('role');
      const type = (el as HTMLInputElement).type;
      if (role === 'checkbox' || type === 'checkbox') sawCheckbox = true;
      else if (role === 'radio' || type === 'radio') sawRadio = true;
    });
  }

  if (!sawRadio && !sawCheckbox) return 'unavailable';
  if (sawRadio && sawCheckbox) return 'unavailable';

  const domType: CanonicalQuestionType = sawCheckbox ? 'checkbox_grid' : 'multiple_choice_grid';
  return domType === question.type ? 'match' : 'conflict';
}

/**
 * Parses an array payload into canonical questions. `root` (optional) enables
 * grid DOM consistency verification. Question typing itself always uses the
 * payload's structural codes.
 */
export function parseGoogleFormPayload(data: unknown[], root?: ParentNode | null): GoogleFormsParseResult {
  const questions: CanonicalQuestion[] = [];
  const diagnostics: string[] = [];

  const items = extractQuestionItems(data);
  if (!items) {
    return {
      form_title: extractFormTitle(data),
      questions: [],
      diagnostic: 'FB_PUBLIC_LOAD_DATA_ question item array (data[1][1]) not found'
    };
  }

  for (const item of items) {
    const question = parseQuestionItem(item);
    if (!question) continue;

    if (root && (question.type === 'multiple_choice_grid' || question.type === 'checkbox_grid')) {
      const consistency = verifyGridWithDom(question, root);
      if (consistency === 'conflict') {
        question.type = 'grid_unknown';
        question.diagnostic = GRID_DOM_CONFLICT_DIAGNOSTIC;
        diagnostics.push(GRID_DOM_CONFLICT_DIAGNOSTIC);
      }
    }

    questions.push(question);
  }

  return {
    form_title: extractFormTitle(data),
    questions,
    diagnostic: diagnostics.length ? diagnostics.join('; ') : null
  };
}

/**
 * Convenience wrapper that scans a document's inline scripts for the payload.
 * Returns null when the page does not embed `FB_PUBLIC_LOAD_DATA_`.
 */
export function parseGoogleFormDocument(doc: Document = document): GoogleFormsParseResult | null {
  let source: string | null = null;

  const scripts = Array.from(doc.scripts || []);
  for (const script of scripts) {
    const text = script.textContent || '';
    if (text.includes('FB_PUBLIC_LOAD_DATA_')) {
      source = text;
      break;
    }
  }

  if (source === null) return null;

  const extraction = extractPublicLoadData(source);
  if (!extraction.value) {
    return { form_title: null, questions: [], diagnostic: extraction.diagnostic };
  }

  return parseGoogleFormPayload(extraction.value, doc);
}

/**
 * AIRA - Response Validation
 * Structural client-side validation for deterministic Google Forms fields plus
 * native input formats. Validation never changes a question's type; it only
 * checks the entered answer against the field's structural constraints.
 *
 * Fail-closed: rules that cannot be derived from structural metadata are not
 * enforced locally. The raw payload validation slot is preserved on the field
 * (`validation`) and forwarded to the agent server for proprietary rules.
 */

import { FormFieldMetadata } from '../types/dom';

export interface FieldValidationResult {
  valid: boolean;
  error?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})$/;
const TIME_PATTERN = /^([01]?\d|2[0-3])[:.][0-5]\d$/;

function isSingleChoice(field: FormFieldMetadata): boolean {
  return (
    ['radio', 'select', 'linear_scale', 'rating'].includes(field.type) ||
    ['multiple_choice', 'dropdown', 'linear_scale', 'rating', 'multiple_choice_grid'].includes(
      field.canonicalType || ''
    )
  );
}

function isMultiChoice(field: FormFieldMetadata): boolean {
  return (
    ['checkbox_group', 'checkboxes'].includes(field.type) ||
    ['checkboxes', 'checkbox_grid'].includes(field.canonicalType || '')
  );
}

function isGridUnknown(field: FormFieldMetadata): boolean {
  return field.canonicalType === 'grid_unknown';
}

function splitSelections(value: string): string[] {
  return value
    .split(/[,|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function matchesOption(value: string, options: string[]): boolean {
  const lowered = value.toLowerCase().trim();
  return options.some((option) => {
    const optLower = option.toLowerCase().trim();
    return optLower === lowered || optLower.includes(lowered) || lowered.includes(optLower);
  });
}

/**
 * Validates a single field answer against structural constraints:
 * required, native formats (email/number/date/time), choice membership,
 * scale ranges and grid rows/columns.
 */
export function validateFieldAnswer(field: FormFieldMetadata, rawValue: string): FieldValidationResult {
  const value = (rawValue ?? '').trim();

  if (!value) {
    if (field.required) {
      return { valid: false, error: `${field.label} wajib diisi.` };
    }
    return { valid: true };
  }

  const canonical = field.canonicalType || '';
  const options = (field.options || []).filter((option) => option !== '');
  const otherAllowed = !!(field.hasOther || field.otherAllowed);

  // Native / structural format checks
  if (field.type === 'email' || canonical === 'email') {
    if (!EMAIL_PATTERN.test(value)) {
      return { valid: false, error: `Format email pada "${field.label}" tidak valid.` };
    }
  }

  if (field.type === 'number') {
    if (!Number.isFinite(Number(value))) {
      return { valid: false, error: `"${field.label}" harus berupa angka.` };
    }
  }

  if (field.type === 'date' || field.typeCode === 9 || canonical === 'date') {
    const isIsoOrDmy = DATE_PATTERN.test(value);
    const isTextualDate = /^\d{1,2}\s+[a-zA-Z]+\s+\d{4}$/.test(value) || /^[a-zA-Z]+\s+\d{1,2},?\s+\d{4}$/.test(value);
    const isMultiConcat = /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/.test(value);
    if (!isIsoOrDmy && !isTextualDate && !isMultiConcat) {
      return { valid: false, error: `Format tanggal "${field.label}" tidak valid (contoh: 2026-12-31 atau 31/12/2026).` };
    }
  }

  if (field.type === 'time' || field.typeCode === 10 || canonical === 'time') {
    if (!TIME_PATTERN.test(value)) {
      return { valid: false, error: `Format waktu "${field.label}" tidak valid (contoh: 14:30).` };
    }
  }

  // Single choice / scale / rating: the answer must be one of the encoded options
  if (isSingleChoice(field) && options.length > 0) {
    if (!matchesOption(value, options) && !otherAllowed) {
      return {
        valid: false,
        error: `Pilih salah satu opsi untuk "${field.label}": ${options.slice(0, 5).join(', ')}.`
      };
    }
  }

  // Multiple choice: every selected value must be an encoded option
  if (isMultiChoice(field) && options.length > 0) {
    const selections = splitSelections(value);
    const invalid = selections.find((selection) => !matchesOption(selection, options));
    if (invalid && !otherAllowed) {
      return { valid: false, error: `Opsi "${invalid}" tidak tersedia untuk "${field.label}".` };
    }
  }

  // Grid with an unresolved subtype: at least enforce column membership
  if (isGridUnknown(field) && options.length > 0) {
    const selections = splitSelections(value);
    const invalid = selections.find((selection) => !matchesOption(selection, options));
    if (invalid) {
      return { valid: false, error: `Kolom "${invalid}" tidak tersedia untuk "${field.label}".` };
    }
  }

  // Structural scale range when the payload did not expose explicit options
  if ((field.type === 'linear_scale' || field.type === 'rating') && options.length === 0 && field.ratingScale) {
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

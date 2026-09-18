/**
 * AIRA - DOM Perception Type Definitions
 */

export interface InteractiveActionElement {
  id: string;
  tag: string;
  text: string;
  role: string;
  href?: string;
}

export interface FormFieldOptionBinding {
  option: string;
  ref: string;
  value?: string;
}

export interface RatingScaleInfo {
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
}

export interface FormFieldGridRow {
  label: string;
  entry_id: number;
  entry_key: string;
  required: boolean;
}

export interface FormFieldMetadata {
  id: string;
  domId?: string;
  label: string;
  type: string;
  placeholder?: string;
  required: boolean;
  currentValue?: any;
  options?: string[];
  hint?: string;
  validationKey?: 'nik' | 'phone' | 'email' | 'date';
  // Hybrid LLM Semantic Extensions:
  domRefs?: string[];
  optionBindings?: FormFieldOptionBinding[];
  ratingScale?: RatingScaleInfo;
  hasOther?: boolean;
  otherInputRef?: string;
  // Deterministic Google Forms (FB_PUBLIC_LOAD_DATA_) metadata:
  typeCode?: number | null;
  canonicalType?: string;
  entryIds?: number[];
  entryKeys?: string[];
  otherAllowed?: boolean;
  columns?: string[] | null;
  rows?: FormFieldGridRow[] | null;
  diagnostic?: string | null;
  /** Raw Google Forms validation slot (proprietary rules; forwarded to the agent). */
  validation?: unknown;
}

export interface FormContainerMetadata {
  id: string;
  title: string;
  fields: FormFieldMetadata[];
}

export interface PageHeading {
  tag: string;
  text: string;
}

export interface PageDOMOverview {
  pageTitle: string;
  headings: PageHeading[];
  actionElements: InteractiveActionElement[];
  forms: FormContainerMetadata[];
  snippets: string[];
}

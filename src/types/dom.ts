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

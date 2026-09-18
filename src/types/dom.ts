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

export interface FormFieldMetadata {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  required: boolean;
  currentValue: string;
  options?: string[];
  hint?: string;
  validationKey?: 'nik' | 'phone' | 'email' | 'date';
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

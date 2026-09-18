"""
State definition for AIRA Universal Voice Agent Loop.
Supports arbitrary web forms with dynamic queues, guardrail validation,
and eyes-free voice-first interactions.
"""

from typing import TypedDict, List, Dict, Any, Optional

class FormField(TypedDict, total=False):
    # Canonical Client-Aligned Metadata (matches FormFieldMetadata in src/types/dom.ts)
    id: str                      # Canonical element ID (e.g. 'field-1', 'txt_nik')
    label: str                   # Human-readable field label
    type: str                    # 'text', 'number', 'tel', 'email', 'date', 'select', 'checkbox', etc.
    placeholder: Optional[str]   # Input placeholder text
    required: bool               # Is mandatory field
    currentValue: Optional[str]  # Initial value present in DOM
    options: Optional[List[str]] # Options list for select or radio choices
    hint: Optional[str]          # Accessibility hint
    validationKey: Optional[str] # 'nik' | 'phone' | 'email' | 'date'
    
    # Extended DOM Attributes (HTML5 constraints & perception)
    tag: Optional[str]           # 'input', 'select', 'textarea'
    name: Optional[str]          # HTML name attribute
    pattern: Optional[str]       # Regex pattern constraint
    minLength: Optional[int]
    maxLength: Optional[int]
    min: Optional[str]
    max: Optional[str]
    
    # Backward Compatibility Alias
    domId: Optional[str]         # Backward-compatible alias for id

# Alias for backward compatibility
DOMField = FormField

class FormAgentState(TypedDict, total=False):
    # Session metadata
    session_id: str
    page_title: str
    page_url: str
    
    # Form processing queue
    fields_queue: List[FormField]
    current_field: Optional[FormField]
    filled_fields: List[FormField]
    answers: Dict[str, Any]      # { field_id: normalized_value }
    
    # Voice turn exchange
    user_speech: str             # Latest speech transcript from STT
    extracted_value: Optional[Any] # LLM-parsed normalized value
    is_valid: bool               # Deterministic guardrail check result
    validation_error: Optional[str]
    
    # Audio guidance outputs for blind user
    spoken_prompt: str           # Sentence to be read aloud via TTS
    audio_cue: Optional[str]     # 'ding', 'success', 'error', 'review', 'complete'
    
    # Lifecycle & status tracking
    status: str                  # 'ORIENTING' | 'INTERVIEWING' | 'REVIEWING' | 'AWAITING_CONFIRMATION' | 'CORRECTING' | 'AWAITING_FIELD_CHOICE' | 'COMPLETED'
    retry_count: int             # Retries on current question
    confirmation_response: Optional[str] # "ya" / "belum" / "ubah nama"
    review_decision: Optional[str]       # "CONFIRMED" | "CORRECT_FIELD" | "ASK_WHICH_FIELD" | "CANCELLED"
    is_correcting: Optional[bool]        # Flag indicating single field correction mode
    
    # Progress & Accessibility Metadata
    total_fields_count: int      # Total number of fields in the form
    current_step_index: int      # 0-based index of current field
    field_hint: Optional[str]    # Accessibility hint explaining current field

/**
 * AIRA - LLM Type Definitions
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatRequest {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}

export interface LLMChatResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export type IntentType = 'NAVIGATE' | 'FILL_FORM' | 'SUMMARIZE' | 'SETTINGS' | 'CHAT';

export interface AIRAIntentResult {
  intent: IntentType;
  targetId: string | null;
  explanation: string;
  actionName: string;
  confidence: number;
}

export type AgentStatus = 'in_progress' | 'review' | 'completed' | 'error';

export interface AgentStepResponse {
  session_id: string;
  status: AgentStatus;
  spoken_prompt: string;
  audio_cue?: string | null;
  is_valid: boolean;
  current_field?: Record<string, any> | null;
  answers: Record<string, any>;
  sync_payload: Record<string, any>;
  step_index: number;
  total_steps: number;
  progress_percent: number;
  field_hint?: string | null;
}

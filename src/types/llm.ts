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

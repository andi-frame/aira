/**
 * AIRA - Agent Client Service (TypeScript)
 * Communicates with the AIRA Python/LangGraph server backend
 */

import { storageManager } from '../shared/storage';
import { FormContainerMetadata, FormFieldMetadata, PageDOMOverview } from '../types/dom';
import { AgentStepResponse, AIRAIntentResult } from '../types/llm';

export class AgentService {
  private defaultServerUrl: string = 'http://localhost:8000';

  private async getServerUrl(): Promise<string> {
    try {
      const settings = await storageManager.getSettings();
      return (settings.agentServerUrl || this.defaultServerUrl).replace(/\/+$/, '');
    } catch {
      return this.defaultServerUrl;
    }
  }

  public async startSession(form: FormContainerMetadata, compactDom?: string): Promise<AgentStepResponse | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const payload = {
        compact_dom: compactDom || undefined,
        form: {
          id: form.id,
          domId: form.id,
          title: form.title || 'Formulir',
          fields: (form.fields || []).map((f) => ({
            id: f.id,
            domId: f.id,
            label: f.label || '',
            type: f.type || 'text',
            required: !!f.required,
            options: f.options || [],
            placeholder: f.placeholder || '',
            currentValue: f.currentValue || '',
            validationKey: f.validationKey,
            domRefs: f.domRefs,
            optionBindings: f.optionBindings,
            ratingScale: f.ratingScale,
            // Deterministic Google Forms metadata (FB_PUBLIC_LOAD_DATA_)
            typeCode: f.typeCode ?? null,
            canonicalType: f.canonicalType ?? null,
            entryIds: f.entryIds ?? [],
            entryKeys: f.entryKeys ?? [],
            otherAllowed: !!f.otherAllowed,
            columns: f.columns ?? null,
            rows: f.rows ?? null,
            diagnostic: f.diagnostic ?? null,
            validation: f.validation ?? null
          }))
        }
      };

      console.log(`[AIRA AgentService] Calling /session/start with compact_dom: ${compactDom ? compactDom.length : 0} chars`);

      const res = await fetch(`${baseUrl}/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        console.warn(`[AIRA AgentService] startSession failed with status ${res.status}`);
        return null;
      }

      return (await res.json()) as AgentStepResponse;
    } catch (err) {
      console.warn('[AIRA AgentService] startSession network error:', err);
      return null;
    }
  }

  public async interactWithText(sessionId: string, text: string): Promise<AgentStepResponse | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/interact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          user_speech: text,
          user_input: text
        })
      });

      if (!res.ok) {
        console.warn(`[AIRA AgentService] interactWithText failed with status ${res.status}`);
        return null;
      }

      return (await res.json()) as AgentStepResponse;
    } catch (err) {
      console.warn('[AIRA AgentService] interactWithText network error:', err);
      return null;
    }
  }

  public async interactWithAudio(sessionId: string, audioBlob: Blob): Promise<AgentStepResponse | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'speech.webm');
      formData.append('session_id', sessionId);

      const res = await fetch(`${baseUrl}/session/interact-audio`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        console.warn(`[AIRA AgentService] interactWithAudio failed with status ${res.status}`);
        return null;
      }

      return (await res.json()) as AgentStepResponse;
    } catch (err) {
      console.warn('[AIRA AgentService] interactWithAudio network error:', err);
      return null;
    }
  }

  public async confirmSubmission(sessionId: string, confirmation: string = 'ya'): Promise<AgentStepResponse | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          confirmation_response: confirmation,
          confirmation: confirmation
        })
      });

      if (!res.ok) {
        console.warn(`[AIRA AgentService] confirmSubmission failed with status ${res.status}`);
        return null;
      }

      return (await res.json()) as AgentStepResponse;
    } catch (err) {
      console.warn('[AIRA AgentService] confirmSubmission network error:', err);
      return null;
    }
  }

  public async stepBack(sessionId: string): Promise<AgentStepResponse | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/step-back`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });

      if (!res.ok) {
        console.warn(`[AIRA AgentService] stepBack failed with status ${res.status}`);
        return null;
      }

      return (await res.json()) as AgentStepResponse;
    } catch (err) {
      console.warn('[AIRA AgentService] stepBack network error:', err);
      return null;
    }
  }

  public async jumpToField(sessionId: string, fieldId: string): Promise<AgentStepResponse | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/jump-to`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          field_id: fieldId
        })
      });

      if (!res.ok) {
        console.warn(`[AIRA AgentService] jumpToField failed with status ${res.status}`);
        return null;
      }

      return (await res.json()) as AgentStepResponse;
    } catch (err) {
      console.warn('[AIRA AgentService] jumpToField network error:', err);
      return null;
    }
  }

  public async cancelSession(sessionId: string): Promise<boolean> {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });
      return res.ok;
    } catch (err) {
      console.warn('[AIRA AgentService] cancelSession network error:', err);
      return false;
    }
  }

  public async transcribeAudio(audioBlob: Blob): Promise<string | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'speech.webm');

      const res = await fetch(`${baseUrl}/audio/transcribe`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        console.warn(`[AIRA AgentService] transcribeAudio failed with status ${res.status}`);
        return null;
      }

      const data = await res.json();
      return (data && typeof data.text === 'string') ? data.text : null;
    } catch (err) {
      console.warn('[AIRA AgentService] transcribeAudio network error:', err);
      return null;
    }
  }

  public async classifyIntent(userInput: string, domOverview: PageDOMOverview): Promise<AIRAIntentResult | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/page/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_input: userInput,
          dom_overview: domOverview
        })
      });

      if (!res.ok) {
        console.warn(`[AIRA AgentService] classifyIntent failed with status ${res.status}`);
        return null;
      }

      return (await res.json()) as AIRAIntentResult;
    } catch (err) {
      console.warn('[AIRA AgentService] classifyIntent network error:', err);
      return null;
    }
  }

  public async summarizePage(domOverview: PageDOMOverview): Promise<string | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/page/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dom_overview: domOverview
        })
      });

      if (!res.ok) {
        console.warn(`[AIRA AgentService] summarizePage failed with status ${res.status}`);
        return null;
      }

      const data = await res.json();
      return (data && typeof data.summary === 'string') ? data.summary : null;
    } catch (err) {
      console.warn('[AIRA AgentService] summarizePage network error:', err);
      return null;
    }
  }

  public async explainField(field: FormFieldMetadata): Promise<string | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/field/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: {
            id: field.id,
            domId: field.id,
            label: field.label || '',
            type: field.type || 'text',
            required: !!field.required,
            options: field.options || [],
            placeholder: field.placeholder || '',
            currentValue: field.currentValue || '',
            validationKey: field.validationKey
          }
        })
      });

      if (!res.ok) {
        console.warn(`[AIRA AgentService] explainField failed with status ${res.status}`);
        return null;
      }

      const data = await res.json();
      return (data && typeof data.explanation === 'string') ? data.explanation : null;
    } catch (err) {
      console.warn('[AIRA AgentService] explainField network error:', err);
      return null;
    }
  }
}

export const agentService = new AgentService();

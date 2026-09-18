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

  public async startSession(
    form: FormContainerMetadata,
    compactDom?: string,
    resume?: { answers?: Record<string, unknown>; stepIndex?: number }
  ): Promise<AgentStepResponse | null> {
    const baseUrl = await this.getServerUrl();
    try {
      // Google Forms pages parsed from FB_PUBLIC_LOAD_DATA_ are deterministic and
      // must never go through the LLM form parser (only Google Forms).
      const deterministic = (form.fields || []).some((f) => !!f.canonicalType);
      const payload = {
        deterministic,
        compact_dom: deterministic ? undefined : compactDom || undefined,
        answers: resume?.answers,
        step_index: resume?.stepIndex,
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
            hint: f.hint,
            // Deterministic Google Forms metadata (FB_PUBLIC_LOAD_DATA_)
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

      console.log(
        `[AIRA AgentService] Calling /session/start (deterministic: ${deterministic}, compact_dom: ${compactDom ? compactDom.length : 0} chars)`
      );

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

  public async interactWithText(
    sessionId: string,
    text: string,
    alreadyExtracted: boolean = false,
    turnIntent?: string
  ): Promise<AgentStepResponse | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/session/interact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          user_speech: text,
          user_input: text,
          already_extracted: alreadyExtracted,
          turn_intent: turnIntent
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

  public async requestFieldExplanation(sessionId: string): Promise<AgentStepResponse | null> {
    return this.interactWithText(sessionId, '', false, 'EXPLAIN');
  }

  public async askFieldQuestion(
    sessionId: string | null,
    field: FormFieldMetadata,
    question: string
  ): Promise<string> {
    const baseUrl = await this.getServerUrl();
    try {
      const res = await fetch(`${baseUrl}/field/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId || undefined,
          field: {
            id: field.id,
            label: field.label,
            type: field.type,
            options: field.options,
            hint: field.hint,
            validationKey: field.validationKey
          },
          question
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.answer === 'string' && data.answer.trim()) {
          return data.answer.trim();
        }
      }
    } catch (err) {
      console.warn('[AIRA AgentService] askFieldQuestion network error, fallback to local:', err);
    }

    return this.getLocalFieldQuestionAnswer(field, question);
  }

  public getLocalFieldQuestionAnswer(field: FormFieldMetadata, question: string): string {
    const lbl = (field.label || '').toLowerCase();
    const qLower = (question || '').toLowerCase().trim();
    const options = field.options || [];

    const isLocation = ['lihat di mana', 'lihat dimana', 'di mana', 'dimana', 'nyari', 'nemu', 'mencari'].some(w => qLower.includes(w));
    const isWhat = ['apa itu', 'maksudnya', 'artinya', 'apa sih', 'kenapa', 'buat apa'].some(w => qLower.includes(w));
    const isFormat = ['contoh', 'format', 'cara mengisi', 'berapa digit', 'huruf apa angka'].some(w => qLower.includes(w));

    if (lbl.includes('nik') || lbl.includes('kependudukan') || lbl.includes('no ktp')) {
      if (isLocation) return 'Nomor NIK tertera di baris paling atas KTP elektronik Anda, atau di lembar Kartu Keluarga tepat di samping nama Anda.';
      if (isFormat) return 'Format NIK berupa 16 digit angka tanpa spasi atau tanda baca.';
      if (isWhat) return 'NIK adalah Nomor Induk Kependudukan sebagai nomor identitas resmi kependudukan Anda.';
      return 'Nomor NIK terdiri dari 16 digit angka yang tercantum pada KTP atau Kartu Keluarga Anda.';
    }

    if (['nim', 'mahasiswa', 'npm', 'nisn', 'nomor siswa'].some(w => lbl.includes(w))) {
      if (isLocation) return 'Nomor tersebut tertera pada Kartu Tanda Mahasiswa (KTM) atau kartu pelajar Anda.';
      if (isFormat) return 'Silakan masukkan nomor induk Anda sesuai dengan yang tertera di kartu mahasiswa atau kartu pelajar.';
      return 'Nomor ini adalah nomor identitas resmi Anda yang tertera di kartu mahasiswa atau pelajar.';
    }

    if (lbl.includes('angkatan') || lbl.includes('tahun masuk')) {
      if (isLocation || isWhat) return 'Angkatan adalah tahun pertama kali Anda diterima atau mulai masuk sekolah atau kampus, contohnya tahun 2022 atau 2023.';
      return 'Contoh pengisian angkatan adalah tahun 4 digit, misalnya 2022 atau 2023.';
    }

    if (['jurusan', 'program studi', 'prodi', 'fakultas'].some(w => lbl.includes(w))) {
      return 'Silakan sebutkan nama jurusan atau program studi Anda, misalnya Teknik Informatika atau Sistem Informasi.';
    }

    if (['bpjs', 'kis', 'asuransi'].some(w => lbl.includes(w))) {
      if (isLocation) return 'Nomor kartu BPJS tertera pada kartu fisik BPJS Kesehatan Anda atau pada aplikasi Mobile JKN di ponsel.';
      return 'Nomor BPJS terdiri dari 13 digit angka yang ada di kartu BPJS Kesehatan Anda.';
    }

    if (['telepon', 'wa', 'whatsapp', 'hp', 'seluler'].some(w => lbl.includes(w))) {
      if (isFormat) return 'Contoh nomor telepon diawali 08, misalnya 081234567890.';
      return 'Nomor telepon yang diminta adalah nomor aktif Anda yang dapat menerima SMS atau panggilan konfirmasi.';
    }

    if (lbl.includes('tanggal') || lbl.includes('lahir')) {
      if (isLocation) return 'Tanggal lahir dapat Anda lihat pada KTP, akta kelahiran, atau Kartu Keluarga.';
      return 'Anda dapat menyebutkan tanggal, bulan, dan tahun, contohnya 17 Agustus 1995.';
    }

    if (lbl.includes('email') || lbl.includes('surel')) {
      if (isFormat) return 'Contoh alamat email yang valid adalah nama@gmail.com.';
      return 'Alamat email adalah akun surat elektronik aktif Anda, misalnya akun Gmail yang Anda gunakan.';
    }

    if (['github', 'repo', 'repository', 'link', 'tautan'].some(w => lbl.includes(w))) {
      if (isLocation) return 'Tautan profil GitHub dapat Anda salin dari bilah alamat browser Anda, contohnya github.com/username.';
      return 'Masukkan tautan atau alamat web repositori proyek Anda di GitHub.';
    }

    if (options.length > 0) {
      return `Untuk pertanyaan ini, pilihan yang tersedia adalah: ${options.slice(0, 5).join(', ')}. Anda bisa memilih salah satu di antaranya.`;
    }

    return `Silakan masukkan data ${field.label || 'kolom'} sesuai dengan dokumen resmi atau informasi yang Anda miliki.`;
  }

  public async transcribeForSession(
    sessionId: string,
    audioBlob: Blob,
    durationMs?: number
  ): Promise<{ transcript: string; normalized: string } | null> {
    const baseUrl = await this.getServerUrl();
    try {
      const formData = new FormData();
      formData.append('session_id', sessionId);
      formData.append('file', audioBlob, 'speech.webm');
      if (typeof durationMs === 'number' && durationMs > 0) {
        formData.append('duration_ms', String(Math.round(durationMs)));
      }

      const res = await fetch(`${baseUrl}/session/transcribe`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        console.warn(`[AIRA AgentService] transcribeForSession failed with status ${res.status}`);
        return null;
      }

      const data = await res.json();
      const transcript = data && typeof data.transcript === 'string' ? data.transcript.trim() : '';
      const normalized = data && typeof data.normalized === 'string' && data.normalized.trim()
        ? data.normalized.trim()
        : transcript;
      if (!transcript && !normalized) return null;
      return { transcript, normalized };
    } catch (err) {
      console.warn('[AIRA AgentService] transcribeForSession network error:', err);
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

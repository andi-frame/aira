/**
 * AIRA - LLM Semantic Reasoning Layer (TypeScript)
 * Connects to OpenAI-compatible endpoints (cx/gpt-5.6-luna) with graceful local degradation.
 */

import { storageManager } from '../shared/storage';
import { AiraSettings } from '../types/index';
import { LLMMessage, LLMChatRequest, LLMChatResponse, AIRAIntentResult } from '../types/llm';
import { PageDOMOverview, FormFieldMetadata } from '../types/dom';

export class LLMService {
  private settings: AiraSettings | null = null;

  private async getActiveSettings(): Promise<AiraSettings> {
    this.settings = await storageManager.getSettings();
    return this.settings;
  }

  public async callChatCompletion(
    messages: LLMMessage[],
    options: { temperature?: number; max_tokens?: number; jsonMode?: boolean } = {}
  ): Promise<string | null> {
    const settings = await this.getActiveSettings();

    if (!settings.llmEnabled || !settings.llmApiKey) {
      return null; // Graceful degradation signal
    }

    const endpoint = settings.llmEndpoint || 'https://9r.disra.net/v1/chat/completions';
    const model = settings.llmModel || 'cx/gpt-5.6-luna';

    const payload: LLMChatRequest = {
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? 600
    };

    if (options.jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.llmApiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[AIRA LLM] API error (${response.status}):`, errorText);
        return null;
      }

      const data = (await response.json()) as LLMChatResponse;
      const content = data.choices?.[0]?.message?.content || '';
      return content.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[AIRA LLM] Request failed, switching to local fallback:', msg);
      return null;
    }
  }

  public async summarizePage(prunedContext: { rawSummary: string; data: PageDOMOverview }): Promise<string> {
    const systemPrompt = `Anda adalah AIRA, asisten aksesibilitas ramah untuk tunanetra dan lansia di Indonesia.
Tugas: Buat ringkasan isi halaman web ini secara padat, santun, dan jelas (maksimal 3-4 kalimat).
Sebutkan nama halaman, fungsi/layanan utama, dan saran langkah berikutnya bagi pengguna.
Gunakan Bahasa Indonesia awam tanpa istilah birokrasi rumit.`;

    const userPrompt = `Struktur Halaman:\n${prunedContext.rawSummary}\n\nBerikan ringkasan ramah.`;

    const result = await this.callChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);

    if (result) return result;

    return this.generateRuleBasedSummary(prunedContext.data);
  }

  private generateRuleBasedSummary(domData: PageDOMOverview): string {
    const title = domData.pageTitle || 'Portal Layanan Publik';
    const formCount = domData.forms.length;
    const actionCount = domData.actionElements.length;

    let summary = `Halo! Anda saat ini berada di halaman "${title}". `;

    if (formCount > 0) {
      const totalFields = domData.forms.reduce((acc, f) => acc + f.fields.length, 0);
      summary += `Terdapat formulir online dengan ${totalFields} pertanyaan isian yang dapat saya bantu pandu pengisiannya secara bertahap. `;
    }

    if (actionCount > 0) {
      const topActions = domData.actionElements.slice(0, 3).map(a => `"${a.text}"`).join(', ');
      summary += `Menu yang dapat Anda pilih antara lain: ${topActions}. `;
    }

    summary += `Silakan katakan "Bantu isi form" atau sebutkan menu yang ingin Anda buka!`;
    return summary;
  }

  public async processUserIntent(
    userInput: string,
    prunedContext: { rawSummary: string; data: PageDOMOverview }
  ): Promise<AIRAIntentResult> {
    const settings = await this.getActiveSettings();

    const systemPrompt = `Anda adalah AIRA Action Engine.
Analisis perintah pengguna dan daftar elemen tombol serta form di halaman.
Keluarkan output JSON dengan format ketat:
{
  "intent": "NAVIGATE" | "FILL_FORM" | "SUMMARIZE" | "SETTINGS" | "CHAT",
  "targetId": "string ID elemen dari daftar, atau null",
  "explanation": "Penjelasan singkat santun dalam Bahasa Indonesia",
  "actionName": "Nama aksi misalnya 'Formulir Pendaftaran'",
  "confidence": 0.0 - 1.0
}
Hanya rujuk targetId yang ada pada daftar.`;

    const userPrompt = `Input Pengguna: "${userInput}"\n\nDaftar Elemen:\n${prunedContext.rawSummary}`;

    if (settings.llmEnabled && settings.llmApiKey) {
      const result = await this.callChatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], { jsonMode: true, temperature: 0.1 });

      if (result) {
        try {
          const parsed = JSON.parse(result) as AIRAIntentResult;
          return parsed;
        } catch (e) {
          console.warn('[AIRA LLM] JSON parse fallback:', e);
        }
      }
    }

    return this.generateRuleBasedIntent(userInput, prunedContext.data);
  }

  private generateRuleBasedIntent(query: string, domData: PageDOMOverview): AIRAIntentResult {
    const q = query.toLowerCase().trim();

    // 1. Summary intent
    if (q.includes('ringkas') || q.includes('rangkum') || q.includes('isi halaman') || q.includes('ada apa')) {
      return {
        intent: 'SUMMARIZE',
        targetId: null,
        explanation: 'Saya akan membacakan ringkasan halaman ini untuk Anda.',
        actionName: 'Ringkas Halaman',
        confidence: 0.95
      };
    }

    // 2. Form filling intent
    if (q.includes('isi form') || q.includes('formulir') || q.includes('daftar') || q.includes('input') || q.includes('bantu isi')) {
      const form = domData.forms[0];
      return {
        intent: 'FILL_FORM',
        targetId: form ? form.id : null,
        explanation: 'Saya siap memandu Anda mengisi formulir satu per satu.',
        actionName: 'Bantu Isi Formulir',
        confidence: 0.9
      };
    }

    // 3. Settings intent
    if (q.includes('kontras') || q.includes('suara') || q.includes('font') || q.includes('pengaturan')) {
      return {
        intent: 'SETTINGS',
        targetId: null,
        explanation: 'Membuka pengaturan aksesibilitas.',
        actionName: 'Pengaturan',
        confidence: 0.9
      };
    }

    // 4. Keyword fuzzy navigation
    let bestMatch = null;
    let highestScore = 0;
    const words = q.replace(/buka|tampilkan|ke|cari|menu|tombol|klik|pergi/g, '').trim().split(/\s+/).filter(w => w.length > 2);

    for (const item of domData.actionElements) {
      const itemText = item.text.toLowerCase();
      let matchCount = 0;
      for (const w of words) {
        if (itemText.includes(w)) matchCount++;
      }
      if (matchCount > highestScore) {
        highestScore = matchCount;
        bestMatch = item;
      }
    }

    if (bestMatch && highestScore > 0) {
      return {
        intent: 'NAVIGATE',
        targetId: bestMatch.id,
        explanation: `Saya menemukan "${bestMatch.text}". Ingin saya sorot dan bantu klik?`,
        actionName: bestMatch.text,
        confidence: 0.8
      };
    }

    return {
      intent: 'CHAT',
      targetId: null,
      explanation: `Saya mendengar: "${query}". Anda dapat meminta saya merangkum halaman, mencari menu tertentu, atau memandu pengisian formulir.`,
      actionName: 'Bantuan Umum',
      confidence: 0.5
    };
  }

  public async explainFormField(field: FormFieldMetadata): Promise<string> {
    const settings = await this.getActiveSettings();

    const systemPrompt = `Anda adalah AIRA. Jelaskan satu kolom formulir kepada lansia atau penyandang disabilitas dalam 1-2 kalimat ramah.
Sebutkan arti kolom ini dan dokumen rujukan untuk melihat data tersebut (misal KTP, KK).`;

    const userPrompt = `Kolom: "${field.label}" (Tipe: ${field.type}, Placeholder: "${field.placeholder}")`;

    if (settings.llmEnabled && settings.llmApiKey) {
      const result = await this.callChatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], { temperature: 0.2 });

      if (result) return result;
    }

    const lbl = field.label.toLowerCase();
    if (lbl.includes('nik') || lbl.includes('kependudukan')) {
      return 'Nomor NIK terdiri dari 16 digit angka, tertera di bagian atas KTP atau Kartu Keluarga Anda.';
    }
    if (lbl.includes('bpjs') || lbl.includes('peserta')) {
      return 'Nomor kartu BPJS Anda, tertera pada kartu fisik BPJS atau aplikasi Mobile JKN.';
    }
    if (lbl.includes('nama')) {
      return 'Nama lengkap Anda sesuai dengan yang tertulis pada dokumen resmi KTP.';
    }
    if (lbl.includes('telepon') || lbl.includes('wa') || lbl.includes('whatsapp') || lbl.includes('hp')) {
      return 'Nomor telepon atau WhatsApp aktif Anda yang dapat menerima pesan konfirmasi.';
    }
    if (lbl.includes('lahir') || lbl.includes('tanggal')) {
      return 'Tanggal lahir Anda sesuai dokumen resmi KTP atau akta kelahiran.';
    }
    if (lbl.includes('alamat')) {
      return 'Alamat tempat tinggal Anda saat ini sesuai KTP atau domisili.';
    }

    return `Silakan masukkan informasi ${field.label} Anda sesuai data yang diminta.`;
  }
}

export const llmService = new LLMService();

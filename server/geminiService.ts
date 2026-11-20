import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { ExtractedMedicineRaw, MedexLookupResult } from '../src/types.ts';

export class GeminiApiError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 500, code = 'GEMINI_ERROR') {
    super(message);
    this.name = 'GeminiApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiApiError(
      'GEMINI_API_KEY is not configured. Please add a valid Gemini API key in Settings > Secrets.',
      503,
      'API_KEY_MISSING'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiError(err: unknown): GeminiApiError {
  if (err instanceof GeminiApiError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes('permission_denied') ||
    lower.includes('403') ||
    lower.includes('reported as leaked')
  ) {
    return new GeminiApiError(
      'Your Gemini API key was rejected (403 PERMISSION_DENIED — key revoked or reported as leaked). Please set a new GEMINI_API_KEY in Settings > Secrets, then retry.',
      403,
      'PERMISSION_DENIED'
    );
  }

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid')
  ) {
    return new GeminiApiError(
      'Your Gemini API key is invalid (400 API_KEY_INVALID). Please check GEMINI_API_KEY in Settings > Secrets and try again.',
      400,
      'API_KEY_INVALID'
    );
  }

  if (lower.includes('resource_exhausted') || lower.includes('429')) {
    return new GeminiApiError(
      'Gemini API quota limit reached (429 RESOURCE_EXHAUSTED). Please wait a moment or select a billing-enabled API key in Settings > Secrets.',
      429,
      'RESOURCE_EXHAUSTED'
    );
  }

  return new GeminiApiError(raw || 'Gemini AI request failed.', 502, 'UPSTREAM_ERROR');
}

export interface RawExtractionPayload {
  doctorName: string;
  patientName: string;
  prescriptionDate: string;
  notes: string;
  medicines: ExtractedMedicineRaw[];
}

export async function extractPrescriptionFromMedia(
  base64Data: string,
  mimeType: string
): Promise<RawExtractionPayload> {
  const ai = getAiClient();

  const systemInstruction = `You are a careful, safety-first pharmacy prescription OCR extraction assistant for pharmacies in Bangladesh.
Your sole responsibility is to transcribe medicine entries that are visibly written on the uploaded doctor's prescription image or PDF.

CRITICAL SAFETY RULES:
1. NEVER diagnose diseases, suggest new medicines, or alter the doctor's prescription.
2. NEVER silently guess an unreadable or ambiguous medicine name, strength, or dose. If any part is unclear, faded, cut off, or scribbled, set confidence to "low" or "medium" and explain clearly in uncertaintyReason.
3. Recognize standard Bangladeshi prescription shorthand:
   - "1+0+1" = 2 times/day (morning + night)
   - "1+1+1" = 3 times/day
   - "0+0+1" = 1 time/day (night)
   - "1+0+0" = 1 time/day (morning)
   - "1/2+0+1" = 1.5 tablets/day (set dosePerIntake = 1, frequencyPerDay = 1.5, frequencyCode = "1/2+0+1")
   - "1/2+0+1/2" = 1 tablet/day (dosePerIntake = 1, frequencyPerDay = 1, frequencyCode = "1/2+0+1/2")
   - "OD" = 1/day, "BD" = 2/day, "TDS" = 3/day, "QID" = 4/day, "HS" = 1/day at bedtime
   - "AC" = before food, "PC" = after food
   - "SOS" or "PRN" or tapering/variable schedules = set isAsNeededOrVariable = true, frequencyPerDay = null, frequencyCode = "SOS" (or "PRN" / "Tapering")
   - Bangla/Bengali duration text like "৭ দিন" (7 days), "১৫ দিন" (15 days), "১ মাস" (30 days), "চলবে" (continue -> set durationDays = 30 and note "Continue / চলবে" in durationText & medium confidence).
   - "Alternate day" / "EOD" = frequencyPerDay = 0.5
   - "Weekly" / "Once weekly" = frequencyPerDay = 0.1429
   - For syrups/suspensions written as "2 tsf 1+1+1" (1 tsf = 5 ml), set dosePerIntake = 10, doseUnit = "ml", frequencyPerDay = 3.
4. Preserve brand names exactly as written (e.g., Napa, Seclo, Sergel, Monas, Tufnil, Maxpro, Comet, Bizoran, Fexo, Zimax). Only populate genericName if written on the prescription or widely unambiguous for that exact brand; otherwise leave genericName empty.
5. Do not invent prices.`;

  const prompt = `Inspect this prescription document carefully and extract every prescribed medicine entry into structured JSON.
Include doctorName, patientName, prescriptionDate (if visible, else empty string), and all medicine lines in order.`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            doctorName: { type: Type.STRING },
            patientName: { type: Type.STRING },
            prescriptionDate: { type: Type.STRING },
            notes: { type: Type.STRING },
            medicines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  rawText: { type: Type.STRING, description: 'Original line text as read from prescription' },
                  brandName: { type: Type.STRING, description: 'Medicine brand name as written' },
                  genericName: { type: Type.STRING, description: 'Generic name if written or exact known generic' },
                  strength: { type: Type.STRING, description: 'Strength e.g. 500 mg, 20 mg, 120 mg/5 ml' },
                  dosageForm: { type: Type.STRING, description: 'Tablet, Capsule, Syrup, Suspension, Injection, Inhaler, Eye Drops, Cream, Ointment, Powder' },
                  dosePerIntake: { type: Type.NUMBER, nullable: true, description: 'Units per intake (e.g. 1, 0.5, 2, or ml for syrup)' },
                  doseUnit: { type: Type.STRING, description: 'tablet, capsule, ml, puff, drop, sachet, vial' },
                  frequencyCode: { type: Type.STRING, description: 'e.g. 1+1+1, 1+0+1, 0+0+1, 1/2+0+1, OD, BD, TDS, QID, SOS, HS, Alternate Day, Weekly' },
                  frequencyPerDay: { type: Type.NUMBER, nullable: true, description: 'Numeric daily intake multiplier, or null if SOS/PRN/variable' },
                  isAsNeededOrVariable: { type: Type.BOOLEAN, description: 'True for SOS, PRN, tapering, or variable schedules' },
                  durationDays: { type: Type.INTEGER, nullable: true, description: 'Prescribed duration in days if specified, else null' },
                  durationText: { type: Type.STRING, description: 'Duration text as written, e.g. 7 days, 1 month, continue' },
                  instructions: { type: Type.STRING, description: 'e.g. Before meal (AC), After meal (PC), At bedtime (HS), For severe headache' },
                  explicitQuantity: { type: Type.NUMBER, nullable: true, description: 'Explicit total count if written by doctor, else null' },
                  confidence: { type: Type.STRING, description: 'high, medium, or low' },
                  uncertaintyReason: { type: Type.STRING, description: 'Empty if high confidence; clear explanation if medium or low' },
                },
                required: [
                  'rawText',
                  'brandName',
                  'dosageForm',
                  'frequencyCode',
                  'isAsNeededOrVariable',
                  'confidence',
                ],
              },
            },
          },
          required: ['medicines'],
        },
      },
    });
  } catch (err) {
    throw formatGeminiError(err);
  }

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as Partial<RawExtractionPayload>;
  return {
    doctorName: parsed.doctorName || '',
    patientName: parsed.patientName || '',
    prescriptionDate: parsed.prescriptionDate || '',
    notes: parsed.notes || '',
    medicines: Array.isArray(parsed.medicines)
      ? parsed.medicines.map((m) => ({
          rawText: m.rawText || '',
          brandName: m.brandName || '',
          genericName: m.genericName || '',
          strength: m.strength || '',
          dosageForm: m.dosageForm || 'Tablet',
          dosePerIntake: typeof m.dosePerIntake === 'number' ? m.dosePerIntake : 1,
          doseUnit: m.doseUnit || 'tablet',
          frequencyCode: m.frequencyCode || '1+0+1',
          frequencyPerDay: typeof m.frequencyPerDay === 'number' ? m.frequencyPerDay : null,
          isAsNeededOrVariable: Boolean(m.isAsNeededOrVariable),
          durationDays: typeof m.durationDays === 'number' ? m.durationDays : null,
          durationText: m.durationText || '',
          instructions: m.instructions || '',
          explicitQuantity: typeof m.explicitQuantity === 'number' ? m.explicitQuantity : null,
          confidence:
            m.confidence === 'high' || m.confidence === 'medium' || m.confidence === 'low'
              ? m.confidence
              : 'medium',
          uncertaintyReason: m.uncertaintyReason || '',
        }))
      : [],
  };
}

/**
 * Live MedEx Bangladesh lookup via Google Search Grounding for medicines not found
 * in the local pharmacy catalog or when verifying latest reference pricing.
 */
export async function lookupMedexOnline(query: string): Promise<MedexLookupResult> {
  const ai = getAiClient();

  const prompt = `Search site:medex.com.bd for the Bangladeshi medicine "${query}".
Report the verified details found on MedEx Bangladesh (https://medex.com.bd/):
- Exact Brand Name
- Generic Name
- Strength
- Dosage Form
- Manufacturer
- Unit Price in BDT (৳)
- Strip/Pack Size and Strip/Pack Price in BDT (৳)

If exact price or product is NOT found on MedEx Bangladesh, state explicitly "Price not verified on MedEx" and do NOT invent or estimate a price.
At the end of your brief summary, include a JSON block wrapped in \`\`\`json ... \`\`\` with keys: brandName, genericName, strength, dosageForm, manufacturer, unitPrice (number or null), packPrice (number or null), packSize (number or null).`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
  } catch (err) {
    throw formatGeminiError(err);
  }

  const text = (response.text ?? '').trim();
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources = chunks
    .map((c: { web?: { uri?: string; title?: string } }) =>
      c.web?.uri ? { title: c.web.title || 'MedEx Reference', uri: c.web.uri } : null
    )
    .filter((s): s is { title: string; uri: string } => s !== null);

  let parsedFields: Partial<MedexLookupResult> = {};
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonMatch?.[1]) {
    try {
      parsedFields = JSON.parse(jsonMatch[1]);
    } catch {
      // keep summary text even if JSON parsing fails
    }
  }

  const cleanSummary = text.replace(/```json[\s\S]*?```/gi, '').trim();

  return {
    summary: cleanSummary || 'No verified MedEx Bangladesh listing returned.',
    brandName: parsedFields.brandName || query,
    genericName: parsedFields.genericName || '',
    strength: parsedFields.strength || '',
    dosageForm: parsedFields.dosageForm || 'Tablet',
    manufacturer: parsedFields.manufacturer || '',
    unitPrice: typeof parsedFields.unitPrice === 'number' ? parsedFields.unitPrice : null,
    packPrice: typeof parsedFields.packPrice === 'number' ? parsedFields.packPrice : null,
    packSize: typeof parsedFields.packSize === 'number' ? parsedFields.packSize : null,
    sources,
  };
}

import Tesseract, { type Worker } from 'tesseract.js';
import type { ExtractedMedicineRaw } from '../src/types.ts';
import type { RawExtractionPayload } from './geminiService.ts';

// Keep a single warm Tesseract worker in memory so every scan skips WASM + traineddata boot (~3-5s saved per scan)
let workerPromise: Promise<Worker> | null = null;
let ocrQueue: Promise<unknown> = Promise.resolve();

function getWarmOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', 1, {
      logger: () => {},
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

// Pre-warm worker quietly on server boot so even the very first scan is instant
void getWarmOcrWorker().catch(() => {});

function runQueuedOcr(buffer: Buffer): Promise<string> {
  const task = ocrQueue.then(async () => {
    const worker = await getWarmOcrWorker();
    const { data } = await worker.recognize(buffer);
    return (data.text || '').trim();
  });
  ocrQueue = task.catch(() => {});
  return task;
}

function normalizeFormToken(raw: string): { form: string; unit: string } {
  const f = raw.toLowerCase().replace(/\./g, '').trim();
  if (f.startsWith('cap')) return { form: 'Capsule', unit: 'capsule' };
  if (f.startsWith('tab')) return { form: 'Tablet', unit: 'tablet' };
  if (f.startsWith('syr')) return { form: 'Syrup', unit: 'ml' };
  if (f.startsWith('susp')) return { form: 'Suspension', unit: 'ml' };
  if (f.startsWith('inj')) return { form: 'Injection', unit: 'vial' };
  if (f.startsWith('inhal')) return { form: 'Inhaler', unit: 'puff' };
  if (f.startsWith('drop')) return { form: 'Eye Drops', unit: 'drop' };
  if (f.startsWith('cream')) return { form: 'Cream', unit: 'tube' };
  if (f.startsWith('oint')) return { form: 'Ointment', unit: 'tube' };
  if (f.startsWith('supp')) return { form: 'Suppository', unit: 'sachet' };
  if (f.startsWith('powd') || f.startsWith('sach')) return { form: 'Powder', unit: 'sachet' };
  return { form: 'Tablet', unit: 'tablet' };
}

function parseFrequencyFromText(text: string): {
  frequencyCode: string;
  frequencyPerDay: number | null;
  isAsNeededOrVariable: boolean;
} {
  // Check plus notation e.g. 1+1+1, 1+0+1, 0+0+1, 1/2+0+1, 1+0+1+0
  const plusMatch = text.match(/\b(\d(?:\/\d)?\s*\+\s*\d(?:\/\d)?\s*\+\s*\d(?:\/\d)?(?:\s*\+\s*\d(?:\/\d)?)?)\b/);
  if (plusMatch) {
    const code = plusMatch[1].replace(/\s+/g, '');
    const parts = code.split('+').map((p) => {
      if (p.includes('/')) {
        const [a, b] = p.split('/').map(Number);
        return b > 0 ? a / b : 0;
      }
      return Number(p) || 0;
    });
    const sum = parts.reduce((acc, v) => acc + v, 0);
    return {
      frequencyCode: code,
      frequencyPerDay: sum > 0 ? Number(sum.toFixed(2)) : null,
      isAsNeededOrVariable: sum <= 0,
    };
  }

  if (/\b(SOS|PRN|as needed|when needed|tapering)\b/i.test(text)) {
    const m = text.match(/\b(SOS|PRN|tapering)\b/i);
    return {
      frequencyCode: m ? m[1].toUpperCase() : 'SOS',
      frequencyPerDay: null,
      isAsNeededOrVariable: true,
    };
  }
  if (/\b(QID|4 times)\b/i.test(text)) {
    return { frequencyCode: 'QID', frequencyPerDay: 4, isAsNeededOrVariable: false };
  }
  if (/\b(TDS|TID|3 times|three times)\b/i.test(text)) {
    return { frequencyCode: 'TDS', frequencyPerDay: 3, isAsNeededOrVariable: false };
  }
  if (/\b(BD|BID|twice daily|2 times)\b/i.test(text)) {
    return { frequencyCode: 'BD', frequencyPerDay: 2, isAsNeededOrVariable: false };
  }
  if (/\b(OD|QD|once daily)\b/i.test(text)) {
    return { frequencyCode: 'OD', frequencyPerDay: 1, isAsNeededOrVariable: false };
  }
  if (/\b(HS|at night|bedtime)\b/i.test(text)) {
    return { frequencyCode: 'HS', frequencyPerDay: 1, isAsNeededOrVariable: false };
  }
  if (/\b(alternate day|EOD)\b/i.test(text)) {
    return { frequencyCode: 'Alternate Day', frequencyPerDay: 0.5, isAsNeededOrVariable: false };
  }
  if (/\b(weekly|once a week)\b/i.test(text)) {
    return { frequencyCode: 'Weekly', frequencyPerDay: 1 / 7, isAsNeededOrVariable: false };
  }

  return {
    frequencyCode: '1+0+1',
    frequencyPerDay: 2,
    isAsNeededOrVariable: false,
  };
}

function parseDurationFromText(text: string): {
  durationDays: number | null;
  durationText: string;
} {
  const monthMatch = text.match(/\b(\d+)\s*(?:month|months|mon)\b/i);
  if (monthMatch) {
    const n = Number(monthMatch[1]);
    return { durationDays: n * 30, durationText: `${n} month(s)` };
  }
  const weekMatch = text.match(/\b(\d+)\s*(?:week|weeks|wk)\b/i);
  if (weekMatch) {
    const n = Number(weekMatch[1]);
    return { durationDays: n * 7, durationText: `${n} week(s)` };
  }
  // Matches "7 days", "15 da", "30 day", "7d"
  const dayMatch = text.match(/\b(\d{1,3})\s*(?:days?|da\b|d\b)/i);
  if (dayMatch) {
    const n = Number(dayMatch[1]);
    if (n > 0 && n <= 365) {
      return { durationDays: n, durationText: `${n} days` };
    }
  }
  return { durationDays: null, durationText: '' };
}

function parseInstructionsFromText(text: string): string {
  const hints: string[] = [];
  if (/\b(before\s*(?:meal|food)|AC)\b/i.test(text)) hints.push('Before meal');
  else if (/\b(after\s*(?:meal|food)|PC|Aptereal)\b/i.test(text)) hints.push('After meal');
  if (/\b(at\s*night|bedtime|HS)\b/i.test(text)) hints.push('At night');
  const parenMatch = text.match(/\(([^)]{3,45})\)/);
  if (parenMatch) {
    const inner = parenMatch[1].replace(/[^a-zA-Z0-9\s/+-]/g, '').trim();
    if (inner.length >= 4 && !hints.some((h) => h.toLowerCase() === inner.toLowerCase())) {
      if (/before/i.test(inner) && !hints.includes('Before meal')) hints.push('Before meal');
      else if (/after/i.test(inner) && !hints.includes('After meal')) hints.push('After meal');
      else if (/night/i.test(inner) && !hints.includes('At night')) hints.push('At night');
      else if (/headache|pain|fever|cough|acid|gas/i.test(inner)) hints.push(inner);
    }
  }
  return hints.join(', ');
}

/**
 * Genuine Local OCR extractor powered by Tesseract.js.
 * Reads pixels from the uploaded prescription image and parses Bangladeshi
 * Rx lines without requiring a cloud AI API key.
 */
export async function extractPrescriptionWithLocalOcr(
  base64Data: string,
  mimeType: string
): Promise<RawExtractionPayload> {
  if (mimeType === 'application/pdf') {
    throw new Error(
      'Local OCR supports prescription images (JPG, PNG). For PDF prescriptions, please configure a valid GEMINI_API_KEY in Settings > Secrets or upload a photo/screenshot of the PDF.'
    );
  }

  const buffer = Buffer.from(base64Data, 'base64');
  const fullText = await runQueuedOcr(buffer);

  const rawLines = fullText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let doctorName = '';
  for (const line of rawLines) {
    const docMatch = line.match(/\bDr\.?\s+[A-Za-z][A-Za-z.\s,()]{3,60}/);
    if (docMatch) {
      doctorName = docMatch[0].trim();
      break;
    }
  }

  // Group medicine line + its immediate continuation instruction line (e.g. "(After meal)")
  const formPattern =
    /\b(Tab\.?|Cap\.?|Syr\.?|Susp\.?|Inj\.?|Inhaler|Drops?|Cream|Oint\.?|Supp\.?|Powder|Sachet)\s+([A-Za-z][A-Za-z0-9\s-]{1,28}?)(?=\s+\d|\s*[—–-]|\s+\d\+\d|\s+(?:SOS|PRN|OD|BD|TDS|QID|HS)|$)/i;

  const strengthPattern =
    /(\d+(?:\.\d+)?\s*(?:mg|mcg|gm|g|ml|iu|%)(?:\/\d+(?:\.\d+)?\s*(?:ml|mg))?(?:\s*\+\s*\d+(?:\.\d+)?\s*(?:mg|mcg|gm|g|ml|iu|%))*)/i;

  const groupedEntries: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const hasForm = formPattern.test(line);
    const hasSchedule =
      /\b\d(?:\/\d)?\+\d(?:\/\d)?\+\d(?:\/\d)?\b/.test(line) ||
      /\b(SOS|PRN|OD|BD|TDS|QID|HS)\b/.test(line);
    const hasStrength = strengthPattern.test(line);

    if (hasForm || (hasStrength && hasSchedule)) {
      let combined = line;
      // Attach next line if it's an instruction continuation (no new form/strength)
      if (i + 1 < rawLines.length) {
        const nextLine = rawLines[i + 1];
        if (
          !formPattern.test(nextLine) &&
          !strengthPattern.test(nextLine) &&
          !/^\d+[.)]\s*/.test(nextLine) &&
          /(meal|food|night|headache|pain|fever|before|after|aptr|apter|\()/i.test(nextLine)
        ) {
          combined = `${line} ${nextLine}`;
          i++;
        }
      }
      groupedEntries.push(combined);
    }
  }

  const medicines: ExtractedMedicineRaw[] = groupedEntries.map((entry) => {
    const formMatch = entry.match(formPattern);
    const strengthMatch = entry.match(strengthPattern);
    const freq = parseFrequencyFromText(entry);
    const dur = parseDurationFromText(entry);
    const instructions = parseInstructionsFromText(entry);

    let dosageForm = 'Tablet';
    let doseUnit = 'tablet';
    let brandName = '';

    if (formMatch) {
      const normalized = normalizeFormToken(formMatch[1]);
      dosageForm = normalized.form;
      doseUnit = normalized.unit;
      brandName = formMatch[2].replace(/[^A-Za-z0-9\s-]/g, '').trim();
    } else if (strengthMatch) {
      const beforeStrength = entry
        .slice(0, entry.indexOf(strengthMatch[1]))
        .replace(/^[\d.\s©"']+/, '')
        .replace(/[^A-Za-z0-9\s-]/g, ' ')
        .trim();
      brandName = beforeStrength.split(/\s+/).slice(-2).join(' ').trim();
    }

    const strength = strengthMatch
      ? strengthMatch[1].replace(/(\d)(mg|mcg|gm|ml|iu)/gi, '$1 $2').trim()
      : '';

    const missingParts: string[] = [];
    if (!brandName) missingParts.push('brand name');
    if (!strength) missingParts.push('strength');
    if (!freq.isAsNeededOrVariable && dur.durationDays === null) {
      missingParts.push('duration');
    }

    return {
      rawText: entry,
      brandName: brandName || 'Unclear Medicine',
      genericName: '',
      strength,
      dosageForm,
      dosePerIntake: 1,
      doseUnit,
      frequencyCode: freq.frequencyCode,
      frequencyPerDay: freq.frequencyPerDay,
      isAsNeededOrVariable: freq.isAsNeededOrVariable,
      durationDays: dur.durationDays,
      durationText: dur.durationText,
      instructions,
      explicitQuantity: null,
      confidence: missingParts.length > 0 ? 'low' : 'medium',
      uncertaintyReason:
        missingParts.length > 0
          ? `Local OCR could not read ${missingParts.join(', ')} clearly — please verify against prescription image.`
          : 'Extracted via Local OCR — please verify medicine name, dose, and duration against prescription image.',
    };
  });

  return {
    doctorName,
    patientName: '',
    prescriptionDate: '',
    notes:
      medicines.length > 0
        ? 'Extracted via Local OCR (Tesseract). Review every row against the original prescription image.'
        : 'Local OCR could not isolate structured medicine lines from this image. Try cropping closely around the medicine list, add medicines manually, or set a valid GEMINI_API_KEY in Settings > Secrets for handwriting vision.',
    medicines,
  };
}

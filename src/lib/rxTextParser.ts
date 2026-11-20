import type { ExtractedMedicineRaw } from '../types.ts';

export interface ParsedRxTextResult {
  doctorName: string;
  patientName: string;
  prescriptionDate: string;
  medicines: ExtractedMedicineRaw[];
  notes: string;
}

const BENGALI_DIGIT_MAP: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

export function toLatinDigits(text: string): string {
  return text.replace(/[০-৯]/g, (ch) => BENGALI_DIGIT_MAP[ch] ?? ch);
}

/**
 * Fix frequent Tesseract OCR misreads on Bangladeshi prescriptions without altering real brand names.
 */
function cleanOcrPrescriptionLine(rawLine: string): string {
  let s = toLatinDigits(rawLine);
  // Common OCR mistakes for Tab. / Cap. / Syr.
  s = s.replace(/\b(?:Tah|1ab|lab|Teb|Tub)\.?(\s+[A-Z])/g, 'Tab.$1');
  s = s.replace(/\b(?:Cop|Cep|Gap)\.?(\s+[A-Z])/g, 'Cap.$1');
  s = s.replace(/\b(?:5yr|Svr)\.?(\s+[A-Z])/g, 'Syr.$1');
  // Common OCR mistakes inside schedules: 1+O+1, l+0+1, I+0+1
  s = s.replace(/\b([012Il|])\s*\+\s*([012OoIl|])\s*\+\s*([012OoIl|])\b/g, (_m, a, b, c) => {
    const fix = (v: string) =>
      v === 'O' || v === 'o' ? '0' : v === 'I' || v === 'l' || v === '|' ? '1' : v;
    return `${fix(a)}+${fix(b)}+${fix(c)}`;
  });
  // Common OCR unit typos: 500mq / 500nq -> 500 mg
  s = s.replace(/(\d)\s*(?:mq|nq)\b/gi, '$1 mg');
  return s;
}

function normalizeFormToken(raw: string): { form: string; unit: string } {
  const f = raw.toLowerCase().replace(/\./g, '').trim();
  if (f.includes('cap')) return { form: 'Capsule', unit: 'capsule' };
  if (f.includes('tab')) return { form: 'Tablet', unit: 'tablet' };
  if (f.includes('syr')) return { form: 'Syrup', unit: 'ml' };
  if (f.includes('susp')) return { form: 'Suspension', unit: 'ml' };
  if (f.includes('sol') || f.includes('lotion')) return { form: 'Solution', unit: 'bottle' };
  if (f.includes('gel')) return { form: 'Gel', unit: 'tube' };
  if (f.includes('inj')) return { form: 'Injection', unit: 'vial' };
  if (f.includes('inhal')) return { form: 'Inhaler', unit: 'puff' };
  if (f.includes('drop')) return { form: 'Eye Drops', unit: 'drop' };
  if (f.includes('cream')) return { form: 'Cream', unit: 'tube' };
  if (f.includes('oint')) return { form: 'Ointment', unit: 'tube' };
  if (f.includes('supp')) return { form: 'Suppository', unit: 'sachet' };
  if (f.includes('powd') || f.includes('sach')) return { form: 'Powder', unit: 'sachet' };
  return { form: 'Tablet', unit: 'tablet' };
}

function parseFrequencyFromText(rawText: string): {
  frequencyCode: string;
  frequencyPerDay: number | null;
  isAsNeededOrVariable: boolean;
  foundExplicit: boolean;
} {
  const text = cleanOcrPrescriptionLine(rawText);

  const plusMatch = text.match(
    /(?:^|[^\d/])(\d(?:\/\d)?\s*\+\s*\d(?:\/\d)?\s*\+\s*\d(?:\/\d)?(?:\s*\+\s*\d(?:\/\d)?)?)(?:[^\d/]|$)/
  );
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
      foundExplicit: true,
    };
  }

  // Bengali daily counts: "দৈনিক ২ বার", "× ২ বার", "দিনে ৩ বার"
  const bnTimesMatch = text.match(/(?:দৈনিক|দিনে|[×xX*])\s*(\d+)\s*বার/);
  if (bnTimesMatch) {
    const n = Number(bnTimesMatch[1]);
    if (n === 1) return { frequencyCode: 'OD', frequencyPerDay: 1, isAsNeededOrVariable: false, foundExplicit: true };
    if (n === 2) return { frequencyCode: 'BD', frequencyPerDay: 2, isAsNeededOrVariable: false, foundExplicit: true };
    if (n === 3) return { frequencyCode: 'TDS', frequencyPerDay: 3, isAsNeededOrVariable: false, foundExplicit: true };
    if (n === 4) return { frequencyCode: 'QID', frequencyPerDay: 4, isAsNeededOrVariable: false, foundExplicit: true };
    if (n > 0) return { frequencyCode: `${n}x/day`, frequencyPerDay: n, isAsNeededOrVariable: false, foundExplicit: true };
  }

  if (/\b(SOS|PRN|as needed|when needed|tapering)\b/i.test(text) || /প্রয়োজনে/.test(text)) {
    const m = text.match(/\b(SOS|PRN|tapering)\b/i);
    return {
      frequencyCode: m ? m[1].toUpperCase() : 'SOS',
      frequencyPerDay: null,
      isAsNeededOrVariable: true,
      foundExplicit: true,
    };
  }
  if (/\b(QID|4 times)\b/i.test(text)) return { frequencyCode: 'QID', frequencyPerDay: 4, isAsNeededOrVariable: false, foundExplicit: true };
  if (/\b(TDS|TID|3 times|three times)\b/i.test(text)) return { frequencyCode: 'TDS', frequencyPerDay: 3, isAsNeededOrVariable: false, foundExplicit: true };
  if (/\b(BD|BID|twice daily|2 times)\b/i.test(text)) return { frequencyCode: 'BD', frequencyPerDay: 2, isAsNeededOrVariable: false, foundExplicit: true };
  if (/\b(OD|QD|once daily)\b/i.test(text)) return { frequencyCode: 'OD', frequencyPerDay: 1, isAsNeededOrVariable: false, foundExplicit: true };
  if (/\b(HS|at night|bedtime)\b/i.test(text) || /রাতে/.test(text)) return { frequencyCode: 'HS', frequencyPerDay: 1, isAsNeededOrVariable: false, foundExplicit: true };
  if (/\b(alternate day|EOD)\b/i.test(text)) return { frequencyCode: 'Alternate Day', frequencyPerDay: 0.5, isAsNeededOrVariable: false, foundExplicit: true };
  if (/\b(weekly|once a week)\b/i.test(text) || /সপ্তাহে\s*1\s*বার/.test(text)) return { frequencyCode: 'Weekly', frequencyPerDay: 1 / 7, isAsNeededOrVariable: false, foundExplicit: true };

  return { frequencyCode: '1+0+1', frequencyPerDay: 2, isAsNeededOrVariable: false, foundExplicit: false };
}

function parseDurationFromText(rawText: string): {
  durationDays: number | null;
  durationText: string;
} {
  const text = cleanOcrPrescriptionLine(rawText);

  const monthMatch = text.match(/(\d+)\s*(?:month|months|mon\b|মাস)/i);
  if (monthMatch) {
    const n = Number(monthMatch[1]);
    return { durationDays: n * 30, durationText: `${n} month(s)` };
  }
  const weekMatch = text.match(/(\d+)\s*(?:week|weeks|wk\b|সপ্তাহ)/i);
  if (weekMatch) {
    const n = Number(weekMatch[1]);
    return { durationDays: n * 7, durationText: `${n} week(s)` };
  }
  const dayMatch = text.match(/(\d{1,3})\s*(?:days?|da\b|d\b|দিন)/i);
  if (dayMatch) {
    const n = Number(dayMatch[1]);
    if (n > 0 && n <= 365) {
      return { durationDays: n, durationText: `${n} days` };
    }
  }
  if (/চলবে|continue|ongoing/i.test(text)) {
    return { durationDays: 30, durationText: 'Ongoing (চলবে)' };
  }
  return { durationDays: null, durationText: '' };
}

function parseInstructionsFromText(rawText: string): string {
  const text = cleanOcrPrescriptionLine(rawText);
  const hints: string[] = [];
  if (
    /\b(before\s*(?:meal|food)|AC)\b/i.test(text) ||
    /\(Before\b/i.test(text) ||
    /(?:খাওয়ার|খাবারের)[^,\n]{0,18}আগে/.test(text)
  ) {
    hints.push('Before meal');
  } else if (
    /\b(after\s*(?:meal|food)|PC|Aptereal)\b/i.test(text) ||
    /(?:খাওয়ার|খাবারের)[^,\n]{0,18}পরে/.test(text)
  ) {
    hints.push('After meal');
  }
  if (/\b(at\s*night|bedtime|HS)\b/i.test(text) || /রাতে/.test(text)) {
    hints.push('At night');
  }
  if (/মাথায় ব্যবহার/.test(text)) hints.push('Apply on scalp');
  else if (/মাখবেন/.test(text)) hints.push('Apply topically');
  return hints.join(', ');
}

function isWithinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      edits++;
      if (edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else {
        i++;
        j++;
      }
    }
  }
  if (i < a.length || j < b.length) edits++;
  return edits <= 1;
}

const STOP_WORDS = new Set([
  'tablet', 'capsule', 'syrup', 'cream', 'drops', 'water', 'plus', 'gold',
  'extra', 'forte', 'max', 'pro', 'name', 'date', 'patient', 'address',
  'chief', 'complaint', 'complaints', 'diagnosis', 'referred', 'years', 'year',
  'irregular', 'fever', 'solution', 'lotion', 'ointment', 'powder', 'advice',
  'history', 'follow', 'next', 'visit', 'days', 'month', 'months', 'week',
  'weeks', 'daily', 'night', 'morning', 'before', 'after', 'meal', 'food',
  'told', 'have', 'with', 'from', 'sherpur', 'dhaka', 'medical', 'hospital',
  'clinic', 'chamber', 'doctor', 'medicine', 'consultation', 'severe',
  'headache', 'pain', 'cough', 'cold', 'body', 'normal', 'test', 'tests',
  'blood', 'sugar', 'pressure', 'weight', 'pulse', 'heart', 'lung', 'chest',
  'high', 'low', 'mild', 'acute', 'chronic', 'female', 'male', 'phone',
  'mobile', 'email', 'signature', 'road', 'house', 'bangladesh', 'limited',
  'pharma', 'continue', 'ongoing', 'twice', 'once', 'thrice', 'times',
  'pcos', 'mbbs', 'fcps', 'bcs', 'md', 'ms', 'ddv', 'dgo',
]);

// Famous 3-letter Bangladeshi brand names that can appear on prescriptions
const SHORT_FAMOUS_BD_BRANDS = new Set([
  'ace', 'fix', 'zin', 'noc', 'def', 'esl', 'ome', 'pan', 'cef', 'azi', 'met', 'los', 'aml',
]);

interface BrandIndex {
  exact: Map<string, string>; // lower -> canonical brand name
  byPrefix: Map<string, string[]>; // 2-char prefix -> canonical brand names (len >= 5)
}

let cachedBrandIndexKey = '';
let cachedBrandIndex: BrandIndex | null = null;

function buildBrandIndex(knownBrandNames: string[]): BrandIndex {
  const key = `${knownBrandNames.length}:${knownBrandNames[0] || ''}:${knownBrandNames[knownBrandNames.length - 1] || ''}`;
  if (cachedBrandIndex && cachedBrandIndexKey === key) {
    return cachedBrandIndex;
  }

  const exact = new Map<string, string>();
  const byPrefix = new Map<string, string[]>();

  for (let i = 0; i < knownBrandNames.length; i++) {
    const raw = knownBrandNames[i].trim();
    const low = raw.toLowerCase();
    if (low.length < 3 || STOP_WORDS.has(low)) continue;
    if (low.length === 3 && !SHORT_FAMOUS_BD_BRANDS.has(low)) continue;

    if (!exact.has(low)) {
      exact.set(low, raw);
      if (low.length >= 5 && /^[a-z]/.test(low)) {
        const p = low.slice(0, 2);
        const bucket = byPrefix.get(p);
        if (bucket) bucket.push(raw);
        else byPrefix.set(p, [raw]);
      }
    }
  }

  cachedBrandIndexKey = key;
  cachedBrandIndex = { exact, byPrefix };
  return cachedBrandIndex;
}

/**
 * Unified Bangladeshi prescription text parser (English + Bengali digits/notations).
 * Handles noisy OCR prefixes, two-column merged lines, digital PDFs, and 25,703 MedEx brand lookup.
 */
export function parsePrescriptionText(
  fullText: string,
  knownBrandNames: string[],
  sourceLabel: string
): ParsedRxTextResult {
  const rawLines = fullText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let doctorName = '';
  let patientName = '';
  let prescriptionDate = '';

  for (const line of rawLines) {
    if (!doctorName) {
      const docMatch = line.match(/\bDr\.?\s+[A-Za-z][A-Za-z.\s,()]{3,60}/);
      if (docMatch) doctorName = docMatch[0].trim();
    }
    if (!patientName) {
      const patMatch = line.match(
        /\b(?:Patient\s*)?Name\s*[:\-]\s*([A-Za-z.\s]{2,45}?)(?=\s+(?:Age|Sex|ID|Date|Mobile)|$)/i
      );
      if (patMatch) patientName = patMatch[1].trim();
    }
    if (!prescriptionDate) {
      const dateMatch = line.match(
        /\bDate\s*[:\-]\s*([0-9০-৯]{1,2}[/\-.][0-9০-৯]{1,2}[/\-.][0-9০-৯]{2,4})/i
      );
      if (dateMatch) prescriptionDate = toLatinDigits(dateMatch[1].trim());
    }
  }

  const brandIndex = buildBrandIndex(knownBrandNames);

  // Un-anchored form prefix (works after OCR noise like '© "1 1 Tab Napa' OR after left-column text!)
  // Intentionally excludes 'Cream' and 'Solution' so 'Vaniflo cream Cream' / 'Xenogrow 2% Solution' parse via brand+suffix.
  const formPrefixPattern =
    /\b(Tab\.?|Cap\.?|Syr\.?|Susp\.?|Inj\.?|Inhaler|Drops?|Oint\.?|Gel|Lotion|Supp\.?|Powder|Sachet)\s+([A-Za-z][A-Za-z0-9\s-]{1,28}?)(?=\s+\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?\s*(?:mg|mcg|gm|g|ml|iu|%)|\s*[—–\-|]|\s+\d(?:\/\d)?\s*\+\s*\d|\s+(?:SOS|PRN|OD|BD|TDS|QID|HS)\b|\s+[\u0980-\u09FF]|$)/i;

  const formSuffixPattern =
    /\b(Tablet|Capsule|Syrup|Suspension|Solution|Scalp\s+Solution|Lotion|Cream|Ointment|Gel|Drops?|Inhaler|Injection|Powder|Sachet)\b/i;

  const strengthPattern =
    /(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?\s*(?:mg|mcg|gm|g|ml|iu|%)(?:\/\d+(?:\.\d+)?\s*(?:ml|mg))?(?:\s*\+\s*\d+(?:\.\d+)?\s*(?:mg|mcg|gm|g|ml|iu|%))*)/i;

  const findKnownBrandInLine = (line: string, allowFuzzy: boolean): string => {
    const words = line
      .replace(/[^A-Za-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w));

    // Pass 1: exact 2-word and 1-word MedEx brand match
    for (let i = 0; i < words.length; i++) {
      if (i + 1 < words.length) {
        const pair = `${words[i]} ${words[i + 1]}`.toLowerCase();
        const hit = brandIndex.exact.get(pair);
        if (hit) return hit;
      }
      const single = words[i].toLowerCase();
      const hit = brandIndex.exact.get(single);
      if (hit) return hit;
    }

    // Pass 2: 1-character OCR typo fuzzy match for words >= 5 chars (e.g. "Inospiran" -> "Inospiron")
    if (allowFuzzy) {
      for (const word of words) {
        const low = word.toLowerCase();
        if (low.length < 5 || STOP_WORDS.has(low) || !/^[a-z]/.test(low)) continue;
        const bucket = brandIndex.byPrefix.get(low.slice(0, 2));
        if (!bucket) continue;
        for (let j = 0; j < bucket.length; j++) {
          const candLow = bucket[j].toLowerCase();
          if (isWithinOneEdit(low, candLow)) {
            return bucket[j];
          }
        }
      }
    }

    return '';
  };

  const isHeaderOrNonRxLine = (cleaned: string): boolean => {
    return /^(?:Dr\.|Name\s*:|Patient\s*Name|Age\s*:|Sex\s*:|Address\s*:|Date\s*:|ID\s*:|Chief\s+Complaint|Diagnosis|Referred\s+By|Advice|Follow\s*Up|Next\s+Visit|DHAKA\s+MEDICAL)/i.test(
      cleaned
    );
  };

  const isMedicineStartLine = (rawLine: string): boolean => {
    const cleaned = cleanOcrPrescriptionLine(rawLine);
    if (isHeaderOrNonRxLine(cleaned) && !formPrefixPattern.test(cleaned)) {
      return false;
    }

    const hasPrefixForm = formPrefixPattern.test(cleaned);
    const hasStrength = strengthPattern.test(cleaned);
    const hasSchedule =
      /\d(?:\/\d)?\s*\+\s*\d(?:\/\d)?\s*\+\s*\d(?:\/\d)?/.test(cleaned) ||
      /\b(SOS|PRN|OD|BD|TDS|QID|HS)\b/.test(cleaned);
    const hasNumberedMarker = /(?:^|\s)\d{1,2}[.)]\s+[A-Za-z]/.test(cleaned);
    const hasSuffixForm = formSuffixPattern.test(cleaned);
    const knownBrand = findKnownBrandInLine(cleaned, hasStrength || hasSchedule || hasNumberedMarker);

    if (hasPrefixForm) return true;
    if (hasStrength && hasSchedule) return true;
    if (knownBrand && (hasStrength || hasSuffixForm || hasSchedule || hasNumberedMarker)) return true;
    return false;
  };

  const groupedEntries: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (isMedicineStartLine(line)) {
      // If left-column text got merged before '1. Tab.' or 'Tab.', slice cleanly from the medicine start!
      let baseLine = line;
      const cleaned = cleanOcrPrescriptionLine(line);
      const pm = cleaned.match(formPrefixPattern);
      if (pm && pm.index !== undefined && pm.index > 6) {
        const before = cleaned.slice(0, pm.index);
        // Only trim if there is non-trivial text before a numbered/form prefix (e.g. left-column chief complaint)
        if (/[A-Za-z]{4,}/.test(before)) {
          baseLine = cleaned.slice(pm.index);
        }
      }

      let combined = baseLine;
      // Attach up to 2 continuation lines (dosage schedule, duration, Bengali/English instructions)
      let attached = 0;
      while (i + 1 < rawLines.length && attached < 2) {
        const nextLine = rawLines[i + 1];
        const nextCleaned = cleanOcrPrescriptionLine(nextLine);
        if (isMedicineStartLine(nextLine)) break;
        if (/^\d{1,2}[.)]\s+[A-Za-z]/.test(nextCleaned)) break;
        if (isHeaderOrNonRxLine(nextCleaned)) break;

        const looksLikeDosageOrInstruction =
          /\d(?:\/\d)?\s*\+\s*\d/.test(nextCleaned) ||
          /(?:চলবে|দিন|মাস|সপ্তাহ|বার|খাওয়ার|খাবারের|মাখবেন|ব্যবহার|আগে|পরে|রাতে|টি)/.test(nextLine) ||
          /(meal|food|night|headache|pain|fever|before|after|aptr|apter|days?|weeks?|months?|daily|SOS|PRN|OD|BD|TDS|QID|HS|\()/i.test(
            nextCleaned
          );
        if (!looksLikeDosageOrInstruction) break;
        combined = `${combined} ${nextLine}`;
        i++;
        attached++;
      }
      groupedEntries.push(combined);
    }
  }

  // Fallback pass: if strict line detection found 0 items, scan for ANY standalone MedEx brand + nearby strength/form
  if (groupedEntries.length === 0) {
    for (let i = 0; i < rawLines.length; i++) {
      const cleaned = cleanOcrPrescriptionLine(rawLines[i]);
      if (isHeaderOrNonRxLine(cleaned)) continue;
      const brand = findKnownBrandInLine(cleaned, true);
      if (brand && brand.length >= 4) {
        const next = i + 1 < rawLines.length ? rawLines[i + 1] : '';
        const merged = next && !isHeaderOrNonRxLine(cleanOcrPrescriptionLine(next))
          ? `${rawLines[i]} ${next}`
          : rawLines[i];
        groupedEntries.push(merged);
      }
    }
  }

  const medicines: ExtractedMedicineRaw[] = groupedEntries.map((entry) => {
    const cleanedEntry = cleanOcrPrescriptionLine(entry);
    const prefixMatch = cleanedEntry.match(formPrefixPattern);
    const suffixMatch = cleanedEntry.match(formSuffixPattern);
    const strengthMatch = cleanedEntry.match(strengthPattern);
    const freq = parseFrequencyFromText(entry);
    const dur = parseDurationFromText(entry);
    const instructions = parseInstructionsFromText(entry);

    let dosageForm = 'Tablet';
    let doseUnit = 'tablet';
    let brandName = '';

    if (prefixMatch) {
      const normalized = normalizeFormToken(prefixMatch[1]);
      dosageForm = normalized.form;
      doseUnit = normalized.unit;
      brandName = prefixMatch[2].replace(/[^A-Za-z0-9\s-]/g, '').trim();
      // If OCR introduced a 1-char typo in the prefix-captured brand, recover exact MedEx spelling!
      const recovered = findKnownBrandInLine(brandName, true);
      if (recovered && brandName.split(/\s+/).length <= 2) {
        // Preserve numeric suffix like "Giane 35" if present, otherwise use exact MedEx spelling
        if (!/\d/.test(brandName)) {
          brandName = recovered;
        }
      }
    } else {
      brandName = findKnownBrandInLine(cleanedEntry, true);
      if (suffixMatch) {
        const normalized = normalizeFormToken(suffixMatch[1]);
        dosageForm = normalized.form;
        doseUnit = normalized.unit;
      }
      if (!brandName && strengthMatch) {
        const beforeStrength = cleanedEntry
          .slice(0, cleanedEntry.indexOf(strengthMatch[1]))
          .replace(/^[\d.\s©"'|:;•-]+/, '')
          .replace(/[^A-Za-z0-9\s-]/g, ' ')
          .trim();
        brandName = beforeStrength.split(/\s+/).slice(-2).join(' ').trim();
      }
    }

    brandName = brandName
      .replace(/\b(tablet|capsule|syrup|suspension|solution|cream|ointment|gel|lotion|drops?)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const strength = strengthMatch
      ? strengthMatch[1]
          .replace(/\s*\/\s*/g, '/')
          .replace(/(\d)(mg|mcg|gm|ml|iu)/gi, '$1 $2')
          .trim()
      : '';

    const missingParts: string[] = [];
    if (!brandName) missingParts.push('brand name');
    if (!freq.isAsNeededOrVariable && dur.durationDays === null) missingParts.push('duration');

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
          ? `${sourceLabel} could not read ${missingParts.join(', ')} clearly — please verify against prescription.`
          : `Extracted via ${sourceLabel} — please verify medicine name, dose, and duration.`,
    };
  });

  // Deduplicate accidental double-captures of the same brand + strength
  const seen = new Set<string>();
  const uniqueMedicines = medicines.filter((m) => {
    const key = `${m.brandName.toLowerCase()}|${m.strength.toLowerCase()}|${m.dosageForm.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    doctorName,
    patientName,
    prescriptionDate,
    medicines: uniqueMedicines,
    notes:
      uniqueMedicines.length > 0
        ? `Extracted ${uniqueMedicines.length} medicine(s) via ${sourceLabel}. Review every row against the original prescription.`
        : `${sourceLabel} could not isolate structured medicine lines. Check the scanned text below, crop tightly around the medicine list, or add medicines manually from the MedEx catalog.`,
  };
}

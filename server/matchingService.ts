import type {
  ExtractedMedicineRaw,
  MedicineRecord,
  PrescriptionLineItem,
  PriceMatchStatus,
} from '../src/types.ts';
import { queryMedicinesFast } from './db.ts';
import { fetchAndCacheMedicinePrice } from './medexService.ts';

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStrength(strength: string): string {
  return strength
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/milligram(s)?/g, 'mg')
    .replace(/microgram(s)?/g, 'mcg')
    .replace(/gram(s)?/g, 'gm')
    .replace(/(\d)g$/g, '$1gm');
}

function normalizeForm(form: string): string {
  const f = form.toLowerCase().trim();
  if (f.startsWith('tab')) return 'tablet';
  if (f.startsWith('cap')) return 'capsule';
  if (f.startsWith('syr')) return 'syrup';
  if (f.startsWith('susp')) return 'suspension';
  if (f.startsWith('inj') || f.includes('vial') || f.includes('amp')) return 'injection';
  if (f.includes('inhal') || f.includes('puff')) return 'inhaler';
  if (f.includes('drop')) return 'eye drops';
  if (f.includes('cream')) return 'cream';
  if (f.includes('oint')) return 'ointment';
  if (f.includes('powd') || f.includes('sach')) return 'powder';
  return f;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => []);
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function similarity(a: string, b: string): number {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.88;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Strict Bangladeshi medicine matcher operating efficiently over 25,000+ MedEx SQLite rows.
 * Never silently attaches a price solely because a name looks similar.
 */
export function matchMedicineStrict(extracted: ExtractedMedicineRaw): {
  matched: MedicineRecord | null;
  candidates: MedicineRecord[];
  status: PriceMatchStatus;
} {
  const queryBrand = normalizeToken(extracted.brandName || '');
  const queryGeneric = normalizeToken(extracted.genericName || '');
  const queryStrength = normalizeStrength(extracted.strength || '');
  const queryForm = normalizeForm(extracted.dosageForm || '');

  // Narrow SQL candidates first (fast indexed lookup over 25,000+ records)
  const poolMap = new Map<number, MedicineRecord>();
  const seedTerms = [
    extracted.brandName,
    extracted.brandName?.slice(0, 4),
    extracted.genericName,
  ].filter((t): t is string => Boolean(t && t.trim().length >= 2));

  for (const term of seedTerms) {
    const res = queryMedicinesFast({ q: term, limit: 80 });
    for (const m of res.medicines) {
      poolMap.set(m.id, m);
    }
  }

  const catalog = Array.from(poolMap.values());

  const scored = catalog
    .map((med) => {
      const medBrand = normalizeToken(med.brandName);
      const medGeneric = normalizeToken(med.genericName);
      const medStrength = normalizeStrength(med.strength);
      const medForm = normalizeForm(med.dosageForm);

      const brandSim = queryBrand ? similarity(queryBrand, medBrand) : 0;
      const genericSim = queryGeneric ? similarity(queryGeneric, medGeneric) : 0;
      const crossSim = queryBrand ? similarity(queryBrand, medGeneric) : 0;

      const exactBrand = queryBrand.length > 0 && queryBrand === medBrand;
      const exactStrength =
        queryStrength.length > 0 &&
        (medStrength === queryStrength ||
          medStrength.includes(queryStrength) ||
          queryStrength.includes(medStrength));
      const formMatches =
        !queryForm ||
        medForm === queryForm ||
        (queryForm === 'syrup' && medForm === 'suspension') ||
        (queryForm === 'cream' && medForm === 'ointment');

      let score = Math.max(brandSim * 0.72, genericSim * 0.55, crossSim * 0.52);
      if (exactBrand) score += 0.2;
      if (exactStrength) score += 0.2;
      if (formMatches && queryForm) score += 0.1;
      if (med.referenceUnitPrice > 0 || med.customUnitPrice !== null) {
        score += 0.04;
      }

      const isStrictVerified =
        exactBrand &&
        (!queryStrength || exactStrength) &&
        formMatches &&
        extracted.confidence !== 'low';

      return { med, score, isStrictVerified, exactBrand };
    })
    .filter((entry) => entry.score >= 0.45)
    .sort((a, b) => b.score - a.score);

  const candidates = scored.slice(0, 6).map((s) => s.med);

  if (scored.length > 0 && scored[0].isStrictVerified) {
    const sameBrandOthers = scored.filter(
      (s) => s.exactBrand && s.med.id !== scored[0].med.id
    );
    if (!queryStrength && sameBrandOthers.length > 0) {
      return { matched: null, candidates, status: 'needs_selection' };
    }
    return { matched: scored[0].med, candidates, status: 'verified' };
  }

  if (candidates.length > 0) {
    return { matched: null, candidates, status: 'needs_selection' };
  }

  return { matched: null, candidates: [], status: 'unverified' };
}

export function searchMedicinesFuzzy(params: {
  q?: string;
  dosageForm?: string;
  strength?: string;
  generic?: string;
  limit?: number;
  offset?: number;
}): {
  medicines: MedicineRecord[];
  totalMatched: number;
} {
  const primary = queryMedicinesFast(params);
  if (primary.medicines.length > 0 || !params.q || params.q.trim().length < 3) {
    return primary;
  }

  // Fuzzy prefix fallback for minor typos (e.g. "Secloo" -> "Secl")
  const trimmed = params.q.trim();
  const prefix = trimmed.slice(0, Math.max(3, Math.floor(trimmed.length * 0.65)));
  const candidates = queryMedicinesFast({
    ...params,
    q: prefix,
    limit: 120,
    offset: 0,
  });

  const qNorm = normalizeToken(trimmed);
  const rescored = candidates.medicines
    .map((m) => ({
      m,
      score: Math.max(similarity(qNorm, m.brandName), similarity(qNorm, m.genericName) * 0.9),
    }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);

  const limit = params.limit ?? 60;
  return {
    medicines: rescored.slice(0, limit),
    totalMatched: rescored.length,
  };
}

export async function buildPrescriptionLinesFromExtracted(
  extractedList: ExtractedMedicineRaw[]
): Promise<PrescriptionLineItem[]> {
  return Promise.all(
    extractedList.map(async (raw, idx) => {
      const { matched: initialMatch, candidates, status } = matchMedicineStrict(raw);
      let matched = initialMatch;

      // If matched brand is in the full 25,700+ MedEx catalog without cached price yet, fetch live MedEx price on-demand
      if (
        matched &&
        matched.customUnitPrice === null &&
        matched.referenceUnitPrice <= 0 &&
        matched.medexUrl.includes('medex.com.bd/brands/')
      ) {
        try {
          const refreshed = await fetchAndCacheMedicinePrice(matched.id);
          if (refreshed) matched = refreshed;
        } catch {
          // Leave price unverified if MedEx unreachable
        }
      }

      const rawPrice = matched
        ? matched.customUnitPrice ?? (matched.referenceUnitPrice > 0 ? matched.referenceUnitPrice : null)
        : null;

      const dosePerIntake =
        raw.dosePerIntake !== null && raw.dosePerIntake > 0 ? raw.dosePerIntake : 1;

      const durationDays =
        raw.durationDays !== null && raw.durationDays > 0 ? raw.durationDays : 7;

      const finalStatus: PriceMatchStatus =
        matched && rawPrice !== null
          ? status
          : matched && rawPrice === null
          ? 'unverified'
          : status;

      return {
        lineId: `rx-${Date.now()}-${idx}`,
        rawText: raw.rawText || `${raw.brandName} ${raw.strength}`.trim(),
        brandName: matched ? matched.brandName : raw.brandName || 'Unreadable Medicine',
        genericName: matched ? matched.genericName : raw.genericName || '',
        strength: matched ? matched.strength : raw.strength || '',
        dosageForm: matched ? matched.dosageForm : raw.dosageForm || 'Tablet',
        dosePerIntake,
        doseUnit: raw.doseUnit || (matched ? matched.unitLabel : 'tablet'),
        frequencyCode: raw.frequencyCode || (raw.isAsNeededOrVariable ? 'SOS' : '1+0+1'),
        frequencyPerDay: raw.isAsNeededOrVariable ? null : raw.frequencyPerDay,
        isAsNeededOrVariable: raw.isAsNeededOrVariable,
        prescribedDurationDays: raw.durationDays,
        durationDays,
        explicitQuantity: raw.explicitQuantity,
        manualQuantity: raw.explicitQuantity ?? null,
        instructions: raw.instructions || '',
        confidence: raw.confidence || 'medium',
        uncertaintyReason:
          raw.uncertaintyReason ||
          (finalStatus === 'needs_selection'
            ? 'Exact strength or brand variant needs staff selection.'
            : finalStatus === 'unverified'
            ? 'Price not verified yet. Fetch MedEx price or enter manually.'
            : ''),
        verifiedByStaff: false,

        matchedMedicineId: matched ? matched.id : null,
        matchedMedicine: matched,
        candidateMatches: candidates,
        matchStatus: finalStatus,
        unitPrice: rawPrice,
        priceSource:
          matched && rawPrice !== null
            ? matched.customUnitPrice !== null
              ? 'Pharmacy Custom Price (MedEx Ref)'
              : matched.priceSource
            : 'Price not verified',
        medexUrl: matched ? matched.medexUrl : '',
        lastVerifiedAt: matched ? matched.lastVerifiedAt : '',

        packSize: matched ? matched.packSize : 10,
        packUnit: matched ? matched.packUnit : 'strip',
        sellingRule: matched ? matched.sellingRule : 'individual',
        sellByFullStripOverride: null,

        discountPercent: 0,
        included: true,
      };
    })
  );
}

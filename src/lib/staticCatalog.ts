import type {
  BillRecord,
  ExtractedMedicineRaw,
  ExtractionResponse,
  MedicineRecord,
  PharmacySettings,
  PrescriptionLineItem,
  PriceMatchStatus,
  SellingRule,
} from '../types';
import type {
  DashboardSummaryResponse,
  MedexSyncStatusResponse,
  MedicineSearchResponse,
} from './api';
import { extractPdfContent, renderPdfPagesToImages } from './pdfExtract';
import { parsePrescriptionText } from './rxTextParser';

interface CompactCatalogPayload {
  v: number;
  g: string[];
  f: string[];
  m: string[];
  r: Array<
    [
      number, // id
      string, // brand
      number, // generic idx
      string, // strength
      number, // form idx
      number, // mfr idx
      number, // packSize
      number, // refUnitPrice
      number, // refPackPrice
      number, // ruleCode
      string, // medex slug
      string?, // verifiedDate
    ]
  >;
}

const RULE_FROM_CODE: SellingRule[] = [
  'individual',
  'strip',
  'bottle',
  'tube',
  'inhaler',
  'sachet',
  'vial',
];

const LS_OVERRIDES = 'shifarx_med_overrides_v1';
const LS_CUSTOM_MEDS = 'shifarx_med_custom_v1';
const LS_BILLS = 'shifarx_bills_v1';
const LS_SETTINGS = 'shifarx_settings_v1';

const DEFAULT_SETTINGS: PharmacySettings = {
  pharmacyName: 'Shifa Model Pharmacy',
  tagline: 'Authentic Medicine & Prescription Care',
  address: 'House 14, Road 7, Dhanmondi, Dhaka-1205',
  phone: '+880 1711-000842',
  drugLicenseNo: 'DGDA-DHK-2026-4419',
  defaultStripOnly: false,
  defaultPaperSize: '80mm',
  footerNote:
    'Check medicines and expiry before leaving counter. Sold items are exchanged within 3 days with receipt.',
};

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota issues gracefully
  }
}

function deriveUnits(
  rule: SellingRule,
  dosageForm: string,
  packSize: number
): { packUnit: string; unitLabel: string } {
  if (rule === 'bottle') {
    return {
      packUnit: 'bottle',
      unitLabel: packSize > 1 ? `bottle (${packSize} ml)` : 'bottle',
    };
  }
  if (rule === 'tube') {
    return {
      packUnit: 'tube',
      unitLabel: packSize > 1 ? `tube (${packSize} gm)` : 'tube',
    };
  }
  if (rule === 'inhaler') {
    return {
      packUnit: 'inhaler',
      unitLabel: packSize > 1 ? `inhaler (${packSize} puffs)` : 'inhaler',
    };
  }
  if (rule === 'sachet') return { packUnit: 'sachet', unitLabel: 'sachet' };
  if (rule === 'vial') return { packUnit: 'vial', unitLabel: 'vial' };
  const isCap = dosageForm.toLowerCase().includes('caps');
  return { packUnit: 'strip', unitLabel: isCap ? 'capsule' : 'tablet' };
}

let catalogPromise: Promise<MedicineRecord[]> | null = null;
let cachedBaseCatalog: MedicineRecord[] | null = null;

async function loadBaseCatalog(): Promise<MedicineRecord[]> {
  if (cachedBaseCatalog) return cachedBaseCatalog;
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const res = await fetch('/data/medex-catalog.json');
      if (!res.ok) {
        throw new Error('Could not load bundled MedEx catalog.');
      }
      const data = (await res.json()) as CompactCatalogPayload;
      const list: MedicineRecord[] = data.r.map((row) => {
        const [
          id,
          brandName,
          gIdx,
          strength,
          fIdx,
          mIdx,
          packSize,
          referenceUnitPrice,
          referencePackPrice,
          ruleCode,
          slug,
          verifiedDate,
        ] = row;
        const dosageForm = data.f[fIdx] || 'Tablet';
        const sellingRule = RULE_FROM_CODE[ruleCode] || 'individual';
        const { packUnit, unitLabel } = deriveUnits(sellingRule, dosageForm, packSize);
        const medexUrl = slug
          ? slug.startsWith('http')
            ? slug
            : `https://medex.com.bd/brands/${slug}`
          : 'https://medex.com.bd/';

        return {
          id,
          brandName,
          genericName: data.g[gIdx] || '',
          strength,
          dosageForm,
          manufacturer: data.m[mIdx] || '',
          packSize,
          packUnit,
          unitLabel,
          referenceUnitPrice,
          referencePackPrice,
          customUnitPrice: null,
          sellingRule,
          priceSource:
            referenceUnitPrice > 0
              ? 'MedEx Bangladesh'
              : 'MedEx Bangladesh (Set / Verify Price)',
          medexUrl,
          lastVerifiedAt: verifiedDate || '',
          stockQty: null,
          reorderLevel: null,
          batchNumber: null,
          expiryDate: null,
          supplierName: null,
        };
      });
      cachedBaseCatalog = list;
      return list;
    })().catch((err) => {
      catalogPromise = null;
      throw err;
    });
  }
  return catalogPromise;
}

async function getMergedCatalog(): Promise<MedicineRecord[]> {
  const base = await loadBaseCatalog();
  const overrides = readJsonStorage<Record<string, Partial<MedicineRecord>>>(
    LS_OVERRIDES,
    {}
  );
  const customMeds = readJsonStorage<MedicineRecord[]>(LS_CUSTOM_MEDS, []);

  const hasOverrides = Object.keys(overrides).length > 0;
  const mergedBase = hasOverrides
    ? base.map((m) => {
        const patch = overrides[String(m.id)];
        return patch ? { ...m, ...patch } : m;
      })
    : base;

  return customMeds.length > 0 ? [...customMeds, ...mergedBase] : mergedBase;
}

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
  if (f.includes('tab')) return 'tablet';
  if (f.includes('cap')) return 'capsule';
  if (f.includes('syr')) return 'syrup';
  if (f.includes('susp')) return 'suspension';
  if (f.includes('sol') || f.includes('lotion')) return 'solution';
  if (f.includes('gel')) return 'gel';
  if (f.includes('inj') || f.includes('vial') || f.includes('amp')) return 'injection';
  if (f.includes('inhal') || f.includes('puff')) return 'inhaler';
  if (f.includes('drop')) return 'eye drops';
  if (f.includes('cream')) return 'cream';
  if (f.includes('oint')) return 'ointment';
  if (f.includes('powd') || f.includes('sach')) return 'powder';
  return f;
}

function strengthsMatch(queryStrength: string, medStrength: string): boolean {
  const qs = normalizeStrength(queryStrength);
  const ms = normalizeStrength(medStrength);
  if (!qs || !ms) return false;
  if (ms === qs || ms.includes(qs) || qs.includes(ms)) return true;

  // Match slash vs plus combinations e.g. "500/20mg" <-> "500mg+20mg"
  const qNums = qs.match(/\d+(?:\.\d+)?/g) || [];
  const mNums = ms.match(/\d+(?:\.\d+)?/g) || [];
  if (qNums.length > 0 && qNums.length === mNums.length) {
    return qNums.every((n, idx) => Number(n) === Number(mNums[idx]));
  }
  return false;
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

export async function staticSearchMedicines(params: {
  q?: string;
  dosageForm?: string;
  strength?: string;
  generic?: string;
  limit?: number;
  offset?: number;
}): Promise<MedicineSearchResponse> {
  const catalog = await getMergedCatalog();
  const q = (params.q || '').trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const formFilter = (params.dosageForm || '').trim().toLowerCase();
  const strengthFilter = (params.strength || '').trim().toLowerCase().replace(/\s+/g, '');
  const genericFilter = (params.generic || '').trim().toLowerCase();
  const limit = Math.min(200, Math.max(1, params.limit ?? 60));
  const offset = Math.max(0, params.offset ?? 0);

  let verifiedPriceCount = 0;
  const matches: MedicineRecord[] = [];

  for (let i = 0; i < catalog.length; i++) {
    const m = catalog[i];
    if (m.referenceUnitPrice > 0 || m.customUnitPrice !== null) {
      verifiedPriceCount++;
    }

    if (formFilter && formFilter !== 'all' && !m.dosageForm.toLowerCase().includes(formFilter)) {
      continue;
    }
    if (
      strengthFilter &&
      !m.strength.toLowerCase().replace(/\s+/g, '').includes(strengthFilter)
    ) {
      continue;
    }
    if (genericFilter && !m.genericName.toLowerCase().includes(genericFilter)) {
      continue;
    }

    if (tokens.length > 0) {
      const hay = `${m.brandName} ${m.genericName} ${m.strength} ${m.manufacturer}`.toLowerCase();
      let allMatch = true;
      for (let t = 0; t < tokens.length; t++) {
        if (!hay.includes(tokens[t])) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) continue;
    }

    matches.push(m);
  }

  // Fuzzy prefix fallback for minor typos (e.g. "Secloo" -> "Secl")
  let finalList = matches;
  if (matches.length === 0 && q.length >= 3) {
    const prefix = q.slice(0, Math.max(3, Math.floor(q.length * 0.65)));
    const qNorm = normalizeToken(q);
    finalList = catalog
      .filter((m) => {
        if (formFilter && formFilter !== 'all' && !m.dosageForm.toLowerCase().includes(formFilter)) {
          return false;
        }
        return (
          m.brandName.toLowerCase().includes(prefix) ||
          m.genericName.toLowerCase().includes(prefix)
        );
      })
      .map((m) => ({
        m,
        score: Math.max(similarity(qNorm, m.brandName), similarity(qNorm, m.genericName) * 0.9),
      }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.m);
  } else {
    finalList.sort((a, b) => {
      if (q) {
        const ab = a.brandName.toLowerCase();
        const bb = b.brandName.toLowerCase();
        const ar =
          ab === q
            ? 0
            : ab.startsWith(q)
            ? 1
            : a.genericName.toLowerCase().startsWith(q)
            ? 2
            : 3;
        const br =
          bb === q
            ? 0
            : bb.startsWith(q)
            ? 1
            : b.genericName.toLowerCase().startsWith(q)
            ? 2
            : 3;
        if (ar !== br) return ar - br;
      }
      const ap = a.referenceUnitPrice > 0 || a.customUnitPrice !== null ? 0 : 1;
      const bp = b.referenceUnitPrice > 0 || b.customUnitPrice !== null ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.brandName.localeCompare(b.brandName);
    });
  }

  return {
    medicines: finalList.slice(offset, offset + limit),
    totalMatched: finalList.length,
    totalCatalog: catalog.length,
    verifiedPriceCount,
  };
}

export async function staticCreateMedicine(
  payload: Partial<MedicineRecord>
): Promise<{ medicine: MedicineRecord }> {
  const customMeds = readJsonStorage<MedicineRecord[]>(LS_CUSTOM_MEDS, []);
  const nextId =
    customMeds.reduce((max, m) => Math.max(max, m.id), 100000) + 1;
  const packSize = Number(payload.packSize) || 10;
  const refUnit = Number(payload.referenceUnitPrice) || 0;
  const created: MedicineRecord = {
    id: nextId,
    brandName: String(payload.brandName || '').trim(),
    genericName: String(payload.genericName || '').trim(),
    strength: String(payload.strength || '').trim(),
    dosageForm: String(payload.dosageForm || 'Tablet').trim(),
    manufacturer: String(payload.manufacturer || 'Local / Unspecified').trim(),
    packSize,
    packUnit: String(payload.packUnit || 'strip'),
    unitLabel: String(payload.unitLabel || 'tablet'),
    referenceUnitPrice: refUnit,
    referencePackPrice: Number(payload.referencePackPrice) || refUnit * packSize,
    customUnitPrice:
      payload.customUnitPrice !== null && payload.customUnitPrice !== undefined
        ? Number(payload.customUnitPrice)
        : null,
    sellingRule: payload.sellingRule || 'individual',
    priceSource: String(payload.priceSource || 'Manual Pharmacy Entry'),
    medexUrl: String(payload.medexUrl || 'https://medex.com.bd/'),
    lastVerifiedAt: String(
      payload.lastVerifiedAt || new Date().toISOString().slice(0, 10)
    ),
    stockQty: payload.stockQty ?? null,
    reorderLevel: payload.reorderLevel ?? null,
    batchNumber: payload.batchNumber ?? null,
    expiryDate: payload.expiryDate ?? null,
    supplierName: payload.supplierName ?? null,
  };
  customMeds.unshift(created);
  writeJsonStorage(LS_CUSTOM_MEDS, customMeds);
  return { medicine: created };
}

export async function staticUpdateMedicine(
  id: number,
  patch: Partial<MedicineRecord>
): Promise<{ medicine: MedicineRecord }> {
  const customMeds = readJsonStorage<MedicineRecord[]>(LS_CUSTOM_MEDS, []);
  const customIdx = customMeds.findIndex((m) => m.id === id);
  if (customIdx !== -1) {
    customMeds[customIdx] = { ...customMeds[customIdx], ...patch };
    writeJsonStorage(LS_CUSTOM_MEDS, customMeds);
    return { medicine: customMeds[customIdx] };
  }

  const base = await loadBaseCatalog();
  const target = base.find((m) => m.id === id);
  if (!target) {
    throw new Error('Medicine not found.');
  }

  const overrides = readJsonStorage<Record<string, Partial<MedicineRecord>>>(
    LS_OVERRIDES,
    {}
  );
  const nextPatch = { ...(overrides[String(id)] || {}), ...patch };
  overrides[String(id)] = nextPatch;
  writeJsonStorage(LS_OVERRIDES, overrides);
  return { medicine: { ...target, ...nextPatch } };
}

export function staticListBills(limit = 100): { bills: BillRecord[] } {
  const bills = readJsonStorage<BillRecord[]>(LS_BILLS, []);
  return { bills: bills.slice(0, limit) };
}

export function staticCreateBill(
  payload: Omit<BillRecord, 'id' | 'invoiceNumber' | 'createdAt'>
): { bill: BillRecord } {
  const bills = readJsonStorage<BillRecord[]>(LS_BILLS, []);
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const countToday = bills.filter((b) =>
    b.invoiceNumber.startsWith(`INV-${datePart}-`)
  ).length;
  const invoiceNumber = `INV-${datePart}-${String(countToday + 1).padStart(4, '0')}`;
  const nextId = bills.reduce((max, b) => Math.max(max, b.id), 0) + 1;

  const saved: BillRecord = {
    ...payload,
    id: nextId,
    invoiceNumber,
    createdAt: now.toISOString(),
  };

  // Keep latest 100 bills; omit large Rx images from older bills if quota is tight
  const updated = [saved, ...bills].slice(0, 100);
  try {
    localStorage.setItem(LS_BILLS, JSON.stringify(updated));
  } catch {
    const slim = updated.map((b, i) => (i === 0 ? b : { ...b, prescriptionImage: null }));
    writeJsonStorage(LS_BILLS, slim);
  }
  return { bill: saved };
}

export async function staticGetDashboard(): Promise<DashboardSummaryResponse> {
  const catalog = await getMergedCatalog();
  const bills = readJsonStorage<BillRecord[]>(LS_BILLS, []);
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todayBills = bills.filter((b) => b.createdAt.startsWith(todayPrefix));

  const todaySales = todayBills.reduce((s, b) => s + b.grandTotal, 0);
  const todayCollected = todayBills.reduce(
    (s, b) => s + (b.paidAmount - b.changeAmount),
    0
  );
  const todayDue = todayBills.reduce((s, b) => s + b.dueAmount, 0);

  return {
    todayBillCount: todayBills.length,
    todaySales: Number(todaySales.toFixed(2)),
    todayCollected: Number(todayCollected.toFixed(2)),
    todayDue: Number(todayDue.toFixed(2)),
    totalMedicines: catalog.length,
    recentBills: bills.slice(0, 8),
  };
}

export function staticGetSettings(): { settings: PharmacySettings } {
  const saved = readJsonStorage<PharmacySettings | null>(LS_SETTINGS, null);
  return { settings: saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS };
}

export function staticUpdateSettings(
  patch: Partial<PharmacySettings>
): { settings: PharmacySettings } {
  const current = staticGetSettings().settings;
  const merged = { ...current, ...patch };
  writeJsonStorage(LS_SETTINGS, merged);
  return { settings: merged };
}

export async function staticGetMedexSyncStatus(): Promise<MedexSyncStatusResponse> {
  const catalog = await getMergedCatalog();
  const verifiedPriceCount = catalog.filter(
    (m) => m.referenceUnitPrice > 0 || m.customUnitPrice !== null
  ).length;
  return {
    running: false,
    currentPage: 859,
    totalPages: 859,
    syncedBrandsThisRun: 0,
    totalCatalogCount: catalog.length,
    verifiedPriceCount,
    lastError: null,
    completedAt: '2026-11-20T00:00:00.000Z',
  };
}

// --- Client-side PDF + Browser Tesseract OCR + Strict MedEx Matching ---
function matchStrictInCatalog(
  extracted: ExtractedMedicineRaw,
  catalog: MedicineRecord[]
): {
  matched: MedicineRecord | null;
  candidates: MedicineRecord[];
  status: PriceMatchStatus;
} {
  const queryBrand = normalizeToken(extracted.brandName || '');
  // Also try brand without trailing numeric suffix e.g. "Giane 35" -> "Giane"
  const queryBrandBase = queryBrand.replace(/\s+\d+(?:\.\d+)?$/, '').trim();
  const queryGeneric = normalizeToken(extracted.genericName || '');
  const queryStrength = normalizeStrength(extracted.strength || '');
  const queryForm = normalizeForm(extracted.dosageForm || '');

  const prefix = (queryBrandBase || queryBrand).slice(0, 3);
  const pool = catalog.filter((m) => {
    const b = m.brandName.toLowerCase();
    const g = m.genericName.toLowerCase();
    return (
      (prefix.length >= 2 && (b.includes(prefix) || g.includes(prefix))) ||
      (queryGeneric.length >= 3 && g.includes(queryGeneric.slice(0, 4)))
    );
  });

  const scored = pool
    .map((med) => {
      const medBrand = normalizeToken(med.brandName);
      const medGeneric = normalizeToken(med.genericName);
      const medForm = normalizeForm(med.dosageForm);

      const brandSim = Math.max(
        queryBrand ? similarity(queryBrand, medBrand) : 0,
        queryBrandBase ? similarity(queryBrandBase, medBrand) : 0
      );
      const genericSim = queryGeneric ? similarity(queryGeneric, medGeneric) : 0;
      const crossSim = queryBrand ? similarity(queryBrand, medGeneric) : 0;

      const exactBrand =
        (queryBrand.length > 0 && queryBrand === medBrand) ||
        (queryBrandBase.length > 0 && queryBrandBase === medBrand);
      const exactStrength =
        queryStrength.length > 0 && strengthsMatch(queryStrength, med.strength);
      const formMatches =
        !queryForm ||
        medForm === queryForm ||
        (queryForm === 'syrup' && medForm === 'suspension') ||
        (queryForm === 'cream' && (medForm === 'ointment' || medForm === 'gel'));

      let score = Math.max(brandSim * 0.72, genericSim * 0.55, crossSim * 0.52);
      if (exactBrand) score += 0.22;
      if (exactStrength) score += 0.2;
      if (formMatches && queryForm) score += 0.1;
      if (med.referenceUnitPrice > 0 || med.customUnitPrice !== null) score += 0.04;

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

  // If brand matched uniquely (e.g. Giane 35 -> only 1 Giane in MedEx) with matching form, match it cleanly
  if (scored.length > 0 && scored[0].exactBrand) {
    const exactBrandGroup = scored.filter((s) => s.exactBrand);
    if (exactBrandGroup.length === 1) {
      return { matched: scored[0].med, candidates, status: 'verified' };
    }
  }

  if (candidates.length > 0) {
    return { matched: null, candidates, status: 'needs_selection' };
  }
  return { matched: null, candidates: [], status: 'unverified' };
}

let browserWorkerPromise: Promise<import('tesseract.js').Worker> | null = null;

function getOrCreateBrowserWorker(): Promise<import('tesseract.js').Worker> {
  if (!browserWorkerPromise) {
    browserWorkerPromise = import('tesseract.js')
      .then((mod) => mod.default.createWorker('eng'))
      .catch((err) => {
        browserWorkerPromise = null;
        throw err;
      });
  }
  return browserWorkerPromise;
}

/**
 * Pre-warm browser Tesseract worker quietly so the first Local OCR scan is fast.
 */
export function warmupBrowserOcr(): void {
  void getOrCreateBrowserWorker().catch(() => {});
  void loadBaseCatalog().catch(() => {});
}

/**
 * Upscale small prescription images and apply crisp grayscale contrast boost for cleaner OCR.
 */
async function enhanceImageForOcr(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Upscale small images (< 1400px) so tiny medicine fonts become readable by Tesseract
      const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = maxDim < 1200 ? Math.min(2, 1500 / Math.max(1, maxDim)) : 1;
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        const contrast = 1.28;
        const intercept = 128 * (1 - contrast);
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const v = Math.max(0, Math.min(255, gray * contrast + intercept));
          d[i] = v;
          d[i + 1] = v;
          d[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export async function staticExtractPrescriptionLocal(
  imageBase64: string,
  mimeType: string
): Promise<ExtractionResponse> {
  const rawDataUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:${mimeType};base64,${imageBase64}`;

  const catalog = await getMergedCatalog();
  const knownBrandNames = catalog.map((m) => m.brandName);

  let fullText = '';
  let sourceLabel = 'Browser Local OCR';
  let parsed = parsePrescriptionText('', knownBrandNames, sourceLabel);

  if (mimeType === 'application/pdf') {
    const pdfRes = await extractPdfContent(rawDataUrl);
    if (pdfRes.isDigitalText) {
      fullText = pdfRes.text;
      sourceLabel = 'PDF Digital Text Extraction';
      parsed = parsePrescriptionText(fullText, knownBrandNames, sourceLabel);
    }

    // Hybrid or scanned PDF fallback: if digital text yielded 0 medicines, render pages and run Tesseract OCR!
    if (parsed.medicines.length === 0) {
      const pageImages =
        pdfRes.pageImages.length > 0
          ? pdfRes.pageImages
          : await renderPdfPagesToImages(rawDataUrl, 2);

      if (pageImages.length > 0) {
        const worker = await getOrCreateBrowserWorker();
        const ocrPages: string[] = [];
        for (const pageImg of pageImages) {
          const enhanced = await enhanceImageForOcr(pageImg);
          const { data } = await worker.recognize(enhanced);
          if (data.text) ocrPages.push(data.text.trim());
        }
        const ocrText = ocrPages.join('\n').trim();
        if (ocrText) {
          const prevHeader = {
            doctorName: parsed.doctorName,
            patientName: parsed.patientName,
            prescriptionDate: parsed.prescriptionDate,
          };
          sourceLabel = 'PDF Scanned Page OCR';
          parsed = parsePrescriptionText(ocrText, knownBrandNames, sourceLabel);
          parsed.doctorName = parsed.doctorName || prevHeader.doctorName;
          parsed.patientName = parsed.patientName || prevHeader.patientName;
          parsed.prescriptionDate = parsed.prescriptionDate || prevHeader.prescriptionDate;
          fullText = fullText ? `${fullText}\n---\n${ocrText}` : ocrText;
        }
      }
    }
  } else {
    const [worker, preparedImage] = await Promise.all([
      getOrCreateBrowserWorker(),
      enhanceImageForOcr(rawDataUrl),
    ]);
    const { data } = await worker.recognize(preparedImage);
    fullText = (data.text || '').trim();
    parsed = parsePrescriptionText(fullText, knownBrandNames, sourceLabel);
  }

  const lines: PrescriptionLineItem[] = parsed.medicines.map((raw, idx) => {
    const { matched, candidates, status } = matchStrictInCatalog(raw, catalog);
    const rawPrice = matched
      ? matched.customUnitPrice ??
        (matched.referenceUnitPrice > 0 ? matched.referenceUnitPrice : null)
      : null;
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
      dosePerIntake: raw.dosePerIntake && raw.dosePerIntake > 0 ? raw.dosePerIntake : 1,
      doseUnit: raw.doseUnit || (matched ? matched.unitLabel : 'tablet'),
      frequencyCode: raw.frequencyCode || (raw.isAsNeededOrVariable ? 'SOS' : '1+0+1'),
      frequencyPerDay: raw.isAsNeededOrVariable ? null : raw.frequencyPerDay,
      isAsNeededOrVariable: raw.isAsNeededOrVariable,
      prescribedDurationDays: raw.durationDays,
      durationDays: raw.durationDays && raw.durationDays > 0 ? raw.durationDays : 7,
      explicitQuantity: raw.explicitQuantity,
      manualQuantity: raw.explicitQuantity ?? null,
      instructions: raw.instructions || '',
      confidence: raw.confidence || 'medium',
      uncertaintyReason:
        raw.uncertaintyReason ||
        (finalStatus === 'needs_selection'
          ? 'Exact strength or brand variant needs staff selection.'
          : finalStatus === 'unverified'
          ? 'Price not verified yet. Enter custom pharmacy price or check MedEx.'
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
  });

  return {
    doctorName: parsed.doctorName,
    patientName: parsed.patientName,
    prescriptionDate: parsed.prescriptionDate,
    notes: parsed.notes,
    lines,
    rawOcrText: fullText,
  };
}

import type { MedexLookupResult, MedicineRecord, SellingRule } from '../src/types.ts';
import {
  getMedicineById,
  getMedicineStats,
  updateMedicine,
  upsertMedexBrandsBulk,
  type MedexBrandCardInput,
} from './db.ts';

const MEDEX_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferPackagingFromForm(dosageForm: string): {
  sellingRule: SellingRule;
  packUnit: string;
  unitLabel: string;
  defaultPackSize: number;
} {
  const f = dosageForm.toLowerCase();
  if (f.includes('capsule')) {
    return { sellingRule: 'individual', packUnit: 'strip', unitLabel: 'capsule', defaultPackSize: 10 };
  }
  if (f.includes('tablet') || f.includes('caplet') || f.includes('pill') || f.includes('lozenge')) {
    return { sellingRule: 'individual', packUnit: 'strip', unitLabel: 'tablet', defaultPackSize: 10 };
  }
  if (
    f.includes('syrup') ||
    f.includes('suspension') ||
    f.includes('solution') ||
    f.includes('drop') ||
    f.includes('elixir') ||
    f.includes('lotion') ||
    f.includes('shampoo') ||
    f.includes('mouthwash') ||
    f.includes('spray') ||
    f.includes('infusion')
  ) {
    return { sellingRule: 'bottle', packUnit: 'bottle', unitLabel: 'bottle', defaultPackSize: 100 };
  }
  if (f.includes('cream') || f.includes('ointment') || f.includes('gel') || f.includes('paste')) {
    return { sellingRule: 'tube', packUnit: 'tube', unitLabel: 'tube', defaultPackSize: 10 };
  }
  if (f.includes('inhaler') || f.includes('rotacap') || f.includes('nebul')) {
    return { sellingRule: 'inhaler', packUnit: 'inhaler', unitLabel: 'inhaler', defaultPackSize: 200 };
  }
  if (f.includes('injection') || f.includes('iv') || f.includes('im') || f.includes('ampoule') || f.includes('vial')) {
    return { sellingRule: 'vial', packUnit: 'vial', unitLabel: 'vial', defaultPackSize: 1 };
  }
  if (f.includes('powder') || f.includes('sachet') || f.includes('granule') || f.includes('suppository')) {
    return { sellingRule: 'sachet', packUnit: 'sachet', unitLabel: 'sachet', defaultPackSize: 1 };
  }
  return { sellingRule: 'individual', packUnit: 'pack', unitLabel: 'unit', defaultPackSize: 10 };
}

export function parseMedexBrandListHtml(html: string): {
  brands: MedexBrandCardInput[];
  totalPages: number;
} {
  const pageMatches = [...html.matchAll(/page=(\d+)/g)].map((m) => Number(m[1]));
  const totalPages = pageMatches.length > 0 ? Math.max(...pageMatches) : 1;

  const brands: MedexBrandCardInput[] = [];
  const cardRegex =
    /<a[^>]*href="(https:\/\/medex\.com\.bd\/brands\/\d+\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  for (const match of html.matchAll(cardRegex)) {
    const medexUrl = match[1].split('?')[0].trim();
    const inner = match[2];
    if (!inner.includes('brand-card__name')) continue;

    const nameMatch = inner.match(/class="brand-card__name"[^>]*>([\s\S]*?)<\/span>/);
    const strengthMatch = inner.match(/class="brand-card__strength"[^>]*>([\s\S]*?)<\/div>/);
    const genericMatch = inner.match(/class="brand-card__generic"[^>]*>([\s\S]*?)<\/div>/);
    const companyMatch = inner.match(/class="brand-card__company"[^>]*>([\s\S]*?)<\/div>/);
    const formMatch =
      inner.match(/title=['"]([^'"]+)['"][^>]*class=['"][^'"]*dosage-icon/) ||
      inner.match(/class=['"][^'"]*dosage-icon[^>]*title=['"]([^'"]+)['"]/) ||
      inner.match(/alt=['"]([^'"]+)['"][^>]*class=['"][^'"]*dosage-icon/);

    const brandName = nameMatch ? decodeHtmlEntities(nameMatch[1].replace(/<[^>]+>/g, '')) : '';
    if (!brandName) continue;

    const strength = strengthMatch
      ? decodeHtmlEntities(strengthMatch[1].replace(/<[^>]+>/g, ''))
      : '';
    const genericName = genericMatch
      ? decodeHtmlEntities(genericMatch[1].replace(/<[^>]+>/g, ''))
      : '';
    const manufacturer = companyMatch
      ? decodeHtmlEntities(companyMatch[1].replace(/<[^>]+>/g, ''))
      : 'MedEx Listed Manufacturer';
    const dosageForm = formMatch ? decodeHtmlEntities(formMatch[1]) : 'Tablet';

    const pkg = inferPackagingFromForm(dosageForm);
    brands.push({
      brandName,
      genericName,
      strength,
      dosageForm,
      manufacturer,
      packSize: pkg.defaultPackSize,
      packUnit: pkg.packUnit,
      unitLabel: pkg.unitLabel,
      sellingRule: pkg.sellingRule,
      medexUrl,
    });
  }

  return { brands, totalPages };
}

export interface ParsedMedexPrice {
  unitPrice: number | null;
  packPrice: number | null;
  packSize: number | null;
  packUnit: string | null;
  unitLabel: string | null;
  sellingRule: SellingRule | null;
  rawSummary: string;
}

export async function fetchMedexBrandPrice(
  medexUrl: string,
  dosageForm = 'Tablet'
): Promise<ParsedMedexPrice> {
  const res = await fetch(medexUrl, {
    headers: MEDEX_HEADERS,
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) {
    throw new Error(`MedEx returned HTTP ${res.status} for ${medexUrl}`);
  }
  const html = await res.text();

  const pkgBlockMatch =
    html.match(/<div class="packages-wrapper"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/i) ||
    html.match(/package-container[\s\S]{0,1200}/i);

  const plainPkg = pkgBlockMatch
    ? decodeHtmlEntities(pkgBlockMatch[0].replace(/<[^>]+>/g, ' '))
    : '';

  const fallback = inferPackagingFromForm(dosageForm);
  let unitPrice: number | null = null;
  let packPrice: number | null = null;
  let packSize: number | null = null;
  let packUnit: string | null = fallback.packUnit;
  let unitLabel: string | null = fallback.unitLabel;
  let sellingRule: SellingRule | null = fallback.sellingRule;

  // Pattern 1: Unit Price: ৳ 2.50 ... (11 x 12: ৳ 330.00) ... Strip Price: ৳ 30.00
  const unitPriceMatch = plainPkg.match(/Unit Price:\s*৳\s*([\d,]+(?:\.\d+)?)/i);
  const stripPriceMatch = plainPkg.match(/Strip Price:\s*৳\s*([\d,]+(?:\.\d+)?)/i);
  const stripCountMatch = plainPkg.match(/\(\s*\d+\s*x\s*(\d+)\s*:/i);

  if (unitPriceMatch) {
    unitPrice = Number(unitPriceMatch[1].replace(/,/g, ''));
    if (stripPriceMatch) {
      packPrice = Number(stripPriceMatch[1].replace(/,/g, ''));
    }
    if (stripCountMatch) {
      packSize = Number(stripCountMatch[1]);
    } else if (unitPrice > 0 && packPrice && packPrice >= unitPrice) {
      packSize = Math.round(packPrice / unitPrice);
    }
    if (!packPrice && unitPrice && packSize) {
      packPrice = Number((unitPrice * packSize).toFixed(2));
    }
  } else {
    // Pattern 2: "60 ml bottle: ৳ 35.00" / "10 gm tube: ৳ 130.00" / "100 ml bottle: ৳ 150.00" / "1's pack: ৳ 190.00"
    const packLineMatch = plainPkg.match(
      /(\d+(?:\.\d+)?)\s*(ml|gm|g|mg|mcg|puffs?|doses?|sachets?|vials?|ampoules?|'s)?\s*(bottle|tube|vial|ampoule|inhaler|sachet|pack|syringe|pen|cartridge|drop|jar|container|box)?[^৳]{0,60}:\s*৳\s*([\d,]+(?:\.\d+)?)/i
    );
    if (packLineMatch) {
      const qtyNum = Number(packLineMatch[1]);
      const measure = (packLineMatch[2] || '').toLowerCase();
      const container = (packLineMatch[3] || '').toLowerCase();
      const priceVal = Number(packLineMatch[4].replace(/,/g, ''));
      if (!Number.isNaN(priceVal) && priceVal > 0) {
        unitPrice = priceVal;
        packPrice = priceVal;
        packSize = !Number.isNaN(qtyNum) && qtyNum > 0 ? Math.round(qtyNum) : fallback.defaultPackSize;
        if (container === 'bottle' || measure === 'ml') {
          packUnit = 'bottle';
          sellingRule = 'bottle';
          unitLabel = measure === 'ml' ? `bottle (${packSize} ml)` : 'bottle';
        } else if (container === 'tube' || measure === 'gm' || measure === 'g') {
          packUnit = 'tube';
          sellingRule = 'tube';
          unitLabel = measure ? `tube (${packSize} ${measure})` : 'tube';
        } else if (container === 'vial' || container === 'ampoule') {
          packUnit = 'vial';
          sellingRule = 'vial';
          unitLabel = container;
        } else if (container === 'inhaler') {
          packUnit = 'inhaler';
          sellingRule = 'inhaler';
          unitLabel = 'inhaler';
        }
      }
    } else {
      // Last resort: first ৳ price in package container
      const anyPrice = plainPkg.match(/৳\s*([\d,]+(?:\.\d+)?)/);
      if (anyPrice) {
        const val = Number(anyPrice[1].replace(/,/g, ''));
        if (!Number.isNaN(val) && val > 0) {
          unitPrice = val;
          packPrice = val;
        }
      }
    }
  }

  return {
    unitPrice,
    packPrice,
    packSize,
    packUnit,
    unitLabel,
    sellingRule,
    rawSummary: plainPkg.slice(0, 260) || 'Package details retrieved from MedEx Bangladesh.',
  };
}

export async function fetchAndCacheMedicinePrice(id: number): Promise<MedicineRecord | null> {
  const med = getMedicineById(id);
  if (!med || !med.medexUrl || !med.medexUrl.includes('medex.com.bd/brands/')) {
    return med;
  }

  const parsed = await fetchMedexBrandPrice(med.medexUrl, med.dosageForm);
  if (parsed.unitPrice === null) {
    return med;
  }

  const nextPackSize = parsed.packSize ?? med.packSize;
  const nextPackPrice =
    parsed.packPrice ?? Number((parsed.unitPrice * nextPackSize).toFixed(2));

  return updateMedicine(id, {
    referenceUnitPrice: parsed.unitPrice,
    referencePackPrice: nextPackPrice,
    packSize: nextPackSize,
    packUnit: parsed.packUnit ?? med.packUnit,
    unitLabel: parsed.unitLabel ?? med.unitLabel,
    sellingRule: parsed.sellingRule ?? med.sellingRule,
    priceSource: 'MedEx Bangladesh',
    lastVerifiedAt: new Date().toISOString().slice(0, 10),
  });
}

/**
 * Direct Live MedEx Bangladesh Search (no Gemini API key needed!)
 * Queries https://medex.com.bd/search?search=<query> directly and fetches live pricing
 * for the top matching brand page.
 */
export async function searchMedexDirect(query: string): Promise<MedexLookupResult> {
  const searchUrl = `https://medex.com.bd/search?search=${encodeURIComponent(query)}`;
  const res = await fetch(searchUrl, { headers: MEDEX_HEADERS });
  if (!res.ok) {
    throw new Error(`MedEx search returned HTTP ${res.status}`);
  }
  const html = await res.text();

  const rowRegex =
    /<div class="search-result-row">[\s\S]*?<a href="(https:\/\/medex\.com\.bd\/brands\/\d+\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p>([\s\S]*?)<\/p>/g;

  const matches: Array<{
    url: string;
    title: string;
    description: string;
    generic: string;
    manufacturer: string;
    dosageForm: string;
    brandName: string;
    strength: string;
  }> = [];

  for (const m of html.matchAll(rowRegex)) {
    const url = m[1].split('?')[0].trim();
    const title = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, ''));
    const descRaw = m[3];
    const description = decodeHtmlEntities(descRaw.replace(/<[^>]+>/g, ''));
    const genMatch = descRaw.match(/<i>\(([\s\S]*?)\)<\/i>/);
    const mfrMatch = description.match(/manufactured by\s+(.+?)\.?$/i);
    const formMatch = title.match(/\(([^)]+)\)\s*$/);
    const titleWithoutForm = title.replace(/\s*\([^)]+\)\s*$/, '').trim();
    const strengthMatch = titleWithoutForm.match(
      /(\d+(?:\.\d+)?\s*(?:mg|mcg|gm|g|ml|iu|%)(?:\/[\d.]+\s*(?:ml|mg|puff|dose))?(?:\s*\+\s*\d+(?:\.\d+)?\s*(?:mg|mcg|gm|g|ml|iu|%))*)/i
    );
    const strength = strengthMatch ? strengthMatch[1].trim() : '';
    const brandName = strength
      ? titleWithoutForm.replace(strength, '').trim()
      : titleWithoutForm;

    matches.push({
      url,
      title,
      description,
      generic: genMatch ? decodeHtmlEntities(genMatch[1]) : '',
      manufacturer: mfrMatch ? mfrMatch[1].trim() : 'MedEx Bangladesh',
      dosageForm: formMatch ? formMatch[1].trim() : 'Tablet',
      brandName,
      strength,
    });
    if (matches.length >= 6) break;
  }

  if (matches.length === 0) {
    return {
      summary: `No matching brand listing found on MedEx Bangladesh for "${query}".`,
      brandName: query,
      genericName: '',
      strength: '',
      dosageForm: 'Tablet',
      manufacturer: '',
      unitPrice: null,
      packPrice: null,
      packSize: null,
      sources: [{ title: 'MedEx Bangladesh Search', uri: searchUrl }],
    };
  }

  const top = matches[0];
  let priceData: ParsedMedexPrice | null = null;
  try {
    priceData = await fetchMedexBrandPrice(top.url, top.dosageForm);
  } catch {
    priceData = null;
  }

  // Upsert all found search matches into local catalog so future searches are instant!
  upsertMedexBrandsBulk(
    matches.map((m) => {
      const pkg = inferPackagingFromForm(m.dosageForm);
      return {
        brandName: m.brandName,
        genericName: m.generic,
        strength: m.strength,
        dosageForm: m.dosageForm,
        manufacturer: m.manufacturer,
        packSize: pkg.defaultPackSize,
        packUnit: pkg.packUnit,
        unitLabel: pkg.unitLabel,
        sellingRule: pkg.sellingRule,
        medexUrl: m.url,
      };
    })
  );

  const summaryLines = [
    `${top.title} — ${top.generic || 'Generic listed on MedEx'} (${top.manufacturer})`,
    priceData?.unitPrice !== null && priceData?.unitPrice !== undefined
      ? `Verified MedEx Price: ৳${priceData.unitPrice.toFixed(2)} ${
          priceData.packSize ? `(${priceData.packSize}/${priceData.packUnit || 'pack'})` : ''
        } · ${priceData.rawSummary}`
      : 'Price not listed on MedEx page — verify manually.',
  ];

  return {
    summary: summaryLines.join('\n'),
    brandName: top.brandName,
    genericName: top.generic,
    strength: top.strength,
    dosageForm: top.dosageForm,
    manufacturer: top.manufacturer,
    unitPrice: priceData?.unitPrice ?? null,
    packPrice: priceData?.packPrice ?? null,
    packSize: priceData?.packSize ?? null,
    sources: matches.slice(0, 4).map((m) => ({
      title: m.title,
      uri: m.url,
    })),
  };
}

// Background MedEx full catalog sync state
export interface MedexSyncStatus {
  running: boolean;
  currentPage: number;
  totalPages: number;
  syncedBrandsThisRun: number;
  totalCatalogCount: number;
  verifiedPriceCount: number;
  lastError: string | null;
  completedAt: string | null;
}

const syncState: MedexSyncStatus = {
  running: false,
  currentPage: 0,
  totalPages: 859,
  syncedBrandsThisRun: 0,
  totalCatalogCount: 0,
  verifiedPriceCount: 0,
  lastError: null,
  completedAt: null,
};

export function getMedexSyncStatus(): MedexSyncStatus {
  const stats = getMedicineStats();
  return {
    ...syncState,
    totalCatalogCount: stats.totalCatalog,
    verifiedPriceCount: stats.verifiedPriceCount,
  };
}

export async function runMedexCatalogSync(options?: {
  startPage?: number;
  endPage?: number;
  concurrency?: number;
}): Promise<MedexSyncStatus> {
  if (syncState.running) {
    return getMedexSyncStatus();
  }

  syncState.running = true;
  syncState.lastError = null;
  syncState.syncedBrandsThisRun = 0;
  syncState.completedAt = null;

  const startPage = Math.max(1, options?.startPage ?? 1);
  const concurrency = Math.min(20, Math.max(4, options?.concurrency ?? 14));

  try {
    // Probe page 1 first to discover latest totalPages dynamically
    const firstRes = await fetch(`https://medex.com.bd/brands?page=${startPage}`, {
      headers: MEDEX_HEADERS,
    });
    if (!firstRes.ok) {
      throw new Error(`MedEx brands directory returned HTTP ${firstRes.status}`);
    }
    const firstHtml = await firstRes.text();
    const firstParsed = parseMedexBrandListHtml(firstHtml);
    const totalPages = Math.min(
      options?.endPage ?? firstParsed.totalPages,
      firstParsed.totalPages
    );
    syncState.totalPages = totalPages;
    syncState.currentPage = startPage;

    if (firstParsed.brands.length > 0) {
      upsertMedexBrandsBulk(firstParsed.brands);
      syncState.syncedBrandsThisRun += firstParsed.brands.length;
    }

    const pages: number[] = [];
    for (let p = startPage + 1; p <= totalPages; p++) {
      pages.push(p);
    }

    let cursor = 0;
    const worker = async () => {
      while (cursor < pages.length) {
        const idx = cursor++;
        const pageNum = pages[idx];
        try {
          const r = await fetch(`https://medex.com.bd/brands?page=${pageNum}`, {
            headers: MEDEX_HEADERS,
          });
          if (!r.ok) continue;
          const html = await r.text();
          const parsed = parseMedexBrandListHtml(html);
          if (parsed.brands.length > 0) {
            upsertMedexBrandsBulk(parsed.brands);
            syncState.syncedBrandsThisRun += parsed.brands.length;
          }
          if (pageNum > syncState.currentPage) {
            syncState.currentPage = pageNum;
          }
        } catch {
          // Skip transient single-page error and continue syncing rest
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    syncState.completedAt = new Date().toISOString();
  } catch (err) {
    syncState.lastError = (err as Error).message;
  } finally {
    syncState.running = false;
  }

  return getMedexSyncStatus();
}

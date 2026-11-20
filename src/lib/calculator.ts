import type {
  BudgetProposal,
  CalculatedLineResult,
  PrescriptionLineItem,
} from '../types';

export interface ParsedFrequency {
  dailyCount: number | null; // null if SOS/PRN/Variable/Tapering
  isVariableOrSos: boolean;
  label: string;
}

const FRACTION_MAP: Record<string, number> = {
  '1/2': 0.5,
  '0.5': 0.5,
  '½': 0.5,
  '1/4': 0.25,
  '¼': 0.25,
  '3/4': 0.75,
  '¾': 0.75,
  '1.5': 1.5,
  '1½': 1.5,
};

function parseSinglePart(part: string): number {
  const cleaned = part.trim();
  if (!cleaned) return 0;
  if (FRACTION_MAP[cleaned] !== undefined) return FRACTION_MAP[cleaned];
  if (cleaned.includes('/')) {
    const [num, den] = cleaned.split('/').map(Number);
    if (!Number.isNaN(num) && !Number.isNaN(den) && den > 0) {
      return num / den;
    }
  }
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Parses common Bangladeshi & international prescription frequency patterns:
 * 1+0+1, 1+1+1, 0+0+1, 1/2+0+1, 1+1+1+1, OD, BD, TDS, QID, HS, EOD, Weekly, SOS, PRN, Tapering.
 */
export function parseFrequencyPattern(code: string): ParsedFrequency {
  const raw = (code || '').trim();
  const upper = raw.toUpperCase();

  if (
    !raw ||
    /\b(SOS|PRN|TAPER|TAPERING|VARIABLE|AS NEEDED|WHEN NEEDED)\b/i.test(raw)
  ) {
    return {
      dailyCount: null,
      isVariableOrSos: true,
      label: raw || 'SOS',
    };
  }

  // Bangladeshi plus-pattern e.g. 1+0+1, 1/2+0+1, 2+0+2, 1+1+1+1
  if (raw.includes('+')) {
    const parts = raw.split('+');
    const sum = parts.reduce((acc, p) => acc + parseSinglePart(p), 0);
    if (sum > 0) {
      return {
        dailyCount: Number(sum.toFixed(3)),
        isVariableOrSos: false,
        label: raw,
      };
    }
  }

  if (upper === 'OD' || upper === 'QD' || upper === 'HS' || upper === 'ONCE DAILY') {
    return { dailyCount: 1, isVariableOrSos: false, label: upper };
  }
  if (upper === 'BD' || upper === 'BID' || upper === 'TWICE DAILY') {
    return { dailyCount: 2, isVariableOrSos: false, label: upper };
  }
  if (upper === 'TDS' || upper === 'TID' || upper === 'THREE TIMES DAILY') {
    return { dailyCount: 3, isVariableOrSos: false, label: upper };
  }
  if (upper === 'QID' || upper === 'FOUR TIMES DAILY') {
    return { dailyCount: 4, isVariableOrSos: false, label: upper };
  }
  if (/ALTERNATE|EOD|EVERY OTHER/i.test(raw)) {
    return { dailyCount: 0.5, isVariableOrSos: false, label: 'Alternate Day' };
  }
  if (/WEEKLY|ONCE A WEEK|1\/WEEK/i.test(raw)) {
    return { dailyCount: 1 / 7, isVariableOrSos: false, label: 'Weekly' };
  }

  const numeric = Number(raw);
  if (!Number.isNaN(numeric) && numeric > 0) {
    return { dailyCount: numeric, isVariableOrSos: false, label: `${numeric}/day` };
  }

  return {
    dailyCount: null,
    isVariableOrSos: true,
    label: raw,
  };
}

export function isPackPricedForm(rule: PrescriptionLineItem['sellingRule']): boolean {
  return (
    rule === 'bottle' ||
    rule === 'tube' ||
    rule === 'vial' ||
    rule === 'inhaler' ||
    rule === 'sachet'
  );
}

export function formatBDT(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '—';
  }
  return `৳${amount.toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Core Quantity & Smart Packaging Calculation Engine
 * Never confuses required (prescribed) quantity with actual sale (packaged) quantity.
 */
export function calculateLineItem(
  item: PrescriptionLineItem,
  options: {
    durationOverrideDays?: number | null;
    globalStripOnly: boolean;
  }
): CalculatedLineResult {
  const parsedFreq = parseFrequencyPattern(item.frequencyCode);
  const manualRequired =
    item.isAsNeededOrVariable || parsedFreq.isVariableOrSos;

  const activeDuration =
    options.durationOverrideDays !== undefined &&
    options.durationOverrideDays !== null
      ? options.durationOverrideDays
      : item.durationDays;

  const packSize = Math.max(1, item.packSize || 10);
  const packPriced = isPackPricedForm(item.sellingRule);
  const effectivePrice =
    item.unitPrice !== null && !Number.isNaN(item.unitPrice)
      ? item.unitPrice
      : null;

  // Determine daily dosage units
  const dailyUnits =
    manualRequired || parsedFreq.dailyCount === null
      ? null
      : Number((item.dosePerIntake * parsedFreq.dailyCount).toFixed(3));

  // Calculate exact required quantity
  let requiredQty = 0;
  if (item.manualQuantity !== null && item.manualQuantity >= 0) {
    requiredQty = item.manualQuantity;
  } else if (manualRequired) {
    requiredQty = 0;
  } else if (dailyUnits !== null) {
    // Weekly medicine minimum 1 dose if duration >= 1 day
    if (parsedFreq.dailyCount !== null && parsedFreq.dailyCount < 0.25) {
      requiredQty = Math.max(1, Math.ceil(dailyUnits * activeDuration));
    } else {
      requiredQty = Math.ceil(dailyUnits * activeDuration);
    }
  }

  // Packaging & sale quantity rounding
  let saleQuantity = requiredQty;
  let packsCount = 0;
  let extraQuantity = 0;
  let requiredLabel = '';
  let saleLabel = '';

  const formLower = item.dosageForm.toLowerCase();
  const unitSingular =
    formLower.includes('capsule')
      ? 'cap'
      : formLower.includes('tablet')
      ? 'tab'
      : formLower.includes('syrup') || formLower.includes('suspension')
      ? 'ml'
      : item.sellingRule;

  if (manualRequired && item.manualQuantity === null) {
    requiredLabel = 'Manual entry req.';
    saleLabel = 'Enter qty';
    saleQuantity = 0;
  } else if (item.sellingRule === 'bottle') {
    if (item.manualQuantity !== null) {
      // Staff entered number of bottles directly
      packsCount = Math.ceil(item.manualQuantity);
      saleQuantity = packsCount;
      requiredLabel = `${packsCount} ${packsCount === 1 ? 'bottle' : 'bottles'}`;
      saleLabel = `${packsCount} ${packsCount === 1 ? 'bottle' : 'bottles'} (${packsCount * packSize} ml)`;
    } else if (formLower.includes('drop')) {
      // Drops: ~20 drops per ml; usually 1 bottle per course unless very long
      const mlNeeded = Math.max(1, Math.ceil(requiredQty / 20));
      packsCount = Math.max(1, Math.ceil(mlNeeded / packSize));
      saleQuantity = packsCount;
      requiredLabel = `${requiredQty} drops (~${mlNeeded} ml)`;
      saleLabel = `${packsCount} ${packsCount === 1 ? 'bottle' : 'bottles'} (${packSize} ml)`;
    } else {
      // Syrup / Suspension: dosePerIntake is ml (default 5ml if 1 tsf)
      const mlTotal =
        item.doseUnit.toLowerCase() === 'ml'
          ? requiredQty
          : requiredQty * 5;
      packsCount = Math.max(1, Math.ceil(mlTotal / packSize));
      saleQuantity = packsCount;
      extraQuantity = Math.max(0, packsCount * packSize - mlTotal);
      requiredLabel = `${mlTotal} ml`;
      saleLabel = `${packsCount} ${packsCount === 1 ? 'bottle' : 'bottles'} (${packsCount * packSize} ml)`;
    }
  } else if (item.sellingRule === 'inhaler') {
    if (item.manualQuantity !== null) {
      packsCount = Math.ceil(item.manualQuantity);
    } else {
      packsCount = Math.max(1, Math.ceil(requiredQty / packSize));
    }
    saleQuantity = packsCount;
    requiredLabel =
      item.manualQuantity !== null
        ? `${packsCount} inhaler`
        : `${requiredQty} puffs`;
    saleLabel = `${packsCount} ${packsCount === 1 ? 'inhaler' : 'inhalers'}`;
  } else if (
    item.sellingRule === 'tube' ||
    item.sellingRule === 'vial' ||
    item.sellingRule === 'sachet'
  ) {
    const qty = Math.max(
      item.sellingRule === 'tube' ? 1 : 0,
      Math.ceil(requiredQty)
    );
    packsCount = qty;
    saleQuantity = qty;
    const labelName = item.sellingRule;
    requiredLabel = `${qty} ${qty === 1 ? labelName : `${labelName}s`}`;
    saleLabel = requiredLabel;
  } else {
    // Tablets or Capsules (individual vs full strip)
    const enforceFullStrip =
      item.sellByFullStripOverride !== null
        ? item.sellByFullStripOverride
        : options.globalStripOnly || item.sellingRule === 'strip';

    requiredLabel = `${requiredQty} ${unitSingular}${requiredQty === 1 ? '' : 's'}`;

    if (enforceFullStrip && requiredQty > 0) {
      packsCount = Math.ceil(requiredQty / packSize);
      saleQuantity = packsCount * packSize;
      extraQuantity = saleQuantity - requiredQty;
      saleLabel = `${packsCount} ${packsCount === 1 ? 'strip' : 'strips'} (${saleQuantity} ${unitSingular}s)`;
    } else {
      packsCount = requiredQty > 0 ? Number((requiredQty / packSize).toFixed(2)) : 0;
      saleQuantity = requiredQty;
      extraQuantity = 0;
      saleLabel = `${saleQuantity} ${unitSingular}${saleQuantity === 1 ? '' : 's'}`;
    }
  }

  // Price calculation
  const billableUnits = packPriced ? packsCount : saleQuantity;
  const grossTotal =
    effectivePrice !== null ? Number((billableUnits * effectivePrice).toFixed(2)) : 0;
  const discountAmount = Number(
    ((grossTotal * Math.min(100, Math.max(0, item.discountPercent || 0))) / 100).toFixed(2)
  );
  const netTotal = Number(Math.max(0, grossTotal - discountAmount).toFixed(2));

  return {
    lineId: item.lineId,
    manualRequired,
    dailyUnits,
    requiredQuantity: requiredQty,
    requiredLabel,
    saleQuantity,
    saleLabel,
    packsCount,
    extraQuantity,
    isPackPriced: packPriced,
    effectiveUnitPrice: effectivePrice,
    grossTotal,
    discountAmount,
    netTotal,
    priceVerified: effectivePrice !== null && item.matchStatus !== 'unverified',
  };
}

/**
 * Mode B: Budget-Based Purchase Planner
 * Safety principles:
 * 1. Never silently drops, replaces, or alters any prescribed medicine.
 * 2. Computes full prescription cost vs customer budget & exact shortfall.
 * 3. When budget is insufficient, proposes a uniform duration adjustment across
 *    all daily scheduled medicines (respecting packaging) for pharmacist confirmation.
 */
export function buildBudgetProposal(
  lines: PrescriptionLineItem[],
  budgetAmount: number,
  options: {
    baseDurationDays: number | null;
    globalStripOnly: boolean;
  }
): BudgetProposal {
  const activeLines = lines.filter((l) => l.included);

  let fullTotal = 0;
  let unpricedItemCount = 0;
  let manualItemCount = 0;

  const fullCalcs = activeLines.map((line) => {
    const calc = calculateLineItem(line, {
      durationOverrideDays: options.baseDurationDays,
      globalStripOnly: options.globalStripOnly,
    });
    if (line.unitPrice === null) unpricedItemCount += 1;
    if (calc.manualRequired && line.manualQuantity === null) manualItemCount += 1;
    fullTotal += calc.netTotal;
    return { line, calc };
  });

  fullTotal = Number(fullTotal.toFixed(2));
  const fitsWithinBudget = budgetAmount >= fullTotal;
  const shortfall = Number(Math.max(0, fullTotal - budgetAmount).toFixed(2));

  if (fitsWithinBudget || activeLines.length === 0) {
    return {
      budgetAmount,
      fullPrescriptionTotal: fullTotal,
      shortfall: 0,
      fitsWithinBudget: true,
      proposedDays: options.baseDurationDays,
      proposedTotal: fullTotal,
      remainingAfterProposal: Number(Math.max(0, budgetAmount - fullTotal).toFixed(2)),
      unpricedItemCount,
      manualItemCount,
      itemBreakdowns: fullCalcs.map(({ line, calc }) => ({
        lineId: line.lineId,
        medicineName: `${line.brandName} ${line.strength}`.trim(),
        fullCost: calc.netTotal,
        proposedQty: calc.saleQuantity,
        proposedSaleLabel: calc.saleLabel,
        proposedCost: calc.netTotal,
        proposedDays: options.baseDurationDays ?? line.durationDays,
        isAdjusted: false,
        note: 'Full prescribed quantity fits budget',
      })),
    };
  }

  // Find maximum uniform duration (in whole days, >= 1) that keeps all prescribed medicines within budget
  const maxBaseDays = Math.max(
    1,
    options.baseDurationDays ??
      Math.max(...activeLines.map((l) => l.durationDays || 7), 7)
  );

  let bestDays: number | null = null;
  let bestCalcs = fullCalcs;
  let bestTotal = fullTotal;

  for (let d = maxBaseDays - 1; d >= 1; d--) {
    let sum = 0;
    const trial = activeLines.map((line) => {
      const calc = calculateLineItem(line, {
        durationOverrideDays: d,
        globalStripOnly: options.globalStripOnly,
      });
      sum += calc.netTotal;
      return { line, calc };
    });
    sum = Number(sum.toFixed(2));
    if (sum <= budgetAmount) {
      bestDays = d;
      bestCalcs = trial;
      bestTotal = sum;
      break;
    }
  }

  // If even 1 day with strict packaging exceeds budget, show 1-day breakdown transparently
  if (bestDays === null) {
    let sum = 0;
    bestCalcs = activeLines.map((line) => {
      const calc = calculateLineItem(line, {
        durationOverrideDays: 1,
        globalStripOnly: options.globalStripOnly,
      });
      sum += calc.netTotal;
      return { line, calc };
    });
    bestTotal = Number(sum.toFixed(2));
    bestDays = 1;
  }

  return {
    budgetAmount,
    fullPrescriptionTotal: fullTotal,
    shortfall,
    fitsWithinBudget: false,
    proposedDays: bestDays,
    proposedTotal: bestTotal,
    remainingAfterProposal: Number((budgetAmount - bestTotal).toFixed(2)),
    unpricedItemCount,
    manualItemCount,
    itemBreakdowns: bestCalcs.map(({ line, calc }, i) => {
      const fullCost = fullCalcs[i].calc.netTotal;
      const changed = calc.saleQuantity !== fullCalcs[i].calc.saleQuantity;
      return {
        lineId: line.lineId,
        medicineName: `${line.brandName} ${line.strength}`.trim(),
        fullCost,
        proposedQty: calc.saleQuantity,
        proposedSaleLabel: calc.saleLabel,
        proposedCost: calc.netTotal,
        proposedDays: bestDays,
        isAdjusted: changed,
        note: calc.manualRequired
          ? 'SOS/Manual — staff confirms quantity'
          : changed
          ? `Proposed ${bestDays}-day course (requires confirmation)`
          : 'Minimum packaging unit retained',
      };
    }),
  };
}

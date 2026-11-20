export type SellingRule =
  | 'individual'
  | 'strip'
  | 'bottle'
  | 'tube'
  | 'vial'
  | 'inhaler'
  | 'sachet';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type PriceMatchStatus = 'verified' | 'needs_selection' | 'unverified';

export interface MedicineRecord {
  id: number;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  manufacturer: string;
  packSize: number; // e.g., 10 tabs per strip, 100 ml per bottle, 1 vial
  packUnit: string; // e.g., 'strip', 'bottle', 'tube', 'vial', 'inhaler', 'sachet'
  unitLabel: string; // e.g., 'tablet', 'capsule', 'ml', 'bottle', 'tube', 'vial', 'inhaler', 'sachet'
  referenceUnitPrice: number; // MedEx reference price per selling unit (per tablet/cap OR per bottle/tube/vial)
  referencePackPrice: number; // MedEx reference price per full pack/strip/bottle
  customUnitPrice: number | null; // Pharmacy configurable selling price override
  sellingRule: SellingRule;
  priceSource: string;
  medexUrl: string;
  lastVerifiedAt: string;
  // Optional future-ready inventory fields
  stockQty: number | null;
  reorderLevel: number | null;
  batchNumber: string | null;
  expiryDate: string | null;
  supplierName: string | null;
}

export interface ExtractedMedicineRaw {
  rawText: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  dosePerIntake: number | null;
  doseUnit: string;
  frequencyCode: string;
  frequencyPerDay: number | null;
  isAsNeededOrVariable: boolean;
  durationDays: number | null;
  durationText: string;
  instructions: string;
  explicitQuantity: number | null;
  confidence: ConfidenceLevel;
  uncertaintyReason: string;
}

export interface PrescriptionLineItem {
  lineId: string;
  rawText: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  dosePerIntake: number;
  doseUnit: string;
  frequencyCode: string;
  frequencyPerDay: number | null; // null if SOS/PRN/variable
  isAsNeededOrVariable: boolean;
  prescribedDurationDays: number | null;
  durationDays: number; // active duration for this item
  explicitQuantity: number | null;
  manualQuantity: number | null; // staff override or SOS qty
  instructions: string;
  confidence: ConfidenceLevel;
  uncertaintyReason: string;
  verifiedByStaff: boolean;

  // Catalog & Pricing match
  matchedMedicineId: number | null;
  matchedMedicine: MedicineRecord | null;
  candidateMatches: MedicineRecord[];
  matchStatus: PriceMatchStatus;
  unitPrice: number | null; // price per individual unit (tab/cap) or per bottle/vial/tube
  priceSource: string;
  medexUrl: string;
  lastVerifiedAt: string;

  // Packaging rules
  packSize: number;
  packUnit: string;
  sellingRule: SellingRule;
  sellByFullStripOverride: boolean | null; // null = follow global/medicine rule

  // Discount & Inclusion
  discountPercent: number;
  included: boolean;
}

export interface CalculatedLineResult {
  lineId: string;
  manualRequired: boolean;
  dailyUnits: number | null;
  requiredQuantity: number; // exact prescribed units needed (e.g., 14 tablets, or 105 ml)
  requiredLabel: string;
  saleQuantity: number; // actual supplied units (e.g., 20 tablets if 2 full strips, or 2 bottles)
  saleLabel: string;
  packsCount: number; // strips/bottles/tubes count
  extraQuantity: number; // extra supplied due to strip/bottle rounding
  isPackPriced: boolean; // true for bottle/tube/vial/inhaler/sachet where unitPrice = price per bottle/pack
  effectiveUnitPrice: number | null;
  grossTotal: number;
  discountAmount: number;
  netTotal: number;
  priceVerified: boolean;
}

export interface BudgetProposal {
  budgetAmount: number;
  fullPrescriptionTotal: number;
  shortfall: number;
  fitsWithinBudget: boolean;
  proposedDays: number | null;
  proposedTotal: number;
  remainingAfterProposal: number;
  unpricedItemCount: number;
  manualItemCount: number;
  itemBreakdowns: Array<{
    lineId: string;
    medicineName: string;
    fullCost: number;
    proposedQty: number;
    proposedSaleLabel: string;
    proposedCost: number;
    proposedDays: number | null;
    isAdjusted: boolean;
    note: string;
  }>;
}

export interface BillItem {
  id: string;
  medicineId: number | null;
  medicineName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  requiredQuantity: number | null;
  quantity: number;
  unitLabel: string;
  packagingNote: string;
  unitPrice: number;
  discountPercent: number;
  lineTotal: number;
  instructions: string;
}

export type PaymentMethod = 'Cash' | 'Card' | 'bKash' | 'Nagad';

export interface BillRecord {
  id: number;
  invoiceNumber: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  doctorName: string;
  paymentMethod: PaymentMethod;
  subtotal: number;
  discountType: 'fixed' | 'percent';
  discountValue: number;
  discountAmount: number;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  changeAmount: number;
  purchaseMode: 'duration' | 'budget' | 'direct';
  durationDays: number | null;
  budgetAmount: number | null;
  items: BillItem[];
  notes: string;
  prescriptionImage?: string | null;
}

export interface PharmacySettings {
  pharmacyName: string;
  tagline: string;
  address: string;
  phone: string;
  drugLicenseNo: string;
  defaultStripOnly: boolean;
  defaultPaperSize: '58mm' | '80mm' | 'a4';
  footerNote: string;
}

export interface ExtractionResponse {
  doctorName: string;
  patientName: string;
  prescriptionDate: string;
  notes: string;
  lines: PrescriptionLineItem[];
  rawOcrText?: string;
}

export interface MedexLookupResult {
  summary: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  manufacturer: string;
  unitPrice: number | null;
  packPrice: number | null;
  packSize: number | null;
  sources: Array<{ title: string; uri: string }>;
}

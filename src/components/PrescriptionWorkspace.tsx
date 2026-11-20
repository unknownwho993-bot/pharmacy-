import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Wallet,
} from 'lucide-react';
import type {
  BillItem,
  MedicineRecord,
  PharmacySettings,
  PrescriptionLineItem,
} from '../types';
import { api } from '../lib/api';
import {
  buildBudgetProposal,
  calculateLineItem,
  formatBDT,
} from '../lib/calculator';
import { PrescriptionViewer } from './PrescriptionViewer';
import { MedicinePickerModal } from './MedicinePickerModal';

interface PrescriptionWorkspaceProps {
  settings: PharmacySettings;
  onAddToBill: (payload: {
    items: BillItem[];
    doctorName: string;
    patientName: string;
    purchaseMode: 'duration' | 'budget';
    durationDays: number | null;
    budgetAmount: number | null;
    prescriptionImage: string | null;
  }) => void;
}

const DURATION_PRESETS = [
  { label: 'As Prescribed', days: null },
  { label: '7 Days', days: 7 },
  { label: '15 Days', days: 15 },
  { label: '30 Days', days: 30 },
  { label: '60 Days', days: 60 },
];

const BUDGET_PRESETS = [300, 500, 1000, 2000];

const FREQUENCY_OPTIONS = [
  '1+0+1',
  '1+1+1',
  '0+0+1',
  '1+0+0',
  '1/2+0+1',
  '1/2+0+1/2',
  'OD',
  'BD',
  'TDS',
  'QID',
  'HS',
  'Alternate Day',
  'Weekly',
  'SOS',
  'PRN',
  'Tapering',
];

export const PrescriptionWorkspace: React.FC<PrescriptionWorkspaceProps> = ({
  settings,
  onAddToBill,
}) => {
  const [fileDataUrl, setFileDataUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const [doctorName, setDoctorName] = useState('');
  const [patientName, setPatientName] = useState('');
  const [prescriptionNotes, setPrescriptionNotes] = useState('');
  const [lines, setLines] = useState<PrescriptionLineItem[]>([]);

  // Purchase mode state
  const [purchaseMode, setPurchaseMode] = useState<'duration' | 'budget'>('duration');
  const [selectedDurationDays, setSelectedDurationDays] = useState<number | null>(null);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [budgetAmount, setBudgetAmount] = useState<number>(500);
  const [globalStripOnly, setGlobalStripOnly] = useState<boolean>(
    settings.defaultStripOnly
  );
  const [budgetAppliedNote, setBudgetAppliedNote] = useState<string | null>(null);

  // Safety review confirmation
  const [staffConfirmed, setStaffConfirmed] = useState(false);

  // Picker modal state
  const [pickerLineId, setPickerLineId] = useState<string | null>(null);
  const [addingNewRowViaPicker, setAddingNewRowViaPicker] = useState(false);

  const handleExtract = async (dataUrl: string, mime: string) => {
    setIsExtracting(true);
    setExtractError(null);
    setStaffConfirmed(false);
    setBudgetAppliedNote(null);
    try {
      const res = await api.extractPrescription(dataUrl, mime);
      setDoctorName(res.doctorName || '');
      setPatientName(res.patientName || '');
      setPrescriptionNotes(res.notes || '');
      setLines(res.lines || []);
      setSelectedDurationDays(null);
    } catch (err) {
      setExtractError((err as Error).message);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleExtractLocal = async (dataUrl: string, mime: string) => {
    setIsExtracting(true);
    setExtractError(null);
    setStaffConfirmed(false);
    setBudgetAppliedNote(null);
    try {
      const res = await api.extractPrescriptionLocal(dataUrl, mime);
      setDoctorName(res.doctorName || '');
      setPatientName(res.patientName || '');
      setPrescriptionNotes(res.notes || '');
      setLines(res.lines || []);
      setSelectedDurationDays(null);
    } catch (err) {
      setExtractError((err as Error).message);
    } finally {
      setIsExtracting(false);
    }
  };

  const updateLine = (lineId: string, patch: Partial<PrescriptionLineItem>) => {
    setLines((prev) =>
      prev.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l))
    );
    setStaffConfirmed(false);
  };

  const removeLine = (lineId: string) => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  };

  const applyCatalogMedicineToLine = (lineId: string, med: MedicineRecord) => {
    const effectivePrice =
      med.customUnitPrice ?? (med.referenceUnitPrice > 0 ? med.referenceUnitPrice : null);
    updateLine(lineId, {
      brandName: med.brandName,
      genericName: med.genericName,
      strength: med.strength,
      dosageForm: med.dosageForm,
      matchedMedicineId: med.id,
      matchedMedicine: med,
      matchStatus: effectivePrice !== null ? 'verified' : 'unverified',
      unitPrice: effectivePrice,
      priceSource:
        effectivePrice === null
          ? 'Price not verified'
          : med.customUnitPrice !== null
          ? 'Pharmacy Custom Price (MedEx Ref)'
          : med.priceSource,
      medexUrl: med.medexUrl,
      lastVerifiedAt: med.lastVerifiedAt,
      packSize: med.packSize,
      packUnit: med.packUnit,
      sellingRule: med.sellingRule,
      doseUnit: med.unitLabel,
      verifiedByStaff: true,
      uncertaintyReason: '',
    });
  };

  const addMedicineAsNewLine = (med: MedicineRecord) => {
    const effectivePrice =
      med.customUnitPrice ?? (med.referenceUnitPrice > 0 ? med.referenceUnitPrice : null);
    const newLine: PrescriptionLineItem = {
      lineId: `manual-${Date.now()}`,
      rawText: 'Added manually by staff',
      brandName: med.brandName,
      genericName: med.genericName,
      strength: med.strength,
      dosageForm: med.dosageForm,
      dosePerIntake: 1,
      doseUnit: med.unitLabel,
      frequencyCode: '1+0+1',
      frequencyPerDay: 2,
      isAsNeededOrVariable: false,
      prescribedDurationDays: selectedDurationDays ?? 7,
      durationDays: selectedDurationDays ?? 7,
      explicitQuantity: null,
      manualQuantity: null,
      instructions: '',
      confidence: 'high',
      uncertaintyReason: '',
      verifiedByStaff: true,
      matchedMedicineId: med.id,
      matchedMedicine: med,
      candidateMatches: [],
      matchStatus: effectivePrice !== null ? 'verified' : 'unverified',
      unitPrice: effectivePrice,
      priceSource:
        effectivePrice === null
          ? 'Price not verified'
          : med.customUnitPrice !== null
          ? 'Pharmacy Custom Price (MedEx Ref)'
          : med.priceSource,
      medexUrl: med.medexUrl,
      lastVerifiedAt: med.lastVerifiedAt,
      packSize: med.packSize,
      packUnit: med.packUnit,
      sellingRule: med.sellingRule,
      sellByFullStripOverride: null,
      discountPercent: 0,
      included: true,
    };
    setLines((prev) => [...prev, newLine]);
  };

  const activeDurationOverride =
    purchaseMode === 'duration' ? selectedDurationDays : null;

  const calculatedMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateLineItem>>();
    for (const line of lines) {
      map.set(
        line.lineId,
        calculateLineItem(line, {
          durationOverrideDays: activeDurationOverride,
          globalStripOnly,
        })
      );
    }
    return map;
  }, [lines, activeDurationOverride, globalStripOnly]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let discountTotal = 0;
    let grandTotal = 0;
    let includedCount = 0;
    let needsReviewCount = 0;
    let unpricedCount = 0;
    let missingManualQtyCount = 0;

    for (const line of lines) {
      if (!line.included) continue;
      includedCount += 1;
      const calc = calculatedMap.get(line.lineId);
      if (!calc) continue;
      subtotal += calc.grossTotal;
      discountTotal += calc.discountAmount;
      grandTotal += calc.netTotal;

      if (
        (line.confidence !== 'high' || line.matchStatus !== 'verified') &&
        !line.verifiedByStaff
      ) {
        needsReviewCount += 1;
      }
      if (line.unitPrice === null) {
        unpricedCount += 1;
      }
      if (calc.manualRequired && line.manualQuantity === null) {
        missingManualQtyCount += 1;
      }
    }

    return {
      subtotal: Number(subtotal.toFixed(2)),
      discountTotal: Number(discountTotal.toFixed(2)),
      grandTotal: Number(grandTotal.toFixed(2)),
      includedCount,
      needsReviewCount,
      unpricedCount,
      missingManualQtyCount,
    };
  }, [lines, calculatedMap]);

  const budgetProposal = useMemo(() => {
    if (purchaseMode !== 'budget' || lines.length === 0) return null;
    return buildBudgetProposal(lines, budgetAmount, {
      baseDurationDays: selectedDurationDays,
      globalStripOnly,
    });
  }, [purchaseMode, lines, budgetAmount, selectedDurationDays, globalStripOnly]);

  const handleApplyBudgetProposal = () => {
    if (!budgetProposal || !budgetProposal.proposedDays) return;
    const days = budgetProposal.proposedDays;
    setLines((prev) =>
      prev.map((line) =>
        line.isAsNeededOrVariable
          ? line
          : {
              ...line,
              durationDays: days,
              manualQuantity: null,
            }
      )
    );
    setSelectedDurationDays(null);
    setBudgetAppliedNote(
      `Pharmacist confirmed proposed ${days}-day adjustment for ৳${budgetAmount} budget.`
    );
  };

  const canAddToBill =
    totals.includedCount > 0 &&
    totals.unpricedCount === 0 &&
    totals.missingManualQtyCount === 0 &&
    staffConfirmed;

  const handleProceedToBill = () => {
    if (!canAddToBill) return;
    const billItems: BillItem[] = [];
    for (const line of lines) {
      if (!line.included) continue;
      const calc = calculatedMap.get(line.lineId);
      if (!calc || calc.saleQuantity <= 0) continue;
      const billableQty = calc.isPackPriced ? calc.packsCount : calc.saleQuantity;
      const unitLabel = calc.isPackPriced ? line.packUnit : line.doseUnit;

      billItems.push({
        id: `bi-${line.lineId}-${Date.now()}`,
        medicineId: line.matchedMedicineId,
        medicineName: line.brandName,
        genericName: line.genericName,
        strength: line.strength,
        dosageForm: line.dosageForm,
        requiredQuantity: calc.requiredQuantity,
        quantity: billableQty,
        unitLabel,
        packagingNote:
          calc.extraQuantity > 0
            ? `${calc.saleLabel} (Req: ${calc.requiredLabel}, +${calc.extraQuantity} extra)`
            : calc.saleLabel,
        unitPrice: line.unitPrice ?? 0,
        discountPercent: line.discountPercent || 0,
        lineTotal: calc.netTotal,
        instructions: line.instructions,
      });
    }

    onAddToBill({
      items: billItems,
      doctorName,
      patientName,
      purchaseMode,
      durationDays:
        purchaseMode === 'duration'
          ? selectedDurationDays
          : budgetProposal?.proposedDays ?? null,
      budgetAmount: purchaseMode === 'budget' ? budgetAmount : null,
      prescriptionImage: fileDataUrl,
    });
  };

  const pickerTargetLine = pickerLineId
    ? lines.find((l) => l.lineId === pickerLineId) || null
    : null;

  return (
    <div className="space-y-6 pb-20 lg:pb-8">
      {/* Top Grid: Prescription Upload/Viewer + Context Header */}
      <div
        className={`grid gap-6 ${
          lines.length > 0 ? 'lg:grid-cols-12 items-start' : 'grid-cols-1 max-w-3xl mx-auto'
        }`}
      >
        <div className={lines.length > 0 ? 'lg:col-span-4 lg:sticky lg:top-20' : ''}>
          <PrescriptionViewer
            fileDataUrl={fileDataUrl}
            mimeType={mimeType}
            fileName={fileName}
            isExtracting={isExtracting}
            compactMode={lines.length > 0}
            onFileSelected={(url, mime, name) => {
              setFileDataUrl(url);
              setMimeType(mime);
              setFileName(name);
              setExtractError(null);
            }}
            onClearFile={() => {
              setFileDataUrl(null);
              setMimeType(null);
              setFileName(null);
              setExtractError(null);
            }}
            onExtract={handleExtract}
            onExtractLocal={handleExtractLocal}
          />

          {extractError && (
            <div className="mt-3 p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <div>
                  <p className="font-semibold">AI Extraction Unavailable</p>
                  <p className="mt-0.5 leading-relaxed">{extractError}</p>
                </div>
              </div>
              <div className="pl-6 flex flex-wrap items-center gap-2">
                {fileDataUrl && mimeType && mimeType !== 'application/pdf' && (
                  <button
                    type="button"
                    disabled={isExtracting}
                    onClick={() => handleExtractLocal(fileDataUrl, mimeType)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                  >
                    Run Local OCR Now (No API Key)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setAddingNewRowViaPicker(true);
                    setPickerLineId(null);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-red-200 text-red-900 font-medium hover:bg-red-100 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Enter Medicines Manually from MedEx DB
                </button>
              </div>
            </div>
          )}

          {lines.length === 0 && (
            <div className="mt-4 flex items-center justify-between px-4 py-3 bg-white border border-slate-200 rounded-xl">
              <span className="text-sm text-slate-600">
                Or enter prescription medicines manually without scanning
              </span>
              <button
                type="button"
                onClick={() => {
                  setAddingNewRowViaPicker(true);
                  setPickerLineId(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Medicine Manually
              </button>
            </div>
          )}
        </div>

        {/* Right / Main Prescription Calculator & Verification Workspace */}
        {lines.length > 0 && (
          <div className="lg:col-span-8 space-y-5 min-w-0">
            {/* Prescription Metadata & Mode Controls */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Prescription Review &amp; Quantity Calculator
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                    {doctorName && <span>Doctor: {doctorName}</span>}
                    {doctorName && patientName && <span aria-hidden="true">·</span>}
                    {patientName && <span>Patient: {patientName}</span>}
                    {(doctorName || patientName) && <span aria-hidden="true">·</span>}
                    <span>{lines.length} extracted items</span>
                  </div>
                </div>

                {/* Mode Switcher */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setPurchaseMode('duration');
                      setBudgetAppliedNote(null);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      purchaseMode === 'duration'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    Duration Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setPurchaseMode('budget')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      purchaseMode === 'budget'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    Budget Mode
                  </button>
                </div>
              </div>

              {/* Mode A: Duration Quick Selector */}
              {purchaseMode === 'duration' && (
                <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {DURATION_PRESETS.map((preset) => {
                      const active =
                        selectedDurationDays === preset.days && !customDurationInput;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setSelectedDurationDays(preset.days);
                            setCustomDurationInput('');
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                            active
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}

                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={365}
                        placeholder="Custom days"
                        value={customDurationInput}
                        onChange={(e) => {
                          setCustomDurationInput(e.target.value);
                          const num = parseInt(e.target.value, 10);
                          if (!Number.isNaN(num) && num > 0) {
                            setSelectedDurationDays(num);
                          } else {
                            setSelectedDurationDays(null);
                          }
                        }}
                        className="w-28 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600 font-mono-num"
                      />
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={globalStripOnly}
                      onChange={(e) => setGlobalStripOnly(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                    />
                    Sell Full Strips Only
                  </label>
                </div>
              )}

              {/* Mode B: Budget Planner Controls */}
              {purchaseMode === 'budget' && (
                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {BUDGET_PRESETS.map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => {
                            setBudgetAmount(amt);
                            setBudgetAppliedNote(null);
                          }}
                          className={`px-3 py-1.5 text-xs font-medium font-mono-num rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                            budgetAmount === amt
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          ৳{amt.toLocaleString('en-BD')}
                        </button>
                      ))}
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                          ৳
                        </span>
                        <input
                          type="number"
                          min={10}
                          value={budgetAmount}
                          onChange={(e) => {
                            setBudgetAmount(Math.max(0, Number(e.target.value)));
                            setBudgetAppliedNote(null);
                          }}
                          className="w-28 pl-6 pr-2.5 py-1.5 text-xs font-mono-num border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
                        />
                      </div>
                    </div>

                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={globalStripOnly}
                        onChange={(e) => setGlobalStripOnly(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                      />
                      Sell Full Strips Only
                    </label>
                  </div>

                  {/* Budget Analysis & Proposed Adjustment (Never Silent) */}
                  {budgetProposal && (
                    <div
                      className={`p-4 rounded-lg border text-xs space-y-3 ${
                        budgetProposal.fitsWithinBudget
                          ? 'bg-emerald-50/60 border-emerald-200'
                          : 'bg-amber-50/70 border-amber-200'
                      }`}
                    >
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <div className="text-slate-500">Full Prescription</div>
                          <div className="font-mono-num text-sm font-semibold text-slate-900 mt-0.5">
                            {formatBDT(budgetProposal.fullPrescriptionTotal)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Customer Budget</div>
                          <div className="font-mono-num text-sm font-semibold text-slate-900 mt-0.5">
                            {formatBDT(budgetProposal.budgetAmount)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">
                            {budgetProposal.fitsWithinBudget ? 'Remaining' : 'Shortfall'}
                          </div>
                          <div
                            className={`font-mono-num text-sm font-semibold mt-0.5 ${
                              budgetProposal.fitsWithinBudget
                                ? 'text-emerald-700'
                                : 'text-red-700'
                            }`}
                          >
                            {budgetProposal.fitsWithinBudget
                              ? formatBDT(budgetProposal.remainingAfterProposal)
                              : formatBDT(budgetProposal.shortfall)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Proposed Plan</div>
                          <div className="font-mono-num text-sm font-semibold text-slate-900 mt-0.5">
                            {budgetProposal.fitsWithinBudget
                              ? 'Full Course'
                              : `${budgetProposal.proposedDays} Days (${formatBDT(
                                  budgetProposal.proposedTotal
                                )})`}
                          </div>
                        </div>
                      </div>

                      {!budgetProposal.fitsWithinBudget && (
                        <div className="pt-2 border-t border-amber-200/80 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-amber-900 font-medium">
                              Proposed Adjustment Requiring Pharmacist Confirmation: All
                              prescribed daily medicines kept intact, scaled uniformly to{' '}
                              <span className="font-mono-num font-semibold">
                                {budgetProposal.proposedDays} day(s)
                              </span>
                              . No medicine is removed or replaced automatically.
                            </p>
                            <button
                              type="button"
                              onClick={handleApplyBudgetProposal}
                              className="px-3 py-1.5 rounded-lg bg-amber-700 text-white font-medium hover:bg-amber-800 transition-colors cursor-pointer whitespace-nowrap"
                            >
                              Apply Proposed {budgetProposal.proposedDays}-Day Plan
                            </button>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="border-b border-amber-200 text-[11px] text-amber-900/80">
                                  <th className="py-1 pr-2 font-medium">Medicine</th>
                                  <th className="py-1 px-2 font-medium text-right">
                                    Full Cost
                                  </th>
                                  <th className="py-1 px-2 font-medium">
                                    Proposed Supply
                                  </th>
                                  <th className="py-1 pl-2 font-medium text-right">
                                    Proposed Cost
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-amber-200/50">
                                {budgetProposal.itemBreakdowns.map((b) => (
                                  <tr key={b.lineId}>
                                    <td className="py-1.5 pr-2 font-medium text-slate-900">
                                      {b.medicineName}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono-num text-slate-600">
                                      {formatBDT(b.fullCost)}
                                    </td>
                                    <td className="py-1.5 px-2 text-slate-700">
                                      {b.proposedSaleLabel} ·{' '}
                                      <span className="text-amber-900">{b.note}</span>
                                    </td>
                                    <td className="py-1.5 pl-2 text-right font-mono-num font-semibold text-slate-900">
                                      {formatBDT(b.proposedCost)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {budgetAppliedNote && (
                        <div className="pt-2 border-t border-emerald-200 text-emerald-800 font-medium flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          {budgetAppliedNote}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {prescriptionNotes && (
                <div className="text-xs text-slate-600 pt-2 border-t border-slate-100">
                  <span className="font-medium text-slate-800">Prescription note:</span>{' '}
                  {prescriptionNotes}
                </div>
              )}
            </div>

            {/* Editable Medicine Table (Desktop) + Card Stack (Mobile) */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="text-sm font-semibold text-slate-900">
                    Extracted Medicines
                  </span>
                  <span aria-hidden="true">·</span>
                  {totals.needsReviewCount > 0 ? (
                    <span className="text-amber-700 font-medium">
                      {totals.needsReviewCount} item(s) need staff review
                    </span>
                  ) : (
                    <span className="text-emerald-700 font-medium">
                      All items verified
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setAddingNewRowViaPicker(true);
                    setPickerLineId(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Medicine
                </button>
              </div>

              <div className="divide-y divide-slate-200">
                {lines.map((line) => {
                  const calc = calculatedMap.get(line.lineId)!;
                  const isLow = line.confidence === 'low' && !line.verifiedByStaff;
                  const isMed = line.confidence === 'medium' && !line.verifiedByStaff;
                  const isPriceUnverified = line.unitPrice === null;
                  const rowBg = !line.included
                    ? 'bg-slate-50/70 opacity-65'
                    : isLow || isPriceUnverified
                    ? 'bg-red-50/35'
                    : isMed || line.matchStatus === 'needs_selection'
                    ? 'bg-amber-50/35'
                    : 'bg-white';

                  const activeStripEnforced =
                    line.sellByFullStripOverride !== null
                      ? line.sellByFullStripOverride
                      : globalStripOnly || line.sellingRule === 'strip';

                  return (
                    <div key={line.lineId} className={`p-4 space-y-3 ${rowBg}`}>
                      {/* Row Top: Include Toggle, Medicine Name, Confidence & Match Status, Actions */}
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 flex-1 min-w-[240px]">
                          <input
                            type="checkbox"
                            checked={line.included}
                            onChange={(e) =>
                              updateLine(line.lineId, { included: e.target.checked })
                            }
                            aria-label={`Include ${line.brandName}`}
                            className="mt-1 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                          />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={line.brandName}
                                onChange={(e) =>
                                  updateLine(line.lineId, { brandName: e.target.value })
                                }
                                placeholder="Brand name"
                                className="font-semibold text-sm text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-emerald-600 focus:outline-none px-0.5 w-40 sm:w-48"
                              />
                              <input
                                type="text"
                                value={line.strength}
                                onChange={(e) =>
                                  updateLine(line.lineId, { strength: e.target.value })
                                }
                                placeholder="Strength"
                                className="text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded px-2 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                              />
                              <input
                                type="text"
                                value={line.dosageForm}
                                onChange={(e) =>
                                  updateLine(line.lineId, { dosageForm: e.target.value })
                                }
                                placeholder="Form"
                                className="text-xs text-slate-600 bg-white border border-slate-200 rounded px-2 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                              />
                            </div>

                            {/* Quiet metadata line (zero pills!) */}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                              <span>
                                {line.genericName || 'Generic unspecified'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  line.verifiedByStaff
                                    ? 'text-emerald-700 font-medium'
                                    : line.confidence === 'low'
                                    ? 'text-red-700 font-medium'
                                    : line.confidence === 'medium'
                                    ? 'text-amber-700 font-medium'
                                    : 'text-slate-600'
                                }
                              >
                                {line.verifiedByStaff
                                  ? 'Verified by staff'
                                  : line.confidence === 'low'
                                  ? 'Low AI confidence — verify manually'
                                  : line.confidence === 'medium'
                                  ? 'Medium AI confidence — review'
                                  : 'High AI confidence'}
                              </span>
                              <span aria-hidden="true">·</span>
                              {line.medexUrl ? (
                                <a
                                  href={line.medexUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
                                >
                                  {line.priceSource} ({line.lastVerifiedAt})
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <span className="text-red-700 font-medium">
                                  Price not verified
                                </span>
                              )}
                            </div>

                            {line.uncertaintyReason && !line.verifiedByStaff && (
                              <p className="text-xs text-amber-800">
                                Review note: {line.uncertaintyReason}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setAddingNewRowViaPicker(false);
                              setPickerLineId(line.lineId);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                          >
                            <Search className="w-3.5 h-3.5" />
                            {line.matchedMedicineId ? 'Match / Substitute' : 'Match Medicine'}
                          </button>

                          {!line.verifiedByStaff && (
                            <button
                              type="button"
                              onClick={() =>
                                updateLine(line.lineId, { verifiedByStaff: true })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 hover:bg-emerald-100 cursor-pointer whitespace-nowrap"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Mark Verified
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => removeLine(line.lineId)}
                            title="Remove medicine"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Candidate quick-select strip when exact match needs staff confirmation */}
                      {line.matchStatus === 'needs_selection' &&
                        line.candidateMatches.length > 0 && (
                          <div className="pl-6 flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-amber-800 font-medium">
                              Possible MedEx matches:
                            </span>
                            {line.candidateMatches.slice(0, 3).map((cand) => (
                              <button
                                key={cand.id}
                                type="button"
                                onClick={() =>
                                  applyCatalogMedicineToLine(line.lineId, cand)
                                }
                                className="px-2 py-1 rounded border border-amber-300 bg-white text-slate-800 hover:bg-amber-50 cursor-pointer whitespace-nowrap"
                              >
                                {cand.brandName} {cand.strength} ({cand.dosageForm}) ·{' '}
                                {formatBDT(
                                  cand.customUnitPrice ?? cand.referenceUnitPrice
                                )}
                              </button>
                            ))}
                          </div>
                        )}

                      {/* Editable Dosage, Schedule, Packaging & Pricing Grid */}
                      <div className="pl-0 sm:pl-6 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 items-end">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            Dose / Intake
                          </label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.5"
                              min="0.25"
                              value={line.dosePerIntake}
                              onChange={(e) =>
                                updateLine(line.lineId, {
                                  dosePerIntake: Math.max(0.25, Number(e.target.value)),
                                })
                              }
                              className="w-16 px-2 py-1.5 text-xs font-mono-num bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-600"
                            />
                            <span className="text-[11px] text-slate-500 truncate">
                              {line.doseUnit}
                            </span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            Frequency
                          </label>
                          <input
                            list={`freq-${line.lineId}`}
                            value={line.frequencyCode}
                            onChange={(e) => {
                              const val = e.target.value;
                              const isSos = /\b(SOS|PRN|TAPER|VARIABLE)\b/i.test(val);
                              updateLine(line.lineId, {
                                frequencyCode: val,
                                isAsNeededOrVariable: isSos,
                              });
                            }}
                            className="w-full px-2 py-1.5 text-xs font-mono-num bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-600"
                          />
                          <datalist id={`freq-${line.lineId}`}>
                            {FREQUENCY_OPTIONS.map((opt) => (
                              <option key={opt} value={opt} />
                            ))}
                          </datalist>
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            {calc.manualRequired ? 'Manual Qty Req.' : 'Duration (Days)'}
                          </label>
                          {calc.manualRequired ? (
                            <input
                              type="number"
                              min={0}
                              placeholder="Enter qty"
                              value={line.manualQuantity ?? ''}
                              onChange={(e) =>
                                updateLine(line.lineId, {
                                  manualQuantity:
                                    e.target.value === ''
                                      ? null
                                      : Math.max(0, Number(e.target.value)),
                                })
                              }
                              className="w-full px-2 py-1.5 text-xs font-mono-num bg-white border border-amber-400 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-600"
                            />
                          ) : (
                            <input
                              type="number"
                              min={1}
                              value={activeDurationOverride ?? line.durationDays}
                              onChange={(e) => {
                                const days = Math.max(1, Number(e.target.value));
                                if (activeDurationOverride !== null) {
                                  setSelectedDurationDays(null);
                                  setCustomDurationInput('');
                                }
                                updateLine(line.lineId, {
                                  durationDays: days,
                                  manualQuantity: null,
                                });
                              }}
                              className="w-full px-2 py-1.5 text-xs font-mono-num bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-600"
                            />
                          )}
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            Unit Price (৳)
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min={0}
                            placeholder="Unverified"
                            value={line.unitPrice ?? ''}
                            onChange={(e) =>
                              updateLine(line.lineId, {
                                unitPrice:
                                  e.target.value === ''
                                    ? null
                                    : Math.max(0, Number(e.target.value)),
                                priceSource:
                                  e.target.value === ''
                                    ? 'Price not verified'
                                    : 'Manual Price Entry',
                              })
                            }
                            className={`w-full px-2 py-1.5 text-xs font-mono-num bg-white border rounded-md focus:outline-none focus:ring-1 ${
                              line.unitPrice === null
                                ? 'border-red-400 focus:ring-red-500'
                                : 'border-slate-300 focus:ring-emerald-600'
                            }`}
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            Discount (%)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={line.discountPercent}
                            onChange={(e) =>
                              updateLine(line.lineId, {
                                discountPercent: Math.min(
                                  100,
                                  Math.max(0, Number(e.target.value))
                                ),
                              })
                            }
                            className="w-full px-2 py-1.5 text-xs font-mono-num bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-600"
                          />
                        </div>

                        <div className="text-right">
                          <div className="text-[11px] text-slate-500 mb-1">Line Total</div>
                          <div className="font-mono-num text-sm font-semibold text-slate-900 py-1">
                            {line.unitPrice === null ? '—' : formatBDT(calc.netTotal)}
                          </div>
                        </div>
                      </div>

                      {/* Packaging & Required vs Sale Quantity Transparency Row */}
                      <div className="pl-0 sm:pl-6 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-slate-600">
                          <span>
                            Required:{' '}
                            <strong className="font-mono-num text-slate-900">
                              {calc.requiredLabel}
                            </strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Sale Supply:{' '}
                            <strong className="font-mono-num text-emerald-800">
                              {calc.saleLabel}
                            </strong>
                          </span>
                          {calc.extraQuantity > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-800 font-medium">
                                +{calc.extraQuantity} extra (pack of {line.packSize})
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          {(line.sellingRule === 'individual' ||
                            line.sellingRule === 'strip') && (
                            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={activeStripEnforced}
                                onChange={(e) =>
                                  updateLine(line.lineId, {
                                    sellByFullStripOverride: e.target.checked,
                                  })
                                }
                                className="rounded border-slate-300 text-emerald-600"
                              />
                              Full strip ({line.packSize}/{line.packUnit})
                            </label>
                          )}

                          <input
                            type="text"
                            value={line.instructions}
                            onChange={(e) =>
                              updateLine(line.lineId, { instructions: e.target.value })
                            }
                            placeholder="Instructions (e.g. Before meal)"
                            className="w-40 sm:w-48 px-2 py-1 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-600"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pharmacist Confirmation & Sticky Summary Action Bar */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{totals.includedCount} medicines selected</span>
                    <span aria-hidden="true">·</span>
                    <span>Subtotal {formatBDT(totals.subtotal)}</span>
                    {totals.discountTotal > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Discount -{formatBDT(totals.discountTotal)}</span>
                      </>
                    )}
                  </div>
                  <div className="text-xl font-bold font-mono-num text-slate-900">
                    Estimated Total: {formatBDT(totals.grandTotal)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleProceedToBill}
                  disabled={!canAddToBill}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Add to Bill
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {(totals.unpricedCount > 0 || totals.missingManualQtyCount > 0) && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                  {totals.unpricedCount > 0 && (
                    <p>
                      • {totals.unpricedCount} medicine(s) have unverified prices. Match
                      from MedEx catalog or enter a manual price before billing.
                    </p>
                  )}
                  {totals.missingManualQtyCount > 0 && (
                    <p>
                      • {totals.missingManualQtyCount} SOS/variable medicine(s) require a
                      manual sale quantity (or uncheck to exclude from this bill).
                    </p>
                  )}
                </div>
              )}

              <label className="flex items-start gap-2.5 pt-3 border-t border-slate-100 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={staffConfirmed}
                  onChange={(e) => setStaffConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  <span className="font-semibold text-slate-900 inline-flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                    Pharmacist Verification Required:
                  </span>{' '}
                  I confirm that all medicine names, strengths, dosages, packaging
                  quantities, and prices have been checked against the original
                  prescription. This software assists calculation and billing only.
                </span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Medicine Match / Substitute / Add Modal */}
      <MedicinePickerModal
        open={pickerLineId !== null || addingNewRowViaPicker}
        initialQuery={
          pickerTargetLine ? pickerTargetLine.brandName : ''
        }
        initialGeneric={
          pickerTargetLine ? pickerTargetLine.genericName : ''
        }
        title={
          addingNewRowViaPicker
            ? 'Add Medicine to Prescription List'
            : `Match or Substitute: ${pickerTargetLine?.brandName || ''}`
        }
        onClose={() => {
          setPickerLineId(null);
          setAddingNewRowViaPicker(false);
        }}
        onSelect={(med) => {
          if (addingNewRowViaPicker) {
            addMedicineAsNewLine(med);
          } else if (pickerLineId) {
            applyCatalogMedicineToLine(pickerLineId, med);
          }
        }}
      />
    </div>
  );
};

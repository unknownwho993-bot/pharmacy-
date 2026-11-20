import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  CreditCard,
  Plus,
  Printer,
  Search,
  Smartphone,
  Trash2,
  User,
} from 'lucide-react';
import type {
  BillItem,
  BillRecord,
  MedicineRecord,
  PaymentMethod,
} from '../types';
import { api } from '../lib/api';
import { formatBDT } from '../lib/calculator';

interface BillingPOSProps {
  items: BillItem[];
  doctorName: string;
  customerName: string;
  purchaseMode: 'duration' | 'budget' | 'direct';
  durationDays: number | null;
  budgetAmount: number | null;
  prescriptionImage: string | null;
  onUpdateItems: (items: BillItem[]) => void;
  onClearDraft: () => void;
  onBillSaved: (bill: BillRecord) => void;
}

const PAYMENT_METHODS: Array<{ id: PaymentMethod; label: string; icon: React.ReactNode }> = [
  { id: 'Cash', label: 'Cash', icon: <Banknote className="w-4 h-4" /> },
  { id: 'bKash', label: 'bKash', icon: <Smartphone className="w-4 h-4" /> },
  { id: 'Nagad', label: 'Nagad', icon: <Smartphone className="w-4 h-4" /> },
  { id: 'Card', label: 'Card', icon: <CreditCard className="w-4 h-4" /> },
];

export const BillingPOS: React.FC<BillingPOSProps> = ({
  items,
  doctorName,
  customerName: initialCustomerName,
  purchaseMode,
  durationDays,
  budgetAmount,
  prescriptionImage,
  onUpdateItems,
  onClearDraft,
  onBillSaved,
}) => {
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MedicineRecord[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);

  const [customerName, setCustomerName] = useState(initialCustomerName);
  const [customerPhone, setCustomerPhone] = useState('');
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [paidInput, setPaidInput] = useState<string>('');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setCustomerName(initialCustomerName);
  }, [initialCustomerName]);

  // Fast keyboard shortcut "/" to jump to counter search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const res = await api.searchMedicines({ q: searchQuery.trim() });
        if (active) setSearchResults(res.medicines.slice(0, 8));
      } catch {
        if (active) setSearchResults([]);
      }
    }, 120);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [searchQuery]);

  const totals = useMemo(() => {
    const subtotal = Number(
      items.reduce((acc, item) => acc + item.lineTotal, 0).toFixed(2)
    );
    const rawDiscount =
      discountType === 'percent'
        ? (subtotal * Math.min(100, Math.max(0, discountValue))) / 100
        : Math.max(0, discountValue);
    const discountAmount = Number(Math.min(subtotal, rawDiscount).toFixed(2));
    const grandTotal = Number(Math.max(0, subtotal - discountAmount).toFixed(2));
    const paidAmount =
      paidInput === '' ? grandTotal : Math.max(0, Number(paidInput) || 0);
    const dueAmount = Number(Math.max(0, grandTotal - paidAmount).toFixed(2));
    const changeAmount = Number(Math.max(0, paidAmount - grandTotal).toFixed(2));

    return {
      subtotal,
      discountAmount,
      grandTotal,
      paidAmount,
      dueAmount,
      changeAmount,
    };
  }, [items, discountType, discountValue, paidInput]);

  const addMedicineToBill = async (initialMed: MedicineRecord) => {
    setSearchQuery('');
    setSearchResults([]);
    let med = initialMed;
    if (
      med.customUnitPrice === null &&
      med.referenceUnitPrice <= 0 &&
      med.medexUrl.includes('medex.com.bd/brands/')
    ) {
      try {
        const refreshed = await api.fetchMedicinePriceFromMedex(med.id);
        med = refreshed.medicine;
      } catch {
        // allow manual price entry in bill row
      }
    }

    const unitPrice = med.customUnitPrice ?? med.referenceUnitPrice;
    const defaultQty =
      med.sellingRule === 'strip' ? med.packSize : 1;
    const existingIdx = items.findIndex((i) => i.medicineId === med.id);

    if (existingIdx >= 0) {
      const next = [...items];
      const existing = next[existingIdx];
      const newQty = existing.quantity + defaultQty;
      const lineGross = newQty * existing.unitPrice;
      const lineTotal = Number(
        (lineGross * (1 - (existing.discountPercent || 0) / 100)).toFixed(2)
      );
      next[existingIdx] = { ...existing, quantity: newQty, lineTotal };
      onUpdateItems(next);
    } else {
      const unitLabel =
        med.sellingRule === 'individual' || med.sellingRule === 'strip'
          ? med.unitLabel
          : med.packUnit;
      const newItem: BillItem = {
        id: `pos-${med.id}-${Date.now()}`,
        medicineId: med.id,
        medicineName: med.brandName,
        genericName: med.genericName,
        strength: med.strength,
        dosageForm: med.dosageForm,
        requiredQuantity: null,
        quantity: defaultQty,
        unitLabel,
        packagingNote: `${defaultQty} ${unitLabel}`,
        unitPrice,
        discountPercent: 0,
        lineTotal: Number((defaultQty * unitPrice).toFixed(2)),
        instructions: '',
      };
      onUpdateItems([...items, newItem]);
    }
  };

  const addBlankManualItem = () => {
    const newItem: BillItem = {
      id: `manual-pos-${Date.now()}`,
      medicineId: null,
      medicineName: 'Custom Item',
      genericName: '',
      strength: '',
      dosageForm: 'Unit',
      requiredQuantity: null,
      quantity: 1,
      unitLabel: 'unit',
      packagingNote: '1 unit',
      unitPrice: 0,
      discountPercent: 0,
      lineTotal: 0,
      instructions: '',
    };
    onUpdateItems([...items, newItem]);
  };

  const updateItem = (id: string, patch: Partial<BillItem>) => {
    onUpdateItems(
      items.map((item) => {
        if (item.id !== id) return item;
        const merged = { ...item, ...patch };
        const gross = merged.quantity * merged.unitPrice;
        const net = gross * (1 - Math.min(100, Math.max(0, merged.discountPercent)) / 100);
        return {
          ...merged,
          lineTotal: Number(Math.max(0, net).toFixed(2)),
          packagingNote:
            patch.quantity !== undefined
              ? `${merged.quantity} ${merged.unitLabel}`
              : merged.packagingNote,
        };
      })
    );
  };

  const removeItem = (id: string) => {
    onUpdateItems(items.filter((i) => i.id !== id));
  };

  const handleSaveAndPrint = async () => {
    if (items.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.createBill({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        doctorName: doctorName.trim(),
        paymentMethod,
        subtotal: totals.subtotal,
        discountType,
        discountValue,
        discountAmount: totals.discountAmount,
        grandTotal: totals.grandTotal,
        paidAmount: totals.paidAmount,
        dueAmount: totals.dueAmount,
        changeAmount: totals.changeAmount,
        purchaseMode,
        durationDays,
        budgetAmount,
        items,
        notes: notes.trim(),
        prescriptionImage,
      });
      setPaidInput('');
      setDiscountValue(0);
      setCustomerPhone('');
      setNotes('');
      onClearDraft();
      onBillSaved(res.bill);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pb-20 lg:pb-8">
      {/* Left: Fast Medicine Search & Bill Line Items */}
      <div className="lg:col-span-8 space-y-4">
        {/* Counter Search Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <label
              htmlFor="pos-search-input"
              className="text-sm font-semibold text-slate-900"
            >
              Add Medicines to Bill
            </label>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>Press &quot;/&quot; to focus search</span>
              <button
                type="button"
                onClick={addBlankManualItem}
                className="inline-flex items-center gap-1 text-emerald-700 font-medium hover:text-emerald-800 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Manual Line
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="pos-search-input"
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchResults.length > 0) {
                  e.preventDefault();
                  addMedicineToBill(searchResults[0]);
                }
              }}
              placeholder="Type brand or generic name (e.g. Napa 500, Seclo, Monas, Orsaline)..."
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
            />

            {searchFocused && searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden divide-y divide-slate-100">
                {searchResults.map((med) => {
                  const price = med.customUnitPrice ?? med.referenceUnitPrice;
                  return (
                    <button
                      key={med.id}
                      type="button"
                      onMouseDown={() => addMedicineToBill(med)}
                      className="w-full px-4 py-2.5 text-left hover:bg-emerald-50 flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          {med.brandName}{' '}
                          <span className="font-normal text-slate-600">
                            {med.strength} · {med.dosageForm}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {med.genericName} · {med.manufacturer}
                        </div>
                      </div>
                      <div className="text-right shrink-0 font-mono-num text-sm font-semibold text-emerald-700">
                        {med.customUnitPrice !== null || med.referenceUnitPrice > 0
                          ? formatBDT(price)
                          : 'Fetch ৳'}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Bill Items Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Current Bill Items</h2>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="text-xs text-slate-500 font-mono-num">
                {items.length} item(s)
              </span>
            </div>
            {items.length > 0 && (
              <button
                type="button"
                onClick={onClearDraft}
                className="text-xs text-slate-500 hover:text-red-600 cursor-pointer"
              >
                Clear Bill
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-slate-700">
                No medicines added to this bill yet
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Search above to add counter items, or transfer calculated items from the
                Prescription Calculator.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 pl-5 pr-3">Medicine</th>
                    <th className="py-2.5 px-2 w-24">Qty</th>
                    <th className="py-2.5 px-2 w-28">Unit Price</th>
                    <th className="py-2.5 px-2 w-20">Disc %</th>
                    <th className="py-2.5 px-3 text-right w-28">Total</th>
                    <th className="py-2.5 pr-4 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="py-3 pl-5 pr-3">
                        <input
                          type="text"
                          value={item.medicineName}
                          onChange={(e) =>
                            updateItem(item.id, { medicineName: e.target.value })
                          }
                          className="font-semibold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-emerald-600 focus:outline-none w-full"
                        />
                        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span>
                            {item.strength} {item.dosageForm}
                          </span>
                          {item.packagingNote && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-700">
                                {item.packagingNote}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) =>
                            updateItem(item.id, {
                              quantity: Math.max(1, Number(e.target.value)),
                            })
                          }
                          className="w-20 px-2 py-1 text-xs font-mono-num bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-600"
                        />
                      </td>
                      <td className="py-3 px-2">
                        <input
                          type="number"
                          step="0.1"
                          min={0}
                          value={item.unitPrice}
                          onChange={(e) =>
                            updateItem(item.id, {
                              unitPrice: Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="w-24 px-2 py-1 text-xs font-mono-num bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-600"
                        />
                      </td>
                      <td className="py-3 px-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={item.discountPercent}
                          onChange={(e) =>
                            updateItem(item.id, {
                              discountPercent: Math.min(
                                100,
                                Math.max(0, Number(e.target.value))
                              ),
                            })
                          }
                          className="w-16 px-2 py-1 text-xs font-mono-num bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-600"
                        />
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num font-semibold text-slate-900">
                        {formatBDT(item.lineTotal)}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          aria-label="Remove item"
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Right: Customer, Payment & Totals Panel */}
      <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          {/* Optional Customer Info */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <User className="w-4 h-4 text-slate-500" />
              Customer Details (Optional)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer name"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Phone (e.g. 017XX-XXXXXX)"
                className="w-full px-3 py-2 text-sm font-mono-num bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          {/* Discount & Totals Breakdown */}
          <div className="pt-4 border-t border-slate-200 space-y-3 text-sm">
            <div className="flex items-center justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="font-mono-num font-medium text-slate-900">
                {formatBDT(totals.subtotal)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-600">Bill Discount</span>
              <div className="flex items-center gap-1.5">
                <div className="flex rounded-md border border-slate-300 overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setDiscountType('fixed')}
                    className={`px-2 py-1 cursor-pointer ${
                      discountType === 'fixed'
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600'
                    }`}
                  >
                    ৳
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountType('percent')}
                    className={`px-2 py-1 cursor-pointer ${
                      discountType === 'percent'
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600'
                    }`}
                  >
                    %
                  </button>
                </div>
                <input
                  type="number"
                  min={0}
                  value={discountValue}
                  onChange={(e) =>
                    setDiscountValue(Math.max(0, Number(e.target.value)))
                  }
                  className="w-20 px-2 py-1 text-right text-xs font-mono-num bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-600"
                />
              </div>
            </div>

            {totals.discountAmount > 0 && (
              <div className="flex items-center justify-between text-xs text-emerald-700">
                <span>Discount Applied</span>
                <span className="font-mono-num">-{formatBDT(totals.discountAmount)}</span>
              </div>
            )}

            <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
              <span className="text-base font-bold text-slate-900">Grand Total</span>
              <span className="text-xl font-bold font-mono-num text-emerald-700">
                {formatBDT(totals.grandTotal)}
              </span>
            </div>
          </div>

          {/* Payment Method */}
          <div className="pt-4 border-t border-slate-200 space-y-2.5">
            <span className="block text-xs font-semibold text-slate-700">
              Payment Method
            </span>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm.id}
                  type="button"
                  onClick={() => setPaymentMethod(pm.id)}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    paymentMethod === pm.id
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {pm.icon}
                  {pm.label}
                </button>
              ))}
            </div>
          </div>

          {/* Paid Amount + Quick Cash Tenders */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700">
                Paid Amount (৳)
              </label>
              <button
                type="button"
                onClick={() => setPaidInput(String(totals.grandTotal))}
                className="text-xs text-emerald-700 font-medium hover:underline cursor-pointer"
              >
                Exact Amount
              </button>
            </div>
            <input
              type="number"
              min={0}
              step="1"
              placeholder={totals.grandTotal.toFixed(2)}
              value={paidInput}
              onChange={(e) => setPaidInput(e.target.value)}
              className="w-full px-3 py-2 text-base font-mono-num font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            <div className="flex items-center gap-1.5 flex-wrap">
              {[100, 500, 1000, 2000].map((note) => (
                <button
                  key={note}
                  type="button"
                  onClick={() => setPaidInput(String(note))}
                  className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-xs font-mono-num font-medium text-slate-700 cursor-pointer"
                >
                  ৳{note}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Change</div>
                <div className="font-mono-num text-sm font-semibold text-emerald-700 mt-0.5">
                  {formatBDT(totals.changeAmount)}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Due</div>
                <div
                  className={`font-mono-num text-sm font-semibold mt-0.5 ${
                    totals.dueAmount > 0 ? 'text-red-600' : 'text-slate-700'
                  }`}
                >
                  {formatBDT(totals.dueAmount)}
                </div>
              </div>
            </div>
          </div>

          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional counter note..."
            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-600"
          />

          {saveError && (
            <p className="text-xs text-red-600 font-medium">{saveError}</p>
          )}

          <button
            type="button"
            disabled={items.length === 0 || saving}
            onClick={handleSaveAndPrint}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            {saving ? 'Saving Bill...' : 'Save Bill & Print Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
};

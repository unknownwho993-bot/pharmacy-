import React, { useEffect, useState } from 'react';
import {
  Check,
  Download,
  ExternalLink,
  Globe,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  X,
} from 'lucide-react';
import type { MedexLookupResult, MedicineRecord, SellingRule } from '../types';
import { api, type MedexSyncStatusResponse } from '../lib/api';
import { formatBDT } from '../lib/calculator';

interface MedicineDatabaseProps {
  onQuickAddToBill: (med: MedicineRecord) => void;
}

const FORMS = [
  'All',
  'Tablet',
  'Capsule',
  'Syrup',
  'Suspension',
  'Injection',
  'Inhaler',
  'Eye Drops',
  'Cream',
  'Ointment',
  'Powder',
  'Suppository',
  'IV Infusion',
];

const SELLING_RULES: SellingRule[] = [
  'individual',
  'strip',
  'bottle',
  'tube',
  'vial',
  'inhaler',
  'sachet',
];

const PAGE_SIZE = 60;

export const MedicineDatabase: React.FC<MedicineDatabaseProps> = ({
  onQuickAddToBill,
}) => {
  const [query, setQuery] = useState('');
  const [dosageForm, setDosageForm] = useState('All');
  const [strength, setStrength] = useState('');
  const [medicines, setMedicines] = useState<MedicineRecord[]>([]);
  const [totalMatched, setTotalMatched] = useState(0);
  const [totalCatalog, setTotalCatalog] = useState(0);
  const [verifiedPriceCount, setVerifiedPriceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [fetchingPriceId, setFetchingPriceId] = useState<number | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [ruleDraft, setRuleDraft] = useState<SellingRule>('individual');

  // Full MedEx catalog sync status
  const [syncStatus, setSyncStatus] = useState<MedexSyncStatusResponse | null>(null);

  // Optional future-ready inventory drawer
  const [inventoryMed, setInventoryMed] = useState<MedicineRecord | null>(null);
  const [invStock, setInvStock] = useState('');
  const [invBatch, setInvBatch] = useState('');
  const [invExpiry, setInvExpiry] = useState('');
  const [invSupplier, setInvSupplier] = useState('');

  // Add new medicine modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMed, setNewMed] = useState({
    brandName: '',
    genericName: '',
    strength: '',
    dosageForm: 'Tablet',
    manufacturer: '',
    packSize: 10,
    packUnit: 'strip',
    unitLabel: 'tablet',
    referenceUnitPrice: 0,
    sellingRule: 'individual' as SellingRule,
    medexUrl: 'https://medex.com.bd/',
  });

  // Live MedEx Search
  const [medexLoading, setMedexLoading] = useState(false);
  const [medexResult, setMedexResult] = useState<MedexLookupResult | null>(null);
  const [medexError, setMedexError] = useState<string | null>(null);

  const fetchMedicines = async (offset = 0, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await api.searchMedicines({
        q: query,
        dosageForm,
        strength,
        limit: PAGE_SIZE,
        offset,
      });
      setMedicines((prev) => (append ? [...prev, ...res.medicines] : res.medicines));
      setTotalMatched(res.totalMatched);
      setTotalCatalog(res.totalCatalog);
      setVerifiedPriceCount(res.verifiedPriceCount);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => fetchMedicines(0, false), 140);
    return () => clearTimeout(t);
  }, [query, dosageForm, strength]);

  // Poll sync status while a full MedEx sync is active
  useEffect(() => {
    api.getMedexSyncStatus().then(setSyncStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!syncStatus?.running) return;
    const id = setInterval(async () => {
      try {
        const next = await api.getMedexSyncStatus();
        setSyncStatus(next);
        setTotalCatalog(next.totalCatalogCount);
        setVerifiedPriceCount(next.verifiedPriceCount);
        if (!next.running) {
          fetchMedicines(0, false);
        }
      } catch {
        // ignore transient poll error
      }
    }, 1800);
    return () => clearInterval(id);
  }, [syncStatus?.running]);

  const handleStartFullSync = async () => {
    try {
      const status = await api.startMedexSync({ startPage: 1 });
      setSyncStatus(status);
    } catch {
      // ignore
    }
  };

  const handleFetchLivePrice = async (med: MedicineRecord) => {
    setFetchingPriceId(med.id);
    try {
      const res = await api.fetchMedicinePriceFromMedex(med.id);
      setMedicines((prev) =>
        prev.map((m) => (m.id === med.id ? res.medicine : m))
      );
      if (res.medicine.referenceUnitPrice > 0) {
        setVerifiedPriceCount((c) => c + 1);
      }
    } finally {
      setFetchingPriceId(null);
    }
  };

  const handleBillClick = async (med: MedicineRecord) => {
    const hasPrice = med.customUnitPrice !== null || med.referenceUnitPrice > 0;
    if (!hasPrice && med.medexUrl.includes('medex.com.bd/brands/')) {
      setFetchingPriceId(med.id);
      try {
        const res = await api.fetchMedicinePriceFromMedex(med.id);
        setMedicines((prev) =>
          prev.map((m) => (m.id === med.id ? res.medicine : m))
        );
        onQuickAddToBill(res.medicine);
        return;
      } catch {
        // fall through to billing with 0 so staff can enter manually
      } finally {
        setFetchingPriceId(null);
      }
    }
    onQuickAddToBill(med);
  };

  const startPriceEdit = (med: MedicineRecord) => {
    setEditingPriceId(med.id);
    setPriceDraft(String(med.customUnitPrice ?? med.referenceUnitPrice));
    setRuleDraft(med.sellingRule);
  };

  const savePriceEdit = async (med: MedicineRecord) => {
    const val = Number(priceDraft);
    if (Number.isNaN(val) || val < 0) return;
    const isSameAsRef =
      med.referenceUnitPrice > 0 && Math.abs(val - med.referenceUnitPrice) < 0.001;
    const res = await api.updateMedicine(med.id, {
      customUnitPrice: isSameAsRef ? null : val,
      sellingRule: ruleDraft,
      lastVerifiedAt: new Date().toISOString().slice(0, 10),
    });
    setMedicines((prev) => prev.map((m) => (m.id === med.id ? res.medicine : m)));
    setEditingPriceId(null);
  };

  const openInventoryEdit = (med: MedicineRecord) => {
    setInventoryMed(med);
    setInvStock(med.stockQty !== null ? String(med.stockQty) : '');
    setInvBatch(med.batchNumber || '');
    setInvExpiry(med.expiryDate || '');
    setInvSupplier(med.supplierName || '');
  };

  const saveInventory = async () => {
    if (!inventoryMed) return;
    const res = await api.updateMedicine(inventoryMed.id, {
      stockQty: invStock === '' ? null : Number(invStock),
      batchNumber: invBatch.trim() || null,
      expiryDate: invExpiry.trim() || null,
      supplierName: invSupplier.trim() || null,
    });
    setMedicines((prev) =>
      prev.map((m) => (m.id === inventoryMed.id ? res.medicine : m))
    );
    setInventoryMed(null);
  };

  const handleCreateMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMed.brandName.trim()) return;
    await api.createMedicine({
      ...newMed,
      referencePackPrice: Number(
        (newMed.referenceUnitPrice * newMed.packSize).toFixed(2)
      ),
      priceSource: 'Pharmacy Catalog Entry',
      lastVerifiedAt: new Date().toISOString().slice(0, 10),
    });
    setShowAddModal(false);
    setNewMed({
      brandName: '',
      genericName: '',
      strength: '',
      dosageForm: 'Tablet',
      manufacturer: '',
      packSize: 10,
      packUnit: 'strip',
      unitLabel: 'tablet',
      referenceUnitPrice: 0,
      sellingRule: 'individual',
      medexUrl: 'https://medex.com.bd/',
    });
    fetchMedicines(0, false);
  };

  const handleLiveMedexLookup = async () => {
    if (!query.trim()) return;
    setMedexLoading(true);
    setMedexError(null);
    setMedexResult(null);
    try {
      const res = await api.lookupMedexOnline(query.trim());
      setMedexResult(res);
      // Direct MedEx search also auto-upserts matches into SQLite — refresh list
      fetchMedicines(0, false);
    } catch (err) {
      setMedexError((err as Error).message);
    } finally {
      setMedexLoading(false);
    }
  };

  return (
    <div className="space-y-5 pb-20 lg:pb-8">
      {/* Search & Sync Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              MedEx Bangladesh Medicine Database
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-0.5">
              <span className="font-mono-num font-medium text-slate-800">
                {totalCatalog.toLocaleString('en-BD')} brands indexed
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">
                {verifiedPriceCount.toLocaleString('en-BD')} with cached price
              </span>
              <span aria-hidden="true">·</span>
              <span>Live MedEx price fetches on demand</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleStartFullSync}
              disabled={syncStatus?.running}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncStatus?.running ? 'animate-spin' : ''}`}
              />
              {syncStatus?.running
                ? `Syncing Page ${syncStatus.currentPage}/${syncStatus.totalPages}...`
                : 'Refresh Full MedEx Sync'}
            </button>
            <button
              type="button"
              onClick={handleLiveMedexLookup}
              disabled={!query.trim() || medexLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-medium hover:bg-emerald-100 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <Globe className="w-3.5 h-3.5" />
              {medexLoading ? 'Searching MedEx...' : 'Search MedEx Live'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Medicine
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="relative sm:col-span-6">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any Bangladesh brand, generic, or company (e.g. Napa, Sergel, Monas, Square)..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
          <input
            type="text"
            value={strength}
            onChange={(e) => setStrength(e.target.value)}
            placeholder="Filter strength (e.g. 500 mg)"
            className="sm:col-span-3 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <select
            value={dosageForm}
            onChange={(e) => setDosageForm(e.target.value)}
            className="sm:col-span-3 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            {FORMS.map((f) => (
              <option key={f} value={f}>
                {f === 'All' ? 'All Dosage Forms' : f}
              </option>
            ))}
          </select>
        </div>

        {(medexResult || medexError) && (
          <div className="p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs space-y-2">
            <div className="flex items-start justify-between gap-2">
              {medexError ? (
                <p className="text-red-700 font-medium">{medexError}</p>
              ) : (
                medexResult && (
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">
                        MedEx Live Result: {medexResult.brandName} {medexResult.strength}
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          const form = medexResult.dosageForm || 'Tablet';
                          const isBottle = /syrup|susp|drop/i.test(form);
                          const isTube = /cream|oint/i.test(form);
                          const isInhaler = /inhal/i.test(form);
                          const isVial = /inj/i.test(form);
                          const rule: SellingRule = isBottle
                            ? 'bottle'
                            : isTube
                            ? 'tube'
                            : isInhaler
                            ? 'inhaler'
                            : isVial
                            ? 'vial'
                            : 'individual';
                          const unitPrice = medexResult.unitPrice ?? 0;
                          const packSize = medexResult.packSize ?? 10;
                          await api.createMedicine({
                            brandName: medexResult.brandName || query.trim(),
                            genericName: medexResult.genericName || '',
                            strength: medexResult.strength || '',
                            dosageForm: form,
                            manufacturer: medexResult.manufacturer || 'MedEx Reference',
                            packSize,
                            packUnit: isBottle
                              ? 'bottle'
                              : isTube
                              ? 'tube'
                              : isInhaler
                              ? 'inhaler'
                              : isVial
                              ? 'vial'
                              : 'strip',
                            unitLabel: form.toLowerCase(),
                            referenceUnitPrice: unitPrice,
                            referencePackPrice:
                              medexResult.packPrice ?? unitPrice * packSize,
                            sellingRule: rule,
                            priceSource:
                              medexResult.unitPrice !== null
                                ? 'MedEx Bangladesh'
                                : 'Manual Verification Required',
                            medexUrl:
                              medexResult.sources[0]?.uri || 'https://medex.com.bd/',
                            lastVerifiedAt: new Date().toISOString().slice(0, 10),
                          });
                          setMedexResult(null);
                          fetchMedicines(0, false);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700 cursor-pointer whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Save with Verified Price
                      </button>
                    </div>
                    <p className="text-slate-700 whitespace-pre-line">
                      {medexResult.summary}
                    </p>
                    {medexResult.sources.length > 0 && (
                      <div className="flex flex-wrap gap-3 pt-1">
                        {medexResult.sources.slice(0, 4).map((s, idx) => (
                          <a
                            key={idx}
                            href={s.uri}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-800 underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {s.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )
              )}
              <button
                type="button"
                onClick={() => {
                  setMedexResult(null);
                  setMedexError(null);
                }}
                className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Catalog Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between text-xs text-slate-600">
          <span>
            Showing{' '}
            <strong className="font-mono-num text-slate-900">
              {medicines.length.toLocaleString('en-BD')}
            </strong>{' '}
            of{' '}
            <strong className="font-mono-num text-slate-900">
              {totalMatched.toLocaleString('en-BD')}
            </strong>{' '}
            matching medicines
          </span>
          <span className="text-slate-500">
            Click &quot;Fetch Price&quot; on any MedEx listing to pull exact live ৳ MRP
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 pl-5 pr-3">Brand &amp; Generic</th>
                <th className="py-2.5 px-3">Form &amp; Pack</th>
                <th className="py-2.5 px-3">Selling Rule</th>
                <th className="py-2.5 px-3 text-right">Selling Price</th>
                <th className="py-2.5 px-3">Source &amp; Verified</th>
                <th className="py-2.5 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    Searching MedEx Bangladesh database...
                  </td>
                </tr>
              ) : medicines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No medicines match your filter. Use &quot;Search MedEx Live&quot; or
                    &quot;Add Medicine&quot;.
                  </td>
                </tr>
              ) : (
                medicines.map((med) => {
                  const isEditing = editingPriceId === med.id;
                  const isFetching = fetchingPriceId === med.id;
                  const hasVerifiedPrice =
                    med.customUnitPrice !== null || med.referenceUnitPrice > 0;
                  const activePrice = med.customUnitPrice ?? med.referenceUnitPrice;

                  return (
                    <tr key={med.id} className="hover:bg-slate-50/70">
                      <td className="py-3 pl-5 pr-3">
                        <div className="font-semibold text-sm text-slate-900">
                          {med.brandName}{' '}
                          <span className="font-medium text-slate-600">
                            {med.strength}
                          </span>
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          {med.genericName || 'Generic on MedEx'} · {med.manufacturer}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                        <div>{med.dosageForm}</div>
                        <div className="text-slate-500">
                          {med.packSize} / {med.packUnit}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {isEditing ? (
                          <select
                            value={ruleDraft}
                            onChange={(e) =>
                              setRuleDraft(e.target.value as SellingRule)
                            }
                            className="px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                          >
                            {SELLING_RULES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-700 capitalize">
                            {med.sellingRule}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.1"
                            min={0}
                            value={priceDraft}
                            onChange={(e) => setPriceDraft(e.target.value)}
                            className="w-24 px-2 py-1 text-right font-mono-num bg-white border border-emerald-500 rounded"
                          />
                        ) : hasVerifiedPrice ? (
                          <div>
                            <div className="font-mono-num text-sm font-semibold text-slate-900">
                              {formatBDT(activePrice)}
                            </div>
                            {med.customUnitPrice !== null && (
                              <div className="text-[11px] text-emerald-700">
                                Custom (Ref {formatBDT(med.referenceUnitPrice)})
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleFetchLivePrice(med)}
                            disabled={isFetching}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-300 bg-amber-50 text-amber-900 font-medium hover:bg-amber-100 cursor-pointer whitespace-nowrap"
                          >
                            <Download className="w-3 h-3" />
                            {isFetching ? 'Fetching...' : 'Fetch MedEx Price'}
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <a
                          href={med.medexUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-700 hover:underline font-medium"
                        >
                          MedEx Bangladesh
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <div className="text-[11px] text-slate-500 font-mono-num">
                          {med.lastVerifiedAt
                            ? `Verified ${med.lastVerifiedAt}`
                            : 'Price not verified yet'}
                        </div>
                      </td>
                      <td className="py-3 pr-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => savePriceEdit(med)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingPriceId(null)}
                                className="px-2 py-1 rounded-md text-slate-600 hover:bg-slate-200 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startPriceEdit(med)}
                                className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                              >
                                Edit Price
                              </button>
                              <button
                                type="button"
                                onClick={() => openInventoryEdit(med)}
                                title="Optional stock & batch info"
                                className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer"
                              >
                                <Package className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleBillClick(med)}
                                disabled={isFetching}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium hover:bg-emerald-100 cursor-pointer"
                              >
                                <ShoppingCart className="w-3.5 h-3.5" />
                                Bill
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {medicines.length < totalMatched && (
          <div className="p-4 border-t border-slate-200 text-center bg-slate-50/50">
            <button
              type="button"
              onClick={() => fetchMedicines(medicines.length, true)}
              disabled={loadingMore}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
              {loadingMore
                ? 'Loading more medicines...'
                : `Load Next ${Math.min(PAGE_SIZE, totalMatched - medicines.length)} Medicines`}
            </button>
          </div>
        )}
      </div>

      {/* Add Medicine Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateMedicine}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                Add Medicine to Pharmacy Catalog
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">Brand Name *</label>
                <input
                  required
                  value={newMed.brandName}
                  onChange={(e) =>
                    setNewMed({ ...newMed, brandName: e.target.value })
                  }
                  placeholder="e.g. Napa"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Strength *</label>
                <input
                  required
                  value={newMed.strength}
                  onChange={(e) =>
                    setNewMed({ ...newMed, strength: e.target.value })
                  }
                  placeholder="e.g. 500 mg"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-slate-600 mb-1">Generic Name</label>
                <input
                  value={newMed.genericName}
                  onChange={(e) =>
                    setNewMed({ ...newMed, genericName: e.target.value })
                  }
                  placeholder="e.g. Paracetamol"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Dosage Form</label>
                <select
                  value={newMed.dosageForm}
                  onChange={(e) =>
                    setNewMed({ ...newMed, dosageForm: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {FORMS.filter((f) => f !== 'All').map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Manufacturer</label>
                <input
                  value={newMed.manufacturer}
                  onChange={(e) =>
                    setNewMed({ ...newMed, manufacturer: e.target.value })
                  }
                  placeholder="e.g. Square Pharmaceuticals"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Unit Price (৳) *</label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  required
                  value={newMed.referenceUnitPrice}
                  onChange={(e) =>
                    setNewMed({
                      ...newMed,
                      referenceUnitPrice: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 font-mono-num border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Pack Size</label>
                <input
                  type="number"
                  min={1}
                  value={newMed.packSize}
                  onChange={(e) =>
                    setNewMed({ ...newMed, packSize: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 font-mono-num border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Selling Rule</label>
                <select
                  value={newMed.sellingRule}
                  onChange={(e) =>
                    setNewMed({
                      ...newMed,
                      sellingRule: e.target.value as SellingRule,
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {SELLING_RULES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-600 mb-1">MedEx URL</label>
                <input
                  value={newMed.medexUrl}
                  onChange={(e) =>
                    setNewMed({ ...newMed, medexUrl: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 cursor-pointer"
              >
                Save Medicine
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Optional Inventory Details Modal (Future-ready) */}
      {inventoryMed && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Optional Inventory Record
                </h3>
                <p className="text-xs text-slate-500">
                  {inventoryMed.brandName} {inventoryMed.strength}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInventoryMed(null)}
                className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">Stock Qty (Optional)</label>
                <input
                  type="number"
                  min={0}
                  value={invStock}
                  onChange={(e) => setInvStock(e.target.value)}
                  placeholder="Not tracked"
                  className="w-full px-3 py-2 font-mono-num border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Batch Number</label>
                <input
                  value={invBatch}
                  onChange={(e) => setInvBatch(e.target.value)}
                  placeholder="e.g. BX-2026A"
                  className="w-full px-3 py-2 font-mono-num border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={invExpiry}
                  onChange={(e) => setInvExpiry(e.target.value)}
                  className="w-full px-3 py-2 font-mono-num border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Supplier</label>
                <input
                  value={invSupplier}
                  onChange={(e) => setInvSupplier(e.target.value)}
                  placeholder="Depot / Distributor"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInventoryMed(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveInventory}
                className="px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 cursor-pointer"
              >
                Update Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

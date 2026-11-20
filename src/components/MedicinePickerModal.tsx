import React, { useEffect, useState } from 'react';
import { ExternalLink, Globe, Search, X, Plus, Check } from 'lucide-react';
import type { MedexLookupResult, MedicineRecord } from '../types';
import { api } from '../lib/api';
import { formatBDT } from '../lib/calculator';

interface MedicinePickerModalProps {
  open: boolean;
  initialQuery: string;
  initialGeneric?: string;
  title?: string;
  onClose: () => void;
  onSelect: (medicine: MedicineRecord) => void;
}

const DOSAGE_FORMS = [
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
];

export const MedicinePickerModal: React.FC<MedicinePickerModalProps> = ({
  open,
  initialQuery,
  initialGeneric = '',
  title = 'Select Verified Medicine (MedEx Reference)',
  onClose,
  onSelect,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [dosageForm, setDosageForm] = useState('All');
  const [strength, setStrength] = useState('');
  const [results, setResults] = useState<MedicineRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const [medexLoading, setMedexLoading] = useState(false);
  const [medexResult, setMedexResult] = useState<MedexLookupResult | null>(null);
  const [medexError, setMedexError] = useState<string | null>(null);
  const [savingFromMedex, setSavingFromMedex] = useState(false);
  const [selectingId, setSelectingId] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery || initialGeneric || '');
      setDosageForm('All');
      setStrength('');
      setMedexResult(null);
      setMedexError(null);
    }
  }, [open, initialQuery, initialGeneric]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchMedicines({
          q: query,
          dosageForm,
          strength,
        });
        if (active) setResults(res.medicines);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, query, dosageForm, strength]);

  if (!open) return null;

  const handleMedexLookup = async () => {
    if (!query.trim()) return;
    setMedexLoading(true);
    setMedexError(null);
    setMedexResult(null);
    try {
      const res = await api.lookupMedexOnline(query.trim());
      setMedexResult(res);
    } catch (err) {
      setMedexError((err as Error).message);
    } finally {
      setMedexLoading(false);
    }
  };

  const handleSaveMedexToCatalog = async () => {
    if (!medexResult) return;
    setSavingFromMedex(true);
    try {
      const unitPrice = medexResult.unitPrice ?? 0;
      const packSize = medexResult.packSize ?? 10;
      const form = medexResult.dosageForm || 'Tablet';
      const isBottle = /syrup|susp|drop/i.test(form);
      const isTube = /cream|oint/i.test(form);
      const isInhaler = /inhal/i.test(form);
      const isVial = /inj/i.test(form);

      const sellingRule = isBottle
        ? 'bottle'
        : isTube
        ? 'tube'
        : isInhaler
        ? 'inhaler'
        : isVial
        ? 'vial'
        : 'individual';

      const created = await api.createMedicine({
        brandName: medexResult.brandName || query.trim(),
        genericName: medexResult.genericName || '',
        strength: medexResult.strength || '',
        dosageForm: form,
        manufacturer: medexResult.manufacturer || 'MedEx Reference',
        packSize,
        packUnit: isBottle ? 'bottle' : isTube ? 'tube' : isInhaler ? 'inhaler' : isVial ? 'vial' : 'strip',
        unitLabel: form.toLowerCase(),
        referenceUnitPrice: unitPrice,
        referencePackPrice: medexResult.packPrice ?? unitPrice * packSize,
        customUnitPrice: null,
        sellingRule,
        priceSource:
          medexResult.unitPrice !== null
            ? 'MedEx Bangladesh (Live Lookup)'
            : 'Manual Verification Required',
        medexUrl: medexResult.sources[0]?.uri || 'https://medex.com.bd/',
        lastVerifiedAt: new Date().toISOString().slice(0, 10),
      });
      onSelect(created.medicine);
      onClose();
    } catch (err) {
      setMedexError((err as Error).message);
    } finally {
      setSavingFromMedex(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Match exact brand, strength, and dosage form before confirming price.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Filters */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search brand, generic, or manufacturer (e.g. Seclo, Omeprazole, Napa)"
                autoFocus
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
              />
            </div>

            <input
              type="text"
              value={strength}
              onChange={(e) => setStrength(e.target.value)}
              placeholder="Strength (e.g. 20 mg)"
              className="w-full sm:w-36 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />

            <select
              value={dosageForm}
              onChange={(e) => setDosageForm(e.target.value)}
              className="w-full sm:w-36 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              {DOSAGE_FORMS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span>
              {loading
                ? 'Searching local MedEx catalog...'
                : `${results.length} matching medicines found`}
            </span>

            <button
              type="button"
              onClick={handleMedexLookup}
              disabled={medexLoading || !query.trim()}
              className="inline-flex items-center gap-1.5 text-emerald-700 font-medium hover:text-emerald-800 disabled:opacity-50 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              {medexLoading
                ? 'Checking MedEx Bangladesh...'
                : 'Search Live on MedEx Bangladesh'}
            </button>
          </div>
        </div>

        {/* Live MedEx Result Box */}
        {(medexResult || medexError) && (
          <div className="px-5 py-3 bg-emerald-50/70 border-b border-emerald-200 text-xs space-y-2">
            {medexError ? (
              <p className="text-red-700 font-medium">{medexError}</p>
            ) : (
              medexResult && (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">
                        Live MedEx Reference: {medexResult.brandName}{' '}
                        {medexResult.strength} ({medexResult.dosageForm})
                      </p>
                      <p className="text-slate-600 mt-0.5 whitespace-pre-line">
                        {medexResult.summary}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveMedexToCatalog}
                      disabled={savingFromMedex}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {savingFromMedex ? 'Saving...' : 'Save & Select'}
                    </button>
                  </div>
                  {medexResult.sources.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      {medexResult.sources.slice(0, 3).map((src, i) => (
                        <a
                          key={i}
                          href={src.uri}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-800 underline hover:text-emerald-950"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {src.title}
                        </a>
                      ))}
                    </div>
                  )}
                </>
              )
            )}
          </div>
        )}

        {/* Results List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {results.length === 0 && !loading ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No matching medicine found in local catalog. Try clearing strength filter or
              use <span className="font-medium text-emerald-700">Search Live on MedEx Bangladesh</span>.
            </div>
          ) : (
            results.map((med) => {
              const price = med.customUnitPrice ?? med.referenceUnitPrice;
              return (
                <div
                  key={med.id}
                  className="px-5 py-3 hover:bg-slate-50 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-900">
                        {med.brandName}
                      </span>
                      <span className="text-xs font-medium text-slate-700">
                        {med.strength}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-xs text-slate-600">{med.dosageForm}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span>{med.genericName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{med.manufacturer}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Pack: {med.packSize} / {med.packUnit}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      {med.customUnitPrice !== null || med.referenceUnitPrice > 0 ? (
                        <>
                          <div className="font-mono-num text-sm font-semibold text-slate-900">
                            {formatBDT(price)}
                            <span className="text-xs font-normal text-slate-500">
                              /{med.sellingRule === 'individual' || med.sellingRule === 'strip' ? med.unitLabel : med.packUnit}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {med.customUnitPrice !== null ? 'Custom Price' : med.priceSource}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-medium text-amber-800">
                            Fetch price on select
                          </div>
                          <div className="text-[11px] text-slate-500">
                            MedEx Bangladesh
                          </div>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={selectingId === med.id}
                      onClick={async () => {
                        let chosen = med;
                        if (
                          med.customUnitPrice === null &&
                          med.referenceUnitPrice <= 0 &&
                          med.medexUrl.includes('medex.com.bd/brands/')
                        ) {
                          setSelectingId(med.id);
                          try {
                            const refreshed = await api.fetchMedicinePriceFromMedex(med.id);
                            chosen = refreshed.medicine;
                          } catch {
                            // proceed with unverified price so staff can enter manually
                          } finally {
                            setSelectingId(null);
                          }
                        }
                        onSelect(chosen);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {selectingId === med.id ? 'Fetching...' : 'Select'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

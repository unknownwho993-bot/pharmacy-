import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  LayoutDashboard,
  Receipt,
  ScanLine,
  Settings,
  ShoppingCart,
} from 'lucide-react';
import type {
  BillItem,
  BillRecord,
  MedicineRecord,
  PharmacySettings,
} from './types';
import { api, type DashboardSummaryResponse } from './lib/api';
import { DashboardView } from './components/DashboardView';
import { PrescriptionWorkspace } from './components/PrescriptionWorkspace';
import { BillingPOS } from './components/BillingPOS';
import { MedicineDatabase } from './components/MedicineDatabase';
import { BillsHistory } from './components/BillsHistory';
import { InvoiceModal } from './components/InvoiceModal';
import { SettingsModal } from './components/SettingsModal';

type NavTab = 'dashboard' | 'prescription' | 'billing' | 'medicines' | 'bills';

const PHARMACY_EMBLEM_PATH =
  '/src/assets/images/pharmacy_emblem_1795156823945.jpg';

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

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortLabel: 'Home',
    icon: <LayoutDashboard className="w-4 h-4" />,
  },
  {
    id: 'prescription',
    label: 'Prescription Scan',
    shortLabel: 'Scan Rx',
    icon: <ScanLine className="w-4 h-4" />,
  },
  {
    id: 'billing',
    label: 'Quick Billing',
    shortLabel: 'Billing',
    icon: <ShoppingCart className="w-4 h-4" />,
  },
  {
    id: 'medicines',
    label: 'MedEx Catalog',
    shortLabel: 'Catalog',
    icon: <Database className="w-4 h-4" />,
  },
  {
    id: 'bills',
    label: 'Recent Bills',
    shortLabel: 'Bills',
    icon: <Receipt className="w-4 h-4" />,
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [logoError, setLogoError] = useState(false);

  // Server data states
  const [settings, setSettings] = useState<PharmacySettings>(DEFAULT_SETTINGS);
  const [dashboard, setDashboard] = useState<DashboardSummaryResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [bills, setBills] = useState<BillRecord[]>([]);
  const [billsLoading, setBillsLoading] = useState(false);

  // Active billing draft shared between Prescription Calculator & POS
  const [draftItems, setDraftItems] = useState<BillItem[]>([]);
  const [draftDoctor, setDraftDoctor] = useState('');
  const [draftCustomer, setDraftCustomer] = useState('');
  const [draftMode, setDraftMode] = useState<'duration' | 'budget' | 'direct'>(
    'direct'
  );
  const [draftDurationDays, setDraftDurationDays] = useState<number | null>(null);
  const [draftBudgetAmount, setDraftBudgetAmount] = useState<number | null>(null);
  const [draftRxImage, setDraftRxImage] = useState<string | null>(null);

  // Modals
  const [activeInvoice, setActiveInvoice] = useState<BillRecord | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const data = await api.getDashboard();
      setDashboard(data);
    } catch {
      // keep existing state
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const loadBills = useCallback(async () => {
    setBillsLoading(true);
    try {
      const res = await api.listBills(100);
      setBills(res.bills);
    } catch {
      // keep existing state
    } finally {
      setBillsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    api
      .getSettings()
      .then((res) => setSettings(res.settings))
      .catch(() => {});
  }, [loadDashboard]);

  useEffect(() => {
    if (activeTab === 'bills') {
      loadBills();
    } else if (activeTab === 'dashboard') {
      loadDashboard();
    }
  }, [activeTab, loadBills, loadDashboard]);

  const handleQuickAddMedicine = (med: MedicineRecord) => {
    const unitPrice = med.customUnitPrice ?? med.referenceUnitPrice;
    const qty = med.sellingRule === 'strip' ? med.packSize : 1;
    const unitLabel =
      med.sellingRule === 'individual' || med.sellingRule === 'strip'
        ? med.unitLabel
        : med.packUnit;

    const existing = draftItems.find((i) => i.medicineId === med.id);
    if (existing) {
      setDraftItems((prev) =>
        prev.map((i) =>
          i.id === existing.id
            ? {
                ...i,
                quantity: i.quantity + qty,
                lineTotal: Number(((i.quantity + qty) * i.unitPrice).toFixed(2)),
              }
            : i
        )
      );
    } else {
      setDraftItems((prev) => [
        ...prev,
        {
          id: `cat-${med.id}-${Date.now()}`,
          medicineId: med.id,
          medicineName: med.brandName,
          genericName: med.genericName,
          strength: med.strength,
          dosageForm: med.dosageForm,
          requiredQuantity: null,
          quantity: qty,
          unitLabel,
          packagingNote: `${qty} ${unitLabel}`,
          unitPrice,
          discountPercent: 0,
          lineTotal: Number((qty * unitPrice).toFixed(2)),
          instructions: '',
        },
      ]);
    }
    setActiveTab('billing');
  };

  const clearBillDraft = () => {
    setDraftItems([]);
    setDraftDoctor('');
    setDraftCustomer('');
    setDraftMode('direct');
    setDraftDurationDays(null);
    setDraftBudgetAmount(null);
    setDraftRxImage(null);
  };

  const currentTabTitle =
    NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Dashboard';

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 overflow-x-hidden">
      {/* Desktop Left Sidebar (240px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-2.5">
          {!logoError ? (
            <img
              src={PHARMACY_EMBLEM_PATH}
              alt="ShifaRx POS"
              referrerPolicy="no-referrer"
              onError={() => setLogoError(true)}
              className="w-8 h-8 rounded-lg object-contain border border-slate-200 p-0.5 bg-white shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
              Rx
            </div>
          )}
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap truncate">
            ShifaRx POS
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  {item.icon}
                  {item.label}
                </span>
                {item.id === 'billing' && draftItems.length > 0 && (
                  <span className="font-mono-num text-xs font-semibold text-emerald-700">
                    {draftItems.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4 shrink-0" />
            <span className="truncate">{settings.pharmacyName}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col lg:pl-60 min-w-0">
        {/* Top Context Header (Clean 1-row contract) */}
        <header className="sticky top-0 z-20 h-14 sm:h-16 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="lg:hidden font-bold text-slate-900 whitespace-nowrap">
              ShifaRx POS
            </span>
            <span className="lg:hidden text-slate-300" aria-hidden="true">
              /
            </span>
            <span className="text-sm font-semibold text-slate-900 truncate">
              {currentTabTitle}
            </span>
            <span
              className="hidden md:inline text-slate-300"
              aria-hidden="true"
            >
              ·
            </span>
            <span className="hidden md:inline text-xs text-slate-500 truncate">
              {settings.pharmacyName}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              aria-label="Pharmacy Settings"
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
            {activeTab !== 'prescription' ? (
              <button
                type="button"
                onClick={() => setActiveTab('prescription')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <ScanLine className="w-3.5 h-3.5" />
                New Prescription
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveTab('billing')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                Open Bill ({draftItems.length})
              </button>
            )}
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 w-full max-w-[1440px] mx-auto p-4 sm:p-6">
          {activeTab === 'dashboard' && (
            <DashboardView
              summary={dashboard}
              loading={dashboardLoading}
              onNavigate={(tab) => setActiveTab(tab)}
              onReprintBill={(bill) => setActiveInvoice(bill)}
            />
          )}

          {activeTab === 'prescription' && (
            <PrescriptionWorkspace
              settings={settings}
              onAddToBill={({
                items,
                doctorName,
                patientName,
                purchaseMode,
                durationDays,
                budgetAmount,
                prescriptionImage,
              }) => {
                setDraftItems(items);
                setDraftDoctor(doctorName);
                setDraftCustomer(patientName);
                setDraftMode(purchaseMode);
                setDraftDurationDays(durationDays);
                setDraftBudgetAmount(budgetAmount);
                setDraftRxImage(prescriptionImage);
                setActiveTab('billing');
              }}
            />
          )}

          {activeTab === 'billing' && (
            <BillingPOS
              items={draftItems}
              doctorName={draftDoctor}
              customerName={draftCustomer}
              purchaseMode={draftMode}
              durationDays={draftDurationDays}
              budgetAmount={draftBudgetAmount}
              prescriptionImage={draftRxImage}
              onUpdateItems={setDraftItems}
              onClearDraft={clearBillDraft}
              onBillSaved={(savedBill) => {
                setActiveInvoice(savedBill);
                loadDashboard();
                loadBills();
              }}
            />
          )}

          {activeTab === 'medicines' && (
            <MedicineDatabase onQuickAddToBill={handleQuickAddMedicine} />
          )}

          {activeTab === 'bills' && (
            <BillsHistory
              bills={bills}
              loading={billsLoading}
              onReprint={(bill) => setActiveInvoice(bill)}
            />
          )}
        </main>
      </div>

      {/* Mobile Compact Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 bg-white border-t border-slate-200 grid grid-cols-5">
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium cursor-pointer ${
                active ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              {item.icon}
              <span className="truncate max-w-full px-1">
                {item.id === 'billing' && draftItems.length > 0
                  ? `${item.shortLabel} (${draftItems.length})`
                  : item.shortLabel}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Modals */}
      <InvoiceModal
        bill={activeInvoice}
        settings={settings}
        onClose={() => setActiveInvoice(null)}
      />

      <SettingsModal
        open={showSettings}
        settings={settings}
        onClose={() => setShowSettings(false)}
        onSaved={(updated) => setSettings(updated)}
      />
    </div>
  );
}

import React from 'react';
import {
  ArrowUpRight,
  Database,
  Printer,
  Receipt,
  ScanLine,
  ShoppingCart,
} from 'lucide-react';
import type { BillRecord } from '../types';
import type { DashboardSummaryResponse } from '../lib/api';
import { formatBDT } from '../lib/calculator';

interface DashboardViewProps {
  summary: DashboardSummaryResponse | null;
  loading: boolean;
  onNavigate: (tab: 'prescription' | 'billing' | 'medicines' | 'bills') => void;
  onReprintBill: (bill: BillRecord) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  summary,
  loading,
  onNavigate,
  onReprintBill,
}) => {
  return (
    <div className="space-y-6 pb-20 lg:pb-8">
      {/* Primary Counter Action Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1.5 max-w-xl">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Fast Prescription Calculation &amp; Counter Billing
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Upload or capture a doctor&apos;s prescription, verify extracted medicines
            against MedEx Bangladesh prices, calculate 7/15/30-day or budget plans, and
            print thermal invoices in under a minute.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('prescription')}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors cursor-pointer whitespace-nowrap"
          >
            <ScanLine className="w-4 h-4" />
            New Prescription Scan
          </button>
          <button
            type="button"
            onClick={() => onNavigate('billing')}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-white border border-slate-300 text-slate-800 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <ShoppingCart className="w-4 h-4" />
            Quick Billing
          </button>
        </div>
      </div>

      {/* Today's Operational KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Today&apos;s Sales</div>
          <div className="font-mono-num text-2xl font-bold text-slate-900 mt-1">
            {loading ? '—' : formatBDT(summary?.todaySales ?? 0)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Collected {loading ? '—' : formatBDT(summary?.todayCollected ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Invoices Today</div>
          <div className="font-mono-num text-2xl font-bold text-slate-900 mt-1">
            {loading ? '—' : summary?.todayBillCount ?? 0}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Due {loading ? '—' : formatBDT(summary?.todayDue ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Verified MedEx Catalog</div>
          <div className="font-mono-num text-2xl font-bold text-slate-900 mt-1">
            {loading ? '—' : summary?.totalMedicines ?? 0}
          </div>
          <div className="text-xs text-slate-500 mt-1">Bangladesh brands ready</div>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('medicines')}
          className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors cursor-pointer flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-emerald-700 font-medium">
            <span>Medicine Search</span>
            <ArrowUpRight className="w-4 h-4" />
          </div>
          <div className="text-sm font-semibold text-slate-900 mt-2">
            Check MedEx Prices &amp; Pack Sizes
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Configure custom counter rates
          </div>
        </button>
      </div>

      {/* Quick Action Shortcuts + Recent Bills */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Recent Bills Table */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Recent Bills</h2>
            <button
              type="button"
              onClick={() => onNavigate('bills')}
              className="text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
            >
              View All Bills
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Loading recent bills...
            </div>
          ) : !summary || summary.recentBills.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-medium text-slate-700">No bills saved yet</p>
              <p className="text-xs text-slate-500">
                Scan a prescription or create a quick counter bill to generate your first
                invoice.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-2.5 pl-5 pr-3">Invoice</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Payment</th>
                    <th className="py-2.5 px-3 text-right">Total</th>
                    <th className="py-2.5 pr-5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.recentBills.map((bill) => (
                    <tr key={bill.id} className="hover:bg-slate-50/70">
                      <td className="py-3 pl-5 pr-3">
                        <div className="font-mono-num font-semibold text-slate-900">
                          {bill.invoiceNumber}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono-num">
                          {new Date(bill.createdAt).toLocaleTimeString('en-BD', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          · {bill.items.length} item(s)
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        {bill.customerName || 'Walk-in Customer'}
                      </td>
                      <td className="py-3 px-3 text-slate-600">
                        {bill.paymentMethod}
                        {bill.dueAmount > 0 && (
                          <span className="text-red-600 font-medium">
                            {' '}
                            · Due {formatBDT(bill.dueAmount)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num font-semibold text-slate-900">
                        {formatBDT(bill.grandTotal)}
                      </td>
                      <td className="py-3 pr-5 text-right">
                        <button
                          type="button"
                          onClick={() => onReprintBill(bill)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Reprint
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Counter Workflow Guide */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Counter Workflow Checklist
          </h2>
          <ol className="space-y-3 text-xs text-slate-600">
            <li className="flex gap-2.5">
              <span className="font-mono-num font-semibold text-emerald-700 shrink-0">
                01.
              </span>
              <span>
                <strong className="text-slate-900">Capture or Upload Rx</strong> — Snap
                with mobile camera or upload JPG/PNG/PDF. Crop &amp; rotate if needed.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono-num font-semibold text-emerald-700 shrink-0">
                02.
              </span>
              <span>
                <strong className="text-slate-900">Verify AI Extraction</strong> — Check
                highlighted names, strengths, and SOS items against the original image.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono-num font-semibold text-emerald-700 shrink-0">
                03.
              </span>
              <span>
                <strong className="text-slate-900">Choose Days or Budget</strong> — Pick
                7/15/30 days or enter a budget (e.g. ৳500) to calculate supply &amp; full
                strips.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono-num font-semibold text-emerald-700 shrink-0">
                04.
              </span>
              <span>
                <strong className="text-slate-900">Confirm &amp; Print</strong> — Click
                Add to Bill, enter cash/bKash payment, and print 58mm/80mm or A4 invoice.
              </span>
            </li>
          </ol>

          <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('medicines')}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800 hover:bg-slate-100 cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" />
              Browse MedEx DB
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

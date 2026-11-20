import React, { useMemo, useState } from 'react';
import { FileImage, Printer, Receipt, Search, X } from 'lucide-react';
import type { BillRecord } from '../types';
import { formatBDT } from '../lib/calculator';

interface BillsHistoryProps {
  bills: BillRecord[];
  loading: boolean;
  onReprint: (bill: BillRecord) => void;
}

export const BillsHistory: React.FC<BillsHistoryProps> = ({
  bills,
  loading,
  onReprint,
}) => {
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [viewingRxBill, setViewingRxBill] = useState<BillRecord | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((b) => {
      if (paymentFilter !== 'All' && b.paymentMethod !== paymentFilter) {
        return false;
      }
      if (!q) return true;
      return (
        b.invoiceNumber.toLowerCase().includes(q) ||
        b.customerName.toLowerCase().includes(q) ||
        b.customerPhone.toLowerCase().includes(q) ||
        b.doctorName.toLowerCase().includes(q) ||
        b.items.some((i) => i.medicineName.toLowerCase().includes(q))
      );
    });
  }, [bills, search, paymentFilter]);

  return (
    <div className="space-y-5 pb-20 lg:pb-8">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice #, customer, phone, or medicine..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {['All', 'Cash', 'bKash', 'Nagad', 'Card'].map((pm) => (
            <button
              key={pm}
              type="button"
              onClick={() => setPaymentFilter(pm)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                paymentFilter === pm
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {pm}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-xs text-slate-500">
            Loading invoice archive...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-medium text-slate-700">No invoices found</p>
            <p className="text-xs text-slate-500">
              Saved bills and reprinted invoices will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 pl-5 pr-3">Invoice &amp; Date</th>
                  <th className="py-2.5 px-3">Customer / Doctor</th>
                  <th className="py-2.5 px-3">Items</th>
                  <th className="py-2.5 px-3">Payment</th>
                  <th className="py-2.5 px-3 text-right">Grand Total</th>
                  <th className="py-2.5 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((bill) => (
                  <tr key={bill.id} className="hover:bg-slate-50/70">
                    <td className="py-3 pl-5 pr-3 whitespace-nowrap">
                      <div className="font-mono-num font-semibold text-slate-900">
                        {bill.invoiceNumber}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono-num">
                        {new Date(bill.createdAt).toLocaleString('en-BD')}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-900">
                        {bill.customerName || 'Walk-in Customer'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {[bill.customerPhone, bill.doctorName && `Rx: ${bill.doctorName}`]
                          .filter(Boolean)
                          .join(' · ') || 'Counter sale'}
                      </div>
                    </td>
                    <td className="py-3 px-3 max-w-[260px]">
                      <div className="text-slate-700 truncate">
                        {bill.items.map((i) => i.medicineName).join(', ')}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {bill.items.length} item(s)
                        {bill.purchaseMode === 'duration' && bill.durationDays
                          ? ` · ${bill.durationDays} days`
                          : bill.purchaseMode === 'budget' && bill.budgetAmount
                          ? ` · Budget ${formatBDT(bill.budgetAmount)}`
                          : ''}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="text-slate-800">{bill.paymentMethod}</div>
                      {bill.dueAmount > 0 ? (
                        <div className="text-[11px] text-red-600 font-medium font-mono-num">
                          Due {formatBDT(bill.dueAmount)}
                        </div>
                      ) : (
                        <div className="text-[11px] text-emerald-700">Paid in full</div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num font-semibold text-slate-900 whitespace-nowrap">
                      {formatBDT(bill.grandTotal)}
                    </td>
                    <td className="py-3 pr-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {bill.prescriptionImage && (
                          <button
                            type="button"
                            onClick={() => setViewingRxBill(bill)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            <FileImage className="w-3.5 h-3.5" />
                            Rx Image
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onReprint(bill)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 font-medium hover:bg-emerald-100 cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Reprint
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stored Original Prescription Reference Modal */}
      {viewingRxBill && viewingRxBill.prescriptionImage && (
        <div className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Original Prescription Reference · {viewingRxBill.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  {viewingRxBill.customerName || 'Walk-in'} ·{' '}
                  {new Date(viewingRxBill.createdAt).toLocaleString('en-BD')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingRxBill(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-4 flex items-center justify-center">
              {viewingRxBill.prescriptionImage.startsWith('data:application/pdf') ? (
                <object
                  data={viewingRxBill.prescriptionImage}
                  type="application/pdf"
                  className="w-full h-[520px] rounded bg-white"
                >
                  <p className="text-sm text-slate-600">
                    PDF prescription archived with invoice {viewingRxBill.invoiceNumber}.
                  </p>
                </object>
              ) : (
                <img
                  src={viewingRxBill.prescriptionImage}
                  alt={`Original prescription for ${viewingRxBill.invoiceNumber}`}
                  referrerPolicy="no-referrer"
                  className="max-h-[70vh] w-auto object-contain rounded border border-slate-200 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

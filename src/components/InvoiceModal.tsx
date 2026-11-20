import React, { useState } from 'react';
import { Download, Printer, X } from 'lucide-react';
import type { BillRecord, PharmacySettings } from '../types';
import { formatBDT } from '../lib/calculator';
import { exportInvoicePdf } from '../lib/pdfInvoice';

const PHARMACY_EMBLEM_PATH =
  '/src/assets/images/pharmacy_emblem_1795156823945.jpg';

interface InvoiceModalProps {
  bill: BillRecord | null;
  settings: PharmacySettings;
  onClose: () => void;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({
  bill,
  settings,
  onClose,
}) => {
  const [paperSize, setPaperSize] = useState<'58mm' | '80mm' | 'a4'>(
    settings.defaultPaperSize || '80mm'
  );
  const [logoError, setLogoError] = useState(false);

  if (!bill) return null;

  const isThermal = paperSize === '58mm' || paperSize === '80mm';

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = () => {
    exportInvoicePdf(bill, settings, paperSize);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Controls Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900">
              Invoice Preview · <span className="font-mono-num">{bill.invoiceNumber}</span>
            </h3>

            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              {(['58mm', '80mm', 'a4'] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setPaperSize(sz)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    paperSize === sz
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {sz === 'a4' ? 'A4 Invoice' : `Thermal ${sz}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Export PDF
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close invoice preview"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Sheet Container */}
        <div className="flex-1 overflow-y-auto bg-slate-100 p-6 flex justify-center">
          <div
            id="printable-invoice-area"
            className={`bg-white text-slate-900 border border-slate-200 shadow-sm ${
              paperSize === '58mm'
                ? 'print-58mm w-[240px] p-3 text-[11px]'
                : paperSize === '80mm'
                ? 'print-80mm w-[320px] p-4 text-xs'
                : 'print-a4 w-full max-w-[740px] p-8 text-sm'
            }`}
          >
            {isThermal ? (
              /* Thermal POS Receipt (58mm / 80mm) */
              <div className="space-y-2.5">
                <div className="text-center space-y-0.5">
                  <div className="font-bold text-sm leading-tight">
                    {settings.pharmacyName}
                  </div>
                  <div className="text-[10px] text-slate-600 leading-snug">
                    {settings.address}
                  </div>
                  <div className="text-[10px] text-slate-600 font-mono-num">
                    Tel: {settings.phone}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono-num">
                    DL: {settings.drugLicenseNo}
                  </div>
                </div>

                <div className="border-t border-dashed border-slate-400 pt-2 space-y-0.5 text-[10px]">
                  <div className="flex justify-between">
                    <span>Inv:</span>
                    <span className="font-mono-num font-semibold">
                      {bill.invoiceNumber}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span className="font-mono-num">
                      {new Date(bill.createdAt).toLocaleString('en-BD')}
                    </span>
                  </div>
                  {bill.customerName && (
                    <div className="flex justify-between">
                      <span>Customer:</span>
                      <span>{bill.customerName}</span>
                    </div>
                  )}
                  {bill.customerPhone && (
                    <div className="flex justify-between">
                      <span>Phone:</span>
                      <span className="font-mono-num">{bill.customerPhone}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Payment:</span>
                    <span className="font-medium">{bill.paymentMethod}</span>
                  </div>
                </div>

                <div className="border-t border-b border-dashed border-slate-400 py-2 space-y-2">
                  {bill.items.map((item, idx) => (
                    <div key={item.id || idx} className="space-y-0.5">
                      <div className="font-semibold leading-tight">
                        {item.medicineName} {item.strength}
                      </div>
                      <div className="flex justify-between font-mono-num text-[10px] text-slate-700">
                        <span>
                          {item.quantity} {item.unitLabel} × {item.unitPrice.toFixed(2)}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {item.lineTotal.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1 font-mono-num text-[11px]">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatBDT(bill.subtotal)}</span>
                  </div>
                  {bill.discountAmount > 0 && (
                    <div className="flex justify-between">
                      <span>Discount</span>
                      <span>-{formatBDT(bill.discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-xs pt-1 border-t border-slate-300">
                    <span>GRAND TOTAL</span>
                    <span>{formatBDT(bill.grandTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Paid ({bill.paymentMethod})</span>
                    <span>{formatBDT(bill.paidAmount)}</span>
                  </div>
                  {bill.dueAmount > 0 && (
                    <div className="flex justify-between font-semibold">
                      <span>Due</span>
                      <span>{formatBDT(bill.dueAmount)}</span>
                    </div>
                  )}
                  {bill.changeAmount > 0 && (
                    <div className="flex justify-between">
                      <span>Change</span>
                      <span>{formatBDT(bill.changeAmount)}</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-dashed border-slate-400 pt-2 text-center text-[9.5px] text-slate-600 leading-snug">
                  {settings.footerNote}
                </div>
              </div>
            ) : (
              /* A4 Formal Pharmacy Invoice */
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-200">
                  <div className="flex items-center gap-3.5">
                    {!logoError ? (
                      <img
                        src={PHARMACY_EMBLEM_PATH}
                        alt={settings.pharmacyName}
                        referrerPolicy="no-referrer"
                        onError={() => setLogoError(true)}
                        className="w-12 h-12 rounded-lg object-contain border border-slate-200 bg-white p-1"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-emerald-600 text-white font-bold flex items-center justify-center text-lg">
                        Rx
                      </div>
                    )}
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">
                        {settings.pharmacyName}
                      </h2>
                      <p className="text-xs text-slate-600">{settings.address}</p>
                      <p className="text-xs text-slate-500 font-mono-num mt-0.5">
                        Phone: {settings.phone} · Drug License: {settings.drugLicenseNo}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-semibold text-emerald-700">
                      PHARMACY INVOICE
                    </div>
                    <div className="font-mono-num text-sm font-bold text-slate-900 mt-0.5">
                      {bill.invoiceNumber}
                    </div>
                    <div className="text-xs text-slate-500 font-mono-num mt-0.5">
                      {new Date(bill.createdAt).toLocaleString('en-BD')}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="text-slate-500">Customer</div>
                    <div className="font-semibold text-slate-900">
                      {bill.customerName || 'Walk-in Customer'}
                    </div>
                    {bill.customerPhone && (
                      <div className="font-mono-num text-slate-600">
                        {bill.customerPhone}
                      </div>
                    )}
                  </div>
                  <div className="text-right space-y-1">
                    <div className="text-slate-500">Payment &amp; Reference</div>
                    <div className="font-semibold text-slate-900">
                      Paid via {bill.paymentMethod}
                    </div>
                    {bill.doctorName && (
                      <div className="text-slate-600">Rx: {bill.doctorName}</div>
                    )}
                  </div>
                </div>

                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-y border-slate-200 text-slate-700">
                      <th className="py-2 px-2.5 w-8">#</th>
                      <th className="py-2 px-2.5">Medicine &amp; Strength</th>
                      <th className="py-2 px-2.5">Quantity / Supply</th>
                      <th className="py-2 px-2.5 text-right">Unit Price</th>
                      <th className="py-2 px-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {bill.items.map((item, idx) => (
                      <tr key={item.id || idx}>
                        <td className="py-2.5 px-2.5 font-mono-num text-slate-500">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-2.5">
                          <div className="font-semibold text-slate-900">
                            {item.medicineName} {item.strength}
                          </div>
                          {item.instructions && (
                            <div className="text-[11px] text-slate-500">
                              {item.instructions}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 font-mono-num text-slate-700">
                          {item.packagingNote || `${item.quantity} ${item.unitLabel}`}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono-num">
                          {formatBDT(item.unitPrice)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono-num font-semibold">
                          {formatBDT(item.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex justify-end">
                  <div className="w-64 space-y-1.5 text-xs font-mono-num">
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal</span>
                      <span>{formatBDT(bill.subtotal)}</span>
                    </div>
                    {bill.discountAmount > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>Discount</span>
                        <span>-{formatBDT(bill.discountAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-300">
                      <span>Grand Total</span>
                      <span>{formatBDT(bill.grandTotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-700">
                      <span>Paid Amount</span>
                      <span>{formatBDT(bill.paidAmount)}</span>
                    </div>
                    {bill.dueAmount > 0 && (
                      <div className="flex justify-between text-red-700 font-semibold">
                        <span>Due Amount</span>
                        <span>{formatBDT(bill.dueAmount)}</span>
                      </div>
                    )}
                    {bill.changeAmount > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>Change Returned</span>
                        <span>{formatBDT(bill.changeAmount)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between gap-4">
                  <p className="max-w-md">{settings.footerNote}</p>
                  <div className="text-right shrink-0">
                    <div className="w-36 border-b border-slate-400 mb-1" />
                    <span className="text-[11px]">Pharmacist Signature</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

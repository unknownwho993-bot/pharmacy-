import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { PharmacySettings } from '../types';
import { api } from '../lib/api';

interface SettingsModalProps {
  open: boolean;
  settings: PharmacySettings;
  onClose: () => void;
  onSaved: (settings: PharmacySettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  settings,
  onClose,
  onSaved,
}) => {
  const [form, setForm] = useState<PharmacySettings>(settings);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.updateSettings(form);
      onSaved(res.settings);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Pharmacy &amp; Invoice Settings
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Printed on thermal receipts and A4 invoices.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3.5 text-xs">
          <div>
            <label className="block text-slate-700 font-medium mb-1">
              Pharmacy Name
            </label>
            <input
              required
              value={form.pharmacyName}
              onChange={(e) => setForm({ ...form, pharmacyName: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-slate-700 font-medium mb-1">Address</label>
            <input
              required
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-medium mb-1">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Drug License No.
              </label>
              <input
                value={form.drugLicenseNo}
                onChange={(e) => setForm({ ...form, drugLicenseNo: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Default Print Format
              </label>
              <select
                value={form.defaultPaperSize}
                onChange={(e) =>
                  setForm({
                    ...form,
                    defaultPaperSize: e.target.value as PharmacySettings['defaultPaperSize'],
                  })
                }
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              >
                <option value="58mm">Thermal 58mm</option>
                <option value="80mm">Thermal 80mm</option>
                <option value="a4">A4 Printable Invoice</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.defaultStripOnly}
                  onChange={(e) =>
                    setForm({ ...form, defaultStripOnly: e.target.checked })
                  }
                  className="rounded border-slate-300 text-emerald-600"
                />
                Default to full-strip rounding
              </label>
            </div>
          </div>

          <div>
            <label className="block text-slate-700 font-medium mb-1">
              Invoice Footer Note
            </label>
            <textarea
              rows={2}
              value={form.footerNote}
              onChange={(e) => setForm({ ...form, footerNote: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
};

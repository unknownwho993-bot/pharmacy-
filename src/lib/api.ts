import type {
  BillRecord,
  ExtractionResponse,
  MedexLookupResult,
  MedicineRecord,
  PharmacySettings,
} from '../types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface DashboardSummaryResponse {
  todayBillCount: number;
  todaySales: number;
  todayCollected: number;
  todayDue: number;
  totalMedicines: number;
  recentBills: BillRecord[];
}

export interface MedicineSearchResponse {
  medicines: MedicineRecord[];
  totalMatched: number;
  totalCatalog: number;
  verifiedPriceCount: number;
}

export interface MedexSyncStatusResponse {
  running: boolean;
  currentPage: number;
  totalPages: number;
  syncedBrandsThisRun: number;
  totalCatalogCount: number;
  verifiedPriceCount: number;
  lastError: string | null;
  completedAt: string | null;
}

export const api = {
  getDashboard: () => request<DashboardSummaryResponse>('/api/dashboard'),

  extractPrescription: (imageBase64: string, mimeType: string) =>
    request<ExtractionResponse>('/api/prescriptions/extract', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mimeType }),
    }),

  extractPrescriptionLocal: (imageBase64: string, mimeType: string) =>
    request<ExtractionResponse>('/api/prescriptions/ocr-local', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mimeType }),
    }),

  searchMedicines: (params: {
    q?: string;
    dosageForm?: string;
    strength?: string;
    generic?: string;
    limit?: number;
    offset?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set('q', params.q);
    if (params.dosageForm && params.dosageForm !== 'All')
      sp.set('dosageForm', params.dosageForm);
    if (params.strength) sp.set('strength', params.strength);
    if (params.generic) sp.set('generic', params.generic);
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.offset) sp.set('offset', String(params.offset));
    return request<MedicineSearchResponse>(`/api/medicines?${sp.toString()}`);
  },

  createMedicine: (payload: Partial<MedicineRecord>) =>
    request<{ medicine: MedicineRecord }>('/api/medicines', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateMedicine: (id: number, patch: Partial<MedicineRecord>) =>
    request<{ medicine: MedicineRecord }>(`/api/medicines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  fetchMedicinePriceFromMedex: (id: number) =>
    request<{ medicine: MedicineRecord }>(`/api/medicines/${id}/fetch-price`, {
      method: 'POST',
    }),

  lookupMedexOnline: (query: string) =>
    request<MedexLookupResult>('/api/medicines/medex-lookup', {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),

  getMedexSyncStatus: () =>
    request<MedexSyncStatusResponse>('/api/medex/sync-status'),

  startMedexSync: (options?: { startPage?: number; endPage?: number }) =>
    request<MedexSyncStatusResponse>('/api/medex/sync', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }),

  listBills: (limit = 100) =>
    request<{ bills: BillRecord[] }>(`/api/bills?limit=${limit}`),

  createBill: (payload: Omit<BillRecord, 'id' | 'invoiceNumber' | 'createdAt'>) =>
    request<{ bill: BillRecord }>('/api/bills', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getSettings: () => request<{ settings: PharmacySettings }>('/api/settings'),

  updateSettings: (patch: Partial<PharmacySettings>) =>
    request<{ settings: PharmacySettings }>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
};

import type {
  BillRecord,
  ExtractionResponse,
  MedexLookupResult,
  MedicineRecord,
  PharmacySettings,
} from '../types';
import {
  staticCreateBill,
  staticCreateMedicine,
  staticExtractPrescriptionLocal,
  staticGetDashboard,
  staticGetMedexSyncStatus,
  staticGetSettings,
  staticListBills,
  staticSearchMedicines,
  staticUpdateMedicine,
  staticUpdateSettings,
} from './staticCatalog';

class ApiUnavailableError extends Error {
  constructor() {
    super('Backend API unavailable');
    this.name = 'ApiUnavailableError';
  }
}

// Once a static-only public preview returns HTML 404 for /api/*, skip redundant network 404s
let backendUnavailable = false;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  if (backendUnavailable) {
    throw new ApiUnavailableError();
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      ...options,
    });
  } catch {
    backendUnavailable = true;
    throw new ApiUnavailableError();
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!isJson) {
    // Public static share hosting returns HTML 404/index for /api/* routes
    if (res.status === 404 || res.status === 405 || res.status === 503) {
      backendUnavailable = true;
      throw new ApiUnavailableError();
    }
    throw new Error(`Unexpected response from server (${res.status})`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T> | T
): Promise<T> {
  try {
    return await primary();
  } catch (err) {
    if (err instanceof ApiUnavailableError) {
      return await fallback();
    }
    throw err;
  }
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
  getDashboard: () =>
    withFallback(
      () => request<DashboardSummaryResponse>('/api/dashboard'),
      () => staticGetDashboard()
    ),

  extractPrescription: (imageBase64: string, mimeType: string) =>
    withFallback(
      () =>
        request<ExtractionResponse>('/api/prescriptions/extract', {
          method: 'POST',
          body: JSON.stringify({ imageBase64, mimeType }),
        }),
      () => {
        throw new Error(
          'Cloud AI Vision requires the backend server with a valid GEMINI_API_KEY. Please click "Local OCR (No API Key)" to scan this prescription directly in your browser.'
        );
      }
    ),

  extractPrescriptionLocal: (imageBase64: string, mimeType: string) =>
    withFallback(
      () =>
        request<ExtractionResponse>('/api/prescriptions/ocr-local', {
          method: 'POST',
          body: JSON.stringify({ imageBase64, mimeType }),
        }),
      () => staticExtractPrescriptionLocal(imageBase64, mimeType)
    ),

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
    return withFallback(
      () => request<MedicineSearchResponse>(`/api/medicines?${sp.toString()}`),
      () => staticSearchMedicines(params)
    );
  },

  createMedicine: (payload: Partial<MedicineRecord>) =>
    withFallback(
      () =>
        request<{ medicine: MedicineRecord }>('/api/medicines', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      () => staticCreateMedicine(payload)
    ),

  updateMedicine: (id: number, patch: Partial<MedicineRecord>) =>
    withFallback(
      () =>
        request<{ medicine: MedicineRecord }>(`/api/medicines/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),
      () => staticUpdateMedicine(id, patch)
    ),

  fetchMedicinePriceFromMedex: (id: number) =>
    withFallback(
      () =>
        request<{ medicine: MedicineRecord }>(`/api/medicines/${id}/fetch-price`, {
          method: 'POST',
        }),
      () => {
        throw new Error(
          'Live MedEx price fetch requires the backend server. You can open the MedEx link to check the price and click "Edit Price" to save your custom counter rate.'
        );
      }
    ),

  lookupMedexOnline: (query: string) =>
    withFallback(
      () =>
        request<MedexLookupResult>('/api/medicines/medex-lookup', {
          method: 'POST',
          body: JSON.stringify({ query }),
        }),
      () => {
        throw new Error(
          'Live MedEx scraping requires the backend server. All 25,703 MedEx Bangladesh brands are already searchable directly in the catalog above!'
        );
      }
    ),

  getMedexSyncStatus: () =>
    withFallback(
      () => request<MedexSyncStatusResponse>('/api/medex/sync-status'),
      () => staticGetMedexSyncStatus()
    ),

  startMedexSync: (options?: { startPage?: number; endPage?: number }) =>
    withFallback(
      () =>
        request<MedexSyncStatusResponse>('/api/medex/sync', {
          method: 'POST',
          body: JSON.stringify(options || {}),
        }),
      () => staticGetMedexSyncStatus()
    ),

  listBills: (limit = 100) =>
    withFallback(
      () => request<{ bills: BillRecord[] }>(`/api/bills?limit=${limit}`),
      () => staticListBills(limit)
    ),

  createBill: (payload: Omit<BillRecord, 'id' | 'invoiceNumber' | 'createdAt'>) =>
    withFallback(
      () =>
        request<{ bill: BillRecord }>('/api/bills', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      () => staticCreateBill(payload)
    ),

  getSettings: () =>
    withFallback(
      () => request<{ settings: PharmacySettings }>('/api/settings'),
      () => staticGetSettings()
    ),

  updateSettings: (patch: Partial<PharmacySettings>) =>
    withFallback(
      () =>
        request<{ settings: PharmacySettings }>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),
      () => staticUpdateSettings(patch)
    ),
};

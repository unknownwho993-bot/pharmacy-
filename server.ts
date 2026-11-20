import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  createBill,
  createMedicine,
  getBillById,
  getDashboardSummary,
  getMedicineStats,
  getSettings,
  listBills,
  updateMedicine,
  updateSettings,
} from './server/db.ts';
import {
  GeminiApiError,
  extractPrescriptionFromMedia,
} from './server/geminiService.ts';
import {
  buildPrescriptionLinesFromExtracted,
  searchMedicinesFuzzy,
} from './server/matchingService.ts';
import { extractPrescriptionWithLocalOcr } from './server/localOcrService.ts';
import {
  fetchAndCacheMedicinePrice,
  getMedexSyncStatus,
  runMedexCatalogSync,
  searchMedexDirect,
} from './server/medexService.ts';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get('/api/dashboard', (_req, res) => {
    try {
      res.json(getDashboardSummary());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // AI Prescription OCR + Strict MedEx Catalog Matching (with auto live price lookup)
  app.post('/api/prescriptions/extract', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body as {
        imageBase64?: string;
        mimeType?: string;
      };

      if (!imageBase64 || !mimeType) {
        return res
          .status(400)
          .json({ error: 'Missing prescription image/PDF payload or mimeType.' });
      }

      const cleanedBase64 = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;

      const raw = await extractPrescriptionFromMedia(cleanedBase64, mimeType);
      const lines = await buildPrescriptionLinesFromExtracted(raw.medicines);

      return res.json({
        doctorName: raw.doctorName,
        patientName: raw.patientName,
        prescriptionDate: raw.prescriptionDate,
        notes: raw.notes,
        lines,
      });
    } catch (err) {
      if (err instanceof GeminiApiError) {
        // Use 502/422 so hosting proxies do not strip JSON error bodies on 403 responses
        const safeStatus = err.statusCode === 403 ? 502 : err.statusCode;
        return res.status(safeStatus).json({
          error: err.message,
          code: err.code,
          upstreamStatus: err.statusCode,
        });
      }
      const message = (err as Error).message || 'Failed to extract prescription.';
      console.error('[OCR Extract Error]', err);
      return res.status(500).json({ error: message });
    }
  });

  // Local Tesseract OCR fallback (no Gemini API key required)
  app.post('/api/prescriptions/ocr-local', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body as {
        imageBase64?: string;
        mimeType?: string;
      };

      if (!imageBase64 || !mimeType) {
        return res
          .status(400)
          .json({ error: 'Missing prescription image payload or mimeType.' });
      }

      const cleanedBase64 = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;

      const raw = await extractPrescriptionWithLocalOcr(cleanedBase64, mimeType);
      const lines = await buildPrescriptionLinesFromExtracted(raw.medicines);

      return res.json({
        doctorName: raw.doctorName,
        patientName: raw.patientName,
        prescriptionDate: raw.prescriptionDate,
        notes: raw.notes,
        lines,
        rawOcrText: raw.rawOcrText,
      });
    } catch (err) {
      return res.status(422).json({
        error: (err as Error).message || 'Local OCR failed to read prescription.',
      });
    }
  });

  // Medicine Catalog Paginated Search & CRUD (25,700+ MedEx brands)
  app.get('/api/medicines', (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const dosageForm =
        typeof req.query.dosageForm === 'string' ? req.query.dosageForm : '';
      const strength =
        typeof req.query.strength === 'string' ? req.query.strength : '';
      const generic =
        typeof req.query.generic === 'string' ? req.query.generic : '';
      const limit = Number(req.query.limit) || 60;
      const offset = Number(req.query.offset) || 0;

      const { medicines, totalMatched } = searchMedicinesFuzzy({
        q,
        dosageForm,
        strength,
        generic,
        limit,
        offset,
      });
      const stats = getMedicineStats();
      res.json({
        medicines,
        totalMatched,
        totalCatalog: stats.totalCatalog,
        verifiedPriceCount: stats.verifiedPriceCount,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/medicines', (req, res) => {
    try {
      const body = req.body;
      if (!body.brandName || !body.dosageForm) {
        return res.status(400).json({ error: 'Brand name and dosage form are required.' });
      }
      const created = createMedicine({
        brandName: String(body.brandName).trim(),
        genericName: String(body.genericName || '').trim(),
        strength: String(body.strength || '').trim(),
        dosageForm: String(body.dosageForm).trim(),
        manufacturer: String(body.manufacturer || 'Local / Unspecified').trim(),
        packSize: Number(body.packSize) || 10,
        packUnit: String(body.packUnit || 'strip'),
        unitLabel: String(body.unitLabel || 'tablet'),
        referenceUnitPrice: Number(body.referenceUnitPrice) || 0,
        referencePackPrice:
          Number(body.referencePackPrice) ||
          (Number(body.referenceUnitPrice) || 0) * (Number(body.packSize) || 10),
        customUnitPrice:
          body.customUnitPrice !== null &&
          body.customUnitPrice !== undefined &&
          body.customUnitPrice !== ''
            ? Number(body.customUnitPrice)
            : null,
        sellingRule: body.sellingRule || 'individual',
        priceSource: String(body.priceSource || 'Manual Pharmacy Entry'),
        medexUrl: String(body.medexUrl || 'https://medex.com.bd/'),
        lastVerifiedAt: String(
          body.lastVerifiedAt || new Date().toISOString().slice(0, 10)
        ),
        stockQty: body.stockQty !== undefined && body.stockQty !== '' ? Number(body.stockQty) : null,
        reorderLevel:
          body.reorderLevel !== undefined && body.reorderLevel !== ''
            ? Number(body.reorderLevel)
            : null,
        batchNumber: body.batchNumber ? String(body.batchNumber) : null,
        expiryDate: body.expiryDate ? String(body.expiryDate) : null,
        supplierName: body.supplierName ? String(body.supplierName) : null,
      });
      res.status(201).json({ medicine: created });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/medicines/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'Invalid medicine ID.' });
      }
      const updated = updateMedicine(id, req.body);
      if (!updated) {
        return res.status(404).json({ error: 'Medicine not found.' });
      }
      res.json({ medicine: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // On-demand exact live MedEx price fetcher for any brand in the 25,700+ database
  app.post('/api/medicines/:id/fetch-price', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'Invalid medicine ID.' });
      }
      const updated = await fetchAndCacheMedicinePrice(id);
      if (!updated) {
        return res.status(404).json({ error: 'Medicine not found.' });
      }
      res.json({ medicine: updated });
    } catch (err) {
      res.status(502).json({
        error: (err as Error).message || 'Could not fetch live MedEx price.',
      });
    }
  });

  // Direct Live MedEx Bangladesh Search (works directly without Gemini API key!)
  app.post('/api/medicines/medex-lookup', async (req, res) => {
    try {
      const { query } = req.body as { query?: string };
      if (!query || !query.trim()) {
        return res.status(400).json({ error: 'Medicine query is required.' });
      }
      const result = await searchMedexDirect(query.trim());
      res.json(result);
    } catch (err) {
      console.error('[MedEx Lookup Error]', err);
      res.status(502).json({
        error: (err as Error).message || 'Live MedEx lookup failed.',
      });
    }
  });

  // Full MedEx Catalog Sync Control
  app.get('/api/medex/sync-status', (_req, res) => {
    res.json(getMedexSyncStatus());
  });

  app.post('/api/medex/sync', (req, res) => {
    const startPage = Number(req.body?.startPage) || 1;
    const endPage = req.body?.endPage ? Number(req.body.endPage) : undefined;
    // Kick off non-blocking background sync so HTTP responds immediately
    void runMedexCatalogSync({ startPage, endPage, concurrency: 14 });
    res.json(getMedexSyncStatus());
  });

  // Billing & Invoices
  app.get('/api/bills', (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 200);
      res.json({ bills: listBills(limit) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/bills/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const bill = getBillById(id);
      if (!bill) {
        return res.status(404).json({ error: 'Bill not found.' });
      }
      res.json({ bill });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/bills', (req, res) => {
    try {
      const payload = req.body;
      if (!Array.isArray(payload.items) || payload.items.length === 0) {
        return res
          .status(400)
          .json({ error: 'At least one medicine item is required to save a bill.' });
      }
      const saved = createBill(payload);
      res.status(201).json({ bill: saved });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Pharmacy Settings
  app.get('/api/settings', (_req, res) => {
    try {
      res.json({ settings: getSettings() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/settings', (req, res) => {
    try {
      const updated = updateSettings(req.body);
      res.json({ settings: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Frontend serving: Vite middleware in development, dist/ in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ShifaRx POS server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

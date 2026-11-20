import Tesseract, { type Worker } from 'tesseract.js';
import { parsePrescriptionText } from '../src/lib/rxTextParser.ts';
import { getAllBrandNames } from './db.ts';
import type { RawExtractionPayload } from './geminiService.ts';

// Keep a single warm Tesseract worker in memory so every scan skips WASM + traineddata boot (~3-5s saved per scan)
let workerPromise: Promise<Worker> | null = null;
let ocrQueue: Promise<unknown> = Promise.resolve();

function getWarmOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', 1, {
      logger: () => {},
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

// Pre-warm worker quietly on server boot so even the very first scan is instant
void getWarmOcrWorker().catch(() => {});

function runQueuedOcr(buffer: Buffer): Promise<string> {
  const task = ocrQueue.then(async () => {
    const worker = await getWarmOcrWorker();
    const { data } = await worker.recognize(buffer);
    return (data.text || '').trim();
  });
  ocrQueue = task.catch(() => {});
  return task;
}

export interface LocalOcrExtractionResult extends RawExtractionPayload {
  rawOcrText: string;
}

/**
 * Genuine Local OCR extractor powered by Tesseract.js + shared Bangladeshi Rx parser
 * with 25,703 MedEx brand lookup and 1-character OCR typo recovery.
 */
export async function extractPrescriptionWithLocalOcr(
  base64Data: string,
  mimeType: string
): Promise<LocalOcrExtractionResult> {
  if (mimeType === 'application/pdf') {
    throw new Error(
      'PDF Local OCR runs directly in your browser. Please retry scanning this PDF.'
    );
  }

  const buffer = Buffer.from(base64Data, 'base64');
  const fullText = await runQueuedOcr(buffer);
  const knownBrands = getAllBrandNames();
  const parsed = parsePrescriptionText(fullText, knownBrands, 'Local OCR');

  return {
    doctorName: parsed.doctorName,
    patientName: parsed.patientName,
    prescriptionDate: parsed.prescriptionDate,
    notes: parsed.notes,
    medicines: parsed.medicines,
    rawOcrText: fullText,
  };
}

/**
 * Client-side PDF text & image extractor powered by pdfjs-dist.
 * - For digital PDFs (e.g., Bangladeshi clinic e-prescriptions): extracts exact Unicode text
 *   (including Bengali script & digits) with two-column layout awareness in < 100ms.
 * - For scanned or hybrid image PDFs: renders pages onto canvas so Tesseract.js Local OCR can scan them.
 */

export interface ExtractedPdfResult {
  text: string;
  pageImages: string[];
  isDigitalText: boolean;
  pageCount: number;
}

interface PositionedItem {
  str: string;
  x: number;
  y: number;
}

function base64ToUint8Array(dataUrlOrBase64: string): Uint8Array {
  const base64 = dataUrlOrBase64.includes(',')
    ? dataUrlOrBase64.split(',')[1]
    : dataUrlOrBase64;
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function groupItemsIntoLines(items: PositionedItem[]): string[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(b.y - a.y) > 4.5) return b.y - a.y;
    return a.x - b.x;
  });

  const rows: PositionedItem[][] = [];
  for (const item of sorted) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow[0].y - item.y) <= 4.5) {
      lastRow.push(item);
    } else {
      rows.push([item]);
    }
  }

  return rows
    .map((row) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((r) => r.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);
}

function reconstructPageText(items: PositionedItem[], pageWidth: number): string {
  if (items.length === 0) return '';

  // Detect standard Bangladeshi two-column prescription where "Rx" starts in the right column
  const rxMarker = items.find(
    (it) => /\bRx[,.:]?$/i.test(it.str.trim()) && it.x > pageWidth * 0.22
  );

  if (rxMarker) {
    const splitX = rxMarker.x - 16;
    const rxY = rxMarker.y + 8;

    const headerItems = items.filter((it) => it.y > rxY);
    const bodyItems = items.filter((it) => it.y <= rxY);
    const rightColItems = bodyItems.filter((it) => it.x >= splitX);
    const leftColItems = bodyItems.filter((it) => it.x < splitX);

    return [
      ...groupItemsIntoLines(headerItems),
      ...groupItemsIntoLines(rightColItems),
      ...groupItemsIntoLines(leftColItems),
    ].join('\n');
  }

  return groupItemsIntoLines(items).join('\n');
}

async function openPdfDocument(dataUrlOrBase64: string) {
  const [pdfjsLib, workerMod] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
  const bytes = base64ToUint8Array(dataUrlOrBase64);
  return pdfjsLib.getDocument({ data: bytes }).promise;
}

export async function renderPdfPagesToImages(
  dataUrlOrBase64: string,
  maxPages = 2
): Promise<string[]> {
  const pdf = await openPdfDocument(dataUrlOrBase64);
  const count = Math.min(pdf.numPages, maxPages);
  const pageImages: string[] = [];

  for (let p = 1; p <= count; p++) {
    const page = await pdf.getPage(p);
    const baseViewport = page.getViewport({ scale: 1.0 });
    const targetScale = Math.min(
      2.5,
      1800 / Math.max(baseViewport.width, baseViewport.height)
    );
    const viewport = page.getViewport({ scale: Math.max(1.5, targetScale) });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      pageImages.push(canvas.toDataURL('image/png'));
    }
  }

  return pageImages;
}

export async function extractPdfContent(
  dataUrlOrBase64: string
): Promise<ExtractedPdfResult> {
  const pdf = await openPdfDocument(dataUrlOrBase64);

  const maxTextPages = Math.min(pdf.numPages, 4);
  const pageTexts: string[] = [];

  for (let p = 1; p <= maxTextPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();

    const positioned: PositionedItem[] = [];
    for (const rawItem of textContent.items) {
      if ('str' in rawItem && rawItem.str && rawItem.str.trim().length > 0) {
        const tx = rawItem.transform;
        positioned.push({
          str: rawItem.str,
          x: Number(tx?.[4] ?? 0),
          y: Number(tx?.[5] ?? 0),
        });
      }
    }

    const reconstructed = reconstructPageText(positioned, viewport.width);
    if (reconstructed) {
      pageTexts.push(reconstructed);
    }
  }

  const combinedText = pageTexts.join('\n').trim();
  if (combinedText.replace(/\s+/g, '').length >= 35) {
    return {
      text: combinedText,
      pageImages: [],
      isDigitalText: true,
      pageCount: pdf.numPages,
    };
  }

  const pageImages = await renderPdfPagesToImages(dataUrlOrBase64, 2);
  return {
    text: combinedText,
    pageImages,
    isDigitalText: false,
    pageCount: pdf.numPages,
  };
}

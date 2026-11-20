import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Crop,
  FileText,
  RotateCw,
  ScanLine,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
  Check,
  RefreshCw,
} from 'lucide-react';

export const SAMPLE_RX_PATH =
  '/src/assets/images/sample_bd_prescription_1795156824639.jpg';

interface PrescriptionViewerProps {
  fileDataUrl: string | null;
  mimeType: string | null;
  fileName: string | null;
  isExtracting: boolean;
  compactMode: boolean;
  isStaticMode?: boolean;
  onFileSelected: (dataUrl: string, mimeType: string, fileName: string) => void;
  onClearFile: () => void;
  onExtract: (dataUrl: string, mimeType: string) => void;
  onExtractLocal: (dataUrl: string, mimeType: string) => void;
}

interface CropRect {
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
}

export const PrescriptionViewer: React.FC<PrescriptionViewerProps> = ({
  fileDataUrl,
  mimeType,
  fileName,
  isExtracting,
  compactMode,
  isStaticMode = false,
  onFileSelected,
  onClearFile,
  onExtract,
  onExtractLocal,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect>({
    x: 0.08,
    y: 0.12,
    w: 0.84,
    h: 0.76,
  });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);

  const isPdf = mimeType === 'application/pdf';

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setIsCropping(false);
  }, [fileName]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onFileSelected(reader.result, file.type || 'image/jpeg', file.name);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleLoadSample = async () => {
    setLoadingSample(true);
    try {
      const res = await fetch(SAMPLE_RX_PATH);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const dataUrl = reader.result;
          onFileSelected(dataUrl, 'image/jpeg', 'sample-dhaka-prescription.jpg');
          if (isStaticMode) {
            onExtractLocal(dataUrl, 'image/jpeg');
          } else {
            onExtract(dataUrl, 'image/jpeg');
          }
        }
        setLoadingSample(false);
      };
      reader.readAsDataURL(blob);
    } catch {
      setLoadingSample(false);
    }
  };

  const buildProcessedDataUrl = async (applyCrop: boolean): Promise<string> => {
    if (!fileDataUrl || isPdf) return fileDataUrl || '';

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const MAX_DIM = 2200;
        const rad = (rotation * Math.PI) / 180;
        const swap = rotation % 180 !== 0;
        const rotW = swap ? img.naturalHeight : img.naturalWidth;
        const rotH = swap ? img.naturalWidth : img.naturalHeight;

        // Compute cropped source region in rotated coordinates
        const sx = applyCrop ? Math.max(0, Math.round(cropRect.x * rotW)) : 0;
        const sy = applyCrop ? Math.max(0, Math.round(cropRect.y * rotH)) : 0;
        const sw = applyCrop ? Math.max(40, Math.round(cropRect.w * rotW)) : rotW;
        const sh = applyCrop ? Math.max(40, Math.round(cropRect.h * rotH)) : rotH;

        // Keep up to 2200px longest side so tiny printed medicine names stay sharp for OCR
        const scale = Math.min(1, MAX_DIM / Math.max(sw, sh));
        const outW = Math.max(1, Math.round(sw * scale));
        const outH = Math.max(1, Math.round(sh * scale));

        const rotCanvas = document.createElement('canvas');
        rotCanvas.width = rotW;
        rotCanvas.height = rotH;
        const rCtx = rotCanvas.getContext('2d');
        if (!rCtx) {
          resolve(fileDataUrl);
          return;
        }
        rCtx.translate(rotW / 2, rotH / 2);
        rCtx.rotate(rad);
        rCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const oCtx = outCanvas.getContext('2d');
        if (!oCtx) {
          resolve(rotCanvas.toDataURL('image/jpeg', 0.9));
          return;
        }
        oCtx.imageSmoothingEnabled = true;
        oCtx.imageSmoothingQuality = 'high';
        oCtx.drawImage(rotCanvas, sx, sy, sw, sh, 0, 0, outW, outH);
        resolve(outCanvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => resolve(fileDataUrl);
      img.src = fileDataUrl;
    });
  };

  const handleApplyCrop = async () => {
    const cropped = await buildProcessedDataUrl(true);
    onFileSelected(cropped, 'image/jpeg', fileName || 'cropped-prescription.jpg');
    setRotation(0);
    setZoom(1);
    setIsCropping(false);
  };

  const handleRunScan = async () => {
    if (!fileDataUrl || !mimeType) return;
    if (isPdf) {
      onExtract(fileDataUrl, mimeType);
      return;
    }
    const processed = await buildProcessedDataUrl(false);
    onExtract(processed, 'image/jpeg');
  };

  const handleRunLocalOcr = async () => {
    if (!fileDataUrl || !mimeType) return;
    if (isPdf) {
      onExtractLocal(fileDataUrl, mimeType);
      return;
    }
    const processed = await buildProcessedDataUrl(false);
    onExtractLocal(processed, 'image/jpeg');
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isCropping || !imgContainerRef.current) return;
    const rect = imgContainerRef.current.getBoundingClientRect();
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setDragStart({ x: nx, y: ny });
    setCropRect({ x: nx, y: ny, w: 0.05, h: 0.05 });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isCropping || !dragStart || !imgContainerRef.current) return;
    const rect = imgContainerRef.current.getBoundingClientRect();
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setCropRect({
      x: Math.min(dragStart.x, nx),
      y: Math.min(dragStart.y, ny),
      w: Math.max(0.05, Math.abs(nx - dragStart.x)),
      h: Math.max(0.05, Math.abs(ny - dragStart.y)),
    });
  };

  const onPointerUp = () => {
    if (dragStart) setDragStart(null);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden w-full max-w-full min-w-0">
      {/* Hidden native inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,application/pdf"
        onChange={handleInputChange}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleInputChange}
        className="hidden"
      />

      {!fileDataUrl ? (
        <div className="p-6 sm:p-8 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 mb-4">
            <ScanLine className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">
            Upload or Capture Doctor&apos;s Prescription
          </h2>
          <p className="text-sm text-slate-600 max-w-md mt-1.5">
            Supports JPG, PNG, and PDF prescriptions. AI extracts medicine names,
            strengths, Bangladeshi dosage schedules (1+0+1, 1+1+1, SOS), and duration for
            staff review.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Camera className="w-4 h-4" />
              Capture with Camera
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-800 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Upload className="w-4 h-4" />
              Upload Image / PDF
            </button>

            <button
              type="button"
              onClick={handleLoadSample}
              disabled={loadingSample || isExtracting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              {loadingSample ? 'Loading Sample...' : 'Try Sample Prescription'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-medium text-slate-700 truncate max-w-[180px]">
                {fileName || 'Prescription'}
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {isPdf ? 'PDF Document' : `${Math.round(zoom * 100)}%`}
              </span>
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {!isPdf && (
                <>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.2).toFixed(2))))}
                    title="Zoom Out"
                    className="p-1.5 rounded-md text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors cursor-pointer"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(2.6, Number((z + 0.2).toFixed(2))))}
                    title="Zoom In"
                    className="p-1.5 rounded-md text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors cursor-pointer"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                    title="Rotate 90°"
                    className="p-1.5 rounded-md text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors cursor-pointer"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                  {!isCropping ? (
                    <button
                      type="button"
                      onClick={() => {
                        setZoom(1);
                        setIsCropping(true);
                      }}
                      title="Crop Image"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Crop className="w-3.5 h-3.5" />
                      Crop
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handleApplyCrop}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer whitespace-nowrap"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Apply Crop
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsCropping(false)}
                        className="px-2 py-1 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-200 cursor-pointer whitespace-nowrap"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              )}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Retake / Upload Another"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retake
              </button>

              <button
                type="button"
                onClick={onClearFile}
                title="Remove Prescription"
                className="p-1.5 rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Preview Canvas */}
          <div
            className={`relative bg-slate-100 overflow-auto flex items-center justify-center ${
              compactMode ? 'max-h-[420px]' : 'max-h-[460px]'
            } min-h-[240px] p-3`}
          >
            {isPdf ? (
              <div className="w-full h-[360px] flex flex-col items-center justify-center bg-white rounded-lg border border-slate-200 p-4">
                <object
                  data={fileDataUrl}
                  type="application/pdf"
                  className="w-full h-full rounded"
                >
                  <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <FileText className="w-10 h-10 text-emerald-700 mb-2" />
                    <p className="text-sm font-medium text-slate-800">{fileName}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      PDF ready for AI extraction. Click &quot;Extract Medicines&quot; below.
                    </p>
                  </div>
                </object>
              </div>
            ) : (
              <div
                ref={imgContainerRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className={`relative inline-block select-none ${
                  isCropping ? 'cursor-crosshair' : ''
                }`}
              >
                <img
                  src={fileDataUrl}
                  alt="Uploaded doctor prescription"
                  referrerPolicy="no-referrer"
                  draggable={false}
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    transformOrigin: 'center center',
                  }}
                  className="max-h-[380px] max-w-full w-auto object-contain rounded border border-slate-200 bg-white transition-transform duration-150"
                />
                {isCropping && (
                  <div
                    style={{
                      left: `${cropRect.x * 100}%`,
                      top: `${cropRect.y * 100}%`,
                      width: `${cropRect.w * 100}%`,
                      height: `${cropRect.h * 100}%`,
                    }}
                    className="absolute border-2 border-emerald-600 bg-emerald-500/15 pointer-events-none"
                  />
                )}
              </div>
            )}
          </div>

          {isCropping && (
            <div className="px-4 py-2 bg-emerald-50 border-t border-emerald-100 text-xs text-emerald-900">
              Drag across the prescription image to select the medicine list area, then click Apply Crop.
            </div>
          )}

          {/* Action Footer */}
          <div className="px-4 py-3 border-t border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <span className="text-xs text-slate-500">
              Original prescription remains visible for review.
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {isStaticMode ? (
                <button
                  type="button"
                  onClick={handleRunLocalOcr}
                  disabled={isExtracting || isCropping}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-xs sm:text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ScanLine className="w-4 h-4" />
                  {isExtracting ? 'Scanning Prescription...' : 'Scan Prescription (Local OCR)'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleRunLocalOcr}
                    disabled={isExtracting || isCropping}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-medium hover:bg-slate-50 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {isExtracting ? 'Scanning...' : 'Local OCR (No Key)'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRunScan}
                    disabled={isExtracting || isCropping}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs sm:text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <ScanLine className="w-4 h-4" />
                    {isExtracting ? 'Extracting...' : 'Extract with AI'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

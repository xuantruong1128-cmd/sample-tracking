import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { getDrawingFileSignedUrl } from '../../services/drawingReviewService';
import { PDFDocument } from 'pdf-lib';
import { ImageEditorModal } from '../../components/common/ImageEditorModal';
import {
  loadPdfDocument,
  renderPageFromDoc,
  renderPdfPageToImage,
  isCanvasSupported,
} from '../../lib/pdfRenderer';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Hand,
  ExternalLink,
  FileText,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Crop as CropIcon,
  Camera,
  Upload,
  X,
  Check,
  Highlighter,
  Type,
  ArrowUpRight,
  Circle,
  Square,
  Undo2,
  Eye,
  EyeOff,
  Trash2,
} from 'lucide-react';
import {
  DrawingAnnotationLayer,
  type AnnotationTool,
  type DrawingAnnotation,
  PRESET_COLORS,
  FONT_SIZE_OPTIONS,
  DEFAULT_FONT_SIZE,
} from './DrawingAnnotationLayer';
import { exportAnnotatedDrawingToBlob } from './drawingAnnotationUtils';

export interface DrawingViewerProps {
  filePath: string;
  fileName: string;
  mimeType?: string;
  canCropAvatar?: boolean;
  onAvatarCropped?: (file: File, cropBox: any) => Promise<void> | void;
  fullHeight?: boolean;
  className?: string;
  versionId?: string;
  initialAnnotations?: DrawingAnnotation[];
  onAnnotationsChange?: (annotations: DrawingAnnotation[]) => void;
  onAttachAnnotatedDrawing?: (file: File, caption: string) => Promise<void> | void;
  readOnly?: boolean;
}

export interface DrawingViewerHandle {
  triggerCrop: () => void;
  resetView: () => void;
  fitDrawing: () => void;
  getAnnotatedBlob: () => Promise<Blob | null>;
  getAnnotations: () => DrawingAnnotation[];
}

export const DrawingViewer = forwardRef<DrawingViewerHandle, DrawingViewerProps>(
  (
    {
      filePath,
      fileName = 'drawing',
      mimeType = 'application/pdf',
      canCropAvatar = false,
      onAvatarCropped,
      fullHeight = false,
      className = '',
      versionId,
      initialAnnotations,
      onAnnotationsChange,
      onAttachAnnotatedDrawing,
      readOnly = false,
    },
    ref
  ) => {
    const [signedUrl, setSignedUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Drawing Annotation & Markup state
    const [isAnnotating, setIsAnnotating] = useState<boolean>(false);
    const [activeTool, setActiveTool] = useState<AnnotationTool>('highlight');
    const [activeColor, setActiveColor] = useState<string>('#facc15');
    const [activeFontSize, setActiveFontSize] = useState<number>(DEFAULT_FONT_SIZE);
    const [annotationsVisible, setAnnotationsVisible] = useState<boolean>(true);
    const [annotations, setAnnotations] = useState<DrawingAnnotation[]>(initialAnnotations || []);
    const [isExportingSnapshot, setIsExportingSnapshot] = useState<boolean>(false);
    const [annotationToast, setAnnotationToast] = useState<string | null>(null);

    const annotationStorageKey = `drawing_ann_${versionId || filePath}`;

    // Load & sync persisted annotations: initialAnnotations from DB takes precedence, fallback to localStorage
    useEffect(() => {
      if (initialAnnotations && initialAnnotations.length > 0) {
        setAnnotations(initialAnnotations);
        try {
          localStorage.setItem(annotationStorageKey, JSON.stringify(initialAnnotations));
        } catch {}
      } else {
        try {
          const saved = localStorage.getItem(annotationStorageKey);
          if (saved) {
            setAnnotations(JSON.parse(saved));
          } else {
            setAnnotations([]);
          }
        } catch {
          setAnnotations([]);
        }
      }
    }, [annotationStorageKey, initialAnnotations]);

    // Save helper to localStorage & notify parent
    const persistAnnotations = useCallback(
      (newAnns: DrawingAnnotation[]) => {
        setAnnotations(newAnns);
        try {
          localStorage.setItem(annotationStorageKey, JSON.stringify(newAnns));
        } catch {}
        onAnnotationsChange?.(newAnns);
      },
      [annotationStorageKey, onAnnotationsChange]
    );

    const handleAddAnnotation = (ann: DrawingAnnotation) => {
      const next = [...annotations, ann];
      persistAnnotations(next);
    };

    const handleDeleteAnnotation = (id: string) => {
      const next = annotations.filter((a) => a.id !== id);
      persistAnnotations(next);
    };

    const handleUndoAnnotation = () => {
      const pageAnns = annotations.filter((a) => a.page === currentPdfPage);
      if (pageAnns.length === 0) return;
      const lastId = pageAnns[pageAnns.length - 1].id;
      const next = annotations.filter((a) => a.id !== lastId);
      persistAnnotations(next);
    };

    const handleClearAnnotations = () => {
      if (window.confirm('Bạn có chắc muốn xóa tất cả ghi chú trên trang bản vẽ này?')) {
        const next = annotations.filter((a) => a.page !== currentPdfPage);
        persistAnnotations(next);
      }
    };

    // File type detection
    const safeFileName = fileName || 'drawing';
    const lowerName = safeFileName.toLowerCase();
    const isTiff =
      ['tif', 'tiff'].some((ext) => lowerName.endsWith(ext)) ||
      Boolean(mimeType?.includes('tiff'));
    const isImage =
      isTiff ||
      mimeType?.startsWith('image/') ||
      ['jpg', 'jpeg', 'png', 'webp', 'svg', 'bmp', 'gif'].some((ext) =>
        lowerName.endsWith(ext)
      );

    // Zoom & Pan navigation state (Engineering CAD-style)
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDraggingPan, setIsDraggingPan] = useState(false);
    const [panToolActive, setPanToolActive] = useState(false);
    const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

    // Synchronous refs for smooth 60fps pan and zoom calculations
    const scaleRef = useRef(1);
    const positionRef = useRef({ x: 0, y: 0 });
    const isPanningRef = useRef(false);
    const startMouseRef = useRef({ x: 0, y: 0 });
    const startPanRef = useRef({ x: 0, y: 0 });
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const touchDistanceRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Keep refs in sync with state
    useEffect(() => {
      scaleRef.current = zoom;
    }, [zoom]);

    useEffect(() => {
      positionRef.current = pan;
    }, [pan]);

    // PDF rendered state
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [pdfRenderedImageUrl, setPdfRenderedImageUrl] = useState<string | null>(null);
    const [pdfPageCount, setPdfPageCount] = useState<number>(1);
    const [currentPdfPage, setCurrentPdfPage] = useState<number>(1);

    // Avatar Cropping & Editor state
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editorFile, setEditorFile] = useState<File | null>(null);
    const [showPdfAvatarPicker, setShowPdfAvatarPicker] = useState(false);
    const [isPreparingCrop, setIsPreparingCrop] = useState(false);
    const [cropSuccessToast, setCropSuccessToast] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    // Load signed URL
    useEffect(() => {
      let active = true;
      async function loadUrl() {
        if (!filePath) {
          setError('Không có đường dẫn tệp bản vẽ.');
          setLoading(false);
          return;
        }
        setLoading(true);
        setError(null);
        setPdfRenderedImageUrl(null);
        setPdfDoc(null);

        const res = await getDrawingFileSignedUrl(filePath, 600); // 10 minutes
        if (!active) return;
        if (res.error || !res.signedUrl) {
          setError(res.error || 'Không thể tạo liên kết tải bản vẽ.');
          setLoading(false);
          return;
        }

        setSignedUrl(res.signedUrl);

        // If PDF, load PDF document and attempt canvas rendering
        if (!isImage) {
          try {
            // First inspect page count via pdf-lib for instant fallback support
            const resp = await fetch(res.signedUrl);
            const arrayBuf = await resp.arrayBuffer();
            try {
              const pdfLibDoc = await PDFDocument.load(arrayBuf, { ignoreEncryption: true });
              const pages = pdfLibDoc.getPageCount();
              if (active && pages > 0) {
                setPdfPageCount(pages);
                setCurrentPdfPage(1);
              }
            } catch {
              if (active) setPdfPageCount(1);
            }

            // Next attempt high-fidelity canvas rendering via PDF.js
            try {
              const loadedDoc = await loadPdfDocument(arrayBuf);
              if (active && loadedDoc) {
                setPdfDoc(loadedDoc);
                const pages = loadedDoc.numPages || 1;
                setPdfPageCount(pages);

                const rendered = await renderPageFromDoc(loadedDoc, 1, 2.0, safeFileName);
                if (active && rendered.dataUrl) {
                  setPdfRenderedImageUrl(rendered.dataUrl);
                  setNaturalSize({ width: rendered.width, height: rendered.height });
                }
              }
            } catch (renderErr) {
              console.warn('PDF.js canvas rendering fallback to iframe:', renderErr);
            }
          } catch (fetchErr: any) {
            console.warn('Could not pre-fetch PDF:', fetchErr);
          }
        }

        setLoading(false);
      }
      loadUrl();
      return () => {
        active = false;
      };
    }, [filePath, isImage, safeFileName]);

    // Re-render PDF page when currentPdfPage changes
    useEffect(() => {
      let active = true;
      if (!isImage && pdfDoc && currentPdfPage) {
        async function renderPage() {
          try {
            const rendered = await renderPageFromDoc(pdfDoc, currentPdfPage, 2.0, safeFileName);
            if (active && rendered.dataUrl) {
              setPdfRenderedImageUrl(rendered.dataUrl);
              setNaturalSize({ width: rendered.width, height: rendered.height });
            }
          } catch (err) {
            console.warn('Error rendering PDF page:', err);
          }
        }
        renderPage();
      }
      return () => {
        active = false;
      };
    }, [currentPdfPage, pdfDoc, isImage, safeFileName]);

    // Image load handler to capture natural dimensions
    const handleImageLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    };

    // Export annotated drawing snapshot to blob & attach to Review Version
    const handleExportAndAttach = async () => {
      if (!onAttachAnnotatedDrawing) return;
      const src = activeDisplayImage || signedUrl;
      if (!src) return;

      setIsExportingSnapshot(true);
      try {
        const effectiveW = naturalSize?.width || 1200;
        const effectiveH = naturalSize?.height || 800;
        const blob = await exportAnnotatedDrawingToBlob(
          src,
          annotations,
          effectiveW,
          effectiveH,
          currentPdfPage
        );
        if (blob) {
          const file = new File(
            [blob],
            `Ban-ve-ghi-chu-trang-${currentPdfPage}-${Date.now()}.png`,
            { type: 'image/png' }
          );
          await onAttachAnnotatedDrawing(
            file,
            `Bản vẽ có ghi chú kỹ thuật (Trang ${currentPdfPage})`
          );
          setAnnotationToast('Đã đính kèm ảnh bản vẽ kèm ghi chú vào mục 7 thành công!');
          setTimeout(() => setAnnotationToast(null), 3500);
        }
      } catch (err: any) {
        console.warn('Lỗi khi xuất ảnh bản vẽ có ghi chú:', err);
      } finally {
        setIsExportingSnapshot(false);
      }
    };

    // Zoom In centered at container center
    const handleZoomIn = () => {
      const container = containerRef.current;
      const currentScale = scaleRef.current;
      const currentPos = positionRef.current;
      const nextScale = Math.min(parseFloat((currentScale + 0.25).toFixed(2)), 6.0);

      let nextX = currentPos.x;
      let nextY = currentPos.y;
      if (container) {
        const rect = container.getBoundingClientRect();
        const midX = rect.width / 2;
        const midY = rect.height / 2;
        const pointX = (midX - currentPos.x) / currentScale;
        const pointY = (midY - currentPos.y) / currentScale;
        nextX = midX - pointX * nextScale;
        nextY = midY - pointY * nextScale;
      }

      scaleRef.current = nextScale;
      positionRef.current = { x: nextX, y: nextY };
      setZoom(nextScale);
      setPan({ x: nextX, y: nextY });
    };

    // Zoom Out centered at container center
    const handleZoomOut = () => {
      const container = containerRef.current;
      const currentScale = scaleRef.current;
      const currentPos = positionRef.current;
      const nextScale = Math.max(parseFloat((currentScale - 0.25).toFixed(2)), 0.2);

      let nextX = currentPos.x;
      let nextY = currentPos.y;
      if (container) {
        const rect = container.getBoundingClientRect();
        const midX = rect.width / 2;
        const midY = rect.height / 2;
        const pointX = (midX - currentPos.x) / currentScale;
        const pointY = (midY - currentPos.y) / currentScale;
        nextX = midX - pointX * nextScale;
        nextY = midY - pointY * nextScale;
      }

      scaleRef.current = nextScale;
      positionRef.current = { x: nextX, y: nextY };
      setZoom(nextScale);
      setPan({ x: nextX, y: nextY });
    };

    const handleZoomReset = () => {
      scaleRef.current = 1;
      positionRef.current = { x: 0, y: 0 };
      setZoom(1);
      setPan({ x: 0, y: 0 });
    };

    // Fit Drawing to Container
    const handleFitDrawing = useCallback(() => {
      const container = containerRef.current;
      if (!container) {
        handleZoomReset();
        return;
      }
      const rect = container.getBoundingClientRect();
      const cWidth = rect.width - 32;
      const cHeight = rect.height - 32;

      if (naturalSize && naturalSize.width > 0 && naturalSize.height > 0) {
        const scaleX = cWidth / naturalSize.width;
        const scaleY = cHeight / naturalSize.height;
        const fitZoom = Math.min(scaleX, scaleY, 1.0);
        const finalZoom = Math.max(parseFloat(fitZoom.toFixed(2)), 0.2);
        const renderedW = naturalSize.width * finalZoom;
        const renderedH = naturalSize.height * finalZoom;
        const centeredX = Math.max(0, (rect.width - renderedW) / 2);
        const centeredY = Math.max(0, (rect.height - renderedH) / 2);

        scaleRef.current = finalZoom;
        positionRef.current = { x: centeredX, y: centeredY };
        setZoom(finalZoom);
        setPan({ x: centeredX, y: centeredY });
      } else {
        handleZoomReset();
      }
    }, [naturalSize]);

    // Core Cursor-Centered Mouse Wheel Zoom Logic
    const handleWheelZoom = useCallback((e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const currentScale = scaleRef.current;
      const currentPos = positionRef.current;

      // Wheel up (e.deltaY < 0): zoom in (1.15x); Wheel down (e.deltaY > 0): zoom out (0.87x)
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const nextScale = Math.min(
        Math.max(parseFloat((currentScale * zoomFactor).toFixed(3)), 0.2),
        6.0
      );

      if (nextScale === currentScale) return;

      // Keep point under cursor stationary
      const pointX = (cursorX - currentPos.x) / currentScale;
      const pointY = (cursorY - currentPos.y) / currentScale;

      const nextX = cursorX - pointX * nextScale;
      const nextY = cursorY - pointY * nextScale;

      scaleRef.current = nextScale;
      positionRef.current = { x: nextX, y: nextY };

      setZoom(nextScale);
      setPan({ x: nextX, y: nextY });
    }, []);

    // Attach non-passive wheel event listener to container
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const onWheel = (e: WheelEvent) => {
        handleWheelZoom(e);
      };

      const onAux = (e: MouseEvent) => {
        if (e.button === 1) {
          e.preventDefault();
        }
      };

      container.addEventListener('wheel', onWheel, { passive: false });
      container.addEventListener('auxclick', onAux);

      return () => {
        container.removeEventListener('wheel', onWheel);
        container.removeEventListener('auxclick', onAux);
      };
    }, [handleWheelZoom, loading, signedUrl]);

    // Direct Left Mouse (button 0) and Middle Mouse (button 1) Drag Pan
    const handleMouseDown = (e: React.MouseEvent) => {
      // Button 0 (left-click) or Button 1 (middle-click)
      if (e.button === 0 || e.button === 1) {
        e.preventDefault();
        e.stopPropagation();

        isPanningRef.current = true;
        setIsDraggingPan(true);
        startMouseRef.current = { x: e.clientX, y: e.clientY };
        startPanRef.current = { ...positionRef.current };
      }
    };

    // Global mousemove and mouseup listeners during dragging
    useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        if (!isPanningRef.current) return;
        e.preventDefault();

        const dx = e.clientX - startMouseRef.current.x;
        const dy = e.clientY - startMouseRef.current.y;

        const nextX = startPanRef.current.x + dx;
        const nextY = startPanRef.current.y + dy;

        positionRef.current = { x: nextX, y: nextY };
        setPan({ x: nextX, y: nextY });
      };

      const handleMouseUp = () => {
        if (isPanningRef.current) {
          isPanningRef.current = false;
          setIsDraggingPan(false);
        }
      };

      window.addEventListener('mousemove', handleMouseMove, { passive: false });
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }, []);

    // Touch events for mobile single-finger pan and two-finger pinch-to-zoom
    const handleTouchStart = (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        startPanRef.current = { ...positionRef.current };
        setIsDraggingPan(true);
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchDistanceRef.current = Math.hypot(dx, dy);
      }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (e.touches.length === 1 && touchStartRef.current) {
        const dx = e.touches[0].clientX - touchStartRef.current.x;
        const dy = e.touches[0].clientY - touchStartRef.current.y;
        const nextX = startPanRef.current.x + dx;
        const nextY = startPanRef.current.y + dy;
        positionRef.current = { x: nextX, y: nextY };
        setPan({ x: nextX, y: nextY });
      } else if (e.touches.length === 2 && touchDistanceRef.current) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const factor = dist / touchDistanceRef.current;
        const nextZoom = Math.min(Math.max(parseFloat((scaleRef.current * factor).toFixed(2)), 0.2), 6.0);
        scaleRef.current = nextZoom;
        setZoom(nextZoom);
        touchDistanceRef.current = dist;
      }
    };

    const handleTouchEnd = () => {
      touchStartRef.current = null;
      touchDistanceRef.current = null;
      setIsDraggingPan(false);
    };

    // Multipage navigation
    const handlePrevPage = () => setCurrentPdfPage((p) => Math.max(1, p - 1));
    const handleNextPage = () => setCurrentPdfPage((p) => Math.min(pdfPageCount, p + 1));

    // Avatar cropping handler - Directly crops the drawing without forcing upload/camera
    const handleStartAvatarCrop = async () => {
      if (!isImage && !isCanvasSupported()) {
        setShowPdfAvatarPicker(true);
        return;
      }

      setIsPreparingCrop(true);
      try {
        let targetFile: File | null = null;

        if (isImage && signedUrl) {
          const resp = await fetch(signedUrl);
          const blob = await resp.blob();
          targetFile = new File([blob], safeFileName, { type: blob.type || 'image/jpeg' });
        } else if (pdfRenderedImageUrl) {
          const resp = await fetch(pdfRenderedImageUrl);
          const blob = await resp.blob();
          targetFile = new File(
            [blob],
            `${safeFileName.replace(/\.[^/.]+$/, '')}_p${currentPdfPage}.png`,
            { type: 'image/png' }
          );
        } else if (!isImage && signedUrl) {
          try {
            const rendered = await renderPdfPageToImage(
              signedUrl,
              currentPdfPage,
              2.0,
              safeFileName
            );
            targetFile = rendered.file;
          } catch (renderErr) {
            console.warn('Direct PDF rasterization failed, falling back to picker:', renderErr);
            setShowPdfAvatarPicker(true);
            return;
          }
        }

        if (targetFile) {
          setEditorFile(targetFile);
          setIsEditorOpen(true);
        } else {
          setShowPdfAvatarPicker(true);
        }
      } catch (err: any) {
        alert('Không thể chuẩn bị ảnh bản vẽ để cắt: ' + (err.message || 'Lỗi mạng'));
      } finally {
        setIsPreparingCrop(false);
      }
    };

    // Expose handles to parent via ref
    useImperativeHandle(ref, () => ({
      triggerCrop: handleStartAvatarCrop,
      resetView: handleZoomReset,
      fitDrawing: handleFitDrawing,
      getAnnotatedBlob: async () => {
        const src = activeDisplayImage || signedUrl;
        if (!src) return null;
        const effectiveW = naturalSize?.width || 1200;
        const effectiveH = naturalSize?.height || 800;
        return await exportAnnotatedDrawingToBlob(
          src,
          annotations,
          effectiveW,
          effectiveH,
          currentPdfPage
        );
      },
      getAnnotations: () => annotations,
    }));

    const handleCustomFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setShowPdfAvatarPicker(false);
        setEditorFile(file);
        setIsEditorOpen(true);
      }
    };

    const handleCropConfirm = async (processedFile: File, stats: any) => {
      if (onAvatarCropped) {
        await onAvatarCropped(processedFile, {
          width: stats.processedWidth,
          height: stats.processedHeight,
        });
        setCropSuccessToast(true);
        setTimeout(() => setCropSuccessToast(false), 4000);
      }
      setIsEditorOpen(false);
      setEditorFile(null);
    };

    const activeDisplayImage = isImage ? signedUrl : pdfRenderedImageUrl;

    return (
      <div
        className={`border border-slate-700/60 rounded-xl overflow-hidden bg-slate-900 text-white shadow-xs flex flex-col ${
          fullHeight ? 'h-full' : ''
        } ${className}`}
        data-testid="drawing-viewer-root"
      >
        {/* Top Toolbar */}
        <div className="flex flex-wrap items-center justify-between px-3.5 py-2 bg-slate-800 border-b border-slate-700 text-xs gap-2 flex-shrink-0 z-30">
          <div className="flex items-center gap-2 truncate pr-2">
            <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <span
              className="font-semibold text-white truncate max-w-[160px] sm:max-w-xs"
              title={safeFileName}
            >
              {safeFileName}
            </span>
            <span className="text-[10px] text-slate-300 font-bold uppercase bg-slate-700 px-1.5 py-0.5 rounded tracking-wider">
              {isTiff ? 'TIFF' : isImage ? 'HÌNH ẢNH' : 'PDF'}
            </span>
          </div>

          {/* Toolbar Controls */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Multipage PDF Controls */}
            {!isImage && pdfPageCount > 1 && (
              <div className="flex items-center gap-1 bg-slate-700 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={handlePrevPage}
                  disabled={currentPdfPage <= 1}
                  title="Trang trước"
                  className="p-1 hover:bg-slate-600 rounded disabled:opacity-30 transition cursor-pointer"
                  data-testid="pdf-prev-page-btn"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] font-mono px-1.5 font-semibold text-slate-200">
                  Trang {currentPdfPage} / {pdfPageCount}
                </span>
                <button
                  type="button"
                  onClick={handleNextPage}
                  disabled={currentPdfPage >= pdfPageCount}
                  title="Trang sau"
                  className="p-1 hover:bg-slate-600 rounded disabled:opacity-30 transition cursor-pointer"
                  data-testid="pdf-next-page-btn"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Zoom and CAD View Controls */}
            <div className="flex items-center gap-0.5 bg-slate-700 rounded-lg p-0.5">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoom <= 0.2}
                title="Thu nhỏ"
                className="p-1 hover:bg-slate-600 rounded disabled:opacity-30 transition cursor-pointer"
                data-testid="zoom-out-btn"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span
                className="text-[11px] font-mono px-1.5 font-bold w-12 text-center text-slate-200"
                data-testid="zoom-percentage-label"
              >
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoom >= 6}
                title="Phóng to"
                className="p-1 hover:bg-slate-600 rounded disabled:opacity-30 transition cursor-pointer"
                data-testid="zoom-in-btn"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              {/* Fit Drawing Button */}
              <button
                type="button"
                onClick={handleFitDrawing}
                title="Tự vừa khung"
                className="p-1 hover:bg-slate-600 rounded text-slate-300 hover:text-white transition cursor-pointer"
                data-testid="fit-drawing-btn"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>

              {/* Reset View Button */}
              <button
                type="button"
                onClick={handleZoomReset}
                title="Tỷ lệ 100%"
                className="p-1 hover:bg-slate-600 rounded text-slate-300 hover:text-white transition cursor-pointer"
                data-testid="reset-view-btn"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              {/* Pan Mode Indicator / Toggle Button */}
              <button
                type="button"
                onClick={() => setPanToolActive((active) => !active)}
                title={
                  panToolActive
                    ? 'Chế độ kéo Pan đang BẬT (kéo chuột trái để di chuyển)'
                    : 'Bật chế độ kéo Pan chuột trái'
                }
                className={`p-1 rounded transition cursor-pointer ${
                  panToolActive
                    ? 'bg-blue-600 text-white font-bold'
                    : 'hover:bg-slate-600 text-slate-300'
                }`}
                data-testid="pan-mode-toggle-btn"
              >
                <Hand className="w-3.5 h-3.5" />
              </button>

              {/* Annotation / Comment Mode Toggle Button */}
              {readOnly ? (
                annotations.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAnnotationsVisible((v) => !v)}
                    className={`p-1 px-2 rounded transition cursor-pointer flex items-center gap-1.5 ${
                      annotationsVisible
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title={annotationsVisible ? 'Ẩn ghi chú trên bản vẽ' : 'Hiện ghi chú trên bản vẽ'}
                    data-testid="toggle-annotations-visibility-btn"
                  >
                    {annotationsVisible ? (
                      <Eye className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                    <span className="text-[10px]">Ghi chú ({annotations.length})</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsAnnotating((prev) => !prev);
                    if (!isAnnotating) {
                      setPanToolActive(false);
                      setActiveTool('highlight');
                    }
                  }}
                  title={
                    isAnnotating
                      ? 'Tắt chế độ ghi chú bản vẽ'
                      : 'Bật công cụ ghi chú bản vẽ (Highlight, viết chữ, mũi tên, khoanh tròn, tô màu)'
                  }
                  className={`p-1 rounded transition cursor-pointer flex items-center gap-1 ${
                    isAnnotating
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                      : 'hover:bg-slate-600 text-slate-300'
                  }`}
                  data-testid="toggle-annotation-mode-btn"
                >
                  <Highlighter className="w-3.5 h-3.5" />
                  <span className="text-[10px] hidden md:inline">
                    Ghi chú{annotations.length > 0 ? ` (${annotations.length})` : ''}
                  </span>
                </button>
              )}
            </div>

            {/* Avatar Cropping Action Button */}
            {canCropAvatar && onAvatarCropped && (
              <button
                type="button"
                onClick={handleStartAvatarCrop}
                disabled={loading || isPreparingCrop}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition shadow-xs disabled:opacity-50 cursor-pointer"
                title="Cắt ảnh đại diện chi tiết từ bản vẽ kỹ thuật"
                data-testid="crop-avatar-btn"
              >
                {isPreparingCrop ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CropIcon className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">Cắt ảnh đại diện</span>
              </button>
            )}

            {/* Open Original File */}
            {signedUrl && (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition"
                data-testid="open-original-drawing-link"
              >
                <span>Mở tệp gốc</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* Annotation & Markup Sub-Toolbar */}
        {isAnnotating && !readOnly && (
          <div
            className="px-3 py-1.5 bg-slate-900 border-b border-slate-700/80 flex flex-wrap items-center justify-between gap-2 text-xs text-white z-30 select-none animate-in fade-in duration-100"
            data-testid="drawing-annotation-toolbar"
          >
            {/* Tool buttons */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-400 font-semibold mr-1">Công cụ:</span>
              <button
                type="button"
                onClick={() => setActiveTool('highlight')}
                className={`px-2 py-1 rounded flex items-center gap-1 transition cursor-pointer ${
                  activeTool === 'highlight'
                    ? 'bg-yellow-500 text-slate-950 font-bold shadow-xs'
                    : 'hover:bg-slate-700 text-slate-300'
                }`}
                title="Tô màu dạ quang (Highlight)"
                data-testid="tool-highlight-btn"
              >
                <Highlighter className="w-3.5 h-3.5" />
                <span className="text-[11px]">Highlight</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTool('text')}
                className={`px-2 py-1 rounded flex items-center gap-1 transition cursor-pointer ${
                  activeTool === 'text'
                    ? 'bg-blue-600 text-white font-bold shadow-xs'
                    : 'hover:bg-slate-700 text-slate-300'
                }`}
                title="Viết chữ ghi chú (Text)"
                data-testid="tool-text-btn"
              >
                <Type className="w-3.5 h-3.5" />
                <span className="text-[11px]">Viết chữ</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTool('arrow')}
                className={`px-2 py-1 rounded flex items-center gap-1 transition cursor-pointer ${
                  activeTool === 'arrow'
                    ? 'bg-blue-600 text-white font-bold shadow-xs'
                    : 'hover:bg-slate-700 text-slate-300'
                }`}
                title="Vẽ mũi tên (Arrow)"
                data-testid="tool-arrow-btn"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span className="text-[11px]">Mũi tên</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTool('circle')}
                className={`px-2 py-1 rounded flex items-center gap-1 transition cursor-pointer ${
                  activeTool === 'circle'
                    ? 'bg-blue-600 text-white font-bold shadow-xs'
                    : 'hover:bg-slate-700 text-slate-300'
                }`}
                title="Khoanh tròn (Circle/Ellipse)"
                data-testid="tool-circle-btn"
              >
                <Circle className="w-3.5 h-3.5" />
                <span className="text-[11px]">Khoanh tròn</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTool('rectangle')}
                className={`px-2 py-1 rounded flex items-center gap-1 transition cursor-pointer ${
                  activeTool === 'rectangle'
                    ? 'bg-blue-600 text-white font-bold shadow-xs'
                    : 'hover:bg-slate-700 text-slate-300'
                }`}
                title="Khung chữ nhật (Box)"
                data-testid="tool-rectangle-btn"
              >
                <Square className="w-3.5 h-3.5" />
                <span className="text-[11px]">Khung</span>
              </button>
            </div>

            {/* Font size control (visible when text tool is active) */}
            {activeTool === 'text' && (
              <div
                className="flex items-center gap-1.5 border-l border-slate-700 pl-2 animate-in fade-in duration-100"
                data-testid="font-size-control-group"
              >
                <span className="text-[10px] text-slate-400 font-semibold">Cỡ chữ:</span>
                <select
                  value={activeFontSize}
                  onChange={(e) => setActiveFontSize(Number(e.target.value))}
                  className="bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 cursor-pointer"
                  data-testid="font-size-select"
                >
                  {FONT_SIZE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Color palette */}
            <div className="flex items-center gap-1.5 border-l border-slate-700 pl-2">
              <span className="text-[10px] text-slate-400 font-semibold mr-0.5">Màu:</span>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setActiveColor(c.hex)}
                  className={`w-4.5 h-4.5 rounded-full border-2 transition cursor-pointer ${
                    activeColor === c.hex
                      ? 'border-white scale-110 shadow-xs'
                      : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.name}
                  data-testid={`color-choice-${c.hex}`}
                />
              ))}
            </div>

            {/* Actions: Undo, Visibility, Clear, Attach */}
            <div className="flex items-center gap-1 border-l border-slate-700 pl-2">
              <button
                type="button"
                onClick={handleUndoAnnotation}
                disabled={annotations.filter((a) => a.page === currentPdfPage).length === 0}
                className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded disabled:opacity-30 transition cursor-pointer"
                title="Hoàn tác nét vẽ cuối (Undo)"
                data-testid="undo-annotation-btn"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setAnnotationsVisible((v) => !v)}
                className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition cursor-pointer"
                title={annotationsVisible ? 'Ẩn tất cả ghi chú' : 'Hiện lại ghi chú'}
                data-testid="toggle-visibility-annotation-btn"
              >
                {annotationsVisible ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                )}
              </button>

              <button
                type="button"
                onClick={handleClearAnnotations}
                disabled={annotations.filter((a) => a.page === currentPdfPage).length === 0}
                className="p-1 hover:bg-red-900/40 text-slate-300 hover:text-red-400 rounded disabled:opacity-30 transition cursor-pointer"
                title="Xóa tất cả ghi chú trang này"
                data-testid="clear-annotations-btn"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              {onAttachAnnotatedDrawing && (
                <button
                  type="button"
                  onClick={handleExportAndAttach}
                  disabled={isExportingSnapshot}
                  className="ml-1 inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-semibold transition cursor-pointer disabled:opacity-50"
                  title="Chụp ảnh bản vẽ kèm ghi chú & chèn vào hình ảnh đính kèm (Section 7)"
                  data-testid="attach-annotated-snapshot-btn"
                >
                  {isExportingSnapshot ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                  <span>Đính kèm vào báo cáo</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Annotation Saved / Success Toast */}
        {annotationToast && (
          <div className="bg-emerald-600 text-white px-4 py-1.5 text-xs flex items-center justify-between font-semibold flex-shrink-0 animate-in fade-in duration-150 z-30">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>{annotationToast}</span>
            </div>
            <button
              type="button"
              onClick={() => setAnnotationToast(null)}
              className="hover:text-emerald-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Crop Success Toast */}
        {cropSuccessToast && (
          <div className="bg-emerald-600 text-white px-4 py-1.5 text-xs flex items-center justify-between font-semibold flex-shrink-0 animate-in fade-in duration-150 z-30">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>Đã cập nhật ảnh đại diện linh kiện (Item Avatar) thành công!</span>
            </div>
            <button
              type="button"
              onClick={() => setCropSuccessToast(false)}
              className="hover:text-emerald-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Preview Container with Viewport Controls */}
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={`relative flex-1 min-h-[380px] bg-slate-950 overflow-hidden flex items-center justify-center select-none ${
            isDraggingPan
              ? 'cursor-grabbing'
              : 'cursor-grab'
          } ${fullHeight ? 'h-full' : 'max-h-[680px]'}`}
          data-testid="drawing-canvas-viewport"
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2 z-10">
              <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
              <span className="text-xs">Đang tải bản vẽ kỹ thuật...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4 max-w-md z-10">
              <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
              <p className="text-xs text-rose-300 font-semibold mb-1">
                Không thể hiển thị bản vẽ
              </p>
              <p className="text-[11px] text-slate-400 mb-3">{error}</p>
              {signedUrl && (
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold border border-slate-600 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Thử mở trực tiếp trong tab mới</span>
                </a>
              )}
            </div>
          ) : (
            <>
              {/* Transformed Drawing Container (Visual Layer 10) */}
              <div
                className="absolute top-0 left-0 will-change-transform z-10"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: '0 0',
                  transition: isDraggingPan ? 'none' : 'transform 75ms ease-out',
                }}
                data-testid={activeDisplayImage ? "drawing-image-transform-container" : "drawing-pdf-container"}
              >
                {activeDisplayImage ? (
                  /* Rendered Image (JPG/PNG or High-Res Rasterized PDF Page) */
                  <img
                    src={activeDisplayImage}
                    alt={fileName}
                    onLoad={handleImageLoaded}
                    draggable={false}
                    className="max-w-none rounded shadow-2xl border border-slate-800/80 pointer-events-none select-none"
                    data-testid="drawing-image-element"
                  />
                ) : signedUrl ? (
                  /* PDF Fallback Container (Protected from intercepting mouse events) */
                  <div className="relative w-[1100px] h-[800px] bg-white rounded shadow-2xl overflow-hidden pointer-events-none select-none">
                    <iframe
                      key={`pdf-page-${currentPdfPage}`}
                      src={`${signedUrl}#page=${currentPdfPage}&toolbar=0&navpanes=0`}
                      title={fileName}
                      className="w-full h-full border-0 pointer-events-none select-none bg-slate-900"
                      data-testid="drawing-pdf-iframe"
                    />
                  </div>
                ) : null}

                {/* Drawing Annotation Layer (Mounted inside transformed container for seamless CAD zoom/pan) */}
                <DrawingAnnotationLayer
                  naturalWidth={naturalSize?.width || 1100}
                  naturalHeight={naturalSize?.height || 800}
                  annotations={annotations}
                  currentPage={currentPdfPage}
                  activeTool={readOnly ? 'none' : activeTool}
                  activeColor={activeColor}
                  activeFontSize={activeFontSize}
                  onChangeFontSize={setActiveFontSize}
                  isAnnotating={isAnnotating && !readOnly}
                  visible={annotationsVisible}
                  onAddAnnotation={handleAddAnnotation}
                  onDeleteAnnotation={handleDeleteAnnotation}
                />
              </div>

              {/* Interaction Overlay (Layer 20) — intercepts all Left Drag & Mouse Wheel events */}
              <div
                onMouseDown={handleMouseDown}
                onDoubleClick={handleFitDrawing}
                className={`absolute inset-0 z-20 select-none ${
                  isDraggingPan ? 'cursor-grabbing' : 'cursor-grab'
                } ${isAnnotating && activeTool !== 'none' ? 'pointer-events-none' : 'pointer-events-auto'}`}
                data-testid="drawing-interaction-overlay"
                title="Kéo chuột trái để di chuyển • Cuộn chuột để phóng to/thu nhỏ • Nhấp đúp để tự vừa khung"
              />
            </>
          )}
        </div>

        {/* Engineering Navigation Quick Hint Footer */}
        <div className="px-3 py-1 bg-slate-800/90 border-t border-slate-700 text-[10px] text-slate-400 flex items-center justify-between flex-shrink-0 select-none z-30">
          <div className="flex items-center gap-2">
            <span>
              Cuộn chuột giữa: <strong>Phóng to / Thu nhỏ</strong>
            </span>
            <span>•</span>
            <span>
              Kéo chuột trái: <strong>Di chuyển bản vẽ (Pan)</strong>
            </span>
            <span>•</span>
            <span>
              Nhấp đúp chuột: <strong>Tự vừa khung</strong>
            </span>
          </div>
          <div className="hidden sm:block text-slate-400 font-mono">
            Vị trí: ({Math.round(pan.x)}, {Math.round(pan.y)})
          </div>
        </div>

        {/* Optional fallback PDF Avatar Picker Modal (if direct canvas rendering fails) */}
        {showPdfAvatarPicker && (
          <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white text-slate-900 rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                <div className="flex items-center gap-2">
                  <CropIcon className="w-5 h-5 text-amber-600" />
                  <h3 className="font-bold text-sm">Chọn ảnh để cắt Avatar từ bản vẽ PDF</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPdfAvatarPicker(false)}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                Bạn có thể tải ảnh chụp bản vẽ hoặc chụp trực tiếp chi tiết linh kiện để đưa vào công cụ cắt avatar:
              </p>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition text-left group cursor-pointer"
                  data-testid="upload-avatar-source-btn"
                >
                  <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-600 group-hover:text-white transition">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-xs text-slate-800">Tải ảnh chụp màn hình / ảnh bản vẽ</div>
                    <div className="text-[11px] text-slate-500">Hỗ trợ JPG, PNG, WEBP từ máy tính</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 transition text-left group cursor-pointer"
                  data-testid="camera-avatar-source-btn"
                >
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition">
                    <Camera className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-xs text-slate-800">Chụp ảnh từ camera điện thoại</div>
                    <div className="text-[11px] text-slate-500">Chụp nhanh bản vẽ giấy hoặc mẫu sản phẩm</div>
                  </div>
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleCustomFileSelected}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleCustomFileSelected}
              />

              <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowPdfAvatarPicker(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Image Editor Modal for precision cropping */}
        {isEditorOpen && editorFile && (
          <ImageEditorModal
            isOpen={isEditorOpen}
            file={editorFile}
            category="drawing"
            onClose={() => {
              setIsEditorOpen(false);
              setEditorFile(null);
            }}
            onConfirm={handleCropConfirm}
          />
        )}
      </div>
    );
  }
);

DrawingViewer.displayName = 'DrawingViewer';

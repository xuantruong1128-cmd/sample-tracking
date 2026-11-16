import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Check,
  RotateCw,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Crop as CropIcon,
  Loader2,
  AlertCircle,
  Hand,
  Maximize2,
  Square,
  RectangleHorizontal,
  RectangleVertical,
} from 'lucide-react';
import {
  type ImageCategory,
  type NormalizedCrop,
  type ProcessImageResult,
  DEFAULT_CATEGORY_CONFIGS,
  formatFileSize,
  calculateScaledDimensions,
  processImageClient,
} from '../../lib/imageProcessing';

export interface ImageEditorModalProps {
  isOpen: boolean;
  file: File | null;
  category?: ImageCategory;
  onClose: () => void;
  onConfirm: (processedFile: File, stats: ProcessImageResult) => Promise<void> | void;
  allowOriginalOption?: boolean;
  defaultKeepOriginal?: boolean;
}

type DragMode =
  | 'move'
  | 'nw'
  | 'ne'
  | 'se'
  | 'sw'
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | null;

export const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
  isOpen,
  file,
  category = 'general',
  onClose,
  onConfirm,
  allowOriginalOption = false,
  defaultKeepOriginal = false,
}) => {
  if (!isOpen || !file) return null;

  const config = DEFAULT_CATEGORY_CONFIGS[category];
  const [imageSrc, setImageSrc] = useState<string>('');
  const [naturalWidth, setNaturalWidth] = useState<number>(0);
  const [naturalHeight, setNaturalHeight] = useState<number>(0);

  // Editor states
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [panToolActive, setPanToolActive] = useState<boolean>(false);
  const [rotation, setRotation] = useState<number>(0);
  const [skipCrop, setSkipCrop] = useState<boolean>(false);
  const [keepOriginal, setKeepOriginal] = useState<boolean>(defaultKeepOriginal);
  const [crop, setCrop] = useState<NormalizedCrop>({ x: 0, y: 0, width: 1, height: 1 });

  // Processing state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Viewport & stage measurements
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Interactive drag state for crop box
  const [activeDrag, setActiveDrag] = useState<DragMode>(null);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    startCrop: NormalizedCrop;
    boxRect: DOMRect | null;
  }>({
    startX: 0,
    startY: 0,
    startCrop: { x: 0, y: 0, width: 1, height: 1 },
    boxRect: null,
  });

  // Pan dragging state
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{
    startX: number;
    startY: number;
    initPan: { x: number; y: number };
  }>({
    startX: 0,
    startY: 0,
    initPan: { x: 0, y: 0 },
  });

  // Load image object URL
  useEffect(() => {
    let active = true;
    const url = URL.createObjectURL(file);
    setImageSrc(url);

    const img = new Image();
    img.onload = () => {
      if (!active) return;
      setNaturalWidth(img.naturalWidth);
      setNaturalHeight(img.naturalHeight);
      setCrop({ x: 0, y: 0, width: 1, height: 1 });
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setRotation(0);
      setSkipCrop(false);
      setErrorMsg(null);
    };
    img.onerror = () => {
      if (!active) return;
      setErrorMsg('Không thể mở hình ảnh. Định dạng có thể bị lỗi hoặc không được hỗ trợ.');
    };
    img.src = url;

    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Compute oriented visible dimensions
  const isRotated90 = rotation === 90 || rotation === 270;
  const visibleWidth = isRotated90 ? naturalHeight : naturalWidth;
  const visibleHeight = isRotated90 ? naturalWidth : naturalHeight;

  // Re-calculate fitted stage size when viewport, image dimensions, or rotation change
  const updateStageDimensions = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || visibleWidth <= 0 || visibleHeight <= 0) return;

    // Viewport bounds with padding
    const vpW = Math.max(200, vp.clientWidth - 32);
    const vpH = Math.max(200, vp.clientHeight - 32);

    const scale = Math.min(vpW / visibleWidth, vpH / visibleHeight, 1.0);
    const w = Math.max(100, Math.round(visibleWidth * scale));
    const h = Math.max(100, Math.round(visibleHeight * scale));

    setStageSize({ width: w, height: h });
  }, [visibleWidth, visibleHeight]);

  useEffect(() => {
    updateStageDimensions();
    const vp = viewportRef.current;
    if (!vp || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => {
      updateStageDimensions();
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [updateStageDimensions]);

  // Rotate 90° clockwise
  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
    setPan({ x: 0, y: 0 });
    // Reset crop to full oriented image
    setCrop({ x: 0, y: 0, width: 1, height: 1 });
  };

  // Reset all adjustments
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPanToolActive(false);
    setRotation(0);
    setSkipCrop(false);
    setCrop({ x: 0, y: 0, width: 1, height: 1 });
  };

  // Fit view reset
  const handleFitView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Quick preset crop shapes
  const applyPresetCrop = (type: 'full' | 'square' | 'landscape' | 'portrait') => {
    setSkipCrop(false);
    if (type === 'full') {
      setCrop({ x: 0, y: 0, width: 1, height: 1 });
    } else if (type === 'square') {
      const minDim = Math.min(visibleWidth, visibleHeight);
      const nw = minDim / visibleWidth;
      const nh = minDim / visibleHeight;
      setCrop({
        x: Number(((1 - nw) / 2).toFixed(4)),
        y: Number(((1 - nh) / 2).toFixed(4)),
        width: Number(nw.toFixed(4)),
        height: Number(nh.toFixed(4)),
      });
    } else if (type === 'landscape') {
      // 16:9 crop centered
      const targetAspect = 16 / 9;
      let w = 1;
      let h = (visibleWidth / visibleHeight) / targetAspect;
      if (h > 1) {
        h = 1;
        w = targetAspect / (visibleWidth / visibleHeight);
      }
      setCrop({
        x: Number(((1 - w) / 2).toFixed(4)),
        y: Number(((1 - h) / 2).toFixed(4)),
        width: Number(w.toFixed(4)),
        height: Number(h.toFixed(4)),
      });
    } else if (type === 'portrait') {
      // 3:4 crop centered
      const targetAspect = 3 / 4;
      let w = targetAspect / (visibleWidth / visibleHeight);
      let h = 1;
      if (w > 1) {
        w = 1;
        h = (visibleWidth / visibleHeight) / targetAspect;
      }
      setCrop({
        x: Number(((1 - w) / 2).toFixed(4)),
        y: Number(((1 - h) / 2).toFixed(4)),
        width: Number(w.toFixed(4)),
        height: Number(h.toFixed(4)),
      });
    }
  };

  // Pointer down on crop handles or crop box
  const handlePointerDown = (e: React.PointerEvent, mode: DragMode) => {
    if (skipCrop || keepOriginal) return;
    e.preventDefault();
    e.stopPropagation();

    const boxRect = stageRef.current?.getBoundingClientRect() || null;
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...crop },
      boxRect,
    };
    setActiveDrag(mode);
  };

  // Global pointer move & up for crop dragging
  useEffect(() => {
    if (!activeDrag) return;

    const handlePointerMove = (e: PointerEvent) => {
      const { startX, startY, startCrop, boxRect } = dragStartRef.current;
      if (!boxRect || boxRect.width === 0 || boxRect.height === 0) return;

      e.preventDefault();

      // Delta in normalized stage space (independent of zoom, pan, display scaling)
      const deltaX = (e.clientX - startX) / boxRect.width;
      const deltaY = (e.clientY - startY) / boxRect.height;

      let { x, y, width, height } = startCrop;
      const minSize = 0.01; // Ultra-flexible: allows 1% narrow strips/ruler lines

      if (activeDrag === 'move') {
        const maxX = 1 - width;
        const maxY = 1 - height;
        x = Math.max(0, Math.min(maxX, startCrop.x + deltaX));
        y = Math.max(0, Math.min(maxY, startCrop.y + deltaY));
      } else {
        // Freeform resizing from any edge or corner
        if (activeDrag.includes('w')) {
          const rightEdge = startCrop.x + startCrop.width;
          const newX = Math.max(0, Math.min(rightEdge - minSize, startCrop.x + deltaX));
          x = newX;
          width = rightEdge - newX;
        }
        if (activeDrag.includes('e')) {
          width = Math.max(minSize, Math.min(1 - startCrop.x, startCrop.width + deltaX));
        }
        if (activeDrag.includes('n')) {
          const bottomEdge = startCrop.y + startCrop.height;
          const newY = Math.max(0, Math.min(bottomEdge - minSize, startCrop.y + deltaY));
          y = newY;
          height = bottomEdge - newY;
        }
        if (activeDrag.includes('s')) {
          height = Math.max(minSize, Math.min(1 - startCrop.y, startCrop.height + deltaY));
        }
      }

      setCrop({
        x: Number(x.toFixed(4)),
        y: Number(y.toFixed(4)),
        width: Number(width.toFixed(4)),
        height: Number(height.toFixed(4)),
      });
    };

    const handlePointerUp = () => {
      setActiveDrag(null);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [activeDrag]);

  // Viewport pointer down for Panning
  const handleViewportPointerDown = (e: React.PointerEvent) => {
    if (activeDrag) return;

    // Pan triggered by pan tool, middle mouse, Shift+drag, or dragging when zoomed
    const isMiddle = e.button === 1;
    const isLeftPan = e.button === 0 && (panToolActive || e.shiftKey || zoom > 1);

    if (isMiddle || isLeftPan) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initPan: { ...pan },
      };
    }
  };

  // Global pointer move & up for Panning
  useEffect(() => {
    if (!isPanning) return;

    const handlePointerMove = (e: PointerEvent) => {
      e.preventDefault();
      const dx = e.clientX - panStartRef.current.startX;
      const dy = e.clientY - panStartRef.current.startY;
      setPan({
        x: panStartRef.current.initPan.x + dx,
        y: panStartRef.current.initPan.y + dy,
      });
    };

    const handlePointerUp = () => {
      setIsPanning(false);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isPanning]);

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.15 : -0.15;
    setZoom((z) => {
      const next = Math.max(1, Math.min(4, Number((z + factor).toFixed(2))));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  // Calculate estimated output dimension & reduction
  const effectiveCropW = (skipCrop ? 1 : crop.width) * (visibleWidth || 1000);
  const effectiveCropH = (skipCrop ? 1 : crop.height) * (visibleHeight || 1000);

  const scaled = calculateScaledDimensions(
    effectiveCropW || 1000,
    effectiveCropH || 1000,
    config.maxDimension
  );

  // Approximate size estimate based on pixels and JPEG quality
  const estimatedPixels = scaled.width * scaled.height;
  const estBytes = Math.round(estimatedPixels * 0.14 * (config.quality / 0.85));
  const estReductionPercent =
    file.size > estBytes
      ? Math.round(((file.size - estBytes) / file.size) * 100)
      : 0;

  // Execute processing and submit
  const handleConfirm = async () => {
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const imgEl = stageRef.current?.querySelector('img') || null;
      const result = await processImageClient(file, {
        category,
        crop: skipCrop ? null : crop,
        isNormalizedCrop: true,
        rotation,
        keepOriginal,
        imageElement: imgEl,
      });

      await onConfirm(result.file, result);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi khi xử lý và nén hình ảnh.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Dimensions of current crop in source oriented pixels
  const cropPixelW = Math.round((skipCrop ? 1 : crop.width) * visibleWidth);
  const cropPixelH = Math.round((skipCrop ? 1 : crop.height) * visibleHeight);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-xs select-none">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[96vh] h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between flex-shrink-0 bg-slate-900/90">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center">
              <CropIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Chỉnh sửa & Tối ưu ảnh
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-900/60 text-blue-300 border border-blue-700/60">
                  {config.label}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Gốc: <strong>{formatFileSize(file.size)}</strong>
                {naturalWidth > 0 && ` (${naturalWidth} × ${naturalHeight}px)`}
                {rotation !== 0 && ` • Đã xoay ${rotation}°`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition disabled:opacity-50 cursor-pointer"
            title="Hủy bỏ"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="mx-4 mt-2 p-2.5 bg-rose-950/60 border border-rose-800/80 rounded-lg text-rose-300 text-xs flex items-center gap-2 flex-shrink-0">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Main Viewport Workspace */}
        <div
          ref={viewportRef}
          className={`relative flex-1 min-h-[300px] bg-slate-950 flex items-center justify-center p-4 overflow-hidden select-none ${
            panToolActive || isPanning ? 'cursor-grab active:cursor-grabbing' : ''
          }`}
          onPointerDown={handleViewportPointerDown}
          onWheel={handleWheel}
        >
          {imageSrc ? (
            <div
              ref={stageRef}
              className="relative select-none touch-none transition-transform duration-75 origin-center"
              style={{
                width: stageSize.width > 0 ? `${stageSize.width}px` : 'auto',
                height: stageSize.height > 0 ? `${stageSize.height}px` : 'auto',
                aspectRatio:
                  stageSize.width === 0 && visibleWidth && visibleHeight
                    ? `${visibleWidth}/${visibleHeight}`
                    : undefined,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              {/* Displayed Image with Exact Layout Matching Rotation */}
              {isRotated90 ? (
                <img
                  src={imageSrc}
                  alt="Crop preview"
                  className="pointer-events-none select-none block max-w-none"
                  style={{
                    width: stageSize.height > 0 ? `${stageSize.height}px` : '100%',
                    height: stageSize.width > 0 ? `${stageSize.width}px` : '100%',
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                    transformOrigin: 'center center',
                  }}
                />
              ) : (
                <img
                  src={imageSrc}
                  alt="Crop preview"
                  className="w-full h-full object-contain pointer-events-none select-none block"
                  style={{
                    transform: rotation === 180 ? 'rotate(180deg)' : undefined,
                  }}
                />
              )}

              {/* Freeform Crop Box (visible when not skipped & not keeping original) */}
              {!skipCrop && !keepOriginal && (
                <div
                  className="absolute border-2 border-blue-400 bg-blue-500/10 cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.60)]"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.width * 100}%`,
                    height: `${crop.height * 100}%`,
                  }}
                  onPointerDown={(e) => handlePointerDown(e, 'move')}
                  title="Kéo bên trong để di chuyển khung cắt"
                >
                  {/* Rule of Thirds Grid Lines */}
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                    <div className="border-r border-b border-white/60" />
                    <div className="border-r border-b border-white/60" />
                    <div className="border-b border-white/60" />
                    <div className="border-r border-b border-white/60" />
                    <div className="border-r border-b border-white/60" />
                    <div className="border-b border-white/60" />
                    <div className="border-r border-b border-white/60" />
                    <div className="border-r border-b border-white/60" />
                    <div />
                  </div>

                  {/* Real-time dimension tag */}
                  <div className="absolute -top-6 left-0 bg-blue-600/90 text-white font-mono text-[10px] px-1.5 py-0.5 rounded shadow pointer-events-none whitespace-nowrap">
                    {cropPixelW} × {cropPixelH}px
                  </div>

                  {/* Corner Handles (Large touch-friendly hit areas) */}
                  <div
                    className="absolute -top-2.5 -left-2.5 w-5 h-5 bg-blue-500 border-2 border-white rounded-xs cursor-nwse-resize shadow-md hover:scale-125 transition-transform z-20"
                    onPointerDown={(e) => handlePointerDown(e, 'nw')}
                    title="Kéo góc trên-trái"
                  />
                  <div
                    className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-blue-500 border-2 border-white rounded-xs cursor-nesw-resize shadow-md hover:scale-125 transition-transform z-20"
                    onPointerDown={(e) => handlePointerDown(e, 'ne')}
                    title="Kéo góc trên-phải"
                  />
                  <div
                    className="absolute -bottom-2.5 -left-2.5 w-5 h-5 bg-blue-500 border-2 border-white rounded-xs cursor-nesw-resize shadow-md hover:scale-125 transition-transform z-20"
                    onPointerDown={(e) => handlePointerDown(e, 'sw')}
                    title="Kéo góc dưới-trái"
                  />
                  <div
                    className="absolute -bottom-2.5 -right-2.5 w-5 h-5 bg-blue-500 border-2 border-white rounded-xs cursor-nwse-resize shadow-md hover:scale-125 transition-transform z-20"
                    onPointerDown={(e) => handlePointerDown(e, 'se')}
                    title="Kéo góc dưới-phải"
                  />

                  {/* Edge Handles with dedicated border hit-strips */}
                  {/* Top Edge Handle & Strip */}
                  <div
                    className="absolute -top-3 left-4 right-4 h-6 cursor-ns-resize z-10"
                    onPointerDown={(e) => handlePointerDown(e, 'n')}
                  />
                  <div
                    className="absolute -top-2 left-1/2 -translate-x-1/2 w-10 h-3.5 bg-blue-500 border border-white rounded-full cursor-ns-resize shadow-md z-20 hover:scale-110 transition-transform"
                    onPointerDown={(e) => handlePointerDown(e, 'n')}
                    title="Kéo cạnh trên (điều chỉnh dọc)"
                  />

                  {/* Bottom Edge Handle & Strip */}
                  <div
                    className="absolute -bottom-3 left-4 right-4 h-6 cursor-ns-resize z-10"
                    onPointerDown={(e) => handlePointerDown(e, 's')}
                  />
                  <div
                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-10 h-3.5 bg-blue-500 border border-white rounded-full cursor-ns-resize shadow-md z-20 hover:scale-110 transition-transform"
                    onPointerDown={(e) => handlePointerDown(e, 's')}
                    title="Kéo cạnh dưới (điều chỉnh dọc)"
                  />

                  {/* Left Edge Handle & Strip */}
                  <div
                    className="absolute top-4 bottom-4 -left-3 w-6 cursor-ew-resize z-10"
                    onPointerDown={(e) => handlePointerDown(e, 'w')}
                  />
                  <div
                    className="absolute top-1/2 -left-2 -translate-y-1/2 w-3.5 h-10 bg-blue-500 border border-white rounded-full cursor-ew-resize shadow-md z-20 hover:scale-110 transition-transform"
                    onPointerDown={(e) => handlePointerDown(e, 'w')}
                    title="Kéo cạnh trái (điều chỉnh ngang)"
                  />

                  {/* Right Edge Handle & Strip */}
                  <div
                    className="absolute top-4 bottom-4 -right-3 w-6 cursor-ew-resize z-10"
                    onPointerDown={(e) => handlePointerDown(e, 'e')}
                  />
                  <div
                    className="absolute top-1/2 -right-2 -translate-y-1/2 w-3.5 h-10 bg-blue-500 border border-white rounded-full cursor-ew-resize shadow-md z-20 hover:scale-110 transition-transform"
                    onPointerDown={(e) => handlePointerDown(e, 'e')}
                    title="Kéo cạnh phải (điều chỉnh ngang)"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-500 gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <span className="text-xs">Đang nạp ảnh...</span>
            </div>
          )}
        </div>

        {/* Toolbar: Zoom, Pan, Rotate, Presets, Reset */}
        <div className="px-3 py-2 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs flex-shrink-0">
          {/* Zoom and Pan controls */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex items-center gap-1 bg-slate-800/80 px-2 py-1 rounded-lg border border-slate-700/60">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(1, Number((z - 0.2).toFixed(1))))}
                disabled={zoom <= 1}
                className="p-1 hover:text-white text-slate-300 disabled:opacity-30 transition cursor-pointer"
                title="Thu nhỏ"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <input
                type="range"
                min="1"
                max="3"
                step="0.1"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-16 sm:w-20 accent-blue-500 cursor-pointer"
              />
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3, Number((z + 0.2).toFixed(1))))}
                disabled={zoom >= 3}
                className="p-1 hover:text-white text-slate-300 disabled:opacity-30 transition cursor-pointer"
                title="Phóng to"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono text-slate-400 w-8 text-right">
                {Math.round(zoom * 100)}%
              </span>
            </div>

            {/* Pan Hand Toggle */}
            <button
              type="button"
              onClick={() => setPanToolActive((p) => !p)}
              className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border transition font-semibold cursor-pointer ${
                panToolActive
                  ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                  : 'bg-slate-800 hover:bg-slate-700/80 border-slate-700 text-slate-300'
              }`}
              title="Công cụ Di chuyển (Pan) khi phóng to"
            >
              <Hand className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Di chuyển</span>
            </button>

            {/* Fit View */}
            {(zoom > 1 || pan.x !== 0 || pan.y !== 0) && (
              <button
                type="button"
                onClick={handleFitView}
                className="inline-flex items-center gap-1 px-2 py-1.5 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg text-slate-300 transition font-semibold cursor-pointer"
                title="Vừa màn hình (Đặt lại zoom)"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Vừa khung</span>
              </button>
            )}
          </div>

          {/* Quick Crop Presets & Actions */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Aspect Presets */}
            {!skipCrop && !keepOriginal && (
              <div className="hidden md:flex items-center gap-1 bg-slate-800/60 p-0.5 rounded-lg border border-slate-700/50">
                <button
                  type="button"
                  onClick={() => applyPresetCrop('full')}
                  className="px-2 py-1 rounded text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition"
                  title="Cắt toàn bộ ảnh"
                >
                  Toàn bộ
                </button>
                <button
                  type="button"
                  onClick={() => applyPresetCrop('landscape')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition"
                  title="Khung ngang 16:9"
                >
                  <RectangleHorizontal className="w-3 h-3 text-blue-400" />
                  <span>16:9</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyPresetCrop('portrait')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition"
                  title="Khung dọc 3:4"
                >
                  <RectangleVertical className="w-3 h-3 text-emerald-400" />
                  <span>3:4</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyPresetCrop('square')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition"
                  title="Khung vuông 1:1"
                >
                  <Square className="w-3 h-3 text-purple-400" />
                  <span>1:1</span>
                </button>
              </div>
            )}

            {/* Rotate Button */}
            <button
              type="button"
              onClick={handleRotate}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg text-slate-200 transition font-semibold cursor-pointer"
              title="Xoay 90 độ theo chiều kim đồng hồ"
            >
              <RotateCw className="w-3.5 h-3.5 text-blue-400" />
              <span>Xoay 90°</span>
            </button>

            {/* Reset Button */}
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg text-slate-200 transition font-semibold cursor-pointer"
              title="Đặt lại vị trí, xoay và khung crop"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>Đặt lại</span>
            </button>

            {/* Skip Crop Button */}
            <button
              type="button"
              onClick={() => setSkipCrop((prev) => !prev)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border transition font-semibold cursor-pointer ${
                skipCrop
                  ? 'bg-blue-600/30 border-blue-500 text-blue-300 font-bold'
                  : 'bg-slate-800 hover:bg-slate-700/80 border-slate-700 text-slate-200'
              }`}
            >
              <CropIcon className="w-3.5 h-3.5" />
              <span>{skipCrop ? 'Đã bỏ qua Crop' : 'Bỏ qua Crop'}</span>
            </button>
          </div>
        </div>

        {/* Compression Estimation Banner */}
        <div className="px-4 py-2 bg-slate-800/40 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs flex-shrink-0">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Dự kiến sau nén:</span>
              {keepOriginal ? (
                <span className="font-bold text-amber-300">
                  Giữ nguyên ảnh gốc ({formatFileSize(file.size)})
                </span>
              ) : (
                <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                  ~{formatFileSize(estBytes)}
                  {estReductionPercent > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 bg-emerald-950 text-emerald-300 rounded border border-emerald-800 font-semibold">
                      -{estReductionPercent}%
                    </span>
                  )}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Kích thước xuất: ~{scaled.width} × {scaled.height}px • Chất lượng {Math.round(config.quality * 100)}%
            </p>
          </div>

          {/* Option for technical drawings to keep original */}
          {(allowOriginalOption || config.allowOriginalOption) && (
            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-300 hover:text-white">
              <input
                type="checkbox"
                checked={keepOriginal}
                onChange={(e) => setKeepOriginal(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
              />
              <span>Giữ nguyên ảnh gốc</span>
            </label>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-2.5 border-t border-slate-800 flex items-center justify-end gap-2.5 bg-slate-900 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 border border-slate-700 text-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-800 transition disabled:opacity-50 cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing}
            className="inline-flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang xử lý & Nén...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Xong & Tải lên</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { getDrawingFileSignedUrl } from '../../services/drawingReviewService';
import { FileText, Loader2, ZoomIn, X } from 'lucide-react';

export interface DrawingAvatarThumbnailProps {
  avatarFilePath?: string | null;
  itemNo: string;
  itemName?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  allowZoomModal?: boolean;
  enableHoverZoom?: boolean;
  onOpenViewer?: () => void;
}

export const DrawingAvatarThumbnail: React.FC<DrawingAvatarThumbnailProps> = React.memo(({
  avatarFilePath,
  itemNo,
  itemName,
  size = 'md',
  className = '',
  allowZoomModal = false,
  enableHoverZoom = false,
  onOpenViewer,
}) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isMobilePreviewOpen, setIsMobilePreviewOpen] = useState(false);
  const [previewCoords, setPreviewCoords] = useState<{ top: number; left: number } | null>(null);
  const thumbnailRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef<number>(0);
  const isLastPointerTouch = useRef<boolean>(false);

  useEffect(() => {
    let active = true;
    if (!avatarFilePath) {
      setSignedUrl(null);
      return;
    }

    setLoading(true);
    getDrawingFileSignedUrl(avatarFilePath, 600).then((res) => {
      if (active) {
        setSignedUrl(res.signedUrl || null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [avatarFilePath]);

  // Hide preview on window/container scroll
  useEffect(() => {
    if (!isHovered && !isMobilePreviewOpen) return;
    const handleScroll = () => {
      setIsHovered(false);
      setIsMobilePreviewOpen(false);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isHovered, isMobilePreviewOpen]);

  const computeDesktopCoords = () => {
    if (!thumbnailRef.current) return;
    const rect = thumbnailRef.current.getBoundingClientRect();
    const popoverWidth = 240;
    const popoverHeight = 280;

    let left = rect.right + 12;
    if (typeof window !== 'undefined' && left + popoverWidth > window.innerWidth - 10) {
      left = Math.max(10, rect.left - popoverWidth - 12);
    }
    let top = rect.top - 20;
    if (typeof window !== 'undefined' && top + popoverHeight > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - popoverHeight - 10);
    }
    if (top < 10) top = 10;
    setPreviewCoords({ top, left });
  };

  const computeMobileCoords = () => {
    if (!thumbnailRef.current) return;
    const rect = thumbnailRef.current.getBoundingClientRect();
    const popoverWidth = 240;
    const popoverHeight = 280;

    let left = typeof window !== 'undefined'
      ? Math.max(12, Math.min(window.innerWidth - popoverWidth - 12, (window.innerWidth - popoverWidth) / 2))
      : 20;
    let top = rect.bottom + 8;
    if (typeof window !== 'undefined' && top + popoverHeight > window.innerHeight - 10) {
      top = Math.max(10, rect.top - popoverHeight - 8);
    }
    setPreviewCoords({ top, left });
  };

  const handleMouseEnter = () => {
    if (!enableHoverZoom || !signedUrl) return;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      return;
    }
    computeDesktopCoords();
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (enableHoverZoom) {
      setIsHovered(false);
    }
  };

  const sizeClasses: Record<string, string> = {
    sm: 'w-8 h-8 rounded-lg text-xs',
    md: 'w-10 h-10 rounded-xl text-xs',
    lg: 'w-16 h-16 rounded-xl text-sm',
    xl: 'w-24 h-24 rounded-xl text-sm',
    '2xl': 'w-28 h-24 rounded-xl text-sm',
  };

  const handleThumbnailClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (allowZoomModal && signedUrl) {
      setIsZoomOpen(true);
      return;
    }

    if (enableHoverZoom) {
      const isMouse = (e as any).pointerType === 'mouse' || (e.nativeEvent as any)?.pointerType === 'mouse';
      const isTouch = !isMouse && (
        isLastPointerTouch.current ||
        (e as any).pointerType === 'touch' ||
        (e.nativeEvent as any)?.pointerType === 'touch' ||
        (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
      );

      if (isTouch) {
        const now = Date.now();
        const diff = now - lastTapRef.current;
        lastTapRef.current = now;

        if (diff < 450 || isMobilePreviewOpen) {
          // 2nd tap: open full drawing viewer modal
          setIsMobilePreviewOpen(false);
          setIsHovered(false);
          onOpenViewer?.();
        } else {
          // 1st tap: open enlarged preview popover
          computeMobileCoords();
          setIsMobilePreviewOpen(true);
        }
      } else {
        // Desktop click: directly open full drawing viewer modal
        setIsHovered(false);
        onOpenViewer?.();
      }
    }
  };

  if (loading) {
    return (
      <div
        className={`${sizeClasses[size] || sizeClasses.md} bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0 ${className}`}
      >
        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
      </div>
    );
  }

  if (signedUrl) {
    return (
      <>
        <div
          ref={thumbnailRef}
          onClick={handleThumbnailClick}
          onPointerDown={(e) => {
            if (e.pointerType === 'touch') {
              isLastPointerTouch.current = true;
            } else if (e.pointerType === 'mouse') {
              isLastPointerTouch.current = false;
            }
          }}
          onTouchStart={() => {
            isLastPointerTouch.current = true;
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={`${sizeClasses[size] || sizeClasses.md} relative group overflow-hidden border border-slate-200 hover:border-blue-400 bg-white shadow-xs flex-shrink-0 flex items-center justify-center p-1 transition-all ${
            allowZoomModal || enableHoverZoom ? 'cursor-zoom-in' : ''
          } ${className}`}
          title={
            enableHoverZoom
              ? `Đưa chuột để xem to • Nhấp để mở toàn bộ bản vẽ`
              : allowZoomModal
              ? `Xem ảnh lớn chi tiết ${itemNo}`
              : itemNo
          }
          data-testid={`avatar-thumbnail-${itemNo}`}
        >
          <img
            src={signedUrl}
            alt={`Avatar ${itemNo}`}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
          />
          {allowZoomModal && (
            <div className="absolute inset-0 bg-slate-900/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl pointer-events-none">
              <ZoomIn className="w-4 h-4 text-white drop-shadow-md" />
            </div>
          )}
        </div>

        {/* Hover / 1-Tap Floating Popover Preview */}
        {enableHoverZoom && (isHovered || isMobilePreviewOpen) && previewCoords && (
          <>
            {/* Mobile backdrop to dismiss when tapping outside */}
            {isMobilePreviewOpen && (
              <div
                className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
                data-testid={`avatar-mobile-backdrop-${itemNo}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMobilePreviewOpen(false);
                }}
              />
            )}

            <div
              data-testid={`avatar-hover-preview-${itemNo}`}
              className="fixed z-50 bg-white p-2.5 rounded-2xl shadow-2xl border-2 border-blue-500/90 flex flex-col items-center animate-in fade-in zoom-in-95 duration-150 pointer-events-auto cursor-pointer"
              style={{
                top: `${previewCoords.top}px`,
                left: `${previewCoords.left}px`,
                width: '240px',
              }}
              onClick={(e) => {
                e.stopPropagation();
                setIsMobilePreviewOpen(false);
                setIsHovered(false);
                onOpenViewer?.();
              }}
              title="Nhấp để mở toàn bộ bản vẽ chi tiết"
            >
              <div className="w-full h-52 flex items-center justify-center bg-slate-50/90 rounded-xl overflow-hidden mb-2 p-1.5 border border-slate-100 relative group">
                <img
                  src={signedUrl}
                  alt={`Phóng to ${itemNo}`}
                  className="w-full h-full object-contain drop-shadow-xs"
                />
                <div className="absolute top-1.5 right-1.5 bg-blue-600 text-white p-1 rounded-md shadow-xs opacity-90">
                  <ZoomIn className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="w-full text-center px-1">
                <div className="text-xs font-mono font-black text-slate-900 truncate tracking-tight">
                  {itemNo}
                </div>
                {itemName && (
                  <div className="text-[11px] text-slate-500 font-medium truncate mt-0.5" title={itemName}>
                    {itemName}
                  </div>
                )}
                {isMobilePreviewOpen ? (
                  <div className="mt-1.5 pt-1.5 border-t border-slate-100 text-[10px] text-blue-600 font-bold text-center">
                    Chạm lần nữa để mở toàn bộ bản vẽ
                  </div>
                ) : (
                  <div className="mt-1 pt-1 border-t border-slate-100 text-[9px] text-slate-400 text-center font-medium">
                    Nhấp chuột để mở toàn bộ bản vẽ
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Zoom Lightbox Modal */}
        {isZoomOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in"
            onClick={(e) => {
              e.stopPropagation();
              setIsZoomOpen(false);
            }}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-4 border border-slate-200 relative flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-full flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-black text-slate-900 text-sm font-mono">{itemNo}</span>
                  <span className="text-xs text-slate-500 font-medium">— Hình dạng sản phẩm</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsZoomOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="w-full max-h-[70vh] flex items-center justify-center bg-slate-50 rounded-xl p-3 border border-slate-200 overflow-auto">
                <img
                  src={signedUrl}
                  alt={`Phóng to ${itemNo}`}
                  className="max-h-[60vh] max-w-full object-contain rounded-lg"
                />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Fallback placeholder
  return (
    <div
      className={`${sizeClasses[size] || sizeClasses.md} bg-slate-50 border border-slate-200 text-slate-400 flex flex-col items-center justify-center font-bold flex-shrink-0 ${className}`}
      title={itemNo}
    >
      <FileText className="w-5 h-5 text-slate-300 mb-0.5" />
      <span className="text-[11px] font-mono text-slate-600 font-bold">
        {itemNo ? itemNo.substring(0, 2).toUpperCase() : 'DW'}
      </span>
    </div>
  );
});

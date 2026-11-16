import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X } from 'lucide-react';

export type AnnotationTool = 'none' | 'highlight' | 'text' | 'arrow' | 'circle' | 'rectangle';

export interface DrawingAnnotation {
  id: string;
  type: 'highlight' | 'text' | 'arrow' | 'circle' | 'rectangle';
  x: number; // drawing natural coordinate
  y: number;
  width?: number;
  height?: number;
  endX?: number; // for arrow
  endY?: number;
  text?: string;
  fontSize?: number; // Font size in px (e.g. 12, 14, 16, 20, 24, 32, 40)
  color: string;
  page: number;
  createdAt: number;
}

export interface DrawingAnnotationLayerProps {
  naturalWidth: number;
  naturalHeight: number;
  annotations: DrawingAnnotation[];
  currentPage: number;
  activeTool: AnnotationTool;
  activeColor: string;
  activeFontSize?: number;
  onChangeFontSize?: (size: number) => void;
  isAnnotating: boolean;
  visible: boolean;
  onAddAnnotation: (ann: DrawingAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
}

export const PRESET_COLORS = [
  { name: 'Vàng Highlight', hex: '#facc15', bg: 'bg-yellow-400', ring: 'ring-yellow-400' },
  { name: 'Đỏ Cảnh báo', hex: '#ef4444', bg: 'bg-red-500', ring: 'ring-red-500' },
  { name: 'Xanh lam Chỉ dẫn', hex: '#3b82f6', bg: 'bg-blue-500', ring: 'ring-blue-500' },
  { name: 'Xanh lá Xác nhận', hex: '#22c55e', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
  { name: 'Cam Lưu ý', hex: '#f97316', bg: 'bg-orange-500', ring: 'ring-orange-500' },
];

export const FONT_SIZE_OPTIONS = [
  { value: 12, label: '12px (Rất nhỏ)' },
  { value: 14, label: '14px (Nhỏ)' },
  { value: 16, label: '16px (Vừa)' },
  { value: 20, label: '20px (Lớn)' },
  { value: 24, label: '24px (Lớn hơn)' },
  { value: 32, label: '32px (Rất lớn)' },
  { value: 40, label: '40px (Cực lớn)' },
];

export const DEFAULT_FONT_SIZE = 16;

export const DrawingAnnotationLayer: React.FC<DrawingAnnotationLayerProps> = ({
  naturalWidth,
  naturalHeight,
  annotations,
  currentPage,
  activeTool,
  activeColor,
  activeFontSize = DEFAULT_FONT_SIZE,
  onChangeFontSize,
  isAnnotating,
  visible,
  onAddAnnotation,
  onDeleteAnnotation,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentDraft, setCurrentDraft] = useState<DrawingAnnotation | null>(null);

  // Text input modal/inline state
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number } | null>(null);
  const [inputTextVal, setInputTextVal] = useState('');
  const [inputFontSize, setInputFontSize] = useState<number>(activeFontSize);
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Keep inputFontSize in sync with activeFontSize prop
  useEffect(() => {
    if (activeFontSize) {
      setInputFontSize(activeFontSize);
    }
  }, [activeFontSize]);

  // Filter annotations for current PDF page
  const pageAnnotations = annotations.filter((a) => a.page === currentPage);

  // Focus textarea when text input opens & place cursor at end
  useEffect(() => {
    if (textInputPos) {
      setTimeout(() => {
        if (textAreaRef.current) {
          textAreaRef.current.focus();
          const len = textAreaRef.current.value.length;
          textAreaRef.current.setSelectionRange(len, len);
        }
      }, 50);
    }
  }, [textInputPos]);

  // Convert mouse event client coordinates to SVG natural drawing coordinates
  const getNaturalCoords = useCallback(
    (e: React.MouseEvent | MouseEvent): { x: number; y: number } | null => {
      if (!svgRef.current || naturalWidth <= 0 || naturalHeight <= 0) return null;
      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const rawX = ((e.clientX - rect.left) / rect.width) * naturalWidth;
      const rawY = ((e.clientY - rect.top) / rect.height) * naturalHeight;

      return {
        x: Math.max(0, Math.min(naturalWidth, Math.round(rawX))),
        y: Math.max(0, Math.min(naturalHeight, Math.round(rawY))),
      };
    },
    [naturalWidth, naturalHeight]
  );

  // Mouse Down handler on SVG layer
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isAnnotating || activeTool === 'none') return;
    if (e.button !== 0) return; // Only left mouse click

    // If text tool, open inline input
    const pt = getNaturalCoords(e);
    if (!pt) return;

    if (activeTool === 'text') {
      setEditingAnnId(null);
      setTextInputPos(pt);
      setInputTextVal('');
      setInputFontSize(activeFontSize || DEFAULT_FONT_SIZE);
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    setIsDrawing(true);
    setStartPoint(pt);

    const initialDraft: DrawingAnnotation = {
      id: `draft-${Date.now()}`,
      type: activeTool,
      x: pt.x,
      y: pt.y,
      width: 0,
      height: 0,
      endX: pt.x,
      endY: pt.y,
      color: activeColor,
      page: currentPage,
      createdAt: Date.now(),
    };
    setCurrentDraft(initialDraft);
  };

  // Double click to edit existing text annotation
  const handleStartEditText = (ann: DrawingAnnotation) => {
    if (ann.type !== 'text') return;
    setEditingAnnId(ann.id);
    setTextInputPos({ x: ann.x, y: ann.y });
    setInputTextVal(ann.text || '');
    setInputFontSize(ann.fontSize || DEFAULT_FONT_SIZE);
  };

  // Mouse Move listener during drawing
  useEffect(() => {
    if (!isDrawing || !startPoint || !currentDraft) return;

    const handleMouseMove = (e: MouseEvent) => {
      const pt = getNaturalCoords(e);
      if (!pt) return;

      if (currentDraft.type === 'arrow') {
        setCurrentDraft((prev) => (prev ? { ...prev, endX: pt.x, endY: pt.y } : null));
      } else if (currentDraft.type === 'circle') {
        const cx = (startPoint.x + pt.x) / 2;
        const cy = (startPoint.y + pt.y) / 2;
        const rx = Math.abs(pt.x - startPoint.x) / 2;
        const ry = Math.abs(pt.y - startPoint.y) / 2;
        setCurrentDraft((prev) => (prev ? { ...prev, x: cx, y: cy, width: rx, height: ry } : null));
      } else {
        // highlight or rectangle
        const x = Math.min(startPoint.x, pt.x);
        const y = Math.min(startPoint.y, pt.y);
        const w = Math.abs(pt.x - startPoint.x);
        const h = Math.abs(pt.y - startPoint.y);
        setCurrentDraft((prev) => (prev ? { ...prev, x, y, width: w, height: h } : null));
      }
    };

    const handleMouseUp = () => {
      setIsDrawing(false);
      if (currentDraft) {
        // Minimum size check to avoid accidental micro-clicks
        const isArrowValid =
          currentDraft.type === 'arrow' &&
          (Math.abs((currentDraft.endX || 0) - currentDraft.x) > 8 ||
            Math.abs((currentDraft.endY || 0) - currentDraft.y) > 8);
        const isBoxValid =
          (currentDraft.type === 'highlight' ||
            currentDraft.type === 'rectangle' ||
            currentDraft.type === 'circle') &&
          (currentDraft.width || 0) > 8 &&
          (currentDraft.height || 0) > 8;

        if (isArrowValid || isBoxValid) {
          onAddAnnotation({
            ...currentDraft,
            id: `ann-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          });
        }
      }
      setCurrentDraft(null);
      setStartPoint(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDrawing, startPoint, currentDraft, getNaturalCoords, onAddAnnotation]);

  // Submit Text Annotation
  const handleConfirmText = () => {
    if (textInputPos && inputTextVal.trim()) {
      if (editingAnnId) {
        onDeleteAnnotation(editingAnnId);
      }
      onAddAnnotation({
        id: editingAnnId || `ann-text-${Date.now()}`,
        type: 'text',
        x: textInputPos.x,
        y: textInputPos.y,
        text: inputTextVal.trim(),
        fontSize: inputFontSize,
        color: activeColor,
        page: currentPage,
        createdAt: Date.now(),
      });
    }
    setEditingAnnId(null);
    setTextInputPos(null);
    setInputTextVal('');
  };

  const handleCancelText = () => {
    setEditingAnnId(null);
    setTextInputPos(null);
    setInputTextVal('');
  };

  if (!visible) return null;

  return (
    <>
      <svg
        ref={svgRef}
        onMouseDown={handleMouseDown}
        viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
        className={`absolute inset-0 w-full h-full select-none ${
          isAnnotating ? 'pointer-events-auto z-20' : 'pointer-events-none z-10'
        } ${isAnnotating && activeTool !== 'none' ? 'cursor-crosshair' : ''}`}
        style={{ width: naturalWidth, height: naturalHeight }}
        data-testid="drawing-annotation-svg-layer"
      >
        <defs>
          {PRESET_COLORS.map((c) => (
            <marker
              key={`marker-${c.hex}`}
              id={`arrow-head-${c.hex.replace('#', '')}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill={c.hex} />
            </marker>
          ))}
        </defs>

        {/* Existing Annotations on this page */}
        {pageAnnotations.map((ann) => {
          const markerId = `arrow-head-${ann.color.replace('#', '')}`;

          return (
            <g
              key={ann.id}
              className="group/ann"
              data-testid={`annotation-item-${ann.type}-${ann.id}`}
            >
              {ann.type === 'highlight' && (
                <rect
                  x={ann.x}
                  y={ann.y}
                  width={ann.width || 0}
                  height={ann.height || 0}
                  fill={ann.color}
                  fillOpacity="0.45"
                  rx="4"
                  style={{ mixBlendMode: 'multiply' }}
                />
              )}

              {ann.type === 'rectangle' && (
                <rect
                  x={ann.x}
                  y={ann.y}
                  width={ann.width || 0}
                  height={ann.height || 0}
                  fill="none"
                  stroke={ann.color}
                  strokeWidth="3.5"
                  rx="4"
                />
              )}

              {ann.type === 'circle' && (
                <ellipse
                  cx={ann.x}
                  cy={ann.y}
                  rx={ann.width || 0}
                  ry={ann.height || 0}
                  fill="none"
                  stroke={ann.color}
                  strokeWidth="3.5"
                />
              )}

              {ann.type === 'arrow' && (
                <line
                  x1={ann.x}
                  y1={ann.y}
                  x2={ann.endX || ann.x}
                  y2={ann.endY || ann.y}
                  stroke={ann.color}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  markerEnd={`url(#${markerId})`}
                />
              )}

              {ann.type === 'text' && ann.text && (() => {
                const fontSize = ann.fontSize || 14;
                const lineHeight = Math.round(fontSize * 1.35);
                const lines = ann.text.split('\n');
                const maxLineLength = Math.max(...lines.map((l) => l.length), 1);
                const paddingX = 8;
                const paddingY = 6;
                const charWidth = fontSize * 0.62;
                const boxWidth = Math.max(50, Math.round(maxLineLength * charWidth + paddingX * 2 + 8));
                const boxHeight = Math.round(lines.length * lineHeight + paddingY * 2);
                const boxTop = -22;
                const line0Baseline = boxTop + paddingY + Math.round(fontSize * 0.88);

                return (
                  <g
                    transform={`translate(${ann.x}, ${ann.y})`}
                    onDoubleClick={(e) => {
                      if (!isAnnotating) return;
                      e.stopPropagation();
                      handleStartEditText(ann);
                    }}
                    className={isAnnotating ? 'cursor-pointer' : ''}
                  >
                    <title>{isAnnotating ? 'Nhấp đúp để chỉnh sửa nội dung hoặc cỡ chữ' : undefined}</title>
                    {/* Subtle white badge behind text for high legibility */}
                    <rect
                      x="-6"
                      y={boxTop}
                      width={boxWidth}
                      height={boxHeight}
                      rx="6"
                      fill="rgba(255, 255, 255, 0.94)"
                      stroke={ann.color}
                      strokeWidth="1.5"
                      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))"
                    />
                    <text
                      x="4"
                      y={line0Baseline}
                      fill={ann.color === '#facc15' ? '#854d0e' : ann.color}
                      fontSize={fontSize}
                      fontWeight="bold"
                      fontFamily="system-ui, -apple-system, sans-serif"
                    >
                      {lines.map((line, idx) => (
                        <tspan
                          key={idx}
                          x="4"
                          y={line0Baseline + idx * lineHeight}
                        >
                          {line || ' '}
                        </tspan>
                      ))}
                    </text>
                  </g>
                );
              })()}

              {/* Delete button on hover when in annotation mode */}
              {isAnnotating && (() => {
                let delX = ann.x + (ann.width || 0) + 4;
                let delY = ann.y - 10;
                if (ann.type === 'text' && ann.text) {
                  const fontSize = ann.fontSize || 14;
                  const lines = ann.text.split('\n');
                  const maxLineLength = Math.max(...lines.map((l) => l.length), 1);
                  const boxWidth = Math.max(50, Math.round(maxLineLength * (fontSize * 0.62) + 24));
                  delX = ann.x + boxWidth - 4;
                  delY = ann.y - 22;
                }

                return (
                  <g
                    className="opacity-0 group-hover/ann:opacity-100 transition-opacity cursor-pointer"
                    transform={`translate(${delX}, ${delY})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteAnnotation(ann.id);
                    }}
                    data-testid={`delete-ann-btn-${ann.id}`}
                  >
                    <circle r="9" fill="#ef4444" />
                    <line x1="-3" y1="-3" x2="3" y2="3" stroke="white" strokeWidth="1.5" />
                    <line x1="3" y1="-3" x2="-3" y2="3" stroke="white" strokeWidth="1.5" />
                  </g>
                );
              })()}
            </g>
          );
        })}

        {/* Real-time Draft while dragging */}
        {currentDraft && (
          <g className="pointer-events-none opacity-90">
            {currentDraft.type === 'highlight' && (
              <rect
                x={currentDraft.x}
                y={currentDraft.y}
                width={currentDraft.width || 0}
                height={currentDraft.height || 0}
                fill={currentDraft.color}
                fillOpacity="0.45"
                rx="4"
                style={{ mixBlendMode: 'multiply' }}
              />
            )}
            {currentDraft.type === 'rectangle' && (
              <rect
                x={currentDraft.x}
                y={currentDraft.y}
                width={currentDraft.width || 0}
                height={currentDraft.height || 0}
                fill="none"
                stroke={currentDraft.color}
                strokeWidth="3.5"
                strokeDasharray="6 4"
                rx="4"
              />
            )}
            {currentDraft.type === 'circle' && (
              <ellipse
                cx={currentDraft.x}
                cy={currentDraft.y}
                rx={currentDraft.width || 0}
                ry={currentDraft.height || 0}
                fill="none"
                stroke={currentDraft.color}
                strokeWidth="3.5"
                strokeDasharray="6 4"
              />
            )}
            {currentDraft.type === 'arrow' && (
              <line
                x1={currentDraft.x}
                y1={currentDraft.y}
                x2={currentDraft.endX || currentDraft.x}
                y2={currentDraft.endY || currentDraft.y}
                stroke={currentDraft.color}
                strokeWidth="3.5"
                strokeDasharray="6 4"
                markerEnd={`url(#arrow-head-${currentDraft.color.replace('#', '')})`}
              />
            )}
          </g>
        )}
      </svg>

      {/* Inline Text Prompt Modal/Popover when placing or editing text annotation */}
      {textInputPos && (() => {
        const isNearTop = textInputPos.y / naturalHeight < 0.15;
        const isNearRight = textInputPos.x / naturalWidth > 0.75;
        const transformX = isNearRight ? '-85%' : '-10px';
        const transformY = isNearTop ? '15px' : '-100%';

        return (
          <div
            className="absolute z-50 bg-white/95 backdrop-blur-md p-3 rounded-xl shadow-2xl border border-slate-300 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-150 w-72 sm:w-84"
            style={{
              left: `${(textInputPos.x / naturalWidth) * 100}%`,
              top: `${(textInputPos.y / naturalHeight) * 100}%`,
              transform: `translate(${transformX}, ${transformY})`,
            }}
            data-testid="inline-text-annotation-popover"
          >
            <div className="flex items-center justify-between text-xs text-slate-600 border-b border-slate-200 pb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-700">Cỡ chữ:</span>
                <select
                  value={inputFontSize}
                  onChange={(e) => {
                    const sz = Number(e.target.value);
                    setInputFontSize(sz);
                    onChangeFontSize?.(sz);
                  }}
                  className="px-2 py-0.5 border border-slate-300 rounded text-xs bg-white text-slate-800 font-semibold focus:ring-1 focus:ring-blue-500 cursor-pointer"
                  data-testid="inline-font-size-select"
                >
                  {FONT_SIZE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-[10px] text-slate-400">Ctrl+Enter để lưu</span>
            </div>

            <textarea
              ref={textAreaRef}
              value={inputTextVal}
              onChange={(e) => setInputTextVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleConfirmText();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelText();
                }
              }}
              placeholder="Nhập nội dung ghi chú... Nhấn Enter để xuống dòng"
              rows={3}
              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-medium text-slate-800 resize-y text-xs leading-relaxed"
              style={{ fontSize: `${inputFontSize}px` }}
              data-testid="inline-annotation-text-input"
            />

            <div className="flex items-center justify-between pt-0.5">
              <span className="text-[10px] text-slate-400">Enter: xuống dòng</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCancelText}
                  className="px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer flex items-center gap-1"
                  data-testid="cancel-text-ann-btn"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Hủy</span>
                </button>
                <button
                  type="button"
                  onClick={handleConfirmText}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition cursor-pointer flex items-center gap-1 shadow-xs"
                  data-testid="confirm-text-ann-btn"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Lưu ghi chú</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
};

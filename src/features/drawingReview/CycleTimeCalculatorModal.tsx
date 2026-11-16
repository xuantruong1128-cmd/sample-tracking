import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Lock,
  Unlock,
  Calculator,
  AlertTriangle,
  RotateCcw,
  Plus,
  Trash2,
  Clock,
  Save,
  Check,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  Hand,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import {
  type MachiningType,
  type MultiCutCycleTimeState,
  isSingleEdgeTurningType,
  createDefaultCutRow,
  createInitialMultiCutState,
  updateCutRowDVcN,
  updateCutRowFeed,
  updateCutRowMachiningType,
  toggleCutRowLock,
  solveCutRow,
  recalculateMultiCutState,
  deserializeMultiCutState,
  safePositiveNumber,
  formatDisplayNumber,
} from '../../lib/cycleTimeEngine';

export interface CycleTimeCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (calculatedCtSeconds: number, calculationState: MultiCutCycleTimeState) => void;
  onSaveDraft?: (calculationState: MultiCutCycleTimeState) => void;
  initialState?: any;
  operationStepOrder?: number;
  workcenterCode?: string;
  drawerWidthPercent?: number;
  onDrawerWidthChange?: (widthPercent: number) => void;
  onFullScreenChange?: (isFullScreen: boolean) => void;
  readOnly?: boolean;
}

export const CycleTimeCalculatorModal: React.FC<CycleTimeCalculatorModalProps> = ({
  isOpen,
  onClose,
  onApply,
  onSaveDraft,
  initialState,
  operationStepOrder = 10,
  workcenterCode = 'CAMC',
  drawerWidthPercent: propDrawerWidthPercent,
  onDrawerWidthChange,
  onFullScreenChange,
  readOnly = false,
}) => {
  // Infer default machining type from workcenterCode
  const inferDefaultMachiningType = (wc: string): MachiningType => {
    const code = wc.toUpperCase();
    if (code.includes('MILL') || code.includes('MC') || code.includes('CNC')) return 'milling';
    if (code.includes('DRILL')) return 'drilling';
    if (code.includes('TAP')) return 'tapping';
    if (code.includes('ROLL')) return 'rolling';
    if (code.includes('BORE') || code.includes('BORING')) return 'boring';
    return 'turning';
  };

  const [state, setState] = useState<MultiCutCycleTimeState>(() => {
    const defaultType = inferDefaultMachiningType(workcenterCode);
    return deserializeMultiCutState(initialState, defaultType);
  });

  // Half-screen vs Full-screen toggle (defaults to false = 1/2 screen on right)
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Success indicator when saving calculation draft
  const [saveSuccessMessage, setSaveSuccessMessage] = useState(false);

  // Local input string buffers so active typing (e.g. typing decimals "1." -> "1.75") never gets interrupted
  const [inputBuffers, setInputBuffers] = useState<Record<string, string>>({});

  // Drawer width percentage (default 50%, can be resized by dragging left edge between 30% and 85%)
  const [drawerWidthPercent, setDrawerWidthPercent] = useState<number>(() => {
    if (
      propDrawerWidthPercent !== undefined &&
      propDrawerWidthPercent >= 30 &&
      propDrawerWidthPercent <= 85
    ) {
      return propDrawerWidthPercent;
    }
    try {
      const saved = localStorage.getItem('sample_tracking_calc_drawer_width');
      if (saved) {
        const parsed = parseFloat(saved);
        if (parsed >= 30 && parsed <= 85) return parsed;
      }
    } catch (_) {}
    return 50;
  });
  const [isResizingDrawer, setIsResizingDrawer] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );

  useEffect(() => {
    if (
      propDrawerWidthPercent !== undefined &&
      propDrawerWidthPercent >= 30 &&
      propDrawerWidthPercent <= 85 &&
      propDrawerWidthPercent !== drawerWidthPercent
    ) {
      setDrawerWidthPercent(propDrawerWidthPercent);
    }
  }, [propDrawerWidthPercent]);

  useEffect(() => {
    onDrawerWidthChange?.(drawerWidthPercent);
  }, [drawerWidthPercent, onDrawerWidthChange]);

  useEffect(() => {
    onFullScreenChange?.(isFullScreen);
  }, [isFullScreen, onFullScreenChange]);

  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== 'undefined') {
        setIsDesktop(window.innerWidth >= 768);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingDrawer(true);
  };

  useEffect(() => {
    if (!isResizingDrawer) return;

    const handleMouseMove = (e: MouseEvent) => {
      const windowWidth = window.innerWidth;
      const newWidth = Math.min(85, Math.max(30, ((windowWidth - e.clientX) / windowWidth) * 100));
      const rounded = parseFloat(newWidth.toFixed(1));
      setDrawerWidthPercent(rounded);
      onDrawerWidthChange?.(rounded);
    };

    const handleMouseUp = () => {
      setIsResizingDrawer(false);
      try {
        localStorage.setItem('sample_tracking_calc_drawer_width', String(drawerWidthPercent));
      } catch (_) {}
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingDrawer, drawerWidthPercent, onDrawerWidthChange]);

  // Table drag-to-pan refs & state
  const tableScrollContainerRef = useRef<HTMLDivElement>(null);
  const [isTablePanning, setIsTablePanning] = useState(false);
  const [isPanMode, setIsPanMode] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Listen for Spacebar keydown / keyup to toggle pan mode temporarily
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const activePan = isPanMode || isSpacePressed;

  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  const handleTablePanMouseDown = (e: React.MouseEvent) => {
    // Left-click (0) or Middle-click (1)
    if (e.button !== 0 && e.button !== 1) return;

    const isMiddleClick = e.button === 1;

    // For regular left-click without pan mode, ignore when clicking interactive form controls
    if (!activePan && !isMiddleClick) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'BUTTON' ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('button') ||
        target.closest('a')
      ) {
        return;
      }
    }

    if (!tableScrollContainerRef.current) return;

    // Prevent text selection / native drag immediately
    e.preventDefault();
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    setIsTablePanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: tableScrollContainerRef.current.scrollLeft,
      scrollTop: tableScrollContainerRef.current.scrollTop,
    };
  };

  useEffect(() => {
    if (!isTablePanning) return;

    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    const handleMouseMove = (e: MouseEvent) => {
      if (!tableScrollContainerRef.current) return;
      e.preventDefault();
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;

      tableScrollContainerRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      tableScrollContainerRef.current.scrollTop = panStartRef.current.scrollTop - dy;
    };

    const handleMouseUp = () => {
      setIsTablePanning(false);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: false });
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isTablePanning]);

  // Horizontal wheel scroll helper
  const handleTableWheel = (e: React.WheelEvent) => {
    if (!tableScrollContainerRef.current) return;
    const el = tableScrollContainerRef.current;
    if (Math.abs(e.deltaX) > 0) {
      el.scrollLeft += e.deltaX;
      return;
    }
    // Any wheel action on horizontally scrollable table scrolls horizontally
    if (el.scrollWidth > el.clientWidth) {
      el.scrollLeft += e.deltaY;
      e.stopPropagation();
    }
  };

  const scrollTableBy = (delta: number) => {
    if (tableScrollContainerRef.current) {
      if (typeof tableScrollContainerRef.current.scrollBy === 'function') {
        tableScrollContainerRef.current.scrollBy({ left: delta, behavior: 'smooth' });
      } else {
        tableScrollContainerRef.current.scrollLeft += delta;
      }
    }
  };

  const scrollTableTo = (position: 'start' | 'end') => {
    if (tableScrollContainerRef.current) {
      const left = position === 'start' ? 0 : tableScrollContainerRef.current.scrollWidth;
      if (typeof tableScrollContainerRef.current.scrollTo === 'function') {
        tableScrollContainerRef.current.scrollTo({ left, behavior: 'smooth' });
      } else {
        tableScrollContainerRef.current.scrollLeft = left;
      }
    }
  };

  // Synchronize when modal opens or initialState changes
  useEffect(() => {
    if (isOpen) {
      const defaultType = inferDefaultMachiningType(workcenterCode);
      const deserialized = deserializeMultiCutState(initialState, defaultType);
      setState(deserialized);
      setInputBuffers({});
      setSaveSuccessMessage(false);
    }
  }, [isOpen, initialState, workcenterCode]);

  if (!isOpen) return null;

  // Helper to get active display value for an input
  const getInputValue = (
    key: string,
    numericVal: number | null | undefined,
    source: 'input' | 'calculated',
    decimals = 2
  ): string => {
    if (source === 'calculated') {
      return formatDisplayNumber(numericVal, decimals);
    }
    if (inputBuffers[key] !== undefined) {
      return inputBuffers[key];
    }
    return formatDisplayNumber(numericVal, decimals);
  };

  // Set input string buffer
  const setBuffer = (key: string, val: string) => {
    setInputBuffers((prev) => ({ ...prev, [key]: val }));
  };

  // 1. Cut Row Name change
  const handleCutNameChange = (cutIndex: number, newName: string) => {
    setState((prev) => {
      const nextCuts = [...prev.cuts];
      nextCuts[cutIndex] = { ...nextCuts[cutIndex], name: newName };
      return { ...prev, cuts: nextCuts };
    });
  };

  // 1b. Cut Row Description change (Ghi tự do nội dung gia công)
  const handleCutDescriptionChange = (cutIndex: number, newDescription: string) => {
    setState((prev) => {
      const nextCuts = [...prev.cuts];
      nextCuts[cutIndex] = { ...nextCuts[cutIndex], description: newDescription };
      return { ...prev, cuts: nextCuts };
    });
  };

  // 2. Cut Row Machining Type change
  const handleMachiningTypeChange = (cutIndex: number, type: MachiningType) => {
    setState((prev) => {
      const nextCuts = [...prev.cuts];
      nextCuts[cutIndex] = updateCutRowMachiningType(nextCuts[cutIndex], type);
      return recalculateMultiCutState({ ...prev, cuts: nextCuts });
    });
  };

  // 3. Cut Row D - Vc - N change
  const handleDVcNChange = (
    cutIndex: number,
    field: 'diameter' | 'cuttingSpeed' | 'spindleSpeed',
    valStr: string
  ) => {
    const cut = state.cuts[cutIndex];
    if (!cut) return;
    const bufKey = `${cut.id}-${field}`;
    setBuffer(bufKey, valStr);

    const num = safePositiveNumber(valStr);
    setState((prev) => {
      const nextCuts = [...prev.cuts];
      nextCuts[cutIndex] = updateCutRowDVcN(nextCuts[cutIndex], field, num);
      return recalculateMultiCutState({ ...prev, cuts: nextCuts });
    });
  };

  // 4. Cut Row Feed change (F, Fz, Fn, Z, Pitch)
  const handleFeedChange = (
    cutIndex: number,
    field: 'feedRate' | 'feedPerTooth' | 'feedPerRev' | 'teethCount' | 'threadPitch',
    valStr: string
  ) => {
    const cut = state.cuts[cutIndex];
    if (!cut) return;
    const bufKey = `${cut.id}-${field}`;
    setBuffer(bufKey, valStr);

    const num = safePositiveNumber(valStr);
    setState((prev) => {
      const nextCuts = [...prev.cuts];
      nextCuts[cutIndex] = updateCutRowFeed(nextCuts[cutIndex], field, num);
      return recalculateMultiCutState({ ...prev, cuts: nextCuts });
    });
  };

  // 5. Cut Row Length change
  const handleLengthChange = (cutIndex: number, valStr: string) => {
    const cut = state.cuts[cutIndex];
    if (!cut) return;
    const bufKey = `${cut.id}-length`;
    setBuffer(bufKey, valStr);

    const num = safePositiveNumber(valStr);
    setState((prev) => {
      const nextCuts = [...prev.cuts];
      nextCuts[cutIndex] = solveCutRow({
        ...nextCuts[cutIndex],
        length: { ...nextCuts[cutIndex].length, value: num, source: 'input' },
      });
      return recalculateMultiCutState({ ...prev, cuts: nextCuts });
    });
  };

  // 6. Cut Row Passes change (Accepts positive decimals: 1, 1.3, 1.5, 1.75, 2.25...)
  const handlePassesChange = (cutIndex: number, valStr: string) => {
    const cut = state.cuts[cutIndex];
    if (!cut) return;
    const bufKey = `${cut.id}-passes`;
    setBuffer(bufKey, valStr);

    if (valStr === '') {
      setState((prev) => {
        const nextCuts = [...prev.cuts];
        nextCuts[cutIndex] = solveCutRow({
          ...nextCuts[cutIndex],
          passes: { ...nextCuts[cutIndex].passes, value: null, source: 'input' },
        });
        return recalculateMultiCutState({ ...prev, cuts: nextCuts });
      });
      return;
    }

    const num = safePositiveNumber(valStr);
    setState((prev) => {
      const nextCuts = [...prev.cuts];
      nextCuts[cutIndex] = solveCutRow({
        ...nextCuts[cutIndex],
        passes: { ...nextCuts[cutIndex].passes, value: num, source: 'input' },
      });
      return recalculateMultiCutState({ ...prev, cuts: nextCuts });
    });
  };

  // 7. Toggle Lock on a variable of a cut row
  const handleToggleLock = (
    cutIndex: number,
    field: 'diameter' | 'cuttingSpeed' | 'spindleSpeed' | 'feedRate' | 'feedPerTooth'
  ) => {
    setState((prev) => {
      const nextCuts = [...prev.cuts];
      nextCuts[cutIndex] = toggleCutRowLock(nextCuts[cutIndex], field);
      return recalculateMultiCutState({ ...prev, cuts: nextCuts });
    });
  };

  // 8. Add a new Cut Row
  const handleAddCutRow = () => {
    const defaultType = inferDefaultMachiningType(workcenterCode);
    const stepNum = state.cuts.length + 1;
    const toolCode = stepNum < 10 ? `T0${stepNum}` : `T${stepNum}`;
    const newCut = createDefaultCutRow(stepNum, defaultType, toolCode);
    setState((prev) => recalculateMultiCutState({ ...prev, cuts: [...prev.cuts, newCut] }));
  };

  // 9. Delete a Cut Row
  const handleDeleteCutRow = (cutIndex: number) => {
    if (state.cuts.length <= 1) return; // Keep at least 1 cut
    setState((prev) => {
      const nextCuts = prev.cuts.filter((_, idx) => idx !== cutIndex);
      return recalculateMultiCutState({ ...prev, cuts: nextCuts });
    });
  };

  // 10. Non-cutting time change
  const handleNonCuttingChange = (valStr: string) => {
    setBuffer('nonCuttingTime', valStr);
    const num = valStr === '' ? 0 : parseFloat(valStr);
    const valid = Number.isFinite(num) && num >= 0 ? num : 0;
    setState((prev) =>
      recalculateMultiCutState({
        ...prev,
        nonCuttingTimeSeconds: valid,
      })
    );
  };

  // 10b. Non-cutting time note change
  const handleNonCuttingNoteChange = (valStr: string) => {
    setState((prev) => ({
      ...prev,
      nonCuttingTimeNote: valStr,
    }));
  };

  // 11. Reset to 1 default cut row
  const handleReset = () => {
    const defaultType = inferDefaultMachiningType(workcenterCode);
    setState(createInitialMultiCutState(defaultType));
    setInputBuffers({});
  };

  // 12. Save Draft / Lưu tính toán dang dở
  const handleSaveDraft = () => {
    if (onSaveDraft) {
      onSaveDraft(state);
    } else {
      const ct = state.totalCycleTimeSeconds ? parseFloat(state.totalCycleTimeSeconds.toFixed(2)) : 0;
      onApply(ct, state);
    }
    setSaveSuccessMessage(true);
    setTimeout(() => {
      setSaveSuccessMessage(false);
    }, 2500);
  };

  // 13. Apply calculated CT to Operation and Close
  const handleApply = () => {
    const totalCt = state.totalCycleTimeSeconds;
    if (totalCt !== null && totalCt !== undefined && Number.isFinite(totalCt)) {
      const roundedCt = parseFloat(totalCt.toFixed(2));
      onApply(roundedCt, state);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none"
      data-testid="cycle-time-calculator-modal"
    >
      {/* Mobile backdrop (opaque on mobile screens so drawer is readable) */}
      <div
        className="md:hidden absolute inset-0 bg-slate-900/50 pointer-events-auto"
        onClick={onClose}
      />

      {/* Half-screen Drawer Container: 1/2 screen on desktop (customizable 30%-85%), interactive drawing on left */}
      <div
        style={
          isDesktop && !isFullScreen
            ? { width: `${drawerWidthPercent}%` }
            : undefined
        }
        className={`pointer-events-auto absolute inset-y-0 right-0 bg-white shadow-2xl border-l border-slate-300 flex flex-col h-full z-50 ${
          isFullScreen ? 'w-full' : 'w-full md:w-1/2 lg:w-1/2 xl:w-1/2'
        } ${isResizingDrawer ? 'select-none transition-none' : 'transition-[width] duration-150'}`}
      >
        {/* Invisible overlay while resizing to prevent mouse capture by iframes/SVGs */}
        {isResizingDrawer && (
          <div className="fixed inset-0 z-50 cursor-col-resize select-none pointer-events-auto" />
        )}

        {/* Draggable Left Resize Handle */}
        {isDesktop && !isFullScreen && (
          <div
            onMouseDown={handleResizeMouseDown}
            onDoubleClick={() => {
              setDrawerWidthPercent(50);
              onDrawerWidthChange?.(50);
              try {
                localStorage.setItem('sample_tracking_calc_drawer_width', '50');
              } catch (_) {}
            }}
            className="absolute left-0 top-0 bottom-0 w-3.5 -ml-2 cursor-col-resize z-50 group flex items-center justify-center hover:bg-blue-500/20 active:bg-blue-500/30 transition select-none"
            title="Kéo sang trái/phải để điều chỉnh độ rộng giữa bản vẽ và máy tính (30% - 85%) • Nhấp đúp để chia đôi 50/50"
            data-testid="calculator-resize-handle"
          >
            <div className="w-1.5 h-16 rounded-full bg-slate-300 group-hover:bg-blue-500 group-hover:h-24 transition-all duration-150 flex items-center justify-center shadow-xs">
              <div className="w-0.5 h-8 bg-white/80 rounded-full" />
            </div>
          </div>
        )}
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 text-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-600/30 rounded-lg border border-blue-400/30">
              <Calculator className="w-4 h-4 text-blue-300" />
            </div>
            <div>
              <h3 className="font-bold text-xs sm:text-sm flex items-center gap-1.5 flex-wrap">
                <span>Tính toán thời gian chu kỳ (Cycle Time)</span>
                {readOnly ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/40">
                    Chế độ xem lại (Chỉ đọc)
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-200 border border-blue-400/30 font-normal">
                    R1.1
                  </span>
                )}
              </h3>
              <p className="text-[10px] text-slate-300">
                Công đoạn: <strong>OP{operationStepOrder}</strong> • Tổ máy:{' '}
                <strong>{workcenterCode}</strong> • Chế độ 1/2 màn hình (xem kèm bản vẽ)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Toggle 1/2 screen vs Fullscreen */}
            <button
              type="button"
              onClick={() => setIsFullScreen((prev) => !prev)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded-lg transition cursor-pointer hidden md:flex items-center gap-1 text-[11px]"
              title={isFullScreen ? 'Thu gọn về 1/2 màn hình (để xem bản vẽ song song)' : 'Mở rộng toàn màn hình'}
              data-testid="toggle-fullscreen-btn"
            >
              {isFullScreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span className="hidden xl:inline text-[10px]">1/2 màn hình</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span className="hidden xl:inline text-[10px]">Toàn màn hình</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded-lg transition cursor-pointer"
              title="Đóng cửa sổ"
              data-testid="close-calc-modal-btn"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Legend / Quick Guide Banner */}
        <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600 flex-shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-slate-300 border border-slate-400" />
              <span>Chữ thường: Kỹ sư nhập</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-600" />
              <span className="font-bold text-blue-900">In đậm: Tự động tính</span>
            </div>
            <div className="flex items-center gap-1">
              <Lock className="w-2.5 h-2.5 text-amber-600" />
              <span>Khóa biến cố định</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-2.5 h-2.5 text-emerald-600" />
              <span>Passes: Số lẻ (1.3, 1.5, 1.75...)</span>
            </div>
          </div>

          <div className="text-[10px] text-slate-500 font-mono italic hidden sm:block">
            Vc = π·D·N/1000 • F = N·Z·Fz • CT = L·Passes·60/F
          </div>
        </div>

        {/* Global Conflict Warning if any */}
        {state.globalConflict && (
          <div
            className="mx-4 mt-2.5 p-2.5 bg-amber-50 border border-amber-300 rounded-lg text-amber-900 flex items-start gap-2 text-xs flex-shrink-0"
            data-testid="calc-conflict-banner"
          >
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Cảnh báo xung đột khóa: </span>
              <span>{state.globalConflict}</span>
            </div>
          </div>
        )}

        {/* Spreadsheet Grid Table (Single Unified Tab) with Mouse Drag-to-Pan */}
        <div
          ref={tableScrollContainerRef}
          onMouseDown={handleTablePanMouseDown}
          onWheel={handleTableWheel}
          className={`p-3 sm:p-4 overflow-x-auto overflow-y-auto flex-1 text-slate-800 text-xs ${
            isTablePanning
              ? 'cursor-grabbing select-none'
              : activePan
              ? 'cursor-grab select-none'
              : 'cursor-grab'
          } [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:bg-slate-400 hover:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded-full`}
          style={{
            scrollbarWidth: 'auto',
            scrollbarColor: '#94a3b8 #f1f5f9',
          }}
          data-testid="calculator-table-scroll-container"
        >
          <div className="border border-slate-200 rounded-xl shadow-xs overflow-hidden bg-white min-w-full inline-block">
            <table
              className={`w-full text-left border-collapse min-w-[1120px] ${
                activePan ? 'pointer-events-none select-none' : ''
              }`}
            >
              <thead>
                <tr className="bg-slate-100/90 text-slate-700 text-[10px] font-bold uppercase tracking-wider border-b border-slate-200 select-none cursor-grab">
                  <th className="py-2 px-2 w-16 text-center">T</th>
                  <th className="py-2 px-2 min-w-[140px] w-48 text-left">
                    <div className="flex items-center gap-1">
                      <span>Description</span>
                      <span className="text-[9px] text-slate-400 font-normal">Nội dung</span>
                    </div>
                  </th>
                  <th className="py-2 px-2 w-24">Phương pháp</th>
                  <th className="py-2 px-2 w-24 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span>D (mm)</span>
                      <span className="text-[9px] text-slate-400 font-normal">Ø</span>
                    </div>
                  </th>
                  <th className="py-2 px-2 w-24 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span>Vc (m/p)</span>
                      <span className="text-[9px] text-slate-400 font-normal">Cắt</span>
                    </div>
                  </th>
                  <th className="py-2 px-2 w-26 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span>N (v/p)</span>
                      <span className="text-[9px] text-slate-400 font-normal">Trục</span>
                    </div>
                  </th>
                  <th className="py-2 px-2 w-20 text-center">Dao (Z/P)</th>
                  <th className="py-2 px-2 w-22 text-center">Tiến (Fz/Fn)</th>
                  <th className="py-2 px-2 w-26 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span>F (mm/p)</span>
                      <span className="text-[9px] text-slate-400 font-normal">Bàn</span>
                    </div>
                  </th>
                  <th className="py-2 px-2 w-20 text-center">L (mm)</th>
                  <th className="py-2 px-2 w-20 text-center">Passes</th>
                  <th className="py-2 px-3 w-28 text-center text-blue-900 bg-blue-50/60 font-bold rounded-tr-lg">
                    TG cắt (s)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150">
                {state.cuts.map((cut, idx) => {
                  const isTapping = cut.machiningType === 'tapping';
                  const isTurning = isSingleEdgeTurningType(cut.machiningType);
                  const dCalculated = cut.diameter.source === 'calculated';
                  const vcCalculated = cut.cuttingSpeed.source === 'calculated';
                  const nCalculated = cut.spindleSpeed.source === 'calculated';
                  const fCalculated = cut.feedRate.source === 'calculated';
                  const fzCalculated = cut.feedPerTooth.source === 'calculated';

                  return (
                    <tr
                      key={cut.id}
                      className="hover:bg-blue-50/30 transition-colors group"
                      data-testid={`cut-row-${idx}`}
                    >
                      {/* Tool Code / T */}
                      <td className="py-2 px-1 text-center">
                        <div className="relative flex items-center justify-center group/tool">
                          <input
                            type="text"
                            value={cut.name}
                            disabled={readOnly}
                            onChange={(e) => handleCutNameChange(idx, e.target.value)}
                            placeholder={`T${String(idx + 1).padStart(2, '0')}`}
                            className="w-full px-1.5 py-1 text-center font-mono font-bold text-xs border border-slate-200 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:bg-slate-100 disabled:text-slate-600"
                            data-testid={`cut-name-input-${idx}`}
                          />
                          {!readOnly && state.cuts.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCutRow(idx)}
                              title={`Xóa dao ${cut.name || `T${idx + 1}`}`}
                              className="hidden group-hover/tool:inline-flex absolute -left-1.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded-full shadow-xs transition cursor-pointer z-10"
                              data-testid={`delete-cut-btn-${idx}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Description (Ghi tự do nội dung gia công) */}
                      <td className="py-2 px-1">
                        <input
                          type="text"
                          value={cut.description || ''}
                          disabled={readOnly}
                          onChange={(e) => handleCutDescriptionChange(idx, e.target.value)}
                          placeholder="Nội dung gia công..."
                          className="w-full px-2 py-1 text-xs border border-slate-200 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:bg-slate-100 disabled:text-slate-600 placeholder:text-slate-400"
                          data-testid={`cut-description-input-${idx}`}
                          title={cut.description || 'Nội dung gia công (ghi tự do)'}
                        />
                      </td>

                      {/* Machining Type Select */}
                      <td className="py-2 px-1">
                        <select
                          value={cut.machiningType}
                          disabled={readOnly}
                          onChange={(e) =>
                            handleMachiningTypeChange(idx, e.target.value as MachiningType)
                          }
                          className="w-full px-1.5 py-1 text-xs border border-slate-200 rounded-md bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-semibold text-slate-700 disabled:bg-slate-100 disabled:text-slate-600"
                          data-testid={`machining-type-select-${idx}`}
                        >
                          <option value="turning">Turning</option>
                          <option value="facing">Facing</option>
                          <option value="thread_turn">Thread turn</option>
                          <option value="part_off">Part off</option>
                          <option value="grooving">Grooving</option>
                          <option value="drilling">Drilling</option>
                          <option value="centering">Centering</option>
                          <option value="boring">Boring</option>
                          <option value="tapping">Tapping</option>
                          <option value="milling">Milling</option>
                          <option value="chamfering">Chamfering</option>
                          <option value="rolling">Rolling</option>
                          <option value="reaming">Reaming</option>
                        </select>
                      </td>

                      {/* Diameter D */}
                      <td className="py-2 px-1">
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            step="any"
                            value={getInputValue(
                              `${cut.id}-diameter`,
                              cut.diameter.value,
                              cut.diameter.source
                            )}
                            disabled={cut.diameter.locked || readOnly}
                            onChange={(e) => handleDVcNChange(idx, 'diameter', e.target.value)}
                            placeholder="D"
                            className={`w-full pl-1.5 pr-5 py-1 text-center font-mono text-xs border rounded-md focus:ring-1 focus:ring-blue-500 ${
                              cut.diameter.locked
                                ? 'bg-amber-50/50 border-amber-300 text-amber-900 cursor-not-allowed'
                                : dCalculated
                                ? 'font-bold text-blue-900 bg-blue-50/60 border-blue-300'
                                : readOnly
                                ? 'bg-slate-50 text-slate-700 border-slate-200'
                                : 'font-normal text-slate-800 border-slate-200 bg-white'
                            }`}
                            data-testid={`input-diameter-${idx}`}
                          />
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => handleToggleLock(idx, 'diameter')}
                              title={cut.diameter.locked ? 'Mở khóa đường kính D' : 'Khóa đường kính D'}
                              className={`absolute right-0.5 p-0.5 rounded transition ${
                                cut.diameter.locked
                                  ? 'text-amber-600 hover:text-amber-700 bg-amber-100/60'
                                  : 'text-slate-300 hover:text-slate-600'
                              }`}
                              data-testid={`lock-diameter-btn-${idx}`}
                            >
                              {cut.diameter.locked ? (
                                <Lock className="w-3 h-3" />
                              ) : (
                                <Unlock className="w-3 h-3 opacity-60" />
                              )}
                            </button>
                          )}
                          {readOnly && cut.diameter.locked && (
                            <span className="absolute right-1 text-amber-600">
                              <Lock className="w-2.5 h-2.5" />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Cutting Speed Vc */}
                      <td className="py-2 px-1">
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            step="any"
                            value={getInputValue(
                              `${cut.id}-cuttingSpeed`,
                              cut.cuttingSpeed.value,
                              cut.cuttingSpeed.source
                            )}
                            disabled={cut.cuttingSpeed.locked || readOnly}
                            onChange={(e) => handleDVcNChange(idx, 'cuttingSpeed', e.target.value)}
                            placeholder="Vc"
                            className={`w-full pl-1.5 pr-5 py-1 text-center font-mono text-xs border rounded-md focus:ring-1 focus:ring-blue-500 ${
                              cut.cuttingSpeed.locked
                                ? 'bg-amber-50/50 border-amber-300 text-amber-900 cursor-not-allowed'
                                : vcCalculated
                                ? 'font-bold text-blue-900 bg-blue-50/60 border-blue-300'
                                : readOnly
                                ? 'bg-slate-50 text-slate-700 border-slate-200'
                                : 'font-normal text-slate-800 border-slate-200 bg-white'
                            }`}
                            data-testid={`input-cuttingSpeed-${idx}`}
                          />
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => handleToggleLock(idx, 'cuttingSpeed')}
                              title={cut.cuttingSpeed.locked ? 'Mở khóa Vc' : 'Khóa Vc'}
                              className={`absolute right-0.5 p-0.5 rounded transition ${
                                cut.cuttingSpeed.locked
                                  ? 'text-amber-600 hover:text-amber-700 bg-amber-100/60'
                                  : 'text-slate-300 hover:text-slate-600'
                              }`}
                              data-testid={`lock-cuttingSpeed-btn-${idx}`}
                            >
                              {cut.cuttingSpeed.locked ? (
                                <Lock className="w-3 h-3" />
                              ) : (
                                <Unlock className="w-3 h-3 opacity-60" />
                              )}
                            </button>
                          )}
                          {readOnly && cut.cuttingSpeed.locked && (
                            <span className="absolute right-1 text-amber-600">
                              <Lock className="w-2.5 h-2.5" />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Spindle Speed N */}
                      <td className="py-2 px-1">
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            step="any"
                            value={getInputValue(
                              `${cut.id}-spindleSpeed`,
                              cut.spindleSpeed.value,
                              cut.spindleSpeed.source,
                              1
                            )}
                            disabled={cut.spindleSpeed.locked || readOnly}
                            onChange={(e) => handleDVcNChange(idx, 'spindleSpeed', e.target.value)}
                            placeholder="N (rpm)"
                            className={`w-full pl-1.5 pr-5 py-1 text-center font-mono text-xs border rounded-md focus:ring-1 focus:ring-blue-500 ${
                              cut.spindleSpeed.locked
                                ? 'bg-amber-50/50 border-amber-300 text-amber-900 cursor-not-allowed'
                                : nCalculated
                                ? 'font-bold text-blue-900 bg-blue-50/60 border-blue-300'
                                : readOnly
                                ? 'bg-slate-50 text-slate-700 border-slate-200'
                                : 'font-normal text-slate-800 border-slate-200 bg-white'
                            }`}
                            data-testid={`input-spindleSpeed-${idx}`}
                          />
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => handleToggleLock(idx, 'spindleSpeed')}
                              title={cut.spindleSpeed.locked ? 'Mở khóa N' : 'Khóa N'}
                              className={`absolute right-0.5 p-0.5 rounded transition ${
                                cut.spindleSpeed.locked
                                  ? 'text-amber-600 hover:text-amber-700 bg-amber-100/60'
                                  : 'text-slate-300 hover:text-slate-600'
                              }`}
                              data-testid={`lock-spindleSpeed-btn-${idx}`}
                            >
                              {cut.spindleSpeed.locked ? (
                                <Lock className="w-3 h-3" />
                              ) : (
                                <Unlock className="w-3 h-3 opacity-60" />
                              )}
                            </button>
                          )}
                          {readOnly && cut.spindleSpeed.locked && (
                            <span className="absolute right-1 text-amber-600">
                              <Lock className="w-2.5 h-2.5" />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Tool Z (Teeth) or Pitch P (Tapping) */}
                      <td className="py-2 px-1">
                        {isTapping ? (
                          <div className="flex items-center">
                            <span className="text-[9px] text-slate-400 font-bold mr-1">P:</span>
                            <input
                              type="number"
                              step="any"
                              disabled={readOnly}
                              value={getInputValue(
                                `${cut.id}-threadPitch`,
                                cut.threadPitch.value,
                                cut.threadPitch.source,
                                3
                              )}
                              onChange={(e) => handleFeedChange(idx, 'threadPitch', e.target.value)}
                              placeholder="Pitch"
                              className="w-full px-1 py-1 text-center font-mono text-xs border border-slate-200 rounded-md bg-white focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-700"
                              data-testid={`input-threadPitch-${idx}`}
                            />
                          </div>
                        ) : isTurning ? (
                          <div className="flex items-center">
                            <span className="text-[9px] text-slate-400 font-bold mr-1">Z:</span>
                            <div
                              title="Nhóm tiện (Turning, Facing, Thread turn, Part off, Grooving): Cố định Z = 1 lưỡi cắt đơn, khóa để tránh sai sót"
                              className="w-full px-1 py-1 text-center font-mono font-bold text-xs bg-slate-100 border border-slate-200 rounded-md text-slate-500 flex items-center justify-center gap-1 select-none cursor-not-allowed"
                              data-testid={`input-teethCount-${idx}`}
                            >
                              <span>1</span>
                              <Lock className="w-2.5 h-2.5 text-slate-400" />
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center">
                            <span className="text-[9px] text-slate-400 font-bold mr-1">Z:</span>
                            <input
                              type="number"
                              min="1"
                              disabled={readOnly}
                              value={getInputValue(
                                `${cut.id}-teethCount`,
                                cut.teethCount.value,
                                cut.teethCount.source,
                                0
                              )}
                              onChange={(e) => handleFeedChange(idx, 'teethCount', e.target.value)}
                              placeholder="1"
                              className="w-full px-1 py-1 text-center font-mono text-xs border border-slate-200 rounded-md bg-white focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-700"
                              data-testid={`input-teethCount-${idx}`}
                            />
                          </div>
                        )}
                      </td>

                      {/* Feed per tooth Fz / per rev Fn */}
                      <td className="py-2 px-1">
                        {cut.machiningType === 'milling' ? (
                          <div className="flex items-center">
                            <span className="text-[9px] text-slate-400 font-bold mr-1">Fz:</span>
                            <input
                              type="number"
                              step="any"
                              disabled={cut.feedPerTooth.locked || readOnly}
                              value={getInputValue(
                                `${cut.id}-feedPerTooth`,
                                cut.feedPerTooth.value,
                                cut.feedPerTooth.source,
                                3
                              )}
                              onChange={(e) => handleFeedChange(idx, 'feedPerTooth', e.target.value)}
                              placeholder="0.05"
                              className={`w-full px-1 py-1 text-center font-mono text-xs border rounded-md focus:ring-1 focus:ring-blue-500 ${
                                cut.feedPerTooth.locked
                                  ? 'bg-amber-50/50 border-amber-300 text-amber-900 cursor-not-allowed'
                                  : fzCalculated
                                  ? 'font-bold text-blue-900 bg-blue-50/60 border-blue-300'
                                  : readOnly
                                  ? 'bg-slate-50 text-slate-700 border-slate-200'
                                  : 'font-normal text-slate-800 border-slate-200 bg-white'
                              }`}
                              data-testid={`input-feedPerTooth-${idx}`}
                            />
                          </div>
                        ) : isTapping ? (
                          <span className="text-center block text-slate-400 italic font-mono text-[10px]">
                            = Pitch
                          </span>
                        ) : (
                          <div className="flex items-center">
                            <span className="text-[9px] text-slate-400 font-bold mr-1">Fn:</span>
                            <input
                              type="number"
                              step="any"
                              disabled={readOnly}
                              value={getInputValue(
                                `${cut.id}-feedPerRev`,
                                cut.feedPerRev.value,
                                cut.feedPerRev.source,
                                3
                              )}
                              onChange={(e) => handleFeedChange(idx, 'feedPerRev', e.target.value)}
                              placeholder="0.1"
                              className="w-full px-1 py-1 text-center font-mono text-xs border border-slate-200 rounded-md bg-white focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-700"
                              data-testid={`input-feedPerRev-${idx}`}
                            />
                          </div>
                        )}
                      </td>

                      {/* Table Feed Rate F (mm/min) */}
                      <td className="py-2 px-1">
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            step="any"
                            value={getInputValue(
                              `${cut.id}-feedRate`,
                              cut.feedRate.value,
                              cut.feedRate.source,
                              1
                            )}
                            disabled={cut.feedRate.locked || readOnly}
                            onChange={(e) => handleFeedChange(idx, 'feedRate', e.target.value)}
                            placeholder="F"
                            className={`w-full pl-1.5 pr-5 py-1 text-center font-mono text-xs border rounded-md focus:ring-1 focus:ring-blue-500 ${
                              cut.feedRate.locked
                                ? 'bg-amber-50/50 border-amber-300 text-amber-900 cursor-not-allowed'
                                : fCalculated
                                ? 'font-bold text-blue-900 bg-blue-50/60 border-blue-300'
                                : readOnly
                                ? 'bg-slate-50 text-slate-700 border-slate-200'
                                : 'font-normal text-slate-800 border-slate-200 bg-white'
                            }`}
                            data-testid={`input-feedRate-${idx}`}
                          />
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => handleToggleLock(idx, 'feedRate')}
                              title={cut.feedRate.locked ? 'Mở khóa F' : 'Khóa F'}
                              className={`absolute right-0.5 p-0.5 rounded transition ${
                                cut.feedRate.locked
                                  ? 'text-amber-600 hover:text-amber-700 bg-amber-100/60'
                                  : 'text-slate-300 hover:text-slate-600'
                              }`}
                              data-testid={`lock-feedRate-btn-${idx}`}
                            >
                              {cut.feedRate.locked ? (
                                <Lock className="w-3 h-3" />
                              ) : (
                                <Unlock className="w-3 h-3 opacity-60" />
                              )}
                            </button>
                          )}
                          {readOnly && cut.feedRate.locked && (
                            <span className="absolute right-1 text-amber-600">
                              <Lock className="w-2.5 h-2.5" />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Cut Length L */}
                      <td className="py-2 px-1">
                        <input
                          type="number"
                          step="any"
                          disabled={readOnly}
                          value={getInputValue(
                            `${cut.id}-length`,
                            cut.length.value,
                            cut.length.source
                          )}
                          onChange={(e) => handleLengthChange(idx, e.target.value)}
                          placeholder="L (mm)"
                          className="w-full px-1.5 py-1 text-center font-mono text-xs border border-slate-200 rounded-md bg-white focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-700"
                          data-testid={`input-length-${idx}`}
                        />
                      </td>

                      {/* Passes (Decimal Passes: 1, 1.3, 1.5, 1.75, 2.25) */}
                      <td className="py-2 px-1">
                        <input
                          type="number"
                          step="any"
                          disabled={readOnly}
                          value={getInputValue(
                            `${cut.id}-passes`,
                            cut.passes.value,
                            cut.passes.source
                          )}
                          onChange={(e) => handlePassesChange(idx, e.target.value)}
                          placeholder="1"
                          className="w-full px-1.5 py-1 text-center font-mono text-xs border border-slate-200 rounded-md bg-white focus:ring-1 focus:ring-blue-500 font-semibold disabled:bg-slate-50 disabled:text-slate-700"
                          data-testid={`input-passes-${idx}`}
                        />
                      </td>

                      {/* Cutting Time CT (Real-time Instant Result) */}
                      <td className="py-2 px-2 text-center bg-blue-50/40">
                        <span
                          className="inline-block px-1.5 py-0.5 rounded font-mono font-bold text-xs text-blue-900 bg-blue-100/70 border border-blue-200/80"
                          data-testid={`cutting-time-cell-${idx}`}
                        >
                          {cut.cuttingTimeSeconds !== null && cut.cuttingTimeSeconds !== undefined
                            ? `${cut.cuttingTimeSeconds.toFixed(2)} s`
                            : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Add / Remove Cut Buttons */}
          <div className="mt-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {!readOnly && (
                <button
                  type="button"
                  onClick={handleAddCutRow}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg text-xs transition border border-blue-200 shadow-2xs cursor-pointer"
                  data-testid="add-cut-row-btn"
                >
                  <Plus className="w-3.5 h-3.5 text-blue-600" />
                  <span>Thêm dao (T)</span>
                </button>
              )}
              {!readOnly && state.cuts.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleDeleteCutRow(state.cuts.length - 1)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 font-medium rounded-lg text-xs transition border border-slate-200 cursor-pointer"
                  data-testid="delete-last-cut-btn"
                  title="Xóa dao cuối cùng"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Xóa dao cuối</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Hand Tool / Pan Mode Toggle Button */}
              <button
                type="button"
                onClick={() => setIsPanMode((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition border cursor-pointer ${
                  isPanMode
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs ring-2 ring-blue-400/40'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                }`}
                title="Bật/Tắt chế độ kéo bảng (hoặc giữ phím Space / phím chuột giữa để kéo từ bất cứ đâu)"
                data-testid="toggle-pan-mode-btn"
              >
                <Hand className="w-3.5 h-3.5" />
                <span>{isPanMode ? 'Đang kéo bảng (Pan)' : 'Kéo bảng (Pan)'}</span>
              </button>

              {/* Quick horizontal scroll buttons */}
              <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200 shadow-2xs">
                <button
                  type="button"
                  onClick={() => scrollTableTo('start')}
                  className="p-1 hover:bg-white text-slate-600 hover:text-blue-700 active:scale-95 rounded transition cursor-pointer"
                  title="Về đầu bảng (cột T, Description, D)"
                  data-testid="scroll-table-start-btn"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollTableBy(-280)}
                  className="p-1 hover:bg-white text-slate-600 hover:text-blue-700 active:scale-95 rounded transition cursor-pointer"
                  title="Cuộn sang trái (hoặc lăn con trỏ chuột)"
                  data-testid="scroll-table-left-btn"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[10px] text-slate-500 px-1 font-medium select-none">Cuộn bảng</span>
                <button
                  type="button"
                  onClick={() => scrollTableBy(280)}
                  className="p-1 hover:bg-white text-slate-600 hover:text-blue-700 active:scale-95 rounded transition cursor-pointer"
                  title="Cuộn sang phải (hoặc lăn con trỏ chuột)"
                  data-testid="scroll-table-right-btn"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollTableTo('end')}
                  className="p-1 hover:bg-white text-slate-600 hover:text-blue-700 active:scale-95 rounded transition cursor-pointer"
                  title="Đến cuối bảng (cột F, L, Passes, TG cắt)"
                  data-testid="scroll-table-end-btn"
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>

              <span className="text-[11px] text-slate-400 italic">
                * {state.cuts.length} dao trong OP{operationStepOrder}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Footer / Real-time Summary Bar */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            {!readOnly && (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 rounded-lg text-xs font-medium transition cursor-pointer"
                title="Đặt lại bảng tính về ban đầu"
                data-testid="reset-calc-btn"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Đặt lại</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:gap-5 flex-1 justify-end">
            {/* Non-cutting time and Non-cutting note */}
            <div className="flex items-center gap-2.5 flex-wrap flex-1 max-w-xl">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="non-cutting-input"
                  className="text-xs font-medium text-slate-600 flex items-center gap-1 whitespace-nowrap"
                >
                  <span>Thời gian phụ:</span>
                </label>
                <div className="relative w-20">
                  <input
                    id="non-cutting-input"
                    type="number"
                    step="any"
                    min="0"
                    disabled={readOnly}
                    value={
                      inputBuffers.nonCuttingTime !== undefined
                        ? inputBuffers.nonCuttingTime
                        : state.nonCuttingTimeSeconds
                    }
                    onChange={(e) => handleNonCuttingChange(e.target.value)}
                    placeholder="0"
                    className="w-full px-1.5 py-1 text-center font-mono font-semibold text-xs border border-slate-300 rounded-md bg-white focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-600"
                    data-testid="input-nonCuttingTime"
                  />
                  <span className="absolute right-1.5 top-1 text-[10px] text-slate-400">s</span>
                </div>
              </div>

              {/* Non-cutting Time Note */}
              <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                <label
                  htmlFor="non-cutting-note-input"
                  className="text-xs font-medium text-slate-600 whitespace-nowrap"
                >
                  <span>Ghi chú TG phụ:</span>
                </label>
                <input
                  id="non-cutting-note-input"
                  type="text"
                  disabled={readOnly}
                  value={state.nonCuttingTimeNote || ''}
                  onChange={(e) => handleNonCuttingNoteChange(e.target.value)}
                  placeholder="Ghi chú thời gian phụ (gá đặt, đo kiểm, thay dao...)"
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded-md bg-white focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-600 font-normal"
                  data-testid="input-nonCuttingTimeNote"
                />
              </div>
            </div>

            {/* Total Cutting Time */}
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
                Tổng TG cắt
              </div>
              <div
                className="font-mono text-xs font-bold text-slate-700"
                data-testid="calc-cutting-time-display"
              >
                {state.totalCuttingTimeSeconds > 0
                  ? `${state.totalCuttingTimeSeconds.toFixed(2)} s`
                  : '—'}
              </div>
            </div>

            {/* Total Cycle Time Highlight Badge */}
            <div className="px-3 py-1 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-300/80 rounded-xl flex items-center gap-2 shadow-2xs">
              <Clock className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
              <div>
                <div className="text-[9px] uppercase tracking-wider font-bold text-emerald-800">
                  Total CT
                </div>
                <div
                  className="text-sm font-mono font-bold text-emerald-950"
                  data-testid="calc-total-ct-display"
                >
                  {state.totalCycleTimeSeconds > 0
                    ? `${state.totalCycleTimeSeconds.toFixed(2)} s`
                    : '—'}
                </div>
              </div>
            </div>

            {/* Save Success Toast */}
            {saveSuccessMessage && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-md text-xs font-bold animate-in fade-in duration-150">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Đã lưu tính toán!</span>
              </span>
            )}

            {/* Buttons */}
            <div className="flex items-center gap-2">
              {!readOnly ? (
                <>
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 shadow-2xs cursor-pointer"
                    data-testid="save-calc-draft-btn"
                    title="Lưu lại bảng tính toán hiện tại (kể cả khi tính toán dang dở) để tiếp tục sau"
                  >
                    <Save className="w-3.5 h-3.5 text-blue-600" />
                    <span>Lưu tính toán</span>
                  </button>

                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-lg transition cursor-pointer"
                    data-testid="cancel-calc-btn"
                  >
                    Đóng
                  </button>

                  <button
                    type="button"
                    onClick={handleApply}
                    disabled={!state.totalCycleTimeSeconds || state.totalCycleTimeSeconds <= 0}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer ${
                      state.totalCycleTimeSeconds && state.totalCycleTimeSeconds > 0
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                    data-testid="apply-calc-to-op-btn"
                    title="Áp dụng thời gian Total CT vào công đoạn"
                  >
                    <span>Áp dụng</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition shadow-xs cursor-pointer"
                  data-testid="close-readonly-calc-btn"
                >
                  Đóng
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import type { DrawingReviewVersion, DrawingReviewOperation } from '../../types/database.types';
import { isSubconWorkcenter } from '../../services/drawingReviewService';
import type { WorkcenterOption } from '../jobs/jobDisplayUtils';
import {
  Plus,
  Trash2,
  RotateCcw,
  MessageSquare,
  Calculator,
} from 'lucide-react';
import { CycleTimeCalculatorModal } from './CycleTimeCalculatorModal';
import {
  serializeMultiCutState,
} from '../../lib/cycleTimeEngine';

export interface PreliminaryRoutingMatrixProps {
  allVersions: Array<DrawingReviewVersion & { operations?: DrawingReviewOperation[] }>;
  currentVersionId: string;
  operations: Array<{
    id?: string;
    lineage_id: string;
    step_order: number;
    workcenter_code: string;
    operation_description?: string;
    cycle_time_seconds?: number | null;
    remark?: string;
    is_removed?: boolean;
    calculation_data?: any;
  }>;
  onChangeOperations: (
    newOps: Array<{
      id?: string;
      lineage_id: string;
      step_order: number;
      workcenter_code: string;
      operation_description?: string;
      cycle_time_seconds?: number | null;
      remark?: string;
      is_removed?: boolean;
      calculation_data?: any;
    }>
  ) => void;
  workcenterOptions: WorkcenterOption[];
  isEditable: boolean;
  onCalculatorStateChange?: (isOpen: boolean, isFullScreen: boolean, drawerWidthPercent: number) => void;
}

export const PreliminaryRoutingMatrix: React.FC<PreliminaryRoutingMatrixProps> = ({
  allVersions,
  currentVersionId,
  operations,
  onChangeOperations,
  workcenterOptions,
  isEditable,
  onCalculatorStateChange,
}) => {
  // Sort versions by version_number ascending
  const sortedVersions = [...allVersions].sort((a, b) => a.version_number - b.version_number);
  const versionNames = sortedVersions.map((v) => v.version_name);
  const currentVersion = sortedVersions.find((v) => v.id === currentVersionId);
  const currentVersionName = currentVersion?.version_name || 'V1';

  // Toggle remark visibility state per operation lineage_id
  const [expandedRemarks, setExpandedRemarks] = useState<Record<string, boolean>>({});

  // Active Cycle Time Calculator operation index
  const [calcModalIndex, setCalcModalIndex] = useState<number | null>(null);

  // Historical Cycle Time Calculator modal state
  const [historicalCalcModal, setHistoricalCalcModal] = useState<{
    vName: string;
    stepOrder: number;
    workcenterCode: string;
    calculationData: any;
    cycleTime: number | null | undefined;
    lineageId: string;
  } | null>(null);

  // Cycle Time Calculator drawer width & fullscreen state tracking
  const [calcDrawerWidth, setCalcDrawerWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('sample_tracking_calc_drawer_width');
      if (saved) {
        const parsed = parseFloat(saved);
        if (parsed >= 30 && parsed <= 85) return parsed;
      }
    } catch (_) {}
    return 50;
  });
  const [calcIsFullScreen, setCalcIsFullScreen] = useState(false);

  const onCalculatorStateChangeRef = useRef(onCalculatorStateChange);
  useEffect(() => {
    onCalculatorStateChangeRef.current = onCalculatorStateChange;
  }, [onCalculatorStateChange]);

  useEffect(() => {
    const isAnyModalOpen = calcModalIndex !== null || historicalCalcModal !== null;
    onCalculatorStateChangeRef.current?.(isAnyModalOpen, calcIsFullScreen, calcDrawerWidth);
  }, [calcModalIndex, historicalCalcModal, calcIsFullScreen, calcDrawerWidth]);

  const toggleRemark = (lineageId: string) => {
    setExpandedRemarks((prev) => ({
      ...prev,
      [lineageId]: !prev[lineageId],
    }));
  };

  // Map historical operations by lineage_id and version_name
  // To show historical cycle times and check if historical W/C changed
  const historicalMap = new Map<
    string,
    Record<
      string,
      {
        workcenter_code: string;
        operation_description?: string | null;
        cycle_time_seconds?: number | null;
        remark?: string | null;
        is_removed: boolean;
        calculation_data?: any;
      }
    >
  >();

  for (const ver of sortedVersions) {
    for (const op of ver.operations || []) {
      if (!historicalMap.has(op.lineage_id)) {
        historicalMap.set(op.lineage_id, {});
      }
      let calc = (op as any).calculation_data;
      if (!calc && op.lineage_id) {
        try {
          const cached = localStorage.getItem(`drawing_review_calc_${ver.id}_${op.lineage_id}`);
          if (cached) calc = JSON.parse(cached);
        } catch {}
      }
      historicalMap.get(op.lineage_id)![ver.version_name] = {
        workcenter_code: op.workcenter_code,
        operation_description: op.operation_description,
        cycle_time_seconds: op.cycle_time_seconds,
        remark: op.remark,
        is_removed: op.is_removed,
        calculation_data: calc || null,
      };
    }
  }

  // Handle operation change
  const handleOpFieldChange = (
    index: number,
    field: 'workcenter_code' | 'operation_description' | 'cycle_time_seconds' | 'remark',
    value: any
  ) => {
    if (!isEditable) return;
    const updated = [...operations];
    updated[index] = {
      ...updated[index],
      [field]: value,
    };
    onChangeOperations(updated);
  };

  // Insert operation between rows or at index
  const handleInsertOperation = (insertAtIndex: number) => {
    if (!isEditable) return;
    const newLineageId = crypto.randomUUID();
    const defaultWc = workcenterOptions[0]?.code || 'CAMC';
    const newOp = {
      lineage_id: newLineageId,
      step_order: (insertAtIndex + 1) * 10,
      workcenter_code: defaultWc,
      operation_description: '',
      cycle_time_seconds: null,
      remark: '',
      is_removed: false,
    };

    const updated = [...operations];
    updated.splice(insertAtIndex, 0, newOp);

    // Recalculate step_orders
    const reordered = updated.map((op, idx) => ({
      ...op,
      step_order: (idx + 1) * 10,
    }));

    // Auto expand remark for newly inserted op
    setExpandedRemarks((prev) => ({ ...prev, [newLineageId]: true }));
    onChangeOperations(reordered);
  };

  // Remove operation (sets is_removed = true, keeping historical data safe)
  const handleRemoveOperation = (index: number) => {
    if (!isEditable) return;
    const updated = [...operations];
    updated[index] = {
      ...updated[index],
      is_removed: true,
    };
    onChangeOperations(updated);
  };

  // Restore removed operation
  const handleRestoreOperation = (index: number) => {
    if (!isEditable) return;
    const updated = [...operations];
    updated[index] = {
      ...updated[index],
      is_removed: false,
    };
    onChangeOperations(updated);
  };

  // Calculate sequential OP display numbering (OP10, OP20...) only for active operations
  let opSeqCounter = 10;
  const displayNumbers: Record<string, string> = {};
  for (const op of operations) {
    if (!op.is_removed) {
      displayNumbers[op.lineage_id] = `OP${opSeqCounter}`;
      opSeqCounter += 10;
    }
  }

  return (
    <div className="space-y-4">
      {/* Table Container with horizontal scrolling */}
      <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white shadow-xs">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider">
              <th className="py-3 px-3 w-16 text-center">OP</th>
              <th className="py-3 px-4 min-w-[220px]">Work Center (W/C)</th>
              {versionNames.map((vName) => {
                const isCurrent = vName === currentVersionName;
                return (
                  <th
                    key={vName}
                    className={`py-3 px-3 text-center min-w-[100px] ${
                      isCurrent
                        ? 'bg-blue-50 text-blue-900 border-x border-blue-200 font-extrabold'
                        : 'text-slate-600 border-x border-slate-200 font-semibold'
                    }`}
                  >
                    <span>{vName} CT</span>
                    <span className="block text-[10px] lowercase text-slate-400 font-normal">
                      (sec/pc)
                    </span>
                  </th>
                );
              })}
              {isEditable && (
                <th className="py-3 px-3 w-24 text-center">Thao tác</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {operations.length === 0 ? (
              <tr>
                <td
                  colSpan={3 + versionNames.length + (isEditable ? 1 : 0)}
                  className="py-8 text-center text-slate-400 font-medium"
                >
                  Chưa có công đoạn nào trong quy trình sơ bộ.
                  {isEditable && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => handleInsertOperation(0)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Thêm công đoạn đầu tiên</span>
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              operations.map((op, idx) => {
                const isRemoved = Boolean(op.is_removed);
                const displayOp = displayNumbers[op.lineage_id] || '—';
                const isSubcon = isSubconWorkcenter(op.workcenter_code);
                const currentRemark = op.remark || (op as any).remarks || '';
                const isRemarkOpen = expandedRemarks[op.lineage_id] || Boolean(currentRemark.trim());
                const histInfo = historicalMap.get(op.lineage_id) || {};

                return (
                  <React.Fragment key={op.lineage_id || idx}>
                    {/* Operation Main Row */}
                    <tr
                      className={`transition ${
                        isRemoved
                          ? 'bg-rose-50/40 text-slate-400'
                          : 'hover:bg-slate-50/60 text-slate-800'
                      }`}
                    >
                      {/* 1. OP Sequence Number */}
                      <td className="py-2.5 px-3 text-center font-mono font-bold">
                        {isRemoved ? (
                          <span className="line-through text-slate-400">
                            {displayOp}
                          </span>
                        ) : (
                          <span className="text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                            {displayOp}
                          </span>
                        )}
                      </td>

                      {/* 2. Work Center & SUBCON Description */}
                      <td className="py-2.5 px-4 space-y-1.5">
                        {isEditable && !isRemoved ? (
                          <div>
                            <select
                              value={op.workcenter_code}
                              onChange={(e) =>
                                handleOpFieldChange(idx, 'workcenter_code', e.target.value)
                              }
                              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                              data-testid={`wc-select-${idx}`}
                            >
                              {workcenterOptions.map((wc) => (
                                <option key={wc.code} value={wc.code}>
                                  {wc.code} — {wc.description}
                                </option>
                              ))}
                            </select>

                            {/* SUBCON Operation Description Input */}
                            {isSubcon && (
                              <div className="mt-1.5">
                                <div className="flex items-center gap-1 mb-0.5">
                                  <span className="text-[11px] font-bold text-amber-900">
                                    Mô tả công đoạn gia công ngoài (SUBCON)
                                  </span>
                                  <span className="text-red-500 font-bold">*</span>
                                </div>
                                <input
                                  type="text"
                                  value={op.operation_description || ''}
                                  onChange={(e) =>
                                    handleOpFieldChange(
                                      idx,
                                      'operation_description',
                                      e.target.value
                                    )
                                  }
                                  placeholder="Bắt buộc: VD: Phun cát, Mạ kẽm, Đánh bóng..."
                                  className={`w-full px-2.5 py-1 border rounded-lg text-xs ${
                                    !op.operation_description?.trim()
                                      ? 'border-amber-400 bg-amber-50/40 focus:ring-amber-500'
                                      : 'border-slate-300 focus:ring-blue-500'
                                  }`}
                                  data-testid={`subcon-desc-input-${idx}`}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className={isRemoved ? 'line-through text-slate-400' : ''}>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">
                                {op.workcenter_code}
                              </span>
                              {isSubcon && (
                                <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded border border-amber-300">
                                  Gia công ngoài
                                </span>
                              )}
                            </div>
                            {isSubcon && op.operation_description && (
                              <p className="text-[11px] text-amber-900 mt-0.5 font-medium">
                                Chi tiết: {op.operation_description}
                              </p>
                            )}
                            {isRemoved && (
                              <span className="text-[10px] text-rose-600 font-semibold block mt-0.5">
                                [Đã xóa ở phiên bản này]
                              </span>
                            )}
                          </div>
                        )}

                        {/* Historical W/C change warning if historical W/C differs */}
                        {versionNames.length > 1 && (
                          <div className="text-[10px] text-slate-400 flex items-center gap-1">
                            {versionNames
                              .filter((vn) => vn !== currentVersionName && histInfo[vn])
                              .map((vn) => {
                                const prev = histInfo[vn];
                                if (prev.workcenter_code !== op.workcenter_code) {
                                  return (
                                    <span
                                      key={vn}
                                      className="text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200"
                                      title={`Ở phiên bản ${vn}, W/C là ${prev.workcenter_code}`}
                                    >
                                      {vn}: {prev.workcenter_code}
                                    </span>
                                  );
                                }
                                return null;
                              })}
                          </div>
                        )}
                      </td>

                      {/* 3. Cycle Time Columns per Version (V1 CT, V2 CT, V3 CT...) */}
                      {versionNames.map((vName) => {
                        const isCurrent = vName === currentVersionName;

                        if (isCurrent) {
                          // Current editable or current read-only
                          return (
                            <td
                              key={vName}
                              className="py-2.5 px-3 text-center bg-blue-50/40 border-x border-blue-200"
                            >
                              {isRemoved ? (
                                <span className="text-slate-400 font-mono">—</span>
                              ) : isEditable ? (
                                <div className="inline-flex items-center justify-center gap-1">
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={
                                      op.cycle_time_seconds !== null &&
                                      op.cycle_time_seconds !== undefined
                                        ? op.cycle_time_seconds
                                        : ''
                                    }
                                    onChange={(e) => {
                                      const val = e.target.value === '' ? null : Number(e.target.value);
                                      handleOpFieldChange(idx, 'cycle_time_seconds', val);
                                    }}
                                    placeholder="0"
                                    className="w-16 px-1.5 py-1 text-center font-mono font-bold border border-slate-300 rounded-lg text-xs bg-white text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                                    data-testid={`ct-input-${idx}`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setCalcModalIndex(idx)}
                                    title={
                                      op.calculation_data
                                        ? 'Bảng tính CT đã lưu (R1.1) • Nhấp để xem/sửa'
                                        : 'Mở máy tính thời gian chu kỳ (Cycle Time Calculator R1.1)'
                                    }
                                    className={`p-1 rounded transition cursor-pointer flex-shrink-0 ${
                                      op.calculation_data
                                        ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300'
                                        : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                                    }`}
                                    data-testid={`open-calc-btn-${idx}`}
                                  >
                                    <Calculator className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="inline-flex items-center justify-center gap-1">
                                  <span className="font-mono font-bold text-blue-900">
                                    {op.cycle_time_seconds !== null && op.cycle_time_seconds !== undefined
                                      ? op.cycle_time_seconds
                                      : '—'}
                                  </span>
                                  {(op.calculation_data || (op.cycle_time_seconds !== null && op.cycle_time_seconds !== undefined)) && (
                                    <button
                                      type="button"
                                      onClick={() => setCalcModalIndex(idx)}
                                      title="Xem lại chi tiết thông số chạy dao & thời gian chu kỳ"
                                      className="p-1 rounded text-blue-600 hover:bg-blue-100 cursor-pointer"
                                      data-testid={`view-calc-btn-${idx}`}
                                    >
                                      <Calculator className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        }

                        // Historical versions: strictly read-only
                        const histOp = histInfo[vName];
                        const ctVal =
                          histOp && !histOp.is_removed && histOp.cycle_time_seconds !== null
                            ? histOp.cycle_time_seconds
                            : undefined;

                        return (
                          <td
                            key={vName}
                            className="py-2.5 px-3 text-center border-x border-slate-200 font-mono text-slate-600 bg-slate-50/40"
                          >
                            {ctVal !== undefined ? (
                              <div className="inline-flex items-center justify-center gap-1">
                                <span className="font-semibold text-slate-700">
                                  {ctVal}
                                </span>
                                {(histOp?.calculation_data || ctVal !== undefined) && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setHistoricalCalcModal({
                                        vName,
                                        stepOrder: op.step_order,
                                        workcenterCode: histOp?.workcenter_code || op.workcenter_code,
                                        calculationData: histOp?.calculation_data,
                                        cycleTime: ctVal,
                                        lineageId: op.lineage_id,
                                      })
                                    }
                                    title={`Xem lại tính toán CT của phiên bản ${vName}`}
                                    className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer"
                                    data-testid={`view-hist-calc-btn-${idx}-${vName}`}
                                  >
                                    <Calculator className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-300 font-bold">—</span>
                            )}
                          </td>
                        );
                      })}

                      {/* 4. Action Buttons (Insert +, Remove, Restore) */}
                      {isEditable && (
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {isRemoved ? (
                              <button
                                type="button"
                                onClick={() => handleRestoreOperation(idx)}
                                title="Khôi phục công đoạn này"
                                className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded transition"
                                data-testid={`restore-op-btn-${idx}`}
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleInsertOperation(idx + 1)}
                                  title="Chèn công đoạn mới phía dưới"
                                  className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded transition"
                                  data-testid={`insert-op-btn-${idx}`}
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveOperation(idx)}
                                  title="Xóa công đoạn khỏi phiên bản này"
                                  className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition"
                                  data-testid={`remove-op-btn-${idx}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleRemark(op.lineage_id)}
                              title={isRemarkOpen ? 'Thu gọn ghi chú' : 'Mở rộng ghi chú'}
                              className={`p-1 rounded transition ${
                                currentRemark.trim()
                                  ? 'text-blue-600 hover:bg-blue-50'
                                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              <MessageSquare className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>

                    {/* Operation Remark Row (Always shown directly below the operation row) */}
                    <tr className="bg-slate-50/50 border-b border-slate-200">
                      <td className="py-1 px-3 text-right">
                        <span className="text-[10px] text-slate-400 uppercase font-semibold">
                          Ghi chú:
                        </span>
                      </td>
                      <td
                        colSpan={2 + versionNames.length + (isEditable ? 1 : 0)}
                        className="py-1.5 px-4 pr-6"
                      >
                        {isEditable && !isRemoved ? (
                          <textarea
                            rows={2}
                            value={currentRemark}
                            onChange={(e) =>
                              handleOpFieldChange(idx, 'remark', e.target.value)
                            }
                            placeholder="Nhập ghi chú kỹ thuật riêng cho công đoạn này (tự động mở rộng, lưu theo phiên bản)..."
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs leading-relaxed text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            data-testid={`remark-textarea-${idx}`}
                          />
                        ) : (
                          <div className="text-xs text-slate-700 bg-white/70 p-2 rounded border border-slate-200 whitespace-pre-line leading-relaxed font-sans">
                            {currentRemark.trim() || (
                              <span className="text-slate-400 italic">Không có ghi chú.</span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Insert at the end button */}
      {isEditable && operations.length > 0 && (
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => handleInsertOperation(operations.length)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 font-semibold rounded-lg text-xs transition border border-slate-300"
            data-testid="add-op-bottom-btn"
          >
            <Plus className="w-3.5 h-3.5 text-blue-600" />
            <span>Thêm công đoạn tiếp theo</span>
          </button>
          <span className="text-[11px] text-slate-500 italic">
            * Mỗi công đoạn lưu trữ ổn định theo Lineage ID qua các phiên bản V1, V2... Hỗ trợ máy tính CT R1.1.
          </span>
        </div>
      )}

      {/* Cycle Time Calculator Modal (R1.1) */}
      {calcModalIndex !== null && operations[calcModalIndex] && (
        <CycleTimeCalculatorModal
          isOpen={calcModalIndex !== null}
          onClose={() => setCalcModalIndex(null)}
          readOnly={!isEditable}
          onApply={(calculatedCt, calculationState) => {
            if (calcModalIndex === null) return;
            const serialized = serializeMultiCutState(calculationState);
            const targetLineageId = operations[calcModalIndex].lineage_id;
            try {
              localStorage.setItem(
                `drawing_review_calc_${currentVersionId}_${targetLineageId}`,
                JSON.stringify(serialized)
              );
            } catch {}
            const updated = [...operations];
            updated[calcModalIndex] = {
              ...updated[calcModalIndex],
              cycle_time_seconds: calculatedCt,
              calculation_data: serialized,
            };
            onChangeOperations(updated);
            setCalcModalIndex(null);
          }}
          onSaveDraft={(calculationState) => {
            if (calcModalIndex === null) return;
            const serialized = serializeMultiCutState(calculationState);
            const targetLineageId = operations[calcModalIndex].lineage_id;
            try {
              localStorage.setItem(
                `drawing_review_calc_${currentVersionId}_${targetLineageId}`,
                JSON.stringify(serialized)
              );
            } catch {}
            const updated = [...operations];
            const partialCt =
              calculationState.totalCycleTimeSeconds > 0
                ? parseFloat(calculationState.totalCycleTimeSeconds.toFixed(2))
                : updated[calcModalIndex].cycle_time_seconds;
            updated[calcModalIndex] = {
              ...updated[calcModalIndex],
              cycle_time_seconds: partialCt,
              calculation_data: serialized,
            };
            onChangeOperations(updated);
          }}
          initialState={
            operations[calcModalIndex].calculation_data ||
            (() => {
              try {
                const cached = localStorage.getItem(
                  `drawing_review_calc_${currentVersionId}_${operations[calcModalIndex].lineage_id}`
                );
                return cached ? JSON.parse(cached) : null;
              } catch {
                return null;
              }
            })()
          }
          operationStepOrder={operations[calcModalIndex].step_order}
          workcenterCode={operations[calcModalIndex].workcenter_code}
          drawerWidthPercent={calcDrawerWidth}
          onDrawerWidthChange={setCalcDrawerWidth}
          onFullScreenChange={setCalcIsFullScreen}
        />
      )}

      {/* Historical Version Cycle Time Calculator Modal (Read-Only) */}
      {historicalCalcModal && (
        <CycleTimeCalculatorModal
          isOpen={Boolean(historicalCalcModal)}
          onClose={() => setHistoricalCalcModal(null)}
          readOnly={true}
          onApply={() => {}}
          initialState={historicalCalcModal.calculationData || null}
          operationStepOrder={historicalCalcModal.stepOrder}
          workcenterCode={historicalCalcModal.workcenterCode}
          drawerWidthPercent={calcDrawerWidth}
          onDrawerWidthChange={setCalcDrawerWidth}
          onFullScreenChange={setCalcIsFullScreen}
        />
      )}
    </div>
  );
};

import React from 'react';
import type { JobOperation } from '../../types/database.types';
import { computeOperationColor, computeLatestQAEvaluation } from './routingUtils';
import { CheckCircle2, Clock, AlertTriangle, ChevronRight } from 'lucide-react';

interface RoutingProgressBarProps {
  operations: JobOperation[];
  selectedOperationId?: string;
  onSelectOperation?: (op: JobOperation) => void;
  compact?: boolean;
}

export const RoutingProgressBar: React.FC<RoutingProgressBarProps> = ({
  operations = [],
  selectedOperationId,
  onSelectOperation,
  compact = false,
}) => {
  if (operations.length === 0) {
    return <span className="text-xs text-slate-400 italic">Chưa thiết lập quy trình (Routing)</span>;
  }

  // Sort operations by step_order
  const sortedOps = [...operations].sort((a, b) => a.step_order - b.step_order);

  if (compact) {
    // Compact representation for Job Card in list view
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {sortedOps.map((op, index) => {
          const colorInfo = computeOperationColor(op);
          return (
            <React.Fragment key={op.id || index}>
              <div
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold tracking-tight shadow-2xs border ${colorInfo.bgClass} ${colorInfo.borderClass}`}
                title={`${op.operation_name}: ${colorInfo.label}`}
              >
                <span>{op.step_order}.</span>
                <span>{op.operation_name}</span>
              </div>
              {index < sortedOps.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // Detailed Interactive View for Job Detail section B
  return (
    <div className="w-full">
      {/* Legend */}
      <div className="flex items-center justify-end gap-3 sm:gap-4 mb-3 text-[11px] font-medium text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
          <span>Hoàn tất (PE) (Xanh)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
          <span>Đang SX / Tạm dừng (Vàng)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-800"></span>
          <span>Chưa bắt đầu (Đen)</span>
        </span>
      </div>

      {/* Dynamic Routing Sequence */}
      <div className="overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
        <div className="flex items-stretch min-w-max gap-2 sm:gap-3">
          {sortedOps.map((op, idx) => {
            const colorInfo = computeOperationColor(op);
            const qaInfo = computeLatestQAEvaluation(op.qa_checks);
            const isSelected = selectedOperationId === op.id;

            return (
              <React.Fragment key={op.id || idx}>
                <button
                  type="button"
                  onClick={() => onSelectOperation && onSelectOperation(op)}
                  className={`flex flex-col justify-between text-left p-3 rounded-lg border-2 min-w-[130px] sm:min-w-[160px] transition-all touch-manipulation focus:outline-none ${
                    isSelected
                      ? 'ring-2 ring-blue-500 ring-offset-2 shadow-sm'
                      : 'hover:opacity-95'
                  } ${colorInfo.borderClass} ${colorInfo.bgClass}`}
                >
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-85">
                      Công đoạn {op.step_order}
                    </span>
                    {colorInfo.color === 'GREEN' && <CheckCircle2 className="w-4 h-4 text-white" />}
                    {colorInfo.color === 'YELLOW' && <AlertTriangle className="w-4 h-4 text-slate-900" />}
                    {colorInfo.color === 'BLACK' && <Clock className="w-4 h-4 text-slate-400" />}
                  </div>

                  <div className="mb-2">
                    <h4 className="font-bold text-sm sm:text-base leading-tight break-words">
                      {op.operation_name}
                    </h4>
                    {op.planned_machine && (
                      <p className="text-[11px] opacity-80 mt-0.5 truncate">
                        Máy: {op.planned_machine}
                      </p>
                    )}
                  </div>

                  <div className="pt-2 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-1 text-[11px] font-medium leading-tight">
                    <span>{colorInfo.label}</span>
                    {qaInfo.result !== 'NOT_REPORTED' && (
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${qaInfo.badgeClass}`}>
                        {qaInfo.result}
                      </span>
                    )}
                  </div>
                </button>

                {idx < sortedOps.length - 1 && (
                  <div className="flex items-center justify-center text-slate-400 px-0.5">
                    <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mt-1 italic">
        * Bấm vào từng công đoạn để xem chi tiết Kế hoạch, Sản xuất (PE-MFG) và Kiểm tra (QA).
      </p>
    </div>
  );
};

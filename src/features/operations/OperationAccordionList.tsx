import React, { useState } from 'react';
import type { JobOperation } from '../../types/database.types';
import { computeCompactOperationColor } from '../routing/routingUtils';
import { OperationExecutionPanel } from './OperationExecutionPanel';
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';

interface OperationAccordionListProps {
  operations: JobOperation[];
  jobId: string;
  jobNo: string;
  partNo: string;
  jobStatus: string;
  onRefresh: () => Promise<void> | void;
}

export const OperationAccordionList: React.FC<OperationAccordionListProps> = ({
  operations,
  jobId,
  jobNo,
  partNo,
  jobStatus,
  onRefresh,
}) => {
  // Sort operations strictly by step_order ASC
  const sortedOperations = [...operations].sort((a, b) => a.step_order - b.step_order);

  // Default expanded: first operation
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (sortedOperations.length > 0) {
      initial.add(sortedOperations[0].id);
    }
    return initial;
  });

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (sortedOperations.length === 0) {
    return (
      <div className="text-center py-12 bg-white border border-slate-200 rounded-xl p-6 text-slate-500 text-xs">
        <Layers className="w-8 h-8 text-slate-400 mx-auto mb-2" />
        <p className="font-semibold text-slate-700">Chưa có công đoạn nào được thiết lập trong quy trình.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sortedOperations.map((op) => {
        const isExpanded = expandedIds.has(op.id);
        const colorInfo = computeCompactOperationColor(op);
        const wcCode = op.workcenter_code || op.planned_machine || '----';
        const desc = op.description || op.operation_name;
        const title = `OP${op.step_order} — ${wcCode} — ${desc}`;

        return (
          <div
            key={op.id}
            className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs transition"
          >
            {/* ACCORDION HEADER (Always compact) */}
            <button
              type="button"
              onClick={() => toggleExpand(op.id)}
              className="w-full px-4 py-3 sm:px-5 sm:py-3.5 flex items-center justify-between text-left bg-slate-50/70 hover:bg-slate-100/70 transition border-b border-transparent data-[expanded=true]:border-slate-200"
              data-expanded={isExpanded}
              aria-expanded={isExpanded}
            >
              <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0 pr-2">
                <span className="font-mono text-xs sm:text-sm font-black text-slate-900 truncate">
                  {title}
                </span>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                {/* Status Badge (GREEN, YELLOW, DARK) */}
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-black tracking-wide border shadow-2xs ${colorInfo.bgClass} ${colorInfo.borderClass}`}
                >
                  {colorInfo.label}
                </span>

                {/* Expand / Collapse Icon */}
                <span className="text-slate-400 hover:text-slate-700 p-1 rounded">
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </span>
              </div>
            </button>

            {/* ACCORDION BODY (PE-MFG & QA) */}
            {isExpanded && (
              <OperationExecutionPanel
                operation={op}
                jobId={jobId}
                jobNo={jobNo}
                partNo={partNo}
                jobStatus={jobStatus}
                onRefresh={onRefresh}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

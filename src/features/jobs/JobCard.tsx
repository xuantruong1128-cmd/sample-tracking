import React from 'react';
import { Link } from 'react-router-dom';
import type { Job } from '../../types/database.types';
import { CompactJobStatusBadge } from '../../components/common/Badge';
import { computeCompactOperationColor } from '../routing/routingUtils';
import {
  getCustomerCode,
  getJobDisplayStatus,
  getWorkcenterCode,
  getCreatedDateDisplay,
  getPlanCloseDateDisplay,
  getActualCloseColorInfo,
  formatIntegerQuantity,
  getJobAutoTurnCTInfo,
  DEFAULT_VISIBLE_COLUMN_IDS,
} from './jobDisplayUtils';

export const DEFAULT_JOB_COLUMN_WIDTHS: Record<string, number> = {
  item_no: 140,
  job_ticket: 130,
  customer: 75,
  created_date: 90,
  plan_close: 90,
  actual_close: 90,
  status: 95,
  qty: 70,
  ct_plan: 80,
  ct_actual: 125,
  routing: 260,
};

export const MIN_JOB_COLUMN_WIDTHS: Record<string, number> = {
  item_no: 90,
  job_ticket: 90,
  customer: 55,
  created_date: 75,
  plan_close: 75,
  actual_close: 75,
  status: 75,
  qty: 55,
  ct_plan: 65,
  ct_actual: 85,
  routing: 150,
};

export const COLUMN_WIDTH_MAP: Record<string, string> = {
  item_no: 'minmax(130px, 1.3fr)',
  job_ticket: 'minmax(125px, 1.2fr)',
  customer: 'minmax(70px, 0.7fr)',
  created_date: 'minmax(85px, 0.8fr)',
  plan_close: 'minmax(85px, 0.8fr)',
  actual_close: 'minmax(85px, 0.8fr)',
  status: 'minmax(90px, 0.9fr)',
  qty: 'minmax(65px, 0.7fr)',
  ct_plan: 'minmax(75px, 0.75fr)',
  ct_actual: 'minmax(120px, 1.2fr)',
  routing: 'minmax(220px, 2.5fr)',
};

interface JobCardProps {
  job: Job;
  visibleColumnIds?: string[];
  columnWidths?: Record<string, number>;
}

export const JobCard: React.FC<JobCardProps> = ({
  job,
  visibleColumnIds = DEFAULT_VISIBLE_COLUMN_IDS,
  columnWidths,
}) => {
  // Sort operations strictly by step_order ascending
  const sortedOps = [...(job.operations || [])].sort(
    (a, b) => a.step_order - b.step_order
  );

  const customerCode = getCustomerCode(job.customer);
  const displayStatus = getJobDisplayStatus(job);
  const createdDateDisplay = getCreatedDateDisplay(job);
  const planCloseDisplay = getPlanCloseDateDisplay(job);
  const actualCloseInfo = getActualCloseColorInfo(job);
  const qtyDisplay = formatIntegerQuantity(job.order_qty);
  const ctInfo = getJobAutoTurnCTInfo(job);

  const isColVisible = (id: string) => visibleColumnIds.includes(id);

  const gridTemplateColumns = visibleColumnIds
    .map((id) => `${columnWidths?.[id] || DEFAULT_JOB_COLUMN_WIDTHS[id] || 100}px`)
    .join(' ');

  return (
    <Link
      to={`/jobs/${job.id}`}
      data-testid={`job-row-${job.id}`}
      style={{ gridTemplateColumns }}
      className="grid items-center px-4 py-2 hover:bg-blue-50/40 transition group focus:outline-none focus:bg-blue-50/60 text-xs sm:text-sm min-h-[44px]"
    >
      {/* Cột 1: Item No. (Always visible, sticky on horizontal scroll) */}
      {isColVisible('item_no') && (
        <div
          data-testid="job-col-item_no"
          className="text-left font-mono font-bold text-slate-900 group-hover:text-blue-600 transition truncate pr-2 sticky left-0 bg-white group-hover:bg-blue-50/90 z-10 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)] py-1"
          title={job.part_no}
        >
          {job.part_no}
        </div>
      )}

      {/* Cột 2: Job Ticket */}
      {isColVisible('job_ticket') && (
        <div
          data-testid="job-col-job_ticket"
          className="text-left font-mono font-medium text-slate-700 truncate pr-2"
          title={job.job_no}
        >
          {job.job_no}
        </div>
      )}

      {/* Cột 3: Customer */}
      {isColVisible('customer') && (
        <div
          data-testid="job-col-customer"
          className="text-left font-bold text-slate-700 truncate pr-2"
          title={job.customer || ''}
        >
          {customerCode}
        </div>
      )}

      {/* Cột 4: Created Date (DD/MM/YY) */}
      {isColVisible('created_date') && (
        <div
          data-testid="job-col-created_date"
          className="text-left font-mono text-slate-600 truncate pr-2 text-xs"
          title={createdDateDisplay}
        >
          {createdDateDisplay}
        </div>
      )}

      {/* Cột 5: Plan Close (DD/MM/YY) */}
      {isColVisible('plan_close') && (
        <div
          data-testid="job-col-plan_close"
          className="text-left font-mono text-slate-600 truncate pr-2 text-xs"
          title={planCloseDisplay || 'Chưa có kế hoạch đóng'}
        >
          {planCloseDisplay || '—'}
        </div>
      )}

      {/* Cột 6: Actual Close (DD/MM/YY) */}
      {isColVisible('actual_close') && (
        <div
          data-testid="job-col-actual_close"
          className="text-left font-mono truncate pr-2 text-xs flex items-center"
          title={
            actualCloseInfo.status === 'on_time'
              ? `Đúng tiến độ (Hoàn thành: ${actualCloseInfo.text}, Kế hoạch: ${planCloseDisplay || '—'})`
              : actualCloseInfo.status === 'late'
              ? `Trễ hạn (Hoàn thành: ${actualCloseInfo.text}, Kế hoạch: ${planCloseDisplay || '—'})`
              : actualCloseInfo.text !== '—'
              ? actualCloseInfo.text
              : job.status === 'CLOSE'
              ? 'Không xác định'
              : 'Chưa đóng'
          }
        >
          <span
            data-testid={`actual-close-badge-${job.id}`}
            className={actualCloseInfo.badgeClassName}
          >
            {actualCloseInfo.text}
          </span>
        </div>
      )}

      {/* Cột 7: Status (Active / Running / Close) */}
      {isColVisible('status') && (
        <div data-testid="job-col-status" className="text-left flex items-center pr-2">
          <CompactJobStatusBadge status={displayStatus} />
        </div>
      )}

      {/* Cột 8: Q'ty */}
      {isColVisible('qty') && (
        <div
          data-testid="job-col-qty"
          className="text-left font-mono font-bold text-emerald-700 truncate pr-2 text-xs"
          title={`${qtyDisplay} pcs`}
        >
          {qtyDisplay}
        </div>
      )}

      {/* Cột 9: CT Plan */}
      {isColVisible('ct_plan') && (
        <div
          data-testid="job-col-ct_plan"
          className="text-left font-mono font-medium text-slate-700 truncate pr-2 text-xs"
          title={ctInfo.planTooltip}
        >
          {ctInfo.planDisplay}
        </div>
      )}

      {/* Cột 10: CT Actual */}
      {isColVisible('ct_actual') && (
        <div
          data-testid="job-col-ct_actual"
          className="text-left font-mono truncate pr-2 text-xs flex items-center"
          title={ctInfo.actualTooltip}
        >
          <span
            data-testid={`ct-actual-badge-${job.id}`}
            className={ctInfo.badgeClassName}
          >
            {ctInfo.status === 'partial' ? (
              <>
                <span>{ctInfo.actualDisplay}</span>
                <span className="text-[10px] text-amber-700 font-semibold">(Chưa đủ CT)</span>
              </>
            ) : (
              ctInfo.actualDisplay
            )}
          </span>
        </div>
      )}

      {/* Cột 11: Routing (Auto-fits and wraps gracefully based on column width) */}
      {isColVisible('routing') && (
        <div
          data-testid="job-col-routing"
          className="text-left flex items-center justify-end overflow-hidden max-w-full py-0.5"
        >
          {sortedOps.length === 0 ? (
            <span className="text-xs text-slate-400 italic">
              Chưa thiết lập Routing
            </span>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-full py-0.5">
              {sortedOps.map((op, index) => {
                const colorInfo = computeCompactOperationColor(op);
                const wcCode = getWorkcenterCode(op);
                return (
                  <React.Fragment key={op.id || index}>
                    <div
                      data-testid={`routing-step-${op.step_order}`}
                      className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-mono font-bold whitespace-nowrap border shadow-2xs ${colorInfo.bgClass} ${colorInfo.borderClass}`}
                      title={`${op.step_order}. ${op.operation_name} (${wcCode}) - ${colorInfo.label}`}
                    >
                      {wcCode}
                    </div>
                    {index < sortedOps.length - 1 && (
                      <span className="text-slate-400 text-xs font-bold shrink-0">
                        →
                      </span>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Link>
  );
};

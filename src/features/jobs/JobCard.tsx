import React from 'react';
import { Link } from 'react-router-dom';
import type { Job } from '../../types/database.types';
import { CompactJobStatusBadge } from '../../components/common/Badge';
import { computeCompactOperationColor } from '../routing/routingUtils';
import {
  getCustomerCode,
  getJobDisplayStatus,
  getWorkcenterCode,
} from './jobDisplayUtils';

interface JobCardProps {
  job: Job;
}

export const JobCard: React.FC<JobCardProps> = ({ job }) => {
  // Sort operations strictly by step_order ascending
  const sortedOps = [...(job.operations || [])].sort(
    (a, b) => a.step_order - b.step_order
  );

  const customerCode = getCustomerCode(job.customer);
  const displayStatus = getJobDisplayStatus(job);

  return (
    <Link
      to={`/jobs/${job.id}`}
      data-testid={`job-row-${job.id}`}
      className="grid grid-cols-[14%_18%_8%_10%_50%] items-center px-4 py-2 hover:bg-blue-50/40 transition group focus:outline-none focus:bg-blue-50/60 text-xs sm:text-sm min-h-[44px]"
    >
      {/* Cột 1: Job Ticket (14%) */}
      <div
        className="text-left font-mono font-bold text-slate-900 group-hover:text-blue-600 transition truncate pr-2"
        title={job.job_no}
      >
        {job.job_no}
      </div>

      {/* Cột 2: Item No. (18%) */}
      <div
        className="text-left font-mono font-medium text-slate-700 truncate pr-2"
        title={job.part_no}
      >
        {job.part_no}
      </div>

      {/* Cột 3: Customer (8%) - strictly 1 character code */}
      <div
        className="text-left font-bold text-slate-700 truncate pr-2"
        title={job.customer || ''}
      >
        {customerCode}
      </div>

      {/* Cột 4: Status (10%) - Active / Running / Close */}
      <div className="text-left flex items-center pr-2">
        <CompactJobStatusBadge status={displayStatus} />
      </div>

      {/* Cột 5: Routing (50%) - Process Flow căn phải */}
      <div className="text-left flex items-center justify-end overflow-x-auto max-w-full scrollbar-none py-0.5">
        {sortedOps.length === 0 ? (
          <span className="text-xs text-slate-400 italic">
            Chưa thiết lập Routing
          </span>
        ) : (
          <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
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
    </Link>
  );
};

import React from 'react';
import type { Job } from '../../types/database.types';
import { JobStatusBadge } from '../../components/common/Badge';
import { Lock } from 'lucide-react';

interface JobGeneralInfoProps {
  job: Job;
  isPlanningLocked?: boolean;
}

export const JobGeneralInfo: React.FC<JobGeneralInfoProps> = ({ job, isPlanningLocked }) => {
  const isLocked =
    isPlanningLocked ??
    (job.status === 'CLOSE' ||
      job.status === 'PURGED' ||
      Boolean(job.operations && job.operations.some((op) => op.status === 'CLOSED')));

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs">
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black text-slate-500 uppercase tracking-wider">
            Planning Information
          </span>
          <span className="text-slate-300">|</span>
          <span className="font-mono text-sm sm:text-base font-black text-slate-900">
            {job.job_no}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isLocked && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
              <Lock className="w-3 h-3 text-amber-600" />
              <span>Planning &amp; Routing: Đã khóa</span>
            </span>
          )}
          <JobStatusBadge status={job.status} />
        </div>
      </div>

      {/* Compact 10-Field Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs">
        {/* 1. Job Ticket */}
        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">Job Ticket</span>
          <span className="font-mono font-bold text-slate-900 text-xs sm:text-sm mt-0.5 block truncate">
            {job.job_no}
          </span>
        </div>

        {/* 2. Item No. */}
        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">Item No.</span>
          <span className="font-mono font-bold text-slate-900 text-xs sm:text-sm mt-0.5 block truncate" title={job.part_no}>
            {job.part_no}
          </span>
        </div>

        {/* 3. Customer Code */}
        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">Customer Code</span>
          <span className="font-bold text-slate-900 text-xs sm:text-sm mt-0.5 block truncate">
            {job.customer || '—'}
          </span>
        </div>

        {/* 4. Item Name */}
        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">Item Name</span>
          <span className="font-semibold text-slate-800 text-xs sm:text-sm mt-0.5 block truncate" title={job.part_name}>
            {job.part_name || job.part_no}
          </span>
        </div>

        {/* 5. Required Quantity */}
        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">Required Quantity</span>
          <span className="font-bold text-emerald-700 text-xs sm:text-sm mt-0.5 block">
            {(job.order_qty ?? 0).toLocaleString('vi-VN')} pcs
          </span>
        </div>

        {/* 6. Material */}
        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">Material</span>
          <span className="font-mono font-bold text-slate-900 text-xs sm:text-sm mt-0.5 block truncate">
            {job.material}
          </span>
        </div>

        {/* 7. Material Specification */}
        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">Material Specification</span>
          <span className="font-medium text-slate-700 text-xs sm:text-sm mt-0.5 block truncate" title={job.material_spec || ''}>
            {job.material_spec || '—'}
          </span>
        </div>

        {/* 8. Planned Start Date */}
        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">Planned Start Date</span>
          <span className="font-semibold text-slate-800 text-xs sm:text-sm mt-0.5 block">
            {new Date(job.planned_start_date).toLocaleDateString('vi-VN')}
          </span>
        </div>

        {/* 9. Planned End Date */}
        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">Planned End Date</span>
          <span className="font-semibold text-slate-800 text-xs sm:text-sm mt-0.5 block">
            {new Date(job.planned_finish_date).toLocaleDateString('vi-VN')}
          </span>
        </div>

        {/* 10. JOB Status */}
        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 flex flex-col justify-between">
          <span className="text-[11px] text-slate-500 font-medium block">JOB Status</span>
          <div className="mt-0.5">
            <JobStatusBadge status={job.status} />
          </div>
        </div>
      </div>
    </div>
  );
};

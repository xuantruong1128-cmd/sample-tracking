import React from 'react';
import type { UserRole } from '../../types/auth';
import type { JobStatus } from '../../types/database.types';

export const RoleBadge: React.FC<{ role: UserRole }> = ({ role }) => {
  const styles: Record<UserRole, string> = {
    Planning: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    'PE-MFG': 'bg-blue-50 text-blue-700 border-blue-200',
    QA: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Admin: 'bg-purple-50 text-purple-700 border-purple-200',
    Drawing: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    Viewer: 'bg-slate-100 text-slate-700 border-slate-300',
    BD: 'bg-amber-50 text-amber-700 border-amber-300',
  };

  const labels: Record<UserRole, string> = {
    Planning: 'Kế hoạch (Planning)',
    'PE-MFG': 'Kỹ thuật / SX (PE-MFG)',
    QA: 'Quản lý chất lượng (QA)',
    Admin: 'Quản trị viên (Admin)',
    Drawing: 'Bản vẽ kỹ thuật (Drawing)',
    Viewer: 'Người xem (Viewer)',
    BD: 'Phát triển kinh doanh (BD)',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[role] || 'bg-slate-100 text-slate-700 border-slate-200'}`}
    >
      {labels[role] || role}
    </span>
  );
};

export const JobStatusBadge: React.FC<{ status: JobStatus }> = ({ status }) => {
  const styles: Record<JobStatus, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    CLOSE: 'bg-slate-200 text-slate-700 border-slate-300',
    ARCHIVE: 'bg-amber-100 text-amber-800 border-amber-300',
    PURGED: 'bg-rose-100 text-rose-800 border-rose-300',
  };

  const labels: Record<JobStatus, string> = {
    ACTIVE: 'ĐANG CHẠY (ACTIVE)',
    CLOSE: 'ĐÃ ĐÓNG (CLOSE)',
    ARCHIVE: 'LƯU TRỮ (ARCHIVE)',
    PURGED: 'ĐÃ XÓA AN TOÀN (PURGED)',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tracking-wide border ${styles[status] || 'bg-slate-100 text-slate-700'}`}
    >
      {labels[status] || status}
    </span>
  );
};

export const CompactJobStatusBadge: React.FC<{ status: 'Active' | 'Running' | 'Close' }> = ({ status }) => {
  const styles: Record<'Active' | 'Running' | 'Close', string> = {
    Active: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    Running: 'bg-blue-50 text-blue-700 border-blue-300',
    Close: 'bg-slate-100 text-slate-600 border-slate-300',
  };

  return (
    <span
      data-testid="compact-job-status-badge"
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tracking-wide border ${styles[status]}`}
    >
      {status}
    </span>
  );
};

export const DrawingReviewStatusBadge: React.FC<{
  status: 'Issued' | 'Reviewing' | 'Completed' | 'Quoted' | 'Requote' | 'Requoted' | string;
  simplified?: boolean;
}> = ({ status, simplified = true }) => {
  const styles: Record<string, string> = {
    Issued: 'bg-amber-50 text-amber-700 border-amber-300',
    Reviewing: 'bg-blue-50 text-blue-700 border-blue-300',
    Completed: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    Quoted: 'bg-purple-50 text-purple-700 border-purple-300',
    Requote: 'bg-orange-50 text-orange-700 border-orange-300',
    Requoted: 'bg-indigo-50 text-indigo-700 border-indigo-300',
  };

  const labels: Record<string, string> = simplified
    ? {
        Issued: 'Issued',
        Reviewing: 'Reviewing',
        Completed: 'Completed',
        Quoted: 'Quoted',
        Requote: 'Requote',
        Requoted: 'Requoted',
      }
    : {
        Issued: 'Đã phát hành (Issued)',
        Reviewing: 'Đang đánh giá (Reviewing)',
        Completed: 'Đã hoàn thành (Completed)',
        Quoted: 'Đã báo giá (Quoted)',
        Requote: 'Yêu cầu báo giá lại (Requote)',
        Requoted: 'Đã báo giá lại (Requoted)',
      };

  return (
    <span
      data-testid={`drawing-review-status-${status.toLowerCase()}`}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border tracking-wide ${styles[status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}
    >
      {labels[status] || status}
    </span>
  );
};

import React, { useState, useEffect } from 'react';
import type { Job } from '../../types/database.types';
import { JobStatusBadge } from '../../components/common/Badge';
import { Lock, Camera, Image as ImageIcon, Loader2 } from 'lucide-react';
import { formatIntegerQuantity } from './jobDisplayUtils';
import { fetchJobPartAvatar, viewSamplePhotoSignedUrl } from '../../services/samplePhotoService';

interface JobGeneralInfoProps {
  job: Job;
  isPlanningLocked?: boolean;
  canEdit?: boolean;
  onEditClick?: () => void;
}

export const JobGeneralInfo: React.FC<JobGeneralInfoProps> = ({
  job,
  isPlanningLocked,
  canEdit,
  onEditClick,
}) => {
  const isLocked =
    isPlanningLocked ??
    (job.status === 'CLOSE' ||
      job.status === 'PURGED' ||
      Boolean(job.operations && job.operations.some((op) => op.status === 'CLOSED')));

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFileName, setAvatarFileName] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    async function loadAvatar() {
      setAvatarLoading(true);

      // 1. If job is closed and has snapshot part_avatar
      const snapshotAvatar = (job as any).final_snapshot?.part_avatar;
      if (snapshotAvatar?.file_path) {
        const { signedUrl } = await viewSamplePhotoSignedUrl(snapshotAvatar.file_path);
        if (isMounted) {
          setAvatarUrl(signedUrl);
          setAvatarFileName(snapshotAvatar.file_name);
          setAvatarLoading(false);
        }
        return;
      }

      // 2. Otherwise fetch live avatar from operation_sample_photos
      const { avatar } = await fetchJobPartAvatar(job.id);
      if (!isMounted) return;

      if (avatar?.file_path) {
        setAvatarFileName(avatar.file_name);
        const { signedUrl } = await viewSamplePhotoSignedUrl(avatar.file_path);
        if (isMounted) {
          setAvatarUrl(signedUrl);
        }
      } else {
        setAvatarUrl(null);
        setAvatarFileName(null);
      }
      setAvatarLoading(false);
    }

    loadAvatar();

    return () => {
      isMounted = false;
    };
  }, [job.id, job.status, (job as any).updated_at]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs">
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 flex-wrap gap-2">
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
          {canEdit && !isLocked && onEditClick && (
            <button
              type="button"
              data-testid="edit-planning-button"
              onClick={onEditClick}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-700 text-xs font-bold rounded-lg border border-blue-200 shadow-2xs transition"
            >
              <span>Chỉnh sửa Kế hoạch</span>
            </button>
          )}
          {isLocked && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
              <Lock className="w-3 h-3 text-amber-600" />
              <span>Planning &amp; Routing: Đã khóa</span>
            </span>
          )}
          <JobStatusBadge status={job.status} />
        </div>
      </div>

      {/* Main Layout: Left Fields + Right Part Avatar (R2-04) */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch">
        {/* Left: Compact 10-Field Grid */}
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs">
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
              {formatIntegerQuantity(job.order_qty)} pcs
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

        {/* Right: Part Avatar (R2-04) */}
        <div
          data-testid="part-avatar-container"
          className="w-full lg:w-44 shrink-0 flex flex-col justify-between p-2.5 bg-slate-50 border border-slate-200/90 rounded-xl"
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60 mb-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <Camera className="w-3 h-3 text-blue-600" />
              <span>Ảnh đại diện</span>
            </span>
            {avatarUrl && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                Avatar
              </span>
            )}
          </div>

          <div className="flex-1 min-h-[90px] flex items-center justify-center bg-white rounded-lg border border-slate-200/80 p-1 overflow-hidden">
            {avatarLoading ? (
              <div className="flex flex-col items-center justify-center text-slate-400 gap-1">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span className="text-[10px]">Đang tải...</span>
              </div>
            ) : avatarUrl ? (
              <img
                src={avatarUrl}
                alt={avatarFileName || job.part_no}
                title={avatarFileName || 'Ảnh đại diện sản phẩm'}
                className="max-h-24 max-w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-2 text-slate-400">
                <ImageIcon className="w-5 h-5 text-slate-300 mb-1" />
                <span className="text-[10px] font-semibold text-slate-500">Chưa có ảnh</span>
                <span className="text-[9px] text-slate-400">Chọn trong công đoạn</span>
              </div>
            )}
          </div>

          {avatarFileName && (
            <p className="text-[9px] text-slate-500 truncate mt-1 text-center font-mono">
              {avatarFileName}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

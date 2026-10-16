import React, { useState, useEffect } from 'react';
import type { Job } from '../../types/database.types';
import { deleteJob } from '../../services/adminJobService';
import {
  AlertTriangle,
  Trash2,
  X,
  Loader2,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';

interface AdminDeleteJobModalProps {
  isOpen: boolean;
  job: Job;
  onClose: () => void;
  onSuccess: (deletedJobNo: string) => void;
}

export const AdminDeleteJobModal: React.FC<AdminDeleteJobModalProps> = ({
  isOpen,
  job,
  onClose,
  onSuccess,
}) => {
  const [confirmTicket, setConfirmTicket] = useState('');
  const [reason, setReason] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setConfirmTicket('');
      setReason('');
      setErrorMessage(null);
      setIsDeleting(false);
    }
  }, [isOpen, job]);

  if (!isOpen) return null;

  // R1 Lock Rule: Close Operation is the definitive boundary for locking Job Deletion
  const isClosed = job.status === 'CLOSE' || job.status === 'PURGED' || job.status === 'ARCHIVE';
  const hasClosedOps = (job.operations || []).some(
    (op) => op.status === 'CLOSED'
  );
  const isBlocked = isClosed || hasClosedOps;

  // Counts of dependent data for clear operational visibility
  const totalOps = (job.operations || []).length;
  const totalRuns = (job.operations || []).reduce(
    (sum, op) => sum + (op.production_runs?.length || 0),
    0
  );
  const totalNg = (job.operations || []).reduce(
    (sum, op) =>
      sum +
      (op.production_runs || []).reduce(
        (rSum, r) => rSum + (r.ng_details?.length || 0),
        0
      ),
    0
  );
  const totalQa = (job.operations || []).reduce(
    (sum, op) => sum + (op.qa_checks?.length || 0),
    0
  );

  const isTicketMatched = confirmTicket.trim().toLowerCase() === job.job_no.trim().toLowerCase();
  const isReasonValid = reason.trim().length >= 3;
  const canSubmit = !isBlocked && isTicketMatched && isReasonValid && !isDeleting;

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setErrorMessage(null);
    setIsDeleting(true);

    try {
      const res = await deleteJob(job.id, confirmTicket, reason);
      if (!res.success) {
        setErrorMessage(res.error || 'Xóa Lệnh sản xuất thất bại.');
        setIsDeleting(false);
        return;
      }

      onSuccess(job.job_no);
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi hệ thống khi xóa Lệnh sản xuất.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 bg-red-50/70 border-b border-red-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-red-950">Xóa Lệnh Sản Xuất</h3>
              <p className="text-xs text-red-700">Dành cho Quản trị viên, Planning Leader hoặc Người tạo JOB</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Target JOB Summary Card */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs grid grid-cols-2 gap-2.5">
            <div>
              <span className="text-slate-400 block font-medium">JOB Ticket</span>
              <span className="font-mono font-bold text-slate-900 text-sm">{job.job_no}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Item Number</span>
              <span className="font-mono font-semibold text-slate-800">{job.part_no}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Khách hàng (Customer)</span>
              <span className="font-semibold text-slate-800">{job.customer || 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Trạng thái</span>
              <span className="font-semibold text-slate-800">{job.status}</span>
            </div>
          </div>

          {/* Block Condition 1: JOB is Closed */}
          {isClosed && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-bold">Không thể xóa JOB đã đóng ({job.status})</strong>
                <span>
                  Lệnh sản xuất đã hoàn tất vòng đời. Hệ thống khóa xóa vĩnh viễn để bảo đảm tính toàn vẹn kiểm toán.
                </span>
              </div>
            </div>
          )}

          {/* Block Condition 2: At least one Operation is Closed */}
          {!isClosed && hasClosedOps && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-bold">Không thể xóa JOB: Đã có công đoạn Chốt (CLOSED)</strong>
                <span>
                  Lệnh sản xuất đã có công đoạn được chốt nghiệm thu. Hệ thống khóa xóa để bảo đảm tính toàn vẹn và truy xuất nguồn gốc kiểm toán.
                </span>
              </div>
            </div>
          )}

          {/* Warning Message if eligible for deletion */}
          {!isBlocked && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <strong className="block font-bold">Cảnh báo: Thao tác không thể hoàn tác!</strong>
                <span>
                  Lệnh sản xuất và toàn bộ quy trình công đoạn sẽ bị xóa vĩnh viễn khỏi hệ thống.
                </span>
                {(totalRuns > 0 || totalQa > 0) && (
                  <p className="text-[11px] font-medium text-amber-800 pt-1 border-t border-amber-200/60 mt-1">
                    Dữ liệu sẽ được dọn dẹp đồng thời: {totalOps} công đoạn, {totalRuns} lượt sản xuất, {totalNg} lỗi NG, {totalQa} biên bản QA.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form for eligible deletion */}
          {!isBlocked && (
            <form onSubmit={handleDelete} className="space-y-3.5 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nhập lại mã JOB Ticket để xác nhận <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={confirmTicket}
                  onChange={(e) => setConfirmTicket(e.target.value)}
                  placeholder={`Nhập chính xác: ${job.job_no}`}
                  disabled={isDeleting}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs sm:text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent placeholder:font-sans placeholder:text-slate-400"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Cần gõ chính xác từng ký tự: <strong className="font-mono text-slate-800">{job.job_no}</strong>
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Lý do xóa (Lưu vào Audit Log) <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ví dụ: Dữ liệu thử nghiệm ban đầu, nhập nhầm mã chi tiết..."
                  disabled={isDeleting}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent placeholder:text-slate-400"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isDeleting}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-lg text-xs font-bold shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang xóa...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xác nhận xóa vĩnh viễn</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Close button if blocked */}
          {isBlocked && (
            <div className="pt-2 flex justify-end border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-900 transition"
              >
                Đóng
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

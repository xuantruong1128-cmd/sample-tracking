import React, { useState, useEffect, useCallback } from 'react';
import type { Attachment, AttachmentType, UserRole } from '../../types/database.types';
import { useAuth } from '../auth/AuthContext';
import {
  uploadAttachment,
  retryAttachmentUpload,
  fetchAttachmentsByJob,
} from '../../services/attachmentUploadService';
import { createSecureSignedUrl } from '../../lib/storageUtils';
import {
  FileText,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Shield,
  Info,
} from 'lucide-react';

interface OperationAttachmentsSectionProps {
  jobId: string;
  operationId: string;
  jobStatus?: string;
}

export const OperationAttachmentsSection: React.FC<OperationAttachmentsSectionProps> = ({
  jobId,
  operationId,
  jobStatus = 'ACTIVE',
}) => {
  const { profile } = useAuth();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const isJobActive = jobStatus === 'ACTIVE';
  const role: UserRole = profile?.role || 'PE-MFG';

  // Allowed file types by role (matching database integrity trigger)
  const getAllowedFileTypes = (r: UserRole): { type: AttachmentType; label: string }[] => {
    switch (r) {
      case 'QA':
        return [
          { type: 'CHECK_SHEET', label: 'Check Sheet kiểm định' },
          { type: 'NG_PHOTO', label: 'Ảnh chụp lỗi thực tế (NG Photo)' },
          { type: 'OTHER', label: 'Hồ sơ khác' },
        ];
      case 'Planning':
        return [
          { type: 'DRAWING', label: 'Bản vẽ kỹ thuật (Drawing)' },
          { type: 'CHECK_SHEET', label: 'Check Sheet chỉ dẫn' },
          { type: 'SETTING_SHEET', label: 'Bảng thiết lập gá đặt' },
          { type: 'OTHER', label: 'Hồ sơ kế hoạch' },
        ];
      case 'PE-MFG':
        return [
          { type: 'CHECK_SHEET', label: 'Check Sheet công đoạn' },
          { type: 'SETTING_SHEET', label: 'Bảng gá đặt & dao cữ' },
          { type: 'DRAWING', label: 'Bản vẽ gia công' },
          { type: 'NG_PHOTO', label: 'Ảnh sự cố gia công' },
          { type: 'OTHER', label: 'Hồ sơ kỹ thuật khác' },
        ];
      case 'Admin':
      default:
        return [
          { type: 'DRAWING', label: 'Bản vẽ kỹ thuật (Drawing)' },
          { type: 'CHECK_SHEET', label: 'Check Sheet kiểm tra' },
          { type: 'SETTING_SHEET', label: 'Bảng thiết lập gá đặt' },
          { type: 'NG_PHOTO', label: 'Ảnh chụp lỗi NG' },
          { type: 'OTHER', label: 'Hồ sơ khác' },
        ];
    }
  };

  const allowedTypes = getAllowedFileTypes(role);
  // Upload Form State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<AttachmentType>(() => allowedTypes[0]?.type || 'CHECK_SHEET');
  const [uploading, setUploading] = useState<boolean>(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const loadAttachments = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    const { attachments: data, error } = await fetchAttachmentsByJob(jobId, operationId);
    if (error) {
      setActionError(error);
    } else {
      setAttachments(data);
    }
    setLoading(false);
  }, [jobId, operationId]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      const ext = file.name.split('.').pop()?.toLowerCase();
      const validExts = ['pdf', 'jpg', 'jpeg', 'png'];

      if (!validTypes.includes(file.type.toLowerCase()) && !validExts.includes(ext || '')) {
        setActionError('Định dạng tệp không được hỗ trợ. Chỉ chấp nhận PDF, JPEG, PNG (tối đa 50MB).');
        setSelectedFile(null);
        e.target.value = '';
        return;
      }

      if (file.size > 52428800) {
        setActionError('Kích thước tệp vượt quá giới hạn cho phép (tối đa 50MB).');
        setSelectedFile(null);
        e.target.value = '';
        return;
      }

      setSelectedFile(file);
      setActionError(null);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setActionError('Vui lòng chọn tệp tin từ máy tính hoặc điện thoại.');
      return;
    }
    if (!isJobActive) {
      setActionError('JOB đã đóng hoặc lưu trữ. Không thể tải thêm tài liệu.');
      return;
    }

    setUploading(true);
    setActionError(null);

    const res = await uploadAttachment({
      jobId,
      operationId,
      fileType,
      file: selectedFile,
      fileName: selectedFile.name,
    });

    if (res.error) {
      setActionError(res.error);
    } else {
      setSelectedFile(null);
      // Reset input element
      const fileInput = document.getElementById('attachment-file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      await loadAttachments();
    }
    setUploading(false);
  };

  const handleRetryUpload = async (attachment: Attachment) => {
    setRetryingId(attachment.id);
    setActionError(null);

    // Call controlled retry function
    const res = await retryAttachmentUpload({
      attachmentId: attachment.id,
      file: selectedFile || undefined,
    });

    if (res.error) {
      setActionError(res.error);
    } else {
      await loadAttachments();
    }
    setRetryingId(null);
  };

  const handleDownloadSignedUrl = async (filePath: string, attachmentId: string) => {
    setOpeningId(attachmentId);
    setActionError(null);

    const { signedUrl, error } = await createSecureSignedUrl(filePath, 300);
    if (error || !signedUrl) {
      setActionError(error || 'Không thể tạo liên kết truy cập an toàn.');
    } else {
      // Open in new tab securely
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    }
    setOpeningId(null);
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className="space-y-6">
      {/* Header and Option A policy badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
            <FileText className="w-4 h-4 text-purple-600" />
            Hồ sơ & Bản vẽ Công đoạn (Attachments)
          </h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Áp dụng chính sách Option A: Toàn bộ nhân sự nội bộ có thể xem tài liệu đã đăng ký.
          </p>
        </div>
        <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs px-2.5 py-1 bg-purple-50 text-purple-700 rounded-md border border-purple-200 font-semibold">
          <Shield className="w-3.5 h-3.5" />
          <span>Option A (Đọc toàn quyền nội bộ)</span>
        </div>
      </div>

      {actionError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block">Thông báo lỗi:</span>
            <span>{actionError}</span>
          </div>
        </div>
      )}

      {/* UPLOAD FORM (Controlled by Role & Job Active State) */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5 text-blue-600" />
            Tải lên tài liệu mới ({role})
          </span>
          {!isJobActive && (
            <span className="text-[11px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
              JOB đã khóa chỉnh sửa ({jobStatus})
            </span>
          )}
        </div>

        {isJobActive ? (
          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="attachment-file-type" className="block text-xs font-semibold text-slate-700 mb-1">
                  Loại tài liệu (Phân quyền theo vai trò):
                </label>
                <select
                  id="attachment-file-type"
                  value={fileType}
                  onChange={(e) => setFileType(e.target.value as AttachmentType)}
                  className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  {allowedTypes.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label} ({t.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="attachment-file-input" className="block text-xs font-semibold text-slate-700 mb-1">
                  Chọn tệp tin (PDF, JPG, PNG - tối đa 50MB):
                </label>
                <input
                  id="attachment-file-input"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={handleFileChange}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 bg-white border border-slate-300 rounded-lg p-1"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-500">
                Tài liệu sẽ được ghi nhận ở trạng thái <code className="bg-slate-200 px-1 py-0.5 rounded">PENDING</code> và tự động xác thực máy chủ trước khi mở <code className="bg-slate-200 px-1 py-0.5 rounded">READY</code>.
              </span>
              <button
                type="submit"
                disabled={uploading || !selectedFile}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
              >
                {uploading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang tải lên...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    <span>Tải lên ngay</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="bg-amber-50/80 border border-amber-200 text-amber-900 rounded-lg p-3 text-xs flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>JOB không ở trạng thái ACTIVE (hiện tại: {jobStatus}). Mọi thao tác tải lên tài liệu mới đã bị khóa để bảo đảm tính toàn vẹn hồ sơ.</span>
          </div>
        )}
      </div>

      {/* ATTACHMENT LIST */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-purple-600" />
            Danh sách hồ sơ đã đăng ký ({attachments.length})
          </span>
          <button
            type="button"
            onClick={loadAttachments}
            className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 p-1"
            title="Làm mới danh sách"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-xs text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2 text-slate-400" />
            Đang tải danh sách tài liệu...
          </div>
        ) : attachments.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-slate-200 rounded-xl p-4 text-xs text-slate-500 bg-slate-50/50">
            Chưa có tài liệu nào được đính kèm cho công đoạn này.
          </div>
        ) : (
          <div className="space-y-2.5">
            {attachments.map((att) => {
              const isReady = att.upload_status === 'READY';
              const isPending = att.upload_status === 'PENDING';
              const isFailed = att.upload_status === 'FAILED';

              return (
                <div
                  key={att.id}
                  className="border border-slate-200 rounded-lg p-3 bg-white hover:border-slate-300 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-slate-100 text-slate-700 flex-shrink-0 mt-0.5">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {att.file_name}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                          {att.file_type}
                        </span>
                        {/* Status Badge */}
                        {isReady && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            READY
                          </span>
                        )}
                        {isPending && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-600" />
                            PENDING
                          </span>
                        )}
                        {isFailed && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-rose-600" />
                            FAILED
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-500 flex items-center gap-3 mt-1 flex-wrap font-mono">
                        <span>Kích thước: {formatFileSize(att.file_size)}</span>
                        <span>Phòng ban: <strong>{att.owning_department || 'Chưa gán'}</strong></span>
                        {att.admin_on_behalf && (
                          <span className="text-amber-700 bg-amber-50 px-1 rounded font-sans text-[10px]">
                            (Admin tải hộ)
                          </span>
                        )}
                        <span>Ngày tạo: {new Date(att.created_at).toLocaleString('vi-VN')}</span>
                      </div>

                      {att.last_error && (
                        <p className="text-[11px] text-rose-600 mt-1 italic">
                          Lỗi: {att.last_error}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
                    {isReady && (
                      <button
                        type="button"
                        onClick={() => handleDownloadSignedUrl(att.file_path, att.id)}
                        disabled={openingId === att.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-md text-xs font-semibold hover:bg-purple-100 transition disabled:opacity-50"
                      >
                        {openingId === att.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="w-3.5 h-3.5" />
                        )}
                        <span>Mở / Tải (Signed URL)</span>
                      </button>
                    )}

                    {isFailed && isJobActive && (
                      <button
                        type="button"
                        onClick={() => handleRetryUpload(att)}
                        disabled={retryingId === att.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded-md text-xs font-semibold hover:bg-amber-700 transition disabled:opacity-50"
                      >
                        {retryingId === att.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>Thử lại tải lên</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

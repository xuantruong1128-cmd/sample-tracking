import React, { useState } from 'react';
import type { JobOperation, EngineeringDocCategory, EngineeringDocument } from '../../types/database.types';
import { useAuth } from '../auth/AuthContext';
import {
  uploadEngineeringDocument,
  isAllowedDocMime,
  MAX_ENGINEERING_DOC_SIZE,
} from '../../services/engineeringDocumentService';
import {
  X,
  Upload,
  FileText,
  Loader2,
  AlertCircle,
  Sliders,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import { ImageEditorModal } from '../../components/common/ImageEditorModal';
import {
  isProcessableImage,
  formatFileSize,
  type ProcessImageResult,
} from '../../lib/imageProcessing';

interface UploadDocumentModalProps {
  jobId: string;
  operations: JobOperation[];
  initialOperationId?: string | null;
  parentDocument?: EngineeringDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

export const UploadDocumentModal: React.FC<UploadDocumentModalProps> = ({
  jobId,
  operations,
  initialOperationId = null,
  parentDocument = null,
  isOpen,
  onClose,
  onSuccess,
}) => {
  let profile = null;
  try {
    const auth = useAuth();
    profile = auth?.profile;
  } catch {
    profile = null;
  }
  if (!isOpen) return null;

  const [operationId, setOperationId] = useState<string>(
    parentDocument ? (parentDocument.operation_id || 'GENERAL') : (initialOperationId || 'GENERAL')
  );
  const [category, setCategory] = useState<EngineeringDocCategory>(
    parentDocument ? parentDocument.category : 'Drawing'
  );
  const [version, setVersion] = useState<string>(() => {
    if (parentDocument) {
      // Suggest next version e.g. v1 -> v2
      const match = parentDocument.version.match(/^v(\d+)$/i);
      if (match) {
        return `v${parseInt(match[1], 10) + 1}`;
      }
      return `${parentDocument.version}.1`;
    }
    return 'v1';
  });
  const [remark, setRemark] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [showImageEditor, setShowImageEditor] = useState<boolean>(false);
  const [optimizationStats, setOptimizationStats] = useState<ProcessImageResult | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!isAllowedDocMime(file.type, file.name)) {
        setErrorMessage('Định dạng tệp không được hỗ trợ. Chấp nhận: PDF, JPG, PNG, WebP, XLS, XLSX.');
        setSelectedFile(null);
        setOriginalFile(null);
        setOptimizationStats(null);
        return;
      }
      if (file.size > MAX_ENGINEERING_DOC_SIZE) {
        setErrorMessage(
          `Dung lượng tệp ${(file.size / (1024 * 1024)).toFixed(2)}MB vượt quá giới hạn 15MB.`
        );
        setSelectedFile(null);
        setOriginalFile(null);
        setOptimizationStats(null);
        return;
      }
      setErrorMessage(null);
      setSelectedFile(file);
      setOriginalFile(file);
      setOptimizationStats(null);
    }
  };

  const handleRevertToOriginal = () => {
    if (originalFile) {
      setSelectedFile(originalFile);
      setOptimizationStats(null);
    }
  };

  const handleEditorConfirm = (processedFile: File, stats: ProcessImageResult) => {
    setSelectedFile(processedFile);
    setOptimizationStats(stats);
    setShowImageEditor(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMessage('Vui lòng chọn tệp tài liệu cần tải lên.');
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);

    const targetOpId = operationId === 'GENERAL' ? null : operationId;
    const { document, error } = await uploadEngineeringDocument({
      jobId,
      operationId: targetOpId,
      category,
      file: selectedFile,
      version: version.trim() || 'v1',
      remark: remark.trim(),
      parentDocumentId: parentDocument?.id || null,
      uploaderName: profile?.full_name || profile?.phone,
    });

    setIsUploading(false);

    if (error || !document) {
      setErrorMessage(error || 'Không thể tải tài liệu lên.');
    } else {
      await onSuccess();
      onClose();
    }
  };

  return (
    <div
      data-testid="upload-document-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
    >
      <div className="bg-white rounded-xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-100 text-cyan-700 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {parentDocument ? `Tải phiên bản mới cho: ${parentDocument.file_name}` : 'Tải lên tài liệu kỹ thuật'}
              </h3>
              <p className="text-[11px] text-slate-500">
                Bản vẽ, Check Sheet tiêu chuẩn, Cài đặt máy &amp; Tài liệu kỹ thuật
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isUploading}
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {/* Operation Selector */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
              Phạm vi áp dụng <span className="text-red-500">*</span>
            </label>
            <select
              disabled={Boolean(parentDocument)}
              value={operationId}
              onChange={(e) => setOperationId(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-cyan-600 disabled:bg-slate-100"
            >
              <option value="GENERAL">Chung cho toàn bộ JOB (General)</option>
              {operations.map((op) => (
                <option key={op.id} value={op.id}>
                  OP{op.step_order} — {op.operation_name} ({op.workcenter_code || 'Workcenter'})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Category */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Phân loại tài liệu <span className="text-red-500">*</span>
              </label>
              <select
                disabled={Boolean(parentDocument)}
                value={category}
                onChange={(e) => setCategory(e.target.value as EngineeringDocCategory)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-cyan-600 disabled:bg-slate-100"
              >
                <option value="Drawing">Bản vẽ (Drawing)</option>
                <option value="Check Sheet">Check Sheet tiêu chuẩn</option>
                <option value="Setting">Hướng dẫn cài đặt máy (Setting)</option>
                <option value="Other">Tài liệu kỹ thuật khác (Other)</option>
              </select>
            </div>

            {/* Version */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Phiên bản (Version) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="v1, v2, Rev A..."
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-cyan-600"
              />
            </div>
          </div>

          {/* File Picker */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
              Chọn tệp đính kèm <span className="text-red-500">*</span>
            </label>
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:bg-slate-50 transition cursor-pointer relative">
              <input
                type="file"
                data-testid="document-file-input"
                required
                accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,application/pdf,image/*,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <Upload className="w-6 h-6 text-slate-400 mx-auto mb-1" />
              {selectedFile ? (
                <div className="text-xs font-bold text-slate-800">
                  <span className="text-cyan-700">{selectedFile.name}</span>{' '}
                  <span className="text-slate-400 font-normal">
                    ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </span>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-slate-700">Kéo thả tệp hoặc bấm để chọn tệp</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Hỗ trợ: PDF, JPG, PNG, WebP, XLS, XLSX (Tối đa 15MB)
                  </p>
                </div>
              )}
            </div>

            {/* Optional Image Editor Action for Drawings/Images */}
            {selectedFile && isProcessableImage(selectedFile) && (
              <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs">
                {optimizationStats ? (
                  <div className="flex items-center gap-1.5 text-emerald-700">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <span>
                      Đã tối ưu: <strong>{formatFileSize(optimizationStats.processedSize)}</strong>{' '}
                      <span className="text-emerald-600">(-{optimizationStats.reductionPercent}%)</span>
                    </span>
                  </div>
                ) : (
                  <div className="text-slate-600">
                    <p className="font-semibold text-[11px] text-slate-700">Tùy chọn tối ưu ảnh:</p>
                    <p className="text-[10px] text-slate-500">Mặc định giữ ảnh gốc. Bấm bên cạnh nếu muốn cắt hoặc nén.</p>
                  </div>
                )}

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowImageEditor(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 hover:border-blue-400 hover:text-blue-600 rounded-md font-semibold text-slate-700 shadow-2xs transition text-xs"
                  >
                    <Sliders className="w-3.5 h-3.5 text-blue-600" />
                    <span>{optimizationStats ? 'Chỉnh sửa lại' : 'Cắt & Nén ảnh'}</span>
                  </button>

                  {optimizationStats && (
                    <button
                      type="button"
                      onClick={handleRevertToOriginal}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 hover:text-amber-600 rounded-md font-semibold text-slate-600 transition text-xs"
                      title="Khôi phục lại tệp ảnh gốc ban đầu"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                      <span>Giữ ảnh gốc</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Remark */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
              Ghi chú / Thay đổi phiên bản
            </label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Ví dụ: Cập nhật dung sai đường kính ngoài; bổ sung bước gá..."
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-cyan-600"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              disabled={isUploading}
              onClick={onClose}
              className="px-3.5 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isUploading || !selectedFile}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>{isUploading ? 'Đang tải lên...' : 'Xác nhận tải tài liệu'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* MOBILE IMAGE CROP & COMPRESSION MODAL FOR DRAWINGS */}
      <ImageEditorModal
        isOpen={showImageEditor}
        file={originalFile || selectedFile}
        category="drawing"
        allowOriginalOption={true}
        onClose={() => setShowImageEditor(false)}
        onConfirm={handleEditorConfirm}
      />
    </div>
  );
};

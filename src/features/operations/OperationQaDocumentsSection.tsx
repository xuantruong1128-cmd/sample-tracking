import React, { useState, useEffect, useCallback } from 'react';
import type { QADocument, QADocumentCategory } from '../../types/database.types';
import { useAuth } from '../auth/AuthContext';
import {
  fetchQaDocumentsByOperation,
  uploadQaDocument,
  deleteQaDocument,
  getQaDocumentSignedUrl,
  QA_DOCUMENT_CATEGORIES,
} from '../../services/qaDocumentService';
import { permissions } from '../auth/authUtils';
import {
  FileText,
  Upload,
  RefreshCw,
  Trash2,
  ExternalLink,
  ShieldAlert,
  Loader2,
  FileCheck,
  CheckCircle2,
  AlertCircle,
  X,
  FileSpreadsheet,
  Image as ImageIcon,
} from 'lucide-react';

interface OperationQaDocumentsSectionProps {
  jobId: string;
  operationId: string;
  jobStatus?: string;
}

export const OperationQaDocumentsSection: React.FC<OperationQaDocumentsSectionProps> = ({
  jobId,
  operationId,
  jobStatus = 'ACTIVE',
}) => {
  const { profile } = useAuth();
  const [documents, setDocuments] = useState<QADocument[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Business Rule: Upload is allowed until JOB Close.
  // Closing an operation does NOT lock QA document upload.
  const isJobClosed = jobStatus === 'CLOSE' || jobStatus === 'PURGED';
  const isViewer = permissions.isViewer(profile?.role);
  const canUpload = !isJobClosed && !isViewer && permissions.canUploadQaDocuments(profile?.role);
  const isAdmin = permissions.isAdmin(profile?.role);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<QADocumentCategory>('Inspection Report');
  const [uploading, setUploading] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Document action loading states
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    const { documents: data, error } = await fetchQaDocumentsByOperation(operationId, jobId);
    if (error) {
      setActionError(error);
    } else {
      setDocuments(data);
    }
    setLoading(false);
  }, [operationId, jobId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleOpenDocument = async (doc: QADocument) => {
    try {
      setOpeningId(doc.id);
      setActionError(null);
      const filePath = doc.file_path || (doc as any).storage_path;
      const { signedUrl, error } = await getQaDocumentSignedUrl(filePath);
      if (error || !signedUrl) {
        throw new Error(error || 'Không thể tạo liên kết tải tài liệu.');
      }
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setActionError(err.message || 'Lỗi khi mở tài liệu.');
    } finally {
      setOpeningId(null);
    }
  };

  const handleDeleteDocument = async (doc: QADocument) => {
    if (isJobClosed || isViewer) return;
    const isOwner = profile?.id && doc.uploaded_by === profile.id;
    if (!isAdmin && !isOwner) {
      setActionError('Bạn chỉ có thể xóa tài liệu do chính mình tải lên.');
      return;
    }

    if (!window.confirm(`Bạn có chắc chắn muốn xóa tài liệu QA "${doc.file_name}"?`)) {
      return;
    }

    try {
      setDeletingId(doc.id);
      setActionError(null);
      const filePath = doc.file_path || (doc as any).storage_path;
      const { success, error } = await deleteQaDocument(doc.id, filePath);
      if (!success) {
        throw new Error(error || 'Xóa tài liệu thất bại.');
      }
      setActionSuccess(`Đã xóa thành công "${doc.file_name}"`);
      await loadDocuments();
    } catch (err: any) {
      setActionError(err.message || 'Lỗi khi xóa tài liệu.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setModalError('Vui lòng chọn tập tin tài liệu.');
      return;
    }

    try {
      setUploading(true);
      setModalError(null);
      const { document: newDoc, error } = await uploadQaDocument({
        jobId,
        operationId,
        file: selectedFile,
        category: selectedCategory,
        uploaderName: profile?.full_name || profile?.phone,
      });

      if (error || !newDoc) {
        throw new Error(error || 'Tải lên tài liệu QA thất bại.');
      }

      setShowUploadModal(false);
      setSelectedFile(null);
      setActionSuccess(`Đã tải lên thành công tài liệu: ${newDoc.file_name}`);
      await loadDocuments();
    } catch (err: any) {
      setModalError(err.message || 'Lỗi trong quá trình tải lên.');
    } finally {
      setUploading(false);
    }
  };

  const getCategoryLabel = (cat: QADocumentCategory) => {
    const found = QA_DOCUMENT_CATEGORIES.find((c) => c.value === cat);
    return found ? found.label : cat;
  };

  const getCategoryBadgeColor = (cat: QADocumentCategory) => {
    switch (cat) {
      case 'Inspection Report':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'CPK/SPC':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'NG Photos':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Measurement Results':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Other':
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      return <FileSpreadsheet className="w-4 h-4 text-emerald-600 flex-shrink-0" />;
    }
    if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp') {
      return <ImageIcon className="w-4 h-4 text-indigo-600 flex-shrink-0" />;
    }
    return <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />;
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="bg-slate-50/60 rounded-xl border border-slate-200 p-4 space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
        <div className="flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-emerald-600" />
          <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
            Hồ sơ &amp; Tài liệu QA (QA Documents)
          </h5>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700">
            {documents.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadDocuments}
            disabled={loading}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-white rounded transition"
            title="Làm mới danh sách tài liệu"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {canUpload && (
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setModalError(null);
                setShowUploadModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-lg shadow-2xs transition"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Tải tài liệu QA</span>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      {actionSuccess && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button type="button" onClick={() => setActionSuccess(null)} className="text-emerald-600 hover:text-emerald-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-xs text-rose-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{actionError}</span>
          </div>
          <button type="button" onClick={() => setActionError(null)} className="text-rose-600 hover:text-rose-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Notice on closed status */}
      {isJobClosed && (
        <div className="text-[11px] text-slate-500 italic flex items-center gap-1 bg-slate-100 p-2 rounded-lg">
          <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
          <span>Lệnh sản xuất đã Đóng (CLOSE). Tài liệu QA chỉ ở chế độ xem.</span>
        </div>
      )}

      {/* Document list */}
      {loading ? (
        <div className="py-6 flex items-center justify-center gap-2 text-slate-500 text-xs">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
          <span>Đang tải danh sách tài liệu QA...</span>
        </div>
      ) : documents.length === 0 ? (
        <div className="py-6 text-center text-slate-400 text-xs italic bg-white rounded-lg border border-dashed border-slate-200">
          Chưa có tài liệu QA nào được tải lên cho công đoạn này.
          {canUpload && (
            <p className="not-italic text-[11px] text-slate-500 mt-1">
              Hỗ trợ: PDF, Excel (XLSX, XLS), CSV, Ảnh (JPG, PNG, WebP) tối đa 50MB. Cho phép tải lên cho tới khi đóng Lệnh sản xuất (JOB Close).
            </p>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white overflow-hidden shadow-2xs">
          {documents.map((doc) => {
            const isDeleting = deletingId === doc.id;
            const isOpening = openingId === doc.id;
            const canDelete =
              !isJobClosed && !isViewer && (isAdmin || (profile?.id && doc.uploaded_by === profile.id));

            return (
              <div
                key={doc.id}
                className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/70 transition text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {getFileIcon(doc.file_name)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 truncate" title={doc.file_name}>
                        {doc.file_name}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getCategoryBadgeColor(
                          doc.category
                        )}`}
                      >
                        {getCategoryLabel(doc.category)}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                      <span>{formatFileSize(doc.file_size)}</span>
                      <span>•</span>
                      <span>{new Date(doc.created_at).toLocaleString('vi-VN')}</span>
                      {doc.uploader_name && (
                        <>
                          <span>•</span>
                          <span className="text-slate-500">{doc.uploader_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenDocument(doc)}
                    disabled={isOpening}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition disabled:opacity-50"
                    title="Mở / Tải tài liệu"
                  >
                    {isOpening ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">Xem</span>
                  </button>

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDeleteDocument(doc)}
                      disabled={isDeleting}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition disabled:opacity-50"
                      title="Xóa tài liệu"
                    >
                      {isDeleting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-emerald-600" />
                <h4 className="text-sm font-bold text-slate-800">Tải lên Tài liệu QA</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="p-5 space-y-4 text-xs">
              {modalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              {/* Category selection */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Phân loại tài liệu <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value as QADocumentCategory)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  {QA_DOCUMENT_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* File input */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Chọn tập tin <span className="text-red-500">*</span>
                </label>
                <input
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setSelectedFile(e.target.files[0]);
                      setModalError(null);
                    }
                  }}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
                />
                <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                  Định dạng cho phép: PDF, Excel (.xlsx, .xls), CSV, Hình ảnh (.jpg, .png, .webp). Kích thước tối đa: 50MB.
                </p>
              </div>

              {/* Selected File Details */}
              {selectedFile && (
                <div className="p-2.5 bg-emerald-50/50 rounded-lg border border-emerald-200/60 flex items-center justify-between">
                  <div className="min-w-0 flex-1 pr-2">
                    <span className="font-semibold text-emerald-900 block truncate">{selectedFile.name}</span>
                    <span className="text-[10px] text-emerald-600">{formatFileSize(selectedFile.size)}</span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 uppercase">Sẵn sàng</span>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploading}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={uploading || !selectedFile}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-lg shadow-xs flex items-center gap-1.5 disabled:opacity-60 transition"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  <span>{uploading ? 'Đang tải lên...' : 'Bắt đầu tải lên'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

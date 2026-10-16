import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { JobOperation, EngineeringDocument, EngineeringDocCategory } from '../../types/database.types';
import { useAuth } from '../auth/AuthContext';
import { permissions } from '../auth/authUtils';
import {
  fetchEngineeringDocuments,
  deleteEngineeringDocument,
  viewEngineeringDocumentSignedUrl,
} from '../../services/engineeringDocumentService';
import { UploadDocumentModal } from './UploadDocumentModal';
import {
  FileText,
  Plus,
  Filter,
  Download,
  Trash2,
  Loader2,
  AlertCircle,
  FileSpreadsheet,
  FileImage,
  History,
} from 'lucide-react';

interface EngineeringDocumentsSectionProps {
  jobId: string;
  operations: JobOperation[];
  jobStatus: string;
}

export const EngineeringDocumentsSection: React.FC<EngineeringDocumentsSectionProps> = ({
  jobId,
  operations,
  jobStatus,
}) => {
  const { profile } = useAuth();
  const role = profile?.role;
  const isJobClosed = jobStatus === 'CLOSE' || jobStatus === 'PURGED';
  const isJobActive = jobStatus === 'ACTIVE';

  const canUpload = !isJobClosed && permissions.canUploadEngineeringDocuments(role);
  const isAdmin = permissions.isAdmin(role);

  const [documents, setDocuments] = useState<EngineeringDocument[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);

  // Filters
  const [opFilter, setOpFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Upload modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [parentDocForVersion, setParentDocForVersion] = useState<EngineeringDocument | null>(null);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    const { documents: data, error } = await fetchEngineeringDocuments(jobId);
    if (error) {
      setErrorMsg(error);
    } else {
      setDocuments(data);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // Filtered documents
  const filteredDocs = useMemo(() => {
    return documents.filter((doc) => {
      // Operation filter
      if (opFilter === 'GENERAL' && doc.operation_id !== null) return false;
      if (opFilter !== 'ALL' && opFilter !== 'GENERAL' && doc.operation_id !== opFilter) return false;

      // Category filter
      if (categoryFilter !== 'ALL' && doc.category !== categoryFilter) return false;

      return true;
    });
  }, [documents, opFilter, categoryFilter]);

  const handleOpenSignedUrl = async (doc: EngineeringDocument) => {
    setOpeningDocId(doc.id);
    const { signedUrl, error } = await viewEngineeringDocumentSignedUrl(doc.file_path);
    setOpeningDocId(null);

    if (error || !signedUrl) {
      alert(error || 'Không thể tạo liên kết tải tài liệu an toàn.');
    } else {
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDelete = async (doc: EngineeringDocument) => {
    if (!window.confirm(`Xác nhận xóa tài liệu "${doc.file_name}" (phiên bản ${doc.version})?`)) {
      return;
    }
    const { success, error } = await deleteEngineeringDocument(doc.id, doc.file_path);
    if (!success || error) {
      alert(error || 'Không thể xóa tài liệu.');
    } else {
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    }
  };

  const handleUploadNewVersion = (doc: EngineeringDocument) => {
    setParentDocForVersion(doc);
    setIsModalOpen(true);
  };

  const handleOpenNewUpload = () => {
    setParentDocForVersion(null);
    setIsModalOpen(true);
  };

  const getCategoryBadge = (cat: EngineeringDocCategory) => {
    switch (cat) {
      case 'Drawing':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            Bản vẽ (Drawing)
          </span>
        );
      case 'Check Sheet':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Check Sheet
          </span>
        );
      case 'Setting':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
            Setting Sheet
          </span>
        );
      case 'Other':
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
            Khác (Other)
          </span>
        );
    }
  };

  const getFileIcon = (_mime: string, name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return <FileText className="w-4 h-4 text-rose-600 flex-shrink-0" />;
    if (['xls', 'xlsx'].includes(ext || '')) return <FileSpreadsheet className="w-4 h-4 text-emerald-600 flex-shrink-0" />;
    return <FileImage className="w-4 h-4 text-blue-600 flex-shrink-0" />;
  };

  return (
    <div
      data-testid="engineering-documents-section"
      className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4"
    >
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-cyan-50 text-cyan-700 flex items-center justify-center border border-cyan-200">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Tài liệu Kỹ thuật (Engineering Documents)
            </h3>
            <p className="text-[11px] text-slate-500">
              Bản vẽ gia công, Check Sheet tiêu chuẩn, Cài đặt thông số máy &amp; Phiên bản
            </p>
          </div>
        </div>

        {canUpload && (
          <button
            type="button"
            onClick={handleOpenNewUpload}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold rounded-lg shadow-xs transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tải tài liệu mới</span>
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 text-xs">
        <div className="flex items-center gap-1.5 text-slate-500 font-semibold">
          <Filter className="w-3.5 h-3.5" />
          <span>Lọc:</span>
        </div>

        {/* Filter by Operation */}
        <div className="flex items-center gap-1">
          <span className="text-slate-600 font-medium">Công đoạn:</span>
          <select
            value={opFilter}
            onChange={(e) => setOpFilter(e.target.value)}
            className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-cyan-600"
          >
            <option value="ALL">Tất cả ({documents.length})</option>
            <option value="GENERAL">Chung cho JOB</option>
            {operations.map((op) => (
              <option key={op.id} value={op.id}>
                OP{op.step_order} — {op.operation_name}
              </option>
            ))}
          </select>
        </div>

        {/* Filter by Category */}
        <div className="flex items-center gap-1">
          <span className="text-slate-600 font-medium">Phân loại:</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-cyan-600"
          >
            <option value="ALL">Tất cả phân loại</option>
            <option value="Drawing">Bản vẽ (Drawing)</option>
            <option value="Check Sheet">Check Sheet</option>
            <option value="Setting">Setting Sheet</option>
            <option value="Other">Khác (Other)</option>
          </select>
        </div>

        <div className="ml-auto text-[11px] text-slate-500">
          Hiển thị: <strong>{filteredDocs.length}</strong> / {documents.length} tài liệu
        </div>
      </div>

      {/* Documents Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-100/80 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3">Tên tài liệu</th>
              <th className="py-2.5 px-3 w-32">Phân loại</th>
              <th className="py-2.5 px-3 w-24 text-center">Phiên bản</th>
              <th className="py-2.5 px-3 w-40">Áp dụng cho</th>
              <th className="py-2.5 px-3 w-36">Người upload</th>
              <th className="py-2.5 px-3">Ghi chú</th>
              <th className="py-2.5 px-3 w-36 text-center">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-1 text-cyan-600" />
                  <span>Đang tải danh sách tài liệu...</span>
                </td>
              </tr>
            ) : filteredDocs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400 italic">
                  Không có tài liệu kỹ thuật nào phù hợp với bộ lọc.
                </td>
              </tr>
            ) : (
              filteredDocs.map((doc) => {
                const op = operations.find((o) => o.id === doc.operation_id);
                const opLabel = op ? `OP${op.step_order} — ${op.operation_name}` : 'Chung cho JOB';
                const canDelete =
                  isJobActive && (isAdmin || (doc.uploaded_by && doc.uploaded_by === profile?.id));

                return (
                  <tr key={doc.id} className="hover:bg-slate-50/60 transition">
                    {/* Tên tài liệu */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        {getFileIcon(doc.mime_type, doc.file_name)}
                        <div>
                          <span className="font-semibold text-slate-900 block truncate max-w-xs" title={doc.file_name}>
                            {doc.file_name}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {(doc.file_size / (1024 * 1024)).toFixed(2)} MB
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Phân loại */}
                    <td className="py-2.5 px-3">{getCategoryBadge(doc.category)}</td>

                    {/* Phiên bản */}
                    <td className="py-2.5 px-3 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-cyan-50 text-cyan-800 border border-cyan-200">
                        {doc.version}
                      </span>
                    </td>

                    {/* Áp dụng cho */}
                    <td className="py-2.5 px-3 text-slate-700 font-medium">
                      <span className="truncate max-w-[150px] block" title={opLabel}>
                        {opLabel}
                      </span>
                    </td>

                    {/* Người upload & Ngày */}
                    <td className="py-2.5 px-3">
                      <div className="text-slate-800 font-medium">{doc.uploader_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {new Date(doc.created_at).toLocaleDateString('vi-VN')}
                      </div>
                    </td>

                    {/* Ghi chú */}
                    <td className="py-2.5 px-3 text-slate-600 italic">
                      {doc.remark || <span className="text-slate-300">—</span>}
                    </td>

                    {/* Thao tác */}
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          disabled={openingDocId === doc.id}
                          onClick={() => handleOpenSignedUrl(doc)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition"
                          title="Mở tài liệu qua Signed URL an toàn"
                        >
                          {openingDocId === doc.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          <span>Xem/Tải</span>
                        </button>

                        {canUpload && (
                          <button
                            type="button"
                            onClick={() => handleUploadNewVersion(doc)}
                            className="p-1 text-slate-500 hover:text-cyan-700 hover:bg-cyan-50 rounded transition"
                            title="Tải lên phiên bản mới cho tài liệu này"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDelete(doc)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                            title="Xóa tài liệu"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Upload Document Modal */}
      <UploadDocumentModal
        jobId={jobId}
        operations={operations}
        parentDocument={parentDocForVersion}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setParentDocForVersion(null);
        }}
        onSuccess={loadDocs}
      />
    </div>
  );
};

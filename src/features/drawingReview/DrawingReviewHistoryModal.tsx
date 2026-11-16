import React, { useState, useEffect } from 'react';
import {
  fetchDrawingReviewHistory,
  formatHanoiDateTime,
} from '../../services/drawingReviewService';
import type { DrawingReviewActivityLog } from '../../types/drawingReview';
import {
  X,
  History,
  Clock,
  User,
  CheckCircle2,
  FileText,
  RotateCcw,
  CheckCheck,
  Tag,
  Layers,
  Edit3,
  Loader2,
  AlertCircle,
  Phone,
  ArrowRight,
} from 'lucide-react';

interface DrawingReviewHistoryModalProps {
  issueId: string;
  issueNo: string;
  itemNo?: string;
  customer?: string;
  onClose: () => void;
}

export const DrawingReviewHistoryModal: React.FC<DrawingReviewHistoryModalProps> = ({
  issueId,
  issueNo,
  itemNo,
  customer,
  onClose,
}) => {
  const [logs, setLogs] = useState<DrawingReviewActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadHistory = async () => {
      setLoading(true);
      setError(null);
      const res = await fetchDrawingReviewHistory(issueId);
      if (active) {
        if (res.error) {
          setError(res.error);
        } else {
          setLogs(res.data);
        }
        setLoading(false);
      }
    };
    loadHistory();
    return () => {
      active = false;
    };
  }, [issueId]);

  const getActionBadge = (action: string, label: string) => {
    switch (action) {
      case 'ISSUE_CREATED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
            <FileText className="w-3 h-3 text-blue-600" />
            <span>{label || 'Phát hành bản vẽ'}</span>
          </span>
        );
      case 'REVIEW_STARTED':
      case 'REVIEW_DRAFT_SAVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-100 text-cyan-800 border border-cyan-200">
            <Edit3 className="w-3 h-3 text-cyan-600" />
            <span>{label || 'Đánh giá kỹ thuật'}</span>
          </span>
        );
      case 'REVIEW_COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>{label || 'Chốt hoàn thành (Completed)'}</span>
          </span>
        );
      case 'VERSION_QUOTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
            <Tag className="w-3 h-3 text-purple-600" />
            <span>{label || 'Báo giá (Quoted)'}</span>
          </span>
        );
      case 'REQUOTE_REQUESTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <RotateCcw className="w-3 h-3 text-amber-600" />
            <span>{label || 'Yêu cầu báo giá lại (Requote)'}</span>
          </span>
        );
      case 'VERSION_REQUOTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">
            <CheckCheck className="w-3 h-3 text-indigo-600" />
            <span>{label || 'Báo giá lại (Requoted)'}</span>
          </span>
        );
      case 'VERSION_CREATED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-violet-100 text-violet-800 border border-violet-200">
            <Layers className="w-3 h-3 text-violet-600" />
            <span>{label || 'Tạo phiên bản mới'}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200">
            <Clock className="w-3 h-3 text-slate-500" />
            <span>{label || action}</span>
          </span>
        );
    }
  };

  const getRoleBadge = (role?: string | null) => {
    if (!role) return null;
    const r = role.toUpperCase();
    if (r === 'BD') {
      return (
        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200">
          Kinh doanh (BD)
        </span>
      );
    }
    if (r === 'PE-MFG' || r.includes('PE')) {
      return (
        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
          Kỹ thuật (PE-MFG)
        </span>
      );
    }
    if (r === 'ADMIN') {
      return (
        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
          Admin
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
        {role}
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in"
      onClick={onClose}
      data-testid="drawing-review-history-modal"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
              <History className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2">
                <span>Lịch sử thao tác bản vẽ</span>
                <span className="font-mono text-blue-300 font-bold px-2 py-0.5 bg-blue-900/60 rounded border border-blue-700/50 text-xs">
                  {issueNo}
                </span>
              </h2>
              <p className="text-xs text-slate-400 truncate max-w-md">
                {itemNo ? `Mã: ${itemNo}` : ''} {customer ? `• Khách: ${customer}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/60 transition cursor-pointer"
            title="Đóng lịch sử"
            data-testid="close-history-modal-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-slate-50/50">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <span className="text-xs font-semibold">Đang tải lịch sử thao tác...</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              <span>{error}</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-xs font-semibold">
              Chưa có nhật ký thao tác nào cho yêu cầu này.
            </div>
          ) : (
            <div className="relative pl-6 sm:pl-8 space-y-6 before:absolute before:left-3 sm:before:left-4 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
              {logs.map((log) => {
                return (
                  <div
                    key={log.id}
                    data-testid={`history-item-${log.id}`}
                    className="relative group bg-white rounded-xl p-3.5 sm:p-4 border border-slate-200/90 shadow-2xs hover:shadow-xs transition"
                  >
                    {/* Circle Node on Timeline line */}
                    <div className="absolute -left-[31px] sm:-left-[39px] top-4 w-4 h-4 rounded-full bg-white border-2 border-blue-600 group-hover:scale-110 group-hover:border-blue-700 transition" />

                    {/* Top Row: Action Badge + Version + Timestamp */}
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {getActionBadge(log.action, log.action_label)}
                        {log.version_name && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            {log.version_name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-medium">
                          {formatHanoiDateTime(log.created_at)}
                        </span>
                      </div>
                    </div>

                    {/* Performer Info */}
                    <div className="flex items-center gap-2 flex-wrap text-xs text-slate-700 mb-2 bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                        <span>{log.performer_name || 'Người dùng'}</span>
                      </div>
                      {getRoleBadge(log.performer_role)}
                      {log.performer_phone && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500 font-mono">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>{log.performer_phone}</span>
                        </div>
                      )}
                    </div>

                    {/* Status transition if present */}
                    {log.old_status && log.new_status && log.old_status !== log.new_status && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-2">
                        <span className="font-semibold text-slate-500 text-[11px]">Trạng thái:</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                          {log.old_status}
                        </span>
                        <ArrowRight className="w-3 h-3 text-slate-400" />
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {log.new_status}
                        </span>
                      </div>
                    )}

                    {/* Additional Details */}
                    {log.details && Object.keys(log.details).length > 0 && (
                      <div className="text-xs text-slate-600 mt-1.5 pt-2 border-t border-slate-100 space-y-1">
                        {log.details.active_operations_count !== undefined && (
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-medium">Số công đoạn:</span>
                            <span className="font-bold text-slate-800">
                              {log.details.active_operations_count} công đoạn
                            </span>
                          </div>
                        )}
                        {log.details.total_cycle_time_seconds !== undefined && (
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-medium">Tổng Cycle Time:</span>
                            <span className="font-bold text-emerald-700">
                              {log.details.total_cycle_time_seconds}s
                            </span>
                          </div>
                        )}
                        {log.details.material && (
                          <div className="flex items-center gap-2 truncate">
                            <span className="text-slate-400 font-medium">Vật liệu:</span>
                            <span className="font-semibold text-slate-700 truncate">
                              {log.details.material}
                            </span>
                          </div>
                        )}
                        {log.details.drawing_file_name && (
                          <div className="flex items-center gap-2 truncate">
                            <span className="text-slate-400 font-medium">Tệp bản vẽ:</span>
                            <span className="font-mono text-slate-700 text-[11px] truncate">
                              {log.details.drawing_file_name}
                            </span>
                          </div>
                        )}
                        {log.details.note && (
                          <p className="text-slate-500 italic text-[11px]">{log.details.note}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>Tổng số sự kiện ghi nhận: {logs.length}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-semibold rounded-lg transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

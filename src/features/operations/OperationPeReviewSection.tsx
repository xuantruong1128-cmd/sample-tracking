import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { PEEngineeringReview, PEReviewResult } from '../../types/database.types';
import { useAuth } from '../auth/AuthContext';
import { fetchPeReviews, submitPeReview } from '../../services/peReviewService';
import {
  Wrench,
  CheckCircle2,
  AlertCircle,
  Clock,
  History,
  Save,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface OperationPeReviewSectionProps {
  jobId: string;
  operationId: string;
  jobStatus: string;
  onRefresh?: () => Promise<void> | void;
}

export const OperationPeReviewSection: React.FC<OperationPeReviewSectionProps> = ({
  jobId,
  operationId,
  jobStatus,
  onRefresh,
}) => {
  const { profile } = useAuth();
  const role = profile?.role || 'PE-MFG';
  const isJobClosed = jobStatus === 'CLOSE' || jobStatus === 'PURGED';
  // PE-MFG and Admin can review even after Close Operation, but locked when Job is closed
  const canReview = !isJobClosed && (role === 'PE-MFG' || role === 'Admin');

  const [reviews, setReviews] = useState<PEEngineeringReview[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  // Form State
  const [reviewResult, setReviewResult] = useState<PEReviewResult>('Pending');
  const [engineeringComment, setEngineeringComment] = useState<string>('');
  const [improvementRequired, setImprovementRequired] = useState<string>('');

  const loadReviews = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    const { reviews: data, error } = await fetchPeReviews(operationId);
    if (error) {
      setErrorMsg(error);
    } else {
      setReviews(data);
      if (data.length > 0) {
        // Pre-fill result and comments from latest review for convenience if user wants to add follow-up
        setReviewResult(data[0].review_result);
      }
    }
    setLoading(false);
  }, [operationId]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const latestReview = useMemo(() => {
    return reviews.length > 0 ? reviews[0] : null;
  }, [reviews]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canReview) return;

    if (!engineeringComment.trim()) {
      setErrorMsg('Vui lòng nhập nhận xét đánh giá kỹ thuật.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const { review, error } = await submitPeReview({
      jobId,
      operationId,
      reviewResult,
      engineeringComment: engineeringComment.trim(),
      improvementRequired: improvementRequired.trim(),
    });

    setIsSubmitting(false);

    if (error || !review) {
      setErrorMsg(error || 'Lỗi khi lưu đánh giá kỹ thuật PE.');
    } else {
      setSuccessMsg('Đã lưu đánh giá kỹ thuật PE thành công.');
      setEngineeringComment('');
      setImprovementRequired('');
      setReviews((prev) => [review, ...prev]);
      if (onRefresh) {
        await onRefresh();
      }
      setTimeout(() => setSuccessMsg(null), 4000);
    }
  };

  const getResultBadge = (res: PEReviewResult) => {
    switch (res) {
      case 'OK':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>Đạt (OK)</span>
          </span>
        );
      case 'NG':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="w-3 h-3 text-rose-600" />
            <span>Không đạt (NG)</span>
          </span>
        );
      case 'Pending':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600" />
            <span>Chờ thẩm định (Pending)</span>
          </span>
        );
    }
  };

  return (
    <div
      data-testid="pe-engineering-review-section"
      className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-blue-600" />
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Đánh giá Kỹ thuật PE (PE Engineering Review)
          </h4>
        </div>
        <div className="flex items-center gap-2">
          {latestReview && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-medium">Kết luận gần nhất:</span>
              {getResultBadge(latestReview.review_result)}
            </div>
          )}
          {isJobClosed && (
            <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
              Đã đóng (Chỉ xem)
            </span>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Review Form */}
      {canReview && (
        <form onSubmit={handleSubmit} className="space-y-3 bg-slate-50/70 p-3.5 rounded-lg border border-slate-200/80">
          <div className="text-xs font-bold text-slate-800">
            Thêm nhận xét &amp; đánh giá kỹ thuật mới
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Review Result Toggle */}
            <div className="sm:col-span-1">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Kết luận đánh giá <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-1">
                {(['Pending', 'OK', 'NG'] as PEReviewResult[]).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => setReviewResult(res)}
                    className={`py-1.5 text-xs font-bold rounded-lg border transition ${
                      reviewResult === res
                        ? res === 'OK'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : res === 'NG'
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-amber-500 text-slate-950 border-amber-500'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            {/* Reviewer Note */}
            <div className="sm:col-span-2 text-right self-end pb-1 text-[11px] text-slate-500">
              Người đánh giá: <strong>{profile?.full_name || profile?.phone}</strong> ({profile?.role})
            </div>
          </div>

          {/* Engineering Comment */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              Nhận xét kỹ thuật gia công (Engineering Comment) <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={2}
              required
              value={engineeringComment}
              onChange={(e) => setEngineeringComment(e.target.value)}
              placeholder="Ghi nhận hiện trạng gia công, chế độ cắt, độ ổn định kích thước, lưu ý cho đợt chạy tiếp theo..."
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          {/* Improvement / Change Required */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              Yêu cầu cải tiến / Thay đổi (Improvement / Change Required)
            </label>
            <textarea
              rows={2}
              value={improvementRequired}
              onChange={(e) => setImprovementRequired(e.target.value)}
              placeholder="Yêu cầu sửa khuôn, làm lại đồ gá, thay đổi dao cụ, điều chỉnh quy trình (nếu có)..."
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          <div className="flex justify-between items-center pt-1">
            <span className="text-[10px] text-slate-500 italic">
              * Đánh giá kỹ thuật được lưu theo lịch sử và không làm thay đổi sản lượng OK/NG/KIV đã chốt.
            </span>
            <button
              type="submit"
              disabled={isSubmitting || !engineeringComment.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Lưu đánh giá PE</span>
            </button>
          </div>
        </form>
      )}

      {/* Latest Review Summary Banner (when not editing or to highlight) */}
      {latestReview && (
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-700 uppercase tracking-wide text-[10px] flex items-center gap-1">
              <span>Đánh giá kỹ thuật hiện hành</span>
            </span>
            <div className="text-[11px] text-slate-500 font-mono">
              {new Date(latestReview.created_at).toLocaleString('vi-VN')} •{' '}
              <strong className="text-slate-700">{latestReview.reviewer_name}</strong> ({latestReview.reviewer_role})
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="bg-white p-2.5 rounded border border-slate-200 space-y-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Nhận xét kỹ thuật</span>
              <p className="text-slate-800 whitespace-pre-wrap">{latestReview.engineering_comment}</p>
            </div>
            <div className="bg-white p-2.5 rounded border border-slate-200 space-y-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Yêu cầu cải tiến</span>
              <p className="text-slate-800 whitespace-pre-wrap">
                {latestReview.improvement_required || <span className="text-slate-400 italic">Không có yêu cầu cải tiến</span>}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Append-only Review History Section */}
      <div className="border-t border-slate-100 pt-2">
        <button
          type="button"
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between text-xs font-bold text-slate-700 hover:text-blue-600 py-1 transition"
        >
          <div className="flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-slate-500" />
            <span>Lịch sử đánh giá kỹ thuật ({reviews.length} lần ghi nhận)</span>
          </div>
          {showHistory ? (
            <ChevronUp className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          )}
        </button>

        {showHistory && (
          <div className="mt-2.5">
            {loading ? (
              <div className="py-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>Đang tải lịch sử...</span>
              </div>
            ) : reviews.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-2">
                Chưa có lịch sử đánh giá kỹ thuật cho công đoạn này.
              </p>
            ) : (
              <div className="space-y-2">
                {reviews.map((rev, idx) => (
                  <div
                    key={rev.id || idx}
                    className="p-3 bg-white border border-slate-200 rounded-lg text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getResultBadge(rev.review_result)}
                        <span className="font-semibold text-slate-800">
                          {rev.reviewer_name} ({rev.reviewer_role})
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {new Date(rev.created_at).toLocaleString('vi-VN')}
                      </span>
                    </div>
                    <div className="text-slate-800 pt-1">
                      <strong className="text-slate-600 text-[11px] block">Nhận xét:</strong>
                      <p className="whitespace-pre-wrap pl-2 border-l-2 border-blue-200 mt-0.5">
                        {rev.engineering_comment}
                      </p>
                    </div>
                    {rev.improvement_required && (
                      <div className="text-slate-800 pt-1">
                        <strong className="text-slate-600 text-[11px] block">Cải tiến:</strong>
                        <p className="whitespace-pre-wrap pl-2 border-l-2 border-amber-300 mt-0.5 text-amber-950">
                          {rev.improvement_required}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

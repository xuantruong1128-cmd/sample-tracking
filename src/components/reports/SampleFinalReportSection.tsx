import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Download,
  Archive,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Eye,
  Loader2,
  Lock,
  ShieldCheck,
  Clock,
} from 'lucide-react';
import type { SampleFinalReport } from '../../types/finalReport';
import { fetchFinalReport, fetchFinalReportStatus, triggerReportGeneration, getReportDownloadUrl } from '../../services/finalReportService';
import { ReportPreviewModal } from './ReportPreviewModal';
import { permissions } from '../../features/auth/authUtils';
import { downloadAndSaveReportFile } from '../../utils/fileSaveUtils';
import type { UserRole } from '../../types/database.types';

interface SampleFinalReportSectionProps {
  jobId: string;
  jobNo?: string;
  partNo?: string;
  jobStatus: string;
  userRole?: UserRole | null;
  isLeader?: boolean;
}

export const SampleFinalReportSection: React.FC<SampleFinalReportSectionProps> = ({
  jobId,
  jobNo,
  partNo,
  jobStatus,
  userRole,
  isLeader,
}) => {
  const [report, setReport] = useState<SampleFinalReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollTimeout, setPollTimeout] = useState<boolean>(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [downloadingType, setDownloadingType] = useState<'pdf' | 'zip' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccessMessage, setDownloadSuccessMessage] = useState<string | null>(null);
  const [downloadFallbackInfo, setDownloadFallbackInfo] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const canDownload = permissions.canDownloadFinalReport(userRole, isLeader);

  const loadReport = useCallback(async () => {
    const res = await fetchFinalReport(jobId);
    if (res.error) {
      setError(res.error);
    } else {
      setReport(res.data);
      setError(null);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    if (jobStatus === 'CLOSE') {
      loadReport();
    } else {
      setLoading(false);
    }
  }, [jobId, jobStatus, loadReport]);

  // Polling while Pending or Generating with bounded retry counter and lightweight status query
  useEffect(() => {
    if (!report) return;
    const isGenerating = report.generation_status === 'Pending' || report.generation_status === 'Generating';
    if (!isGenerating) return;

    let pollCount = 0;
    const MAX_POLLS = 20; // 20 * 3500ms = 70 seconds max polling time

    const interval = setInterval(async () => {
      pollCount++;
      if (pollCount > MAX_POLLS) {
        clearInterval(interval);
        setPollTimeout(true);
        return;
      }

      const { status, error: statusErr } = await fetchFinalReportStatus(jobId);
      if (statusErr) {
        clearInterval(interval);
        setError(statusErr);
        await loadReport();
      } else if (status === 'Ready' || status === 'Completed' || status === 'Failed') {
        clearInterval(interval);
        setPollTimeout(false);
        await loadReport();
      }
    }, 3500);

    return () => clearInterval(interval);
  }, [report?.generation_status, jobId, loadReport]);

  // Handle Safe Retry
  const handleRetry = async () => {
    if (!canDownload || isRetrying) return;
    setIsRetrying(true);
    setDownloadError(null);
    const res = await triggerReportGeneration(jobId);
    if (!res.success) {
      setDownloadError(res.error || 'Lỗi khi khởi chạy lại tiến trình sinh báo cáo.');
    } else {
      await loadReport();
    }
    setIsRetrying(false);
  };

  // Handle Download with Save As Dialog & Streaming
  const handleDownload = async (fileType: 'pdf' | 'zip') => {
    if (!canDownload) {
      setDownloadError('Quyền hạn bị từ chối: Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) hoặc Quản trị viên (Admin) mới được tải tệp gốc.');
      return;
    }

    setDownloadError(null);
    setDownloadSuccessMessage(null);
    setDownloadFallbackInfo(null);

    // Compute standard filename: {ItemNumber} - {JobTicketNumber}.pdf / .zip
    const currentPartNo = partNo || report?.snapshot_data?.part_no || 'PART';
    const currentJobNo = jobNo || report?.snapshot_data?.job_no || 'JOB';
    const standardFileName =
      fileType === 'pdf'
        ? (report?.pdf_file_name || `${currentPartNo} - ${currentJobNo}.pdf`)
        : (report?.zip_file_name || `${currentPartNo} - ${currentJobNo}.zip`);

    try {
      setDownloadingType(fileType);
      const result = await downloadAndSaveReportFile({
        suggestedName: standardFileName,
        fileType,
        getSignedUrl: () => getReportDownloadUrl(jobId, fileType),
        onFallbackUsed: ({ message }) => {
          setDownloadFallbackInfo(message);
        },
      });

      if (result.cancelled) {
        // User cancelled the Save As dialog - handle cleanly without error
        return;
      }

      if (result.success && result.method === 'file-system-access') {
        setDownloadSuccessMessage(`Đã lưu thành công tệp "${standardFileName}" vào thư mục được chọn.`);
      }
    } catch (err: any) {
      setDownloadError(err.message || 'Lỗi khi tải hoặc lưu tệp báo cáo.');
    } finally {
      setDownloadingType(null);
    }
  };

  if (jobStatus !== 'CLOSE' && !report) {
    return null;
  }

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-xl border border-slate-200 flex items-center justify-center gap-2 text-slate-500 text-xs">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
        <span>Đang tải thông tin Báo cáo nghiệm thu...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center gap-2.5">
          <FileText className="w-4 h-4 text-rose-400" />
          <h3 className="text-xs sm:text-sm font-bold tracking-wide">Báo Cáo Nghiệm Thu Mẫu (Sample Final Report)</h3>
        </div>
        <div className="p-4 text-xs text-rose-700 bg-rose-50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Không thể tải thông tin báo cáo: {error}</span>
          </div>
          <button
            type="button"
            onClick={loadReport}
            className="px-2.5 py-1 bg-white border border-rose-300 rounded text-[11px] font-bold text-rose-800 hover:bg-rose-100 transition"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="px-5 py-3.5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold tracking-wide">
                Báo Cáo Nghiệm Thu Mẫu (Sample Final Report)
              </h3>
              <p className="text-[11px] text-slate-400">Trạng thái: Chưa có hồ sơ báo cáo số hóa</p>
            </div>
          </div>
        </div>
        <div className="p-6 text-center space-y-2 text-slate-500 text-xs">
          <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
          <p className="font-semibold text-slate-700">Lệnh sản xuất này chưa có dữ liệu Báo cáo nghiệm thu mẫu</p>
          <p className="text-[11px] text-slate-500 max-w-md mx-auto">
            JOB này đã được đóng trước thời điểm hệ thống số hóa Báo cáo nghiệm thu mẫu được triển khai, hoặc hồ sơ báo cáo chưa được khởi tạo tại thời điểm đóng.
          </p>
        </div>
      </div>
    );
  }

  const evalResult = report.evaluation_result || 'PASS';
  const isGenerating = report.generation_status === 'Pending' || report.generation_status === 'Generating';
  const isReady = report.generation_status === 'Ready';
  const isFailed = report.generation_status === 'Failed';

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden space-y-4">
      {/* Section Header */}
      <div className="px-5 py-3.5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-bold tracking-wide flex items-center gap-2">
              <span>Báo Cáo Nghiệm Thu Mẫu (Sample Final Report)</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>Bất biến</span>
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Đã chốt bởi {report.closed_by_name} lúc {new Date(report.closed_at).toLocaleString('vi-VN')}
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2 self-start sm:self-center">
          {isGenerating && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40 animate-pulse">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Đang sinh tệp tự động...</span>
            </span>
          )}
          {isReady && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Sẵn sàng</span>
            </span>
          )}
          {isFailed && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-400/40">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
              <span>Lỗi tạo tệp</span>
            </span>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4">
        {/* Error Notification */}
        {downloadError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{downloadError}</span>
            </div>
            <button
              type="button"
              onClick={() => setDownloadError(null)}
              className="text-rose-500 hover:text-rose-800 text-xs font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Success Notification */}
        {downloadSuccessMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{downloadSuccessMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setDownloadSuccessMessage(null)}
              className="text-emerald-500 hover:text-emerald-800 text-xs font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Fallback Browser Guidance Notification */}
        {downloadFallbackInfo && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-xs flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold block">Đang tải tệp qua trình duyệt</span>
                <span className="text-[11px] text-blue-800">{downloadFallbackInfo}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDownloadFallbackInfo(null)}
              className="text-blue-500 hover:text-blue-800 text-xs font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* FINAL EVALUATION SUMMARY CARD */}
        <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                Kết quả nghiệm thu kỹ thuật:
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold uppercase ${
                  evalResult === 'PASS'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : evalResult === 'CONDITIONAL'
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-rose-100 text-rose-800 border border-rose-300'
                }`}
              >
                {evalResult === 'PASS' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                {evalResult === 'CONDITIONAL' && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
                {evalResult === 'FAIL' && <AlertCircle className="w-3.5 h-3.5 text-rose-600" />}
                <span>{evalResult}</span>
              </span>
            </div>

            <div className="text-[11px] text-slate-500">
              Chốt bởi: <strong className="text-slate-800">{report.closed_by_name}</strong> (PE-MFG Leader)
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <span className="text-[11px] font-bold text-slate-600 block mb-0.5">Đánh giá kỹ thuật tổng thể:</span>
              <p className="p-2.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-[11px] leading-relaxed">
                {report.overall_assessment}
              </p>
            </div>

            {report.improvements_required && (
              <div>
                <span className="text-[11px] font-bold text-amber-900 block mb-0.5">Hạng mục cần cải tiến:</span>
                <p className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-lg text-amber-950 text-[11px] leading-relaxed">
                  {report.improvements_required}
                </p>
              </div>
            )}

            {report.unresolved_issues && (
              <div>
                <span className="text-[11px] font-bold text-rose-900 block mb-0.5">Vấn đề tồn đọng:</span>
                <p className="p-2.5 bg-rose-50/70 border border-rose-200 rounded-lg text-rose-950 text-[11px] leading-relaxed">
                  {report.unresolved_issues}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* GENERATION STATE / ARTIFACTS / ACTIONS */}
        {isGenerating && !pollTimeout && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-900">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-amber-600 shrink-0" />
              <div>
                <strong className="block text-amber-950 font-bold">Hệ thống đang biên soạn Báo cáo PDF và gói Hồ sơ ZIP</strong>
                <span className="text-[11px] text-amber-800">
                  Toàn bộ tài liệu kỹ thuật, hình ảnh mẫu và kết quả kiểm tra đang được đóng gói tự động. Vui lòng chờ giây lát...
                </span>
              </div>
            </div>
          </div>
        )}

        {isGenerating && pollTimeout && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
            <div className="flex items-start gap-2.5">
              <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <strong className="font-bold">Tiến trình tạo báo cáo đang mất nhiều thời gian hơn bình thường (&gt; 70s)</strong>
                <p className="text-[11px] text-amber-800">
                  Hệ thống vẫn đang tiếp tục xử lý ngầm trên máy chủ. Bạn không cần tạo lại. Bấm nút bên cạnh để kiểm tra trạng thái mới nhất từ máy chủ.
                </p>
              </div>
            </div>
            <button
              type="button"
              data-testid="poll-check-status-btn"
              onClick={async () => {
                setPollTimeout(false);
                await loadReport();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition self-end sm:self-center shrink-0 cursor-pointer shadow-2xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Kiểm tra trạng thái</span>
            </button>
          </div>
        )}

        {isFailed && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-3">
            <div className="flex items-start gap-2.5 text-xs text-rose-900">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <strong className="font-bold">Quá trình sinh tệp tự động gặp lỗi</strong>
                <p className="text-[11px] text-rose-800 font-mono">
                  {report.generation_error || 'Lỗi không xác định khi tạo PDF/ZIP.'}
                </p>
              </div>
            </div>

            {canDownload && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  disabled={isRetrying}
                  onClick={handleRetry}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition shadow-2xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                  <span>Thử lại tạo báo cáo (Retry)</span>
                </button>
              </div>
            )}
          </div>
        )}

        {isReady && (
          <div className="space-y-3">
            {/* Artifact Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* PDF Card */}
              <div className="p-3.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 hover:border-slate-300 transition">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <strong className="block text-xs text-slate-900 font-bold truncate">
                      {report.pdf_file_name || 'Báo cáo nghiệm thu.pdf'}
                    </strong>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Dung lượng: {formatFileSize(report.pdf_file_size)}
                    </span>
                  </div>
                </div>

                {canDownload ? (
                  <button
                    type="button"
                    disabled={downloadingType === 'pdf'}
                    onClick={() => handleDownload('pdf')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition shrink-0 shadow-2xs"
                    title="Tải tệp PDF gốc"
                  >
                    {downloadingType === 'pdf' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>Tải PDF</span>
                  </button>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-slate-100 text-slate-400 border border-slate-200 shrink-0 cursor-not-allowed"
                    title="Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) được phép tải tệp gốc"
                  >
                    <Lock className="w-3 h-3 text-slate-400" />
                    <span>Giới hạn</span>
                  </span>
                )}
              </div>

              {/* ZIP Card */}
              <div className="p-3.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 hover:border-slate-300 transition">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center shrink-0">
                    <Archive className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <strong className="block text-xs text-slate-900 font-bold truncate">
                      {report.zip_file_name || 'Gói hồ sơ mẫu.zip'}
                    </strong>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Dung lượng: {formatFileSize(report.zip_file_size)}
                    </span>
                  </div>
                </div>

                {canDownload ? (
                  <button
                    type="button"
                    disabled={downloadingType === 'zip'}
                    onClick={() => handleDownload('zip')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition shrink-0 shadow-2xs"
                    title="Tải gói hồ sơ ZIP (toàn bộ bản vẽ, ảnh mẫu, phiếu kiểm tra)"
                  >
                    {downloadingType === 'zip' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Archive className="w-3.5 h-3.5" />
                    )}
                    <span>Tải ZIP</span>
                  </button>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-slate-100 text-slate-400 border border-slate-200 shrink-0 cursor-not-allowed"
                    title="Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) được phép tải tệp gốc"
                  >
                    <Lock className="w-3 h-3 text-slate-400" />
                    <span>Giới hạn</span>
                  </span>
                )}
              </div>
            </div>

            {/* Bottom Actions Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  {!canDownload
                    ? 'Bạn đang ở chế độ xem tóm tắt nội dung báo cáo trực tuyến.'
                    : 'Toàn bộ hồ sơ đã được ký số và bảo đảm tính toàn vẹn (SHA-256).'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold transition shadow-2xs text-xs"
                >
                  <Eye className="w-3.5 h-3.5 text-blue-600" />
                  <span>Xem báo cáo</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Restricted Preview Modal */}
      {showPreviewModal && report && (
        <ReportPreviewModal
          isOpen={showPreviewModal}
          report={report}
          onClose={() => setShowPreviewModal(false)}
        />
      )}
    </div>
  );
};

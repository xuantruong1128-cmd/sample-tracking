import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { permissions } from '../auth/authUtils';
import {
  fetchDrawingReviewDetail,
  createNextDrawingReviewVersion,
  quoteDrawingReviewVersion,
  requoteDrawingReviewVersion,
  isSubconWorkcenter,
  getDrawingFileSignedUrl,
  formatHanoiDateTime,
  formatHanoiDate,
} from '../../services/drawingReviewService';
import { downloadDrawingReviewPdf } from '../../services/drawingReviewPdfService';
import { DrawingViewer, type DrawingViewerHandle } from './DrawingViewer';
import { DrawingAvatarThumbnail } from './DrawingAvatarThumbnail';
import { DrawingReviewStatusBadge } from '../../components/common/Badge';
import { CycleTimeCalculatorModal } from './CycleTimeCalculatorModal';
import { DrawingReviewHistoryModal } from './DrawingReviewHistoryModal';
import {
  ArrowLeft,
  Plus,
  Loader2,
  AlertCircle,
  FileDown,
  X,
  Calculator,
  CheckCircle2,
  RotateCcw,
  History,
} from 'lucide-react';

export const DrawingReviewCompletedPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [issue, setIssue] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // BD Quoting states
  const [isQuoting, setIsQuoting] = useState(false);
  const [isRequoting, setIsRequoting] = useState(false);

  // History modal state
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // PDF download state
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [pdfDownloadError, setPdfDownloadError] = useState<string | null>(null);

  // Attachment photo preview modal
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; caption?: string; name: string } | null>(
    null
  );
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});

  // Cycle time calculator inspection modal
  const [calcModalOp, setCalcModalOp] = useState<any | null>(null);
  const drawingViewerRef = useRef<DrawingViewerHandle>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);

    const res = await fetchDrawingReviewDetail(id);
    if (res.error || !res.data) {
      setError(res.error || 'Không tìm thấy yêu cầu đánh giá bản vẽ.');
      setIssue(null);
    } else {
      setIssue(res.data);
      // Default to the latest completed/quoted version or the last version
      const vers = res.data.versions || [];
      const postReviewVers = vers.filter((v: any) =>
        ['Completed', 'Quoted', 'Requote', 'Requoted'].includes(v.status)
      );
      const targetVer = postReviewVers[postReviewVers.length - 1] || vers[vers.length - 1];
      if (targetVer) {
        setSelectedVersionId(targetVer.id);
      }
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Selected version
  const currentVersion = useMemo(() => {
    if (!issue || !issue.versions) return null;
    return (
      issue.versions.find((v: any) => v.id === selectedVersionId) ||
      issue.latest_version
    );
  }, [issue, selectedVersionId]);

  // Active operations for this version, ordered by step_order
  const activeOperations = useMemo(() => {
    if (!currentVersion || !currentVersion.operations) return [];
    return currentVersion.operations
      .filter((op: any) => !op.is_removed)
      .sort((a: any, b: any) => a.step_order - b.step_order);
  }, [currentVersion]);

  // Load signed URLs for attachments
  useEffect(() => {
    let active = true;
    const atts = currentVersion?.attachments || [];
    if (atts.length === 0) return;

    atts.forEach(async (att: any) => {
      if (att.file_path && !attachmentUrls[att.id]) {
        const urlRes = await getDrawingFileSignedUrl(att.file_path, 600);
        if (active && urlRes.signedUrl) {
          setAttachmentUrls((prev) => ({ ...prev, [att.id]: urlRes.signedUrl! }));
        }
      }
    });

    return () => {
      active = false;
    };
  }, [currentVersion]);

  // Handle PDF Download
  const handleDownloadPdf = async () => {
    if (!issue || !currentVersion) return;
    setIsDownloadingPdf(true);
    setPdfDownloadError(null);

    const extraBlobs: Array<{ blob: Blob; caption?: string; name: string }> = [];
    const hasAnnotatedAttachment = (currentVersion.attachments || []).some(
      (a: any) =>
        (a.caption || '').includes('Bản vẽ có ghi chú') ||
        (a.file_name || '').includes('Ban-ve-ghi-chu')
    );

    if (
      !hasAnnotatedAttachment &&
      currentVersion.annotations &&
      currentVersion.annotations.length > 0
    ) {
      try {
        const blob = await drawingViewerRef.current?.getAnnotatedBlob();
        if (blob) {
          extraBlobs.push({
            blob,
            caption: `Bản vẽ có ghi chú kỹ thuật (${currentVersion.version_name})`,
            name: `Ban-ve-ghi-chu-${currentVersion.version_name}.png`,
          });
        }
      } catch (err) {
        console.warn('Could not export annotated drawing for PDF:', err);
      }
    }

    const res = await downloadDrawingReviewPdf(
      issue,
      currentVersion,
      activeOperations,
      currentVersion.attachments || [],
      extraBlobs
    );

    if (!res.success) {
      setPdfDownloadError(res.error || 'Xuất tệp PDF báo cáo thất bại.');
    }
    setIsDownloadingPdf(false);
  };

  // Handle Create V+1
  const handleCreateNextVersion = async () => {
    if (!issue?.id) return;
    if (
      !window.confirm(
        `Xác nhận tạo phiên bản mới (V${(issue.versions?.length || 1) + 1})?\n\nPhiên bản mới sẽ kế thừa toàn bộ thông tin từ phiên bản hoàn thành này.`
      )
    ) {
      return;
    }

    setCreatingVersion(true);
    setActionError(null);

    const res = await createNextDrawingReviewVersion(issue.id);
    if (!res.success || !res.versionId) {
      setActionError(res.error || 'Tạo phiên bản mới thất bại.');
      setCreatingVersion(false);
    } else {
      // Navigate to the editing workspace for the new version
      navigate(`/drawing-reviews/${issue.id}`);
    }
  };

  // Handle BD Quote (Marks Completed as Quoted or Requoted)
  const handleQuote = async () => {
    if (!currentVersion?.id || !issue?.issue_no) return;
    const isV1 = currentVersion.version_number === 1;
    const actionLabel = isV1
      ? 'xác nhận đã báo giá (Quoted)'
      : 'xác nhận đã báo giá lại (Requoted)';

    if (
      !window.confirm(
        `Xác nhận ${actionLabel} cho bản vẽ ${issue.issue_no} (${currentVersion.version_name})?\n\nSau khi báo giá, nút tạo phiên bản mới của PE sẽ bị khóa lại cho đến khi có yêu cầu Requote.`
      )
    ) {
      return;
    }

    setIsQuoting(true);
    setActionError(null);

    try {
      const target = isV1 ? 'Quoted' : 'Requoted';
      const res = await quoteDrawingReviewVersion(currentVersion.id, target);
      if (!res.success) {
        setActionError(res.error || 'Lỗi khi xác nhận báo giá.');
      } else {
        await loadData();
      }
    } catch (err: any) {
      setActionError(err.message || 'Lỗi khi xác nhận báo giá.');
    } finally {
      setIsQuoting(false);
    }
  };

  // Handle BD Requote (Marks Quoted/Requoted as Requote, unlocking '+' for PE)
  const handleRequote = async () => {
    if (!currentVersion?.id || !issue?.issue_no) return;
    if (
      !window.confirm(
        `Xác nhận yêu cầu báo giá lại (Requote) cho bản vẽ ${issue.issue_no}?\n\nThao tác này sẽ mở lại dấu cộng tạo phiên bản mới cho bộ phận PE-MFG.`
      )
    ) {
      return;
    }

    setIsRequoting(true);
    setActionError(null);

    try {
      const res = await requoteDrawingReviewVersion(currentVersion.id);
      if (!res.success) {
        setActionError(res.error || 'Lỗi khi yêu cầu báo giá lại.');
      } else {
        await loadData();
      }
    } catch (err: any) {
      setActionError(err.message || 'Lỗi khi yêu cầu báo giá lại.');
    } finally {
      setIsRequoting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-xs font-semibold">Đang tải báo cáo đánh giá bản vẽ...</p>
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4 text-center">
        <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900 mb-1">
          Không tìm thấy báo cáo
        </h2>
        <p className="text-xs text-slate-600 mb-4">{error}</p>
        <Link
          to="/drawing-reviews"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại danh sách</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      {/* Top Header & Navigation */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 border border-slate-200 rounded-xl shadow-xs print:hidden">
        <div className="flex items-center gap-3">
          <Link
            to={`/drawing-reviews/${issue.id}`}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition"
            title="Quay lại không gian đánh giá"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-black text-slate-900">
                {issue.issue_no}
              </span>
              <span className="text-xs font-bold text-slate-400">•</span>
              <span className="text-sm font-bold text-blue-900">
                {issue.item_no} — {issue.item_name}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Báo cáo tổng kết đánh giá kỹ thuật hoàn thành (Completed Review Report)
            </p>
          </div>
        </div>

        {/* Version Switcher & Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Version Switcher Tabs */}
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-bold">
            {(issue.versions || []).map((ver: any) => {
              const isActive = ver.id === currentVersion?.id;
              return (
                <button
                  key={ver.id}
                  type="button"
                  onClick={() => setSelectedVersionId(ver.id)}
                  className={`px-3 py-1 rounded-md transition flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-white text-blue-700 shadow-xs border border-slate-200 font-extrabold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  data-testid={`report-tab-${ver.version_name}`}
                >
                  <span>{ver.version_name}</span>
                  {['Completed', 'Quoted', 'Requote', 'Requoted'].includes(ver.status) && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        ver.status === 'Completed'
                          ? 'bg-emerald-500'
                          : ver.status === 'Quoted'
                          ? 'bg-purple-500'
                          : ver.status === 'Requote'
                          ? 'bg-orange-500'
                          : 'bg-indigo-500'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {currentVersion && (
            <DrawingReviewStatusBadge status={currentVersion.status} />
          )}

          {/* Download PDF Button */}
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={isDownloadingPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-xs disabled:opacity-50"
            data-testid="download-pdf-btn"
          >
            {isDownloadingPdf ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Đang xuất PDF...</span>
              </>
            ) : (
              <>
                <FileDown className="w-3.5 h-3.5" />
                <span>Tải báo cáo PDF</span>
              </>
            )}
          </button>

          {/* Activity History Button */}
          <button
            type="button"
            onClick={() => setShowHistoryModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer"
            data-testid="completed-view-history-btn"
            title="Xem lịch sử thao tác & thay đổi trạng thái"
          >
            <History className="w-3.5 h-3.5 text-slate-500" />
            <span>Lịch sử</span>
          </button>

                    {/* BD Quoting Actions (Visible to BD and Admin on the latest version) */}
          {currentVersion?.id === issue.latest_version?.id &&
            permissions.canQuoteDrawingReview(profile?.role) && (
              <>
                {/* 1. When status is Completed: BD can Quote (V1) or Requoted (V2+) */}
                {currentVersion.status === 'Completed' && (
                  <button
                    type="button"
                    onClick={handleQuote}
                    disabled={isQuoting}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-white rounded-lg text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer ${
                      currentVersion.version_number === 1
                        ? 'bg-purple-600 hover:bg-purple-700'
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                    data-testid={currentVersion.version_number === 1 ? 'quote-version-btn' : 'requoted-version-btn'}
                    title={
                      currentVersion.version_number === 1
                        ? 'Xác nhận đã gửi báo giá lần đầu cho khách hàng'
                        : 'Xác nhận đã gửi báo giá lại cho khách hàng'
                    }
                  >
                    {isQuoting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {currentVersion.version_number === 1 ? 'Quoted' : 'Requoted'}
                    </span>
                  </button>
                )}

                {/* 2. When status is Quoted or Requoted: BD can Requote (unlocks '+' for PE) */}
                {(currentVersion.status === 'Quoted' || currentVersion.status === 'Requoted') && (
                  <button
                    type="button"
                    onClick={handleRequote}
                    disabled={isRequoting}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                    data-testid="requote-version-btn"
                    title="Yêu cầu PE đánh giá và tính toán lại để báo giá lại cho khách hàng"
                  >
                    {isRequoting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    <span>Requote</span>
                  </button>
                )}
              </>
            )}

          {/* PE Create V+1 Action Button */}
          {currentVersion?.id === issue.latest_version?.id &&
            permissions.canCreateReviewVersion(profile?.role) && (
              <>
                {/* Enabled when Completed or Requote */}
                {(currentVersion.status === 'Completed' || currentVersion.status === 'Requote') && (
                  <button
                    type="button"
                    onClick={handleCreateNextVersion}
                    disabled={creatingVersion}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                    data-testid="create-v-next-btn"
                    title={`Tạo phiên bản mới (V${(issue.versions?.length || 1) + 1})`}
                  >
                    {creatingVersion ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    <span>Tạo V{(issue.versions?.length || 1) + 1}</span>
                  </button>
                )}

                {/* Disabled (dimmed) when Quoted or Requoted */}
                {(currentVersion.status === 'Quoted' || currentVersion.status === 'Requoted') && (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 border border-slate-200 text-slate-400 opacity-60 cursor-not-allowed rounded-lg text-xs font-bold"
                    data-testid="create-v-next-btn-disabled"
                    title={`Bản vẽ đang ở trạng thái ${currentVersion.status} (Đã báo giá). Cần bộ phận BD nhấn Requote để mở khóa trước khi tạo phiên bản mới.`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tạo V{(issue.versions?.length || 1) + 1}</span>
                  </button>
                )}
              </>
            )}
        </div>
      </div>

      {actionError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {pdfDownloadError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>{pdfDownloadError}</span>
        </div>
      )}

      {/* =========================================================================
          REPORT DOCUMENT CONTAINER (Print & PDF ready)
          ========================================================================= */}
      <div className="bg-white border border-slate-300 rounded-xl shadow-md p-6 sm:p-10 space-y-8 font-sans">
        {/* Document Title Header with Avatar */}
        <div className="border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <DrawingAvatarThumbnail
              avatarFilePath={currentVersion?.avatar_file_path}
              itemNo={issue.item_no}
              size="lg"
            />
            <div>
              <span className="text-[10px] font-black tracking-widest text-blue-600 uppercase">
                DRAWING REVIEW REPORT — BÁO CÁO ĐÁNH GIÁ BẢN VẼ
              </span>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-0.5">
                {issue.item_no} — {issue.item_name}
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Khách hàng: <strong className="text-slate-800">{issue.customer}</strong> • Mã phiếu:{' '}
                <strong className="font-mono text-slate-800">{issue.issue_no}</strong>
              </p>
            </div>
          </div>

          <div className="text-right flex flex-col items-start sm:items-end">
            <span className="inline-block px-3 py-1 bg-blue-100 text-blue-900 font-extrabold text-sm rounded-lg border border-blue-300">
              PHIÊN BẢN {currentVersion?.version_name}
            </span>
            <span className="text-[11px] text-slate-400 mt-1 font-mono">
              Ngày chốt:{' '}
              {currentVersion?.closed_at
                ? formatHanoiDateTime(currentVersion.closed_at)
                : 'Đang mở'}
            </span>
          </div>
        </div>

        {/* =========================================================================
            PAGE 1 CONTENT: ISSUE INFO & ORIGINAL DRAWING
            ========================================================================= */}
        <div className="space-y-6">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-1">
            1. Thông tin chung &amp; Bản vẽ gốc
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs">
            <div>
              <span className="text-slate-400 text-[11px] block">Mã Issue No</span>
              <span className="font-mono font-bold text-slate-900">{issue.issue_no}</span>
            </div>
            <div>
              <span className="text-slate-400 text-[11px] block">Khách hàng</span>
              <span className="font-bold text-slate-900">{issue.customer}</span>
            </div>
            <div>
              <span className="text-slate-400 text-[11px] block">Ngày phát hành</span>
              <span className="font-mono font-bold text-slate-900">
                {formatHanoiDate(issue.created_at)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 text-[11px] block">Tệp bản vẽ gốc</span>
              <span className="font-bold text-slate-900 truncate block">
                {issue.drawing_file_name}
              </span>
            </div>
          </div>

          {issue.attention && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950">
              <span className="font-bold block mb-0.5">Lưu ý đặc biệt (Attention):</span>
              <p className="whitespace-pre-line leading-relaxed font-sans">
                {issue.attention}
              </p>
            </div>
          )}

          {/* Drawing Viewer */}
          <DrawingViewer
            ref={drawingViewerRef}
            filePath={issue.drawing_file_path}
            fileName={issue.drawing_file_name}
            mimeType={issue.drawing_mime_type}
            versionId={currentVersion?.id}
            initialAnnotations={currentVersion?.annotations || []}
            readOnly={true}
          />
        </div>

        {/* =========================================================================
            PAGE 2 CONTENT: TECHNICAL SPECIFICATIONS & PRELIMINARY ROUTING
            ========================================================================= */}
        <div className="space-y-6 pt-4 border-t border-slate-200">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-1">
            2. Quy trình công nghệ sơ bộ &amp; Thông số kỹ thuật
          </h2>

          {/* Required Material (Material Type & Specification) */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Vật liệu yêu cầu (Required Material):
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Chủng loại (Material Type)
                </span>
                <div
                  className="text-xs font-semibold text-slate-900"
                  data-testid="completed-material-type"
                >
                  {currentVersion?.material_type?.trim() || (
                    <span className="text-slate-400 italic font-normal">Chưa chỉ định</span>
                  )}
                </div>
              </div>

              <div className="md:col-span-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Quy cách / Thông số phôi (Material Specification)
                </span>
                <div
                  className="text-xs leading-relaxed text-slate-800 whitespace-pre-line font-sans"
                  data-testid="completed-material-specification"
                >
                  {currentVersion?.material_specification?.trim() ||
                    (!currentVersion?.material_type ? currentVersion?.required_material?.trim() : undefined) || (
                      <span className="text-slate-400 italic">Không có yêu cầu đặc biệt.</span>
                    )}
                </div>
              </div>
            </div>
          </div>

          {/* Routing Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Quy trình công nghệ sơ bộ (Preliminary Routing):
              </h3>
              <span className="text-[11px] text-slate-500 italic">
                * Không cộng tổng Total CT
              </span>
            </div>

            <div className="border border-slate-300 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-800 text-white font-bold uppercase text-[11px]">
                    <th className="py-2.5 px-3 w-16 text-center">OP</th>
                    <th className="py-2.5 px-4 w-40">Tổ máy (W/C)</th>
                    <th className="py-2.5 px-4 w-32 text-center">CT (giây/sp)</th>
                    <th className="py-2.5 px-4">Ghi chú công đoạn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {activeOperations.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-400 italic">
                        Không có công đoạn nào được lập cho phiên bản này.
                      </td>
                    </tr>
                  ) : (
                    activeOperations.map((op: any, i: number) => {
                      const displaySeq = `OP${(i + 1) * 10}`;
                      const isSubcon = isSubconWorkcenter(op.workcenter_code);
                      return (
                        <tr key={op.id || i} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 text-center font-mono font-bold text-blue-700 bg-blue-50/50">
                            {displaySeq}
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="font-bold text-slate-900">
                              {op.workcenter_code}
                            </span>
                            {isSubcon && op.operation_description && (
                              <p className="text-[11px] text-amber-800 font-medium mt-0.5">
                                Chi tiết gia công ngoài: {op.operation_description}
                              </p>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-900 bg-slate-50/50">
                            <div className="inline-flex items-center justify-center gap-1.5">
                              <span>
                                {op.cycle_time_seconds !== null && op.cycle_time_seconds !== undefined
                                  ? op.cycle_time_seconds
                                  : '—'}
                              </span>
                              {(op.calculation_data || (op.cycle_time_seconds !== null && op.cycle_time_seconds !== undefined)) && (
                                <button
                                  type="button"
                                  onClick={() => setCalcModalOp(op)}
                                  title="Xem lại chi tiết thông số chạy dao & thời gian chu kỳ"
                                  className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded transition cursor-pointer"
                                  data-testid={`view-calc-btn-${i}`}
                                >
                                  <Calculator className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-slate-700 whitespace-pre-line leading-relaxed">
                            {op.remark?.trim() || <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Required Tooling */}
          <div className="space-y-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Dao cụ &amp; Đồ gá yêu cầu (Required Tooling):
            </h3>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs leading-relaxed text-slate-800 whitespace-pre-line">
              {currentVersion?.required_tooling?.trim() || (
                <span className="text-slate-400 italic">Không có thông tin.</span>
              )}
            </div>
          </div>

          {/* Special Measuring Equipment */}
          <div className="space-y-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Thiết bị đo lường đặc biệt (Special Measuring Equipment):
            </h3>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs leading-relaxed text-slate-800 whitespace-pre-line">
              {currentVersion?.special_measuring_equipment?.trim() || (
                <span className="text-slate-400 italic">Không có thông tin.</span>
              )}
            </div>
          </div>

          {/* Engineering Remarks */}
          <div className="space-y-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Ghi chú kỹ thuật tổng kết (Engineering Remarks):
            </h3>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs leading-relaxed text-slate-800 whitespace-pre-line">
              {currentVersion?.engineering_remarks?.trim() || (
                <span className="text-slate-400 italic">Không có ghi chú.</span>
              )}
            </div>
          </div>

          {/* Attachments Gallery in Completed Report */}
          {currentVersion?.attachments && currentVersion.attachments.length > 0 && (
            <div className="space-y-3 pt-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <span>Hình ảnh &amp; Tài liệu đính kèm (Photo Attachments):</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px]">
                  {currentVersion.attachments.length} tệp
                </span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {currentVersion.attachments.map((att: any) => {
                  const url = attachmentUrls[att.id];
                  return (
                    <div
                      key={att.id}
                      onClick={() =>
                        url &&
                        setPreviewPhoto({
                          url,
                          caption: att.caption,
                          name: att.file_name,
                        })
                      }
                      className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50 hover:border-blue-400 hover:shadow-sm cursor-pointer transition flex flex-col"
                    >
                      <div className="h-32 bg-slate-200 flex items-center justify-center overflow-hidden">
                        {url ? (
                          <img
                            src={url}
                            alt={att.file_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                        )}
                      </div>
                      <div className="p-2 text-[11px] text-slate-700 font-medium truncate">
                        {att.caption || att.file_name}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions: Download PDF */}
        <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            Báo cáo được lưu trữ bất biến theo phiên bản{' '}
            <strong className="text-slate-800">{currentVersion?.version_name}</strong>.
          </span>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={isDownloadingPdf}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-xs disabled:opacity-50"
          >
            {isDownloadingPdf ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang xuất PDF...</span>
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" />
                <span>Tải báo cáo PDF (Download PDF)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Attachment Full Preview Modal */}
      {previewPhoto && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full p-4 shadow-2xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-3">
              <span className="font-bold text-xs text-slate-800 truncate">
                {previewPhoto.caption || previewPhoto.name}
              </span>
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[70vh] flex items-center justify-center bg-slate-900 rounded-lg overflow-hidden">
              <img
                src={previewPhoto.url}
                alt={previewPhoto.name}
                className="max-w-full max-h-[70vh] object-contain"
              />
            </div>
            {previewPhoto.caption && (
              <p className="text-xs text-slate-600 mt-2 italic text-center">
                {previewPhoto.caption}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Cycle Time Calculator modal in read-only inspection mode */}
      {calcModalOp && (
        <CycleTimeCalculatorModal
          isOpen={Boolean(calcModalOp)}
          onClose={() => setCalcModalOp(null)}
          readOnly={true}
          onApply={() => {}}
          initialState={calcModalOp.calculation_data || null}
          operationStepOrder={calcModalOp.step_order}
          workcenterCode={calcModalOp.workcenter_code}
        />
      )}

      {/* Drawing Review Activity History Modal */}
      {showHistoryModal && issue && (
        <DrawingReviewHistoryModal
          issueId={issue.id}
          issueNo={issue.issue_no}
          itemNo={issue.item_no}
          customer={issue.customer}
          onClose={() => setShowHistoryModal(false)}
        />
      )}
    </div>
  );
};

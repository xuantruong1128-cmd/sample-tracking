import React, { useState, useEffect, useMemo } from 'react';
import type { JobOperation, DefectItem } from '../../types/database.types';
import { useAuth } from '../auth/AuthContext';
import {
  fetchDefectCatalog,
  saveProductionResult,
  saveQACheck,
  uploadNGPhoto,
  viewNGPhotoSignedUrl,
  closeJobOperation,
  reviewKivTransfer,
  fetchKivReviews,
  type NGItemInput,
} from '../../services/productionResultService';
import { OperationAttachmentsSection } from './OperationAttachmentsSection';
import { OperationSamplePhotosGallery } from './OperationSamplePhotosGallery';
import { OperationPeReviewSection } from './OperationPeReviewSection';
import {
  Save,
  Plus,
  Trash2,
  Paperclip,
  X,
  ExternalLink,
  ShieldCheck,
  Cpu,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileImage,
  Lock,
  RefreshCw,
  History,
  Check,
} from 'lucide-react';

interface OperationExecutionPanelProps {
  operation: JobOperation;
  jobId: string;
  jobNo: string;
  partNo: string;
  jobStatus: string;
  onRefresh: () => Promise<void> | void;
}

export const OperationExecutionPanel: React.FC<OperationExecutionPanelProps> = ({
  operation,
  jobId,
  jobNo: _jobNo,
  partNo: _partNo,
  jobStatus,
  onRefresh,
}) => {
  const { profile } = useAuth();
  const role = profile?.role || 'PE-MFG';
  const isJobClosed = jobStatus === 'CLOSE' || jobStatus === 'PURGED';
  const isOpClosed = operation.status === 'CLOSED';
  const isPeLeaderOrAdmin = role === 'Admin' || (role === 'PE-MFG' && Boolean(profile?.is_department_leader));
  const canEditMfg = !isJobClosed && !isOpClosed && (role === 'PE-MFG' || role === 'Admin');
  const canEditQa = !isJobClosed && (role === 'QA' || role === 'Admin');
  const canCloseOp = !isJobClosed && !isOpClosed && isPeLeaderOrAdmin;
  const canReviewKiv = !isJobClosed && isOpClosed && isPeLeaderOrAdmin;

  // Defect catalog for dropdown
  const [defectCatalog, setDefectCatalog] = useState<DefectItem[]>([]);
  const [loadingDefects, setLoadingDefects] = useState<boolean>(true);

  // Close Operation Modal State
  const [showCloseOpModal, setShowCloseOpModal] = useState<boolean>(false);
  const [isClosingOp, setIsClosingOp] = useState<boolean>(false);
  const [closeOpError, setCloseOpError] = useState<string | null>(null);

  // KIV Review State
  const [kivReviews, setKivReviews] = useState<any[]>([]);
  const [kivToOk, setKivToOk] = useState<number>(0);
  const [kivToNg, setKivToNg] = useState<number>(0);
  const [kivReason, setKivReason] = useState<string>('');
  const [kivNgRows, setKivNgRows] = useState<NGItemInput[]>([]);
  const [isSubmittingKiv, setIsSubmittingKiv] = useState<boolean>(false);
  const [kivSuccessMsg, setKivSuccessMsg] = useState<string | null>(null);
  const [kivErrorMsg, setKivErrorMsg] = useState<string | null>(null);
  const [uploadingKivPhotoIdx, setUploadingKivPhotoIdx] = useState<number | null>(null);

  // Latest Production Run
  const latestRun = useMemo(() => {
    const runs = operation.production_runs || [];
    if (runs.length === 0) return null;
    return [...runs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  }, [operation.production_runs]);

  // Form State: PE-MFG Row 1
  const [machineId, setMachineId] = useState<string>(
    latestRun?.machine_id || operation.machine_no || operation.planned_machine || ''
  );
  const [productionDate, setProductionDate] = useState<string>(
    latestRun?.production_date || new Date().toISOString().split('T')[0]
  );
  const [cycleTimeActual, setCycleTimeActual] = useState<string>(
    latestRun?.cycle_time_seconds ? String(latestRun.cycle_time_seconds) : ''
  );

  // Form State: PE-MFG Row 2
  const [okQty, setOkQty] = useState<number>(latestRun?.ok_qty ?? 0);
  const [kivQty, setKivQty] = useState<number>(latestRun?.kiv_qty ?? 0);

  // Form State: NG Details
  const [ngRows, setNgRows] = useState<NGItemInput[]>(() => {
    if (latestRun?.ng_details && latestRun.ng_details.length > 0) {
      return latestRun.ng_details.map((d) => ({
        id: d.id,
        ng_qty: d.ng_qty,
        defect_name: d.defect_name,
        defect_code: d.defect_code || undefined,
        cause: d.cause || d.defect_description || '',
        remark: d.remark || '',
        photo_urls: d.photo_urls || [],
      }));
    }
    return [];
  });

  // Calculate Total NG automatically from NG rows
  const totalNG = useMemo(() => {
    return ngRows.reduce((sum, row) => sum + (Number(row.ng_qty) || 0), 0);
  }, [ngRows]);

  // Submission & feedback states
  const [isSavingMfg, setIsSavingMfg] = useState<boolean>(false);
  const [mfgSuccessMsg, setMfgSuccessMsg] = useState<string | null>(null);
  const [mfgErrorMsg, setMfgErrorMsg] = useState<string | null>(null);

  // Photo viewer modal
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState<boolean>(false);
  const [uploadingRowIdx, setUploadingRowIdx] = useState<number | null>(null);

  // QA Check State
  const latestQaCheck = useMemo(() => {
    const checks = operation.qa_checks || [];
    if (checks.length === 0) return null;
    return [...checks].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  }, [operation.qa_checks]);

  const [qaResult, setQaResult] = useState<'OK' | 'NG' | 'KIV'>(latestQaCheck?.result || 'OK');
  const [qaSampleSize, setQaSampleSize] = useState<number>(latestQaCheck?.sample_size || 5);
  const [qaOkQty, setQaOkQty] = useState<number>(latestQaCheck?.ok_qty ?? 5);
  const [qaNgQty, setQaNgQty] = useState<number>(latestQaCheck?.ng_qty ?? 0);
  const [qaNotes, setQaNotes] = useState<string>(latestQaCheck?.notes || '');
  const [isSavingQa, setIsSavingQa] = useState<boolean>(false);
  const [qaSuccessMsg, setQaSuccessMsg] = useState<string | null>(null);
  const [qaErrorMsg, setQaErrorMsg] = useState<string | null>(null);

  // Load defect catalog on mount
  useEffect(() => {
    let isMounted = true;
    fetchDefectCatalog().then(({ defects }) => {
      if (isMounted) {
        setDefectCatalog(defects);
        setLoadingDefects(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Load KIV reviews if operation is closed
  useEffect(() => {
    if (isOpClosed) {
      fetchKivReviews(operation.id).then(({ data }) => {
        setKivReviews(data || []);
      });
    }
  }, [isOpClosed, operation.id]);

  // Update inputs when operation/latestRun changes
  useEffect(() => {
    if (latestRun) {
      setMachineId(latestRun.machine_id || '');
      setProductionDate(latestRun.production_date || new Date().toISOString().split('T')[0]);
      setCycleTimeActual(latestRun.cycle_time_seconds ? String(latestRun.cycle_time_seconds) : '');
      setOkQty(latestRun.ok_qty ?? 0);
      setKivQty(latestRun.kiv_qty ?? 0);
      if (latestRun.ng_details && latestRun.ng_details.length > 0) {
        setNgRows(
          latestRun.ng_details.map((d) => ({
            id: d.id,
            ng_qty: d.ng_qty,
            defect_name: d.defect_name,
            defect_code: d.defect_code || undefined,
            cause: d.cause || d.defect_description || '',
            remark: d.remark || '',
            photo_urls: d.photo_urls || [],
          }))
        );
      } else {
        setNgRows([]);
      }
    }
  }, [latestRun]);

  // Handle NG Rows
  const handleAddNgRow = () => {
    if (!canEditMfg) return;
    const defaultDefect = defectCatalog[0]?.name_vi || 'Sai đường kính';
    const defaultCode = defectCatalog[0]?.code || 'DEF-DIM-01';
    setNgRows([
      ...ngRows,
      {
        ng_qty: 1,
        defect_name: defaultDefect,
        defect_code: defaultCode,
        cause: '',
        remark: '',
        photo_urls: [],
      },
    ]);
  };

  const handleRemoveNgRow = (index: number) => {
    if (!canEditMfg) return;
    setNgRows(ngRows.filter((_, i) => i !== index));
  };

  const handleNgChange = (index: number, field: keyof NGItemInput, value: any) => {
    if (!canEditMfg) return;
    const updated = [...ngRows];
    if (field === 'defect_name') {
      const match = defectCatalog.find((d) => d.name_vi === value);
      updated[index] = {
        ...updated[index],
        defect_name: value,
        defect_code: match ? match.code : undefined,
      };
    } else {
      updated[index] = {
        ...updated[index],
        [field]: value,
      };
    }
    setNgRows(updated);
  };

  // Upload NG Photo (Max 2 photos per row)
  const handlePhotoUpload = async (rowIdx: number, file: File) => {
    if (!canEditMfg) return;
    const row = ngRows[rowIdx];
    const currentPhotos = row.photo_urls || [];
    if (currentPhotos.length >= 2) {
      setMfgErrorMsg('Mỗi dòng NG chỉ được đính kèm tối đa 2 ảnh.');
      return;
    }

    setUploadingRowIdx(rowIdx);
    setMfgErrorMsg(null);
    const { filePath, error } = await uploadNGPhoto(jobId, operation.id, file);
    setUploadingRowIdx(null);

    if (error || !filePath) {
      setMfgErrorMsg(error || 'Lỗi khi tải ảnh lên kho lưu trữ.');
      return;
    }

    const updated = [...ngRows];
    updated[rowIdx] = {
      ...row,
      photo_urls: [...currentPhotos, filePath].slice(0, 2),
    };
    setNgRows(updated);
  };

  const handleRemovePhoto = (rowIdx: number, photoIdx: number) => {
    if (!canEditMfg) return;
    const row = ngRows[rowIdx];
    const currentPhotos = row.photo_urls || [];
    const updatedPhotos = currentPhotos.filter((_, i) => i !== photoIdx);
    const updated = [...ngRows];
    updated[rowIdx] = { ...row, photo_urls: updatedPhotos };
    setNgRows(updated);
  };

  const handleViewPhoto = async (filePath: string) => {
    setPhotoLoading(true);
    const { signedUrl, error } = await viewNGPhotoSignedUrl(filePath);
    setPhotoLoading(false);
    if (error || !signedUrl) {
      alert(error || 'Không thể lấy liên kết xem ảnh.');
      return;
    }
    setPreviewPhotoUrl(signedUrl);
  };

  // Save Production Result
  const handleSaveProductionResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditMfg) return;

    setMfgErrorMsg(null);
    setMfgSuccessMsg(null);
    setIsSavingMfg(true);

    const result = await saveProductionResult({
      operationId: operation.id,
      machineId: machineId.trim(),
      productionDate,
      cycleTimeSeconds: cycleTimeActual ? Number(cycleTimeActual) : null,
      okQty: Number(okQty) || 0,
      kivQty: Number(kivQty) || 0,
      ngItems: ngRows,
    });

    setIsSavingMfg(false);

    if (!result.success) {
      setMfgErrorMsg(result.error || 'Lỗi khi lưu kết quả sản xuất.');
    } else {
      setMfgSuccessMsg('Đã lưu kết quả sản xuất thành công!');
      setTimeout(() => setMfgSuccessMsg(null), 4000);
      await onRefresh();
    }
  };

  // Save QA Check
  const handleSaveQACheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditQa) return;

    setQaErrorMsg(null);
    setQaSuccessMsg(null);
    setIsSavingQa(true);

    const result = await saveQACheck({
      operationId: operation.id,
      result: qaResult,
      sampleSize: Number(qaSampleSize) || 1,
      okQty: Number(qaOkQty) || 0,
      ngQty: Number(qaNgQty) || 0,
      notes: qaNotes,
    });

    setIsSavingQa(false);

    if (!result.success) {
      setQaErrorMsg(result.error || 'Lỗi khi lưu kết quả kiểm tra QA.');
    } else {
      setQaSuccessMsg('Đã lưu kết quả QA thành công!');
      setTimeout(() => setQaSuccessMsg(null), 4000);
      await onRefresh();
    }
  };

  // -------------------------------------------------------------------------
  // Workflow V2: Close Operation Handler
  // -------------------------------------------------------------------------
  const handleConfirmCloseOp = async () => {
    if (!canCloseOp) return;
    setIsClosingOp(true);
    setCloseOpError(null);
    const res = await closeJobOperation(operation.id);
    setIsClosingOp(false);
    if (!res.success) {
      setCloseOpError(res.error || 'Lỗi khi chốt công đoạn.');
    } else {
      setShowCloseOpModal(false);
      await onRefresh();
    }
  };

  // -------------------------------------------------------------------------
  // Workflow V2: KIV Review Handlers
  // -------------------------------------------------------------------------
  const handleAddKivNgRow = () => {
    if (!canReviewKiv) return;
    const defaultDefect = defectCatalog[0]?.name_vi || 'Sai kích thước';
    const defaultCode = defectCatalog[0]?.code || 'DEF-DIM-01';
    setKivNgRows([
      ...kivNgRows,
      {
        ng_qty: 1,
        defect_name: defaultDefect,
        defect_code: defaultCode,
        cause: '',
        remark: '',
        photo_urls: [],
      },
    ]);
  };

  const handleRemoveKivNgRow = (index: number) => {
    if (!canReviewKiv) return;
    setKivNgRows(kivNgRows.filter((_, i) => i !== index));
  };

  const handleKivNgChange = (index: number, field: keyof NGItemInput, value: any) => {
    if (!canReviewKiv) return;
    const updated = [...kivNgRows];
    if (field === 'defect_name') {
      const match = defectCatalog.find((d) => d.name_vi === value);
      updated[index] = {
        ...updated[index],
        defect_name: value,
        defect_code: match ? match.code : undefined,
      };
    } else {
      updated[index] = {
        ...updated[index],
        [field]: value,
      };
    }
    setKivNgRows(updated);
  };

  const handleKivPhotoUpload = async (rowIdx: number, file: File) => {
    if (!canReviewKiv) return;
    const row = kivNgRows[rowIdx];
    const currentPhotos = row.photo_urls || [];
    if (currentPhotos.length >= 2) {
      setKivErrorMsg('Mỗi dòng lỗi chỉ được đính kèm tối đa 2 ảnh.');
      return;
    }

    setUploadingKivPhotoIdx(rowIdx);
    setKivErrorMsg(null);
    const { filePath, error } = await uploadNGPhoto(jobId, operation.id, file);
    setUploadingKivPhotoIdx(null);

    if (error || !filePath) {
      setKivErrorMsg(error || 'Lỗi khi tải ảnh lên.');
      return;
    }

    const updated = [...kivNgRows];
    updated[rowIdx] = {
      ...row,
      photo_urls: [...currentPhotos, filePath].slice(0, 2),
    };
    setKivNgRows(updated);
  };

  const handleRemoveKivPhoto = (rowIdx: number, photoIdx: number) => {
    if (!canReviewKiv) return;
    const row = kivNgRows[rowIdx];
    const currentPhotos = row.photo_urls || [];
    const updatedPhotos = currentPhotos.filter((_, i) => i !== photoIdx);
    const updated = [...kivNgRows];
    updated[rowIdx] = { ...row, photo_urls: updatedPhotos };
    setKivNgRows(updated);
  };

  const handleSubmitKivReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canReviewKiv) return;

    setKivErrorMsg(null);
    setKivSuccessMsg(null);
    setIsSubmittingKiv(true);

    const res = await reviewKivTransfer({
      operationId: operation.id,
      kivToOk: Number(kivToOk) || 0,
      kivToNg: Number(kivToNg) || 0,
      reason: kivReason.trim(),
      ngItems: kivNgRows,
    });

    setIsSubmittingKiv(false);

    if (!res.success) {
      setKivErrorMsg(res.error || 'Lỗi khi thực hiện Review KIV.');
    } else {
      setKivSuccessMsg('Đã xác nhận chuyển đổi KIV thành công!');
      setKivToOk(0);
      setKivToNg(0);
      setKivReason('');
      setKivNgRows([]);
      const { data } = await fetchKivReviews(operation.id);
      setKivReviews(data || []);
      await onRefresh();
      setTimeout(() => setKivSuccessMsg(null), 4000);
    }
  };

  return (
    <div className="p-4 sm:p-5 space-y-6 bg-slate-50/50">
      {/* ----------------------------------------------------------------- */}
      {/* SECTION 1: PE-MFG PRODUCTION RESULT & NG DETAILS                 */}
      {/* ----------------------------------------------------------------- */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-600" />
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Kết quả Sản xuất (PE–MFG Production Result)
            </h4>
          </div>
          <div className="flex items-center gap-2">
            {isOpClosed && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                <Lock className="w-3 h-3 text-indigo-600" />
                <span>Đã chốt công đoạn (CLOSED)</span>
              </span>
            )}
            {isJobClosed && (
              <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                JOB đã đóng (Chỉ đọc)
              </span>
            )}
          </div>
        </div>

        {isOpClosed && (
          <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg text-indigo-900 text-xs flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">
                Công đoạn đã được Chốt sản lượng
                {operation.closed_snapshot?.closed_by_name ? ` bởi ${operation.closed_snapshot.closed_by_name}` : ''}
                {operation.closed_at ? ` lúc ${new Date(operation.closed_at).toLocaleString('vi-VN')}` : ''}.
              </p>
              <p className="mt-0.5 text-indigo-800">
                Sản lượng gốc: OK: <strong>{operation.closed_snapshot?.baseline_ok ?? latestRun?.ok_qty ?? 0}</strong>,{' '}
                NG: <strong>{operation.closed_snapshot?.baseline_ng ?? totalNG}</strong>,{' '}
                KIV: <strong>{operation.closed_snapshot?.baseline_kiv ?? kivQty}</strong>.
                Sản lượng gốc đã khóa trực tiếp. Phân định KIV được thực hiện tại mục <em>Review KIV</em> bên dưới.
              </p>
            </div>
          </div>
        )}

        {mfgSuccessMsg && (
          <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{mfgSuccessMsg}</span>
          </div>
        )}

        {mfgErrorMsg && (
          <div className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{mfgErrorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSaveProductionResult} className="space-y-4">
          {/* TOP AREA: Split Desktop Left (Parameters 2 Rows) & Right (Sample Photos Gallery) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
            {/* LEFT: Thông số sản xuất dạng compact, hai hàng */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-3">
              {/* HÀNG 1: Machine | Date | CT Actual */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Machine */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Machine <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!canEditMfg}
                    value={machineId}
                    onChange={(e) => setMachineId(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Date */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    disabled={!canEditMfg}
                    value={productionDate}
                    onChange={(e) => setProductionDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                </div>

                {/* CT Actual (sec/pcs) - CT Target is NOT shown here */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    CT Actual <span className="text-slate-400 font-normal">(sec/pcs)</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    disabled={!canEditMfg}
                    value={cycleTimeActual}
                    onChange={(e) => setCycleTimeActual(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* HÀNG 2: OK | NG | KIV (Nằm cùng một hàng ngang) */}
              <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50/70 border border-slate-200/80 rounded-lg">
                {/* OK */}
                <div>
                  <label className="block text-[11px] font-bold text-emerald-800 mb-1">
                    OK <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    disabled={!canEditMfg}
                    value={okQty}
                    onChange={(e) => setOkQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                </div>

                {/* NG (Total NG auto-summed from NG Details, READ-ONLY) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-rose-800">
                      NG <span className="text-[10px] text-slate-500 font-normal">(Tự cộng)</span>
                    </label>
                  </div>
                  <input
                    type="number"
                    readOnly
                    tabIndex={-1}
                    value={totalNG}
                    className="w-full px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-rose-700 focus:outline-none cursor-not-allowed select-none"
                  />
                </div>

                {/* KIV (Not auto-added to OK or NG) */}
                <div>
                  <label className="block text-[11px] font-bold text-amber-800 mb-1">
                    KIV <span className="text-slate-400 font-normal">(Chưa phân định)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    disabled={!canEditMfg}
                    value={kivQty}
                    onChange={(e) => setKivQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            {/* RIGHT: Sample Photos gallery */}
            <div className="lg:col-span-5 xl:col-span-4 flex flex-col">
              <OperationSamplePhotosGallery
                jobId={jobId}
                operationId={operation.id}
                jobStatus={jobStatus}
              />
            </div>
          </div>

          {/* NG DETAILS TABLE: Q'ty | Type | Cause | Remark | Ảnh */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                  Chi tiết Lỗi (NG Details)
                </span>
                <span className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                  Total NG: {totalNG}
                </span>
              </div>
              {canEditMfg && (
                <button
                  type="button"
                  onClick={handleAddNgRow}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm dòng</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100/80 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-3 w-16">Q'ty</th>
                    <th className="py-2 px-3 w-40">Type</th>
                    <th className="py-2 px-3 w-36">Cause</th>
                    <th className="py-2 px-3">Remark</th>
                    <th className="py-2 px-3 w-32">Ảnh</th>
                    {canEditMfg && <th className="py-2 px-2 w-10 text-center"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ngRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={canEditMfg ? 6 : 5}
                        className="py-4 px-3 text-center text-slate-400 text-xs italic"
                      >
                        Chưa có dòng lỗi NG nào. (Total NG = 0)
                      </td>
                    </tr>
                  ) : (
                    ngRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        {/* 1. Q'ty */}
                        <td className="p-2">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            required
                            disabled={!canEditMfg}
                            value={row.ng_qty}
                            onChange={(e) =>
                              handleNgChange(idx, 'ng_qty', Math.max(1, parseInt(e.target.value, 10) || 1))
                            }
                            className="w-16 px-2 py-1 bg-white border border-slate-200 rounded text-xs font-bold text-rose-700 text-center focus:outline-none focus:ring-1 focus:ring-rose-500 disabled:bg-slate-100"
                          />
                        </td>

                        {/* 2. Type (Dropdown from defect_catalog) */}
                        <td className="p-2">
                          <select
                            disabled={!canEditMfg || loadingDefects}
                            value={row.defect_name}
                            onChange={(e) => handleNgChange(idx, 'defect_name', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100"
                          >
                            {defectCatalog.map((def) => (
                              <option key={def.id || def.code} value={def.name_vi}>
                                {def.name_vi}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* 3. Cause */}
                        <td className="p-2">
                          <input
                            type="text"
                            disabled={!canEditMfg}
                            value={row.cause || ''}
                            onChange={(e) => handleNgChange(idx, 'cause', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100"
                          />
                        </td>

                        {/* 4. Remark */}
                        <td className="p-2">
                          <input
                            type="text"
                            disabled={!canEditMfg}
                            value={row.remark || ''}
                            onChange={(e) => handleNgChange(idx, 'remark', e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100"
                          />
                        </td>

                        {/* 5. Ảnh (Max 2 photos, Links only, no inline thumbnails) */}
                        <td className="p-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Existing photo links */}
                            {(row.photo_urls || []).map((photoPath, photoIdx) => (
                              <div
                                key={photoIdx}
                                className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200 text-[11px] font-semibold"
                              >
                                <button
                                  type="button"
                                  onClick={() => handleViewPhoto(photoPath)}
                                  className="hover:underline flex items-center gap-0.5"
                                  title="Nhấn để xem ảnh"
                                >
                                  <span>Ảnh {photoIdx + 1}</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </button>
                                {canEditMfg && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePhoto(idx, photoIdx)}
                                    className="text-slate-400 hover:text-rose-600 p-0.5"
                                    title="Xóa ảnh"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                )}
                              </div>
                            ))}

                            {/* Attach button if < 2 photos */}
                            {canEditMfg && (row.photo_urls || []).length < 2 && (
                              <label
                                className={`cursor-pointer inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-semibold border border-dashed border-slate-300 text-slate-600 hover:text-blue-600 hover:border-blue-400 bg-slate-50 transition ${
                                  uploadingRowIdx === idx ? 'opacity-50 pointer-events-none' : ''
                                }`}
                              >
                                {uploadingRowIdx === idx ? (
                                  <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                                ) : (
                                  <Paperclip className="w-3 h-3" />
                                )}
                                <span>{row.photo_urls && row.photo_urls.length > 0 ? '+ Ảnh 2' : '+ Ảnh'}</span>
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg,image/jpg"
                                  className="hidden"
                                  disabled={uploadingRowIdx === idx}
                                  onChange={(e) => {
                                    if (e.target.files && e.target.files[0]) {
                                      handlePhotoUpload(idx, e.target.files[0]);
                                      e.target.value = '';
                                    }
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        </td>

                        {/* Delete row */}
                        {canEditMfg && (
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveNgRow(idx)}
                              className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition"
                              title="Xóa dòng"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* PE-MFG Action Buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <div>
              {canCloseOp && (
                <button
                  type="button"
                  onClick={() => setShowCloseOpModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs transition"
                  title="Chốt sản lượng công đoạn này và khóa Planning/Routing toàn bộ JOB"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Chốt công đoạn (Close Operation)</span>
                </button>
              )}
            </div>
            {canEditMfg && (
              <button
                type="submit"
                disabled={isSavingMfg}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
              >
                {isSavingMfg ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Lưu kết quả sản xuất (PE-MFG)</span>
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* SECTION 1.5: KIV REVIEW & DISPOSITION (WHEN OPERATION CLOSED)    */}
      {/* ----------------------------------------------------------------- */}
      {isOpClosed && (
        <div className="bg-white rounded-xl border border-amber-200/90 p-4 sm:p-5 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-amber-100 gap-2">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-amber-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Đánh giá &amp; Chuyển đổi KIV (KIV Review)
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                KIV hiện tại: {latestRun?.kiv_qty ?? 0} pcs
              </span>
              <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                OK: {latestRun?.ok_qty ?? 0}
              </span>
              <span className="text-[11px] font-bold text-rose-800 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-full">
                NG: {latestRun?.ng_details?.reduce((s, r) => s + (Number(r.ng_qty) || 0), 0) ?? totalNG}
              </span>
            </div>
          </div>

          {kivSuccessMsg && (
            <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{kivSuccessMsg}</span>
            </div>
          )}

          {kivErrorMsg && (
            <div className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{kivErrorMsg}</span>
            </div>
          )}

          {/* Form chuyển đổi KIV */}
          {(latestRun?.kiv_qty ?? 0) > 0 ? (
            canReviewKiv ? (
              <form onSubmit={handleSubmitKivReview} className="space-y-4 bg-amber-50/40 p-3.5 rounded-lg border border-amber-200/70">
                <div className="text-xs font-semibold text-amber-950">
                  Thực hiện chuyển đổi KIV sang OK hoặc NG (Chỉ PE-MFG Leader hoặc Admin)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* KIV -> OK */}
                  <div>
                    <label htmlFor="kiv-to-ok-input" className="block text-[11px] font-bold text-emerald-800 mb-1">
                      Chuyển KIV sang OK (pcs)
                    </label>
                    <input
                      id="kiv-to-ok-input"
                      type="number"
                      min="0"
                      max={latestRun?.kiv_qty ?? 0}
                      step="1"
                      value={kivToOk}
                      onChange={(e) => setKivToOk(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                    />
                  </div>

                  {/* KIV -> NG */}
                  <div>
                    <label htmlFor="kiv-to-ng-input" className="block text-[11px] font-bold text-rose-800 mb-1">
                      Chuyển KIV sang NG (pcs)
                    </label>
                    <input
                      id="kiv-to-ng-input"
                      type="number"
                      min="0"
                      max={latestRun?.kiv_qty ?? 0}
                      step="1"
                      value={kivToNg}
                      onChange={(e) => {
                        const newNg = Math.max(0, parseInt(e.target.value, 10) || 0);
                        setKivToNg(newNg);
                        if (newNg > 0) {
                          if (kivNgRows.length === 0) {
                            setKivNgRows([
                              {
                                ng_qty: newNg,
                                defect_name: defectCatalog[0]?.name_vi || 'Sai kích thước',
                                defect_code: defectCatalog[0]?.code || 'DEF-DIM-01',
                                cause: '',
                                remark: '',
                                photo_urls: [],
                              },
                            ]);
                          } else if (kivNgRows.length === 1) {
                            setKivNgRows([
                              {
                                ...kivNgRows[0],
                                ng_qty: newNg,
                              },
                            ]);
                          }
                        } else {
                          setKivNgRows([]);
                        }
                      }}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-rose-700 focus:outline-none focus:ring-1 focus:ring-rose-600"
                    />
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label htmlFor="kiv-reason-input" className="block text-[11px] font-bold text-slate-700 mb-1">
                    Lý do thẩm định / chuyển đổi <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="kiv-reason-input"
                    type="text"
                    required
                    placeholder="Ví dụ: Đã gia công lại đạt kích thước dung sai; hoặc Bỏ phế do xước bề mặt sâu"
                    value={kivReason}
                    onChange={(e) => setKivReason(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  />
                </div>

                {/* NG Details for KIV -> NG */}
                {kivToNg > 0 && (
                  <div className="space-y-2 pt-2 border-t border-amber-200/80">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-rose-800 uppercase tracking-wide">
                        Chi tiết lỗi NG cho {kivToNg} sản phẩm chuyển đổi
                      </span>
                      <button
                        type="button"
                        onClick={handleAddKivNgRow}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Thêm lỗi</span>
                      </button>
                    </div>

                    <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-100/80 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                          <tr>
                            <th className="py-2 px-3 w-16">Q'ty</th>
                            <th className="py-2 px-3 w-40">Type</th>
                            <th className="py-2 px-3 w-36">Cause</th>
                            <th className="py-2 px-3">Remark</th>
                            <th className="py-2 px-3 w-32">Ảnh</th>
                            <th className="py-2 px-2 w-10 text-center"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {kivNgRows.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50">
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  required
                                  value={row.ng_qty}
                                  onChange={(e) =>
                                    handleKivNgChange(idx, 'ng_qty', Math.max(1, parseInt(e.target.value, 10) || 1))
                                  }
                                  className="w-16 px-2 py-1 bg-white border border-slate-200 rounded text-xs font-bold text-rose-700 text-center"
                                />
                              </td>
                              <td className="p-2">
                                <select
                                  value={row.defect_name}
                                  onChange={(e) => handleKivNgChange(idx, 'defect_name', e.target.value)}
                                  className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs font-semibold text-slate-800"
                                >
                                  {defectCatalog.map((def) => (
                                    <option key={def.id || def.code} value={def.name_vi}>
                                      {def.name_vi}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={row.cause || ''}
                                  onChange={(e) => handleKivNgChange(idx, 'cause', e.target.value)}
                                  className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={row.remark || ''}
                                  onChange={(e) => handleKivNgChange(idx, 'remark', e.target.value)}
                                  className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                                />
                              </td>
                              <td className="p-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {(row.photo_urls || []).map((photoPath, photoIdx) => (
                                    <div
                                      key={photoIdx}
                                      className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200 text-[11px]"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => handleViewPhoto(photoPath)}
                                        className="hover:underline flex items-center gap-0.5"
                                      >
                                        <span>Ảnh {photoIdx + 1}</span>
                                        <ExternalLink className="w-2.5 h-2.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveKivPhoto(idx, photoIdx)}
                                        className="text-slate-400 hover:text-rose-600 p-0.5"
                                      >
                                        <X className="w-2.5 h-2.5" />
                                      </button>
                                    </div>
                                  ))}
                                  {(row.photo_urls || []).length < 2 && (
                                    <label
                                      className={`cursor-pointer inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] border border-dashed border-slate-300 text-slate-600 hover:text-blue-600 bg-slate-50 transition ${
                                        uploadingKivPhotoIdx === idx ? 'opacity-50 pointer-events-none' : ''
                                      }`}
                                    >
                                      {uploadingKivPhotoIdx === idx ? (
                                        <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                                      ) : (
                                        <Paperclip className="w-3 h-3" />
                                      )}
                                      <span>+ Ảnh</span>
                                      <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/jpg"
                                        className="hidden"
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files[0]) {
                                            handleKivPhotoUpload(idx, e.target.files[0]);
                                            e.target.value = '';
                                          }
                                        }}
                                      />
                                    </label>
                                  )}
                                </div>
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveKivNgRow(idx)}
                                  className="text-slate-400 hover:text-rose-600 p-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSubmittingKiv || (kivToOk === 0 && kivToNg === 0) || !kivReason.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
                  >
                    {isSubmittingKiv ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>Xác nhận Chuyển đổi KIV</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs">
                Còn <strong>{latestRun?.kiv_qty}</strong> sản phẩm KIV đang chờ PE-MFG Leader hoặc Admin đánh giá và phân định.
              </div>
            )
          ) : (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Công đoạn này không còn sản phẩm KIV tồn đọng (KIV = 0).</span>
            </div>
          )}

          {/* Bảng lịch sử Review KIV */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                Lịch sử Đánh giá KIV ({kivReviews.length} lần)
              </span>
            </div>

            {kivReviews.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-2">
                Chưa có lịch sử review KIV cho công đoạn này.
              </p>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100/80 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 w-36">Thời gian</th>
                      <th className="py-2 px-3 w-32">Người duyệt</th>
                      <th className="py-2 px-3 w-20 text-center">KIV → OK</th>
                      <th className="py-2 px-3 w-20 text-center">KIV → NG</th>
                      <th className="py-2 px-3 w-20 text-center">Còn lại</th>
                      <th className="py-2 px-3">Lý do &amp; Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {kivReviews.map((rev) => (
                      <tr key={rev.id} className="hover:bg-slate-50/50">
                        <td className="p-2 text-slate-600 font-mono text-[11px]">
                          {new Date(rev.created_at).toLocaleString('vi-VN')}
                        </td>
                        <td className="p-2 font-medium text-slate-800">
                          {rev.reviewed_by_name || 'Leader'}
                        </td>
                        <td className="p-2 text-center font-bold text-emerald-700">
                          +{rev.kiv_to_ok}
                        </td>
                        <td className="p-2 text-center font-bold text-rose-700">
                          +{rev.kiv_to_ng}
                        </td>
                        <td className="p-2 text-center font-bold text-amber-700">
                          {rev.kiv_remaining}
                        </td>
                        <td className="p-2 text-slate-700">
                          <div>{rev.review_reason}</div>
                          {Array.isArray(rev.ng_details_snapshot) && rev.ng_details_snapshot.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {rev.ng_details_snapshot.map((ngSnap: any, sIdx: number) => (
                                <span
                                  key={sIdx}
                                  className="text-[10px] bg-rose-50 border border-rose-200 text-rose-800 px-1.5 py-0.5 rounded"
                                >
                                  {ngSnap.defect_name}: {ngSnap.ng_qty} pcs
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* SECTION 1.8: PE ENGINEERING REVIEW                                */}
      {/* ----------------------------------------------------------------- */}
      <OperationPeReviewSection
        jobId={jobId}
        operationId={operation.id}
        jobStatus={jobStatus}
        onRefresh={onRefresh}
      />

      {/* ----------------------------------------------------------------- */}
      {/* SECTION 2: QA INSPECTION SECTION                                  */}
      {/* ----------------------------------------------------------------- */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Kiểm tra Chất lượng (QA Inspection)
            </h4>
          </div>
          {latestQaCheck && (
            <span
              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                latestQaCheck.result === 'OK'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : latestQaCheck.result === 'KIV'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              Kết luận gần nhất: {latestQaCheck.result}
            </span>
          )}
        </div>

        {qaSuccessMsg && (
          <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{qaSuccessMsg}</span>
          </div>
        )}

        {qaErrorMsg && (
          <div className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{qaErrorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSaveQACheck} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {/* QA Result Toggle (OK / NG / KIV) */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Kết quả QA <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-1">
                {(['OK', 'NG', 'KIV'] as const).map((res) => (
                  <button
                    key={res}
                    type="button"
                    disabled={!canEditQa}
                    onClick={() => setQaResult(res)}
                    className={`py-1.5 text-xs font-bold rounded-lg border transition ${
                      qaResult === res
                        ? res === 'OK'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : res === 'KIV'
                          ? 'bg-amber-500 text-slate-950 border-amber-500'
                          : 'bg-rose-600 text-white border-rose-600'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    } disabled:opacity-50`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            {/* Sample Size */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Cỡ mẫu kiểm (pcs) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="1"
                required
                disabled={!canEditQa}
                value={qaSampleSize}
                onChange={(e) => setQaSampleSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
              />
            </div>

            {/* QA OK Qty */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Số lượng OK (pcs)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                disabled={!canEditQa}
                value={qaOkQty}
                onChange={(e) => setQaOkQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
              />
            </div>

            {/* QA NG Qty */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Số lượng NG (pcs)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                disabled={!canEditQa}
                value={qaNgQty}
                onChange={(e) => setQaNgQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-rose-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {/* QA Notes */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              Ghi chú thẩm định QA
            </label>
            <input
              type="text"
              disabled={!canEditQa}
              value={qaNotes}
              onChange={(e) => setQaNotes(e.target.value)}
              className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
          </div>

          {/* QA Submit Button */}
          {canEditQa && (
            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="submit"
                disabled={isSavingQa}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
              >
                {isSavingQa ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Xác nhận kiểm tra (QA)</span>
              </button>
            </div>
          )}
        </form>

        {/* Operation Attachments / Document Section */}
        <div className="pt-3 border-t border-slate-100">
          <OperationAttachmentsSection
            jobId={jobId}
            operationId={operation.id}
            jobStatus={jobStatus}
          />
        </div>
      </div>

      {/* PHOTO PREVIEW MODAL */}
      {previewPhotoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-2xl w-full p-4 shadow-2xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <FileImage className="w-4 h-4 text-blue-600" />
                Ảnh chụp lỗi thực tế (NG Photo)
              </span>
              <button
                type="button"
                onClick={() => setPreviewPhotoUrl(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center justify-center min-h-[300px] max-h-[70vh] bg-slate-900 rounded-lg overflow-hidden">
              {photoLoading ? (
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              ) : (
                <img
                  src={previewPhotoUrl}
                  alt="Ảnh chi tiết lỗi NG"
                  className="max-h-[68vh] max-w-full object-contain"
                />
              )}
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setPreviewPhotoUrl(null)}
                className="px-3 py-1.5 text-xs font-bold bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* MODAL: CLOSE OPERATION CONFIRMATION                               */}
      {/* ----------------------------------------------------------------- */}
      {showCloseOpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Xác nhận Chốt công đoạn (OP{operation.step_order})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {operation.operation_name} — {operation.workcenter_code || 'Workcenter'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCloseOpModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {closeOpError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>{closeOpError}</span>
              </div>
            )}

            {/* Snapshot Preview */}
            <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs">
              <span className="font-bold text-slate-700 uppercase tracking-wide text-[10px] block">
                Sản lượng chốt gốc (Snapshot Baseline)
              </span>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white p-2 rounded border border-slate-100 text-center">
                  <span className="text-[10px] text-slate-500 block">OK</span>
                  <span className="text-sm font-bold text-emerald-700">{okQty}</span>
                </div>
                <div className="bg-white p-2 rounded border border-slate-100 text-center">
                  <span className="text-[10px] text-slate-500 block">NG</span>
                  <span className="text-sm font-bold text-rose-700">{totalNG}</span>
                </div>
                <div className="bg-white p-2 rounded border border-slate-100 text-center">
                  <span className="text-[10px] text-slate-500 block">KIV</span>
                  <span className="text-sm font-bold text-amber-700">{kivQty}</span>
                </div>
              </div>
              <div className="text-[11px] text-slate-600 flex justify-between pt-1">
                <span>Máy: <strong>{machineId || 'Chưa nhập'}</strong></span>
                <span>Ngày: <strong>{productionDate}</strong></span>
                <span>CT: <strong>{cycleTimeActual || 'N/A'}s</strong></span>
              </div>
            </div>

            {/* Warning Message */}
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs space-y-1.5">
              <p className="font-bold flex items-center gap-1.5 text-amber-800">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span>Hệ quả bắt buộc sau khi Chốt công đoạn:</span>
              </p>
              <ul className="list-disc list-inside space-y-1 text-amber-950 text-[11px] leading-relaxed pl-1">
                <li>Sản lượng gốc của công đoạn này sẽ bị <strong>KHÓA CHẶT</strong>, không được sửa đổi trực tiếp.</li>
                <li>Toàn bộ <strong>Planning Information và Routing công đoạn</strong> của JOB sẽ bị KHÓA VĨNH VIỄN.</li>
                <li>Nếu còn {kivQty} sản phẩm KIV, việc phân định sang OK/NG sẽ thực hiện qua <em>Review KIV</em>.</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isClosingOp}
                onClick={() => setShowCloseOpModal(false)}
                className="px-3.5 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 transition"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isClosingOp}
                onClick={handleConfirmCloseOp}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
              >
                {isClosingOp ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>Xác nhận Chốt công đoạn</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

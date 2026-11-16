import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, AlertTriangle, AlertCircle, FileText, Layers, ShieldAlert, Paperclip, Camera, Image as ImageIcon } from 'lucide-react';
import type { SampleFinalReport } from '../../types/finalReport';
import { viewSamplePhotoSignedUrl } from '../../services/samplePhotoService';

interface ReportPreviewModalProps {
  isOpen: boolean;
  report: SampleFinalReport;
  onClose: () => void;
}

export const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({ isOpen, report, onClose }) => {
  if (!isOpen) return null;

  const snapshot = report.snapshot_data || {};
  const evalResult = report.evaluation_result || 'PASS';
  const operations = snapshot.operations || [];
  const engineeringDocs = snapshot.engineering_documents || [];
  const partAvatar = snapshot.part_avatar;

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (partAvatar?.file_path) {
      viewSamplePhotoSignedUrl(partAvatar.file_path).then(({ signedUrl }) => {
        if (isMounted && signedUrl) {
          setAvatarUrl(signedUrl);
        }
      });
    }
    return () => {
      isMounted = false;
    };
  }, [partAvatar?.file_path]);

  // Collect photos for appendix
  const appendixPhotos: Array<{ op: number; fileName: string; desc: string; filePath: string }> = [];
  const seenPaths = new Set<string>();

  operations.forEach((op: any) => {
    // 1. Sample photos
    (op.sample_photos || []).forEach((sp: any) => {
      if (sp.file_path && !seenPaths.has(sp.file_path)) {
        seenPaths.add(sp.file_path);
        appendixPhotos.push({
          op: op.step_order,
          fileName: sp.file_name,
          desc: `Ảnh mẫu sản phẩm${sp.is_avatar ? ' (Ảnh đại diện)' : ''}`,
          filePath: sp.file_path,
        });
      }
    });

    // 2. PE-MFG NG photos
    (op.ng_details || []).forEach((ng: any) => {
      (ng.photo_urls || []).forEach((u: string) => {
        if (u && !seenPaths.has(u)) {
          seenPaths.add(u);
          const fn = u.split('/').pop()?.split('?')[0] || 'NG_Photo.jpg';
          appendixPhotos.push({
            op: op.step_order,
            fileName: fn,
            desc: `[PE-MFG] Lỗi: [${ng.defect_code || 'NG'}] ${ng.defect_name || 'Lỗi'}${ng.remark ? ` (${ng.remark})` : ''}`,
            filePath: u,
          });
        }
      });
    });

    // 3. QA NG photos (Part C3)
    (op.qa_ng_details || []).forEach((qng: any) => {
      (qng.photo_urls || []).forEach((u: string) => {
        if (u && !seenPaths.has(u)) {
          seenPaths.add(u);
          const fn = u.split('/').pop()?.split('?')[0] || 'QA_NG_Photo.jpg';
          appendixPhotos.push({
            op: op.step_order,
            fileName: fn,
            desc: `[QA-NG] Lỗi: [${qng.defect_code || 'NG'}] ${qng.defect_name || 'Lỗi'}${qng.remark ? ` (${qng.remark})` : ''}`,
            filePath: u,
          });
        }
      });
    });

    // 4. QA N1 Check Sheet images (Part C3)
    (op.qa_checks || []).forEach((qc: any) => {
      (qc.n1_check_sheet_urls || []).forEach((u: string) => {
        if (u && !seenPaths.has(u)) {
          seenPaths.add(u);
          const fn = u.split('/').pop()?.split('?')[0] || 'N1_CheckSheet.jpg';
          appendixPhotos.push({
            op: op.step_order,
            fileName: fn,
            desc: `[QA-N1] Phiếu kiểm tra N1 (${qc.n1_result || 'OK'})`,
            filePath: u,
          });
        }
      });
    });

    // 5. QA Documents (Images)
    (op.qa_documents || []).forEach((qd: any) => {
      const mime = (qd.mime_type || '').toLowerCase();
      const fn = (qd.file_name || '').toLowerCase();
      const isImg = mime.startsWith('image/') || fn.endsWith('.jpg') || fn.endsWith('.jpeg') || fn.endsWith('.png') || fn.endsWith('.webp');
      if (isImg && qd.file_path && !seenPaths.has(qd.file_path)) {
        seenPaths.add(qd.file_path);
        appendixPhotos.push({
          op: op.step_order,
          fileName: qd.file_name,
          desc: `Kiểm tra QA (${qd.category})${qd.remark ? `: ${qd.remark}` : ''}`,
          filePath: qd.file_path,
        });
      }
    });
  });

  // Collect unified NG records (PE-MFG & QA)
  interface UnifiedNgItem {
    opStep: number;
    source: 'PE-MFG' | 'QA';
    defectQty: number;
    defectCode?: string;
    defectName: string;
    cause?: string;
    remark?: string;
    photoUrls?: string[];
  }

  const allNgRecords: UnifiedNgItem[] = [];
  operations.forEach((op: any) => {
    (op.ng_details || []).forEach((ng: any) => {
      allNgRecords.push({
        opStep: op.step_order,
        source: 'PE-MFG',
        defectQty: ng.defect_qty || ng.ng_qty || 0,
        defectCode: ng.defect_code,
        defectName: ng.defect_name || 'Lỗi sản xuất',
        cause: ng.cause,
        remark: ng.remark,
        photoUrls: ng.photo_urls || [],
      });
    });
    (op.qa_ng_details || []).forEach((qng: any) => {
      allNgRecords.push({
        opStep: op.step_order,
        source: 'QA',
        defectQty: qng.defect_qty || qng.ng_qty || 0,
        defectCode: qng.defect_code,
        defectName: qng.defect_name || 'Lỗi thẩm định QA',
        cause: qng.cause,
        remark: qng.remark,
        photoUrls: qng.photo_urls || [],
      });
    });
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900 text-white border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/30 border border-blue-400/40 flex items-center justify-center text-blue-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">
                Xem Trước Báo Cáo Tổng Kết Mẫu: <span className="font-mono text-blue-300">{snapshot.job_no}</span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Mã bản vẽ: <span className="font-mono text-slate-300">{snapshot.part_no}</span> — Đã lưu trữ bất biến (Revision R2)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md transition"
            title="Đóng modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-slate-800 text-xs">
          {/* Access Policy Info Banner */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-3 text-[11px] text-slate-600">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-slate-500 shrink-0" />
              <span>
                <strong>Chế độ xem thu gọn (Restricted Preview):</strong> Hiển thị snapshot dữ liệu tại thời điểm đóng JOB. Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) và Quản trị viên (Admin) được phép tải tệp gốc PDF &amp; ZIP.
              </span>
            </div>
          </div>

          {/* SECTION 1: PLANNING OVERVIEW + PART AVATAR (R2-04) */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100/80 px-3.5 py-2 border-b border-slate-200 font-bold text-slate-700 text-[11px] uppercase tracking-wider flex items-center justify-between">
              <span>1. Thông Tin Kế Hoạch Sản Xuất (Planning Overview)</span>
              {partAvatar && (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  Có ảnh đại diện
                </span>
              )}
            </div>
            <div className="p-3.5 flex flex-col md:flex-row gap-4 bg-white">
              {/* Left: Info Grid */}
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-[10px] text-slate-400 block">Mã JOB Ticket</span>
                  <span className="font-mono font-bold text-slate-900">{snapshot.job_no || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Mã bản vẽ (Part No)</span>
                  <span className="font-mono font-bold text-slate-900">{snapshot.part_no || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Tên sản phẩm</span>
                  <span className="font-medium text-slate-800">{snapshot.part_name || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Khách hàng</span>
                  <span className="font-medium text-slate-800">{snapshot.customer || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Sản lượng đặt hàng</span>
                  <span className="font-bold text-blue-700">{snapshot.order_qty || 0} pcs</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Ngày giao hàng</span>
                  <span className="text-slate-700">{snapshot.delivery_date || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Vật liệu</span>
                  <span className="text-slate-700">{snapshot.material || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Xử lý bề mặt</span>
                  <span className="text-slate-700">{snapshot.treatment || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Thời gian đóng</span>
                  <span className="font-mono text-slate-700">
                    {snapshot.closed_at ? new Date(snapshot.closed_at).toLocaleString('vi-VN') : '-'}
                  </span>
                </div>
              </div>

              {/* Right: Part Avatar Box */}
              <div className="w-full md:w-40 shrink-0 flex flex-col justify-between p-2 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
                  <Camera className="w-3 h-3 text-blue-600" />
                  <span>Ảnh đại diện</span>
                </span>
                <div className="flex-1 min-h-[85px] flex items-center justify-center bg-white rounded border border-slate-200 overflow-hidden p-1">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={partAvatar?.file_name || 'Part Avatar'}
                      className="max-h-20 max-w-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center p-2 text-slate-400">
                      <ImageIcon className="w-5 h-5 text-slate-300 mb-1" />
                      <span className="text-[10px] font-medium text-slate-500">Chưa có ảnh đại diện</span>
                    </div>
                  )}
                </div>
                {partAvatar?.file_name && (
                  <p className="text-[9px] text-slate-500 truncate mt-1 text-center font-mono">
                    {partAvatar.file_name}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* SECTION 2: FINAL EVALUATION */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100/80 px-3.5 py-2 border-b border-slate-200 font-bold text-slate-700 text-[11px] uppercase tracking-wider flex items-center justify-between">
              <span>2. Kết Quả Nghiệm Thu Cuối Cùng (Final Evaluation)</span>
              <span
                className={`px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase inline-flex items-center gap-1 ${
                  evalResult === 'PASS'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : evalResult === 'CONDITIONAL'
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-rose-100 text-rose-800 border border-rose-300'
                }`}
              >
                {evalResult === 'PASS' && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                {evalResult === 'CONDITIONAL' && <AlertTriangle className="w-3 h-3 text-amber-600" />}
                {evalResult === 'FAIL' && <AlertCircle className="w-3 h-3 text-rose-600" />}
                <span>{evalResult}</span>
              </span>
            </div>
            <div className="p-3.5 space-y-3 bg-white">
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 pb-2 border-b border-slate-100">
                <div>
                  Người đánh giá: <strong className="text-slate-800">{report.closed_by_name}</strong> (PE-MFG Leader)
                </div>
                <div>
                  Thời gian đóng: <strong className="text-slate-800">{new Date(report.closed_at).toLocaleString('vi-VN')}</strong>
                </div>
              </div>
              <div>
                <div className="font-bold text-slate-700 text-[11px] mb-1">Đánh giá kỹ thuật tổng thể:</div>
                <p className="p-2.5 bg-slate-50 border border-slate-200 rounded text-slate-800 leading-relaxed text-[11px]">
                  {report.overall_assessment}
                </p>
              </div>

              {report.improvements_required && (
                <div>
                  <div className="font-bold text-amber-900 text-[11px] mb-1">Hạng mục cần cải tiến:</div>
                  <p className="p-2.5 bg-amber-50/70 border border-amber-200 rounded text-amber-950 leading-relaxed text-[11px]">
                    {report.improvements_required}
                  </p>
                </div>
              )}

              {report.unresolved_issues && (
                <div>
                  <div className="font-bold text-rose-900 text-[11px] mb-1">Vấn đề tồn đọng:</div>
                  <p className="p-2.5 bg-rose-50/70 border border-rose-200 rounded text-rose-950 leading-relaxed text-[11px]">
                    {report.unresolved_issues}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 3: OPERATIONS BREAKDOWN TABLE (R2-02: Status column REMOVED) */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100/80 px-3.5 py-2 border-b border-slate-200 font-bold text-slate-700 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-blue-600" />
              <span>3. Chi Tiết Tiến Độ Sản Xuất Theo Công Đoạn</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                    <th className="py-2 px-3 w-14">Bước</th>
                    <th className="py-2 px-3">Công đoạn</th>
                    <th className="py-2 px-3">Máy</th>
                    <th className="py-2 px-3">CT Actual (s)</th>
                    <th className="py-2 px-3 text-right">OK</th>
                    <th className="py-2 px-3 text-right">NG</th>
                    <th className="py-2 px-3 text-right">KIV</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {operations.map((op: any) => {
                    const pr = op.production_run || {};
                    return (
                      <tr key={op.operation_id || op.step_order} className="hover:bg-slate-50/60">
                        <td className="py-2 px-3 font-mono font-bold text-slate-900">OP{op.step_order}</td>
                        <td className="py-2 px-3 font-medium text-slate-800">{op.operation_name}</td>
                        <td className="py-2 px-3 text-slate-600">{pr.machine_id || op.machine_no || '-'}</td>
                        <td className="py-2 px-3 text-slate-600">{pr.cycle_time_seconds || '-'}</td>
                        <td className="py-2 px-3 text-right font-bold text-emerald-700">{pr.ok_qty ?? 0}</td>
                        <td className="py-2 px-3 text-right font-bold text-rose-700">{pr.ng_qty ?? 0}</td>
                        <td className="py-2 px-3 text-right font-bold text-amber-700">{pr.kiv_qty ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* SECTION 4: NG DETAILS TABLE (R2-03 & C2: Unified PE-MFG and QA NG) */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100/80 px-3.5 py-2 border-b border-slate-200 font-bold text-slate-700 text-[11px] uppercase tracking-wider">
              4. Danh Sách Phế Phẩm &amp; Nguyên Nhân Lỗi (NG Details)
            </div>
            <div className="bg-white overflow-x-auto">
              {allNgRecords.length > 0 ? (
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <th className="py-2 px-3 w-28">Nguồn / OP</th>
                      <th className="py-2 px-3 w-20">Số lượng</th>
                      <th className="py-2 px-3">Lỗi / Nguyên nhân (Reason)</th>
                      <th className="py-2 px-3">Ghi chú (Remark)</th>
                      <th className="py-2 px-3 w-40">Tệp ảnh (Image)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allNgRecords.map((item, idx) => {
                      const fileNames = (item.photoUrls || []).slice(0, 2).map((u: string) =>
                        u.split('/').pop()?.split('?')[0] || ''
                      ).filter(Boolean);

                      return (
                        <tr key={idx} className="hover:bg-slate-50/60">
                          <td className="py-2 px-3 font-mono font-bold text-slate-900">
                            <span className="flex items-center gap-1.5">
                              <span>OP{item.opStep}</span>
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${
                                  item.source === 'QA'
                                    ? 'bg-purple-100 text-purple-700 border border-purple-200'
                                    : 'bg-amber-100 text-amber-700 border border-amber-200'
                                }`}
                              >
                                {item.source === 'QA' ? 'QA-NG' : 'PE-MFG'}
                              </span>
                            </span>
                          </td>
                          <td className="py-2 px-3 font-bold text-rose-700">{item.defectQty} pcs</td>
                          <td className="py-2 px-3">
                            <span className="font-semibold text-slate-800">
                              [{item.defectCode || 'NG'}] {item.defectName}
                            </span>
                            {item.cause && (
                              <span className="block text-[10px] text-slate-500">NN: {item.cause}</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-slate-600">{item.remark || '-'}</td>
                          <td className="py-2 px-3 text-slate-500 font-mono text-[10px]">
                            {fileNames.length > 0 ? (
                              fileNames.map((fn: string, fIdx: number) => (
                                <div key={fIdx} className="truncate" title={fn}>
                                  {fn}
                                </div>
                              ))
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-3 bg-emerald-50 text-emerald-800 text-[11px] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Không phát sinh phế phẩm (Không ghi nhận lỗi từ PE-MFG hoặc QA).</span>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 5: QA INSPECTION (C1: Revised QA Presentation) */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100/80 px-3.5 py-2 border-b border-slate-200 font-bold text-slate-700 text-[11px] uppercase tracking-wider flex items-center justify-between">
              <span>5. Kết Quả Kiểm Tra Chất Lượng (QA Inspection)</span>
            </div>
            <div className="p-3.5 space-y-2 bg-white text-[11px]">
              {operations.some((op: any) => (op.qa_checks || []).length > 0) ? (
                operations.map((op: any) =>
                  (op.qa_checks || []).map((qc: any, qIdx: number) => {
                    const n1Res = qc.n1_result || (qc.result === 'NG' ? 'NG' : 'OK');
                    const totalNg = qc.qa_total_ng ?? qc.ng_qty ?? 0;
                    return (
                      <div
                        key={`${op.step_order}-${qIdx}`}
                        className="p-2.5 rounded-lg border border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900">OP{op.step_order}</span>
                          <span className="text-slate-600 font-medium">QA Kiểm tra:</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              n1Res === 'OK'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-rose-100 text-rose-800 border border-rose-300'
                            }`}
                          >
                            N1 [{n1Res}]
                          </span>
                          <span className="font-semibold text-slate-700">
                            Tổng lỗi QA: <span className="text-rose-700 font-bold">{totalNg} pcs</span>
                          </span>
                        </div>
                        {qc.notes && (
                          <div className="text-slate-500 text-[10px] italic">
                            Ghi chú: {qc.notes}
                          </div>
                        )}
                      </div>
                    );
                  })
                )
              ) : (
                <p className="text-[11px] text-slate-400 italic">Chưa có ghi nhận kiểm tra QA độc lập.</p>
              )}
            </div>
          </div>

          {/* SECTION 6: ENGINEERING DOCUMENTS INDEX */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100/80 px-3.5 py-2 border-b border-slate-200 font-bold text-slate-700 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-slate-500" />
              <span>6. Mục Lục Tài Liệu &amp; Hồ Sơ Kỹ Thuật Đính Kèm</span>
            </div>
            <div className="p-3.5 space-y-1.5 bg-white">
              {engineeringDocs.length > 0 ? (
                engineeringDocs.map((doc: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded border border-slate-100 hover:bg-slate-50 text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {doc.category}
                      </span>
                      <span className="font-medium text-slate-800">{doc.file_name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">({doc.version || 'v1'})</span>
                    </div>
                    <span className="text-[10px] text-slate-400">Người tải: {doc.uploader_name}</span>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-slate-400 italic">Không có tài liệu đính kèm bổ sung.</p>
              )}
            </div>
          </div>

          {/* SECTION 7: PHOTO APPENDIX PREVIEW (R2-05 & C3) */}
          {appendixPhotos.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-100/80 px-3.5 py-2 border-b border-slate-200 font-bold text-slate-700 text-[11px] uppercase tracking-wider flex items-center justify-between">
                <span>7. Phụ Lục Hình Ảnh (Photo Appendix Preview)</span>
                <span className="text-[10px] text-slate-500 font-normal">
                  {appendixPhotos.length} ảnh đính kèm
                </span>
              </div>
              <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white">
                {appendixPhotos.map((photo, pIdx) => (
                  <div
                    key={pIdx}
                    className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-900 text-[10px]">
                          OP{photo.op}
                        </span>
                        <span className="font-medium text-slate-800 truncate text-[11px]">
                          {photo.fileName}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 truncate mt-0.5">
                        {photo.desc}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-white text-slate-600 text-[9px] font-bold border border-slate-200 shrink-0">
                      Appendix
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition"
          >
            Đóng cửa sổ
          </button>
        </div>
      </div>
    </div>
  );
};

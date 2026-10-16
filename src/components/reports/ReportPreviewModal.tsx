import React from 'react';
import { X, CheckCircle2, AlertTriangle, AlertCircle, FileText, Layers, ShieldAlert, Paperclip } from 'lucide-react';
import type { SampleFinalReport } from '../../types/finalReport';

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
                Mã bản vẽ: <span className="font-mono text-slate-300">{snapshot.part_no}</span> — Đã lưu trữ bất biến
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

          {/* SECTION 1: PLANNING OVERVIEW */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100/80 px-3.5 py-2 border-b border-slate-200 font-bold text-slate-700 text-[11px] uppercase tracking-wider">
              1. Thông Tin Kế Hoạch Sản Xuất (Planning Overview)
            </div>
            <div className="p-3.5 grid grid-cols-2 sm:grid-cols-3 gap-3 bg-white">
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
                <span className="text-[10px] text-slate-400 block">Phiên bản bản vẽ</span>
                <span className="font-mono text-slate-700">{snapshot.drawing_version || '-'}</span>
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

          {/* SECTION 3: OPERATIONS BREAKDOWN TABLE (NO OK/NG SUMMATION) */}
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
                    <th className="py-2 px-3 text-center">Trạng thái</th>
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
                        <td className="py-2 px-3 text-center">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                            {op.status || 'CLOSED'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* SECTION 4: DEFECT LOGS (NG DETAILS) */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100/80 px-3.5 py-2 border-b border-slate-200 font-bold text-slate-700 text-[11px] uppercase tracking-wider">
              4. Danh Sách Phế Phẩm &amp; Nguyên Nhân Lỗi (NG Details)
            </div>
            <div className="p-3.5 space-y-2 bg-white">
              {operations.some((o: any) => (o.ng_details || []).length > 0) ? (
                operations.map((op: any) =>
                  (op.ng_details || []).map((ng: any, idx: number) => (
                    <div
                      key={`${op.step_order}-${idx}`}
                      className="p-2.5 bg-slate-50 border border-slate-200 rounded flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]"
                    >
                      <div>
                        <span className="font-mono font-bold text-slate-900 mr-2">OP{op.step_order}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 mr-2">
                          {ng.defect_code || 'NG'}
                        </span>
                        <strong className="text-slate-800">{ng.defect_name || 'Lỗi'}</strong>: {ng.cause || 'Chưa rõ nguyên nhân'}
                        {ng.remark && <span className="text-slate-500 italic ml-1">({ng.remark})</span>}
                      </div>
                      <div className="font-bold text-rose-700 sm:text-right shrink-0">
                        Số lượng: {ng.defect_qty || 0} pcs
                      </div>
                    </div>
                  ))
                )
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 text-[11px] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Không phát sinh phế phẩm (NG = 0) trong toàn bộ quy trình sản xuất.</span>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 5: ENGINEERING DOCUMENTS INDEX */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100/80 px-3.5 py-2 border-b border-slate-200 font-bold text-slate-700 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-slate-500" />
              <span>5. Mục Lục Tài Liệu &amp; Hồ Sơ Kỹ Thuật Đính Kèm</span>
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

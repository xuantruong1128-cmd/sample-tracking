import React, { useState } from 'react';
import type { JobOperation } from '../../types/database.types';
import { computeOperationColor, computeLatestQAEvaluation } from '../routing/routingUtils';
import { PhaseBadge } from '../../components/common/PhaseBadge';
import { OperationAttachmentsSection } from './OperationAttachmentsSection';
import {
  Calendar,
  Cpu,
  History,
  ShieldCheck,
  Info,
} from 'lucide-react';

interface OperationDetailPanelProps {
  operation: JobOperation;
  jobId?: string;
  jobNo: string;
  partNo: string;
  jobStatus?: string;
}

export const OperationDetailPanel: React.FC<OperationDetailPanelProps> = ({
  operation,
  jobId,
  jobNo,
  partNo,
  jobStatus,
}) => {
  const [activeTab, setActiveTab] = useState<'planning' | 'mfg' | 'qa' | 'documents'>('planning');

  const colorInfo = computeOperationColor(operation);
  const qaInfo = computeLatestQAEvaluation(operation.qa_checks);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
      {/* Header of selected operation */}
      <div className="bg-slate-50 border-b border-slate-200 p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Công đoạn {operation.step_order}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${colorInfo.borderClass} ${colorInfo.bgClass}`}
            >
              Tiến độ: {colorInfo.label}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${qaInfo.badgeClass}`}
            >
              {qaInfo.label}
            </span>
          </div>
          <h3 className="text-lg font-bold text-slate-900 mt-0.5">{operation.operation_name}</h3>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5">
            Mã JOB: {jobNo} | Chi tiết: {partNo}
          </p>
        </div>

        {/* Tab navigation */}
        <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-lg text-xs font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('planning')}
            className={`px-3 py-1.5 rounded-md transition whitespace-nowrap ${
              activeTab === 'planning'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            1. Planning
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mfg')}
            className={`px-3 py-1.5 rounded-md transition whitespace-nowrap ${
              activeTab === 'mfg'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            2. PE–MFG
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('qa')}
            className={`px-3 py-1.5 rounded-md transition whitespace-nowrap ${
              activeTab === 'qa'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            3. QA
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('documents')}
            className={`px-3 py-1.5 rounded-md transition whitespace-nowrap ${
              activeTab === 'documents'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            4. Tài liệu
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-4 sm:p-6">
        {/* TAB 1: PLANNING */}
        {activeTab === 'planning' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-600" />
                Thông số Kế hoạch (Planning Specification)
              </h4>
              <PhaseBadge phase={2} label="Planning Engine" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3.5">
                <span className="text-xs text-slate-500 font-medium block">Máy / Line dự kiến:</span>
                <span className="text-sm font-bold text-slate-900 mt-1 block">
                  {operation.planned_machine || 'Chưa chỉ định'}
                </span>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3.5">
                <span className="text-xs text-slate-500 font-medium block">Cycle Time kế hoạch:</span>
                <span className="text-sm font-bold text-slate-900 mt-1 block">
                  {operation.planned_cycle_time_seconds
                    ? `${operation.planned_cycle_time_seconds} giây / cái`
                    : 'Chưa có dữ liệu'}
                </span>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3.5">
                <span className="text-xs text-slate-500 font-medium block">Thứ tự công đoạn:</span>
                <span className="text-sm font-bold text-slate-900 mt-1 block">
                  Bước {operation.step_order} trong Routing
                </span>
              </div>
            </div>

            <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-4 text-xs text-blue-900 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Quy chuẩn dữ liệu Kế hoạch (Phase 1):</p>
                <p className="mt-0.5 text-blue-800 leading-relaxed">
                  Tại Phase 1, cấu trúc Routing và thông số kế hoạch được tải từ cơ sở dữ liệu và hiển thị trực quan.
                  Chức năng thêm/sửa routing và phân bổ máy sẽ được kết nối form trực tiếp ở <strong>Phase 2</strong>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PE–MFG */}
        {activeTab === 'mfg' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <Cpu className="w-4 h-4 text-blue-600" />
                Tiến độ Sản xuất & Kỹ thuật (PE–MFG Execution)
              </h4>
              <PhaseBadge phase={3} label="PE-MFG Entry" />
            </div>

            {/* Feature preview notice */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-700">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-slate-500" />
                  Lịch sử Sản xuất (Append-only Production Runs)
                </span>
                <span className="text-[11px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">
                  Bảng: production_runs & ng_details
                </span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Mỗi lượt chạy máy của kỹ thuật viên sẽ được ghi nhận nối tiếp (không ghi đè lịch sử).
                Form nhập liệu nhanh (Máy thực tế, Cycle time đo đạc, Số lượng OK/NG, Danh mục lỗi chi tiết)
                đã được thiết kế schema và RLS đầy đủ, sẵn sàng kích hoạt tại <strong>Phase 3</strong>.
              </p>
            </div>

            {/* Production history list */}
            {(!operation.production_runs || operation.production_runs.length === 0) ? (
              <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-lg bg-slate-50/50">
                <Cpu className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-600">Chưa có lượt chạy sản xuất nào được ghi nhận</p>
                <p className="text-xs text-slate-400 mt-1">
                  Dữ liệu lượt chạy máy sẽ hiển thị tại đây khi nhân viên PE-MFG nhập báo cáo sản xuất.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border border-slate-200 rounded-lg">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase">
                    <tr>
                      <th className="p-2.5">Thời gian</th>
                      <th className="p-2.5">Máy SX</th>
                      <th className="p-2.5">Người đứng máy</th>
                      <th className="p-2.5 text-right">Cycle Time</th>
                      <th className="p-2.5 text-right">SL OK</th>
                      <th className="p-2.5 text-right">SL NG</th>
                      <th className="p-2.5">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y border-slate-100">
                    {operation.production_runs.map((run, i) => (
                      <tr key={run.id || i} className="hover:bg-slate-50">
                        <td className="p-2.5">{new Date(run.start_time).toLocaleString('vi-VN')}</td>
                        <td className="p-2.5 font-semibold">{run.machine_id}</td>
                        <td className="p-2.5">{run.operator_name}</td>
                        <td className="p-2.5 text-right">{run.cycle_time_seconds ? `${run.cycle_time_seconds}s` : '-'}</td>
                        <td className="p-2.5 text-right font-bold text-emerald-600">{run.ok_qty}</td>
                        <td className="p-2.5 text-right font-bold text-rose-600">{run.ng_qty}</td>
                        <td className="p-2.5 text-slate-500">{run.remarks || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: QA */}
        {activeTab === 'qa' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Kiểm tra Chất lượng (QA Inspection)
              </h4>
              <PhaseBadge phase={4} label="QA Inspection" />
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-700">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-slate-500" />
                  Biên bản Kiểm tra QA (Append-only QA Checks)
                </span>
                <span className="text-[11px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">
                  Bảng: qa_checks
                </span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                QA độc lập ghi nhận kết quả thẩm định (OK / NG / KIV). Báo cáo QA là tùy chọn và không bắt buộc để PE hoàn tất công đoạn.
                Kỹ sư PE chịu trách nhiệm kỹ thuật và có thể quyết định tiếp tục sản xuất (kèm Biên bản xử lý kỹ thuật nếu có NG/KIV).
                Form kiểm tra và Check Sheet số sẽ được kích hoạt tại <strong>Phase 4</strong>.
              </p>
            </div>

            {(!operation.qa_checks || operation.qa_checks.length === 0) ? (
              <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-lg bg-slate-50/50">
                <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-600">Chưa có biên bản kiểm tra QA nào</p>
                <p className="text-xs text-slate-400 mt-1">
                  Kết quả kiểm tra mẫu sẽ được ghi nhận tại đây sau khi QA thẩm định.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border border-slate-200 rounded-lg">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase">
                    <tr>
                      <th className="p-2.5">Thời gian kiểm</th>
                      <th className="p-2.5">Kỹ thuật viên QA</th>
                      <th className="p-2.5 text-right">Cỡ mẫu</th>
                      <th className="p-2.5 text-right">OK</th>
                      <th className="p-2.5 text-right">NG</th>
                      <th className="p-2.5 text-center">Kết luận</th>
                      <th className="p-2.5">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {operation.qa_checks.map((check, i) => (
                      <tr key={check.id || i} className="hover:bg-slate-50">
                        <td className="p-2.5">{new Date(check.inspection_time).toLocaleString('vi-VN')}</td>
                        <td className="p-2.5 font-semibold">{check.inspector_name}</td>
                        <td className="p-2.5 text-right">{check.sample_size}</td>
                        <td className="p-2.5 text-right font-bold text-emerald-600">{check.ok_qty}</td>
                        <td className="p-2.5 text-right font-bold text-rose-600">{check.ng_qty}</td>
                        <td className="p-2.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded font-bold ${
                              check.result === 'OK'
                                ? 'bg-emerald-100 text-emerald-700'
                                : check.result === 'KIV'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-700'
                            }`}
                          >
                            {check.result}
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-500">{check.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: DOCUMENTS & ATTACHMENTS */}
        {activeTab === 'documents' && (
          <OperationAttachmentsSection
            jobId={jobId || operation.job_id}
            operationId={operation.id}
            jobStatus={jobStatus}
          />
        )}
      </div>
    </div>
  );
};

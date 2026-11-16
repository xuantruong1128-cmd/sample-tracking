import React, { useState, useEffect } from 'react';
import type { Job } from '../../types/database.types';
import {
  updateJobPlanningAndRouting,
  fetchWorkcenterMaster,
} from '../../services/jobCreationService';
import { NumericInput } from '../../components/common/NumericInput';
import {
  UNIQUE_WORKCENTERS,
  getWorkcenterDescription,
  isAutoTurnOperation,
  type WorkcenterOption,
} from './jobDisplayUtils';
import {
  X,
  Save,
  Plus,
  Trash2,
  Lock,
  AlertCircle,
  Loader2,
  Layers,
  Package,
  ShieldAlert,
} from 'lucide-react';

interface JobEditModalProps {
  job: Job;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedMessage?: string) => void;
}

interface EditableOperation {
  id?: string | null;
  step_order: number;
  workcenter_code: string;
  description: string;
  planned_cycle_time_seconds?: number | null;
  machine_no?: string | null;
  hasExistingData?: boolean;
}

export const JobEditModal: React.FC<JobEditModalProps> = ({
  job,
  isOpen,
  onClose,
  onSuccess,
}) => {
  // Form fields for Job Header
  const [partNo, setPartNo] = useState(job.part_no || '');
  const [partName, setPartName] = useState(job.part_name || '');
  const [customer, setCustomer] = useState(job.customer || '');
  const [orderQty, setOrderQty] = useState<number>(job.order_qty ?? 1);
  const [material, setMaterial] = useState(job.material || '');
  const [materialSpec, setMaterialSpec] = useState(job.material_spec || '');
  const [plannedStartDate, setPlannedStartDate] = useState(
    job.planned_start_date ? job.planned_start_date.split('T')[0] : ''
  );
  const [plannedFinishDate, setPlannedFinishDate] = useState(
    job.planned_finish_date ? job.planned_finish_date.split('T')[0] : ''
  );

  // Operations state
  const [operations, setOperations] = useState<EditableOperation[]>([]);
  const [workcenters, setWorkcenters] = useState<WorkcenterOption[]>(UNIQUE_WORKCENTERS);

  // Status & feedback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize data on open
  useEffect(() => {
    if (isOpen) {
      setPartNo(job.part_no || '');
      setPartName(job.part_name || '');
      setCustomer(job.customer || '');
      setOrderQty(job.order_qty ?? 1);
      setMaterial(job.material || '');
      setMaterialSpec(job.material_spec || '');
      setPlannedStartDate(job.planned_start_date ? job.planned_start_date.split('T')[0] : '');
      setPlannedFinishDate(job.planned_finish_date ? job.planned_finish_date.split('T')[0] : '');

      const initialOps: EditableOperation[] = (job.operations || [])
        .sort((a, b) => a.step_order - b.step_order)
        .map((op) => {
          const hasRuns = (op.production_runs || []).length > 0;
          const hasQa = (op.qa_checks || []).length > 0;
          const hasPhotos = (op.sample_photos || []).length > 0;
          const hasQaDocs = (op.qa_documents || []).length > 0;
          const hasExisting = hasRuns || hasQa || hasPhotos || hasQaDocs;

          return {
            id: op.id,
            step_order: op.step_order,
            workcenter_code: op.workcenter_code || op.planned_machine || 'CAMC',
            description: op.description || op.operation_name || '',
            planned_cycle_time_seconds: op.planned_cycle_time_seconds,
            machine_no: op.machine_no || op.planned_machine || '',
            hasExistingData: hasExisting,
          };
        });

      setOperations(initialOps);
      setErrorMessage(null);

      // Load master workcenters
      fetchWorkcenterMaster().then((wcs) => {
        if (wcs && wcs.length > 0) {
          setWorkcenters(wcs);
        }
      });
    }
  }, [isOpen, job]);

  if (!isOpen) return null;

  // Handlers for Operations
  const handleAddOperation = () => {
    const nextOrder = (operations.length + 1) * 10;
    const defaultWc = workcenters[0]?.code || 'CAMC';
    const defaultDesc = workcenters[0]?.description || 'Auto Turn';

    setOperations([
      ...operations,
      {
        id: null, // New operation
        step_order: nextOrder,
        workcenter_code: defaultWc,
        description: defaultDesc,
        planned_cycle_time_seconds: null,
        machine_no: '',
        hasExistingData: false,
      },
    ]);
  };

  const handleRemoveOperation = (index: number) => {
    const op = operations[index];
    if (op.hasExistingData) {
      setErrorMessage(
        `Không thể xóa công đoạn OP${op.step_order} vì đã có dữ liệu sản xuất hoặc QA ghi nhận. Hệ thống bảo toàn dữ liệu thực tế.`
      );
      return;
    }

    const updated = operations.filter((_, i) => i !== index);
    // Renumber step orders
    const renumbered = updated.map((item, idx) => ({
      ...item,
      step_order: (idx + 1) * 10,
    }));
    setOperations(renumbered);
  };

  const handleOpChange = (index: number, field: keyof EditableOperation, val: any) => {
    setOperations((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      if (field === 'workcenter_code') {
        const desc = getWorkcenterDescription(val, workcenters);
        if (desc) {
          next[index].description = desc;
        }
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Basic Validations
    if (!partNo.trim()) {
      setErrorMessage('Vui lòng nhập Mã chi tiết (Part Number).');
      return;
    }
    if (!orderQty || orderQty <= 0) {
      setErrorMessage('Số lượng yêu cầu (Quantity) phải lớn hơn 0.');
      return;
    }
    if (!material.trim()) {
      setErrorMessage('Vui lòng nhập Vật liệu (Material).');
      return;
    }
    if (!plannedStartDate || !plannedFinishDate) {
      setErrorMessage('Vui lòng chọn ngày bắt đầu và kết thúc kế hoạch.');
      return;
    }
    if (plannedFinishDate < plannedStartDate) {
      setErrorMessage('Ngày kết thúc không được trước ngày bắt đầu.');
      return;
    }
    if (operations.length === 0) {
      setErrorMessage('Quy trình gia công (Routing) phải có ít nhất 1 công đoạn.');
      return;
    }

    // R4 FIX 02: Validate Auto Turn operations have Cycle Time Target > 0
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const isAutoTurn = isAutoTurnOperation(op, workcenters);
      const ct = op.planned_cycle_time_seconds;
      if (isAutoTurn && (!ct || Number(ct) <= 0 || isNaN(Number(ct)))) {
        setErrorMessage(
          `Công đoạn Auto Turn (OP${op.step_order || (i + 1) * 10}) bắt buộc phải nhập Thời gian chu kỳ mục tiêu (Cycle Time Target > 0).`
        );
        return;
      }
    }

    try {
      setIsSubmitting(true);
      const res = await updateJobPlanningAndRouting({
        jobId: job.id,
        partNo: partNo.trim(),
        partName: partName.trim() || partNo.trim(),
        customer: customer.trim(),
        orderQty,
        material: material.trim(),
        materialSpec: materialSpec.trim() || undefined,
        plannedStartDate,
        plannedFinishDate,
        operations: operations.map((op, idx) => ({
          id: op.id || null,
          step_order: (idx + 1) * 10,
          workcenter_code: op.workcenter_code,
          description: op.description,
          operation_name: op.description || op.workcenter_code,
          planned_cycle_time_seconds: op.planned_cycle_time_seconds || null,
          machine_no: op.machine_no || null,
          planned_machine: op.machine_no || null,
        })),
      });

      if (!res.success) {
        setErrorMessage(res.error || 'Cập nhật Kế hoạch & Quy trình thất bại.');
        return;
      }

      onSuccess(res.message || 'Cập nhật Kế hoạch thành công.');
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi cập nhật kế hoạch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header Bar */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Chỉnh sửa Kế hoạch &amp; Quy trình gia công (Planning Edit)
              </h3>
              <p className="text-[11px] text-slate-500">
                Cho phép chỉnh sửa thông tin và quy trình cho tới khi công đoạn đầu tiên được đóng.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body (Scrollable) */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold">Lỗi cập nhật:</span>
                <p className="mt-0.5 text-rose-700">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* SECTION 1: HEADER & JOB TICKET IMMUTABILITY */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-slate-200/80">
              <span className="font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                <Package className="w-4 h-4 text-slate-600" />
                <span>1. Thông tin chung Lệnh sản xuất</span>
              </span>
              <span className="text-[11px] text-slate-400 italic">
                * Dấu sao đỏ là bắt buộc
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {/* Job Ticket (IMMUTABLE) */}
              <div>
                <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <span>Job Ticket</span>
                  <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200 flex items-center gap-0.5">
                    <Lock className="w-2.5 h-2.5" />
                    <span>Bất biến</span>
                  </span>
                </label>
                <input
                  type="text"
                  readOnly
                  disabled
                  value={job.job_no}
                  className="w-full px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-600 cursor-not-allowed select-none"
                  title="Mã Job Ticket là định danh duy nhất và bất biến của lệnh gia công"
                />
              </div>

              {/* Item No. (Part Number) */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Item No. (Part No.) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={partNo}
                  onChange={(e) => setPartNo(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              {/* Item Name */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Tên sản phẩm (Item Name)
                </label>
                <input
                  type="text"
                  value={partName}
                  onChange={(e) => setPartName(e.target.value)}
                  placeholder={partNo}
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              {/* Customer */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Khách hàng (Customer Code)
                </label>
                <input
                  type="text"
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder="Ví dụ: Canon, Nidec, A..."
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              {/* Required Quantity (Q'TY) - USING NUMERIC INPUT */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Số lượng yêu cầu (Q'ty pcs) <span className="text-red-500">*</span>
                </label>
                <NumericInput
                  min={1}
                  required
                  value={orderQty}
                  onChange={(val) => setOrderQty(val)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-emerald-700 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              {/* Material */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Vật liệu (Material) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  placeholder="Ví dụ: SUS304, S45C..."
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              {/* Material Specification */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Quy cách vật liệu (Material Spec)
                </label>
                <input
                  type="text"
                  value={materialSpec}
                  onChange={(e) => setMaterialSpec(e.target.value)}
                  placeholder="Ví dụ: D16.0 x 2500 mm"
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              {/* Planned Start Date */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Ngày bắt đầu KH <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={plannedStartDate}
                  onChange={(e) => setPlannedStartDate(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              {/* Planned Finish Date */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Ngày hoàn thành KH <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={plannedFinishDate}
                  onChange={(e) => setPlannedFinishDate(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: ROUTING & OPERATIONS CONFIGURATION */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between pb-1 border-b border-slate-200/80">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-blue-600" />
                  <span>2. Quy trình công đoạn gia công (Routing)</span>
                </span>
                <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {operations.length} công đoạn
                </span>
              </div>

              <button
                type="button"
                onClick={handleAddOperation}
                className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm công đoạn</span>
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 w-16 text-center">Bước</th>
                    <th className="py-2.5 px-3 w-40">Workcenter</th>
                    <th className="py-2.5 px-3">Tên / Diễn giải công đoạn</th>
                    <th className="py-2.5 px-3 w-32">Máy dự kiến</th>
                    <th className="py-2.5 px-3 w-32 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span>Cycle Time Target (sec)</span>
                        <span className="text-red-500 font-bold" title="Bắt buộc đối với công đoạn Auto Turn">*</span>
                      </div>
                    </th>
                    <th className="py-2.5 px-3 w-14 text-center">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {operations.map((op, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      {/* Bước (OP10, OP20...) */}
                      <td className="p-2 text-center font-mono font-bold text-slate-700">
                        OP{(idx + 1) * 10}
                      </td>

                      {/* Workcenter Dropdown */}
                      <td className="p-2">
                        <select
                          value={op.workcenter_code}
                          onChange={(e) => handleOpChange(idx, 'workcenter_code', e.target.value)}
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        >
                          {workcenters.map((wc) => (
                            <option key={wc.code} value={wc.code}>
                              {wc.code} - {wc.description}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Description / Operation Name */}
                      <td className="p-2">
                        <input
                          type="text"
                          required
                          value={op.description}
                          onChange={(e) => handleOpChange(idx, 'description', e.target.value)}
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        />
                      </td>

                      {/* Machine No */}
                      <td className="p-2">
                        <input
                          type="text"
                          value={op.machine_no || ''}
                          onChange={(e) => handleOpChange(idx, 'machine_no', e.target.value)}
                          placeholder="Mã máy"
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        />
                      </td>

                      {/* Planned Cycle Time (NumericInput) - mandatory for Auto Turn */}
                      <td className="p-2">
                        <div className="relative flex items-center justify-center">
                          <NumericInput
                            min={0}
                            value={op.planned_cycle_time_seconds || 0}
                            onChange={(val) => handleOpChange(idx, 'planned_cycle_time_seconds', val > 0 ? val : null)}
                            placeholder={isAutoTurnOperation(op, workcenters) ? 'Bắt buộc > 0 *' : '0'}
                            className={`w-full px-2 py-1 bg-white border rounded text-xs text-center font-mono ${
                              isAutoTurnOperation(op, workcenters) && (!op.planned_cycle_time_seconds || Number(op.planned_cycle_time_seconds) <= 0)
                                ? 'border-amber-400 bg-amber-50/20'
                                : 'border-slate-300'
                            }`}
                          />
                          {isAutoTurnOperation(op, workcenters) && (
                            <span
                              data-testid={`edit-cycle-time-required-star-${idx}`}
                              className="text-red-500 font-bold text-sm ml-1 select-none flex-shrink-0"
                              title="Bắt buộc nhập Cycle Time Target > 0 cho Auto Turn"
                            >
                              *
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Delete action */}
                      <td className="p-2 text-center">
                        {op.hasExistingData ? (
                          <span
                            className="inline-flex p-1 text-slate-300 cursor-not-allowed"
                            title="Công đoạn này đã phát sinh dữ liệu (sản xuất / QA / ảnh). Không thể xóa nhằm bảo toàn dữ liệu lịch sử."
                          >
                            <Lock className="w-3.5 h-3.5 text-amber-500" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRemoveOperation(idx)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded transition"
                            title="Xóa công đoạn chưa có dữ liệu"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              <ShieldAlert className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span>
                Quy tắc an toàn: Các công đoạn đã ghi nhận kết quả sản xuất, kiểm tra QA hoặc tài liệu đính kèm sẽ được bảo vệ tuyệt đối và không thể bị xóa khi thay đổi quy trình.
              </span>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-200 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg shadow-xs flex items-center gap-2 transition disabled:opacity-60"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>{isSubmitting ? 'Đang lưu kế hoạch...' : 'Lưu thay đổi Kế hoạch'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

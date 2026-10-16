import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../auth/AuthContext';
import { permissions } from '../auth/authUtils';
import {
  createJobWithRouting,
  fetchWorkcenterMaster,
  fetchPreviewJobCode,
  validateJobInput,
  type CreateJobInput,
  type CreateOperationInput,
} from '../../services/jobCreationService';
import {
  UNIQUE_WORKCENTERS,
  getWorkcenterDescription,
  type WorkcenterOption,
} from './jobDisplayUtils';
import type { Job } from '../../types/database.types';
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  AlertCircle,
  FileCode,
  Layers,
  Calendar,
  Building2,
  Package,
  Wrench,
  CheckCircle2,
  ShieldAlert,
  ChevronDown,
  Search,
} from 'lucide-react';

interface JobCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newJob: Job) => void;
}

/**
 * Searchable Dropdown for selecting official 4-character Workcenter Codes.
 */
const WorkcenterSearchDropdown: React.FC<{
  value: string;
  onChange: (code: string) => void;
  options: WorkcenterOption[];
  stepIndex: number;
}> = ({ value, onChange, options, stepIndex }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return options;
    const q = searchTerm.toLowerCase();
    return options.filter(
      (opt) => opt.code.toLowerCase().includes(q) || opt.description.toLowerCase().includes(q)
    );
  }, [options, searchTerm]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selectedOpt = options.find((o) => o.code === value);

  return (
    <div className="relative w-full" ref={dropdownRef}>
      {/* Hidden standard select to guarantee full test event & accessibility support */}
      <select
        data-testid={`workcenter-select-${stepIndex}`}
        aria-label="Workcenter"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
      >
        <option value=""></option>
        {options.map((opt) => (
          <option key={opt.code} value={opt.code}>
            {opt.code} - {opt.description}
          </option>
        ))}
      </select>

      {/* Trigger Button */}
      <button
        type="button"
        data-testid={`workcenter-trigger-${stepIndex}`}
        onClick={() => {
          setIsOpen(!isOpen);
          setSearchTerm('');
        }}
        className={`w-full px-2.5 py-1.5 bg-white border rounded-lg text-xs font-mono font-bold flex items-center justify-between text-left transition ${
          isOpen ? 'ring-2 ring-blue-600 border-blue-600' : 'border-slate-200 hover:border-slate-300'
        } ${value ? 'text-slate-900' : 'text-slate-400 font-normal'}`}
      >
        <span className="truncate">
          {selectedOpt ? selectedOpt.code : ''}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
      </button>

      {/* Floating Searchable Menu */}
      {isOpen && (
        <div className="absolute z-50 left-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95">
          <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              autoFocus
              data-testid={`workcenter-search-input-${stepIndex}`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-transparent text-xs text-slate-900 focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-50 p-1">
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-400 italic">
                Không tìm thấy mã phù hợp
              </div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.code}
                  type="button"
                  data-testid={`workcenter-option-${opt.code}`}
                  onClick={() => {
                    onChange(opt.code);
                    setIsOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs flex items-center justify-between transition ${
                    opt.code === value
                      ? 'bg-blue-50 text-blue-700 font-bold'
                      : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <span className="font-mono font-bold">{opt.code}</span>
                  <span className="text-[11px] text-slate-500 truncate ml-2">{opt.description}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const JobCreateModal: React.FC<JobCreateModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { profile } = useAuth();
  const canCreate = permissions.canCreateJob(profile?.role);

  // Form State — General Information
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [partNo, setPartNo] = useState('');
  const [partName, setPartName] = useState('');
  const [customer, setCustomer] = useState('');
  const [orderQty, setOrderQty] = useState<number | ''>(100);
  const [material, setMaterial] = useState('');
  const [materialSpec, setMaterialSpec] = useState('');

  // Default dates: start today, finish today + 7 days
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });

  // Workcenter Master Options
  const [workcenters, setWorkcenters] = useState<WorkcenterOption[]>(UNIQUE_WORKCENTERS);

  // Load Workcenter Master and Preview Job Code on mount
  useEffect(() => {
    let mounted = true;
    fetchWorkcenterMaster().then((wcs) => {
      if (mounted && wcs.length > 0) {
        setWorkcenters(wcs);
      }
    });
    fetchPreviewJobCode().then((code) => {
      if (mounted && code) {
        setPreviewCode(code);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Routing operations state (UI-03: sequence 10, 20, 30...)
  const [operations, setOperations] = useState<CreateOperationInput[]>([
    {
      step_order: 10,
      workcenter_code: 'A20C',
      description: 'Auto Turn',
      planned_cycle_time_seconds: null,
      machine_no: '',
      remark: '',
    },
    {
      step_order: 20,
      workcenter_code: 'CGMG',
      description: 'Centerless Grinding',
      planned_cycle_time_seconds: null,
      machine_no: '',
      remark: '',
    },
  ]);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Add Operation (auto-increments sequence by 10)
  const handleAddOperation = () => {
    const nextOrder = (operations.length + 1) * 10;
    setOperations([
      ...operations,
      {
        step_order: nextOrder,
        workcenter_code: '',
        description: '',
        planned_cycle_time_seconds: null,
        machine_no: '',
        remark: '',
      },
    ]);
  };

  // Remove Operation (auto-renumbers remaining sequentially by 10)
  const handleRemoveOperation = (index: number) => {
    if (operations.length <= 1) {
      setErrorMessage('Quy trình công đoạn phải có ít nhất 1 bước.');
      return;
    }
    const filtered = operations.filter((_, idx) => idx !== index);
    const reindexed = filtered.map((op, idx) => ({
      ...op,
      step_order: (idx + 1) * 10,
    }));
    setOperations(reindexed);
  };

  // Move Operation Up (auto-renumbers sequentially by 10)
  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const reordered = [...operations];
    const temp = reordered[index - 1];
    reordered[index - 1] = reordered[index];
    reordered[index] = temp;
    setOperations(
      reordered.map((op, idx) => ({
        ...op,
        step_order: (idx + 1) * 10,
      }))
    );
  };

  // Move Operation Down (auto-renumbers sequentially by 10)
  const handleMoveDown = (index: number) => {
    if (index === operations.length - 1) return;
    const reordered = [...operations];
    const temp = reordered[index + 1];
    reordered[index + 1] = reordered[index];
    reordered[index] = temp;
    setOperations(
      reordered.map((op, idx) => ({
        ...op,
        step_order: (idx + 1) * 10,
      }))
    );
  };

  // Handle Workcenter Change (auto-populates read-only Description)
  const handleWorkcenterChange = (index: number, code: string) => {
    const desc = getWorkcenterDescription(code, workcenters);
    setOperations((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        workcenter_code: code,
        description: desc,
        operation_name: desc || code,
      };
      return next;
    });
  };

  // Handle Cycle Time Change
  const handleCycleTimeChange = (index: number, val: string) => {
    const trimmed = val.trim();
    const num = trimmed === '' ? null : Number(trimmed);
    setOperations((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        planned_cycle_time_seconds: num,
        cycle_time: num,
      };
      return next;
    });
  };

  // Handle Machine No. Change
  const handleMachineNoChange = (index: number, val: string) => {
    setOperations((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        machine_no: val,
        planned_machine: val,
      };
      return next;
    });
  };

  // Handle Remark Change
  const handleRemarkChange = (index: number, val: string) => {
    setOperations((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        remark: val,
      };
      return next;
    });
  };

  // Handle Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!canCreate) {
      setErrorMessage(
        'Quyền hạn bị từ chối: Chỉ tài khoản Admin hoặc Planning mới được tạo JOB mới.'
      );
      return;
    }

    // Routing validation
    if (operations.length === 0) {
      setErrorMessage('Quy trình công đoạn (Routing) phải có ít nhất 1 bước.');
      return;
    }

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (!op.workcenter_code?.trim() && !op.operation_name?.trim()) {
        setErrorMessage(
          `Vui lòng chọn mã Workcenter cho công đoạn tại bước thứ ${i + 1} (Operation ${op.step_order}).`
        );
        return;
      }
      const rawCycle = op.planned_cycle_time_seconds ?? op.cycle_time;
      if (rawCycle !== null && rawCycle !== undefined && rawCycle !== ('' as any)) {
        const num = Number(rawCycle);
        if (isNaN(num) || num <= 0) {
          setErrorMessage(
            `Thời gian chu kỳ (Cycle Time Target) tại bước thứ ${i + 1} phải là số dương lớn hơn 0.`
          );
          return;
        }
      }
    }

    const payload: CreateJobInput = {
      job_no: previewCode || '',
      part_no: partNo.trim(),
      part_name: partName.trim() || partNo.trim(),
      customer: customer.trim(),
      order_qty: Number(orderQty),
      material: material.trim(),
      material_spec: materialSpec.trim(),
      planned_start_date: startDate,
      planned_finish_date: endDate,
      operations: operations.map((op, idx) => ({
        step_order: (idx + 1) * 10,
        workcenter_code: (op.workcenter_code || op.operation_name || '').trim(),
        description: (op.description || getWorkcenterDescription(op.workcenter_code) || op.operation_name || '').trim(),
        operation_name: (op.description || getWorkcenterDescription(op.workcenter_code) || op.operation_name || '').trim(),
        planned_cycle_time_seconds: op.planned_cycle_time_seconds ?? null,
        machine_no: (op.machine_no || op.planned_machine || '').trim() || null,
        planned_machine: (op.machine_no || op.planned_machine || '').trim() || null,
        remark: (op.remark || '').trim() || null,
      })),
    };

    // Client-side validation
    const validation = validateJobInput(payload);
    if (!validation.isValid) {
      setErrorMessage(validation.error || 'Vui lòng kiểm tra lại thông tin nhập.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createJobWithRouting(payload);
      if (result.success && result.job) {
        onSuccess(result.job);
        onClose();
      } else {
        setErrorMessage(result.error || 'Không thể tạo JOB mới.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi lưu JOB vào hệ thống.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/70 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Plus className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                Tạo Lệnh Sản Xuất Mới (JOB Creation)
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Permission Guard Alert */}
        {!canCreate && (
          <div className="p-4 bg-amber-50 border-b border-amber-200 flex items-center gap-3 text-xs text-amber-900">
            <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <strong className="block font-semibold">Tài khoản không đủ thẩm quyền</strong>
              Vai trò hiện tại của bạn là <strong>{profile?.role || 'Khách'}</strong>. Chỉ tài khoản <strong>Planning</strong> hoặc <strong>Admin</strong> mới có quyền tạo JOB mới.
            </div>
          </div>
        )}

        {/* Scrollable Form Body */}
        <form id="job-creation-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* Server Error Alert Banner */}
          {errorMessage && (
            <div className="bg-red-50 border-l-4 border-red-500 p-3.5 rounded-r-lg flex items-start gap-3 shadow-2xs">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-red-900">Không thể hoàn tất tạo JOB</h4>
                <p className="text-xs text-red-700 mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* SECTION 1: General Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <FileCode className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                1. Thông tin chung Lệnh sản xuất (General Information)
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 sm:gap-4">
              {/* Job Code (Read-Only, Server Auto-Generated) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    Mã JOB (Job Code) <span className="text-red-600">*</span>
                  </label>
                  <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                    {previewCode ? 'Mã dự kiến' : 'Tự động tạo'}
                  </span>
                </div>
                <input
                  type="text"
                  readOnly
                  tabIndex={-1}
                  value={previewCode ? `${previewCode} (Dự kiến)` : 'Tự động tạo'}
                  className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs sm:text-sm font-mono font-bold text-slate-700 focus:outline-none cursor-not-allowed select-none"
                />
              </div>

              {/* Part Number */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Mã chi tiết (Part Number) <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={partNo}
                  onChange={(e) => setPartNo(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition"
                />
              </div>

              {/* Part Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Tên chi tiết (Part Name)
                </label>
                <input
                  type="text"
                  value={partName}
                  onChange={(e) => setPartName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition"
                />
              </div>

              {/* Customer */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Khách hàng (Customer)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Building2 className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="text"
                    value={customer}
                    onChange={(e) => setCustomer(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition"
                  />
                </div>
              </div>

              {/* Order Quantity */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Số lượng yêu cầu (Quantity) <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Package className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={orderQty}
                    onChange={(e) => setOrderQty(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition"
                  />
                </div>
              </div>

              {/* Material */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Vật liệu (Material) <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Layers className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="text"
                    required
                    value={material}
                    onChange={(e) => setMaterial(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition"
                  />
                </div>
              </div>

              {/* Material Spec */}
              <div className="sm:col-span-2 md:col-span-3">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Quy cách vật liệu (Material Specification)
                </label>
                <input
                  type="text"
                  value={materialSpec}
                  onChange={(e) => setMaterialSpec(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition"
                />
              </div>

              {/* Planned Dates */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Ngày bắt đầu KH (Planned Start Date) <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Calendar className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Ngày kết thúc KH (Planned End Date) <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Calendar className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="date"
                    required
                    min={startDate}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: Routing Configuration (UI-03: 6 Columns) */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  2. Quy trình Công đoạn Gia công (Routing Operations)
                </h3>
              </div>
            </div>

            {/* Desktop Table View (>= md) */}
            <div className="hidden md:block border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 w-16 text-center">Operation</th>
                    <th className="py-2.5 px-3 w-40">Workcenter</th>
                    <th className="py-2.5 px-3 w-44">Description</th>
                    <th className="py-2.5 px-3 w-32">Cycle Time (sec)</th>
                    <th className="py-2.5 px-3 w-28">Machine No.</th>
                    <th className="py-2.5 px-3">Remark</th>
                    <th className="py-2.5 px-2 w-20 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {operations.map((op, index) => (
                    <tr key={index} className="hover:bg-slate-50/70 transition">
                      {/* 1. Operation sequence: auto 10, 20, 30... */}
                      <td className="py-2 px-3 text-center">
                        <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                          {op.step_order}
                        </span>
                      </td>

                      {/* 2. Workcenter: Searchable dropdown */}
                      <td className="py-2 px-3">
                        <WorkcenterSearchDropdown
                          value={op.workcenter_code || ''}
                          onChange={(code) => handleWorkcenterChange(index, code)}
                          options={workcenters}
                          stepIndex={index}
                        />
                      </td>

                      {/* 3. Description: Auto-displayed, read-only */}
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          readOnly
                          tabIndex={-1}
                          data-testid={`description-input-${index}`}
                          value={op.description || ''}
                          className="w-full bg-slate-100/80 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-medium cursor-not-allowed truncate"
                        />
                      </td>

                      {/* 4. Cycle Time Target: optional number */}
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          data-testid={`cycle-time-input-${index}`}
                          value={op.planned_cycle_time_seconds ?? ''}
                          onChange={(e) => handleCycleTimeChange(index, e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 transition"
                        />
                      </td>

                      {/* 5. Machine No.: free text */}
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          data-testid={`machine-no-input-${index}`}
                          value={op.machine_no || ''}
                          onChange={(e) => handleMachineNoChange(index, e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 transition"
                        />
                      </td>

                      {/* 6. Remark: free text */}
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          data-testid={`remark-input-${index}`}
                          value={op.remark || ''}
                          onChange={(e) => handleRemarkChange(index, e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 transition"
                        />
                      </td>

                      {/* Row Actions: Up, Down, Delete */}
                      <td className="py-2 px-2 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <button
                            type="button"
                            title="Di chuyển lên trên"
                            disabled={index === 0}
                            onClick={() => handleMoveUp(index)}
                            className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-20 transition"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Di chuyển xuống dưới"
                            disabled={index === operations.length - 1}
                            onClick={() => handleMoveDown(index)}
                            className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 disabled:opacity-20 transition"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Xóa công đoạn này"
                            disabled={operations.length <= 1}
                            onClick={() => handleRemoveOperation(index)}
                            className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 disabled:opacity-20 transition ml-0.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Compact Group View (< md) */}
            <div className="md:hidden space-y-2.5">
              {operations.map((op, index) => (
                <div
                  key={index}
                  className="bg-slate-50/80 p-3 rounded-xl border border-slate-200 space-y-2.5 transition hover:border-slate-300"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded border border-blue-200">
                        Operation {op.step_order}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="Di chuyển lên trên"
                        disabled={index === 0}
                        onClick={() => handleMoveUp(index)}
                        className="p-1 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-20 transition"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Di chuyển xuống dưới"
                        disabled={index === operations.length - 1}
                        onClick={() => handleMoveDown(index)}
                        className="p-1 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-20 transition"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Xóa công đoạn này"
                        disabled={operations.length <= 1}
                        onClick={() => handleRemoveOperation(index)}
                        className="p-1 rounded text-slate-400 hover:text-red-600 disabled:opacity-20 transition ml-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Workcenter <span className="text-red-600">*</span>
                      </label>
                      <WorkcenterSearchDropdown
                        value={op.workcenter_code || ''}
                        onChange={(code) => handleWorkcenterChange(index, code)}
                        options={workcenters}
                        stepIndex={index}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Description
                      </label>
                      <input
                        type="text"
                        readOnly
                        tabIndex={-1}
                        value={op.description || ''}
                        className="w-full bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-medium cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Cycle Time Target (sec/pcs)
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        value={op.planned_cycle_time_seconds ?? ''}
                        onChange={(e) => handleCycleTimeChange(index, e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Machine No.
                      </label>
                      <input
                        type="text"
                        value={op.machine_no || ''}
                        onChange={(e) => handleMachineNoChange(index, e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Remark
                      </label>
                      <input
                        type="text"
                        value={op.remark || ''}
                        onChange={(e) => handleRemarkChange(index, e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Button "+ Thêm công đoạn" directly below table */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleAddOperation}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 rounded-lg border border-blue-200 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm công đoạn</span>
              </button>
            </div>
          </div>
        </form>

        {/* Modal Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-xs text-slate-500 font-medium">
            <span className="text-red-600">*</span> Các trường bắt buộc nhập
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-100 transition disabled:opacity-50"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              form="job-creation-form"
              disabled={isSubmitting || !canCreate}
              className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-xs hover:shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang lưu JOB...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Lưu & Tạo JOB</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

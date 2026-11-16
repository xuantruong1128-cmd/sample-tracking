import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { permissions } from '../auth/authUtils';
import { Search, Plus, X, RotateCcw, AlertCircle } from 'lucide-react';
import { JobCreateModal } from './JobCreateModal';
import type { Job } from '../../types/database.types';
import {
  type FilterCondition,
  type FilterField,
  type FilterOperator,
  createDefaultCondition,
  validateConditions,
} from './jobFilterUtils';

export interface JobToolbarProps {
  // UI-01 Dynamic Multi-Condition Filter Props
  conditions?: FilterCondition[];
  onConditionsChange?: (conditions: FilterCondition[]) => void;
  onApplyFilter?: (conditions: FilterCondition[]) => void;
  onResetFilter?: () => void;
  onJobCreated?: (newJob: Job) => void;

  // Additional action controls (e.g. Column Visibility & Export Excel)
  extraActions?: React.ReactNode;
  resetToEmpty?: boolean;

  // Backward compatibility props for legacy test suites
  searchTerm?: string;
  onSearchChange?: (value: string) => void;
  statusFilter?: 'ALL' | 'ACTIVE' | 'CLOSE';
  onStatusFilterChange?: (status: 'ALL' | 'ACTIVE' | 'CLOSE') => void;
}

export const JobToolbar: React.FC<JobToolbarProps> = ({
  conditions: externalConditions,
  onConditionsChange,
  onApplyFilter,
  onResetFilter,
  onJobCreated,
  extraActions,
  resetToEmpty = false,
  // legacy props
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
}) => {
  const { profile } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const canCreate = permissions.canCreateJob(profile?.role);

  // If running in legacy mode (used by existing phase B tests)
  const isLegacyMode = !onConditionsChange && !onApplyFilter && onSearchChange !== undefined && onStatusFilterChange !== undefined;

  // Local state for filter conditions if not controlled externally
  const [internalConditions, setInternalConditions] = useState<FilterCondition[]>([
    createDefaultCondition('init_1', 'item_number'),
  ]);
  const [validationError, setValidationError] = useState<string | null>(null);

  const activeConditions = externalConditions ?? internalConditions;

  const updateConditions = (updater: (prev: FilterCondition[]) => FilterCondition[]) => {
    const next = updater(activeConditions);
    if (onConditionsChange) {
      onConditionsChange(next);
    } else {
      setInternalConditions(next);
    }
    // Re-check validation
    const err = validateConditions(next);
    setValidationError(err);
  };

  const handleAddField = () => {
    updateConditions((prev) => [
      ...prev,
      createDefaultCondition(undefined, 'item_number'),
    ]);
  };

  const handleRemoveField = (id: string) => {
    updateConditions((prev) => prev.filter((c) => c.id !== id));
  };

  const handleFieldChange = (id: string, newField: FilterField) => {
    updateConditions((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (newField === 'status') {
          return {
            id: c.id,
            field: 'status',
            operator: 'equal',
            value: 'ACTIVE',
            valueTo: undefined,
          };
        }
        if (newField === 'start_date' || newField === 'closing_date') {
          return {
            id: c.id,
            field: newField,
            operator: 'equal',
            value: '',
            valueTo: '',
          };
        }
        // Text fields: item_number, job_number, customer, process
        return {
          id: c.id,
          field: newField,
          operator: 'contain',
          value: '',
          valueTo: undefined,
        };
      })
    );
  };

  const handleOperatorChange = (id: string, newOp: FilterOperator) => {
    updateConditions((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        return {
          ...c,
          operator: newOp,
          valueTo: newOp === 'range' ? (c.valueTo || '') : undefined,
        };
      })
    );
  };

  const handleValueChange = (id: string, value: string) => {
    updateConditions((prev) =>
      prev.map((c) => (c.id === id ? { ...c, value } : c))
    );
  };

  const handleValueToChange = (id: string, valueTo: string) => {
    updateConditions((prev) =>
      prev.map((c) => (c.id === id ? { ...c, valueTo } : c))
    );
  };

  const handleApply = () => {
    const err = validateConditions(activeConditions);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    if (onApplyFilter) {
      onApplyFilter(activeConditions);
    }
  };

  const handleReset = () => {
    const resetList = resetToEmpty ? [] : [createDefaultCondition('init_1', 'item_number')];
    if (onConditionsChange) {
      onConditionsChange(resetList);
    } else {
      setInternalConditions(resetList);
    }
    setValidationError(null);
    if (onResetFilter) {
      onResetFilter();
    }
  };

  // -------------------------------------------------------------------------
  // Legacy Fallback View (preserves Phase B test assertions)
  // -------------------------------------------------------------------------
  if (isLegacyMode) {
    return (
      <>
        <div className="bg-white border border-slate-200/90 rounded-xl p-3 sm:p-4 shadow-xs mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="h-4 w-4" />
              </div>
              <input
                type="text"
                placeholder="Tìm theo mã JOB hoặc mã chi tiết (Part No.)..."
                value={searchTerm || ''}
                onChange={(e) => onSearchChange?.(e.target.value)}
                className="block w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => onSearchChange?.('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => onStatusFilterChange?.('ALL')}
                  className={`px-3 py-1.5 rounded-md transition ${
                    statusFilter === 'ALL'
                      ? 'bg-white text-blue-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tất cả
                </button>
                <button
                  type="button"
                  onClick={() => onStatusFilterChange?.('ACTIVE')}
                  className={`px-3 py-1.5 rounded-md transition ${
                    statusFilter === 'ACTIVE'
                      ? 'bg-white text-emerald-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ACTIVE
                </button>
                <button
                  type="button"
                  onClick={() => onStatusFilterChange?.('CLOSE')}
                  className={`px-3 py-1.5 rounded-md transition ${
                    statusFilter === 'CLOSE'
                      ? 'bg-white text-slate-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  CLOSE
                </button>
              </div>

              {extraActions}

              {canCreate && (
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-xs transition touch-manipulation focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tạo JOB mới</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {showCreateModal && (
          <JobCreateModal
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onSuccess={(newJob) => {
              setShowCreateModal(false);
              onJobCreated?.(newJob);
            }}
          />
        )}
      </>
    );
  }

  // -------------------------------------------------------------------------
  // UI-01: Dynamic Multi-Condition Job Filter View
  // -------------------------------------------------------------------------
  return (
    <>
      <div className="bg-white border border-slate-200/90 rounded-xl p-3 sm:p-4 shadow-xs mb-3 space-y-3">
        {/* Condition Rows List (only rendered when there are conditions) */}
        {activeConditions.length > 0 && (
          <div className="space-y-2">
            {activeConditions.map((cond) => {
              const isDateField = cond.field === 'start_date' || cond.field === 'closing_date';
              const isRange = isDateField && cond.operator === 'range';
              const isStatus = cond.field === 'status';
              const hasRangeErr = isRange && cond.value && cond.valueTo && cond.value > cond.valueTo;

              return (
                <div
                  key={cond.id}
                  data-testid={`filter-condition-row-${cond.id}`}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 bg-slate-50/70 p-2 sm:p-2.5 rounded-lg border border-slate-200 text-xs sm:text-sm"
                >
                {/* 1. Field Dropdown */}
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Trường tìm kiếm"
                    value={cond.field}
                    onChange={(e) => handleFieldChange(cond.id, e.target.value as FilterField)}
                    className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-semibold focus:ring-2 focus:ring-blue-500 focus:outline-none min-w-[130px] text-xs sm:text-sm shadow-2xs"
                  >
                    <option value="status">Status</option>
                    <option value="item_number">Item Number</option>
                    <option value="job_number">JOB Number</option>
                    <option value="customer">Customer</option>
                    <option value="start_date">Start Date</option>
                    <option value="closing_date">Closing Date</option>
                    <option value="process">Process</option>
                  </select>

                  {/* 2. Operator Dropdown (Hidden/Omitted if Status) */}
                  {!isStatus && (
                    <select
                      aria-label="Toán tử"
                      value={cond.operator}
                      onChange={(e) => handleOperatorChange(cond.id, e.target.value as FilterOperator)}
                      className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none min-w-[100px] text-xs sm:text-sm shadow-2xs"
                    >
                      {isDateField ? (
                        <>
                          <option value="equal">Equal</option>
                          <option value="range">Range</option>
                        </>
                      ) : (
                        <>
                          <option value="contain">Contain</option>
                          <option value="equal">Equal</option>
                        </>
                      )}
                    </select>
                  )}
                </div>

                {/* 3. Input Value Area */}
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  {isStatus ? (
                    /* Status value dropdown */
                    <select
                      aria-label="Giá trị Status"
                      value={cond.value}
                      onChange={(e) => handleValueChange(cond.id, e.target.value)}
                      className="w-full sm:w-auto min-w-[140px] px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-semibold focus:ring-2 focus:ring-blue-500 focus:outline-none text-xs sm:text-sm shadow-2xs"
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="RUNNING">Running</option>
                      <option value="CLOSE">Close</option>
                    </select>
                  ) : isDateField ? (
                    isRange ? (
                      /* Date Range: From & To inputs */
                      <div className="flex items-center gap-1.5 w-full flex-wrap sm:flex-nowrap">
                        <span className="text-slate-500 text-xs font-semibold whitespace-nowrap">From:</span>
                        <input
                          type="date"
                          aria-label="Từ ngày (From)"
                          value={cond.value}
                          onChange={(e) => handleValueChange(cond.id, e.target.value)}
                          className={`flex-1 min-w-[130px] px-2.5 py-1.5 bg-white border ${
                            hasRangeErr ? 'border-red-500 ring-1 ring-red-400' : 'border-slate-300 focus:ring-blue-500'
                          } rounded-lg text-slate-900 text-xs sm:text-sm focus:ring-2 focus:outline-none shadow-2xs`}
                        />
                        <span className="text-slate-500 text-xs font-semibold whitespace-nowrap">To:</span>
                        <input
                          type="date"
                          aria-label="Đến ngày (To)"
                          value={cond.valueTo || ''}
                          onChange={(e) => handleValueToChange(cond.id, e.target.value)}
                          className={`flex-1 min-w-[130px] px-2.5 py-1.5 bg-white border ${
                            hasRangeErr ? 'border-red-500 ring-1 ring-red-400' : 'border-slate-300 focus:ring-blue-500'
                          } rounded-lg text-slate-900 text-xs sm:text-sm focus:ring-2 focus:outline-none shadow-2xs`}
                        />
                      </div>
                    ) : (
                      /* Date Equal single input */
                      <input
                        type="date"
                        aria-label="Giá trị ngày"
                        value={cond.value}
                        onChange={(e) => handleValueChange(cond.id, e.target.value)}
                        className="w-full sm:w-auto min-w-[160px] px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-2xs"
                      />
                    )
                  ) : (
                    /* Text input (Item Number, JOB Number, Customer, Process) */
                    <input
                      type="text"
                      aria-label="Giá trị tìm kiếm"
                      placeholder={
                        cond.field === 'item_number'
                          ? 'Nhập mã Item (Part No.)...'
                          : cond.field === 'job_number'
                          ? 'Nhập mã JOB...'
                          : cond.field === 'customer'
                          ? 'Nhập tên khách hàng...'
                          : 'Nhập tên công đoạn Routing...'
                      }
                      value={cond.value}
                      onChange={(e) => handleValueChange(cond.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleApply();
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-2xs transition"
                    />
                  )}
                </div>

                {/* 4. Remove row [X] button */}
                <button
                  type="button"
                  aria-label="Xóa điều kiện"
                  onClick={() => handleRemoveField(cond.id)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 active:bg-red-100 rounded-lg transition self-end sm:self-center flex-shrink-0"
                  title="Xóa điều kiện này"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
        )}

        {/* Validation Error Message */}
        {validationError && (
          <div
            data-testid="filter-validation-error"
            className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 animate-in fade-in"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-500" />
            <span className="font-semibold">{validationError}</span>
          </div>
        )}

        {/* Actions Bar */}
        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${activeConditions.length > 0 ? 'pt-2 border-t border-slate-100' : ''}`}>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Thêm điều kiện */}
            <button
              type="button"
              onClick={handleAddField}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-lg transition shadow-2xs touch-manipulation"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm điều kiện</span>
            </button>

            {/* Tìm kiếm */}
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-xs transition touch-manipulation focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Tìm kiếm</span>
            </button>

            {/* Xóa lọc */}
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 rounded-lg transition shadow-2xs touch-manipulation"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Xóa lọc</span>
            </button>
          </div>

          {/* Right side: Extra Actions (Hiển thị cột, Xuất Excel) + Tạo JOB mới */}
          <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
            {extraActions}

            {/* + Tạo JOB mới (Planning / Admin only) */}
            {canCreate && (
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-xs transition touch-manipulation focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>Tạo JOB mới</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Real JOB Creation Modal */}
      {showCreateModal && (
        <JobCreateModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={(newJob) => {
            setShowCreateModal(false);
            onJobCreated?.(newJob);
          }}
        />
      )}
    </>
  );
};

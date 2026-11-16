import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ENV } from '../../lib/env';
import type { Job } from '../../types/database.types';
import { useAuth } from '../auth/AuthContext';
import { DEMO_JOBS } from './jobDemoData';
import {
  JobCard,
  DEFAULT_JOB_COLUMN_WIDTHS,
  MIN_JOB_COLUMN_WIDTHS,
} from './JobCard';
import { JobToolbar } from './JobToolbar';
import {
  HOMEPAGE_COLUMNS,
  DEFAULT_VISIBLE_COLUMN_IDS,
} from './jobDisplayUtils';
import { exportJobsToExcel } from '../../services/excelExportService';
import {
  type FilterCondition,
  filterJobs,
} from './jobFilterUtils';
import { useTableColumnResizer } from '../../hooks/useTableColumnResizer';
import {
  Loader2,
  FolderKanban,
  Database,
  AlertCircle,
  RefreshCw,
  FlaskConical,
  CheckCircle2,
  X,
  RotateCcw,
  Eye,
  FileSpreadsheet,
} from 'lucide-react';

export const JobListPage: React.FC = () => {
  const location = useLocation();
  const { profile } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'supabase' | 'demo'>('supabase');

  // UI-01: Multi-condition dynamic filter state (hidden by default until user clicks '+ Thêm điều kiện')
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [appliedConditions, setAppliedConditions] = useState<FilterCondition[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // R4 FIX 04: Column Visibility State partitioned by user ID in localStorage
  const userStorageKey = `sample_tracking_col_visibility_${profile?.id || 'guest'}`;

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(
        `sample_tracking_col_visibility_${profile?.id || 'guest'}`
      );
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const withFixed = parsed.includes('item_no') ? parsed : ['item_no', ...parsed];
          return withFixed.slice().sort((a, b) => {
            const idxA = HOMEPAGE_COLUMNS.findIndex((c) => c.id === a);
            const idxB = HOMEPAGE_COLUMNS.findIndex((c) => c.id === b);
            return idxA - idxB;
          });
        }
      }
    } catch {
      // Fallback on error
    }
    return DEFAULT_VISIBLE_COLUMN_IDS;
  });

  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  // Close column dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setIsColumnMenuOpen(false);
      }
    };
    if (isColumnMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isColumnMenuOpen]);

  // Update visible columns if user logs in or profile changes
  useEffect(() => {
    if (profile?.id) {
      try {
        const saved = localStorage.getItem(`sample_tracking_col_visibility_${profile.id}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const withFixed = parsed.includes('item_no') ? parsed : ['item_no', ...parsed];
            setVisibleColumns(
              withFixed.slice().sort((a, b) => {
                const idxA = HOMEPAGE_COLUMNS.findIndex((c) => c.id === a);
                const idxB = HOMEPAGE_COLUMNS.findIndex((c) => c.id === b);
                return idxA - idxB;
              })
            );
          }
        }
      } catch {
        // Fallback
      }
    }
  }, [profile?.id]);

  const toggleColumn = (colId: string) => {
    // ITEM NO. is strictly non-toggleable and always visible
    if (colId === 'item_no') return;

    setVisibleColumns((prev) => {
      let next: string[];
      if (prev.includes(colId)) {
        next = prev.filter((id) => id !== colId);
        if (!next.includes('item_no')) {
          next.unshift('item_no');
        }
      } else {
        next = [...prev, colId];
      }
      // Sort strictly according to HOMEPAGE_COLUMNS order
      next.sort((a, b) => {
        const idxA = HOMEPAGE_COLUMNS.findIndex((c) => c.id === a);
        const idxB = HOMEPAGE_COLUMNS.findIndex((c) => c.id === b);
        return idxA - idxB;
      });
      try {
        localStorage.setItem(userStorageKey, JSON.stringify(next));
      } catch {
        // Ignore localStorage quota errors
      }
      return next;
    });
  };

  // Excel-like Column Width Resizer State
  const {
    columnWidths: jobColWidths,
    handleResizeStart,
    handleResetColumnWidth,
    handleResetAllWidths,
  } = useTableColumnResizer({
    storageKey: `sample_tracking_job_col_widths_${profile?.id || 'guest'}`,
    defaultWidths: DEFAULT_JOB_COLUMN_WIDTHS,
    minWidths: MIN_JOB_COLUMN_WIDTHS,
  });

  const handleRestoreDefaultColumns = () => {
    setVisibleColumns(DEFAULT_VISIBLE_COLUMN_IDS);
    handleResetAllWidths();
    try {
      localStorage.removeItem(userStorageKey);
    } catch {
      // Ignore
    }
  };

  // R4 FIX 05: Excel Export State
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (location.state?.deletedMessage) {
      setSuccessMessage(location.state.deletedMessage);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setFetchError(null);

    // F-09: Explicit Demo Mode Check
    if (ENV.IS_DEMO_MODE) {
      setJobs(DEMO_JOBS);
      setDataSource('demo');
      setLoading(false);
      return;
    }

    try {
      // Production live query: joins job_operations with production_runs & qa_checks for accurate operation coloring
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          *,
          operations:job_operations(
            *,
            production_runs(*),
            qa_checks(*)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) {
        setFetchError(`Không thể tải dữ liệu từ máy chủ Supabase: ${error.message}`);
        setJobs([]);
      } else {
        setJobs((data as Job[]) || []);
        setDataSource('supabase');
      }
    } catch (err: any) {
      setFetchError(err.message || 'Lỗi kết nối tới cơ sở dữ liệu.');
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // UI-01: Evaluate applied conditions on live data
  const filteredJobs = useMemo(() => {
    return filterJobs(jobs, appliedConditions);
  }, [jobs, appliedConditions]);

  const handleApplyFilter = (currentConditions: FilterCondition[]) => {
    setAppliedConditions([...currentConditions]);
  };

  const handleResetFilter = () => {
    setConditions([]);
    setAppliedConditions([]);
  };

  // R4 FIX 05: Export all matching jobs to Excel
  const handleExportExcel = async () => {
    if (filteredJobs.length === 0) return;
    setIsExporting(true);
    try {
      const res = await exportJobsToExcel(filteredJobs);
      if (res.success && res.filename) {
        setSuccessMessage(`Đã xuất thành công ${res.count ?? filteredJobs.length} lệnh sản xuất ra file: ${res.filename}`);
      }
      // Note: If res.cancelled === true, user dismissed save dialog; do not show success message.
      if (!res.success && !res.cancelled && res.error) {
        setFetchError(`Xuất file Excel thất bại: ${res.error}`);
      }
    } catch (err: any) {
      setFetchError(`Lỗi khi xuất file Excel: ${err.message || 'Lỗi không xác định'}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Compute CSS grid columns string for visible columns with dynamic widths
  const gridTemplateColumns = useMemo(() => {
    return visibleColumns
      .map((id) => `${jobColWidths[id] || DEFAULT_JOB_COLUMN_WIDTHS[id] || 100}px`)
      .join(' ');
  }, [visibleColumns, jobColWidths]);

  // Calculate table container minimum width to fit columns exactly
  const calculatedMinWidth = useMemo(() => {
    const totalPx = visibleColumns.reduce((sum, colId) => {
      return sum + (jobColWidths[colId] || DEFAULT_JOB_COLUMN_WIDTHS[colId] || 100);
    }, 0);
    return `${Math.max(totalPx, 360)}px`;
  }, [visibleColumns, jobColWidths]);

  return (
    <div className="space-y-4">
      {/* Page Title & Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-200/80 gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <FolderKanban className="w-6 h-6 text-blue-600" />
            Danh sách Lệnh Sản xuất Mẫu (JOB List)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Theo dõi tiến độ từ Kế hoạch → Kỹ thuật (PE-MFG) → Kiểm tra (QA)
          </p>
        </div>

        {/* Data Source Badge & Counter */}
        <div className="flex items-center gap-2 text-xs">
          {dataSource === 'demo' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold border bg-amber-50 text-amber-800 border-amber-300">
              <FlaskConical className="w-3.5 h-3.5 text-amber-600" />
              <span>Chế độ Demo (Development Mode)</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold border bg-slate-100 text-slate-700 border-slate-200">
              <Database className="w-3.5 h-3.5 text-blue-600" />
              <span>Sample Tracking</span>
            </span>
          )}
          <span className="text-slate-500 font-mono font-bold bg-slate-100 px-2.5 py-1 rounded-lg">
            {filteredJobs.length} / {jobs.length} JOBs
          </span>
        </div>
      </div>

      {/* Query Error State (F-09: No silent demo fallback) */}
      {fetchError && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex items-start justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-red-900">Lỗi truy vấn cơ sở dữ liệu</h4>
              <p className="text-xs text-red-700 mt-0.5 leading-relaxed">{fetchError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchJobs}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-md hover:bg-red-700 transition flex-shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Thử lại</span>
          </button>
        </div>
      )}

      {/* Creation / Export Success Banner */}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-xl flex items-center justify-between gap-3 text-xs text-emerald-800 shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span className="font-semibold">{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-500 hover:text-emerald-700 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Toolbar Area: Filter Toolbar + Action Buttons on the same row */}
      <JobToolbar
        conditions={conditions}
        onConditionsChange={setConditions}
        onApplyFilter={handleApplyFilter}
        onResetFilter={handleResetFilter}
        resetToEmpty={true}
        onJobCreated={(newJob) => {
          setSuccessMessage(`Đã tạo thành công Lệnh sản xuất: ${newJob.job_no} (Mã chi tiết: ${newJob.part_no})!`);
          fetchJobs();
        }}
        extraActions={
          <>
            {/* Column Visibility Popover Button */}
            <div className="relative" ref={columnMenuRef}>
              <button
                type="button"
                data-testid="column-visibility-toggle-btn"
                onClick={() => setIsColumnMenuOpen((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border rounded-lg shadow-2xs transition ${
                  isColumnMenuOpen
                    ? 'bg-blue-50 text-blue-700 border-blue-300'
                    : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300'
                }`}
                title="Tùy chỉnh bật/tắt các cột hiển thị trên bảng"
              >
                <Eye className="w-3.5 h-3.5 text-slate-500" />
                <span>Hiển thị cột</span>
                <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded-full border border-slate-200">
                  {visibleColumns.length}/{HOMEPAGE_COLUMNS.length}
                </span>
              </button>

              {/* Column Selection Dropdown */}
              {isColumnMenuOpen && (
                <div
                  data-testid="column-visibility-menu"
                  className="absolute right-0 mt-1.5 w-60 bg-white border border-slate-200 rounded-xl shadow-xl z-30 p-3 space-y-2 animate-in fade-in zoom-in-95 duration-100"
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-800">Tùy chỉnh cột hiển thị</span>
                    <button
                      type="button"
                      onClick={() => setIsColumnMenuOpen(false)}
                      className="text-slate-400 hover:text-slate-600 p-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-1 max-h-60 overflow-y-auto py-1">
                    {HOMEPAGE_COLUMNS.map((col) => {
                      const isChecked = visibleColumns.includes(col.id);
                      const isLocked = col.alwaysVisible;
                      return (
                        <label
                          key={col.id}
                          className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer select-none transition ${
                            isLocked
                              ? 'bg-slate-50 text-slate-500 cursor-not-allowed'
                              : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              data-testid={`col-toggle-${col.id}`}
                              checked={isChecked}
                              disabled={isLocked}
                              onChange={() => toggleColumn(col.id)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 disabled:opacity-60"
                            />
                            <span className={isLocked ? 'font-medium' : ''}>{col.label}</span>
                          </span>
                          {isLocked && (
                            <span className="text-[10px] text-slate-400 italic font-mono">(Cố định)</span>
                          )}
                        </label>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <button
                      type="button"
                      data-testid="restore-default-columns-btn"
                      onClick={handleRestoreDefaultColumns}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Khôi phục mặc định</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Export to Excel Button (R4 FIX 05) */}
            <button
              type="button"
              data-testid="export-excel-btn"
              onClick={handleExportExcel}
              disabled={isExporting || filteredJobs.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 border border-emerald-300 rounded-lg shadow-2xs transition disabled:opacity-50 disabled:cursor-not-allowed"
              title="Xuất toàn bộ JOBs phù hợp với bộ lọc hiện tại ra file Excel (.xlsx)"
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              )}
              <span>{isExporting ? 'Đang xuất...' : 'Xuất Excel'}</span>
            </button>
          </>
        }
      />

      {/* Loading State */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-sm font-medium text-slate-500">Đang tải danh sách JOB...</p>
        </div>
      ) : !fetchError && filteredJobs.length === 0 ? (
        /* Empty State */
        <div
          data-testid="job-list-empty-state"
          className="text-center py-16 bg-white border border-slate-200 rounded-xl p-8 shadow-xs"
        >
          <FolderKanban className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800">
            {jobs.length === 0
              ? 'Chưa có lệnh sản xuất nào trong hệ thống'
              : 'Không tìm thấy mã JOB phù hợp với bộ lọc'}
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {jobs.length === 0
              ? 'Hệ thống đã kết nối cơ sở dữ liệu thực. Nhân viên Planning có thể khởi tạo JOB mẫu khi kích hoạt Phase 2.'
              : 'Không có kết quả nào khớp với các điều kiện tìm kiếm đã chọn. Thử thay đổi điều kiện hoặc nhấn "Xóa lọc" để xem lại toàn bộ danh sách.'}
          </p>
          {jobs.length > 0 && (
            <button
              type="button"
              onClick={handleResetFilter}
              className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 rounded-lg transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Xóa lọc</span>
            </button>
          )}
        </div>
      ) : (
        /* R4 Job List Layout with Dynamic Column Visibility, Sticky Header & Sticky Job Ticket */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div
            className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-230px)] min-h-[420px] scrollbar-thin"
            data-testid="job-list-table-container"
          >
            <div style={{ minWidth: calculatedMinWidth }}>
              {/* Header danh sách: Nền xanh dương, chữ trắng, sticky cố định khi cuộn dọc và sticky cột Item No. khi cuộn ngang */}
              <div
                data-testid="job-list-header"
                style={{ gridTemplateColumns }}
                className="sticky top-0 z-20 bg-blue-600 text-white font-bold text-xs uppercase tracking-wider py-2.5 px-4 grid items-center shadow-xs select-none"
              >
                {HOMEPAGE_COLUMNS.map((col) => {
                  if (!visibleColumns.includes(col.id)) return null;
                  const isStickyCol = col.id === 'item_no';
                  return (
                    <div
                      key={col.id}
                      data-testid={`header-col-${col.id}`}
                      className={`text-left pr-2 py-1 relative group select-none ${
                        isStickyCol
                          ? 'sticky left-0 bg-blue-600 z-30 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.15)]'
                          : ''
                      }`}
                    >
                      <span className="text-left truncate block pr-2">{col.label}</span>
                      <div
                        data-testid={`resizer-${col.id}`}
                        className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize select-none flex items-center justify-center z-40 group hover:bg-blue-400/50 active:bg-blue-300"
                        onMouseDown={(e) => handleResizeStart(col.id, e)}
                        onDoubleClick={() => handleResetColumnWidth(col.id)}
                        onClick={(e) => e.stopPropagation()}
                        title={`Kéo sang trái/phải để chỉnh độ rộng cột ${col.label}. Nhấp đúp để đặt lại.`}
                      >
                        <div className="w-[1.5px] h-4 bg-blue-300/80 group-hover:bg-white transition-colors" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Danh sách các JOB: Mỗi JOB 1 dòng trên desktop, chia cách bởi border mỏng */}
              <div className="divide-y divide-slate-100">
                {filteredJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    visibleColumnIds={visibleColumns}
                    columnWidths={jobColWidths}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

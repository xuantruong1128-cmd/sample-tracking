import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ENV } from '../../lib/env';
import type { Job } from '../../types/database.types';
import { DEMO_JOBS } from './jobDemoData';
import { JobCard } from './JobCard';
import { JobToolbar } from './JobToolbar';
import {
  type FilterCondition,
  createDefaultCondition,
  filterJobs,
} from './jobFilterUtils';
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
} from 'lucide-react';

export const JobListPage: React.FC = () => {
  const location = useLocation();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'supabase' | 'demo'>('supabase');

  // UI-01: Multi-condition dynamic filter state
  const [conditions, setConditions] = useState<FilterCondition[]>([
    createDefaultCondition('init_1', 'item_number'),
  ]);
  const [appliedConditions, setAppliedConditions] = useState<FilterCondition[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
    const initial = [createDefaultCondition('init_1', 'item_number')];
    setConditions(initial);
    setAppliedConditions([]);
  };

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

      {/* Creation Success Banner */}
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

      {/* Dynamic Multi-Condition Toolbar (UI-01 Preserved) */}
      <JobToolbar
        conditions={conditions}
        onConditionsChange={setConditions}
        onApplyFilter={handleApplyFilter}
        onResetFilter={handleResetFilter}
        onJobCreated={(newJob) => {
          setSuccessMessage(`Đã tạo thành công Lệnh sản xuất: ${newJob.job_no} (Mã chi tiết: ${newJob.part_no})!`);
          fetchJobs();
        }}
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
        /* UI-02 R2 Compact Job List Layout with Unified 5-Column Grid Header */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto scrollbar-thin">
            <div className="min-w-[680px] md:min-w-0">
              {/* Header danh sách: Nền xanh dương, chữ trắng, cả 5 cột đều căn trái */}
              <div
                data-testid="job-list-header"
                className="bg-blue-600 text-white font-bold text-xs uppercase tracking-wider py-2.5 px-4 grid grid-cols-[14%_18%_8%_10%_50%] items-center shadow-xs"
              >
                <div className="text-left pr-2">Job Ticket</div>
                <div className="text-left pr-2">Item No.</div>
                <div className="text-left pr-2">Customer</div>
                <div className="text-left pr-2">Status</div>
                <div className="text-left">Routing</div>
              </div>

              {/* Danh sách các JOB: Mỗi JOB 1 dòng trên desktop, chia cách bởi border mỏng */}
              <div className="divide-y divide-slate-100">
                {filteredJobs.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ENV } from '../../lib/env';
import type { Job } from '../../types/database.types';
import { DEMO_JOBS } from './jobDemoData';
import { JobGeneralInfo } from './JobGeneralInfo';
import { OperationAccordionList } from '../operations/OperationAccordionList';
import { EngineeringDocumentsSection } from '../documents/EngineeringDocumentsSection';
import { AdminDeleteJobModal } from '../../components/admin/AdminDeleteJobModal';
import { useAuth } from '../auth/AuthContext';
import { permissions } from '../auth/authUtils';
import { closeJobFinal } from '../../services/productionResultService';
import { SampleFinalReportSection } from '../../components/reports/SampleFinalReportSection';
import { triggerReportGeneration } from '../../services/finalReportService';
import type { FinalEvaluationResult } from '../../types/finalReport';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Lock,
  Layers,
  X,
  AlertCircle,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export const JobDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [job, setJob] = useState<Job | null>(null);
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Workflow V2: Close Job (Option B) Modal State
  const [confirmTicket, setConfirmTicket] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [ackWarnings, setAckWarnings] = useState(false);
  const [isClosingJob, setIsClosingJob] = useState(false);
  const [closeJobError, setCloseJobError] = useState<string | null>(null);

  // Final Evaluation State (Phase F)
  const [evaluationResult, setEvaluationResult] = useState<FinalEvaluationResult>('PASS');
  const [overallAssessment, setOverallAssessment] = useState('');
  const [improvementsRequired, setImprovementsRequired] = useState('');
  const [unresolvedIssues, setUnresolvedIssues] = useState('');

  const loadJob = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    // F-09: Explicit Demo Mode Check
    if (ENV.IS_DEMO_MODE) {
      setAllJobs(DEMO_JOBS);
      const found = DEMO_JOBS.find((j) => j.id === id || j.job_no === id);
      setJob(found || null);
      setLoading(false);
      return;
    }

    try {
      // Production live query: NEVER fallback to demo jobs
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          *,
          operations:job_operations(
            *,
            production_runs(
              *,
              ng_details(*)
            ),
            qa_checks(*)
          )
        `)
        .eq('id', id)
        .single();

      if (error || !data) {
        setErrorMessage(error ? `Lỗi tải JOB: ${error.message}` : 'Không tìm thấy thông tin JOB trong cơ sở dữ liệu.');
        setJob(null);
      } else {
        const loadedJob = data as Job;
        setJob(loadedJob);

        // Fetch surrounding jobs for navigation
        const { data: listData } = await supabase.from('jobs').select('id, job_no').order('created_at', { ascending: false });
        if (listData) {
          setAllJobs(listData as Job[]);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi kết nối tới cơ sở dữ liệu.');
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-sm font-medium text-slate-500">Đang tải chi tiết lệnh gia công...</p>
      </div>
    );
  }

  if (errorMessage || !job) {
    return (
      <div className="py-16 text-center bg-white border border-slate-200 rounded-xl p-8 max-w-lg mx-auto shadow-xs">
        <div className="w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-3">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-800">
          {errorMessage ? 'Không thể tải thông tin JOB' : 'Không tìm thấy thông tin JOB'}
        </h3>
        <p className="text-xs text-slate-500 mt-2 mb-6">
          {errorMessage || 'Mã JOB hoặc ID truy vấn không tồn tại trong hệ thống.'}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={loadJob}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Thử lại</span>
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Về danh sách JOB</span>
          </Link>
        </div>
      </div>
    );
  }

  const currentIdx = allJobs.findIndex((j) => j.id === job.id);
  const prevJob = currentIdx > 0 ? allJobs[currentIdx - 1] : null;
  const nextJob = currentIdx >= 0 && currentIdx < allJobs.length - 1 ? allJobs[currentIdx + 1] : null;

  const isPlanningLocked =
    job.status === 'CLOSE' ||
    job.status === 'PURGED' ||
    Boolean(job.operations && job.operations.some((op) => op.status === 'CLOSED'));

  const canClose =
    permissions.canCloseJob(profile?.role, profile?.is_department_leader) && job.status === 'ACTIVE';
  const isAdmin = profile?.role === 'Admin';
  const isPlanningOwner =
    profile?.role === 'Planning' && Boolean(job.created_by && job.created_by === profile?.id);
  const isPlanningLeader =
    profile?.role === 'Planning' && Boolean(profile?.is_department_leader);
  const canDelete = isAdmin || isPlanningLeader || isPlanningOwner;

  // Warnings & Pre-conditions for Close JOB (Option B)
  const unclosedOps = (job.operations || []).filter((op) => op.status !== 'CLOSED');
  const allOpsClosed = (job.operations || []).length > 0 && unclosedOps.length === 0;

  const totalRemainingKiv = (job.operations || []).reduce((sum, op) => {
    const runs = op.production_runs || [];
    if (runs.length === 0) return sum;
    const latest = [...runs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    return sum + (latest?.kiv_qty || 0);
  }, 0);

  const incompleteQaOps = (job.operations || []).filter((op) => {
    const checks = op.qa_checks || [];
    if (checks.length === 0) return true;
    const latest = [...checks].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    return latest?.result !== 'OK';
  });

  const closeJobWarnings: string[] = [];
  if (totalRemainingKiv > 0) {
    closeJobWarnings.push(`Có ${totalRemainingKiv} sản phẩm KIV chưa được xử lý/phân định tại các công đoạn.`);
  }
  if (incompleteQaOps.length > 0) {
    closeJobWarnings.push(
      `Có ${incompleteQaOps.length} công đoạn chưa hoàn tất kiểm tra QA hoặc kết quả kiểm tra không phải là OK (${incompleteQaOps.map((o) => `OP${o.step_order}`).join(', ')}).`
    );
  }

  const handleOpenCloseModal = () => {
    setConfirmTicket('');
    setCloseReason('');
    setAckWarnings(false);
    setEvaluationResult('PASS');
    setOverallAssessment('Đạt yêu cầu kỹ thuật và tiêu chuẩn chất lượng mẫu.');
    setImprovementsRequired('');
    setUnresolvedIssues('');
    setCloseJobError(null);
    setShowCloseModal(true);
  };

  const handleConfirmCloseJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canClose || !allOpsClosed) return;
    if (confirmTicket.trim() !== job.job_no) {
      setCloseJobError(`Mã xác nhận không khớp. Vui lòng nhập chính xác "${job.job_no}".`);
      return;
    }
    if (overallAssessment.trim().length < 5) {
      setCloseJobError('Vui lòng nhập Đánh giá kỹ thuật tổng thể (tối thiểu 5 ký tự).');
      return;
    }
    if (evaluationResult === 'CONDITIONAL' && improvementsRequired.trim().length < 5) {
      setCloseJobError('Đối với kết quả CONDITIONAL (Đạt có điều kiện), bắt buộc nêu rõ các hạng mục cần cải tiến (tối thiểu 5 ký tự).');
      return;
    }
    if (closeJobWarnings.length > 0 && (!ackWarnings || closeReason.trim().length < 5)) {
      setCloseJobError('Vui lòng đánh dấu chấp nhận cảnh báo và nhập lý do đóng JOB (tối thiểu 5 ký tự).');
      return;
    }

    setIsClosingJob(true);
    setCloseJobError(null);
    const res = await closeJobFinal({
      jobId: job.id,
      confirmTicket: confirmTicket.trim(),
      closeReason: closeReason.trim() || undefined,
      acknowledgedWarnings: closeJobWarnings,
      evaluationResult,
      overallAssessment: overallAssessment.trim(),
      improvementsRequired: improvementsRequired.trim() || undefined,
      unresolvedIssues: unresolvedIssues.trim() || undefined,
    });
    setIsClosingJob(false);

    if (!res.success) {
      setCloseJobError(res.error || 'Lỗi khi đóng JOB.');
    } else {
      setShowCloseModal(false);
      // Trigger background report generation immediately
      triggerReportGeneration(job.id).catch(console.error);
      await loadJob();
    }
  };

  return (
    <div className="space-y-6">
      {/* Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:text-blue-600 hover:border-blue-400 transition shadow-2xs"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Quay lại</span>
          </Link>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Chi tiết JOB:</span>
            <strong className="font-mono text-slate-900">{job.job_no}</strong>
            {isPlanningLocked && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                <Lock className="w-3 h-3 text-amber-600" />
                <span>Planning &amp; Routing: Đã khóa</span>
              </span>
            )}
          </div>
        </div>

        {/* Quick Prev / Next Switcher & Action Buttons */}
        <div className="flex items-center gap-2">
          {prevJob && (
            <Link
              to={`/jobs/${prevJob.id}`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              title={`Chuyển tới ${prevJob.job_no}`}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="hidden md:inline font-mono">{prevJob.job_no}</span>
            </Link>
          )}

          {nextJob && (
            <Link
              to={`/jobs/${nextJob.id}`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              title={`Chuyển tới ${nextJob.job_no}`}
            >
              <span className="hidden md:inline font-mono">{nextJob.job_no}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          )}

          {canClose && (
            <button
              type="button"
              onClick={handleOpenCloseModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 transition shadow-2xs ml-2"
            >
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <span>Đóng JOB (CLOSE)</span>
            </button>
          )}

          {/* Delete Job Button (Admin, Planning Leader, Planning Owner) */}
          {canDelete && (
            <button
              type="button"
              data-testid="admin-delete-job-button"
              disabled={isPlanningLocked}
              onClick={() => setShowDeleteModal(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-2xs ml-1.5 touch-manipulation ${
                isPlanningLocked
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
                  : 'text-white bg-red-600 hover:bg-red-700 active:bg-red-800'
              }`}
              title={
                isPlanningLocked
                  ? 'JOB đã có công đoạn Close nên không được phép xóa / sửa kế hoạch'
                  : 'Xóa Lệnh sản xuất'
              }
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xóa JOB</span>
            </button>
          )}
        </div>
      </div>

      {/* SECTION 1: PLANNING INFORMATION (Compact 10-Field Grid) */}
      <section aria-label="Planning Information">
        <JobGeneralInfo job={job} isPlanningLocked={isPlanningLocked} />
      </section>

      {/* SECTION 2: OPERATIONS ACCORDION (OP10, OP20, OP30...) */}
      <section aria-label="Operations Accordion" className="space-y-3">
        <div className="flex items-center justify-between pb-1">
          <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-blue-600" />
            <span>Quy trình Công đoạn (Operations)</span>
          </h3>
          <span className="text-[11px] text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded">
            {job.operations?.length || 0} công đoạn
          </span>
        </div>

        <OperationAccordionList
          operations={job.operations || []}
          jobId={job.id}
          jobNo={job.job_no}
          partNo={job.part_no}
          jobStatus={job.status}
          onRefresh={loadJob}
        />
      </section>

      {/* SECTION 3: ENGINEERING DOCUMENTS (Drawing, Check Sheet, Setting, Other) */}
      <section aria-label="Engineering Documents" className="space-y-3">
        <EngineeringDocumentsSection
          jobId={job.id}
          operations={job.operations || []}
          jobStatus={job.status}
        />
      </section>

      {/* SECTION 4: SAMPLE FINAL REPORT (Rendered when closed) */}
      {job.status === 'CLOSE' && (
        <section aria-label="Sample Final Report" className="space-y-3">
          <SampleFinalReportSection
            jobId={job.id}
            jobNo={job.job_no}
            partNo={job.part_no}
            jobStatus={job.status}
            userRole={profile?.role}
            isLeader={profile?.is_department_leader}
          />
        </section>
      )}

      {/* Workflow V2: Close Job Confirmation Modal (Option B) */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Xác nhận Đóng JOB ({job.job_no})</h3>
                  <p className="text-[11px] text-slate-500">Chỉ PE-MFG Leader hoặc Admin có quyền thực hiện</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {closeJobError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>{closeJobError}</span>
              </div>
            )}

            {/* BLOCKER CHECK: Tất cả công đoạn phải CLOSED */}
            {!allOpsClosed ? (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-xs space-y-2">
                <div className="font-bold flex items-center gap-1.5 text-rose-800">
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span>Không thể Đóng JOB: Còn công đoạn chưa Chốt (CLOSED)!</span>
                </div>
                <p className="text-rose-800 leading-relaxed">
                  Hệ thống yêu cầu toàn bộ quy trình phải được chốt trước khi đóng JOB. Hiện có{' '}
                  <strong>{unclosedOps.length}</strong> công đoạn chưa chốt:
                </p>
                <div className="flex flex-wrap gap-1 pt-1">
                  {unclosedOps.map((op) => (
                    <span
                      key={op.id}
                      className="px-2 py-0.5 bg-white border border-rose-200 rounded text-[11px] font-bold text-rose-700"
                    >
                      OP{op.step_order} - {op.operation_name} ({op.status})
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-rose-700 pt-1 font-medium">
                  Vui lòng yêu cầu PE-MFG Leader hoặc Admin mở từng công đoạn và thực hiện "Chốt công đoạn" trước.
                </p>
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCloseModal(false)}
                    className="px-3.5 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 transition"
                  >
                    Đã hiểu
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConfirmCloseJob} className="space-y-4">
                {/* Notice về tính bất biến */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs leading-relaxed">
                  <p className="font-bold text-slate-800 mb-1">Quy tắc Đóng JOB (Section 7 &amp; Workflow V2):</p>
                  <p>
                    Khi JOB chuyển sang trạng thái <strong>CLOSE</strong>, toàn bộ thông tin Planning, Routing,
                    sản lượng PE-MFG, QA inspection và attachments sẽ chuyển sang chế độ{' '}
                    <strong className="text-rose-700">READ-ONLY vĩnh viễn (kể cả với Admin)</strong>.
                  </p>
                </div>

                {/* FINAL EVALUATION SECTION (Task 2A) */}
                <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-900 uppercase tracking-wide">
                      Đánh giá Nghiệm thu Mẫu (Final Evaluation)
                    </span>
                    <span className="text-[10px] text-blue-700 font-semibold bg-blue-100 px-2 py-0.5 rounded">
                      Bắt buộc
                    </span>
                  </div>

                  {/* Radio Group for PASS / CONDITIONAL / FAIL */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                      Kết quả nghiệm thu <span className="text-red-500">*</span>:
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <label
                        className={`flex items-center justify-center gap-1.5 p-2 rounded-lg border text-xs font-bold cursor-pointer transition ${
                          evaluationResult === 'PASS'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-400 ring-1 ring-emerald-400'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="evalResult"
                          value="PASS"
                          checked={evaluationResult === 'PASS'}
                          onChange={() => setEvaluationResult('PASS')}
                          className="sr-only"
                        />
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>PASS</span>
                      </label>

                      <label
                        className={`flex items-center justify-center gap-1.5 p-2 rounded-lg border text-xs font-bold cursor-pointer transition ${
                          evaluationResult === 'CONDITIONAL'
                            ? 'bg-amber-50 text-amber-900 border-amber-400 ring-1 ring-amber-400'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="evalResult"
                          value="CONDITIONAL"
                          checked={evaluationResult === 'CONDITIONAL'}
                          onChange={() => setEvaluationResult('CONDITIONAL')}
                          className="sr-only"
                        />
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        <span>CONDITIONAL</span>
                      </label>

                      <label
                        className={`flex items-center justify-center gap-1.5 p-2 rounded-lg border text-xs font-bold cursor-pointer transition ${
                          evaluationResult === 'FAIL'
                            ? 'bg-rose-50 text-rose-800 border-rose-400 ring-1 ring-rose-400'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="evalResult"
                          value="FAIL"
                          checked={evaluationResult === 'FAIL'}
                          onChange={() => setEvaluationResult('FAIL')}
                          className="sr-only"
                        />
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                        <span>FAIL</span>
                      </label>
                    </div>
                  </div>

                  {/* Overall Assessment Textarea */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Đánh giá kỹ thuật tổng thể <span className="text-red-500">* (tối thiểu 5 ký tự)</span>:
                    </label>
                    <textarea
                      required
                      rows={2}
                      value={overallAssessment}
                      onChange={(e) => setOverallAssessment(e.target.value)}
                      placeholder="Nhận xét tổng thể về chất lượng chi tiết, kích thước, độ cứng và độ đáp ứng yêu cầu..."
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  {/* Required Improvements (Mandatory if CONDITIONAL) */}
                  {evaluationResult === 'CONDITIONAL' && (
                    <div>
                      <label className="block text-[11px] font-bold text-amber-900 mb-1">
                        Hạng mục cần cải tiến cho lần chạy sau <span className="text-red-500">* (bắt buộc với CONDITIONAL)</span>:
                      </label>
                      <textarea
                        required
                        rows={2}
                        value={improvementsRequired}
                        onChange={(e) => setImprovementsRequired(e.target.value)}
                        placeholder="Nêu rõ các kích thước, đồ gá hoặc thông số công nghệ cần tinh chỉnh..."
                        className="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-600"
                      />
                    </div>
                  )}

                  {/* Unresolved Issues */}
                  {(evaluationResult === 'CONDITIONAL' || evaluationResult === 'FAIL') && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Vấn đề tồn đọng chưa xử lý (nếu có):
                      </label>
                      <input
                        type="text"
                        value={unresolvedIssues}
                        onChange={(e) => setUnresolvedIssues(e.target.value)}
                        placeholder="Ví dụ: Rung rơ bề mặt ở máy phay CNC 02..."
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  )}
                </div>

                {/* WARNINGS CHECKLIST (Phương án B) */}
                {closeJobWarnings.length > 0 ? (
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs space-y-2.5">
                    <div className="font-bold flex items-center gap-1.5 text-amber-800">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <span>Cảnh báo tồn đọng (Phương án B - Đóng có điều kiện):</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-amber-950 text-[11px] pl-1">
                      {closeJobWarnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>

                    <div className="pt-2 border-t border-amber-200/80 space-y-2">
                      <label className="flex items-start gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={ackWarnings}
                          onChange={(e) => setAckWarnings(e.target.checked)}
                          className="mt-0.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span className="text-[11px] font-semibold text-amber-900">
                          Tôi xác nhận đã kiểm tra và đồng ý đóng JOB bất kể các cảnh báo trên.
                        </span>
                      </label>

                      <div>
                        <label className="block text-[11px] font-bold text-amber-900 mb-1">
                          Lý do chấp nhận đóng JOB <span className="text-red-500">* (tối thiểu 5 ký tự)</span>:
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Ví dụ: Đơn vị khách hàng đồng ý nhận sớm, KIV xử lý ở đợt khác..."
                          value={closeReason}
                          onChange={(e) => setCloseReason(e.target.value)}
                          className="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-600"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <span>Tất cả công đoạn đã chốt hoàn hảo. Không có KIV tồn đọng và QA đã nghiệm thu OK.</span>
                  </div>
                )}

                {/* CONFIRM TICKET INPUT */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Nhập lại chính xác Mã JOB Ticket <span className="text-red-500">*</span>:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={`Gõ lại chính xác "${job.job_no}"`}
                    value={confirmTicket}
                    onChange={(e) => setConfirmTicket(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-800"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Gõ đúng mã: <strong className="font-mono text-slate-700">{job.job_no}</strong>
                  </span>
                </div>

                <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={isClosingJob}
                    onClick={() => setShowCloseModal(false)}
                    className="px-3.5 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 transition"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isClosingJob ||
                      confirmTicket.trim() !== job.job_no ||
                      overallAssessment.trim().length < 5 ||
                      (evaluationResult === 'CONDITIONAL' && improvementsRequired.trim().length < 5) ||
                      (closeJobWarnings.length > 0 && (!ackWarnings || closeReason.trim().length < 5))
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
                  >
                    {isClosingJob ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    <span>Xác nhận Đóng JOB (CLOSE)</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Admin Delete Job Modal */}
      {showDeleteModal && (
        <AdminDeleteJobModal
          isOpen={showDeleteModal}
          job={job}
          onClose={() => setShowDeleteModal(false)}
          onSuccess={(deletedJobNo) => {
            setShowDeleteModal(false);
            navigate('/', {
              state: { deletedMessage: `Đã xóa thành công Lệnh sản xuất: ${deletedJobNo}` },
            });
          }}
        />
      )}
    </div>
  );
};

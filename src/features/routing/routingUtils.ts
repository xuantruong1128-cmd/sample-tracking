import type { JobOperation, OperationStatus } from '../../types/database.types';
import type { OperationColorInfo } from '../../types/job';

/**
 * Computes status color according to Section 4.B business rules:
 * - GREEN: MFG completed and QA confirmed OK.
 * - YELLOW: In production, waiting for QA, QA KIV, or NG under resolution.
 * - BLACK: Not started.
 *
 * NOTE: Strictly computed from workflow data. Cannot be selected manually.
 */
export function computeOperationColor(op: { status: OperationStatus }): OperationColorInfo {
  switch (op.status) {
    case 'CLOSED':
      return {
        color: 'GREEN',
        label: 'Đã chốt (CLOSED)',
        bgClass: 'bg-indigo-600 text-white',
        textClass: 'text-indigo-700',
        borderClass: 'border-indigo-600',
      };

    case 'COMPLETED':
      return {
        color: 'GREEN',
        label: 'Hoàn tất (PE)',
        bgClass: 'bg-emerald-600 text-white',
        textClass: 'text-emerald-700',
        borderClass: 'border-emerald-600',
      };

    case 'HOLD':
      return {
        color: 'YELLOW',
        label: 'Tạm dừng (HOLD)',
        bgClass: 'bg-amber-500 text-slate-950 font-bold',
        textClass: 'text-amber-900',
        borderClass: 'border-amber-500',
      };

    case 'IN_PROGRESS':
      return {
        color: 'YELLOW',
        label: 'Đang sản xuất (PE)',
        bgClass: 'bg-amber-400 text-slate-950 font-bold',
        textClass: 'text-amber-800',
        borderClass: 'border-amber-400',
      };

    case 'WAITING_QA':
    case 'QA_KIV':
    case 'QA_NG':
      return {
        color: 'YELLOW',
        label: 'Đang xử lý (PE)',
        bgClass: 'bg-amber-400 text-slate-950 font-bold',
        textClass: 'text-amber-800',
        borderClass: 'border-amber-400',
      };

    case 'NOT_STARTED':
    default:
      return {
        color: 'BLACK',
        label: 'Chưa bắt đầu',
        bgClass: 'bg-slate-800 text-slate-100',
        textClass: 'text-slate-600',
        borderClass: 'border-slate-700',
      };
  }
}

/**
 * UI-02 Section 3: Workflow Operation Status Color Rules for Compact Job List
 *
 * Rules:
 * - GREEN: Có sản lượng OK > 0 và QA đã xác nhận OK.
 * - YELLOW: Đang sản xuất, chờ QA hoặc QA KIV (hoặc trạng thái trung tính khi dữ liệu chưa đủ 2 điều kiện).
 * - BLACK / DARK: Chưa bắt đầu.
 *
 * NOTE: Strictly computed from operation's production_runs and qa_checks.
 * Không xác định màu chỉ dựa vào trạng thái JOB tổng thể.
 * Không được đánh dấu GREEN khi chưa đủ cả hai điều kiện.
 */
export function computeCompactOperationColor(op: {
  status: OperationStatus;
  production_runs?: { ok_qty?: number }[];
  qa_checks?: { result: string }[];
}): {
  color: 'GREEN' | 'YELLOW' | 'BLACK';
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
} {
  const prodRuns = op.production_runs || [];
  const qaChecks = op.qa_checks || [];

  const hasOkProduction = prodRuns.some((run) => (run.ok_qty || 0) > 0);
  const hasOkQa = qaChecks.some((chk) => chk.result === 'OK');

  // CLOSED: Đã chốt sản lượng bởi PE-MFG Leader / Admin
  if (op.status === 'CLOSED') {
    return {
      color: 'GREEN',
      label: 'Đã chốt (CLOSED)',
      bgClass: 'bg-indigo-600 text-white',
      textClass: 'text-indigo-700',
      borderClass: 'border-indigo-600',
    };
  }

  // GREEN: Có sản lượng OK > 0 VÀ QA đã xác nhận OK
  if (hasOkProduction && hasOkQa) {
    return {
      color: 'GREEN',
      label: 'Hoàn tất (MFG + QA)',
      bgClass: 'bg-emerald-600 text-white',
      textClass: 'text-emerald-700',
      borderClass: 'border-emerald-600',
    };
  }

  // BLACK / DARK: Chưa bắt đầu (NOT_STARTED và không có production runs)
  if (op.status === 'NOT_STARTED' && prodRuns.length === 0) {
    return {
      color: 'BLACK',
      label: 'Chưa bắt đầu',
      bgClass: 'bg-slate-800 text-slate-100',
      textClass: 'text-slate-600',
      borderClass: 'border-slate-800',
    };
  }

  // YELLOW: Đang sản xuất, chờ QA, QA KIV, hoặc dữ liệu chưa đủ 2 điều kiện GREEN
  return {
    color: 'YELLOW',
    label: 'Đang xử lý / Chờ QA',
    bgClass: 'bg-amber-400 text-slate-950 font-bold',
    textClass: 'text-amber-800',
    borderClass: 'border-amber-400',
  };
}

/**
 * Section A3: Independent QA Evaluation Helper
 */
export function computeLatestQAEvaluation(qaChecks?: { result: string; inspection_time?: string; created_at?: string }[]): {
  result: 'NOT_REPORTED' | 'OK' | 'NG' | 'KIV';
  label: string;
  badgeClass: string;
} {
  if (!qaChecks || qaChecks.length === 0) {
    return {
      result: 'NOT_REPORTED',
      label: 'Chưa kiểm tra (Optional)',
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-300',
    };
  }

  const sorted = [...qaChecks].sort((a, b) => {
    const timeA = new Date(a.inspection_time || a.created_at || 0).getTime();
    const timeB = new Date(b.inspection_time || b.created_at || 0).getTime();
    return timeB - timeA;
  });

  const latest = sorted[0];
  switch (latest.result) {
    case 'OK':
      return {
        result: 'OK',
        label: 'QA: OK (Đạt)',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold',
      };
    case 'NG':
      return {
        result: 'NG',
        label: 'QA: NG (Không đạt)',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300 font-bold',
      };
    case 'KIV':
      return {
        result: 'KIV',
        label: 'QA: KIV (Tạm giữ)',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 font-bold',
      };
    default:
      return {
        result: 'NOT_REPORTED',
        label: 'Chưa kiểm tra',
        badgeClass: 'bg-slate-100 text-slate-600 border-slate-300',
      };
  }
}

/**
 * Helper to get progress statistics for a JOB's routing
 */
export function getRoutingStats(operations: JobOperation[] = []) {
  if (!operations || operations.length === 0) {
    return { total: 0, completed: 0, inProgress: 0, notStarted: 0, percentage: 0 };
  }

  const total = operations.length;
  const completed = operations.filter((op) => op.status === 'COMPLETED').length;
  const inProgress = operations.filter(
    (op) =>
      op.status === 'IN_PROGRESS' ||
      op.status === 'WAITING_QA' ||
      op.status === 'QA_KIV' ||
      op.status === 'QA_NG'
  ).length;
  const notStarted = operations.filter((op) => op.status === 'NOT_STARTED').length;
  const percentage = Math.round((completed / total) * 100);

  return { total, completed, inProgress, notStarted, percentage };
}

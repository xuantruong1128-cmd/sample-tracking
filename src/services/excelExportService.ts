import * as XLSX from 'xlsx';
import type { Job } from '../types/database.types';
import type { DrawingReviewActivityLog } from '../types/drawingReview';
import { formatHanoiDateTime } from './drawingReviewService';
import {
  getCustomerCode,
  getJobDisplayStatus,
  getCreatedDateDisplay,
  getPlanCloseDateDisplay,
  getActualCloseDateDisplay,
  getWorkcenterCode,
  getJobAutoTurnCTInfo,
} from '../features/jobs/jobDisplayUtils';

export interface ExportResult {
  success: boolean;
  cancelled?: boolean;
  filename?: string;
  count?: number;
  error?: string;
}

/**
 * Converts a Job's routing operations into a clean text flow:
 * e.g. "A20C → CGMG → WSHP → VMIQ"
 * Omits HTML, badges, or styling.
 */
export function formatRoutingAsText(job: Job): string {
  const ops = [...(job.operations || [])].sort((a, b) => a.step_order - b.step_order);
  if (ops.length === 0) return 'Chưa thiết lập Routing';
  const codes = ops.map((op) => getWorkcenterCode(op)).filter(Boolean);
  return codes.length > 0 ? codes.join(' → ') : 'Chưa thiết lập Routing';
}

/**
 * Generates standard filename: Sample_Tracking_JOBs_YYYYMMDD.xlsx
 */
export function getDefaultExportFilename(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `Sample_Tracking_JOBs_${yyyy}${mm}${dd}.xlsx`;
}

/**
 * Builds an XLSX workbook containing all columns matching the Homepage schema in exact order:
 * 1. Job Ticket
 * 2. Item No.
 * 3. Customer
 * 4. Created Date (DD/MM/YY)
 * 5. Plan Close (DD/MM/YY)
 * 6. Actual Close (DD/MM/YY)
 * 7. Status
 * 8. Q'ty
 * 9. CT Plan
 * 10. CT Actual
 * 11. CT Status
 * 12. Routing
 */
export function generateJobsWorkbook(jobs: Job[]): XLSX.WorkBook {
  const headers = [
    'Job Ticket',
    'Item No.',
    'Customer',
    'Created Date',
    'Plan Close',
    'Actual Close',
    'Status',
    "Q'ty",
    'CT Plan',
    'CT Actual',
    'CT Status',
    'Routing',
  ];

  const rows = jobs.map((job) => {
    const ctInfo = getJobAutoTurnCTInfo(job);
    return [
      job.job_no || '',
      job.part_no || '',
      getCustomerCode(job.customer) || '',
      getCreatedDateDisplay(job),
      getPlanCloseDateDisplay(job),
      getActualCloseDateDisplay(job),
      getJobDisplayStatus(job),
      job.order_qty ?? 0,
      ctInfo.totalPlan !== null ? ctInfo.totalPlan : '',
      ctInfo.totalActual !== null ? ctInfo.totalActual : '',
      ctInfo.statusLabel,
      formatRoutingAsText(job),
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Set explicit types:
  // - Column 7 (Q'ty): numeric 'n' with integer format '0'
  // - Column 8 (CT Plan): numeric 'n' (unrounded sum of Auto Turn CT targets)
  // - Column 9 (CT Actual): numeric 'n' (unrounded sum of latest valid CT actuals)
  // - If CT Actual is partial, adds cell comment marking incomplete status to avoid misinterpretation
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:L1');
  for (let R = 1; R <= range.e.r; ++R) {
    const job = jobs[R - 1];
    const ctInfo = job ? getJobAutoTurnCTInfo(job) : null;

    for (let C = 0; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[cellAddress] || ws[cellAddress].v === undefined) continue;

      if (C === 7) {
        // Column 7 (index 7) is Q'ty: numeric cell with format '0'
        const rawVal = ws[cellAddress].v;
        const numVal = typeof rawVal === 'number' ? rawVal : Number(rawVal);
        const intVal = isNaN(numVal) ? 0 : Math.round(numVal);
        ws[cellAddress].t = 'n';
        ws[cellAddress].v = intVal;
        ws[cellAddress].z = '0';
      } else if (C === 8) {
        // Column 8 (index 8) is CT Plan: numeric cell
        const rawVal = ws[cellAddress].v;
        const numVal = typeof rawVal === 'number' ? rawVal : Number(rawVal);
        if (rawVal !== '' && rawVal !== null && rawVal !== undefined && !isNaN(numVal)) {
          ws[cellAddress].t = 'n';
          ws[cellAddress].v = numVal;
          ws[cellAddress].z = Number.isInteger(numVal) ? '0' : '0.##';
        } else {
          ws[cellAddress].t = 's';
          ws[cellAddress].v = '—';
        }
      } else if (C === 9) {
        // Column 9 (index 9) is CT Actual: numeric cell
        const rawVal = ws[cellAddress].v;
        const numVal = typeof rawVal === 'number' ? rawVal : Number(rawVal);
        if (rawVal !== '' && rawVal !== null && rawVal !== undefined && !isNaN(numVal)) {
          ws[cellAddress].t = 'n';
          ws[cellAddress].v = numVal;
          ws[cellAddress].z = Number.isInteger(numVal) ? '0' : '0.##';
          if (ctInfo && !ctInfo.isComplete && ctInfo.status === 'partial') {
            ws[cellAddress].c = [
              {
                t: `Chưa đủ CT (${ctInfo.actualRecordedCount}/${ctInfo.autoTurnCount} công đoạn Auto Turn)`,
                a: 'System',
              },
            ];
          }
        } else {
          ws[cellAddress].t = 's';
          ws[cellAddress].v = '—';
        }
      } else {
        // All other columns are strings to preserve leading zeros and formatting
        ws[cellAddress].t = 's';
        ws[cellAddress].v = String(ws[cellAddress].v);
      }
    }
  }

  // Freeze top header row
  ws['!views'] = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }];

  // Auto-filter for the full table range
  ws['!autofilter'] = {
    ref: `A1:L${Math.max(rows.length + 1, 1)}`,
  };

  // Set reasonable column widths
  ws['!cols'] = [
    { wch: 18 }, // Job Ticket
    { wch: 22 }, // Item No.
    { wch: 12 }, // Customer
    { wch: 14 }, // Created Date
    { wch: 14 }, // Plan Close
    { wch: 14 }, // Actual Close
    { wch: 12 }, // Status
    { wch: 10 }, // Q'ty
    { wch: 12 }, // CT Plan
    { wch: 14 }, // CT Actual
    { wch: 16 }, // CT Status
    { wch: 38 }, // Routing
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'JOBs');
  return wb;
}

/**
 * Exports jobs to an Excel file (.xlsx) with modern File System Access API (showSaveFilePicker)
 * and fallback for mobile or unsupported browsers.
 * Does NOT report success if the user cancels the save dialog.
 */
export async function exportJobsToExcel(
  jobs: Job[],
  customFilename?: string
): Promise<ExportResult> {
  if (!jobs || jobs.length === 0) {
    return { success: false, error: 'Không có dữ liệu để xuất file Excel.' };
  }

  const filename = customFilename || getDefaultExportFilename();
  const wb = generateJobsWorkbook(jobs);
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  // 1. Try browser showSaveFilePicker if available
  if (typeof window !== 'undefined' && typeof (window as any).showSaveFilePicker === 'function') {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'Bảng tính Excel (*.xlsx)',
            accept: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return {
        success: true,
        filename: handle.name || filename,
        count: jobs.length,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User explicitly clicked Cancel in the file picker dialog
        return { success: false, cancelled: true };
      }
      // If error other than AbortError (e.g. security rejection), fall back to standard download
    }
  }

  // 2. Fallback: Trigger standard browser/mobile download
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return {
      success: true,
      filename,
      count: jobs.length,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Lỗi khi tải file Excel về thiết bị.',
    };
  }
}

/**
 * Formats details JSON into a human-readable summary string for Excel
 */
export function formatLogDetailsForExcel(log: DrawingReviewActivityLog): string {
  const parts: string[] = [];
  if (log.details) {
    if (log.details.issue_no) parts.push(`Mã: ${log.details.issue_no}`);
    if (log.details.item_no) parts.push(`Part No: ${log.details.item_no}`);
    if (log.details.item_name) parts.push(`Tên SP: ${log.details.item_name}`);
    if (log.details.customer) parts.push(`Khách hàng: ${log.details.customer}`);
    if (log.details.drawing_file_name) parts.push(`File: ${log.details.drawing_file_name}`);
    if (log.details.active_operations_count !== undefined) parts.push(`Số CĐ: ${log.details.active_operations_count}`);
    if (log.details.total_cycle_time_seconds !== undefined) parts.push(`Tổng CT: ${log.details.total_cycle_time_seconds}s`);
    if (log.details.material) parts.push(`Vật liệu: ${log.details.material}`);
    if (log.details.note) parts.push(`Ghi chú: ${log.details.note}`);
  }
  return parts.length > 0 ? parts.join(' | ') : '—';
}

/**
 * Generates an XLSX workbook for Activity Logs
 */
export function generateActivityLogsWorkbook(logs: DrawingReviewActivityLog[]): XLSX.WorkBook {
  const headers = [
    'STT',
    'Thời gian (Giờ Hà Nội)',
    'Mã bản vẽ (Issue No)',
    'Mã sản phẩm (Item No)',
    'Tên sản phẩm',
    'Khách hàng',
    'Phiên bản',
    'Hành động thao tác',
    'Người thực hiện',
    'Bộ phận / Vai trò',
    'Số điện thoại',
    'Trạng thái trước',
    'Trạng thái sau',
    'Chi tiết nội dung',
  ];

  const rows = logs.map((log, index) => {
    return [
      index + 1,
      formatHanoiDateTime(log.created_at),
      log.issue?.issue_no || log.details?.issue_no || '',
      log.issue?.item_no || log.details?.item_no || '',
      log.issue?.item_name || log.details?.item_name || '',
      log.issue?.customer || log.details?.customer || '',
      log.version_name || 'V1',
      log.action_label || log.action,
      log.performer_name || 'Người dùng',
      log.performer_role || '',
      log.performer_phone || '',
      log.old_status || '—',
      log.new_status || '—',
      formatLogDetailsForExcel(log),
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  ws['!views'] = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }];
  ws['!autofilter'] = {
    ref: `A1:N${Math.max(rows.length + 1, 1)}`,
  };

  ws['!cols'] = [
    { wch: 6 },  // STT
    { wch: 22 }, // Thời gian
    { wch: 18 }, // Issue No
    { wch: 18 }, // Item No
    { wch: 25 }, // Tên sản phẩm
    { wch: 14 }, // Khách hàng
    { wch: 10 }, // Phiên bản
    { wch: 30 }, // Hành động thao tác
    { wch: 22 }, // Người thực hiện
    { wch: 18 }, // Bộ phận
    { wch: 15 }, // SĐT
    { wch: 16 }, // Trạng thái trước
    { wch: 16 }, // Trạng thái sau
    { wch: 45 }, // Chi tiết nội dung
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Nhat_Ky_Log');
  return wb;
}

/**
 * Exports Activity Logs to an Excel file (.xlsx)
 */
export async function exportActivityLogsToExcel(
  logs: DrawingReviewActivityLog[],
  customFilename?: string
): Promise<ExportResult> {
  if (!logs || logs.length === 0) {
    return { success: false, error: 'Không có dữ liệu nhật ký để xuất file Excel.' };
  }

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const defaultFilename = `Nhat_ky_he_thong_Drawing_Review_${yyyy}${mm}${dd}_${hh}${min}.xlsx`;

  const filename = customFilename || defaultFilename;
  const wb = generateActivityLogsWorkbook(logs);
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  if (typeof window !== 'undefined' && typeof (window as any).showSaveFilePicker === 'function') {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'Bảng tính Excel (*.xlsx)',
            accept: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return {
        success: true,
        filename: handle.name || filename,
        count: logs.length,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { success: false, cancelled: true };
      }
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return {
      success: true,
      filename,
      count: logs.length,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Lỗi khi tải file Excel nhật ký về máy.',
    };
  }
}

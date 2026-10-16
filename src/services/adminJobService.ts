import { supabase } from '../lib/supabase';
import { STORAGE_BUCKET } from '../lib/storageUtils';

export interface DeleteJobResult {
  success: boolean;
  message?: string;
  error?: string;
  deleted_attachments?: string[];
  stats?: {
    operations: number;
    production_runs: number;
    ng_details: number;
    qa_checks: number;
    attachments: number;
  };
}

/**
 * Delete a job using backend security RPC (admin_delete_job).
 * Strict rules:
 * - Admin, Planning Leader, or Planning Owner only (enforced by backend RPC).
 * - Exact ticket string confirmation.
 * - Requires non-empty reason (at least 3 characters).
 * - Backend rejects if job is CLOSE/ARCHIVE or has any CLOSED operation.
 * - Cleans up associated storage attachments.
 */
export async function deleteJob(
  jobId: string,
  confirmTicket: string,
  reason: string
): Promise<DeleteJobResult> {
  const trimmedTicket = confirmTicket.trim();
  const trimmedReason = reason.trim();

  if (!trimmedTicket) {
    return { success: false, error: 'Vui lòng nhập mã JOB Ticket để xác nhận.' };
  }
  if (!trimmedReason || trimmedReason.length < 3) {
    return { success: false, error: 'Vui lòng nhập lý do xóa (tối thiểu 3 ký tự).' };
  }

  try {
    const { data, error } = await supabase.rpc('admin_delete_job', {
      p_job_id: jobId,
      p_confirm_ticket: trimmedTicket,
      p_reason: trimmedReason,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (data?.success) {
      // Clean up orphaned storage attachments if any were deleted
      if (
        data.deleted_attachments &&
        Array.isArray(data.deleted_attachments) &&
        data.deleted_attachments.length > 0
      ) {
        try {
          await supabase.storage.from(STORAGE_BUCKET).remove(data.deleted_attachments);
        } catch (storageErr) {
          console.warn('Attachment storage cleanup warning:', storageErr);
        }
      }

      return {
        success: true,
        message: data.message || 'Đã xóa Lệnh sản xuất thành công.',
        deleted_attachments: data.deleted_attachments,
        stats: data.stats,
      };
    }

    return { success: false, error: data?.message || 'Không thể xóa Lệnh sản xuất.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi hệ thống khi xóa Lệnh sản xuất.' };
  }
}

// Backward-compatible alias
export const deleteJobByAdmin = deleteJob;

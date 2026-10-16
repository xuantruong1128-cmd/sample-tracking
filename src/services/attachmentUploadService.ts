import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import { buildSecureStoragePath, isValidStoragePath, STORAGE_BUCKET } from '../lib/storageUtils';
import type { Attachment, AttachmentType } from '../types/database.types';

export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_ATTACHMENT_SIZE_BYTES = 52428800; // 50MB

export function isAllowedMimeType(mime: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime.toLowerCase());
}

/**
 * Computes hexadecimal SHA-256 hash of a file or Blob.
 */
export async function computeFileSha256(file: Blob | File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UploadAttachmentParams {
  jobId: string;
  operationId?: string | null;
  fileType: AttachmentType;
  file: Blob | File;
  fileName: string;
}

export interface UploadAttachmentResult {
  attachment: Attachment | null;
  error: string | null;
}

export interface RetryAttachmentParams {
  attachmentId: string;
  file?: Blob | File;
}

/**
 * Service to orchestrate the safe, metadata-first attachment upload lifecycle (Clean Baseline V1):
 * 1. Preflight validation of path, MIME type, file size and SHA-256 content hash.
 * 2. Insert attachment record with upload_status = 'PENDING' (enforced unconditionally server-side).
 * 3. Upload physical file to private Storage bucket (upsert: false to prevent overwrite).
 * 4. Call Edge Function verify-and-confirm-upload (with fallback to canonical database RPC
 *    confirm_attachment_upload) to verify actual Storage bytes and transition upload_status to 'READY'.
 * 5. If any failure occurs, call canonical RPC fail_attachment_upload to mark record as 'FAILED'.
 */
export async function uploadAttachment({
  jobId,
  operationId,
  fileType,
  file,
  fileName,
}: UploadAttachmentParams): Promise<UploadAttachmentResult> {
  if (!ENV.IS_CONFIGURED) {
    return { attachment: null, error: 'Chưa cấu hình Supabase.' };
  }

  // 1. Authenticate caller
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    return { attachment: null, error: 'Chưa đăng nhập. Quyền truy cập bị từ chối.' };
  }

  // 2. Validate parameters and MIME type
  const mimeType = (file.type || 'application/octet-stream').toLowerCase();
  if (!isAllowedMimeType(mimeType)) {
    return {
      attachment: null,
      error: 'Định dạng tệp không được hỗ trợ. Chỉ chấp nhận PDF, JPEG, PNG (tối đa 50MB).',
    };
  }

  const fileSize = file.size;
  if (fileSize <= 0 || fileSize > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      attachment: null,
      error: `Kích thước tệp không hợp lệ (${fileSize} bytes). Tối đa cho phép: 50MB.`,
    };
  }

  const filePath = buildSecureStoragePath({ jobId, fileType, fileName });
  if (!isValidStoragePath(filePath)) {
    return { attachment: null, error: 'Đường dẫn tệp không hợp lệ hoặc vi phạm cấu trúc an toàn.' };
  }

  // Compute SHA-256 hash client-side before registering metadata
  let contentHash: string | null = null;
  try {
    contentHash = await computeFileSha256(file);
  } catch (hashErr: any) {
    return {
      attachment: null,
      error: `Không thể tính mã băm toàn vẹn SHA-256: ${hashErr.message}`,
    };
  }

  // 3. Metadata-first registration: insert attachment (trigger unconditionally forces upload_status = 'PENDING')
  const { data: insertedAttachment, error: insertError } = await supabase
    .from('attachments')
    .insert({
      job_id: jobId,
      operation_id: operationId || null,
      file_name: fileName,
      file_path: filePath,
      file_size: fileSize,
      mime_type: mimeType,
      content_hash: contentHash,
      file_type: fileType,
      upload_status: 'PENDING',
    })
    .select()
    .single();

  if (insertError || !insertedAttachment) {
    return {
      attachment: null,
      error: insertError?.message || 'Không thể đăng ký thông tin tài liệu (PENDING).',
    };
  }

  const attachmentId = insertedAttachment.id;

  // 4. Upload binary object to private Supabase Storage bucket (upsert: false to prevent overwrite)
  try {
    const { error: storageUploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (storageUploadError) {
      // Mark as FAILED via canonical server RPC
      await failAttachmentUpload(attachmentId, storageUploadError.message);
      return {
        attachment: null,
        error: `Tải tệp lên lưu trữ thất bại: ${storageUploadError.message}`,
      };
    }

    // 5. Server-side proof of existence and integrity confirmation via Edge Function verify-and-confirm-upload
    let confirmed = false;
    let confirmError: string | null = null;

    try {
      const { data: efData, error: efError } = await supabase.functions.invoke('verify-and-confirm-upload', {
        body: { attachment_id: attachmentId },
      });

      if (!efError && efData?.success) {
        confirmed = true;
      } else {
        confirmError = efData?.error || efError?.message || 'Xác thực tài liệu trên máy chủ thất bại.';
      }
    } catch (invokeErr: any) {
      confirmError = invokeErr.message || 'Lỗi gọi Edge Function verify-and-confirm-upload.';
    }

    if (!confirmed || confirmError) {
      await failAttachmentUpload(attachmentId, confirmError || 'Xác thực tài liệu thất bại.');
      return {
        attachment: null,
        error: confirmError || 'Xác thực tài liệu trên máy chủ thất bại sau khi tải lên.',
      };
    }

    return {
      attachment: {
        ...insertedAttachment,
        upload_status: 'READY',
      },
      error: null,
    };
  } catch (err: any) {
    await failAttachmentUpload(attachmentId, err.message || 'Unknown upload exception');
    return {
      attachment: null,
      error: err.message || 'Lỗi không xác định trong quá trình tải lên tài liệu.',
    };
  }
}

/**
 * Verifies and confirms an attachment by invoking the verify-and-confirm-upload Edge Function.
 * Direct database RPC confirm_attachment_upload execution is restricted to service_role.
 */
export async function confirmAttachmentUpload(
  attachmentId: string
): Promise<{ confirmed: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('verify-and-confirm-upload', {
      body: { attachment_id: attachmentId },
    });

    if (error) {
      return { confirmed: false, error: error.message };
    }

    if (!data?.success) {
      return { confirmed: false, error: data?.error || 'Không thể xác nhận tải lên.' };
    }

    return { confirmed: true, error: null };
  } catch (err: any) {
    return { confirmed: false, error: err.message || 'Lỗi gọi Edge Function xác thực.' };
  }
}

/**
 * Invokes the database canonical RPC function fail_attachment_upload.
 * Transitions an unfinalized upload (strictly PENDING) to FAILED status.
 */
export async function failAttachmentUpload(
  attachmentId: string,
  errorMessage?: string
): Promise<{ failed: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('fail_attachment_upload', {
      p_attachment_id: attachmentId,
      p_error: errorMessage || 'Client upload failed or aborted',
    });

    if (error) {
      return { failed: false, error: error.message };
    }

    return { failed: data?.success ?? true, error: null };
  } catch (err: any) {
    return { failed: false, error: err.message || 'RPC fail_attachment_upload exception' };
  }
}

/**
 * Invokes canonical retry_attachment_upload to safely recover or reset a FAILED upload.
 */
export async function retryAttachmentUpload({
  attachmentId,
  file,
}: RetryAttachmentParams): Promise<UploadAttachmentResult> {
  if (!ENV.IS_CONFIGURED) {
    return { attachment: null, error: 'Chưa cấu hình Supabase.' };
  }

  try {
    let newSize: number | undefined;
    let newMime: string | undefined;
    let newHash: string | undefined;

    if (file) {
      newMime = (file.type || 'application/octet-stream').toLowerCase();
      if (!isAllowedMimeType(newMime)) {
        return {
          attachment: null,
          error: 'Định dạng tệp không được hỗ trợ. Chỉ chấp nhận PDF, JPEG, PNG (tối đa 50MB).',
        };
      }
      newSize = file.size;
      newHash = await computeFileSha256(file);
    }

    // Call canonical retry RPC with new file metadata if file is supplied (Fix 3: supports collision-free path)
    const { data: retryData, error: retryError } = await supabase.rpc('retry_attachment_upload', {
      p_attachment_id: attachmentId,
      p_new_size: newSize || null,
      p_new_mime: newMime || null,
      p_new_hash: newHash || null,
      p_new_path: null,
    });

    if (retryError) {
      return { attachment: null, error: retryError.message };
    }

    if (!retryData?.success) {
      return { attachment: null, error: retryData?.message || 'Không thể thử lại tải lên.' };
    }

    // Status is reset to PENDING -> upload new binary if provided, then verify via Edge Function
    if (retryData.status === 'PENDING') {
      const { data: attRecord, error: fetchErr } = await supabase
        .from('attachments')
        .select('*')
        .eq('id', attachmentId)
        .single();

      if (fetchErr || !attRecord) {
        return { attachment: null, error: 'Không tìm thấy thông tin bản ghi tài liệu.' };
      }

      if (file) {
        // Non-overwriting upload to storage at the fresh, collision-free storage path
        const { error: uploadErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(attRecord.file_path, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadErr) {
          await failAttachmentUpload(attachmentId, uploadErr.message);
          return { attachment: null, error: `Tải lại tệp lên lưu trữ thất bại: ${uploadErr.message}` };
        }

        // Best-effort cleanup of prior failed storage object if path changed
        if (retryData.old_file_path && retryData.old_file_path !== attRecord.file_path) {
          try {
            await supabase.storage.from(STORAGE_BUCKET).remove([retryData.old_file_path]);
          } catch {
            // Ignore best-effort cleanup failure
          }
        }
      }

      // Confirm upload via Edge Function verify-and-confirm-upload
      const { confirmed, error: confirmErr } = await confirmAttachmentUpload(attachmentId);
      if (!confirmed || confirmErr) {
        return { attachment: null, error: confirmErr || 'Xác nhận tải lại thất bại.' };
      }

      return {
        attachment: {
          ...attRecord,
          upload_status: 'READY',
        },
        error: null,
      };
    }

    return { attachment: null, error: 'Trạng thái sau khi thử lại không xác định.' };
  } catch (err: any) {
    return { attachment: null, error: err.message || 'Lỗi ngoại lệ khi thử lại tải lên.' };
  }
}

/**
 * Fetches registered attachments for a job and optional operation.
 * Complies with Option A Document Access Policy.
 */
export async function fetchAttachmentsByJob(
  jobId: string,
  operationId?: string | null
): Promise<{ attachments: Attachment[]; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { attachments: [], error: null };
  }

  try {
    let query = supabase
      .from('attachments')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });

    if (operationId) {
      query = query.eq('operation_id', operationId);
    }

    const { data, error } = await query;
    if (error) {
      return { attachments: [], error: error.message };
    }

    return { attachments: data || [], error: null };
  } catch (err: any) {
    return { attachments: [], error: err.message || 'Lỗi khi tải danh sách tài liệu.' };
  }
}

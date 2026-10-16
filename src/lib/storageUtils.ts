import { supabase } from './supabase';
import { ENV } from './env';
import type { AttachmentType } from '../types/database.types';

export const STORAGE_BUCKET = 'sample-documents';
export const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes
export const MAX_SIGNED_URL_EXPIRY_SECONDS = 300;     // Server/client enforced cap (R2 Remediation)

export interface StoragePathParams {
  jobId: string;
  fileType: AttachmentType;
  fileName: string;
}

/**
 * Builds standard secure storage path: <jobId>/<fileType>/<sanitizedFileName>
 * (F-05 Remediation)
 * Sanitizes file names to strictly prevent path traversal attempts.
 */
export function buildSecureStoragePath({ jobId, fileType, fileName }: StoragePathParams): string {
  const sanitizedFileName = fileName
    .replace(/[/\\]/g, '_')
    .replace(/\.\./g, '__')
    .replace(/[^a-zA-Z0-9_.-]/g, '_');

  return `${jobId}/${fileType}/${sanitizedFileName}`;
}

/**
 * Validates storage path structure matches: <jobId>/<fileType>/<fileName>
 */
export function isValidStoragePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  if (filePath.includes('..') || filePath.includes('\\')) return false;
  const parts = filePath.split('/');
  if (parts.length < 3 || parts.length > 4) return false;
  const jobId = parts[0];
  const fileType = parts[1];
  const fileName = parts[parts.length - 1];
  if (!jobId || !fileType || !fileName) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) return false;
  const validTypes = [
    'DRAWING',
    'CHECK_SHEET',
    'SETTING_SHEET',
    'NG_PHOTO',
    'OTHER',
    'SAMPLE_PHOTO',
    'DOCUMENTS',
    'sample-photos',
    'documents',
  ];
  if (!validTypes.includes(fileType)) return false;
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) return false;
  return true;
}

/**
 * Generates a short-lived signed URL for a private document (F-13 & R2 Remediation)
 * Strictly caps expiration to MAX_SIGNED_URL_EXPIRY_SECONDS (300 seconds).
 */
export async function createSecureSignedUrl(
  filePath: string,
  expiresInSeconds: number = DEFAULT_SIGNED_URL_EXPIRY_SECONDS
): Promise<{ signedUrl: string | null; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { signedUrl: null, error: 'Chưa cấu hình Supabase.' };
  }

  // Validate path format
  if (!isValidStoragePath(filePath)) {
    return { signedUrl: null, error: 'Đường dẫn tệp không hợp lệ hoặc vi phạm cấu trúc an toàn.' };
  }

  // Validate active session
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    return { signedUrl: null, error: 'Chưa đăng nhập. Quyền truy cập bị từ chối.' };
  }

  // Enforce strict upper bound of 300 seconds (5 minutes)
  const effectiveExpiry = Math.min(Math.max(1, expiresInSeconds), MAX_SIGNED_URL_EXPIRY_SECONDS);

  try {
    const { data, error } = await supabase.functions.invoke('create-signed-url', {
      body: { file_path: filePath, expires_in: effectiveExpiry },
    });

    if (!error && data?.signedUrl) {
      return { signedUrl: data.signedUrl as string, error: null };
    }

    // Direct Supabase Storage fallback for non-legacy paths or local environment
    const { data: storageData, error: storageErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(filePath, effectiveExpiry);

    if (storageData?.signedUrl) {
      return { signedUrl: storageData.signedUrl, error: null };
    }

    return {
      signedUrl: null,
      error: storageErr?.message || error?.message || data?.error || 'Không thể tạo liên kết tải tài liệu an toàn.',
    };
  } catch (err: any) {
    try {
      const { data: storageData, error: storageErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(filePath, effectiveExpiry);
      if (storageData?.signedUrl) {
        return { signedUrl: storageData.signedUrl, error: null };
      }
      return { signedUrl: null, error: storageErr?.message || err.message || 'Lỗi hệ thống khi tạo signed URL.' };
    } catch {
      return { signedUrl: null, error: err.message || 'Lỗi hệ thống khi tạo signed URL.' };
    }
  }
}

import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import { STORAGE_BUCKET, createSecureSignedUrl } from '../lib/storageUtils';
import type { EngineeringDocument, EngineeringDocCategory } from '../types/database.types';

export const MAX_ENGINEERING_DOC_SIZE = 15 * 1024 * 1024; // 15MB

export const ALLOWED_DOC_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export function isAllowedDocMime(mime: string, fileName?: string): boolean {
  const lowerMime = (mime || '').toLowerCase();
  if (ALLOWED_DOC_MIMES.includes(lowerMime)) return true;

  // Fallback check by file extension for excel/image
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return true;
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) return true;
    if (['xls', 'xlsx'].includes(ext || '')) return true;
  }
  return false;
}

/**
 * Fetch all engineering documents for a job, optionally filtered by operation.
 */
export async function fetchEngineeringDocuments(
  jobId: string,
  operationId?: string | null
): Promise<{ documents: EngineeringDocument[]; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { documents: [], error: null };
  }

  try {
    let query = supabase
      .from('engineering_documents')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });

    if (operationId !== undefined) {
      if (operationId === null) {
        query = query.is('operation_id', null);
      } else {
        query = query.eq('operation_id', operationId);
      }
    }

    const { data, error } = await query;
    if (error) {
      return { documents: [], error: error.message };
    }

    return { documents: (data || []) as EngineeringDocument[], error: null };
  } catch (err: any) {
    return { documents: [], error: err.message || 'Lỗi khi tải danh sách tài liệu kỹ thuật.' };
  }
}

export interface UploadEngineeringDocParams {
  jobId: string;
  operationId?: string | null;
  category: EngineeringDocCategory;
  file: File;
  version?: string;
  remark?: string;
  parentDocumentId?: string | null;
}

/**
 * Upload an engineering document to Supabase Storage and register metadata.
 */
export async function uploadEngineeringDocument({
  jobId,
  operationId = null,
  category,
  file,
  version = 'v1',
  remark = '',
  parentDocumentId = null,
}: UploadEngineeringDocParams): Promise<{ document: EngineeringDocument | null; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    const mockDoc: EngineeringDocument = {
      id: `mock-doc-${Date.now()}`,
      job_id: jobId,
      operation_id: operationId,
      category,
      file_name: file.name,
      file_path: `${jobId}/DOCUMENTS/${category}_${version}_${Date.now()}_${file.name}`,
      file_size: file.size,
      mime_type: file.type || 'application/pdf',
      version: version || 'v1',
      parent_document_id: parentDocumentId,
      remark: remark || '',
      uploaded_by: 'demo-user',
      uploader_name: 'Drawing Engineer',
      created_at: new Date().toISOString(),
    };
    return { document: mockDoc, error: null };
  }

  // 1. Validation
  const mime = (file.type || '').toLowerCase();
  if (!isAllowedDocMime(mime, file.name)) {
    return {
      document: null,
      error: 'Định dạng tài liệu không được hỗ trợ. Chấp nhận: PDF, JPG, PNG, WebP, XLS, XLSX.',
    };
  }

  if (file.size <= 0 || file.size > MAX_ENGINEERING_DOC_SIZE) {
    return {
      document: null,
      error: `Dung lượng tệp vượt quá giới hạn (tối đa 15MB). Kích thước hiện tại: ${(
        file.size /
        (1024 * 1024)
      ).toFixed(2)}MB.`,
    };
  }

  // 2. Auth user check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    return { document: null, error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, phone, role')
    .eq('id', session.user.id)
    .single();

  const uploaderName = profile?.full_name || profile?.phone || 'Bộ phận Kỹ thuật';

  // 3. Prepare storage path
  const sanitizedName = file.name
    .replace(/[/\\]/g, '_')
    .replace(/\.\./g, '__')
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
  const catFolder = category.replace(/\s+/g, '_');
  const verTag = (version || 'v1').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = `${jobId}/DOCUMENTS/${catFolder}_${verTag}_${Date.now()}_${sanitizedName}`;

  try {
    // 4. Upload file to Storage
    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        contentType: mime || 'application/octet-stream',
        upsert: false,
      });

    if (uploadErr) {
      return { document: null, error: uploadErr.message || 'Lỗi khi tải tài liệu lên máy chủ lưu trữ.' };
    }

    // 5. Insert record
    const { data: record, error: insertErr } = await supabase
      .from('engineering_documents')
      .insert({
        job_id: jobId,
        operation_id: operationId,
        category,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        mime_type: mime || 'application/octet-stream',
        version: version.trim() || 'v1',
        parent_document_id: parentDocumentId,
        remark: (remark || '').trim(),
        uploaded_by: session.user.id,
        uploader_name: uploaderName,
      })
      .select()
      .single();

    if (insertErr) {
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
      return { document: null, error: insertErr.message || 'Lỗi khi lưu thông tin tài liệu.' };
    }

    return { document: record as EngineeringDocument, error: null };
  } catch (err: any) {
    return { document: null, error: err.message || 'Lỗi không xác định khi tải tài liệu.' };
  }
}

/**
 * Delete an engineering document from database and storage.
 */
export async function deleteEngineeringDocument(
  documentId: string,
  filePath: string
): Promise<{ success: boolean; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { success: true, error: null };
  }

  try {
    const { error: dbErr } = await supabase
      .from('engineering_documents')
      .delete()
      .eq('id', documentId);

    if (dbErr) {
      return { success: false, error: dbErr.message };
    }

    await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi xóa tài liệu.' };
  }
}

/**
 * Generate secure signed URL for viewing or downloading an engineering document.
 */
export async function viewEngineeringDocumentSignedUrl(
  filePath: string
): Promise<{ signedUrl: string | null; error: string | null }> {
  return createSecureSignedUrl(filePath, 300);
}

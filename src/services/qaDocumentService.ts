import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import { STORAGE_BUCKET, createSecureSignedUrl, invalidateSignedUrl } from '../lib/storageUtils';
import type { QADocument, QADocumentCategory } from '../types/database.types';

export const MAX_QA_DOC_SIZE = 20 * 1024 * 1024; // 20MB

export const ALLOWED_QA_DOC_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];

export function isAllowedQADocMime(mime: string, fileName?: string): boolean {
  const lowerMime = (mime || '').toLowerCase();
  if (ALLOWED_QA_DOC_MIMES.includes(lowerMime)) return true;

  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return true;
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) return true;
    if (['xls', 'xlsx'].includes(ext || '')) return true;
    if (ext === 'csv') return true;
  }
  return false;
}

/**
 * Fetch QA documents for a specific operation within a job.
 */
export async function fetchOperationQADocuments(
  jobId: string,
  operationId: string
): Promise<{ documents: QADocument[]; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { documents: [], error: null };
  }

  try {
    const { data, error } = await supabase
      .from('qa_documents')
      .select('*')
      .eq('job_id', jobId)
      .eq('operation_id', operationId)
      .order('created_at', { ascending: false });

    if (error) {
      return { documents: [], error: error.message };
    }

    return { documents: (data || []) as QADocument[], error: null };
  } catch (err: any) {
    return { documents: [], error: err.message || 'Lỗi khi tải danh sách tài liệu QA.' };
  }
}

export interface UploadQADocParams {
  jobId: string;
  operationId: string;
  category: QADocumentCategory;
  file: File;
  remark?: string;
  uploaderName?: string;
}

/**
 * Upload a QA document to private Supabase Storage and register in public.qa_documents.
 * QA personnel can upload until JOB Close, including after Operation Close.
 */
export async function uploadQADocument({
  jobId,
  operationId,
  category,
  file,
  remark = '',
  uploaderName: customUploaderName,
}: UploadQADocParams): Promise<{ document: QADocument | null; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    const mockDoc: QADocument = {
      id: `mock-qa-doc-${Date.now()}`,
      job_id: jobId,
      operation_id: operationId,
      category,
      file_name: file.name,
      file_path: `${jobId}/QA_DOCS/${operationId}/${category}_${Date.now()}_${file.name}`,
      file_size: file.size,
      mime_type: file.type || 'application/pdf',
      remark: remark || '',
      uploaded_by: 'demo-user',
      uploader_name: customUploaderName || 'QA Inspector',
      created_at: new Date().toISOString(),
    };
    return { document: mockDoc, error: null };
  }

  // 1. Validation
  const mime = (file.type || '').toLowerCase();
  if (!isAllowedQADocMime(mime, file.name)) {
    return {
      document: null,
      error: 'Định dạng tài liệu không được hỗ trợ. Chấp nhận: PDF, XLSX, XLS, CSV, JPG, PNG, WebP.',
    };
  }

  if (file.size <= 0 || file.size > MAX_QA_DOC_SIZE) {
    return {
      document: null,
      error: `Dung lượng tệp vượt quá giới hạn (tối đa 20MB). Kích thước hiện tại: ${(
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

  let uploaderName = customUploaderName;
  if (!uploaderName) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, phone, role')
      .eq('id', session.user.id)
      .single();

    uploaderName = profile?.full_name || profile?.phone || 'QA Inspector';
  }

  // 3. Prepare storage path
  const sanitizedName = file.name
    .replace(/[/\\]/g, '_')
    .replace(/\.\./g, '__')
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
  const catFolder = category.replace(/\s+/g, '_');
  const filePath = `${jobId}/QA_DOCS/${operationId}/${catFolder}_${Date.now()}_${sanitizedName}`;

  try {
    // 4. Upload file to Storage
    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        contentType: mime || 'application/octet-stream',
        upsert: false,
      });

    if (uploadErr) {
      return { document: null, error: uploadErr.message || 'Lỗi khi tải tài liệu QA lên máy chủ lưu trữ.' };
    }

    // 5. Insert record into database
    const { data: record, error: insertErr } = await supabase
      .from('qa_documents')
      .insert({
        job_id: jobId,
        operation_id: operationId,
        category,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        mime_type: mime || 'application/octet-stream',
        remark: (remark || '').trim(),
        uploaded_by: session.user.id,
        uploader_name: uploaderName,
      })
      .select()
      .single();

    if (insertErr) {
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
      return { document: null, error: insertErr.message || 'Lỗi khi lưu thông tin tài liệu QA.' };
    }

    return { document: record as QADocument, error: null };
  } catch (err: any) {
    return { document: null, error: err.message || 'Lỗi không xác định khi tải tài liệu QA.' };
  }
}

/**
 * Delete a QA document from database and storage.
 */
export async function deleteQADocument(
  documentId: string,
  filePath: string
): Promise<{ success: boolean; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { success: true, error: null };
  }

  try {
    const { error: dbErr } = await supabase
      .from('qa_documents')
      .delete()
      .eq('id', documentId);

    if (dbErr) {
      return { success: false, error: dbErr.message };
    }

    await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
    invalidateSignedUrl(STORAGE_BUCKET, filePath);
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi xóa tài liệu QA.' };
  }
}

/**
 * Generate secure signed URL for viewing or downloading a QA document.
 */
export async function viewQADocumentSignedUrl(
  filePath: string
): Promise<{ signedUrl: string | null; error: string | null }> {
  return createSecureSignedUrl(filePath, 300);
}

export const QA_DOCUMENT_CATEGORIES: { value: QADocumentCategory; label: string }[] = [
  { value: 'Inspection Report', label: 'Báo cáo đo / Kiểm tra (Inspection Report)' },
  { value: 'CPK/SPC', label: 'CPK / SPC' },
  { value: 'NG Photos', label: 'Ảnh chụp lỗi NG (NG Photos)' },
  { value: 'Measurement Results', label: 'Kết quả đo (Measurement Results)' },
  { value: 'Other', label: 'Khác (Other)' },
];

/**
 * Convenience aliases for UI components
 */
export async function fetchQaDocumentsByOperation(
  operationId: string,
  jobId?: string
): Promise<{ documents: QADocument[]; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { documents: [], error: null };
  }
  try {
    let query = supabase
      .from('qa_documents')
      .select('*')
      .eq('operation_id', operationId);
    if (jobId) {
      query = query.eq('job_id', jobId);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      return { documents: [], error: error.message };
    }
    return { documents: (data || []) as QADocument[], error: null };
  } catch (err: any) {
    return { documents: [], error: err.message || 'Lỗi khi tải danh sách tài liệu QA.' };
  }
}

export const uploadQaDocument = uploadQADocument;
export const deleteQaDocument = deleteQADocument;
export const getQaDocumentSignedUrl = viewQADocumentSignedUrl;

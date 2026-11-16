import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import { STORAGE_BUCKET, createSecureSignedUrl, invalidateSignedUrl } from '../lib/storageUtils';
import type { OperationSamplePhoto } from '../types/database.types';

export const MAX_SAMPLE_PHOTO_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_SAMPLE_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Fetch sample photos for a specific operation.
 */
export async function fetchSamplePhotos(
  operationId: string
): Promise<{ photos: OperationSamplePhoto[]; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { photos: [], error: null };
  }

  try {
    const { data, error } = await supabase
      .from('operation_sample_photos')
      .select('*')
      .eq('operation_id', operationId)
      .order('created_at', { ascending: false });

    if (error) {
      return { photos: [], error: error.message };
    }
    return { photos: (data || []) as OperationSamplePhoto[], error: null };
  } catch (err: any) {
    return { photos: [], error: err.message || 'Lỗi khi tải ảnh sản phẩm mẫu.' };
  }
}

export interface UploadSamplePhotoParams {
  jobId: string;
  operationId: string;
  file: File;
  uploaderName?: string;
}

/**
 * Upload a sample photo for an operation into sample-documents private bucket
 * and register metadata in public.operation_sample_photos.
 */
export async function uploadSamplePhoto({
  jobId,
  operationId,
  file,
  uploaderName: customUploaderName,
}: UploadSamplePhotoParams): Promise<{ photo: OperationSamplePhoto | null; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    const mockPhoto: OperationSamplePhoto = {
      id: `mock-${Date.now()}`,
      job_id: jobId,
      operation_id: operationId,
      file_name: file.name,
      file_path: `${jobId}/SAMPLE_PHOTO/${operationId}_${Date.now()}_${file.name}`,
      file_size: file.size,
      mime_type: file.type || 'image/jpeg',
      uploaded_by: 'demo-user',
      uploader_name: customUploaderName || 'Người dùng thử nghiệm',
      created_at: new Date().toISOString(),
    };
    return { photo: mockPhoto, error: null };
  }

  // 1. Validation
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_SAMPLE_PHOTO_MIMES.includes(mime)) {
    return {
      photo: null,
      error: 'Định dạng ảnh không được hỗ trợ. Chỉ chấp nhận JPG, JPEG, PNG, WebP.',
    };
  }

  if (file.size <= 0 || file.size > MAX_SAMPLE_PHOTO_SIZE) {
    return {
      photo: null,
      error: `Dung lượng ảnh vượt quá giới hạn cho phép (tối đa 10MB). Kích thước hiện tại: ${(
        file.size /
        (1024 * 1024)
      ).toFixed(2)}MB.`,
    };
  }

  // 2. Auth user check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    return { photo: null, error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' };
  }

  let uploaderName = customUploaderName;
  if (!uploaderName) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, phone, role')
      .eq('id', session.user.id)
      .single();

    uploaderName = profile?.full_name || profile?.phone || 'Kỹ thuật viên';
  }

  // 3. Prepare storage path
  const sanitizedName = file.name
    .replace(/[/\\]/g, '_')
    .replace(/\.\./g, '__')
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
  const filePath = `${jobId}/SAMPLE_PHOTO/${operationId}_${Date.now()}_${sanitizedName}`;

  try {
    // 4. Upload file to Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        contentType: mime,
        upsert: false,
      });

    if (uploadErr) {
      return { photo: null, error: uploadErr.message || 'Lỗi khi tải ảnh lên máy chủ lưu trữ.' };
    }

    // 5. Insert record into operation_sample_photos
    const { data: record, error: insertErr } = await supabase
      .from('operation_sample_photos')
      .insert({
        job_id: jobId,
        operation_id: operationId,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        mime_type: mime,
        uploaded_by: session.user.id,
        uploader_name: uploaderName,
      })
      .select()
      .single();

    if (insertErr) {
      // Cleanup orphan storage file
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
      return { photo: null, error: insertErr.message || 'Lỗi khi lưu thông tin ảnh vào cơ sở dữ liệu.' };
    }

    return { photo: record as OperationSamplePhoto, error: null };
  } catch (err: any) {
    return { photo: null, error: err.message || 'Lỗi không xác định khi tải ảnh mẫu.' };
  }
}

/**
 * Delete a sample photo from storage and database.
 */
export async function deleteSamplePhoto(
  photoId: string,
  filePath: string
): Promise<{ success: boolean; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { success: true, error: null };
  }

  try {
    const { error: dbErr } = await supabase
      .from('operation_sample_photos')
      .delete()
      .eq('id', photoId);

    if (dbErr) {
      return { success: false, error: dbErr.message };
    }

    // Also remove from storage
    await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
    invalidateSignedUrl(STORAGE_BUCKET, filePath);
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi xóa ảnh mẫu.' };
  }
}

/**
 * Get short-lived signed URL for viewing a sample photo.
 */
export async function viewSamplePhotoSignedUrl(
  filePath: string
): Promise<{ signedUrl: string | null; error: string | null }> {
  return createSecureSignedUrl(filePath, 300);
}

/**
 * Set an uploaded sample photo as the Part Avatar for a job.
 * Pass photoId=null to unset avatar.
 */
export async function setPartAvatar(
  jobId: string,
  photoId: string | null
): Promise<{ success: boolean; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { success: true, error: null };
  }

  try {
    const { data, error } = await supabase.rpc('set_part_avatar', {
      p_job_id: jobId,
      p_photo_id: photoId,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (data && data.success === false) {
      return { success: false, error: data.message || 'Lỗi khi đặt ảnh đại diện.' };
    }

    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi cập nhật ảnh đại diện.' };
  }
}

/**
 * Fetch the current Part Avatar for a job.
 */
export async function fetchJobPartAvatar(
  jobId: string
): Promise<{ avatar: OperationSamplePhoto | null; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { avatar: null, error: null };
  }

  try {
    const { data, error } = await supabase
      .from('operation_sample_photos')
      .select('*')
      .eq('job_id', jobId)
      .eq('is_avatar', true)
      .maybeSingle();

    if (error) {
      return { avatar: null, error: error.message };
    }
    return { avatar: data as OperationSamplePhoto | null, error: null };
  } catch (err: any) {
    return { avatar: null, error: err.message || 'Lỗi khi tải ảnh đại diện.' };
  }
}

/**
 * Fetch all sample photos for a job across all operations.
 */
export async function fetchAllJobSamplePhotos(
  jobId: string
): Promise<{ photos: OperationSamplePhoto[]; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { photos: [], error: null };
  }

  try {
    const { data, error } = await supabase
      .from('operation_sample_photos')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });

    if (error) {
      return { photos: [], error: error.message };
    }
    return { photos: (data || []) as OperationSamplePhoto[], error: null };
  } catch (err: any) {
    return { photos: [], error: err.message || 'Lỗi khi tải danh sách ảnh mẫu.' };
  }
}

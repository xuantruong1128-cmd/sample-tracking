import { supabase } from '../lib/supabase';
import {
  getOrFetchSignedUrl,
  invalidateSignedUrl,
  invalidateSignedUrlsByPrefix,
} from '../lib/signedUrlCache';
import type {
  DrawingReviewIssue,
  DrawingReviewVersion,
  DrawingReviewOperation,
  DrawingReviewAttachment,
  DrawingReviewStatus,
  CreateDrawingReviewInput,
  SaveDrawingReviewDraftInput,
  DrawingReviewActivityLog,
} from '../types/drawingReview';

export const DRAWING_REVIEWS_STORAGE_BUCKET = 'drawing-reviews';
export const MAX_DRAWING_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const ALLOWED_DRAWING_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * Validates allowed file format and size for Drawing Review uploads
 */
export function validateDrawingFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'Vui lòng chọn tệp bản vẽ.' };
  }
  if (file.size > MAX_DRAWING_FILE_SIZE) {
    return { valid: false, error: 'Dung lượng tệp vượt quá giới hạn 50MB.' };
  }
  const type = (file.type || '').toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase();
  const isValidMime = ALLOWED_DRAWING_MIME_TYPES.includes(type);
  const isValidExt = ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext || '');

  if (!isValidMime && !isValidExt) {
    return {
      valid: false,
      error: 'Định dạng tệp không được hỗ trợ. Vui lòng tải lên tệp PDF, JPG, JPEG hoặc PNG.',
    };
  }
  return { valid: true };
}

/**
 * Upload drawing to private Supabase bucket 'drawing-reviews'
 */
export async function uploadDrawingFile(
  file: File,
  folderId: string
): Promise<{ filePath?: string; fileName?: string; fileSize?: number; mimeType?: string; error?: string }> {
  const validation = validateDrawingFile(file);
  if (!validation.valid) {
    return { error: validation.error };
  }

  const sanitized = file.name
    .replace(/[/\\]/g, '_')
    .replace(/\.\./g, '__')
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
  const path = `drawings/${folderId}/${Date.now()}_${sanitized}`;

  try {
    const { error } = await supabase.storage
      .from(DRAWING_REVIEWS_STORAGE_BUCKET)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/pdf',
      });

    if (error) {
      return { error: `Lỗi tải tệp lên Storage: ${error.message}` };
    }

    // Invalidate any previously cached signed URLs for this drawing folder
    invalidateSignedUrlsByPrefix(DRAWING_REVIEWS_STORAGE_BUCKET, `drawings/${folderId}`);

    return {
      filePath: path,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/pdf',
    };
  } catch (err: any) {
    return { error: err.message || 'Lỗi khi tải tệp bản vẽ.' };
  }
}

/**
 * Generates a short-lived signed URL for drawing or attachment preview.
 * Integrated with M2.1 in-memory SignedUrlCache and in-flight deduplication.
 * Default TTL: 600 seconds (10 minutes) per specification.
 */
export async function getDrawingFileSignedUrl(
  filePath: string,
  expiresInSeconds: number = 600
): Promise<{ signedUrl: string | null; error: string | null }> {
  if (!filePath) return { signedUrl: null, error: 'Đường dẫn tệp không tồn tại.' };

  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id || 'anonymous';

  return getOrFetchSignedUrl(
    {
      bucket: DRAWING_REVIEWS_STORAGE_BUCKET,
      filePath,
      userId,
    },
    async () => {
      try {
        const { data, error } = await supabase.storage
          .from(DRAWING_REVIEWS_STORAGE_BUCKET)
          .createSignedUrl(filePath, expiresInSeconds);

        if (error || !data?.signedUrl) {
          return { signedUrl: null, error: error?.message || 'Không tạo được liên kết tệp.' };
        }
        return { signedUrl: data.signedUrl, error: null };
      } catch (err: any) {
        return { signedUrl: null, error: err.message || 'Lỗi khi tạo liên kết tệp.' };
      }
    },
    expiresInSeconds
  );
}

/**
 * Fetches all Drawing Review issues with their versions and current status
 */
export async function fetchDrawingReviewList(): Promise<{
  data: Array<
    DrawingReviewIssue & {
      versions: Array<
        DrawingReviewVersion & {
          operations?: DrawingReviewOperation[];
        }
      >;
      latest_version?: DrawingReviewVersion & {
        operations?: DrawingReviewOperation[];
      };
    }
  >;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase
      .from('drawing_review_issues')
      .select(`
        *,
        versions:drawing_review_versions(
          *,
          operations:drawing_review_operations(*)
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }

    const formatted = (data || []).map((issue: any) => {
      const sortedVersions: Array<
        DrawingReviewVersion & { operations?: DrawingReviewOperation[] }
      > = [...(issue.versions || [])]
        .sort((a, b) => b.version_number - a.version_number)
        .map((ver) => ({
          ...ver,
          operations: [...(ver.operations || [])]
            .filter((op: DrawingReviewOperation) => !op.is_removed)
            .sort((a: DrawingReviewOperation, b: DrawingReviewOperation) => a.step_order - b.step_order),
        }));

      return {
        ...issue,
        versions: sortedVersions,
        latest_version: sortedVersions[0],
      };
    });

    return { data: formatted, error: null };
  } catch (err: any) {
    return { data: [], error: err.message || 'Lỗi khi tải danh sách đánh giá bản vẽ.' };
  }
}

/**
 * Fetches full detail for an issue, including all versions, operations, and attachments
 */
export async function fetchDrawingReviewDetail(
  issueId: string
): Promise<{ data: any | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('drawing_review_issues')
      .select(`
        *,
        versions:drawing_review_versions(
          *,
          operations:drawing_review_operations(*),
          attachments:drawing_review_attachments(*)
        )
      `)
      .or(`id.eq.${issueId},issue_no.eq.${issueId}`)
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    if (!data) {
      return { data: null, error: 'Không tìm thấy yêu cầu đánh giá bản vẽ.' };
    }

    const sortedVersions = [...(data.versions || [])].sort(
      (a: any, b: any) => a.version_number - b.version_number
    );
    const latestVersion = sortedVersions[sortedVersions.length - 1];

    return {
      data: {
        ...data,
        versions: sortedVersions,
        latest_version: latestVersion,
      },
      error: null,
    };
  } catch (err: any) {
    return { data: null, error: err.message || 'Lỗi khi tải chi tiết đánh giá bản vẽ.' };
  }
}

/**
 * Case-insensitive helper to detect SUBCON work center per requirement
 */
export function isSubconWorkcenter(code?: string | null): boolean {
  if (!code) return false;
  return code.trim().toUpperCase() === 'SUBCON';
}

/**
 * Validates SUBCON description requirement before submission or close
 */
export function validateSubconOperations(
  operations: Array<{ workcenter_code: string; operation_description?: string | null; is_removed?: boolean }>
): { valid: boolean; error?: string } {
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.is_removed) continue;
    if (isSubconWorkcenter(op.workcenter_code)) {
      if (!op.operation_description || op.operation_description.trim().length === 0) {
        return {
          valid: false,
          error: `Công đoạn thứ ${i + 1} (${op.workcenter_code}) là gia công ngoài (SUBCON) nên bắt buộc phải có mô tả công đoạn (Operation Description).`,
        };
      }
    }
  }
  return { valid: true };
}

/**
 * Allocate next Issue Number atomically (YYMMDD-N001)
 */
export async function allocateNextIssueNo(targetDate?: string): Promise<{ issueNo: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('allocate_next_drawing_review_issue_no', {
      p_target_timestamp: targetDate || new Date().toISOString(),
    });
    if (error) return { issueNo: null, error: error.message };
    return { issueNo: data as string, error: null };
  } catch (err: any) {
    return { issueNo: null, error: err.message || 'Lỗi khi cấp mã Issue No.' };
  }
}

/**
 * Create new Drawing Review Issue + V1 (BD action)
 */
export async function createDrawingReviewIssue(input: CreateDrawingReviewInput): Promise<{
  success: boolean;
  issueId?: string;
  issueNo?: string;
  versionId?: string;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.rpc('create_drawing_review_issue', {
      p_item_no: input.item_no.trim(),
      p_item_name: input.item_name.trim(),
      p_customer: input.customer.trim(),
      p_drawing_file_path: input.drawing_file_path.trim(),
      p_drawing_file_name: input.drawing_file_name.trim(),
      p_drawing_file_size: input.drawing_file_size,
      p_drawing_mime_type: input.drawing_mime_type.trim(),
      p_attention: input.attention?.trim() || null,
    });

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      issueId: data?.issue_id,
      issueNo: data?.issue_no,
      versionId: data?.version_id,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi tạo yêu cầu đánh giá bản vẽ.' };
  }
}

/**
 * Save Technical Review Draft (PE-MFG action, status becomes 'Reviewing')
 */
export async function saveDrawingReviewDraft(input: SaveDrawingReviewDraftInput): Promise<{
  success: boolean;
  versionId?: string;
  status?: DrawingReviewStatus;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.rpc('save_drawing_review_draft', {
      p_version_id: input.version_id,
      p_required_material: input.required_material ?? null,
      p_required_tooling: input.required_tooling ?? null,
      p_special_measuring_equipment: input.special_measuring_equipment ?? null,
      p_engineering_remarks: input.engineering_remarks ?? null,
      p_avatar_file_path: input.avatar_file_path ?? null,
      p_avatar_crop_box: input.avatar_crop_box ?? null,
      p_operations: input.operations,
      p_material_type: input.material_type ?? null,
      p_material_specification: input.material_specification ?? null,
      p_annotations: input.annotations ?? null,
    });

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      versionId: data?.version_id,
      status: data?.status,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi lưu bản nháp kỹ thuật.' };
  }
}

/**
 * Persist Drawing Annotations / Markups directly to drawing_review_versions.annotations
 */
export async function saveDrawingReviewAnnotations(
  versionId: string,
  annotations: any[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('drawing_review_versions')
      .update({
        annotations,
        updated_at: new Date().toISOString(),
      })
      .eq('id', versionId);

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi lưu ghi chú bản vẽ.' };
  }
}

/**
 * Close Technical Review Version (PE-MFG action, status becomes 'Completed', locks version)
 */
export async function closeDrawingReviewVersion(versionId: string): Promise<{
  success: boolean;
  status?: DrawingReviewStatus;
  closedAt?: string;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.rpc('close_drawing_review_version', {
      p_version_id: versionId,
    });

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      status: data?.status,
      closedAt: data?.closed_at,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi hoàn thành phiên bản kỹ thuật.' };
  }
}

/**
 * Create Next Version (copies latest Completed version into V+1 with status Reviewing)
 */
export async function createNextDrawingReviewVersion(issueId: string): Promise<{
  success: boolean;
  versionId?: string;
  versionNumber?: number;
  versionName?: string;
  status?: DrawingReviewStatus;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.rpc('create_next_drawing_review_version', {
      p_issue_id: issueId,
    });

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      versionId: data?.version_id,
      versionNumber: data?.version_number,
      versionName: data?.version_name,
      status: data?.status,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi tạo phiên bản mới.' };
  }
}

/**
 * Quote Drawing Review Version (BD action: marks Completed as Quoted or Requoted, locking '+')
 */
export async function quoteDrawingReviewVersion(
  versionId: string,
  targetStatus?: 'Quoted' | 'Requoted'
): Promise<{
  success: boolean;
  status?: DrawingReviewStatus;
  quotedAt?: string;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.rpc('quote_drawing_review_version', {
      p_version_id: versionId,
      p_target_status: targetStatus || null,
    });

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      status: data?.status,
      quotedAt: data?.quoted_at,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi xác nhận báo giá.' };
  }
}

/**
 * Requote Drawing Review Version (BD action: marks Quoted/Requoted as Requote, opening '+')
 */
export async function requoteDrawingReviewVersion(versionId: string): Promise<{
  success: boolean;
  status?: DrawingReviewStatus;
  requoteRequestedAt?: string;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.rpc('requote_drawing_review_version', {
      p_version_id: versionId,
    });

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      status: data?.status,
      requoteRequestedAt: data?.requote_requested_at,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi yêu cầu báo giá lại.' };
  }
}

/**
 * Fetches the complete activity and status change history for an issue or all issues
 */
export async function fetchDrawingReviewHistory(
  issueId?: string
): Promise<{ data: DrawingReviewActivityLog[]; error: string | null }> {
  try {
    let query = supabase
      .from('drawing_review_activity_logs')
      .select(`
        *,
        issue:drawing_review_issues(id, issue_no, item_no, item_name, customer)
      `)
      .order('created_at', { ascending: false });

    if (issueId) {
      query = query.eq('issue_id', issueId);
    }

    const { data, error } = await query;

    if (error) {
      return { data: [], error: error.message };
    }
    return { data: (data as DrawingReviewActivityLog[]) || [], error: null };
  } catch (err: any) {
    return { data: [], error: err.message || 'Lỗi khi tải lịch sử thao tác.' };
  }
}

export interface RoutingMatrixRow {
  lineage_id: string;
  current_op_display_number?: string; // 'OP10', 'OP20'... for active ops in current version
  workcenter_code: string;
  operation_description?: string | null;
  remark?: string | null;
  is_removed: boolean;
  exists_in_current: boolean;
  /**
   * Historical cycle time values keyed by version name ('V1', 'V2', 'V3'...)
   * Displays number or '—' if absent in that version
   */
  cycle_times: Record<string, number | null | undefined>;
}

/**
 * Builds the Routing Comparison Matrix using stable Lineage IDs
 * Preserves historical alignment across V1, V2, V3...
 */
export function buildRoutingComparisonMatrix(
  allVersions: Array<DrawingReviewVersion & { operations?: DrawingReviewOperation[] }>,
  currentVersionId: string
): {
  versionNames: string[];
  rows: RoutingMatrixRow[];
} {
  // Sort versions by version_number ascending
  const sortedVersions = [...allVersions].sort((a, b) => a.version_number - b.version_number);
  const versionNames = sortedVersions.map((v) => v.version_name);

  // Collect all unique lineage IDs in appearance order
  const lineageOrder: string[] = [];
  const lineageMap = new Map<
    string,
    {
      workcenter_code: string;
      operation_description?: string | null;
      remark?: string | null;
      is_removed: boolean;
      exists_in_current: boolean;
      cycle_times: Record<string, number | null | undefined>;
    }
  >();

  // First pass: Process historical and current versions
  for (const ver of sortedVersions) {
    const ops = ver.operations || [];
    for (const op of ops) {
      if (!lineageMap.has(op.lineage_id)) {
        lineageOrder.push(op.lineage_id);
        lineageMap.set(op.lineage_id, {
          workcenter_code: op.workcenter_code,
          operation_description: op.operation_description,
          remark: op.remark,
          is_removed: op.is_removed,
          exists_in_current: false,
          cycle_times: {},
        });
      }

      const entry = lineageMap.get(op.lineage_id)!;
      // If active in this version, record cycle time; if removed, don't record active CT
      if (!op.is_removed) {
        entry.cycle_times[ver.version_name] = op.cycle_time_seconds;
      } else {
        entry.cycle_times[ver.version_name] = null;
      }

      // If this is the current active version, update current attributes
      if (ver.id === currentVersionId) {
        entry.workcenter_code = op.workcenter_code;
        entry.operation_description = op.operation_description;
        entry.remark = op.remark;
        entry.is_removed = op.is_removed;
        entry.exists_in_current = true;
      }
    }
  }

  // Calculate OP display sequence (10, 20, 30...) for active operations in current version
  let currentStepSeq = 10;
  const rows: RoutingMatrixRow[] = [];

  for (const lid of lineageOrder) {
    const entry = lineageMap.get(lid)!;
    let displayNum: string | undefined = undefined;

    if (entry.exists_in_current && !entry.is_removed) {
      displayNum = `OP${currentStepSeq}`;
      currentStepSeq += 10;
    }

    rows.push({
      lineage_id: lid,
      current_op_display_number: displayNum,
      workcenter_code: entry.workcenter_code,
      operation_description: entry.operation_description,
      remark: entry.remark,
      is_removed: entry.is_removed,
      exists_in_current: entry.exists_in_current,
      cycle_times: entry.cycle_times,
    });
  }

  return { versionNames, rows };
}

/**
 * Upload an attachment photo/file for a Drawing Review version
 */
export async function uploadDrawingReviewAttachment(
  versionId: string,
  file: File | Blob,
  fileName: string,
  caption?: string
): Promise<{ data: DrawingReviewAttachment | null; error: string | null }> {
  try {
    const cleanFileName = fileName
      .replace(/[/\\]/g, '_')
      .replace(/\.\./g, '__')
      .replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storagePath = `attachments/${versionId}/${Date.now()}_${cleanFileName}`;

    const { error: uploadError } = await supabase.storage
      .from(DRAWING_REVIEWS_STORAGE_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'image/jpeg',
      });

    if (uploadError) {
      return { data: null, error: `Lỗi tải ảnh lên Storage: ${uploadError.message}` };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: attachment, error: insertError } = await supabase
      .from('drawing_review_attachments')
      .insert({
        version_id: versionId,
        file_path: storagePath,
        file_name: fileName,
        file_size: file.size,
        mime_type: file.type || 'image/jpeg',
        caption: caption?.trim() || null,
        uploaded_by: user?.id || null,
      })
      .select()
      .single();

    if (insertError) {
      return { data: null, error: `Lỗi lưu thông tin tệp: ${insertError.message}` };
    }

    return { data: attachment as DrawingReviewAttachment, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Lỗi khi tải lên hình ảnh đính kèm.' };
  }
}

/**
 * Delete an attachment from database and storage
 */
export async function deleteDrawingReviewAttachment(
  attachmentId: string,
  filePath: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { error: dbError } = await supabase
      .from('drawing_review_attachments')
      .delete()
      .eq('id', attachmentId);

    if (dbError) {
      return { success: false, error: dbError.message };
    }

    // Attempt storage deletion (best effort)
    if (filePath) {
      await supabase.storage.from(DRAWING_REVIEWS_STORAGE_BUCKET).remove([filePath]);
      invalidateSignedUrl(DRAWING_REVIEWS_STORAGE_BUCKET, filePath);
    }

    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi xóa tệp đính kèm.' };
  }
}

/**
 * Upload cropped Item Avatar to storage and return its path
 */
export async function uploadItemAvatar(
  versionId: string,
  file: File | Blob
): Promise<{ avatarFilePath: string | null; error: string | null }> {
  try {
    const avatarPath = `avatars/${versionId}_${Date.now()}_avatar.jpg`;

    const { error: uploadError } = await supabase.storage
      .from(DRAWING_REVIEWS_STORAGE_BUCKET)
      .upload(avatarPath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'image/jpeg',
      });

    if (uploadError) {
      return { avatarFilePath: null, error: `Lỗi tải ảnh đại diện: ${uploadError.message}` };
    }

    // Invalidate cached signed URLs for previous avatar of this version
    invalidateSignedUrlsByPrefix(DRAWING_REVIEWS_STORAGE_BUCKET, `avatars/${versionId}`);

    return { avatarFilePath: avatarPath, error: null };
  } catch (err: any) {
    return { avatarFilePath: null, error: err.message || 'Lỗi khi tải ảnh đại diện.' };
  }
}

/**
 * Formats timestamp specifically into Hanoi (UTC+7) local time:
 * Displays "HH:mm:ss DD/MM/YYYY" or "HH:mm DD/MM/YYYY"
 * Accurately extracts Hanoi local clock values without double timezone shift.
 */
export function formatHanoiDateTime(dateStr?: string | null, includeSeconds = true): string {
  if (!dateStr) return '—';
  try {
    const raw = String(dateStr).trim();
    if (!raw) return '—';

    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const [, yyyy, mm, dd, hh, min, ss] = match;
      const secPart = includeSeconds && ss ? `:${ss}` : '';
      return `${hh}:${min}${secPart} ${dd}/${mm}/${yyyy}`;
    }

    const d = new Date(raw);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: includeSeconds ? '2-digit' : undefined,
      hour12: false,
    }).format(d);
  } catch {
    return '—';
  }
}

/**
 * Formats timestamp specifically into Hanoi (UTC+7) date: "DD/MM/YYYY"
 */
export function formatHanoiDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const raw = String(dateStr).trim();
    if (!raw) return '—';

    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, yyyy, mm, dd] = match;
      return `${dd}/${mm}/${yyyy}`;
    }

    const d = new Date(raw);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return '—';
  }
}



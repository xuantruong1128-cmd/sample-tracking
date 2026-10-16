import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import { uploadAttachment } from './attachmentUploadService';
import { createSecureSignedUrl } from '../lib/storageUtils';
import type { DefectItem, ProductionRun } from '../types/database.types';

export interface NGItemInput {
  id?: string;
  ng_qty: number;
  defect_name: string;
  defect_code?: string;
  cause?: string;
  remark?: string;
  photo_urls?: string[];
}

export interface SaveProductionResultInput {
  operationId: string;
  machineId: string;
  productionDate: string; // YYYY-MM-DD
  cycleTimeSeconds?: number | null;
  okQty: number;
  kivQty: number;
  ngItems: NGItemInput[];
  remarks?: string;
}

export interface SaveQACheckInput {
  operationId: string;
  result: 'OK' | 'NG' | 'KIV';
  sampleSize: number;
  okQty: number;
  ngQty: number;
  notes?: string;
}

/**
 * Fetch active defect catalog items from database.
 */
export async function fetchDefectCatalog(): Promise<{ defects: DefectItem[]; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return {
      defects: [
        { id: '1', code: 'DEF-DIM-01', name_vi: 'Sai đường kính', name_en: 'Outer Diameter', category: 'DIMENSION', is_active: true, created_at: '' },
        { id: '2', code: 'DEF-SRF-01', name_vi: 'Bavia', name_en: 'Burr', category: 'SURFACE', is_active: true, created_at: '' },
        { id: '3', code: 'DEF-SRF-02', name_vi: 'Xước bề mặt', name_en: 'Surface scratch', category: 'SURFACE', is_active: true, created_at: '' },
        { id: '4', code: 'DEF-THR-01', name_vi: 'Lỗi ren', name_en: 'Thread defect', category: 'MACHINING', is_active: true, created_at: '' },
        { id: '5', code: 'DEF-OTH-01', name_vi: 'Lỗi khác', name_en: 'Other defect', category: 'OTHER', is_active: true, created_at: '' },
      ],
      error: null,
    };
  }

  try {
    const { data, error } = await supabase
      .from('defect_catalog')
      .select('*')
      .eq('is_active', true)
      .order('code', { ascending: true });

    if (error) {
      return { defects: [], error: error.message };
    }
    return { defects: (data as DefectItem[]) || [], error: null };
  } catch (err: any) {
    return { defects: [], error: err.message || 'Lỗi khi tải danh mục lỗi.' };
  }
}

/**
 * Fetch latest production run and its NG details for an operation.
 */
export async function fetchOperationProductionRun(
  operationId: string
): Promise<{ run: ProductionRun | null; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { run: null, error: null };
  }

  try {
    const { data, error } = await supabase
      .from('production_runs')
      .select(`
        *,
        ng_details(*)
      `)
      .eq('operation_id', operationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { run: null, error: error.message };
    }
    return { run: data as ProductionRun | null, error: null };
  } catch (err: any) {
    return { run: null, error: err.message || 'Lỗi khi tải kết quả sản xuất.' };
  }
}

/**
 * Save Production Result & NG Details atomically via RPC.
 */
export async function saveProductionResult(
  input: SaveProductionResultInput
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!ENV.IS_CONFIGURED) {
    return { success: true, data: { ok_qty: input.okQty, ng_qty: 0, kiv_qty: input.kivQty } };
  }

  // Frontend validation
  if (!input.machineId || input.machineId.trim() === '') {
    return { success: false, error: 'Mã máy (Machine) không được để trống.' };
  }

  if (input.okQty < 0 || !Number.isInteger(input.okQty)) {
    return { success: false, error: 'Số lượng OK phải là số nguyên không âm.' };
  }

  if (input.kivQty < 0 || !Number.isInteger(input.kivQty)) {
    return { success: false, error: 'Số lượng KIV phải là số nguyên không âm.' };
  }

  if (input.cycleTimeSeconds !== null && input.cycleTimeSeconds !== undefined && input.cycleTimeSeconds <= 0) {
    return { success: false, error: 'Cycle Time thực tế phải là số dương lớn hơn 0.' };
  }

  for (let i = 0; i < input.ngItems.length; i++) {
    const item = input.ngItems[i];
    if (!item.ng_qty || item.ng_qty <= 0 || !Number.isInteger(item.ng_qty)) {
      return { success: false, error: `Số lượng NG tại dòng ${i + 1} phải là số nguyên dương lớn hơn 0.` };
    }
    if (!item.defect_name || item.defect_name.trim() === '') {
      return { success: false, error: `Vui lòng chọn loại lỗi (Type) tại dòng NG thứ ${i + 1}.` };
    }
  }

  try {
    const { data, error } = await supabase.rpc('save_production_result_with_ng', {
      p_operation_id: input.operationId,
      p_machine_id: input.machineId.trim(),
      p_production_date: input.productionDate || new Date().toISOString().split('T')[0],
      p_cycle_time: input.cycleTimeSeconds ? Number(input.cycleTimeSeconds) : null,
      p_ok_qty: Math.floor(input.okQty),
      p_kiv_qty: Math.floor(input.kivQty),
      p_ng_items: input.ngItems.map((item) => ({
        defect_name: item.defect_name.trim(),
        defect_code: item.defect_code || null,
        ng_qty: Math.floor(item.ng_qty),
        cause: item.cause ? item.cause.trim() : null,
        remark: item.remark ? item.remark.trim() : null,
        photo_urls: (item.photo_urls || []).slice(0, 2),
      })),
      p_remarks: input.remarks ? input.remarks.trim() : null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi lưu kết quả sản xuất.' };
  }
}

/**
 * Save QA Inspection Result atomically via RPC.
 */
export async function saveQACheck(
  input: SaveQACheckInput
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!ENV.IS_CONFIGURED) {
    return { success: true, data: { result: input.result } };
  }

  if (input.sampleSize <= 0 || !Number.isInteger(input.sampleSize)) {
    return { success: false, error: 'Cỡ mẫu kiểm tra phải là số nguyên dương lớn hơn 0.' };
  }

  if (input.okQty < 0 || input.ngQty < 0) {
    return { success: false, error: 'Số lượng OK và NG kiểm tra phải là số không âm.' };
  }

  if (input.okQty + input.ngQty > input.sampleSize) {
    return { success: false, error: 'Tổng số lượng OK và NG không được vượt quá cỡ mẫu.' };
  }

  try {
    const { data, error } = await supabase.rpc('save_qa_check_result', {
      p_operation_id: input.operationId,
      p_result: input.result,
      p_sample_size: Math.floor(input.sampleSize),
      p_ok_qty: Math.floor(input.okQty),
      p_ng_qty: Math.floor(input.ngQty),
      p_notes: input.notes ? input.notes.trim() : null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi lưu kết quả kiểm tra QA.' };
  }
}

/**
 * Upload NG Photo using private Supabase Storage and register as NG_PHOTO attachment.
 * Maximum 2 photos per NG row enforced.
 */
export async function uploadNGPhoto(
  jobId: string,
  operationId: string,
  file: File
): Promise<{ filePath: string | null; error: string | null }> {
  const result = await uploadAttachment({
    jobId,
    operationId,
    fileType: 'NG_PHOTO',
    file,
    fileName: `ng_${Date.now()}_${file.name}`,
  });

  if (result.error || !result.attachment) {
    return { filePath: null, error: result.error || 'Lỗi khi tải ảnh lên kho lưu trữ.' };
  }

  return { filePath: result.attachment.file_path, error: null };
}

/**
 * Generate secure signed URL for viewing an NG photo (max 5 minutes lifetime, private storage).
 */
export async function viewNGPhotoSignedUrl(
  filePath: string
): Promise<{ signedUrl: string | null; error: string | null }> {
  return createSecureSignedUrl(filePath, 300);
}

export interface ReviewKivInput {
  operationId: string;
  kivToOk: number;
  kivToNg: number;
  reason: string;
  ngItems?: NGItemInput[];
}

export interface CloseJobFinalInput {
  jobId: string;
  confirmTicket: string;
  closeReason?: string;
  acknowledgedWarnings?: any[];
  evaluationResult?: 'PASS' | 'CONDITIONAL' | 'FAIL';
  overallAssessment?: string;
  improvementsRequired?: string;
  unresolvedIssues?: string;
}

/**
 * Close Job Operation via RPC close_job_operation (PE-MFG Leader or Admin)
 */
export async function closeJobOperation(
  operationId: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('close_job_operation', {
      p_operation_id: operationId,
    });

    if (error) {
      return { success: false, error: error.message };
    }
    if (data?.error) {
      return { success: false, error: data.error };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi chốt công đoạn.' };
  }
}

/**
 * Review KIV Transfer (Convert KIV to OK and/or NG) via RPC review_kiv_transfer
 */
export async function reviewKivTransfer(
  input: ReviewKivInput
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (input.kivToOk < 0 || input.kivToNg < 0) {
    return { success: false, error: 'Số lượng chuyển đổi phải là số không âm.' };
  }

  if (input.kivToOk + input.kivToNg <= 0) {
    return { success: false, error: 'Tổng số lượng chuyển đổi (OK + NG) phải lớn hơn 0.' };
  }

  if (!input.reason || input.reason.trim().length < 3) {
    return { success: false, error: 'Vui lòng cung cấp lý do chuyển đổi KIV (tối thiểu 3 ký tự).' };
  }

  if (input.kivToNg > 0) {
    if (!input.ngItems || input.ngItems.length === 0) {
      return { success: false, error: 'Chuyển KIV sang NG bắt buộc phải nhập chi tiết lỗi (NG Details).' };
    }
    const sumNg = input.ngItems.reduce((sum, item) => sum + (Number(item.ng_qty) || 0), 0);
    if (sumNg !== input.kivToNg) {
      return {
        success: false,
        error: `Tổng số lượng trong bảng lỗi NG (${sumNg} pcs) phải khớp chính xác với số lượng chuyển sang NG (${input.kivToNg} pcs).`,
      };
    }
  }

  try {
    const { data, error } = await supabase.rpc('review_kiv_transfer', {
      p_operation_id: input.operationId,
      p_kiv_to_ok: Math.floor(input.kivToOk),
      p_kiv_to_ng: Math.floor(input.kivToNg),
      p_reason: input.reason.trim(),
      p_ng_items: (input.ngItems || []).map((item) => ({
        defect_name: item.defect_name.trim(),
        defect_code: item.defect_code || null,
        ng_qty: Math.floor(item.ng_qty),
        cause: item.cause ? item.cause.trim() : null,
        remark: item.remark ? item.remark.trim() : null,
        photo_urls: (item.photo_urls || []).slice(0, 2),
      })),
    });

    if (error) {
      return { success: false, error: error.message };
    }
    if (data?.error) {
      return { success: false, error: data.error };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi thực hiện Review KIV.' };
  }
}

/**
 * Fetch KIV review history for an operation
 */
export async function fetchKivReviews(
  operationId: string
): Promise<{ data: any[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('kiv_reviews')
      .select('*')
      .eq('operation_id', operationId)
      .order('created_at', { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }
    return { data: data || [] };
  } catch (err: any) {
    return { data: [], error: err.message };
  }
}

/**
 * Close Job Final (Option B) via RPC close_job_final
 */
export async function closeJobFinal(
  input: CloseJobFinalInput
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!input.confirmTicket || input.confirmTicket.trim() === '') {
    return { success: false, error: 'Vui lòng nhập lại mã JOB Ticket để xác nhận.' };
  }

  try {
    const { data, error } = await supabase.rpc('close_job_final', {
      p_job_id: input.jobId,
      p_confirm_ticket: input.confirmTicket.trim(),
      p_close_reason: input.closeReason ? input.closeReason.trim() : null,
      p_acknowledged_warnings: input.acknowledgedWarnings || [],
      p_evaluation_result: input.evaluationResult || 'PASS',
      p_overall_assessment: input.overallAssessment ? input.overallAssessment.trim() : 'Đạt yêu cầu kỹ thuật sản xuất mẫu.',
      p_improvements_required: input.improvementsRequired ? input.improvementsRequired.trim() : null,
      p_unresolved_issues: input.unresolvedIssues ? input.unresolvedIssues.trim() : null,
    });

    if (error) {
      return { success: false, error: error.message };
    }
    if (data?.error) {
      return { success: false, error: data.error };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi đóng Lệnh sản xuất.' };
  }
}

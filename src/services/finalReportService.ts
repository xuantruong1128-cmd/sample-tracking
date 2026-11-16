import { supabase } from '../lib/supabase';
import type { SampleFinalReport } from '../types/finalReport';

export async function fetchFinalReport(
  jobId: string
): Promise<{ data: SampleFinalReport | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('sample_final_reports')
      .select('*')
      .eq('job_id', jobId)
      .maybeSingle();

    if (error) {
      return { data: null, error: error.message };
    }
    return { data: data as SampleFinalReport | null, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Lỗi khi tải thông tin báo cáo.' };
  }
}

/**
 * Lightweight status check for polling, avoiding downloading heavy snapshot_data JSONB.
 */
export async function fetchFinalReportStatus(
  jobId: string
): Promise<{ status: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('sample_final_reports')
      .select('id, generation_status, error_message')
      .eq('job_id', jobId)
      .maybeSingle();

    if (error) {
      return { status: null, error: error.message };
    }
    return {
      status: (data as any)?.generation_status || null,
      error: (data as any)?.error_message || null,
    };
  } catch (err: any) {
    return { status: null, error: err.message || 'Lỗi kiểm tra trạng thái báo cáo.' };
  }
}

export async function triggerReportGeneration(
  jobId: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('generate-final-report', {
      body: { job_id: jobId },
    });

    if (error) {
      return { success: false, error: error.message };
    }
    if (data?.error) {
      return { success: false, error: data.error };
    }
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi khởi chạy tiến trình sinh báo cáo.' };
  }
}

export async function getReportDownloadUrl(
  jobId: string,
  fileType: 'pdf' | 'zip'
): Promise<{ signedUrl: string | null; fileName?: string; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('get-report-download-url', {
      body: { job_id: jobId, file_type: fileType },
    });

    if (error) {
      return { signedUrl: null, error: error.message };
    }
    if (data?.error) {
      return { signedUrl: null, error: data.error };
    }
    return { signedUrl: data.signedUrl, fileName: data.fileName, error: null };
  } catch (err: any) {
    return { signedUrl: null, error: err.message || 'Lỗi khi tạo liên kết tải báo cáo.' };
  }
}

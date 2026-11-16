import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import type { PEEngineeringReview, PEReviewResult, UserRole } from '../types/database.types';

export interface SubmitPeReviewParams {
  jobId: string;
  operationId: string;
  reviewResult: PEReviewResult;
  engineeringComment: string;
  improvementRequired?: string;
  reviewerName?: string;
  reviewerRole?: UserRole;
}

/**
 * Fetch all PE Engineering Reviews for an operation, ordered newest first.
 */
export async function fetchPeReviews(
  operationId: string
): Promise<{ reviews: PEEngineeringReview[]; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    return { reviews: [], error: null };
  }

  try {
    const { data, error } = await supabase
      .from('pe_engineering_reviews')
      .select('*')
      .eq('operation_id', operationId)
      .order('created_at', { ascending: false });

    if (error) {
      return { reviews: [], error: error.message };
    }

    return { reviews: (data || []) as PEEngineeringReview[], error: null };
  } catch (err: any) {
    return { reviews: [], error: err.message || 'Lỗi khi tải lịch sử đánh giá kỹ thuật PE.' };
  }
}

/**
 * Submit a new PE Engineering Review (append-only history).
 * Preserves all earlier reviews and timestamps.
 */
export async function submitPeReview({
  jobId,
  operationId,
  reviewResult,
  engineeringComment,
  improvementRequired = '',
  reviewerName: customReviewerName,
  reviewerRole: customReviewerRole,
}: SubmitPeReviewParams): Promise<{ review: PEEngineeringReview | null; error: string | null }> {
  if (!ENV.IS_CONFIGURED) {
    const mockReview: PEEngineeringReview = {
      id: `mock-pe-${Date.now()}`,
      job_id: jobId,
      operation_id: operationId,
      review_result: reviewResult,
      engineering_comment: engineeringComment,
      improvement_required: improvementRequired,
      reviewed_by: 'demo-user',
      reviewer_name: customReviewerName || 'Kỹ sư PE',
      reviewer_role: customReviewerRole || 'PE-MFG',
      created_at: new Date().toISOString(),
    };
    return { review: mockReview, error: null };
  }

  // 1. Validation
  const trimmedComment = (engineeringComment || '').trim();
  if (!trimmedComment) {
    return { review: null, error: 'Vui lòng nhập nhận xét đánh giá kỹ thuật (Engineering Comment).' };
  }

  if (reviewResult !== 'OK' && reviewResult !== 'NG') {
    return { review: null, error: 'Kết luận đánh giá PE mới chỉ chấp nhận OK hoặc NG (Pending đã bị loại bỏ).' };
  }

  // 2. Auth user check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    return { review: null, error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' };
  }

  let reviewerName = customReviewerName;
  let reviewerRole: UserRole | undefined = customReviewerRole;

  if (!reviewerName || !reviewerRole) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, phone, role')
      .eq('id', session.user.id)
      .single();

    reviewerName = reviewerName || profile?.full_name || profile?.phone || 'Kỹ sư PE';
    reviewerRole = reviewerRole || profile?.role || 'PE-MFG';
  }

  try {
    const { data, error } = await supabase
      .from('pe_engineering_reviews')
      .insert({
        job_id: jobId,
        operation_id: operationId,
        review_result: reviewResult,
        engineering_comment: trimmedComment,
        improvement_required: (improvementRequired || '').trim(),
        reviewed_by: session.user.id,
        reviewer_name: reviewerName,
        reviewer_role: reviewerRole,
      })
      .select()
      .single();

    if (error) {
      return { review: null, error: error.message };
    }

    return { review: data as PEEngineeringReview, error: null };
  } catch (err: any) {
    return { review: null, error: err.message || 'Lỗi khi lưu đánh giá kỹ thuật PE.' };
  }
}

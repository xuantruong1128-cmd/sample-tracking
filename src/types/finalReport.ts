export type FinalEvaluationResult = 'PASS' | 'CONDITIONAL' | 'FAIL';
export type ReportGenerationStatus = 'Pending' | 'Generating' | 'Ready' | 'Failed';

export interface SampleFinalReport {
  id: string;
  job_id: string;
  evaluation_result: FinalEvaluationResult;
  overall_assessment: string;
  improvements_required?: string | null;
  unresolved_issues?: string | null;
  closed_by: string;
  closed_by_name: string;
  closed_at: string;
  close_reason?: string | null;
  close_warnings: any[];
  snapshot_data: Record<string, any>;
  generation_status: ReportGenerationStatus;
  generation_error?: string | null;
  generation_attempts: number;
  generated_at?: string | null;
  pdf_file_name?: string | null;
  pdf_file_path?: string | null;
  pdf_file_size?: number | null;
  pdf_sha256?: string | null;
  zip_file_name?: string | null;
  zip_file_path?: string | null;
  zip_file_size?: number | null;
  zip_sha256?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloseJobEvaluationInput {
  evaluationResult: FinalEvaluationResult;
  overallAssessment: string;
  improvementsRequired?: string;
  unresolvedIssues?: string;
}

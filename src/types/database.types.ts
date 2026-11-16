export type UserRole = 'Planning' | 'PE-MFG' | 'QA' | 'Admin' | 'Drawing' | 'Viewer' | 'BD';
export type JobStatus = 'ACTIVE' | 'CLOSE' | 'ARCHIVE' | 'PURGED';
export type OperationStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'HOLD'
  | 'WAITING_QA'
  | 'QA_KIV'
  | 'QA_NG'
  | 'COMPLETED'
  | 'CLOSED';
export type QAResult = 'OK' | 'NG' | 'KIV';
export type AttachmentType = 'DRAWING' | 'CHECK_SHEET' | 'SETTING_SHEET' | 'NG_PHOTO' | 'OTHER';
export type UploadStatus = 'PENDING' | 'READY' | 'FAILED';
export type PEDispositionType =
  | 'CONTINUE_AS_IS'
  | 'REWORK_NEXT'
  | 'TECHNICAL_REVIEW'
  | 'CUSTOMER_EVALUATION'
  | 'HOLD';
export type EngineeringDocCategory = 'Drawing' | 'Check Sheet' | 'Setting' | 'Other';
export type QADocumentCategory =
  | 'Inspection Report'
  | 'CPK/SPC'
  | 'NG Photos'
  | 'Measurement Results'
  | 'Other';
export type PEReviewResult = 'Pending' | 'OK' | 'NG';

export interface Profile {
  id: string;
  phone: string;
  email?: string | null;
  full_name: string;
  role: UserRole;
  department: string;
  is_active: boolean;
  must_change_password?: boolean;
  can_make_pe_decisions?: boolean;
  is_department_leader?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  job_no: string;
  part_no: string;
  part_name: string;
  customer: string;
  order_qty: number;
  material: string;
  material_spec?: string | null;
  planned_start_date: string;
  planned_finish_date: string;
  status: JobStatus;
  pe_owner_id?: string | null;
  pe_delegates?: string[];
  closed_at?: string | null;
  closed_by?: string | null;
  close_warnings?: any[] | null;
  close_reason?: string | null;
  final_snapshot?: any | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  // joined relations
  operations?: JobOperation[];
  pe_dispositions?: PETechnicalDisposition[];
  engineering_documents?: EngineeringDocument[];
}

export interface WorkcenterMaster {
  id: string;
  stt?: number | null;
  code: string;
  mc_type?: string | null;
  description: string;
  is_active: boolean;
  created_at: string;
}

export interface JobOperation {
  id: string;
  job_id: string;
  step_order: number;
  operation_name: string;
  planned_machine?: string | null;
  planned_cycle_time_seconds?: number | null;
  status: OperationStatus;
  qa_event_counter?: number;
  reopened_at?: string | null;
  reopened_by?: string | null;
  reopen_reason?: string | null;
  created_at: string;
  updated_at: string;
  // UI-03 enhanced fields
  workcenter_code?: string | null;
  description?: string | null;
  machine_no?: string | null;
  remark?: string | null;
  // Workflow V2 closed fields
  closed_at?: string | null;
  closed_by?: string | null;
  closed_snapshot?: any | null;
  // joined relations
  production_runs?: ProductionRun[];
  qa_checks?: QACheck[];
  kiv_reviews?: KIVReview[];
  sample_photos?: OperationSamplePhoto[];
  pe_reviews?: PEEngineeringReview[];
  qa_documents?: QADocument[];
}

export interface QADocument {
  id: string;
  job_id: string;
  operation_id: string;
  category: QADocumentCategory;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  remark?: string;
  uploaded_by?: string | null;
  uploader_name: string;
  created_at: string;
}

export interface OperationSamplePhoto {
  id: string;
  job_id: string;
  operation_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  is_avatar?: boolean;
  uploaded_by?: string | null;
  uploader_name: string;
  created_at: string;
}

export interface PEEngineeringReview {
  id: string;
  job_id: string;
  operation_id: string;
  review_result: PEReviewResult;
  engineering_comment: string;
  improvement_required?: string;
  reviewed_by?: string | null;
  reviewer_name: string;
  reviewer_role: UserRole;
  created_at: string;
}

export interface EngineeringDocument {
  id: string;
  job_id: string;
  operation_id?: string | null;
  category: EngineeringDocCategory;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  version: string;
  parent_document_id?: string | null;
  remark?: string;
  uploaded_by?: string | null;
  uploader_name: string;
  created_at: string;
}

export interface KIVReview {
  id: string;
  operation_id: string;
  job_id: string;
  production_run_id?: string | null;
  kiv_before: number;
  kiv_to_ok: number;
  kiv_to_ng: number;
  kiv_after: number;
  reason: string;
  reviewed_by: string;
  reviewed_by_name: string;
  ng_details_snapshot?: any;
  created_at: string;
}

export interface ProductionRun {
  id: string;
  operation_id: string;
  machine_id: string;
  operator_id?: string | null;
  operator_name: string;
  start_time: string;
  end_time: string;
  cycle_time_seconds?: number | null;
  ok_qty: number;
  ng_qty: number;
  kiv_qty?: number;
  production_date?: string | null;
  remarks?: string | null;
  created_at: string;
  updated_at?: string;
  ng_details?: NGDetail[];
}

export interface DefectItem {
  id: string;
  code: string;
  name_vi: string;
  name_en: string;
  category: string;
  is_active: boolean;
  created_at: string;
}

export interface NGDetail {
  id: string;
  production_run_id: string;
  defect_id?: string | null;
  defect_code?: string | null;
  defect_name: string;
  ng_qty: number;
  defect_description?: string | null;
  cause?: string | null;
  remark?: string | null;
  photo_urls?: string[];
  created_at: string;
  updated_at?: string;
}

export interface QANgDetail {
  id: string;
  qa_check_id: string;
  operation_id: string;
  job_id: string;
  defect_code?: string | null;
  defect_name: string;
  ng_qty: number;
  cause?: string | null;
  remark?: string | null;
  photo_urls?: string[];
  created_at: string;
  updated_at?: string;
}

export interface QACheck {
  id: string;
  operation_id: string;
  production_run_id?: string | null;
  inspector_id?: string | null;
  inspector_name: string;
  inspection_time: string;
  sample_size?: number | null;
  ok_qty?: number;
  ng_qty?: number;
  result: QAResult;
  event_seq?: number;
  notes?: string | null;
  created_at: string;
  n1_result?: 'OK' | 'NG' | null;
  n1_check_sheet_urls?: string[];
  qa_total_ng?: number;
  qa_ng_details?: QANgDetail[];
}

export interface Attachment {
  id: string;
  job_id: string;
  operation_id?: string | null;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  file_type: AttachmentType;
  upload_status?: UploadStatus;
  content_hash?: string | null;
  last_error?: string | null;
  last_retry_at?: string | null;
  admin_on_behalf?: boolean;
  owning_department?: UserRole;
  uploaded_by?: string | null;
  created_at: string;
}

export interface PETechnicalDisposition {
  id: string;
  job_id: string;
  operation_id: string;
  qa_check_id?: string | null;
  decision_type: PEDispositionType;
  technical_reason: string;
  planned_follow_up?: string | null;
  decision_maker: string;
  decision_maker_name: string;
  decision_timestamp: string;
  attachments_urls?: string[];
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  old_values?: Record<string, any> | null;
  new_values?: Record<string, any> | null;
  ip_address?: string | null;
  created_at: string;
}

export interface JobArchive {
  id: string;
  job_id: string;
  job_no: string;
  archive_zip_path: string;
  file_hash: string;
  archive_size: number;
  verified_at?: string | null;
  verified_by?: string | null;
  status: string;
  created_at: string;
}

export type DrawingReviewStatus =
  | 'Issued'
  | 'Reviewing'
  | 'Completed'
  | 'Quoted'
  | 'Requote'
  | 'Requoted';

export interface DrawingReviewIssue {
  id: string;
  issue_no: string;
  item_no: string;
  item_name: string;
  customer: string;
  drawing_file_path: string;
  drawing_file_name: string;
  drawing_file_size: number;
  drawing_mime_type: string;
  attention?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DrawingReviewVersion {
  id: string;
  issue_id: string;
  version_number: number;
  version_name: string;
  parent_version_id?: string | null;
  status: DrawingReviewStatus;
  material_type?: string | null;
  material_specification?: string | null;
  required_material?: string | null;
  required_tooling?: string | null;
  special_measuring_equipment?: string | null;
  engineering_remarks?: string | null;
  avatar_file_path?: string | null;
  avatar_crop_box?: Record<string, any> | null;
  annotations?: any[] | null;
  closed_by?: string | null;
  closed_at?: string | null;
  quoted_at?: string | null;
  quoted_by?: string | null;
  requote_requested_at?: string | null;
  requote_requested_by?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DrawingReviewOperation {
  id: string;
  version_id: string;
  lineage_id: string;
  step_order: number;
  workcenter_code: string;
  operation_description?: string | null;
  cycle_time_seconds?: number | null;
  remark?: string | null;
  is_removed: boolean;
  calculation_data?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface DrawingReviewAttachment {
  id: string;
  version_id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  caption?: string | null;
  uploaded_by?: string | null;
  created_at: string;
}

import type {
  DrawingReviewIssue,
  DrawingReviewVersion,
  DrawingReviewOperation,
  DrawingReviewAttachment,
  DrawingReviewStatus,
} from './database.types';

export type {
  DrawingReviewIssue,
  DrawingReviewVersion,
  DrawingReviewOperation,
  DrawingReviewAttachment,
  DrawingReviewStatus,
};

export interface CreateDrawingReviewInput {
  item_no: string;
  item_name: string;
  customer: string;
  drawing_file_path: string;
  drawing_file_name: string;
  drawing_file_size: number;
  drawing_mime_type: string;
  attention?: string;
}

export interface SaveDrawingReviewDraftInput {
  version_id: string;
  material_type?: string;
  material_specification?: string;
  required_material?: string;
  required_tooling?: string;
  special_measuring_equipment?: string;
  engineering_remarks?: string;
  avatar_file_path?: string;
  avatar_crop_box?: Record<string, any>;
  annotations?: any[];
  operations: {
    id?: string;
    lineage_id?: string;
    step_order: number;
    workcenter_code: string;
    operation_description?: string;
    cycle_time_seconds?: number | null;
    remark?: string;
    is_removed?: boolean;
    calculation_data?: Record<string, any> | null;
  }[];
}

export interface DrawingReviewDetail extends DrawingReviewIssue {
  versions: (DrawingReviewVersion & {
    operations: DrawingReviewOperation[];
    attachments: DrawingReviewAttachment[];
  })[];
  current_version?: DrawingReviewVersion & {
    operations: DrawingReviewOperation[];
    attachments: DrawingReviewAttachment[];
  };
}

export interface DrawingReviewActivityLog {
  id: string;
  issue_id: string;
  version_id?: string | null;
  version_name?: string | null;
  action: string;
  action_label: string;
  performed_by?: string | null;
  performer_name: string;
  performer_role?: string | null;
  performer_phone?: string | null;
  old_status?: string | null;
  new_status?: string | null;
  details?: Record<string, any> | null;
  created_at: string;
  issue?: {
    id: string;
    issue_no: string;
    item_no: string;
    item_name: string;
    customer: string;
  } | null;
}

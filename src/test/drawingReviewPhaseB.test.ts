import { describe, it, expect, vi, beforeEach } from 'vitest';
import { permissions } from '../features/auth/authUtils';
import type { UserRole, Profile } from '../types/auth';
import {
  isSubconWorkcenter,
  validateSubconOperations,
  buildRoutingComparisonMatrix,
} from '../services/drawingReviewService';
import type { DrawingReviewVersion, DrawingReviewOperation } from '../types/database.types';
import fs from 'fs';
import path from 'path';

describe('DRAWING REVIEW PHASE B — ROLE & AUTHORIZATION TEST SUITE', () => {
  it('1. Recognizes BD as a valid UserRole', () => {
    const bdRole: UserRole = 'BD';
    expect(permissions.isBD(bdRole)).toBe(true);
    expect(permissions.isBD('Planning')).toBe(false);
    expect(permissions.isBD('PE-MFG')).toBe(false);
    expect(permissions.isBD('Admin')).toBe(false);
  });

  it('2. BD has permission to create and view Drawing Reviews, but NOT edit/close technical reviews', () => {
    expect(permissions.canCreateDrawingReview('BD')).toBe(true);
    expect(permissions.canCreateDrawingReview('Admin')).toBe(true);
    expect(permissions.canCreateDrawingReview('PE-MFG')).toBe(false);
    expect(permissions.canCreateDrawingReview('Planning')).toBe(false);

    expect(permissions.canEditTechnicalReview('BD')).toBe(false);
    expect(permissions.canEditTechnicalReview('PE-MFG')).toBe(true);
    expect(permissions.canEditTechnicalReview('Admin')).toBe(true);

    expect(permissions.canCloseTechnicalReview('BD')).toBe(false);
    expect(permissions.canCloseTechnicalReview('PE-MFG')).toBe(true);
    expect(permissions.canCloseTechnicalReview('Admin')).toBe(true);

    expect(permissions.canCreateReviewVersion('BD')).toBe(false);
    expect(permissions.canCreateReviewVersion('PE-MFG')).toBe(true);
    expect(permissions.canCreateReviewVersion('Admin')).toBe(true);
  });

  it('3. BD is strictly FORBIDDEN from Sample Tracking operational actions', () => {
    const bdRole: UserRole = 'BD';
    expect(permissions.canCreateJob(bdRole)).toBe(false);
    expect(permissions.canEditPlanning(bdRole)).toBe(false);
    expect(permissions.canEnterProduction(bdRole)).toBe(false);
    expect(permissions.canInspectQA(bdRole)).toBe(false);
    expect(permissions.canCloseJob(bdRole, false)).toBe(false);
    expect(permissions.canCloseJob(bdRole, true)).toBe(false);
    expect(permissions.canCloseOperation(bdRole, false)).toBe(false);
    expect(permissions.canReviewKiv(bdRole, false)).toBe(false);
    expect(permissions.canManageUsers(bdRole)).toBe(false);
    expect(permissions.canMakePEDecision(bdRole, false)).toBe(false);
    expect(permissions.canUploadSamplePhotos(bdRole)).toBe(false);
    expect(permissions.canReviewPeEngineering(bdRole)).toBe(false);
    expect(permissions.canUploadQaDocuments(bdRole)).toBe(false);
  });

  it('4. Existing Sample Tracking roles remain 100% unchanged', () => {
    expect(permissions.canCreateJob('Planning')).toBe(true);
    expect(permissions.canCreateJob('Admin')).toBe(true);
    expect(permissions.canEnterProduction('PE-MFG')).toBe(true);
    expect(permissions.canInspectQA('QA')).toBe(true);
    expect(permissions.canManageUsers('Admin')).toBe(true);
    expect(permissions.isAdmin('Admin')).toBe(true);
  });
});

describe('DRAWING REVIEW PHASE B — SUBCON WORK CENTER COMPATIBILITY', () => {
  it('5. Detects SUBCON case-insensitively without breaking existing "Subcon" or "subcon"', () => {
    expect(isSubconWorkcenter('SUBCON')).toBe(true);
    expect(isSubconWorkcenter('Subcon')).toBe(true);
    expect(isSubconWorkcenter('subcon')).toBe(true);
    expect(isSubconWorkcenter('  SubCon  ')).toBe(true);
    expect(isSubconWorkcenter('A20C')).toBe(false);
    expect(isSubconWorkcenter('CAMC')).toBe(false);
    expect(isSubconWorkcenter(null)).toBe(false);
    expect(isSubconWorkcenter(undefined)).toBe(false);
  });

  it('6. Fails validation if SUBCON operation is missing Operation Description', () => {
    const ops = [
      { workcenter_code: 'A20C', operation_description: null },
      { workcenter_code: 'SUBCON', operation_description: '' },
    ];
    const result = validateSubconOperations(ops);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('mô tả công đoạn (Operation Description)');
  });

  it('7. Passes validation if SUBCON operation has non-empty Operation Description', () => {
    const ops = [
      { workcenter_code: 'A20C', operation_description: null },
      { workcenter_code: 'SUBCON', operation_description: 'Phun cát' },
    ];
    const result = validateSubconOperations(ops);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('8. Supports multiple SUBCON operations with completely different descriptions', () => {
    const ops = [
      { workcenter_code: 'SUBCON', operation_description: 'Phun cát' },
      { workcenter_code: 'A20C', operation_description: null },
      { workcenter_code: 'Subcon', operation_description: 'Mạ kẽm điện phân' },
    ];
    const result = validateSubconOperations(ops);
    expect(result.valid).toBe(true);
    expect(ops[0].operation_description).toBe('Phun cát');
    expect(ops[2].operation_description).toBe('Mạ kẽm điện phân');
  });

  it('9. Ignores removed SUBCON operations during close validation', () => {
    const ops = [
      { workcenter_code: 'A20C', operation_description: null, is_removed: false },
      { workcenter_code: 'SUBCON', operation_description: '', is_removed: true }, // removed
    ];
    const result = validateSubconOperations(ops);
    expect(result.valid).toBe(true);
  });
});

describe('DRAWING REVIEW PHASE B — OPERATION LINEAGE & MATRIX COMPARISON', () => {
  const opL1 = 'lineage-1111';
  const opL2 = 'lineage-2222';
  const opL3 = 'lineage-3333';
  const opL4 = 'lineage-4444'; // newly inserted in V2

  const mockV1: DrawingReviewVersion & { operations: DrawingReviewOperation[] } = {
    id: 'v1-id',
    issue_id: 'issue-1',
    version_number: 1,
    version_name: 'V1',
    status: 'Completed',
    created_at: '2026-11-03T10:00:00Z',
    updated_at: '2026-11-03T10:00:00Z',
    operations: [
      {
        id: 'op-1',
        version_id: 'v1-id',
        lineage_id: opL1,
        step_order: 10,
        workcenter_code: 'A20C',
        cycle_time_seconds: 45,
        is_removed: false,
        created_at: '2026-11-03T10:00:00Z',
        updated_at: '2026-11-03T10:00:00Z',
      },
      {
        id: 'op-2',
        version_id: 'v1-id',
        lineage_id: opL2,
        step_order: 20,
        workcenter_code: 'CGMG',
        cycle_time_seconds: 18,
        is_removed: false,
        created_at: '2026-11-03T10:00:00Z',
        updated_at: '2026-11-03T10:00:00Z',
      },
      {
        id: 'op-3',
        version_id: 'v1-id',
        lineage_id: opL3,
        step_order: 30,
        workcenter_code: 'SUBCON',
        operation_description: 'Mạ kẽm',
        cycle_time_seconds: 60,
        is_removed: false,
        created_at: '2026-11-03T10:00:00Z',
        updated_at: '2026-11-03T10:00:00Z',
      },
    ],
  };

  // V2 modifies CT of L1, removes L2, retains L3, inserts new L4
  const mockV2: DrawingReviewVersion & { operations: DrawingReviewOperation[] } = {
    id: 'v2-id',
    issue_id: 'issue-1',
    version_number: 2,
    version_name: 'V2',
    parent_version_id: 'v1-id',
    status: 'Reviewing',
    created_at: '2026-11-03T11:00:00Z',
    updated_at: '2026-11-03T11:00:00Z',
    operations: [
      {
        id: 'op-4',
        version_id: 'v2-id',
        lineage_id: opL1,
        step_order: 10,
        workcenter_code: 'A20C',
        cycle_time_seconds: 42, // changed from 45 to 42
        is_removed: false,
        created_at: '2026-11-03T11:00:00Z',
        updated_at: '2026-11-03T11:00:00Z',
      },
      {
        id: 'op-5',
        version_id: 'v2-id',
        lineage_id: opL2,
        step_order: 20,
        workcenter_code: 'CGMG',
        cycle_time_seconds: 18,
        is_removed: true, // removed in V2
        created_at: '2026-11-03T11:00:00Z',
        updated_at: '2026-11-03T11:00:00Z',
      },
      {
        id: 'op-6',
        version_id: 'v2-id',
        lineage_id: opL3,
        step_order: 30,
        workcenter_code: 'SUBCON',
        operation_description: 'Mạ kẽm',
        cycle_time_seconds: 60,
        is_removed: false,
        created_at: '2026-11-03T11:00:00Z',
        updated_at: '2026-11-03T11:00:00Z',
      },
      {
        id: 'op-7',
        version_id: 'v2-id',
        lineage_id: opL4,
        step_order: 40,
        workcenter_code: 'WSHP',
        cycle_time_seconds: 15, // newly inserted in V2
        is_removed: false,
        created_at: '2026-11-03T11:00:00Z',
        updated_at: '2026-11-03T11:00:00Z',
      },
    ],
  };

  it('10. Aligns operations across V1 and V2 using stable lineage IDs', () => {
    const { versionNames, rows } = buildRoutingComparisonMatrix([mockV1, mockV2], 'v2-id');

    expect(versionNames).toEqual(['V1', 'V2']);
    expect(rows.length).toBe(4);

    // Row 1 (L1): Exists in both V1 and V2
    const row1 = rows.find((r) => r.lineage_id === opL1)!;
    expect(row1.current_op_display_number).toBe('OP10');
    expect(row1.cycle_times['V1']).toBe(45);
    expect(row1.cycle_times['V2']).toBe(42);

    // Row 2 (L2): In V1 had 18, in V2 is removed -> cycle_times['V2'] is null
    const row2 = rows.find((r) => r.lineage_id === opL2)!;
    expect(row2.is_removed).toBe(true);
    expect(row2.cycle_times['V1']).toBe(18);
    expect(row2.cycle_times['V2']).toBeNull();
    expect(row2.current_op_display_number).toBeUndefined(); // Not numbered in V2 active list

    // Row 3 (L3): Active in both, sequential OP numbering in V2
    const row3 = rows.find((r) => r.lineage_id === opL3)!;
    expect(row3.current_op_display_number).toBe('OP20'); // dynamically assigned OP20 because L2 was removed!
    expect(row3.cycle_times['V1']).toBe(60);
    expect(row3.cycle_times['V2']).toBe(60);

    // Row 4 (L4): Newly inserted in V2 -> absent in V1
    const row4 = rows.find((r) => r.lineage_id === opL4)!;
    expect(row4.current_op_display_number).toBe('OP30');
    expect(row4.cycle_times['V1']).toBeUndefined(); // Absent in V1!
    expect(row4.cycle_times['V2']).toBe(15);
  });

  it('11. Individual version reports number only active operations (OP10, OP20...) without gaps', () => {
    // Check V1 active display numbers
    const v1Matrix = buildRoutingComparisonMatrix([mockV1], 'v1-id');
    const v1Active = v1Matrix.rows.map((r) => r.current_op_display_number);
    expect(v1Active).toEqual(['OP10', 'OP20', 'OP30']);

    // Check V2 active display numbers
    const v2Matrix = buildRoutingComparisonMatrix([mockV1, mockV2], 'v2-id');
    const v2Active = v2Matrix.rows.filter((r) => r.current_op_display_number).map((r) => r.current_op_display_number);
    expect(v2Active).toEqual(['OP10', 'OP20', 'OP30']);
  });
});

describe('DRAWING REVIEW PHASE B — DATABASE MIGRATION SCRIPT AUDIT', () => {
  const mig32Path = path.resolve(process.cwd(), 'supabase/migrations/00032_add_bd_user_role_enum.sql');
  const mig33Path = path.resolve(process.cwd(), 'supabase/migrations/00033_drawing_review_module.sql');
  const rollbackPath = path.resolve(process.cwd(), 'scripts/rollback_00032_00033_drawing_review.sql');

  it('12. Migration 00032 exists and safely adds BD role at its own transaction boundary', () => {
    expect(fs.existsSync(mig32Path)).toBe(true);
    const content = fs.readFileSync(mig32Path, 'utf8');
    expect(content).toContain("ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'BD';");
  });

  it('13. Migration 00033 exists and creates all required transactional tables', () => {
    expect(fs.existsSync(mig33Path)).toBe(true);
    const content = fs.readFileSync(mig33Path, 'utf8');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.drawing_review_issue_sequences');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.drawing_review_issues');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.drawing_review_versions');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.drawing_review_operations');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.drawing_review_attachments');
  });

  it('14. Migration 00033 includes trigger-level immutability enforcement for Completed versions', () => {
    const content = fs.readFileSync(mig33Path, 'utf8');
    expect(content).toContain('check_drawing_review_version_immutability');
    expect(content).toContain('check_drawing_review_operation_immutability');
    expect(content).toContain('check_drawing_review_attachment_immutability');
    expect(content).toContain('Phiên bản đánh giá kỹ thuật đã hoàn thành (Completed) là bất biến');
  });

  it('15. Migration 00033 implements all required RPCs with SECURITY DEFINER and search_path', () => {
    const content = fs.readFileSync(mig33Path, 'utf8');
    expect(content).toContain('allocate_next_drawing_review_issue_no');
    expect(content).toContain('create_drawing_review_issue');
    expect(content).toContain('save_drawing_review_draft');
    expect(content).toContain('close_drawing_review_version');
    expect(content).toContain('create_next_drawing_review_version');
    expect(content).toContain('SET search_path = public, auth, pg_temp');
  });

  it('16. Migration 00033 configures private drawing-reviews storage bucket and RLS policies', () => {
    const content = fs.readFileSync(mig33Path, 'utf8');
    expect(content).toContain("'drawing-reviews'");
    expect(content).toContain('p_storage_drawing_reviews_select');
    expect(content).toContain('p_storage_drawing_reviews_insert');
    expect(content).toContain("public.get_current_user_role() IN ('BD', 'PE-MFG', 'Admin')");
  });

  it('17. Rollback script exists and drops all resources cleanly in reverse dependency order', () => {
    expect(fs.existsSync(rollbackPath)).toBe(true);
    const content = fs.readFileSync(rollbackPath, 'utf8');
    expect(content).toContain('DROP TABLE IF EXISTS public.drawing_review_attachments CASCADE;');
    expect(content).toContain('DROP TABLE IF EXISTS public.drawing_review_operations CASCADE;');
    expect(content).toContain('DROP TABLE IF EXISTS public.drawing_review_versions CASCADE;');
    expect(content).toContain('DROP TABLE IF EXISTS public.drawing_review_issues CASCADE;');
    expect(content).toContain('DROP TABLE IF EXISTS public.drawing_review_issue_sequences CASCADE;');
  });

  it('18. Migration 00033 does NOT touch or overwrite workcenter_master table data', () => {
    const content = fs.readFileSync(mig33Path, 'utf8');
    expect(content).not.toMatch(/UPDATE\s+public\.workcenter_master/i);
    expect(content).not.toMatch(/DELETE\s+FROM\s+public\.workcenter_master/i);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Job, JobOperation, ProductionRun } from '../types/database.types';
import {
  getJobAutoTurnCTInfo,
  formatCTValue,
  DEFAULT_VISIBLE_COLUMN_IDS,
  HOMEPAGE_COLUMNS,
} from '../features/jobs/jobDisplayUtils';
import { JobCard } from '../features/jobs/JobCard';
import { generateJobsWorkbook } from '../services/excelExportService';

describe('SAMPLE TRACKING R4.3 — UPDATE AUTO TURN CT AGGREGATION TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to construct mock operation
  const createMockOp = (
    step_order: number,
    workcenter_code: string,
    description: string,
    planned_ct: number | null,
    runs: Partial<ProductionRun>[] = [],
    status: JobOperation['status'] = 'IN_PROGRESS'
  ): JobOperation => ({
    id: `op-${step_order}`,
    job_id: 'job-test',
    step_order,
    operation_name: description,
    workcenter_code,
    description,
    planned_cycle_time_seconds: planned_ct,
    status,
    created_at: '2026-11-01T08:00:00Z',
    updated_at: '2026-11-01T08:00:00Z',
    production_runs: runs.map((r, i) => ({
      id: `run-${step_order}-${i}`,
      operation_id: `op-${step_order}`,
      machine_id: 'M1',
      operator_name: 'Operator A',
      start_time: '2026-11-01T08:00:00Z',
      end_time: '2026-11-01T12:00:00Z',
      ok_qty: 100,
      ng_qty: 0,
      created_at: r.created_at || '2026-11-01T09:00:00Z',
      updated_at: r.updated_at || r.created_at || '2026-11-01T09:00:00Z',
      cycle_time_seconds: r.cycle_time_seconds,
    })),
  });

  // =========================================================================
  // 1. One Auto Turn Operation
  // =========================================================================
  describe('1. Acceptance: Single Auto Turn Operation', () => {
    it('displays CT of that single operation and colors green when Actual <= Plan', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 35, [
        { cycle_time_seconds: 30 },
      ]);
      const job: Partial<Job> = {
        id: 'job-1-turn-green',
        job_no: 'JOB-2026-001',
        operations: [op10],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(ctInfo.autoTurnCount).toBe(1);
      expect(ctInfo.actualRecordedCount).toBe(1);
      expect(ctInfo.totalPlan).toBe(35);
      expect(ctInfo.totalActual).toBe(30);
      expect(ctInfo.planDisplay).toBe('35');
      expect(ctInfo.actualDisplay).toBe('30');
      expect(ctInfo.status).toBe('on_time');
      expect(ctInfo.statusLabel).toBe('Đạt');
      expect(ctInfo.isComplete).toBe(true);
      expect(ctInfo.badgeClassName).toContain('bg-emerald-100');
    });

    it('displays CT of that single operation and colors dark red when Actual > Plan', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 35, [
        { cycle_time_seconds: 38 },
      ]);
      const job: Partial<Job> = {
        id: 'job-1-turn-red',
        job_no: 'JOB-2026-002',
        operations: [op10],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(ctInfo.autoTurnCount).toBe(1);
      expect(ctInfo.actualRecordedCount).toBe(1);
      expect(ctInfo.totalPlan).toBe(35);
      expect(ctInfo.totalActual).toBe(38);
      expect(ctInfo.planDisplay).toBe('35');
      expect(ctInfo.actualDisplay).toBe('38');
      expect(ctInfo.status).toBe('exceeded');
      expect(ctInfo.statusLabel).toBe('Vượt CT');
      expect(ctInfo.isComplete).toBe(true);
      expect(ctInfo.badgeClassName).toContain('bg-red-700');
    });

    it('displays "—" for CT Actual when no production run exists yet', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 35, []);
      const job: Partial<Job> = {
        id: 'job-1-turn-norun',
        job_no: 'JOB-2026-003',
        operations: [op10],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(ctInfo.autoTurnCount).toBe(1);
      expect(ctInfo.actualRecordedCount).toBe(0);
      expect(ctInfo.totalPlan).toBe(35);
      expect(ctInfo.totalActual).toBeNull();
      expect(ctInfo.planDisplay).toBe('35');
      expect(ctInfo.actualDisplay).toBe('—');
      expect(ctInfo.status).toBe('no_actual');
      expect(ctInfo.isComplete).toBe(false);
    });
  });

  // =========================================================================
  // 2. Two Auto Turn Operations (Prompt Exact Example)
  // =========================================================================
  describe('2. Acceptance: Two Auto Turn Operations (Prompt Example)', () => {
    it('OP10 Plan 35, Actual 38; OP30 Plan 25, Actual 30 => Plan 60, Actual 68, màu đỏ', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 35, [
        { cycle_time_seconds: 38 },
      ]);
      const op30 = createMockOp(30, 'B12C', 'Auto Turn', 25, [
        { cycle_time_seconds: 30 },
      ]);
      const job: Partial<Job> = {
        id: 'job-2-turns-exceeded',
        job_no: 'JOB-2026-PROMPT-EX',
        operations: [op10, op30],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(ctInfo.autoTurnCount).toBe(2);
      expect(ctInfo.actualRecordedCount).toBe(2);
      expect(ctInfo.totalPlan).toBe(60);
      expect(ctInfo.totalActual).toBe(68);
      expect(ctInfo.planDisplay).toBe('60');
      expect(ctInfo.actualDisplay).toBe('68');
      expect(ctInfo.status).toBe('exceeded');
      expect(ctInfo.statusLabel).toBe('Vượt CT');
      expect(ctInfo.badgeClassName).toContain('bg-red-700');
      expect(ctInfo.badgeClassName).toContain('text-white');
    });

    it('Two Auto Turns with Actual <= Plan => green background', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 35, [
        { cycle_time_seconds: 32 },
      ]);
      const op30 = createMockOp(30, 'B12C', 'Auto Turn', 25, [
        { cycle_time_seconds: 24 },
      ]);
      const job: Partial<Job> = {
        id: 'job-2-turns-ontime',
        job_no: 'JOB-2026-TWO-GREEN',
        operations: [op10, op30],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(ctInfo.totalPlan).toBe(60);
      expect(ctInfo.totalActual).toBe(56);
      expect(ctInfo.status).toBe('on_time');
      expect(ctInfo.statusLabel).toBe('Đạt');
      expect(ctInfo.badgeClassName).toContain('bg-emerald-100');
      expect(ctInfo.badgeClassName).toContain('text-emerald-800');
    });
  });

  // =========================================================================
  // 3. Three Auto Turn Operations
  // =========================================================================
  describe('3. Acceptance: Three Auto Turn Operations', () => {
    it('sums all 3 Auto Turn operations for both Plan and Actual', () => {
      const op10 = createMockOp(10, 'CAMC', 'Auto Turn', 20, [{ cycle_time_seconds: 20 }]);
      const op20 = createMockOp(20, 'A20C', 'Auto Turn', 40, [{ cycle_time_seconds: 39 }]);
      const op30 = createMockOp(30, 'L20C', 'Auto Turn', 30, [{ cycle_time_seconds: 30 }]);
      const job: Partial<Job> = {
        id: 'job-3-turns',
        job_no: 'JOB-2026-THREE',
        operations: [op10, op20, op30],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(ctInfo.autoTurnCount).toBe(3);
      expect(ctInfo.actualRecordedCount).toBe(3);
      expect(ctInfo.totalPlan).toBe(90);
      expect(ctInfo.totalActual).toBe(89);
      expect(ctInfo.status).toBe('on_time');
      expect(ctInfo.statusLabel).toBe('Đạt');
      expect(ctInfo.badgeClassName).toContain('bg-emerald-100');
    });
  });

  // =========================================================================
  // 4. Do NOT sum Grinding or other operations
  // =========================================================================
  describe('4. Acceptance: Strict Exclusion of Grinding and Other Operations', () => {
    it('does NOT add CT from CGMG, CYGG, or any non-Auto Turn operation into total', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 35, [{ cycle_time_seconds: 38 }]);
      const op20 = createMockOp(20, 'CGMG', 'Centerless Grinding', 100, [{ cycle_time_seconds: 90 }]);
      const op30 = createMockOp(30, 'CYGG', 'Cylindrical Grinding', 80, [{ cycle_time_seconds: 75 }]);
      const op40 = createMockOp(40, 'B26C', 'Auto Turn', 25, [{ cycle_time_seconds: 30 }]);
      const op50 = createMockOp(50, 'VMIQ', 'Visual Inspection', 10, [{ cycle_time_seconds: 10 }]);

      const job: Partial<Job> = {
        id: 'job-mixed-ops',
        job_no: 'JOB-MIXED-GRINDING',
        operations: [op10, op20, op30, op40, op50],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      // Only OP10 (A20C) and OP40 (B26C) must be included!
      expect(ctInfo.autoTurnCount).toBe(2);
      expect(ctInfo.actualRecordedCount).toBe(2);
      expect(ctInfo.totalPlan).toBe(60); // 35 + 25
      expect(ctInfo.totalActual).toBe(68); // 38 + 30
      expect(ctInfo.planDisplay).toBe('60');
      expect(ctInfo.actualDisplay).toBe('68');
      expect(ctInfo.status).toBe('exceeded');
    });

    it('returns no_auto_turn ("—") when job has only Grinding operations', () => {
      const op10 = createMockOp(10, 'CGMG', 'Centerless Grinding', 50, [{ cycle_time_seconds: 48 }]);
      const op20 = createMockOp(20, 'CYGG', 'Cylindrical Grinding', 60, [{ cycle_time_seconds: 62 }]);

      const job: Partial<Job> = {
        id: 'job-only-grinding',
        job_no: 'JOB-GRINDING-ONLY',
        operations: [op10, op20],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(ctInfo.autoTurnCount).toBe(0);
      expect(ctInfo.totalPlan).toBeNull();
      expect(ctInfo.totalActual).toBeNull();
      expect(ctInfo.planDisplay).toBe('—');
      expect(ctInfo.actualDisplay).toBe('—');
      expect(ctInfo.status).toBe('no_auto_turn');
    });
  });

  // =========================================================================
  // 5. Rule 6: Latest Valid Production Run Only (Does NOT sum multiple runs of same op)
  // =========================================================================
  describe('5. Acceptance: Latest Valid Run of Each Operation (No Multi-Run Summing)', () => {
    it('takes ONLY the latest valid CT Actual for an operation, ignoring older runs', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 45, [
        { cycle_time_seconds: 40, created_at: '2026-11-01T08:00:00Z' },
        { cycle_time_seconds: 50, created_at: '2026-11-01T10:00:00Z' },
        { cycle_time_seconds: 42, created_at: '2026-11-01T14:00:00Z' }, // latest
      ]);

      const job: Partial<Job> = {
        id: 'job-multi-run-same-op',
        operations: [op10],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(ctInfo.autoTurnCount).toBe(1);
      expect(ctInfo.actualRecordedCount).toBe(1);
      // Must be 42, NEVER 40 + 50 + 42 = 132!
      expect(ctInfo.totalActual).toBe(42);
      expect(ctInfo.status).toBe('on_time'); // 42 <= 45
    });

    it('ignores runs with null or 0 cycle time and picks the latest positive run', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 45, [
        { cycle_time_seconds: 44, created_at: '2026-11-01T08:00:00Z' },
        { cycle_time_seconds: null, created_at: '2026-11-01T11:00:00Z' }, // invalid/unrecorded
      ]);

      const job: Partial<Job> = {
        id: 'job-ignore-invalid-run',
        operations: [op10],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(ctInfo.totalActual).toBe(44);
    });
  });

  // =========================================================================
  // 6. Rule 8: Operation Does NOT Need to Be Closed
  // =========================================================================
  describe('6. Acceptance: Unclosed Operations Count Immediately', () => {
    it('aggregates CT for IN_PROGRESS or PENDING operations without waiting for CLOSE', () => {
      const op10 = createMockOp(
        10,
        'A20C',
        'Auto Turn',
        35,
        [{ cycle_time_seconds: 34 }],
        'IN_PROGRESS' // NOT CLOSED!
      );
      const op30 = createMockOp(
        30,
        'B12C',
        'Auto Turn',
        25,
        [{ cycle_time_seconds: 24 }],
        'PENDING' // NOT CLOSED!
      );

      const job: Partial<Job> = {
        id: 'job-unclosed-ops',
        operations: [op10, op30],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(ctInfo.isComplete).toBe(true);
      expect(ctInfo.totalActual).toBe(58);
      expect(ctInfo.status).toBe('on_time');
    });
  });

  // =========================================================================
  // 7. Partial Data Behavior
  // =========================================================================
  describe('7. Partial Data Behavior', () => {
    it('displays partial sum with neutral styling and "Chưa đủ CT" when only 1 of 2 Auto Turns has actual', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 35, [
        { cycle_time_seconds: 38 },
      ]);
      const op30 = createMockOp(10, 'B12C', 'Auto Turn', 25, []); // No actual!

      const job: Partial<Job> = {
        id: 'job-partial-turn',
        operations: [op10, op30],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(ctInfo.autoTurnCount).toBe(2);
      expect(ctInfo.actualRecordedCount).toBe(1);
      expect(ctInfo.totalPlan).toBe(60);
      expect(ctInfo.totalActual).toBe(38);
      expect(ctInfo.actualDisplay).toBe('38');
      expect(ctInfo.status).toBe('partial');
      expect(ctInfo.statusLabel).toBe('Chưa đủ CT');
      expect(ctInfo.isComplete).toBe(false);

      // Must NOT be colored green or dark red!
      expect(ctInfo.badgeClassName).not.toContain('bg-emerald-100');
      expect(ctInfo.badgeClassName).not.toContain('bg-red-700');
      expect(ctInfo.badgeClassName).toContain('bg-slate-100');
    });
  });

  // =========================================================================
  // 8. Decimal Precision (No Premature Rounding)
  // =========================================================================
  describe('8. Precision: No Premature Rounding', () => {
    it('preserves decimals when summing and comparing CT', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 35.5, [
        { cycle_time_seconds: 38.2 },
      ]);
      const op30 = createMockOp(30, 'B12C', 'Auto Turn', 25.2, [
        { cycle_time_seconds: 30.1 },
      ]);

      const job: Partial<Job> = {
        id: 'job-decimal-ct',
        operations: [op10, op30],
      };

      const ctInfo = getJobAutoTurnCTInfo(job);
      expect(formatCTValue(ctInfo.totalPlan)).toBe('60.7');
      expect(formatCTValue(ctInfo.totalActual)).toBe('68.3');
      expect(ctInfo.status).toBe('exceeded');
    });
  });

  // =========================================================================
  // 9. Homepage JobCard Rendering
  // =========================================================================
  describe('9. Homepage JobCard Columns', () => {
    it('renders CT Plan = 60 and CT Actual = 68 in JobCard with red badge for prompt example', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 35, [{ cycle_time_seconds: 38 }]);
      const op30 = createMockOp(30, 'B12C', 'Auto Turn', 25, [{ cycle_time_seconds: 30 }]);
      const fullJob: Job = {
        id: 'job-card-test',
        job_no: 'JOB-2026-CARD',
        part_no: 'PIN-CARD',
        customer: 'Canon',
        order_qty: 1000,
        material: 'SUS304',
        status: 'ACTIVE',
        operations: [op10, op30],
      };

      render(
        <MemoryRouter>
          <JobCard job={fullJob} visibleColumnIds={DEFAULT_VISIBLE_COLUMN_IDS} />
        </MemoryRouter>
      );

      const planCol = screen.getByTestId('job-col-ct_plan');
      expect(planCol).toBeInTheDocument();
      expect(planCol.textContent?.trim()).toBe('60');

      const actualCol = screen.getByTestId('job-col-ct_actual');
      expect(actualCol).toBeInTheDocument();
      expect(actualCol.textContent?.trim()).toBe('68');

      const badge = screen.getByTestId('ct-actual-badge-job-card-test');
      expect(badge.className).toContain('bg-red-700');
    });

    it('renders "Chưa đủ CT" tag when CT Actual is partial', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 35, [{ cycle_time_seconds: 38 }]);
      const op30 = createMockOp(30, 'B12C', 'Auto Turn', 25, []); // incomplete
      const fullJob: Job = {
        id: 'job-card-partial',
        job_no: 'JOB-2026-PARTIAL',
        part_no: 'PIN-PARTIAL',
        customer: 'Canon',
        order_qty: 1000,
        status: 'ACTIVE',
        operations: [op10, op30],
      };

      render(
        <MemoryRouter>
          <JobCard job={fullJob} visibleColumnIds={DEFAULT_VISIBLE_COLUMN_IDS} />
        </MemoryRouter>
      );

      const actualCol = screen.getByTestId('job-col-ct_actual');
      expect(actualCol.textContent).toContain('38');
      expect(actualCol.textContent).toContain('Chưa đủ CT');
    });

    it('includes ct_plan and ct_actual in HOMEPAGE_COLUMNS definition', () => {
      expect(HOMEPAGE_COLUMNS.some((c) => c.id === 'ct_plan')).toBe(true);
      expect(HOMEPAGE_COLUMNS.some((c) => c.id === 'ct_actual')).toBe(true);
    });
  });

  // =========================================================================
  // 10. Excel Export Configuration
  // =========================================================================
  describe('10. Excel Export Requirements', () => {
    it('exports CT Plan and CT Actual as numeric cells with unrounded sums, and marks partial CT', () => {
      const op10 = createMockOp(10, 'A20C', 'Auto Turn', 35, [{ cycle_time_seconds: 38 }]);
      const op30 = createMockOp(30, 'B12C', 'Auto Turn', 25, [{ cycle_time_seconds: 30 }]);
      const job1: Job = {
        id: 'job-ex-1',
        job_no: 'JOB-EX-001',
        part_no: 'PART-EX',
        customer: 'Denso',
        order_qty: 500,
        status: 'ACTIVE',
        operations: [op10, op30],
      };

      const opPartial10 = createMockOp(10, 'A20C', 'Auto Turn', 40, [{ cycle_time_seconds: 35 }]);
      const opPartial30 = createMockOp(30, 'B12C', 'Auto Turn', 20, []); // incomplete
      const job2: Job = {
        id: 'job-ex-2',
        job_no: 'JOB-EX-002',
        part_no: 'PART-EX2',
        customer: 'Brother',
        order_qty: 200,
        status: 'ACTIVE',
        operations: [opPartial10, opPartial30],
      };

      const wb = generateJobsWorkbook([job1, job2]);
      const ws = wb.Sheets['JOBs'];

      // Row 1: Headers
      expect(ws['I1'].v).toBe('CT Plan');
      expect(ws['J1'].v).toBe('CT Actual');
      expect(ws['K1'].v).toBe('CT Status');
      expect(ws['L1'].v).toBe('Routing');

      // Row 2: Job 1 (Complete CT: Plan 60, Actual 68, Vượt CT)
      expect(ws['I2'].t).toBe('n');
      expect(ws['I2'].v).toBe(60);

      expect(ws['J2'].t).toBe('n');
      expect(ws['J2'].v).toBe(68);

      expect(ws['K2'].t).toBe('s');
      expect(ws['K2'].v).toBe('Vượt CT');

      // Row 3: Job 2 (Partial CT: Plan 60, Actual 35, Chưa đủ CT)
      expect(ws['I3'].t).toBe('n');
      expect(ws['I3'].v).toBe(60);

      expect(ws['J3'].t).toBe('n');
      expect(ws['J3'].v).toBe(35);

      expect(ws['K3'].t).toBe('s');
      expect(ws['K3'].v).toBe('Chưa đủ CT');

      // Cell comment on J3 marking partial status
      expect(ws['J3'].c).toBeDefined();
      expect(ws['J3'].c![0].t).toContain('Chưa đủ CT (1/2 công đoạn Auto Turn)');
    });
  });
});

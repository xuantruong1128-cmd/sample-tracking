import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Job } from '../types/database.types';
import {
  getJobDisplayStatus,
  getActualCloseDateDisplay,
  getPlanCloseDateDisplay,
  getCreatedDateDisplay,
  getVietnamCalendarDate,
  getActualCloseColorInfo,
  isAutoTurnOperation,
  getWorkcenterDescription,
  DEFAULT_VISIBLE_COLUMN_IDS,
} from '../features/jobs/jobDisplayUtils';
import {
  filterJobs,
  type FilterCondition,
} from '../features/jobs/jobFilterUtils';
import { JobCard } from '../features/jobs/JobCard';
import { JobCreateModal } from '../features/jobs/JobCreateModal';
import { JobEditModal } from '../features/jobs/JobEditModal';
import { AuthContext } from '../features/auth/AuthContext';
import { generateJobsWorkbook } from '../services/excelExportService';

function createMockAuth(role = 'Planning') {
  return {
    user: { id: 'mock-user', email: 'test@example.com' } as any,
    profile: {
      id: 'mock-user',
      full_name: 'Test Planning',
      role: role as any,
      department: 'Planning',
      is_active: true,
      must_change_password: false,
    } as any,
    loading: false,
    refreshProfile: vi.fn(),
    logout: vi.fn(),
  };
}

describe('SAMPLE TRACKING R4.1 — PRODUCTION BUG FIX & ACTUAL CLOSE COLOR TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // FIX 01: STATUS FILTER NOT WORKING
  // =========================================================================
  describe('FIX 01 — Status Filter Not Working', () => {
    // Dataset representing real factory jobs in various manufacturing phases
    const testJobs: Job[] = [
      {
        id: 'job-running-1',
        job_no: 'JOB-2026-R01',
        part_no: 'PART-RUN-01',
        customer: 'A',
        order_qty: 100,
        status: 'ACTIVE',
        closed_at: null,
        planned_finish_date: '2026-11-10',
        operations: [
          {
            id: 'op-r1-1',
            job_id: 'job-running-1',
            step_order: 10,
            status: 'IN_PROGRESS', // IN_PROGRESS op -> Running
            production_runs: [],
          },
        ],
      },
      {
        id: 'job-running-2',
        job_no: 'JOB-2026-R02',
        part_no: 'PART-RUN-02',
        customer: 'B',
        order_qty: 50,
        status: 'ACTIVE',
        closed_at: null,
        planned_finish_date: '2026-11-12',
        operations: [
          {
            id: 'op-r2-1',
            job_id: 'job-running-2',
            step_order: 10,
            status: 'COMPLETED', // COMPLETED op -> Running
            production_runs: [],
          },
          {
            id: 'op-r2-2',
            job_id: 'job-running-2',
            step_order: 20,
            status: 'NOT_STARTED',
            production_runs: [],
          },
        ],
      },
      {
        id: 'job-running-3',
        job_no: 'JOB-2026-R03',
        part_no: 'PART-RUN-03',
        customer: 'A',
        order_qty: 80,
        status: 'ACTIVE',
        closed_at: null,
        planned_finish_date: '2026-11-15',
        operations: [
          {
            id: 'op-r3-1',
            job_id: 'job-running-3',
            step_order: 10,
            status: 'CLOSED', // OP closed by PE-MFG Leader -> Running
            closed_at: '2026-11-01T08:00:00Z',
            production_runs: [{ id: 'run-1', ok_qty: 80, ng_qty: 0 }],
          },
          {
            id: 'op-r3-2',
            job_id: 'job-running-3',
            step_order: 20,
            status: 'NOT_STARTED',
            production_runs: [],
          },
        ],
      },
      {
        id: 'job-active-1',
        job_no: 'JOB-2026-A01',
        part_no: 'PART-ACT-01',
        customer: 'C',
        order_qty: 200,
        status: 'ACTIVE',
        closed_at: null,
        planned_finish_date: '2026-11-20',
        operations: [
          {
            id: 'op-a1-1',
            job_id: 'job-active-1',
            step_order: 10,
            status: 'NOT_STARTED', // Scheduled, not started yet -> Active
            production_runs: [],
          },
        ],
      },
      {
        id: 'job-close-1',
        job_no: 'JOB-2026-C01',
        part_no: 'PART-CLS-01',
        customer: 'A',
        order_qty: 120,
        status: 'CLOSE', // Closed job -> Close
        closed_at: '2026-10-30T10:00:00Z',
        planned_finish_date: '2026-11-03',
        operations: [
          {
            id: 'op-c1-1',
            job_id: 'job-close-1',
            step_order: 10,
            status: 'CLOSED',
            production_runs: [{ id: 'run-c1', ok_qty: 120, ng_qty: 0 }],
          },
        ],
      },
    ];

    it('returns exactly all Running jobs (matches UI Running badge count)', () => {
      const cond: FilterCondition = {
        id: 'f1',
        field: 'status',
        operator: 'equal',
        value: 'RUNNING',
      };
      const filtered = filterJobs(testJobs, [cond]);
      expect(filtered).toHaveLength(3);
      expect(filtered.map((j) => j.job_no)).toEqual([
        'JOB-2026-R01',
        'JOB-2026-R02',
        'JOB-2026-R03',
      ]);
    });

    it('returns exactly all Active jobs (excludes Running jobs)', () => {
      const cond: FilterCondition = {
        id: 'f2',
        field: 'status',
        operator: 'equal',
        value: 'ACTIVE',
      };
      const filtered = filterJobs(testJobs, [cond]);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].job_no).toBe('JOB-2026-A01');
    });

    it('returns exactly all Close jobs', () => {
      const cond: FilterCondition = {
        id: 'f3',
        field: 'status',
        operator: 'equal',
        value: 'CLOSE',
      };
      const filtered = filterJobs(testJobs, [cond]);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].job_no).toBe('JOB-2026-C01');
    });

    it('handles case-insensitivity: lowercase running, active, close', () => {
      expect(filterJobs(testJobs, [{ id: 'c-run', field: 'status', operator: 'equal', value: 'running' }])).toHaveLength(3);
      expect(filterJobs(testJobs, [{ id: 'c-act', field: 'status', operator: 'equal', value: 'active' }])).toHaveLength(1);
      expect(filterJobs(testJobs, [{ id: 'c-cls', field: 'status', operator: 'equal', value: 'close' }])).toHaveLength(1);
    });

    it('combines Status with other fields using AND logic', () => {
      const conds: FilterCondition[] = [
        { id: 'c1', field: 'status', operator: 'equal', value: 'RUNNING' },
        { id: 'c2', field: 'customer', operator: 'equal', value: 'A' },
      ];
      const filtered = filterJobs(testJobs, conds);
      // Among Running jobs (R01, R02, R03), only R01 and R03 have customer A
      expect(filtered).toHaveLength(2);
      expect(filtered.map((j) => j.job_no)).toEqual(['JOB-2026-R01', 'JOB-2026-R03']);
    });

    it('clearing/resetting filter returns the complete dataset', () => {
      const filtered = filterJobs(testJobs, []);
      expect(filtered).toHaveLength(testJobs.length);
    });

    it('ensures Export Excel includes the exact filtered result set', () => {
      const cond: FilterCondition = {
        id: 'f-excel',
        field: 'status',
        operator: 'equal',
        value: 'RUNNING',
      };
      const filtered = filterJobs(testJobs, [cond]);
      const wb = generateJobsWorkbook(filtered);
      const ws = wb.Sheets[wb.SheetNames[0]];
      // 1 header row + 3 data rows = 4 rows, A..L columns
      expect(ws['!ref']).toBe('A1:L4');
      expect(ws['A2'].v).toBe('JOB-2026-R01');
      expect(ws['G2'].v).toBe('Running');
      expect(ws['A3'].v).toBe('JOB-2026-R02');
      expect(ws['G3'].v).toBe('Running');
      expect(ws['A4'].v).toBe('JOB-2026-R03');
      expect(ws['G4'].v).toBe('Running');
    });
  });

  // =========================================================================
  // FIX 02: REQUIRED STAR FOR AUTO TURN CT TARGET
  // =========================================================================
  describe('FIX 02 — Required Star for Auto Turn CT Target', () => {
    it('identifies A20C, B12C, etc. as Auto Turn and CYGG, CGMG as non-Auto Turn', () => {
      expect(isAutoTurnOperation({ workcenter_code: 'A20C', description: 'Auto Turn' })).toBe(true);
      expect(isAutoTurnOperation({ workcenter_code: 'B12C', description: 'Auto Turn' })).toBe(true);
      expect(isAutoTurnOperation({ workcenter_code: 'CYGG', description: 'Cylindrical Grinding' })).toBe(false);
      expect(isAutoTurnOperation({ workcenter_code: 'CGMG', description: 'Centerless Grinding' })).toBe(false);
      expect(getWorkcenterDescription('CYGG')).toBe('Cylindrical Grinding');
    });

    it('renders red * in Desktop table header and on Auto Turn row in JobCreateModal', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuth()}>
            <JobCreateModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Operation 1 is A20C (Auto Turn) by default: must have red *
      const star = screen.getByTestId('cycle-time-required-star-0');
      expect(star).toBeInTheDocument();
      expect(star).toHaveTextContent('*');
      expect(star.className).toContain('text-red-500');

      // Operation 2 is CGMG (Centerless Grinding): must NOT have red *
      expect(screen.queryByTestId('cycle-time-required-star-1')).not.toBeInTheDocument();
    });

    it('renders red * in Mobile view for Auto Turn operation in JobCreateModal', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuth()}>
            <JobCreateModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Mobile view for OP1 (A20C)
      const mobileStar = screen.getByTestId('cycle-time-required-star-mobile-0');
      expect(mobileStar).toBeInTheDocument();
      expect(mobileStar).toHaveTextContent('*');
      expect(mobileStar.className).toContain('text-red-500');

      // Mobile view for OP2 (CGMG) must not have red *
      expect(screen.queryByTestId('cycle-time-required-star-mobile-1')).not.toBeInTheDocument();
    });

    it('renders red * on Auto Turn row in JobEditModal and omits on non-Auto Turn', () => {
      const mockJobToEdit: Job = {
        id: 'job-edit-test',
        job_no: 'JOB-2026-ED01',
        part_no: 'PART-ED-01',
        customer: 'Canon',
        order_qty: 150,
        status: 'ACTIVE',
        planned_start_date: '2026-11-02',
        planned_finish_date: '2026-11-10',
        operations: [
          {
            id: 'op-ed-1',
            job_id: 'job-edit-test',
            step_order: 10,
            workcenter_code: 'A20C',
            description: 'Auto Turn',
            planned_cycle_time_seconds: 45.0,
          },
          {
            id: 'op-ed-2',
            job_id: 'job-edit-test',
            step_order: 20,
            workcenter_code: 'CYGG',
            description: 'Cylindrical Grinding',
            planned_cycle_time_seconds: null,
          },
        ],
      };

      render(
        <MemoryRouter>
          <JobEditModal
            job={mockJobToEdit}
            isOpen={true}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />
        </MemoryRouter>
      );

      // Operation 1 (A20C) has red *
      const editStar0 = screen.getByTestId('edit-cycle-time-required-star-0');
      expect(editStar0).toBeInTheDocument();
      expect(editStar0).toHaveTextContent('*');
      expect(editStar0.className).toContain('text-red-500');

      // Operation 2 (CYGG) must NOT have red *
      expect(screen.queryByTestId('edit-cycle-time-required-star-1')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // FIX 03: ACTUAL CLOSE DATE COLOR
  // =========================================================================
  describe('FIX 03 — Actual Close Date Color', () => {
    it('normalizes calendar dates in Vietnam timezone (Asia/Ho_Chi_Minh)', () => {
      expect(getVietnamCalendarDate('2026-10-30')).toBe('2026-10-30');
      // ISO UTC timestamp: 2026-10-30T17:00:00Z is 2026-10-31 00:00:00 in Vietnam UTC+7
      expect(getVietnamCalendarDate('2026-10-30T17:00:00Z')).toBe('2026-10-31');
      // ISO UTC timestamp: 2026-10-30T03:00:00Z is 2026-10-30 10:00:00 in Vietnam UTC+7
      expect(getVietnamCalendarDate('2026-10-30T03:00:00Z')).toBe('2026-10-30');
      expect(getVietnamCalendarDate(null)).toBeNull();
      expect(getVietnamCalendarDate('')).toBeNull();
    });

    it('Rule 1: Actual Close <= Plan Close => XANH (Green badge, dark green text)', () => {
      // Example 1: Plan Close 03/11/26, Actual Close 30/10/26 => GREEN
      const job1 = {
        status: 'CLOSE',
        closed_at: '2026-10-30T08:00:00Z',
        planned_finish_date: '2026-11-03',
      };
      const info1 = getActualCloseColorInfo(job1);
      expect(info1.status).toBe('on_time');
      expect(info1.text).toBe('30/10/26');
      expect(info1.badgeClassName).toContain('bg-emerald-100');
      expect(info1.badgeClassName).toContain('text-emerald-800');

      // Example 2: Plan Close 30/10/26, Actual Close 30/10/26 => GREEN (exact day)
      const job2 = {
        status: 'CLOSE',
        closed_at: '2026-10-30T15:00:00+07:00',
        planned_finish_date: '2026-10-30',
      };
      const info2 = getActualCloseColorInfo(job2);
      expect(info2.status).toBe('on_time');
      expect(info2.text).toBe('30/10/26');
      expect(info2.badgeClassName).toContain('bg-emerald-100');
      expect(info2.badgeClassName).toContain('text-emerald-800');
    });

    it('Rule 2: Actual Close > Plan Close => ĐỎ ĐẬM (Dark red badge, white contrast text)', () => {
      // Example 3: Plan Close 26/10/26, Actual Close 30/10/26 => DARK RED
      const job3 = {
        status: 'CLOSE',
        closed_at: '2026-10-30T08:00:00Z',
        planned_finish_date: '2026-10-26',
      };
      const info3 = getActualCloseColorInfo(job3);
      expect(info3.status).toBe('late');
      expect(info3.text).toBe('30/10/26');
      expect(info3.badgeClassName).toContain('bg-red-700');
      expect(info3.badgeClassName).toContain('text-white');
    });

    it('Rule 3: Job not closed => displays "—" without background color', () => {
      const activeJob = {
        status: 'ACTIVE',
        closed_at: null,
        planned_finish_date: '2026-11-10',
      };
      const info = getActualCloseColorInfo(activeJob);
      expect(info.status).toBe('none');
      expect(info.text).toBe('—');
      expect(info.badgeClassName).not.toContain('bg-');
    });

    it('Rule 4: Missing either date => does not guess or color incorrectly', () => {
      // Closed job but missing planned_finish_date
      const noPlanJob = {
        status: 'CLOSE',
        closed_at: '2026-10-30T08:00:00Z',
        planned_finish_date: null,
      };
      const infoNoPlan = getActualCloseColorInfo(noPlanJob);
      expect(infoNoPlan.status).toBe('none');
      expect(infoNoPlan.badgeClassName).not.toContain('bg-emerald');
      expect(infoNoPlan.badgeClassName).not.toContain('bg-red');

      // Closed job but missing closed_at
      const noCloseJob = {
        status: 'CLOSE',
        closed_at: null,
        planned_finish_date: '2026-11-03',
      };
      const infoNoClose = getActualCloseColorInfo(noCloseJob);
      expect(infoNoClose.status).toBe('none');
      expect(infoNoClose.text).toBe('—');
    });

    it('renders on-time green badge inside JobCard actual_close column', () => {
      const onTimeJob: Job = {
        id: 'job-ontime',
        job_no: 'JOB-2026-ON',
        part_no: 'PART-ON',
        customer: 'Canon',
        order_qty: 100,
        status: 'CLOSE',
        closed_at: '2026-10-30T08:00:00Z',
        planned_finish_date: '2026-11-03',
        operations: [],
      };

      render(
        <MemoryRouter>
          <JobCard job={onTimeJob} visibleColumnIds={DEFAULT_VISIBLE_COLUMN_IDS} />
        </MemoryRouter>
      );

      const badge = screen.getByTestId('actual-close-badge-job-ontime');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('30/10/26');
      expect(badge.className).toContain('bg-emerald-100');
      expect(badge.className).toContain('text-emerald-800');
    });

    it('renders late dark red badge inside JobCard actual_close column', () => {
      const lateJob: Job = {
        id: 'job-late',
        job_no: 'JOB-2026-LT',
        part_no: 'PART-LT',
        customer: 'Denso',
        order_qty: 100,
        status: 'CLOSE',
        closed_at: '2026-10-30T08:00:00Z',
        planned_finish_date: '2026-10-26',
        operations: [],
      };

      render(
        <MemoryRouter>
          <JobCard job={lateJob} visibleColumnIds={DEFAULT_VISIBLE_COLUMN_IDS} />
        </MemoryRouter>
      );

      const badge = screen.getByTestId('actual-close-badge-job-late');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('30/10/26');
      expect(badge.className).toContain('bg-red-700');
      expect(badge.className).toContain('text-white');
    });

    it('renders neutral "—" inside JobCard actual_close column for active job', () => {
      const activeJob: Job = {
        id: 'job-active-test',
        job_no: 'JOB-2026-AC',
        part_no: 'PART-AC',
        customer: 'Honda',
        order_qty: 50,
        status: 'ACTIVE',
        closed_at: null,
        planned_finish_date: '2026-11-10',
        operations: [],
      };

      render(
        <MemoryRouter>
          <JobCard job={activeJob} visibleColumnIds={DEFAULT_VISIBLE_COLUMN_IDS} />
        </MemoryRouter>
      );

      const badge = screen.getByTestId('actual-close-badge-job-active-test');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('—');
      expect(badge.className).not.toContain('bg-emerald');
      expect(badge.className).not.toContain('bg-red');
    });
  });
});

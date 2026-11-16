import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { JobListPage } from '../features/jobs/JobListPage';
import { JobCard } from '../features/jobs/JobCard';
import { AuthContext } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import {
  getWorkcenterDescription,
  isAutoTurnOperation,
  formatDDMMYY,
  getCreatedDateDisplay,
  getPlanCloseDateDisplay,
  getActualCloseDateDisplay,
  HOMEPAGE_COLUMNS,
  DEFAULT_VISIBLE_COLUMN_IDS,
} from '../features/jobs/jobDisplayUtils';
import {
  validateJobInput,
  fetchWorkcenterMaster,
} from '../services/jobCreationService';
import {
  formatRoutingAsText,
  generateJobsWorkbook,
  getDefaultExportFilename,
  exportJobsToExcel,
} from '../services/excelExportService';
import type { Job, Profile } from '../types/database.types';
import { ENV } from '../lib/env';
import * as XLSX from 'xlsx';

function createMockAuth(userId = 'mock-user-1') {
  const profile: Profile = {
    id: userId,
    phone: '+84912345678',
    full_name: 'Test Planning User',
    role: 'Planning',
    department: 'Planning',
    is_active: true,
    must_change_password: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  return {
    user: { id: profile.id, email: 'test@sampletracking.local' } as any,
    profile,
    loading: false,
    refreshProfile: vi.fn(),
    logout: vi.fn(),
  };
}

describe('SAMPLE TRACKING R4 — ROUTING & HOMEPAGE IMPROVEMENTS TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // --------------------------------------------------------------------------
  // FIX 01: Workcenter CYGG Description
  // --------------------------------------------------------------------------
  describe('FIX 01 — CYGG Description', () => {
    it('Acceptance Criteria 1: CYGG displays "Cylindrical Grinding"', () => {
      expect(getWorkcenterDescription('CYGG')).toBe('Cylindrical Grinding');
      expect(getWorkcenterDescription('cygg')).toBe('Cylindrical Grinding');
      expect(getWorkcenterDescription(' CYGG ')).toBe('Cylindrical Grinding');
    });

    it('Acceptance Criteria 2: A20C displays "Auto Turn"', () => {
      expect(getWorkcenterDescription('A20C')).toBe('Auto Turn');
      expect(getWorkcenterDescription('a20c')).toBe('Auto Turn');
    });

    it('CYGG is strictly NOT classified as Auto Turn', () => {
      expect(isAutoTurnOperation({ workcenter_code: 'CYGG' })).toBe(false);
      expect(isAutoTurnOperation({ workcenter_code: 'CYGG', description: 'Cylindrical Grinding' })).toBe(false);
    });

    it('Overwrites any stale remote database description of CYGG during fetchWorkcenterMaster', async () => {
      const fromSpy = vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                { code: 'A20C', description: 'Auto Turn' },
                { code: 'CYGG', description: 'Auto Turn' }, // Stale remote value
              ],
              error: null,
            }),
          }),
        }),
      } as any);

      try {
        const list = await fetchWorkcenterMaster();
        const cyggItem = list.find((w) => w.code.toUpperCase() === 'CYGG');
        expect(cyggItem).toBeDefined();
        expect(cyggItem?.description).toBe('Cylindrical Grinding');
      } finally {
        fromSpy.mockRestore();
      }
    });
  });

  // --------------------------------------------------------------------------
  // FIX 02: Mandatory Cycle Time Target for Auto Turn
  // --------------------------------------------------------------------------
  describe('FIX 02 — Mandatory Cycle Time Target for Auto Turn', () => {
    it('Acceptance Criteria 3: Auto Turn without CT Target cannot create JOB', () => {
      const jobWithoutCt = {
        part_no: 'PART-NO-CT',
        customer: 'CUST-A',
        order_qty: 100,
        material: 'SUS304',
        planned_start_date: '2026-11-01',
        planned_finish_date: '2026-11-07',
        operations: [
          {
            step_order: 10,
            workcenter_code: 'A20C', // Auto Turn
            description: 'Auto Turn',
            planned_cycle_time_seconds: null, // missing CT Target
          },
        ],
      };

      const res = validateJobInput(jobWithoutCt);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('Công đoạn Auto Turn tại bước thứ 1 (OP10) bắt buộc phải nhập Thời gian chu kỳ mục tiêu (Cycle Time Target > 0).');
    });

    it('Auto Turn with CT Target <= 0 is rejected', () => {
      const jobWithZeroCt = {
        part_no: 'PART-ZERO-CT',
        customer: 'CUST-A',
        order_qty: 100,
        material: 'SUS304',
        planned_start_date: '2026-11-01',
        planned_finish_date: '2026-11-07',
        operations: [
          {
            step_order: 10,
            workcenter_code: 'A20C',
            description: 'Auto Turn',
            planned_cycle_time_seconds: 0,
          },
        ],
      };

      const res = validateJobInput(jobWithZeroCt);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('Cycle Time Target > 0');
    });

    it('Acceptance Criteria 4: Auto Turn with valid CT Target creates JOB', () => {
      const validAutoTurnJob = {
        part_no: 'PART-VALID-CT',
        customer: 'CUST-A',
        order_qty: 100,
        material: 'SUS304',
        planned_start_date: '2026-11-01',
        planned_finish_date: '2026-11-07',
        operations: [
          {
            step_order: 10,
            workcenter_code: 'A20C',
            description: 'Auto Turn',
            planned_cycle_time_seconds: 35.5,
          },
        ],
      };

      const res = validateJobInput(validAutoTurnJob);
      expect(res.isValid).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it('Non-Auto Turn operations (e.g. CYGG, CGMG) can have optional/blank CT Target', () => {
      const validNonAutoTurnJob = {
        part_no: 'PART-CYGG-OPTIONAL',
        customer: 'CUST-A',
        order_qty: 100,
        material: 'SUS304',
        planned_start_date: '2026-11-01',
        planned_finish_date: '2026-11-07',
        operations: [
          {
            step_order: 10,
            workcenter_code: 'CYGG', // Cylindrical Grinding
            description: 'Cylindrical Grinding',
            planned_cycle_time_seconds: null,
          },
          {
            step_order: 20,
            workcenter_code: 'CGMG', // Centerless Grinding
            description: 'Centerless Grinding',
            planned_cycle_time_seconds: null,
          },
        ],
      };

      const res = validateJobInput(validNonAutoTurnJob);
      expect(res.isValid).toBe(true);
    });

    it('Detects Auto Turn at ANY step order (not solely OP10)', () => {
      const autoTurnAtOp30 = {
        part_no: 'PART-OP30-AT',
        customer: 'CUST-A',
        order_qty: 100,
        material: 'SUS304',
        planned_start_date: '2026-11-01',
        planned_finish_date: '2026-11-07',
        operations: [
          { step_order: 10, workcenter_code: 'CGMG', description: 'Centerless Grinding' },
          { step_order: 20, workcenter_code: 'D&TS', description: 'Drill & Tap' },
          { step_order: 30, workcenter_code: 'CAMC', description: 'Auto Turn', planned_cycle_time_seconds: null }, // Auto Turn at OP30!
        ],
      };

      const res = validateJobInput(autoTurnAtOp30);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('Công đoạn Auto Turn tại bước thứ 3 (OP30) bắt buộc phải nhập Thời gian chu kỳ mục tiêu (Cycle Time Target > 0).');
    });
  });

  // --------------------------------------------------------------------------
  // FIX 03: Homepage Columns (Created Date, Plan Close, Actual Close)
  // --------------------------------------------------------------------------
  describe('FIX 03 — Homepage Columns', () => {
    it('Acceptance Criteria 6: CREATED DATE displays strictly DD/MM/YY without hours or minutes', () => {
      expect(formatDDMMYY('2026-10-30T14:35:10Z')).toBe('30/10/26');
      expect(formatDDMMYY('2026-05-04T02:00:00Z')).toBe('04/05/26');
      expect(formatDDMMYY('2026-11-02')).toBe('02/11/26');
      expect(formatDDMMYY(null)).toBe('');
      expect(formatDDMMYY('')).toBe('');

      const job: Partial<Job> = { created_at: '2026-10-16T08:15:00Z' };
      expect(getCreatedDateDisplay(job as Job)).toBe('16/10/26');
      expect(getCreatedDateDisplay(job as Job)).not.toContain(':');
    });

    it('Acceptance Criteria 7: PLAN CLOSE shows Planned End Date formatted as DD/MM/YY', () => {
      const job: Partial<Job> = { planned_finish_date: '2026-11-15' };
      expect(getPlanCloseDateDisplay(job as Job)).toBe('15/11/26');
    });

    it('Acceptance Criteria 8: ACTUAL CLOSE rules (empty if not CLOSE, DD/MM/YY when closed)', () => {
      // Case A: Job is ACTIVE (not closed) -> strictly empty
      const activeJob: Partial<Job> = {
        status: 'ACTIVE',
        closed_at: null,
      };
      expect(getActualCloseDateDisplay(activeJob as Job)).toBe('');

      // Case B: Job was reopened (status is ACTIVE even if closed_at has old timestamp) -> strictly empty
      const reopenedJob: Partial<Job> = {
        status: 'ACTIVE',
        closed_at: '2026-10-20T10:00:00Z',
      };
      expect(getActualCloseDateDisplay(reopenedJob as Job)).toBe('');

      // Case C: Job is CLOSE with closed_at -> formatted as DD/MM/YY
      const closedJob: Partial<Job> = {
        status: 'CLOSE',
        closed_at: '2026-10-25T15:30:00Z',
      };
      expect(getActualCloseDateDisplay(closedJob as Job)).toBe('25/10/26');

      // Case D: Job is CLOSE but closed_at is missing (legacy) -> empty (no guessed date)
      const legacyClosedJob: Partial<Job> = {
        status: 'CLOSE',
        closed_at: null,
      };
      expect(getActualCloseDateDisplay(legacyClosedJob as Job)).toBe('');
    });
  });

  // --------------------------------------------------------------------------
  // FIX 04: Column Visibility & Sticky Column
  // --------------------------------------------------------------------------
  describe('FIX 04 — Column Visibility', () => {
    it('Acceptance Criteria 9: Columns can be shown/hidden and preferences are remembered per user in localStorage', async () => {
      const originalDemo = ENV.IS_DEMO_MODE;
      (ENV as any).IS_DEMO_MODE = true;
      try {
        render(
          <MemoryRouter>
            <AuthContext.Provider value={createMockAuth('user-alpha')}>
              <JobListPage />
            </AuthContext.Provider>
          </MemoryRouter>
        );

        // Header initially renders all 9 columns
        const header = await screen.findByTestId('job-list-header');
        expect(within(header).getByText('Job Ticket')).toBeInTheDocument();
        expect(within(header).getByText('Plan Close')).toBeInTheDocument();
        expect(within(header).getByText('Actual Close')).toBeInTheDocument();

        // Open Column Visibility popover
        const toggleBtn = screen.getByTestId('column-visibility-toggle-btn');
        fireEvent.click(toggleBtn);

        const menu = screen.getByTestId('column-visibility-menu');
        expect(menu).toBeInTheDocument();

        // Item No. checkbox is disabled (cannot be hidden, always fixed on left)
        const itemNoCheckbox = screen.getByTestId('col-toggle-item_no') as HTMLInputElement;
        expect(itemNoCheckbox.disabled).toBe(true);
        expect(itemNoCheckbox.checked).toBe(true);

        // Hide 'Customer' column
        const customerCheckbox = screen.getByTestId('col-toggle-customer');
        fireEvent.click(customerCheckbox);

        // Verify stored in user-scoped localStorage
        const savedStorage = localStorage.getItem('sample_tracking_col_visibility_user-alpha');
        expect(savedStorage).toBeDefined();
        const parsedCols = JSON.parse(savedStorage!);
        expect(parsedCols).not.toContain('customer');
        expect(parsedCols).toContain('item_no');

        // Restore default button
        const restoreBtn = screen.getByTestId('restore-default-columns-btn');
        fireEvent.click(restoreBtn);

        // Verify restored
        expect(within(header).getByText('Customer')).toBeInTheDocument();
      } finally {
        (ENV as any).IS_DEMO_MODE = originalDemo;
      }
    });

    it('Item No. column has sticky styling to anchor on horizontal scroll', () => {
      const mockJob: Job = {
        id: 'job-sticky-test',
        job_no: '202611-999',
        part_no: 'PART-STICKY',
        customer: 'CUSTOMER-X',
        order_qty: 100,
        material: 'SUS304',
        planned_start_date: '2026-11-01',
        planned_finish_date: '2026-11-05',
        status: 'ACTIVE',
        created_at: '2026-11-01T08:00:00Z',
        updated_at: '',
        operations: [],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} visibleColumnIds={DEFAULT_VISIBLE_COLUMN_IDS} />
        </MemoryRouter>
      );

      const itemNoCol = screen.getByTestId('job-col-item_no');
      expect(itemNoCol.className).toContain('sticky');
      expect(itemNoCol.className).toContain('left-0');
    });
  });

  // --------------------------------------------------------------------------
  // FIX 05: Export Homepage to Excel (.xlsx)
  // --------------------------------------------------------------------------
  describe('FIX 05 — Export Homepage to Excel', () => {
    const sampleJobs: Job[] = [
      {
        id: 'j-01',
        job_no: '00123-JOB', // Leading zero test
        part_no: '0456-PART', // Leading zero test
        customer: 'CORP-A',
        order_qty: 500,
        material: 'SUS304',
        planned_start_date: '2026-11-01',
        planned_finish_date: '2026-11-10',
        status: 'CLOSE',
        closed_at: '2026-11-09T14:30:00Z',
        created_at: '2026-11-01T07:00:00Z',
        updated_at: '',
        operations: [
          {
            id: 'op-1',
            job_id: 'j-01',
            step_order: 10,
            workcenter_code: 'A20C',
            operation_name: 'Auto Turn',
            status: 'CLOSED',
            created_at: '',
            updated_at: '',
          },
          {
            id: 'op-2',
            job_id: 'j-01',
            step_order: 20,
            workcenter_code: 'CGMG',
            operation_name: 'Centerless Grinding',
            status: 'CLOSED',
            created_at: '',
            updated_at: '',
          },
        ],
      },
    ];

    it('Acceptance Criteria 11: Excel workbook contains all 9 schema columns with freeze panes and autofilter', () => {
      const wb = generateJobsWorkbook(sampleJobs);
      expect(wb.SheetNames).toContain('JOBs');

      const ws = wb.Sheets['JOBs'];
      expect(ws).toBeDefined();

      // Top row freeze view check
      expect(ws['!views']).toBeDefined();
      expect(ws['!views']![0].state).toBe('frozen');
      expect(ws['!views']![0].ySplit).toBe(1);

      // Autofilter check
      expect(ws['!autofilter']).toBeDefined();
      expect(ws['!autofilter']?.ref).toContain('A1:L');

      // Check header values
      expect(ws['A1'].v).toBe('Job Ticket');
      expect(ws['B1'].v).toBe('Item No.');
      expect(ws['C1'].v).toBe('Customer');
      expect(ws['D1'].v).toBe('Created Date');
      expect(ws['E1'].v).toBe('Plan Close');
      expect(ws['F1'].v).toBe('Actual Close');
      expect(ws['G1'].v).toBe('Status');
      expect(ws['H1'].v).toBe("Q'ty");
      expect(ws['I1'].v).toBe('CT Plan');
      expect(ws['J1'].v).toBe('CT Actual');
      expect(ws['K1'].v).toBe('CT Status');
      expect(ws['L1'].v).toBe('Routing');

      // Check data values
      expect(ws['A2'].v).toBe('00123-JOB');
      expect(ws['A2'].t).toBe('s'); // explicit string to preserve leading zeros
      expect(ws['B2'].v).toBe('0456-PART');
      expect(ws['B2'].t).toBe('s'); // explicit string
      expect(ws['D2'].v).toBe('01/11/26'); // Created Date
      expect(ws['E2'].v).toBe('10/11/26'); // Plan Close
      expect(ws['F2'].v).toBe('09/11/26'); // Actual Close
      expect(ws['H2'].v).toBe(500); // Q'ty numeric
    });

    it('Acceptance Criteria 12: ROUTING in Excel is formatted as clean text with arrow separator', () => {
      const routingText = formatRoutingAsText(sampleJobs[0]);
      expect(routingText).toBe('A20C → CGMG');
      expect(routingText).not.toContain('<');
      expect(routingText).not.toContain('>');
      expect(routingText).not.toContain('class=');
    });

    it('Suggested filename follows Sample_Tracking_JOBs_YYYYMMDD.xlsx', () => {
      const testDate = new Date(2026, 10, 2); // 2026-11-02
      const filename = getDefaultExportFilename(testDate);
      expect(filename).toBe('Sample_Tracking_JOBs_20261102.xlsx');
    });

    it('Acceptance Criteria 13: Handles user abort on showSaveFilePicker without declaring false success', async () => {
      // Mock window.showSaveFilePicker rejecting with AbortError
      const originalShowPicker = (window as any).showSaveFilePicker;
      (window as any).showSaveFilePicker = vi.fn().mockRejectedValue({
        name: 'AbortError',
        message: 'The user aborted a request.',
      });

      try {
        const res = await exportJobsToExcel(sampleJobs);
        expect(res.success).toBe(false);
        expect(res.cancelled).toBe(true);
      } finally {
        (window as any).showSaveFilePicker = originalShowPicker;
      }
    });

    it('Exports full dataset matching current filter (not limited to one pagination page)', () => {
      const manyJobs: Job[] = Array.from({ length: 50 }, (_, i) => ({
        ...sampleJobs[0],
        id: `job-${i}`,
        job_no: `JOB-202611-${String(i).padStart(3, '0')}`,
      }));

      const wb = generateJobsWorkbook(manyJobs);
      const ws = wb.Sheets['JOBs'];
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
      // 1 header row + 50 data rows = 51 rows (indices 0..50)
      expect(range.e.r).toBe(50);
    });
  });
});

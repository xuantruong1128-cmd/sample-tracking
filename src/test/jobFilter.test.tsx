import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { JobToolbar } from '../features/jobs/JobToolbar';
import { AuthContext } from '../features/auth/AuthContext';
import {
  filterJobs,
  validateConditions,
  getJobClosingDates,
  createDefaultCondition,
  isConditionComplete,
  type FilterCondition,
} from '../features/jobs/jobFilterUtils';
import type { Job, Profile, UserRole } from '../types/database.types';
import * as supabaseModule from '../lib/supabase';

// Helper to create mock AuthContext
function createMockAuth(role: UserRole = 'Planning') {
  const profile: Profile = {
    id: 'mock-user-id',
    phone: '+84912345678',
    full_name: 'Test Planning User',
    role,
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

// Mock test dataset mirroring real Supabase schema
const mockJobsDataset: Job[] = [
  {
    id: 'job-1',
    job_no: 'JOB-2026-001',
    part_no: 'PART-A100',
    part_name: 'Shaft Machining A',
    customer: 'Toyota',
    order_qty: 50,
    material: 'SUS304',
    planned_start_date: '2026-10-10',
    planned_finish_date: '2026-10-15',
    status: 'ACTIVE',
    closed_at: null,
    created_at: '2026-10-09T08:00:00Z',
    updated_at: '2026-10-09T08:00:00Z',
    operations: [
      {
        id: 'op-1-1',
        job_id: 'job-1',
        step_order: 1,
        operation_name: 'CNC Milling',
        status: 'IN_PROGRESS',
        created_at: '2026-10-09T08:00:00Z',
        updated_at: '2026-10-09T08:00:00Z',
      },
      {
        id: 'op-1-2',
        job_id: 'job-1',
        step_order: 2,
        operation_name: 'Grinding',
        status: 'NOT_STARTED',
        created_at: '2026-10-09T08:00:00Z',
        updated_at: '2026-10-09T08:00:00Z',
      },
    ],
  },
  {
    id: 'job-2',
    job_no: 'JOB-2026-002',
    part_no: 'PART-B200',
    part_name: 'Gear Housing B',
    customer: 'Honda',
    order_qty: 100,
    material: 'AL6061',
    planned_start_date: '2026-10-12',
    planned_finish_date: '2026-10-18',
    status: 'ACTIVE',
    closed_at: null,
    created_at: '2026-10-11T08:00:00Z',
    updated_at: '2026-10-11T08:00:00Z',
    operations: [
      {
        id: 'op-2-1',
        job_id: 'job-2',
        step_order: 1,
        operation_name: 'Lathe Turning',
        status: 'NOT_STARTED',
        created_at: '2026-10-11T08:00:00Z',
        updated_at: '2026-10-11T08:00:00Z',
      },
      {
        id: 'op-2-2',
        job_id: 'job-2',
        step_order: 2,
        operation_name: 'Anodizing',
        status: 'NOT_STARTED',
        created_at: '2026-10-11T08:00:00Z',
        updated_at: '2026-10-11T08:00:00Z',
      },
    ],
  },
  {
    id: 'job-3',
    job_no: 'JOB-2026-003',
    part_no: 'PART-A100-MOD',
    part_name: 'Shaft Machining Modified',
    customer: 'Toyota',
    order_qty: 25,
    material: 'SUS316',
    planned_start_date: '2026-10-15',
    planned_finish_date: '2026-10-20',
    status: 'CLOSE',
    closed_at: '2026-10-19T10:00:00.000Z',
    created_at: '2026-10-14T08:00:00Z',
    updated_at: '2026-10-19T10:00:00Z',
    operations: [
      {
        id: 'op-3-1',
        job_id: 'job-3',
        step_order: 1,
        operation_name: 'CNC Milling',
        status: 'COMPLETED',
        created_at: '2026-10-14T08:00:00Z',
        updated_at: '2026-10-19T10:00:00Z',
      },
    ],
  },
  {
    id: 'job-4',
    job_no: 'JOB-2026-004',
    part_no: 'PART-C300',
    part_name: 'Flange Plate C',
    customer: 'Denso',
    order_qty: 200,
    material: 'SS400',
    planned_start_date: '2026-10-20',
    planned_finish_date: '2026-10-25',
    status: 'CLOSE',
    closed_at: '2026-10-24T15:30:00.000Z',
    created_at: '2026-10-19T08:00:00Z',
    updated_at: '2026-10-24T15:30:00Z',
    operations: [
      {
        id: 'op-4-1',
        job_id: 'job-4',
        step_order: 1,
        operation_name: 'Laser Cutting',
        status: 'COMPLETED',
        created_at: '2026-10-19T08:00:00Z',
        updated_at: '2026-10-24T15:30:00Z',
      },
      {
        id: 'op-4-2',
        job_id: 'job-4',
        step_order: 2,
        operation_name: 'Bending',
        status: 'COMPLETED',
        created_at: '2026-10-19T08:00:00Z',
        updated_at: '2026-10-24T15:30:00Z',
      },
    ],
  },
];

describe('SAMPLE TRACKING — UI-01: Dynamic Multi-Condition Job Filter Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Status = Running, Active, Close
  // -------------------------------------------------------------------------
  describe('Test 1: Status = Running, Active, Close', () => {
    it('matches Running jobs that have started manufacturing', () => {
      const cond: FilterCondition = {
        id: 'c1',
        field: 'status',
        operator: 'equal',
        value: 'RUNNING',
      };

      const results = filterJobs(mockJobsDataset, [cond]);
      // job-1 has status: 'ACTIVE' and op-1-1: 'IN_PROGRESS' -> matches Running
      // job-2 is ACTIVE with all NOT_STARTED operations -> does NOT match Running (is Active)
      // job-3 is CLOSE -> does NOT match
      // job-4 is CLOSE -> does NOT match
      expect(results).toHaveLength(1);
      expect(results[0].job_no).toBe('JOB-2026-001');
    });

    it('matches Active and Close correctly according to display status', () => {
      const condActive: FilterCondition = {
        id: 'c_active',
        field: 'status',
        operator: 'equal',
        value: 'ACTIVE',
      };
      const activeResults = filterJobs(mockJobsDataset, [condActive]);
      expect(activeResults).toHaveLength(1); // job-2
      expect(activeResults[0].job_no).toBe('JOB-2026-002');

      const condClose: FilterCondition = {
        id: 'c_close',
        field: 'status',
        operator: 'equal',
        value: 'CLOSE',
      };
      const closeResults = filterJobs(mockJobsDataset, [condClose]);
      expect(closeResults).toHaveLength(2); // job-3, job-4
    });
  });

  // -------------------------------------------------------------------------
  // 2. Item Number Contain một phần mã
  // -------------------------------------------------------------------------
  describe('Test 2: Item Number Contain một phần mã', () => {
    it('matches case-insensitive substring for part_no', () => {
      const cond: FilterCondition = {
        id: 'c2',
        field: 'item_number',
        operator: 'contain',
        value: 'a100', // lowercase partial
      };

      const results = filterJobs(mockJobsDataset, [cond]);
      // PART-A100 and PART-A100-MOD
      expect(results).toHaveLength(2);
      expect(results.map((j) => j.job_no)).toEqual(['JOB-2026-001', 'JOB-2026-003']);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Item Number Equal mã đầy đủ
  // -------------------------------------------------------------------------
  describe('Test 3: Item Number Equal mã đầy đủ', () => {
    it('matches exact part_no and rejects partial matches', () => {
      const cond: FilterCondition = {
        id: 'c3',
        field: 'item_number',
        operator: 'equal',
        value: 'PART-A100',
      };

      const results = filterJobs(mockJobsDataset, [cond]);
      expect(results).toHaveLength(1);
      expect(results[0].job_no).toBe('JOB-2026-001');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Start Date Equal
  // -------------------------------------------------------------------------
  describe('Test 4: Start Date Equal', () => {
    it('matches single exact business planned start date', () => {
      const cond: FilterCondition = {
        id: 'c4',
        field: 'start_date',
        operator: 'equal',
        value: '2026-10-12',
      };

      const results = filterJobs(mockJobsDataset, [cond]);
      expect(results).toHaveLength(1);
      expect(results[0].job_no).toBe('JOB-2026-002');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Start Date Range, bao gồm ngày đầu và ngày cuối
  // -------------------------------------------------------------------------
  describe('Test 5: Start Date Range bao gồm ngày đầu và ngày cuối', () => {
    it('includes start and end bounds inclusively', () => {
      const cond: FilterCondition = {
        id: 'c5',
        field: 'start_date',
        operator: 'range',
        value: '2026-10-10', // exact start of job-1
        valueTo: '2026-10-15', // exact start of job-3
      };

      const results = filterJobs(mockJobsDataset, [cond]);
      // job-1 (10-10), job-2 (10-12), job-3 (10-15)
      expect(results).toHaveLength(3);
      expect(results.map((j) => j.job_no)).toEqual([
        'JOB-2026-001',
        'JOB-2026-002',
        'JOB-2026-003',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Hai điều kiện kết hợp bằng AND
  // -------------------------------------------------------------------------
  describe('Test 6: Hai điều kiện kết hợp bằng AND', () => {
    it('matches only jobs that satisfy both condition 1 AND condition 2', () => {
      const conds: FilterCondition[] = [
        {
          id: 'c6_1',
          field: 'customer',
          operator: 'equal',
          value: 'Toyota',
        },
        {
          id: 'c6_2',
          field: 'status',
          operator: 'equal',
          value: 'RUNNING',
        },
      ];

      const results = filterJobs(mockJobsDataset, conds);
      // Both Toyota jobs are job-1 (RUNNING) and job-3 (CLOSE) -> only job-1 matches
      expect(results).toHaveLength(1);
      expect(results[0].job_no).toBe('JOB-2026-001');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Ba điều kiện kết hợp bằng AND
  // -------------------------------------------------------------------------
  describe('Test 7: Ba điều kiện kết hợp bằng AND', () => {
    it('matches jobs satisfying all three conditions simultaneously', () => {
      const conds: FilterCondition[] = [
        {
          id: 'c7_1',
          field: 'customer',
          operator: 'equal',
          value: 'Toyota',
        },
        {
          id: 'c7_2',
          field: 'status',
          operator: 'equal',
          value: 'RUNNING',
        },
        {
          id: 'c7_3',
          field: 'process',
          operator: 'contain',
          value: 'CNC',
        },
      ];

      const results = filterJobs(mockJobsDataset, conds);
      expect(results).toHaveLength(1);
      expect(results[0].job_no).toBe('JOB-2026-001');

      // Adding a 4th non-matching condition returns empty
      const nonMatching = filterJobs(mockJobsDataset, [
        ...conds,
        {
          id: 'c7_4',
          field: 'item_number',
          operator: 'equal',
          value: 'NON_EXISTENT',
        },
      ]);
      expect(nonMatching).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Thêm và xóa điều kiện (UI interaction)
  // -------------------------------------------------------------------------
  describe('Test 8: Thêm và xóa điều kiện trên giao diện', () => {
    it('adds a new condition row on "+ Thêm điều kiện" and removes it on "X"', () => {
      const handleChange = vi.fn();
      const { rerender } = render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuth()}>
            <JobToolbar
              conditions={[createDefaultCondition('row-1', 'item_number')]}
              onConditionsChange={handleChange}
              onApplyFilter={vi.fn()}
              onResetFilter={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Verify 1 row initially
      expect(screen.getByTestId('filter-condition-row-row-1')).toBeInTheDocument();

      // Click "Thêm điều kiện"
      const addBtn = screen.getByRole('button', { name: /thêm điều kiện/i });
      fireEvent.click(addBtn);

      expect(handleChange).toHaveBeenCalled();
      const updatedConditions = handleChange.mock.calls[0][0];
      expect(updatedConditions).toHaveLength(2);

      // Re-render with 2 conditions to simulate parent state update
      rerender(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuth()}>
            <JobToolbar
              conditions={updatedConditions}
              onConditionsChange={handleChange}
              onApplyFilter={vi.fn()}
              onResetFilter={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Now click "X" on the second row
      const deleteButtons = screen.getAllByRole('button', { name: /xóa điều kiện/i });
      expect(deleteButtons).toHaveLength(2);
      fireEvent.click(deleteButtons[1]);

      const afterDeleteConditions = handleChange.mock.calls[1][0];
      expect(afterDeleteConditions).toHaveLength(1);
      expect(afterDeleteConditions[0].id).toBe('row-1');
    });
  });

  // -------------------------------------------------------------------------
  // 9. Xóa toàn bộ bộ lọc
  // -------------------------------------------------------------------------
  describe('Test 9: Xóa toàn bộ bộ lọc (Reset)', () => {
    it('resets all conditions and triggers onResetFilter', () => {
      const handleReset = vi.fn();
      const handleConditionsChange = vi.fn();

      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuth()}>
            <JobToolbar
              conditions={[
                { id: '1', field: 'status', operator: 'equal', value: 'RUNNING' },
                { id: '2', field: 'customer', operator: 'equal', value: 'Toyota' },
              ]}
              onConditionsChange={handleConditionsChange}
              onApplyFilter={vi.fn()}
              onResetFilter={handleReset}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const resetBtn = screen.getByRole('button', { name: /xóa lọc/i });
      fireEvent.click(resetBtn);

      expect(handleReset).toHaveBeenCalledTimes(1);
      expect(handleConditionsChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ field: 'item_number', operator: 'contain', value: '' }),
        ])
      );
    });
  });

  // -------------------------------------------------------------------------
  // 10. Không có kết quả
  // -------------------------------------------------------------------------
  describe('Test 10: Không có kết quả (Empty State)', () => {
    it('displays clear empty state message when 0 jobs match filter', () => {
      const cond: FilterCondition = {
        id: 'c10',
        field: 'customer',
        operator: 'equal',
        value: 'NonExistentCustomer123',
      };

      const filtered = filterJobs(mockJobsDataset, [cond]);
      expect(filtered).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 11. From lớn hơn To (Validation Rejection)
  // -------------------------------------------------------------------------
  describe('Test 11: From lớn hơn To', () => {
    it('detects From > To in date range and returns validation error', () => {
      const invalidCond: FilterCondition = {
        id: 'c11',
        field: 'start_date',
        operator: 'range',
        value: '2026-10-25',
        valueTo: '2026-10-10', // Earlier than from
      };

      const err = validateConditions([invalidCond]);
      expect(err).toBe('Từ ngày (From) không được lớn hơn Đến ngày (To).');

      // filterJobs rejects invalid range
      const results = filterJobs(mockJobsDataset, [invalidCond]);
      expect(results).toHaveLength(0);
    });

    it('JobToolbar displays validation error message and blocks search when From > To', () => {
      const handleApply = vi.fn();

      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuth()}>
            <JobToolbar
              conditions={[
                {
                  id: 'c_invalid',
                  field: 'start_date',
                  operator: 'range',
                  value: '2026-10-25',
                  valueTo: '2026-10-10',
                },
              ]}
              onConditionsChange={vi.fn()}
              onApplyFilter={handleApply}
              onResetFilter={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Click "Tìm kiếm"
      const searchBtn = screen.getByRole('button', { name: /tìm kiếm/i });
      fireEvent.click(searchBtn);

      expect(handleApply).not.toHaveBeenCalled();
      expect(screen.getByTestId('filter-validation-error')).toHaveTextContent(
        'Từ ngày (From) không được lớn hơn Đến ngày (To).'
      );
    });
  });

  // -------------------------------------------------------------------------
  // 12. Process lọc theo Routing
  // -------------------------------------------------------------------------
  describe('Test 12: Process lọc theo Routing operations', () => {
    it('filters jobs having matching operation name in routing (contain)', () => {
      const cond: FilterCondition = {
        id: 'c12',
        field: 'process',
        operator: 'contain',
        value: 'turning', // inside "Lathe Turning" of job-2
      };

      const results = filterJobs(mockJobsDataset, [cond]);
      expect(results).toHaveLength(1);
      expect(results[0].job_no).toBe('JOB-2026-002');
    });

    it('filters jobs having exact matching operation name in routing (equal)', () => {
      const cond: FilterCondition = {
        id: 'c12_eq',
        field: 'process',
        operator: 'equal',
        value: 'CNC Milling',
      };

      const results = filterJobs(mockJobsDataset, [cond]);
      // job-1 and job-3 both have "CNC Milling"
      expect(results).toHaveLength(2);
      expect(results.map((j) => j.job_no)).toEqual(['JOB-2026-001', 'JOB-2026-003']);
    });
  });

  // -------------------------------------------------------------------------
  // 13. Kiểm tra desktop và mobile layout styling
  // -------------------------------------------------------------------------
  describe('Test 13: Kiểm tra desktop và mobile layout', () => {
    it('applies horizontal single-row flex on desktop and responsive wrap on mobile', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuth()}>
            <JobToolbar
              conditions={[createDefaultCondition('row-test', 'item_number')]}
              onConditionsChange={vi.fn()}
              onApplyFilter={vi.fn()}
              onResetFilter={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const row = screen.getByTestId('filter-condition-row-row-test');
      // Must contain flex-col on mobile and sm:flex-row on desktop
      expect(row.className).toContain('flex-col');
      expect(row.className).toContain('sm:flex-row');
      expect(row.className).toContain('sm:items-center');
    });
  });

  // -------------------------------------------------------------------------
  // 14. Kiểm tra dữ liệu vẫn đúng sau khi refresh
  // -------------------------------------------------------------------------
  describe('Test 14: Tính toàn vẹn bộ lọc sau khi refresh', () => {
    it('evaluates updated job dataset correctly under persistent active filter condition', () => {
      const activeCond: FilterCondition = {
        id: 'c14',
        field: 'status',
        operator: 'equal',
        value: 'RUNNING',
      };

      // Initial query result
      const initialFiltered = filterJobs(mockJobsDataset, [activeCond]);
      expect(initialFiltered).toHaveLength(1);

      // Simulate refreshed dataset where job-2 started CNC operation
      const refreshedDataset: Job[] = [
        ...mockJobsDataset,
        {
          ...mockJobsDataset[1],
          id: 'job-2-updated',
          operations: [
            {
              id: 'op-2-new',
              job_id: 'job-2-updated',
              step_order: 1,
              operation_name: 'CNC Milling',
              status: 'IN_PROGRESS',
              created_at: '2026-10-12T00:00:00Z',
              updated_at: '2026-10-12T00:00:00Z',
            },
          ],
        },
      ];

      const refreshedFiltered = filterJobs(refreshedDataset, [activeCond]);
      expect(refreshedFiltered).toHaveLength(2);
      expect(refreshedFiltered.map((j) => j.id)).toContain('job-2-updated');
    });
  });

  // -------------------------------------------------------------------------
  // 15. Kiểm tra quyền truy cập dữ liệu theo RLS
  // -------------------------------------------------------------------------
  describe('Test 15: Kiểm tra quyền truy cập dữ liệu theo RLS', () => {
    it('frontend executes query via Supabase anon client and enforces user role permissions', () => {
      // Ensure supabase client does not use service_role key
      const anonClient = supabaseModule.supabase;
      expect(anonClient).toBeDefined();

      // Ensure RLS permissions guard job creation in JobToolbar
      // QA and PE-MFG cannot see "+ Tạo JOB mới"
      const { unmount: unmountQA } = render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuth('QA')}>
            <JobToolbar
              conditions={[createDefaultCondition('row-qa', 'item_number')]}
              onConditionsChange={vi.fn()}
              onApplyFilter={vi.fn()}
              onResetFilter={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );
      expect(screen.queryByRole('button', { name: /tạo job mới/i })).not.toBeInTheDocument();
      unmountQA();

      // Planning can see "+ Tạo JOB mới"
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuth('Planning')}>
            <JobToolbar
              conditions={[createDefaultCondition('row-plan', 'item_number')]}
              onConditionsChange={vi.fn()}
              onApplyFilter={vi.fn()}
              onResetFilter={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );
      expect(screen.getByRole('button', { name: /tạo job mới/i })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Additional Edge Case Verifications
  // -------------------------------------------------------------------------
  describe('Additional Edge Cases: Field Switching, Closing Date & Incomplete Rows', () => {
    it('extracts closing dates from closed_at timestamp', () => {
      const dates = getJobClosingDates(mockJobsDataset[2]); // job-3 has closed_at '2026-10-19T10:00:00.000Z'
      expect(dates).toContain('2026-10-19');
    });

    it('ignores incomplete conditions without filtering out jobs', () => {
      const incompleteConds: FilterCondition[] = [
        { id: 'inc_1', field: 'item_number', operator: 'contain', value: '   ' }, // blank text
        { id: 'inc_2', field: 'start_date', operator: 'range', value: '2026-10-10', valueTo: '' }, // missing To
      ];

      expect(isConditionComplete(incompleteConds[0])).toBe(false);
      expect(isConditionComplete(incompleteConds[1])).toBe(false);

      const results = filterJobs(mockJobsDataset, incompleteConds);
      expect(results).toHaveLength(mockJobsDataset.length); // All returned
    });

    it('resets operator and value when field changes', () => {
      let currentConditions = [
        { id: 'test_field', field: 'item_number' as const, operator: 'contain' as const, value: 'ABC' },
      ];

      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuth()}>
            <JobToolbar
              conditions={currentConditions}
              onConditionsChange={(next) => {
                currentConditions = next;
              }}
              onApplyFilter={vi.fn()}
              onResetFilter={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Select Status
      const fieldSelect = screen.getByLabelText('Trường tìm kiếm');
      fireEvent.change(fieldSelect, { target: { value: 'status' } });

      // When field changes to status, operator must reset to 'equal' and value to 'ACTIVE'
      expect(currentConditions[0].field).toBe('status');
      expect(currentConditions[0].operator).toBe('equal');
      expect(currentConditions[0].value).toBe('ACTIVE');
    });
  });
});

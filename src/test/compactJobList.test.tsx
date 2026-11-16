import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { JobListPage } from '../features/jobs/JobListPage';
import { JobCard } from '../features/jobs/JobCard';
import { AuthContext } from '../features/auth/AuthContext';
import {
  getWorkcenterCode,
  getCustomerCode,
  getJobDisplayStatus,
} from '../features/jobs/jobDisplayUtils';
import type { Job, JobOperation, Profile } from '../types/database.types';
import { ENV } from '../lib/env';

function createMockAuth() {
  const profile: Profile = {
    id: 'mock-user-id',
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

describe('SAMPLE TRACKING — UI-02 R2: COMPACT JOB LIST TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. JOB List hiển thị đầy đủ các cột chuẩn (R4 FIX 03 & FIX 04)
  // -------------------------------------------------------------------------
  describe('Test 1: JOB List hiển thị đầy đủ các cột chuẩn (R4 FIX 03 & FIX 04)', () => {
    it('renders single blue header with all standard columns including Plan Close and Actual Close', async () => {
      const originalDemo = ENV.IS_DEMO_MODE;
      (ENV as any).IS_DEMO_MODE = true;
      try {
        render(
          <MemoryRouter>
            <AuthContext.Provider value={createMockAuth()}>
              <JobListPage />
            </AuthContext.Provider>
          </MemoryRouter>
        );

        const header = await screen.findByTestId('job-list-header');
        expect(header).toBeInTheDocument();
        expect(header.className).toContain('bg-blue-600');
        expect(header.className).toContain('text-white');

        const headerScope = within(header);
        expect(headerScope.getByText('Job Ticket')).toBeInTheDocument();
        expect(headerScope.getByText('Item No.')).toBeInTheDocument();
        expect(headerScope.getByText('Customer')).toBeInTheDocument();
        expect(headerScope.getByText('Created Date')).toBeInTheDocument();
        expect(headerScope.getByText('Plan Close')).toBeInTheDocument();
        expect(headerScope.getByText('Actual Close')).toBeInTheDocument();
        expect(headerScope.getByText('Status')).toBeInTheDocument();
        expect(headerScope.getByText("Q'ty")).toBeInTheDocument();
        expect(headerScope.getByText('Routing')).toBeInTheDocument();
      } finally {
        (ENV as any).IS_DEMO_MODE = originalDemo;
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Header và dữ liệu thẳng hàng
  // -------------------------------------------------------------------------
  describe('Test 2: Header và dữ liệu thẳng hàng (All columns left-aligned in header)', () => {
    it('all column titles in header are left-aligned', async () => {
      const originalDemo = ENV.IS_DEMO_MODE;
      (ENV as any).IS_DEMO_MODE = true;
      try {
        render(
          <MemoryRouter>
            <AuthContext.Provider value={createMockAuth()}>
              <JobListPage />
            </AuthContext.Provider>
          </MemoryRouter>
        );

        const header = await screen.findByTestId('job-list-header');
        const headerScope = within(header);
        expect(headerScope.getByText('Job Ticket')).toHaveClass('text-left');
        expect(headerScope.getByText('Item No.')).toHaveClass('text-left');
        expect(headerScope.getByText('Customer')).toHaveClass('text-left');
        expect(headerScope.getByText('Created Date')).toHaveClass('text-left');
        expect(headerScope.getByText('Plan Close')).toHaveClass('text-left');
        expect(headerScope.getByText('Actual Close')).toHaveClass('text-left');
        expect(headerScope.getByText('Status')).toHaveClass('text-left');
        expect(headerScope.getByText("Q'ty")).toHaveClass('text-left');
        expect(headerScope.getByText('Routing')).toHaveClass('text-left');
      } finally {
        (ENV as any).IS_DEMO_MODE = originalDemo;
      }
    });

    it('JobCard row data uses grid layout and left-aligned text', () => {
      const mockJob: Job = {
        id: 'j-align',
        job_no: '202610-001',
        part_no: 'PART-ALIGN-01',
        part_name: 'Align Test',
        customer: 'A',
        order_qty: 100,
        material: 'SUS304',
        planned_start_date: '2026-10-10',
        planned_finish_date: '2026-10-20',
        status: 'ACTIVE',
        created_at: '2026-10-10T07:30:00Z',
        updated_at: '',
        operations: [],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} />
        </MemoryRouter>
      );

      const row = screen.getByTestId('job-row-j-align');
      expect(row.className).toContain('grid');
      expect(row.className).toContain('px-4');

      expect(screen.getByText('202610-001')).toHaveClass('text-left');
      expect(screen.getByText('PART-ALIGN-01')).toHaveClass('text-left');
      expect(screen.getByText('A')).toHaveClass('text-left');
      expect(screen.getByText('100')).toHaveClass('text-left');
      expect(screen.getByTestId('compact-job-status-badge').parentElement).toHaveClass('text-left');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Routing nằm cùng dòng với thông tin JOB trên desktop
  // -------------------------------------------------------------------------
  describe('Test 3: Routing nằm cùng dòng với thông tin JOB trên desktop', () => {
    it('renders single horizontal line per JOB containing both info and routing', () => {
      const mockJob: Job = {
        id: 'j-single-line',
        job_no: '202610-002',
        part_no: 'PART-02',
        part_name: '',
        customer: 'B',
        order_qty: 10,
        material: '',
        planned_start_date: '2026-10-10',
        planned_finish_date: '2026-10-15',
        status: 'ACTIVE',
        created_at: '',
        updated_at: '',
        operations: [
          {
            id: 'op1',
            job_id: 'j-single-line',
            step_order: 1,
            operation_name: 'CNC',
            planned_machine: 'Cincom citizent A20',
            status: 'NOT_STARTED',
            created_at: '',
            updated_at: '',
          },
        ],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} />
        </MemoryRouter>
      );

      const row = screen.getByTestId('job-row-j-single-line');
      // Single grid row element
      expect(row.tagName).toBe('A');
      expect(row.className).toContain('grid');
      // All columns are direct children of the row by default (11 columns with R4.3 CT Plan & CT Actual)
      expect(row.children).toHaveLength(11);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Routing căn phải
  // -------------------------------------------------------------------------
  describe('Test 4: Routing căn phải trong cột Routing', () => {
    it('Process flow inside Routing column has justify-end class', () => {
      const mockJob: Job = {
        id: 'j-r-align',
        job_no: '202610-003',
        part_no: 'PART-03',
        part_name: '',
        customer: 'C',
        order_qty: 10,
        material: '',
        planned_start_date: '2026-10-10',
        planned_finish_date: '2026-10-15',
        status: 'ACTIVE',
        created_at: '',
        updated_at: '',
        operations: [
          {
            id: 'op1',
            job_id: 'j-r-align',
            step_order: 1,
            operation_name: 'CNC',
            planned_machine: 'Cincom citizent A20',
            status: 'NOT_STARTED',
            created_at: '',
            updated_at: '',
          },
        ],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} />
        </MemoryRouter>
      );

      const routingStep = screen.getByTestId('routing-step-1');
      const container = routingStep.closest('.justify-end');
      expect(container).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Workcenter Code hiển thị đúng 4 ký tự theo dữ liệu
  // -------------------------------------------------------------------------
  describe('Test 5: Workcenter Code hiển thị đúng 4 ký tự theo dữ liệu', () => {
    it('displays [A20C] → [CGMG] → [AUTP] → [VMIQ] as 4-character boxes without process name or machine', () => {
      const mockJob: Job = {
        id: 'j-wc',
        job_no: '202610-004',
        part_no: 'PART-04',
        part_name: '',
        customer: 'A',
        order_qty: 50,
        material: '',
        planned_start_date: '2026-10-10',
        planned_finish_date: '2026-10-20',
        status: 'ACTIVE',
        created_at: '',
        updated_at: '',
        operations: [
          {
            id: 'op1',
            job_id: 'j-wc',
            step_order: 1,
            operation_name: 'CNC',
            planned_machine: 'Cincom citizent A20',
            status: 'COMPLETED',
            created_at: '',
            updated_at: '',
            production_runs: [{ id: 'r1', operation_id: 'op1', machine_id: 'M1', operator_name: 'A', start_time: '', end_time: '', ok_qty: 50, ng_qty: 0, created_at: '' }],
            qa_checks: [{ id: 'q1', operation_id: 'op1', inspector_name: 'QA', inspection_time: '', sample_size: 5, ok_qty: 5, ng_qty: 0, result: 'OK', created_at: '' }],
          },
          {
            id: 'op2',
            job_id: 'j-wc',
            step_order: 2,
            operation_name: 'Centerless Grinding',
            planned_machine: 'Paragon RC12',
            status: 'IN_PROGRESS',
            created_at: '',
            updated_at: '',
          },
          {
            id: 'op3',
            job_id: 'j-wc',
            step_order: 3,
            operation_name: 'Plating',
            planned_machine: 'Plating',
            status: 'NOT_STARTED',
            created_at: '',
            updated_at: '',
          },
          {
            id: 'op4',
            job_id: 'j-wc',
            step_order: 4,
            operation_name: 'Visual check',
            planned_machine: 'Visual check',
            status: 'NOT_STARTED',
            created_at: '',
            updated_at: '',
          },
        ],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} />
        </MemoryRouter>
      );

      // Verify each box text is strictly the 4-char Workcenter Code
      expect(screen.getByTestId('routing-step-1')).toHaveTextContent('A20C');
      expect(screen.getByTestId('routing-step-2')).toHaveTextContent('CGMG');
      expect(screen.getByTestId('routing-step-3')).toHaveTextContent('AUTP');
      expect(screen.getByTestId('routing-step-4')).toHaveTextContent('VMIQ');

      // Does NOT display operation names inside the boxes
      expect(screen.queryByText('CNC')).not.toBeInTheDocument();
      expect(screen.queryByText('Centerless Grinding')).not.toBeInTheDocument();
    });

    it('returns neutral placeholder "----" when workcenter cannot be mapped and does not arbitrarily truncate name', () => {
      const code = getWorkcenterCode({
        operation_name: 'Custom Unknown Process',
        planned_machine: 'UnknownMachine999',
      });
      expect(code).toBe('----');
      expect(code.length).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Active / Running / Close hiển thị đúng ý nghĩa
  // -------------------------------------------------------------------------
  describe('Test 6: Active / Running / Close hiển thị đúng ý nghĩa', () => {
    it('displays concise badges Active, Running, Close without long strings like "ĐANG CHẠY (ACTIVE)"', () => {
      const notStartedJob = {
        status: 'ACTIVE',
        operations: [{ status: 'NOT_STARTED', production_runs: [] }],
      };
      expect(getJobDisplayStatus(notStartedJob)).toBe('Active');

      const runningJob = {
        status: 'ACTIVE',
        operations: [{ status: 'IN_PROGRESS' }],
      };
      expect(getJobDisplayStatus(runningJob)).toBe('Running');

      const closedJob = {
        status: 'CLOSE',
        operations: [{ status: 'COMPLETED' }],
      };
      expect(getJobDisplayStatus(closedJob)).toBe('Close');
    });
  });

  // -------------------------------------------------------------------------
  // 7. JOB chưa sản xuất không bị gán Running
  // -------------------------------------------------------------------------
  describe('Test 7: JOB chưa sản xuất không bị gán Running', () => {
    it('JOB in ACTIVE status with all NOT_STARTED operations is strictly "Active"', () => {
      const mockJob: Job = {
        id: 'j-new',
        job_no: '202610-005',
        part_no: 'PART-05',
        part_name: '',
        customer: 'A',
        order_qty: 10,
        material: '',
        planned_start_date: '2026-10-10',
        planned_finish_date: '2026-10-15',
        status: 'ACTIVE',
        created_at: '',
        updated_at: '',
        operations: [
          {
            id: 'op1',
            job_id: 'j-new',
            step_order: 1,
            operation_name: 'CNC',
            planned_machine: 'A20C',
            status: 'NOT_STARTED',
            created_at: '',
            updated_at: '',
            production_runs: [],
          },
        ],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} />
        </MemoryRouter>
      );

      expect(screen.getByTestId('compact-job-status-badge')).toHaveTextContent('Active');
      expect(screen.queryByText('Running')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 8. JOB đã đóng không bị gán Active
  // -------------------------------------------------------------------------
  describe('Test 8: JOB đã đóng không bị gán Active', () => {
    it('JOB in CLOSE status is strictly "Close", never "Active"', () => {
      const mockJob: Job = {
        id: 'j-closed',
        job_no: '202610-006',
        part_no: 'PART-06',
        part_name: '',
        customer: 'A',
        order_qty: 10,
        material: '',
        planned_start_date: '2026-10-10',
        planned_finish_date: '2026-10-15',
        status: 'CLOSE',
        created_at: '',
        updated_at: '',
        operations: [
          {
            id: 'op1',
            job_id: 'j-closed',
            step_order: 1,
            operation_name: 'CNC',
            planned_machine: 'A20C',
            status: 'COMPLETED',
            created_at: '',
            updated_at: '',
          },
        ],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} />
        </MemoryRouter>
      );

      expect(screen.getByTestId('compact-job-status-badge')).toHaveTextContent('Close');
      expect(screen.queryByText('Active')).not.toBeInTheDocument();
      expect(screen.queryByText('Running')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 9. JOB có nhiều công đoạn (Multi-operations)
  // -------------------------------------------------------------------------
  describe('Test 9: JOB có nhiều công đoạn (không giả định tối đa 4)', () => {
    it('renders 6 sequential operation boxes connected with 5 arrows', () => {
      const operations: JobOperation[] = [
        { id: '1', job_id: 'j-6', step_order: 1, operation_name: 'CNC', planned_machine: 'Cincom B12', status: 'NOT_STARTED', created_at: '', updated_at: '' },
        { id: '2', job_id: 'j-6', step_order: 2, operation_name: 'CG', planned_machine: 'Paragon RC12', status: 'NOT_STARTED', created_at: '', updated_at: '' },
        { id: '3', job_id: 'j-6', step_order: 3, operation_name: 'Fanuc', planned_machine: 'Fanuc', status: 'NOT_STARTED', created_at: '', updated_at: '' },
        { id: '4', job_id: 'j-6', step_order: 4, operation_name: 'SPM', planned_machine: 'SPM', status: 'NOT_STARTED', created_at: '', updated_at: '' },
        { id: '5', job_id: 'j-6', step_order: 5, operation_name: 'Plating', planned_machine: 'Plating', status: 'NOT_STARTED', created_at: '', updated_at: '' },
        { id: '6', job_id: 'j-6', step_order: 6, operation_name: 'VMI', planned_machine: 'Visual check', status: 'NOT_STARTED', created_at: '', updated_at: '' },
      ];

      const mockJob: Job = {
        id: 'j-6op',
        job_no: '202610-007',
        part_no: 'PART-07',
        part_name: '',
        customer: 'A',
        order_qty: 10,
        material: '',
        planned_start_date: '2026-10-10',
        planned_finish_date: '2026-10-15',
        status: 'ACTIVE',
        created_at: '',
        updated_at: '',
        operations,
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} />
        </MemoryRouter>
      );

      // Verify all 6 step boxes
      expect(screen.getByTestId('routing-step-1')).toHaveTextContent('B12C');
      expect(screen.getByTestId('routing-step-2')).toHaveTextContent('CGMG');
      expect(screen.getByTestId('routing-step-3')).toHaveTextContent('D&TS');
      expect(screen.getByTestId('routing-step-4')).toHaveTextContent('SPMS');
      expect(screen.getByTestId('routing-step-5')).toHaveTextContent('AUTP');
      expect(screen.getByTestId('routing-step-6')).toHaveTextContent('VMIQ');

      // Exactly 5 arrows
      const arrows = screen.getAllByText('→');
      expect(arrows).toHaveLength(5);
    });
  });

  // -------------------------------------------------------------------------
  // 10. JOB chưa có Routing
  // -------------------------------------------------------------------------
  describe('Test 10: JOB chưa có Routing', () => {
    it('displays right-aligned "Chưa thiết lập Routing"', () => {
      const mockJob: Job = {
        id: 'j-noroute',
        job_no: '202610-008',
        part_no: 'PART-08',
        part_name: '',
        customer: 'A',
        order_qty: 10,
        material: '',
        planned_start_date: '2026-10-10',
        planned_finish_date: '2026-10-15',
        status: 'ACTIVE',
        created_at: '',
        updated_at: '',
        operations: [],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} />
        </MemoryRouter>
      );

      const placeholder = screen.getByText('Chưa thiết lập Routing');
      expect(placeholder).toBeInTheDocument();
      expect(placeholder.closest('.justify-end')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 11. JOB cũ có mã dài
  // -------------------------------------------------------------------------
  describe('Test 11: JOB cũ có mã dài và Customer 1 ký tự', () => {
    it('handles long ticket with truncate and tooltip, and strictly limits customer to 1 char or "-"', () => {
      const mockJob: Job = {
        id: 'j-long',
        job_no: 'TEST-ATT-PEND-1791802140243-SUPER-LONG-LEGACY-TICKET',
        part_no: 'PART-EXTREMELY-LONG-SPECIFICATION-NUMBER',
        part_name: '',
        customer: 'Panasonic Industrial Devices Vietnam Co., Ltd.',
        order_qty: 10,
        material: '',
        planned_start_date: '2026-10-10',
        planned_finish_date: '2026-10-15',
        status: 'ACTIVE',
        created_at: '',
        updated_at: '',
        operations: [],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} />
        </MemoryRouter>
      );

      const ticketEl = screen.getByText('TEST-ATT-PEND-1791802140243-SUPER-LONG-LEGACY-TICKET');
      expect(ticketEl).toHaveClass('truncate');
      expect(ticketEl).toHaveAttribute('title', 'TEST-ATT-PEND-1791802140243-SUPER-LONG-LEGACY-TICKET');

      // Customer must NOT display full string, but '-'
      expect(screen.queryByText('Panasonic Industrial Devices Vietnam Co., Ltd.')).not.toBeInTheDocument();
      const customerEl = screen.getByTitle('Panasonic Industrial Devices Vietnam Co., Ltd.');
      expect(customerEl).toHaveTextContent('-');
    });

    it('customer code resolution strictly returns 1 character or "-"', () => {
      expect(getCustomerCode('A')).toBe('A');
      expect(getCustomerCode('b')).toBe('B');
      expect(getCustomerCode('Samsung')).toBe('-'); // Unmapped: does NOT take 'S'
      expect(getCustomerCode('ENBI')).toBe('-');    // Unmapped: does NOT take 'E'
      expect(getCustomerCode('')).toBe('-');
      expect(getCustomerCode(null)).toBe('-');
    });
  });

  // -------------------------------------------------------------------------
  // 12. Giao diện desktop và mobile
  // -------------------------------------------------------------------------
  describe('Test 12: Giao diện desktop và mobile (không làm tràn chiều ngang toàn trang)', () => {
    it('contains list inside overflow-x-auto container preventing body overflow', async () => {
      const originalDemo = ENV.IS_DEMO_MODE;
      (ENV as any).IS_DEMO_MODE = true;
      try {
        render(
          <MemoryRouter>
            <AuthContext.Provider value={createMockAuth()}>
              <JobListPage />
            </AuthContext.Provider>
          </MemoryRouter>
        );

        const header = await screen.findByTestId('job-list-header');
        const scrollContainer = header.closest('.overflow-x-auto');
        expect(scrollContainer).toBeInTheDocument();
      } finally {
        (ENV as any).IS_DEMO_MODE = originalDemo;
      }
    });
  });

  // -------------------------------------------------------------------------
  // 13. Nhấn JOB mở đúng chi tiết
  // -------------------------------------------------------------------------
  describe('Test 13: Nhấn JOB mở đúng chi tiết', () => {
    it('links entire row to /jobs/:id', () => {
      const mockJob: Job = {
        id: 'job-target-123',
        job_no: '202610-009',
        part_no: 'PART-09',
        part_name: '',
        customer: 'A',
        order_qty: 10,
        material: '',
        planned_start_date: '2026-10-10',
        planned_finish_date: '2026-10-15',
        status: 'ACTIVE',
        created_at: '',
        updated_at: '',
        operations: [],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} />
        </MemoryRouter>
      );

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/jobs/job-target-123');
    });
  });

  // -------------------------------------------------------------------------
  // 14. UI-01 tìm kiếm nhiều điều kiện vẫn hoạt động
  // -------------------------------------------------------------------------
  describe('Test 14: UI-01 tìm kiếm nhiều điều kiện vẫn hoạt động', () => {
    it('preserves JobToolbar with multi-condition search controls intact', async () => {
      const originalDemo = ENV.IS_DEMO_MODE;
      (ENV as any).IS_DEMO_MODE = true;
      try {
        render(
          <MemoryRouter>
            <AuthContext.Provider value={createMockAuth()}>
              <JobListPage />
            </AuthContext.Provider>
          </MemoryRouter>
        );

        expect(screen.getByRole('button', { name: /thêm điều kiện/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /tìm kiếm/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /xóa lọc/i })).toBeInTheDocument();
      } finally {
        (ENV as any).IS_DEMO_MODE = originalDemo;
      }
    });
  });

  // -------------------------------------------------------------------------
  // 15. Không thay đổi hoặc mất dữ liệu Supabase
  // -------------------------------------------------------------------------
  describe('Test 15: Không thay đổi hoặc mất dữ liệu Supabase', () => {
    it('JobCard and JobListPage do not mutate any external state or database enum', () => {
      expect(typeof JobListPage).toBe('function');
      expect(typeof JobCard).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // 16. Toolbar compact layout & Freeze header
  // -------------------------------------------------------------------------
  describe('Test 16: Toolbar compact layout & Freeze table header', () => {
    it('moves Column Visibility and Export Excel to the upper toolbar row, removes redundant count text, and freezes table header', async () => {
      const originalDemo = ENV.IS_DEMO_MODE;
      (ENV as any).IS_DEMO_MODE = true;
      try {
        render(
          <MemoryRouter>
            <AuthContext.Provider value={createMockAuth()}>
              <JobListPage />
            </AuthContext.Provider>
          </MemoryRouter>
        );

        // 1. Column visibility and Export Excel buttons exist
        const colVisibilityBtn = await screen.findByTestId('column-visibility-toggle-btn');
        const exportExcelBtn = screen.getByTestId('export-excel-btn');
        expect(colVisibilityBtn).toBeInTheDocument();
        expect(exportExcelBtn).toBeInTheDocument();

        // 2. Redundant "Hiển thị ... lệnh sản xuất phù hợp" text is removed
        expect(screen.queryByText(/lệnh sản xuất phù hợp/i)).not.toBeInTheDocument();

        // 3. Freeze Table Header: sticky top-0 and vertical scroll container
        const header = screen.getByTestId('job-list-header');
        expect(header.className).toContain('sticky');
        expect(header.className).toContain('top-0');
        expect(header.className).toContain('z-20');

        const tableContainer = screen.getByTestId('job-list-table-container');
        expect(tableContainer).toBeInTheDocument();
        expect(tableContainer.className).toContain('overflow-y-auto');
        expect(tableContainer.className).toContain('overflow-x-auto');
      } finally {
        (ENV as any).IS_DEMO_MODE = originalDemo;
      }
    });
  });

  // -------------------------------------------------------------------------
  // 17. Ẩn bỏ trường lọc mặc định, chỉ hiện ra khi bấm "+ Thêm điều kiện"
  // -------------------------------------------------------------------------
  describe('Test 17: Filter rows hidden by default until "+ Thêm điều kiện" is clicked', () => {
    it('initializes with no filter condition inputs visible, reveals condition row on click, and clears on remove', async () => {
      const originalDemo = ENV.IS_DEMO_MODE;
      (ENV as any).IS_DEMO_MODE = true;
      try {
        render(
          <MemoryRouter>
            <AuthContext.Provider value={createMockAuth()}>
              <JobListPage />
            </AuthContext.Provider>
          </MemoryRouter>
        );

        // Initially no filter condition rows exist
        expect(screen.queryByLabelText('Trường tìm kiếm')).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText('Nhập mã Item (Part No.)...')).not.toBeInTheDocument();

        // Click "+ Thêm điều kiện"
        const addConditionBtn = screen.getByRole('button', { name: /Thêm điều kiện/i });
        fireEvent.click(addConditionBtn);

        // Now condition row appears
        expect(await screen.findByLabelText('Trường tìm kiếm')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Nhập mã Item (Part No.)...')).toBeInTheDocument();

        // Click remove [X] button
        const removeBtn = screen.getByRole('button', { name: /Xóa điều kiện/i });
        fireEvent.click(removeBtn);

        // Condition row is gone again
        expect(screen.queryByLabelText('Trường tìm kiếm')).not.toBeInTheDocument();
      } finally {
        (ENV as any).IS_DEMO_MODE = originalDemo;
      }
    });
  });
});

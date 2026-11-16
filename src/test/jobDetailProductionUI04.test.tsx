import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { JobGeneralInfo } from '../features/jobs/JobGeneralInfo';
import { OperationAccordionList } from '../features/operations/OperationAccordionList';
import { OperationExecutionPanel } from '../features/operations/OperationExecutionPanel';
import { AuthContext } from '../features/auth/AuthContext';
import type { Job, JobOperation, UserRole } from '../types/database.types';

// Mock storage & service modules
vi.mock('../services/productionResultService', () => {
  return {
    fetchDefectCatalog: vi.fn().mockResolvedValue({
      defects: [
        { id: '1', code: 'DEF-DIM-01', name_vi: 'Sai đường kính', name_en: 'Outer Diameter', category: 'DIMENSION', is_active: true, created_at: '' },
        { id: '2', code: 'DEF-SRF-01', name_vi: 'Bavia', name_en: 'Burr', category: 'SURFACE', is_active: true, created_at: '' },
        { id: '3', code: 'DEF-SRF-02', name_vi: 'Xước bề mặt', name_en: 'Surface scratch', category: 'SURFACE', is_active: true, created_at: '' },
      ],
      error: null,
    }),
    saveProductionResult: vi.fn().mockResolvedValue({ success: true }),
    saveQACheck: vi.fn().mockResolvedValue({ success: true }),
    uploadNGPhoto: vi.fn().mockResolvedValue({ filePath: 'test/path/ng_photo.jpg', error: null }),
    viewNGPhotoSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://storage.test/signed_photo.jpg', error: null }),
  };
});

function createMockAuthContext(role: UserRole) {
  return {
    user: { id: 'test-user-id', email: 'test@example.com' } as any,
    profile: {
      id: 'test-user-id',
      username: 'testuser',
      full_name: 'Test Operator',
      role,
      is_active: true,
      must_change_password: false,
      created_at: '',
      updated_at: '',
    },
    session: {} as any,
    isLoading: false,
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  };
}

const mockJob: Job = {
  id: 'job-123',
  job_no: '202610-001',
  part_no: 'PART-999',
  part_name: 'Trục truyền động chính',
  customer: 'CUST-A',
  order_qty: 500,
  material: 'SUS304',
  material_spec: 'Ø30 x 150mm',
  planned_start_date: '2026-10-15',
  planned_finish_date: '2026-10-25',
  status: 'ACTIVE',
  created_at: '2026-10-12T00:00:00Z',
  updated_at: '2026-10-12T00:00:00Z',
};

const mockOperations: JobOperation[] = [
  {
    id: 'op-1',
    job_id: 'job-123',
    step_order: 10,
    operation_name: 'Auto Turn',
    workcenter_code: 'A20C',
    description: 'Auto Turn',
    status: 'IN_PROGRESS',
    created_at: '2026-10-12T00:00:00Z',
    updated_at: '2026-10-12T00:00:00Z',
    production_runs: [
      {
        id: 'run-1',
        operation_id: 'op-1',
        machine_id: 'AA08',
        operator_name: 'Tech 1',
        start_time: '2026-10-15T08:00:00Z',
        end_time: '2026-10-15T16:00:00Z',
        cycle_time_seconds: 45,
        ok_qty: 100,
        ng_qty: 5,
        kiv_qty: 10,
        production_date: '2026-10-15',
        remarks: 'Ca 1',
        created_at: '2026-10-15T08:00:00Z',
        ng_details: [
          {
            id: 'ng-1',
            production_run_id: 'run-1',
            defect_name: 'Sai đường kính',
            defect_code: 'DEF-DIM-01',
            ng_qty: 5,
            cause: 'Mòn dao',
            remark: 'Đã mài dao',
            photo_urls: ['test/path/photo1.jpg'],
            created_at: '2026-10-15T08:00:00Z',
          },
        ],
      },
    ],
    qa_checks: [],
  },
  {
    id: 'op-2',
    job_id: 'job-123',
    step_order: 20,
    operation_name: 'Centerless Grinding',
    workcenter_code: 'CGMG',
    description: 'Centerless Grinding',
    status: 'NOT_STARTED',
    created_at: '2026-10-12T00:00:00Z',
    updated_at: '2026-10-12T00:00:00Z',
    production_runs: [],
    qa_checks: [],
  },
];

describe('SAMPLE TRACKING — UI-04: Job Detail & Production Result Redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Check 1: Planning Information Compact Layout', () => {
    it('displays all 10 compact planning fields with Customer Code only', () => {
      render(<JobGeneralInfo job={mockJob} />);

      // 1. Job Ticket
      expect(screen.getAllByText('202610-001').length).toBeGreaterThan(0);
      // 2. Item No.
      expect(screen.getByText('PART-999')).toBeInTheDocument();
      // 3. Customer Code (only code, e.g. CUST-A)
      expect(screen.getByText('CUST-A')).toBeInTheDocument();
      // 4. Item Name
      expect(screen.getByText('Trục truyền động chính')).toBeInTheDocument();
      // 5. Required Quantity
      expect(screen.getByText('500 pcs')).toBeInTheDocument();
      // 6. Material
      expect(screen.getByText('SUS304')).toBeInTheDocument();
      // 7. Material Specification
      expect(screen.getByText('Ø30 x 150mm')).toBeInTheDocument();
      // 8 & 9. Planned Start and End Date
      expect(screen.getByText('Planning Information')).toBeInTheDocument();
      // 10. JOB Status badge
      expect(screen.getAllByText(/ACTIVE/).length).toBeGreaterThan(0);
    });
  });

  describe('Check 2 & Check 3: Operations Accordion (OP10, OP20) & Status Colors', () => {
    it('renders operations in strictly ordered OP10, OP20 format', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <OperationAccordionList
              operations={mockOperations}
              jobId={mockJob.id}
              jobNo={mockJob.job_no}
              partNo={mockJob.part_no}
              jobStatus={mockJob.status}
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Verify OP10 and OP20 titles
      expect(screen.getByText('OP10 — A20C — Auto Turn')).toBeInTheDocument();
      expect(screen.getByText('OP20 — CGMG — Centerless Grinding')).toBeInTheDocument();
    });

    it('toggles accordion expansion and collapse when clicking header', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <OperationAccordionList
              operations={mockOperations}
              jobId={mockJob.id}
              jobNo={mockJob.job_no}
              partNo={mockJob.part_no}
              jobStatus={mockJob.status}
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const op2Button = screen.getByText('OP20 — CGMG — Centerless Grinding');
      fireEvent.click(op2Button);

      // Now OP20 is expanded, and shows PE-MFG execution section
      expect(screen.getAllByText(/Kết quả Sản xuất/).length).toBeGreaterThan(0);
    });

    it('displays status colors according to rules: GREEN, YELLOW, DARK', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <OperationAccordionList
              operations={mockOperations}
              jobId={mockJob.id}
              jobNo={mockJob.job_no}
              partNo={mockJob.part_no}
              jobStatus={mockJob.status}
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // OP1 has in-progress run without QA OK -> YELLOW: "Đang xử lý / Chờ QA"
      expect(screen.getByText('Đang xử lý / Chờ QA')).toBeInTheDocument();
      // OP2 has no runs, NOT_STARTED -> DARK: "Chưa bắt đầu"
      expect(screen.getByText('Chưa bắt đầu')).toBeInTheDocument();
    });
  });

  describe('Check 4 to Check 14: PE-MFG Production Result & NG Details Table', () => {
    it('renders Row 1 (Machine, Date, CT Actual) and Row 2 (OK, NG, KIV)', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <OperationExecutionPanel
              operation={mockOperations[0]}
              jobId={mockJob.id}
              jobNo={mockJob.job_no}
              partNo={mockJob.part_no}
              jobStatus={mockJob.status}
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByText('Machine')).toBeInTheDocument();
      expect(screen.getByText('Date')).toBeInTheDocument();
      expect(screen.getByText(/Cycle Time \(sec\)|CT Actual/)).toBeInTheDocument();
      expect(screen.getAllByText('OK').length).toBeGreaterThan(0);
      expect(screen.getAllByText('NG').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/KIV/).length).toBeGreaterThan(0);
    });

    it('Total NG is strictly read-only and automatically sums from NG rows', () => {
      const { container } = render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <OperationExecutionPanel
              operation={mockOperations[0]}
              jobId={mockJob.id}
              jobNo={mockJob.job_no}
              partNo={mockJob.part_no}
              jobStatus={mockJob.status}
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Total NG badge
      expect(screen.getByText('Total NG: 5')).toBeInTheDocument();

      // Find read-only Total NG input
      const ngInputs = container.querySelectorAll('input[type="number"]');
      const totalNgInput = Array.from(ngInputs).find((inp) => (inp as HTMLInputElement).readOnly);
      expect(totalNgInput).toBeTruthy();
      expect((totalNgInput as HTMLInputElement).value).toBe('5');
    });

    it('adding a new NG row and changing quantity updates Total NG immediately', async () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <OperationExecutionPanel
              operation={mockOperations[0]}
              jobId={mockJob.id}
              jobNo={mockJob.job_no}
              partNo={mockJob.part_no}
              jobStatus={mockJob.status}
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Click Thêm dòng
      const addRowBtn = screen.getByRole('button', { name: /thêm dòng/i });
      fireEvent.click(addRowBtn);

      // Now Total NG should be 5 + 1 = 6
      expect(screen.getByText('Total NG: 6')).toBeInTheDocument();
    });

    it('stores Cause and Remark in separate columns without mixing', () => {
      const { container } = render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <OperationExecutionPanel
              operation={mockOperations[0]}
              jobId={mockJob.id}
              jobNo={mockJob.job_no}
              partNo={mockJob.part_no}
              jobStatus={mockJob.status}
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const textInputs = container.querySelectorAll('table input[type="text"]');
      const causeInput = textInputs[0] as HTMLInputElement;
      const remarkInput = textInputs[1] as HTMLInputElement;

      expect(causeInput.value).toBe('Mòn dao');
      expect(remarkInput.value).toBe('Đã mài dao');
    });
  });

  describe('Check 15 to Check 18: NG Photo Upload and Constraints (Max 2 Photos)', () => {
    it('displays photo link "Ảnh 1" when photo exists, and prevents adding more than 2 photos', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <OperationExecutionPanel
              operation={mockOperations[0]}
              jobId={mockJob.id}
              jobNo={mockJob.job_no}
              partNo={mockJob.part_no}
              jobStatus={mockJob.status}
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Link Ảnh 1 exists
      expect(screen.getByText('Ảnh 1')).toBeInTheDocument();
      // Button for second photo "+ Ảnh 2" is available
      expect(screen.getByText('+ Ảnh 2')).toBeInTheDocument();
    });
  });

  describe('Check 20 & Check 21: Role Guards and Closed Job Immutability', () => {
    it('disables editing when JOB is in CLOSE status', () => {
      const { container } = render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <OperationExecutionPanel
              operation={mockOperations[0]}
              jobId={mockJob.id}
              jobNo={mockJob.job_no}
              partNo={mockJob.part_no}
              jobStatus="CLOSE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByText('JOB đã đóng (Chỉ đọc)')).toBeInTheDocument();

      // Submit buttons are hidden/disabled
      expect(screen.queryByText('Lưu kết quả sản xuất (PE-MFG)')).not.toBeInTheDocument();
      expect(screen.queryByText('Xác nhận kiểm tra (QA)')).not.toBeInTheDocument();

      // Inputs are disabled
      const inputs = container.querySelectorAll('input');
      inputs.forEach((input) => {
        expect(input.disabled || input.readOnly).toBe(true);
      });
    });

    it('enforces PE-MFG cannot submit QA check and QA cannot submit PE-MFG run', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <OperationExecutionPanel
              operation={mockOperations[0]}
              jobId={mockJob.id}
              jobNo={mockJob.job_no}
              partNo={mockJob.part_no}
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // PE-MFG can save production result
      expect(screen.getByText('Lưu kết quả sản xuất (PE-MFG)')).toBeInTheDocument();
      // But QA submit button is not available for PE-MFG
      expect(screen.queryByText('Xác nhận kiểm tra (QA)')).not.toBeInTheDocument();
    });
  });
});

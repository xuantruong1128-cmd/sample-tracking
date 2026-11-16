import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { permissions } from '../features/auth/authUtils';
import { formatVietnamCreationDate } from '../features/jobs/jobDisplayUtils';
import { NumericInput } from '../components/common/NumericInput';
import { JobGeneralInfo } from '../features/jobs/JobGeneralInfo';
import { JobCard } from '../features/jobs/JobCard';
import { JobListPage } from '../features/jobs/JobListPage';
import { AuthContext } from '../features/auth/AuthContext';
import { isAllowedQADocMime, QA_DOCUMENT_CATEGORIES } from '../services/qaDocumentService';
import type { Job, Profile, UserRole } from '../types/database.types';
import { ENV } from '../lib/env';

function createMockAuthContext(role: UserRole = 'Planning', isLeader = false) {
  const profile: Profile = {
    id: 'mock-user-uuid',
    phone: '+84912345678',
    full_name: 'Test User',
    role,
    department: 'Planning',
    is_department_leader: isLeader,
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

describe('SAMPLE TRACKING — PRODUCTION UX & PERMISSION R1 TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // R1-01: PLANNING EDIT PERMISSIONS & IMMUTABILITY
  // =========================================================================
  describe('R1-01: Planning Edit Permissions & Lockout', () => {
    const unstartedJob: Job = {
      id: 'job-unstarted',
      job_no: '202610-001',
      part_no: 'PART-001',
      customer: 'A',
      order_qty: 50,
      material: 'SUS304',
      planned_start_date: '2026-10-10',
      planned_finish_date: '2026-10-20',
      status: 'ACTIVE',
      created_at: '2026-10-10T07:30:00Z',
      updated_at: '',
      operations: [
        {
          id: 'op-1',
          job_id: 'job-unstarted',
          step_order: 10,
          operation_name: 'CNC',
          status: 'NOT_STARTED',
          created_at: '',
          updated_at: '',
        },
      ],
    };

    const closedOpJob: Job = {
      ...unstartedJob,
      id: 'job-locked',
      operations: [
        {
          id: 'op-1',
          job_id: 'job-locked',
          step_order: 10,
          operation_name: 'CNC',
          status: 'CLOSED',
          created_at: '',
          updated_at: '',
        },
      ],
    };

    it('allows Planner, Planning Leader, and Admin to edit Planning when no operation is closed', () => {
      expect(permissions.canEditJobPlanning(unstartedJob, 'Planning')).toBe(true);
      expect(permissions.canEditJobPlanning(unstartedJob, 'Admin')).toBe(true);
      expect(permissions.canEditJobPlanning(unstartedJob, 'PE-MFG')).toBe(false);
      expect(permissions.canEditJobPlanning(unstartedJob, 'QA')).toBe(false);
      expect(permissions.canEditJobPlanning(unstartedJob, 'Viewer')).toBe(false);
    });

    it('locks Planning edits as soon as any operation has been CLOSED', () => {
      expect(permissions.canEditJobPlanning(closedOpJob, 'Planning')).toBe(false);
      expect(permissions.canEditJobPlanning(closedOpJob, 'Admin')).toBe(false);
      expect(permissions.canEditJobPlanning(closedOpJob, 'Viewer')).toBe(false);
    });

    it('JobGeneralInfo displays "Chỉnh sửa Kế hoạch" button when editable and hides when locked', () => {
      const handleEdit = vi.fn();
      const { rerender } = render(
        <JobGeneralInfo
          job={unstartedJob}
          isPlanningLocked={false}
          canEdit={true}
          onEditClick={handleEdit}
        />
      );

      const editBtn = screen.getByTestId('edit-planning-button');
      expect(editBtn).toBeInTheDocument();
      fireEvent.click(editBtn);
      expect(handleEdit).toHaveBeenCalledTimes(1);

      // Rerender when locked
      rerender(
        <JobGeneralInfo
          job={closedOpJob}
          isPlanningLocked={true}
          canEdit={false}
          onEditClick={handleEdit}
        />
      );

      expect(screen.queryByTestId('edit-planning-button')).not.toBeInTheDocument();
      expect(screen.getByText(/Planning & Routing: Đã khóa/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // R1-02: QA DOCUMENT UPLOAD PERMISSIONS & VALIDATION
  // =========================================================================
  describe('R1-02: QA Document Upload Rules & Format Support', () => {
    it('verifies QA and Admin are authorized to upload QA docs while Viewer is denied', () => {
      expect(permissions.canUploadQaDocuments('QA')).toBe(true);
      expect(permissions.canUploadQaDocuments('Admin')).toBe(true);
      expect(permissions.canUploadQaDocuments('Viewer')).toBe(false);
    });

    it('validates supported file formats: PDF, XLSX, XLS, CSV, JPG, PNG, WEBP', () => {
      expect(isAllowedQADocMime('application/pdf', 'report.pdf')).toBe(true);
      expect(isAllowedQADocMime('application/vnd.ms-excel', 'data.xls')).toBe(true);
      expect(
        isAllowedQADocMime(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'data.xlsx'
        )
      ).toBe(true);
      expect(isAllowedQADocMime('text/csv', 'measurements.csv')).toBe(true);
      expect(isAllowedQADocMime('image/jpeg', 'defect.jpg')).toBe(true);
      expect(isAllowedQADocMime('image/png', 'defect.png')).toBe(true);
      expect(isAllowedQADocMime('image/webp', 'defect.webp')).toBe(true);

      // Rejects unsupported formats
      expect(isAllowedQADocMime('application/x-msdownload', 'malware.exe')).toBe(false);
      expect(isAllowedQADocMime('application/zip', 'archive.zip')).toBe(false);
    });

    it('provides all 5 required QA document categories', () => {
      const values = QA_DOCUMENT_CATEGORIES.map((c) => c.value);
      expect(values).toContain('Inspection Report');
      expect(values).toContain('CPK/SPC');
      expect(values).toContain('NG Photos');
      expect(values).toContain('Measurement Results');
      expect(values).toContain('Other');
    });
  });

  // =========================================================================
  // R1-03: NUMERIC INPUT USABILITY
  // =========================================================================
  describe('R1-03: Numeric Input Usability on Mobile & Desktop', () => {
    it('has inputMode="numeric" and selects text on focus', () => {
      const handleChange = vi.fn();
      render(
        <NumericInput
          value={120}
          onChange={handleChange}
          data-testid="test-numeric-input"
        />
      );

      const input = screen.getByTestId('test-numeric-input') as HTMLInputElement;
      expect(input.getAttribute('inputmode')).toBe('numeric');
      expect(input.value).toBe('120');

      // Focus should trigger select
      const selectSpy = vi.spyOn(input, 'select');
      fireEvent.focus(input);
      expect(selectSpy).toHaveBeenCalled();
    });

    function ControlledInput({ initial = 10, onChange, ...rest }: any) {
      const [val, setVal] = React.useState(initial);
      return (
        <NumericInput
          value={val}
          onChange={(newVal) => {
            setVal(newVal);
            onChange?.(newVal);
          }}
          {...rest}
        />
      );
    }

    it('allows clearing input completely during editing without forcing zero immediately', () => {
      const handleChange = vi.fn();
      render(
        <ControlledInput
          initial={10}
          onChange={handleChange}
          data-testid="test-numeric-clear"
        />
      );

      const input = screen.getByTestId('test-numeric-clear') as HTMLInputElement;
      fireEvent.focus(input);

      // User backspaces everything
      fireEvent.change(input, { target: { value: '' } });
      expect(input.value).toBe('');
      // Propagates 0 to parent so auto-sum updates without breaking
      expect(handleChange).toHaveBeenCalledWith(0);

      // User types 8
      fireEvent.change(input, { target: { value: '8' } });
      expect(input.value).toBe('8');
      expect(handleChange).toHaveBeenCalledWith(8);

      // On blur, value is cleanly preserved
      fireEvent.blur(input);
      expect(input.value).toBe('8');
    });

    it('normalizes empty input or leading zeros cleanly on blur', () => {
      const handleChange = vi.fn();
      render(
        <ControlledInput
          initial={5}
          min={1}
          onChange={handleChange}
          data-testid="test-numeric-blur"
        />
      );

      const input = screen.getByTestId('test-numeric-blur') as HTMLInputElement;
      fireEvent.focus(input);

      // Type leading zero '05'
      fireEvent.change(input, { target: { value: '05' } });
      fireEvent.blur(input);

      // Normalized to 5 (not '05')
      expect(input.value).toBe('5');
      expect(handleChange).toHaveBeenLastCalledWith(5);
    });
  });

  // =========================================================================
  // R1-04: VIEWER ROLE ENFORCEMENT
  // =========================================================================
  describe('R1-04: Viewer Role Security & Read-Only Enforcements', () => {
    it('recognizes Viewer role and blocks all mutation actions', () => {
      expect(permissions.isViewer('Viewer')).toBe(true);
      expect(permissions.isViewer('Planning')).toBe(false);
      expect(permissions.isViewer('Admin')).toBe(false);

      // Viewer cannot perform any privileged operations
      expect(permissions.canCreateJob('Viewer')).toBe(false);
      expect(permissions.canCloseJob('Viewer', false)).toBe(false);
      expect(permissions.canCloseJob('Viewer', true)).toBe(false);
      expect(permissions.canCloseOperation('Viewer', false)).toBe(false);
      expect(permissions.canReviewKiv('Viewer', false)).toBe(false);
      expect(permissions.canManageUsers('Viewer')).toBe(false);
      expect(permissions.canUploadSamplePhotos('Viewer')).toBe(false);
      expect(permissions.canUploadQaDocuments('Viewer')).toBe(false);
      expect(permissions.canUploadEngineeringDocuments('Viewer')).toBe(false);
      expect(permissions.canReviewPeEngineering('Viewer')).toBe(false);
      expect(permissions.canDeleteJob({ created_by: 'some-id', status: 'ACTIVE' }, { role: 'Viewer' } as any)).toBe(false);

      // Viewer CAN view final reports and download files
      expect(permissions.canViewFinalReport('Viewer')).toBe(true);
    });
  });

  // =========================================================================
  // R1-05: COMPACT JOB LIST 7-COLUMN LAYOUT
  // =========================================================================
  describe('R1-05: Compact JOB List 7-Column Layout & Timezone', () => {
    it('formats database timestamp into Vietnam local time (Asia/Ho_Chi_Minh)', () => {
      // 2026-10-16T07:30:00Z -> In UTC+7 (Vietnam), this is 14:30 16/10/2026
      const formatted = formatVietnamCreationDate('2026-10-16T07:30:00Z');
      expect(formatted).toContain('16/10/2026');
      expect(formatted).toContain('14:30');
    });

    it('renders header with standard columns including Plan Close and Actual Close (R4 FIX 03 & FIX 04)', async () => {
      const originalDemo = ENV.IS_DEMO_MODE;
      (ENV as any).IS_DEMO_MODE = true;
      try {
        render(
          <MemoryRouter>
            <AuthContext.Provider value={createMockAuthContext('Viewer')}>
              <JobListPage />
            </AuthContext.Provider>
          </MemoryRouter>
        );

        const header = await screen.findByTestId('job-list-header');
        expect(header).toBeInTheDocument();

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

    it('JobCard renders matching columns with DD/MM/YY date and order quantity', () => {
      const mockJob: Job = {
        id: 'job-7-col',
        job_no: '202610-099',
        part_no: 'PART-7COL',
        customer: 'C',
        order_qty: 2500,
        material: 'SUS304',
        planned_start_date: '2026-10-10',
        planned_finish_date: '2026-10-20',
        status: 'ACTIVE',
        created_at: '2026-10-16T07:30:00Z',
        updated_at: '',
        operations: [],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} />
        </MemoryRouter>
      );

      const row = screen.getByTestId('job-row-job-7-col');
      expect(row).toBeInTheDocument();
      // All columns are direct children of the row by default (11 columns with R4.3 CT Plan & CT Actual)
      expect(row.children).toHaveLength(11);

      expect(screen.getByText('202610-099')).toBeInTheDocument();
      expect(screen.getByText('PART-7COL')).toBeInTheDocument();
      expect(screen.getByText('C')).toBeInTheDocument();
      expect(screen.getByText('16/10/26')).toBeInTheDocument(); // R4 FIX 03: DD/MM/YY without time
      expect(screen.getByText('20/10/26')).toBeInTheDocument(); // Plan Close
      expect(screen.getByText('2500')).toBeInTheDocument(); // R4.2: Plain integer without thousands separator
    });
  });
});

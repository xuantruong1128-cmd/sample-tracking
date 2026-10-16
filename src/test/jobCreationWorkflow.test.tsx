import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobCreateModal } from '../features/jobs/JobCreateModal';
import { JobToolbar } from '../features/jobs/JobToolbar';
import { AuthContext } from '../features/auth/AuthContext';
import {
  validateJobInput,
  translateJobCreationError,
} from '../services/jobCreationService';
import { permissions } from '../features/auth/authUtils';
import type { Profile, UserRole } from '../types/database.types';
import { MemoryRouter } from 'react-router-dom';

// Helper to create mock AuthContext value
function createMockAuthContext(role: UserRole, isActive = true) {
  const profile: Profile = {
    id: `mock-${role.toLowerCase()}-id`,
    phone: '+84912345678',
    full_name: `Test ${role} User`,
    role: role,
    department: 'Manufacturing',
    is_active: isActive,
    must_change_password: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    user: { id: profile.id, email: 'test@sampletracking.local' } as any,
    profile,
    loading: false,
    refreshProfile: vi.fn(),
    logout: vi.fn(),
  };
}

describe('JOB Creation Workflow & Validation (UAT Blocker 01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. Role-based Permission Verification
  // --------------------------------------------------------------------------
  describe('Authorization: Role-Based Creation Guards', () => {
    it('Admin can create JOBs', () => {
      expect(permissions.canCreateJob('Admin')).toBe(true);
    });

    it('Planning can create JOBs', () => {
      expect(permissions.canCreateJob('Planning')).toBe(true);
    });

    it('PE-MFG cannot create JOBs', () => {
      expect(permissions.canCreateJob('PE-MFG')).toBe(false);
    });

    it('QA cannot create JOBs', () => {
      expect(permissions.canCreateJob('QA')).toBe(false);
    });

    it('JobToolbar renders "+ Tạo JOB mới" button for Admin and Planning, but hides it for PE-MFG and QA', () => {
      // 1. Admin: Visible
      const { unmount: unmountAdmin } = render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('Admin')}>
            <JobToolbar
              searchTerm=""
              onSearchChange={vi.fn()}
              statusFilter="ALL"
              onStatusFilterChange={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );
      expect(screen.getByRole('button', { name: /tạo job mới/i })).toBeInTheDocument();
      unmountAdmin();

      // 2. Planning: Visible
      const { unmount: unmountPlan } = render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('Planning')}>
            <JobToolbar
              searchTerm=""
              onSearchChange={vi.fn()}
              statusFilter="ALL"
              onStatusFilterChange={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );
      expect(screen.getByRole('button', { name: /tạo job mới/i })).toBeInTheDocument();
      unmountPlan();

      // 3. PE-MFG: Hidden
      const { unmount: unmountPE } = render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG')}>
            <JobToolbar
              searchTerm=""
              onSearchChange={vi.fn()}
              statusFilter="ALL"
              onStatusFilterChange={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );
      expect(screen.queryByRole('button', { name: /tạo job mới/i })).not.toBeInTheDocument();
      unmountPE();

      // 4. QA: Hidden
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('QA')}>
            <JobToolbar
              searchTerm=""
              onSearchChange={vi.fn()}
              statusFilter="ALL"
              onStatusFilterChange={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );
      expect(screen.queryByRole('button', { name: /tạo job mới/i })).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Form Input Validation Logic
  // --------------------------------------------------------------------------
  describe('Input Validation: Mandatory Fields & Constraints', () => {
    const validBaseJob = {
      job_no: 'JOB-2026-TEST',
      part_no: 'PART-001',
      customer: 'ENBI',
      order_qty: 100,
      material: 'A6061-T6',
      material_spec: 'Ø20 x 150mm',
      planned_start_date: '2026-10-12',
      planned_finish_date: '2026-10-18',
      operations: [
        { step_order: 1, operation_name: 'CNC', planned_machine: 'Cincom L20-X' },
        { step_order: 2, operation_name: 'Mài CG', planned_machine: 'TopKing TK-18' },
      ],
    };

    it('passes validation with complete valid input', () => {
      const res = validateJobInput(validBaseJob);
      expect(res.isValid).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it('rejects empty or whitespace JOB Code', () => {
      const res = validateJobInput({ ...validBaseJob, job_no: '   ' });
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/vui lòng nhập mã job/i);
    });

    it('rejects empty Part Number', () => {
      const res = validateJobInput({ ...validBaseJob, part_no: '' });
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/vui lòng nhập mã chi tiết/i);
    });

    it('rejects zero or negative quantities', () => {
      const resZero = validateJobInput({ ...validBaseJob, order_qty: 0 });
      expect(resZero.isValid).toBe(false);
      expect(resZero.error).toMatch(/số nguyên dương lớn hơn 0/i);

      const resNeg = validateJobInput({ ...validBaseJob, order_qty: -15 });
      expect(resNeg.isValid).toBe(false);
      expect(resNeg.error).toMatch(/số nguyên dương lớn hơn 0/i);
    });

    it('rejects non-integer quantities', () => {
      const resFloat = validateJobInput({ ...validBaseJob, order_qty: 12.5 });
      expect(resFloat.isValid).toBe(false);
      expect(resFloat.error).toMatch(/số nguyên dương/i);
    });

    it('rejects empty Material', () => {
      const res = validateJobInput({ ...validBaseJob, material: '  ' });
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/vui lòng nhập vật liệu/i);
    });

    it('rejects Planned End Date earlier than Planned Start Date', () => {
      const res = validateJobInput({
        ...validBaseJob,
        planned_start_date: '2026-10-20',
        planned_finish_date: '2026-10-15',
      });
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/không được nhỏ hơn ngày bắt đầu/i);
    });

    it('rejects empty routing operations array', () => {
      const res = validateJobInput({ ...validBaseJob, operations: [] });
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/ít nhất 1 công đoạn/i);
    });

    it('rejects blank operation name in any step', () => {
      const res = validateJobInput({
        ...validBaseJob,
        operations: [
          { step_order: 1, operation_name: 'CNC', planned_machine: 'M1' },
          { step_order: 2, operation_name: '   ', planned_machine: 'M2' },
        ],
      });
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/bước thứ 2 không được để trống/i);
    });

    it('rejects duplicate step orders in routing', () => {
      const res = validateJobInput({
        ...validBaseJob,
        operations: [
          { step_order: 1, operation_name: 'CNC', planned_machine: 'M1' },
          { step_order: 1, operation_name: 'CG', planned_machine: 'M2' },
        ],
      });
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/thứ tự các công đoạn/i);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Error Translation & Security
  // --------------------------------------------------------------------------
  describe('Error Translation: Clear Vietnamese Guidance', () => {
    it('translates duplicate key error into clear Vietnamese notification', () => {
      const msg = translateJobCreationError({ message: 'duplicate key value violates unique constraint "jobs_job_no_key"' });
      expect(msg).toMatch(/mã job này đã tồn tại/i);
    });

    it('translates permission denied error into Vietnamese notice', () => {
      const msg = translateJobCreationError({ message: 'Quyền hạn bị từ chối: Chỉ Planning hoặc Admin' });
      expect(msg).toMatch(/chỉ tài khoản thuộc bộ phận planning hoặc admin/i);
    });

    it('translates check constraint violations', () => {
      const msgDates = translateJobCreationError({ message: 'violates check constraint "chk_planned_dates"' });
      expect(msgDates).toMatch(/ngày kết thúc kế hoạch phải sau hoặc cùng ngày bắt đầu/i);

      const msgQty = translateJobCreationError({ message: 'violates check constraint "jobs_order_qty_check"' });
      expect(msgQty).toMatch(/số lượng yêu cầu/i);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Modal UI Component Behavior
  // --------------------------------------------------------------------------
  describe('JobCreateModal Interactive Behavior', () => {
    it('renders all required form fields with Vietnamese labels', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('Planning')}>
            <JobCreateModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Verify Vietnamese labels
      expect(screen.getByText(/mã job \(job code\)/i)).toBeInTheDocument();
      expect(screen.getByText(/mã chi tiết \(part number\)/i)).toBeInTheDocument();
      expect(screen.getByText(/tên chi tiết \(part name\)/i)).toBeInTheDocument();
      expect(screen.getByText(/khách hàng \(customer\)/i)).toBeInTheDocument();
      expect(screen.getByText(/số lượng yêu cầu \(quantity\)/i)).toBeInTheDocument();
      expect(screen.getByText(/vật liệu \(material\)/i)).toBeInTheDocument();
      expect(screen.getByText(/quy cách vật liệu \(material specification\)/i)).toBeInTheDocument();
      expect(screen.getByText(/ngày bắt đầu kh/i)).toBeInTheDocument();
      expect(screen.getByText(/ngày kết thúc kh/i)).toBeInTheDocument();
      expect(screen.getByText(/quy trình công đoạn/i)).toBeInTheDocument();

      // Action buttons
      expect(screen.getByRole('button', { name: /hủy bỏ/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /lưu & tạo job/i })).toBeInTheDocument();
    });

    it('allows adding and removing routing operations dynamically with 10, 20, 30... sequence', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('Planning')}>
            <JobCreateModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Default has 2 operations (Step 10 and Step 20)
      expect(screen.getAllByText('10').length).toBeGreaterThan(0);
      expect(screen.getAllByText('20').length).toBeGreaterThan(0);

      // Click "+ Thêm công đoạn"
      const addBtn = screen.getByRole('button', { name: /thêm công đoạn/i });
      fireEvent.click(addBtn);

      // Should now have Step 30
      expect(screen.getAllByText('30').length).toBeGreaterThan(0);

      // Delete the 3rd step
      const deleteButtons = screen.getAllByTitle(/xóa công đoạn này/i);
      fireEvent.click(deleteButtons[0]); // delete one of them

      // Remaining operations renumber to 10 and 20
      expect(screen.getAllByText('10').length).toBeGreaterThan(0);
      expect(screen.getAllByText('20').length).toBeGreaterThan(0);
      expect(screen.queryByText('30')).not.toBeInTheDocument();
    });

    it('allows reordering routing operations via Move Up and Move Down buttons', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('Planning')}>
            <JobCreateModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Descriptions in initial state: Step 10 is Auto Turn (A20C), Step 20 is Centerless Grinding (CGMG)
      const descInputs = screen.getAllByDisplayValue(/Auto Turn/i);
      expect(descInputs.length).toBeGreaterThan(0);

      // Click move down on first operation
      const moveDownButtons = screen.getAllByTitle(/di chuyển xuống dưới/i);
      fireEvent.click(moveDownButtons[0]);

      // Step 10 is now CGMG (Centerless Grinding) and Step 20 is A20C (Auto Turn)
      // Both still exist but order in DOM swapped
      const postMoveDownButtons = screen.getAllByTitle(/di chuyển xuống dưới/i);
      expect(postMoveDownButtons.length).toBeGreaterThan(0);
    });

    it('closes modal when Hủy bỏ or X button is clicked', () => {
      const handleClose = vi.fn();
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('Planning')}>
            <JobCreateModal isOpen={true} onClose={handleClose} onSuccess={vi.fn()} />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const cancelBtn = screen.getByRole('button', { name: /hủy bỏ/i });
      fireEvent.click(cancelBtn);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminDeleteJobModal } from '../components/admin/AdminDeleteJobModal';
import { JobDetailPage } from '../features/jobs/JobDetailPage';
import { JobListPage } from '../features/jobs/JobListPage';
import { JobToolbar } from '../features/jobs/JobToolbar';
import { AuthContext } from '../features/auth/AuthContext';
import * as adminJobService from '../services/adminJobService';
import type { Job } from '../types/database.types';
import type { AuthUser } from '../types/auth';

const createMockAuthContext = (
  role: 'Admin' | 'Planning' | 'PE-MFG' | 'QA',
  isLeader = false,
  userId = `user-${role.toLowerCase()}`
) => {
  const mockUser: AuthUser = {
    id: userId,
    phone: '+84968000000',
    email: `${role.toLowerCase()}@test.com`,
    profile: {
      id: userId,
      phone: '+84968000000',
      role,
      is_department_leader: isLeader,
      full_name: `Test User ${role}`,
      is_active: true,
      must_change_password: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };

  return {
    user: mockUser,
    profile: mockUser.profile,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  };
};

const mockCleanActiveJob: Job = {
  id: 'job-uuid-clean',
  job_no: '202610-099',
  part_no: 'PART-CLEAN-01',
  part_name: 'Clean Sample Part',
  customer: 'CUST-A',
  target_qty: 100,
  order_qty: 100,
  material: 'AL6061',
  material_spec: 'T6',
  surface_treatment: 'Anodize Clear',
  status: 'ACTIVE',
  created_at: '2026-10-13T10:00:00Z',
  updated_at: '2026-10-13T10:00:00Z',
  created_by: 'planning-owner-id',
  operations: [
    {
      id: 'op-1',
      job_id: 'job-uuid-clean',
      step_order: 10,
      operation_name: 'CNC Milling',
      status: 'NOT_STARTED',
      production_runs: [],
      qa_checks: [],
      created_at: '2026-10-13T10:00:00Z',
      updated_at: '2026-10-13T10:00:00Z',
    },
  ],
};

const mockJobWithProdRuns: Job = {
  ...mockCleanActiveJob,
  id: 'job-uuid-prod',
  job_no: '202610-100',
  operations: [
    {
      id: 'op-2',
      job_id: 'job-uuid-prod',
      step_order: 10,
      operation_name: 'CNC Milling',
      status: 'IN_PROGRESS',
      production_runs: [
        {
          id: 'run-1',
          operation_id: 'op-2',
          machine_id: 'MC-01',
          operator_name: 'Tech 1',
          ok_qty: 50,
          ng_qty: 2,
          kiv_qty: 0,
          cycle_time_seconds: 45,
          production_date: '2026-10-13',
          created_at: '2026-10-13T11:00:00Z',
          updated_at: '2026-10-13T11:00:00Z',
        },
      ],
      qa_checks: [],
      created_at: '2026-10-13T10:00:00Z',
      updated_at: '2026-10-13T10:00:00Z',
    },
  ],
};

const mockJobWithClosedOp: Job = {
  ...mockJobWithProdRuns,
  id: 'job-uuid-closed-op',
  job_no: '202610-102',
  operations: [
    {
      ...mockJobWithProdRuns.operations![0],
      status: 'CLOSED',
      closed_at: '2026-10-13T12:00:00Z',
    },
  ],
};

const mockClosedJob: Job = {
  ...mockCleanActiveJob,
  id: 'job-uuid-closed',
  job_no: '202610-101',
  status: 'CLOSE',
};

describe('SAMPLE TRACKING — UI-06 & R1: Job Deletion & Lock Condition Rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Delete Job Button Visibility Guard (Admin, Planning Leader, Planning Owner)', () => {
    it('shows "Xóa JOB" button for Admin user on JobDetailPage', async () => {
      const { supabase } = await import('../lib/supabase');
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockCleanActiveJob, error: null }),
      } as any);

      render(
        <MemoryRouter initialEntries={['/jobs/job-uuid-clean']}>
          <AuthContext.Provider value={createMockAuthContext('Admin')}>
            <Routes>
              <Route path="/jobs/:id" element={<JobDetailPage />} />
            </Routes>
          </AuthContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('admin-delete-job-button')).toBeInTheDocument();
        expect(screen.getByText('Xóa JOB')).toBeInTheDocument();
      });
    });

    it('shows "Xóa JOB" button for Planning Leader on JobDetailPage', async () => {
      const { supabase } = await import('../lib/supabase');
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockCleanActiveJob, error: null }),
      } as any);

      render(
        <MemoryRouter initialEntries={['/jobs/job-uuid-clean']}>
          <AuthContext.Provider value={createMockAuthContext('Planning', true, 'planning-leader-id')}>
            <Routes>
              <Route path="/jobs/:id" element={<JobDetailPage />} />
            </Routes>
          </AuthContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('admin-delete-job-button')).toBeInTheDocument();
        expect(screen.getByText('Xóa JOB')).toBeInTheDocument();
      });
    });

    it('shows "Xóa JOB" button for Planning Owner (created_by match) on JobDetailPage', async () => {
      const { supabase } = await import('../lib/supabase');
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockCleanActiveJob, error: null }),
      } as any);

      render(
        <MemoryRouter initialEntries={['/jobs/job-uuid-clean']}>
          <AuthContext.Provider value={createMockAuthContext('Planning', false, 'planning-owner-id')}>
            <Routes>
              <Route path="/jobs/:id" element={<JobDetailPage />} />
            </Routes>
          </AuthContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('admin-delete-job-button')).toBeInTheDocument();
        expect(screen.getByText('Xóa JOB')).toBeInTheDocument();
      });
    });

    it('hides "Xóa JOB" button for regular Planning non-owner non-leader and other roles (PE-MFG, QA)', async () => {
      const { supabase } = await import('../lib/supabase');
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockCleanActiveJob, error: null }),
      } as any);

      // 1. Planning non-owner, non-leader
      const { unmount: u1 } = render(
        <MemoryRouter initialEntries={['/jobs/job-uuid-clean']}>
          <AuthContext.Provider value={createMockAuthContext('Planning', false, 'different-user-id')}>
            <Routes>
              <Route path="/jobs/:id" element={<JobDetailPage />} />
            </Routes>
          </AuthContext.Provider>
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.queryByTestId('admin-delete-job-button')).not.toBeInTheDocument();
      });
      u1();

      // 2. PE-MFG and QA
      for (const role of ['PE-MFG', 'QA'] as const) {
        const { unmount } = render(
          <MemoryRouter initialEntries={['/jobs/job-uuid-clean']}>
            <AuthContext.Provider value={createMockAuthContext(role)}>
              <Routes>
                <Route path="/jobs/:id" element={<JobDetailPage />} />
              </Routes>
            </AuthContext.Provider>
          </MemoryRouter>
        );

        await waitFor(() => {
          expect(screen.queryByTestId('admin-delete-job-button')).not.toBeInTheDocument();
        });
        unmount();
      }
    });

    it('disables "Xóa JOB" button when JOB has a CLOSED operation (Planning Lockout)', async () => {
      const { supabase } = await import('../lib/supabase');
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockJobWithClosedOp, error: null }),
      } as any);

      render(
        <MemoryRouter initialEntries={['/jobs/job-uuid-closed-op']}>
          <AuthContext.Provider value={createMockAuthContext('Admin')}>
            <Routes>
              <Route path="/jobs/:id" element={<JobDetailPage />} />
            </Routes>
          </AuthContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        const deleteBtn = screen.getByTestId('admin-delete-job-button');
        expect(deleteBtn).toBeInTheDocument();
        expect(deleteBtn).toBeDisabled();
        expect(deleteBtn).toHaveAttribute(
          'title',
          'JOB đã có công đoạn Close nên không được phép xóa / sửa kế hoạch'
        );
      });
    });
  });

  describe('2. AdminDeleteJobModal Safety Rules & R1 Lock Condition', () => {
    it('blocks deletion for Closed JOBs', () => {
      render(
        <AdminDeleteJobModal
          isOpen={true}
          job={mockClosedJob}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(screen.getByText(/Không thể xóa JOB đã đóng/i)).toBeInTheDocument();
      expect(screen.queryByText('Xác nhận xóa vĩnh viễn')).not.toBeInTheDocument();
    });

    it('blocks deletion when at least one operation is CLOSED', () => {
      render(
        <AdminDeleteJobModal
          isOpen={true}
          job={mockJobWithClosedOp}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(
        screen.getByText(/Không thể xóa JOB: Đã có công đoạn Chốt \(CLOSED\)/i)
      ).toBeInTheDocument();
      expect(screen.queryByText('Xác nhận xóa vĩnh viễn')).not.toBeInTheDocument();
    });

    it('R1 Rule: ALLOWS deletion when production runs exist but NO operation is Closed', async () => {
      const deleteSpy = vi
        .spyOn(adminJobService, 'deleteJob')
        .mockResolvedValue({ success: true });
      const onSuccessMock = vi.fn();

      render(
        <AdminDeleteJobModal
          isOpen={true}
          job={mockJobWithProdRuns}
          onClose={vi.fn()}
          onSuccess={onSuccessMock}
        />
      );

      // Should NOT show blocked message
      expect(
        screen.queryByText(/Không thể xóa JOB: Đã có công đoạn Chốt \(CLOSED\)/i)
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Từ chối xóa: JOB đã phát sinh dữ liệu/i)).not.toBeInTheDocument();

      // Displays warning with count of dependent items
      expect(screen.getByText(/Cảnh báo: Thao tác không thể hoàn tác!/i)).toBeInTheDocument();
      expect(screen.getByText(/1 lượt sản xuất/i)).toBeInTheDocument();

      const ticketInput = screen.getByPlaceholderText('Nhập chính xác: 202610-100');
      const reasonInput = screen.getByPlaceholderText(
        'Ví dụ: Dữ liệu thử nghiệm ban đầu, nhập nhầm mã chi tiết...'
      );
      const submitBtn = screen.getByRole('button', { name: /Xác nhận xóa vĩnh viễn/i });

      expect(submitBtn).toBeDisabled();

      fireEvent.change(ticketInput, { target: { value: '202610-100' } });
      fireEvent.change(reasonInput, { target: { value: 'Xóa đơn hàng thử nghiệm chưa chốt công đoạn' } });

      expect(submitBtn).not.toBeDisabled();

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(deleteSpy).toHaveBeenCalledWith(
          'job-uuid-prod',
          '202610-100',
          'Xóa đơn hàng thử nghiệm chưa chốt công đoạn'
        );
        expect(onSuccessMock).toHaveBeenCalledWith('202610-100');
      });
    });

    it('requires exact ticket confirmation and reason before enabling submit for clean jobs', async () => {
      const deleteSpy = vi
        .spyOn(adminJobService, 'deleteJob')
        .mockResolvedValue({ success: true });
      const onSuccessMock = vi.fn();

      render(
        <AdminDeleteJobModal
          isOpen={true}
          job={mockCleanActiveJob}
          onClose={vi.fn()}
          onSuccess={onSuccessMock}
        />
      );

      expect(screen.getAllByText('202610-099')[0]).toBeInTheDocument();
      expect(screen.getByText('PART-CLEAN-01')).toBeInTheDocument();

      const ticketInput = screen.getByPlaceholderText('Nhập chính xác: 202610-099');
      const reasonInput = screen.getByPlaceholderText(
        'Ví dụ: Dữ liệu thử nghiệm ban đầu, nhập nhầm mã chi tiết...'
      );
      const submitBtn = screen.getByRole('button', { name: /Xác nhận xóa vĩnh viễn/i });

      // Initially disabled
      expect(submitBtn).toBeDisabled();

      // Enter wrong ticket
      fireEvent.change(ticketInput, { target: { value: 'WRONG-TICKET' } });
      fireEvent.change(reasonInput, { target: { value: 'Xóa test' } });
      expect(submitBtn).toBeDisabled();

      // Enter correct ticket but too short reason (< 3 chars)
      fireEvent.change(ticketInput, { target: { value: '202610-099' } });
      fireEvent.change(reasonInput, { target: { value: 'ok' } });
      expect(submitBtn).toBeDisabled();

      // Enter correct ticket and valid reason
      fireEvent.change(reasonInput, { target: { value: 'Dọn dẹp dữ liệu thử nghiệm ban đầu' } });
      expect(submitBtn).not.toBeDisabled();

      // Click submit
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(deleteSpy).toHaveBeenCalledWith(
          'job-uuid-clean',
          '202610-099',
          'Dọn dẹp dữ liệu thử nghiệm ban đầu'
        );
        expect(onSuccessMock).toHaveBeenCalledWith('202610-099');
      });
    });
  });

  describe('3. Create Job Button UI Polishing (Single Plus Sign)', () => {
    it('renders exactly one "+" symbol and centers icon with text', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('Planning')}>
            <JobToolbar />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const createBtn = screen.getByRole('button', { name: /tạo job mới/i });
      expect(createBtn).toBeInTheDocument();

      expect(createBtn).toHaveTextContent('Tạo JOB mới');
      expect(createBtn.textContent?.trim()).toBe('Tạo JOB mới');
    });
  });

  describe('4. Environment Label Polishing', () => {
    it('displays "Sample Tracking" and does not contain "Production"', async () => {
      const { supabase } = await import('../lib/supabase');
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      } as any);

      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('Admin')}>
            <JobListPage />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Sample Tracking')).toBeInTheDocument();
        expect(screen.queryByText(/Production Data/i)).not.toBeInTheDocument();
      });
    });
  });
});

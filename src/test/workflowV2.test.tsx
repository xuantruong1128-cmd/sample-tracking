import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OperationExecutionPanel } from '../features/operations/OperationExecutionPanel';
import { JobDetailPage } from '../features/jobs/JobDetailPage';
import { AuthContext } from '../features/auth/AuthContext';
import { permissions } from '../features/auth/authUtils';
import * as prodService from '../services/productionResultService';
import type { Job, JobOperation } from '../types/database.types';
import type { AuthUser } from '../types/auth';

const createMockAuthContext = (
  role: 'Admin' | 'Planning' | 'PE-MFG' | 'QA',
  isLeader: boolean = false
) => {
  const mockUser: AuthUser = {
    id: `user-${role.toLowerCase()}-${isLeader ? 'leader' : 'staff'}`,
    phone: '+84968000000',
    email: `${role.toLowerCase()}@test.com`,
    profile: {
      id: `user-${role.toLowerCase()}-${isLeader ? 'leader' : 'staff'}`,
      phone: '+84968000000',
      role,
      full_name: `${role} ${isLeader ? 'Leader' : 'Staff'}`,
      is_department_leader: isLeader,
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

const mockOpenOp: JobOperation = {
  id: 'op-open-1',
  job_id: 'job-1',
  step_order: 10,
  operation_name: 'CNC Milling',
  workcenter_code: 'CNC01',
  planned_machine: 'AA08',
  machine_no: 'AA08',
  status: 'IN_PROGRESS',
  created_at: '2026-10-13T10:00:00Z',
  updated_at: '2026-10-13T10:00:00Z',
  production_runs: [
    {
      id: 'run-1',
      operation_id: 'op-open-1',
      job_id: 'job-1',
      machine_id: 'AA08',
      production_date: '2026-10-13',
      cycle_time_seconds: 45,
      ok_qty: 90,
      kiv_qty: 8,
      created_at: '2026-10-13T10:00:00Z',
      updated_at: '2026-10-13T10:00:00Z',
      ng_details: [
        {
          id: 'ng-1',
          production_run_id: 'run-1',
          ng_qty: 2,
          defect_name: 'Sai kích thước',
          defect_code: 'DEF-DIM-01',
          cause: 'Mòn dao phay',
          remark: 'Cần thay dao',
          photo_urls: [],
          created_at: '2026-10-13T10:00:00Z',
        },
      ],
    },
  ],
  qa_checks: [
    {
      id: 'qa-1',
      operation_id: 'op-open-1',
      job_id: 'job-1',
      inspector_id: 'qa-user',
      sample_size: 5,
      ok_qty: 5,
      ng_qty: 0,
      result: 'OK',
      notes: 'Đạt kích thước dung sai',
      inspection_time: '2026-10-13T11:00:00Z',
      created_at: '2026-10-13T11:00:00Z',
    },
  ],
};

const mockClosedOp: JobOperation = {
  ...mockOpenOp,
  id: 'op-closed-1',
  status: 'CLOSED',
  closed_at: '2026-10-13T12:00:00Z',
  closed_by: 'user-pe-leader',
  closed_snapshot: {
    closed_by_name: 'PE-MFG Leader',
    closed_at: '2026-10-13T12:00:00Z',
    baseline_ok: 90,
    baseline_ng: 2,
    baseline_kiv: 8,
    machine_id: 'AA08',
    production_date: '2026-10-13',
  },
};

describe('SAMPLE TRACKING — WORKFLOW V2 TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(prodService, 'fetchDefectCatalog').mockResolvedValue({
      defects: [
        { id: '1', code: 'DEF-DIM-01', name_vi: 'Sai kích thước', category: 'Kích thước', is_active: true },
        { id: '2', code: 'DEF-SURF-01', name_vi: 'Xước bề mặt', category: 'Ngoại quan', is_active: true },
      ],
    });
    vi.spyOn(prodService, 'fetchKivReviews').mockResolvedValue({
      data: [
        {
          id: 'rev-1',
          operation_id: 'op-closed-1',
          job_id: 'job-1',
          reviewed_by: 'pe-leader-id',
          reviewed_by_name: 'Trần Văn PE Leader',
          kiv_to_ok: 5,
          kiv_to_ng: 1,
          kiv_remaining: 2,
          review_reason: '5 con đạt sau khi đánh bóng, 1 con vỡ phế phẩm',
          ng_details_snapshot: [{ defect_name: 'Xước bề mặt', ng_qty: 1 }],
          created_at: '2026-10-13T13:00:00Z',
        },
      ],
    });
  });

  describe('1. Role & Permission Guards', () => {
    it('canCloseOperation: strictly allows only PE-MFG Leader or Admin', () => {
      expect(permissions.canCloseOperation('Admin')).toBe(true);
      expect(permissions.canCloseOperation('PE-MFG', true)).toBe(true);
      expect(permissions.canCloseOperation('PE-MFG', false)).toBe(false);
      expect(permissions.canCloseOperation('Planning', true)).toBe(false);
      expect(permissions.canCloseOperation('QA', true)).toBe(false);
    });

    it('canReviewKiv: strictly allows only PE-MFG Leader or Admin', () => {
      expect(permissions.canReviewKiv('Admin')).toBe(true);
      expect(permissions.canReviewKiv('PE-MFG', true)).toBe(true);
      expect(permissions.canReviewKiv('PE-MFG', false)).toBe(false);
      expect(permissions.canReviewKiv('QA', true)).toBe(false);
    });

    it('canCloseJob: strictly allows only PE-MFG Leader or Admin', () => {
      expect(permissions.canCloseJob('Admin')).toBe(true);
      expect(permissions.canCloseJob('PE-MFG', true)).toBe(true);
      expect(permissions.canCloseJob('PE-MFG', false)).toBe(false);
      expect(permissions.canCloseJob('Planning', true)).toBe(false);
    });
  });

  describe('2. Operation Execution & Close Operation Behavior', () => {
    it('hides "Chốt công đoạn" button for regular PE-MFG staff and displays it for PE-MFG Leader', () => {
      // 1. Staff view
      const staffAuth = createMockAuthContext('PE-MFG', false);
      const { rerender } = render(
        <AuthContext.Provider value={staffAuth as any}>
          <OperationExecutionPanel
            operation={mockOpenOp}
            jobId="job-1"
            jobNo="202610-001"
            partNo="PART-01"
            jobStatus="ACTIVE"
            onRefresh={vi.fn()}
          />
        </AuthContext.Provider>
      );
      expect(screen.queryByText(/Chốt công đoạn \(Close Operation\)/i)).not.toBeInTheDocument();

      // 2. Leader view
      const leaderAuth = createMockAuthContext('PE-MFG', true);
      rerender(
        <AuthContext.Provider value={leaderAuth as any}>
          <OperationExecutionPanel
            operation={mockOpenOp}
            jobId="job-1"
            jobNo="202610-001"
            partNo="PART-01"
            jobStatus="ACTIVE"
            onRefresh={vi.fn()}
          />
        </AuthContext.Provider>
      );
      expect(screen.getByText(/Chốt công đoạn \(Close Operation\)/i)).toBeInTheDocument();
    });

    it('opens Close Operation confirmation modal and shows snapshot preview and consequence warning', async () => {
      const leaderAuth = createMockAuthContext('PE-MFG', true);
      render(
        <AuthContext.Provider value={leaderAuth as any}>
          <OperationExecutionPanel
            operation={mockOpenOp}
            jobId="job-1"
            jobNo="202610-001"
            partNo="PART-01"
            jobStatus="ACTIVE"
            onRefresh={vi.fn()}
          />
        </AuthContext.Provider>
      );

      fireEvent.click(screen.getByText(/Chốt công đoạn \(Close Operation\)/i));

      expect(screen.getByText(/Xác nhận Chốt công đoạn \(OP10\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Sản lượng chốt gốc \(Snapshot Baseline\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Hệ quả bắt buộc sau khi Chốt công đoạn:/i)).toBeInTheDocument();
      expect(screen.getByText(/Planning Information và Routing công đoạn/i)).toBeInTheDocument();
    });

    it('calls closeJobOperation RPC when user confirms close operation', async () => {
      const mockCloseRpc = vi.spyOn(prodService, 'closeJobOperation').mockResolvedValue({ success: true });
      const onRefreshMock = vi.fn();
      const leaderAuth = createMockAuthContext('PE-MFG', true);

      render(
        <AuthContext.Provider value={leaderAuth as any}>
          <OperationExecutionPanel
            operation={mockOpenOp}
            jobId="job-1"
            jobNo="202610-001"
            partNo="PART-01"
            jobStatus="ACTIVE"
            onRefresh={onRefreshMock}
          />
        </AuthContext.Provider>
      );

      fireEvent.click(screen.getByText(/Chốt công đoạn \(Close Operation\)/i));
      fireEvent.click(screen.getByRole('button', { name: /Xác nhận Chốt công đoạn/i }));

      await waitFor(() => {
        expect(mockCloseRpc).toHaveBeenCalledWith('op-open-1');
        expect(onRefreshMock).toHaveBeenCalled();
      });
    });
  });

  describe('3. Post-Close Operation & KIV Review Section', () => {
    it('displays CLOSED badge, baseline snapshot banner, and KIV Review section when operation is CLOSED', async () => {
      const leaderAuth = createMockAuthContext('PE-MFG', true);
      render(
        <AuthContext.Provider value={leaderAuth as any}>
          <OperationExecutionPanel
            operation={mockClosedOp}
            jobId="job-1"
            jobNo="202610-001"
            partNo="PART-01"
            jobStatus="ACTIVE"
            onRefresh={vi.fn()}
          />
        </AuthContext.Provider>
      );

      expect(screen.getByText(/Đã chốt công đoạn \(CLOSED\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Công đoạn đã được Chốt sản lượng/i)).toBeInTheDocument();
      expect(screen.getByText(/Đánh giá & Chuyển đổi KIV \(KIV Review\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Lịch sử Đánh giá KIV/i)).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByText(/Trần Văn PE Leader/i)).toBeInTheDocument();
      });
    });

    it('validates and submits KIV review transfer with reason and defect details for KIV -> NG', async () => {
      const mockReviewRpc = vi.spyOn(prodService, 'reviewKivTransfer').mockResolvedValue({ success: true });
      const onRefreshMock = vi.fn();
      const leaderAuth = createMockAuthContext('PE-MFG', true);

      render(
        <AuthContext.Provider value={leaderAuth as any}>
          <OperationExecutionPanel
            operation={mockClosedOp}
            jobId="job-1"
            jobNo="202610-001"
            partNo="PART-01"
            jobStatus="ACTIVE"
            onRefresh={onRefreshMock}
          />
        </AuthContext.Provider>
      );

      // Input KIV to OK = 4
      const kivToOkInput = screen.getByLabelText(/Chuyển KIV sang OK/i);
      fireEvent.change(kivToOkInput, { target: { value: '4' } });

      // Input KIV to NG = 2
      const kivToNgInput = screen.getByLabelText(/Chuyển KIV sang NG/i);
      fireEvent.change(kivToNgInput, { target: { value: '2' } });

      // Input reason
      const reasonInput = screen.getByPlaceholderText(/Ví dụ: Đã gia công lại đạt kích thước dung sai/i);
      fireEvent.change(reasonInput, { target: { value: 'Đã hoàn thiện kiểm định lần 2' } });

      // Submit KIV Review
      const submitBtn = screen.getByRole('button', { name: /Xác nhận Chuyển đổi KIV/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockReviewRpc).toHaveBeenCalledWith({
          operationId: 'op-closed-1',
          kivToOk: 4,
          kivToNg: 2,
          reason: 'Đã hoàn thiện kiểm định lần 2',
          ngItems: expect.arrayContaining([
            expect.objectContaining({ ng_qty: 2 }),
          ]),
        });
      });
    });
  });

  describe('4. Close JOB (Option B) Modal & Planning Lockout', () => {
    const mockActiveJobWithUnclosedOp: Job = {
      id: 'job-uuid-1',
      job_no: '202610-001',
      part_no: 'PART-A',
      part_name: 'Part A',
      customer: 'Customer 1',
      target_qty: 100,
      order_qty: 100,
      material: 'AL6061',
      material_spec: 'T6',
      surface_treatment: 'None',
      status: 'ACTIVE',
      created_at: '2026-10-13T10:00:00Z',
      updated_at: '2026-10-13T10:00:00Z',
      created_by: 'plan-id',
      operations: [mockOpenOp], // Still IN_PROGRESS
    };

    const mockActiveJobAllOpsClosedWithKiv: Job = {
      ...mockActiveJobWithUnclosedOp,
      id: 'job-uuid-2',
      job_no: '202610-002',
      operations: [mockClosedOp], // CLOSED, but has KIV = 8
    };

    it('blocks Close JOB when any operation has not been CLOSED', async () => {
      const { supabase } = await import('../lib/supabase');
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockActiveJobWithUnclosedOp, error: null }),
      } as any);

      const leaderAuth = createMockAuthContext('PE-MFG', true);

      render(
        <MemoryRouter initialEntries={['/jobs/job-uuid-1']}>
          <AuthContext.Provider value={leaderAuth as any}>
            <Routes>
              <Route path="/jobs/:id" element={<JobDetailPage />} />
            </Routes>
          </AuthContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getAllByText('202610-001').length).toBeGreaterThan(0);
      });

      // Click Đóng JOB
      fireEvent.click(screen.getByText(/Đóng JOB \(CLOSE\)/i));

      // Check blocker message is displayed
      await waitFor(() => {
        expect(screen.getByText(/Không thể Đóng JOB: Còn công đoạn chưa Chốt \(CLOSED\)!/i)).toBeInTheDocument();
        expect(screen.getByText(/OP10 - CNC Milling \(IN_PROGRESS\)/i)).toBeInTheDocument();
      });
    });

    it('shows Planning Lockout badge, checklist warnings, requires checkbox and reason, and executes closeJobFinal', async () => {
      const { supabase } = await import('../lib/supabase');
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockActiveJobAllOpsClosedWithKiv, error: null }),
      } as any);

      const mockCloseFinalRpc = vi.spyOn(prodService, 'closeJobFinal').mockResolvedValue({ success: true });
      const leaderAuth = createMockAuthContext('PE-MFG', true);

      render(
        <MemoryRouter initialEntries={['/jobs/job-uuid-2']}>
          <AuthContext.Provider value={leaderAuth as any}>
            <Routes>
              <Route path="/jobs/:id" element={<JobDetailPage />} />
            </Routes>
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Verify Planning & Routing Lockout badge is visible
      await waitFor(() => {
        expect(screen.getAllByText(/Planning & Routing: Đã khóa/i).length).toBeGreaterThan(0);
      });

      // Click Đóng JOB
      fireEvent.click(screen.getByText(/Đóng JOB \(CLOSE\)/i));

      // Check Modal renders with warnings
      await waitFor(() => {
        expect(screen.getByText(/Cảnh báo tồn đọng \(Phương án B - Đóng có điều kiện\):/i)).toBeInTheDocument();
        expect(screen.getByText(/Có 8 sản phẩm KIV chưa được xử lý\/phân định tại các công đoạn./i)).toBeInTheDocument();
      });

      const submitBtn = screen.getByRole('button', { name: /Xác nhận Đóng JOB \(CLOSE\)/i });
      expect(submitBtn).toBeDisabled();

      // Check acknowledgment checkbox
      const ackCheckbox = screen.getByRole('checkbox');
      fireEvent.click(ackCheckbox);
      expect(submitBtn).toBeDisabled();

      // Enter short reason (<5 chars)
      const reasonInput = screen.getByPlaceholderText(/Ví dụ: Đơn vị khách hàng đồng ý nhận sớm/i);
      fireEvent.change(reasonInput, { target: { value: 'OK' } });
      expect(submitBtn).toBeDisabled();

      // Enter valid reason (>= 5 chars)
      fireEvent.change(reasonInput, { target: { value: 'Khách hàng duyệt nhận hàng sớm' } });
      expect(submitBtn).toBeDisabled(); // Still disabled because ticket not typed

      // Enter wrong ticket
      const ticketInput = screen.getByPlaceholderText(/Gõ lại chính xác "202610-002"/i);
      fireEvent.change(ticketInput, { target: { value: 'WRONG-TICKET' } });
      expect(submitBtn).toBeDisabled();

      // Enter correct ticket
      fireEvent.change(ticketInput, { target: { value: '202610-002' } });
      expect(submitBtn).toBeEnabled();

      // Submit
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockCloseFinalRpc).toHaveBeenCalledWith(
          expect.objectContaining({
            jobId: 'job-uuid-2',
            confirmTicket: '202610-002',
            closeReason: 'Khách hàng duyệt nhận hàng sớm',
            acknowledgedWarnings: expect.arrayContaining([
              expect.stringContaining('8 sản phẩm KIV'),
            ]),
            evaluationResult: 'PASS',
          })
        );
      });
    });
  });
});

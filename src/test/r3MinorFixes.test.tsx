import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { OperationExecutionPanel } from '../features/operations/OperationExecutionPanel';
import { AuthContext } from '../features/auth/AuthContext';
import {
  getWorkcenterDescription,
  UNIQUE_WORKCENTERS,
  OFFICIAL_WORKCENTERS,
  isAutoTurnOperation,
} from '../features/jobs/jobDisplayUtils';
import * as prodService from '../services/productionResultService';
import type { JobOperation, UserRole } from '../types/database.types';

// Mock productionResultService
vi.mock('../services/productionResultService', () => ({
  fetchDefectCatalog: vi.fn().mockResolvedValue({
    defects: [{ id: '1', code: 'DEF-01', name_vi: 'Lỗi kích thước' }],
    error: null,
  }),
  saveProductionResult: vi.fn().mockResolvedValue({ success: true }),
  saveQACheck: vi.fn().mockResolvedValue({ success: true }),
  uploadNGPhoto: vi.fn().mockResolvedValue({ filePath: 'photos/ng.jpg', error: null }),
  uploadN1CheckSheet: vi.fn().mockResolvedValue({ filePath: 'checks/n1.pdf', error: null }),
  uploadQaNgPhoto: vi.fn().mockResolvedValue({ filePath: 'photos/qa_ng.jpg', error: null }),
  viewNGPhotoSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://example.com/photo.jpg', error: null }),
  closeJobOperation: vi.fn().mockResolvedValue({ success: true }),
  reviewKivTransfer: vi.fn().mockResolvedValue({ success: true }),
  fetchKivReviews: vi.fn().mockResolvedValue({ reviews: [], error: null }),
}));

function createMockAuthContext(role: UserRole = 'PE-MFG', isLeader = true) {
  return {
    user: { id: 'test-user-id', email: 'test@example.com' } as any,
    profile: {
      id: 'test-user-id',
      username: 'testleader',
      full_name: 'Test PE Leader',
      role,
      is_department_leader: isLeader,
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

const autoTurnOp: JobOperation = {
  id: 'op-auto-turn-1',
  job_id: 'job-123',
  step_order: 10,
  operation_name: 'Auto Turn',
  workcenter_code: 'A20C',
  description: 'Auto Turn',
  status: 'IN_PROGRESS',
  created_at: '2026-10-15T00:00:00Z',
  updated_at: '2026-10-15T00:00:00Z',
  production_runs: [
    {
      id: 'run-1',
      operation_id: 'op-auto-turn-1',
      machine_id: 'AA08',
      cycle_time_seconds: null,
      ok_qty: 100,
      ng_qty: 0,
      kiv_qty: 0,
      production_date: '2026-10-15',
      created_at: '2026-10-15T08:00:00Z',
    },
  ],
};

const cyggOp: JobOperation = {
  id: 'op-cygg-2',
  job_id: 'job-123',
  step_order: 20,
  operation_name: 'Cylindrical Grinding',
  workcenter_code: 'CYGG',
  description: 'Cylindrical Grinding',
  status: 'IN_PROGRESS',
  created_at: '2026-10-15T00:00:00Z',
  updated_at: '2026-10-15T00:00:00Z',
  production_runs: [
    {
      id: 'run-2',
      operation_id: 'op-cygg-2',
      machine_id: 'CY01',
      cycle_time_seconds: null,
      ok_qty: 80,
      ng_qty: 0,
      kiv_qty: 0,
      production_date: '2026-10-15',
      created_at: '2026-10-15T09:00:00Z',
    },
  ],
};

describe('SAMPLE TRACKING — R3 MINOR FIXES TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // FIX 01 — Workcenter CYGG Description
  // ==========================================================================
  describe('FIX 01: Workcenter CYGG Description', () => {
    it('CYGG maps to "Cylindrical Grinding", NOT "Auto Turn"', () => {
      expect(getWorkcenterDescription('CYGG')).toBe('Cylindrical Grinding');
    });

    it('A20C and lathe workcenters retain "Auto Turn"', () => {
      expect(getWorkcenterDescription('A20C')).toBe('Auto Turn');
      expect(getWorkcenterDescription('B12C')).toBe('Auto Turn');
      expect(getWorkcenterDescription('B26C')).toBe('Auto Turn');
      expect(getWorkcenterDescription('CAMC')).toBe('Auto Turn');
      expect(getWorkcenterDescription('L16C')).toBe('Auto Turn');
      expect(getWorkcenterDescription('L20C')).toBe('Auto Turn');
      expect(getWorkcenterDescription('L32C')).toBe('Auto Turn');
      expect(getWorkcenterDescription('B18C')).toBe('Auto Turn');
      expect(getWorkcenterDescription('SR2C')).toBe('Auto Turn');
      expect(getWorkcenterDescription('SB2C')).toBe('Auto Turn');
      expect(getWorkcenterDescription('SR3C')).toBe('Auto Turn');
    });

    it('OFFICIAL_WORKCENTERS entry 4 has code CYGG and description Cylindrical Grinding', () => {
      const cyggEntry = OFFICIAL_WORKCENTERS.find((w) => w.code === 'CYGG');
      expect(cyggEntry).toBeDefined();
      expect(cyggEntry?.description).toBe('Cylindrical Grinding');
      expect(cyggEntry?.mcType).toBe('Cilindrical Grinding');
    });

    it('UNIQUE_WORKCENTERS has CYGG with description Cylindrical Grinding', () => {
      const uniqueCygg = UNIQUE_WORKCENTERS.find((w) => w.code === 'CYGG');
      expect(uniqueCygg).toBeDefined();
      expect(uniqueCygg?.description).toBe('Cylindrical Grinding');
    });
  });

  // ==========================================================================
  // FIX 02 — Mandatory Actual Cycle Time for Auto Turn
  // ==========================================================================
  describe('FIX 02: Mandatory Actual Cycle Time for Auto Turn', () => {
    it('isAutoTurnOperation correctly classifies Auto Turn vs Non-Auto Turn operations', () => {
      expect(isAutoTurnOperation(autoTurnOp)).toBe(true);
      expect(isAutoTurnOperation({ workcenter_code: 'A20C' })).toBe(true);
      expect(isAutoTurnOperation({ description: 'Auto Turn' })).toBe(true);
      expect(isAutoTurnOperation({ operation_name: 'Auto Turn' })).toBe(true);

      // CYGG must NOT be Auto Turn
      expect(isAutoTurnOperation(cyggOp)).toBe(false);
      expect(isAutoTurnOperation({ workcenter_code: 'CYGG' })).toBe(false);
      expect(isAutoTurnOperation({ workcenter_code: 'CGMG' })).toBe(false);
    });

    it('Auto Turn displays "Cycle Time (sec) *" label and warns when CT is missing', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG', true)}>
            <OperationExecutionPanel
              operation={autoTurnOp}
              jobId="job-123"
              jobNo="202610-001"
              partNo="PART-1"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Label must indicate mandatory Cycle Time
      expect(screen.getByText(/Cycle Time \(sec\)/i)).toBeInTheDocument();
      // Warning for missing CT must be shown
      expect(
        screen.getByText(/Bắt buộc nhập Cycle Time thực tế \(> 0\) cho Auto Turn/i)
      ).toBeInTheDocument();
    });

    it('Non-Auto Turn (CYGG) displays "CT Actual (sec/pcs)" without mandatory requirement', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG', true)}>
            <OperationExecutionPanel
              operation={cyggOp}
              jobId="job-123"
              jobNo="202610-001"
              partNo="PART-1"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByText(/CT Actual/i)).toBeInTheDocument();
      expect(
        screen.queryByText(/Bắt buộc nhập Cycle Time thực tế \(> 0\) cho Auto Turn/i)
      ).not.toBeInTheDocument();
    });

    it('Blocks saving production result on Auto Turn when CT Actual is missing or 0', async () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG', true)}>
            <OperationExecutionPanel
              operation={autoTurnOp}
              jobId="job-123"
              jobNo="202610-001"
              partNo="PART-1"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const saveBtn = screen.getByRole('button', { name: /Lưu kết quả sản xuất/i });
      fireEvent.submit(saveBtn.closest('form')!);

      await waitFor(() => {
        expect(
          screen.getByText(/Vui lòng nhập Cycle Time thực tế \(CT Actual > 0\) cho công đoạn Auto Turn/i)
        ).toBeInTheDocument();
      });
      expect(prodService.saveProductionResult).not.toHaveBeenCalled();
    });

    it('Blocks closing Auto Turn operation when no production run has CT > 0', async () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG', true)}>
            <OperationExecutionPanel
              operation={autoTurnOp}
              jobId="job-123"
              jobNo="202610-001"
              partNo="PART-1"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Click "Chốt công đoạn" button to open modal
      const closeOpBtn = screen.getByRole('button', { name: /Chốt công đoạn/i });
      fireEvent.click(closeOpBtn);

      // Modal opens
      expect(screen.getByRole('heading', { name: /Xác nhận Chốt công đoạn/i })).toBeInTheDocument();
      expect(screen.getByText(/Không thể đóng công đoạn Auto Turn/i)).toBeInTheDocument();

      // Click confirm close in modal
      const confirmBtns = screen.getAllByRole('button');
      const confirmCloseBtn = confirmBtns.find((b) => b.textContent?.includes('Chốt công đoạn') && b !== closeOpBtn);
      expect(confirmCloseBtn).toBeDefined();
      if (confirmCloseBtn) {
        fireEvent.click(confirmCloseBtn);
      }

      await waitFor(() => {
        expect(
          screen.getByText(
            'Không thể đóng công đoạn Auto Turn. PE-MFG phải nhập Cycle Time thực tế (CT Actual) trước khi đóng.'
          )
        ).toBeInTheDocument();
      });
      expect(prodService.closeJobOperation).not.toHaveBeenCalled();
    });

    it('Allows closing Auto Turn operation when a production run has CT > 0', async () => {
      const autoTurnWithCt: JobOperation = {
        ...autoTurnOp,
        production_runs: [
          {
            id: 'run-valid-ct',
            operation_id: 'op-auto-turn-1',
            machine_id: 'AA08',
            cycle_time_seconds: 45.5,
            ok_qty: 100,
            ng_qty: 0,
            kiv_qty: 0,
            production_date: '2026-10-15',
            created_at: '2026-10-15T08:00:00Z',
          },
        ],
      };

      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG', true)}>
            <OperationExecutionPanel
              operation={autoTurnWithCt}
              jobId="job-123"
              jobNo="202610-001"
              partNo="PART-1"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const closeOpBtn = screen.getByRole('button', { name: /Chốt công đoạn/i });
      fireEvent.click(closeOpBtn);

      expect(screen.queryByText(/Không thể đóng công đoạn Auto Turn/i)).not.toBeInTheDocument();

      const confirmBtns = screen.getAllByRole('button');
      const confirmCloseBtn = confirmBtns.find((b) => b.textContent?.includes('Chốt công đoạn') && b !== closeOpBtn);
      if (confirmCloseBtn) {
        fireEvent.click(confirmCloseBtn);
      }

      await waitFor(() => {
        expect(prodService.closeJobOperation).toHaveBeenCalledWith(autoTurnWithCt.id);
      });
    });

    it('Allows closing non-Auto Turn (CYGG) even without Cycle Time', async () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('PE-MFG', true)}>
            <OperationExecutionPanel
              operation={cyggOp}
              jobId="job-123"
              jobNo="202610-001"
              partNo="PART-1"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const closeOpBtn = screen.getByRole('button', { name: /Chốt công đoạn/i });
      fireEvent.click(closeOpBtn);

      expect(screen.queryByText(/Không thể đóng công đoạn Auto Turn/i)).not.toBeInTheDocument();

      const confirmBtns = screen.getAllByRole('button');
      const confirmCloseBtn = confirmBtns.find((b) => b.textContent?.includes('Chốt công đoạn') && b !== closeOpBtn);
      if (confirmCloseBtn) {
        fireEvent.click(confirmCloseBtn);
      }

      await waitFor(() => {
        expect(prodService.closeJobOperation).toHaveBeenCalledWith(cyggOp.id);
      });
    });
  });

  // ==========================================================================
  // FIX 03 — Remove Duplicate Plus Icon in QA
  // ==========================================================================
  describe('FIX 03: Remove Duplicate Plus Icon in QA', () => {
    it('Renders exactly one "+" in the N1 Check Sheet button without an additional Plus icon', () => {
      const qaOp: JobOperation = {
        ...autoTurnOp,
        qa_checks: [],
      };

      const { container } = render(
        <MemoryRouter>
          <AuthContext.Provider value={createMockAuthContext('QA', false)}>
            <OperationExecutionPanel
              operation={qaOp}
              jobId="job-123"
              jobNo="202610-001"
              partNo="PART-1"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Find the label for N1 Check Sheet upload
      const n1Label = screen.getByText('+ Check Sheet / Ảnh').closest('label');
      expect(n1Label).toBeInTheDocument();

      // Check text content contains single "+"
      const textContent = n1Label?.textContent || '';
      const plusCount = (textContent.match(/\+/g) || []).length;
      expect(plusCount).toBe(1);

      // Verify that no SVG <Plus> icon is rendered inside the label (when not uploading)
      const svgs = n1Label?.querySelectorAll('svg');
      // No SVG or spinner inside when idle
      expect(svgs?.length).toBe(0);
    });
  });
});

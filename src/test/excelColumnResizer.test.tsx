import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DrawingReviewListPage } from '../features/drawingReview/DrawingReviewListPage';
import { JobListPage } from '../features/jobs/JobListPage';
import { JobCard } from '../features/jobs/JobCard';
import { AuthContext } from '../features/auth/AuthContext';
import * as drawingReviewService from '../services/drawingReviewService';
import type { Job } from '../types/database.types';
import { ENV } from '../lib/env';

// Mock drawingReviewService
vi.mock('../services/drawingReviewService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/drawingReviewService')>();
  return {
    ...actual,
    fetchDrawingReviewList: vi.fn(),
    createNextDrawingReviewVersion: vi.fn(),
    getDrawingFileSignedUrl: vi.fn().mockResolvedValue({
      signedUrl: 'https://storage.mock.local/drawings/test-avatar.png',
      error: null,
    }),
  };
});

const createMockAuth = (role: 'BD' | 'PE-MFG' | 'Admin' | 'Planning') => ({
  user: { id: 'test-user-resizer', email: 'test@example.com' } as any,
  profile: {
    id: 'test-user-resizer',
    email: 'test@example.com',
    full_name: 'Test Engineer',
    role: role,
    department: role,
    is_active: true,
    must_change_password: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as any,
  session: {} as any,
  loading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
  logout: vi.fn(),
});

describe('EXCEL-LIKE COLUMN RESIZING & AUTO-FIT ROUTING TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('Part 1: Drawing Review Table Column Resizing', () => {
    const mockIssues = [
      {
        id: 'issue-resizer-1',
        issue_no: '261111-N001',
        item_no: 'SHAFT-1002',
        item_name: 'Output Shaft',
        customer: 'TTI',
        drawing_file_path: 'drawings/shaft.pdf',
        drawing_file_name: 'shaft.pdf',
        drawing_file_size: 1024,
        drawing_mime_type: 'application/pdf',
        created_at: '2026-11-11T08:00:00Z',
        updated_at: '2026-11-11T08:00:00Z',
        versions: [
          {
            id: 'v1',
            issue_id: 'issue-resizer-1',
            version_number: 1,
            version_name: 'V1',
            status: 'Completed',
            avatar_file_path: 'drawings/shaft-avatar.png',
            created_at: '2026-11-11T08:00:00Z',
            operations: [
              { id: 'op1', step_order: 10, workcenter_code: 'A20C', cycle_time_seconds: 61, is_removed: false },
              { id: 'op2', step_order: 20, workcenter_code: 'SUBCON', cycle_time_seconds: 1, is_removed: false },
              { id: 'op3', step_order: 30, workcenter_code: 'VMIC', cycle_time_seconds: 15, is_removed: false },
              { id: 'op4', step_order: 40, workcenter_code: 'CGMG', cycle_time_seconds: 37, is_removed: false },
              { id: 'op5', step_order: 50, workcenter_code: 'VMIQ', cycle_time_seconds: 6, is_removed: false },
            ],
          },
        ],
        latest_version: {
          id: 'v1',
          issue_id: 'issue-resizer-1',
          version_number: 1,
          version_name: 'V1',
          status: 'Completed',
          avatar_file_path: 'drawings/shaft-avatar.png',
          created_at: '2026-11-11T08:00:00Z',
          operations: [
            { id: 'op1', step_order: 10, workcenter_code: 'A20C', cycle_time_seconds: 61, is_removed: false },
            { id: 'op2', step_order: 20, workcenter_code: 'SUBCON', cycle_time_seconds: 1, is_removed: false },
            { id: 'op3', step_order: 30, workcenter_code: 'VMIC', cycle_time_seconds: 15, is_removed: false },
            { id: 'op4', step_order: 40, workcenter_code: 'CGMG', cycle_time_seconds: 37, is_removed: false },
            { id: 'op5', step_order: 50, workcenter_code: 'VMIQ', cycle_time_seconds: 6, is_removed: false },
          ],
        },
      },
    ];

    it('renders column resizer handles on all adjustable column headers in Drawing Review', async () => {
      (drawingReviewService.fetchDrawingReviewList as any).mockResolvedValue({
        data: mockIssues,
        error: null,
      });

      render(
        <AuthContext.Provider value={createMockAuth('PE-MFG')}>
          <MemoryRouter>
            <DrawingReviewListPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText('261111-N001')).toBeInTheDocument();
      });

      // Verify resizer handles exist for columns
      expect(screen.getByTestId('resizer-picture')).toBeInTheDocument();
      expect(screen.getByTestId('resizer-issue_no')).toBeInTheDocument();
      expect(screen.getByTestId('resizer-product')).toBeInTheDocument();
      expect(screen.getByTestId('resizer-customer')).toBeInTheDocument();
      expect(screen.getByTestId('resizer-routing')).toBeInTheDocument();
      expect(screen.getByTestId('resizer-issue_date')).toBeInTheDocument();
      expect(screen.getByTestId('resizer-version')).toBeInTheDocument();
      expect(screen.getByTestId('resizer-status')).toBeInTheDocument();
    });

    it('dragging resizer handle adjusts column width and saves to localStorage', async () => {
      (drawingReviewService.fetchDrawingReviewList as any).mockResolvedValue({
        data: mockIssues,
        error: null,
      });

      render(
        <AuthContext.Provider value={createMockAuth('PE-MFG')}>
          <MemoryRouter>
            <DrawingReviewListPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText('261111-N001')).toBeInTheDocument();
      });

      const resizerProduct = screen.getByTestId('resizer-product');
      // Simulate mousedown at x=200
      fireEvent.mouseDown(resizerProduct, { clientX: 200 });

      // Simulate mousemove to x=320 (+120px)
      fireEvent(window, new MouseEvent('mousemove', { clientX: 320 }));

      // Simulate mouseup
      fireEvent(window, new MouseEvent('mouseup'));

      // Check localStorage for saved widths
      const saved = localStorage.getItem('sample_tracking_drawing_review_col_widths');
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved!);
      expect(parsed.product).toBeGreaterThanOrEqual(300);
    });

    it('routing column uses flex-wrap allowing processes to auto-fit cell space', async () => {
      (drawingReviewService.fetchDrawingReviewList as any).mockResolvedValue({
        data: mockIssues,
        error: null,
      });

      render(
        <AuthContext.Provider value={createMockAuth('PE-MFG')}>
          <MemoryRouter>
            <DrawingReviewListPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText('A20C')).toBeInTheDocument();
      });

      // The container wrapping the routing operations has flex-wrap
      const a20cEl = screen.getByText('A20C');
      const routingContainer = a20cEl.closest('.flex-wrap');
      expect(routingContainer).toBeInTheDocument();
      expect(routingContainer?.className).toContain('flex');
      expect(routingContainer?.className).toContain('flex-wrap');
    });
  });

  describe('Part 2: Sample Production Table Column Resizing & Routing Auto-Fit', () => {
    it('renders column resizer handles on JOB List header and supports resizing', async () => {
      const originalDemo = ENV.IS_DEMO_MODE;
      (ENV as any).IS_DEMO_MODE = true;
      try {
        render(
          <MemoryRouter>
            <AuthContext.Provider value={createMockAuth('Planning')}>
              <JobListPage />
            </AuthContext.Provider>
          </MemoryRouter>
        );

        const header = await screen.findByTestId('job-list-header');
        expect(header).toBeInTheDocument();

        // Check resizers exist
        expect(screen.getByTestId('resizer-job_ticket')).toBeInTheDocument();
        expect(screen.getByTestId('resizer-item_no')).toBeInTheDocument();
        expect(screen.getByTestId('resizer-customer')).toBeInTheDocument();
        expect(screen.getByTestId('resizer-routing')).toBeInTheDocument();

        // Drag resizer-item_no
        const resizerItemNo = screen.getByTestId('resizer-item_no');
        fireEvent.mouseDown(resizerItemNo, { clientX: 100 });
        fireEvent(window, new MouseEvent('mousemove', { clientX: 180 }));
        fireEvent(window, new MouseEvent('mouseup'));

        const saved = localStorage.getItem('sample_tracking_job_col_widths_test-user-resizer');
        expect(saved).not.toBeNull();
        const parsed = JSON.parse(saved!);
        expect(parsed.item_no).toBe(220); // 140 default + 80
      } finally {
        (ENV as any).IS_DEMO_MODE = originalDemo;
      }
    });

    it('JobCard routing column auto-fits with flex-wrap and justify-end', () => {
      const mockJob: Job = {
        id: 'job-autofit-1',
        job_no: '202611-099',
        part_no: 'PART-99',
        part_name: 'Fit Test',
        customer: 'TTI',
        order_qty: 250,
        material: 'SUS304',
        planned_start_date: '2026-11-10',
        planned_finish_date: '2026-11-15',
        status: 'ACTIVE',
        created_at: '2026-11-10T00:00:00Z',
        updated_at: '',
        operations: [
          {
            id: 'op1',
            job_id: 'job-autofit-1',
            step_order: 1,
            operation_name: 'CNC',
            planned_machine: 'Cincom citizent A20',
            status: 'NOT_STARTED',
            created_at: '',
            updated_at: '',
          },
          {
            id: 'op2',
            job_id: 'job-autofit-1',
            step_order: 2,
            operation_name: 'Grinding',
            planned_machine: 'Paragon',
            status: 'NOT_STARTED',
            created_at: '',
            updated_at: '',
          },
        ],
      };

      render(
        <MemoryRouter>
          <JobCard job={mockJob} columnWidths={{ routing: 350 }} />
        </MemoryRouter>
      );

      const routingCol = screen.getByTestId('job-col-routing');
      expect(routingCol).toBeInTheDocument();

      const flexContainer = routingCol.querySelector('.flex-wrap');
      expect(flexContainer).toBeInTheDocument();
      expect(flexContainer?.className).toContain('justify-end');
    });
  });
});

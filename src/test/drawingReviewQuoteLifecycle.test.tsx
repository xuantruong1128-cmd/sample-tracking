import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DrawingReviewStatusBadge } from '../components/common/Badge';
import { permissions } from '../features/auth/authUtils';
import { DrawingReviewListPage } from '../features/drawingReview/DrawingReviewListPage';
import { DrawingReviewCompletedPage } from '../features/drawingReview/DrawingReviewCompletedPage';
import * as drawingReviewService from '../services/drawingReviewService';

// Mock AuthContext
let mockCurrentUserRole = 'BD';
vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'mock-user-1',
      role: mockCurrentUserRole,
      full_name: 'Test User',
      is_active: true,
      has_completed_password_change: true,
    },
    user: { id: 'mock-user-1' },
    session: {},
  }),
}));

describe('DRAWING REVIEW QUOTE & REQUOTE LIFECYCLE TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUserRole = 'BD';
  });

  // --------------------------------------------------------------------------
  // 1. Badge Rendering Tests
  // --------------------------------------------------------------------------
  it('1. DrawingReviewStatusBadge renders Quoted, Requote, and Requoted with proper styles and labels', () => {
    const { rerender } = render(<DrawingReviewStatusBadge status="Quoted" />);
    const quotedBadge = screen.getByTestId('drawing-review-status-quoted');
    expect(quotedBadge).toBeInTheDocument();
    expect(quotedBadge).toHaveTextContent('Quoted');
    expect(quotedBadge.className).toContain('text-purple-700');

    rerender(<DrawingReviewStatusBadge status="Requote" />);
    const requoteBadge = screen.getByTestId('drawing-review-status-requote');
    expect(requoteBadge).toBeInTheDocument();
    expect(requoteBadge).toHaveTextContent('Requote');
    expect(requoteBadge.className).toContain('text-orange-700');

    rerender(<DrawingReviewStatusBadge status="Requoted" />);
    const requotedBadge = screen.getByTestId('drawing-review-status-requoted');
    expect(requotedBadge).toBeInTheDocument();
    expect(requotedBadge).toHaveTextContent('Requoted');
    expect(requotedBadge.className).toContain('text-indigo-700');

    // Full labels test
    rerender(<DrawingReviewStatusBadge status="Quoted" simplified={false} />);
    expect(screen.getByText('Đã báo giá (Quoted)')).toBeInTheDocument();

    rerender(<DrawingReviewStatusBadge status="Requote" simplified={false} />);
    expect(screen.getByText('Yêu cầu báo giá lại (Requote)')).toBeInTheDocument();

    rerender(<DrawingReviewStatusBadge status="Requoted" simplified={false} />);
    expect(screen.getByText('Đã báo giá lại (Requoted)')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // 2. Permission Rules Tests
  // --------------------------------------------------------------------------
  it('2. Permissions canQuoteDrawingReview and canRequoteDrawingReview allow BD and Admin, reject others', () => {
    expect(permissions.canQuoteDrawingReview('BD')).toBe(true);
    expect(permissions.canQuoteDrawingReview('Admin')).toBe(true);
    expect(permissions.canQuoteDrawingReview('PE-MFG')).toBe(false);
    expect(permissions.canQuoteDrawingReview('Planning')).toBe(false);
    expect(permissions.canQuoteDrawingReview('QA')).toBe(false);
    expect(permissions.canQuoteDrawingReview('Viewer')).toBe(false);

    expect(permissions.canRequoteDrawingReview('BD')).toBe(true);
    expect(permissions.canRequoteDrawingReview('Admin')).toBe(true);
    expect(permissions.canRequoteDrawingReview('PE-MFG')).toBe(false);
    expect(permissions.canRequoteDrawingReview('Planning')).toBe(false);
    expect(permissions.canRequoteDrawingReview('QA')).toBe(false);
    expect(permissions.canRequoteDrawingReview('Viewer')).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 3. DrawingReviewListPage: Status Filter & Action Icons (Plus Dimming)
  // --------------------------------------------------------------------------
  it('3. DrawingReviewListPage includes Quoted, Requote, and Requoted in filter and dims "+" when Quoted/Requoted', async () => {
    mockCurrentUserRole = 'PE-MFG';

    const mockIssues = [
      {
        id: 'issue-1',
        issue_no: '261110-N001',
        item_no: '611573127',
        item_name: 'Pinion',
        customer: 'TTI',
        created_at: '2026-11-10T08:00:00Z',
        versions: [{ id: 'v1', version_number: 1, version_name: 'V1', status: 'Completed' }],
        latest_version: {
          id: 'v1',
          version_number: 1,
          version_name: 'V1',
          status: 'Completed',
          operations: [{ id: 'op1', step_order: 10, workcenter_code: 'A20C', cycle_time_seconds: 48 }],
        },
      },
      {
        id: 'issue-2',
        issue_no: '261110-N002',
        item_no: '611573124',
        item_name: 'Motor Pinion',
        customer: 'TTI',
        created_at: '2026-11-10T08:00:00Z',
        versions: [{ id: 'v2-1', version_number: 1, version_name: 'V1', status: 'Quoted' }],
        latest_version: {
          id: 'v2-1',
          version_number: 1,
          version_name: 'V1',
          status: 'Quoted',
          operations: [{ id: 'op2', step_order: 10, workcenter_code: 'A20C', cycle_time_seconds: 55 }],
        },
      },
      {
        id: 'issue-3',
        issue_no: '261110-N003',
        item_no: '621253003',
        item_name: 'OUTPUT SHAFT',
        customer: 'TTI',
        created_at: '2026-11-10T08:00:00Z',
        versions: [{ id: 'v3-1', version_number: 1, version_name: 'V1', status: 'Requote' }],
        latest_version: {
          id: 'v3-1',
          version_number: 1,
          version_name: 'V1',
          status: 'Requote',
          operations: [{ id: 'op3', step_order: 10, workcenter_code: 'A20C', cycle_time_seconds: 61 }],
        },
      },
      {
        id: 'issue-4',
        issue_no: '261110-N004',
        item_no: '621253004',
        item_name: 'DRIVE SHAFT',
        customer: 'TTI',
        created_at: '2026-11-10T08:00:00Z',
        versions: [
          { id: 'v4-1', version_number: 1, version_name: 'V1', status: 'Requote' },
          { id: 'v4-2', version_number: 2, version_name: 'V2', status: 'Requoted' },
        ],
        latest_version: {
          id: 'v4-2',
          version_number: 2,
          version_name: 'V2',
          status: 'Requoted',
          operations: [{ id: 'op4', step_order: 10, workcenter_code: 'A20C', cycle_time_seconds: 70 }],
        },
      },
    ];

    vi.spyOn(drawingReviewService, 'fetchDrawingReviewList').mockResolvedValue({
      data: mockIssues as any,
      error: null,
    });

    render(
      <MemoryRouter>
        <DrawingReviewListPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('261110-N001')).toBeInTheDocument();
    });

    // Activate status filter via dynamic toolbar
    fireEvent.click(screen.getByTestId('add-filter-button'));
    fireEvent.click(screen.getByTestId('toggle-filter-status'));

    // Check Filter dropdown options
    const filterSelect = screen.getByTestId('status-filter') as HTMLSelectElement;
    expect(filterSelect).toBeInTheDocument();
    const options = Array.from(filterSelect.options).map((o) => o.value);
    expect(options).toContain('Quoted');
    expect(options).toContain('Requote');
    expect(options).toContain('Requoted');

    // Issue 1 (Completed): '+' button is ENABLED
    const plusBtnIssue1 = screen.getByTestId('create-v-next-btn-261110-N001');
    expect(plusBtnIssue1).toBeInTheDocument();
    expect(plusBtnIssue1).not.toBeDisabled();

    // Issue 2 (Quoted): '+' button is DISABLED (tối đi)
    const plusBtnIssue2 = screen.getByTestId('create-v-next-btn-261110-N002-disabled');
    expect(plusBtnIssue2).toBeInTheDocument();
    expect(plusBtnIssue2).toBeDisabled();

    // Issue 3 (Requote): '+' button is ENABLED (mở ra)
    const plusBtnIssue3 = screen.getByTestId('create-v-next-btn-261110-N003');
    expect(plusBtnIssue3).toBeInTheDocument();
    expect(plusBtnIssue3).not.toBeDisabled();

    // Issue 4 (Requoted): '+' button is DISABLED (tối đi)
    const plusBtnIssue4 = screen.getByTestId('create-v-next-btn-261110-N004-disabled');
    expect(plusBtnIssue4).toBeInTheDocument();
    expect(plusBtnIssue4).toBeDisabled();
  });

  // --------------------------------------------------------------------------
  // 4. DrawingReviewCompletedPage: BD Quote & Requote Actions & PE Locking
  // --------------------------------------------------------------------------
  it('4. DrawingReviewCompletedPage renders Quote button for BD on Completed, and Requote button on Quoted/Requoted', async () => {
    mockCurrentUserRole = 'BD';

    const mockDetail = {
      id: 'issue-comp-1',
      issue_no: '261110-N001',
      item_no: '611573127',
      item_name: 'Pinion',
      customer: 'TTI',
      created_at: '2026-11-10T08:00:00Z',
      latest_version: {
        id: 'ver-1',
        version_number: 1,
        version_name: 'V1',
        status: 'Completed',
        closed_at: '2026-11-10T11:45:12Z',
        operations: [],
        attachments: [],
      },
      versions: [
        {
          id: 'ver-1',
          version_number: 1,
          version_name: 'V1',
          status: 'Completed',
          closed_at: '2026-11-10T11:45:12Z',
          operations: [],
          attachments: [],
        },
      ],
    };

    vi.spyOn(drawingReviewService, 'fetchDrawingReviewDetail').mockResolvedValue({
      data: mockDetail as any,
      error: null,
    });

    const quoteSpy = vi.spyOn(drawingReviewService, 'quoteDrawingReviewVersion').mockResolvedValue({
      success: true,
      status: 'Quoted',
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/drawing-reviews/issue-comp-1/report']}>
        <Routes>
          <Route path="/drawing-reviews/:id/report" element={<DrawingReviewCompletedPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('quote-version-btn')).toBeInTheDocument();
    });

    // BD should see Quoted button on V1 Completed
    const quoteBtn = screen.getByTestId('quote-version-btn');
    expect(quoteBtn).toHaveTextContent('Quoted');

    // Confirm dialog mock
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(quoteBtn);
    expect(quoteSpy).toHaveBeenCalledWith('ver-1', 'Quoted');

    unmount();

    // Test Requote state
    mockDetail.latest_version.status = 'Quoted';
    mockDetail.versions[0].status = 'Quoted';

    const requoteSpy = vi.spyOn(drawingReviewService, 'requoteDrawingReviewVersion').mockResolvedValue({
      success: true,
      status: 'Requote',
    });

    render(
      <MemoryRouter initialEntries={['/drawing-reviews/issue-comp-1/report']}>
        <Routes>
          <Route path="/drawing-reviews/:id/report" element={<DrawingReviewCompletedPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('requote-version-btn')).toBeInTheDocument();
    });

    // BD should see Requote button on Quoted version
    const requoteBtn = screen.getByTestId('requote-version-btn');
    expect(requoteBtn).toBeInTheDocument();
    expect(requoteBtn).toHaveTextContent('Requote');

    fireEvent.click(requoteBtn);
    expect(requoteSpy).toHaveBeenCalledWith('ver-1');
  });
});

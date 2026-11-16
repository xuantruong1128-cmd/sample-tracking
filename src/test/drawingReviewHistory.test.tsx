import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DrawingReviewHistoryModal } from '../features/drawingReview/DrawingReviewHistoryModal';
import { DrawingReviewListPage } from '../features/drawingReview/DrawingReviewListPage';
import { DrawingReviewCompletedPage } from '../features/drawingReview/DrawingReviewCompletedPage';
import { LogListPage } from '../features/logs/LogListPage';
import { Header } from '../components/common/Header';
import { generateActivityLogsWorkbook } from '../services/excelExportService';
import { AuthContext } from '../features/auth/AuthContext';
import * as drawingReviewService from '../services/drawingReviewService';

vi.mock('../services/drawingReviewService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/drawingReviewService')>();
  return {
    ...actual,
    fetchDrawingReviewList: vi.fn(),
    fetchDrawingReviewDetail: vi.fn(),
    fetchDrawingReviewHistory: vi.fn(),
    createNextDrawingReviewVersion: vi.fn(),
    quoteDrawingReviewVersion: vi.fn(),
    requoteDrawingReviewVersion: vi.fn(),
    getDrawingFileSignedUrl: vi.fn().mockResolvedValue({
      signedUrl: 'https://storage.mock.local/drawings/test-avatar.png',
      error: null,
    }),
  };
});

const createMockAuth = (role: 'BD' | 'PE-MFG' | 'Admin' | 'Viewer') => ({
  user: { id: 'test-user-1', email: 'test@example.com' } as any,
  profile: {
    id: 'test-user-1',
    email: 'test@example.com',
    full_name: 'Đỗ Xuân Trường',
    role: role,
    phone: '+84968041128',
    is_active: true,
  } as any,
  session: {} as any,
  loading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
});

describe('Drawing Review Activity & Status Change History Audit Suite', () => {
  const mockHistoryLogs = [
    {
      id: 'log-1',
      issue_id: 'issue-001',
      version_id: 'v1',
      version_name: 'V1',
      action: 'ISSUE_CREATED',
      action_label: 'Phát hành bản vẽ',
      performed_by: 'user-bd-1',
      performer_name: 'Nguyễn Hải Ngọc',
      performer_role: 'BD',
      performer_phone: '+84968646083',
      old_status: null,
      new_status: 'Issued',
      details: {
        issue_no: '261110-N003',
        item_no: '621253003',
        drawing_file_name: 'shaft_drawing.pdf',
      },
      created_at: '2026-11-10T10:00:00Z',
    },
    {
      id: 'log-2',
      issue_id: 'issue-001',
      version_id: 'v1',
      version_name: 'V1',
      action: 'REVIEW_COMPLETED',
      action_label: 'Chốt hoàn thành đánh giá (Completed)',
      performed_by: 'user-pe-1',
      performer_name: 'Đỗ Xuân Trường',
      performer_role: 'PE-MFG',
      performer_phone: '+84968041128',
      old_status: 'Reviewing',
      new_status: 'Completed',
      details: {
        active_operations_count: 5,
        total_cycle_time_seconds: 145,
      },
      created_at: '2026-11-10T14:30:00Z',
    },
    {
      id: 'log-3',
      issue_id: 'issue-001',
      version_id: 'v1',
      version_name: 'V1',
      action: 'VERSION_QUOTED',
      action_label: 'Báo giá khách hàng (Quoted)',
      performed_by: 'user-bd-1',
      performer_name: 'Nguyễn Hải Ngọc',
      performer_role: 'BD',
      performer_phone: '+84968646083',
      old_status: 'Completed',
      new_status: 'Quoted',
      details: {
        target_status: 'Quoted',
      },
      created_at: '2026-11-11T08:15:00Z',
    },
    {
      id: 'log-4',
      issue_id: 'issue-001',
      version_id: 'v1',
      version_name: 'V1',
      action: 'REQUOTE_REQUESTED',
      action_label: 'Yêu cầu báo giá lại (Requote)',
      performed_by: 'user-bd-1',
      performer_name: 'Nguyễn Hải Ngọc',
      performer_role: 'BD',
      performer_phone: '+84968646083',
      old_status: 'Quoted',
      new_status: 'Requote',
      details: {
        note: 'Mở khóa nút tạo phiên bản mới cho bộ phận PE-MFG',
      },
      created_at: '2026-11-11T09:00:00Z',
    },
  ];

  const mockIssueDetail = {
    id: 'issue-001',
    issue_no: '261110-N003',
    item_no: '621253003',
    item_name: 'OUTPUT SHAFT',
    customer: 'TTI',
    drawing_file_path: 'drawings/issue-001/shaft.pdf',
    drawing_file_name: 'shaft.pdf',
    created_at: '2026-11-10T10:00:00Z',
    versions: [
      {
        id: 'v1',
        version_number: 1,
        version_name: 'V1',
        status: 'Completed',
        created_at: '2026-11-10T10:00:00Z',
        closed_at: '2026-11-10T14:30:00Z',
        operations: [
          { step_order: 10, workcenter_code: 'A20C', cycle_time_seconds: 61, is_removed: false },
        ],
      },
    ],
    latest_version: {
      id: 'v1',
      version_number: 1,
      version_name: 'V1',
      status: 'Completed',
      operations: [
        { step_order: 10, workcenter_code: 'A20C', cycle_time_seconds: 61, is_removed: false },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (drawingReviewService.fetchDrawingReviewHistory as any).mockResolvedValue({
      data: mockHistoryLogs,
      error: null,
    });
    (drawingReviewService.fetchDrawingReviewList as any).mockResolvedValue({
      data: [mockIssueDetail],
      error: null,
    });
    (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValue({
      data: mockIssueDetail,
      error: null,
    });
  });

  it('1. DrawingReviewHistoryModal renders all timeline events with performers, roles, and Hanoi timestamps', async () => {
    const handleClose = vi.fn();
    render(
      <DrawingReviewHistoryModal
        issueId="issue-001"
        issueNo="261110-N003"
        itemNo="621253003"
        customer="TTI"
        onClose={handleClose}
      />
    );

    // Header metadata
    expect(await screen.findByText('261110-N003')).toBeInTheDocument();
    expect(screen.getByText(/Mã: 621253003/)).toBeInTheDocument();
    expect(screen.getByText(/Khách: TTI/)).toBeInTheDocument();

    // Verify all 4 audit events
    expect(screen.getByText('Phát hành bản vẽ')).toBeInTheDocument();
    expect(screen.getByText(/Chốt hoàn thành/)).toBeInTheDocument();
    expect(screen.getByText(/Báo giá/)).toBeInTheDocument();
    expect(screen.getByText(/Yêu cầu báo giá lại/)).toBeInTheDocument();

    // Verify performers
    const performersBD = screen.getAllByText('Nguyễn Hải Ngọc');
    expect(performersBD.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Đỗ Xuân Trường')).toBeInTheDocument();

    // Verify roles
    const bdBadges = screen.getAllByText('Kinh doanh (BD)');
    expect(bdBadges.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Kỹ thuật (PE-MFG)')).toBeInTheDocument();

    // Verify status transition
    expect(screen.getByText('Reviewing')).toBeInTheDocument();
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);

    // Verify details
    expect(screen.getByText('5 công đoạn')).toBeInTheDocument();
    expect(screen.getByText('145s')).toBeInTheDocument();
    expect(screen.getByText('shaft_drawing.pdf')).toBeInTheDocument();

    // Close button
    fireEvent.click(screen.getByTestId('close-history-modal-btn'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('2. DrawingReviewListPage provides History button on each row and opens history modal on click', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('BD')}>
        <MemoryRouter>
          <DrawingReviewListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    // Wait for list to load
    await waitFor(() => {
      expect(screen.getByText('261110-N003')).toBeInTheDocument();
    });

    // History button exists on row
    const historyBtn = screen.getByTestId('history-btn-261110-N003');
    expect(historyBtn).toBeInTheDocument();
    expect(historyBtn).toHaveAttribute('title', 'Xem lịch sử thao tác & thay đổi trạng thái');

    // Click History button opens modal
    fireEvent.click(historyBtn);

    expect(await screen.findByTestId('drawing-review-history-modal')).toBeInTheDocument();
    expect(screen.getByText('Lịch sử thao tác bản vẽ')).toBeInTheDocument();
    expect(screen.getByText('Phát hành bản vẽ')).toBeInTheDocument();

    // Close modal
    fireEvent.click(screen.getByTestId('close-history-modal-btn'));
    expect(screen.queryByTestId('drawing-review-history-modal')).toBeNull();
  });

  it('3. DrawingReviewCompletedPage provides History button in header and opens history modal', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('PE-MFG')}>
        <MemoryRouter initialEntries={['/drawing-reviews/issue-001/report']}>
          <Routes>
            <Route path="/drawing-reviews/:id/report" element={<DrawingReviewCompletedPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    );

    // Wait for completed page to render
    await waitFor(() => {
      expect(screen.getByTestId('completed-view-history-btn')).toBeInTheDocument();
    });

    // Click History button
    fireEvent.click(screen.getByTestId('completed-view-history-btn'));

    expect(await screen.findByTestId('drawing-review-history-modal')).toBeInTheDocument();
    expect(screen.getByText('Lịch sử thao tác bản vẽ')).toBeInTheDocument();

    // Close modal
    fireEvent.click(screen.getByTestId('close-history-modal-btn'));
    expect(screen.queryByTestId('drawing-review-history-modal')).toBeNull();
  });

  it('4. LogListPage renders dedicated table view with all columns, refresh, and excel export button', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('Admin')}>
        <MemoryRouter>
          <LogListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    // Verify Title & Counts
    expect(await screen.findByText('Nhật ký hệ thống & Thao tác (Log)')).toBeInTheDocument();
    expect(screen.getByText('4 sự kiện')).toBeInTheDocument();

    // Verify Action buttons
    expect(screen.getByTestId('refresh-logs-btn')).toBeInTheDocument();
    expect(screen.getByTestId('export-logs-excel-btn')).toBeInTheDocument();

    // Verify Table Headers
    expect(screen.getByText('Mã bản vẽ (Issue No)')).toBeInTheDocument();
    expect(screen.getByText('Hành động thao tác')).toBeInTheDocument();
    expect(screen.getByText('Người thực hiện')).toBeInTheDocument();
    expect(screen.getByText('Thay đổi trạng thái')).toBeInTheDocument();
    expect(screen.getByText('Chi tiết nội dung')).toBeInTheDocument();

    // Verify Rows rendered
    expect(screen.getByTestId('log-row-log-1')).toBeInTheDocument();
    expect(screen.getByTestId('log-row-log-2')).toBeInTheDocument();
    expect(screen.getByTestId('log-row-log-3')).toBeInTheDocument();
    expect(screen.getByTestId('log-row-log-4')).toBeInTheDocument();
  });

  it('5. LogListPage filters logs by search keyword, action, and department role', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('Admin')}>
        <MemoryRouter>
          <LogListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    await screen.findByText('Nhật ký hệ thống & Thao tác (Log)');

    // Filter by Role 'PE-MFG' -> only log-2 should match
    const roleSelect = screen.getByTestId('log-role-filter');
    fireEvent.change(roleSelect, { target: { value: 'PE-MFG' } });

    expect(screen.queryByTestId('log-row-log-1')).toBeNull();
    expect(screen.getByTestId('log-row-log-2')).toBeInTheDocument();
    expect(screen.queryByTestId('log-row-log-3')).toBeNull();

    // Reset role to ALL
    fireEvent.change(roleSelect, { target: { value: 'ALL' } });

    // Filter by Action 'VERSION_QUOTED' -> only log-3 should match
    const actionSelect = screen.getByTestId('log-action-filter');
    fireEvent.change(actionSelect, { target: { value: 'VERSION_QUOTED' } });

    expect(screen.queryByTestId('log-row-log-1')).toBeNull();
    expect(screen.queryByTestId('log-row-log-2')).toBeNull();
    expect(screen.getByTestId('log-row-log-3')).toBeInTheDocument();

    // Filter by Search Term 'shaft_drawing' -> only log-1 should match
    fireEvent.change(actionSelect, { target: { value: 'ALL' } });
    const searchInput = screen.getByTestId('log-search-input');
    fireEvent.change(searchInput, { target: { value: 'shaft_drawing' } });

    expect(screen.getByTestId('log-row-log-1')).toBeInTheDocument();
    expect(screen.queryByTestId('log-row-log-2')).toBeNull();
  });

  it('6. Header renders the dedicated "Log" navigation tab', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('Admin')}>
        <MemoryRouter initialEntries={['/logs']}>
          <Header />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    const logNav = screen.getByTestId('nav-logs');
    expect(logNav).toBeInTheDocument();
    expect(logNav).toHaveAttribute('href', '/logs');
    expect(logNav).toHaveTextContent('Log');
  });

  it('7. generateActivityLogsWorkbook generates a valid Excel sheet with headers and data', () => {
    const wb = generateActivityLogsWorkbook(mockHistoryLogs as any);
    expect(wb.SheetNames).toContain('Nhat_Ky_Log');
    const ws = wb.Sheets['Nhat_Ky_Log'];
    expect(ws).toBeDefined();
    // Cell A1 is 'STT'
    expect(ws['A1'].v).toBe('STT');
    // Cell C1 is 'Mã bản vẽ (Issue No)'
    expect(ws['C1'].v).toBe('Mã bản vẽ (Issue No)');
    // Cell H1 is 'Hành động thao tác'
    expect(ws['H1'].v).toBe('Hành động thao tác');
    // Row 2 data exists
    expect(ws['A2'].v).toBe(1);
    expect(ws['I2'].v).toBe('Nguyễn Hải Ngọc');
  });
});

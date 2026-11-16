import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DrawingReviewListPage } from '../features/drawingReview/DrawingReviewListPage';
import { AuthContext } from '../features/auth/AuthContext';
import * as drawingReviewService from '../services/drawingReviewService';

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

const createMockAuth = (role: 'BD' | 'PE-MFG' | 'Admin' | 'Viewer') => ({
  user: { id: 'test-user-1', email: 'test@example.com' } as any,
  profile: {
    id: 'test-user-1',
    email: 'test@example.com',
    full_name: 'Test Engineer',
    role: role,
    is_active: true,
  } as any,
  session: {} as any,
  loading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
});

describe('Drawing Review List Page Redesign Specification R4', () => {
  const mockIssues = [
    {
      id: 'issue-001',
      issue_no: '261104-N003',
      item_no: '71006806A',
      item_name: 'INLET FITTING',
      customer: 'PHINIA',
      drawing_file_path: 'drawings/issue-001/part.pdf',
      drawing_file_name: 'part.pdf',
      drawing_file_size: 1024,
      drawing_mime_type: 'application/pdf',
      created_at: '2026-11-04T10:00:00Z',
      updated_at: '2026-11-04T10:00:00Z',
      versions: [
        {
          id: 'v1',
          issue_id: 'issue-001',
          version_number: 1,
          version_name: 'V1',
          status: 'Completed',
          avatar_file_path: 'drawings/issue-001/avatar.png',
          created_at: '2026-11-04T10:00:00Z',
          operations: [
            {
              id: 'op1',
              step_order: 10,
              workcenter_code: 'CNC-01',
              cycle_time_seconds: 110,
              is_removed: false,
            },
            {
              id: 'op2',
              step_order: 20,
              workcenter_code: 'SUBCON',
              cycle_time_seconds: null,
              operation_description: 'Nhiệt luyện chân không',
              is_removed: false,
            },
            {
              id: 'op3',
              step_order: 30,
              workcenter_code: 'QC',
              cycle_time_seconds: 30,
              is_removed: false,
            },
          ],
        },
      ],
      latest_version: {
        id: 'v1',
        issue_id: 'issue-001',
        version_number: 1,
        version_name: 'V1',
        status: 'Completed',
        avatar_file_path: 'drawings/issue-001/avatar.png',
        created_at: '2026-11-04T10:00:00Z',
        operations: [
          {
            id: 'op1',
            step_order: 10,
            workcenter_code: 'CNC-01',
            cycle_time_seconds: 110,
            is_removed: false,
          },
          {
            id: 'op2',
            step_order: 20,
            workcenter_code: 'SUBCON',
            cycle_time_seconds: null,
            operation_description: 'Nhiệt luyện chân không',
            is_removed: false,
          },
          {
            id: 'op3',
            step_order: 30,
            workcenter_code: 'QC',
            cycle_time_seconds: 30,
            is_removed: false,
          },
        ],
      },
    },
    {
      id: 'issue-002',
      issue_no: '261105-N001',
      item_no: 'FLANGE-9988',
      item_name: 'MOUNTING FLANGE',
      customer: 'BOSCH',
      drawing_file_path: 'drawings/issue-002/flange.pdf',
      drawing_file_name: 'flange.pdf',
      drawing_file_size: 2048,
      drawing_mime_type: 'application/pdf',
      created_at: '2026-11-05T08:00:00Z',
      updated_at: '2026-11-05T08:00:00Z',
      versions: [
        {
          id: 'v2',
          issue_id: 'issue-002',
          version_number: 1,
          version_name: 'V1',
          status: 'Reviewing',
          avatar_file_path: null,
          created_at: '2026-11-05T08:00:00Z',
          operations: [
            {
              id: 'op-b1',
              step_order: 10,
              workcenter_code: 'A20C',
              cycle_time_seconds: 53,
              is_removed: false,
            },
          ],
        },
      ],
      latest_version: {
        id: 'v2',
        issue_id: 'issue-002',
        version_number: 1,
        version_name: 'V1',
        status: 'Reviewing',
        avatar_file_path: null,
        created_at: '2026-11-05T08:00:00Z',
        operations: [
          {
            id: 'op-b1',
            step_order: 10,
            workcenter_code: 'A20C',
            cycle_time_seconds: 53,
            is_removed: false,
          },
        ],
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (drawingReviewService.fetchDrawingReviewList as any).mockResolvedValue({
      data: mockIssues,
      error: null,
    });
  });

  it('1. Column headers match updated names: PICTURE, PRODUCT, STATUS, etc.', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('PE-MFG')}>
        <MemoryRouter>
          <DrawingReviewListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      // 1. Picture (not ẢNH)
      expect(screen.getByRole('columnheader', { name: 'PICTURE' })).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'ẢNH' })).toBeNull();

      // 2. ISSUE NO
      expect(screen.getByRole('columnheader', { name: 'ISSUE NO' })).toBeInTheDocument();

      // 3. PRODUCT (not Product code)
      expect(screen.getByRole('columnheader', { name: 'PRODUCT' })).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Product code' })).toBeNull();

      // 4. CUSTOMER
      expect(screen.getByRole('columnheader', { name: 'CUSTOMER' })).toBeInTheDocument();

      // 5. ROUTING
      expect(screen.getByRole('columnheader', { name: 'ROUTING' })).toBeInTheDocument();

      // 6. ISSUE DATE
      expect(screen.getByRole('columnheader', { name: 'ISSUE DATE' })).toBeInTheDocument();

      // 7. VERSION
      expect(screen.getByRole('columnheader', { name: 'VERSION' })).toBeInTheDocument();

      // 8. STATUS (not Trạng thái)
      expect(screen.getByRole('columnheader', { name: 'STATUS' })).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Trạng thái' })).toBeNull();

      // 9. No THAO TÁC header
      expect(screen.queryByRole('columnheader', { name: /Thao tác/i })).toBeNull();
    });
  });

  it('2. Routing format: NO OP10, NO arrows, 3-column processes, NO total CT', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('PE-MFG')}>
        <MemoryRouter>
          <DrawingReviewListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      // Processes are rendered
      expect(screen.getByText('CNC-01')).toBeInTheDocument();
      expect(screen.getByText('(110s)')).toBeInTheDocument();
      expect(screen.getByText('SUBCON')).toBeInTheDocument();
      expect(screen.getByText('QC')).toBeInTheDocument();
      expect(screen.getByText('(30s)')).toBeInTheDocument();

      // Verify NO OP10 step numbers
      expect(screen.queryByText('10.')).toBeNull();
      expect(screen.queryByText('20.')).toBeNull();
      expect(screen.queryByText('30.')).toBeNull();

      // Verify NO arrows '→'
      expect(screen.queryByText('→')).toBeNull();

      // Verify NO total CT 'Tổng CT'
      expect(screen.queryByText(/Tổng CT/i)).toBeNull();
    });
  });

  it('3. Clicking Picture opens full drawing zoom & pan modal', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('PE-MFG')}>
        <MemoryRouter>
          <DrawingReviewListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('picture-preview-trigger-261104-N003')).toBeInTheDocument();
    });

    // Click the picture
    fireEvent.click(screen.getByTestId('picture-preview-trigger-261104-N003'));

    // Modal should appear with drawing viewer
    await waitFor(() => {
      expect(screen.getByTestId('full-drawing-preview-modal')).toBeInTheDocument();
      expect(screen.getByTestId('close-full-drawing-modal-btn')).toBeInTheDocument();
    });

    // Close modal
    fireEvent.click(screen.getByTestId('close-full-drawing-modal-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('full-drawing-preview-modal')).toBeNull();
    });
  });

  it('4. Filters: Issue No (Equal and Contain)', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('PE-MFG')}>
        <MemoryRouter>
          <DrawingReviewListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('261104-N003')).toBeInTheDocument();
      expect(screen.getByText('261105-N001')).toBeInTheDocument();
    });

    // Dynamically enable Issue No filter field
    fireEvent.click(screen.getByTestId('add-filter-button'));
    fireEvent.click(screen.getByTestId('toggle-filter-issue_no'));

    // Contain filter
    const input = screen.getByTestId('filter-issue-no-input');
    fireEvent.change(input, { target: { value: 'N003' } });

    expect(screen.getByText('261104-N003')).toBeInTheDocument();
    expect(screen.queryByText('261105-N001')).toBeNull();

    // Equal mode with partial string should match nothing
    const modeSelect = screen.getByTestId('issue-no-mode-select');
    fireEvent.change(modeSelect, { target: { value: 'equal' } });
    expect(screen.queryByText('261104-N003')).toBeNull();

    // Equal mode with exact string should match
    fireEvent.change(input, { target: { value: '261104-N003' } });
    expect(screen.getByText('261104-N003')).toBeInTheDocument();
  });

  it('5. Filters: Process from Routing (Equal and Contain)', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('PE-MFG')}>
        <MemoryRouter>
          <DrawingReviewListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('261104-N003')).toBeInTheDocument();
      expect(screen.getByText('261105-N001')).toBeInTheDocument();
    });

    // Dynamically enable Process filter field
    fireEvent.click(screen.getByTestId('add-filter-button'));
    fireEvent.click(screen.getByTestId('toggle-filter-process'));

    // Filter by process 'A20C'
    const processInput = screen.getByTestId('filter-process-input');
    fireEvent.change(processInput, { target: { value: 'A20C' } });

    // Issue 002 has A20C, Issue 001 does not
    expect(screen.queryByText('261104-N003')).toBeNull();
    expect(screen.getByText('261105-N001')).toBeInTheDocument();

    // Reset filters
    fireEvent.click(screen.getByTestId('reset-filters-btn'));
    expect(screen.getByText('261104-N003')).toBeInTheDocument();
    expect(screen.getByText('261105-N001')).toBeInTheDocument();
  });

  it('6. 1-Row layout & sticky frozen header: renders compact toolbar and sticky table header', async () => {
    const { container } = render(
      <AuthContext.Provider value={createMockAuth('PE-MFG')}>
        <MemoryRouter>
          <DrawingReviewListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('261104-N003')).toBeInTheDocument();
    });

    // 1-Row add filter button exists
    expect(screen.getByTestId('add-filter-button')).toBeInTheDocument();

    // Table container has scrollable overflow-y-auto
    const tableContainer = screen.getByTestId('drawing-review-table-container');
    expect(tableContainer).toBeInTheDocument();
    expect(tableContainer.className).toContain('overflow-y-auto');

    // thead has sticky top-0
    const thead = container.querySelector('thead');
    expect(thead).toBeInTheDocument();
    expect(thead?.className).toContain('sticky');
    expect(thead?.className).toContain('top-0');
  });

  it('7. Desktop hover on Picture thumbnail shows enlarged preview with Item No & Item Name', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('PE-MFG')}>
        <MemoryRouter>
          <DrawingReviewListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('avatar-thumbnail-71006806A')).toBeInTheDocument();
    });

    const thumbnail = screen.getByTestId('avatar-thumbnail-71006806A');

    // Hover mouse over thumbnail
    fireEvent.mouseEnter(thumbnail);

    await waitFor(() => {
      const hoverPreview = screen.getByTestId('avatar-hover-preview-71006806A');
      expect(hoverPreview).toBeInTheDocument();
      expect(hoverPreview).toHaveTextContent('71006806A');
      expect(hoverPreview).toHaveTextContent('INLET FITTING');
      expect(hoverPreview).toHaveTextContent('Nhấp chuột để mở toàn bộ bản vẽ');
    });

    // Leave mouse from thumbnail
    fireEvent.mouseLeave(thumbnail);

    await waitFor(() => {
      expect(screen.queryByTestId('avatar-hover-preview-71006806A')).toBeNull();
    });
  });

  it('8. Mobile touch on Picture thumbnail: 1st tap enlarges, 2nd tap opens full drawing viewer', async () => {
    render(
      <AuthContext.Provider value={createMockAuth('PE-MFG')}>
        <MemoryRouter>
          <DrawingReviewListPage />
        </MemoryRouter>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('avatar-thumbnail-71006806A')).toBeInTheDocument();
    });

    const thumbnail = screen.getByTestId('avatar-thumbnail-71006806A');

    // Tap 1: touch tap opens floating preview with mobile instruction
    fireEvent.pointerDown(thumbnail, { pointerType: 'touch' });
    fireEvent.click(thumbnail);

    await waitFor(() => {
      expect(screen.getByTestId('avatar-hover-preview-71006806A')).toBeInTheDocument();
      expect(screen.getByTestId('avatar-mobile-backdrop-71006806A')).toBeInTheDocument();
      expect(screen.getByText('Chạm lần nữa để mở toàn bộ bản vẽ')).toBeInTheDocument();
    });

    // Tap 2: second touch opens full modal
    fireEvent.pointerDown(thumbnail, { pointerType: 'touch' });
    fireEvent.click(thumbnail);

    await waitFor(() => {
      expect(screen.getByTestId('full-drawing-preview-modal')).toBeInTheDocument();
      expect(screen.getByTestId('close-full-drawing-modal-btn')).toBeInTheDocument();
    });
  });
});

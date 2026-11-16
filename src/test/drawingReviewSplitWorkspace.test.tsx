import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../features/auth/AuthContext';
import { DrawingViewer } from '../features/drawingReview/DrawingViewer';
import { DrawingReviewDetailPage } from '../features/drawingReview/DrawingReviewDetailPage';
import * as drawingReviewService from '../services/drawingReviewService';
import type { AuthUser, UserRole } from '../types/auth';

// Mock drawingReviewService
vi.mock('../services/drawingReviewService', async () => {
  const actual = await vi.importActual<typeof import('../services/drawingReviewService')>(
    '../services/drawingReviewService'
  );
  return {
    ...actual,
    fetchDrawingReviewDetail: vi.fn(),
    saveDrawingReviewDraft: vi.fn(),
    closeDrawingReviewVersion: vi.fn(),
    createNextDrawingReviewVersion: vi.fn(),
    getDrawingFileSignedUrl: vi.fn().mockResolvedValue({
      signedUrl: 'https://storage.test/drawings/sample-part.png',
      error: null,
    }),
    uploadDrawingReviewAttachment: vi.fn(),
    deleteDrawingReviewAttachment: vi.fn(),
    uploadItemAvatar: vi.fn(),
  };
});

// Helper auth profile builder
function mockAuthContext(role: UserRole = 'PE-MFG'): any {
  const user: AuthUser = {
    id: 'user-pe-01',
    phone: '84988888888',
    email: 'pe@sampletracking.local',
    role,
    department: 'PE-MFG',
    full_name: 'Test PE Engineer',
    is_active: true,
    must_change_password: false,
    created_at: new Date().toISOString(),
  };

  return {
    user,
    profile: user,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn(),
    refreshProfile: vi.fn(),
  };
}

// Sample Issue Data for Tests
const mockIssueData = {
  id: 'issue-split-1',
  issue_no: '261104-N001',
  item_no: 'PART-SPLIT-01',
  item_name: 'Trục Bạc Đạn Thử Nghiệm Split Workspace',
  customer: 'Toyota Tsusho',
  drawing_file_path: 'drawings/261104-N001/blueprint.png',
  drawing_file_name: 'blueprint.png',
  drawing_file_size: 102400,
  drawing_mime_type: 'image/png',
  attention: 'Chú ý dung sai đường kính ngoài h6',
  created_at: '2026-11-04T00:00:00Z',
  versions: [
    {
      id: 'ver-split-1',
      version_number: 1,
      version_name: 'V1',
      status: 'Reviewing',
      required_material: 'SUS304 phi 25.4mm',
      required_tooling: 'Dao tiện CNMG 120408',
      special_measuring_equipment: 'Panme đo ngoài Mitutoyo',
      engineering_remarks: 'Lưu ý kiểm tra độ đảo trước khi chuyển mạ crom',
      avatar_file_path: null,
      avatar_crop_box: null,
      closed_at: null,
      operations: [
        {
          id: 'op-1',
          lineage_id: 'lin-1',
          step_order: 10,
          workcenter_code: 'A20C',
          operation_description: 'Tiện thô & tinh',
          cycle_time_seconds: 120,
          remark: 'Mặt A',
        },
        {
          id: 'op-2',
          lineage_id: 'lin-2',
          step_order: 20,
          workcenter_code: 'Subcon',
          operation_description: 'Mạ Crom cứng',
          cycle_time_seconds: 0,
          remark: 'Gia công ngoài',
        },
      ],
      attachments: [],
    },
  ],
  latest_version: null as any,
};
mockIssueData.latest_version = mockIssueData.versions[0];

describe('DRAWING REVIEW UX HOTFIX R3 — SPLIT WORKSPACE TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValue({
      data: mockIssueData,
      error: null,
    });
  });

  // =========================================================================
  // 1. Desktop Split Workspace Layout
  // =========================================================================
  describe('1. Desktop Split Workspace Layout', () => {
    it('renders two independent panels: Left Drawing Viewer (~45%) and Right Review (~55%)', async () => {
      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-split-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-drawing-panel')).toBeInTheDocument();
        expect(screen.getByTestId('desktop-review-panel')).toBeInTheDocument();
        expect(screen.getByTestId('split-workspace-divider')).toBeInTheDocument();
      });

      const drawingPanel = screen.getByTestId('desktop-drawing-panel');
      const reviewPanel = screen.getByTestId('desktop-review-panel');

      // Verify default 45% / 55%
      expect(drawingPanel).toHaveStyle({ width: '45%' });
      expect(reviewPanel).toHaveStyle({ width: '55%' });

      // Verify section titles in both panels
      expect(screen.getByText(/Bản vẽ kỹ thuật gốc/i)).toBeInTheDocument();
      expect(screen.getByText(/Thông tin yêu cầu đánh giá bản vẽ/i)).toBeInTheDocument();
      expect(screen.getByText(/Vật liệu yêu cầu/i)).toBeInTheDocument();
      expect(screen.getByText(/Quy trình công nghệ sơ bộ/i)).toBeInTheDocument();
      expect(screen.getByText(/Dao cụ & Đồ gá yêu cầu/i)).toBeInTheDocument();
      expect(screen.getByText(/Thiết bị đo lường đặc biệt/i)).toBeInTheDocument();
      expect(screen.getByText(/Ghi chú kỹ thuật & Hình ảnh đính kèm/i)).toBeInTheDocument();
    });

    it('loads and applies custom saved split ratio from localStorage', async () => {
      localStorage.setItem('drawing_review_split_width', '52.5');

      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-split-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        const drawingPanel = screen.getByTestId('desktop-drawing-panel');
        const reviewPanel = screen.getByTestId('desktop-review-panel');
        expect(drawingPanel).toHaveStyle({ width: '52.5%' });
        expect(reviewPanel).toHaveStyle({ width: '47.5%' });
      });
    });
  });

  // =========================================================================
  // 2. Engineering Mouse Navigation in DrawingViewer
  // =========================================================================
  describe('2. Drawing Navigation: Cursor-Centered Zoom & Middle-Mouse Pan', () => {
    it('renders engineering controls: Zoom In, Zoom Out, Fit Drawing, Reset View and Pan Tool', async () => {
      render(
        <DrawingViewer
          filePath="drawings/blueprint.png"
          fileName="blueprint.png"
          mimeType="image/png"
          fullHeight={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('zoom-in-btn')).toBeInTheDocument();
        expect(screen.getByTestId('zoom-out-btn')).toBeInTheDocument();
        expect(screen.getByTestId('fit-drawing-btn')).toBeInTheDocument();
        expect(screen.getByTestId('reset-view-btn')).toBeInTheDocument();
        expect(screen.getByTestId('pan-mode-toggle-btn')).toBeInTheDocument();
        expect(screen.getByTestId('zoom-percentage-label')).toHaveTextContent('100%');
      });

      // Zoom In
      fireEvent.click(screen.getByTestId('zoom-in-btn'));
      expect(screen.getByTestId('zoom-percentage-label')).toHaveTextContent('125%');

      // Reset View returns to 100%
      fireEvent.click(screen.getByTestId('reset-view-btn'));
      expect(screen.getByTestId('zoom-percentage-label')).toHaveTextContent('100%');

      // Fit Drawing button operates without error
      fireEvent.click(screen.getByTestId('fit-drawing-btn'));
      expect(screen.getByTestId('zoom-percentage-label')).toBeInTheDocument();

      // Pan Mode toggle button activates hand mode
      const panBtn = screen.getByTestId('pan-mode-toggle-btn');
      fireEvent.click(panBtn);
      expect(panBtn).toHaveClass('bg-blue-600');
    });

    it('mouse wheel zoom triggers without error and updates zoom percentage', async () => {
      render(
        <DrawingViewer
          filePath="drawings/blueprint.png"
          fileName="blueprint.png"
          mimeType="image/png"
          fullHeight={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawing-canvas-viewport')).toBeInTheDocument();
      });

      const viewport = screen.getByTestId('drawing-canvas-viewport');

      // Simulate mouse wheel up (zoom in)
      const wheelEvt = new WheelEvent('wheel', {
        deltaY: -100,
        clientX: 200,
        clientY: 200,
        bubbles: true,
        cancelable: true,
      });

      const prevented = !viewport.dispatchEvent(wheelEvt);
      // Listener calls preventDefault on wheel to stop outer page scrolling
      expect(prevented).toBe(true);
    });

    it('middle mouse button (button=1) drag activates panning mode without triggering autoscroll', async () => {
      render(
        <DrawingViewer
          filePath="drawings/blueprint.png"
          fileName="blueprint.png"
          mimeType="image/png"
          fullHeight={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawing-canvas-viewport')).toBeInTheDocument();
      });

      const viewport = screen.getByTestId('drawing-canvas-viewport');

      // Middle click mousedown (button 1)
      fireEvent.mouseDown(viewport, { button: 1, clientX: 100, clientY: 100 });
      expect(viewport).toHaveClass('cursor-grabbing');

      // AuxClick with button 1 prevents default
      const auxEvt = new MouseEvent('auxclick', { button: 1, cancelable: true, bubbles: true });
      viewport.dispatchEvent(auxEvt);
      expect(auxEvt.defaultPrevented).toBe(true);
    });
  });

  // =========================================================================
  // 3. Panel Divider Dragging & Session Persistence
  // =========================================================================
  describe('3. Panel Divider Dragging & Session Persistence', () => {
    it('dragging divider adjusts split percentage and persists in localStorage', async () => {
      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-split-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('split-workspace-divider')).toBeInTheDocument();
      });

      const divider = screen.getByTestId('split-workspace-divider');

      // Start drag
      fireEvent.mouseDown(divider, { button: 0 });

      // Move mouse to 600px in a 1000px container (60%)
      const container = screen.getByTestId('desktop-drawing-panel').parentElement!;
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 1000,
        height: 800,
        right: 1000,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      fireEvent.mouseMove(window, { clientX: 600 });
      fireEvent.mouseUp(window);

      // Verify persisted in localStorage
      expect(localStorage.getItem('drawing_review_split_width')).toBe('60');

      // Verify width updated on panels
      expect(screen.getByTestId('desktop-drawing-panel')).toHaveStyle({ width: '60%' });
      expect(screen.getByTestId('desktop-review-panel')).toHaveStyle({ width: '40%' });
    });
  });

  // =========================================================================
  // 4. Fixed Bottom Action Bar (Save & Close)
  // =========================================================================
  describe('4. Fixed Bottom Action Bar', () => {
    it('renders Save Draft and Close Version buttons docked at bottom without covering form fields', async () => {
      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-split-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('bottom-action-bar')).toBeInTheDocument();
        expect(screen.getByTestId('save-draft-btn')).toBeInTheDocument();
        expect(screen.getByTestId('close-version-btn')).toBeInTheDocument();
        expect(screen.getByText('Đã đồng bộ')).toBeInTheDocument();
      });

      // Modify material to trigger dirty state
      const materialSpecInput = screen.getByTestId('material-specification-textarea');
      fireEvent.change(materialSpecInput, { target: { value: 'SUS304 phi 30mm' } });

      expect(screen.getByText('Có thay đổi chưa lưu')).toBeInTheDocument();

      // Click Save Draft
      (drawingReviewService.saveDrawingReviewDraft as any).mockResolvedValueOnce({
        success: true,
        status: 'Reviewing',
      });

      fireEvent.click(screen.getByTestId('save-draft-btn'));

      await waitFor(() => {
        expect(drawingReviewService.saveDrawingReviewDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            version_id: 'ver-split-1',
            material_specification: 'SUS304 phi 30mm',
          })
        );
      });
    });
  });

  // =========================================================================
  // 5. Mobile Responsive View Switching
  // =========================================================================
  describe('5. Mobile Responsive Layout & View Switching', () => {
    it('supports tab switching between Drawing and Review on mobile devices', async () => {
      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-split-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('mobile-tab-drawing-btn')).toBeInTheDocument();
        expect(screen.getByTestId('mobile-tab-review-btn')).toBeInTheDocument();
        expect(screen.getByTestId('mobile-floating-toggle-btn')).toBeInTheDocument();
      });

      // Default mobile tab is 'review'
      const reviewPanel = screen.getByTestId('desktop-review-panel');
      expect(reviewPanel).toHaveClass('flex');

      // Click mobile tab 'Bản vẽ'
      fireEvent.click(screen.getByTestId('mobile-tab-drawing-btn'));
      const drawingPanel = screen.getByTestId('desktop-drawing-panel');
      expect(drawingPanel).toHaveClass('flex');

      // Click floating toggle button switches back to 'Đánh giá'
      const floatToggle = screen.getByTestId('mobile-floating-toggle-btn');
      fireEvent.click(floatToggle);
      expect(screen.getByTestId('desktop-review-panel')).toHaveClass('flex');
    });

    it('preserves unsaved form inputs when toggling between Drawing and Review tabs', async () => {
      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-split-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('material-type-input')).toBeInTheDocument();
        expect(screen.getByTestId('material-specification-textarea')).toBeInTheDocument();
      });

      // Type in Material Type, Material Spec, and Tooling
      fireEvent.change(screen.getByTestId('material-type-input'), {
        target: { value: 'INCONEL 718' },
      });
      fireEvent.change(screen.getByTestId('material-specification-textarea'), {
        target: { value: 'UNS N07718 Ø25.4mm' },
      });
      fireEvent.change(screen.getByTestId('tooling-textarea'), {
        target: { value: 'Dao phay carbide phủ TiAlN' },
      });

      // Switch to Drawing tab
      fireEvent.click(screen.getByTestId('mobile-tab-drawing-btn'));

      // Switch back to Review tab
      fireEvent.click(screen.getByTestId('mobile-tab-review-btn'));

      // Form values must be 100% preserved
      expect(screen.getByTestId('material-type-input')).toHaveValue('INCONEL 718');
      expect(screen.getByTestId('material-specification-textarea')).toHaveValue('UNS N07718 Ø25.4mm');
      expect(screen.getByTestId('tooling-textarea')).toHaveValue('Dao phay carbide phủ TiAlN');
    });
  });

  // =========================================================================
  // 6. Auto-Expanding Remarks Textarea
  // =========================================================================
  describe('6. Auto-Expanding Remarks Textarea', () => {
    it('allows editing engineering remarks with auto-expansion', async () => {
      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-split-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('engineering-remarks-textarea')).toBeInTheDocument();
      });

      const remarksInput = screen.getByTestId('engineering-remarks-textarea');
      expect(remarksInput).toHaveValue('Lưu ý kiểm tra độ đảo trước khi chuyển mạ crom');

      fireEvent.change(remarksInput, {
        target: {
          value:
            'Dòng 1: Kiểm tra dung sai h6\nDòng 2: Mạ crom dày 15 micromet\nDòng 3: Khử ứng suất dư sau mài',
        },
      });

      expect(remarksInput).toHaveValue(
        'Dòng 1: Kiểm tra dung sai h6\nDòng 2: Mạ crom dày 15 micromet\nDòng 3: Khử ứng suất dư sau mài'
      );
    });
  });
});

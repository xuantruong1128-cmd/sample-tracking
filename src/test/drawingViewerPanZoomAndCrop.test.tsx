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
      signedUrl: 'https://storage.test/drawings/sample-blueprint.png',
      error: null,
    }),
    uploadDrawingReviewAttachment: vi.fn(),
    deleteDrawingReviewAttachment: vi.fn(),
    uploadItemAvatar: vi.fn().mockResolvedValue({
      avatarFilePath: 'avatars/ver-1_avatar.jpg',
      error: null,
    }),
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

const mockIssueData = {
  id: 'issue-pz-1',
  issue_no: '261106-P001',
  item_no: 'PIN-SHAFT-01',
  item_name: 'Chốt Trục Điều Khiển Máy Phay',
  customer: 'Honda Precision',
  drawing_file_path: 'drawings/261106-P001/blueprint.png',
  drawing_file_name: 'blueprint.png',
  drawing_file_size: 102400,
  drawing_mime_type: 'image/png',
  attention: 'Lưu ý độ bóng bề mặt Ra 0.8',
  created_at: '2026-11-06T00:00:00Z',
  versions: [
    {
      id: 'ver-pz-1',
      version_number: 1,
      version_name: 'V1',
      status: 'Reviewing',
      required_material: 'SCM440 phi 30mm',
      required_tooling: 'Dao tiện Kyocera',
      special_measuring_equipment: 'Đồng hồ so',
      engineering_remarks: 'Lưu ý kiểm tra nhiệt luyện',
      avatar_file_path: null,
      avatar_crop_box: null,
      closed_at: null,
      operations: [
        {
          id: 'op-1',
          lineage_id: 'lin-1',
          step_order: 10,
          workcenter_code: 'CNC-01',
          operation_description: 'Tiện ngoài',
          cycle_time_seconds: 60,
          remark: null,
        },
      ],
    },
  ],
};

describe('DRAWING VIEWER ZOOM, PAN & AVATAR CROP TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (drawingReviewService.fetchDrawingReviewDetail as any).mockResolvedValue({
      data: mockIssueData,
      error: null,
    });
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/dummy-drawing-blob');
    global.URL.revokeObjectURL = vi.fn();
  });

  // =========================================================================
  // 1. Left Mouse Pan (Button 0) & Middle Mouse Pan (Button 1)
  // =========================================================================
  describe('1. Left Mouse Drag Panning & Mouse Wheel Zooming', () => {
    it('activates pan mode directly upon left mouse button down (button 0) and updates cursor', async () => {
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

      // Default cursor class is cursor-grab or cursor-default
      expect(viewport).not.toHaveClass('cursor-grabbing');

      // Left-click (button 0) mouse down
      fireEvent.mouseDown(viewport, { button: 0, clientX: 200, clientY: 200 });

      // Cursor changes to cursor-grabbing
      expect(viewport).toHaveClass('cursor-grabbing');

      // Drag mouse
      fireEvent.mouseMove(window, { clientX: 250, clientY: 270 });

      // Mouse up releases dragging
      fireEvent.mouseUp(window);
      expect(viewport).not.toHaveClass('cursor-grabbing');
    });

    it('activates pan mode on middle mouse button down (button 1) as well', async () => {
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

      // Middle-click (button 1) mouse down
      fireEvent.mouseDown(viewport, { button: 1, clientX: 150, clientY: 150 });
      expect(viewport).toHaveClass('cursor-grabbing');

      fireEvent.mouseUp(window);
      expect(viewport).not.toHaveClass('cursor-grabbing');
    });

    it('zooms using mouse wheel and resets to 100%', async () => {
      render(
        <DrawingViewer
          filePath="drawings/blueprint.png"
          fileName="blueprint.png"
          mimeType="image/png"
          fullHeight={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('zoom-percentage-label')).toHaveTextContent('100%');
      });

      const viewport = screen.getByTestId('drawing-canvas-viewport');

      // Wheel scroll
      const wheelEvt = new WheelEvent('wheel', {
        deltaY: -100,
        clientX: 200,
        clientY: 200,
        bubbles: true,
        cancelable: true,
      });
      viewport.dispatchEvent(wheelEvt);

      // Reset button resets to 100%
      const resetBtn = screen.getByTestId('reset-view-btn');
      fireEvent.click(resetBtn);
      expect(screen.getByTestId('zoom-percentage-label')).toHaveTextContent('100%');
    });

    it('supports single-finger touch pan and pinch-to-zoom on mobile', async () => {
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

      // Touch start (1 finger)
      fireEvent.touchStart(viewport, {
        touches: [{ clientX: 100, clientY: 100 }],
      });
      expect(viewport).toHaveClass('cursor-grabbing');

      // Touch move
      fireEvent.touchMove(viewport, {
        touches: [{ clientX: 140, clientY: 160 }],
      });

      // Touch end
      fireEvent.touchEnd(viewport);
      expect(viewport).not.toHaveClass('cursor-grabbing');
    });
  });

  // =========================================================================
  // 2. Direct Drawing Crop to Avatar (No upload / camera forced)
  // =========================================================================
  describe('2. Direct Drawing Crop to Avatar', () => {
    it('opens ImageEditorModal directly when clicking crop avatar on image drawing', async () => {
      // Mock global fetch returning binary blob for drawing image
      global.fetch = vi.fn().mockResolvedValue({
        blob: vi.fn().mockResolvedValue(new Blob(['image-bytes'], { type: 'image/png' })),
      } as any);

      const handleCrop = vi.fn();
      render(
        <DrawingViewer
          filePath="drawings/blueprint.png"
          fileName="blueprint.png"
          mimeType="image/png"
          canCropAvatar={true}
          onAvatarCropped={handleCrop}
        />
      );

      await waitFor(() => {
        const cropBtn = screen.getByTestId('crop-avatar-btn');
        expect(cropBtn).toBeInTheDocument();
      });

      // Click "Cắt ảnh đại diện" on toolbar
      fireEvent.click(screen.getByTestId('crop-avatar-btn'));

      // Directly opens ImageEditorModal without showing PDF upload picker
      await waitFor(() => {
        expect(screen.getByText(/Chỉnh sửa & Tối ưu ảnh/i)).toBeInTheDocument();
        expect(screen.getByText(/Bản vẽ kỹ thuật/i)).toBeInTheDocument();
        expect(screen.getByText(/Xong & Tải lên/i)).toBeInTheDocument();
      });

      // Modal has free-crop handles and controls
      expect(screen.getByText(/Xoay 90°/i)).toBeInTheDocument();
    });

    it('displays "Cắt từ bản vẽ" button in Avatar section of DrawingReviewDetailPage', async () => {
      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-pz-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText('PIN-SHAFT-01')).toBeInTheDocument();
      });

      // Avatar card contains prominent "Cắt từ bản vẽ" button
      const cropDrawingBtn = screen.getByTestId('crop-drawing-avatar-card-btn');
      expect(cropDrawingBtn).toBeInTheDocument();
      expect(cropDrawingBtn).toHaveTextContent('Cắt từ bản vẽ');

      // Also contains secondary optional buttons
      expect(screen.getByTestId('upload-direct-avatar-btn')).toBeInTheDocument();
      expect(screen.getByTestId('camera-direct-avatar-btn')).toBeInTheDocument();
    });

    it('clicking "Cắt từ bản vẽ" triggers drawing crop directly from avatar card', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        blob: vi.fn().mockResolvedValue(new Blob(['blueprint-bytes'], { type: 'image/png' })),
      } as any);

      render(
        <AuthContext.Provider value={mockAuthContext('PE-MFG')}>
          <MemoryRouter initialEntries={['/drawing-reviews/issue-pz-1']}>
            <Routes>
              <Route path="/drawing-reviews/:id" element={<DrawingReviewDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('crop-drawing-avatar-card-btn')).toBeInTheDocument();
      });

      // Click "Cắt từ bản vẽ" on avatar card
      fireEvent.click(screen.getByTestId('crop-drawing-avatar-card-btn'));

      // Image editor modal opens directly with the drawing
      await waitFor(() => {
        expect(screen.getByText(/Chỉnh sửa & Tối ưu ảnh/i)).toBeInTheDocument();
        expect(screen.getByText('Bỏ qua Crop')).toBeInTheDocument();
      });
    });
  });
});

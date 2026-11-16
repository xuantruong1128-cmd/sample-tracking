import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ImageEditorModal } from '../components/common/ImageEditorModal';
import * as imgProc from '../lib/imageProcessing';

describe('DRAWING REVIEW HOTFIX R2 — Free-Form Rectangular Cropping Test Suite', () => {
  const dummyFile = new File(['dummy-image-binary-data'], 'technical_drawing_dwg01.jpg', {
    type: 'image/jpeg',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/dummy-dwg-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('renders modal with full title, zoom, pan, rotation, presets, and action buttons', () => {
    render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="drawing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText(/Chỉnh sửa & Tối ưu ảnh/i)).toBeInTheDocument();
    expect(screen.getByText(/Bản vẽ kỹ thuật/i)).toBeInTheDocument();
    expect(screen.getByText(/Xoay 90°/i)).toBeInTheDocument();
    expect(screen.getByText(/Đặt lại/i)).toBeInTheDocument();
    expect(screen.getByText(/Bỏ qua Crop/i)).toBeInTheDocument();
    expect(screen.getByText(/Di chuyển/i)).toBeInTheDocument();
    expect(screen.getByText('Hủy')).toBeInTheDocument();
    expect(screen.getByText(/Xong & Tải lên/i)).toBeInTheDocument();
  });

  it('supports free-form resizing from all four corners and four edges without aspect ratio locking', () => {
    const { container } = render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="drawing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    // Verify presence of all 4 corner handles and 4 edge handles
    expect(container.querySelector('[title="Kéo góc trên-trái"]')).toBeInTheDocument();
    expect(container.querySelector('[title="Kéo góc trên-phải"]')).toBeInTheDocument();
    expect(container.querySelector('[title="Kéo góc dưới-trái"]')).toBeInTheDocument();
    expect(container.querySelector('[title="Kéo góc dưới-phải"]')).toBeInTheDocument();
    expect(container.querySelector('[title="Kéo cạnh trên (điều chỉnh dọc)"]')).toBeInTheDocument();
    expect(container.querySelector('[title="Kéo cạnh dưới (điều chỉnh dọc)"]')).toBeInTheDocument();
    expect(container.querySelector('[title="Kéo cạnh trái (điều chỉnh ngang)"]')).toBeInTheDocument();
    expect(container.querySelector('[title="Kéo cạnh phải (điều chỉnh ngang)"]')).toBeInTheDocument();
    expect(container.querySelector('[title="Kéo bên trong để di chuyển khung cắt"]')).toBeInTheDocument();
  });

  it('handles vertical resizing from top handle (North) smoothly', () => {
    const { container } = render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="drawing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const northHandle = container.querySelector('[title="Kéo cạnh trên (điều chỉnh dọc)"]') as HTMLElement;
    expect(northHandle).toBeInTheDocument();

    // Mock stage bounding rect
    const stageEl = northHandle.closest('.relative.select-none') as HTMLElement;
    if (stageEl) {
      vi.spyOn(stageEl, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 100,
        right: 900,
        bottom: 700,
        width: 800,
        height: 600,
        x: 100,
        y: 100,
        toJSON: () => {},
      });
    }

    // Pointer down on North handle
    fireEvent.pointerDown(northHandle, { clientX: 500, clientY: 100 });

    // Drag pointer down by 150px (vertical resize)
    fireEvent.pointerMove(window, { clientX: 500, clientY: 250 });
    fireEvent.pointerUp(window);

    // Check that crop box adjusted its top dimension
    const cropBox = container.querySelector('[title="Kéo bên trong để di chuyển khung cắt"]') as HTMLElement;
    expect(cropBox).toBeInTheDocument();
  });

  it('handles vertical resizing from bottom handle (South) smoothly', () => {
    const { container } = render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="drawing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const southHandle = container.querySelector('[title="Kéo cạnh dưới (điều chỉnh dọc)"]') as HTMLElement;
    expect(southHandle).toBeInTheDocument();

    // Pointer down on South handle
    fireEvent.pointerDown(southHandle, { clientX: 500, clientY: 700 });

    // Drag pointer up by 200px (vertical reduction)
    fireEvent.pointerMove(window, { clientX: 500, clientY: 500 });
    fireEvent.pointerUp(window);

    const cropBox = container.querySelector('[title="Kéo bên trong để di chuyển khung cắt"]') as HTMLElement;
    expect(cropBox).toBeInTheDocument();
  });

  it('handles horizontal resizing from left (West) and right (East) handles', () => {
    const { container } = render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="drawing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const eastHandle = container.querySelector('[title="Kéo cạnh phải (điều chỉnh ngang)"]') as HTMLElement;
    const westHandle = container.querySelector('[title="Kéo cạnh trái (điều chỉnh ngang)"]') as HTMLElement;
    expect(eastHandle).toBeInTheDocument();
    expect(westHandle).toBeInTheDocument();

    // Drag East
    fireEvent.pointerDown(eastHandle, { clientX: 900, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 400 });
    fireEvent.pointerUp(window);

    // Drag West
    fireEvent.pointerDown(westHandle, { clientX: 100, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 250, clientY: 400 });
    fireEvent.pointerUp(window);

    const cropBox = container.querySelector('[title="Kéo bên trong để di chuyển khung cắt"]') as HTMLElement;
    expect(cropBox).toBeInTheDocument();
  });

  it('supports dragging inside the crop rectangle to reposition it (Move mode)', () => {
    const { container } = render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="drawing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const cropBox = container.querySelector('[title="Kéo bên trong để di chuyển khung cắt"]') as HTMLElement;
    expect(cropBox).toBeInTheDocument();

    // Drag box
    fireEvent.pointerDown(cropBox, { clientX: 500, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 550, clientY: 450 });
    fireEvent.pointerUp(window);

    expect(cropBox).toBeInTheDocument();
  });

  it('allows applying preset shapes (16:9 landscape, 3:4 portrait, 1:1 square, full)', () => {
    render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="drawing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const btn169 = screen.getByTitle('Khung ngang 16:9');
    const btn34 = screen.getByTitle('Khung dọc 3:4');
    const btn11 = screen.getByTitle('Khung vuông 1:1');
    const btnFull = screen.getByTitle('Cắt toàn bộ ảnh');

    expect(btn169).toBeInTheDocument();
    expect(btn34).toBeInTheDocument();
    expect(btn11).toBeInTheDocument();
    expect(btnFull).toBeInTheDocument();

    fireEvent.click(btn169);
    fireEvent.click(btn34);
    fireEvent.click(btn11);
    fireEvent.click(btnFull);
  });

  it('enables Zoom and Pan mode for high-resolution drawing inspection', () => {
    render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="drawing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const panBtn = screen.getByTitle(/Công cụ Di chuyển \(Pan\) khi phóng to/i);
    expect(panBtn).toBeInTheDocument();

    fireEvent.click(panBtn);
    expect(panBtn.className).toContain('text-blue-300');

    const zoomInBtn = screen.getByTitle('Phóng to');
    fireEvent.click(zoomInBtn);
    expect(screen.getByText('120%')).toBeInTheDocument();

    // Vừa khung button should appear when zoomed
    const fitBtn = screen.getByTitle(/Vừa màn hình/i);
    expect(fitBtn).toBeInTheDocument();
    fireEvent.click(fitBtn);

    // Zoom resets
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('rotates 90 degrees and updates rotation label', () => {
    render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="drawing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const rotateBtn = screen.getByText(/Xoay 90°/i);
    fireEvent.click(rotateBtn);

    // Header updates with rotation angle
    expect(screen.getByText(/Đã xoay 90°/i)).toBeInTheDocument();

    fireEvent.click(rotateBtn);
    expect(screen.getByText(/Đã xoay 180°/i)).toBeInTheDocument();

    const resetBtn = screen.getByText(/Đặt lại/i);
    fireEvent.click(resetBtn);
    expect(screen.queryByText(/Đã xoay/i)).not.toBeInTheDocument();
  });

  describe('processImageClient coordinate mapping across rotations', () => {
    it('accurately maps normalized crop coordinates under 90° clockwise rotation', async () => {
      const mockImg = {
        naturalWidth: 2000,
        naturalHeight: 1000,
      } as HTMLImageElement;

      const mockCtx = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        fillStyle: '',
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        drawImage: vi.fn(),
      };

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        callback: BlobCallback
      ) {
        callback(new Blob(['blob'], { type: 'image/jpeg' }));
      });

      // User sees rotated image (1000w x 2000h) and selects a rectangle:
      // x: 0.1 (100px), y: 0.2 (400px), width: 0.3 (300px), height: 0.4 (800px)
      await imgProc.processImageClient(dummyFile, {
        category: 'drawing',
        rotation: 90,
        crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        isNormalizedCrop: true,
        imageElement: mockImg,
      });

      expect(mockCtx.drawImage).toHaveBeenCalled();
      const drawArgs = mockCtx.drawImage.mock.calls[0];
      // drawImage(img, cropX, cropY, cropW, cropH, ...)
      // For 90° rotation:
      // cropX = round(ny * naturalW) = round(0.2 * 2000) = 400
      // cropW = round(nh * naturalW) = round(0.4 * 2000) = 800
      // cropY = round((1 - nx - nw) * naturalH) = round((1 - 0.1 - 0.3) * 1000) = 600
      // cropH = round(nw * naturalH) = round(0.3 * 1000) = 300
      expect(drawArgs[1]).toBe(400); // cropX
      expect(drawArgs[2]).toBe(600); // cropY
      expect(drawArgs[3]).toBe(800); // cropW
      expect(drawArgs[4]).toBe(300); // cropH

      vi.restoreAllMocks();
    });

    it('accurately maps normalized crop coordinates under 180° rotation', async () => {
      const mockImg = {
        naturalWidth: 2000,
        naturalHeight: 1000,
      } as HTMLImageElement;

      const mockCtx = {
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        drawImage: vi.fn(),
      };

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        callback: BlobCallback
      ) {
        callback(new Blob(['blob'], { type: 'image/jpeg' }));
      });

      // Crop: x: 0.1, y: 0.2, w: 0.5, h: 0.4
      await imgProc.processImageClient(dummyFile, {
        category: 'drawing',
        rotation: 180,
        crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
        isNormalizedCrop: true,
        imageElement: mockImg,
      });

      expect(mockCtx.drawImage).toHaveBeenCalled();
      const drawArgs = mockCtx.drawImage.mock.calls[0];
      // For 180°:
      // cropX = round((1 - 0.1 - 0.5) * 2000) = 800
      // cropW = round(0.5 * 2000) = 1000
      // cropY = round((1 - 0.2 - 0.4) * 1000) = 400
      // cropH = round(0.4 * 1000) = 400
      expect(drawArgs[1]).toBe(800);
      expect(drawArgs[2]).toBe(400);
      expect(drawArgs[3]).toBe(1000);
      expect(drawArgs[4]).toBe(400);

      vi.restoreAllMocks();
    });

    it('accurately maps normalized crop coordinates under 270° clockwise rotation', async () => {
      const mockImg = {
        naturalWidth: 2000,
        naturalHeight: 1000,
      } as HTMLImageElement;

      const mockCtx = {
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        drawImage: vi.fn(),
      };

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        callback: BlobCallback
      ) {
        callback(new Blob(['blob'], { type: 'image/jpeg' }));
      });

      // Crop: x: 0.1, y: 0.2, w: 0.3, h: 0.4
      await imgProc.processImageClient(dummyFile, {
        category: 'drawing',
        rotation: 270,
        crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        isNormalizedCrop: true,
        imageElement: mockImg,
      });

      expect(mockCtx.drawImage).toHaveBeenCalled();
      const drawArgs = mockCtx.drawImage.mock.calls[0];
      // For 270°:
      // cropX = round((1 - 0.2 - 0.4) * 2000) = 800
      // cropW = round(0.4 * 2000) = 800
      // cropY = round(0.1 * 1000) = 100
      // cropH = round(0.3 * 1000) = 300
      expect(drawArgs[1]).toBe(800);
      expect(drawArgs[2]).toBe(100);
      expect(drawArgs[3]).toBe(800);
      expect(drawArgs[4]).toBe(300);

      vi.restoreAllMocks();
    });
  });
});

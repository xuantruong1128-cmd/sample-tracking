import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ImageEditorModal } from '../components/common/ImageEditorModal';
import * as imgProc from '../lib/imageProcessing';

describe('SAMPLE TRACKING — ImageEditorModal Component Tests', () => {
  const dummyFile = new File(['dummy-image-binary-data'], 'test-sample.jpg', {
    type: 'image/jpeg',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock URL.createObjectURL and URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/dummy-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ImageEditorModal
        isOpen={false}
        file={dummyFile}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title, file size, zoom, rotate, reset, and action buttons when open', () => {
    render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="sample"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText(/Chỉnh sửa & Tối ưu ảnh/i)).toBeInTheDocument();
    expect(screen.getByText(/Ảnh hàng mẫu \(PE-MFG\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Xoay 90°/i)).toBeInTheDocument();
    expect(screen.getByText(/Đặt lại/i)).toBeInTheDocument();
    expect(screen.getByText(/Bỏ qua Crop/i)).toBeInTheDocument();
    expect(screen.getByText('Hủy')).toBeInTheDocument();
    expect(screen.getByText(/Xong & Tải lên/i)).toBeInTheDocument();
  });

  it('toggles "Bỏ qua Crop" state on click', () => {
    render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="ng"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const skipBtn = screen.getByText(/Bỏ qua Crop/i);
    fireEvent.click(skipBtn);
    expect(screen.getByText(/Đã bỏ qua Crop/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Đã bỏ qua Crop/i));
    expect(screen.getByText(/Bỏ qua Crop/i)).toBeInTheDocument();
  });

  it('displays "Giữ nguyên ảnh gốc" checkbox when category is drawing or allowOriginalOption is true', () => {
    render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="drawing"
        allowOriginalOption={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText(/Giữ nguyên ảnh gốc/i)).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText(/Giữ nguyên ảnh gốc \(/i)).toBeInTheDocument();
  });

  it('calls onClose when Hủy button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        onClose={handleClose}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Hủy'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('processes image and calls onConfirm on "Xong & Tải lên"', async () => {
    const mockProcessedFile = new File(['compressed-data'], 'test-sample.jpg', { type: 'image/jpeg' });
    const mockResult: imgProc.ProcessImageResult = {
      file: mockProcessedFile,
      originalSize: 5000000,
      processedSize: 350000,
      originalWidth: 4000,
      originalHeight: 3000,
      processedWidth: 2000,
      processedHeight: 1500,
      reductionPercent: 93,
      wasCompressed: true,
      mimeType: 'image/jpeg',
    };

    const spyProcess = vi.spyOn(imgProc, 'processImageClient').mockResolvedValue(mockResult);
    const handleConfirm = vi.fn();
    const handleClose = vi.fn();

    render(
      <ImageEditorModal
        isOpen={true}
        file={dummyFile}
        category="ng"
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    const submitBtn = screen.getByText(/Xong & Tải lên/i);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(spyProcess).toHaveBeenCalled();
      expect(handleConfirm).toHaveBeenCalledWith(mockProcessedFile, mockResult);
      expect(handleClose).toHaveBeenCalled();
    });
  });
});

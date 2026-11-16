import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CATEGORY_CONFIGS,
  formatFileSize,
  calculateScaledDimensions,
  isProcessableImage,
} from '../lib/imageProcessing';

describe('SAMPLE TRACKING — Image Processing Engine Unit Tests', () => {
  describe('DEFAULT_CATEGORY_CONFIGS Specifications', () => {
    it('Sample photo has maxDimension 1600 px and quality 0.85', () => {
      const config = DEFAULT_CATEGORY_CONFIGS.sample;
      expect(config.maxDimension).toBe(1600);
      expect(config.quality).toBe(0.85);
      expect(config.mimeType).toBe('image/jpeg');
    });

    it('NG photo has maxDimension 2000 px and quality 0.88', () => {
      const config = DEFAULT_CATEGORY_CONFIGS.ng;
      expect(config.maxDimension).toBe(2000);
      expect(config.quality).toBe(0.88);
      expect(config.mimeType).toBe('image/jpeg');
    });

    it('QA Check Sheet has maxDimension 2400 px and quality 0.90 for fine details', () => {
      const config = DEFAULT_CATEGORY_CONFIGS.check_sheet;
      expect(config.maxDimension).toBe(2400);
      expect(config.quality).toBe(0.90);
      expect(config.mimeType).toBe('image/jpeg');
    });

    it('Drawing has maxDimension 2400 px, quality 0.92, and allows original option', () => {
      const config = DEFAULT_CATEGORY_CONFIGS.drawing;
      expect(config.maxDimension).toBe(2400);
      expect(config.quality).toBe(0.92);
      expect(config.allowOriginalOption).toBe(true);
    });
  });

  describe('calculateScaledDimensions (No Upscaling Rule)', () => {
    it('scales down large landscape image proportionally within maxDimension', () => {
      // 4000x3000 -> max 2000 (NG photo)
      const res = calculateScaledDimensions(4000, 3000, 2000);
      expect(res.width).toBe(2000);
      expect(res.height).toBe(1500);
      expect(res.scale).toBe(0.5);
    });

    it('scales down large portrait image proportionally within maxDimension', () => {
      // 3000x4000 -> max 1600 (Sample photo)
      const res = calculateScaledDimensions(3000, 4000, 1600);
      expect(res.width).toBe(1200);
      expect(res.height).toBe(1600);
      expect(res.scale).toBe(0.4);
    });

    it('does NOT upscale smaller images (preserves original dimensions)', () => {
      // 800x600 with max 2000 should stay 800x600
      const res = calculateScaledDimensions(800, 600, 2000);
      expect(res.width).toBe(800);
      expect(res.height).toBe(600);
      expect(res.scale).toBe(1);
    });

    it('handles square images accurately', () => {
      const res = calculateScaledDimensions(3200, 3200, 1600);
      expect(res.width).toBe(1600);
      expect(res.height).toBe(1600);
      expect(res.scale).toBe(0.5);
    });
  });

  describe('formatFileSize helper', () => {
    it('formats bytes, KB, and MB accurately', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(500 * 1024)).toBe('500.0 KB');
      expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
      expect(formatFileSize(15.4 * 1024 * 1024)).toBe('15.40 MB');
    });
  });

  describe('isProcessableImage type guard', () => {
    it('identifies JPEG, PNG, WebP, HEIC as processable', () => {
      expect(isProcessableImage({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(true);
      expect(isProcessableImage({ type: 'image/png', name: 'screenshot.png' })).toBe(true);
      expect(isProcessableImage({ type: 'image/webp', name: 'image.webp' })).toBe(true);
      expect(isProcessableImage({ type: '', name: 'camera.HEIC' })).toBe(true);
      expect(isProcessableImage({ type: '', name: 'phone.heif' })).toBe(true);
    });

    it('rejects PDF, Excel, Word, and ZIP from auto-compression', () => {
      expect(isProcessableImage({ type: 'application/pdf', name: 'drawing.pdf' })).toBe(false);
      expect(isProcessableImage({ type: '', name: 'specs.pdf' })).toBe(false);
      expect(isProcessableImage({ type: 'application/vnd.ms-excel', name: 'report.xlsx' })).toBe(false);
      expect(isProcessableImage({ type: '', name: 'data.xls' })).toBe(false);
      expect(isProcessableImage({ type: '', name: 'archive.zip' })).toBe(false);
    });
  });

  describe('processImageClient logic and rules', () => {
    it('returns original file unmodified when keepOriginal is true', async () => {
      const originalFile = new File(['mock-binary-drawing'], 'machine_drawing.jpg', {
        type: 'image/jpeg',
      });

      const { processImageClient } = await import('../lib/imageProcessing');
      const result = await processImageClient(originalFile, {
        category: 'drawing',
        keepOriginal: true,
      });

      expect(result.wasCompressed).toBe(false);
      expect(result.file).toBe(originalFile);
      expect(result.reductionPercent).toBe(0);
    });

    it('skips compression when file size is under skip threshold, dimensions fit, and no crop/rotation', async () => {
      // 50KB image under 150KB threshold
      const smallContent = new Uint8Array(50 * 1024);
      const smallFile = new File([smallContent], 'tiny-photo.jpg', { type: 'image/jpeg' });

      const mockImg = {
        naturalWidth: 800,
        naturalHeight: 600,
      } as HTMLImageElement;

      const { processImageClient } = await import('../lib/imageProcessing');
      const result = await processImageClient(smallFile, {
        category: 'sample',
        rotation: 0,
        crop: null,
        imageElement: mockImg,
      });

      expect(result.wasCompressed).toBe(false);
      expect(result.file).toBe(smallFile);
      expect(result.processedWidth).toBe(800);
      expect(result.processedHeight).toBe(600);
    });

    it('executes canvas resize, crop, and compression within category constraints', async () => {
      const largeContent = new Uint8Array(12 * 1024 * 1024); // 12MB
      const largeFile = new File([largeContent], 'raw-camera-shot.jpg', { type: 'image/jpeg' });

      const mockImg = {
        naturalWidth: 4032,
        naturalHeight: 3024,
      } as HTMLImageElement;

      // Mock HTMLCanvasElement methods for jsdom
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
        callback: BlobCallback,
        type?: string,
        quality?: any
      ) {
        // Return 450 KB compressed blob
        const compressedBlob = new Blob([new Uint8Array(450 * 1024)], { type: type || 'image/jpeg' });
        callback(compressedBlob);
      });

      const { processImageClient } = await import('../lib/imageProcessing');
      const result = await processImageClient(largeFile, {
        category: 'sample', // max 1600, quality 0.85
        crop: { x: 0, y: 0, width: 1, height: 1 },
        isNormalizedCrop: true,
        rotation: 0,
        imageElement: mockImg,
      });

      expect(result.wasCompressed).toBe(true);
      expect(result.originalSize).toBe(12 * 1024 * 1024);
      expect(result.processedSize).toBe(450 * 1024);
      expect(result.processedWidth).toBe(1600);
      expect(result.processedHeight).toBe(1200);
      expect(result.reductionPercent).toBeGreaterThan(90);
      expect(result.file.name).toBe('raw-camera-shot.jpg');
      expect(result.file.type).toBe('image/jpeg');

      vi.restoreAllMocks();
    });
  });
});

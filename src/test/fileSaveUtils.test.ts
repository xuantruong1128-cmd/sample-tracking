import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadAndSaveReportFile } from '../utils/fileSaveUtils';

describe('fileSaveUtils - File System Access & Fallback Download', () => {
  const originalShowSaveFilePicker = (window as any).showSaveFilePicker;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalShowSaveFilePicker !== undefined) {
      (window as any).showSaveFilePicker = originalShowSaveFilePicker;
    } else {
      delete (window as any).showSaveFilePicker;
    }
    global.fetch = originalFetch;
  });

  describe('File System Access API (Modern Chromium Browsers)', () => {
    it('successfully streams PDF file to disk via showSaveFilePicker and pipeTo', async () => {
      const mockWritable = {
        write: vi.fn(),
        close: vi.fn(),
      };
      const mockFileHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      const mockShowSaveFilePicker = vi.fn().mockResolvedValue(mockFileHandle);
      (window as any).showSaveFilePicker = mockShowSaveFilePicker;

      const mockPipeTo = vi.fn().mockResolvedValue(undefined);
      const mockResponseBody = {
        pipeTo: mockPipeTo,
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: mockResponseBody,
      } as any);

      const mockGetSignedUrl = vi.fn().mockResolvedValue({
        signedUrl: 'https://example.com/storage/signed-pdf-url?token=abc',
        fileName: 'PART-001 - JOB-001.pdf',
      });

      const result = await downloadAndSaveReportFile({
        suggestedName: 'PART-001 - JOB-001.pdf',
        fileType: 'pdf',
        getSignedUrl: mockGetSignedUrl,
      });

      expect(mockShowSaveFilePicker).toHaveBeenCalledTimes(1);
      expect(mockShowSaveFilePicker).toHaveBeenCalledWith({
        suggestedName: 'PART-001 - JOB-001.pdf',
        types: [
          {
            description: 'Tài liệu PDF (Báo cáo nghiệm thu)',
            accept: { 'application/pdf': ['.pdf'] },
          },
        ],
      });

      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/storage/signed-pdf-url?token=abc');
      expect(mockFileHandle.createWritable).toHaveBeenCalledTimes(1);
      expect(mockPipeTo).toHaveBeenCalledWith(mockWritable);

      expect(result).toEqual({
        success: true,
        method: 'file-system-access',
      });
    });

    it('successfully streams ZIP file to disk with proper type filters', async () => {
      const mockWritable = {};
      const mockFileHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      const mockShowSaveFilePicker = vi.fn().mockResolvedValue(mockFileHandle);
      (window as any).showSaveFilePicker = mockShowSaveFilePicker;

      const mockPipeTo = vi.fn().mockResolvedValue(undefined);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: { pipeTo: mockPipeTo },
      } as any);

      const mockGetSignedUrl = vi.fn().mockResolvedValue({
        signedUrl: 'https://example.com/storage/signed-zip-url',
        fileName: 'PART-001 - JOB-001.zip',
      });

      const result = await downloadAndSaveReportFile({
        suggestedName: 'PART-001 - JOB-001.zip',
        fileType: 'zip',
        getSignedUrl: mockGetSignedUrl,
      });

      expect(mockShowSaveFilePicker).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestedName: 'PART-001 - JOB-001.zip',
          types: [
            {
              description: 'Tệp nén ZIP (Hồ sơ mẫu đầy đủ)',
              accept: { 'application/zip': ['.zip'] },
            },
          ],
        })
      );
      expect(result).toEqual({ success: true, method: 'file-system-access' });
    });

    it('gracefully handles user cancellation of Save As dialog (AbortError) without error', async () => {
      const abortError = new DOMException('The user aborted a request.', 'AbortError');
      const mockShowSaveFilePicker = vi.fn().mockRejectedValue(abortError);
      (window as any).showSaveFilePicker = mockShowSaveFilePicker;

      const mockGetSignedUrl = vi.fn();
      global.fetch = vi.fn();

      const result = await downloadAndSaveReportFile({
        suggestedName: 'PART-001 - JOB-001.pdf',
        fileType: 'pdf',
        getSignedUrl: mockGetSignedUrl,
      });

      expect(result).toEqual({
        success: false,
        cancelled: true,
        method: 'file-system-access',
      });

      // Crucial: No signed URL requested and no download performed after cancel
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws error when getSignedUrl fails with authorization error', async () => {
      const mockFileHandle = { createWritable: vi.fn() };
      (window as any).showSaveFilePicker = vi.fn().mockResolvedValue(mockFileHandle);

      const mockGetSignedUrl = vi.fn().mockResolvedValue({
        signedUrl: null,
        error: 'Quyền hạn bị từ chối: Chỉ Trưởng nhóm PE-MFG và Admin mới được phép tải tệp.',
      });

      await expect(
        downloadAndSaveReportFile({
          suggestedName: 'PART-001.pdf',
          fileType: 'pdf',
          getSignedUrl: mockGetSignedUrl,
        })
      ).rejects.toThrow('Quyền hạn bị từ chối: Chỉ Trưởng nhóm PE-MFG và Admin mới được phép tải tệp.');
    });

    it('throws error when storage download fetch returns non-200', async () => {
      const mockFileHandle = { createWritable: vi.fn() };
      (window as any).showSaveFilePicker = vi.fn().mockResolvedValue(mockFileHandle);

      const mockGetSignedUrl = vi.fn().mockResolvedValue({
        signedUrl: 'https://example.com/expired-url',
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as any);

      await expect(
        downloadAndSaveReportFile({
          suggestedName: 'PART-001.pdf',
          fileType: 'pdf',
          getSignedUrl: mockGetSignedUrl,
        })
      ).rejects.toThrow('Không thể tải tệp từ máy chủ lưu trữ (HTTP 404 Not Found).');
    });
  });

  describe('Browser Fallback Mode (Firefox, Safari, or Legacy Browsers)', () => {
    it('uses standard anchor download and triggers onFallbackUsed notification', async () => {
      delete (window as any).showSaveFilePicker;

      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');
      let createdAnchor: HTMLAnchorElement | null = null;

      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const el = originalCreateElement(tagName);
        if (tagName === 'a') {
          createdAnchor = el as HTMLAnchorElement;
          vi.spyOn(createdAnchor, 'click');
        }
        return el;
      });

      const onFallbackUsed = vi.fn();
      const mockGetSignedUrl = vi.fn().mockResolvedValue({
        signedUrl: 'https://example.com/storage/signed-fallback-url',
      });

      const result = await downloadAndSaveReportFile({
        suggestedName: 'FALLBACK - JOB-999.pdf',
        fileType: 'pdf',
        getSignedUrl: mockGetSignedUrl,
        onFallbackUsed,
      });

      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
      expect(createdAnchor).not.toBeNull();
      expect(createdAnchor?.href).toBe('https://example.com/storage/signed-fallback-url');
      expect(createdAnchor?.download).toBe('FALLBACK - JOB-999.pdf');
      expect(createdAnchor?.target).toBe('_blank');
      expect(createdAnchor?.rel).toBe('noopener noreferrer');
      expect(createdAnchor?.click).toHaveBeenCalledTimes(1);
      expect(appendChildSpy).toHaveBeenCalledWith(createdAnchor);
      expect(removeChildSpy).toHaveBeenCalledWith(createdAnchor);

      expect(onFallbackUsed).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Hỏi vị trí lưu từng tệp trước khi tải xuống'),
        })
      );

      expect(result).toEqual({
        success: true,
        method: 'browser-download',
      });
    });
  });
});

/**
 * Utility for downloading and saving files with File System Access API (Save As dialog)
 * and streaming support, with backward-compatible browser fallback.
 */

export interface SaveFileOptions {
  suggestedName: string;
  fileType: 'pdf' | 'zip';
  getSignedUrl: () => Promise<{ signedUrl?: string | null; error?: string | null; fileName?: string | null }>;
  onFallbackUsed?: (info: { message: string }) => void;
}

export interface SaveFileResult {
  success: boolean;
  cancelled?: boolean;
  error?: string | null;
  method: 'file-system-access' | 'browser-download';
}

/**
 * Downloads a file using File System Access API (showSaveFilePicker) when supported,
 * allowing the user to select destination folder and filename, and streams response chunks
 * directly to disk without memory buffering.
 *
 * Falls back gracefully on browsers lacking showSaveFilePicker (Firefox, Safari, etc.)
 * with guidance on browser Save As settings.
 */
export async function downloadAndSaveReportFile(options: SaveFileOptions): Promise<SaveFileResult> {
  const { suggestedName, fileType, getSignedUrl, onFallbackUsed } = options;

  const isFSAAvailable = typeof window !== 'undefined' && typeof (window as any).showSaveFilePicker === 'function';

  if (isFSAAvailable) {
    let fileHandle: any;

    // STEP 1: Invoke showSaveFilePicker immediately during user-activation
    try {
      fileHandle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [
          fileType === 'pdf'
            ? {
                description: 'Tài liệu PDF (Báo cáo nghiệm thu)',
                accept: { 'application/pdf': ['.pdf'] },
              }
            : {
                description: 'Tệp nén ZIP (Hồ sơ mẫu đầy đủ)',
                accept: { 'application/zip': ['.zip'] },
              },
        ],
      });
    } catch (pickerErr: any) {
      if (pickerErr && (pickerErr.name === 'AbortError' || pickerErr.code === 20)) {
        // User cancelled the Save As dialog - handle cleanly without error
        return { success: false, cancelled: true, method: 'file-system-access' };
      }
      throw new Error(`Không thể mở hộp thoại Lưu tệp (Save As): ${pickerErr.message || pickerErr}`);
    }

    // STEP 2: Request authorized download URL
    const authResult = await getSignedUrl();
    if (authResult.error || !authResult.signedUrl) {
      throw new Error(authResult.error || 'Quyền hạn bị từ chối hoặc không thể tạo liên kết tải tài liệu an toàn.');
    }

    // STEP 3: Retrieve file securely
    const response = await fetch(authResult.signedUrl);
    if (!response.ok) {
      throw new Error(`Không thể tải tệp từ máy chủ lưu trữ (HTTP ${response.status} ${response.statusText}).`);
    }
    if (!response.body) {
      throw new Error('Dữ liệu tệp tải về rỗng hoặc không có luồng dữ liệu.');
    }

    // STEP 4: Stream response directly to disk avoiding memory buffering
    const writable = await fileHandle.createWritable();
    await response.body.pipeTo(writable);

    return { success: true, method: 'file-system-access' };
  } else {
    // Fallback for browsers without File System Access API
    const authResult = await getSignedUrl();
    if (authResult.error || !authResult.signedUrl) {
      throw new Error(authResult.error || 'Quyền hạn bị từ chối hoặc không thể tạo liên kết tải tài liệu an toàn.');
    }

    const link = document.createElement('a');
    link.href = authResult.signedUrl;
    link.download = suggestedName;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (onFallbackUsed) {
      onFallbackUsed({
        message:
          'Trình duyệt đang tải tệp theo thư mục mặc định. Để chọn thư mục lưu (Save As) trên trình duyệt này, bạn có thể bật tùy chọn: "Hỏi vị trí lưu từng tệp trước khi tải xuống" (Ask where to save each file before downloading) trong Cài đặt (Settings -> Downloads).',
      });
    }

    return { success: true, method: 'browser-download' };
  }
}

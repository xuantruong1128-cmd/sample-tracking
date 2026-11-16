/**
 * SAMPLE TRACKING — MOBILE IMAGE CROP & COMPRESSION ENGINE
 * Client-side high performance image cropping, scaling and compression.
 */

export type ImageCategory = 'sample' | 'ng' | 'check_sheet' | 'drawing' | 'general';

export interface ImageProcessingConfig {
  maxDimension: number;
  quality: number;
  mimeType: 'image/jpeg' | 'image/webp' | 'image/png';
  skipIfSmallerThanBytes?: number;
  allowOriginalOption?: boolean;
  label: string;
}

/**
 * Default configurations per requirement:
 * - Sample photo: 1600 px, quality 0.85.
 * - NG photo: 2000 px, quality 0.88.
 * - QA Check Sheet: 2400 px, quality 0.90 (crisp measurement numbers & tiny text).
 * - Drawing / Technical: 2400 px, quality 0.92 (optional keep original).
 */
export const DEFAULT_CATEGORY_CONFIGS: Record<ImageCategory, ImageProcessingConfig> = {
  sample: {
    maxDimension: 1600,
    quality: 0.85,
    mimeType: 'image/jpeg',
    skipIfSmallerThanBytes: 150 * 1024, // 150KB
    label: 'Ảnh hàng mẫu (PE-MFG)',
  },
  ng: {
    maxDimension: 2000,
    quality: 0.88,
    mimeType: 'image/jpeg',
    skipIfSmallerThanBytes: 200 * 1024, // 200KB
    label: 'Ảnh lỗi NG',
  },
  check_sheet: {
    maxDimension: 2400,
    quality: 0.90,
    mimeType: 'image/jpeg',
    skipIfSmallerThanBytes: 250 * 1024, // 250KB
    label: 'QA Check Sheet',
  },
  drawing: {
    maxDimension: 2400,
    quality: 0.92,
    mimeType: 'image/jpeg',
    allowOriginalOption: true,
    label: 'Bản vẽ kỹ thuật',
  },
  general: {
    maxDimension: 1800,
    quality: 0.85,
    mimeType: 'image/jpeg',
    skipIfSmallerThanBytes: 150 * 1024,
    label: 'Ảnh chung',
  },
};

export interface NormalizedCrop {
  x: number;      // 0 to 1
  y: number;      // 0 to 1
  width: number;  // 0 to 1
  height: number; // 0 to 1
}

export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProcessImageOptions {
  category?: ImageCategory;
  config?: Partial<ImageProcessingConfig>;
  crop?: NormalizedCrop | PixelCrop | null;
  isNormalizedCrop?: boolean;
  rotation?: number; // 0, 90, 180, 270 degrees
  keepOriginal?: boolean;
  imageElement?: HTMLImageElement | null;
}

export interface ProcessImageResult {
  file: File;
  originalSize: number;
  processedSize: number;
  originalWidth: number;
  originalHeight: number;
  processedWidth: number;
  processedHeight: number;
  reductionPercent: number; // e.g. 96 for 96% reduction
  wasCompressed: boolean;
  mimeType: string;
}

/**
 * Format bytes into human-readable string (B, KB, MB)
 */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Calculate scaled dimensions without upscaling.
 */
export function calculateScaledDimensions(
  srcWidth: number,
  srcHeight: number,
  maxDimension: number
): { width: number; height: number; scale: number } {
  if (srcWidth <= 0 || srcHeight <= 0) {
    return { width: srcWidth, height: srcHeight, scale: 1 };
  }

  // Never upscale smaller images
  const scale = Math.min(1, maxDimension / srcWidth, maxDimension / srcHeight);
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  return { width, height, scale };
}

/**
 * Checks if a file is an editable/compressible image.
 * Excludes PDF, Excel, Word, ZIP files.
 */
export function isProcessableImage(file: File | { type: string; name: string }): boolean {
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();

  // Explicitly ignore non-images
  if (mime.includes('pdf') || name.endsWith('.pdf')) return false;
  if (mime.includes('excel') || mime.includes('spreadsheet') || name.endsWith('.xls') || name.endsWith('.xlsx')) return false;
  if (name.endsWith('.csv') || name.endsWith('.zip')) return false;

  if (mime.startsWith('image/')) return true;

  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.bmp', '.gif'];
  return imageExtensions.some((ext) => name.endsWith(ext));
}

/**
 * Load an image from File or Blob into an HTMLImageElement
 */
export function loadImageElement(file: Blob | File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không thể tải hoặc giải mã hình ảnh. Định dạng có thể không được trình duyệt hỗ trợ.'));
    };

    img.src = url;
  });
}

/**
 * Core image processing function:
 * 1. Honors crop area (freeform rectangle).
 * 2. Applies 90° rotation.
 * 3. Scales down within maxDimension without upscaling.
 * 4. Compresses with target JPEG/WebP quality.
 * 5. Bypasses compression if image is already small or resulting size would increase.
 */
export async function processImageClient(
  file: File,
  options: ProcessImageOptions = {}
): Promise<ProcessImageResult> {
  const originalSize = file.size;
  const category = options.category || 'general';
  const baseConfig = DEFAULT_CATEGORY_CONFIGS[category];
  const config: ImageProcessingConfig = { ...baseConfig, ...options.config };

  // If user requested to keep original file
  if (options.keepOriginal) {
    const w = options.imageElement?.naturalWidth || 0;
    const h = options.imageElement?.naturalHeight || 0;
    return {
      file,
      originalSize,
      processedSize: originalSize,
      originalWidth: w,
      originalHeight: h,
      processedWidth: w,
      processedHeight: h,
      reductionPercent: 0,
      wasCompressed: false,
      mimeType: file.type || 'image/jpeg',
    };
  }

  // Load image element or use passed element
  const img = options.imageElement || (await loadImageElement(file));
  const naturalW = img.naturalWidth || 1;
  const naturalH = img.naturalHeight || 1;

  const rotation = ((options.rotation || 0) % 360 + 360) % 360;

  // Resolve pixel crop coordinates mapped from visible oriented coordinates to source image
  let cropX = 0;
  let cropY = 0;
  let cropW = naturalW;
  let cropH = naturalH;

  if (options.crop) {
    if (options.isNormalizedCrop) {
      const nc = options.crop as NormalizedCrop;
      // Clamp normalized inputs safely in [0, 1]
      const nx = Math.max(0, Math.min(1, nc.x));
      const ny = Math.max(0, Math.min(1, nc.y));
      const nw = Math.max(0.001, Math.min(1 - nx, nc.width));
      const nh = Math.max(0.001, Math.min(1 - ny, nc.height));

      if (rotation === 90) {
        // Visible: W_vis = naturalH, H_vis = naturalW
        cropX = Math.max(0, Math.min(naturalW - 1, Math.round(ny * naturalW)));
        cropW = Math.max(1, Math.min(naturalW - cropX, Math.round(nh * naturalW)));
        cropY = Math.max(0, Math.min(naturalH - 1, Math.round((1 - nx - nw) * naturalH)));
        cropH = Math.max(1, Math.min(naturalH - cropY, Math.round(nw * naturalH)));
      } else if (rotation === 180) {
        // Visible: W_vis = naturalW, H_vis = naturalH
        cropX = Math.max(0, Math.min(naturalW - 1, Math.round((1 - nx - nw) * naturalW)));
        cropW = Math.max(1, Math.min(naturalW - cropX, Math.round(nw * naturalW)));
        cropY = Math.max(0, Math.min(naturalH - 1, Math.round((1 - ny - nh) * naturalH)));
        cropH = Math.max(1, Math.min(naturalH - cropY, Math.round(nh * naturalH)));
      } else if (rotation === 270) {
        // Visible: W_vis = naturalH, H_vis = naturalW
        cropX = Math.max(0, Math.min(naturalW - 1, Math.round((1 - ny - nh) * naturalW)));
        cropW = Math.max(1, Math.min(naturalW - cropX, Math.round(nh * naturalW)));
        cropY = Math.max(0, Math.min(naturalH - 1, Math.round(nx * naturalH)));
        cropH = Math.max(1, Math.min(naturalH - cropY, Math.round(nw * naturalH)));
      } else {
        // 0 degrees default: W_vis = naturalW, H_vis = naturalH
        cropX = Math.max(0, Math.min(naturalW - 1, Math.round(nx * naturalW)));
        cropY = Math.max(0, Math.min(naturalH - 1, Math.round(ny * naturalH)));
        cropW = Math.max(1, Math.min(naturalW - cropX, Math.round(nw * naturalW)));
        cropH = Math.max(1, Math.min(naturalH - cropY, Math.round(nh * naturalH)));
      }
    } else {
      const pc = options.crop as PixelCrop;
      cropX = Math.max(0, Math.min(naturalW, Math.round(pc.x)));
      cropY = Math.max(0, Math.min(naturalH, Math.round(pc.y)));
      cropW = Math.max(1, Math.min(naturalW - cropX, Math.round(pc.width)));
      cropH = Math.max(1, Math.min(naturalH - cropY, Math.round(pc.height)));
    }
  }

  const isFullImage = cropX === 0 && cropY === 0 && cropW === naturalW && cropH === naturalH;

  // Determine post-rotation dimensions
  const isRotated90or270 = rotation === 90 || rotation === 270;
  const postRotateW = isRotated90or270 ? cropH : cropW;
  const postRotateH = isRotated90or270 ? cropW : cropH;

  // Check if we can skip compression completely (image is already small and unchanged)
  if (
    isFullImage &&
    rotation === 0 &&
    config.skipIfSmallerThanBytes &&
    originalSize <= config.skipIfSmallerThanBytes &&
    naturalW <= config.maxDimension &&
    naturalH <= config.maxDimension
  ) {
    return {
      file,
      originalSize,
      processedSize: originalSize,
      originalWidth: naturalW,
      originalHeight: naturalH,
      processedWidth: naturalW,
      processedHeight: naturalH,
      reductionPercent: 0,
      wasCompressed: false,
      mimeType: file.type || 'image/jpeg',
    };
  }

  // Calculate final target dimensions (no upscaling)
  const { width: targetW, height: targetH } = calculateScaledDimensions(
    postRotateW,
    postRotateH,
    config.maxDimension
  );

  // Setup Canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Trình duyệt không hỗ trợ Canvas 2D Context để xử lý hình ảnh.');
  }

  // Enable high quality bicubic interpolation
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Fill with white background in case source has transparency and output is JPEG
  if (config.mimeType === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetW, targetH);
  }

  // Apply transformations: Center, Rotate, Draw
  ctx.save();
  ctx.translate(targetW / 2, targetH / 2);
  if (rotation !== 0) {
    ctx.rotate((rotation * Math.PI) / 180);
  }

  // Calculate destination rectangle inside rotated context
  const drawW = isRotated90or270 ? targetH : targetW;
  const drawH = isRotated90or270 ? targetW : targetH;

  ctx.drawImage(
    img,
    cropX,
    cropY,
    cropW,
    cropH,
    -drawW / 2,
    -drawH / 2,
    drawW,
    drawH
  );
  ctx.restore();

  // Export blob with quality
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Lỗi xuất dữ liệu hình ảnh từ Canvas.'));
      },
      config.mimeType,
      config.quality
    );
  });

  // If compression didn't reduce size on an uncropped/unrotated image, keep original
  if (isFullImage && rotation === 0 && blob.size >= originalSize) {
    return {
      file,
      originalSize,
      processedSize: originalSize,
      originalWidth: naturalW,
      originalHeight: naturalH,
      processedWidth: naturalW,
      processedHeight: naturalH,
      reductionPercent: 0,
      wasCompressed: false,
      mimeType: file.type || config.mimeType,
    };
  }

  // Construct new File with proper extension
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const ext = config.mimeType === 'image/jpeg' ? '.jpg' : config.mimeType === 'image/webp' ? '.webp' : '.png';
  const newFileName = `${baseName}${ext}`;

  const processedFile = new File([blob], newFileName, {
    type: config.mimeType,
    lastModified: Date.now(),
  });

  const reductionPercent = Math.max(
    0,
    Math.round(((originalSize - processedFile.size) / originalSize) * 100)
  );

  return {
    file: processedFile,
    originalSize,
    processedSize: processedFile.size,
    originalWidth: naturalW,
    originalHeight: naturalH,
    processedWidth: targetW,
    processedHeight: targetH,
    reductionPercent,
    wasCompressed: true,
    mimeType: config.mimeType,
  };
}

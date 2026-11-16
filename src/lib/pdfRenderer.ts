/**
 * PDF Renderer Utility for Technical Drawings
 * Supports rendering PDF pages to Canvas / Image with high-DPI scaling
 * using local PDF.js (/libs/pdfjs) with CDN fallback.
 */

let pdfjsLibPromise: Promise<any> | null = null;

/**
 * Checks if HTML5 2D Canvas is supported in the current runtime environment
 */
export function isCanvasSupported(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext && canvas.getContext('2d'));
  } catch {
    return false;
  }
}

/**
 * Dynamically loads PDF.js library in browser runtime
 */
export async function getPdfJsLib(): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('Window is not available');
  }

  if (!isCanvasSupported()) {
    throw new Error('Canvas 2D context is not supported in this environment');
  }

  if ((window as any).pdfjsLib) {
    return (window as any).pdfjsLib;
  }

  if (pdfjsLibPromise) {
    return pdfjsLibPromise;
  }

  pdfjsLibPromise = new Promise((resolve, reject) => {
    // Safety timeout so it never hangs in test or offline without script
    const timeout = setTimeout(() => {
      reject(new Error('PDF.js script load timed out'));
    }, 2500);

    // 1. Try local bundled script from /libs/pdfjs/
    const localScript = document.createElement('script');
    localScript.src = '/libs/pdfjs/pdf.min.js';
    localScript.async = true;

    localScript.onload = () => {
      clearTimeout(timeout);
      const lib = (window as any).pdfjsLib;
      if (lib) {
        lib.GlobalWorkerOptions.workerSrc = '/libs/pdfjs/pdf.worker.min.js';
        resolve(lib);
      } else {
        fallbackCdn(resolve, reject);
      }
    };

    localScript.onerror = () => {
      fallbackCdn(resolve, reject);
    };

    function fallbackCdn(res: any, rej: any) {
      const cdnScript = document.createElement('script');
      cdnScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      cdnScript.async = true;
      cdnScript.onload = () => {
        clearTimeout(timeout);
        const cdnLib = (window as any).pdfjsLib;
        if (cdnLib) {
          cdnLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          res(cdnLib);
        } else {
          rej(new Error('PDF.js could not be initialized'));
        }
      };
      cdnScript.onerror = () => {
        clearTimeout(timeout);
        rej(new Error('Failed to load PDF.js from local and CDN'));
      };
      document.head.appendChild(cdnScript);
    }

    document.head.appendChild(localScript);
  });

  return pdfjsLibPromise;
}

export interface RenderedPdfPageResult {
  dataUrl: string;
  blob: Blob;
  file: File;
  width: number;
  height: number;
  numPages: number;
}

/**
 * Loads a PDF document proxy from URL or ArrayBuffer
 */
export async function loadPdfDocument(source: string | ArrayBuffer): Promise<any> {
  const pdfjsLib = await getPdfJsLib();
  const loadingTask = pdfjsLib.getDocument(
    typeof source === 'string'
      ? {
          url: source,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true,
        }
      : {
          data: source,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true,
        }
  );
  return loadingTask.promise;
}

/**
 * Renders a specific page from an already loaded PDF Document to an image/canvas
 */
export async function renderPageFromDoc(
  pdfDoc: any,
  pageNumber: number = 1,
  scale: number = 2.0, // High-DPI for CAD sharpness
  fileName: string = 'drawing.pdf'
): Promise<RenderedPdfPageResult> {
  const numPages = pdfDoc.numPages || 1;
  const safePageNum = Math.min(Math.max(1, pageNumber), numPages);
  const page = await pdfDoc.getPage(safePageNum);

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  // Technical drawings have a crisp white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise;

  const dataUrl = canvas.toDataURL('image/png');

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Canvas toBlob failed'));
    }, 'image/png');
  });

  const baseName = fileName.replace(/\.[^/.]+$/, '');
  const file = new File([blob], `${baseName}_p${safePageNum}.png`, {
    type: 'image/png',
  });

  return {
    dataUrl,
    blob,
    file,
    width: viewport.width,
    height: viewport.height,
    numPages,
  };
}

/**
 * Convenience function to load and render a PDF page directly
 */
export async function renderPdfPageToImage(
  pdfSource: string | ArrayBuffer,
  pageNumber: number = 1,
  scale: number = 2.0,
  fileName: string = 'drawing.pdf'
): Promise<RenderedPdfPageResult> {
  const doc = await loadPdfDocument(pdfSource);
  return renderPageFromDoc(doc, pageNumber, scale, fileName);
}

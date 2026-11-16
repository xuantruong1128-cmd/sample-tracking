import type { DrawingAnnotation } from './DrawingAnnotationLayer';

/**
 * Renders the drawing image along with SVG annotations onto an HTML5 canvas
 * and exports as a PNG Blob.
 */
export async function exportAnnotatedDrawingToBlob(
  imageUrl: string,
  annotations: DrawingAnnotation[],
  naturalWidth: number,
  naturalHeight: number,
  currentPage: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = naturalWidth || img.naturalWidth || 1200;
      canvas.height = naturalHeight || img.naturalHeight || 800;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      // 1. Draw base drawing image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // 2. Filter annotations for current page
      const pageAnnotations = annotations.filter((a) => a.page === currentPage);

      // 3. Render annotations
      for (const ann of pageAnnotations) {
        ctx.save();

        if (ann.type === 'highlight') {
          // Yellow or custom color highlight with translucent alpha
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillStyle = ann.color;
          ctx.globalAlpha = 0.45;
          ctx.fillRect(ann.x, ann.y, ann.width || 0, ann.height || 0);
        } else if (ann.type === 'rectangle') {
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 4;
          ctx.strokeRect(ann.x, ann.y, ann.width || 0, ann.height || 0);
        } else if (ann.type === 'circle') {
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.ellipse(
            ann.x,
            ann.y,
            ann.width || 1,
            ann.height || 1,
            0,
            0,
            2 * Math.PI
          );
          ctx.stroke();
        } else if (ann.type === 'arrow' && ann.endX !== undefined && ann.endY !== undefined) {
          ctx.strokeStyle = ann.color;
          ctx.fillStyle = ann.color;
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';

          // Draw line
          ctx.beginPath();
          ctx.moveTo(ann.x, ann.y);
          ctx.lineTo(ann.endX, ann.endY);
          ctx.stroke();

          // Draw arrowhead at end point
          const angle = Math.atan2(ann.endY - ann.y, ann.endX - ann.x);
          const headLength = 16;
          ctx.beginPath();
          ctx.moveTo(ann.endX, ann.endY);
          ctx.lineTo(
            ann.endX - headLength * Math.cos(angle - Math.PI / 6),
            ann.endY - headLength * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            ann.endX - headLength * Math.cos(angle + Math.PI / 6),
            ann.endY - headLength * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fill();
        } else if (ann.type === 'text' && ann.text) {
          // Multi-line and custom font size text box with white card backing
          const fontSize = ann.fontSize || 14;
          const lineHeight = Math.round(fontSize * 1.35);
          const lines = ann.text.split('\n');
          ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;

          let maxLineWidth = 0;
          for (const line of lines) {
            const w = ctx.measureText(line || ' ').width;
            if (w > maxLineWidth) maxLineWidth = w;
          }

          const paddingX = 8;
          const paddingY = 6;
          const cardWidth = Math.max(50, Math.round(maxLineWidth + paddingX * 2 + 8));
          const cardHeight = Math.round(lines.length * lineHeight + paddingY * 2);
          const boxTop = -22;

          // White badge background
          ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 1.5;

          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(ann.x - 6, ann.y + boxTop, cardWidth, cardHeight, 6);
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.fillRect(ann.x - 6, ann.y + boxTop, cardWidth, cardHeight);
            ctx.strokeRect(ann.x - 6, ann.y + boxTop, cardWidth, cardHeight);
          }

          // Text content with multiline support
          ctx.fillStyle = ann.color === '#facc15' ? '#854d0e' : ann.color;
          const line0Baseline = ann.y + boxTop + paddingY + Math.round(fontSize * 0.88);
          lines.forEach((line, idx) => {
            ctx.fillText(line, ann.x + 4, line0Baseline + idx * lineHeight);
          });
        }

        ctx.restore();
      }

      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/png');
    };

    img.onerror = () => {
      resolve(null);
    };

    img.src = imageUrl;
  });
}

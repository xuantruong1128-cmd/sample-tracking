import { useState, useCallback, useRef } from 'react';

export interface ColumnResizerConfig {
  storageKey: string;
  defaultWidths: Record<string, number>;
  minWidths?: Record<string, number>;
  maxWidths?: Record<string, number>;
}

export function useTableColumnResizer({
  storageKey,
  defaultWidths,
  minWidths = {},
  maxWidths = {},
}: ColumnResizerConfig) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return { ...defaultWidths, ...parsed };
        }
      }
    } catch {
      // fallback
    }
    return defaultWidths;
  });

  const widthsRef = useRef(columnWidths);
  widthsRef.current = columnWidths;

  const handleResizeStart = useCallback(
    (colKey: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = widthsRef.current[colKey] || defaultWidths[colKey] || 100;
      const minW = minWidths[colKey] || 50;
      const maxW = maxWidths[colKey] || 1500;

      let currentWidth = startWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const newWidth = Math.max(minW, Math.min(maxW, Math.round(startWidth + deltaX)));
        currentWidth = newWidth;
        setColumnWidths((prev) => ({
          ...prev,
          [colKey]: newWidth,
        }));
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        try {
          const updated = { ...widthsRef.current, [colKey]: currentWidth };
          localStorage.setItem(storageKey, JSON.stringify(updated));
        } catch {
          // ignore
        }
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [defaultWidths, minWidths, maxWidths, storageKey]
  );

  const handleResetColumnWidth = useCallback(
    (colKey: string) => {
      const defW = defaultWidths[colKey] || 100;
      setColumnWidths((prev) => {
        const next = { ...prev, [colKey]: defW };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [defaultWidths, storageKey]
  );

  const handleResetAllWidths = useCallback(() => {
    setColumnWidths(defaultWidths);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [defaultWidths, storageKey]);

  return {
    columnWidths,
    handleResizeStart,
    handleResetColumnWidth,
    handleResetAllWidths,
  };
}

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DrawingAnnotationLayer,
  PRESET_COLORS,
  type DrawingAnnotation,
} from '../features/drawingReview/DrawingAnnotationLayer';
import { DrawingViewer } from '../features/drawingReview/DrawingViewer';

// Mock service
vi.mock('../services/drawingReviewService', () => ({
  getDrawingFileSignedUrl: vi.fn().mockResolvedValue({
    signedUrl: 'https://storage.test/sample-drawing.pdf',
    error: null,
  }),
}));

// Mock pdfRenderer
vi.mock('../lib/pdfRenderer', () => ({
  loadPdfDocument: vi.fn().mockResolvedValue({ numPages: 1 }),
  renderPageFromDoc: vi.fn().mockResolvedValue({
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    width: 1200,
    height: 800,
  }),
  renderPdfPageToImage: vi.fn().mockResolvedValue({
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    width: 1200,
    height: 800,
  }),
  isCanvasSupported: vi.fn().mockReturnValue(true),
}));

describe('DRAWING VIEWER ANNOTATION & MARKUP (COMMENT ON DRAWING) TEST SUITE', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  const mockAnnotations: DrawingAnnotation[] = [
    {
      id: 'ann-1',
      type: 'highlight',
      x: 100,
      y: 150,
      width: 120,
      height: 30,
      color: '#facc15',
      page: 1,
      createdAt: 1000,
    },
    {
      id: 'ann-2',
      type: 'text',
      x: 250,
      y: 300,
      text: 'Dim 34: Need to change 0.0125 to be 0.025',
      color: '#ef4444',
      page: 1,
      createdAt: 1001,
    },
    {
      id: 'ann-3',
      type: 'arrow',
      x: 200,
      y: 200,
      endX: 300,
      endY: 250,
      color: '#3b82f6',
      page: 1,
      createdAt: 1002,
    },
    {
      id: 'ann-4',
      type: 'circle',
      x: 400,
      y: 400,
      width: 50,
      height: 40,
      color: '#22c55e',
      page: 1,
      createdAt: 1003,
    },
    {
      id: 'ann-5',
      type: 'rectangle',
      x: 500,
      y: 500,
      width: 80,
      height: 60,
      color: '#f97316',
      page: 1,
      createdAt: 1004,
    },
  ];

  it('1. Renders all 5 annotation types (highlight, text, arrow, circle, rectangle) onto the SVG layer', () => {
    const onAdd = vi.fn();
    const onDelete = vi.fn();

    render(
      <DrawingAnnotationLayer
        naturalWidth={1200}
        naturalHeight={800}
        annotations={mockAnnotations}
        currentPage={1}
        activeTool="none"
        activeColor="#facc15"
        isAnnotating={false}
        visible={true}
        onAddAnnotation={onAdd}
        onDeleteAnnotation={onDelete}
      />
    );

    // Verify SVG layer exists
    const svgLayer = screen.getByTestId('drawing-annotation-svg-layer');
    expect(svgLayer).toBeInTheDocument();

    // Verify all 5 annotations are rendered
    expect(screen.getByTestId('annotation-item-highlight-ann-1')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-item-text-ann-2')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-item-arrow-ann-3')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-item-circle-ann-4')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-item-rectangle-ann-5')).toBeInTheDocument();

    // Verify text content
    expect(screen.getByText('Dim 34: Need to change 0.0125 to be 0.025')).toBeInTheDocument();
  });

  it('2. Highlight annotation uses translucent opacity and multiply blend mode for CAD lines readability', () => {
    const { container } = render(
      <DrawingAnnotationLayer
        naturalWidth={1200}
        naturalHeight={800}
        annotations={[mockAnnotations[0]]}
        currentPage={1}
        activeTool="none"
        activeColor="#facc15"
        isAnnotating={false}
        visible={true}
        onAddAnnotation={vi.fn()}
        onDeleteAnnotation={vi.fn()}
      />
    );

    const highlightRect = container.querySelector('rect[fill="#facc15"]');
    expect(highlightRect).toBeInTheDocument();
    expect(highlightRect).toHaveAttribute('fill-opacity', '0.45');
    expect(highlightRect).toHaveStyle({ mixBlendMode: 'multiply' });
  });

  it('3. Arrow annotation has marker-end referencing arrowhead with chosen color', () => {
    const { container } = render(
      <DrawingAnnotationLayer
        naturalWidth={1200}
        naturalHeight={800}
        annotations={[mockAnnotations[2]]}
        currentPage={1}
        activeTool="none"
        activeColor="#3b82f6"
        isAnnotating={false}
        visible={true}
        onAddAnnotation={vi.fn()}
        onDeleteAnnotation={vi.fn()}
      />
    );

    const arrowLine = container.querySelector('line[stroke="#3b82f6"]');
    expect(arrowLine).toBeInTheDocument();
    expect(arrowLine).toHaveAttribute('marker-end', 'url(#arrow-head-3b82f6)');
  });

  it('4. Preset colors list contains Yellow, Red, Blue, Green, and Orange with corresponding hex values', () => {
    expect(PRESET_COLORS.length).toBe(5);
    const hexes = PRESET_COLORS.map((c) => c.hex);
    expect(hexes).toContain('#facc15'); // Yellow
    expect(hexes).toContain('#ef4444'); // Red
    expect(hexes).toContain('#3b82f6'); // Blue
    expect(hexes).toContain('#22c55e'); // Green
    expect(hexes).toContain('#f97316'); // Orange
  });

  it('5. Toggling visibility hides the SVG layer cleanly', () => {
    const { rerender } = render(
      <DrawingAnnotationLayer
        naturalWidth={1200}
        naturalHeight={800}
        annotations={mockAnnotations}
        currentPage={1}
        activeTool="none"
        activeColor="#facc15"
        isAnnotating={false}
        visible={true}
        onAddAnnotation={vi.fn()}
        onDeleteAnnotation={vi.fn()}
      />
    );

    expect(screen.getByTestId('drawing-annotation-svg-layer')).toBeInTheDocument();

    rerender(
      <DrawingAnnotationLayer
        naturalWidth={1200}
        naturalHeight={800}
        annotations={mockAnnotations}
        currentPage={1}
        activeTool="none"
        activeColor="#facc15"
        isAnnotating={false}
        visible={false}
        onAddAnnotation={vi.fn()}
        onDeleteAnnotation={vi.fn()}
      />
    );

    expect(screen.queryByTestId('drawing-annotation-svg-layer')).not.toBeInTheDocument();
  });

  it('6. DrawingViewer renders Ghi chú toggle button and opens annotation sub-toolbar with all tools', async () => {
    render(
      <DrawingViewer
        filePath="drawings/issue-1/shaft.pdf"
        fileName="shaft.pdf"
        versionId="ver-1"
        fullHeight={true}
      />
    );

    // Toggle button exists in toolbar
    const toggleBtn = screen.getByTestId('toggle-annotation-mode-btn');
    expect(toggleBtn).toBeInTheDocument();

    // Initially sub-toolbar is closed
    expect(screen.queryByTestId('drawing-annotation-toolbar')).not.toBeInTheDocument();

    // Click to activate Annotation Mode
    fireEvent.click(toggleBtn);

    // Sub-toolbar appears
    const toolbar = screen.getByTestId('drawing-annotation-toolbar');
    expect(toolbar).toBeInTheDocument();

    // Tools exist
    expect(screen.getByTestId('tool-highlight-btn')).toBeInTheDocument();
    expect(screen.getByTestId('tool-text-btn')).toBeInTheDocument();
    expect(screen.getByTestId('tool-arrow-btn')).toBeInTheDocument();
    expect(screen.getByTestId('tool-circle-btn')).toBeInTheDocument();
    expect(screen.getByTestId('tool-rectangle-btn')).toBeInTheDocument();

    // Color choices exist
    expect(screen.getByTestId('color-choice-#facc15')).toBeInTheDocument();
    expect(screen.getByTestId('color-choice-#ef4444')).toBeInTheDocument();
    expect(screen.getByTestId('color-choice-#3b82f6')).toBeInTheDocument();
    expect(screen.getByTestId('color-choice-#22c55e')).toBeInTheDocument();
    expect(screen.getByTestId('color-choice-#f97316')).toBeInTheDocument();

    // Actions exist
    expect(screen.getByTestId('undo-annotation-btn')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-visibility-annotation-btn')).toBeInTheDocument();
    expect(screen.getByTestId('clear-annotations-btn')).toBeInTheDocument();
  });

  it('7. Switching active tool in sub-toolbar highlights selected tool button', () => {
    render(
      <DrawingViewer
        filePath="drawings/issue-1/shaft.pdf"
        fileName="shaft.pdf"
        versionId="ver-1"
      />
    );

    // Open toolbar
    fireEvent.click(screen.getByTestId('toggle-annotation-mode-btn'));

    // Click arrow tool
    const arrowBtn = screen.getByTestId('tool-arrow-btn');
    fireEvent.click(arrowBtn);
    expect(arrowBtn).toHaveClass('bg-blue-600');

    // Click circle tool
    const circleBtn = screen.getByTestId('tool-circle-btn');
    fireEvent.click(circleBtn);
    expect(circleBtn).toHaveClass('bg-blue-600');
  });

  it('8. Switching color updates activeColor state', () => {
    render(
      <DrawingViewer
        filePath="drawings/issue-1/shaft.pdf"
        fileName="shaft.pdf"
        versionId="ver-1"
      />
    );

    fireEvent.click(screen.getByTestId('toggle-annotation-mode-btn'));

    const redColor = screen.getByTestId('color-choice-#ef4444');
    fireEvent.click(redColor);
    expect(redColor).toHaveClass('border-white');
  });

  it('9. Font size selector appears when Text tool (Viết chữ) is active and allows changing font size', () => {
    render(
      <DrawingViewer
        filePath="drawings/issue-1/shaft.pdf"
        fileName="shaft.pdf"
        versionId="ver-1"
      />
    );

    // Open annotation sub-toolbar
    fireEvent.click(screen.getByTestId('toggle-annotation-mode-btn'));

    // Initially activeTool is highlight -> font-size control group is hidden
    expect(screen.queryByTestId('font-size-control-group')).not.toBeInTheDocument();

    // Select "Viết chữ" tool
    fireEvent.click(screen.getByTestId('tool-text-btn'));

    // Now font-size control group is visible
    expect(screen.getByTestId('font-size-control-group')).toBeInTheDocument();
    const select = screen.getByTestId('font-size-select') as HTMLSelectElement;
    expect(select.value).toBe('16'); // Default 16px

    // Change to 24px
    fireEvent.change(select, { target: { value: '24' } });
    expect(select.value).toBe('24');
  });

  it('10. Multi-line text annotation renders each line inside SVG tspan with specified fontSize', () => {
    const multiLineAnnotation: DrawingAnnotation = {
      id: 'ann-multiline-1',
      type: 'text',
      x: 150,
      y: 250,
      text: 'Dòng 1: Cần gia công lại\nDòng 2: Dung sai ±0.01mm\nDòng 3: Tôi bề mặt HRC 58-62',
      fontSize: 20,
      color: '#ef4444',
      page: 1,
      createdAt: 2000,
    };

    const { container } = render(
      <DrawingAnnotationLayer
        naturalWidth={1200}
        naturalHeight={800}
        annotations={[multiLineAnnotation]}
        currentPage={1}
        activeTool="none"
        activeColor="#ef4444"
        isAnnotating={false}
        visible={true}
        onAddAnnotation={vi.fn()}
        onDeleteAnnotation={vi.fn()}
      />
    );

    // All lines are rendered
    expect(screen.getByText('Dòng 1: Cần gia công lại')).toBeInTheDocument();
    expect(screen.getByText('Dòng 2: Dung sai ±0.01mm')).toBeInTheDocument();
    expect(screen.getByText('Dòng 3: Tôi bề mặt HRC 58-62')).toBeInTheDocument();

    // Verify SVG text element has fontSize="20"
    const textEl = container.querySelector('text');
    expect(textEl).toBeInTheDocument();
    expect(textEl).toHaveAttribute('font-size', '20');

    // Verify 3 tspan elements exist for the 3 lines
    const tspans = container.querySelectorAll('tspan');
    expect(tspans.length).toBe(3);
  });

  it('11. Inline text input popover uses textarea for multi-line notes and supports font size selection', () => {
    const onAdd = vi.fn();
    const onDelete = vi.fn();

    const { container } = render(
      <DrawingAnnotationLayer
        naturalWidth={1200}
        naturalHeight={800}
        annotations={[]}
        currentPage={1}
        activeTool="text"
        activeColor="#f97316"
        activeFontSize={16}
        isAnnotating={true}
        visible={true}
        onAddAnnotation={onAdd}
        onDeleteAnnotation={onDelete}
      />
    );

    // Mock bounding rect for SVG layer so getNaturalCoords works
    const svgLayer = screen.getByTestId('drawing-annotation-svg-layer');
    vi.spyOn(svgLayer, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1200,
      height: 800,
      right: 1200,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Click on SVG to place text annotation
    fireEvent.mouseDown(svgLayer, { clientX: 300, clientY: 400, button: 0 });

    // Popover is displayed
    expect(screen.getByTestId('inline-text-annotation-popover')).toBeInTheDocument();

    // Input is a textarea supporting multiline
    const textarea = screen.getByTestId('inline-annotation-text-input') as HTMLTextAreaElement;
    expect(textarea.tagName).toBe('TEXTAREA');

    // Type multi-line note
    const multilineContent = 'Ghi chú quan trọng:\n- Kiểm tra góc vát C1\n- Xi mạ Crôm bóng';
    fireEvent.change(textarea, { target: { value: multilineContent } });
    expect(textarea.value).toBe(multilineContent);

    // Change font size in popover
    const fontSizeSelect = screen.getByTestId('inline-font-size-select') as HTMLSelectElement;
    fireEvent.change(fontSizeSelect, { target: { value: '24' } });
    expect(fontSizeSelect.value).toBe('24');

    // Confirm adding note
    fireEvent.click(screen.getByTestId('confirm-text-ann-btn'));

    // onAddAnnotation is called with the multi-line text and chosen font size
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'text',
        x: 300,
        y: 400,
        text: multilineContent,
        fontSize: 24,
        color: '#f97316',
        page: 1,
      })
    );
  });

  it('12. Double-clicking an existing text annotation opens inline editor to modify text or font size', () => {
    const onAdd = vi.fn();
    const onDelete = vi.fn();

    const existingAnn: DrawingAnnotation = {
      id: 'ann-to-edit',
      type: 'text',
      x: 200,
      y: 200,
      text: 'Bản vẽ mẫu cũ',
      fontSize: 14,
      color: '#3b82f6',
      page: 1,
      createdAt: 1000,
    };

    render(
      <DrawingAnnotationLayer
        naturalWidth={1200}
        naturalHeight={800}
        annotations={[existingAnn]}
        currentPage={1}
        activeTool="text"
        activeColor="#3b82f6"
        isAnnotating={true}
        visible={true}
        onAddAnnotation={onAdd}
        onDeleteAnnotation={onDelete}
      />
    );

    // Double click the annotation item
    const item = screen.getByTestId('annotation-item-text-ann-to-edit');
    fireEvent.doubleClick(item.firstElementChild || item);

    // Popover opens prefilled with existing text and font size
    expect(screen.getByTestId('inline-text-annotation-popover')).toBeInTheDocument();
    const textarea = screen.getByTestId('inline-annotation-text-input') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Bản vẽ mẫu cũ');

    const fontSizeSelect = screen.getByTestId('inline-font-size-select') as HTMLSelectElement;
    expect(fontSizeSelect.value).toBe('14');

    // Update text and font size
    fireEvent.change(textarea, { target: { value: 'Bản vẽ đã sửa đổi:\nCỡ chữ mới 20px' } });
    fireEvent.change(fontSizeSelect, { target: { value: '20' } });

    // Confirm
    fireEvent.click(screen.getByTestId('confirm-text-ann-btn'));

    // Old annotation deleted and new one added
    expect(onDelete).toHaveBeenCalledWith('ann-to-edit');
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ann-to-edit',
        text: 'Bản vẽ đã sửa đổi:\nCỡ chữ mới 20px',
        fontSize: 20,
      })
    );
  });

  it('13. DrawingViewer mounts with initialAnnotations from DB and renders annotations count badge and elements in readOnly mode', async () => {
    const dbAnnotations: DrawingAnnotation[] = [
      {
        id: 'db-ann-1',
        type: 'text',
        x: 150,
        y: 250,
        text: 'Ghi chú kỹ thuật từ Database',
        fontSize: 16,
        color: '#ef4444',
        page: 1,
        createdAt: 2000,
      },
      {
        id: 'db-ann-2',
        type: 'rectangle',
        x: 300,
        y: 300,
        width: 100,
        height: 80,
        color: '#3b82f6',
        page: 1,
        createdAt: 2001,
      },
    ];

    render(
      <DrawingViewer
        filePath="drawings/sample.pdf"
        fileName="sample.pdf"
        versionId="version-uuid-123"
        initialAnnotations={dbAnnotations}
        readOnly={true}
      />
    );

    // Shows badge with count of 2 annotations
    expect(await screen.findByText(/Ghi chú \(2\)/)).toBeInTheDocument();

    // Renders the annotations in the SVG layer
    expect(await screen.findByText('Ghi chú kỹ thuật từ Database')).toBeInTheDocument();
  });

  it('14. DrawingViewer ref exposes getAnnotations and getAnnotatedBlob for snapshot attachment', async () => {
    const dbAnnotations: DrawingAnnotation[] = [
      {
        id: 'db-ann-test',
        type: 'text',
        x: 100,
        y: 100,
        text: 'Lưu vào báo cáo hoàn thành',
        fontSize: 16,
        color: '#ef4444',
        page: 1,
        createdAt: 3000,
      },
    ];

    const ref = React.createRef<any>();

    render(
      <DrawingViewer
        ref={ref}
        filePath="drawings/sample.pdf"
        fileName="sample.pdf"
        versionId="version-uuid-456"
        initialAnnotations={dbAnnotations}
        readOnly={false}
      />
    );

    expect(ref.current).not.toBeNull();
    expect(typeof ref.current.getAnnotations).toBe('function');
    expect(typeof ref.current.getAnnotatedBlob).toBe('function');

    const anns = ref.current.getAnnotations();
    expect(anns).toHaveLength(1);
    expect(anns[0].text).toBe('Lưu vào báo cáo hoàn thành');
  });
});

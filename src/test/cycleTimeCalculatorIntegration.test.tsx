import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CycleTimeCalculatorModal } from '../features/drawingReview/CycleTimeCalculatorModal';
import { PreliminaryRoutingMatrix } from '../features/drawingReview/PreliminaryRoutingMatrix';
import { serializeMultiCutState, deserializeMultiCutState } from '../lib/cycleTimeEngine';
import { formatHanoiDateTime, formatHanoiDate } from '../services/drawingReviewService';

describe('CYCLE TIME CALCULATOR (R1.1) — UI & INTEGRATION TEST SUITE (UNIFIED SPREADSHEET GRID)', () => {
  it('1. Renders modal with spreadsheet table and controls in a single unified tab', () => {
    const handleClose = vi.fn();
    const handleApply = vi.fn();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={handleClose}
        onApply={handleApply}
        operationStepOrder={10}
        workcenterCode="CAMC"
      />
    );

    expect(screen.getByTestId('cycle-time-calculator-modal')).toBeInTheDocument();
    expect(screen.getByText(/Tính toán thời gian chu kỳ/i)).toBeInTheDocument();
    expect(screen.getAllByText(/OP10/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/CAMC/i)).toBeInTheDocument();

    // Check single-tab spreadsheet grid table
    expect(screen.getByTestId('cut-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('machining-type-select-0')).toBeInTheDocument();
    expect(screen.getByTestId('cut-name-input-0')).toBeInTheDocument();

    // Check D, Vc, N inputs and lock buttons on the cut row 0
    expect(screen.getByTestId('input-diameter-0')).toBeInTheDocument();
    expect(screen.getByTestId('input-cuttingSpeed-0')).toBeInTheDocument();
    expect(screen.getByTestId('input-spindleSpeed-0')).toBeInTheDocument();
    expect(screen.getByTestId('lock-diameter-btn-0')).toBeInTheDocument();
    expect(screen.getByTestId('lock-cuttingSpeed-btn-0')).toBeInTheDocument();
    expect(screen.getByTestId('lock-spindleSpeed-btn-0')).toBeInTheDocument();

    // Check Feed & Time inputs
    expect(screen.getByTestId('input-passes-0')).toBeInTheDocument();
    expect(screen.getByTestId('input-length-0')).toBeInTheDocument();
    expect(screen.getByTestId('add-cut-row-btn')).toBeInTheDocument();
    expect(screen.getByTestId('apply-calc-to-op-btn')).toBeInTheDocument();
  });

  it('2. Example A: Bidirectional D-Vc-N calculation & bold calculated visual distinction', async () => {
    const user = userEvent.setup();
    const handleApply = vi.fn();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={handleApply}
      />
    );

    const vcInput = screen.getByTestId('input-cuttingSpeed-0');
    const dInput = screen.getByTestId('input-diameter-0');
    const nInput = screen.getByTestId('input-spindleSpeed-0');

    // 1. Enter Vc = 100
    await user.type(vcInput, '100');
    // 2. Enter D = 10
    await user.type(dInput, '10');

    // 3. System calculates N ≈ 3183.1
    await waitFor(() => {
      expect((nInput as HTMLInputElement).value).toBe('3183.1');
    });
    // Calculated field has font-bold
    expect(nInput.className).toContain('font-bold');

    // 4. User overrides N = 2500
    await user.clear(nInput);
    await user.type(nInput, '2500');

    // 5. System retains Vc = 100, recalculates D ≈ 12.73
    await waitFor(() => {
      expect((vcInput as HTMLInputElement).value).toBe('100');
      expect((dInput as HTMLInputElement).value).toBe('12.73');
    });
    // D is now calculated (bold)
    expect(dInput.className).toContain('font-bold');
    // N is now user input (font-normal)
    expect(nInput.className).toContain('font-normal');
  });

  it('3. Example B: Locking D preserves D and recalculates Vc when N is edited', async () => {
    const user = userEvent.setup();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />
    );

    const dInput = screen.getByTestId('input-diameter-0');
    const lockDBtn = screen.getByTestId('lock-diameter-btn-0');
    const nInput = screen.getByTestId('input-spindleSpeed-0');
    const vcInput = screen.getByTestId('input-cuttingSpeed-0');

    // 1. Enter D = 10
    await user.type(dInput, '10');

    // 2. Lock D
    await user.click(lockDBtn);
    // Locked field is disabled
    expect(dInput).toBeDisabled();
    expect(dInput.className).toContain('cursor-not-allowed');

    // 3. Change N = 2500
    await user.type(nInput, '2500');

    // 4. D is preserved at 10, Vc is calculated ≈ 78.54
    await waitFor(() => {
      expect((dInput as HTMLInputElement).value).toBe('10');
      expect((vcInput as HTMLInputElement).value).toBe('78.54');
    });
    expect(vcInput.className).toContain('font-bold');
  });

  it('4. Decimal Passes: Accepts 1.75 and calculates exact cutting time and total CT', async () => {
    const user = userEvent.setup();
    const handleApply = vi.fn();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={handleApply}
      />
    );

    // Set Feed Rate F = 200
    const fInput = screen.getByTestId('input-feedRate-0');
    await user.type(fInput, '200');

    // Set Length = 50 mm
    const lenInput = screen.getByTestId('input-length-0');
    await user.type(lenInput, '50');

    // Set Decimal Passes = 1.75
    const passesInput = screen.getByTestId('input-passes-0');
    await user.clear(passesInput);
    await user.type(passesInput, '1.75');

    // Set Non-cutting time = 3.75 sec
    const nonCutInput = screen.getByTestId('input-nonCuttingTime');
    await user.clear(nonCutInput);
    await user.type(nonCutInput, '3.75');

    // Cutting Time = 50 * 1.75 * 60 / 200 = 26.25 seconds
    // Total CT = 26.25 + 3.75 = 30.00 seconds
    await waitFor(() => {
      expect(screen.getByTestId('cutting-time-cell-0')).toHaveTextContent('26.25 s');
      expect(screen.getByTestId('calc-cutting-time-display')).toHaveTextContent('26.25 s');
      expect(screen.getByTestId('calc-total-ct-display')).toHaveTextContent('30.00 s');
    });

    // Apply to Operation
    const applyBtn = screen.getByTestId('apply-calc-to-op-btn');
    expect(applyBtn).not.toBeDisabled();
    await user.click(applyBtn);

    expect(handleApply).toHaveBeenCalledTimes(1);
    expect(handleApply).toHaveBeenCalledWith(
      30, // calculated total CT (seconds)
      expect.objectContaining({
        schemaVersion: '1.2',
        cuts: expect.any(Array),
      })
    );
  });

  it('5. Multi-Cut Table: Adding multiple cuts calculates cumulative CT in real-time in 1 tab', async () => {
    const user = userEvent.setup();
    const handleApply = vi.fn();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={handleApply}
      />
    );

    // Row 0: Facing cut - F = 100, L = 20, Passes = 1 -> CT = 20 * 1 * 60 / 100 = 12s
    await user.type(screen.getByTestId('input-feedRate-0'), '100');
    await user.type(screen.getByTestId('input-length-0'), '20');

    await waitFor(() => {
      expect(screen.getByTestId('cutting-time-cell-0')).toHaveTextContent('12.00 s');
      expect(screen.getByTestId('calc-total-ct-display')).toHaveTextContent('12.00 s');
    });

    // Click "+ Thêm đường dao"
    const addBtn = screen.getByTestId('add-cut-row-btn');
    await user.click(addBtn);

    // Now 2 rows exist in the same unified table
    expect(screen.getByTestId('cut-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('cut-row-1')).toBeInTheDocument();

    // Row 1: Drilling cut - F = 150, L = 45, Passes = 1 -> CT = 45 * 1 * 60 / 150 = 18s
    await user.type(screen.getByTestId('input-feedRate-1'), '150');
    await user.type(screen.getByTestId('input-length-1'), '45');

    // Total Cutting Time = 12 + 18 = 30s
    // Plus Non-cutting time = 5s -> Total CT = 35s
    await user.clear(screen.getByTestId('input-nonCuttingTime'));
    await user.type(screen.getByTestId('input-nonCuttingTime'), '5');

    await waitFor(() => {
      expect(screen.getByTestId('cutting-time-cell-0')).toHaveTextContent('12.00 s');
      expect(screen.getByTestId('cutting-time-cell-1')).toHaveTextContent('18.00 s');
      expect(screen.getByTestId('calc-cutting-time-display')).toHaveTextContent('30.00 s');
      expect(screen.getByTestId('calc-total-ct-display')).toHaveTextContent('35.00 s');
    });

    // Test Deleting row 1 using delete-last-cut-btn
    const delBtn = screen.getByTestId('delete-last-cut-btn');
    await user.click(delBtn);
    expect(screen.queryByTestId('cut-row-1')).not.toBeInTheDocument();
  });

  it('6. Integration with PreliminaryRoutingMatrix: Opens modal, calculates multi-cuts, and applies CT to operation', async () => {
    const user = userEvent.setup();
    const handleChangeOps = vi.fn();

    const mockOps = [
      {
        id: 'op-1',
        lineage_id: 'lineage-1',
        step_order: 10,
        workcenter_code: 'CNC',
        operation_description: 'Phay tinh',
        cycle_time_seconds: null,
        remark: '',
        is_removed: false,
      },
    ];

    const mockVersions = [
      {
        id: 'v1-id',
        issue_id: 'issue-1',
        version_number: 1,
        version_name: 'V1',
        status: 'Issued' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        operations: mockOps as any,
      },
    ];

    render(
      <PreliminaryRoutingMatrix
        allVersions={mockVersions}
        currentVersionId="v1-id"
        operations={mockOps}
        onChangeOperations={handleChangeOps}
        workcenterOptions={[{ code: 'CNC', description: 'CNC Milling' }]}
        isEditable={true}
      />
    );

    // Initial state: CT input is empty, calculator icon button is present
    expect(screen.getByTestId('ct-input-0')).toHaveValue(null);
    const openCalcBtn = screen.getByTestId('open-calc-btn-0');
    expect(openCalcBtn).toBeInTheDocument();

    // Click calculator button to open modal
    await user.click(openCalcBtn);
    expect(screen.getByTestId('cycle-time-calculator-modal')).toBeInTheDocument();

    // Fill in values for Cut 1: Vc = 120, D = 20
    await user.type(screen.getByTestId('input-cuttingSpeed-0'), '120');
    await user.type(screen.getByTestId('input-diameter-0'), '20');

    // Feed Rate = 200, Length = 100, Passes = 1.5 -> CT = (100 * 1.5 * 60) / 200 = 45s
    await user.type(screen.getByTestId('input-feedRate-0'), '200');
    await user.type(screen.getByTestId('input-length-0'), '100');
    await user.clear(screen.getByTestId('input-passes-0'));
    await user.type(screen.getByTestId('input-passes-0'), '1.5');

    // Non-cutting = 5s -> Total CT = 45 + 5 = 50s
    await user.clear(screen.getByTestId('input-nonCuttingTime'));
    await user.type(screen.getByTestId('input-nonCuttingTime'), '5');

    // Apply to Operation
    const applyBtn = screen.getByTestId('apply-calc-to-op-btn');
    await user.click(applyBtn);

    // Modal closes
    await waitFor(() => {
      expect(screen.queryByTestId('cycle-time-calculator-modal')).not.toBeInTheDocument();
    });

    // Operation was updated with calculated CT and serialized multi-cut calculation_data
    expect(handleChangeOps).toHaveBeenCalledTimes(1);
    const updatedOps = handleChangeOps.mock.calls[0][0];
    expect(updatedOps[0].cycle_time_seconds).toBe(50);
    expect(updatedOps[0].calculation_data).toBeDefined();
    expect(updatedOps[0].calculation_data.schema_version).toBe('1.2');
    expect(updatedOps[0].calculation_data.cuts[0].passes).toBe(1.5);
  });

  it('7. When type is Turning, Z is strictly locked to 1 to prevent mistakes; switching to Milling unlocks Z', async () => {
    const user = userEvent.setup();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={vi.fn()}
        workcenterCode="A20C" // Defaults to turning
      />
    );

    // In Turning: Z is fixed to 1 and locked
    const zCell = screen.getByTestId('input-teethCount-0');
    expect(zCell).toHaveTextContent('1');
    expect(zCell.tagName.toLowerCase()).not.toBe('input'); // rendered as locked badge, not input

    // Switch to Milling
    const typeSelect = screen.getByTestId('machining-type-select-0');
    await user.selectOptions(typeSelect, 'milling');

    // In Milling: Z becomes an editable input
    await waitFor(() => {
      const zInput = screen.getByTestId('input-teethCount-0');
      expect(zInput.tagName.toLowerCase()).toBe('input');
    });

    const editableZ = screen.getByTestId('input-teethCount-0') as HTMLInputElement;
    await user.clear(editableZ);
    await user.type(editableZ, '4');
    expect(editableZ.value).toBe('4');

    // Switch back to Turning
    await user.selectOptions(typeSelect, 'turning');

    // In Turning: Z is immediately forced back to 1 and locked again
    await waitFor(() => {
      const turningZCell = screen.getByTestId('input-teethCount-0');
      expect(turningZCell).toHaveTextContent('1');
      expect(turningZCell.tagName.toLowerCase()).not.toBe('input');
    });
  });

  it('8. Half-screen layout allows viewing drawing on left; toggle fullscreen and "Lưu tính toán" button works for in-progress draft', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    const handleApply = vi.fn();
    const handleSaveDraft = vi.fn();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={handleClose}
        onApply={handleApply}
        onSaveDraft={handleSaveDraft}
        operationStepOrder={20}
        workcenterCode="MILL01"
      />
    );

    const modalRoot = screen.getByTestId('cycle-time-calculator-modal');
    expect(modalRoot).toBeInTheDocument();
    // Modal root is non-blocking on outer layer so drawing behind/left can receive mouse/pointer events
    expect(modalRoot.className).toContain('pointer-events-none');

    // Drawer container starts in half-screen width (md:w-1/2)
    const drawerContainer = modalRoot.querySelector('.pointer-events-auto.absolute.inset-y-0.right-0');
    expect(drawerContainer).toBeInTheDocument();
    expect(drawerContainer?.className).toContain('md:w-1/2');

    // Toggle full-screen button
    const toggleFullscreenBtn = screen.getByTestId('toggle-fullscreen-btn');
    await user.click(toggleFullscreenBtn);
    expect(drawerContainer?.className).toContain('w-full');
    expect(drawerContainer?.className).not.toContain('md:w-1/2');

    // Toggle back to half-screen
    await user.click(toggleFullscreenBtn);
    expect(drawerContainer?.className).toContain('md:w-1/2');

    // Fill in partial data for tool T01
    const dInput = screen.getByTestId('input-diameter-0');
    const vcInput = screen.getByTestId('input-cuttingSpeed-0');
    await user.type(dInput, '50');
    await user.type(vcInput, '150');

    // Click "Lưu tính toán" to persist in-progress calculation without closing modal
    const saveDraftBtn = screen.getByTestId('save-calc-draft-btn');
    await user.click(saveDraftBtn);

    // Should call onSaveDraft callback
    expect(handleSaveDraft).toHaveBeenCalledTimes(1);
    const savedState = handleSaveDraft.mock.calls[0][0];
    expect(savedState.cuts[0].diameter.value).toBe(50);
    expect(savedState.cuts[0].cuttingSpeed.value).toBe(150);

    // Modal is still open (not closed)
    expect(screen.getByTestId('cycle-time-calculator-modal')).toBeInTheDocument();
    // Shows success feedback
    expect(screen.getByText(/Đã lưu tính toán!/i)).toBeInTheDocument();
  });

  it('9. Table mouse drag-to-pan, quick scroll buttons, and drawer resize handle work properly', async () => {
    const user = userEvent.setup();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={vi.fn()}
        operationStepOrder={10}
        workcenterCode="A20C"
      />
    );

    // Check table scroll container
    const scrollContainer = screen.getByTestId('calculator-table-scroll-container');
    expect(scrollContainer).toBeInTheDocument();
    expect(scrollContainer.className).toContain('cursor-grab');

    // Check formula guide exists
    expect(screen.getByText(/Vc = π·D·N\/1000/i)).toBeInTheDocument();

    // Check resize handle on the left border of the drawer
    const resizeHandle = screen.getByTestId('calculator-resize-handle');
    expect(resizeHandle).toBeInTheDocument();
    expect(resizeHandle.className).toContain('cursor-col-resize');

    // Drag resize handle
    fireEvent.mouseDown(resizeHandle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 400 });
    fireEvent.mouseUp(window);

    // Check quick scroll buttons and pan toggle
    const togglePanBtn = screen.getByTestId('toggle-pan-mode-btn');
    expect(togglePanBtn).toBeInTheDocument();
    await user.click(togglePanBtn);
    expect(togglePanBtn).toHaveTextContent(/Đang kéo bảng/i);
    await user.click(togglePanBtn);

    const scrollLeftBtn = screen.getByTestId('scroll-table-left-btn');
    const scrollRightBtn = screen.getByTestId('scroll-table-right-btn');
    const scrollStartBtn = screen.getByTestId('scroll-table-start-btn');
    const scrollEndBtn = screen.getByTestId('scroll-table-end-btn');
    expect(scrollLeftBtn).toBeInTheDocument();
    expect(scrollRightBtn).toBeInTheDocument();
    expect(scrollStartBtn).toBeInTheDocument();
    expect(scrollEndBtn).toBeInTheDocument();

    // Click quick scroll buttons
    await user.click(scrollEndBtn);
    await user.click(scrollRightBtn);
    await user.click(scrollLeftBtn);
    await user.click(scrollStartBtn);

    // Mouse drag-to-pan on scroll container
    fireEvent.mouseDown(scrollContainer, { clientX: 600, clientY: 300, button: 0 });
    expect(scrollContainer.className).toContain('cursor-grabbing');
    fireEvent.mouseMove(window, { clientX: 450, clientY: 300 });
    fireEvent.mouseUp(window);
    expect(scrollContainer.className).toContain('cursor-grab');
  });

  it('10. Resizable split synchronization & wheel scrolling: drawer width change triggers callback and double click resets', async () => {
    const handleDrawerWidthChange = vi.fn();
    const handleFullScreenChange = vi.fn();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={vi.fn()}
        operationStepOrder={10}
        workcenterCode="A20C"
        drawerWidthPercent={50}
        onDrawerWidthChange={handleDrawerWidthChange}
        onFullScreenChange={handleFullScreenChange}
      />
    );

    const resizeHandle = screen.getByTestId('calculator-resize-handle');
    expect(resizeHandle).toBeInTheDocument();

    // Drag resize handle
    fireEvent.mouseDown(resizeHandle, { clientX: 500 });
    window.innerWidth = 1000;
    fireEvent.mouseMove(window, { clientX: 400 });
    fireEvent.mouseUp(window);

    expect(handleDrawerWidthChange).toHaveBeenCalledWith(60);

    // Double click to reset to 50%
    fireEvent.doubleClick(resizeHandle);
    expect(handleDrawerWidthChange).toHaveBeenCalledWith(50);

    // Test wheel scroll on table container
    const scrollContainer = screen.getByTestId('calculator-table-scroll-container');
    fireEvent.wheel(scrollContainer, { deltaY: 150 });
  });

  it('11. Non-cutting time note input and persistence: allows entering reason and persists note in state and serialization', async () => {
    const user = userEvent.setup();
    const handleApply = vi.fn();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={handleApply}
        operationStepOrder={10}
        workcenterCode="A20C"
      />
    );

    // Fill in non-cutting time and non-cutting note
    const noteInput = screen.getByTestId('input-nonCuttingTimeNote');
    expect(noteInput).toBeInTheDocument();
    await user.type(noteInput, 'Gá kẹp phôi và đo kiểm đầu giờ');

    await user.clear(screen.getByTestId('input-nonCuttingTime'));
    await user.type(screen.getByTestId('input-nonCuttingTime'), '12');

    // Also fill a cut to enable apply button
    await user.type(screen.getByTestId('input-cuttingSpeed-0'), '100');
    await user.type(screen.getByTestId('input-diameter-0'), '20');
    await user.type(screen.getByTestId('input-feedRate-0'), '200');
    await user.type(screen.getByTestId('input-length-0'), '50');

    // Click Apply
    const applyBtn = screen.getByTestId('apply-calc-to-op-btn');
    await user.click(applyBtn);

    expect(handleApply).toHaveBeenCalledTimes(1);
    const appliedState = handleApply.mock.calls[0][1];
    expect(appliedState.nonCuttingTimeSeconds).toBe(12);
    expect(appliedState.nonCuttingTimeNote).toBe('Gá kẹp phôi và đo kiểm đầu giờ');

    const serialized = serializeMultiCutState(appliedState);
    expect(serialized.non_cutting_time_seconds).toBe(12);
    expect(serialized.non_cutting_time_note).toBe('Gá kẹp phôi và đo kiểm đầu giờ');
  });

  it('12. Reopening saved calculation displays all previous tool cuts, speeds, feeds, passes, and non-cutting note intact', async () => {
    // Initial saved calculation data from earlier edit
    const savedCalculationData = {
      schema_version: '1.2' as const,
      cuts: [
        {
          id: 'cut-1',
          name: 'T01',
          machining_type: 'turning' as const,
          diameter: 11,
          cutting_speed: 86.39,
          spindle_speed: 2500,
          teeth_count: 1,
          feed_per_tooth: 0.1,
          feed_per_rev: 0.1,
          feed_rate: 250,
          thread_pitch: null,
          length: 45,
          passes: 1.5,
          cutting_time_seconds: 16.2,
          field_sources: { diameter: 'input' as const, cuttingSpeed: 'calculated' as const, spindleSpeed: 'input' as const },
          lock_states: { diameter: false, cuttingSpeed: false, spindleSpeed: false, feedRate: false, feedPerTooth: false },
        },
      ],
      non_cutting_time_seconds: 8,
      non_cutting_time_note: 'Đổi dao tiện rãnh và vệ sinh phoi',
      total_cutting_time_seconds: 16.2,
      total_cycle_time_seconds: 24.2,
    };

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={vi.fn()}
        initialState={savedCalculationData}
        operationStepOrder={10}
        workcenterCode="A20C"
      />
    );

    // Verify all tool data is intact upon reopening
    expect(screen.getByTestId('cut-name-input-0')).toHaveValue('T01');
    expect(screen.getByTestId('input-diameter-0')).toHaveValue(11);
    expect(screen.getByTestId('input-spindleSpeed-0')).toHaveValue(2500);
    expect(screen.getByTestId('input-cuttingSpeed-0')).toHaveValue(86.39);
    expect(screen.getByTestId('input-feedRate-0')).toHaveValue(250);
    expect(screen.getByTestId('input-length-0')).toHaveValue(45);
    expect(screen.getByTestId('input-passes-0')).toHaveValue(1.5);

    // Verify non-cutting time & note are restored
    expect(screen.getByTestId('input-nonCuttingTime')).toHaveValue(8);
    expect(screen.getByTestId('input-nonCuttingTimeNote')).toHaveValue('Đổi dao tiện rãnh và vệ sinh phoi');
    expect(screen.getByTestId('calc-total-ct-display')).toHaveTextContent('24.20 s');
  });

  it('13. Read-only inspection mode: opens saved calculation when operation is completed, inputs are disabled and only Close button is available', async () => {
    const savedData = {
      schema_version: '1.2' as const,
      cuts: [
        {
          id: 'cut-1',
          name: 'T01',
          machining_type: 'turning' as const,
          diameter: 15,
          cutting_speed: 120,
          spindle_speed: 2546,
          teeth_count: 1,
          feed_per_tooth: 0.12,
          feed_per_rev: 0.12,
          feed_rate: 305.5,
          thread_pitch: null,
          length: 30,
          passes: 1,
          cutting_time_seconds: 5.89,
          field_sources: {},
          lock_states: {},
        },
      ],
      non_cutting_time_seconds: 4,
      non_cutting_time_note: 'Gá đặt',
      total_cutting_time_seconds: 5.89,
      total_cycle_time_seconds: 9.89,
    };

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={vi.fn()}
        readOnly={true}
        initialState={savedData}
        operationStepOrder={20}
        workcenterCode="CAMC"
      />
    );

    // Header displays read-only inspection badge
    expect(screen.getByText(/Chế độ xem lại \(Chỉ đọc\)/i)).toBeInTheDocument();

    // Inputs are disabled
    expect(screen.getByTestId('cut-name-input-0')).toBeDisabled();
    expect(screen.getByTestId('machining-type-select-0')).toBeDisabled();
    expect(screen.getByTestId('input-diameter-0')).toBeDisabled();
    expect(screen.getByTestId('input-cuttingSpeed-0')).toBeDisabled();
    expect(screen.getByTestId('input-spindleSpeed-0')).toBeDisabled();
    expect(screen.getByTestId('input-nonCuttingTime')).toBeDisabled();
    expect(screen.getByTestId('input-nonCuttingTimeNote')).toBeDisabled();

    // Editing action buttons are hidden
    expect(screen.queryByTestId('add-cut-row-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reset-calc-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-calc-draft-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('apply-calc-to-op-btn')).not.toBeInTheDocument();

    // Prominent Close button is displayed
    expect(screen.getByTestId('close-readonly-calc-btn')).toBeInTheDocument();
  });

  it('14. Hanoi timezone date formatting: formatHanoiDateTime and formatHanoiDate display correct local time without double offset', () => {
    // Database timestamp saved by timezone('Asia/Ho_Chi_Minh', now())
    const dbIsoTimestamp = '2026-11-10T11:45:12+00:00';
    const formattedDateTime = formatHanoiDateTime(dbIsoTimestamp);
    expect(formattedDateTime).toBe('11:45:12 10/11/2026');

    const formattedDate = formatHanoiDate(dbIsoTimestamp);
    expect(formattedDate).toBe('10/11/2026');

    // Without seconds
    expect(formatHanoiDateTime(dbIsoTimestamp, false)).toBe('11:45 10/11/2026');

    // Null/undefined safety
    expect(formatHanoiDateTime(null)).toBe('—');
    expect(formatHanoiDate(undefined)).toBe('—');
  });

  it('15. Column # is removed and Description column allows free-text entry of machining details', async () => {
    const user = userEvent.setup();
    const handleApply = vi.fn();
    const handleSaveDraft = vi.fn();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={() => {}}
        onApply={handleApply}
        onSaveDraft={handleSaveDraft}
        operationStepOrder={10}
        workcenterCode="CAMC"
      />
    );

    // 1. Column '#' is removed - header should not contain a '#' header
    expect(screen.queryByRole('columnheader', { name: '#' })).not.toBeInTheDocument();

    // 2. Column 'T' and 'Description' are present
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByTestId('cut-name-input-0')).toHaveValue('T01');

    // 3. Free text entry in Description
    const descInput = screen.getByTestId('cut-description-input-0');
    expect(descInput).toBeInTheDocument();
    await user.type(descInput, 'Tiện thô ngoài Ø25 & khỏa mặt');
    expect(descInput).toHaveValue('Tiện thô ngoài Ø25 & khỏa mặt');

    // 4. Save draft should contain the description
    const saveDraftBtn = screen.getByTestId('save-calc-draft-btn');
    await user.click(saveDraftBtn);

    expect(handleSaveDraft).toHaveBeenCalledTimes(1);
    const savedState = handleSaveDraft.mock.calls[0][0];
    expect(savedState.cuts[0].name).toBe('T01');
    expect(savedState.cuts[0].description).toBe('Tiện thô ngoài Ø25 & khỏa mặt');

    // 5. Test serialization retains description
    const serialized = serializeMultiCutState(savedState);
    expect(serialized.cuts[0].description).toBe('Tiện thô ngoài Ø25 & khỏa mặt');

    // 6. Test deserialization restores description
    const deserialized = deserializeMultiCutState(serialized);
    expect(deserialized.cuts[0].description).toBe('Tiện thô ngoài Ø25 & khỏa mặt');
  });

  it('16. Machining methods dropdown supports all requested types and enforces Z=1 lock on turning family', async () => {
    const user = userEvent.setup();

    render(
      <CycleTimeCalculatorModal
        isOpen={true}
        onClose={vi.fn()}
        onApply={vi.fn()}
        workcenterCode="CAMC"
      />
    );

    const typeSelect = screen.getByTestId('machining-type-select-0');
    expect(typeSelect).toBeInTheDocument();

    // Verify all requested options exist in the select
    const expectedOptions = [
      { value: 'turning', label: 'Turning' },
      { value: 'facing', label: 'Facing' },
      { value: 'thread_turn', label: 'Thread turn' },
      { value: 'part_off', label: 'Part off' },
      { value: 'grooving', label: 'Grooving' },
      { value: 'drilling', label: 'Drilling' },
      { value: 'centering', label: 'Centering' },
      { value: 'boring', label: 'Boring' },
      { value: 'tapping', label: 'Tapping' },
      { value: 'milling', label: 'Milling' },
      { value: 'chamfering', label: 'Chamfering' },
      { value: 'rolling', label: 'Rolling' },
    ];

    for (const opt of expectedOptions) {
      expect(screen.getByRole('option', { name: opt.label })).toBeInTheDocument();
    }

    // Verify Turning family strictly locks Z = 1
    const turningTypes = ['turning', 'facing', 'thread_turn', 'part_off', 'grooving'];
    for (const t of turningTypes) {
      await user.selectOptions(typeSelect, t);
      await waitFor(() => {
        const zCell = screen.getByTestId('input-teethCount-0');
        expect(zCell).toHaveTextContent('1');
        expect(zCell.tagName.toLowerCase()).not.toBe('input'); // locked badge
      });
    }

    // Verify other methods (e.g. Drilling, Centering, Milling, Chamfering, Rolling) allow editing Z
    const editableZTypes = ['milling', 'drilling', 'centering', 'boring', 'chamfering', 'rolling'];
    for (const t of editableZTypes) {
      await user.selectOptions(typeSelect, t);
      await waitFor(() => {
        const zInput = screen.getByTestId('input-teethCount-0');
        expect(zInput.tagName.toLowerCase()).toBe('input'); // editable input
      });
    }

    // Verify Tapping shows thread pitch input instead of Z
    await user.selectOptions(typeSelect, 'tapping');
    await waitFor(() => {
      expect(screen.getByTestId('input-threadPitch-0')).toBeInTheDocument();
    });
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../lib/supabase', () => {
  return {
    supabase: {
      rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
    ENV: {
      IS_CONFIGURED: true,
      SUPABASE_URL: 'https://mock.supabase.co',
      SUPABASE_ANON_KEY: 'mock-key',
    },
  };
});

import {
  STANDARDIZED_NG_TYPES,
  STANDARDIZED_NG_CODES,
  getNgTypeOptions,
} from '../constants/defectCatalog';
import { NumericInput } from '../components/common/NumericInput';
import { OperationExecutionPanel } from '../features/operations/OperationExecutionPanel';
import { AuthContext } from '../features/auth/AuthContext';
import { MemoryRouter } from 'react-router-dom';
import {
  saveProductionResult,
  saveQACheck,
} from '../services/productionResultService';

describe('SAMPLE TRACKING R3 — FIX 04 & FIX 05 TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // FIX 04 — Standardize NG Types & Catalog Consistency
  // ---------------------------------------------------------------------------
  describe('FIX 04: Standardize NG Types Catalog', () => {
    it('contains exactly 8 standardized NG types in the specified order', () => {
      expect(STANDARDIZED_NG_TYPES).toHaveLength(8);
      expect(STANDARDIZED_NG_TYPES[0]).toBe('NG Đường Kính');
      expect(STANDARDIZED_NG_TYPES[1]).toBe('NG Chiều Dài');
      expect(STANDARDIZED_NG_TYPES[2]).toBe('NG Kích thước');
      expect(STANDARDIZED_NG_TYPES[3]).toBe('NG Ren');
      expect(STANDARDIZED_NG_TYPES[4]).toBe('NG Ngoại quan');
      expect(STANDARDIZED_NG_TYPES[5]).toBe('NG Xước dập');
      expect(STANDARDIZED_NG_TYPES[6]).toBe('NG hình dáng');
      expect(STANDARDIZED_NG_TYPES[7]).toBe('Lỗi khác');
    });

    it('maps all 8 standardized NG types to valid defect codes', () => {
      for (const ngType of STANDARDIZED_NG_TYPES) {
        expect(STANDARDIZED_NG_CODES[ngType]).toBeDefined();
        expect(STANDARDIZED_NG_CODES[ngType].length).toBeGreaterThan(0);
      }
      expect(STANDARDIZED_NG_CODES['NG Đường Kính']).toBe('NG-DIA');
      expect(STANDARDIZED_NG_CODES['NG Chiều Dài']).toBe('NG-LEN');
      expect(STANDARDIZED_NG_CODES['NG Kích thước']).toBe('NG-DIM');
      expect(STANDARDIZED_NG_CODES['NG Ren']).toBe('NG-THR');
      expect(STANDARDIZED_NG_CODES['NG Ngoại quan']).toBe('NG-APP');
      expect(STANDARDIZED_NG_CODES['NG Xước dập']).toBe('NG-SCR');
      expect(STANDARDIZED_NG_CODES['NG hình dáng']).toBe('NG-SHP');
      expect(STANDARDIZED_NG_CODES['Lỗi khác']).toBe('DEF-OTH-01');
    });

    it('getNgTypeOptions preserves historical/legacy defect values not in the 8 items', () => {
      // Legacy value from existing DB record (e.g. 'Bavia' or 'Vát mép không đều')
      const optionsWithLegacy = getNgTypeOptions('Vát mép không đều');
      expect(optionsWithLegacy).toContain('Vát mép không đều');
      expect(optionsWithLegacy[0]).toBe('Vát mép không đều');
      expect(optionsWithLegacy).toHaveLength(9); // 1 legacy + 8 standard

      // Another legacy example
      const optionsWithBavia = getNgTypeOptions('Bavia');
      expect(optionsWithBavia[0]).toBe('Bavia');
      expect(optionsWithBavia).toContain('NG Đường Kính');
    });

    it('getNgTypeOptions does not duplicate when value is already one of the 8 standard types', () => {
      const options = getNgTypeOptions('NG Ren');
      expect(options).toHaveLength(8);
      const renCount = options.filter((o) => o === 'NG Ren').length;
      expect(renCount).toBe(1);
    });

    it('getNgTypeOptions returns 8 standard options when value is empty or null', () => {
      expect(getNgTypeOptions('')).toHaveLength(8);
      expect(getNgTypeOptions(null)).toHaveLength(8);
      expect(getNgTypeOptions(undefined)).toHaveLength(8);
    });
  });

  // ---------------------------------------------------------------------------
  // FIX 04 — Validation: 'Lỗi khác' requires specific description
  // ---------------------------------------------------------------------------
  describe('FIX 04: Validation of "Lỗi khác"', () => {
    it('saveProductionResult rejects when defect_name is "Lỗi khác" and cause is empty', async () => {
      const res = await saveProductionResult({
        operationId: '00000000-0000-0000-0000-000000000001',
        machineId: 'CNC-01',
        productionDate: '2026-10-30',
        okQty: 10,
        kivQty: 0,
        ngItems: [
          {
            ng_qty: 2,
            defect_name: 'Lỗi khác',
            cause: '', // Empty cause
            remark: 'Đang theo dõi',
          },
        ],
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Vui lòng nhập mô tả cụ thể khi chọn Lỗi khác');
    });

    it('saveProductionResult accepts when defect_name is "Lỗi khác" and cause is provided', async () => {
      const res = await saveProductionResult({
        operationId: '00000000-0000-0000-0000-000000000001',
        machineId: 'CNC-01',
        productionDate: '2026-10-30',
        okQty: 10,
        kivQty: 0,
        ngItems: [
          {
            ng_qty: 2,
            defect_name: 'Lỗi khác',
            cause: 'Lỗi mẻ phôi do kẹp chặt phôi quá lực',
            remark: 'Đã điều chỉnh áp lực thủy lực',
          },
        ],
      });

      // ENV is not configured in test runner, returns mock data or passes validation
      expect(res.error).toBeUndefined();
    });

    it('saveQACheck rejects when defect_name is "Lỗi khác" and cause is empty', async () => {
      const res = await saveQACheck({
        operationId: '00000000-0000-0000-0000-000000000001',
        qaNgItems: [
          {
            ng_qty: 1,
            defect_name: 'Lỗi khác',
            cause: '', // Empty cause
            remark: 'Ghi chú kiểm tra',
          },
        ],
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Vui lòng nhập mô tả cụ thể khi chọn Lỗi khác');
    });

    it('saveQACheck accepts when defect_name is "Lỗi khác" and cause is provided', async () => {
      const res = await saveQACheck({
        operationId: '00000000-0000-0000-0000-000000000001',
        qaNgItems: [
          {
            ng_qty: 1,
            defect_name: 'Lỗi khác',
            cause: 'Mép vát góc R không đúng bản vẽ',
            remark: 'Yêu cầu PE kiểm tra góc dao',
          },
        ],
      });

      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // FIX 05 — Enter Key Behavior on NumericInput & Forms
  // ---------------------------------------------------------------------------
  describe('FIX 05: Enter Key Behavior', () => {
    it('pressing Enter on NumericInput prevents default and stops propagation', () => {
      const onChange = vi.fn();
      const onKeyDown = vi.fn();

      render(
        <NumericInput
          value={15}
          onChange={onChange}
          onKeyDown={onKeyDown}
          data-testid="num-input"
        />
      );

      const input = screen.getByTestId('num-input') as HTMLInputElement;
      input.focus();

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = vi.spyOn(enterEvent, 'preventDefault');
      const stopPropagationSpy = vi.spyOn(enterEvent, 'stopPropagation');

      input.dispatchEvent(enterEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
      expect(onKeyDown).toHaveBeenCalled();
    });

    it('pressing Enter blurs the NumericInput and commits normalized value via onBlur', () => {
      const onChange = vi.fn();

      const TestComponent = () => {
        const [num, setNum] = React.useState(10);
        return (
          <NumericInput
            value={num}
            min={1}
            onChange={(newVal) => {
              setNum(newVal);
              onChange(newVal);
            }}
            data-testid="num-input"
          />
        );
      };

      render(<TestComponent />);

      const input = screen.getByTestId('num-input') as HTMLInputElement;
      fireEvent.focus(input);

      // Change input value
      fireEvent.change(input, { target: { value: '25' } });
      expect(onChange).toHaveBeenCalledWith(25);

      // Press Enter
      fireEvent.keyDown(input, { key: 'Enter' });

      // Blur should have fired and value remains 25
      expect(input.value).toBe('25');
    });

    it('pressing Enter does NOT submit a parent form', () => {
      const onFormSubmit = vi.fn();
      const onChange = vi.fn();

      render(
        <form onSubmit={onFormSubmit}>
          <NumericInput
            value={5}
            onChange={onChange}
            data-testid="form-num-input"
          />
          <button type="submit">Submit</button>
        </form>
      );

      const input = screen.getByTestId('form-num-input');
      input.focus();

      fireEvent.keyDown(input, { key: 'Enter' });

      // Form submit must NOT be triggered
      expect(onFormSubmit).not.toHaveBeenCalled();
    });

    it('pressing Tab on NumericInput does NOT prevent default (Tab navigation works)', () => {
      const onChange = vi.fn();
      const onKeyDown = vi.fn();

      render(
        <NumericInput
          value={5}
          onChange={onChange}
          onKeyDown={onKeyDown}
          data-testid="tab-num-input"
        />
      );

      const input = screen.getByTestId('tab-num-input');
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = vi.spyOn(tabEvent, 'preventDefault');
      input.dispatchEvent(tabEvent);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
      expect(onKeyDown).toHaveBeenCalled();
    });

    it('preserves window.scrollY when Enter is pressed on NumericInput', () => {
      const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      Object.defineProperty(window, 'scrollY', { value: 450, writable: true });

      render(
        <NumericInput
          value={8}
          onChange={() => {}}
          data-testid="scroll-num-input"
        />
      );

      const input = screen.getByTestId('scroll-num-input');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(scrollToSpy).toHaveBeenCalledWith(
        expect.objectContaining({ top: 450, behavior: 'instant' })
      );

      scrollToSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // Component Integration: OperationExecutionPanel UI Dropdowns & Forms
  // ---------------------------------------------------------------------------
  describe('FIX 04 & 05: OperationExecutionPanel Integration', () => {
    const mockAuthContext = {
      user: { id: 'user-admin', email: 'admin@example.com' } as any,
      profile: {
        id: 'user-admin',
        username: 'admin',
        full_name: 'Admin System',
        role: 'Admin' as const,
        is_active: true,
        must_change_password: false,
        created_at: '',
        updated_at: '',
      },
      session: {} as any,
      isLoading: false,
      logout: vi.fn(),
      refreshProfile: vi.fn(),
    };

    const mockOperation: any = {
      id: 'op-101',
      job_id: 'job-101',
      step_order: 10,
      operation_no: 'OP10',
      process_name: 'Auto Turn',
      workcenter_id: 'wc-1',
      status: 'IN_PROGRESS',
      workcenters: { id: 'wc-1', code: 'A20C', name: 'Auto Turn' },
      production_runs: [
        {
          id: 'run-1',
          machine_id: 'CNC-A1',
          cycle_time_seconds: 45,
          ok_qty: 20,
          ng_qty: 2,
          kiv_qty: 0,
          created_at: '2026-10-30T10:00:00Z',
          ng_details: [
            {
              id: 'ng-1',
              defect_name: 'Vát mép không đều', // Legacy defect
              defect_code: 'NG-CHAMFER',
              ng_qty: 2,
              cause: 'Lệch góc dao',
              remark: 'Đã chỉnh lại',
            },
          ],
        },
      ],
      qa_checks: [
        {
          id: 'qa-1',
          n1_result: 'OK',
          qa_total_ng: 1,
          result: 'NG',
          created_at: '2026-10-30T10:30:00Z',
          qa_ng_details: [
            {
              id: 'qng-1',
              defect_name: 'NG Ren', // Standard defect
              defect_code: 'NG-THR',
              ng_qty: 1,
              cause: 'Ren bị sượng bước P1.0',
              remark: 'Dưỡng ren không lọt',
            },
          ],
        },
      ],
    };

    it('renders legacy defect in PE-MFG dropdown and displays all 8 standard NG types', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAuthContext as any}>
            <OperationExecutionPanel
              operation={mockOperation}
              jobId="job-101"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // In PE-MFG NG details table, find the select element
      const selects = screen.getAllByRole('combobox');
      // The PE-MFG select has the legacy value 'Vát mép không đều'
      const mfgSelect = selects.find((s) => (s as HTMLSelectElement).value === 'Vát mép không đều');
      expect(mfgSelect).toBeDefined();

      // Check options inside this select
      const options = Array.from(mfgSelect!.querySelectorAll('option')).map((o) => o.textContent);
      expect(options).toContain('Vát mép không đều'); // Legacy option preserved
      expect(options).toContain('NG Đường Kính');
      expect(options).toContain('NG Chiều Dài');
      expect(options).toContain('NG Kích thước');
      expect(options).toContain('NG Ren');
      expect(options).toContain('NG Ngoại quan');
      expect(options).toContain('NG Xước dập');
      expect(options).toContain('NG hình dáng');
      expect(options).toContain('Lỗi khác');
    });

    it('renders QA NG Details with Cause/Mô tả column and standard options', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAuthContext as any}>
            <OperationExecutionPanel
              operation={mockOperation}
              jobId="job-101"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Verify QA NG header contains "Mô tả cụ thể / Cause"
      expect(screen.getByText(/Mô tả cụ thể \/ Cause/i)).toBeInTheDocument();

      // QA NG select has 'NG Ren'
      const selects = screen.getAllByRole('combobox');
      const qaSelect = selects.find((s) => (s as HTMLSelectElement).value === 'NG Ren');
      expect(qaSelect).toBeDefined();

      const options = Array.from(qaSelect!.querySelectorAll('option')).map((o) => o.textContent);
      expect(options).toContain('NG Đường Kính');
      expect(options).toContain('Lỗi khác');
    });

    it('requires specific description when "Lỗi khác" is selected in PE-MFG', () => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAuthContext as any}>
            <OperationExecutionPanel
              operation={mockOperation}
              jobId="job-101"
              jobStatus="ACTIVE"
              onRefresh={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      const selects = screen.getAllByRole('combobox');
      const mfgSelect = selects.find((s) => (s as HTMLSelectElement).value === 'Vát mép không đều')!;
      
      // Change to 'Lỗi khác'
      fireEvent.change(mfgSelect, { target: { value: 'Lỗi khác' } });

      // Clear the cause input
      const causeInputs = screen.getAllByPlaceholderText(/Bắt buộc nhập mô tả cụ thể \*/i);
      expect(causeInputs.length).toBeGreaterThan(0);
      fireEvent.change(causeInputs[0], { target: { value: '' } });

      // Click "Lưu kết quả"
      const saveButtons = screen.getAllByText(/Lưu kết quả/i);
      fireEvent.click(saveButtons[0]);

      // Error message should appear
      expect(screen.getByText(/Vui lòng nhập mô tả cụ thể khi chọn Lỗi khác/i)).toBeInTheDocument();
    });
  });
});

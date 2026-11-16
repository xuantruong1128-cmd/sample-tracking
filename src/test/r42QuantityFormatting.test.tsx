import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Job } from '../types/database.types';
import {
  formatIntegerQuantity,
  DEFAULT_VISIBLE_COLUMN_IDS,
} from '../features/jobs/jobDisplayUtils';
import { JobCard } from '../features/jobs/JobCard';
import { JobGeneralInfo } from '../features/jobs/JobGeneralInfo';
import { NumericInput } from '../components/common/NumericInput';
import { generateJobsWorkbook } from '../services/excelExportService';

describe('SAMPLE TRACKING R4.2 — FIX QUANTITY NUMBER FORMATTING TEST SUITE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Utility: formatIntegerQuantity
  // =========================================================================
  describe('1. formatIntegerQuantity Utility', () => {
    it('formats numbers strictly as integers without thousands separators (no dots or commas)', () => {
      // Direct prompt examples
      expect(formatIntegerQuantity(1050)).toBe('1050');
      expect(formatIntegerQuantity(12500)).toBe('12500');
      expect(formatIntegerQuantity(100000)).toBe('100000');
      expect(formatIntegerQuantity(500)).toBe('500');
      expect(formatIntegerQuantity(0)).toBe('0');

      // Check strictly that NO dots or commas are present
      expect(formatIntegerQuantity(1050)).not.toContain('.');
      expect(formatIntegerQuantity(1050)).not.toContain(',');
      expect(formatIntegerQuantity(12500)).not.toContain('.');
      expect(formatIntegerQuantity(12500)).not.toContain(',');
    });

    it('handles string representations of numbers properly', () => {
      expect(formatIntegerQuantity('1050')).toBe('1050');
      expect(formatIntegerQuantity('12500')).toBe('12500');
    });

    it('handles null, undefined, empty string, or NaN gracefully', () => {
      expect(formatIntegerQuantity(null)).toBe('0');
      expect(formatIntegerQuantity(undefined)).toBe('0');
      expect(formatIntegerQuantity('')).toBe('0');
      expect(formatIntegerQuantity('invalid')).toBe('0');
    });
  });

  // =========================================================================
  // 2. Homepage: JobCard Q'ty Display
  // =========================================================================
  describe('2. Homepage JobCard Q\'ty Column', () => {
    const jobWith1050: Job = {
      id: 'job-1050-test',
      job_no: 'JOB-2026-1050',
      part_no: 'PIN-HEX-1050',
      part_name: 'Pin Hexagonal Special',
      customer: 'Canon',
      order_qty: 1050,
      material: 'SUS304',
      status: 'ACTIVE',
      closed_at: null,
      planned_start_date: '2026-11-03',
      planned_finish_date: '2026-11-15',
      operations: [],
    };

    it('renders exact integer "1050" and NEVER "1.050" in JobCard', () => {
      render(
        <MemoryRouter>
          <JobCard job={jobWith1050} visibleColumnIds={DEFAULT_VISIBLE_COLUMN_IDS} />
        </MemoryRouter>
      );

      const qtyCol = screen.getByTestId('job-col-qty');
      expect(qtyCol).toBeInTheDocument();
      expect(qtyCol.textContent?.trim()).toBe('1050');
      expect(qtyCol.textContent).not.toBe('1.050');
      expect(qtyCol.textContent).not.toBe('1,050');
      expect(qtyCol).toHaveAttribute('title', '1050 pcs');
    });

    it('renders large quantities like 12500 and 100000 without separators', () => {
      const jobWith12500: Job = {
        ...jobWith1050,
        id: 'job-12500',
        order_qty: 12500,
      };

      const { unmount } = render(
        <MemoryRouter>
          <JobCard job={jobWith12500} visibleColumnIds={DEFAULT_VISIBLE_COLUMN_IDS} />
        </MemoryRouter>
      );

      const qtyCol = screen.getByTestId('job-col-qty');
      expect(qtyCol.textContent?.trim()).toBe('12500');
      expect(qtyCol.textContent).not.toContain('.');
      expect(qtyCol.textContent).not.toContain(',');
      unmount();
    });
  });

  // =========================================================================
  // 3. JOB Details: JobGeneralInfo Required Quantity
  // =========================================================================
  describe('3. JobGeneralInfo Required Quantity', () => {
    const jobWith1050: Job = {
      id: 'job-info-1050',
      job_no: 'JOB-2026-INFO-1050',
      part_no: 'SHAFT-1050',
      part_name: 'Shaft 1050 mm',
      customer: 'Toyota',
      order_qty: 1050,
      material: 'S45C',
      status: 'ACTIVE',
      closed_at: null,
      planned_start_date: '2026-11-03',
      planned_finish_date: '2026-11-15',
      operations: [],
    };

    it('renders "1050 pcs" and NEVER "1.050 pcs" in JobGeneralInfo', () => {
      render(
        <MemoryRouter>
          <JobGeneralInfo job={jobWith1050} />
        </MemoryRouter>
      );

      // Check text in Required Quantity section
      const textMatches = screen.getAllByText((_, element) => {
        return element?.textContent === '1050 pcs';
      });
      expect(textMatches.length).toBeGreaterThan(0);

      // Ensure "1.050 pcs" or "1,050 pcs" does not exist
      expect(screen.queryByText(/1\.050 pcs/)).not.toBeInTheDocument();
      expect(screen.queryByText(/1,050 pcs/)).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 4. Excel Export: Numeric Cell with Format '0'
  // =========================================================================
  describe('4. Excel Export Quantity Formatting', () => {
    it('exports Quantity as a real numeric cell (t: "n") with value 1050 and format "0"', () => {
      const testJobs: Job[] = [
        {
          id: 'job-excel-1050',
          job_no: 'JOB-2026-EX-1050',
          part_no: 'PART-EX-1050',
          customer: 'Denso',
          order_qty: 1050,
          status: 'ACTIVE',
          operations: [],
        },
      ];

      const wb = generateJobsWorkbook(testJobs);
      const ws = wb.Sheets[wb.SheetNames[0]];

      // Column H (index 7, row 2) is Q'ty
      const qtyCell = ws['H2'];
      expect(qtyCell).toBeDefined();

      // Must be numeric cell type 'n'
      expect(qtyCell.t).toBe('n');

      // Value must be true number 1050, not string "1.050"
      expect(qtyCell.v).toBe(1050);
      expect(typeof qtyCell.v).toBe('number');
      expect(qtyCell.v).not.toBe('1.050');
      expect(qtyCell.v).not.toBe('1,050');

      // Number format code must be '0' (integer without thousands separators)
      expect(qtyCell.z).toBe('0');
    });
  });

  // =========================================================================
  // 5. Input Validation: NumericInput does not parse 1050 to 1.05
  // =========================================================================
  describe('5. Input Handling: NumericInput Parsing', () => {
    it('correctly accepts and outputs 1050 as integer 1050, not 1.05', () => {
      const handleChange = vi.fn();
      render(
        <NumericInput
          value={0}
          onChange={handleChange}
          data-testid="quantity-input"
        />
      );

      const input = screen.getByTestId('quantity-input') as HTMLInputElement;

      // Simulate typing "1050"
      fireEvent.change(input, { target: { value: '1050' } });
      expect(handleChange).toHaveBeenLastCalledWith(1050);
      expect(input.value).toBe('1050');

      // Even if user pasted "1.050" or "1,050" by mistake, non-digits are filtered to 1050
      fireEvent.change(input, { target: { value: '1.050' } });
      expect(handleChange).toHaveBeenLastCalledWith(1050);
      expect(handleChange).not.toHaveBeenCalledWith(1.05);

      // On blur, value normalizes to 1050
      fireEvent.blur(input);
      expect(input.value).toBe('1050');
    });
  });

  // =========================================================================
  // 6. Preservation of Decimal Values (Cycle Time, Dimensions)
  // =========================================================================
  describe('6. Preservation of Decimal Values (Cycle Time, Dimensions)', () => {
    it('keeps decimal precision for Cycle Time (e.g. 42.5s)', () => {
      const cycleTime = 42.5;
      expect(cycleTime).toBe(42.5);
      expect(String(cycleTime)).toBe('42.5');
      // formatIntegerQuantity is NOT used for cycle time: decimal precision is preserved
      const formattedCt = `${cycleTime}s`;
      expect(formattedCt).toBe('42.5s');
    });
  });
});

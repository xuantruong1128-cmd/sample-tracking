import type { Job } from '../../types/database.types';
import { getJobDisplayStatus } from './jobDisplayUtils';

export type FilterField =
  | 'status'
  | 'item_number'
  | 'job_number'
  | 'customer'
  | 'start_date'
  | 'closing_date'
  | 'process';

export type TextOperator = 'contain' | 'equal';
export type DateOperator = 'equal' | 'range';
export type FilterOperator = TextOperator | DateOperator;
export type StatusFilterValue = 'ACTIVE' | 'RUNNING' | 'CLOSE';

export interface FilterCondition {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: string;
  valueTo?: string;
}

/**
 * Creates a new condition with sensible defaults.
 */
export function createDefaultCondition(id?: string, field: FilterField = 'item_number'): FilterCondition {
  const condId = id || `cond_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  if (field === 'status') {
    return {
      id: condId,
      field: 'status',
      operator: 'equal',
      value: 'ACTIVE',
    };
  }
  if (field === 'start_date' || field === 'closing_date') {
    return {
      id: condId,
      field,
      operator: 'equal',
      value: '',
    };
  }
  return {
    id: condId,
    field,
    operator: 'contain',
    value: '',
  };
}

/**
 * Checks if a condition is complete enough to be applied.
 * Incomplete conditions are safely ignored without filtering out items.
 */
export function isConditionComplete(cond: FilterCondition): boolean {
  if (cond.field === 'status') {
    return Boolean(cond.value && cond.value.trim().length > 0);
  }
  if (cond.field === 'start_date' || cond.field === 'closing_date') {
    if (cond.operator === 'range') {
      return Boolean(cond.value && cond.valueTo);
    }
    return Boolean(cond.value);
  }
  // Text fields (item_number, job_number, customer, process)
  return Boolean(cond.value && cond.value.trim().length > 0);
}

/**
 * Validates a condition for semantic errors (e.g. From > To in date range).
 * Returns error string if invalid, or null if valid.
 */
export function validateCondition(cond: FilterCondition): string | null {
  if ((cond.field === 'start_date' || cond.field === 'closing_date') && cond.operator === 'range') {
    if (cond.value && cond.valueTo && cond.value > cond.valueTo) {
      return 'Từ ngày (From) không được lớn hơn Đến ngày (To).';
    }
  }
  return null;
}

/**
 * Validates all conditions in the list. Returns the first error or null.
 */
export function validateConditions(conditions: FilterCondition[]): string | null {
  for (const cond of conditions) {
    const err = validateCondition(cond);
    if (err) return err;
  }
  return null;
}

/**
 * Extracts normalized YYYY-MM-DD closing dates for a Job.
 * Prioritizes `closed_at` (actual closing timestamp),
 * falls back to `planned_finish_date` if `closed_at` is null.
 */
export function getJobClosingDates(job: Job): string[] {
  const dates: string[] = [];
  if (job.closed_at) {
    // 1. ISO UTC date part
    const isoDate = job.closed_at.slice(0, 10);
    dates.push(isoDate);

    // 2. Local date part (e.g. Vietnam UTC+7)
    const d = new Date(job.closed_at);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const localDate = `${year}-${month}-${day}`;
      if (!dates.includes(localDate)) {
        dates.push(localDate);
      }
    }
  } else if (job.planned_finish_date) {
    dates.push(job.planned_finish_date);
  }
  return dates;
}

/**
 * Evaluates whether a single job satisfies a single condition.
 */
export function evaluateJobCondition(job: Job, cond: FilterCondition): boolean {
  if (!isConditionComplete(cond)) {
    return true; // Incomplete conditions are ignored
  }

  switch (cond.field) {
    case 'status': {
      const target = cond.value.trim().toUpperCase();
      // R4.1 FIX 01: Unify filter logic with the single source of truth for Homepage status display
      const displayStatus = getJobDisplayStatus(job).toUpperCase();

      if (target === 'RUNNING') {
        return displayStatus === 'RUNNING';
      }
      if (target === 'ACTIVE') {
        return displayStatus === 'ACTIVE';
      }
      if (target === 'CLOSE') {
        return displayStatus === 'CLOSE' || job.status === 'CLOSE' || job.status === 'ARCHIVE' || job.status === 'PURGED';
      }
      return displayStatus === target || (job.status && job.status.toUpperCase() === target);
    }

    case 'item_number': {
      const query = cond.value.trim().toLowerCase();
      const partNo = (job.part_no || '').trim().toLowerCase();
      if (cond.operator === 'equal') {
        return partNo === query;
      }
      return partNo.includes(query);
    }

    case 'job_number': {
      const query = cond.value.trim().toLowerCase();
      const jobNo = (job.job_no || '').trim().toLowerCase();
      if (cond.operator === 'equal') {
        return jobNo === query;
      }
      return jobNo.includes(query);
    }

    case 'customer': {
      const query = cond.value.trim().toLowerCase();
      const customer = (job.customer || '').trim().toLowerCase();
      if (cond.operator === 'equal') {
        return customer === query;
      }
      return customer.includes(query);
    }

    case 'start_date': {
      const jobDate = job.planned_start_date; // YYYY-MM-DD
      if (!jobDate) return false;
      if (cond.operator === 'range') {
        const from = cond.value;
        const to = cond.valueTo || '';
        return jobDate >= from && jobDate <= to;
      }
      // Equal
      return jobDate === cond.value;
    }

    case 'closing_date': {
      const closingDates = getJobClosingDates(job);
      if (closingDates.length === 0) return false;
      if (cond.operator === 'range') {
        const from = cond.value;
        const to = cond.valueTo || '';
        return closingDates.some((d) => d >= from && d <= to);
      }
      // Equal
      return closingDates.some((d) => d === cond.value);
    }

    case 'process': {
      const query = cond.value.trim().toLowerCase();
      const operations = job.operations || [];
      if (cond.operator === 'equal') {
        return operations.some(
          (op) => (op.operation_name || '').trim().toLowerCase() === query
        );
      }
      // Contain
      return operations.some((op) =>
        (op.operation_name || '').toLowerCase().includes(query)
      );
    }

    default:
      return true;
  }
}

/**
 * Filter a list of jobs by applying all complete conditions with AND logic.
 */
export function filterJobs(jobs: Job[], conditions: FilterCondition[]): Job[] {
  const activeConditions = conditions.filter(isConditionComplete);
  if (activeConditions.length === 0) {
    return jobs;
  }

  // If any condition has validation error (e.g. From > To), reject
  const err = validateConditions(activeConditions);
  if (err) {
    return [];
  }

  return jobs.filter((job) =>
    activeConditions.every((cond) => evaluateJobCondition(job, cond))
  );
}

import type { Job, JobOperation, JobStatus } from './database.types';

export type { Job, JobOperation, JobStatus };

export interface JobFilterState {
  searchTerm: string;
  status: 'ALL' | 'ACTIVE' | 'CLOSE';
}

export type OperationColor = 'GREEN' | 'YELLOW' | 'BLACK';

export interface OperationColorInfo {
  color: OperationColor;
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
}

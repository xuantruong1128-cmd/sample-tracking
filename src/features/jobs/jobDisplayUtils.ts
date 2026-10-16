import type { JobOperation } from '../../types/database.types';

/**
 * UI-02 R2: Work Center Master list from Master data.xlsx
 * Contains 37 official work center definitions.
 */
export const OFFICIAL_WORKCENTERS = [
  { no: 1, code: 'CAMC', mcType: 'CAM', description: 'Auto Turn' },
  { no: 2, code: 'B12C', mcType: 'Cincom B12', description: 'Auto Turn' },
  { no: 3, code: 'A20C', mcType: 'Cincom citizent A20', description: 'Auto Turn' },
  { no: 4, code: 'CYGG', mcType: 'Cilindrical Grinding', description: 'Auto Turn' },
  { no: 5, code: 'D&TS', mcType: 'Drilling and Tapping', description: 'Drill & Tap' },
  { no: 6, code: 'B26C', mcType: 'Tsugami BO265', description: 'Auto Turn' },
  { no: 7, code: 'L32C', mcType: 'Cincom Citizent L32', description: 'Auto Turn' },
  { no: 8, code: 'L20C', mcType: 'Tsugami L20', description: 'Auto Turn' },
  { no: 9, code: 'L16C', mcType: 'Tsugami L16', description: 'Auto Turn' },
  { no: 10, code: 'B18C', mcType: 'Tsugami B18', description: 'Auto Turn' },
  { no: 11, code: 'SR2C', mcType: 'Star SR20', description: 'Auto Turn' },
  { no: 12, code: 'SB2C', mcType: 'Star SB20R', description: 'Auto Turn' },
  { no: 13, code: 'SR3C', mcType: 'Star SR32', description: 'Auto Turn' },
  { no: 14, code: 'CGMG', mcType: 'Paragon RC12', description: 'Centerless Grinding' },
  { no: 15, code: 'CGMG', mcType: 'Paragon RC20', description: 'Centerless Grinding' },
  { no: 16, code: 'CGMG', mcType: 'DX18 CNC CG', description: 'Centerless Grinding' },
  { no: 17, code: 'CGMG', mcType: 'DX18 CG', description: 'Centerless Grinding' },
  { no: 18, code: 'D&TS', mcType: 'Fanuc', description: 'Drill & Tap' },
  { no: 19, code: 'SPMS', mcType: 'SPM', description: 'Milling' },
  { no: 20, code: 'KURS', mcType: 'Rolling/Knurling', description: 'Rolling/Knurling' },
  { no: 21, code: 'IDHL', mcType: 'Induction Hardening', description: 'Induction Hardening' },
  { no: 22, code: 'FINS', mcType: 'Buffing', description: 'Buffing' },
  { no: 23, code: 'STAS', mcType: 'Stacking', description: 'Stacking' },
  { no: 24, code: 'TMBS', mcType: 'Tumbling', description: 'Tumbling' },
  { no: 25, code: 'TMBS', mcType: 'Magnetic polishing', description: 'Magnetic polishing' },
  { no: 26, code: 'FINS', mcType: 'Chamfering', description: 'Chamfering' },
  { no: 27, code: 'FINS', mcType: 'Polishing', description: 'Polishing' },
  { no: 28, code: 'ASYS', mcType: 'Assembly', description: 'Assembly' },
  { no: 29, code: 'MYNC', mcType: 'STS Chucker', description: 'STS Chucker' },
  { no: 30, code: 'GCMN', mcType: 'Gear cutting', description: 'Gear cutting' },
  { no: 31, code: 'AUTP', mcType: 'Plating', description: 'Plating' },
  { no: 32, code: 'MANP', mcType: 'Plating', description: 'Plating' },
  { no: 33, code: 'PLPP', mcType: 'Plating', description: 'Plating' },
  { no: 34, code: 'WSHP', mcType: 'Washing', description: 'Washing' },
  { no: 35, code: 'Subcon', mcType: 'Subcon', description: 'Subcon' },
  { no: 36, code: 'VMIC', mcType: 'Inspection 100%', description: 'Inspection 100%' },
  { no: 37, code: 'VMIQ', mcType: 'Visual check', description: 'Visual check' },
] as const;

export interface WorkcenterOption {
  code: string;
  description: string;
}

/**
 * Unique Workcenters list derived from Workcenter Master list.
 * Deduplicates multiple machine models belonging to the same Workcenter code.
 */
export const UNIQUE_WORKCENTERS: WorkcenterOption[] = [
  { code: 'A20C', description: 'Auto Turn' },
  { code: 'ASYS', description: 'Assembly' },
  { code: 'AUTP', description: 'Plating' },
  { code: 'B12C', description: 'Auto Turn' },
  { code: 'B18C', description: 'Auto Turn' },
  { code: 'B26C', description: 'Auto Turn' },
  { code: 'CAMC', description: 'Auto Turn' },
  { code: 'CGMG', description: 'Centerless Grinding' },
  { code: 'CYGG', description: 'Auto Turn' },
  { code: 'D&TS', description: 'Drill & Tap' },
  { code: 'FINS', description: 'Buffing / Polishing' },
  { code: 'GCMN', description: 'Gear cutting' },
  { code: 'IDHL', description: 'Induction Hardening' },
  { code: 'KURS', description: 'Rolling/Knurling' },
  { code: 'L16C', description: 'Auto Turn' },
  { code: 'L20C', description: 'Auto Turn' },
  { code: 'L32C', description: 'Auto Turn' },
  { code: 'MANP', description: 'Plating' },
  { code: 'MYNC', description: 'STS Chucker' },
  { code: 'PLPP', description: 'Plating' },
  { code: 'SB2C', description: 'Auto Turn' },
  { code: 'SPMS', description: 'Milling' },
  { code: 'SR2C', description: 'Auto Turn' },
  { code: 'SR3C', description: 'Auto Turn' },
  { code: 'STAS', description: 'Stacking' },
  { code: 'Subcon', description: 'Subcon' },
  { code: 'TMBS', description: 'Tumbling' },
  { code: 'VMIC', description: 'Inspection 100%' },
  { code: 'VMIQ', description: 'Visual check' },
  { code: 'WSHP', description: 'Washing' },
];

/**
 * Returns Description for a given Workcenter Code.
 * e.g. A20C -> 'Auto Turn', CGMG -> 'Centerless Grinding', D&TS -> 'Drill & Tap'
 */
export function getWorkcenterDescription(
  code?: string | null,
  customList?: readonly WorkcenterOption[] | WorkcenterOption[]
): string {
  if (!code) return '';
  const trimmed = code.trim().toUpperCase();
  const list = customList && customList.length > 0 ? customList : UNIQUE_WORKCENTERS;
  const match = list.find((w) => w.code.toUpperCase() === trimmed);
  return match ? match.description : '';
}

/** Set of valid 4-character workcenter codes for O(1) membership check */
const VALID_WC_CODES = new Set<string>(
  OFFICIAL_WORKCENTERS.map((w) => w.code).filter((c) => c.length === 4)
);

/**
 * Map known machine names/models to official 4-character Workcenter Codes.
 */
const MACHINE_TO_WC_MAP: Record<string, string> = {
  // Auto Turn (CAM / Cincom / Tsugami / Star)
  'cam': 'CAMC',
  'cincom b12': 'B12C',
  'b12': 'B12C',
  'cincom citizent a20': 'A20C',
  'cincom citizen a20': 'A20C',
  'a20': 'A20C',
  'a20c': 'A20C',
  'cilindrical grinding': 'CYGG',
  'drilling and tapping': 'D&TS',
  'tsugami bo265': 'B26C',
  'tsugami b0265': 'B26C',
  'tsugami b0205': 'B26C',
  'cincom citizent l32': 'L32C',
  'cincom citizen l32': 'L32C',
  'l32': 'L32C',
  'cincom l20-x': 'L20C',
  'cincom l20': 'L20C',
  'tsugami l20': 'L20C',
  'l20': 'L20C',
  'tsugami l16': 'L16C',
  'l16': 'L16C',
  'tsugami b18': 'B18C',
  'b18': 'B18C',
  'star sr20': 'SR2C',
  'star sb20r': 'SB2C',
  'star sr32': 'SR3C',
  // Centerless Grinding
  'paragon rc12': 'CGMG',
  'paragon rc12 (cg)': 'CGMG',
  'paragon rc20': 'CGMG',
  'dx18 cnc cg': 'CGMG',
  'dx18 cg': 'CGMG',
  'topking tk-18': 'CGMG',
  'topking tk-18 (cg)': 'CGMG',
  // Drill & Tap / Milling
  'fanuc': 'D&TS',
  'fanuc robodrill': 'D&TS',
  'spm': 'SPMS',
  'spm milling': 'SPMS',
  'rolling/knurling': 'KURS',
  'induction hardening': 'IDHL',
  'stacking': 'STAS',
  'tumbling': 'TMBS',
  'magnetic polishing': 'TMBS',
  'buffing': 'FINS',
  'chamfering': 'FINS',
  'polishing': 'FINS',
  'assembly': 'ASYS',
  'sts chucker': 'MYNC',
  'gear cutting': 'GCMN',
  // Surface treatment & washing
  'plating': 'AUTP',
  'plating line 01': 'AUTP',
  'line anod-02': 'AUTP',
  'manual plating': 'MANP',
  'washing': 'WSHP',
  // QA / Inspection
  'inspection 100%': 'VMIC',
  'qc 100% station': 'VMIC',
  'visual check': 'VMIQ',
  'qc station 1': 'VMIQ',
};

/**
 * UI-02 R2 Section 5: Workcenter Code Resolver
 *
 * Requirements:
 * - Each step box MUST only display a 4-character Workcenter Code.
 * - Does NOT display Process Name, Machine, Remark.
 * - Does NOT arbitrarily truncate process names into 4 characters.
 * - If legacy data does not have a valid Workcenter Code, returns neutral '----'.
 */
export function getWorkcenterCode(op: Partial<JobOperation> & { planned_workcenter?: string | null; workcenter_code?: string | null }): string {
  // 1. Direct workcenter field if explicitly provided (e.g. future schema or custom field)
  const directWc = (op.workcenter_code || op.planned_workcenter || '').trim().toUpperCase();
  if (directWc && VALID_WC_CODES.has(directWc)) {
    return directWc;
  }
  if (directWc && directWc.length === 4) {
    return directWc;
  }

  // 2. Check planned_machine field
  const machine = (op.planned_machine || '').trim();
  if (machine) {
    const upperMachine = machine.toUpperCase();
    if (VALID_WC_CODES.has(upperMachine)) {
      return upperMachine;
    }
    const lowerMachine = machine.toLowerCase();
    if (MACHINE_TO_WC_MAP[lowerMachine]) {
      return MACHINE_TO_WC_MAP[lowerMachine];
    }
  }

  // 3. If no valid Workcenter Code can be derived, return neutral placeholder
  // Strict rule: Do NOT arbitrarily slice or convert operation_name into a 4-char code
  return '----';
}

/**
 * UI-02 R2 Section 3: Customer Code Resolver
 *
 * Requirements:
 * - ONLY displays a 1-character customer code (e.g. A, B, C).
 * - NEVER displays full customer name in JOB List.
 * - Does NOT arbitrarily take the first letter if mapping is not verified.
 * - Returns neutral '-' if unmapped or not a 1-char code.
 */
export function getCustomerCode(customer?: string | null): string {
  if (!customer) return '-';
  const trimmed = customer.trim();
  if (trimmed.length === 1 && /^[A-Za-z0-9]$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return '-';
}

export type JobDisplayStatus = 'Active' | 'Running' | 'Close';

/**
 * UI-02 R2 Section 4: Status Determination
 *
 * Requirements:
 * - EXACTLY 3 display states:
 *   - Active: JOB scheduled but has NOT started manufacturing yet
 *   - Running: JOB has started manufacturing and is not closed
 *   - Close: JOB is closed
 * - Badges must be concise ('Active', 'Running', 'Close').
 * - Do NOT alter Supabase DB enum ('ACTIVE', 'CLOSE', 'ARCHIVE', 'PURGED').
 */
export function getJobDisplayStatus(job: {
  status: string;
  operations?: Array<{
    status?: string;
    production_runs?: Array<{ ok_qty?: number; ng_qty?: number }>;
  }>;
}): JobDisplayStatus {
  // Closed status in database
  if (job.status === 'CLOSE' || job.status === 'ARCHIVE' || job.status === 'PURGED') {
    return 'Close';
  }

  // Check if manufacturing has started
  const ops = job.operations || [];
  const hasStartedManufacturing = ops.some((op) => {
    const isStarted =
      op.status === 'IN_PROGRESS' ||
      op.status === 'COMPLETED' ||
      op.status === 'WAITING_QA' ||
      op.status === 'QA_KIV' ||
      op.status === 'QA_NG' ||
      op.status === 'HOLD';
    const hasRuns = Boolean(op.production_runs && op.production_runs.length > 0);
    return isStarted || hasRuns;
  });

  if (hasStartedManufacturing) {
    return 'Running';
  }

  // Default: Scheduled, not started manufacturing yet
  return 'Active';
}

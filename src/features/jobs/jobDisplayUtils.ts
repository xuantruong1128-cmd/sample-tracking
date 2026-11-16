import type { Job, JobOperation, ProductionRun } from '../../types/database.types';

/**
 * UI-02 R2: Work Center Master list from Master data.xlsx
 * Contains 37 official work center definitions.
 */
export const OFFICIAL_WORKCENTERS = [
  { no: 1, code: 'CAMC', mcType: 'CAM', description: 'Auto Turn' },
  { no: 2, code: 'B12C', mcType: 'Cincom B12', description: 'Auto Turn' },
  { no: 3, code: 'A20C', mcType: 'Cincom citizent A20', description: 'Auto Turn' },
  { no: 4, code: 'CYGG', mcType: 'Cilindrical Grinding', description: 'Cylindrical Grinding' },
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
  { code: 'CYGG', description: 'Cylindrical Grinding' },
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
  // R4 FIX 01 Safeguard: CYGG is always Cylindrical Grinding, never Auto Turn
  if (trimmed === 'CYGG') {
    return 'Cylindrical Grinding';
  }
  const list = customList && customList.length > 0 ? customList : UNIQUE_WORKCENTERS;
  const match = list.find((w) => w.code.toUpperCase() === trimmed);
  return match ? match.description : '';
}

/**
 * R3 FIX 02: Checks if an operation is an "Auto Turn" operation based on:
 * 1. Operation description or name equaling 'Auto Turn' (case-insensitive)
 * 2. Or operation workcenter_code mapping to 'Auto Turn' in master data
 * Does NOT rely on step_order (OP10).
 */
export function isAutoTurnOperation(
  op?: {
    workcenter_code?: string | null;
    description?: string | null;
    operation_name?: string | null;
  } | null,
  customList?: readonly WorkcenterOption[] | WorkcenterOption[]
): boolean {
  if (!op) return false;
  const wc = (op.workcenter_code || '').trim().toUpperCase();
  // R4 FIX 01 Safeguard: CYGG is Cylindrical Grinding, never Auto Turn
  if (wc === 'CYGG') return false;

  const desc = (op.description || '').trim().toLowerCase();
  const name = (op.operation_name || '').trim().toLowerCase();
  if (desc === 'auto turn' || name === 'auto turn') return true;

  if (op.workcenter_code) {
    const wcDesc = getWorkcenterDescription(op.workcenter_code, customList).trim().toLowerCase();
    if (wcDesc === 'auto turn') return true;
  }
  return false;
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
    closed_at?: string | null;
    production_runs?: Array<{ ok_qty?: number; ng_qty?: number }>;
    qa_checks?: Array<any>;
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
      op.status === 'HOLD' ||
      op.status === 'CLOSED' ||
      Boolean(op.closed_at);
    const hasRuns = Boolean(op.production_runs && op.production_runs.length > 0);
    const hasQa = Boolean(op.qa_checks && op.qa_checks.length > 0);
    return isStarted || hasRuns || hasQa;
  });

  if (hasStartedManufacturing) {
    return 'Running';
  }

  // Default: Scheduled, not started manufacturing yet
  return 'Active';
}

/**
 * R1-05: Formats database ISO timestamp into Vietnam local time (Asia/Ho_Chi_Minh).
 * e.g. "14:30 16/10/2026" or "16/10/2026"
 */
export function formatVietnamCreationDate(createdAt?: string | null): string {
  if (!createdAt) return '—';
  try {
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) return '—';
    const formatter = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(d);
  } catch {
    return '—';
  }
}

/**
 * R4 FIX 03: Formats date strictly as DD/MM/YY in Vietnam timeZone without hours/minutes.
 * Works for ISO timestamps or DATE-only strings ('YYYY-MM-DD').
 * Returns empty string '' if input is missing or invalid.
 */
export function formatDDMMYY(dateStr?: string | null): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  if (!trimmed) return '';

  // Fast path for YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-');
    return `${d}/${m}/${y.slice(-2)}`;
  }

  try {
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }).formatToParts(d);
    const day = parts.find((p) => p.type === 'day')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const year = parts.find((p) => p.type === 'year')?.value;
    if (day && month && year) {
      return `${day}/${month}/${year}`;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * R4 FIX 03: Returns formatted Created Date strictly as DD/MM/YY.
 */
export function getCreatedDateDisplay(job: { created_at?: string | null }): string {
  return formatDDMMYY(job.created_at);
}

/**
 * R4 FIX 03: Returns Plan Close date (from Planned Finish Date) strictly as DD/MM/YY.
 */
export function getPlanCloseDateDisplay(job: { planned_finish_date?: string | null }): string {
  return formatDDMMYY(job.planned_finish_date);
}

/**
 * R4 FIX 03: Returns Actual Close date strictly as DD/MM/YY.
 * Rules:
 * - If job status != 'CLOSE', returns empty string '' (never guesses from updated_at or operation close).
 * - If job status == 'CLOSE' but closed_at is missing, returns empty string ''.
 * - If job status == 'CLOSE' and closed_at is present, returns DD/MM/YY.
 */
export function getActualCloseDateDisplay(job: {
  status?: string | null;
  closed_at?: string | null;
}): string {
  if (job.status !== 'CLOSE' || !job.closed_at) {
    return '';
  }
  return formatDDMMYY(job.closed_at);
}

/**
 * R4.1 FIX 03: Normalizes a date or timestamp string into YYYY-MM-DD in Vietnam timezone (Asia/Ho_Chi_Minh).
 * Avoids any 1-day off errors due to UTC conversion.
 */
export function getVietnamCalendarDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // If strictly YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
    return null;
  } catch {
    return null;
  }
}

export interface ActualCloseColorInfo {
  status: 'on_time' | 'late' | 'none';
  text: string;
  badgeClassName: string;
}

/**
 * R4.1 FIX 03: Returns visual status, text, and badge class for Homepage Actual Close column.
 *
 * Rules:
 * - JOB closed and Actual Close <= Plan Close: Green background, dark green text.
 * - JOB closed and Actual Close > Plan Close: Dark red background, high contrast white text.
 * - JOB not closed: displays '—', no background color.
 * - Missing either date: displays available date or '—', no color (never guesses).
 * - Comparisons done strictly on calendar dates (YYYY-MM-DD) in Vietnam timezone.
 */
export function getActualCloseColorInfo(job: {
  status?: string | null;
  closed_at?: string | null;
  planned_finish_date?: string | null;
}): ActualCloseColorInfo {
  // If JOB is not closed or closed_at is missing: display '—' without background color
  if (job.status !== 'CLOSE' || !job.closed_at) {
    return {
      status: 'none',
      text: '—',
      badgeClassName: 'text-slate-400 font-mono text-xs',
    };
  }

  const actualDateDisplay = getActualCloseDateDisplay(job);
  if (!actualDateDisplay) {
    return {
      status: 'none',
      text: '—',
      badgeClassName: 'text-slate-400 font-mono text-xs',
    };
  }

  // If planned_finish_date is missing: cannot evaluate timeliness -> no color
  if (!job.planned_finish_date) {
    return {
      status: 'none',
      text: actualDateDisplay,
      badgeClassName: 'text-slate-700 font-mono text-xs font-semibold',
    };
  }

  const actualCal = getVietnamCalendarDate(job.closed_at);
  const planCal = getVietnamCalendarDate(job.planned_finish_date);

  if (!actualCal || !planCal) {
    return {
      status: 'none',
      text: actualDateDisplay,
      badgeClassName: 'text-slate-700 font-mono text-xs font-semibold',
    };
  }

  if (actualCal <= planCal) {
    // ON TIME / EARLY: Green background, dark green text, easy to read
    return {
      status: 'on_time',
      text: actualDateDisplay,
      badgeClassName:
        'inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300',
    };
  } else {
    // LATE: Dark red background, high-contrast clear text, easy to read
    return {
      status: 'late',
      text: actualDateDisplay,
      badgeClassName:
        'inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-mono font-bold bg-red-700 text-white shadow-2xs',
    };
  }
}

/**
 * R4 FIX 04: Homepage Column Definitions & Visibility Configuration
 */
export interface ColumnConfig {
  id: string;
  label: string;
  defaultVisible: boolean;
  alwaysVisible?: boolean;
}

export const HOMEPAGE_COLUMNS: ColumnConfig[] = [
  { id: 'item_no', label: 'Item No.', defaultVisible: true, alwaysVisible: true },
  { id: 'job_ticket', label: 'Job Ticket', defaultVisible: true },
  { id: 'customer', label: 'Customer', defaultVisible: true },
  { id: 'created_date', label: 'Created Date', defaultVisible: true },
  { id: 'plan_close', label: 'Plan Close', defaultVisible: true },
  { id: 'actual_close', label: 'Actual Close', defaultVisible: true },
  { id: 'status', label: 'Status', defaultVisible: true },
  { id: 'qty', label: "Q'ty", defaultVisible: true },
  { id: 'ct_plan', label: 'CT Plan', defaultVisible: true },
  { id: 'ct_actual', label: 'CT Actual', defaultVisible: true },
  { id: 'routing', label: 'Routing', defaultVisible: true },
];

export const DEFAULT_VISIBLE_COLUMN_IDS = HOMEPAGE_COLUMNS.map((c) => c.id);

/**
 * R4.2: Formats an integer quantity (order_qty, ok_qty, ng_qty, kiv_qty) without thousands separators.
 * e.g. 1050 -> "1050", 12500 -> "12500", 100000 -> "100000", 500 -> "500", 0 -> "0".
 * Strictly avoids dots or commas as thousands separators (never produces "1.050" or "1,050").
 */
export function formatIntegerQuantity(qty?: number | string | null): string {
  if (qty === null || qty === undefined || qty === '') return '0';
  const num = typeof qty === 'number' ? qty : Number(qty);
  if (isNaN(num)) return '0';
  return String(Math.round(num));
}

export interface AutoTurnCTInfo {
  autoTurnCount: number;
  actualRecordedCount: number;
  totalPlan: number | null;
  totalActual: number | null;
  planDisplay: string;
  actualDisplay: string;
  status: 'none' | 'no_auto_turn' | 'no_actual' | 'partial' | 'on_time' | 'exceeded';
  statusLabel: string;
  isComplete: boolean;
  badgeClassName: string;
  planTooltip: string;
  actualTooltip: string;
}

/**
 * Formats a CT number without rounding before summation or comparison.
 * Avoids JavaScript floating point inaccuracies (e.g. 60.70000000000001 -> "60.7").
 */
export function formatCTValue(val?: number | null): string {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const rounded = Math.round(val * 100) / 100;
  return String(rounded);
}

/**
 * R4.3: Computes aggregated Auto Turn CT Plan & CT Actual for a Job.
 *
 * Rules:
 * 1. Identifies Auto Turn operations via isAutoTurnOperation(op, customList).
 * 2. Excludes Grinding (CYGG, CGMG) and non-Auto Turn operations completely.
 * 3. CT Plan = Sum of planned_cycle_time_seconds of all Auto Turn operations.
 * 4. CT Actual = Sum of latest valid cycle_time_seconds for each Auto Turn operation (does NOT sum multiple runs of same op).
 * 5. Does NOT require operations to be CLOSED.
 * 6. Partial data handling:
 *    - 0 actuals recorded: display '—'
 *    - 0 < actuals < autoTurnCount: display partial sum, neutral styling, statusLabel 'Chưa đủ CT'
 *    - all actuals recorded:
 *        - actual <= plan: green background, statusLabel 'Đạt'
 *        - actual > plan: dark red background, statusLabel 'Vượt CT'
 * 7. Does NOT round CT before summing or comparing.
 */
export function getJobAutoTurnCTInfo(
  job?: Partial<Job> | null,
  customList?: readonly WorkcenterOption[] | WorkcenterOption[]
): AutoTurnCTInfo {
  if (!job || !job.operations || job.operations.length === 0) {
    return {
      autoTurnCount: 0,
      actualRecordedCount: 0,
      totalPlan: null,
      totalActual: null,
      planDisplay: '—',
      actualDisplay: '—',
      status: 'no_auto_turn',
      statusLabel: '—',
      isComplete: false,
      badgeClassName: 'text-slate-400 font-mono text-xs',
      planTooltip: 'Không có công đoạn Auto Turn',
      actualTooltip: 'Không có công đoạn Auto Turn',
    };
  }

  // Filter Auto Turn operations strictly
  const autoTurnOps = (job.operations || []).filter((op: JobOperation) =>
    isAutoTurnOperation(op, customList)
  );

  const autoTurnCount = autoTurnOps.length;

  if (autoTurnCount === 0) {
    return {
      autoTurnCount: 0,
      actualRecordedCount: 0,
      totalPlan: null,
      totalActual: null,
      planDisplay: '—',
      actualDisplay: '—',
      status: 'no_auto_turn',
      statusLabel: '—',
      isComplete: false,
      badgeClassName: 'text-slate-400 font-mono text-xs',
      planTooltip: 'Không có công đoạn Auto Turn',
      actualTooltip: 'Không có công đoạn Auto Turn',
    };
  }

  // Calculate total plan without premature rounding
  let rawPlanSum = 0;
  let hasValidPlan = false;
  for (const op of autoTurnOps) {
    const rawVal = op.planned_cycle_time_seconds;
    if (rawVal !== null && rawVal !== undefined && !isNaN(Number(rawVal)) && Number(rawVal) > 0) {
      rawPlanSum += Number(rawVal);
      hasValidPlan = true;
    }
  }
  const totalPlan = hasValidPlan ? rawPlanSum : null;
  const planDisplay = totalPlan !== null ? formatCTValue(totalPlan) : '—';
  const planTooltip =
    totalPlan !== null
      ? `Tổng CT Kế hoạch: ${formatCTValue(totalPlan)}s (${autoTurnCount} công đoạn Auto Turn)`
      : `Chưa có CT Kế hoạch (${autoTurnCount} công đoạn Auto Turn)`;

  // For each Auto Turn operation, find the latest valid production run's cycle_time_seconds
  let rawActualSum = 0;
  let actualRecordedCount = 0;

  for (const op of autoTurnOps) {
    const validRuns = (op.production_runs || []).filter((r: ProductionRun) => {
      const ct = r.cycle_time_seconds;
      return ct !== null && ct !== undefined && !isNaN(Number(ct)) && Number(ct) > 0;
    });

    if (validRuns.length > 0) {
      // Sort latest first
      validRuns.sort((a: ProductionRun, b: ProductionRun) => {
        const timeA = new Date(a.updated_at || a.created_at || a.start_time || 0).getTime();
        const timeB = new Date(b.updated_at || b.created_at || b.start_time || 0).getTime();
        return timeB - timeA;
      });
      const latestCt = Number(validRuns[0].cycle_time_seconds);
      rawActualSum += latestCt;
      actualRecordedCount += 1;
    }
  }

  // Case A: No CT Actual recorded at all
  if (actualRecordedCount === 0) {
    return {
      autoTurnCount,
      actualRecordedCount: 0,
      totalPlan,
      totalActual: null,
      planDisplay,
      actualDisplay: '—',
      status: 'no_actual',
      statusLabel: '—',
      isComplete: false,
      badgeClassName: 'text-slate-400 font-mono text-xs',
      planTooltip,
      actualTooltip: `Chưa có CT Thực tế (${autoTurnCount} công đoạn Auto Turn)`,
    };
  }

  const totalActual = rawActualSum;
  const actualDisplay = formatCTValue(totalActual);

  // Case B: Partial CT Actual (0 < actualRecordedCount < autoTurnCount)
  if (actualRecordedCount < autoTurnCount) {
    return {
      autoTurnCount,
      actualRecordedCount,
      totalPlan,
      totalActual,
      planDisplay,
      actualDisplay,
      status: 'partial',
      statusLabel: 'Chưa đủ CT',
      isComplete: false,
      badgeClassName:
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono font-medium bg-slate-100 text-slate-700 border border-slate-300',
      planTooltip,
      actualTooltip: `Tổng CT Thực tế hiện có: ${formatCTValue(totalActual)}s (Chưa đủ CT: ${actualRecordedCount}/${autoTurnCount} công đoạn Auto Turn)`,
    };
  }

  // Case C: Complete CT Actual (actualRecordedCount === autoTurnCount)
  // Compare raw numbers without rounding
  if (totalPlan !== null && totalActual <= totalPlan) {
    return {
      autoTurnCount,
      actualRecordedCount,
      totalPlan,
      totalActual,
      planDisplay,
      actualDisplay,
      status: 'on_time',
      statusLabel: 'Đạt',
      isComplete: true,
      badgeClassName:
        'inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300',
      planTooltip,
      actualTooltip: `Tổng CT Đạt: ${formatCTValue(totalActual)}s <= ${formatCTValue(totalPlan)}s (${autoTurnCount}/${autoTurnCount} công đoạn Auto Turn)`,
    };
  } else {
    return {
      autoTurnCount,
      actualRecordedCount,
      totalPlan,
      totalActual,
      planDisplay,
      actualDisplay,
      status: 'exceeded',
      statusLabel: 'Vượt CT',
      isComplete: true,
      badgeClassName:
        'inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-mono font-bold bg-red-700 text-white shadow-2xs',
      planTooltip,
      actualTooltip: `Tổng CT Vượt kế hoạch: ${formatCTValue(totalActual)}s > ${formatCTValue(totalPlan ?? 0)}s (${autoTurnCount}/${autoTurnCount} công đoạn Auto Turn)`,
    };
  }
}




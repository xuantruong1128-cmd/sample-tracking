/**
 * ============================================================================
 * SPECIFICATION R1.1 — CYCLE TIME CALCULATOR ENGINE
 * Pure mathematical calculation engine, bidirectional solver & variable locking
 * ============================================================================
 */

export type MachiningType =
  | 'turning'
  | 'facing'
  | 'thread_turn'
  | 'part_off'
  | 'grooving'
  | 'drilling'
  | 'centering'
  | 'boring'
  | 'tapping'
  | 'milling'
  | 'chamfering'
  | 'rolling'
  | 'reaming';

/**
 * Returns true if the machining type belongs to the lathe turning family
 * where the number of cutting edges is strictly fixed to 1:
 * Turning, Facing, Thread turn, Part off, Grooving.
 */
export function isSingleEdgeTurningType(type?: string | null): boolean {
  if (!type) return false;
  const t = type.toLowerCase().trim();
  return (
    t === 'turning' ||
    t === 'facing' ||
    t === 'thread_turn' ||
    t === 'thread turn' ||
    t === 'thread-turn' ||
    t === 'part_off' ||
    t === 'part off' ||
    t === 'part-off' ||
    t === 'grooving'
  );
}

/**
 * Normalizes raw machining type strings, including common aliases (e.g. borring, taping)
 */
export function normalizeMachiningType(
  raw: any,
  defaultType: MachiningType = 'turning'
): MachiningType {
  if (!raw || typeof raw !== 'string') return defaultType;
  const s = raw.toLowerCase().trim();
  if (s === 'turning') return 'turning';
  if (s === 'facing') return 'facing';
  if (s === 'thread_turn' || s === 'thread turn' || s === 'thread-turn') return 'thread_turn';
  if (s === 'part_off' || s === 'part off' || s === 'part-off') return 'part_off';
  if (s === 'grooving') return 'grooving';
  if (s === 'drilling') return 'drilling';
  if (s === 'centering') return 'centering';
  if (s === 'boring' || s === 'borring') return 'boring';
  if (s === 'tapping' || s === 'taping') return 'tapping';
  if (s === 'milling') return 'milling';
  if (s === 'chamfering') return 'chamfering';
  if (s === 'rolling') return 'rolling';
  if (s === 'reaming') return 'reaming';
  return defaultType;
}

export type VariableSource = 'input' | 'calculated';

export interface VariableState<T = number | null> {
  value: T;
  source: VariableSource;
  locked: boolean;
  lastEditedAt?: number;
}

export interface DVcNSolverState {
  diameter: VariableState<number | null>; // D (mm)
  cuttingSpeed: VariableState<number | null>; // Vc (m/min)
  spindleSpeed: VariableState<number | null>; // N (rpm)
  lastCalculatedTarget: 'diameter' | 'cuttingSpeed' | 'spindleSpeed' | null;
  conflict: string | null;
}

export interface FeedSolverState {
  feedRate: VariableState<number | null>; // F (mm/min)
  feedPerTooth: VariableState<number | null>; // Fz (mm/tooth)
  feedPerRev: VariableState<number | null>; // Fn (mm/rev)
  teethCount: VariableState<number | null>; // Z
  threadPitch: VariableState<number | null>; // P (mm/rev) for tapping
  lastCalculatedTarget: 'feedRate' | 'feedPerTooth' | 'feedPerRev' | null;
  conflict: string | null;
}

export interface CuttingTimeState {
  length: VariableState<number | null>; // Length (mm)
  passes: VariableState<number | null>; // Decimal passes (e.g. 1, 1.3, 1.5, 1.75, 2.25)
  nonCuttingTime: VariableState<number | null>; // Non-cutting / handling time (sec)
  cuttingTimeSeconds: number | null;
  totalCycleTimeSeconds: number | null;
}

export interface CycleTimeCalculationState {
  schemaVersion: '1.1';
  machiningType: MachiningType;
  d_vc_n: DVcNSolverState;
  feed: FeedSolverState;
  time: CuttingTimeState;
  globalConflict: string | null;
}

/**
 * Creates a fresh initial calculation state for a given machining type
 */
export function createInitialCalculationState(
  machiningType: MachiningType = 'turning',
  initialCtSeconds?: number | null
): CycleTimeCalculationState {
  const defaultZ = isSingleEdgeTurningType(machiningType) ? 1 : 2;

  return {
    schemaVersion: '1.1',
    machiningType,
    d_vc_n: {
      diameter: { value: null, source: 'input', locked: false },
      cuttingSpeed: { value: null, source: 'input', locked: false },
      spindleSpeed: { value: null, source: 'input', locked: false },
      lastCalculatedTarget: null,
      conflict: null,
    },
    feed: {
      feedRate: { value: null, source: 'input', locked: false },
      feedPerTooth: { value: null, source: 'input', locked: false },
      feedPerRev: { value: null, source: 'input', locked: false },
      teethCount: { value: defaultZ, source: 'input', locked: false },
      threadPitch: { value: null, source: 'input', locked: false },
      lastCalculatedTarget: null,
      conflict: null,
    },
    time: {
      length: { value: null, source: 'input', locked: false },
      passes: { value: 1, source: 'input', locked: false },
      nonCuttingTime: { value: 0, source: 'input', locked: false },
      cuttingTimeSeconds: null,
      totalCycleTimeSeconds: initialCtSeconds ?? null,
    },
    globalConflict: null,
  };
}

/**
 * Safe numeric helper: returns null if not a finite positive number
 */
export function safePositiveNumber(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

/**
 * Rounding helper for display without mutating raw internal precision
 */
export function formatDisplayNumber(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '';
  // Trim unnecessary trailing zeros if whole
  const fixed = val.toFixed(decimals);
  return parseFloat(fixed).toString();
}

// ============================================================================
// 1. THREE-VARIABLE SOLVER: D - Vc - N
// Formula: Vc = (π * D * N) / 1000
// D = (1000 * Vc) / (π * N)
// N = (1000 * Vc) / (π * D)
// ============================================================================

export function solveDVcN(
  state: DVcNSolverState,
  editedField: 'diameter' | 'cuttingSpeed' | 'spindleSpeed',
  newValue: number | null
): DVcNSolverState {
  const next: DVcNSolverState = {
    ...state,
    diameter: { ...state.diameter },
    cuttingSpeed: { ...state.cuttingSpeed },
    spindleSpeed: { ...state.spindleSpeed },
    conflict: null,
  };

  // If user cleared the field
  if (newValue === null || newValue <= 0) {
    next[editedField].value = null;
    next[editedField].source = 'input';
    next[editedField].lastEditedAt = Date.now();
    return next;
  }

  // Set the edited field as direct input
  next[editedField].value = newValue;
  next[editedField].source = 'input';
  next[editedField].lastEditedAt = Date.now();

  const D = next.diameter;
  const Vc = next.cuttingSpeed;
  const N = next.spindleSpeed;

  const otherFields = (['diameter', 'cuttingSpeed', 'spindleSpeed'] as const).filter(
    (f) => f !== editedField
  );

  const lockedOthers = otherFields.filter((f) => next[f].locked);

  // Case 1: Both other fields are locked!
  if (lockedOthers.length === 2) {
    const f1 = lockedOthers[0];
    const f2 = lockedOthers[1];
    // Check if the 3 values satisfy the equation within a 1% margin
    if (D.value && Vc.value && N.value) {
      const expectedVc = (Math.PI * D.value * N.value) / 1000;
      const diff = Math.abs(Vc.value - expectedVc);
      if (diff > 0.05) {
        next.conflict = `Xung đột khóa biến: Biến ${f1} và ${f2} đều đang bị khóa nên không thể tự động tính toán lại. Vui lòng mở khóa một biến.`;
      }
    } else {
      next.conflict = `Không đủ dữ liệu khả dụng vì các biến còn lại đang bị khóa.`;
    }
    return next;
  }

  // Case 2: Exactly one other field is locked
  if (lockedOthers.length === 1) {
    const lockedTarget = lockedOthers[0];
    const eligibleTarget = otherFields.find((f) => f !== lockedTarget)!;

    // Recalculate eligibleTarget using editedField and lockedTarget
    const val1 = next[editedField].value;
    const val2 = next[lockedTarget].value;

    if (val1 && val2) {
      const calcVal = calculateThirdDVcN(editedField, lockedTarget, val1, val2);
      if (calcVal !== null && Number.isFinite(calcVal) && calcVal > 0) {
        next[eligibleTarget].value = calcVal;
        next[eligibleTarget].source = 'calculated';
        next.lastCalculatedTarget = eligibleTarget;
      }
    }
    return next;
  }

  // Case 3: Neither of the other two fields is locked
  // Determine which field to preserve and which to recalculate
  // Rules from Spec R1.1:
  // - Preserve the other previously entered independent variable when possible
  // - Example A:
  //   1. Vc = 100 entered
  //   2. D = 10 entered -> N is calculated
  //   3. N changed to 2500 -> Vc = 100 is retained, D is recalculated (D ≈ 12.73)
  //   4. If Vc is edited -> D is retained, N is recalculated.
  let targetToRecalculate: 'diameter' | 'cuttingSpeed' | 'spindleSpeed';

  if (editedField === 'spindleSpeed') {
    // If Vc exists, retain Vc as primary cutting condition, recalculate D
    if (Vc.value) {
      targetToRecalculate = 'diameter';
    } else if (D.value) {
      targetToRecalculate = 'cuttingSpeed';
    } else {
      return next;
    }
  } else if (editedField === 'cuttingSpeed') {
    // If D exists, retain D, recalculate N
    if (D.value) {
      targetToRecalculate = 'spindleSpeed';
    } else if (N.value) {
      targetToRecalculate = 'diameter';
    } else {
      return next;
    }
  } else {
    // editedField === 'diameter'
    // If Vc exists, retain Vc, recalculate N
    if (Vc.value) {
      targetToRecalculate = 'spindleSpeed';
    } else if (N.value) {
      targetToRecalculate = 'cuttingSpeed';
    } else {
      return next;
    }
  }

  const partnerField = otherFields.find((f) => f !== targetToRecalculate)!;
  const partnerVal = next[partnerField].value;
  const editedVal = next[editedField].value;

  if (partnerVal && editedVal) {
    const calcVal = calculateThirdDVcN(editedField, partnerField, editedVal, partnerVal);
    if (calcVal !== null && Number.isFinite(calcVal) && calcVal > 0) {
      next[targetToRecalculate].value = calcVal;
      next[targetToRecalculate].source = 'calculated';
      next.lastCalculatedTarget = targetToRecalculate;
    }
  }

  return next;
}

/**
 * Pure math solver for third variable given two known variables
 */
function calculateThirdDVcN(
  f1: 'diameter' | 'cuttingSpeed' | 'spindleSpeed',
  f2: 'diameter' | 'cuttingSpeed' | 'spindleSpeed',
  val1: number,
  val2: number
): number | null {
  const map: Record<string, number> = { [f1]: val1, [f2]: val2 };

  // Need Vc: Vc = (π * D * N) / 1000
  if (!('cuttingSpeed' in map)) {
    const D = map.diameter;
    const N = map.spindleSpeed;
    if (!D || !N) return null;
    return (Math.PI * D * N) / 1000;
  }

  // Need D: D = (1000 * Vc) / (π * N)
  if (!('diameter' in map)) {
    const Vc = map.cuttingSpeed;
    const N = map.spindleSpeed;
    if (!Vc || !N || N === 0) return null;
    return (1000 * Vc) / (Math.PI * N);
  }

  // Need N: N = (1000 * Vc) / (π * D)
  if (!('spindleSpeed' in map)) {
    const Vc = map.cuttingSpeed;
    const D = map.diameter;
    if (!Vc || !D || D === 0) return null;
    return (1000 * Vc) / (Math.PI * D);
  }

  return null;
}

// ============================================================================
// 2. FEED SOLVER: F = N * Z * Fz (and Fn = Z * Fz)
// ============================================================================

export function solveFeed(
  state: FeedSolverState,
  machiningType: MachiningType,
  spindleSpeed: number | null,
  editedField: 'feedRate' | 'feedPerTooth' | 'feedPerRev' | 'teethCount' | 'threadPitch',
  newValue: number | null
): FeedSolverState {
  const next: FeedSolverState = {
    ...state,
    feedRate: { ...state.feedRate },
    feedPerTooth: { ...state.feedPerTooth },
    feedPerRev: { ...state.feedPerRev },
    teethCount: { ...state.teethCount },
    threadPitch: { ...state.threadPitch },
    conflict: null,
  };

  if (newValue === null || newValue <= 0) {
    next[editedField].value = null;
    next[editedField].source = 'input';
    return next;
  }

  next[editedField].value = newValue;
  next[editedField].source = 'input';

  const N = spindleSpeed;
  const Z = next.teethCount.value ?? (isSingleEdgeTurningType(machiningType) ? 1 : 2);

  // Tapping special case: F = N * Pitch
  if (machiningType === 'tapping') {
    const pitch = next.threadPitch.value;
    if (N && pitch) {
      next.feedRate.value = N * pitch;
      next.feedRate.source = 'calculated';
      next.feedPerRev.value = pitch;
      next.feedPerRev.source = 'calculated';
    }
    return next;
  }

  // If user edited Feed Rate directly
  if (editedField === 'feedRate') {
    if (N && N > 0) {
      const fn = newValue / N;
      next.feedPerRev.value = fn;
      next.feedPerRev.source = 'calculated';
      if (Z > 0) {
        next.feedPerTooth.value = fn / Z;
        next.feedPerTooth.source = 'calculated';
      }
      next.lastCalculatedTarget = 'feedPerTooth';
    }
  } else if (editedField === 'feedPerTooth') {
    const fz = newValue;
    const fn = fz * Z;
    next.feedPerRev.value = fn;
    next.feedPerRev.source = 'calculated';
    if (N && N > 0) {
      next.feedRate.value = N * fn;
      next.feedRate.source = 'calculated';
      next.lastCalculatedTarget = 'feedRate';
    }
  } else if (editedField === 'feedPerRev') {
    const fn = newValue;
    if (Z > 0) {
      next.feedPerTooth.value = fn / Z;
      next.feedPerTooth.source = 'calculated';
    }
    if (N && N > 0) {
      next.feedRate.value = N * fn;
      next.feedRate.source = 'calculated';
      next.lastCalculatedTarget = 'feedRate';
    }
  } else if (editedField === 'teethCount') {
    // When Z changes: if Fz is set, recalculate Fn and F; if Fn is set and Fz locked, etc.
    const fz = next.feedPerTooth.value;
    if (fz && Z > 0) {
      const fn = fz * Z;
      next.feedPerRev.value = fn;
      next.feedPerRev.source = 'calculated';
      if (N && N > 0) {
        next.feedRate.value = N * fn;
        next.feedRate.source = 'calculated';
      }
    }
  }

  return next;
}

/**
 * Re-evaluates Feed when upstream Spindle Speed N changes
 */
export function recalculateFeedFromSpindleSpeed(
  feedState: FeedSolverState,
  machiningType: MachiningType,
  newN: number | null
): FeedSolverState {
  const next: FeedSolverState = {
    ...feedState,
    feedRate: { ...feedState.feedRate },
    feedPerTooth: { ...feedState.feedPerTooth },
    feedPerRev: { ...feedState.feedPerRev },
    teethCount: { ...feedState.teethCount },
    threadPitch: { ...feedState.threadPitch },
    conflict: null,
  };

  if (!newN || newN <= 0) return next;

  const Z = next.teethCount.value ?? (isSingleEdgeTurningType(machiningType) ? 1 : 2);

  if (machiningType === 'tapping') {
    const pitch = next.threadPitch.value;
    if (pitch && pitch > 0) {
      next.feedRate.value = newN * pitch;
      next.feedRate.source = 'calculated';
    }
    return next;
  }

  // If feedRate is locked, recalculate feedPerTooth
  if (next.feedRate.locked && next.feedRate.value) {
    const fn = next.feedRate.value / newN;
    next.feedPerRev.value = fn;
    next.feedPerRev.source = 'calculated';
    if (Z > 0) {
      next.feedPerTooth.value = fn / Z;
      next.feedPerTooth.source = 'calculated';
    }
    return next;
  }

  // Otherwise preserve feedPerTooth / feedPerRev and recalculate feedRate
  const fn = next.feedPerRev.value ?? (next.feedPerTooth.value ? next.feedPerTooth.value * Z : null);
  if (fn && fn > 0) {
    next.feedRate.value = newN * fn;
    next.feedRate.source = 'calculated';
  }

  return next;
}

// ============================================================================
// 3. CUTTING TIME & TOTAL CT SOLVER
// Formula: Cutting Time = (Length * Passes * 60) / F
// Total CT = Cutting Time + NonCuttingTime
// ============================================================================

export function solveTimes(
  timeState: CuttingTimeState,
  feedRate: number | null
): CuttingTimeState {
  const next: CuttingTimeState = {
    ...timeState,
    length: { ...timeState.length },
    passes: { ...timeState.passes },
    nonCuttingTime: { ...timeState.nonCuttingTime },
  };

  const length = next.length.value;
  const passes = next.passes.value;
  const nonCut = next.nonCuttingTime.value ?? 0;

  if (length && length > 0 && passes && passes > 0 && feedRate && feedRate > 0) {
    // High precision calculation
    const ctSec = (length * passes * 60) / feedRate;
    if (Number.isFinite(ctSec) && ctSec > 0) {
      next.cuttingTimeSeconds = ctSec;
      next.totalCycleTimeSeconds = ctSec + nonCut;
    } else {
      next.cuttingTimeSeconds = null;
      next.totalCycleTimeSeconds = null;
    }
  } else {
    next.cuttingTimeSeconds = null;
    next.totalCycleTimeSeconds = null;
  }

  return next;
}

// ============================================================================
// 4. MASTER RECALCULATION PIPELINE (Zero Circular Loops)
// ============================================================================

export function recalculateAll(state: CycleTimeCalculationState): CycleTimeCalculationState {
  const N = state.d_vc_n.spindleSpeed.value;
  const updatedFeed = recalculateFeedFromSpindleSpeed(state.feed, state.machiningType, N);
  const updatedTime = solveTimes(state.time, updatedFeed.feedRate.value);

  const globalConflict = state.d_vc_n.conflict || updatedFeed.conflict || null;

  return {
    ...state,
    feed: updatedFeed,
    time: updatedTime,
    globalConflict,
  };
}

/**
 * Handle user lock toggle on any field
 */
export function toggleFieldLock(
  state: CycleTimeCalculationState,
  group: 'd_vc_n' | 'feed',
  field: string
): CycleTimeCalculationState {
  const next = { ...state };
  if (group === 'd_vc_n') {
    const dGroup = { ...next.d_vc_n };
    const curVar = (dGroup as any)[field] as VariableState;
    if (curVar) {
      (dGroup as any)[field] = {
        ...curVar,
        locked: !curVar.locked,
      };
      next.d_vc_n = dGroup;
    }
  } else if (group === 'feed') {
    const fGroup = { ...next.feed };
    const curVar = (fGroup as any)[field] as VariableState;
    if (curVar) {
      (fGroup as any)[field] = {
        ...curVar,
        locked: !curVar.locked,
      };
      next.feed = fGroup;
    }
  }
  return recalculateAll(next);
}

// ============================================================================
// 5. SERIALIZATION & DRAFT PERSISTENCE
// ============================================================================

export interface SerializedCycleTimeState {
  schema_version: '1.1';
  machining_type: MachiningType;
  diameter: number | null;
  cutting_speed: number | null;
  spindle_speed: number | null;
  feed_rate: number | null;
  feed_per_tooth: number | null;
  feed_per_rev: number | null;
  teeth_count: number | null;
  thread_pitch: number | null;
  length: number | null;
  passes: number;
  non_cutting_time: number | null;
  cutting_time_seconds: number | null;
  total_cycle_time_seconds: number | null;
  field_sources: Record<string, VariableSource>;
  lock_states: Record<string, boolean>;
  last_calculated_targets: {
    d_vc_n?: string | null;
    feed?: string | null;
  };
}

export function serializeCalculationState(
  state: CycleTimeCalculationState
): SerializedCycleTimeState {
  return {
    schema_version: '1.1',
    machining_type: state.machiningType,
    diameter: state.d_vc_n.diameter.value,
    cutting_speed: state.d_vc_n.cuttingSpeed.value,
    spindle_speed: state.d_vc_n.spindleSpeed.value,
    feed_rate: state.feed.feedRate.value,
    feed_per_tooth: state.feed.feedPerTooth.value,
    feed_per_rev: state.feed.feedPerRev.value,
    teeth_count: state.feed.teethCount.value,
    thread_pitch: state.feed.threadPitch.value,
    length: state.time.length.value,
    passes: state.time.passes.value ?? 1,
    non_cutting_time: state.time.nonCuttingTime.value,
    cutting_time_seconds: state.time.cuttingTimeSeconds,
    total_cycle_time_seconds: state.time.totalCycleTimeSeconds,
    field_sources: {
      diameter: state.d_vc_n.diameter.source,
      cuttingSpeed: state.d_vc_n.cuttingSpeed.source,
      spindleSpeed: state.d_vc_n.spindleSpeed.source,
      feedRate: state.feed.feedRate.source,
      feedPerTooth: state.feed.feedPerTooth.source,
      feedPerRev: state.feed.feedPerRev.source,
    },
    lock_states: {
      diameter: state.d_vc_n.diameter.locked,
      cuttingSpeed: state.d_vc_n.cuttingSpeed.locked,
      spindleSpeed: state.d_vc_n.spindleSpeed.locked,
      feedRate: state.feed.feedRate.locked,
      feedPerTooth: state.feed.feedPerTooth.locked,
    },
    last_calculated_targets: {
      d_vc_n: state.d_vc_n.lastCalculatedTarget,
      feed: state.feed.lastCalculatedTarget,
    },
  };
}

export function deserializeCalculationState(
  data: Partial<SerializedCycleTimeState> | null | undefined
): CycleTimeCalculationState {
  if (!data) return createInitialCalculationState();

  const machiningType = data.machining_type || 'turning';
  const base = createInitialCalculationState(machiningType, data.total_cycle_time_seconds);

  const sources = data.field_sources || {};
  const locks = data.lock_states || {};

  base.d_vc_n.diameter = {
    value: data.diameter ?? null,
    source: sources.diameter || 'input',
    locked: Boolean(locks.diameter),
  };
  base.d_vc_n.cuttingSpeed = {
    value: data.cutting_speed ?? null,
    source: sources.cuttingSpeed || 'input',
    locked: Boolean(locks.cuttingSpeed),
  };
  base.d_vc_n.spindleSpeed = {
    value: data.spindle_speed ?? null,
    source: sources.spindleSpeed || 'input',
    locked: Boolean(locks.spindleSpeed),
  };
  base.d_vc_n.lastCalculatedTarget =
    (data.last_calculated_targets?.d_vc_n as any) || null;

  base.feed.feedRate = {
    value: data.feed_rate ?? null,
    source: sources.feedRate || 'input',
    locked: Boolean(locks.feedRate),
  };
  base.feed.feedPerTooth = {
    value: data.feed_per_tooth ?? null,
    source: sources.feedPerTooth || 'input',
    locked: Boolean(locks.feedPerTooth),
  };
  base.feed.feedPerRev = {
    value: data.feed_per_rev ?? null,
    source: sources.feedPerRev || 'input',
    locked: false,
  };
  base.feed.teethCount = {
    value: data.teeth_count ?? (machiningType === 'turning' ? 1 : 2),
    source: 'input',
    locked: false,
  };
  base.feed.threadPitch = {
    value: data.thread_pitch ?? null,
    source: 'input',
    locked: false,
  };
  base.feed.lastCalculatedTarget =
    (data.last_calculated_targets?.feed as any) || null;

  base.time.length = {
    value: data.length ?? null,
    source: 'input',
    locked: false,
  };
  base.time.passes = {
    value: typeof data.passes === 'number' && data.passes > 0 ? data.passes : 1,
    source: 'input',
    locked: false,
  };
  base.time.nonCuttingTime = {
    value: data.non_cutting_time ?? 0,
    source: 'input',
    locked: false,
  };
  base.time.cuttingTimeSeconds = data.cutting_time_seconds ?? null;
  base.time.totalCycleTimeSeconds = data.total_cycle_time_seconds ?? null;

  return recalculateAll(base);
}

// ============================================================================
// 6. MULTI-CUT UNIFIED CYCLE TIME ENGINE (SPECIFICATION R1.1 EXTENSION)
// All tool cuts / passes in ONE unified tab / spreadsheet grid
// ============================================================================

export interface MachiningCutRow {
  id: string;
  name: string; // e.g. "T01", "T02"...
  description?: string; // Nội dung gia công (cho ghi tự do)
  machiningType: MachiningType;

  // D - Vc - N group
  diameter: VariableState<number | null>; // D (mm)
  cuttingSpeed: VariableState<number | null>; // Vc (m/min)
  spindleSpeed: VariableState<number | null>; // N (rpm)
  d_vc_n_lastTarget?: 'diameter' | 'cuttingSpeed' | 'spindleSpeed' | null;
  d_vc_n_conflict?: string | null;

  // Feed group
  teethCount: VariableState<number | null>; // Z
  feedPerTooth: VariableState<number | null>; // Fz (mm/tooth)
  feedPerRev: VariableState<number | null>; // Fn (mm/rev)
  feedRate: VariableState<number | null>; // F (mm/min)
  threadPitch: VariableState<number | null>; // P (mm/rev, for tapping)
  feed_lastTarget?: 'feedRate' | 'feedPerTooth' | 'feedPerRev' | null;
  feed_conflict?: string | null;

  // Time & passes
  length: VariableState<number | null>; // Length (mm)
  passes: VariableState<number | null>; // Passes (decimal, e.g. 1.75)
  cuttingTimeSeconds: number | null; // (L * Passes * 60) / F
}

export interface MultiCutCycleTimeState {
  schemaVersion: '1.2';
  cuts: MachiningCutRow[];
  nonCuttingTimeSeconds: number; // Thời gian phụ / gá kẹp / đổi dao (giây)
  nonCuttingTimeNote?: string; // Ghi chú thời gian phụ (hạng mục gì, lý do)
  totalCuttingTimeSeconds: number; // Tổng thời gian cắt của tất cả đường dao
  totalCycleTimeSeconds: number; // Tổng thời gian chu kỳ = Cắt + Phụ
  globalConflict?: string | null;
}

export function createDefaultCutRow(
  stepNumber: number,
  machiningType: MachiningType = 'turning',
  name?: string,
  description?: string
): MachiningCutRow {
  const isTurning = isSingleEdgeTurningType(machiningType);
  const defaultZ = isTurning ? 1 : 2;
  const id = `cut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const defaultToolName = stepNumber < 10 ? `T0${stepNumber}` : `T${stepNumber}`;
  return {
    id,
    name: name || defaultToolName,
    description: description || '',
    machiningType,
    diameter: { value: null, source: 'input', locked: false },
    cuttingSpeed: { value: null, source: 'input', locked: false },
    spindleSpeed: { value: null, source: 'input', locked: false },
    d_vc_n_lastTarget: null,
    d_vc_n_conflict: null,
    teethCount: { value: isTurning ? 1 : defaultZ, source: 'input', locked: isTurning },
    feedPerTooth: { value: null, source: 'input', locked: false },
    feedPerRev: { value: null, source: 'input', locked: false },
    feedRate: { value: null, source: 'input', locked: false },
    threadPitch: { value: null, source: 'input', locked: false },
    feed_lastTarget: null,
    feed_conflict: null,
    length: { value: null, source: 'input', locked: false },
    passes: { value: 1, source: 'input', locked: false },
    cuttingTimeSeconds: null,
  };
}

export function createInitialMultiCutState(
  defaultType: MachiningType = 'turning',
  initialCtSeconds?: number | null
): MultiCutCycleTimeState {
  const firstCut = createDefaultCutRow(1, defaultType, 'T01');
  return {
    schemaVersion: '1.2',
    cuts: [firstCut],
    nonCuttingTimeSeconds: 0,
    nonCuttingTimeNote: '',
    totalCuttingTimeSeconds: 0,
    totalCycleTimeSeconds: initialCtSeconds ?? 0,
    globalConflict: null,
  };
}

export function solveCutRow(cut: MachiningCutRow): MachiningCutRow {
  const updatedCut = { ...cut };
  const length = updatedCut.length.value;
  const passes = updatedCut.passes.value;
  const feed = updatedCut.feedRate.value;

  if (length && length > 0 && passes && passes > 0 && feed && feed > 0) {
    const ctSec = (length * passes * 60) / feed;
    updatedCut.cuttingTimeSeconds = Number.isFinite(ctSec) && ctSec > 0 ? ctSec : null;
  } else {
    updatedCut.cuttingTimeSeconds = null;
  }
  return updatedCut;
}

/**
 * Updates a variable in D - Vc - N group for a specific cut row and cascades
 */
export function updateCutRowDVcN(
  cut: MachiningCutRow,
  field: 'diameter' | 'cuttingSpeed' | 'spindleSpeed',
  value: number | null
): MachiningCutRow {
  const dVcNState: DVcNSolverState = {
    diameter: cut.diameter,
    cuttingSpeed: cut.cuttingSpeed,
    spindleSpeed: cut.spindleSpeed,
    lastCalculatedTarget: cut.d_vc_n_lastTarget ?? null,
    conflict: cut.d_vc_n_conflict ?? null,
  };

  const solvedDVcN = solveDVcN(dVcNState, field, value);

  // Re-evaluate feed with new spindle speed
  const feedState: FeedSolverState = {
    feedRate: cut.feedRate,
    feedPerTooth: cut.feedPerTooth,
    feedPerRev: cut.feedPerRev,
    teethCount: cut.teethCount,
    threadPitch: cut.threadPitch,
    lastCalculatedTarget: cut.feed_lastTarget ?? null,
    conflict: cut.feed_conflict ?? null,
  };

  const solvedFeed = recalculateFeedFromSpindleSpeed(
    feedState,
    cut.machiningType,
    solvedDVcN.spindleSpeed.value
  );

  const updatedCut: MachiningCutRow = {
    ...cut,
    diameter: solvedDVcN.diameter,
    cuttingSpeed: solvedDVcN.cuttingSpeed,
    spindleSpeed: solvedDVcN.spindleSpeed,
    d_vc_n_lastTarget: solvedDVcN.lastCalculatedTarget,
    d_vc_n_conflict: solvedDVcN.conflict,
    feedRate: solvedFeed.feedRate,
    feedPerTooth: solvedFeed.feedPerTooth,
    feedPerRev: solvedFeed.feedPerRev,
    teethCount: solvedFeed.teethCount,
    threadPitch: solvedFeed.threadPitch,
    feed_lastTarget: solvedFeed.lastCalculatedTarget,
    feed_conflict: solvedFeed.conflict,
  };

  return solveCutRow(updatedCut);
}

/**
 * Updates a variable in Feed group for a specific cut row and cascades
 */
export function updateCutRowFeed(
  cut: MachiningCutRow,
  field: 'feedRate' | 'feedPerTooth' | 'feedPerRev' | 'teethCount' | 'threadPitch',
  value: number | null
): MachiningCutRow {
  // If turning family (turning, facing, thread_turn, part_off, grooving), Z is strictly fixed to 1 and locked
  if (isSingleEdgeTurningType(cut.machiningType) && field === 'teethCount') {
    return cut;
  }

  const feedState: FeedSolverState = {
    feedRate: cut.feedRate,
    feedPerTooth: cut.feedPerTooth,
    feedPerRev: cut.feedPerRev,
    teethCount: cut.teethCount,
    threadPitch: cut.threadPitch,
    lastCalculatedTarget: cut.feed_lastTarget ?? null,
    conflict: cut.feed_conflict ?? null,
  };

  const solvedFeed = solveFeed(
    feedState,
    cut.machiningType,
    cut.spindleSpeed.value,
    field,
    value
  );

  const updatedCut: MachiningCutRow = {
    ...cut,
    feedRate: solvedFeed.feedRate,
    feedPerTooth: solvedFeed.feedPerTooth,
    feedPerRev: solvedFeed.feedPerRev,
    teethCount: solvedFeed.teethCount,
    threadPitch: solvedFeed.threadPitch,
    feed_lastTarget: solvedFeed.lastCalculatedTarget,
    feed_conflict: solvedFeed.conflict,
  };

  return solveCutRow(updatedCut);
}

/**
 * Updates machining type for a specific cut row and re-evaluates
 */
export function updateCutRowMachiningType(
  cut: MachiningCutRow,
  newType: MachiningType
): MachiningCutRow {
  const isTurning = isSingleEdgeTurningType(newType);
  const defaultZ = isTurning ? 1 : 2;
  const currentZ = cut.teethCount.value;

  const updatedCut: MachiningCutRow = {
    ...cut,
    machiningType: newType,
    teethCount: {
      value: isTurning ? 1 : (currentZ && currentZ > 1 ? currentZ : defaultZ),
      source: 'input',
      locked: isTurning,
    },
  };
  return solveCutRow(updatedCut);
}

/**
 * Toggles lock state of a variable for a specific cut row
 */
export function toggleCutRowLock(
  cut: MachiningCutRow,
  field: 'diameter' | 'cuttingSpeed' | 'spindleSpeed' | 'feedRate' | 'feedPerTooth'
): MachiningCutRow {
  const updated = { ...cut };
  if (field === 'diameter' || field === 'cuttingSpeed' || field === 'spindleSpeed') {
    updated[field] = {
      ...updated[field],
      locked: !updated[field].locked,
    };
  } else if (field === 'feedRate' || field === 'feedPerTooth') {
    updated[field] = {
      ...updated[field],
      locked: !updated[field].locked,
    };
  }
  return solveCutRow(updated);
}

/**
 * Duplicates a cut row
 */
export function duplicateCutRow(
  cut: MachiningCutRow,
  _newStepNumber?: number
): MachiningCutRow {
  const id = `cut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    ...cut,
    id,
    name: `${cut.name} (copy)`,
  };
}

export function recalculateMultiCutState(state: MultiCutCycleTimeState): MultiCutCycleTimeState {
  let totalCutTime = 0;
  let hasConflict = false;

  const nextCuts = state.cuts.map((cut) => {
    // Solve Feed with Spindle Speed
    const feedSolverInput: FeedSolverState = {
      feedRate: cut.feedRate,
      feedPerTooth: cut.feedPerTooth,
      feedPerRev: cut.feedPerRev,
      teethCount: cut.teethCount,
      threadPitch: cut.threadPitch,
      lastCalculatedTarget: cut.feed_lastTarget ?? null,
      conflict: cut.feed_conflict ?? null,
    };
    const updatedFeed = recalculateFeedFromSpindleSpeed(
      feedSolverInput,
      cut.machiningType,
      cut.spindleSpeed.value
    );

    const resolvedCut: MachiningCutRow = {
      ...cut,
      feedRate: updatedFeed.feedRate,
      feedPerTooth: updatedFeed.feedPerTooth,
      feedPerRev: updatedFeed.feedPerRev,
      teethCount: updatedFeed.teethCount,
      threadPitch: updatedFeed.threadPitch,
      feed_lastTarget: updatedFeed.lastCalculatedTarget,
      feed_conflict: updatedFeed.conflict,
    };

    const finalCut = solveCutRow(resolvedCut);
    if (finalCut.cuttingTimeSeconds) {
      totalCutTime += finalCut.cuttingTimeSeconds;
    }
    if (finalCut.d_vc_n_conflict || finalCut.feed_conflict) {
      hasConflict = true;
    }
    return finalCut;
  });

  const nonCut = state.nonCuttingTimeSeconds || 0;
  const totalCycleTime = totalCutTime > 0 || nonCut > 0 ? totalCutTime + nonCut : 0;

  return {
    ...state,
    cuts: nextCuts,
    nonCuttingTimeNote: state.nonCuttingTimeNote || '',
    totalCuttingTimeSeconds: totalCutTime,
    totalCycleTimeSeconds: totalCycleTime,
    globalConflict: hasConflict ? 'Có xung đột khóa biến ở một hoặc nhiều đường dao' : null,
  };
}

export interface SerializedMultiCutState {
  schema_version: '1.2';
  cuts: Array<{
    id: string;
    name: string;
    description?: string;
    machining_type: MachiningType;
    diameter: number | null;
    cutting_speed: number | null;
    spindle_speed: number | null;
    teeth_count: number | null;
    feed_per_tooth: number | null;
    feed_per_rev: number | null;
    feed_rate: number | null;
    thread_pitch: number | null;
    length: number | null;
    passes: number;
    cutting_time_seconds: number | null;
    field_sources: Record<string, VariableSource>;
    lock_states: Record<string, boolean>;
  }>;
  non_cutting_time_seconds: number;
  non_cutting_time_note?: string;
  total_cutting_time_seconds: number;
  total_cycle_time_seconds: number;
}

export function serializeMultiCutState(state: MultiCutCycleTimeState): SerializedMultiCutState {
  return {
    schema_version: '1.2',
    cuts: state.cuts.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description || '',
      machining_type: c.machiningType,
      diameter: c.diameter.value,
      cutting_speed: c.cuttingSpeed.value,
      spindle_speed: c.spindleSpeed.value,
      teeth_count: c.teethCount.value,
      feed_per_tooth: c.feedPerTooth.value,
      feed_per_rev: c.feedPerRev.value,
      feed_rate: c.feedRate.value,
      thread_pitch: c.threadPitch.value,
      length: c.length.value,
      passes: c.passes.value ?? 1,
      cutting_time_seconds: c.cuttingTimeSeconds,
      field_sources: {
        diameter: c.diameter.source,
        cuttingSpeed: c.cuttingSpeed.source,
        spindleSpeed: c.spindleSpeed.source,
        feedRate: c.feedRate.source,
        feedPerTooth: c.feedPerTooth.source,
        feedPerRev: c.feedPerRev.source,
      },
      lock_states: {
        diameter: c.diameter.locked,
        cuttingSpeed: c.cuttingSpeed.locked,
        spindleSpeed: c.spindleSpeed.locked,
        feedRate: c.feedRate.locked,
        feedPerTooth: c.feedPerTooth.locked,
      },
    })),
    non_cutting_time_seconds: state.nonCuttingTimeSeconds,
    non_cutting_time_note: state.nonCuttingTimeNote || '',
    total_cutting_time_seconds: state.totalCuttingTimeSeconds,
    total_cycle_time_seconds: state.totalCycleTimeSeconds,
  };
}

export function deserializeMultiCutState(
  data: any,
  defaultType: MachiningType = 'turning',
  initialCt?: number | null
): MultiCutCycleTimeState {
  if (!data) return createInitialMultiCutState(defaultType, initialCt);

  // 1. If already a MultiCutCycleTimeState object (with VariableState structure)
  if (
    (data.schemaVersion === '1.2' || data.schema_version === '1.2') &&
    Array.isArray(data.cuts) &&
    data.cuts.length > 0 &&
    data.cuts[0] &&
    typeof data.cuts[0].diameter === 'object' &&
    data.cuts[0].diameter !== null &&
    'value' in data.cuts[0].diameter
  ) {
    const directState: MultiCutCycleTimeState = {
      schemaVersion: '1.2',
      cuts: data.cuts.map((c: any) => ({
        ...c,
        description: c.description || '',
      })),
      nonCuttingTimeSeconds: data.nonCuttingTimeSeconds ?? data.non_cutting_time_seconds ?? 0,
      nonCuttingTimeNote: data.nonCuttingTimeNote ?? data.non_cutting_time_note ?? '',
      totalCuttingTimeSeconds: data.totalCuttingTimeSeconds ?? data.total_cutting_time_seconds ?? 0,
      totalCycleTimeSeconds: data.totalCycleTimeSeconds ?? data.total_cycle_time_seconds ?? (initialCt ?? 0),
    };
    return recalculateMultiCutState(directState);
  }

  // 2. If serialized multi-cut (schema_version 1.2 or schemaVersion 1.2 with flat cut values)
  if (
    (data.schema_version === '1.2' || data.schemaVersion === '1.2') &&
    Array.isArray(data.cuts) &&
    data.cuts.length > 0
  ) {
    const cuts: MachiningCutRow[] = data.cuts.map((c: any, idx: number) => {
      const rawType = c.machining_type || c.machiningType;
      const type: MachiningType = normalizeMachiningType(rawType, defaultType);
      const sources = c.field_sources || c.fieldSources || {};
      const locks = c.lock_states || c.lockStates || {};
      const isTurning = isSingleEdgeTurningType(type);
      const defZ = isTurning ? 1 : 2;
      const defaultToolCode = idx < 9 ? `T0${idx + 1}` : `T${idx + 1}`;
      const rawName = typeof c.name === 'string' ? c.name.trim() : '';
      const finalName = !rawName || rawName.startsWith('Đường dao') ? defaultToolCode : rawName;

      const getVal = (v: any) =>
        typeof v === 'object' && v !== null && 'value' in v ? v.value : (v !== undefined ? v : null);
      const getSource = (key: string, v: any): VariableSource =>
        typeof v === 'object' && v !== null && 'source' in v ? v.source : (sources[key] || 'input');
      const getLock = (key: string, v: any): boolean =>
        typeof v === 'object' && v !== null && 'locked' in v ? Boolean(v.locked) : Boolean(locks[key]);

      return {
        id: c.id || `cut-${idx + 1}-${Date.now()}`,
        name: finalName,
        description: c.description || '',
        machiningType: type,
        diameter: {
          value: getVal(c.diameter),
          source: getSource('diameter', c.diameter),
          locked: getLock('diameter', c.diameter),
        },
        cuttingSpeed: {
          value: getVal(c.cutting_speed ?? c.cuttingSpeed),
          source: getSource('cuttingSpeed', c.cuttingSpeed),
          locked: getLock('cuttingSpeed', c.cuttingSpeed),
        },
        spindleSpeed: {
          value: getVal(c.spindle_speed ?? c.spindleSpeed),
          source: getSource('spindleSpeed', c.spindleSpeed),
          locked: getLock('spindleSpeed', c.spindleSpeed),
        },
        teethCount: {
          value: isTurning ? 1 : (getVal(c.teeth_count ?? c.teethCount) ?? defZ),
          source: 'input',
          locked: isTurning,
        },
        feedPerTooth: {
          value: getVal(c.feed_per_tooth ?? c.feedPerTooth),
          source: getSource('feedPerTooth', c.feedPerTooth),
          locked: getLock('feedPerTooth', c.feedPerTooth),
        },
        feedPerRev: {
          value: getVal(c.feed_per_rev ?? c.feedPerRev),
          source: getSource('feedPerRev', c.feedPerRev),
          locked: false,
        },
        feedRate: {
          value: getVal(c.feed_rate ?? c.feedRate),
          source: getSource('feedRate', c.feedRate),
          locked: getLock('feedRate', c.feedRate),
        },
        threadPitch: {
          value: getVal(c.thread_pitch ?? c.threadPitch),
          source: 'input',
          locked: false,
        },
        length: {
          value: getVal(c.length),
          source: 'input',
          locked: false,
        },
        passes: {
          value:
            typeof c.passes === 'object' && c.passes !== null && 'value' in c.passes
              ? c.passes.value
              : typeof c.passes === 'number' && c.passes > 0
              ? c.passes
              : 1,
          source: 'input',
          locked: false,
        },
        cuttingTimeSeconds: c.cutting_time_seconds ?? c.cuttingTimeSeconds ?? null,
      };
    });

    const state: MultiCutCycleTimeState = {
      schemaVersion: '1.2',
      cuts,
      nonCuttingTimeSeconds: data.non_cutting_time_seconds ?? data.nonCuttingTimeSeconds ?? 0,
      nonCuttingTimeNote: data.non_cutting_time_note ?? data.nonCuttingTimeNote ?? '',
      totalCuttingTimeSeconds: data.total_cutting_time_seconds ?? data.totalCuttingTimeSeconds ?? 0,
      totalCycleTimeSeconds: data.total_cycle_time_seconds ?? data.totalCycleTimeSeconds ?? (initialCt ?? 0),
    };
    return recalculateMultiCutState(state);
  }

  // 3. If legacy schema 1.1 or partial single cut
  const legacy = deserializeCalculationState(data);
  const singleCut: MachiningCutRow = {
    id: `cut-1-${Date.now()}`,
    name: 'T01',
    description: (data as any)?.cut_description || (data as any)?.description || '',
    machiningType: legacy.machiningType,
    diameter: legacy.d_vc_n.diameter,
    cuttingSpeed: legacy.d_vc_n.cuttingSpeed,
    spindleSpeed: legacy.d_vc_n.spindleSpeed,
    d_vc_n_lastTarget: legacy.d_vc_n.lastCalculatedTarget,
    teethCount: legacy.feed.teethCount,
    feedPerTooth: legacy.feed.feedPerTooth,
    feedPerRev: legacy.feed.feedPerRev,
    feedRate: legacy.feed.feedRate,
    threadPitch: legacy.feed.threadPitch,
    feed_lastTarget: legacy.feed.lastCalculatedTarget,
    length: legacy.time.length,
    passes: legacy.time.passes,
    cuttingTimeSeconds: legacy.time.cuttingTimeSeconds,
  };

  const state: MultiCutCycleTimeState = {
    schemaVersion: '1.2',
    cuts: [singleCut],
    nonCuttingTimeSeconds: legacy.time.nonCuttingTime.value ?? 0,
    nonCuttingTimeNote: (data as any)?.non_cutting_time_note || (data as any)?.nonCuttingTimeNote || '',
    totalCuttingTimeSeconds: legacy.time.cuttingTimeSeconds ?? 0,
    totalCycleTimeSeconds: legacy.time.totalCycleTimeSeconds ?? (initialCt ?? 0),
  };
  return recalculateMultiCutState(state);
}

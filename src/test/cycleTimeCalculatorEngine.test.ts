import { describe, it, expect } from 'vitest';
import {
  createInitialCalculationState,
  solveDVcN,
  solveFeed,
  solveTimes,
  recalculateAll,
  toggleFieldLock,
  serializeCalculationState,
  deserializeCalculationState,
  formatDisplayNumber,
} from '../lib/cycleTimeEngine';

describe('CYCLE TIME CALCULATOR ENGINE — SPECIFICATION R1.1', () => {
  // Acceptance Test 1: Decimal Passes
  it('1. Decimal Passes: Passes = 1.75 calculates correctly with exact precision', () => {
    let state = createInitialCalculationState('turning');
    state.time.length.value = 50; // mm
    state.time.passes.value = 1.75; // decimal passes
    state.feed.feedRate.value = 200; // mm/min

    const updated = solveTimes(state.time, state.feed.feedRate.value);

    // Expected Cutting Time = 50 * 1.75 * 60 / 200 = 26.25 seconds
    expect(updated.cuttingTimeSeconds).toBeCloseTo(26.25, 4);
    expect(updated.totalCycleTimeSeconds).toBeCloseTo(26.25, 4);

    // Verify other decimal passes: 1.3, 1.5, 2.25
    state.time.passes.value = 1.3;
    const ct13 = solveTimes(state.time, 200);
    expect(ct13.cuttingTimeSeconds).toBeCloseTo((50 * 1.3 * 60) / 200, 4);

    state.time.passes.value = 2.25;
    const ct225 = solveTimes(state.time, 200);
    expect(ct225.cuttingTimeSeconds).toBeCloseTo((50 * 2.25 * 60) / 200, 4);
  });

  // Acceptance Test 2: Example A — Unlocked: Editing N recalculates D when Vc must be preserved
  it('2. Example A: Editing N recalculates D when Vc must be preserved', () => {
    let state = createInitialCalculationState('turning');

    // 1. Engineer enters Vc = 100
    state.d_vc_n = solveDVcN(state.d_vc_n, 'cuttingSpeed', 100);
    expect(state.d_vc_n.cuttingSpeed.value).toBe(100);
    expect(state.d_vc_n.cuttingSpeed.source).toBe('input');

    // 2. Engineer enters D = 10
    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', 10);
    expect(state.d_vc_n.diameter.value).toBe(10);
    expect(state.d_vc_n.diameter.source).toBe('input');

    // 3. System calculates N ≈ 3183.10 rpm
    expect(state.d_vc_n.spindleSpeed.value).toBeCloseTo(3183.0988, 2);
    expect(state.d_vc_n.spindleSpeed.source).toBe('calculated');

    // 4. Engineer changes N to 2500
    state.d_vc_n = solveDVcN(state.d_vc_n, 'spindleSpeed', 2500);

    // 5. System retains Vc = 100
    expect(state.d_vc_n.cuttingSpeed.value).toBe(100);
    expect(state.d_vc_n.cuttingSpeed.source).toBe('input');

    // 6. System recalculates D ≈ 12.7324
    // Formula: D = 1000 * 100 / (π * 2500) ≈ 12.732395
    expect(state.d_vc_n.diameter.value).toBeCloseTo(12.7324, 2);

    // 7. D becomes bold (source === 'calculated')
    expect(state.d_vc_n.diameter.source).toBe('calculated');
    expect(state.d_vc_n.spindleSpeed.source).toBe('input');
  });

  // Acceptance Test 3: Example B — Locked D: Locking D and editing N recalculates Vc
  it('3. Example B: Locking D and editing N recalculates Vc', () => {
    let state = createInitialCalculationState('turning');

    // 1. Engineer enters D = 10
    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', 10);

    // 2. Engineer locks D
    state = toggleFieldLock(state, 'd_vc_n', 'diameter');
    expect(state.d_vc_n.diameter.locked).toBe(true);

    // 3. Engineer changes N = 2500
    state.d_vc_n = solveDVcN(state.d_vc_n, 'spindleSpeed', 2500);

    // 4. System preserves D = 10
    expect(state.d_vc_n.diameter.value).toBe(10);
    expect(state.d_vc_n.diameter.locked).toBe(true);

    // 5. System calculates Vc ≈ 78.54
    // Formula: Vc = π * 10 * 2500 / 1000 ≈ 78.5398
    expect(state.d_vc_n.cuttingSpeed.value).toBeCloseTo(78.5398, 2);

    // 6. Vc becomes bold
    expect(state.d_vc_n.cuttingSpeed.source).toBe('calculated');
  });

  // Acceptance Test 4: Editing Vc with D locked recalculates N
  it('4. Editing Vc with D locked recalculates N', () => {
    let state = createInitialCalculationState('turning');

    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', 10);
    state = toggleFieldLock(state, 'd_vc_n', 'diameter');
    expect(state.d_vc_n.diameter.locked).toBe(true);

    // Engineer enters Vc = 100
    state.d_vc_n = solveDVcN(state.d_vc_n, 'cuttingSpeed', 100);

    // D is preserved
    expect(state.d_vc_n.diameter.value).toBe(10);
    // N is calculated: 1000 * 100 / (π * 10) ≈ 3183.10
    expect(state.d_vc_n.spindleSpeed.value).toBeCloseTo(3183.0988, 2);
    expect(state.d_vc_n.spindleSpeed.source).toBe('calculated');
  });

  // Acceptance Test 5: Changing calculated values converts them to user inputs
  it('5. Changing calculated values converts them to user inputs (source: input)', () => {
    let state = createInitialCalculationState('turning');

    state.d_vc_n = solveDVcN(state.d_vc_n, 'cuttingSpeed', 100);
    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', 10);
    expect(state.d_vc_n.spindleSpeed.source).toBe('calculated');

    // Overriding the calculated spindle speed directly
    state.d_vc_n = solveDVcN(state.d_vc_n, 'spindleSpeed', 3000);
    expect(state.d_vc_n.spindleSpeed.source).toBe('input');
    expect(state.d_vc_n.spindleSpeed.value).toBe(3000);
  });

  // Acceptance Test 6: Recalculated fields become bold (source: calculated)
  it('6. Recalculated fields are flagged with source: calculated', () => {
    let state = createInitialCalculationState('turning');

    state.d_vc_n = solveDVcN(state.d_vc_n, 'cuttingSpeed', 120);
    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', 20);

    expect(state.d_vc_n.spindleSpeed.source).toBe('calculated');
  });

  // Acceptance Test 7: Recalculation Cascades — D/Vc/N -> F/Fz -> Cutting Time -> Total CT
  it('7. Cascades: Editing upstream D updates N, which cascades into Feed, Cutting Time and Total CT', () => {
    let state = createInitialCalculationState('milling');
    state.time.length.value = 100; // mm
    state.time.passes.value = 1.5; // decimal passes
    state.time.nonCuttingTime.value = 5; // 5 seconds handling
    state.feed.teethCount.value = 4; // 4 flutes
    state.feed.feedPerTooth.value = 0.05; // mm/tooth

    // Set Vc = 100, D = 20
    state.d_vc_n = solveDVcN(state.d_vc_n, 'cuttingSpeed', 100);
    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', 20);

    // Initial N ≈ 1591.55 rpm
    // Feed = N * Z * Fz = 1591.55 * 4 * 0.05 ≈ 318.31 mm/min
    // Cutting Time = 100 * 1.5 * 60 / 318.31 ≈ 28.27 sec
    // Total CT = 28.27 + 5 = 33.27 sec
    state = recalculateAll(state);

    expect(state.d_vc_n.spindleSpeed.value).toBeCloseTo(1591.55, 1);
    expect(state.feed.feedRate.value).toBeCloseTo(318.31, 1);
    expect(state.time.cuttingTimeSeconds).toBeCloseTo(28.27, 1);
    expect(state.time.totalCycleTimeSeconds).toBeCloseTo(33.27, 1);

    // Now user changes D from 20 to 40 (cutting speed remains 100)
    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', 40);
    state = recalculateAll(state);

    // Spindle speed halves to ≈ 795.77 rpm
    // Feed halves to ≈ 159.15 mm/min
    // Cutting Time doubles to ≈ 56.55 sec
    // Total CT = 56.55 + 5 = 61.55 sec
    expect(state.d_vc_n.spindleSpeed.value).toBeCloseTo(795.77, 1);
    expect(state.feed.feedRate.value).toBeCloseTo(159.15, 1);
    expect(state.time.cuttingTimeSeconds).toBeCloseTo(56.55, 1);
    expect(state.time.totalCycleTimeSeconds).toBeCloseTo(61.55, 1);
  });

  // Acceptance Test 8: Conflicting lock combinations are detected
  it('8. Conflict detection: Locking all remaining variables produces a conflict explanation', () => {
    let state = createInitialCalculationState('turning');
    state.d_vc_n = solveDVcN(state.d_vc_n, 'cuttingSpeed', 100);
    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', 10);
    state = recalculateAll(state);

    // Lock both diameter and cutting speed
    state = toggleFieldLock(state, 'd_vc_n', 'diameter');
    state = toggleFieldLock(state, 'd_vc_n', 'cuttingSpeed');
    expect(state.d_vc_n.diameter.locked).toBe(true);
    expect(state.d_vc_n.cuttingSpeed.locked).toBe(true);

    // Now try to edit spindleSpeed to an incompatible value
    state.d_vc_n = solveDVcN(state.d_vc_n, 'spindleSpeed', 9999);
    expect(state.d_vc_n.conflict).toBeTruthy();
    expect(state.d_vc_n.conflict).toContain('Xung đột khóa biến');
    // Locked values must NOT be overwritten silently
    expect(state.d_vc_n.diameter.value).toBe(10);
    expect(state.d_vc_n.cuttingSpeed.value).toBe(100);
  });

  // Acceptance Test 9: Invalid numeric states never produce NaN or Infinity
  it('9. Error safety: Zero or negative values never produce NaN or Infinity', () => {
    let state = createInitialCalculationState('turning');
    state.d_vc_n = solveDVcN(state.d_vc_n, 'cuttingSpeed', 0);
    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', -10);
    state.time.length.value = 0;
    state.feed.feedRate.value = 0;

    const result = recalculateAll(state);

    expect(Number.isNaN(result.d_vc_n.spindleSpeed.value)).toBe(false);
    expect(result.d_vc_n.spindleSpeed.value).toBeNull();
    expect(result.time.cuttingTimeSeconds).toBeNull();
    expect(result.time.totalCycleTimeSeconds).toBeNull();
  });

  // Acceptance Test 10: Reopening Draft restores variable locks and calculation precedence
  it('10. Draft Persistence: Serializing and deserializing restores all inputs, locks, and sources', () => {
    let state = createInitialCalculationState('turning');
    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', 15);
    state = toggleFieldLock(state, 'd_vc_n', 'diameter'); // Locked D
    state.d_vc_n = solveDVcN(state.d_vc_n, 'spindleSpeed', 2000);
    state.feed = solveFeed(state.feed, 'turning', 2000, 'feedPerRev', 0.12);
    state.time.length.value = 45;
    state.time.passes.value = 1.75;
    state.time.nonCuttingTime.value = 3.5;
    state = recalculateAll(state);

    const serialized = serializeCalculationState(state);
    expect(serialized.schema_version).toBe('1.1');
    expect(serialized.passes).toBe(1.75);
    expect(serialized.lock_states.diameter).toBe(true);

    const restored = deserializeCalculationState(serialized);

    expect(restored.schemaVersion).toBe('1.1');
    expect(restored.d_vc_n.diameter.value).toBe(15);
    expect(restored.d_vc_n.diameter.locked).toBe(true);
    expect(restored.d_vc_n.cuttingSpeed.source).toBe('calculated');
    expect(restored.time.passes.value).toBe(1.75);
    expect(restored.time.cuttingTimeSeconds).toBeCloseTo(state.time.cuttingTimeSeconds!, 4);
    expect(restored.time.totalCycleTimeSeconds).toBeCloseTo(state.time.totalCycleTimeSeconds!, 4);
  });

  // Acceptance Test 11: No circular update loops
  it('11. Determinism: Single pass recalculation produces stable state with zero loop oscillations', () => {
    let state = createInitialCalculationState('turning');
    state.d_vc_n = solveDVcN(state.d_vc_n, 'cuttingSpeed', 150);
    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', 25);
    state = recalculateAll(state);

    const firstPassN = state.d_vc_n.spindleSpeed.value;
    const secondPass = recalculateAll(state);
    const thirdPass = recalculateAll(secondPass);

    expect(secondPass.d_vc_n.spindleSpeed.value).toBe(firstPassN);
    expect(thirdPass.d_vc_n.spindleSpeed.value).toBe(firstPassN);
  });

  // Acceptance Test 12: Display rounding does not create cumulative calculation errors
  it('12. Full-precision calculation: Display formatting does not corrupt raw internal numbers', () => {
    let state = createInitialCalculationState('turning');
    state.d_vc_n = solveDVcN(state.d_vc_n, 'cuttingSpeed', 100);
    state.d_vc_n = solveDVcN(state.d_vc_n, 'diameter', 10);
    state = recalculateAll(state);

    const rawN = state.d_vc_n.spindleSpeed.value!;
    const displayedN = formatDisplayNumber(rawN, 2); // e.g. "3183.1"

    // Raw value preserves all precision
    expect(rawN.toString()).not.toBe(displayedN);
    expect(rawN).toBeCloseTo(3183.0988618379, 6);
  });
});

/**
 * Master catalog of 8 standardized NG types for Sample Tracking R3 (FIX 04).
 * Shared master catalog between PE-MFG and QA.
 */
export const STANDARDIZED_NG_TYPES = [
  'NG Đường Kính',
  'NG Chiều Dài',
  'NG Kích thước',
  'NG Ren',
  'NG Ngoại quan',
  'NG Xước dập',
  'NG hình dáng',
  'Lỗi khác',
] as const;

export type StandardizedNgType = (typeof STANDARDIZED_NG_TYPES)[number];

/**
 * Standard defect code mapping for database integrity.
 */
export const STANDARDIZED_NG_CODES: Record<string, string> = {
  'NG Đường Kính': 'NG-DIA',
  'NG Chiều Dài': 'NG-LEN',
  'NG Kích thước': 'NG-DIM',
  'NG Ren': 'NG-THR',
  'NG Ngoại quan': 'NG-APP',
  'NG Xước dập': 'NG-SCR',
  'NG hình dáng': 'NG-SHP',
  'Lỗi khác': 'DEF-OTH-01',
};

/**
 * Returns options list for dropdown.
 * If existing record has a legacy value not in the 8 standardized types,
 * it preserves and includes that legacy value at the beginning of the list
 * so it remains visible and selected without automatic mutation.
 */
export function getNgTypeOptions(currentValue?: string | null): string[] {
  const standard = [...STANDARDIZED_NG_TYPES];
  if (!currentValue || !currentValue.trim()) {
    return standard;
  }
  const trimmed = currentValue.trim();
  if (standard.includes(trimmed as any)) {
    return standard;
  }
  // Preserve legacy/historical value at top of list
  return [trimmed, ...standard];
}

/**
 * Maps a defect name to a standard defect code.
 * Falls back to DEF-OTH-01 or null.
 */
export function getDefectCodeForName(name: string): string {
  if (STANDARDIZED_NG_CODES[name]) {
    return STANDARDIZED_NG_CODES[name];
  }
  return 'DEF-OTH-01';
}

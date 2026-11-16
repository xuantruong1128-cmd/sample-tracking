import { supabase } from '../../lib/supabase';
import { ENV } from '../../lib/env';
import type { AuthUser, Profile, UserRole } from '../../types/auth';
import { registerOrCheckDeviceSession } from '../../lib/deviceUtils';

/**
 * Valid Vietnamese Mobile Prefixes (after leading 0):
 * Viettel: 32, 33, 34, 35, 36, 37, 38, 39, 86, 96, 97, 98
 * Mobifone: 70, 79, 77, 76, 78, 89, 90, 93
 * Vinaphone: 81, 82, 83, 84, 85, 88, 91, 94
 * Vietnamobile: 52, 56, 58, 92
 * Gmobile: 59, 99
 * Itelecom / Wintel: 55, 87
 */
const VALID_VN_MOBILE_PREFIXES = [
  '32', '33', '34', '35', '36', '37', '38', '39',
  '52', '55', '56', '58', '59',
  '70', '76', '77', '78', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '90', '91', '92', '93', '94', '96', '97', '98', '99',
];

export interface CanonicalPhoneResult {
  isValid: boolean;
  canonicalPhone: string; // E.164: +84912345678
  localPhone: string;     // Local VN format: 0912345678
  displayPhone: string;   // Formatted for UI: 0912 345 678
  aliasEmail: string;     // Internal Supabase alias: 84912345678@sampletracking.local
  error?: string;
}

/**
 * Vietnamese Phone Canonicalization Policy (F-06 Remediation)
 * Shared policy across Frontend, CLI scripts, and Edge Functions.
 *
 * Rules:
 * 1. Strips all spaces, dashes, dots, brackets.
 * 2. Accepts:
 *    - Local format: 0912345678 (10 digits starting with 0)
 *    - International format: +84912345678 or 84912345678
 * 3. Enforces valid Vietnamese mobile prefix (3x, 5x, 7x, 8x, 9x).
 * 4. Rejects invalid prefixes, wrong digit lengths, or non-phone inputs.
 * 5. Returns deterministic E.164 canonical (+84xxxxxxxxx) and internal email alias.
 */
export function canonicalizeVietnamesePhone(rawPhone: string): CanonicalPhoneResult {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return {
      isValid: false,
      canonicalPhone: '',
      localPhone: '',
      displayPhone: '',
      aliasEmail: '',
      error: 'Vui lòng nhập số điện thoại.',
    };
  }

  // Strip all whitespace, hyphens, periods, parentheses
  let cleaned = rawPhone.trim().replace(/[\s\-.()]/g, '');

  // Check if starts with +
  let hasPlus = cleaned.startsWith('+');
  if (hasPlus) {
    cleaned = cleaned.substring(1);
  }

  // Check digits only
  if (!/^\d+$/.test(cleaned)) {
    return {
      isValid: false,
      canonicalPhone: '',
      localPhone: '',
      displayPhone: '',
      aliasEmail: '',
      error: 'Số điện thoại chỉ được chứa các chữ số.',
    };
  }

  let nineDigits = '';

  if (cleaned.startsWith('84')) {
    // e.g. 84912345678 -> length must be 11
    if (cleaned.length !== 11) {
      return {
        isValid: false,
        canonicalPhone: '',
        localPhone: '',
        displayPhone: '',
        aliasEmail: '',
        error: `Số điện thoại định dạng quốc tế phải có đúng 11 chữ số (ví dụ: +84912345678). Đang có ${cleaned.length} số.`,
      };
    }
    nineDigits = cleaned.substring(2);
  } else if (cleaned.startsWith('0')) {
    // e.g. 0912345678 -> length must be 10
    if (cleaned.length !== 10) {
      return {
        isValid: false,
        canonicalPhone: '',
        localPhone: '',
        displayPhone: '',
        aliasEmail: '',
        error: `Số điện thoại di động Việt Nam phải có đúng 10 chữ số (ví dụ: 0912345678). Đang có ${cleaned.length} số.`,
      };
    }
    nineDigits = cleaned.substring(1);
  } else if (cleaned.length === 9) {
    // 9 digits without leading 0 or 84 (e.g. 912345678)
    nineDigits = cleaned;
  } else {
    return {
      isValid: false,
      canonicalPhone: '',
      localPhone: '',
      displayPhone: '',
      aliasEmail: '',
      error: 'Số điện thoại không hợp lệ. Vui lòng nhập số di động bắt đầu bằng 0 (ví dụ: 0912345678).',
    };
  }

  // Validate 2-digit prefix
  const prefix = nineDigits.substring(0, 2);
  if (!VALID_VN_MOBILE_PREFIXES.includes(prefix)) {
    return {
      isValid: false,
      canonicalPhone: '',
      localPhone: '',
      displayPhone: '',
      aliasEmail: '',
      error: `Đầu số "0${prefix}" không phải là đầu số di động hợp lệ tại Việt Nam.`,
    };
  }

  const canonicalPhone = `+84${nineDigits}`;
  const localPhone = `0${nineDigits}`;
  const displayPhone = `${localPhone.substring(0, 4)} ${localPhone.substring(4, 7)} ${localPhone.substring(7)}`;
  const aliasEmail = `84${nineDigits}@sampletracking.local`;

  return {
    isValid: true,
    canonicalPhone,
    localPhone,
    displayPhone,
    aliasEmail,
  };
}

/**
 * Legacy compatibility helper
 */
export function normalizePhone(rawPhone: string): string {
  const result = canonicalizeVietnamesePhone(rawPhone);
  return result.isValid ? result.localPhone : rawPhone.replace(/[^\d+]/g, '');
}

export function phoneToAliasEmail(rawPhone: string): string {
  const result = canonicalizeVietnamesePhone(rawPhone);
  return result.isValid ? result.aliasEmail : `${rawPhone.replace(/[^\d]/g, '')}@sampletracking.local`;
}

export function isValidPhone(rawPhone: string): boolean {
  return canonicalizeVietnamesePhone(rawPhone).isValid;
}

/**
 * Safe user-facing authentication errors (F-11 Remediation)
 * Prevents account enumeration and internal stack leaks while giving clear Vietnamese guidance.
 */
export function translateAuthError(error: any): string {
  if (!error) return 'Đã xảy ra lỗi không xác định.';
  const msg = (error.message || String(error)).toLowerCase();

  // User enumeration prevention: uniform invalid credential message
  if (
    msg.includes('invalid login credentials') ||
    msg.includes('invalid credentials') ||
    msg.includes('user not found') ||
    msg.includes('invalid email') ||
    msg.includes('invalid password') ||
    msg.includes('wrong password')
  ) {
    return 'Số điện thoại hoặc mật khẩu không chính xác.';
  }

  // Disabled / Banned account check (F-12)
  if (msg.includes('disabled') || msg.includes('banned') || msg.includes('vô hiệu')) {
    return 'Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ Quản trị viên (Admin).';
  }

  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'Thao tác quá nhanh hoặc quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.';
  }

  if (msg.includes('public user registration is disabled')) {
    return 'Hệ thống không cho phép tự đăng ký tài khoản. Vui lòng liên hệ Admin để được cấp quyền.';
  }

  if (msg.includes('network') || msg.includes('failed to fetch')) {
    return 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng.';
  }

  return 'Đăng nhập không thành công. Vui lòng kiểm tra lại thông tin đăng nhập.';
}

/**
 * Core authentication function using Phone + Password
 */
export async function loginWithPhone(
  rawPhone: string,
  password: string
): Promise<{ authUser: AuthUser; profile: Profile }> {
  if (!ENV.IS_CONFIGURED) {
    throw new Error(
      'Hệ thống chưa được kết nối với Supabase. Vui lòng cấu hình VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY trong tệp .env.'
    );
  }

  const phoneResult = canonicalizeVietnamesePhone(rawPhone);
  if (!phoneResult.isValid) {
    throw new Error(phoneResult.error || 'Số điện thoại không hợp lệ.');
  }

  if (!password || password.trim().length === 0) {
    throw new Error('Vui lòng nhập mật khẩu.');
  }

  // Attempt login using internal canonical alias
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: phoneResult.aliasEmail,
    password,
  });

  if (authError || !authData.user) {
    // Attempt fallback to canonical E.164 phone if native SMS provider is enabled
    let directSuccess = false;
    let fallbackUser: any = null;

    try {
      const directAttempt = await supabase.auth.signInWithPassword({
        phone: phoneResult.canonicalPhone,
        password,
      });
      if (!directAttempt.error && directAttempt.data.user) {
        directSuccess = true;
        fallbackUser = directAttempt.data.user;
      }
    } catch {
      // Direct phone fallback not enabled
    }

    if (!directSuccess) {
      throw new Error(translateAuthError(authError));
    }

    authData.user = fallbackUser;
  }

  const authenticatedUser = authData.user;
  if (!authenticatedUser) {
    throw new Error('Đăng nhập không thành công. Không tìm thấy thông tin tài khoản.');
  }

  // Fetch user profile and verify backend active status (F-12)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authenticatedUser.id)
    .single();

  if (profileError || !profile) {
    await supabase.auth.signOut();
    throw new Error(
      'Hồ sơ người dùng không tồn tại hoặc chưa được Admin cấp quyền. Vui lòng liên hệ Admin.'
    );
  }

  if (!profile.is_active) {
    // Immediately terminate session on deactivated account
    await supabase.auth.signOut();
    throw new Error('Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ Quản trị viên (Admin).');
  }

  // Enforce 2-Device Policy (1 PC + 1 Mobile per account)
  const deviceResult = await registerOrCheckDeviceSession();
  if (!deviceResult.allowed) {
    await supabase.auth.signOut();
    const typeLabel = deviceResult.device_type === 'desktop' ? 'Máy tính' : 'Điện thoại';
    const conflictName = deviceResult.conflictingDevice?.device_name || 'Thiết bị khác';
    const err: any = new Error(
      `Tài khoản đang đăng nhập trên một ${typeLabel} khác (${conflictName}). Quy định hệ thống chỉ cho phép 1 Máy tính và 1 Điện thoại cùng lúc. Vui lòng đăng xuất trên thiết bị cũ trước khi sử dụng máy này. Nếu thiết bị cũ bị mất hoặc hỏng, vui lòng liên hệ Admin để được cấp lại mật khẩu.`
    );
    err.isDeviceConflict = true;
    err.conflictingDevice = deviceResult.conflictingDevice;
    err.deviceType = deviceResult.device_type;
    throw err;
  }

  const authUser: AuthUser = {
    id: authenticatedUser.id,
    phone: phoneResult.localPhone,
    email: authenticatedUser.email,
    profile: profile as Profile,
  };

  return { authUser, profile: profile as Profile };
}

/**
 * Role-based permission guards for Workflow V2
 */
export const permissions = {
  canCreateJob: (role?: UserRole | null): boolean => role === 'Planning' || role === 'Admin',
  canEditPlanning: (role?: UserRole | null): boolean => role === 'Planning' || role === 'Admin',
  canEnterProduction: (role?: UserRole | null): boolean => role === 'PE-MFG' || role === 'Admin',
  canInspectQA: (role?: UserRole | null): boolean => role === 'QA' || role === 'Admin',
  canCloseJob: (role?: UserRole | null, isLeader?: boolean): boolean =>
    role === 'Admin' || (role === 'PE-MFG' && Boolean(isLeader)),
  canCloseOperation: (role?: UserRole | null, isLeader?: boolean): boolean =>
    role === 'Admin' || (role === 'PE-MFG' && Boolean(isLeader)),
  canReviewKiv: (role?: UserRole | null, isLeader?: boolean): boolean =>
    role === 'Admin' || (role === 'PE-MFG' && Boolean(isLeader)),
  canManageUsers: (role?: UserRole | null): boolean => role === 'Admin',
  canAppointLeader: (role?: UserRole | null): boolean => role === 'Admin',
  canMakePEDecision: (role?: UserRole | null, isDecisionMaker?: boolean): boolean =>
    role === 'Admin' || (role === 'PE-MFG' && Boolean(isDecisionMaker)),
  isAdmin: (role?: UserRole | null): boolean => role === 'Admin',
  isDrawing: (role?: UserRole | null): boolean => role === 'Drawing',
  isViewer: (role?: UserRole | null): boolean => role === 'Viewer',
  isBD: (role?: UserRole | null): boolean => role === 'BD',
  canCreateDrawingReview: (role?: UserRole | null): boolean => role === 'BD' || role === 'Admin',
  canEditTechnicalReview: (role?: UserRole | null): boolean => role === 'PE-MFG' || role === 'Admin',
  canCloseTechnicalReview: (role?: UserRole | null): boolean => role === 'PE-MFG' || role === 'Admin',
  canCreateReviewVersion: (role?: UserRole | null): boolean => role === 'PE-MFG' || role === 'Admin',
  canQuoteDrawingReview: (role?: UserRole | null): boolean => role === 'BD' || role === 'Admin',
  canRequoteDrawingReview: (role?: UserRole | null): boolean => role === 'BD' || role === 'Admin',
  canViewDrawingReview: (role?: UserRole | null): boolean => Boolean(role),
  canDownloadDrawingReport: (role?: UserRole | null): boolean => Boolean(role),
  canUploadSamplePhotos: (role?: UserRole | null): boolean => role === 'PE-MFG' || role === 'Admin',
  canReviewPeEngineering: (role?: UserRole | null): boolean => role === 'PE-MFG' || role === 'Admin',
  canUploadEngineeringDocuments: (role?: UserRole | null): boolean =>
    role === 'Drawing' || role === 'Planning' || role === 'PE-MFG' || role === 'Admin',
  canUploadQaDocuments: (role?: UserRole | null): boolean => role === 'QA' || role === 'Admin',
  canEditJobPlanning: (
    job?: { status?: string; operations?: Array<{ status: string }> } | null,
    role?: UserRole | null
  ): boolean => {
    if (role !== 'Planning' && role !== 'Admin') return false;
    if (!job || job.status !== 'ACTIVE') return false;
    return !(job.operations && job.operations.some((op) => op.status === 'CLOSED'));
  },
  canDeleteJob: (
    job?: { created_by?: string | null; status?: string; operations?: Array<{ status: string }> } | null,
    profile?: Profile | null
  ): boolean => {
    if (!job || !profile) return false;
    const isAdmin = profile.role === 'Admin';
    const isPlanningLeader = profile.role === 'Planning' && Boolean(profile.is_department_leader);
    const isPlanningOwner =
      profile.role === 'Planning' && Boolean(job.created_by && job.created_by === profile.id);
    return isAdmin || isPlanningLeader || isPlanningOwner;
  },
  isJobLocked: (
    job?: { status?: string; operations?: Array<{ status: string }> } | null
  ): boolean => {
    if (!job) return false;
    return (
      job.status === 'CLOSE' ||
      job.status === 'PURGED' ||
      Boolean(job.operations && job.operations.some((op) => op.status === 'CLOSED'))
    );
  },
  isPlanningLeader: (profile?: Profile | null): boolean =>
    profile?.role === 'Planning' && Boolean(profile?.is_department_leader),
  isPeMfgLeader: (profile?: Profile | null): boolean =>
    profile?.role === 'PE-MFG' && Boolean(profile?.is_department_leader),
  isQaLeader: (profile?: Profile | null): boolean =>
    profile?.role === 'QA' && Boolean(profile?.is_department_leader),
  canDownloadFinalReport: (role?: UserRole | null, isLeader?: boolean): boolean =>
    role === 'Admin' || (role === 'PE-MFG' && Boolean(isLeader)),
  canViewFinalReport: (role?: UserRole | null): boolean =>
    Boolean(role && role !== null),
};

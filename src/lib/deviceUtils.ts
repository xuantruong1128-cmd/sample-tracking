import { supabase } from './supabase';

export type DeviceType = 'desktop' | 'mobile';

export interface ConflictingDevice {
  device_name: string;
  device_type: DeviceType;
  last_active_at: string;
  created_at?: string;
}

export interface DeviceSessionResult {
  allowed: boolean;
  reason?: string;
  device_type?: DeviceType;
  conflictingDevice?: ConflictingDevice;
}

export interface DeviceVerifyResult {
  valid: boolean;
  reason?: string;
}

const DEVICE_ID_KEY = 'sample_tracking_device_id';

/**
 * Detects whether client device is a Desktop/PC or a Mobile device.
 * Used for 1-PC + 1-Mobile policy enforcement.
 */
export function detectDeviceType(): DeviceType {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'desktop';
  }

  const ua = navigator.userAgent || '';

  // 1. Common mobile user agent keywords
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
  if (mobileRegex.test(ua)) {
    return 'mobile';
  }

  // 2. iPad running modern iPadOS reports as Macintosh in UA, but has multi-touch
  if (/Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 2) {
    return 'mobile';
  }

  // 3. Coarse pointer + narrow viewport heuristic
  if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse) and (max-width: 768px)').matches) {
    return 'mobile';
  }

  return 'desktop';
}

/**
 * Human-readable friendly device label (e.g. "Chrome trên Windows 11", "Safari trên iPhone")
 */
export function getDeviceDisplayName(deviceType: DeviceType): string {
  if (typeof navigator === 'undefined') {
    return deviceType === 'desktop' ? 'Máy tính' : 'Điện thoại';
  }

  const ua = navigator.userAgent;
  let browser = 'Trình duyệt';
  if (/Edg/i.test(ua)) browser = 'Edge';
  else if (/Chrome/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Opera|OPR/i.test(ua)) browser = 'Opera';

  let os = deviceType === 'desktop' ? 'Máy tính' : 'Điện thoại';
  if (/Windows NT 10.0/i.test(ua)) os = 'Windows';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return `${browser} trên ${os}`;
}

/**
 * Returns a persistent unique identifier for this browser/device installation.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return 'temp-server-device-id';
  }

  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id || id.trim().length < 8) {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        id = crypto.randomUUID();
      } else {
        id = `dev-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
      }
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `dev-${Date.now()}`;
  }
}

/**
 * Registers this device session or checks for conflict during login.
 */
export async function registerOrCheckDeviceSession(): Promise<DeviceSessionResult> {
  const deviceId = getOrCreateDeviceId();
  const deviceType = detectDeviceType();
  const deviceName = getDeviceDisplayName(deviceType);
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;

  try {
    const { data, error } = await supabase.rpc('check_and_register_device_session', {
      p_device_id: deviceId,
      p_device_type: deviceType,
      p_device_name: deviceName,
      p_user_agent: userAgent,
    });

    if (error) {
      console.warn('check_and_register_device_session error:', error.message);
      // Graceful fallback to avoid locking users out in network anomaly
      return { allowed: true, reason: 'rpc_warning', device_type: deviceType };
    }

    const payload = data as any;
    if (payload?.allowed === false) {
      return {
        allowed: false,
        reason: payload.reason || 'device_slot_conflict',
        device_type: payload.device_type || deviceType,
        conflictingDevice: payload.conflicting_device,
      };
    }

    return {
      allowed: true,
      reason: payload?.reason || 'success',
      device_type: deviceType,
    };
  } catch (err: any) {
    console.error('Failed to register device session:', err);
    return { allowed: true, reason: 'exception_fallback', device_type: deviceType };
  }
}

/**
 * Verifies that current device is still active (used on focus / page load).
 * Auto-claims slot if vacant (smooth transition for existing logged-in sessions).
 */
export async function verifyCurrentDeviceSession(): Promise<DeviceVerifyResult> {
  const deviceId = getOrCreateDeviceId();
  const deviceType = detectDeviceType();
  const deviceName = getDeviceDisplayName(deviceType);
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;

  try {
    const { data, error } = await supabase.rpc('verify_current_device_session', {
      p_device_id: deviceId,
      p_device_type: deviceType,
      p_device_name: deviceName,
      p_user_agent: userAgent,
    });

    if (error) {
      // In case function is temporarily unavailable, do not force logout
      return { valid: true };
    }

    const payload = data as any;
    if (payload?.valid === false) {
      return { valid: false, reason: payload.reason || 'device_replaced' };
    }

    return { valid: true, reason: payload?.reason };
  } catch {
    return { valid: true };
  }
}

/**
 * Releases device session when user clicks logout.
 */
export async function releaseDeviceSession(): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  try {
    await supabase.rpc('release_device_session', {
      p_device_id: deviceId,
    });
  } catch (err) {
    console.warn('Failed to release device session on logout:', err);
  }
}

/**
 * Admin action: Revoke all active devices for a user.
 */
export async function adminRevokeUserDevices(targetUserId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.rpc('admin_revoke_all_user_devices', {
      p_target_user_id: targetUserId,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi khi thu hồi phiên thiết bị.' };
  }
}

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { ENV } from '../../lib/env';
import { Factory, Phone, Lock, AlertCircle, Info, ArrowRight, Loader2, Smartphone, Monitor } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deviceConflict, setDeviceConflict] = useState<{
    device_name: string;
    device_type: 'desktop' | 'mobile';
    last_active_at?: string;
  } | null>(null);

  const { login, error: authContextError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setDeviceConflict(null);

    if (!phone.trim()) {
      setFormError('Vui lòng nhập số điện thoại.');
      return;
    }
    if (!password) {
      setFormError('Vui lòng nhập mật khẩu.');
      return;
    }

    try {
      setIsSubmitting(true);
      await login(phone, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      if (err.isDeviceConflict) {
        setDeviceConflict(err.conflictingDevice || {
          device_name: 'Thiết bị khác',
          device_type: err.deviceType || 'desktop',
        });
      }
      setFormError(err.message || 'Đăng nhập không thành công. Vui lòng kiểm tra lại thông tin.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-8 sm:px-6 lg:px-8 px-4">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20 mb-3">
            <Factory className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">SAMPLE TRACKING</h1>
          <p className="text-sm text-slate-500 mt-1">Hệ thống Quản lý Tiến độ Gia công Hàng mẫu V1.0</p>
        </div>

        {/* Configuration Notice if not connected to live Supabase */}
        {!ENV.IS_CONFIGURED && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4 text-left">
            <div className="flex gap-2.5 items-start">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">
                  Chưa cấu hình Supabase
                </p>
                <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                  Vui lòng thêm biến môi trường <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">VITE_SUPABASE_URL</code> và <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">VITE_SUPABASE_ANON_KEY</code> vào file <code className="font-mono font-semibold">.env</code> để kết nối cơ sở dữ liệu thật.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="bg-white py-8 px-6 shadow-sm border border-slate-200/80 rounded-xl sm:px-10">
          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            {/* System / Session Terminated Message */}
            {authContextError && !formError && (
              <div
                role="alert"
                className="bg-amber-50 border-l-4 border-amber-500 p-3.5 rounded-r-md flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-snug font-medium">{authContextError}</p>
              </div>
            )}

            {/* Error Message */}
            {formError && (
              <div
                role="alert"
                className="bg-red-50 border-l-4 border-red-500 p-3.5 rounded-r-md flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-red-700 leading-snug font-medium space-y-1">
                  <p>{formError}</p>
                  {deviceConflict && (
                    <button
                      type="button"
                      onClick={() => setDeviceConflict(deviceConflict)}
                      className="underline font-bold text-red-800 hover:text-red-950 cursor-pointer block mt-1"
                    >
                      👉 Xem chi tiết thiết bị đang đăng nhập & hướng xử lý
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Phone Input */}
            <div>
              <label htmlFor="phone" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Số điện thoại
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Phone className="h-4 w-4" />
                </div>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="Ví dụ: 0912345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 text-slate-900 border border-slate-300 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label htmlFor="password" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Mật khẩu
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Nhập mật khẩu"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 text-slate-900 border border-slate-300 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-4 border border-transparent rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed touch-manipulation"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang đăng nhập...</span>
                  </>
                ) : (
                  <>
                    <span>Đăng nhập</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Admin Policy Notice */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <div className="flex gap-2 items-start text-left">
              <Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-500 leading-relaxed">
                Hệ thống nội bộ phục vụ sản xuất. Tài khoản do Admin cấp phát theo phòng ban (Planning, PE-MFG, QA).
                Không hỗ trợ tự đăng ký tài khoản.
              </p>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <p className="text-center text-xs text-slate-400 mt-6">
          SAMPLE TRACKING SYSTEM &copy; 2026 — Production Edition
        </p>
      </div>

      {/* Device Slot Conflict Warning Modal */}
      {deviceConflict && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
          data-testid="device-conflict-modal"
        >
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-amber-300 overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-5 py-4 flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl">
                {deviceConflict.device_type === 'desktop' ? (
                  <Monitor className="w-6 h-6 text-white" />
                ) : (
                  <Smartphone className="w-6 h-6 text-white" />
                )}
              </div>
              <div>
                <h3 className="font-bold text-sm tracking-wide uppercase">
                  Tài khoản đang đăng nhập ở thiết bị khác
                </h3>
                <p className="text-[11px] text-amber-100">
                  Chính sách bảo mật: Tối đa 1 Máy tính và 1 Điện thoại
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-700">
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-slate-600">
                  <span className="font-semibold">Loại thiết bị xung đột:</span>
                  <span className="font-bold text-amber-900">
                    {deviceConflict.device_type === 'desktop' ? '💻 Máy tính (PC/Laptop)' : '📱 Điện thoại (Mobile)'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span className="font-semibold">Thiết bị đang chiếm giữ:</span>
                  <span className="font-mono text-slate-900 font-semibold">{deviceConflict.device_name}</span>
                </div>
                {deviceConflict.last_active_at && (
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="font-semibold">Hoạt động gần nhất:</span>
                    <span className="text-slate-700">{new Date(deviceConflict.last_active_at).toLocaleString('vi-VN')}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2 text-slate-600 leading-relaxed">
                <p className="font-semibold text-slate-900">👉 Hướng xử lý:</p>
                <p>
                  1. <strong>Đăng xuất thiết bị cũ:</strong> Vui lòng mở thiết bị cũ ({deviceConflict.device_name}) và bấm <strong>Đăng xuất</strong>, sau đó quay lại đăng nhập máy này.
                </p>
                <p>
                  2. <strong>Nếu thiết bị cũ bị mất hoặc hỏng:</strong> Vui lòng liên hệ Quản trị viên (Admin) để cấp lại mật khẩu. Khi cấp lại mật khẩu, hệ thống sẽ tự động đăng xuất tất cả thiết bị để bạn đăng nhập lại từ đầu.
                </p>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                  📞 Hotline hỗ trợ Quản trị viên:
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <a
                    href="tel:0968041128"
                    className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-800 font-medium block"
                  >
                    <div className="font-bold text-blue-700">Đỗ Xuân Trường</div>
                    <div className="font-mono text-slate-600">0968 041 128</div>
                  </a>
                  <a
                    href="tel:0963238895"
                    className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-800 font-medium block"
                  >
                    <div className="font-bold text-blue-700">Nguyễn Thu Hương</div>
                    <div className="font-mono text-slate-600">0963 238 895</div>
                  </a>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setDeviceConflict(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs rounded-lg transition cursor-pointer"
              >
                Đã hiểu & Quay lại
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

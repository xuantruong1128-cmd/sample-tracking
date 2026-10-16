import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { supabase } from '../../lib/supabase';
import { ShieldCheck, Lock, AlertCircle, CheckCircle2, Loader2, LogOut } from 'lucide-react';

export const ChangePasswordPage: React.FC = () => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const { user, profile, refreshProfile, logout } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!newPassword || newPassword.trim().length === 0) {
      setFormError('Vui lòng nhập mật khẩu mới.');
      return;
    }

    if (newPassword.trim() === '123456') {
      setFormError('Mật khẩu mới không được trùng với mật khẩu tạm thời ban đầu (123456).');
      return;
    }

    if (newPassword.length < 8) {
      setFormError('Mật khẩu mới phải có tối thiểu 8 ký tự.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError('Xác nhận mật khẩu không trùng khớp.');
      return;
    }

    try {
      setIsSubmitting(true);

      // 1. Update password in Supabase GoTrue Auth
      const { error: authUpdateErr } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (authUpdateErr) {
        throw new Error(authUpdateErr.message || 'Không thể cập nhật mật khẩu trong hệ thống xác thực.');
      }

      // 2. Complete password change state in PostgreSQL profiles via dedicated RPC
      const { error: rpcErr } = await supabase.rpc('complete_first_login_password_change', {
        p_new_password: newPassword,
      });

      if (rpcErr) {
        throw new Error(rpcErr.message || 'Lỗi lưu trữ trạng thái đổi mật khẩu trên cơ sở dữ liệu.');
      }

      setSuccess(true);
      await refreshProfile();

      setTimeout(() => {
        navigate('/', { replace: true });
      }, 1000);
    } catch (err: any) {
      setFormError(err.message || 'Đổi mật khẩu thất bại. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-8 sm:px-6 lg:px-8 px-4">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-amber-500 text-white shadow-md shadow-amber-500/20 mb-3">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">ĐỔI MẬT KHẨU BẮT BUỘC</h1>
          <p className="text-sm text-slate-500 mt-1">
            Yêu cầu an toàn bảo mật cho lần đăng nhập đầu tiên
          </p>
        </div>

        {/* Warning Banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 text-left">
          <div className="flex gap-2.5 items-start">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 leading-relaxed">
              <strong className="font-semibold block text-amber-900 mb-1">
                Tài khoản: {profile?.full_name || user?.phone} ({profile?.role})
              </strong>
              Tài khoản đang sử dụng mật khẩu tạm thời. Để bảo vệ dữ liệu sản xuất, bạn bắt buộc phải thiết lập mật khẩu mới (tối thiểu 8 ký tự và khác 123456) trước khi truy cập hệ thống.
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white py-6 px-6 sm:px-8 shadow-sm rounded-xl border border-slate-200">
          {success ? (
            <div className="py-6 text-center">
              <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">Đổi mật khẩu thành công!</h3>
              <p className="text-xs text-slate-500 mt-1">Đang chuyển tiếp vào hệ thống...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3.5 py-2.5 rounded-lg text-xs flex gap-2 items-start">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-500" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mật khẩu mới <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Tối thiểu 8 ký tự"
                    required
                    disabled={isSubmitting}
                    className="block w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Xác nhận mật khẩu mới <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới"
                    required
                    disabled={isSubmitting}
                    className="block w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Đang lưu mật khẩu mới...</span>
                    </>
                  ) : (
                    <span>Lưu mật khẩu mới & Tiếp tục</span>
                  )}
                </button>
              </div>

              <div className="pt-2 border-t border-slate-100 flex justify-center">
                <button
                  type="button"
                  onClick={logout}
                  className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1.5 transition py-1"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Đăng xuất khỏi tài khoản</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

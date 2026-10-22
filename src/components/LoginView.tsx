import React, { useState } from 'react';
import { Lock, Sparkles, User } from 'lucide-react';
import { api, setAuthToken } from '../services/api';

interface LoginViewProps {
  onLoginSuccess: (user: {
    id: number;
    username: string;
    displayName: string;
    role: string;
  }) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(username, password);
      setAuthToken(res.token);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-[#111C35] to-[#0B1324] flex items-center justify-center p-4"
      dir="rtl"
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
        <div className="p-6 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">فيفي 50×50</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              نظام إدارة المحل والمبيعات والمخزون والشكك
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-md">
            <Sparkles className="w-5 h-5" />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              اسم المستخدم
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border border-slate-300 rounded-xl pr-10 pl-4 py-2.5 text-sm font-mono focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="أدخل كلمة المرور..."
                className="w-full border border-slate-300 rounded-xl pr-10 pl-4 py-2.5 text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              بيانات الدخول الافتراضية للمالك: <span className="font-mono">admin</span> / كلمة المرور:{' '}
              <span className="font-mono">fifi5050</span>
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-extrabold transition-colors cursor-pointer"
          >
            {loading ? 'جارٍ التحقق...' : 'تسجيل الدخول للنظام'}
          </button>
        </form>
      </div>
    </div>
  );
};

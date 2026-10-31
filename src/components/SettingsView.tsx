import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  Lock,
  Save,
  ShieldCheck,
  Store,
  Upload,
  Wallet,
} from 'lucide-react';
import { api } from '../services/api';
import { StoreBootstrapData } from '../types/store';
import { formatCurrency, formatDateTimeAr, getTodayIso } from '../utils/format';

interface SettingsViewProps {
  data: StoreBootstrapData;
  onRefresh: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ data, onRefresh }) => {
  const s = data.settings;
  const [storeName, setStoreName] = useState(s?.store_name || 'فيفي 50×50');
  const [storeSubtitle, setStoreSubtitle] = useState(
    s?.store_subtitle || 'للمنظفات المنزلية والورقيات'
  );
  const [phone, setPhone] = useState(s?.phone || '');
  const [address, setAddress] = useState(s?.address || '');
  const [lowStockThreshold, setLowStockThreshold] = useState(
    String(s?.low_stock_threshold ?? 10)
  );
  const [receiptHeader, setReceiptHeader] = useState(
    s?.receipt_header || 'محل فيفي 50×50 للمنظفات المنزلية'
  );
  const [receiptFooter, setReceiptFooter] = useState(
    s?.receipt_footer || 'شكراً لتعاملكم معنا'
  );
  const [savingSettings, setSavingSettings] = useState(false);

  // Opening Cash
  const currentOpeningMovement = data.cashMovements.find(
    (cm) => cm.movement_type === 'opening_balance'
  );
  const [openingCashAmount, setOpeningCashAmount] = useState(
    currentOpeningMovement ? String(currentOpeningMovement.amount) : '0'
  );
  const [openingCashDate, setOpeningCashDate] = useState(
    currentOpeningMovement?.movement_date || getTodayIso()
  );
  const [openingCashNotes, setOpeningCashNotes] = useState(
    currentOpeningMovement?.description || 'رصيد الخزنة الافتتاحي عند بدء التشغيل'
  );
  const [savingCash, setSavingCash] = useState(false);

  // Password Change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Backups
  const [backupWorking, setBackupWorking] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingSettings(true);
    try {
      await api.updateSettings({
        store_name: storeName,
        store_subtitle: storeSubtitle,
        phone,
        address,
        low_stock_threshold: Number(lowStockThreshold),
        receipt_header: receiptHeader,
        receipt_footer: receiptFooter,
      });
      await onRefresh();
      setFeedback({ type: 'success', message: 'تم حفظ إعدادات المحل والفواتير بنجاح' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveOpeningCash = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingCash(true);
    try {
      await api.setOpeningCash({
        amount: Number(openingCashAmount),
        movementDate: openingCashDate,
        notes: openingCashNotes,
      });
      await onRefresh();
      setFeedback({
        type: 'success',
        message: 'تم تحديث قيد رصيد الخزنة الافتتاحي بنجاح',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setSavingCash(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingPassword(true);
    try {
      await api.changePassword({
        currentPassword,
        newPassword,
        displayName: displayName || undefined,
      });
      setCurrentPassword('');
      setNewPassword('');
      setFeedback({ type: 'success', message: 'تم تحديث كلمة المرور بنجاح' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleExportDownload = async () => {
    setFeedback(null);
    setBackupWorking(true);
    try {
      const snapshot = await api.exportBackup();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: 'application/json;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `fifi_50x50_backup_${new Date().toISOString().slice(0, 10)}.json`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setFeedback({
        type: 'success',
        message: 'تم تصدير وتحميل ملف النسخة الاحتياطية الكاملة بنجاح',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setBackupWorking(false);
    }
  };

  const handleCreateServerBackup = async () => {
    setFeedback(null);
    setBackupWorking(true);
    try {
      const res = await api.createManualBackup();
      await onRefresh();
      setFeedback({
        type: 'success',
        message: `تم حفظ نسخة احتياطية على الخادم (${res.filename})`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setBackupWorking(false);
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    setBackupWorking(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await api.restoreBackup(parsed);
      await onRefresh();
      setFeedback({
        type: 'success',
        message: 'تمت استعادة قاعدة البيانات بالكامل من ملف النسخة الاحتياطية بنجاح',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'فشل قراءة أو استعادة ملف النسخة الاحتياطية',
      });
    } finally {
      setBackupWorking(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2.5 text-xs sm:text-sm font-bold">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs font-bold underline cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Store & Receipt Settings */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-6">
          <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-slate-100">
            <Store className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                بيانات المحل وإعدادات الطباعة
              </h3>
              <p className="text-xs text-slate-500">
                تظهر هذه البيانات في الشريط الجانبي وعلى إيصالات البيع وكشوف الحساب.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المحل *</label>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">النشاط / الوصف</label>
                <input
                  type="text"
                  value={storeSubtitle}
                  onChange={(e) => setStoreSubtitle(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-bold text-slate-700 mb-1">رقم الهاتف</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010..."
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">العملة المعتمدة</label>
                <input
                  type="text"
                  disabled
                  value="الجنيه المصري (ج.م - EGP)"
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2 text-slate-600 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  حد التنبيه الافتراضي للمخزون
                </label>
                <input
                  type="number"
                  min="1"
                  value={lowStockThreshold}
                  onChange={(e) => setLowStockThreshold(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">العنوان</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                ترويسة إيصال الفاتورة (Receipt Header)
              </label>
              <input
                type="text"
                value={receiptHeader}
                onChange={(e) => setReceiptHeader(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                تذييل إيصال الفاتورة (Receipt Footer)
              </label>
              <input
                type="text"
                value={receiptFooter}
                onChange={(e) => setReceiptFooter(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2"
              />
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={savingSettings}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{savingSettings ? 'جارٍ الحفظ...' : 'حفظ إعدادات المحل'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Opening Cash Balance + Security */}
        <div className="lg:col-span-5 space-y-6">
          {/* Opening Cash Setup */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6">
            <div className="flex items-center gap-2.5 mb-3 pb-3 border-b border-slate-100">
              <Wallet className="w-5 h-5 text-emerald-600" />
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  إعداد رصيد الخزنة الافتتاحي
                </h3>
                <p className="text-xs text-slate-500">
                  يُسجل كقيد افتتاحي مؤرخ ومستقل عن المبيعات.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveOpeningCash} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    المبلغ الافتتاحي (ج.م)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={openingCashAmount}
                    onChange={(e) => setOpeningCashAmount(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">تاريخ القيد</label>
                  <input
                    type="date"
                    value={openingCashDate}
                    onChange={(e) => setOpeningCashDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">البيان</label>
                <input
                  type="text"
                  value={openingCashNotes}
                  onChange={(e) => setOpeningCashNotes(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2"
                />
              </div>

              <button
                type="submit"
                disabled={savingCash}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
              >
                {savingCash ? 'جارٍ التحديث...' : 'اعتماد الرصيد الافتتاحي للخزنة'}
              </button>
            </form>
          </div>

          {/* Password & Account Security */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6">
            <div className="flex items-center gap-2.5 mb-3 pb-3 border-b border-slate-100">
              <Lock className="w-5 h-5 text-slate-700" />
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  أمان الحساب وتغيير كلمة المرور
                </h3>
                <p className="text-xs text-slate-500">
                  تُحفظ بيانات الدخول محلياً على متصفحك.
                </p>
              </div>
            </div>

            <form onSubmit={handlePasswordChange} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  اسم العرض للمالك (اختياري)
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="مالك المحل (فيفي 50×50)"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    كلمة المرور الحالية *
                  </label>
                  <input
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="الافتراضية: fifi5050"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    كلمة المرور الجديدة *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={savingPassword}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold cursor-pointer"
              >
                {savingPassword ? 'جارٍ التحديث...' : 'تحديث كلمة المرور'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Backup & Restore Center */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <Database className="w-6 h-6 text-blue-600" />
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                النسخ الاحتياطي واستعادة البيانات (محلياً على المتصفح)
              </h3>
              <p className="text-xs text-slate-500">
                تُحفظ كافة البيانات مباشرة في المتصفح (LocalStorage) بدون الحاجة لخادم أو قاعدة بيانات خارجية، مع إمكانية التصدير والاستعادة في أي وقت.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={backupWorking}
              onClick={handleExportDownload}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تصدير نسخة احتياطية كاملة (JSON)</span>
            </button>

            <button
              type="button"
              disabled={backupWorking}
              onClick={handleCreateServerBackup}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>حفظ نقطة استعادة في المتصفح</span>
            </button>

            <label className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-4 h-4" />
              <span>استعادة من ملف نسخة احتياطية</span>
              <input
                type="file"
                accept=".json"
                onChange={handleRestoreFile}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Documented Restoration Procedure + Recent Automated Backups */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="font-extrabold text-slate-900">
              طريقة حفظ البيانات والنسخ الاحتياطي:
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-600 leading-relaxed">
              <li>
                <strong>تخزين فوري بالمتصفح:</strong> تُحفظ كافة الفواتير والمنتجات وحسابات الشكك محلياً داخل المتصفح (`LocalStorage`) بشكل تلقائي وفوري.
              </li>
              <li>
                <strong>النسخ اليدوي الخارجي:</strong> اضغط على «تصدير نسخة احتياطية كاملة (JSON)» لتحميل ملف البيانات على جهازك الشخصي أو فلاشة خارجية.
              </li>
              <li>
                <strong>خطوات الاستعادة:</strong> اضغط على «استعادة من ملف نسخة احتياطية» واختر ملف `.json` المُصدّر لاسترجاع كافة الأرصدة والفواتير فوراً.
              </li>
            </ol>
          </div>

          <div>
            <div className="font-extrabold text-slate-900 mb-2">
              نقاط الاستعادة المحفوظة بالمتصفح ({data.backups?.length || 0})
            </div>
            {!data.backups || data.backups.length === 0 ? (
              <div className="p-6 text-center text-slate-400 border border-slate-200 rounded-xl">
                لا توجد نسخ احتياطية محفوظة بعد.
              </div>
            ) : (
              <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {data.backups.slice(0, 8).map((b) => (
                  <div
                    key={b.filename}
                    className="px-3.5 py-2 flex items-center justify-between"
                  >
                    <span className="font-mono text-[11px] text-slate-800 truncate max-w-[230px]">
                      {b.filename}
                    </span>
                    <span className="text-slate-500 tabular-nums">
                      {formatDateTimeAr(b.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};

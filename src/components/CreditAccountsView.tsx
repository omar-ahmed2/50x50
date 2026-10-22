import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Eye,
  Printer,
  Search,
  UserPlus,
  Users,
  X,
  Edit3,
} from 'lucide-react';
import { roundMoney } from '../domain/calculations';
import { api, generateIdempotencyKey } from '../services/api';
import { Customer, PaymentMethod, StoreBootstrapData } from '../types/store';
import {
  formatCurrency,
  formatDateAr,
  formatDateTimeAr,
  getPaymentMethodLabel,
  getTodayIso,
} from '../utils/format';

interface CreditAccountsViewProps {
  data: StoreBootstrapData;
  onRefresh: () => Promise<void>;
  initialCustomerId?: number;
}

export const CreditAccountsView: React.FC<CreditAccountsViewProps> = ({
  data,
  onRefresh,
  initialCustomerId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'outstanding' | 'settled'>('all');
  const [sortBy, setSortBy] = useState<'balance_desc' | 'name_asc' | 'recent'>('balance_desc');

  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(
    initialCustomerId || null
  );
  const [statementFromDate, setStatementFromDate] = useState('2020-01-01');
  const [statementToDate, setStatementToDate] = useState(getTodayIso());

  // Add / Edit Customer Modal
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custOpeningBal, setCustOpeningBal] = useState('0');
  const [custNotes, setCustNotes] = useState('');
  const [custSubmitting, setCustSubmitting] = useState(false);

  // Collect Payment Modal
  const [collectModalCustomer, setCollectModalCustomer] = useState<Customer | null>(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [collectMethod, setCollectMethod] = useState<PaymentMethod>('cash');
  const [collectNotes, setCollectNotes] = useState('');
  const [collectDate, setCollectDate] = useState(getTodayIso());
  const [collectSubmitting, setCollectSubmitting] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const filteredCustomers = useMemo(() => {
    const list = data.customers.filter((c) => {
      if (statusFilter === 'outstanding' && Number(c.current_balance) <= 0) return false;
      if (statusFilter === 'settled' && Number(c.current_balance) > 0) return false;

      const q = searchQuery.trim().toLowerCase();
      if (q) {
        return c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q));
      }
      return true;
    });

    return list.sort((a, b) => {
      if (sortBy === 'balance_desc') {
        return Number(b.current_balance) - Number(a.current_balance);
      }
      if (sortBy === 'name_asc') {
        return a.name.localeCompare(b.name, 'ar');
      }
      return (b.last_transaction_at || '').localeCompare(a.last_transaction_at || '');
    });
  }, [data.customers, searchQuery, statusFilter, sortBy]);

  const selectedCustomer = useMemo(
    () => data.customers.find((c) => c.id === selectedCustomerId) || null,
    [data.customers, selectedCustomerId]
  );

  // Detailed Customer Profile & Statement data
  const customerProfileData = useMemo(() => {
    if (!selectedCustomer) return null;

    const inDateRange = (dStr: string | null | undefined) => {
      if (!dStr) return true;
      const d = dStr.slice(0, 10);
      return d >= statementFromDate && d <= statementToDate;
    };

    const creditSales = data.sales.filter(
      (s) => s.customer_id === selectedCustomer.id && inDateRange(s.sale_date)
    );
    const payments = data.payments.filter(
      (p) => p.customer_id === selectedCustomer.id && inDateRange(p.payment_date)
    );
    const returns = data.salesReturns.filter(
      (r) => r.customer_id === selectedCustomer.id && inDateRange(r.return_date)
    );

    // Unified chronological statement entries
    const statementEntries: Array<{
      id: string;
      date: string;
      reference: string;
      typeLabel: string;
      description: string;
      debit: number; // increases customer debt
      credit: number; // decreases customer debt
    }> = [];

    for (const s of creditSales) {
      const items = data.saleItems.filter((si) => si.sale_id === s.id);
      const itemsSummary = items
        .map((i) => `${i.product_name_snapshot} (${i.selling_unit_qty} ${i.selling_unit_label})`)
        .join(' + ');

      statementEntries.push({
        id: `sale-${s.id}`,
        date: s.created_at,
        reference: s.invoice_number,
        typeLabel: s.sale_type === 'partial' ? 'فاتورة دفع جزئي' : 'فاتورة شكك',
        description: itemsSummary || 'مشتريات آجلة',
        debit: Number(s.total_amount),
        credit: 0,
      });
    }

    for (const p of payments) {
      statementEntries.push({
        id: `pay-${p.id}`,
        date: p.created_at,
        reference: p.reference_number,
        typeLabel: p.payment_type === 'sale_initial' ? 'دفعة مقدمة' : 'تحصيل نقدية',
        description: p.notes || `سداد (${getPaymentMethodLabel(p.payment_method)})`,
        debit: 0,
        credit: Number(p.amount),
      });
    }

    for (const r of returns) {
      if (Number(r.credit_balance_reduction) > 0) {
        statementEntries.push({
          id: `ret-${r.id}`,
          date: r.created_at,
          reference: r.return_number,
          typeLabel: 'مرتجع مبيعات',
          description: `تخفيض مديونية عن مرتجع فاتورة (${r.reason})`,
          debit: 0,
          credit: Number(r.credit_balance_reduction),
        });
      }
    }

    statementEntries.sort((a, b) => a.date.localeCompare(b.date));

    return {
      creditSales,
      payments,
      returns,
      statementEntries,
    };
  }, [selectedCustomer, data.sales, data.saleItems, data.payments, data.salesReturns, statementFromDate, statementToDate]);

  const handleCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setCustSubmitting(true);
    try {
      if (editingCustomer) {
        await api.updateCustomer(editingCustomer.id, {
          name: custName,
          phone: custPhone,
          notes: custNotes,
        });
        setFeedback({ type: 'success', message: 'تم تحديث بيانات العميل بنجاح' });
      } else {
        await api.createCustomer({
          name: custName,
          phone: custPhone,
          notes: custNotes,
          opening_balance: Number(custOpeningBal || 0),
        });
        setFeedback({ type: 'success', message: 'تم إضافة العميل لدفتر الشكك بنجاح' });
      }
      setCustomerModalOpen(false);
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setCustSubmitting(false);
    }
  };

  const handleCollectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectModalCustomer) return;
    setFeedback(null);
    setCollectSubmitting(true);
    try {
      const res = await api.collectCustomerDebt(collectModalCustomer.id, {
        idempotency_key: generateIdempotencyKey('col'),
        amount: Number(collectAmount),
        payment_method: collectMethod,
        notes: collectNotes,
        payment_date: collectDate,
      });
      setCollectModalCustomer(null);
      await onRefresh();
      setFeedback({
        type: 'success',
        message: `تم تحصيل مبلغ ${formatCurrency(collectAmount)} بإيصال رقم ${
          res.reference_number
        }. الرصيد المتبقي على العميل: ${formatCurrency(res.new_balance)}`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setCollectSubmitting(false);
    }
  };

  const totalOutstandingAll = useMemo(
    () => roundMoney(data.customers.reduce((acc, c) => acc + Number(c.current_balance), 0)),
    [data.customers]
  );

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

      {/* Top Summary & Actions */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">الشكك — إدارة حسابات العملاء</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            إجمالي الديون المستحقة حالياً:{' '}
            <span className="font-extrabold text-rose-600 tabular-nums">
              {formatCurrency(totalOutstandingAll)}
            </span>{' '}
            · عدد العملاء المدينين:{' '}
            <span className="font-extrabold text-slate-800 tabular-nums">
              {data.customers.filter((c) => Number(c.current_balance) > 0).length}
            </span>
          </p>
        </div>

        <button
          onClick={() => {
            setEditingCustomer(null);
            setCustName('');
            setCustPhone('');
            setCustOpeningBal('0');
            setCustNotes('');
            setCustomerModalOpen(true);
          }}
          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-xs cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>إضافة عميل جديد</span>
        </button>
      </div>

      {/* Search & Filters matching reference image */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم العميل أو رقم الهاتف..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-2 text-xs sm:text-sm focus:bg-white focus:border-blue-600 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                statusFilter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-600'
              }`}
            >
              الكل ({data.customers.length})
            </button>
            <button
              onClick={() => setStatusFilter('outstanding')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                statusFilter === 'outstanding' ? 'bg-blue-600 text-white' : 'text-slate-600'
              }`}
            >
              مدين ({data.customers.filter((c) => Number(c.current_balance) > 0).length})
            </button>
            <button
              onClick={() => setStatusFilter('settled')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                statusFilter === 'settled' ? 'bg-blue-600 text-white' : 'text-slate-600'
              }`}
            >
              مسدد ({data.customers.filter((c) => Number(c.current_balance) <= 0).length})
            </button>
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700"
          >
            <option value="balance_desc">الأعلى مديونية</option>
            <option value="recent">الأحدث تعاملاً</option>
            <option value="name_asc">الاسم أبجدياً</option>
          </select>
        </div>
      </div>

      {/* Customer List Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden">
        {filteredCustomers.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-slate-800">لا توجد حسابات عملاء مطابقة</h3>
            <p className="text-xs text-slate-500 mt-1">
              يمكنك إضافة عملاء جدد لتتبع فواتير الشكك والتحصيلات وكشوف الحسابات الخاصة بهم.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold">
                  <th className="py-3.5 px-4">اسم العميل</th>
                  <th className="py-3.5 px-3">رقم الهاتف</th>
                  <th className="py-3.5 px-3">إجمالي مشتريات الشكك</th>
                  <th className="py-3.5 px-3">إجمالي المسدد</th>
                  <th className="py-3.5 px-3">الرصيد المستحق</th>
                  <th className="py-3.5 px-3">آخر عملية</th>
                  <th className="py-3.5 px-3">الحالة</th>
                  <th className="py-3.5 px-4 text-left">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCustomers.map((c) => {
                  const hasDebt = Number(c.current_balance) > 0;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4 font-extrabold text-slate-900">{c.name}</td>
                      <td className="py-3.5 px-3 font-mono text-slate-600">{c.phone || '—'}</td>
                      <td className="py-3.5 px-3 font-bold text-slate-800 tabular-nums">
                        {formatCurrency(c.total_credit_purchases)}
                      </td>
                      <td className="py-3.5 px-3 font-bold text-emerald-700 tabular-nums">
                        {formatCurrency(c.total_payments)}
                      </td>
                      <td
                        className={`py-3.5 px-3 font-extrabold tabular-nums ${
                          hasDebt ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        {formatCurrency(c.current_balance)}
                      </td>
                      <td className="py-3.5 px-3 text-slate-500 tabular-nums">
                        {formatDateTimeAr(c.last_transaction_at)}
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`font-bold ${
                            hasDebt ? 'text-rose-600' : 'text-emerald-700'
                          }`}
                        >
                          {hasDebt ? 'مدين' : 'مسدد'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center justify-end gap-2">
                          {hasDebt && (
                            <button
                              onClick={() => {
                                setCollectModalCustomer(c);
                                setCollectAmount(String(c.current_balance));
                                setCollectMethod('cash');
                                setCollectNotes('');
                                setCollectDate(getTodayIso());
                              }}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Coins className="w-3.5 h-3.5" />
                              <span>تحصيل دفعة</span>
                            </button>
                          )}
                          <button
                            onClick={() => setSelectedCustomerId(c.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>كشف الحساب</span>
                          </button>
                          <button
                            onClick={() => {
                              setEditingCustomer(c);
                              setCustName(c.name);
                              setCustPhone(c.phone || '');
                              setCustNotes(c.notes || '');
                              setCustomerModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==================== CUSTOMER ACCOUNT STATEMENT MODAL ==================== */}
      {selectedCustomer && customerProfileData && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full overflow-hidden my-8">
            <div className="no-print px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  ملف وكشف حساب العميل: {selectedCustomer.name}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  {selectedCustomer.phone || 'بدون رقم هاتف'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {Number(selectedCustomer.current_balance) > 0 && (
                  <button
                    onClick={() => {
                      setCollectModalCustomer(selectedCustomer);
                      setCollectAmount(String(selectedCustomer.current_balance));
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Coins className="w-3.5 h-3.5" />
                    <span>تحصيل دفعة الآن</span>
                  </button>
                )}
                <button
                  onClick={() => window.print()}
                  className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة كشف الحساب</span>
                </button>
                <button
                  onClick={() => setSelectedCustomerId(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 max-h-[82vh] overflow-y-auto space-y-5 text-xs">
              {/* Summary Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">إجمالي المشتريات الآجلة</div>
                  <div className="text-base font-extrabold text-slate-900 mt-1 tabular-nums">
                    {formatCurrency(selectedCustomer.total_credit_purchases)}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200">
                  <div className="text-emerald-800">إجمالي المدفوعات</div>
                  <div className="text-base font-extrabold text-emerald-700 mt-1 tabular-nums">
                    {formatCurrency(selectedCustomer.total_payments)}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200">
                  <div className="text-amber-800">المرتجعات المعتمدة</div>
                  <div className="text-base font-extrabold text-amber-700 mt-1 tabular-nums">
                    {formatCurrency(selectedCustomer.total_returns)}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-rose-50/80 border border-rose-200">
                  <div className="text-rose-800 font-bold">الرصيد المستحق الحالي</div>
                  <div className="text-lg font-extrabold text-rose-600 mt-1 tabular-nums">
                    {formatCurrency(selectedCustomer.current_balance)}
                  </div>
                </div>
              </div>

              {/* Date Range Filter */}
              <div className="no-print flex flex-wrap items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="font-bold text-slate-700">تصفية كشف الحساب بالتاريخ:</span>
                <input
                  type="date"
                  value={statementFromDate}
                  onChange={(e) => setStatementFromDate(e.target.value)}
                  className="bg-white border border-slate-300 rounded-lg px-2.5 py-1"
                />
                <span>إلى</span>
                <input
                  type="date"
                  value={statementToDate}
                  onChange={(e) => setStatementToDate(e.target.value)}
                  className="bg-white border border-slate-300 rounded-lg px-2.5 py-1"
                />
              </div>

              {/* Full Account Statement Ledger */}
              <div>
                <h4 className="font-extrabold text-slate-900 text-sm mb-2">
                  كشف الحساب التفصيلي (الفواتير، الأصناف، الدفعات، والمرتجعات)
                </h4>
                {customerProfileData.statementEntries.length === 0 ? (
                  <p className="text-center text-slate-400 py-6">
                    لا توجد حركات مسجلة لهذا العميل في الفترة المحددة.
                  </p>
                ) : (
                  <table className="w-full text-right border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold">
                        <th className="py-2.5 px-3">التاريخ</th>
                        <th className="py-2.5 px-3">رقم المرجع</th>
                        <th className="py-2.5 px-3">نوع الحركة</th>
                        <th className="py-2.5 px-3">البيان والأصناف</th>
                        <th className="py-2.5 px-3">مدين (عليه)</th>
                        <th className="py-2.5 px-3">دائن (له / سداد)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {customerProfileData.statementEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td className="py-2.5 px-3 tabular-nums">{formatDateAr(entry.date)}</td>
                          <td className="py-2.5 px-3 font-mono font-bold">{entry.reference}</td>
                          <td className="py-2.5 px-3 font-bold text-slate-800">
                            {entry.typeLabel}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{entry.description}</td>
                          <td className="py-2.5 px-3 font-bold text-rose-600 tabular-nums">
                            {entry.debit > 0 ? formatCurrency(entry.debit) : '—'}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-emerald-700 tabular-nums">
                            {entry.credit > 0 ? formatCurrency(entry.credit) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== COLLECT PAYMENT MODAL ==================== */}
      {collectModalCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                تحصيل دفعة شكك — {collectModalCustomer.name}
              </h3>
              <button
                onClick={() => setCollectModalCustomer(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCollectSubmit} className="p-6 space-y-4">
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between text-xs">
                <span className="font-bold text-rose-900">الرصيد المستحق حالياً:</span>
                <span className="text-base font-extrabold text-rose-600 tabular-nums">
                  {formatCurrency(collectModalCustomer.current_balance)}
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  المبلغ المستلم من العميل (ج.م) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={Number(collectModalCustomer.current_balance)}
                  required
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-sm font-extrabold tabular-nums"
                />
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                  <span>الرصيد المتبقي بعد التحصيل:</span>
                  <span className="font-bold text-slate-800 tabular-nums">
                    {formatCurrency(
                      Math.max(
                        0,
                        Number(collectModalCustomer.current_balance) - Number(collectAmount || 0)
                      )
                    )}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    طريقة السداد
                  </label>
                  <select
                    value={collectMethod}
                    onChange={(e) => setCollectMethod(e.target.value as PaymentMethod)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white"
                  >
                    <option value="cash">نقدي (الخزنة)</option>
                    <option value="card">بطاقة بنكية</option>
                    <option value="bank_transfer">تحويل بنكي / محفظة</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    تاريخ التحصيل
                  </label>
                  <input
                    type="date"
                    value={collectDate}
                    onChange={(e) => setCollectDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ملاحظات (اختياري)
                </label>
                <input
                  type="text"
                  value={collectNotes}
                  onChange={(e) => setCollectNotes(e.target.value)}
                  placeholder="مثال: دفعة نقدية من الحساب..."
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCollectModalCustomer(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={collectSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                >
                  {collectSubmitting ? 'جارٍ التسجيل...' : 'تأكيد التحصيل وتحديث الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== ADD / EDIT CUSTOMER MODAL ==================== */}
      {customerModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                {editingCustomer ? 'تعديل بيانات العميل' : 'إضافة عميل جديد لدفتر الشكك'}
              </h3>
              <button
                onClick={() => setCustomerModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCustomerSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اسم العميل *
                </label>
                <input
                  type="text"
                  required
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="مثال: أحمد محمد، محمود السيد..."
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  رقم الهاتف (اختياري)
                </label>
                <input
                  type="text"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  placeholder="01012345678"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-mono"
                />
              </div>

              {!editingCustomer && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    رصيد مديونية افتتاحي سابق (إن وجد - ج.م)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={custOpeningBal}
                    onChange={(e) => setCustOpeningBal(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs sm:text-sm tabular-nums"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ملاحظات (اختياري)
                </label>
                <input
                  type="text"
                  value={custNotes}
                  onChange={(e) => setCustNotes(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs sm:text-sm"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCustomerModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={custSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                >
                  {custSubmitting ? 'جارٍ الحفظ...' : 'حفظ العميل'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

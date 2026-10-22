import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Plus,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { calculateFinancialSummary, roundMoney } from '../domain/calculations';
import { api, generateIdempotencyKey } from '../services/api';
import { PaymentMethod, StoreBootstrapData } from '../types/store';
import {
  formatCurrency,
  formatDateAr,
  formatDateTimeAr,
  getPaymentMethodLabel,
  getTodayIso,
} from '../utils/format';

interface FinanceViewProps {
  data: StoreBootstrapData;
  onRefresh: () => Promise<void>;
}

type FinanceTab =
  | 'treasury'
  | 'receipts'
  | 'payments'
  | 'purchases'
  | 'expenses'
  | 'profits';

export const FinanceView: React.FC<FinanceViewProps> = ({ data, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<FinanceTab>('treasury');
  const [fromDate, setFromDate] = useState('2020-01-01');
  const [toDate, setToDate] = useState(getTodayIso());

  // Add Expense Modal
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expCategory, setExpCategory] = useState('إيجار المحل');
  const [expAmount, setExpAmount] = useState('');
  const [expDate, setExpDate] = useState(getTodayIso());
  const [expMethod, setExpMethod] = useState<PaymentMethod>('cash');
  const [expDesc, setExpDesc] = useState('');
  const [expAttachment, setExpAttachment] = useState('');
  const [expSubmitting, setExpSubmitting] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const inRange = (dStr: string | null | undefined) => {
    if (!dStr) return false;
    const d = dStr.slice(0, 10);
    return d >= fromDate && d <= toDate;
  };

  // Comprehensive Financial Calculations
  const financeMetrics = useMemo(() => {
    // Cash Treasury (All-time balance in physical cash drawer)
    const openingCash = roundMoney(
      data.cashMovements
        .filter((cm) => cm.movement_type === 'opening_balance')
        .reduce((acc, cm) => acc + Number(cm.amount), 0)
    );

    const cashReceiptsAll = roundMoney(
      data.cashMovements
        .filter(
          (cm) =>
            cm.direction === 'in' &&
            cm.movement_type !== 'opening_balance' &&
            cm.payment_method === 'cash'
        )
        .reduce((acc, cm) => acc + Number(cm.amount), 0)
    );

    const cashPaymentsAll = roundMoney(
      data.cashMovements
        .filter((cm) => cm.direction === 'out' && cm.payment_method === 'cash')
        .reduce((acc, cm) => acc + Number(cm.amount), 0)
    );

    const cardNetBalance = roundMoney(
      data.cashMovements
        .filter((cm) => cm.payment_method === 'card')
        .reduce(
          (acc, cm) => acc + (cm.direction === 'in' ? Number(cm.amount) : -Number(cm.amount)),
          0
        )
    );

    const bankNetBalance = roundMoney(
      data.cashMovements
        .filter((cm) => cm.payment_method === 'bank_transfer')
        .reduce(
          (acc, cm) => acc + (cm.direction === 'in' ? Number(cm.amount) : -Number(cm.amount)),
          0
        )
    );

    // Period-filtered Profit & Loss figures
    const periodSales = data.sales.filter((s) => inRange(s.sale_date));
    const periodReturns = data.salesReturns.filter((r) => inRange(r.return_date));
    const periodExpenses = data.expenses.filter((e) => inRange(e.expense_date));
    const periodPurchases = data.purchases.filter((p) => inRange(p.purchase_date));

    const grossSalesSubtotal = roundMoney(
      periodSales.reduce((acc, s) => acc + Number(s.subtotal), 0)
    );
    const salesDiscounts = roundMoney(
      periodSales.reduce((acc, s) => acc + Number(s.discount), 0)
    );
    const salesReturnsAmount = roundMoney(
      periodReturns.reduce((acc, r) => acc + Number(r.total_return_amount), 0)
    );
    const grossCogs = roundMoney(
      periodSales.reduce((acc, s) => acc + Number(s.total_cogs), 0)
    );
    const returnedResellableCogs = roundMoney(
      periodReturns.reduce((acc, r) => acc + Number(r.resellable_cogs_reversed), 0)
    );
    const damagedReturnsLoss = roundMoney(
      periodReturns.reduce((acc, r) => acc + Number(r.damaged_loss_amount), 0)
    );
    const operatingExpensesTotal = roundMoney(
      periodExpenses.reduce((acc, e) => acc + Number(e.amount), 0)
    );

    const summary = calculateFinancialSummary({
      grossSalesRevenue: grossSalesSubtotal,
      salesDiscounts,
      salesReturnsAmount,
      grossCogs,
      returnedResellableCogs,
      operatingExpenses: operatingExpensesTotal,
      openingCashBalance: openingCash,
      cashReceipts: cashReceiptsAll,
      cashPayments: cashPaymentsAll,
    });

    const periodReceiptsList = data.cashMovements.filter(
      (cm) => cm.direction === 'in' && inRange(cm.movement_date)
    );
    const periodPaymentsList = data.cashMovements.filter(
      (cm) => cm.direction === 'out' && inRange(cm.movement_date)
    );

    const unpaidPurchasesTotal = roundMoney(
      data.purchases
        .filter((p) => p.payment_status === 'unpaid')
        .reduce((acc, p) => acc + (Number(p.total_cost) - Number(p.amount_paid)), 0)
    );

    const hasIncompleteCosts = data.products.some(
      (p) => !p.is_archived && Number(p.cost_incomplete_flag) === 1
    );

    return {
      ...summary,
      openingCash,
      cashReceiptsAll,
      cashPaymentsAll,
      cardNetBalance,
      bankNetBalance,
      grossSalesSubtotal,
      salesDiscounts,
      salesReturnsAmount,
      grossCogs,
      returnedResellableCogs,
      damagedReturnsLoss,
      operatingExpensesTotal,
      periodReceiptsList,
      periodPaymentsList,
      periodExpenses,
      periodPurchases,
      unpaidPurchasesTotal,
      hasIncompleteCosts,
    };
  }, [data, fromDate, toDate]);

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setExpSubmitting(true);
    try {
      await api.createExpense({
        idempotency_key: generateIdempotencyKey('exp'),
        category: expCategory,
        amount: Number(expAmount),
        expense_date: expDate,
        payment_method: expMethod,
        description: expDesc,
        attachment_name: expAttachment,
      });
      setExpenseModalOpen(false);
      setExpAmount('');
      setExpDesc('');
      setExpAttachment('');
      await onRefresh();
      setFeedback({
        type: 'success',
        message: 'تم تسجيل المصروف التشغيلي وخصمه من الرصيد بنجاح',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setExpSubmitting(false);
    }
  };

  const handlePayUnpaidPurchase = async (purchaseId: number) => {
    setFeedback(null);
    try {
      await api.payPurchase(purchaseId, {
        payment_method: 'cash',
        payment_date: getTodayIso(),
      });
      await onRefresh();
      setFeedback({
        type: 'success',
        message: 'تم سداد فاتورة المشتريات الآجلة وخصم قيمتها من الخزنة بنجاح',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
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

      {/* Top Summary Cards matching reference image */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-emerald-50/70 rounded-2xl border border-emerald-200 p-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-emerald-900">صافي المبيعات (الفترة)</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">
              {formatCurrency(financeMetrics.netSales)}
            </div>
            <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
              بعد خصم الخصومات والمرتجعات
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-700 flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-rose-50/70 rounded-2xl border border-rose-200 p-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-rose-900">إجمالي المصروفات التشغيلية</div>
            <div className="text-2xl font-extrabold text-rose-600 mt-1 tabular-nums">
              {formatCurrency(financeMetrics.operatingExpensesTotal)}
            </div>
            <div className="text-[11px] text-rose-700 font-semibold mt-0.5">
              لا تشمل تكلفة شراء البضاعة
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-rose-500/15 text-rose-600 flex items-center justify-center">
            <TrendingDown className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-purple-50/70 rounded-2xl border border-purple-200 p-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-purple-950">صافي الربح التشغيلي</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">
              {formatCurrency(financeMetrics.operatingProfit)}
            </div>
            <div className="text-[11px] text-purple-800 font-semibold mt-0.5">
              مجمل الربح: {formatCurrency(financeMetrics.grossProfit)}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-purple-500/15 text-purple-700 flex items-center justify-center">
            <Wallet className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Navigation Tabs + Date Range & Expense Button */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'treasury', label: 'الخزنة' },
              { id: 'receipts', label: 'المقبوضات' },
              { id: 'payments', label: 'المدفوعات' },
              { id: 'purchases', label: 'المشتريات' },
              { id: 'expenses', label: 'المصروفات' },
              { id: 'profits', label: 'الأرباح' },
            ] as Array<{ id: FinanceTab; label: string }>
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-colors cursor-pointer ${
                activeTab === t.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold"
          />
          <span className="text-xs text-slate-400">إلى</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold"
          />

          <button
            onClick={() => setExpenseModalOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>تسجيل مصروف تشغيلي</span>
          </button>
        </div>
      </div>

      {/* TAB 1: الخزنة (TREASURY) */}
      {activeTab === 'treasury' && (
        <div className="space-y-6">
          {/* Cash Balance Formula Breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5">
            <h3 className="text-base font-extrabold text-slate-900 mb-3">
              معادلة مطابقة رصيد الخزنة النقدي والحسابات البنكية
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">الرصيد الافتتاحي للخزنة</div>
                <div className="text-base font-extrabold text-slate-900 mt-1 tabular-nums">
                  {formatCurrency(financeMetrics.openingCash)}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200">
                <div className="text-emerald-800">+ إجمالي المقبوضات النقدية</div>
                <div className="text-base font-extrabold text-emerald-700 mt-1 tabular-nums">
                  +{formatCurrency(financeMetrics.cashReceiptsAll)}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200">
                <div className="text-rose-800">− إجمالي المدفوعات النقدية</div>
                <div className="text-base font-extrabold text-rose-600 mt-1 tabular-nums">
                  -{formatCurrency(financeMetrics.cashPaymentsAll)}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-300">
                <div className="text-blue-900 font-bold">= رصيد الخزنة النقدي الفعلي</div>
                <div className="text-lg font-extrabold text-blue-700 mt-1 tabular-nums">
                  {formatCurrency(financeMetrics.cashBalance)}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-slate-500">أرصدة البطاقة والتحويل البنكي</div>
                <div className="text-xs font-bold text-slate-800 mt-1 tabular-nums">
                  بطاقة: {formatCurrency(financeMetrics.cardNetBalance)}
                </div>
                <div className="text-xs font-bold text-slate-800 mt-0.5 tabular-nums">
                  تحويل: {formatCurrency(financeMetrics.bankNetBalance)}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Cash Movements Table */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5">
            <h3 className="text-base font-extrabold text-slate-900 mb-3">
              حركات الخزنة الأخيرة
            </h3>
            {data.cashMovements.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                لا توجد حركات مسجلة في الخزنة بعد.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                      <th className="py-3 px-3">التاريخ</th>
                      <th className="py-3 px-3">رقم المرجع</th>
                      <th className="py-3 px-3">الاتجاه</th>
                      <th className="py-3 px-3">طريقة الدفع</th>
                      <th className="py-3 px-3">المبلغ</th>
                      <th className="py-3 px-3">الوصف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.cashMovements.map((cm) => (
                      <tr key={cm.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-3 tabular-nums">
                          {formatDateAr(cm.movement_date)}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-slate-800">
                          {cm.reference_number}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`font-extrabold ${
                              cm.direction === 'in' ? 'text-emerald-700' : 'text-rose-600'
                            }`}
                          >
                            {cm.direction === 'in' ? 'مقبوضات (وارد)' : 'مدفوعات (صادر)'}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-semibold text-slate-600">
                          {getPaymentMethodLabel(cm.payment_method)}
                        </td>
                        <td
                          className={`py-3 px-3 font-extrabold tabular-nums ${
                            cm.direction === 'in' ? 'text-emerald-700' : 'text-rose-600'
                          }`}
                        >
                          {cm.direction === 'in' ? '+' : '-'}
                          {formatCurrency(cm.amount)}
                        </td>
                        <td className="py-3 px-3 text-slate-700">{cm.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: المقبوضات (RECEIPTS) */}
      {activeTab === 'receipts' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5">
          <h3 className="text-base font-extrabold text-slate-900 mb-3">
            سجل المقبوضات الفعلية (مبيعات نقدية + دفعات مقدمة + تحصيلات شكك)
          </h3>
          {financeMetrics.periodReceiptsList.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              لا توجد مقبوضات مسجلة في هذه الفترة.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                    <th className="py-3 px-3">التاريخ</th>
                    <th className="py-3 px-3">رقم المرجع</th>
                    <th className="py-3 px-3">طريقة الدفع</th>
                    <th className="py-3 px-3">المبلغ المقبوض</th>
                    <th className="py-3 px-3">البيان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {financeMetrics.periodReceiptsList.map((cm) => (
                    <tr key={cm.id}>
                      <td className="py-3 px-3 tabular-nums">{formatDateAr(cm.movement_date)}</td>
                      <td className="py-3 px-3 font-mono font-bold">{cm.reference_number}</td>
                      <td className="py-3 px-3">{getPaymentMethodLabel(cm.payment_method)}</td>
                      <td className="py-3 px-3 font-extrabold text-emerald-700 tabular-nums">
                        +{formatCurrency(cm.amount)}
                      </td>
                      <td className="py-3 px-3 text-slate-700">{cm.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: المدفوعات (PAYMENTS OUT) */}
      {activeTab === 'payments' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5">
          <h3 className="text-base font-extrabold text-slate-900 mb-3">
            سجل المدفوعات الفعلية (سداد مشتريات + مصروفات تشغيلية + رد نقدية مرتجعات)
          </h3>
          {financeMetrics.periodPaymentsList.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              لا توجد مدفوعات مسجلة في هذه الفترة.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                    <th className="py-3 px-3">التاريخ</th>
                    <th className="py-3 px-3">رقم المرجع</th>
                    <th className="py-3 px-3">طريقة الدفع</th>
                    <th className="py-3 px-3">المبلغ المدفوع</th>
                    <th className="py-3 px-3">البيان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {financeMetrics.periodPaymentsList.map((cm) => (
                    <tr key={cm.id}>
                      <td className="py-3 px-3 tabular-nums">{formatDateAr(cm.movement_date)}</td>
                      <td className="py-3 px-3 font-mono font-bold">{cm.reference_number}</td>
                      <td className="py-3 px-3">{getPaymentMethodLabel(cm.payment_method)}</td>
                      <td className="py-3 px-3 font-extrabold text-rose-600 tabular-nums">
                        -{formatCurrency(cm.amount)}
                      </td>
                      <td className="py-3 px-3 text-slate-700">{cm.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: المشتريات (PURCHASES) */}
      {activeTab === 'purchases' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                سجل فواتير المشتريات وتوريد المخزون
              </h3>
              <p className="text-xs text-slate-500">
                المشتريات الآجلة لا تُخصم من الخزنة إلا عند سدادها فعلياً، ولا تُعد مصروفاً تشغيلياً.
              </p>
            </div>
            {financeMetrics.unpaidPurchasesTotal > 0 && (
              <div className="text-xs font-bold text-amber-700 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200 tabular-nums">
                مشتريات آجلة غير مسددة: {formatCurrency(financeMetrics.unpaidPurchasesTotal)}
              </div>
            )}
          </div>

          {financeMetrics.periodPurchases.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              لا توجد فواتير مشتريات مسجلة في هذه الفترة.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                    <th className="py-3 px-3">التاريخ</th>
                    <th className="py-3 px-3">رقم الفاتورة</th>
                    <th className="py-3 px-3">المورد / الصنف</th>
                    <th className="py-3 px-3">إجمالي التكلفة</th>
                    <th className="py-3 px-3">حالة السداد</th>
                    <th className="py-3 px-3 text-left">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {financeMetrics.periodPurchases.map((pur) => {
                    const pItem = data.purchaseItems.find((pi) => pi.purchase_id === pur.id);
                    return (
                      <tr key={pur.id}>
                        <td className="py-3 px-3 tabular-nums">
                          {formatDateAr(pur.purchase_date)}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold">{pur.reference_number}</td>
                        <td className="py-3 px-3 font-bold text-slate-800">
                          {pItem ? `${pItem.product_name_snapshot} (${pItem.purchased_qty} ${pItem.purchase_unit_label})` : pur.supplier_name || '—'}
                        </td>
                        <td className="py-3 px-3 font-extrabold text-slate-900 tabular-nums">
                          {formatCurrency(pur.total_cost)}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`font-bold ${
                              pur.payment_status === 'paid'
                                ? 'text-emerald-700'
                                : 'text-amber-600'
                            }`}
                          >
                            {pur.payment_status === 'paid' ? 'مسددة' : 'آجل غير مدفوع'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-left">
                          {pur.payment_status === 'unpaid' && (
                            <button
                              onClick={() => handlePayUnpaidPurchase(pur.id)}
                              className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold cursor-pointer"
                            >
                              سداد الآن من الخزنة
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: المصروفات (OPERATING EXPENSES) */}
      {activeTab === 'expenses' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-extrabold text-slate-900">
              سجل المصروفات التشغيلية (إيجار، كهرباء، نقل، نثريات)
            </h3>
            <button
              onClick={() => setExpenseModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
            >
              + إضافة مصروف
            </button>
          </div>

          {financeMetrics.periodExpenses.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              لا توجد مصروفات تشغيلية مسجلة في هذه الفترة.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                    <th className="py-3 px-3">التاريخ</th>
                    <th className="py-3 px-3">رقم المرجع</th>
                    <th className="py-3 px-3">التصنيف</th>
                    <th className="py-3 px-3">طريقة الدفع</th>
                    <th className="py-3 px-3">المبلغ</th>
                    <th className="py-3 px-3">الوصف / المرفق</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {financeMetrics.periodExpenses.map((ex) => (
                    <tr key={ex.id}>
                      <td className="py-3 px-3 tabular-nums">{formatDateAr(ex.expense_date)}</td>
                      <td className="py-3 px-3 font-mono font-bold">{ex.reference_number}</td>
                      <td className="py-3 px-3 font-extrabold text-slate-900">{ex.category}</td>
                      <td className="py-3 px-3">{getPaymentMethodLabel(ex.payment_method)}</td>
                      <td className="py-3 px-3 font-extrabold text-rose-600 tabular-nums">
                        {formatCurrency(ex.amount)}
                      </td>
                      <td className="py-3 px-3 text-slate-600">
                        {ex.description || '—'}
                        {ex.attachment_name && (
                          <span className="mr-2 text-blue-600 font-mono">
                            [{ex.attachment_name}]
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 6: الأرباح (PROFIT STATEMENT) */}
      {activeTab === 'profits' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 space-y-4">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              قائمة الأرباح والخسائر التفصيلية للفترة ({formatDateAr(fromDate)} إلى{' '}
              {formatDateAr(toDate)})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              يتم احتساب الأرباح بناءً على التكلفة التاريخية للبضاعة وقت البيع، ولا تُحسب تحصيلات الشكك كإيرادات مكررة.
            </p>
          </div>

          {financeMetrics.hasIncompleteCosts && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900">
              ملاحظة: توجد بعض الأصناف ذات رصيد افتتاحي بدون تكلفة شراء مسجلة؛ الأرقام أدناه تعتبر تقديرية لحين استكمال تكلفة تلك الأصناف.
            </div>
          )}

          <div className="max-w-2xl divide-y divide-slate-200 border border-slate-200 rounded-2xl overflow-hidden text-xs sm:text-sm">
            <div className="p-3.5 flex justify-between bg-white">
              <span className="font-semibold text-slate-700">إجمالي إيرادات المبيعات (قبل الخصم):</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {formatCurrency(financeMetrics.grossSalesSubtotal)}
              </span>
            </div>
            <div className="p-3.5 flex justify-between bg-white">
              <span className="font-semibold text-slate-600">− خصومات المبيعات الممنوحة:</span>
              <span className="font-bold text-rose-600 tabular-nums">
                -{formatCurrency(financeMetrics.salesDiscounts)}
              </span>
            </div>
            <div className="p-3.5 flex justify-between bg-white">
              <span className="font-semibold text-slate-600">− مرتجعات المبيعات المعتمدة:</span>
              <span className="font-bold text-rose-600 tabular-nums">
                -{formatCurrency(financeMetrics.salesReturnsAmount)}
              </span>
            </div>
            <div className="p-3.5 flex justify-between bg-slate-50 font-extrabold">
              <span className="text-slate-900">= صافي المبيعات (Net Sales):</span>
              <span className="text-blue-700 tabular-nums">
                {formatCurrency(financeMetrics.netSales)}
              </span>
            </div>
            <div className="p-3.5 flex justify-between bg-white">
              <span className="font-semibold text-slate-600">
                − صافي تكلفة البضاعة المباعة (COGS بالتكلفة التاريخية):
              </span>
              <span className="font-bold text-rose-600 tabular-nums">
                -{formatCurrency(financeMetrics.netCogs)}
              </span>
            </div>
            <div className="p-3.5 flex justify-between bg-emerald-50/70 font-extrabold">
              <span className="text-emerald-950">= مجمل الربح (Gross Profit):</span>
              <span className="text-emerald-700 tabular-nums">
                {formatCurrency(financeMetrics.grossProfit)}
              </span>
            </div>
            <div className="p-3.5 flex justify-between bg-white">
              <span className="font-semibold text-slate-600">
                − إجمالي المصروفات التشغيلية المسجلة:
              </span>
              <span className="font-bold text-rose-600 tabular-nums">
                -{formatCurrency(financeMetrics.operatingExpensesTotal)}
              </span>
            </div>
            <div className="p-4 flex justify-between bg-slate-900 text-white font-extrabold text-base">
              <span>= صافي الربح التشغيلي (Operating Profit):</span>
              <span className="tabular-nums">{formatCurrency(financeMetrics.operatingProfit)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Add Operating Expense Modal */}
      {expenseModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">تسجيل مصروف تشغيلي جديد</h3>
              <button
                onClick={() => setExpenseModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExpenseSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  تصنيف المصروف *
                </label>
                <select
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs sm:text-sm bg-white"
                >
                  <option value="إيجار المحل">إيجار المحل</option>
                  <option value="فاتورة كهرباء ومياه">فاتورة كهرباء ومياه</option>
                  <option value="نقل ومشال بضاعة">نقل ومشال بضاعة</option>
                  <option value="أكياس ومستلزمات تعبئة">أكياس ومستلزمات تعبئة</option>
                  <option value="يوميات وعمالة">يوميات وعمالة</option>
                  <option value="مصروفات نثرية وتشغيلية">مصروفات نثرية وتشغيلية</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    المبلغ (ج.م) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">التاريخ</label>
                  <input
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">طريقة الدفع</label>
                <select
                  value={expMethod}
                  onChange={(e) => setExpMethod(e.target.value as PaymentMethod)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs bg-white"
                >
                  <option value="cash">نقدي (من الخزنة)</option>
                  <option value="card">بطاقة بنكية</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  البيان / الوصف
                </label>
                <input
                  type="text"
                  value={expDesc}
                  onChange={(e) => setExpDesc(e.target.value)}
                  placeholder="تفاصيل المصروف..."
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  رقم الإيصال المرفق / اسم المرفق (اختياري)
                </label>
                <input
                  type="text"
                  value={expAttachment}
                  onChange={(e) => setExpAttachment(e.target.value)}
                  placeholder="مثال: إيصال كهرباء شهر مايو #412"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setExpenseModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={expSubmitting}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                >
                  {expSubmitting ? 'جارٍ الحفظ...' : 'حفظ المصروف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

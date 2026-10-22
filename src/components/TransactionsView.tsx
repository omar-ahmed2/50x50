import React, { useMemo, useState } from 'react';
import { Eye, Filter, History, Search, X } from 'lucide-react';
import { StoreBootstrapData } from '../types/store';
import {
  formatCurrency,
  formatDateAr,
  formatDateTimeAr,
  getPaymentMethodLabel,
  getTodayIso,
} from '../utils/format';

interface TransactionsViewProps {
  data: StoreBootstrapData;
  initialSaleId?: number;
}

export interface UnifiedTransactionRecord {
  uid: string;
  reference: string;
  date: string;
  createdAt: string;
  typeKey:
    | 'cash_sale'
    | 'credit_sale'
    | 'collection'
    | 'purchase'
    | 'expense'
    | 'sales_return'
    | 'stocktake'
    | 'liquid_filling'
    | 'opening';
  typeLabel: string;
  partyOrProduct: string;
  productIds: number[];
  customerId: number | null;
  quantityDisplay: string;
  amount: number;
  paymentMethod: string;
  statusLabel: string;
  financialEffect: string;
  details: Array<{ label: string; value: string }>;
}

export const TransactionsView: React.FC<TransactionsViewProps> = ({ data }) => {
  const [fromDate, setFromDate] = useState('2020-01-01');
  const [toDate, setToDate] = useState(getTodayIso());
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [customerFilter, setCustomerFilter] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedTx, setSelectedTx] = useState<UnifiedTransactionRecord | null>(null);

  const allTransactions = useMemo<UnifiedTransactionRecord[]>(() => {
    const records: UnifiedTransactionRecord[] = [];

    // 1. Sales (Cash, Credit, Partial)
    for (const s of data.sales) {
      const items = data.saleItems.filter((si) => si.sale_id === s.id);
      const totalUnits = items.reduce((a, b) => a + Number(b.selling_unit_qty), 0);
      const prodNames = items.map((i) => i.product_name_snapshot).join('، ');

      records.push({
        uid: `sale-${s.id}`,
        reference: s.invoice_number,
        date: s.sale_date,
        createdAt: s.created_at,
        typeKey: s.sale_type === 'cash' ? 'cash_sale' : 'credit_sale',
        typeLabel:
          s.sale_type === 'cash'
            ? 'بيع نقدي'
            : s.sale_type === 'partial'
            ? 'بيع دفع جزئي'
            : 'بيع شكك',
        partyOrProduct: prodNames || s.customer_name || 'فاتورة مبيعات',
        productIds: items.map((i) => i.product_id),
        customerId: s.customer_id,
        quantityDisplay: `${totalUnits} وحدة`,
        amount: Number(s.total_amount),
        paymentMethod: s.payment_method,
        statusLabel:
          s.status === 'confirmed'
            ? 'مؤكدة'
            : s.status === 'partially_returned'
            ? 'مرتجع جزئي'
            : 'مرتجع كلي',
        financialEffect:
          s.sale_type === 'cash'
            ? `تحصيل ${formatCurrency(s.amount_paid)} (${getPaymentMethodLabel(s.payment_method)})`
            : `مدفوع: ${formatCurrency(s.amount_paid)} · متبقي شكك: ${formatCurrency(
                s.remaining_amount
              )}`,
        details: [
          { label: 'رقم الفاتورة', value: s.invoice_number },
          { label: 'العميل', value: s.customer_name || 'عميل نقدي' },
          { label: 'الأصناف المباعة', value: prodNames || '—' },
          { label: 'الإجمالي الفرعي', value: formatCurrency(s.subtotal) },
          { label: 'الخصم', value: formatCurrency(s.discount) },
          { label: 'صافي الفاتورة', value: formatCurrency(s.total_amount) },
          { label: 'تكلفة البضاعة المباعة (COGS)', value: formatCurrency(s.total_cogs) },
          { label: 'المبلغ المدفوع', value: formatCurrency(s.amount_paid) },
          { label: 'المبلغ المتبقي (شكك)', value: formatCurrency(s.remaining_amount) },
        ],
      });
    }

    // 2. Customer Debt Collections
    for (const p of data.payments) {
      if (p.payment_type !== 'debt_collection') continue;
      records.push({
        uid: `pay-${p.id}`,
        reference: p.reference_number,
        date: p.payment_date,
        createdAt: p.created_at,
        typeKey: 'collection',
        typeLabel: 'تحصيل شكك',
        partyOrProduct: p.customer_name || 'عميل',
        productIds: [],
        customerId: p.customer_id,
        quantityDisplay: '—',
        amount: Number(p.amount),
        paymentMethod: p.payment_method,
        statusLabel: 'مؤكدة',
        financialEffect: `زيادة النقدية وخفض مديونية العميل بمقدار ${formatCurrency(p.amount)}`,
        details: [
          { label: 'رقم إيصال التحصيل', value: p.reference_number },
          { label: 'العميل', value: p.customer_name || '—' },
          { label: 'المبلغ المحصل', value: formatCurrency(p.amount) },
          { label: 'طريقة الدفع', value: getPaymentMethodLabel(p.payment_method) },
          { label: 'مديونية العميل قبل التحصيل', value: formatCurrency(p.balance_before) },
          { label: 'مديونية العميل بعد التحصيل', value: formatCurrency(p.balance_after) },
          { label: 'ملاحظات', value: p.notes || '—' },
        ],
      });
    }

    // 3. Purchases / Stock Intake
    for (const pur of data.purchases) {
      const pItems = data.purchaseItems.filter((pi) => pi.purchase_id === pur.id);
      const firstItem = pItems[0];
      records.push({
        uid: `pur-${pur.id}`,
        reference: pur.reference_number,
        date: pur.purchase_date,
        createdAt: pur.created_at,
        typeKey: 'purchase',
        typeLabel: 'شراء وتوريد',
        partyOrProduct: firstItem?.product_name_snapshot || pur.supplier_name || 'توريد مخزون',
        productIds: pItems.map((i) => i.product_id),
        customerId: null,
        quantityDisplay: firstItem
          ? `${firstItem.purchased_qty} ${firstItem.purchase_unit_label}`
          : '—',
        amount: Number(pur.total_cost),
        paymentMethod: pur.payment_method,
        statusLabel: pur.payment_status === 'paid' ? 'مدفوع' : 'آجل غير مدفوع',
        financialEffect:
          pur.payment_status === 'paid'
            ? `صرف ${formatCurrency(pur.total_cost)} من الخزنة وزيادة المخزون`
            : `زيادة المخزون بقيمة ${formatCurrency(pur.total_cost)} (التزام آجل لم يُصرف بعد)`,
        details: [
          { label: 'رقم مرجع الشراء', value: pur.reference_number },
          { label: 'المنتج المورد', value: firstItem?.product_name_snapshot || '—' },
          {
            label: 'الكمية المشتراة',
            value: firstItem
              ? `${firstItem.purchased_qty} ${firstItem.purchase_unit_label} (${firstItem.base_unit_qty} وحدة أساس)`
              : '—',
          },
          { label: 'إجمالي تكلفة الشراء', value: formatCurrency(pur.total_cost) },
          {
            label: 'متوسط التكلفة قبل الشراء',
            value: firstItem ? formatCurrency(firstItem.prev_avg_cost_per_base) : '—',
          },
          {
            label: 'متوسط التكلفة المرجح الجديد',
            value: firstItem ? formatCurrency(firstItem.new_avg_cost_per_base) : '—',
          },
          { label: 'المورد', value: pur.supplier_name || '—' },
        ],
      });
    }

    // 4. Sales Returns
    for (const sr of data.salesReturns) {
      const rItems = data.salesReturnItems.filter((ri) => ri.return_id === sr.id);
      records.push({
        uid: `ret-${sr.id}`,
        reference: sr.return_number,
        date: sr.return_date,
        createdAt: sr.created_at,
        typeKey: 'sales_return',
        typeLabel: 'مرتجع مبيعات',
        partyOrProduct:
          rItems.map((i) => i.product_name_snapshot).join('، ') ||
          `مرتجع فاتورة ${sr.invoice_number}`,
        productIds: rItems.map((i) => i.product_id),
        customerId: sr.customer_id,
        quantityDisplay: `${rItems.reduce((a, b) => a + Number(b.returned_selling_qty), 0)} وحدة`,
        amount: Number(sr.total_return_amount),
        paymentMethod: sr.payment_method,
        statusLabel: sr.condition_type === 'resellable' ? 'سليم (أعيد للمخزون)' : 'تالف (فاقد)',
        financialEffect: `رد نقدية: ${formatCurrency(
          sr.refund_cash_amount
        )} · خفض شكك: ${formatCurrency(sr.credit_balance_reduction)}`,
        details: [
          { label: 'رقم المرتجع', value: sr.return_number },
          { label: 'الفاتورة الأصلية', value: sr.invoice_number || '—' },
          { label: 'قيمة المرتجع الإجمالية', value: formatCurrency(sr.total_return_amount) },
          { label: 'المبلغ النقدي المسترد للعميل', value: formatCurrency(sr.refund_cash_amount) },
          {
            label: 'المبلغ المخصوم من مديونية العميل',
            value: formatCurrency(sr.credit_balance_reduction),
          },
          {
            label: 'حالة البضاعة المرتجعة',
            value: sr.condition_type === 'resellable' ? 'سليمة أعيدت للمخزون' : 'تالفة سُجلت كخسارة',
          },
          { label: 'السبب', value: sr.reason },
        ],
      });
    }

    // 5. Operating Expenses
    for (const ex of data.expenses) {
      records.push({
        uid: `exp-${ex.id}`,
        reference: ex.reference_number,
        date: ex.expense_date,
        createdAt: ex.created_at,
        typeKey: 'expense',
        typeLabel: 'مصروف تشغيلي',
        partyOrProduct: `${ex.category}${ex.description ? ` — ${ex.description}` : ''}`,
        productIds: [],
        customerId: null,
        quantityDisplay: '—',
        amount: Number(ex.amount),
        paymentMethod: ex.payment_method,
        statusLabel: 'مسدد',
        financialEffect: `صرف ${formatCurrency(ex.amount)} من الخزنة وخفض صافي الربح التشغيلي`,
        details: [
          { label: 'رقم المرجع', value: ex.reference_number },
          { label: 'بند المصروف', value: ex.category },
          { label: 'المبلغ', value: formatCurrency(ex.amount) },
          { label: 'طريقة السداد', value: getPaymentMethodLabel(ex.payment_method) },
          { label: 'البيان', value: ex.description || '—' },
        ],
      });
    }

    // 6. Stocktakes
    for (const st of data.stocktakes) {
      records.push({
        uid: `stkt-${st.id}`,
        reference: st.reference_number,
        date: st.stocktake_date,
        createdAt: st.created_at,
        typeKey: 'stocktake',
        typeLabel: 'تسوية جرد',
        partyOrProduct: st.scope_type === 'full' ? 'جرد كلي للمخزون' : 'جرد جزئي للمخزون',
        productIds: [],
        customerId: null,
        quantityDisplay: `${st.total_items_counted} صنف`,
        amount: Math.abs(Number(st.total_discrepancy_value)),
        paymentMethod: 'cash',
        statusLabel: 'معتمد',
        financialEffect: `صافي أثر فروق الجرد على تقييم المخزون: ${formatCurrency(
          st.total_discrepancy_value
        )}`,
        details: [
          { label: 'رقم محضر الجرد', value: st.reference_number },
          { label: 'نطاق الجرد', value: st.scope_type === 'full' ? 'جرد كلي' : 'جرد جزئي' },
          { label: 'عدد الأصناف التي تم جردها', value: `${st.total_items_counted} صنف` },
          { label: 'عدد الأصناف ذات الفروقات', value: `${st.discrepancy_items_count} صنف` },
          {
            label: 'الأثر المالي للفروقات',
            value: formatCurrency(st.total_discrepancy_value),
          },
          { label: 'ملاحظات', value: st.notes || '—' },
        ],
      });
    }

    // 7. Internal Liquid Filling Transfers
    for (const it of data.inventoryTransfers) {
      records.push({
        uid: `fill-${it.id}`,
        reference: it.reference_number,
        date: it.transfer_date,
        createdAt: it.created_at,
        typeKey: 'liquid_filling',
        typeLabel: 'تعبئة سائل',
        partyOrProduct: `تعبئة ${it.packaged_product_name} من ${it.bulk_product_name}`,
        productIds: [it.bulk_product_id, it.packaged_product_id],
        customerId: null,
        quantityDisplay: `${it.containers_filled} عبوة (${it.bulk_ml_used} مل)`,
        amount: Number(it.transferred_cost),
        paymentMethod: 'cash',
        statusLabel: 'تحويل داخلي',
        financialEffect: `تحويل مخزني داخلي بتكلفة ${formatCurrency(
          it.transferred_cost
        )} (لا يُعد بيعاً أو ربحاً)`,
        details: [
          { label: 'رقم المرجع', value: it.reference_number },
          { label: 'السائل السائب المصدر', value: it.bulk_product_name || '—' },
          { label: 'العبوة الجاهزة المعبأة', value: it.packaged_product_name || '—' },
          { label: 'الكمية المسحوبة بالملليلتر', value: `${it.bulk_ml_used} مل` },
          { label: 'عدد العبوات المعبأة', value: `${it.containers_filled} عبوة` },
          { label: 'التكلفة المنقولة للعبوات', value: formatCurrency(it.transferred_cost) },
        ],
      });
    }

    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data]);

  const filteredTransactions = useMemo(() => {
    return allTransactions.filter((tx) => {
      const d = tx.date.slice(0, 10);
      if (d < fromDate || d > toDate) return false;
      if (typeFilter !== 'all' && tx.typeKey !== typeFilter) return false;
      if (productFilter !== 'all' && !tx.productIds.includes(Number(productFilter))) return false;
      if (customerFilter !== 'all' && String(tx.customerId) !== customerFilter) return false;
      if (methodFilter !== 'all' && tx.paymentMethod !== methodFilter) return false;

      const q = searchQuery.trim().toLowerCase();
      if (q) {
        return (
          tx.reference.toLowerCase().includes(q) ||
          tx.partyOrProduct.toLowerCase().includes(q) ||
          tx.typeLabel.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allTransactions, fromDate, toDate, typeFilter, productFilter, customerFilter, methodFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">
            سجل العمليات الموحد — المبيعات والمخزون والخزنة
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            جميع العمليات الموثقة بأرقام مرجعية فريدة. السجلات المؤكدة محمية من الحذف الصامت.
          </p>
        </div>
        <div className="text-xs font-bold text-slate-600">
          إجمالي العمليات المعروضة: <span className="font-extrabold text-blue-600 tabular-nums">{filteredTransactions.length}</span>
        </div>
      </div>

      {/* Filters Panel matching reference mockup */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">من تاريخ</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">نوع العملية</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold"
            >
              <option value="all">الكل</option>
              <option value="cash_sale">بيع نقدي</option>
              <option value="credit_sale">بيع شكك / دفع جزئي</option>
              <option value="collection">تحصيل شكك</option>
              <option value="purchase">شراء وتوريد مخزون</option>
              <option value="sales_return">مرتجع مبيعات</option>
              <option value="expense">مصروف تشغيلي</option>
              <option value="stocktake">تسوية جرد</option>
              <option value="liquid_filling">تعبئة سائل داخلي</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">المنتج</label>
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold"
            >
              <option value="all">كل المنتجات</option>
              {data.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">العميل</label>
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold"
            >
              <option value="all">كل العملاء</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث برقم الفاتورة أو المرجع أو اسم الصنف أو العميل..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-2 text-xs"
            />
          </div>

          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700"
          >
            <option value="all">كل طرق الدفع</option>
            <option value="cash">نقدي</option>
            <option value="card">بطاقة</option>
            <option value="bank_transfer">تحويل بنكي</option>
          </select>
        </div>
      </div>

      {/* Unified Operations Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden">
        {filteredTransactions.length === 0 ? (
          <div className="p-12 text-center">
            <History className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-slate-800">لا توجد عمليات مسجلة تطابق البحث</h3>
            <p className="text-xs text-slate-500 mt-1">
              ستظهر هنا جميع عمليات البيع، الشراء، التحصيل، المصروفات، المرتجعات، والجرد.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold">
                  <th className="py-3.5 px-4">التاريخ</th>
                  <th className="py-3.5 px-3">رقم المرجع</th>
                  <th className="py-3.5 px-3">النوع</th>
                  <th className="py-3.5 px-3">المنتج / العميل / البيان</th>
                  <th className="py-3.5 px-3">الكمية</th>
                  <th className="py-3.5 px-3">المبلغ</th>
                  <th className="py-3.5 px-3">الحالة</th>
                  <th className="py-3.5 px-4 text-left">التفاصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTransactions.map((tx) => (
                  <tr key={tx.uid} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-4 tabular-nums text-slate-600">
                      {formatDateAr(tx.date)}
                    </td>
                    <td className="py-3.5 px-3 font-mono font-bold text-slate-900">
                      {tx.reference}
                    </td>
                    <td className="py-3.5 px-3">
                      <span
                        className={`font-extrabold ${
                          tx.typeKey === 'cash_sale' || tx.typeKey === 'credit_sale'
                            ? 'text-blue-700'
                            : tx.typeKey === 'purchase'
                            ? 'text-emerald-700'
                            : tx.typeKey === 'collection'
                            ? 'text-amber-700'
                            : tx.typeKey === 'sales_return' || tx.typeKey === 'expense'
                            ? 'text-rose-600'
                            : 'text-slate-700'
                        }`}
                      >
                        {tx.typeLabel}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 font-bold text-slate-800">{tx.partyOrProduct}</td>
                    <td className="py-3.5 px-3 tabular-nums text-slate-600">
                      {tx.quantityDisplay}
                    </td>
                    <td className="py-3.5 px-3 font-extrabold text-slate-900 tabular-nums">
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="py-3.5 px-3 text-slate-600 font-semibold">
                      {tx.statusLabel}
                    </td>
                    <td className="py-3.5 px-4 text-left">
                      <button
                        onClick={() => setSelectedTx(tx)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>عرض</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transaction Details Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  تفاصيل العملية: {selectedTx.typeLabel}
                </h3>
                <p className="text-xs text-slate-500 font-mono">{selectedTx.reference}</p>
              </div>
              <button
                onClick={() => setSelectedTx(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 text-blue-950">
                <div className="font-extrabold mb-0.5">الأثر المالي والمخزني:</div>
                <div>{selectedTx.financialEffect}</div>
              </div>

              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {selectedTx.details.map((row, i) => (
                  <div
                    key={i}
                    className="px-3.5 py-2.5 flex items-center justify-between bg-white"
                  >
                    <span className="text-slate-500 font-semibold">{row.label}:</span>
                    <span className="font-bold text-slate-900 tabular-nums">{row.value}</span>
                  </div>
                ))}
                <div className="px-3.5 py-2.5 flex items-center justify-between bg-slate-50">
                  <span className="text-slate-500 font-semibold">توقيت التسجيل:</span>
                  <span className="font-bold text-slate-700 tabular-nums">
                    {formatDateTimeAr(selectedTx.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

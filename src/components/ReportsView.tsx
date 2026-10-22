import React, { useMemo, useState } from 'react';
import { BarChart3, Download, Printer } from 'lucide-react';
import { calculateFinancialSummary, roundMoney } from '../domain/calculations';
import { StoreBootstrapData } from '../types/store';
import {
  exportToCsv,
  formatCurrency,
  formatDateAr,
  formatNumber,
  getBaseUnitLabel,
  getFormattedProductStock,
  getPaymentMethodLabel,
  getProductStockStatus,
  getProductTypeLabel,
  getSaleTypeLabel,
  getTodayIso,
} from '../utils/format';

interface ReportsViewProps {
  data: StoreBootstrapData;
}

type ReportKey =
  | 'daily_sales'
  | 'sales_by_range'
  | 'sales_by_product'
  | 'sales_by_category'
  | 'gross_profit'
  | 'operating_profit'
  | 'current_stock'
  | 'low_stock'
  | 'inventory_valuation'
  | 'customer_debts'
  | 'customer_statement'
  | 'customer_collections'
  | 'purchases_report'
  | 'expenses_report'
  | 'cash_movement'
  | 'stocktake_discrepancy';

const REPORT_LIST: Array<{ key: ReportKey; title: string; group: string }> = [
  { key: 'daily_sales', title: '1. تقرير المبيعات اليومية', group: 'المبيعات والأرباح' },
  { key: 'sales_by_range', title: '2. تقرير المبيعات حسب الفترة', group: 'المبيعات والأرباح' },
  { key: 'sales_by_product', title: '3. تقرير المبيعات حسب المنتج', group: 'المبيعات والأرباح' },
  { key: 'sales_by_category', title: '4. تقرير المبيعات حسب التصنيف', group: 'المبيعات والأرباح' },
  { key: 'gross_profit', title: '5. تقرير مجمل الربح بالتكلفة التاريخية', group: 'المبيعات والأرباح' },
  { key: 'operating_profit', title: '6. تقرير صافي الربح التشغيلي', group: 'المبيعات والأرباح' },
  { key: 'current_stock', title: '7. تقرير المخزون الحالي', group: 'المخزون والجرد' },
  { key: 'low_stock', title: '8. تقرير نواقص المخزون', group: 'المخزون والجرد' },
  { key: 'inventory_valuation', title: '9. تقرير تقييم المخزون المالي', group: 'المخزون والجرد' },
  { key: 'stocktake_discrepancy', title: '16. تقرير فروقات الجرد والتسويات', group: 'المخزون والجرد' },
  { key: 'customer_debts', title: '10. تقرير ديون العملاء (الشكك)', group: 'العملاء والمالية' },
  { key: 'customer_statement', title: '11. كشف حساب عميل', group: 'العملاء والمالية' },
  { key: 'customer_collections', title: '12. تقرير تحصيلات العملاء', group: 'العملاء والمالية' },
  { key: 'purchases_report', title: '13. تقرير المشتريات والتوريد', group: 'العملاء والمالية' },
  { key: 'expenses_report', title: '14. تقرير المصروفات التشغيلية', group: 'العملاء والمالية' },
  { key: 'cash_movement', title: '15. تقرير حركة الخزنة النقدية', group: 'العملاء والمالية' },
];

export const ReportsView: React.FC<ReportsViewProps> = ({ data }) => {
  const todayIso = getTodayIso();
  const [activeReport, setActiveReport] = useState<ReportKey>('daily_sales');
  const [fromDate, setFromDate] = useState(todayIso);
  const [toDate, setToDate] = useState(todayIso);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    data.customers[0]?.id ? String(data.customers[0].id) : ''
  );

  const inRange = (dStr: string | null | undefined) => {
    if (!dStr) return false;
    const d = dStr.slice(0, 10);
    if (activeReport === 'daily_sales') {
      return d === toDate;
    }
    return d >= fromDate && d <= toDate;
  };

  // Build tabular headers, rows, and summary cards dynamically for all 16 reports
  const reportContent = useMemo(() => {
    const activeReportMeta = REPORT_LIST.find((r) => r.key === activeReport)!;

    // 1 & 2: Daily Sales / Sales by Range
    if (activeReport === 'daily_sales' || activeReport === 'sales_by_range') {
      const salesList = data.sales.filter((s) => inRange(s.sale_date));
      const totalNet = roundMoney(salesList.reduce((a, b) => a + Number(b.total_amount), 0));
      const totalPaid = roundMoney(salesList.reduce((a, b) => a + Number(b.amount_paid), 0));
      const totalRem = roundMoney(salesList.reduce((a, b) => a + Number(b.remaining_amount), 0));

      return {
        title: activeReportMeta.title,
        summaryCards: [
          { label: 'عدد الفواتير', value: `${salesList.length} فاتورة` },
          { label: 'إجمالي المبيعات', value: formatCurrency(totalNet) },
          { label: 'المحصل نقداً/بنكياً', value: formatCurrency(totalPaid) },
          { label: 'الآجل (شكك)', value: formatCurrency(totalRem) },
        ],
        headers: [
          'رقم الفاتورة',
          'التاريخ',
          'العميل',
          'نوع البيع',
          'الإجمالي الفرعي',
          'الخصم',
          'الصافي',
          'المدفوع',
          'المتبقي',
        ],
        rows: salesList.map((s) => [
          s.invoice_number,
          formatDateAr(s.sale_date),
          s.customer_name || 'عميل نقدي',
          getSaleTypeLabel(s.sale_type),
          formatCurrency(s.subtotal),
          formatCurrency(s.discount),
          formatCurrency(s.total_amount),
          formatCurrency(s.amount_paid),
          formatCurrency(s.remaining_amount),
        ]),
      };
    }

    // 3: Sales by Product
    if (activeReport === 'sales_by_product') {
      const validSaleIds = new Set(
        data.sales.filter((s) => inRange(s.sale_date)).map((s) => s.id)
      );
      const map = new Map<
        number,
        { name: string; sku: string; baseQty: number; revenue: number; cogs: number }
      >();

      for (const si of data.saleItems) {
        if (!validSaleIds.has(si.sale_id)) continue;
        const cur = map.get(si.product_id) || {
          name: si.product_name_snapshot,
          sku: si.sku_snapshot,
          baseQty: 0,
          revenue: 0,
          cogs: 0,
        };
        cur.baseQty += Number(si.base_unit_qty) - Number(si.returned_base_qty);
        cur.revenue = roundMoney(cur.revenue + Number(si.line_total));
        cur.cogs = roundMoney(cur.cogs + Number(si.total_line_cost));
        map.set(si.product_id, cur);
      }

      const list = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
      const totalRev = roundMoney(list.reduce((a, b) => a + b.revenue, 0));

      return {
        title: activeReportMeta.title,
        summaryCards: [
          { label: 'عدد الأصناف المباعة', value: `${list.length} صنف` },
          { label: 'إجمالي إيراد الأصناف', value: formatCurrency(totalRev) },
        ],
        headers: [
          'اسم المنتج',
          'صافي الكمية المباعة (وحدة أساس)',
          'إجمالي المبيعات',
          'التكلفة التاريخية (COGS)',
          'مجمل ربح الصنف',
        ],
        rows: list.map((item) => [
          item.name,
          formatNumber(item.baseQty),
          formatCurrency(item.revenue),
          formatCurrency(item.cogs),
          formatCurrency(item.revenue - item.cogs),
        ]),
      };
    }

    // 4: Sales by Category
    if (activeReport === 'sales_by_category') {
      const validSaleIds = new Set(
        data.sales.filter((s) => inRange(s.sale_date)).map((s) => s.id)
      );
      const prodCatMap = new Map<number, string>();
      for (const p of data.products) {
        prodCatMap.set(p.id, p.category_name || 'بدون تصنيف');
      }

      const catAgg = new Map<string, { revenue: number; cogs: number; itemsCount: number }>();
      for (const si of data.saleItems) {
        if (!validSaleIds.has(si.sale_id)) continue;
        const cat = prodCatMap.get(si.product_id) || 'بدون تصنيف';
        const cur = catAgg.get(cat) || { revenue: 0, cogs: 0, itemsCount: 0 };
        cur.revenue = roundMoney(cur.revenue + Number(si.line_total));
        cur.cogs = roundMoney(cur.cogs + Number(si.total_line_cost));
        cur.itemsCount += 1;
        catAgg.set(cat, cur);
      }

      const rowsData = Array.from(catAgg.entries()).sort((a, b) => b[1].revenue - a[1].revenue);
      return {
        title: activeReportMeta.title,
        summaryCards: [
          { label: 'عدد التصنيفات النشطة', value: `${rowsData.length}` },
        ],
        headers: ['التصنيف', 'عدد البنود المباعة', 'إجمالي المبيعات', 'التكلفة', 'مجمل الربح'],
        rows: rowsData.map(([cat, v]) => [
          cat,
          v.itemsCount,
          formatCurrency(v.revenue),
          formatCurrency(v.cogs),
          formatCurrency(v.revenue - v.cogs),
        ]),
      };
    }

    // 5 & 6: Gross Profit & Operating Profit
    if (activeReport === 'gross_profit' || activeReport === 'operating_profit') {
      const periodSales = data.sales.filter((s) => inRange(s.sale_date));
      const periodReturns = data.salesReturns.filter((r) => inRange(r.return_date));
      const periodExpenses = data.expenses.filter((e) => inRange(e.expense_date));

      const fin = calculateFinancialSummary({
        grossSalesRevenue: periodSales.reduce((a, b) => a + Number(b.subtotal), 0),
        salesDiscounts: periodSales.reduce((a, b) => a + Number(b.discount), 0),
        salesReturnsAmount: periodReturns.reduce((a, b) => a + Number(b.total_return_amount), 0),
        grossCogs: periodSales.reduce((a, b) => a + Number(b.total_cogs), 0),
        returnedResellableCogs: periodReturns.reduce(
          (a, b) => a + Number(b.resellable_cogs_reversed),
          0
        ),
        operatingExpenses: periodExpenses.reduce((a, b) => a + Number(b.amount), 0),
        openingCashBalance: 0,
        cashReceipts: 0,
        cashPayments: 0,
      });

      return {
        title: activeReportMeta.title,
        summaryCards: [
          { label: 'صافي المبيعات', value: formatCurrency(fin.netSales) },
          { label: 'صافي تكلفة البضاعة المباعة', value: formatCurrency(fin.netCogs) },
          { label: 'مجمل الربح', value: formatCurrency(fin.grossProfit) },
          { label: 'صافي الربح التشغيلي', value: formatCurrency(fin.operatingProfit) },
        ],
        headers: [
          'رقم الفاتورة',
          'التاريخ',
          'صافي الفاتورة',
          'تكلفة البضاعة المباعة (COGS)',
          'مجمل ربح الفاتورة',
        ],
        rows: periodSales.map((s) => [
          s.invoice_number,
          formatDateAr(s.sale_date),
          formatCurrency(s.total_amount),
          formatCurrency(s.total_cogs),
          formatCurrency(Number(s.total_amount) - Number(s.total_cogs)),
        ]),
      };
    }

    // 7, 8, 9: Current Stock, Low Stock, Inventory Valuation
    if (
      activeReport === 'current_stock' ||
      activeReport === 'low_stock' ||
      activeReport === 'inventory_valuation'
    ) {
      const productsList = data.products.filter((p) => {
        if (p.is_archived) return false;
        if (activeReport === 'low_stock') {
          return getProductStockStatus(p).status !== 'available';
        }
        return true;
      });

      const totalVal = roundMoney(
        productsList.reduce(
          (acc, p) => acc + Number(p.stock_base_qty) * Number(p.avg_cost_per_base),
          0
        )
      );

      return {
        title: activeReportMeta.title,
        summaryCards: [
          { label: 'عدد الأصناف', value: `${productsList.length} صنف` },
          { label: 'إجمالي القيمة التقييمية للمخزون', value: formatCurrency(totalVal) },
        ],
        headers: [
          'اسم المنتج',
          'التصنيف',
          'نوع المنتج',
          'الكمية المتاحة',
          'متوسط تكلفة الوحدة الأساسية',
          'إجمالي القيمة بالمخزن',
          'الحالة',
        ],
        rows: productsList.map((p) => [
          p.name,
          p.category_name || 'عام',
          getProductTypeLabel(p.product_type),
          getFormattedProductStock(p).primaryText,
          formatCurrency(
            p.product_type === 'bulk_liquid'
              ? Number(p.avg_cost_per_base) * 1000
              : Number(p.avg_cost_per_base)
          ),
          formatCurrency(Number(p.stock_base_qty) * Number(p.avg_cost_per_base)),
          getProductStockStatus(p).label,
        ]),
      };
    }

    // 10: Customer Debts Report
    if (activeReport === 'customer_debts') {
      const totalDebt = roundMoney(
        data.customers.reduce((a, b) => a + Number(b.current_balance), 0)
      );
      return {
        title: activeReportMeta.title,
        summaryCards: [
          { label: 'إجمالي العملاء', value: `${data.customers.length} عميل` },
          { label: 'إجمالي الديون القائمة', value: formatCurrency(totalDebt) },
        ],
        headers: [
          'اسم العميل',
          'رقم الهاتف',
          'إجمالي المشتريات الآجلة',
          'إجمالي المسدد',
          'المرتجعات',
          'الرصيد المستحق الحالي',
          'الحالة',
        ],
        rows: data.customers.map((c) => [
          c.name,
          c.phone || '—',
          formatCurrency(c.total_credit_purchases),
          formatCurrency(c.total_payments),
          formatCurrency(c.total_returns),
          formatCurrency(c.current_balance),
          Number(c.current_balance) > 0 ? 'مدين' : 'مسدد',
        ]),
      };
    }

    // 11: Customer Account Statement
    if (activeReport === 'customer_statement') {
      const cust = data.customers.find((c) => String(c.id) === selectedCustomerId);
      const custSales = data.sales.filter(
        (s) => String(s.customer_id) === selectedCustomerId && inRange(s.sale_date)
      );
      const custPayments = data.payments.filter(
        (p) => String(p.customer_id) === selectedCustomerId && inRange(p.payment_date)
      );

      const combinedRows: (string | number)[][] = [
        ...custSales.map((s) => [
          formatDateAr(s.sale_date),
          s.invoice_number,
          'فاتورة مبيعات آجلة',
          formatCurrency(s.total_amount),
          formatCurrency(s.amount_paid),
          formatCurrency(s.remaining_amount),
        ]),
        ...custPayments
          .filter((p) => p.payment_type === 'debt_collection')
          .map((p) => [
            formatDateAr(p.payment_date),
            p.reference_number,
            'تحصيل دفعة شكك',
            '—',
            formatCurrency(p.amount),
            formatCurrency(p.balance_after),
          ]),
      ];

      return {
        title: `${activeReportMeta.title} — ${cust?.name || 'اختر عميلاً'}`,
        summaryCards: [
          { label: 'العميل', value: cust?.name || '—' },
          {
            label: 'الرصيد المستحق الحالي',
            value: formatCurrency(cust?.current_balance || 0),
          },
        ],
        headers: [
          'التاريخ',
          'رقم المرجع',
          'نوع العملية',
          'قيمة الفاتورة',
          'المسدد',
          'المتبقي بعد العملية',
        ],
        rows: combinedRows,
      };
    }

    // 12: Customer Collections Report
    if (activeReport === 'customer_collections') {
      const cols = data.payments.filter(
        (p) => p.payment_type === 'debt_collection' && inRange(p.payment_date)
      );
      const totalCol = roundMoney(cols.reduce((a, b) => a + Number(b.amount), 0));

      return {
        title: activeReportMeta.title,
        summaryCards: [
          { label: 'عدد عمليات التحصيل', value: `${cols.length}` },
          { label: 'إجمالي المبالغ المحصلة', value: formatCurrency(totalCol) },
        ],
        headers: [
          'رقم الإيصال',
          'التاريخ',
          'اسم العميل',
          'المبلغ المحصل',
          'طريقة الدفع',
          'المديونية قبل السداد',
          'المديونية بعد السداد',
        ],
        rows: cols.map((p) => [
          p.reference_number,
          formatDateAr(p.payment_date),
          p.customer_name || '—',
          formatCurrency(p.amount),
          getPaymentMethodLabel(p.payment_method),
          formatCurrency(p.balance_before),
          formatCurrency(p.balance_after),
        ]),
      };
    }

    // 13: Purchases Report
    if (activeReport === 'purchases_report') {
      const purs = data.purchases.filter((p) => inRange(p.purchase_date));
      const totalCost = roundMoney(purs.reduce((a, b) => a + Number(b.total_cost), 0));

      return {
        title: activeReportMeta.title,
        summaryCards: [
          { label: 'عدد فواتير الشراء', value: `${purs.length}` },
          { label: 'إجمالي تكلفة المشتريات', value: formatCurrency(totalCost) },
        ],
        headers: [
          'رقم المرجع',
          'التاريخ',
          'المنتج',
          'الكمية المشتراة',
          'إجمالي التكلفة',
          'حالة السداد',
          'المورد',
        ],
        rows: purs.map((pur) => {
          const item = data.purchaseItems.find((pi) => pi.purchase_id === pur.id);
          return [
            pur.reference_number,
            formatDateAr(pur.purchase_date),
            item?.product_name_snapshot || '—',
            item ? `${item.purchased_qty} ${item.purchase_unit_label}` : '—',
            formatCurrency(pur.total_cost),
            pur.payment_status === 'paid' ? 'مدفوع' : 'آجل غير مدفوع',
            pur.supplier_name || '—',
          ];
        }),
      };
    }

    // 14: Operating Expenses Report
    if (activeReport === 'expenses_report') {
      const exps = data.expenses.filter((e) => inRange(e.expense_date));
      const totalExp = roundMoney(exps.reduce((a, b) => a + Number(b.amount), 0));

      return {
        title: activeReportMeta.title,
        summaryCards: [
          { label: 'عدد البنود', value: `${exps.length}` },
          { label: 'إجمالي المصروفات التشغيلية', value: formatCurrency(totalExp) },
        ],
        headers: ['رقم المرجع', 'التاريخ', 'التصنيف', 'المبلغ', 'طريقة الدفع', 'البيان'],
        rows: exps.map((e) => [
          e.reference_number,
          formatDateAr(e.expense_date),
          e.category,
          formatCurrency(e.amount),
          getPaymentMethodLabel(e.payment_method),
          e.description || '—',
        ]),
      };
    }

    // 15: Cash Movement Report
    if (activeReport === 'cash_movement') {
      const cms = data.cashMovements.filter((cm) => inRange(cm.movement_date));
      const totalIn = roundMoney(
        cms.filter((c) => c.direction === 'in').reduce((a, b) => a + Number(b.amount), 0)
      );
      const totalOut = roundMoney(
        cms.filter((c) => c.direction === 'out').reduce((a, b) => a + Number(b.amount), 0)
      );

      return {
        title: activeReportMeta.title,
        summaryCards: [
          { label: 'إجمالي الوارد للفترة', value: formatCurrency(totalIn) },
          { label: 'إجمالي الصادر للفترة', value: formatCurrency(totalOut) },
          { label: 'صافي حركة الفترة', value: formatCurrency(totalIn - totalOut) },
        ],
        headers: ['رقم المرجع', 'التاريخ', 'الاتجاه', 'طريقة الدفع', 'المبلغ', 'الوصف'],
        rows: cms.map((cm) => [
          cm.reference_number,
          formatDateAr(cm.movement_date),
          cm.direction === 'in' ? 'وارد (مقبوضات)' : 'صادر (مدفوعات)',
          getPaymentMethodLabel(cm.payment_method),
          formatCurrency(cm.amount),
          cm.description,
        ]),
      };
    }

    // 16: Stocktake Discrepancy Report
    const stIds = new Set(
      data.stocktakes.filter((s) => inRange(s.stocktake_date)).map((s) => s.id)
    );
    const items = data.stocktakeItems.filter((si) => stIds.has(si.stocktake_id));

    return {
      title: activeReportMeta.title,
      summaryCards: [
        { label: 'عدد بنود الجرد', value: `${items.length}` },
        {
          label: 'بنود بها فروقات',
          value: `${items.filter((i) => Number(i.difference_base_qty) !== 0).length}`,
        },
      ],
      headers: [
        'المنتج',
        'الرصيد الدفتري',
        'الرصيد الفعلي',
        'الفرق',
        'الأثر المالي',
        'السبب الموثق',
      ],
      rows: items.map((si) => [
        si.product_name_snapshot,
        si.system_base_qty,
        si.physical_base_qty,
        si.difference_base_qty,
        formatCurrency(si.financial_impact),
        si.discrepancy_reason,
      ]),
    };
  }, [activeReport, data, fromDate, toDate, selectedCustomerId]);

  return (
    <div className="space-y-6">
      {/* Header & Export/Print Controls */}
      <div className="no-print bg-white rounded-2xl border border-slate-200/90 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">
            التقارير التفصيلية والتصدير (16 تقريراً قياسياً)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            جميع التقارير تُحسب مباشرة من السجلات الفعلية المعتمدة مع دعم التصدير إلى Excel (CSV) والطباعة.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() =>
              exportToCsv(
                `fifi_50x50_${activeReport}_${toDate}`,
                reportContent.headers,
                reportContent.rows
              )
            }
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تصدير CSV (Excel)</span>
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة التقرير</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right Sidebar: 16 Reports Selector */}
        <div className="no-print lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 p-3 space-y-1 max-h-[75vh] overflow-y-auto">
          {REPORT_LIST.map((r) => (
            <button
              key={r.key}
              onClick={() => setActiveReport(r.key)}
              className={`w-full text-right px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                activeReport === r.key
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {r.title}
            </button>
          ))}
        </div>

        {/* Left Main Report Area */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/90 p-6 space-y-5">
          {/* Report Header & Filters */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <div className="text-xs font-bold text-blue-600">
                {data.settings?.store_name || 'فيفي 50×50'}
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-slate-900 mt-0.5">
                {reportContent.title}
              </h3>
            </div>

            <div className="no-print flex flex-wrap items-center gap-2 text-xs">
              {activeReport === 'customer_statement' && (
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 font-bold"
                >
                  <option value="">اختر العميل...</option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}

              {activeReport === 'daily_sales' ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 font-bold">اليوم:</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 font-bold"
                  />
                </div>
              ) : (
                <>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 font-bold"
                  />
                  <span className="text-slate-400">إلى</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 font-bold"
                  />
                </>
              )}
            </div>
          </div>

          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {reportContent.summaryCards.map((card, i) => (
              <div
                key={i}
                className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80"
              >
                <div className="text-[11px] font-bold text-slate-500">{card.label}</div>
                <div className="text-sm sm:text-base font-extrabold text-slate-900 mt-1 tabular-nums">
                  {card.value}
                </div>
              </div>
            ))}
          </div>

          {/* Report Data Table */}
          {reportContent.rows.length === 0 ? (
            <div className="py-12 text-center">
              <BarChart3 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-400">
                لا توجد سجلات مطابقة لهذا التقرير في الفترة المحددة.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold">
                    {reportContent.headers.map((h, i) => (
                      <th key={i} className="py-3 px-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportContent.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50/70">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="py-2.5 px-3 font-medium text-slate-800 tabular-nums">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

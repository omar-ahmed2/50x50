import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Calendar,
  Coins,
  PackagePlus,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { calculateFinancialSummary, roundMoney } from '../domain/calculations';
import { NavSection, StoreBootstrapData } from '../types/store';
import {
  formatCurrency,
  formatDateAr,
  formatNumber,
  getBaseUnitLabel,
  getFormattedProductStock,
  getProductStockStatus,
  getTodayIso,
} from '../utils/format';

interface DashboardViewProps {
  data: StoreBootstrapData;
  onNavigate: (
    section: NavSection,
    contextId?: number,
    action?: 'view' | 'purchase'
  ) => void;
  onRefresh: () => Promise<void>;
}

type DatePreset = 'today' | '7days' | 'month' | 'all';

export const DashboardView: React.FC<DashboardViewProps> = ({
  data,
  onNavigate,
}) => {
  const todayIso = getTodayIso();
  const [datePreset, setDatePreset] = useState<DatePreset>('today');

  const dateRange = useMemo(() => {
    const now = new Date();
    if (datePreset === 'today') {
      return { from: todayIso, to: todayIso, label: 'اليوم' };
    }
    if (datePreset === '7days') {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return {
        from: d.toISOString().slice(0, 10),
        to: todayIso,
        label: 'آخر 7 أيام',
      };
    }
    if (datePreset === 'month') {
      const firstOfMonth = `${todayIso.slice(0, 7)}-01`;
      return { from: firstOfMonth, to: todayIso, label: 'هذا الشهر' };
    }
    return { from: '2000-01-01', to: '2099-12-31', label: 'كل الفترات' };
  }, [datePreset, todayIso]);

  const inRange = (dateStr: string | null | undefined) => {
    if (!dateStr) return false;
    const d = dateStr.slice(0, 10);
    return d >= dateRange.from && d <= dateRange.to;
  };

  // Compute core metrics from database records
  const metrics = useMemo(() => {
    const filteredSales = data.sales.filter((s) => inRange(s.sale_date));
    const filteredReturns = data.salesReturns.filter((r) => inRange(r.return_date));
    const filteredExpenses = data.expenses.filter((e) => inRange(e.expense_date));
    const filteredCashInPeriod = data.cashMovements.filter((cm) => inRange(cm.movement_date));

    const grossSalesSubtotal = filteredSales.reduce((acc, s) => acc + Number(s.subtotal), 0);
    const salesDiscounts = filteredSales.reduce((acc, s) => acc + Number(s.discount), 0);
    const salesReturnsAmount = filteredReturns.reduce(
      (acc, r) => acc + Number(r.total_return_amount),
      0
    );
    const grossCogs = filteredSales.reduce((acc, s) => acc + Number(s.total_cogs), 0);
    const returnedResellableCogs = filteredReturns.reduce(
      (acc, r) => acc + Number(r.resellable_cogs_reversed),
      0
    );
    const operatingExpenses = filteredExpenses.reduce((acc, e) => acc + Number(e.amount), 0);

    const actualCollectionsInPeriod = roundMoney(
      filteredCashInPeriod
        .filter(
          (cm) =>
            cm.direction === 'in' &&
            (cm.movement_type === 'cash_sale' ||
              cm.movement_type === 'partial_sale_payment' ||
              cm.movement_type === 'debt_collection')
        )
        .reduce((acc, cm) => acc + Number(cm.amount), 0)
    );

    const finSummary = calculateFinancialSummary({
      grossSalesRevenue: grossSalesSubtotal,
      salesDiscounts,
      salesReturnsAmount,
      grossCogs,
      returnedResellableCogs,
      operatingExpenses,
      openingCashBalance: 0,
      cashReceipts: 0,
      cashPayments: 0,
    });

    return {
      ...finSummary,
      actualCollectionsInPeriod,
    };
  }, [data, dateRange]);

  // Last 7 days sales data for the Analysis Wave Chart
  const last7DaysWave = useMemo(() => {
    const days: Array<{ date: string; dayLabel: string; total: number }> = [];
    const arabicDays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const daySales = data.sales
        .filter((s) => s.sale_date === iso)
        .reduce((acc, s) => acc + Number(s.total_amount), 0);
      const dayReturns = data.salesReturns
        .filter((r) => r.return_date === iso)
        .reduce((acc, r) => acc + Number(r.total_return_amount), 0);

      days.push({
        date: iso,
        dayLabel: arabicDays[d.getDay()],
        total: Math.max(0, roundMoney(daySales - dayReturns)),
      });
    }
    return days;
  }, [data.sales, data.salesReturns]);

  // Smooth SVG Bezier Wave Path Builder
  const waveChartGeometry = useMemo(() => {
    const width = 860;
    const height = 240;
    const padX = 52;
    const padTop = 36;
    const padBottom = 40;
    const usableW = width - padX * 2;
    const usableH = height - padTop - padBottom;

    const maxVal = Math.max(...last7DaysWave.map((d) => d.total), 100);

    const points = last7DaysWave.map((d, idx) => {
      const x = padX + (idx / Math.max(1, last7DaysWave.length - 1)) * usableW;
      const y = padTop + usableH - (d.total / maxVal) * usableH;
      return { x, y, ...d };
    });

    if (points.length === 0) {
      return { width, height, points: [], linePath: '', areaPath: '' };
    }

    let linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const ctrlX1 = curr.x + (next.x - curr.x) / 2;
      const ctrlY1 = curr.y;
      const ctrlX2 = curr.x + (next.x - curr.x) / 2;
      const ctrlY2 = next.y;
      linePath += ` C ${ctrlX1} ${ctrlY1}, ${ctrlX2} ${ctrlY2}, ${next.x} ${next.y}`;
    }

    const baseLineY = padTop + usableH;
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${baseLineY} L ${points[0].x} ${baseLineY} Z`;

    return { width, height, points, linePath, areaPath };
  }, [last7DaysWave]);

  // Products at or below reorder level
  const reorderProducts = useMemo(() => {
    return data.products
      .filter(
        (p) => !p.is_archived && Number(p.stock_base_qty) <= Number(p.min_stock_threshold_base)
      )
      .sort((a, b) => Number(a.stock_base_qty) - Number(b.stock_base_qty));
  }, [data.products]);

  return (
    <div className="space-y-6">
      {/* Simple Date Filter Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 bg-white px-3.5 py-2 rounded-xl border border-slate-200/90">
          <Calendar className="w-4 h-4 text-blue-600" />
          <span className="text-xs font-bold text-slate-600">
            {dateRange.label} : {formatDateAr(todayIso)}
          </span>
        </div>

        <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200/90">
          {(
            [
              { id: 'today', label: 'اليوم' },
              { id: '7days', label: 'آخر 7 أيام' },
              { id: 'month', label: 'هذا الشهر' },
              { id: 'all', label: 'الكل' },
            ] as Array<{ id: DatePreset; label: string }>
          ).map((preset) => (
            <button
              key={preset.id}
              onClick={() => setDatePreset(preset.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                datePreset === preset.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. KPI NUMBER CARDS ONLY */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-emerald-50/80 rounded-2xl border border-emerald-200/90 p-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-emerald-800">مبيعات اليوم</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-2 tabular-nums">
              {formatCurrency(metrics.netSales)}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-700 flex items-center justify-center shrink-0">
            <ShoppingCart className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-blue-50/80 rounded-2xl border border-blue-200/90 p-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-blue-800">التحصيلات اليوم</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-2 tabular-nums">
              {formatCurrency(metrics.actualCollectionsInPeriod)}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-500/15 text-blue-700 flex items-center justify-between shrink-0">
            <Coins className="w-5 h-5 mx-auto" />
          </div>
        </div>

        <div className="bg-purple-50/80 rounded-2xl border border-purple-200/90 p-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-purple-900">تكلفة البضاعة المباعة</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-2 tabular-nums">
              {formatCurrency(metrics.netCogs)}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-purple-500/15 text-purple-700 flex items-center justify-center shrink-0">
            <Boxes className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-amber-50/80 rounded-2xl border border-amber-200/90 p-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-amber-900">الربح الإجمالي</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-2 tabular-nums">
              {formatCurrency(metrics.grossProfit)}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-500/15 text-amber-700 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 2. ANALYSIS WAVE CHART */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-extrabold text-slate-900">
            المبيعات خلال آخر 7 أيام
          </h3>
          <span className="text-xs font-bold text-blue-600 tabular-nums">
            {formatCurrency(last7DaysWave.reduce((acc, d) => acc + d.total, 0))}
          </span>
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${waveChartGeometry.width} ${waveChartGeometry.height}`}
            className="w-full h-60 overflow-visible"
          >
            <defs>
              <linearGradient id="salesWaveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563EB" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#2563EB" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
              const y = 36 + ratio * (waveChartGeometry.height - 76);
              return (
                <line
                  key={idx}
                  x1={52}
                  y1={y}
                  x2={waveChartGeometry.width - 52}
                  y2={y}
                  stroke="#F1F5F9"
                  strokeWidth="1.5"
                />
              );
            })}

            {waveChartGeometry.areaPath && (
              <path d={waveChartGeometry.areaPath} fill="url(#salesWaveFill)" />
            )}

            {waveChartGeometry.linePath && (
              <path
                d={waveChartGeometry.linePath}
                fill="none"
                stroke="#2563EB"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
            )}

            {waveChartGeometry.points.map((pt) => (
              <g key={pt.date}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r="5.5"
                  fill="#FFFFFF"
                  stroke="#2563EB"
                  strokeWidth="3"
                />
                <text
                  x={pt.x}
                  y={pt.y - 12}
                  textAnchor="middle"
                  className="fill-slate-700 text-[11px] font-bold"
                >
                  {pt.total > 0 ? pt.total.toLocaleString('en-US') : '0'}
                </text>
                <text
                  x={pt.x}
                  y={waveChartGeometry.height - 12}
                  textAnchor="middle"
                  className="fill-slate-500 text-[12px] font-bold"
                >
                  {pt.dayLabel}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>

      {/* 3. REORDER-LEVEL / LOW-STOCK PRODUCTS LIST WITH QUICK PURCHASE BUTTON */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                نواقص المخزون — منتجات وصلت لمستوى إعادة الطلب ({reorderProducts.length})
              </h3>
            </div>
          </div>

          <button
            onClick={() => onNavigate('inventory')}
            className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
          >
            فتح المخزون
          </button>
        </div>

        {reorderProducts.length === 0 ? (
          <div className="p-5 rounded-xl bg-slate-50 border border-slate-200/70 text-center text-xs font-bold text-slate-500">
            لا توجد منتجات ناقصة أو وصلت لحد إعادة الطلب حالياً.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold">
                  <th className="py-3 px-4">اسم المنتج</th>
                  <th className="py-3 px-3">الكمية المتبقية</th>
                  <th className="py-3 px-3">حد إعادة الطلب</th>
                  <th className="py-3 px-3">الحالة</th>
                  <th className="py-3 px-4 text-left">شراء سريع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reorderProducts.map((p) => {
                  const stockDisp = getFormattedProductStock(p);
                  const st = getProductStockStatus(p);
                  const thresholdDisp =
                    p.product_type === 'bulk_liquid'
                      ? `${formatNumber(Number(p.min_stock_threshold_base) / 1000)} لتر`
                      : `${formatNumber(p.min_stock_threshold_base)} ${getBaseUnitLabel(p)}`;

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-extrabold text-slate-900">{p.name}</td>
                      <td className="py-3 px-3 font-extrabold text-rose-600 tabular-nums">
                        {stockDisp.primaryText}
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-600 tabular-nums">
                        {thresholdDisp}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`font-bold ${
                            st.status === 'out' ? 'text-rose-600' : 'text-amber-600'
                          }`}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left">
                        <button
                          onClick={() => onNavigate('inventory', p.id, 'purchase')}
                          className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold inline-flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <PackagePlus className="w-3.5 h-3.5" />
                          <span>إضافة مشتريات لهذا المنتج</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

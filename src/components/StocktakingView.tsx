import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Printer,
  RotateCcw,
  X,
} from 'lucide-react';
import { roundMoney, roundQty } from '../domain/calculations';
import { api, generateIdempotencyKey } from '../services/api';
import { StoreBootstrapData } from '../types/store';
import {
  formatCurrency,
  formatDateTimeAr,
  formatNumber,
  getBaseUnitLabel,
  getTodayIso,
} from '../utils/format';

interface StocktakingViewProps {
  data: StoreBootstrapData;
  onRefresh: () => Promise<void>;
}

export const StocktakingView: React.FC<StocktakingViewProps> = ({ data, onRefresh }) => {
  const activeProducts = useMemo(
    () => data.products.filter((p) => !p.is_archived),
    [data.products]
  );

  const [physicalCounts, setPhysicalCounts] = useState<Record<number, string>>({});
  const [discrepancyReasons, setDiscrepancyReasons] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Printable Stocktake Report Modal
  const [viewingStocktakeId, setViewingStocktakeId] = useState<number | null>(null);

  const resetCountsToSystem = () => {
    const initialCounts: Record<number, string> = {};
    for (const p of activeProducts) {
      initialCounts[p.id] = String(p.stock_base_qty);
    }
    setPhysicalCounts(initialCounts);
    setDiscrepancyReasons({});
    setFeedback(null);
  };

  const countedItemsPreview = useMemo(() => {
    return activeProducts.map((product) => {
      const systemQty = roundQty(Number(product.stock_base_qty));
      const rawPhys = physicalCounts[product.id];
      const physicalQty =
        rawPhys !== undefined && rawPhys !== '' ? roundQty(Number(rawPhys)) : systemQty;
      const diffQty = roundQty(physicalQty - systemQty);
      const unitCost = Number(product.avg_cost_per_base);
      const financialImpact = roundMoney(diffQty * unitCost);
      const reason = discrepancyReasons[product.id] || 'تسوية جرد فعلي';

      return {
        product,
        systemQty,
        physicalQty,
        diffQty,
        unitCost,
        financialImpact,
        reason,
      };
    });
  }, [activeProducts, physicalCounts, discrepancyReasons]);

  const totalFinancialImpact = useMemo(
    () =>
      roundMoney(
        countedItemsPreview.reduce((acc, item) => acc + item.financialImpact, 0)
      ),
    [countedItemsPreview]
  );

  const handleApproveStocktake = async () => {
    setFeedback(null);
    if (countedItemsPreview.length === 0) {
      setFeedback({ type: 'error', message: 'لا توجد منتجات مسجلة لإجراء الجرد' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createStocktake({
        idempotency_key: generateIdempotencyKey('stkt'),
        scope_type: 'full',
        notes: 'جرد مباشر مبسط',
        stocktake_date: getTodayIso(),
        items: countedItemsPreview.map((item) => ({
          product_id: item.product.id,
          physical_base_qty: item.physicalQty,
          discrepancy_reason: item.reason,
        })),
      });

      await onRefresh();
      setViewingStocktakeId(res.id);
      setFeedback({
        type: 'success',
        message: `تم اعتماد الجرد رقم ${res.reference_number} وتحديث أرصدة المخزون فوراً بنجاح`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const viewingStocktake = useMemo(
    () => data.stocktakes.find((s) => s.id === viewingStocktakeId) || null,
    [data.stocktakes, viewingStocktakeId]
  );

  const viewingStocktakeItems = useMemo(
    () => data.stocktakeItems.filter((si) => si.stocktake_id === viewingStocktakeId),
    [data.stocktakeItems, viewingStocktakeId]
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

      {/* Single-Step Direct Stocktaking Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">
              الجرد السريع (في خطوة واحدة)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              عدّل الكمية الفعلية الموجودة أمامك على الرف لأي منتج، ثم اضغط اعتماد الجرد لتحديث المخزن فوراً.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={resetCountsToSystem}
              className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>إعادة ضبط الأرقام</span>
            </button>
            <button
              type="button"
              disabled={submitting || activeProducts.length === 0}
              onClick={handleApproveStocktake}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-extrabold shadow-xs cursor-pointer"
            >
              {submitting ? 'جارٍ الاعتماد...' : 'اعتماد الجرد وتحديث المخزون'}
            </button>
          </div>
        </div>

        {activeProducts.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">
            لا توجد منتجات مسجلة في المخزون حالياً لإجراء الجرد.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold">
                    <th className="py-3 px-4">المنتج</th>
                    <th className="py-3 px-3">الكمية المسجلة بالنظام</th>
                    <th className="py-3 px-3">الكمية الفعلية على الرف</th>
                    <th className="py-3 px-3">الفرق</th>
                    <th className="py-3 px-4">ملاحظة / سبب الفرق (اختياري)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {countedItemsPreview.map((item) => (
                    <tr key={item.product.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-extrabold text-slate-900">
                        {item.product.name}
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-700 tabular-nums">
                        {formatNumber(item.systemQty)} {getBaseUnitLabel(item.product)}
                      </td>
                      <td className="py-3 px-3">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={
                            physicalCounts[item.product.id] !== undefined
                              ? physicalCounts[item.product.id]
                              : String(item.systemQty)
                          }
                          onChange={(e) =>
                            setPhysicalCounts((prev) => ({
                              ...prev,
                              [item.product.id]: e.target.value,
                            }))
                          }
                          className="w-32 bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-extrabold tabular-nums focus:border-blue-600 focus:outline-none"
                        />
                      </td>
                      <td className="py-3 px-3 tabular-nums">
                        <span
                          className={`font-extrabold px-2.5 py-1 rounded-lg ${
                            item.diffQty === 0
                              ? 'bg-emerald-50 text-emerald-700'
                              : item.diffQty > 0
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-rose-50 text-rose-600'
                          }`}
                        >
                          {item.diffQty > 0 ? `+${item.diffQty}` : item.diffQty}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {item.diffQty === 0 ? (
                          <span className="text-slate-400">مطابق</span>
                        ) : (
                          <input
                            type="text"
                            value={discrepancyReasons[item.product.id] || ''}
                            onChange={(e) =>
                              setDiscrepancyReasons((prev) => ({
                                ...prev,
                                [item.product.id]: e.target.value,
                              }))
                            }
                            placeholder="سبب الفرق (اختياري)..."
                            className="w-full max-w-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:border-blue-600 focus:outline-none"
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div>
                <span className="text-slate-500">الأصناف التي بها تعديل: </span>
                <span className="font-extrabold text-slate-900 tabular-nums">
                  {countedItemsPreview.filter((i) => i.diffQty !== 0).length} من{' '}
                  {countedItemsPreview.length}
                </span>
              </div>
              <div>
                <span className="text-slate-500">صافي قيمة الفروقات: </span>
                <span
                  className={`font-extrabold tabular-nums ${
                    totalFinancialImpact >= 0 ? 'text-emerald-700' : 'text-rose-600'
                  }`}
                >
                  {formatCurrency(totalFinancialImpact)}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Previous Stocktakes History */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5">
        <h3 className="text-base font-extrabold text-slate-900 mb-3">
          سجل محاضر الجرد السابقة
        </h3>

        {data.stocktakes.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            لم يتم تسجيل محاضر جرد سابقة بعد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                  <th className="py-3 px-3">رقم المحضر</th>
                  <th className="py-3 px-3">التاريخ</th>
                  <th className="py-3 px-3">عدد الأصناف</th>
                  <th className="py-3 px-3">أصناف بها فروق</th>
                  <th className="py-3 px-3">صافي الأثر المالي</th>
                  <th className="py-3 px-3 text-left">التقرير</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.stocktakes.map((st) => (
                  <tr key={st.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900">
                      {st.reference_number}
                    </td>
                    <td className="py-3 px-3 tabular-nums">{formatDateTimeAr(st.created_at)}</td>
                    <td className="py-3 px-3 tabular-nums">{st.total_items_counted}</td>
                    <td className="py-3 px-3 tabular-nums font-bold text-amber-600">
                      {st.discrepancy_items_count}
                    </td>
                    <td
                      className={`py-3 px-3 font-extrabold tabular-nums ${
                        Number(st.total_discrepancy_value) >= 0
                          ? 'text-emerald-700'
                          : 'text-rose-600'
                      }`}
                    >
                      {formatCurrency(st.total_discrepancy_value)}
                    </td>
                    <td className="py-3 px-3 text-left">
                      <button
                        onClick={() => setViewingStocktakeId(st.id)}
                        className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>عرض وطباعة</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Printable Stocktake Report Modal */}
      {viewingStocktake && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full overflow-hidden">
            <div className="no-print px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                تقرير محضر الجرد رقم {viewingStocktake.reference_number}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة التقرير</span>
                </button>
                <button
                  onClick={() => setViewingStocktakeId(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 max-h-[80vh] overflow-y-auto space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <div className="text-base font-extrabold text-slate-900">
                    {data.settings?.store_name || 'فيفي 50×50'} — محضر جرد وتسوية مخزون
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    رقم المرجع: {viewingStocktake.reference_number} · التاريخ:{' '}
                    {formatDateTimeAr(viewingStocktake.created_at)}
                  </div>
                </div>
                <div className="text-left">
                  <div className="text-slate-500">صافي الأثر المالي:</div>
                  <div className="text-sm font-extrabold tabular-nums">
                    {formatCurrency(viewingStocktake.total_discrepancy_value)}
                  </div>
                </div>
              </div>

              <table className="w-full text-right border-collapse border border-slate-200">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                    <th className="py-2 px-3">المنتج</th>
                    <th className="py-2 px-3">الرصيد الدفتري</th>
                    <th className="py-2 px-3">الرصيد الفعلي</th>
                    <th className="py-2 px-3">الفرق</th>
                    <th className="py-2 px-3">الأثر المالي</th>
                    <th className="py-2 px-3">السبب الموثق</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {viewingStocktakeItems.map((si) => (
                    <tr key={si.id}>
                      <td className="py-2 px-3 font-bold text-slate-900">
                        {si.product_name_snapshot}
                      </td>
                      <td className="py-2 px-3 tabular-nums">{si.system_base_qty}</td>
                      <td className="py-2 px-3 font-bold tabular-nums">{si.physical_base_qty}</td>
                      <td
                        className={`py-2 px-3 font-bold tabular-nums ${
                          Number(si.difference_base_qty) < 0
                            ? 'text-rose-600'
                            : Number(si.difference_base_qty) > 0
                            ? 'text-blue-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {Number(si.difference_base_qty) > 0
                          ? `+${si.difference_base_qty}`
                          : si.difference_base_qty}
                      </td>
                      <td className="py-2 px-3 tabular-nums">
                        {formatCurrency(si.financial_impact)}
                      </td>
                      <td className="py-2 px-3 text-slate-600">{si.discrepancy_reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

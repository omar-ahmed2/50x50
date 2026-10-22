import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
  X,
  FileText,
} from 'lucide-react';
import { roundMoney, roundQty, roundUnitCost, toBaseQuantity } from '../domain/calculations';
import { api, generateIdempotencyKey } from '../services/api';
import { PaymentMethod, Product, Sale, StoreBootstrapData } from '../types/store';
import {
  formatCurrency,
  formatDateTimeAr,
  formatNumber,
  getFormattedProductStock,
  getPaymentMethodLabel,
  getSaleTypeLabel,
  getTodayIso,
} from '../utils/format';

interface PosSalesViewProps {
  data: StoreBootstrapData;
  onRefresh: () => Promise<void>;
}

interface CartItem {
  cartLineId: string;
  product: Product;
  sellingUnitMode: 'unit' | 'carton' | 'liter' | 'ml' | 'container';
  quantity: number;
  unitPrice: number;
}

export const PosSalesView: React.FC<PosSalesViewProps> = ({ data, onRefresh }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');

  const [cart, setCart] = useState<CartItem[]>([]);
  const [saleType, setSaleType] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [customerId, setCustomerId] = useState<string>('');
  const [isCreatingNewCustomer, setIsCreatingNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [discountInput, setDiscountInput] = useState('0');
  const [partialPaidInput, setPartialPaidInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [saleNotes, setSaleNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Completed Invoice Receipt Modal
  const [viewingSaleId, setViewingSaleId] = useState<number | null>(null);

  // Sales Return Modal
  const [returnModalSale, setReturnModalSale] = useState<Sale | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<number, string>>({});
  const [returnCondition, setReturnCondition] = useState<'resellable' | 'damaged'>('resellable');
  const [returnReason, setReturnReason] = useState('');
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  const availableProducts = useMemo(() => {
    return data.products.filter((p) => {
      if (p.is_archived) return false;
      if (selectedCategoryId !== 'all' && String(p.category_id) !== selectedCategoryId) {
        return false;
      }
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      }
      return true;
    });
  }, [data.products, searchQuery, selectedCategoryId]);

  const getDefaultUnitAndPrice = (
    product: Product,
    modeOverride?: 'unit' | 'carton' | 'liter' | 'ml' | 'container'
  ) => {
    const mode =
      modeOverride ||
      (product.product_type === 'bulk_liquid'
        ? 'liter'
        : product.product_type === 'packaged_liquid'
        ? 'container'
        : 'unit');

    let unitPrice = Number(product.selling_price_primary);
    if (product.product_type === 'carton' && mode === 'carton') {
      unitPrice =
        Number(product.selling_price_carton) > 0
          ? Number(product.selling_price_carton)
          : roundMoney(Number(product.selling_price_primary) * Number(product.units_per_carton));
    } else if (product.product_type === 'bulk_liquid') {
      const literPrice =
        Number(product.selling_price_per_liter) || Number(product.selling_price_primary);
      unitPrice = mode === 'liter' ? roundMoney(literPrice) : roundUnitCost(literPrice / 1000);
    }

    return { mode, unitPrice };
  };

  const addToCart = (
    product: Product,
    preferredMode?: 'unit' | 'carton' | 'liter' | 'ml' | 'container',
    preferredQty = 1
  ) => {
    setFeedback(null);
    if (Number(product.stock_base_qty) <= 0) {
      setFeedback({
        type: 'error',
        message: `المنتج (${product.name}) نفذ من المخزون حالياً ولا يمكن إضافته للسلة`,
      });
      return;
    }

    const { mode, unitPrice } = getDefaultUnitAndPrice(product, preferredMode);

    setCart((prev) => {
      const existingIdx = prev.findIndex(
        (item) => item.product.id === product.id && item.sellingUnitMode === mode
      );
      if (existingIdx > -1) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: roundQty(updated[existingIdx].quantity + preferredQty),
        };
        return updated;
      }
      return [
        ...prev,
        {
          cartLineId: `${product.id}-${mode}-${Date.now()}`,
          product,
          sellingUnitMode: mode,
          quantity: preferredQty,
          unitPrice,
        },
      ];
    });
  };

  const updateCartItemMode = (
    cartLineId: string,
    newMode: 'unit' | 'carton' | 'liter' | 'ml' | 'container'
  ) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.cartLineId !== cartLineId) return item;
        const { unitPrice } = getDefaultUnitAndPrice(item.product, newMode);
        const adjustedQty =
          item.product.product_type === 'bulk_liquid'
            ? newMode === 'ml'
              ? 500
              : 1
            : 1;
        return {
          ...item,
          sellingUnitMode: newMode,
          unitPrice,
          quantity: adjustedQty,
        };
      })
    );
  };

  const updateCartItemQuantity = (cartLineId: string, newQty: number) => {
    if (newQty <= 0) {
      setCart((prev) => prev.filter((i) => i.cartLineId !== cartLineId));
      return;
    }
    setCart((prev) =>
      prev.map((item) =>
        item.cartLineId === cartLineId ? { ...item, quantity: roundQty(newQty) } : item
      )
    );
  };

  // Calculate cart totals and stock validation
  const cartSummary = useMemo(() => {
    let subtotal = 0;
    const baseUsedByProduct = new Map<number, number>();
    const stockErrors: string[] = [];

    for (const item of cart) {
      const lineTotal = roundMoney(item.quantity * item.unitPrice);
      subtotal = roundMoney(subtotal + lineTotal);

      const baseQty = toBaseQuantity({
        productType: item.product.product_type,
        quantity: item.quantity,
        unitMode: item.sellingUnitMode,
        unitsPerCarton: Number(item.product.units_per_carton) || 1,
      });

      const totalBaseForProd = roundQty(
        (baseUsedByProduct.get(item.product.id) || 0) + baseQty
      );
      baseUsedByProduct.set(item.product.id, totalBaseForProd);

      if (totalBaseForProd > Number(item.product.stock_base_qty)) {
        stockErrors.push(
          `الكمية المطلوبة من (${item.product.name}) تتجاوز الرصيد المتاح بالمخزن`
        );
      }
    }

    const discount = roundMoney(Math.max(0, Number(discountInput) || 0));
    const total = roundMoney(Math.max(0, subtotal - discount));

    let paid = total;
    if (saleType === 'credit') {
      paid = 0;
    } else if (saleType === 'partial') {
      paid = roundMoney(Math.max(0, Number(partialPaidInput) || 0));
    }

    const remaining = roundMoney(Math.max(0, total - paid));

    return {
      subtotal,
      discount,
      total,
      paid,
      remaining,
      stockErrors,
    };
  }, [cart, discountInput, saleType, partialPaidInput]);

  const handleConfirmSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (cart.length === 0) {
      setFeedback({ type: 'error', message: 'السلة فارغة، يرجى اختيار منتج واحد على الأقل' });
      return;
    }
    if (cartSummary.stockErrors.length > 0) {
      setFeedback({ type: 'error', message: cartSummary.stockErrors[0] });
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createSale({
        idempotency_key: generateIdempotencyKey('sale'),
        sale_type: saleType,
        customer_id: customerId ? Number(customerId) : null,
        new_customer_name: isCreatingNewCustomer ? newCustomerName : undefined,
        new_customer_phone: isCreatingNewCustomer ? newCustomerPhone : undefined,
        discount: cartSummary.discount,
        amount_paid: cartSummary.paid,
        payment_method: paymentMethod,
        notes: saleNotes,
        sale_date: getTodayIso(),
        items: cart.map((c) => ({
          product_id: c.product.id,
          selling_unit_mode: c.sellingUnitMode,
          quantity: c.quantity,
          unit_selling_price: c.unitPrice,
        })),
      });

      setCart([]);
      setDiscountInput('0');
      setPartialPaidInput('');
      setSaleNotes('');
      setIsCreatingNewCustomer(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
      await onRefresh();
      setViewingSaleId(res.id);
      setFeedback({
        type: 'success',
        message: `تم إصدار الفاتورة رقم ${res.invoice_number} وتحديث المخزون والحسابات بنجاح`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const viewingSale = useMemo(
    () => data.sales.find((s) => s.id === viewingSaleId) || null,
    [data.sales, viewingSaleId]
  );

  const viewingSaleItems = useMemo(
    () => data.saleItems.filter((si) => si.sale_id === viewingSaleId),
    [data.saleItems, viewingSaleId]
  );

  const openReturnModal = (sale: Sale) => {
    setReturnModalSale(sale);
    setReturnQuantities({});
    setReturnCondition('resellable');
    setReturnReason('');
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnModalSale) return;
    setFeedback(null);
    setReturnSubmitting(true);

    try {
      const itemsPayload = Object.entries(returnQuantities)
        .map(([saleItemId, qtyStr]) => ({
          sale_item_id: Number(saleItemId),
          return_selling_qty: Number(qtyStr || 0),
        }))
        .filter((x) => x.return_selling_qty > 0);

      const res = await api.createSalesReturn(returnModalSale.id, {
        idempotency_key: generateIdempotencyKey('ret'),
        items: itemsPayload,
        condition_type: returnCondition,
        payment_method: returnModalSale.payment_method,
        reason: returnReason,
        return_date: getTodayIso(),
      });

      setReturnModalSale(null);
      await onRefresh();
      setFeedback({
        type: 'success',
        message: `تم توثيق مرتجع المبيعات رقم ${res.return_number} وتحديث المخزون والحسابات بنجاح`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setReturnSubmitting(false);
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

      {/* Main Split POS Layout: Right Side Products Grid + Left Side Active Invoice Cart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Products Selection Area (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث باسم المنتج لإضافته للفاتورة..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-2.5 text-xs sm:text-sm focus:bg-white focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedCategoryId('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap ${
                  selectedCategoryId === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                كل الأصناف
              </button>
              {data.categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(String(cat.id))}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap ${
                    selectedCategoryId === String(cat.id)
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Product Cards Grid */}
          {availableProducts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/90 p-10 text-center">
              <ShoppingCart className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-800">لا توجد منتجات متاحة للعرض</h3>
              <p className="text-xs text-slate-500 mt-1">
                أضف منتجات من قسم المخزون أولاً لتتمكن من بيعها عبر نقطة البيع.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {availableProducts.map((p) => {
                const stockDisp = getFormattedProductStock(p);
                const outOfStock = Number(p.stock_base_qty) <= 0;

                return (
                  <div
                    key={p.id}
                    className={`bg-white rounded-2xl border p-4 flex flex-col justify-between transition-all ${
                      outOfStock
                        ? 'border-slate-200 opacity-60'
                        : 'border-slate-200/90 hover:border-blue-400 shadow-2xs'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-extrabold text-slate-900">{p.name}</h4>
                          <div className="text-[11px] text-slate-400">
                            {p.category_name || 'بدون تصنيف'}
                          </div>
                        </div>
                        <span className="text-sm font-extrabold text-emerald-700 tabular-nums shrink-0">
                          {formatCurrency(
                            p.product_type === 'bulk_liquid'
                              ? p.selling_price_per_liter || p.selling_price_primary
                              : p.selling_price_primary
                          )}
                          <span className="text-[10px] text-slate-400 mr-0.5">
                            /{p.container_unit_label || (p.product_type === 'bulk_liquid' ? 'لتر' : 'قطعة')}
                          </span>
                        </span>
                      </div>

                      <div className="mt-2 text-xs text-slate-600 flex items-center justify-between">
                        <span>الرصيد المتاح:</span>
                        <span
                          className={`font-bold tabular-nums ${
                            outOfStock ? 'text-rose-600' : 'text-slate-800'
                          }`}
                        >
                          {stockDisp.primaryText}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons tailored to product type */}
                    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5">
                      {p.product_type === 'carton' ? (
                        <>
                          <button
                            type="button"
                            disabled={outOfStock}
                            onClick={() => addToCart(p, 'unit', 1)}
                            className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white text-xs font-bold cursor-pointer"
                          >
                            + قطعة فردية
                          </button>
                          <button
                            type="button"
                            disabled={
                              Number(p.stock_base_qty) < Number(p.units_per_carton)
                            }
                            onClick={() => addToCart(p, 'carton', 1)}
                            className="flex-1 py-1.5 px-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold cursor-pointer"
                          >
                            + كرتونة ({p.units_per_carton} ق)
                          </button>
                        </>
                      ) : p.product_type === 'bulk_liquid' ? (
                        <>
                          <button
                            type="button"
                            disabled={Number(p.stock_base_qty) < 250}
                            onClick={() => addToCart(p, 'ml', 250)}
                            className="py-1.5 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold cursor-pointer tabular-nums"
                          >
                            +250 مل
                          </button>
                          <button
                            type="button"
                            disabled={Number(p.stock_base_qty) < 500}
                            onClick={() => addToCart(p, 'ml', 500)}
                            className="py-1.5 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold cursor-pointer tabular-nums"
                          >
                            +500 مل
                          </button>
                          <button
                            type="button"
                            disabled={Number(p.stock_base_qty) < 750}
                            onClick={() => addToCart(p, 'ml', 750)}
                            className="py-1.5 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold cursor-pointer tabular-nums"
                          >
                            +750 مل
                          </button>
                          <button
                            type="button"
                            disabled={Number(p.stock_base_qty) < 1000}
                            onClick={() => addToCart(p, 'liter', 1)}
                            className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white text-xs font-bold cursor-pointer tabular-nums"
                          >
                            +1 لتر
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={outOfStock}
                          onClick={() =>
                            addToCart(
                              p,
                              p.product_type === 'packaged_liquid' ? 'container' : 'unit',
                              1
                            )
                          }
                          className="w-full py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white text-xs font-bold cursor-pointer"
                        >
                          + إضافة للفاتورة
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Active Invoice Panel (5 cols - matching reference image) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden sticky top-20">
          <div className="p-5 border-b border-slate-200/80">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">تفاصيل الفاتورة</h3>
                <p className="text-xs text-slate-500">
                  عدد الأصناف في السلة: {cart.length}
                </p>
              </div>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
                >
                  إفراغ السلة
                </button>
              )}
            </div>

            {/* Sale Type Toggle (بيع عادي / شكك / دفع جزئي) */}
            <div className="grid grid-cols-3 gap-2 mt-4">
              <button
                type="button"
                onClick={() => setSaleType('cash')}
                className={`py-2 px-3 rounded-xl text-xs font-extrabold transition-colors cursor-pointer ${
                  saleType === 'cash'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                بيع عادي (نقدي)
              </button>
              <button
                type="button"
                onClick={() => setSaleType('credit')}
                className={`py-2 px-3 rounded-xl text-xs font-extrabold transition-colors cursor-pointer ${
                  saleType === 'credit'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                شكك (آجل بالكامل)
              </button>
              <button
                type="button"
                onClick={() => setSaleType('partial')}
                className={`py-2 px-3 rounded-xl text-xs font-extrabold transition-colors cursor-pointer ${
                  saleType === 'partial'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                دفع جزئي
              </button>
            </div>

            {/* Customer Selection (Required for credit/partial, optional for cash) */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700">
                  العميل {saleType !== 'cash' ? '(إلزامي لحساب الشكك) *' : '(اختياري)'}
                </label>
                <button
                  type="button"
                  onClick={() => setIsCreatingNewCustomer((prev) => !prev)}
                  className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{isCreatingNewCustomer ? 'اختيار عميل مسجل' : 'عميل جديد سريع'}</span>
                </button>
              </div>

              {!isCreatingNewCustomer ? (
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold bg-slate-50/70"
                >
                  <option value="">
                    {saleType === 'cash' ? 'عميل نقدي مباشر' : 'اختر العميل من القائمة...'}
                  </option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — (مديونية حالية: {formatCurrency(c.current_balance)})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="اسم العميل الجديد *"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="border border-slate-300 rounded-xl px-3 py-2 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="رقم الهاتف (اختياري)"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    className="border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Cart Items Table */}
          <div className="p-4 max-h-80 overflow-y-auto divide-y divide-slate-100">
            {cart.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">
                اختر المنتجات من القائمة الجانبية لإضافتها إلى الفاتورة الحالية.
              </div>
            ) : (
              cart.map((item) => {
                const lineTotal = roundMoney(item.quantity * item.unitPrice);
                return (
                  <div key={item.cartLineId} className="py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-extrabold text-slate-900">
                          {item.product.name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          المتاح: {getFormattedProductStock(item.product).primaryText}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs font-extrabold text-slate-900 tabular-nums">
                          {formatCurrency(lineTotal)}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCartItemQuantity(item.cartLineId, 0)}
                          className="text-slate-400 hover:text-rose-600 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      {/* Selling Unit Mode Selector */}
                      <select
                        value={item.sellingUnitMode}
                        onChange={(e) =>
                          updateCartItemMode(item.cartLineId, e.target.value as any)
                        }
                        className="border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-bold bg-slate-50"
                      >
                        {item.product.product_type === 'carton' && (
                          <>
                            <option value="unit">قطعة</option>
                            <option value="carton">
                              كرتونة ({item.product.units_per_carton} قطعة)
                            </option>
                          </>
                        )}
                        {item.product.product_type === 'individual' && (
                          <option value="unit">
                            {item.product.container_unit_label || 'قطعة'}
                          </option>
                        )}
                        {item.product.product_type === 'bulk_liquid' && (
                          <>
                            <option value="liter">لتر</option>
                            <option value="ml">ملليلتر (مل)</option>
                          </>
                        )}
                        {item.product.product_type === 'packaged_liquid' && (
                          <option value="container">
                            {item.product.container_unit_label || 'عبوة'}
                          </option>
                        )}
                      </select>

                      {/* Quantity Stepper */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateCartItemQuantity(
                              item.cartLineId,
                              item.sellingUnitMode === 'ml'
                                ? item.quantity - 250
                                : item.quantity - 1
                            )
                          }
                          className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-100"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <input
                          type="number"
                          step="any"
                          min="0.01"
                          value={item.quantity}
                          onChange={(e) =>
                            updateCartItemQuantity(
                              item.cartLineId,
                              Number(e.target.value)
                            )
                          }
                          className="w-16 text-center border border-slate-200 rounded-lg py-1 text-xs font-bold tabular-nums"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateCartItemQuantity(
                              item.cartLineId,
                              item.sellingUnitMode === 'ml'
                                ? item.quantity + 250
                                : item.quantity + 1
                            )
                          }
                          className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-100"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Totals, Payment Method & Submit */}
          <form onSubmit={handleConfirmSale} className="p-5 bg-slate-50 border-t border-slate-200 space-y-3">
            {cartSummary.stockErrors.length > 0 && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-bold text-rose-700">
                {cartSummary.stockErrors[0]}
              </div>
            )}

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-600">
                <span>الإجمالي الفرعي:</span>
                <span className="font-bold tabular-nums">{formatCurrency(cartSummary.subtotal)}</span>
              </div>

              <div className="flex items-center justify-between text-slate-600">
                <span>الخصم (ج.م):</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  className="w-24 bg-white border border-slate-300 rounded-lg px-2 py-1 text-left font-bold tabular-nums"
                />
              </div>

              <div className="flex items-center justify-between text-sm font-extrabold text-slate-900 pt-1 border-t border-slate-200">
                <span>الإجمالي النهائي المطلوب:</span>
                <span className="text-emerald-700 text-base tabular-nums">
                  {formatCurrency(cartSummary.total)}
                </span>
              </div>
            </div>

            {saleType !== 'credit' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  طريقة الدفع
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'cash', label: 'نقدي (الخزنة)' },
                      { id: 'card', label: 'بطاقة' },
                      { id: 'bank_transfer', label: 'تحويل بنكي' },
                    ] as Array<{ id: PaymentMethod; label: string }>
                  ).map((pm) => (
                    <button
                      type="button"
                      key={pm.id}
                      onClick={() => setPaymentMethod(pm.id)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold border cursor-pointer ${
                        paymentMethod === pm.id
                          ? 'bg-emerald-50 border-emerald-600 text-emerald-900'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      {pm.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {saleType === 'partial' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  المبلغ المدفوع الآن (ج.م) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={partialPaidInput}
                  onChange={(e) => setPartialPaidInput(e.target.value)}
                  placeholder="أدخل الجزء المدفوع والباقي يُسجل شكك..."
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold tabular-nums"
                />
              </div>
            )}

            <div className="p-3 rounded-xl bg-white border border-slate-200 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-500">المبلغ المدفوع: </span>
                <span className="font-extrabold text-emerald-700 tabular-nums">
                  {formatCurrency(cartSummary.paid)}
                </span>
              </div>
              <div>
                <span className="text-slate-500">المتبقي (شكك): </span>
                <span className="font-extrabold text-rose-600 tabular-nums">
                  {formatCurrency(cartSummary.remaining)}
                </span>
              </div>
            </div>

            <input
              type="text"
              value={saleNotes}
              onChange={(e) => setSaleNotes(e.target.value)}
              placeholder="ملاحظات على الفاتورة (اختياري)..."
              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs"
            />

            <button
              type="submit"
              disabled={submitting || cart.length === 0 || cartSummary.stockErrors.length > 0}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-extrabold shadow-sm transition-colors cursor-pointer"
            >
              {submitting ? 'جارٍ اعتماد الفاتورة...' : 'تأكيد وإصدار الفاتورة'}
            </button>
          </form>
        </div>
      </div>

      {/* Recent Confirmed Invoices & Returns Section */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5">
        <h3 className="text-base font-extrabold text-slate-900 mb-1">
          سجل الفواتير الصادرة وإدارة المرتجعات
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          الفواتير المؤكدة لا تُحذف أبداً؛ يمكنك طباعة الفاتورة أو تسجيل مرتجع موثق (سليم أو تالف).
        </p>

        {data.sales.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            لم يتم إصدار أي فواتير مبيعات بعد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                  <th className="py-3 px-3">رقم الفاتورة</th>
                  <th className="py-3 px-3">التاريخ والوقت</th>
                  <th className="py-3 px-3">العميل</th>
                  <th className="py-3 px-3">نوع البيع</th>
                  <th className="py-3 px-3">الإجمالي</th>
                  <th className="py-3 px-3">المدفوع</th>
                  <th className="py-3 px-3">المتبقي</th>
                  <th className="py-3 px-3">الحالة</th>
                  <th className="py-3 px-3 text-left">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.sales.slice(0, 15).map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900">
                      {s.invoice_number}
                    </td>
                    <td className="py-3 px-3 tabular-nums text-slate-600">
                      {formatDateTimeAr(s.created_at)}
                    </td>
                    <td className="py-3 px-3 font-bold text-slate-800">
                      {s.customer_name || 'عميل نقدي'}
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-700">
                      {getSaleTypeLabel(s.sale_type)}
                    </td>
                    <td className="py-3 px-3 font-extrabold text-slate-900 tabular-nums">
                      {formatCurrency(s.total_amount)}
                    </td>
                    <td className="py-3 px-3 font-bold text-emerald-700 tabular-nums">
                      {formatCurrency(s.amount_paid)}
                    </td>
                    <td className="py-3 px-3 font-bold text-rose-600 tabular-nums">
                      {formatCurrency(s.remaining_amount)}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`font-bold ${
                          s.status === 'confirmed'
                            ? 'text-emerald-700'
                            : s.status === 'partially_returned'
                            ? 'text-amber-600'
                            : 'text-rose-600'
                        }`}
                      >
                        {s.status === 'confirmed'
                          ? 'مؤكدة'
                          : s.status === 'partially_returned'
                          ? 'مرتجع جزئي'
                          : 'مرتجع بالكامل'}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setViewingSaleId(s.id)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>الإيصال</span>
                        </button>
                        {s.status !== 'returned' && (
                          <button
                            onClick={() => openReturnModal(s)}
                            className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>مرتجع</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==================== PRINTABLE RECEIPT MODAL ==================== */}
      {viewingSale && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="no-print px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-extrabold text-slate-900">
                إيصال فاتورة رقم {viewingSale.invoice_number}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة الإيصال</span>
                </button>
                <button
                  onClick={() => setViewingSaleId(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="text-center border-b border-dashed border-slate-300 pb-3">
                <div className="text-lg font-extrabold text-slate-900">
                  {data.settings?.store_name || 'فيفي 50×50'}
                </div>
                <div className="text-slate-500 mt-0.5">
                  {data.settings?.receipt_header || 'للمنظفات المنزلية والورقيات'}
                </div>
                {data.settings?.phone && (
                  <div className="text-slate-500 font-mono mt-0.5">{data.settings.phone}</div>
                )}
              </div>

              <div className="space-y-1 text-slate-700">
                <div className="flex justify-between">
                  <span>رقم الفاتورة:</span>
                  <span className="font-mono font-bold">{viewingSale.invoice_number}</span>
                </div>
                <div className="flex justify-between">
                  <span>التاريخ والوقت:</span>
                  <span className="tabular-nums">{formatDateTimeAr(viewingSale.created_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span>العميل:</span>
                  <span className="font-bold">{viewingSale.customer_name || 'عميل نقدي'}</span>
                </div>
                <div className="flex justify-between">
                  <span>نوع الفاتورة / الدفع:</span>
                  <span className="font-bold">
                    {getSaleTypeLabel(viewingSale.sale_type)} ({getPaymentMethodLabel(viewingSale.payment_method)})
                  </span>
                </div>
              </div>

              <table className="w-full text-right border-t border-b border-dashed border-slate-300 py-2">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="py-1.5">الصنف</th>
                    <th className="py-1.5">الكمية</th>
                    <th className="py-1.5">السعر</th>
                    <th className="py-1.5 text-left">الإجمالي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {viewingSaleItems.map((si) => (
                    <tr key={si.id}>
                      <td className="py-1.5 font-bold text-slate-900">
                        {si.product_name_snapshot}
                      </td>
                      <td className="py-1.5 tabular-nums">
                        {si.selling_unit_qty} {si.selling_unit_label}
                      </td>
                      <td className="py-1.5 tabular-nums">
                        {formatCurrency(si.unit_selling_price)}
                      </td>
                      <td className="py-1.5 text-left font-bold tabular-nums">
                        {formatCurrency(si.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-slate-600">
                  <span>الإجمالي الفرعي:</span>
                  <span className="tabular-nums">{formatCurrency(viewingSale.subtotal)}</span>
                </div>
                {Number(viewingSale.discount) > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>الخصم:</span>
                    <span className="tabular-nums">-{formatCurrency(viewingSale.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-1 border-t border-slate-200">
                  <span>الصافي الإجمالي:</span>
                  <span className="tabular-nums">{formatCurrency(viewingSale.total_amount)}</span>
                </div>
                <div className="flex justify-between text-emerald-700 font-bold">
                  <span>المدفوع:</span>
                  <span className="tabular-nums">{formatCurrency(viewingSale.amount_paid)}</span>
                </div>
                {Number(viewingSale.remaining_amount) > 0 && (
                  <div className="flex justify-between text-rose-600 font-bold">
                    <span>المتبقي على الحساب (شكك):</span>
                    <span className="tabular-nums">
                      {formatCurrency(viewingSale.remaining_amount)}
                    </span>
                  </div>
                )}
              </div>

              <div className="text-center text-[11px] text-slate-400 border-t border-dashed border-slate-300 pt-3">
                {data.settings?.receipt_footer || 'شكراً لتعاملكم مع محل فيفي 50×50'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== SALES RETURN MODAL ==================== */}
      {returnModalSale && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                تسجيل مرتجع مبيعات للفاتورة {returnModalSale.invoice_number}
              </h3>
              <button
                onClick={() => setReturnModalSale(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleReturnSubmit} className="p-6 space-y-4">
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-700">
                  حدد الكمية المرتجعة لكل صنف:
                </div>
                {data.saleItems
                  .filter((si) => si.sale_id === returnModalSale.id)
                  .map((si) => {
                    const ratioBasePerSelling =
                      Number(si.base_unit_qty) / Number(si.selling_unit_qty);
                    const remainingReturnableSelling = roundQty(
                      (Number(si.base_unit_qty) - Number(si.returned_base_qty)) /
                        ratioBasePerSelling
                    );

                    return (
                      <div
                        key={si.id}
                        className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-bold text-slate-900">
                            {si.product_name_snapshot}
                          </div>
                          <div className="text-slate-500">
                            المباع: {si.selling_unit_qty} {si.selling_unit_label} · القابل للاسترجاع:{' '}
                            <span className="font-bold text-slate-800 tabular-nums">
                              {remainingReturnableSelling} {si.selling_unit_label}
                            </span>
                          </div>
                        </div>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          max={remainingReturnableSelling}
                          disabled={remainingReturnableSelling <= 0}
                          value={returnQuantities[si.id] || ''}
                          onChange={(e) =>
                            setReturnQuantities((prev) => ({
                              ...prev,
                              [si.id]: e.target.value,
                            }))
                          }
                          placeholder="الكمية المرتجعة"
                          className="w-28 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold tabular-nums"
                        />
                      </div>
                    );
                  })}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  حالة البضاعة المرتجعة *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setReturnCondition('resellable')}
                    className={`p-2.5 rounded-xl border text-xs font-bold cursor-pointer ${
                      returnCondition === 'resellable'
                        ? 'bg-emerald-50 border-emerald-600 text-emerald-950'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    سليمة (تعود للمخزون المتاح)
                  </button>
                  <button
                    type="button"
                    onClick={() => setReturnCondition('damaged')}
                    className={`p-2.5 rounded-xl border text-xs font-bold cursor-pointer ${
                      returnCondition === 'damaged'
                        ? 'bg-rose-50 border-rose-600 text-rose-950'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    تالفة (تُسجل كفاقد ولا تعود للمخزون)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  سبب الإرجاع *
                </label>
                <input
                  type="text"
                  required
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="مثال: استبدال بناءً على طلب العميل / عيب عبوة..."
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setReturnModalSale(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={returnSubmitting}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                >
                  {returnSubmitting ? 'جارٍ التسجيل...' : 'تأكيد المرتجع'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

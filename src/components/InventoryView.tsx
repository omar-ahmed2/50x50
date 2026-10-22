import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Edit3,
  Eye,
  FolderPlus,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { ProductType, roundMoney } from '../domain/calculations';
import { api, generateIdempotencyKey } from '../services/api';
import { Product, SellingMethod, StoreBootstrapData } from '../types/store';
import {
  formatCurrency,
  formatDateTimeAr,
  formatNumber,
  getFormattedProductStock,
  getProductStockStatus,
  getProductTypeLabel,
  getTodayIso,
} from '../utils/format';

interface InventoryViewProps {
  data: StoreBootstrapData;
  onRefresh: () => Promise<void>;
  initialProductId?: number;
  initialAction?: 'view' | 'purchase';
  onClearInitialAction?: () => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  data,
  onRefresh,
  initialProductId,
  initialAction,
  onClearInitialAction,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const sellingMethods: SellingMethod[] = useMemo(
    () => data.sellingMethods || [],
    [data.sellingMethods]
  );

  // Modals state
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [manageListsModalOpen, setManageListsModalOpen] = useState(false);
  const [viewingProductId, setViewingProductId] = useState<number | null>(
    initialAction === 'view' && initialProductId ? initialProductId : null
  );

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Product Form State
  const [formName, setFormName] = useState('');
  const [formCategoryId, setFormCategoryId] = useState<string>('');
  const [formSellingMethodName, setFormSellingMethodName] = useState<string>('');
  const [formUnitsPerCarton, setFormUnitsPerCarton] = useState('12');
  const [formInitQty, setFormInitQty] = useState('');
  const [formPurchaseCost, setFormPurchaseCost] = useState('');
  const [formSellingPrice, setFormSellingPrice] = useState('');
  const [formMinThreshold, setFormMinThreshold] = useState('5');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Inline quick-add inside Product Modal (or Lists Modal)
  const [showInlineAddCat, setShowInlineAddCat] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCat, setAddingCat] = useState(false);

  const [showInlineAddMethod, setShowInlineAddMethod] = useState(false);
  const [newMethodName, setNewMethodName] = useState('');
  const [addingMethod, setAddingMethod] = useState(false);

  // Simple Purchase (Restock) Form State
  const [purProductId, setPurProductId] = useState<string>('');
  const [purQty, setPurQty] = useState('');
  const [purTotalCost, setPurTotalCost] = useState('');
  const [purSubmitting, setPurSubmitting] = useState(false);

  // Find selected selling method object
  const selectedSellingMethodObj = useMemo(() => {
    return sellingMethods.find((m) => m.name === formSellingMethodName) || null;
  }, [sellingMethods, formSellingMethodName]);

  const effectiveProductType: ProductType = useMemo(() => {
    if (editingProduct) return editingProduct.product_type;
    if (selectedSellingMethodObj) return selectedSellingMethodObj.product_type;
    if (
      formSellingMethodName.includes('كرتون') ||
      formSellingMethodName.includes('دست') ||
      formSellingMethodName.includes('باكيت')
    ) {
      return 'carton';
    }
    if (formSellingMethodName.includes('لتر') || formSellingMethodName.includes('سائل')) {
      return 'bulk_liquid';
    }
    return 'individual';
  }, [editingProduct, selectedSellingMethodObj, formSellingMethodName]);

  const openCreateProductModal = () => {
    setEditingProduct(null);
    setFormName('');
    setFormCategoryId(data.categories[0]?.id ? String(data.categories[0].id) : '');
    setFormSellingMethodName(sellingMethods[0]?.name || '');
    setFormUnitsPerCarton('12');
    setFormInitQty('');
    setFormPurchaseCost('');
    setFormSellingPrice('');
    setFormMinThreshold('5');
    setShowInlineAddCat(data.categories.length === 0);
    setShowInlineAddMethod(sellingMethods.length === 0);
    setNewCategoryName('');
    setNewMethodName('');
    setProductModalOpen(true);
  };

  const openEditProductModal = (prod: Product) => {
    setEditingProduct(prod);
    setFormName(prod.name);
    setFormCategoryId(prod.category_id ? String(prod.category_id) : '');
    setFormSellingMethodName(prod.container_unit_label || getProductTypeLabel(prod.product_type));
    setFormUnitsPerCarton(String(prod.units_per_carton || 12));
    if (prod.product_type === 'carton') {
      setFormPurchaseCost(
        String(roundMoney(Number(prod.avg_cost_per_base) * Number(prod.units_per_carton)))
      );
    } else if (prod.product_type === 'bulk_liquid') {
      setFormPurchaseCost(String(roundMoney(Number(prod.avg_cost_per_base) * 1000)));
    } else {
      setFormPurchaseCost(String(roundMoney(Number(prod.avg_cost_per_base))));
    }
    setFormSellingPrice(
      String(
        prod.product_type === 'bulk_liquid'
          ? prod.selling_price_per_liter || prod.selling_price_primary || ''
          : prod.selling_price_primary || ''
      )
    );
    setFormMinThreshold(
      prod.product_type === 'bulk_liquid'
        ? String(Number(prod.min_stock_threshold_base) / 1000)
        : String(prod.min_stock_threshold_base)
    );
    setShowInlineAddCat(false);
    setShowInlineAddMethod(false);
    setProductModalOpen(true);
  };

  const handleQuickAddCategory = async () => {
    const clean = newCategoryName.trim();
    if (!clean) return;
    setAddingCat(true);
    try {
      const res = await api.createCategory({ name: clean });
      await onRefresh();
      setFormCategoryId(String(res.id));
      setNewCategoryName('');
      setShowInlineAddCat(false);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setAddingCat(false);
    }
  };

  const handleQuickAddSellingMethod = async () => {
    const clean = newMethodName.trim();
    if (!clean) return;
    setAddingMethod(true);
    try {
      const res = await api.createSellingMethod({ name: clean });
      await onRefresh();
      setFormSellingMethodName(res.name);
      setNewMethodName('');
      setShowInlineAddMethod(false);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setAddingMethod(false);
    }
  };

  const openPurchaseModalForProduct = (prod?: Product) => {
    const target = prod || data.products.find((p) => !p.is_archived);
    setPurProductId(target ? String(target.id) : '');
    setPurQty('');
    setPurTotalCost('');
    setPurchaseModalOpen(true);
  };

  useEffect(() => {
    if (!initialProductId) return;
    if (initialAction === 'purchase') {
      const targetProd = data.products.find((p) => p.id === initialProductId);
      if (targetProd) {
        openPurchaseModalForProduct(targetProd);
      }
      onClearInitialAction?.();
    } else if (initialAction === 'view') {
      setViewingProductId(initialProductId);
      onClearInitialAction?.();
    }
  }, [initialProductId, initialAction, data.products]);

  const filteredProducts = useMemo(() => {
    return data.products.filter((p) => {
      if (p.is_archived) return false;
      if (selectedCategory !== 'all' && String(p.category_id) !== selectedCategory) {
        return false;
      }
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        return (
          p.name.toLowerCase().includes(q) ||
          (p.category_name && p.category_name.toLowerCase().includes(q)) ||
          (p.container_unit_label && p.container_unit_label.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [data.products, searchQuery, selectedCategory]);

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    // If user typed a new category or selling method in the inline box without clicking "إضافة", save it automatically!
    let finalCategoryId = formCategoryId ? Number(formCategoryId) : null;
    let finalSellingMethodLabel = formSellingMethodName.trim();

    setFormSubmitting(true);
    try {
      if (showInlineAddCat && newCategoryName.trim()) {
        const createdCat = await api.createCategory({ name: newCategoryName.trim() });
        finalCategoryId = createdCat.id;
      }

      if (showInlineAddMethod && newMethodName.trim()) {
        const createdMethod = await api.createSellingMethod({ name: newMethodName.trim() });
        finalSellingMethodLabel = createdMethod.name;
      }

      if (!finalSellingMethodLabel) {
        setFeedback({
          type: 'error',
          message: 'يرجى اختيار طريقة البيع أو إضافة طريقة بيع جديدة أولاً',
        });
        setFormSubmitting(false);
        return;
      }

      const prodType: ProductType = editingProduct
        ? editingProduct.product_type
        : finalSellingMethodLabel.includes('كرتون') ||
          finalSellingMethodLabel.includes('دست') ||
          finalSellingMethodLabel.includes('باكيت')
        ? 'carton'
        : finalSellingMethodLabel.includes('لتر') || finalSellingMethodLabel.includes('سائل')
        ? 'bulk_liquid'
        : 'individual';

      const unitMode =
        prodType === 'carton' ? 'carton' : prodType === 'bulk_liquid' ? 'liter' : 'unit';

      const initQtyNum = Number(formInitQty || 0);
      const buyPriceNum = Number(formPurchaseCost || 0);
      const sellPriceNum = Number(formSellingPrice || 0);

      const computedPurchaseCostInput =
        !editingProduct && prodType === 'bulk_liquid' && initQtyNum > 0
          ? buyPriceNum * initQtyNum
          : buyPriceNum;

      if (editingProduct) {
        await api.updateProduct(editingProduct.id, {
          name: formName,
          category_id: finalCategoryId,
          container_unit_label: finalSellingMethodLabel,
          units_per_carton: Number(formUnitsPerCarton || 12),
          purchase_cost_input: buyPriceNum,
          selling_price_primary: sellPriceNum,
          selling_price_per_liter: prodType === 'bulk_liquid' ? sellPriceNum : 0,
          min_stock_threshold: Number(formMinThreshold || 5),
        });
        setFeedback({ type: 'success', message: 'تم تعديل المنتج بنجاح' });
      } else {
        await api.createProduct({
          name: formName,
          category_id: finalCategoryId,
          product_type: prodType,
          container_unit_label: finalSellingMethodLabel,
          units_per_carton: Number(formUnitsPerCarton || 12),
          initial_quantity: initQtyNum,
          initial_unit_mode: unitMode,
          purchase_cost_input: computedPurchaseCostInput,
          selling_price_primary: sellPriceNum,
          selling_price_per_liter: prodType === 'bulk_liquid' ? sellPriceNum : 0,
          min_stock_threshold: Number(formMinThreshold || 5),
        });
        setFeedback({ type: 'success', message: 'تم إضافة المنتج بنجاح' });
      }
      setProductModalOpen(false);
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setFormSubmitting(false);
    }
  };

  const selectedPurchaseProduct = useMemo(
    () => data.products.find((p) => String(p.id) === purProductId) || null,
    [data.products, purProductId]
  );

  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPurchaseProduct) return;
    setFeedback(null);
    setPurSubmitting(true);
    try {
      const unitMode =
        selectedPurchaseProduct.product_type === 'carton'
          ? 'carton'
          : selectedPurchaseProduct.product_type === 'bulk_liquid'
          ? 'liter'
          : selectedPurchaseProduct.product_type === 'packaged_liquid'
          ? 'container'
          : 'unit';

      await api.recordPurchase({
        idempotency_key: generateIdempotencyKey('pur'),
        product_id: selectedPurchaseProduct.id,
        quantity_purchased: Number(purQty),
        purchase_unit_mode: unitMode,
        total_purchase_cost: Number(purTotalCost),
        purchase_date: getTodayIso(),
        payment_status: 'paid',
        payment_method: 'cash',
      });
      setPurchaseModalOpen(false);
      setFeedback({
        type: 'success',
        message: `تم إضافة الكمية الجديدة للمنتج (${selectedPurchaseProduct.name}) بنجاح`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setPurSubmitting(false);
    }
  };

  const viewingProduct = useMemo(
    () => data.products.find((p) => p.id === viewingProductId) || null,
    [data.products, viewingProductId]
  );

  const viewingProductMovements = useMemo(
    () => data.stockMovements.filter((m) => m.product_id === viewingProductId),
    [data.stockMovements, viewingProductId]
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

      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">المخزون</h2>
          <p className="text-xs text-slate-500">
            أضف تصنيفاتك وطرق البيع الخاصة بك يدوياً ثم أضف منتجاتك بكل سهولة
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setManageListsModalOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-bold flex items-center gap-2 shadow-2xs transition-colors cursor-pointer"
          >
            <FolderPlus className="w-4 h-4 text-blue-600" />
            <span>إضافة تصنيف / طريقة بيع</span>
          </button>

          <button
            onClick={openCreateProductModal}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة منتج</span>
          </button>

          {data.products.length > 0 && (
            <button
              onClick={() => openPurchaseModalForProduct()}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-bold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
            >
              <PackagePlus className="w-4 h-4" />
              <span>شراء / تزويد كمية</span>
            </button>
          )}
        </div>
      </div>

      {/* Search & Manual Categories Filter */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث عن منتج بالاسم أو التصنيف..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-2.5 text-xs sm:text-sm focus:bg-white focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              selectedCategory === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
            }`}
          >
            الكل
          </button>
          {data.categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(String(cat.id))}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                selectedCategory === String(cat.id)
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              {cat.name}
            </button>
          ))}
          <button
            onClick={() => setManageListsModalOpen(true)}
            className="px-3 py-1.5 rounded-xl text-xs font-bold border border-dashed border-slate-300 text-slate-600 hover:border-blue-500 hover:text-blue-600 cursor-pointer whitespace-nowrap flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>تصنيف جديد</span>
          </button>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden">
        {filteredProducts.length === 0 ? (
          <div className="p-12 text-center">
            <Boxes className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-800">لا توجد منتجات في المخزون بعد</h3>
            <p className="text-xs text-slate-500 mt-1">
              اضغط على «إضافة منتج» ويمكنك بداخلها إضافة التصنيف وطريقة البيع التي تريدها يدوياً.
            </p>
            <button
              onClick={openCreateProductModal}
              className="mt-4 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة أول منتج</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-xs font-extrabold text-slate-500">
                  <th className="py-3.5 px-5">اسم المنتج</th>
                  <th className="py-3.5 px-4">التصنيف</th>
                  <th className="py-3.5 px-4">طريقة البيع</th>
                  <th className="py-3.5 px-4">الكمية المتاحة</th>
                  <th className="py-3.5 px-4">سعر الشراء</th>
                  <th className="py-3.5 px-4">سعر البيع</th>
                  <th className="py-3.5 px-4">الحالة</th>
                  <th className="py-3.5 px-5 text-left">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                {filteredProducts.map((p) => {
                  const stockDisp = getFormattedProductStock(p);
                  const st = getProductStockStatus(p);
                  const buyPrice =
                    p.product_type === 'bulk_liquid'
                      ? Number(p.avg_cost_per_base) * 1000
                      : p.product_type === 'carton'
                      ? Number(p.avg_cost_per_base) * Number(p.units_per_carton || 1)
                      : Number(p.avg_cost_per_base);
                  const sellPrice =
                    p.product_type === 'bulk_liquid'
                      ? Number(p.selling_price_per_liter || p.selling_price_primary)
                      : Number(p.selling_price_primary);

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-5 font-extrabold text-slate-900">{p.name}</td>

                      <td className="py-3.5 px-4 text-slate-600 font-semibold">
                        {p.category_name || 'بدون تصنيف'}
                      </td>

                      <td className="py-3.5 px-4 text-slate-700 font-bold">
                        {p.container_unit_label || getProductTypeLabel(p.product_type)}
                      </td>

                      <td className="py-3.5 px-4 font-extrabold text-slate-900 tabular-nums">
                        {stockDisp.primaryText}
                      </td>

                      <td className="py-3.5 px-4 font-bold text-slate-600 tabular-nums">
                        {formatCurrency(buyPrice)}
                      </td>

                      <td className="py-3.5 px-4 font-extrabold text-emerald-700 tabular-nums">
                        {formatCurrency(sellPrice)}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`font-bold ${
                            st.status === 'available'
                              ? 'text-emerald-700'
                              : st.status === 'low'
                              ? 'text-amber-600'
                              : 'text-rose-600'
                          }`}
                        >
                          {st.status === 'available'
                            ? 'متوفر'
                            : st.status === 'low'
                            ? 'قارب على النفاذ'
                            : 'نفذ'}
                        </span>
                      </td>

                      <td className="py-3.5 px-5">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openPurchaseModalForProduct(p)}
                            title="تزويد كمية / شراء"
                            className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <PackagePlus className="w-3.5 h-3.5" />
                            <span>+ شراء بضاعة</span>
                          </button>
                          <button
                            onClick={() => openEditProductModal(p)}
                            title="تعديل"
                            className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setViewingProductId(p.id)}
                            title="حركات الصنف"
                            className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={async () => {
                              await api.toggleArchiveProduct(p.id, true);
                              await onRefresh();
                            }}
                            title="حذف / أرشفة"
                            className="p-1.5 rounded-lg bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
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

      {/* ==================== ADD / EDIT PRODUCT MODAL (WITH MANUAL CATEGORY & SELLING METHOD) ==================== */}
      {productModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden my-6">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                {editingProduct ? `تعديل: ${editingProduct.name}` : 'إضافة منتج جديد'}
              </h3>
              <button
                onClick={() => setProductModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleProductSubmit} className="p-6 space-y-4">
              {/* 1. Product Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اسم المنتج *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="اكتب اسم المنتج..."
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>

              {/* 2. Manual Category Selection / Addition */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">التصنيف</label>
                  <button
                    type="button"
                    onClick={() => setShowInlineAddCat((prev) => !prev)}
                    className="text-xs font-extrabold text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{showInlineAddCat ? 'اختيار من القائمة' : 'إضافة تصنيف جديد'}</span>
                  </button>
                </div>

                {showInlineAddCat || data.categories.length === 0 ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="اكتب اسم التصنيف الجديد (مثال: منظفات، ورقيات)..."
                      className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={addingCat || !newCategoryName.trim()}
                      onClick={handleQuickAddCategory}
                      className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer shrink-0"
                    >
                      {addingCat ? '...' : 'إضافة للقائمة'}
                    </button>
                  </div>
                ) : (
                  <select
                    value={formCategoryId}
                    onChange={(e) => setFormCategoryId(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold bg-white"
                  >
                    <option value="">بدون تصنيف</option>
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* 3. Manual Selling Method Selection / Addition */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">طريقة البيع *</label>
                  <button
                    type="button"
                    onClick={() => setShowInlineAddMethod((prev) => !prev)}
                    className="text-xs font-extrabold text-emerald-700 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>
                      {showInlineAddMethod ? 'اختيار من القائمة' : 'إضافة طريقة بيع جديدة'}
                    </span>
                  </button>
                </div>

                {showInlineAddMethod || sellingMethods.length === 0 ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newMethodName}
                      onChange={(e) => setNewMethodName(e.target.value)}
                      placeholder="اكتب طريقة البيع (مثال: قطعة، كيلو، لتر، كرتونة، جركن)..."
                      className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs focus:border-emerald-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={addingMethod || !newMethodName.trim()}
                      onClick={handleQuickAddSellingMethod}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer shrink-0"
                    >
                      {addingMethod ? '...' : 'إضافة للقائمة'}
                    </button>
                  </div>
                ) : (
                  <select
                    value={formSellingMethodName}
                    onChange={(e) => setFormSellingMethodName(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold bg-white"
                  >
                    <option value="">اختر طريقة البيع...</option>
                    {sellingMethods.map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {effectiveProductType === 'carton' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    عدد القطع داخل الكرتونة
                  </label>
                  <input
                    type="number"
                    min="2"
                    required
                    value={formUnitsPerCarton}
                    onChange={(e) => setFormUnitsPerCarton(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-sm tabular-nums"
                  />
                </div>
              )}

              {/* 4. Initial Quantity */}
              {!editingProduct && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الكمية الموجودة حالياً{' '}
                    {formSellingMethodName ? `(${formSellingMethodName})` : ''} *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={formInitQty}
                    onChange={(e) => setFormInitQty(e.target.value)}
                    placeholder="0"
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-bold tabular-nums"
                  />
                </div>
              )}

              {/* 5. Buy Price & Sell Price */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سعر الشراء (ج.م) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formPurchaseCost}
                    onChange={(e) => setFormPurchaseCost(e.target.value)}
                    placeholder="0"
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-bold tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سعر البيع (ج.م) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formSellingPrice}
                    onChange={(e) => setFormSellingPrice(e.target.value)}
                    placeholder="0"
                    className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-bold tabular-nums"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-extrabold cursor-pointer"
                >
                  {formSubmitting ? 'جارٍ الحفظ...' : 'حفظ المنتج'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MANAGE CATEGORIES & SELLING METHODS MODAL ==================== */}
      {manageListsModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full overflow-hidden my-6">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                إدارة التصنيفات وطرق البيع اليدوية
              </h3>
              <button
                onClick={() => setManageListsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Column 1: Categories */}
              <div className="space-y-3">
                <h4 className="text-sm font-extrabold text-slate-900">1. التصنيفات</h4>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="اسم التصنيف..."
                    className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-xs"
                  />
                  <button
                    type="button"
                    disabled={addingCat || !newCategoryName.trim()}
                    onClick={handleQuickAddCategory}
                    className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                  >
                    إضافة
                  </button>
                </div>

                {data.categories.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-xl">
                    لا توجد تصنيفات بعد. أضف تصنيفاتك يدوياً بالأعلى.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {data.categories.map((cat) => (
                      <div
                        key={cat.id}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-xs font-bold text-slate-800"
                      >
                        <span>{cat.name}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            await api.deleteCategory(cat.id);
                            await onRefresh();
                          }}
                          className="text-slate-400 hover:text-rose-600 cursor-pointer"
                          title="حذف التصنيف"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Column 2: Selling Methods */}
              <div className="space-y-3">
                <h4 className="text-sm font-extrabold text-slate-900">2. طرق البيع</h4>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newMethodName}
                    onChange={(e) => setNewMethodName(e.target.value)}
                    placeholder="مثال: بالقطعة، بالكيلو، باللتر..."
                    className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-xs"
                  />
                  <button
                    type="button"
                    disabled={addingMethod || !newMethodName.trim()}
                    onClick={handleQuickAddSellingMethod}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                  >
                    إضافة
                  </button>
                </div>

                {sellingMethods.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-xl">
                    لا توجد طرق بيع بعد. أضف طرق البيع يدوياً بالأعلى.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {sellingMethods.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-xs font-bold text-slate-800"
                      >
                        <span>{m.name}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            await api.deleteSellingMethod(m.id);
                            await onRefresh();
                          }}
                          className="text-slate-400 hover:text-rose-600 cursor-pointer"
                          title="حذف طريقة البيع"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setManageListsModalOpen(false)}
                className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer"
              >
                تم
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== ULTRA-SIMPLE 3-FIELD RESTOCK / PURCHASE MODAL ==================== */}
      {purchaseModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                شراء وتزويد كمية للمخزن
              </h3>
              <button
                onClick={() => setPurchaseModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePurchaseSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المنتج *</label>
                <select
                  required
                  value={purProductId}
                  onChange={(e) => setPurProductId(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-bold bg-white"
                >
                  <option value="">اختر المنتج...</option>
                  {data.products
                    .filter((p) => !p.is_archived)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  الكمية المشتراة{' '}
                  {selectedPurchaseProduct?.container_unit_label
                    ? `(${selectedPurchaseProduct.container_unit_label})`
                    : ''}{' '}
                  *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  required
                  value={purQty}
                  onChange={(e) => setPurQty(e.target.value)}
                  placeholder="أدخل الكمية..."
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-bold tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  إجمالي مبلغ الشراء المدفوع (ج.م) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={purTotalCost}
                  onChange={(e) => setPurTotalCost(e.target.value)}
                  placeholder="إجمالي الفاتورة بالجنيه..."
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-bold tabular-nums"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPurchaseModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={purSubmitting || !purProductId}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-extrabold cursor-pointer"
                >
                  {purSubmitting ? 'جارٍ الإضافة...' : 'تأكيد وإضافة للمخزن'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Simple Product Movements Modal */}
      {viewingProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">
                سجل حركات: {viewingProduct.name}
              </h3>
              <button
                onClick={() => setViewingProductId(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-[70vh] overflow-y-auto">
              {viewingProductMovements.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-6">
                  لا توجد حركات مسجلة لهذا الصنف.
                </p>
              ) : (
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-bold">
                      <th className="py-2 px-2">التاريخ</th>
                      <th className="py-2 px-2">التغير</th>
                      <th className="py-2 px-2">الرصيد بعدها</th>
                      <th className="py-2 px-2">البيان</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {viewingProductMovements.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2.5 px-2 tabular-nums">{formatDateTimeAr(m.created_at)}</td>
                        <td
                          className={`py-2.5 px-2 font-bold tabular-nums ${
                            Number(m.base_qty_change) >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {Number(m.base_qty_change) > 0 ? `+${m.base_qty_change}` : m.base_qty_change}
                        </td>
                        <td className="py-2.5 px-2 font-bold tabular-nums">
                          {formatNumber(m.balance_after_base)}
                        </td>
                        <td className="py-2.5 px-2 text-slate-600">{m.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

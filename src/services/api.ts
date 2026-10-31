import {
  BaseUnit,
  ProductType,
  SellingUnitMode,
  calculateCustomerReceivableAfterCollection,
  calculateLiquidFillingTransfer,
  calculateMovingAverageCost,
  roundMoney,
  roundQty,
  roundUnitCost,
  toBaseQuantity,
} from '../domain/calculations';
import {
  BackupFileInfo,
  CashMovement,
  Customer,
  ExpenseRecord,
  InventoryTransfer,
  PaymentMethod,
  PaymentRecord,
  Product,
  ProductCategory,
  Purchase,
  Sale,
  SaleItem,
  SalesReturn,
  SellingMethod,
  StockMovement,
  Stocktake,
  StoreBootstrapData,
  StoreSettings,
} from '../types/store';

const STORAGE_KEY = 'fifi_50x50_store_data_v1';
const AUTH_KEY = 'fifi_50x50_auth_v1';
const BACKUPS_KEY = 'fifi_50x50_backups_v1';
const TOKEN_KEY = 'fifi_50x50_auth_token';
const EXPLICIT_LOGOUT_KEY = 'fifi_50x50_explicit_logout';

interface AuthState {
  username: string;
  password: string;
  displayName: string;
  isDefaultPassword: boolean;
  authenticated: boolean;
}

interface StoredBackup {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  payload: StoreBootstrapData;
}

export function setAuthToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function markExplicitLogout() {
  sessionStorage.setItem(EXPLICIT_LOGOUT_KEY, '1');
}

export function clearExplicitLogout() {
  sessionStorage.removeItem(EXPLICIT_LOGOUT_KEY);
}

export function generateIdempotencyKey(prefix = 'op'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextId<T extends { id: number }>(items: T[]): number {
  if (!items || items.length === 0) return 1;
  return Math.max(...items.map((item) => Number(item.id) || 0)) + 1;
}

function generateRef(prefix: string, seq: number): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${datePart}-${String(seq).padStart(4, '0')}`;
}

function defaultSettings(): StoreSettings {
  return {
    id: 1,
    store_name: 'فيفي 50×50',
    store_subtitle: 'للمنظفات المنزلية والورقيات',
    phone: '',
    address: '',
    currency: 'ج.م',
    low_stock_threshold: 5,
    receipt_header: 'أهلاً بكم في محل فيفي 50×50 للمنظفات المنزلية',
    receipt_footer: 'شكراً لتعاملكم معنا',
    opening_cash_configured: 0,
    setup_completed: 0,
    updated_at: nowIso(),
  };
}

function createInitialStoreData(): StoreBootstrapData {
  return {
    settings: defaultSettings(),
    categories: [],
    sellingMethods: [],
    products: [],
    customers: [],
    sales: [],
    saleItems: [],
    salesReturns: [],
    salesReturnItems: [],
    payments: [],
    purchases: [],
    purchaseItems: [],
    expenses: [],
    stockMovements: [],
    stocktakes: [],
    stocktakeItems: [],
    cashMovements: [],
    inventoryTransfers: [],
    backups: [],
  };
}

function loadAuth(): AuthState {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        username: parsed.username || 'admin',
        password: parsed.password || 'fifi5050',
        displayName: parsed.displayName || 'مالك المحل (فيفي 50×50)',
        isDefaultPassword: Boolean(parsed.isDefaultPassword ?? true),
        authenticated: Boolean(parsed.authenticated ?? true),
      };
    }
  } catch {
    // ignore
  }
  const initial: AuthState = {
    username: 'admin',
    password: 'fifi5050',
    displayName: 'مالك المحل (فيفي 50×50)',
    isDefaultPassword: true,
    authenticated: true,
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(initial));
  return initial;
}

function saveAuth(auth: AuthState): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

function loadBackups(): StoredBackup[] {
  try {
    const raw = localStorage.getItem(BACKUPS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveBackups(backups: StoredBackup[]): void {
  try {
    localStorage.setItem(BACKUPS_KEY, JSON.stringify(backups.slice(0, 15)));
  } catch {
    // ignore quota issues on extra backups
  }
}

function loadRawStore(): StoreBootstrapData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const init = createInitialStoreData();
      return {
        settings: { ...init.settings, ...(parsed.settings || {}) },
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
        sellingMethods: Array.isArray(parsed.sellingMethods) ? parsed.sellingMethods : [],
        products: Array.isArray(parsed.products) ? parsed.products : [],
        customers: Array.isArray(parsed.customers) ? parsed.customers : [],
        sales: Array.isArray(parsed.sales) ? parsed.sales : [],
        saleItems: Array.isArray(parsed.saleItems) ? parsed.saleItems : [],
        salesReturns: Array.isArray(parsed.salesReturns) ? parsed.salesReturns : [],
        salesReturnItems: Array.isArray(parsed.salesReturnItems) ? parsed.salesReturnItems : [],
        payments: Array.isArray(parsed.payments) ? parsed.payments : [],
        purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
        purchaseItems: Array.isArray(parsed.purchaseItems) ? parsed.purchaseItems : [],
        expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
        stockMovements: Array.isArray(parsed.stockMovements) ? parsed.stockMovements : [],
        stocktakes: Array.isArray(parsed.stocktakes) ? parsed.stocktakes : [],
        stocktakeItems: Array.isArray(parsed.stocktakeItems) ? parsed.stocktakeItems : [],
        cashMovements: Array.isArray(parsed.cashMovements) ? parsed.cashMovements : [],
        inventoryTransfers: Array.isArray(parsed.inventoryTransfers) ? parsed.inventoryTransfers : [],
        backups: [],
      };
    }
  } catch {
    // ignore corrupted state and re-initialize
  }
  const initial = createInitialStoreData();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function saveStore(state: StoreBootstrapData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function enrichStoreData(state: StoreBootstrapData): StoreBootstrapData {
  const categoryMap = new Map<number, ProductCategory>();
  state.categories.forEach((c) => categoryMap.set(c.id, c));

  const productMap = new Map<number, Product>();
  state.products.forEach((p) => productMap.set(p.id, p));

  const customerMap = new Map<number, Customer>();
  state.customers.forEach((c) => customerMap.set(c.id, c));

  const saleMap = new Map<number, Sale>();
  state.sales.forEach((s) => saleMap.set(s.id, s));

  const products: Product[] = [...state.products]
    .map((p) => ({
      ...p,
      category_name: p.category_id ? categoryMap.get(p.category_id)?.name || null : null,
    }))
    .sort((a, b) => a.is_archived - b.is_archived || a.name.localeCompare(b.name, 'ar'));

  const customers: Customer[] = [...state.customers].sort(
    (a, b) => b.current_balance - a.current_balance || a.name.localeCompare(b.name, 'ar')
  );

  const sales: Sale[] = [...state.sales]
    .map((s) => ({
      ...s,
      customer_name: s.customer_id ? customerMap.get(s.customer_id)?.name || null : null,
    }))
    .sort((a, b) => b.id - a.id);

  const salesReturns: SalesReturn[] = [...state.salesReturns]
    .map((sr) => ({
      ...sr,
      invoice_number: saleMap.get(sr.sale_id)?.invoice_number || `#${sr.sale_id}`,
      customer_name: sr.customer_id ? customerMap.get(sr.customer_id)?.name || null : null,
    }))
    .sort((a, b) => b.id - a.id);

  const payments: PaymentRecord[] = [...state.payments]
    .map((p) => ({
      ...p,
      customer_name: customerMap.get(p.customer_id)?.name || '',
      invoice_number: p.sale_id ? saleMap.get(p.sale_id)?.invoice_number || null : null,
    }))
    .sort((a, b) => b.id - a.id);

  const purchases: Purchase[] = [...state.purchases].sort((a, b) => b.id - a.id);

  const expenses: ExpenseRecord[] = [...state.expenses].sort(
    (a, b) => b.expense_date.localeCompare(a.expense_date) || b.id - a.id
  );

  const stockMovements: StockMovement[] = [...state.stockMovements]
    .map((sm) => {
      const prod = productMap.get(sm.product_id);
      return {
        ...sm,
        product_name: prod?.name || sm.product_name || 'منتج محذوف',
        product_sku: prod?.sku || sm.product_sku || '',
        product_type: prod?.product_type || sm.product_type || 'individual',
        base_unit: prod?.base_unit || sm.base_unit || 'unit',
      };
    })
    .sort((a, b) => b.id - a.id);

  const stocktakes: Stocktake[] = [...state.stocktakes].sort((a, b) => b.id - a.id);
  const cashMovements: CashMovement[] = [...state.cashMovements].sort((a, b) => b.id - a.id);

  const inventoryTransfers: InventoryTransfer[] = [...state.inventoryTransfers]
    .map((it) => ({
      ...it,
      bulk_product_name: productMap.get(it.bulk_product_id)?.name || it.bulk_product_name || '',
      packaged_product_name:
        productMap.get(it.packaged_product_id)?.name || it.packaged_product_name || '',
    }))
    .sort((a, b) => b.id - a.id);

  const storedBackups = loadBackups();
  const backups: BackupFileInfo[] = storedBackups.map((b) => ({
    filename: b.filename,
    sizeBytes: b.sizeBytes,
    createdAt: b.createdAt,
  }));

  return {
    ...state,
    products,
    customers,
    sales,
    salesReturns,
    payments,
    purchases,
    expenses,
    stockMovements,
    stocktakes,
    cashMovements,
    inventoryTransfers,
    backups,
  };
}

export const api = {
  bootstrapSession: async () => {
    if (sessionStorage.getItem(EXPLICIT_LOGOUT_KEY) === '1') {
      throw new Error('تم تسجيل الخروج');
    }
    const auth = loadAuth();
    auth.authenticated = true;
    saveAuth(auth);
    const token = getAuthToken() || 'local-frontend-session-token';
    setAuthToken(token);
    return {
      token,
      user: {
        id: 1,
        username: auth.username,
        displayName: auth.displayName,
        role: 'owner',
      },
    };
  },

  login: async (username: string, password: string) => {
    const auth = loadAuth();
    const validPass =
      password === auth.password || (auth.isDefaultPassword && (password === 'fifi5050' || password === 'admin123'));
    if (username.trim() !== auth.username || !validPass) {
      throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    clearExplicitLogout();
    auth.authenticated = true;
    saveAuth(auth);
    const token = `local-token-${Date.now()}`;
    setAuthToken(token);
    return {
      token,
      user: {
        id: 1,
        username: auth.username,
        displayName: auth.displayName,
        role: 'owner',
      },
    };
  },

  logout: async () => {
    const auth = loadAuth();
    auth.authenticated = false;
    saveAuth(auth);
    setAuthToken(null);
    markExplicitLogout();
    return { ok: true };
  },

  changePassword: async (
    payloadOrCurrent: { currentPassword: string; newPassword: string; displayName?: string } | string,
    newPasswordArg?: string
  ) => {
    const auth = loadAuth();
    const currentPassword =
      typeof payloadOrCurrent === 'string' ? payloadOrCurrent : payloadOrCurrent.currentPassword;
    const newPassword =
      typeof payloadOrCurrent === 'string' ? newPasswordArg || '' : payloadOrCurrent.newPassword;
    const displayName =
      typeof payloadOrCurrent === 'object' ? payloadOrCurrent.displayName : undefined;

    const validCurrent =
      currentPassword === auth.password ||
      (auth.isDefaultPassword && (currentPassword === 'fifi5050' || currentPassword === 'admin123'));

    if (!validCurrent) {
      throw new Error('كلمة المرور الحالية غير صحيحة');
    }
    if (!newPassword || newPassword.length < 4) {
      throw new Error('كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل');
    }
    auth.password = newPassword;
    auth.isDefaultPassword = false;
    if (displayName && displayName.trim()) {
      auth.displayName = displayName.trim();
    }
    saveAuth(auth);
    return { ok: true };
  },

  getBootstrapData: async (): Promise<StoreBootstrapData> => {
    const state = loadRawStore();
    return enrichStoreData(state);
  },

  updateSettings: async (payload: Partial<StoreSettings>) => {
    const state = loadRawStore();
    state.settings = {
      ...state.settings,
      store_name: payload.store_name?.trim() || state.settings.store_name,
      store_subtitle: payload.store_subtitle?.trim() ?? state.settings.store_subtitle,
      phone: payload.phone?.trim() ?? state.settings.phone,
      address: payload.address?.trim() ?? state.settings.address,
      currency: payload.currency?.trim() || 'ج.م',
      low_stock_threshold: Math.max(
        0,
        Number(payload.low_stock_threshold ?? state.settings.low_stock_threshold)
      ),
      receipt_header: payload.receipt_header?.trim() ?? state.settings.receipt_header,
      receipt_footer: payload.receipt_footer?.trim() ?? state.settings.receipt_footer,
      setup_completed: Number(payload.setup_completed ?? state.settings.setup_completed),
      updated_at: nowIso(),
    };
    saveStore(state);
    return state.settings;
  },

  setOpeningCash: async (payload: { amount: number; movementDate?: string; notes?: string }) => {
    const state = loadRawStore();
    const amount = roundMoney(Number(payload.amount));
    if (amount < 0) {
      throw new Error('الرصيد الافتتاحي للخزنة لا يمكن أن يكون سالباً');
    }

    const existingIndex = state.cashMovements.findIndex(
      (cm) => cm.movement_type === 'opening_balance'
    );
    const now = nowIso();
    const movementDate = payload.movementDate || todayDate();
    const description = payload.notes?.trim() || 'رصيد افتتاحي للخزنة عند تأسيس النظام';

    if (existingIndex >= 0) {
      state.cashMovements[existingIndex] = {
        ...state.cashMovements[existingIndex],
        amount,
        description,
        movement_date: movementDate,
      };
    } else {
      const id = nextId(state.cashMovements);
      state.cashMovements.push({
        id,
        reference_number: generateRef('OPEN', id),
        movement_type: 'opening_balance',
        direction: 'in',
        amount,
        payment_method: 'cash',
        source_type: 'setup',
        source_id: 1,
        description,
        movement_date: movementDate,
        created_at: now,
      });
    }

    state.settings.opening_cash_configured = 1;
    state.settings.updated_at = now;
    saveStore(state);
    return { ok: true };
  },

  createCategory: async (payload: { name: string; description?: string }) => {
    const name = payload.name?.trim();
    if (!name) {
      throw new Error('اسم التصنيف مطلوب');
    }
    const state = loadRawStore();
    const existing = state.categories.find((c) => c.name === name);
    if (existing) {
      return existing;
    }
    const now = nowIso();
    const id = nextId(state.categories);
    const created: ProductCategory = {
      id,
      name,
      description: payload.description?.trim() || '',
      created_at: now,
      updated_at: now,
    };
    state.categories.push(created);
    saveStore(state);
    return created;
  },

  updateCategory: async (id: number, payload: { name: string; description?: string }) => {
    const name = payload.name?.trim();
    if (!name) {
      throw new Error('اسم التصنيف مطلوب');
    }
    const state = loadRawStore();
    const idx = state.categories.findIndex((c) => c.id === id);
    if (idx < 0) {
      throw new Error('التصنيف غير موجود');
    }
    state.categories[idx] = {
      ...state.categories[idx],
      name,
      description: payload.description?.trim() || '',
      updated_at: nowIso(),
    };
    saveStore(state);
    return state.categories[idx];
  },

  deleteCategory: async (id: number) => {
    const state = loadRawStore();
    state.categories = state.categories.filter((c) => c.id !== id);
    state.products = state.products.map((p) =>
      p.category_id === id ? { ...p, category_id: null } : p
    );
    saveStore(state);
    return { ok: true };
  },

  createSellingMethod: async (payload: {
    name: string;
    product_type?: 'individual' | 'carton' | 'bulk_liquid';
    default_units_per_carton?: number;
  }) => {
    const name = payload.name?.trim();
    if (!name) {
      throw new Error('اسم طريقة البيع مطلوب');
    }
    const state = loadRawStore();
    const methods = state.sellingMethods || [];
    const existing = methods.find((m) => m.name === name);
    if (existing) {
      return existing;
    }
    const inferredType: 'individual' | 'carton' | 'bulk_liquid' =
      payload.product_type ||
      (name.includes('كرتون') || name.includes('دست') || name.includes('باكيت')
        ? 'carton'
        : name.includes('لتر') || name.includes('سائل') || name.includes('جركن') || name.includes('برميل')
        ? 'bulk_liquid'
        : 'individual');

    const id = nextId(methods);
    const newMethod: SellingMethod = {
      id,
      name,
      product_type: inferredType,
      default_units_per_carton: Math.max(1, Number(payload.default_units_per_carton || 12)),
      created_at: nowIso(),
    };
    state.sellingMethods = [...methods, newMethod];
    saveStore(state);
    return newMethod;
  },

  deleteSellingMethod: async (id: number) => {
    const state = loadRawStore();
    state.sellingMethods = (state.sellingMethods || []).filter((m) => m.id !== id);
    saveStore(state);
    return { ok: true };
  },

  createProduct: async (payload: Record<string, any>) => {
    const name = String(payload.name || '').trim();
    if (!name) {
      throw new Error('اسم المنتج مطلوب');
    }

    const state = loadRawStore();
    const id = nextId(state.products);
    const sku = String(payload.sku || '').trim() || `FIFI-${Date.now()}-${id}`;
    const productType = (payload.product_type as ProductType) || 'individual';
    const baseUnit: BaseUnit =
      productType === 'bulk_liquid'
        ? 'ml'
        : productType === 'packaged_liquid'
        ? 'container'
        : 'unit';

    const unitsPerCarton = Math.max(1, Number(payload.units_per_carton || 1));
    const containerSizeMl = Math.max(0, Number(payload.container_size_ml || 0));
    const containerUnitLabel = String(payload.container_unit_label || 'عبوة').trim();

    const openingQtyInput = Math.max(
      0,
      Number(payload.initial_quantity ?? payload.opening_qty_input ?? 0)
    );
    const openingUnitMode =
      (payload.initial_unit_mode as SellingUnitMode) ||
      (payload.opening_unit_mode as SellingUnitMode) ||
      (productType === 'bulk_liquid'
        ? 'liter'
        : productType === 'packaged_liquid'
        ? 'container'
        : 'unit');

    const openingBaseQty =
      openingQtyInput > 0
        ? toBaseQuantity({
            productType,
            quantity: openingQtyInput,
            unitMode: openingUnitMode,
            unitsPerCarton,
          })
        : 0;

    const purchasePriceInput = Math.max(
      0,
      roundMoney(Number(payload.purchase_cost_input ?? payload.purchase_price_input ?? 0))
    );

    let avgCostPerBase = 0;
    if (purchasePriceInput > 0) {
      if (productType === 'carton') {
        avgCostPerBase = roundUnitCost(purchasePriceInput / unitsPerCarton);
      } else if (productType === 'bulk_liquid') {
        if (openingBaseQty > 0 && payload.purchase_cost_input !== undefined) {
          avgCostPerBase = roundUnitCost(purchasePriceInput / openingBaseQty);
        } else {
          avgCostPerBase = roundUnitCost(purchasePriceInput / 1000);
        }
      } else {
        avgCostPerBase = roundUnitCost(purchasePriceInput);
      }
    }

    const sellingPricePrimary = Math.max(0, roundMoney(Number(payload.selling_price_primary || 0)));
    const sellingPriceCarton = Math.max(
      0,
      roundMoney(
        Number(
          payload.selling_price_carton ||
            (productType === 'carton' ? sellingPricePrimary * unitsPerCarton : 0)
        )
      )
    );
    const sellingPricePerLiter = Math.max(
      0,
      roundMoney(
        Number(
          payload.selling_price_per_liter ||
            (productType === 'bulk_liquid' ? sellingPricePrimary : 0)
        )
      )
    );

    const minStockInput = Math.max(
      0,
      Number(payload.min_stock_threshold ?? payload.min_stock_input ?? 5)
    );
    const minStockThresholdBase =
      productType === 'bulk_liquid'
        ? roundQty(minStockInput * 1000)
        : roundQty(minStockInput);

    const costIncompleteFlag = openingBaseQty > 0 && avgCostPerBase === 0 ? 1 : 0;
    const now = nowIso();

    const newProduct: Product = {
      id,
      name,
      sku,
      category_id: payload.category_id ? Number(payload.category_id) : null,
      product_type: productType,
      base_unit: baseUnit,
      units_per_carton: unitsPerCarton,
      container_size_ml: containerSizeMl,
      container_unit_label: containerUnitLabel,
      stock_base_qty: openingBaseQty,
      avg_cost_per_base: avgCostPerBase,
      purchase_price_input: purchasePriceInput,
      selling_price_primary: sellingPricePrimary,
      selling_price_carton: sellingPriceCarton,
      selling_price_per_liter: sellingPricePerLiter,
      min_stock_threshold_base: minStockThresholdBase,
      cost_incomplete_flag: costIncompleteFlag,
      is_archived: 0,
      notes: String(payload.notes || '').trim(),
      last_movement_at: openingBaseQty > 0 ? now : null,
      created_at: now,
      updated_at: now,
    };

    state.products.push(newProduct);

    if (openingBaseQty > 0) {
      const movId = nextId(state.stockMovements);
      state.stockMovements.push({
        id: movId,
        reference_number: generateRef('OPN-STK', movId),
        product_id: id,
        movement_type: 'opening_stock',
        base_qty_change: openingBaseQty,
        balance_after_base: openingBaseQty,
        unit_cost_per_base: avgCostPerBase,
        source_type: 'product_creation',
        source_id: id,
        notes: 'رصيد افتتاحي عند تعريف الصنف',
        movement_date: todayDate(),
        created_at: now,
      });
    }

    saveStore(state);
    return newProduct;
  },

  updateProduct: async (id: number, payload: Record<string, any>) => {
    const state = loadRawStore();
    const idx = state.products.findIndex((p) => p.id === id);
    if (idx < 0) {
      throw new Error('المنتج غير موجود');
    }
    const existing = state.products[idx];
    const name = String(payload.name ?? existing.name).trim();
    if (!name) {
      throw new Error('اسم المنتج مطلوب');
    }

    const unitsPerCarton = Math.max(
      1,
      Number(payload.units_per_carton ?? existing.units_per_carton)
    );
    const containerSizeMl = Math.max(
      0,
      Number(payload.container_size_ml ?? existing.container_size_ml)
    );
    const containerUnitLabel = String(
      payload.container_unit_label ?? existing.container_unit_label
    ).trim();

    const sellingPricePrimary = Math.max(
      0,
      roundMoney(Number(payload.selling_price_primary ?? existing.selling_price_primary))
    );
    const sellingPriceCarton = Math.max(
      0,
      roundMoney(Number(payload.selling_price_carton ?? existing.selling_price_carton))
    );
    const sellingPricePerLiter = Math.max(
      0,
      roundMoney(
        Number(
          payload.selling_price_per_liter ??
            (existing.product_type === 'bulk_liquid'
              ? sellingPricePrimary
              : existing.selling_price_per_liter)
        )
      )
    );

    const rawMinInput = payload.min_stock_threshold ?? payload.min_stock_input;
    const minStockInput =
      rawMinInput !== undefined
        ? Math.max(0, Number(rawMinInput))
        : existing.product_type === 'bulk_liquid'
        ? existing.min_stock_threshold_base / 1000
        : existing.min_stock_threshold_base;

    const minStockThresholdBase =
      existing.product_type === 'bulk_liquid'
        ? roundQty(minStockInput * 1000)
        : roundQty(minStockInput);

    let avgCostPerBase = existing.avg_cost_per_base;
    let purchasePriceInput = existing.purchase_price_input;
    let costIncompleteFlag = existing.cost_incomplete_flag;

    const rawPurchaseInput = payload.purchase_cost_input ?? payload.purchase_price_input;
    if (rawPurchaseInput !== undefined) {
      purchasePriceInput = Math.max(0, roundMoney(Number(rawPurchaseInput)));
      if (purchasePriceInput > 0) {
        if (existing.product_type === 'carton') {
          avgCostPerBase = roundUnitCost(purchasePriceInput / unitsPerCarton);
        } else if (existing.product_type === 'bulk_liquid') {
          avgCostPerBase = roundUnitCost(purchasePriceInput / 1000);
        } else {
          avgCostPerBase = roundUnitCost(purchasePriceInput);
        }
        costIncompleteFlag = 0;
      }
    }

    state.products[idx] = {
      ...existing,
      name,
      sku: String(payload.sku ?? existing.sku).trim() || existing.sku,
      category_id:
        payload.category_id !== undefined
          ? payload.category_id
            ? Number(payload.category_id)
            : null
          : existing.category_id,
      units_per_carton: unitsPerCarton,
      container_size_ml: containerSizeMl,
      container_unit_label: containerUnitLabel,
      avg_cost_per_base: avgCostPerBase,
      purchase_price_input: purchasePriceInput,
      selling_price_primary: sellingPricePrimary,
      selling_price_carton: sellingPriceCarton,
      selling_price_per_liter: sellingPricePerLiter,
      min_stock_threshold_base: minStockThresholdBase,
      cost_incomplete_flag: costIncompleteFlag,
      is_archived:
        payload.is_archived !== undefined ? Number(payload.is_archived) : existing.is_archived,
      notes: String(payload.notes ?? existing.notes).trim(),
      updated_at: nowIso(),
    };

    saveStore(state);
    return state.products[idx];
  },

  toggleArchiveProduct: async (id: number, archive?: boolean) => {
    const state = loadRawStore();
    const idx = state.products.findIndex((p) => p.id === id);
    if (idx < 0) {
      throw new Error('المنتج غير موجود');
    }
    const nextArchived =
      archive !== undefined ? (archive ? 1 : 0) : state.products[idx].is_archived ? 0 : 1;
    state.products[idx].is_archived = nextArchived;
    state.products[idx].updated_at = nowIso();
    saveStore(state);
    return { is_archived: nextArchived };
  },

  fillLiquidContainers: async (payload: Record<string, any>) => {
    const state = loadRawStore();
    const bulkId = Number(payload.bulk_product_id ?? payload.bulkProductId);
    const packId = Number(payload.packaged_product_id ?? payload.packagedProductId);
    const containersToFill = Number(payload.containers_to_fill ?? payload.containersToFill);

    const bulkIdx = state.products.findIndex((p) => p.id === bulkId);
    const packIdx = state.products.findIndex((p) => p.id === packId);

    if (bulkIdx < 0 || packIdx < 0) {
      throw new Error('أحد المنتجين غير موجود');
    }

    const bulkProduct = state.products[bulkIdx];
    const packagedProduct = state.products[packIdx];

    if (bulkProduct.product_type !== 'bulk_liquid') {
      throw new Error('المنتج المصدر يجب أن يكون سائل سائب');
    }
    if (packagedProduct.product_type !== 'packaged_liquid') {
      throw new Error('المنتج الهدف يجب أن يكون عبوة معبأة');
    }

    const transferResult = calculateLiquidFillingTransfer({
      bulkAvailableMl: bulkProduct.stock_base_qty,
      bulkAvgCostPerMl: bulkProduct.avg_cost_per_base,
      containerSizeMl: packagedProduct.container_size_ml,
      containersToFill,
      packagedExistingQty: packagedProduct.stock_base_qty,
      packagedExistingAvgCost: packagedProduct.avg_cost_per_base,
    });

    const now = nowIso();
    const transferDate = payload.transfer_date || todayDate();
    const transferId = nextId(state.inventoryTransfers);
    const refNumber = generateRef('FILL', transferId);

    state.products[bulkIdx] = {
      ...bulkProduct,
      stock_base_qty: transferResult.remainingBulkMl,
      last_movement_at: now,
      updated_at: now,
    };

    state.products[packIdx] = {
      ...packagedProduct,
      stock_base_qty: transferResult.newPackagedQty,
      avg_cost_per_base: transferResult.newPackagedAvgCost,
      purchase_price_input: roundMoney(transferResult.newPackagedAvgCost),
      last_movement_at: now,
      updated_at: now,
    };

    state.inventoryTransfers.push({
      id: transferId,
      reference_number: refNumber,
      bulk_product_id: bulkProduct.id,
      packaged_product_id: packagedProduct.id,
      bulk_ml_used: transferResult.bulkMlUsed,
      containers_filled: containersToFill,
      container_size_ml: packagedProduct.container_size_ml,
      transferred_cost: transferResult.transferredCost,
      notes: payload.notes?.trim() || '',
      transfer_date: transferDate,
      created_at: now,
    });

    const outMovId = nextId(state.stockMovements);
    state.stockMovements.push({
      id: outMovId,
      reference_number: `${refNumber}-OUT`,
      product_id: bulkProduct.id,
      movement_type: 'liquid_filling_out',
      base_qty_change: -transferResult.bulkMlUsed,
      balance_after_base: transferResult.remainingBulkMl,
      unit_cost_per_base: bulkProduct.avg_cost_per_base,
      source_type: 'inventory_transfer',
      source_id: transferId,
      notes: `سحب سائل لتعبئة ${containersToFill} ${packagedProduct.container_unit_label} من ${packagedProduct.name}`,
      movement_date: transferDate,
      created_at: now,
    });

    const inMovId = nextId(state.stockMovements);
    state.stockMovements.push({
      id: inMovId,
      reference_number: `${refNumber}-IN`,
      product_id: packagedProduct.id,
      movement_type: 'liquid_filling_in',
      base_qty_change: containersToFill,
      balance_after_base: transferResult.newPackagedQty,
      unit_cost_per_base: transferResult.newPackagedAvgCost,
      source_type: 'inventory_transfer',
      source_id: transferId,
      notes: `إضافة عبوات معبأة من ${bulkProduct.name}`,
      movement_date: transferDate,
      created_at: now,
    });

    saveStore(state);
    return { ok: true, reference_number: refNumber, transferResult };
  },

  recordPurchase: async (payload: Record<string, any>) => {
    const rawItems = Array.isArray(payload.items)
      ? payload.items
      : payload.product_id
      ? [
          {
            productId: payload.product_id,
            purchasedQty: payload.quantity_purchased,
            purchaseUnitMode: payload.purchase_unit_mode,
            totalCost: payload.total_purchase_cost,
          },
        ]
      : [];

    if (rawItems.length === 0) {
      throw new Error('يجب إضافة صنف واحد على الأقل في فاتورة المشتريات');
    }

    const state = loadRawStore();
    const now = nowIso();
    const purchaseDate = payload.purchase_date || payload.purchaseDate || todayDate();
    const paymentStatus =
      (payload.payment_status || payload.paymentStatus) === 'unpaid' ? 'unpaid' : 'paid';
    const paymentMethod: PaymentMethod =
      payload.payment_method || payload.paymentMethod || 'cash';
    const supplierName = String(
      payload.supplier_name ?? payload.supplierName ?? 'مورد عام'
    ).trim();
    const purchaseId = nextId(state.purchases);
    const refNumber = generateRef('PUR', purchaseId);

    let totalInvoiceCost = 0;

    for (const item of rawItems) {
      const productId = Number(item.product_id ?? item.productId);
      const prodIdx = state.products.findIndex((p) => p.id === productId);
      if (prodIdx < 0) {
        throw new Error('أحد الأصناف المختارة غير موجود');
      }
      const product = state.products[prodIdx];
      const purchasedQty = Number(item.quantity_purchased ?? item.purchasedQty);
      const totalCost = roundMoney(Number(item.total_purchase_cost ?? item.totalCost));
      const unitMode: SellingUnitMode =
        item.purchase_unit_mode || item.purchaseUnitMode || 'unit';

      if (purchasedQty <= 0) {
        throw new Error(`الكمية المشتراة للصنف (${product.name}) يجب أن تكون أكبر من صفر`);
      }
      if (totalCost < 0) {
        throw new Error(`تكلفة الشراء للصنف (${product.name}) غير صالحة`);
      }

      const baseUnitQty = toBaseQuantity({
        productType: product.product_type,
        quantity: purchasedQty,
        unitMode,
        unitsPerCarton: product.units_per_carton,
      });

      const avgCalc = calculateMovingAverageCost({
        existingBaseQty: product.stock_base_qty,
        existingAvgCostPerBase: product.avg_cost_per_base,
        purchasedBaseQty: baseUnitQty,
        totalPurchaseCost: totalCost,
      });

      const unitLabel =
        unitMode === 'carton'
          ? 'كرتونة'
          : unitMode === 'liter'
          ? 'لتر'
          : unitMode === 'ml'
          ? 'مل'
          : unitMode === 'container'
          ? product.container_unit_label || 'عبوة'
          : 'قطعة';

      const displayPurchasePrice =
        product.product_type === 'carton' && unitMode === 'carton'
          ? roundMoney(avgCalc.newAvgCostPerBase * product.units_per_carton)
          : product.product_type === 'bulk_liquid'
          ? roundMoney(avgCalc.newAvgCostPerBase * 1000)
          : roundMoney(avgCalc.newAvgCostPerBase);

      state.products[prodIdx] = {
        ...product,
        stock_base_qty: avgCalc.newStockBaseQty,
        avg_cost_per_base: avgCalc.newAvgCostPerBase,
        purchase_price_input: displayPurchasePrice,
        cost_incomplete_flag: avgCalc.newAvgCostPerBase > 0 ? 0 : product.cost_incomplete_flag,
        last_movement_at: now,
        updated_at: now,
      };

      const purchaseItemId = nextId(state.purchaseItems);
      state.purchaseItems.push({
        id: purchaseItemId,
        purchase_id: purchaseId,
        product_id: product.id,
        product_name_snapshot: product.name,
        purchase_unit_mode: unitMode,
        purchase_unit_label: unitLabel,
        purchased_qty: purchasedQty,
        base_unit_qty: baseUnitQty,
        total_cost: totalCost,
        unit_cost_per_base: avgCalc.purchaseCostPerBase,
        prev_stock_base: product.stock_base_qty,
        prev_avg_cost_per_base: product.avg_cost_per_base,
        new_avg_cost_per_base: avgCalc.newAvgCostPerBase,
        created_at: now,
      });

      const movId = nextId(state.stockMovements);
      state.stockMovements.push({
        id: movId,
        reference_number: `${refNumber}-P${product.id}-${purchaseItemId}`,
        product_id: product.id,
        movement_type: 'purchase',
        base_qty_change: baseUnitQty,
        balance_after_base: avgCalc.newStockBaseQty,
        unit_cost_per_base: avgCalc.purchaseCostPerBase,
        source_type: 'purchase',
        source_id: purchaseId,
        notes: `توريد مخزني (${purchasedQty} ${unitLabel})`,
        movement_date: purchaseDate,
        created_at: now,
      });

      totalInvoiceCost = roundMoney(totalInvoiceCost + totalCost);
    }

    const amountPaid = paymentStatus === 'paid' ? totalInvoiceCost : 0;

    state.purchases.push({
      id: purchaseId,
      reference_number: refNumber,
      supplier_name: supplierName || 'مورد عام',
      purchase_date: purchaseDate,
      total_cost: totalInvoiceCost,
      amount_paid: amountPaid,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      notes: payload.notes?.trim() || '',
      created_at: now,
      updated_at: now,
    });

    if (paymentStatus === 'paid' && totalInvoiceCost > 0) {
      const cashId = nextId(state.cashMovements);
      state.cashMovements.push({
        id: cashId,
        reference_number: `${refNumber}-CASH`,
        movement_type: 'purchase_payment',
        direction: 'out',
        amount: totalInvoiceCost,
        payment_method: paymentMethod,
        source_type: 'purchase',
        source_id: purchaseId,
        description: `سداد فاتورة مشتريات رقم ${refNumber} (${supplierName || 'مورد عام'})`,
        movement_date: purchaseDate,
        created_at: now,
      });
    }

    saveStore(state);
    return { id: purchaseId, reference_number: refNumber };
  },

  payPurchase: async (
    id: number,
    payloadOrMethod?: { payment_method?: PaymentMethod; payment_date?: string } | PaymentMethod
  ) => {
    const state = loadRawStore();
    const idx = state.purchases.findIndex((p) => p.id === id);
    if (idx < 0) {
      throw new Error('فاتورة المشتريات غير موجودة');
    }
    const purchase = state.purchases[idx];
    if (purchase.payment_status === 'paid') {
      throw new Error('تم سداد هذه الفاتورة بالفعل');
    }
    const paymentMethod: PaymentMethod =
      typeof payloadOrMethod === 'string'
        ? payloadOrMethod
        : payloadOrMethod?.payment_method || 'cash';
    const paymentDate =
      typeof payloadOrMethod === 'object' && payloadOrMethod?.payment_date
        ? payloadOrMethod.payment_date
        : todayDate();

    const remaining = roundMoney(purchase.total_cost - purchase.amount_paid);
    const now = nowIso();

    state.purchases[idx] = {
      ...purchase,
      amount_paid: purchase.total_cost,
      payment_status: 'paid',
      payment_method: paymentMethod,
      updated_at: now,
    };

    if (remaining > 0) {
      const cashId = nextId(state.cashMovements);
      state.cashMovements.push({
        id: cashId,
        reference_number: `${purchase.reference_number}-PAY`,
        movement_type: 'purchase_payment',
        direction: 'out',
        amount: remaining,
        payment_method: paymentMethod,
        source_type: 'purchase',
        source_id: purchase.id,
        description: `سداد آجل لفاتورة مشتريات رقم ${purchase.reference_number}`,
        movement_date: paymentDate,
        created_at: now,
      });
    }

    saveStore(state);
    return { ok: true };
  },

  createSale: async (payload: Record<string, any>) => {
    const state = loadRawStore();
    const idempotencyKey = payload.idempotency_key ?? payload.idempotencyKey ?? null;

    if (idempotencyKey) {
      const dup = state.sales.find((s) => s.idempotency_key === idempotencyKey);
      if (dup) {
        return { id: dup.id, invoice_number: dup.invoice_number, duplicate: true };
      }
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) {
      throw new Error('السلة فارغة — أضف منتجاً واحداً على الأقل لإتمام البيع');
    }

    const now = nowIso();
    const saleDate = payload.sale_date || payload.saleDate || todayDate();
    const saleType: 'cash' | 'credit' | 'partial' =
      payload.sale_type || payload.saleType || 'cash';
    const paymentMethod: PaymentMethod =
      payload.payment_method || payload.paymentMethod || 'cash';
    const discount = Math.max(0, roundMoney(Number(payload.discount || 0)));

    const rawCustomerId = payload.customer_id ?? payload.customerId;
    let customerId: number | null = rawCustomerId ? Number(rawCustomerId) : null;

    if ((saleType === 'credit' || saleType === 'partial') && !customerId) {
      const newCustomerName = String(
        payload.new_customer_name ?? payload.newCustomerName ?? ''
      ).trim();
      const newCustomerPhone = String(
        payload.new_customer_phone ?? payload.newCustomerPhone ?? ''
      ).trim();
      if (!newCustomerName) {
        throw new Error('البيع الآجل (الشكك) أو الجزئي يتطلب اختيار عميل أو إدخال اسم عميل جديد');
      }
      customerId = nextId(state.customers);
      state.customers.push({
        id: customerId,
        name: newCustomerName,
        phone: newCustomerPhone,
        notes: 'تم إنشاؤه من شاشة الكاشير',
        total_credit_purchases: 0,
        total_payments: 0,
        total_returns: 0,
        current_balance: 0,
        status: 'settled',
        last_transaction_at: now,
        created_at: now,
        updated_at: now,
      });
    }

    interface PreparedLine {
      productIdx: number;
      product: Product;
      sellingUnitMode: SellingUnitMode;
      sellingUnitLabel: string;
      sellingUnitQty: number;
      baseUnitQty: number;
      unitSellingPrice: number;
      unitCostPerBase: number;
      totalLineCost: number;
      lineTotal: number;
    }

    const preparedLines: PreparedLine[] = [];
    let subtotal = 0;
    let totalCogs = 0;

    const requiredByProduct = new Map<number, number>();

    for (const rawItem of items) {
      const prodId = Number(rawItem.product_id ?? rawItem.productId);
      const prodIdx = state.products.findIndex((p) => p.id === prodId && p.is_archived === 0);
      if (prodIdx < 0) {
        throw new Error('أحد الأصناف في السلة غير موجود أو مؤرشف');
      }
      const product = state.products[prodIdx];
      const sellingUnitMode: SellingUnitMode =
        rawItem.selling_unit_mode || rawItem.sellingUnitMode || 'unit';
      const sellingUnitQty = roundQty(Number(rawItem.quantity));

      if (sellingUnitQty <= 0) {
        throw new Error(`الكمية للصنف (${product.name}) يجب أن تكون أكبر من صفر`);
      }

      const baseUnitQty = toBaseQuantity({
        productType: product.product_type,
        quantity: sellingUnitQty,
        unitMode: sellingUnitMode,
        unitsPerCarton: product.units_per_carton,
      });

      const cumulativeReq = roundQty((requiredByProduct.get(product.id) || 0) + baseUnitQty);
      if (cumulativeReq > product.stock_base_qty) {
        throw new Error(
          `الرصيد غير كافٍ للصنف (${product.name}). المتاح حالياً: ${product.stock_base_qty} ${
            product.base_unit === 'ml'
              ? 'مل'
              : product.base_unit === 'container'
              ? product.container_unit_label
              : 'قطعة'
          }`
        );
      }
      requiredByProduct.set(product.id, cumulativeReq);

      let defaultPrice = product.selling_price_primary;
      let sellingUnitLabel = product.container_unit_label || 'قطعة';

      if (product.product_type === 'carton') {
        if (sellingUnitMode === 'carton') {
          defaultPrice =
            product.selling_price_carton ||
            roundMoney(product.selling_price_primary * product.units_per_carton);
          sellingUnitLabel = product.container_unit_label || 'كرتونة';
        } else {
          defaultPrice = product.selling_price_primary;
          sellingUnitLabel = 'قطعة';
        }
      } else if (product.product_type === 'bulk_liquid') {
        const pricePerLiter = product.selling_price_per_liter || product.selling_price_primary;
        if (sellingUnitMode === 'liter') {
          defaultPrice = pricePerLiter;
          sellingUnitLabel = 'لتر';
        } else {
          defaultPrice = roundUnitCost(pricePerLiter / 1000);
          sellingUnitLabel = 'مل';
        }
      } else if (product.product_type === 'packaged_liquid') {
        defaultPrice = product.selling_price_primary;
        sellingUnitLabel = product.container_unit_label || 'عبوة';
      }

      const rawPrice = rawItem.unit_selling_price ?? rawItem.unitPrice;
      const unitSellingPrice =
        rawPrice !== undefined && Number(rawPrice) >= 0 ? Number(rawPrice) : defaultPrice;

      const lineTotal = roundMoney(sellingUnitQty * unitSellingPrice);
      const unitCostPerBase = product.avg_cost_per_base;
      const totalLineCost = roundMoney(baseUnitQty * unitCostPerBase);

      subtotal = roundMoney(subtotal + lineTotal);
      totalCogs = roundMoney(totalCogs + totalLineCost);

      preparedLines.push({
        productIdx: prodIdx,
        product,
        sellingUnitMode,
        sellingUnitLabel,
        sellingUnitQty,
        baseUnitQty,
        unitSellingPrice: roundMoney(unitSellingPrice),
        unitCostPerBase,
        totalLineCost,
        lineTotal,
      });
    }

    if (discount > subtotal) {
      throw new Error('قيمة الخصم لا يمكن أن تتجاوز إجمالي الفاتورة');
    }

    const totalAmount = roundMoney(subtotal - discount);
    let amountPaid = 0;

    if (saleType === 'cash') {
      amountPaid = totalAmount;
    } else if (saleType === 'credit') {
      amountPaid = 0;
    } else if (saleType === 'partial') {
      amountPaid = roundMoney(Number(payload.amount_paid ?? payload.amountPaid ?? 0));
      if (amountPaid <= 0 || amountPaid >= totalAmount) {
        throw new Error(
          'في الدفع الجزئي يجب أن يكون المبلغ المدفوع أكبر من صفر وأقل من إجمالي الفاتورة'
        );
      }
    }

    const remainingAmount = roundMoney(totalAmount - amountPaid);
    const saleId = nextId(state.sales);
    const invoiceNumber = generateRef('INV', saleId);

    state.sales.push({
      id: saleId,
      invoice_number: invoiceNumber,
      idempotency_key: idempotencyKey,
      customer_id: customerId,
      sale_type: saleType,
      subtotal,
      discount,
      total_amount: totalAmount,
      total_cogs: totalCogs,
      amount_paid: amountPaid,
      remaining_amount: remainingAmount,
      payment_method: paymentMethod,
      status: 'confirmed',
      notes: payload.notes?.trim() || '',
      sale_date: saleDate,
      created_at: now,
      updated_at: now,
    });

    for (const line of preparedLines) {
      const currentProd = state.products[line.productIdx];
      const newStockBase = roundQty(currentProd.stock_base_qty - line.baseUnitQty);

      state.products[line.productIdx] = {
        ...currentProd,
        stock_base_qty: newStockBase,
        last_movement_at: now,
        updated_at: now,
      };

      const saleItemId = nextId(state.saleItems);
      state.saleItems.push({
        id: saleItemId,
        sale_id: saleId,
        product_id: currentProd.id,
        product_name_snapshot: currentProd.name,
        sku_snapshot: currentProd.sku,
        product_type_snapshot: currentProd.product_type,
        selling_unit_mode: line.sellingUnitMode,
        selling_unit_label: line.sellingUnitLabel,
        selling_unit_qty: line.sellingUnitQty,
        base_unit_qty: line.baseUnitQty,
        unit_selling_price: line.unitSellingPrice,
        unit_cost_snapshot_per_base: line.unitCostPerBase,
        total_line_cost: line.totalLineCost,
        line_total: line.lineTotal,
        returned_base_qty: 0,
        cost_incomplete_snapshot: currentProd.cost_incomplete_flag,
        created_at: now,
      });

      const movId = nextId(state.stockMovements);
      state.stockMovements.push({
        id: movId,
        reference_number: `${invoiceNumber}-S${saleItemId}`,
        product_id: currentProd.id,
        movement_type: 'sale',
        base_qty_change: -line.baseUnitQty,
        balance_after_base: newStockBase,
        unit_cost_per_base: line.unitCostPerBase,
        source_type: 'sale',
        source_id: saleId,
        notes: `بيع فاتورة ${invoiceNumber} (${line.sellingUnitQty} ${line.sellingUnitLabel})`,
        movement_date: saleDate,
        created_at: now,
      });
    }

    if (amountPaid > 0) {
      const cashId = nextId(state.cashMovements);
      state.cashMovements.push({
        id: cashId,
        reference_number: `${invoiceNumber}-CASH`,
        movement_type: saleType === 'cash' ? 'cash_sale' : 'partial_sale_payment',
        direction: 'in',
        amount: amountPaid,
        payment_method: paymentMethod,
        source_type: 'sale',
        source_id: saleId,
        description:
          saleType === 'cash'
            ? `تحصيل مبيعات نقدية فاتورة ${invoiceNumber}`
            : `دفعة مقدمة من فاتورة بيع جزئي ${invoiceNumber}`,
        movement_date: saleDate,
        created_at: now,
      });
    }

    if (customerId) {
      const custIdx = state.customers.findIndex((c) => c.id === customerId);
      if (custIdx >= 0) {
        const customer = state.customers[custIdx];
        const newTotalCreditPurchases =
          remainingAmount > 0
            ? roundMoney(customer.total_credit_purchases + totalAmount)
            : customer.total_credit_purchases;
        const newTotalPayments =
          remainingAmount > 0 && amountPaid > 0
            ? roundMoney(customer.total_payments + amountPaid)
            : customer.total_payments;
        const newBalance = roundMoney(customer.current_balance + remainingAmount);
        const newStatus = newBalance > 0 ? 'outstanding' : 'settled';

        state.customers[custIdx] = {
          ...customer,
          total_credit_purchases: newTotalCreditPurchases,
          total_payments: newTotalPayments,
          current_balance: newBalance,
          status: newStatus,
          last_transaction_at: now,
          updated_at: now,
        };

        if (amountPaid > 0 && saleType === 'partial') {
          const payId = nextId(state.payments);
          state.payments.push({
            id: payId,
            reference_number: `${invoiceNumber}-INIT`,
            customer_id: customerId,
            sale_id: saleId,
            payment_type: 'sale_initial',
            amount: amountPaid,
            payment_method: paymentMethod,
            balance_before: roundMoney(customer.current_balance + totalAmount),
            balance_after: newBalance,
            notes: `دفعة مقدمة عند إصدار الفاتورة ${invoiceNumber}`,
            payment_date: saleDate,
            created_at: now,
          });
        }
      }
    }

    saveStore(state);
    return { id: saleId, invoice_number: invoiceNumber };
  },

  createSalesReturn: async (saleId: number, payload: Record<string, any>) => {
    const state = loadRawStore();
    const saleIdx = state.sales.findIndex((s) => s.id === Number(saleId));
    if (saleIdx < 0) {
      throw new Error('الفاتورة الأصلية غير موجودة');
    }
    const sale = state.sales[saleIdx];

    const returnLines = Array.isArray(payload.items) ? payload.items : [];
    if (returnLines.length === 0) {
      throw new Error('اختر صنفاً واحداً على الأقل للاسترجاع');
    }

    const rawCondition = payload.condition_type ?? payload.conditionType;
    const conditionType: 'resellable' | 'damaged' =
      rawCondition === 'damaged' ? 'damaged' : 'resellable';
    const paymentMethod: PaymentMethod =
      payload.payment_method || payload.paymentMethod || 'cash';
    const reason = payload.reason?.trim() || 'مرتجع مبيعات';
    const now = nowIso();
    const returnDate = payload.return_date || payload.returnDate || todayDate();

    let totalReturnAmount = 0;
    let totalReturnCogs = 0;

    interface PreparedReturnItem {
      saleItemIdx: number;
      saleItem: SaleItem;
      returnSellingQty: number;
      returnBaseQty: number;
      lineRefundAmount: number;
      lineCostReversed: number;
    }

    const preparedReturns: PreparedReturnItem[] = [];

    for (const reqItem of returnLines) {
      const reqSaleItemId = Number(reqItem.sale_item_id ?? reqItem.saleItemId);
      const siIdx = state.saleItems.findIndex(
        (si) => si.id === reqSaleItemId && si.sale_id === sale.id
      );
      if (siIdx < 0) {
        throw new Error('بند الفاتورة غير موجود');
      }
      const saleItem = state.saleItems[siIdx];
      const returnSellingQty = roundQty(
        Number(reqItem.return_selling_qty ?? reqItem.returnSellingQty)
      );
      if (returnSellingQty <= 0) continue;

      const ratioBasePerSelling = saleItem.base_unit_qty / saleItem.selling_unit_qty;
      const returnBaseQty = roundQty(returnSellingQty * ratioBasePerSelling);
      const remainingReturnableBase = roundQty(
        saleItem.base_unit_qty - saleItem.returned_base_qty
      );

      if (returnBaseQty > remainingReturnableBase + 0.001) {
        throw new Error(
          `الكمية المرتجعة للصنف (${saleItem.product_name_snapshot}) تتجاوز الكمية المباعة المتبقية`
        );
      }

      const invoiceDiscountRatio =
        sale.subtotal > 0 ? (sale.subtotal - sale.discount) / sale.subtotal : 1;
      const grossLineRefund = roundMoney(returnSellingQty * saleItem.unit_selling_price);
      const lineRefundAmount = roundMoney(grossLineRefund * invoiceDiscountRatio);
      const lineCostReversed = roundMoney(
        returnBaseQty * saleItem.unit_cost_snapshot_per_base
      );

      totalReturnAmount = roundMoney(totalReturnAmount + lineRefundAmount);
      totalReturnCogs = roundMoney(totalReturnCogs + lineCostReversed);

      preparedReturns.push({
        saleItemIdx: siIdx,
        saleItem,
        returnSellingQty,
        returnBaseQty,
        lineRefundAmount,
        lineCostReversed,
      });
    }

    if (preparedReturns.length === 0) {
      throw new Error('لم يتم تحديد أي كميات صالحة للمرتجع');
    }

    const resellableCogsReversed = conditionType === 'resellable' ? totalReturnCogs : 0;
    const damagedLossAmount = conditionType === 'damaged' ? totalReturnCogs : 0;

    let creditBalanceReduction = 0;
    let refundCashAmount = 0;

    if (sale.customer_id && sale.remaining_amount > 0) {
      creditBalanceReduction = Math.min(sale.remaining_amount, totalReturnAmount);
      refundCashAmount = roundMoney(totalReturnAmount - creditBalanceReduction);
    } else {
      refundCashAmount = totalReturnAmount;
    }

    const returnId = nextId(state.salesReturns);
    const returnNumber = generateRef('RET', returnId);

    state.salesReturns.push({
      id: returnId,
      return_number: returnNumber,
      sale_id: sale.id,
      customer_id: sale.customer_id,
      total_return_amount: totalReturnAmount,
      total_return_cogs: totalReturnCogs,
      resellable_cogs_reversed: resellableCogsReversed,
      damaged_loss_amount: damagedLossAmount,
      refund_cash_amount: refundCashAmount,
      credit_balance_reduction: creditBalanceReduction,
      payment_method: paymentMethod,
      condition_type: conditionType,
      reason,
      return_date: returnDate,
      created_at: now,
    });

    for (const item of preparedReturns) {
      state.saleItems[item.saleItemIdx] = {
        ...item.saleItem,
        returned_base_qty: roundQty(item.saleItem.returned_base_qty + item.returnBaseQty),
      };

      const retItemId = nextId(state.salesReturnItems);
      state.salesReturnItems.push({
        id: retItemId,
        return_id: returnId,
        sale_item_id: item.saleItem.id,
        product_id: item.saleItem.product_id,
        product_name_snapshot: item.saleItem.product_name_snapshot,
        returned_selling_qty: item.returnSellingQty,
        returned_base_qty: item.returnBaseQty,
        refund_amount: item.lineRefundAmount,
        cost_reversed: item.lineCostReversed,
        condition_type: conditionType,
        created_at: now,
      });

      const prodIdx = state.products.findIndex((p) => p.id === item.saleItem.product_id);
      if (prodIdx >= 0) {
        const product = state.products[prodIdx];
        if (conditionType === 'resellable') {
          const newStock = roundQty(product.stock_base_qty + item.returnBaseQty);
          state.products[prodIdx] = {
            ...product,
            stock_base_qty: newStock,
            last_movement_at: now,
            updated_at: now,
          };

          const movId = nextId(state.stockMovements);
          state.stockMovements.push({
            id: movId,
            reference_number: `${returnNumber}-I${item.saleItem.id}`,
            product_id: product.id,
            movement_type: 'sale_return_resellable',
            base_qty_change: item.returnBaseQty,
            balance_after_base: newStock,
            unit_cost_per_base: item.saleItem.unit_cost_snapshot_per_base,
            source_type: 'sales_return',
            source_id: returnId,
            notes: `مرتجع سليم من فاتورة ${sale.invoice_number}`,
            movement_date: returnDate,
            created_at: now,
          });
        } else {
          const movId = nextId(state.stockMovements);
          state.stockMovements.push({
            id: movId,
            reference_number: `${returnNumber}-D${item.saleItem.id}`,
            product_id: product.id,
            movement_type: 'sale_return_damaged',
            base_qty_change: 0,
            balance_after_base: product.stock_base_qty,
            unit_cost_per_base: item.saleItem.unit_cost_snapshot_per_base,
            source_type: 'sales_return',
            source_id: returnId,
            notes: `مرتجع تالف (لا يعود للمخزون السليم) من فاتورة ${sale.invoice_number}`,
            movement_date: returnDate,
            created_at: now,
          });
        }
      }
    }

    const saleItemsForInvoice = state.saleItems.filter((si) => si.sale_id === sale.id);
    const allReturned = saleItemsForInvoice.every(
      (si) => si.returned_base_qty >= si.base_unit_qty - 0.001
    );
    const newRemainingOnSale = roundMoney(
      Math.max(0, sale.remaining_amount - creditBalanceReduction)
    );

    state.sales[saleIdx] = {
      ...sale,
      status: allReturned ? 'returned' : 'partially_returned',
      remaining_amount: newRemainingOnSale,
      updated_at: now,
    };

    if (sale.customer_id && creditBalanceReduction > 0) {
      const custIdx = state.customers.findIndex((c) => c.id === sale.customer_id);
      if (custIdx >= 0) {
        const customer = state.customers[custIdx];
        const newBalance = roundMoney(
          Math.max(0, customer.current_balance - creditBalanceReduction)
        );
        const newTotalReturns = roundMoney(customer.total_returns + creditBalanceReduction);
        state.customers[custIdx] = {
          ...customer,
          total_returns: newTotalReturns,
          current_balance: newBalance,
          status: newBalance > 0 ? 'outstanding' : 'settled',
          last_transaction_at: now,
          updated_at: now,
        };

        const payId = nextId(state.payments);
        state.payments.push({
          id: payId,
          reference_number: `${returnNumber}-ADJ`,
          customer_id: customer.id,
          sale_id: sale.id,
          payment_type: 'balance_adjustment',
          amount: creditBalanceReduction,
          payment_method: paymentMethod,
          balance_before: customer.current_balance,
          balance_after: newBalance,
          notes: `خصم مرتجع مبيعات رقم ${returnNumber} من مديونية الفاتورة ${sale.invoice_number}`,
          payment_date: returnDate,
          created_at: now,
        });
      }
    }

    if (refundCashAmount > 0) {
      const cashId = nextId(state.cashMovements);
      state.cashMovements.push({
        id: cashId,
        reference_number: `${returnNumber}-CASH`,
        movement_type: 'sales_refund',
        direction: 'out',
        amount: refundCashAmount,
        payment_method: paymentMethod,
        source_type: 'sales_return',
        source_id: returnId,
        description: `رد نقدي لمرتجع مبيعات رقم ${returnNumber} (فاتورة ${sale.invoice_number})`,
        movement_date: returnDate,
        created_at: now,
      });
    }

    saveStore(state);
    return { id: returnId, return_number: returnNumber };
  },

  createCustomer: async (payload: {
    name: string;
    phone?: string;
    notes?: string;
    opening_balance?: number;
  }) => {
    const name = payload.name?.trim();
    if (!name) {
      throw new Error('اسم العميل مطلوب');
    }
    const state = loadRawStore();
    const id = nextId(state.customers);
    const now = nowIso();
    const openingBal = Math.max(0, roundMoney(Number(payload.opening_balance || 0)));
    const created: Customer = {
      id,
      name,
      phone: payload.phone?.trim() || '',
      notes: payload.notes?.trim() || '',
      total_credit_purchases: openingBal,
      total_payments: 0,
      total_returns: 0,
      current_balance: openingBal,
      status: openingBal > 0 ? 'outstanding' : 'settled',
      last_transaction_at: openingBal > 0 ? now : null,
      created_at: now,
      updated_at: now,
    };
    state.customers.push(created);
    saveStore(state);
    return created;
  },

  updateCustomer: async (id: number, payload: { name: string; phone?: string; notes?: string }) => {
    const name = payload.name?.trim();
    if (!name) {
      throw new Error('اسم العميل مطلوب');
    }
    const state = loadRawStore();
    const idx = state.customers.findIndex((c) => c.id === id);
    if (idx < 0) {
      throw new Error('العميل غير موجود');
    }
    state.customers[idx] = {
      ...state.customers[idx],
      name,
      phone: payload.phone?.trim() || '',
      notes: payload.notes?.trim() || '',
      updated_at: nowIso(),
    };
    saveStore(state);
    return state.customers[idx];
  },

  collectCustomerDebt: async (customerId: number, payload: Record<string, any>) => {
    const state = loadRawStore();
    const custIdx = state.customers.findIndex((c) => c.id === Number(customerId));
    if (custIdx < 0) {
      throw new Error('العميل غير موجود');
    }
    const customer = state.customers[custIdx];
    const collectionAmount = roundMoney(Number(payload.amount));
    const paymentMethod: PaymentMethod =
      payload.payment_method || payload.paymentMethod || 'cash';
    const notes = payload.notes?.trim() || 'تحصيل دفعة من حساب الشكك';

    const result = calculateCustomerReceivableAfterCollection({
      currentOutstandingBalance: customer.current_balance,
      collectionAmount,
    });

    const now = nowIso();
    const paymentDate = payload.payment_date || payload.paymentDate || todayDate();
    const payId = nextId(state.payments);
    const refNumber = generateRef('COL', payId);
    const newTotalPayments = roundMoney(customer.total_payments + collectionAmount);

    state.customers[custIdx] = {
      ...customer,
      total_payments: newTotalPayments,
      current_balance: result.newOutstandingBalance,
      status: result.status,
      last_transaction_at: now,
      updated_at: now,
    };

    let amountToAllocate = collectionAmount;
    const unpaidSaleIndices = state.sales
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => s.customer_id === customer.id && s.remaining_amount > 0)
      .sort((a, b) => a.s.id - b.s.id);

    for (const { s, idx } of unpaidSaleIndices) {
      if (amountToAllocate <= 0) break;
      const deduction = roundMoney(Math.min(s.remaining_amount, amountToAllocate));
      state.sales[idx] = {
        ...s,
        amount_paid: roundMoney(s.amount_paid + deduction),
        remaining_amount: roundMoney(s.remaining_amount - deduction),
        updated_at: now,
      };
      amountToAllocate = roundMoney(amountToAllocate - deduction);
    }

    state.payments.push({
      id: payId,
      reference_number: refNumber,
      customer_id: customer.id,
      sale_id: payload.sale_id ?? payload.saleId ?? null,
      payment_type: 'debt_collection',
      amount: collectionAmount,
      payment_method: paymentMethod,
      balance_before: customer.current_balance,
      balance_after: result.newOutstandingBalance,
      notes,
      payment_date: paymentDate,
      created_at: now,
    });

    const cashId = nextId(state.cashMovements);
    state.cashMovements.push({
      id: cashId,
      reference_number: `${refNumber}-CASH`,
      movement_type: 'debt_collection',
      direction: 'in',
      amount: collectionAmount,
      payment_method: paymentMethod,
      source_type: 'payment',
      source_id: payId,
      description: `تحصيل شكك من العميل (${customer.name}) — إيصال ${refNumber}`,
      movement_date: paymentDate,
      created_at: now,
    });

    saveStore(state);
    return {
      id: payId,
      reference_number: refNumber,
      new_balance: result.newOutstandingBalance,
      newBalance: result.newOutstandingBalance,
    };
  },

  createStocktake: async (payload: Record<string, any>) => {
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) {
      throw new Error('يجب إدخال صنف واحد على الأقل في جلسة الجرد');
    }

    const state = loadRawStore();
    const now = nowIso();
    const stocktakeDate = payload.stocktake_date || payload.stocktakeDate || todayDate();
    const rawScope = payload.scope_type ?? payload.scopeType;
    const scopeType: 'full' | 'partial' = rawScope === 'partial' ? 'partial' : 'full';
    const stocktakeId = nextId(state.stocktakes);
    const refNumber = generateRef('ST', stocktakeId);

    let discrepancyCount = 0;
    let totalDiscrepancyValue = 0;

    for (const item of items) {
      const prodId = Number(item.product_id ?? item.productId);
      const prodIdx = state.products.findIndex((p) => p.id === prodId);
      if (prodIdx < 0) continue;
      const product = state.products[prodIdx];
      const physicalBaseQty = roundQty(
        Math.max(0, Number(item.physical_base_qty ?? item.physicalBaseQty))
      );
      const systemBaseQty = roundQty(product.stock_base_qty);
      const differenceBaseQty = roundQty(physicalBaseQty - systemBaseQty);
      const financialImpact = roundMoney(differenceBaseQty * product.avg_cost_per_base);
      const reason = String(item.discrepancy_reason ?? item.discrepancyReason ?? '').trim();

      if (Math.abs(differenceBaseQty) > 0.0001) {
        discrepancyCount += 1;
        totalDiscrepancyValue = roundMoney(totalDiscrepancyValue + financialImpact);
      }

      const stItemId = nextId(state.stocktakeItems);
      state.stocktakeItems.push({
        id: stItemId,
        stocktake_id: stocktakeId,
        product_id: product.id,
        product_name_snapshot: product.name,
        sku_snapshot: product.sku,
        base_unit_snapshot: product.base_unit,
        system_base_qty: systemBaseQty,
        physical_base_qty: physicalBaseQty,
        difference_base_qty: differenceBaseQty,
        unit_cost_per_base: product.avg_cost_per_base,
        financial_impact: financialImpact,
        discrepancy_reason: reason,
        created_at: now,
      });

      if (Math.abs(differenceBaseQty) > 0.0001) {
        state.products[prodIdx] = {
          ...product,
          stock_base_qty: physicalBaseQty,
          last_movement_at: now,
          updated_at: now,
        };

        const movId = nextId(state.stockMovements);
        state.stockMovements.push({
          id: movId,
          reference_number: `${refNumber}-P${product.id}`,
          product_id: product.id,
          movement_type: 'stocktake_adjustment',
          base_qty_change: differenceBaseQty,
          balance_after_base: physicalBaseQty,
          unit_cost_per_base: product.avg_cost_per_base,
          source_type: 'stocktake',
          source_id: stocktakeId,
          notes: `تسوية جرد (${differenceBaseQty > 0 ? 'زيادة' : 'عجز'}): ${
            reason || 'اعتماد جرد فعلي'
          }`,
          movement_date: stocktakeDate,
          created_at: now,
        });
      }
    }

    state.stocktakes.push({
      id: stocktakeId,
      reference_number: refNumber,
      scope_type: scopeType,
      status: 'approved',
      total_items_counted: items.length,
      discrepancy_items_count: discrepancyCount,
      total_discrepancy_value: totalDiscrepancyValue,
      notes: payload.notes?.trim() || '',
      stocktake_date: stocktakeDate,
      created_at: now,
    });

    saveStore(state);
    return { id: stocktakeId, reference_number: refNumber };
  },

  createExpense: async (payload: Record<string, any>) => {
    const category = payload.category?.trim();
    const amount = roundMoney(Number(payload.amount));
    if (!category) {
      throw new Error('تصنيف المصروف مطلوب');
    }
    if (amount <= 0) {
      throw new Error('قيمة المصروف يجب أن تكون أكبر من صفر');
    }

    const state = loadRawStore();
    const now = nowIso();
    const expenseDate = payload.expense_date || payload.expenseDate || todayDate();
    const paymentMethod: PaymentMethod =
      payload.payment_method || payload.paymentMethod || 'cash';
    const description = payload.description?.trim() || '';
    const attachmentName = String(payload.attachment_name ?? '').trim();
    const expenseId = nextId(state.expenses);
    const refNumber = generateRef('EXP', expenseId);

    state.expenses.push({
      id: expenseId,
      reference_number: refNumber,
      category,
      amount,
      expense_date: expenseDate,
      payment_method: paymentMethod,
      description,
      attachment_name: attachmentName,
      created_at: now,
    });

    const cashId = nextId(state.cashMovements);
    state.cashMovements.push({
      id: cashId,
      reference_number: `${refNumber}-CASH`,
      movement_type: 'expense_payment',
      direction: 'out',
      amount,
      payment_method: paymentMethod,
      source_type: 'expense',
      source_id: expenseId,
      description: `مصروف تشغيلي (${category}): ${description || refNumber}`,
      movement_date: expenseDate,
      created_at: now,
    });

    saveStore(state);
    return { id: expenseId, reference_number: refNumber };
  },

  exportBackup: async () => {
    const state = loadRawStore();
    return {
      app: 'Fifi 50x50 Store Management System (Frontend LocalStorage)',
      version: '2.0.0',
      exportedAt: nowIso(),
      tables: {
        store_settings: [state.settings],
        product_categories: state.categories,
        selling_methods: state.sellingMethods || [],
        products: state.products,
        customers: state.customers,
        sales: state.sales,
        sale_items: state.saleItems,
        sales_returns: state.salesReturns,
        sales_return_items: state.salesReturnItems,
        payments: state.payments,
        purchases: state.purchases,
        purchase_items: state.purchaseItems,
        expenses: state.expenses,
        stock_movements: state.stockMovements,
        stocktakes: state.stocktakes,
        stocktake_items: state.stocktakeItems,
        cash_movements: state.cashMovements,
        inventory_transfers: state.inventoryTransfers,
      },
    };
  },

  createManualBackup: async () => {
    const state = loadRawStore();
    const backups = loadBackups();
    const createdAt = nowIso();
    const stamp = createdAt.replace(/[:.]/g, '-');
    const filename = `fifi-local-backup-${stamp}.json`;
    const serialized = JSON.stringify(state);
    const newBackup: StoredBackup = {
      filename,
      sizeBytes: new Blob([serialized]).size,
      createdAt,
      payload: state,
    };
    saveBackups([newBackup, ...backups]);
    return { ok: true, filename };
  },

  restoreBackup: async (backupPayload: Record<string, unknown>) => {
    const tables = (backupPayload?.tables || backupPayload) as Record<string, any>;
    if (!tables || typeof tables !== 'object') {
      throw new Error('ملف النسخة الاحتياطية غير صالح');
    }

    const current = loadRawStore();
    const restoredSettings =
      Array.isArray(tables.store_settings) && tables.store_settings[0]
        ? tables.store_settings[0]
        : tables.settings || current.settings;

    const nextState: StoreBootstrapData = {
      settings: { ...defaultSettings(), ...restoredSettings },
      categories: Array.isArray(tables.product_categories)
        ? tables.product_categories
        : Array.isArray(tables.categories)
        ? tables.categories
        : [],
      sellingMethods: Array.isArray(tables.selling_methods)
        ? tables.selling_methods
        : Array.isArray(tables.sellingMethods)
        ? tables.sellingMethods
        : [],
      products: Array.isArray(tables.products) ? tables.products : [],
      customers: Array.isArray(tables.customers) ? tables.customers : [],
      sales: Array.isArray(tables.sales) ? tables.sales : [],
      saleItems: Array.isArray(tables.sale_items)
        ? tables.sale_items
        : Array.isArray(tables.saleItems)
        ? tables.saleItems
        : [],
      salesReturns: Array.isArray(tables.sales_returns)
        ? tables.sales_returns
        : Array.isArray(tables.salesReturns)
        ? tables.salesReturns
        : [],
      salesReturnItems: Array.isArray(tables.sales_return_items)
        ? tables.sales_return_items
        : Array.isArray(tables.salesReturnItems)
        ? tables.salesReturnItems
        : [],
      payments: Array.isArray(tables.payments) ? tables.payments : [],
      purchases: Array.isArray(tables.purchases) ? tables.purchases : [],
      purchaseItems: Array.isArray(tables.purchase_items)
        ? tables.purchase_items
        : Array.isArray(tables.purchaseItems)
        ? tables.purchaseItems
        : [],
      expenses: Array.isArray(tables.expenses) ? tables.expenses : [],
      stockMovements: Array.isArray(tables.stock_movements)
        ? tables.stock_movements
        : Array.isArray(tables.stockMovements)
        ? tables.stockMovements
        : [],
      stocktakes: Array.isArray(tables.stocktakes) ? tables.stocktakes : [],
      stocktakeItems: Array.isArray(tables.stocktake_items)
        ? tables.stocktake_items
        : Array.isArray(tables.stocktakeItems)
        ? tables.stocktakeItems
        : [],
      cashMovements: Array.isArray(tables.cash_movements)
        ? tables.cash_movements
        : Array.isArray(tables.cashMovements)
        ? tables.cashMovements
        : [],
      inventoryTransfers: Array.isArray(tables.inventory_transfers)
        ? tables.inventory_transfers
        : Array.isArray(tables.inventoryTransfers)
        ? tables.inventoryTransfers
        : [],
      backups: [],
    };

    saveStore(nextState);
    return { ok: true };
  },
};

import { BaseUnit, ProductType, SellingUnitMode } from '../domain/calculations';

export type NavSection =
  | 'dashboard'
  | 'pos'
  | 'inventory'
  | 'credit'
  | 'transactions'
  | 'stocktaking'
  | 'finance'
  | 'reports'
  | 'settings';

export type PaymentMethod = 'cash' | 'card' | 'bank_transfer';

export interface StoreSettings {
  id: number;
  store_name: string;
  store_subtitle: string;
  phone: string;
  address: string;
  currency: string;
  low_stock_threshold: number;
  receipt_header: string;
  receipt_footer: string;
  opening_cash_configured: number;
  setup_completed: number;
  updated_at: string;
}

export interface ProductCategory {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface SellingMethod {
  id: number;
  name: string;
  product_type: 'individual' | 'carton' | 'bulk_liquid';
  default_units_per_carton: number;
  created_at: string;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  category_id: number | null;
  category_name?: string | null;
  product_type: ProductType;
  base_unit: BaseUnit;
  units_per_carton: number;
  container_size_ml: number;
  container_unit_label: string;
  stock_base_qty: number;
  avg_cost_per_base: number;
  purchase_price_input: number;
  selling_price_primary: number;
  selling_price_carton: number;
  selling_price_per_liter: number;
  min_stock_threshold_base: number;
  cost_incomplete_flag: number;
  is_archived: number;
  notes: string;
  last_movement_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  notes: string;
  total_credit_purchases: number;
  total_payments: number;
  total_returns: number;
  current_balance: number;
  status: 'settled' | 'outstanding';
  last_transaction_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sale {
  id: number;
  invoice_number: string;
  idempotency_key: string | null;
  customer_id: number | null;
  customer_name?: string | null;
  sale_type: 'cash' | 'credit' | 'partial';
  subtotal: number;
  discount: number;
  total_amount: number;
  total_cogs: number;
  amount_paid: number;
  remaining_amount: number;
  payment_method: PaymentMethod;
  status: 'confirmed' | 'partially_returned' | 'returned';
  notes: string;
  sale_date: string;
  created_at: string;
  updated_at: string;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  product_name_snapshot: string;
  sku_snapshot: string;
  product_type_snapshot: ProductType;
  selling_unit_mode: SellingUnitMode;
  selling_unit_label: string;
  selling_unit_qty: number;
  base_unit_qty: number;
  unit_selling_price: number;
  unit_cost_snapshot_per_base: number;
  total_line_cost: number;
  line_total: number;
  returned_base_qty: number;
  cost_incomplete_snapshot: number;
  created_at: string;
}

export interface SalesReturn {
  id: number;
  return_number: string;
  sale_id: number;
  invoice_number?: string;
  customer_id: number | null;
  customer_name?: string | null;
  total_return_amount: number;
  total_return_cogs: number;
  resellable_cogs_reversed: number;
  damaged_loss_amount: number;
  refund_cash_amount: number;
  credit_balance_reduction: number;
  payment_method: PaymentMethod;
  condition_type: 'resellable' | 'damaged';
  reason: string;
  return_date: string;
  created_at: string;
}

export interface SalesReturnItem {
  id: number;
  return_id: number;
  sale_item_id: number;
  product_id: number;
  product_name_snapshot: string;
  returned_selling_qty: number;
  returned_base_qty: number;
  refund_amount: number;
  cost_reversed: number;
  condition_type: 'resellable' | 'damaged';
  created_at: string;
}

export interface PaymentRecord {
  id: number;
  reference_number: string;
  customer_id: number;
  customer_name?: string;
  sale_id: number | null;
  invoice_number?: string | null;
  payment_type: 'sale_initial' | 'debt_collection' | 'refund' | 'balance_adjustment';
  amount: number;
  payment_method: PaymentMethod;
  balance_before: number;
  balance_after: number;
  notes: string;
  payment_date: string;
  created_at: string;
}

export interface Purchase {
  id: number;
  reference_number: string;
  supplier_name: string;
  purchase_date: string;
  total_cost: number;
  amount_paid: number;
  payment_status: 'paid' | 'unpaid';
  payment_method: PaymentMethod;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface PurchaseItem {
  id: number;
  purchase_id: number;
  product_id: number;
  product_name_snapshot: string;
  purchase_unit_mode: string;
  purchase_unit_label: string;
  purchased_qty: number;
  base_unit_qty: number;
  total_cost: number;
  unit_cost_per_base: number;
  prev_stock_base: number;
  prev_avg_cost_per_base: number;
  new_avg_cost_per_base: number;
  created_at: string;
}

export interface ExpenseRecord {
  id: number;
  reference_number: string;
  category: string;
  amount: number;
  expense_date: string;
  payment_method: PaymentMethod;
  description: string;
  attachment_name: string;
  created_at: string;
}

export interface StockMovement {
  id: number;
  reference_number: string;
  product_id: number;
  product_name?: string;
  product_sku?: string;
  product_type?: ProductType;
  base_unit?: BaseUnit;
  movement_type:
    | 'opening_stock'
    | 'purchase'
    | 'sale'
    | 'sale_return_resellable'
    | 'sale_return_damaged'
    | 'stocktake_adjustment'
    | 'liquid_filling_out'
    | 'liquid_filling_in'
    | 'manual_adjustment';
  base_qty_change: number;
  balance_after_base: number;
  unit_cost_per_base: number;
  source_type: string;
  source_id: number | null;
  notes: string;
  movement_date: string;
  created_at: string;
}

export interface Stocktake {
  id: number;
  reference_number: string;
  scope_type: 'full' | 'partial';
  status: 'approved';
  total_items_counted: number;
  discrepancy_items_count: number;
  total_discrepancy_value: number;
  notes: string;
  stocktake_date: string;
  created_at: string;
}

export interface StocktakeItem {
  id: number;
  stocktake_id: number;
  product_id: number;
  product_name_snapshot: string;
  sku_snapshot: string;
  base_unit_snapshot: BaseUnit;
  system_base_qty: number;
  physical_base_qty: number;
  difference_base_qty: number;
  unit_cost_per_base: number;
  financial_impact: number;
  discrepancy_reason: string;
  created_at: string;
}

export interface CashMovement {
  id: number;
  reference_number: string;
  movement_type:
    | 'opening_balance'
    | 'cash_sale'
    | 'partial_sale_payment'
    | 'debt_collection'
    | 'purchase_payment'
    | 'expense_payment'
    | 'sales_refund';
  direction: 'in' | 'out';
  amount: number;
  payment_method: PaymentMethod;
  source_type: string;
  source_id: number | null;
  description: string;
  movement_date: string;
  created_at: string;
}

export interface InventoryTransfer {
  id: number;
  reference_number: string;
  bulk_product_id: number;
  bulk_product_name?: string;
  packaged_product_id: number;
  packaged_product_name?: string;
  bulk_ml_used: number;
  containers_filled: number;
  container_size_ml: number;
  transferred_cost: number;
  notes: string;
  transfer_date: string;
  created_at: string;
}

export interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export interface StoreBootstrapData {
  settings: StoreSettings;
  categories: ProductCategory[];
  sellingMethods?: SellingMethod[];
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  saleItems: SaleItem[];
  salesReturns: SalesReturn[];
  salesReturnItems: SalesReturnItem[];
  payments: PaymentRecord[];
  purchases: Purchase[];
  purchaseItems: PurchaseItem[];
  expenses: ExpenseRecord[];
  stockMovements: StockMovement[];
  stocktakes: Stocktake[];
  stocktakeItems: StocktakeItem[];
  cashMovements: CashMovement[];
  inventoryTransfers: InventoryTransfer[];
  backups: BackupFileInfo[];
}

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateCustomerReceivableAfterCollection,
  calculateLiquidFillingTransfer,
  calculateMovingAverageCost,
  ProductType,
  roundMoney,
  roundQty,
  roundUnitCost,
  toBaseQuantity,
} from '../domain/calculations';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUP_DIR = path.resolve(DATA_DIR, 'backups');
const DB_PATH = path.resolve(DATA_DIR, 'fifi_50x50.sqlite');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign key enforcement
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA synchronous = NORMAL;');

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const usedSalt = salt || crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, usedSalt, 64).toString('hex');
  return { hash: derivedKey, salt: usedSalt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

export function generateReference(prefix: string): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  const seq = Math.floor(Math.random() * 900 + 100);
  return `${prefix}-${y}${m}${d}-${seq}${rand}`;
}

export function runInTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error if already rolled back
    }
    throw err;
  }
}

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      store_name TEXT NOT NULL DEFAULT 'فيفي 50×50',
      store_subtitle TEXT NOT NULL DEFAULT 'للمنظفات المنزلية والورقيات',
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'ج.م',
      low_stock_threshold INTEGER NOT NULL DEFAULT 10,
      receipt_header TEXT NOT NULL DEFAULT 'محل فيفي 50×50 للمنظفات المنزلية',
      receipt_footer TEXT NOT NULL DEFAULT 'شكراً لتعاملكم معنا - البضاعة المباعة ترد وتستبدل وفق سياسة المحل',
      opening_cash_configured INTEGER NOT NULL DEFAULT 0,
      setup_completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS selling_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      product_type TEXT NOT NULL DEFAULT 'individual' CHECK (product_type IN ('individual', 'carton', 'bulk_liquid')),
      default_units_per_carton INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      category_id INTEGER,
      product_type TEXT NOT NULL CHECK (product_type IN ('individual', 'carton', 'bulk_liquid', 'packaged_liquid')),
      base_unit TEXT NOT NULL CHECK (base_unit IN ('unit', 'ml', 'container')),
      units_per_carton INTEGER NOT NULL DEFAULT 1,
      container_size_ml NUMERIC NOT NULL DEFAULT 0,
      container_unit_label TEXT NOT NULL DEFAULT 'عبوة',
      stock_base_qty NUMERIC NOT NULL DEFAULT 0 CHECK (stock_base_qty >= 0),
      avg_cost_per_base NUMERIC NOT NULL DEFAULT 0 CHECK (avg_cost_per_base >= 0),
      purchase_price_input NUMERIC NOT NULL DEFAULT 0,
      selling_price_primary NUMERIC NOT NULL DEFAULT 0 CHECK (selling_price_primary >= 0),
      selling_price_carton NUMERIC NOT NULL DEFAULT 0 CHECK (selling_price_carton >= 0),
      selling_price_per_liter NUMERIC NOT NULL DEFAULT 0 CHECK (selling_price_per_liter >= 0),
      min_stock_threshold_base NUMERIC NOT NULL DEFAULT 5,
      cost_incomplete_flag INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      last_movement_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      total_credit_purchases NUMERIC NOT NULL DEFAULT 0,
      total_payments NUMERIC NOT NULL DEFAULT 0,
      total_returns NUMERIC NOT NULL DEFAULT 0,
      current_balance NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'settled' CHECK (status IN ('settled', 'outstanding')),
      last_transaction_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT UNIQUE,
      customer_id INTEGER,
      sale_type TEXT NOT NULL CHECK (sale_type IN ('cash', 'credit', 'partial')),
      subtotal NUMERIC NOT NULL DEFAULT 0,
      discount NUMERIC NOT NULL DEFAULT 0,
      total_amount NUMERIC NOT NULL DEFAULT 0,
      total_cogs NUMERIC NOT NULL DEFAULT 0,
      amount_paid NUMERIC NOT NULL DEFAULT 0,
      remaining_amount NUMERIC NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'bank_transfer')),
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'partially_returned', 'returned')),
      notes TEXT NOT NULL DEFAULT '',
      sale_date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name_snapshot TEXT NOT NULL,
      sku_snapshot TEXT NOT NULL,
      product_type_snapshot TEXT NOT NULL,
      selling_unit_mode TEXT NOT NULL,
      selling_unit_label TEXT NOT NULL,
      selling_unit_qty NUMERIC NOT NULL,
      base_unit_qty NUMERIC NOT NULL,
      unit_selling_price NUMERIC NOT NULL,
      unit_cost_snapshot_per_base NUMERIC NOT NULL,
      total_line_cost NUMERIC NOT NULL,
      line_total NUMERIC NOT NULL,
      returned_base_qty NUMERIC NOT NULL DEFAULT 0,
      cost_incomplete_snapshot INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

    CREATE TABLE IF NOT EXISTS sales_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT UNIQUE,
      sale_id INTEGER NOT NULL,
      customer_id INTEGER,
      total_return_amount NUMERIC NOT NULL DEFAULT 0,
      total_return_cogs NUMERIC NOT NULL DEFAULT 0,
      resellable_cogs_reversed NUMERIC NOT NULL DEFAULT 0,
      damaged_loss_amount NUMERIC NOT NULL DEFAULT 0,
      refund_cash_amount NUMERIC NOT NULL DEFAULT 0,
      credit_balance_reduction NUMERIC NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      condition_type TEXT NOT NULL CHECK (condition_type IN ('resellable', 'damaged')),
      reason TEXT NOT NULL,
      return_date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS sales_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL,
      sale_item_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name_snapshot TEXT NOT NULL,
      returned_selling_qty NUMERIC NOT NULL,
      returned_base_qty NUMERIC NOT NULL,
      refund_amount NUMERIC NOT NULL,
      cost_reversed NUMERIC NOT NULL,
      condition_type TEXT NOT NULL CHECK (condition_type IN ('resellable', 'damaged')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (return_id) REFERENCES sales_returns(id) ON DELETE CASCADE,
      FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT UNIQUE,
      customer_id INTEGER NOT NULL,
      sale_id INTEGER,
      payment_type TEXT NOT NULL CHECK (payment_type IN ('sale_initial', 'debt_collection', 'refund', 'balance_adjustment')),
      amount NUMERIC NOT NULL CHECK (amount > 0),
      payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'bank_transfer')),
      balance_before NUMERIC NOT NULL DEFAULT 0,
      balance_after NUMERIC NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      payment_date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
    CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT UNIQUE,
      supplier_name TEXT NOT NULL DEFAULT '',
      purchase_date TEXT NOT NULL DEFAULT (date('now')),
      total_cost NUMERIC NOT NULL DEFAULT 0,
      amount_paid NUMERIC NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL CHECK (payment_status IN ('paid', 'unpaid')),
      payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'bank_transfer')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name_snapshot TEXT NOT NULL,
      purchase_unit_mode TEXT NOT NULL,
      purchase_unit_label TEXT NOT NULL,
      purchased_qty NUMERIC NOT NULL,
      base_unit_qty NUMERIC NOT NULL,
      total_cost NUMERIC NOT NULL,
      unit_cost_per_base NUMERIC NOT NULL,
      prev_stock_base NUMERIC NOT NULL,
      prev_avg_cost_per_base NUMERIC NOT NULL,
      new_avg_cost_per_base NUMERIC NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT UNIQUE,
      category TEXT NOT NULL,
      amount NUMERIC NOT NULL CHECK (amount > 0),
      expense_date TEXT NOT NULL DEFAULT (date('now')),
      payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'bank_transfer')),
      description TEXT NOT NULL DEFAULT '',
      attachment_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_number TEXT NOT NULL UNIQUE,
      product_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL CHECK (
        movement_type IN (
          'opening_stock',
          'purchase',
          'sale',
          'sale_return_resellable',
          'sale_return_damaged',
          'stocktake_adjustment',
          'liquid_filling_out',
          'liquid_filling_in',
          'manual_adjustment'
        )
      ),
      base_qty_change NUMERIC NOT NULL,
      balance_after_base NUMERIC NOT NULL,
      unit_cost_per_base NUMERIC NOT NULL DEFAULT 0,
      source_type TEXT NOT NULL,
      source_id INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      movement_date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(movement_date);

    CREATE TABLE IF NOT EXISTS stocktakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT UNIQUE,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('full', 'partial')),
      status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved')),
      total_items_counted INTEGER NOT NULL DEFAULT 0,
      discrepancy_items_count INTEGER NOT NULL DEFAULT 0,
      total_discrepancy_value NUMERIC NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      stocktake_date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stocktake_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stocktake_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name_snapshot TEXT NOT NULL,
      sku_snapshot TEXT NOT NULL,
      base_unit_snapshot TEXT NOT NULL,
      system_base_qty NUMERIC NOT NULL,
      physical_base_qty NUMERIC NOT NULL,
      difference_base_qty NUMERIC NOT NULL,
      unit_cost_per_base NUMERIC NOT NULL,
      financial_impact NUMERIC NOT NULL,
      discrepancy_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (stocktake_id) REFERENCES stocktakes(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_number TEXT NOT NULL UNIQUE,
      movement_type TEXT NOT NULL CHECK (
        movement_type IN (
          'opening_balance',
          'cash_sale',
          'partial_sale_payment',
          'debt_collection',
          'purchase_payment',
          'expense_payment',
          'sales_refund'
        )
      ),
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      amount NUMERIC NOT NULL CHECK (amount >= 0),
      payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'bank_transfer')),
      source_type TEXT NOT NULL,
      source_id INTEGER,
      description TEXT NOT NULL DEFAULT '',
      movement_date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cash_movements_date ON cash_movements(movement_date);

    CREATE TABLE IF NOT EXISTS inventory_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT UNIQUE,
      bulk_product_id INTEGER NOT NULL,
      packaged_product_id INTEGER NOT NULL,
      bulk_ml_used NUMERIC NOT NULL CHECK (bulk_ml_used > 0),
      containers_filled INTEGER NOT NULL CHECK (containers_filled > 0),
      container_size_ml NUMERIC NOT NULL CHECK (container_size_ml > 0),
      transferred_cost NUMERIC NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      transfer_date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (bulk_product_id) REFERENCES products(id) ON DELETE RESTRICT,
      FOREIGN KEY (packaged_product_id) REFERENCES products(id) ON DELETE RESTRICT
    );
  `);

  // Ensure default settings row exists
  const settingsRow = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!settingsRow) {
    db.prepare(`
      INSERT INTO settings (id, store_name, store_subtitle, currency, low_stock_threshold, opening_cash_configured, setup_completed)
      VALUES (1, 'فيفي 50×50', 'للمنظفات المنزلية والورقيات', 'ج.م', 10, 0, 1)
    `).run();
  }

  // Clean up previously auto-seeded default categories if no products are linked to them
  const prodCount = db.prepare('SELECT COUNT(*) as cnt FROM products').get() as any;
  if (!prodCount || Number(prodCount.cnt) === 0) {
    db.prepare(
      `DELETE FROM product_categories WHERE name IN ('منظفات أرضيات', 'كلور ومبيضات', 'صابون سائل', 'مساحيق غسيل', 'منظفات عامة')`
    ).run();
  }

  // Ensure owner account exists with scrypt hashed password
  const userRow = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!userRow) {
    const { hash, salt } = hashPassword('fifi5050');
    db.prepare(`
      INSERT INTO users (username, display_name, password_hash, password_salt, role)
      VALUES ('admin', 'مالك المحل (فيفي 50×50)', ?, ?, 'owner')
    `).run(hash, salt);
  }
}

export function createAutomatedBackup(reason: string): string {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `fifi_backup_${reason}_${timestamp}.json`;
    const fullPath = path.join(BACKUP_DIR, filename);
    const dump = exportDatabaseSnapshot();
    fs.writeFileSync(fullPath, JSON.stringify(dump, null, 2), 'utf-8');

    // Keep most recent 20 automated backups
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const old of files.slice(20)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old.name));
    }
    return filename;
  } catch (err) {
    console.error('Automated backup error:', err);
    return '';
  }
}

export function exportDatabaseSnapshot() {
  const tables = [
    'settings',
    'product_categories',
    'selling_methods',
    'products',
    'customers',
    'sales',
    'sale_items',
    'sales_returns',
    'sales_return_items',
    'payments',
    'purchases',
    'purchase_items',
    'expenses',
    'stock_movements',
    'stocktakes',
    'stocktake_items',
    'cash_movements',
    'inventory_transfers',
  ];

  const data: Record<string, unknown[]> = {};
  for (const table of tables) {
    data[table] = db.prepare(`SELECT * FROM ${table}`).all();
  }

  return {
    app: 'Fifi 50x50 Store Management System',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function restoreDatabaseSnapshot(snapshot: { data: Record<string, any[]> }): void {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.data) {
    throw new Error('ملف النسخة الاحتياطية غير صالح');
  }

  const orderedTables = [
    'settings',
    'product_categories',
    'selling_methods',
    'products',
    'customers',
    'sales',
    'sale_items',
    'sales_returns',
    'sales_return_items',
    'payments',
    'purchases',
    'purchase_items',
    'expenses',
    'stock_movements',
    'stocktakes',
    'stocktake_items',
    'cash_movements',
    'inventory_transfers',
  ];

  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    runInTransaction(() => {
      for (const table of [...orderedTables].reverse()) {
        db.exec(`DELETE FROM ${table};`);
      }

      for (const table of orderedTables) {
        const rows = snapshot.data[table];
        if (Array.isArray(rows) && rows.length > 0) {
          const cols = Object.keys(rows[0]);
          const placeholders = cols.map(() => '?').join(', ');
          const stmt = db.prepare(
            `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`
          );
          for (const row of rows) {
            stmt.run(...cols.map((c) => row[c] ?? null));
          }
        }
      }
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

export function listSavedBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return {
        filename: f,
        sizeBytes: stat.size,
        createdAt: new Date(stat.mtimeMs).toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

initializeDatabase();

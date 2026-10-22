import crypto from 'node:crypto';
import path from 'node:path';
import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  createAutomatedBackup,
  db,
  exportDatabaseSnapshot,
  generateReference,
  hashPassword,
  listSavedBackups,
  restoreDatabaseSnapshot,
  runInTransaction,
  verifyPassword,
} from './src/db/database';
import {
  calculateCustomerReceivableAfterCollection,
  calculateLiquidFillingTransfer,
  calculateMovingAverageCost,
  ProductType,
  roundMoney,
  roundQty,
  roundUnitCost,
  toBaseQuantity,
} from './src/domain/calculations';

const app = express();
app.use(express.json({ limit: '15mb' }));

// Helper to extract bearer token
function getTokenFromReq(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

// Authentication middleware for protected /api routes
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getTokenFromReq(req);
  if (!token) {
    res.status(401).json({ error: 'يرجى تسجيل الدخول للمتابعة' });
    return;
  }
  const session = db
    .prepare(
      `SELECT s.token, s.expires_at, u.id as user_id, u.username, u.display_name, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as any;

  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    res.status(401).json({ error: 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول' });
    return;
  }

  (req as any).user = {
    id: session.user_id,
    username: session.username,
    displayName: session.display_name,
    role: session.role,
  };
  next();
}

// ==================== AUTH ROUTES ====================

app.post('/api/auth/bootstrap-session', (req: Request, res: Response) => {
  const existingToken = getTokenFromReq(req);
  if (existingToken) {
    const valid = db
      .prepare(
        `SELECT s.token, u.id, u.username, u.display_name, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > datetime('now')`
      )
      .get(existingToken) as any;
    if (valid) {
      res.json({
        token: valid.token,
        user: {
          id: valid.id,
          username: valid.username,
          displayName: valid.display_name,
          role: valid.role,
        },
      });
      return;
    }
  }

  // Only allow auto-bootstrap if client did not explicitly log out
  const explicitLogout = req.body?.explicitLogout === true;
  if (explicitLogout) {
    res.status(401).json({ error: 'يلزم تسجيل الدخول' });
    return;
  }

  const owner = db.prepare('SELECT id, username, display_name, role FROM users LIMIT 1').get() as any;
  if (!owner) {
    res.status(500).json({ error: 'لم يتم العثور على حساب المالك' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    owner.id,
    expiresAt
  );

  res.json({
    token,
    user: {
      id: owner.id,
      username: owner.username,
      displayName: owner.display_name,
      role: owner.role,
    },
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { username = 'admin', password = '' } = req.body || {};
  const user = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(username).trim()) as any;

  if (!user || !verifyPassword(String(password), user.password_hash, user.password_salt)) {
    res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    user.id,
    expiresAt
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    },
  });
});

app.post('/api/auth/logout', requireAuth, (req: Request, res: Response) => {
  const token = getTokenFromReq(req);
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.json({ ok: true });
});

app.post('/api/auth/change-password', requireAuth, (req: Request, res: Response) => {
  const { currentPassword, newPassword, displayName } = req.body || {};
  const userId = (req as any).user.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;

  if (!user || !verifyPassword(String(currentPassword || ''), user.password_hash, user.password_salt)) {
    res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    return;
  }

  if (!newPassword || String(newPassword).length < 4) {
    res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن 4 أحرف' });
    return;
  }

  const { hash, salt } = hashPassword(String(newPassword));
  db.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, display_name = COALESCE(?, display_name), updated_at = datetime('now') WHERE id = ?`
  ).run(hash, salt, displayName ? String(displayName).trim() : null, userId);

  res.json({ ok: true });
});

// ==================== BOOTSTRAP STATE ====================

app.get('/api/bootstrap', requireAuth, (_req: Request, res: Response) => {
  try {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const categories = db.prepare('SELECT * FROM product_categories ORDER BY id ASC').all();
    const sellingMethods = db.prepare('SELECT * FROM selling_methods ORDER BY id ASC').all();
    const products = db
      .prepare(
        `SELECT p.*, c.name as category_name
         FROM products p
         LEFT JOIN product_categories c ON c.id = p.category_id
         ORDER BY p.is_archived ASC, p.id DESC`
      )
      .all();
    const customers = db.prepare('SELECT * FROM customers ORDER BY current_balance DESC, id DESC').all();
    const sales = db
      .prepare(
        `SELECT s.*, c.name as customer_name
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         ORDER BY s.id DESC`
      )
      .all();
    const saleItems = db.prepare('SELECT * FROM sale_items ORDER BY id ASC').all();
    const salesReturns = db
      .prepare(
        `SELECT sr.*, s.invoice_number, c.name as customer_name
         FROM sales_returns sr
         JOIN sales s ON s.id = sr.sale_id
         LEFT JOIN customers c ON c.id = sr.customer_id
         ORDER BY sr.id DESC`
      )
      .all();
    const salesReturnItems = db.prepare('SELECT * FROM sales_return_items ORDER BY id ASC').all();
    const payments = db
      .prepare(
        `SELECT p.*, c.name as customer_name, s.invoice_number
         FROM payments p
         JOIN customers c ON c.id = p.customer_id
         LEFT JOIN sales s ON s.id = p.sale_id
         ORDER BY p.id DESC`
      )
      .all();
    const purchases = db.prepare('SELECT * FROM purchases ORDER BY id DESC').all();
    const purchaseItems = db.prepare('SELECT * FROM purchase_items ORDER BY id ASC').all();
    const expenses = db.prepare('SELECT * FROM expenses ORDER BY id DESC').all();
    const stockMovements = db
      .prepare(
        `SELECT sm.*, p.name as product_name, p.sku as product_sku, p.product_type, p.base_unit
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         ORDER BY sm.id DESC`
      )
      .all();
    const stocktakes = db.prepare('SELECT * FROM stocktakes ORDER BY id DESC').all();
    const stocktakeItems = db.prepare('SELECT * FROM stocktake_items ORDER BY id ASC').all();
    const cashMovements = db.prepare('SELECT * FROM cash_movements ORDER BY id DESC').all();
    const inventoryTransfers = db
      .prepare(
        `SELECT it.*, bp.name as bulk_product_name, pp.name as packaged_product_name
         FROM inventory_transfers it
         JOIN products bp ON bp.id = it.bulk_product_id
         JOIN products pp ON pp.id = it.packaged_product_id
         ORDER BY it.id DESC`
      )
      .all();
    const backups = listSavedBackups();

    res.json({
      settings,
      categories,
      sellingMethods,
      products,
      customers,
      sales,
      saleItems,
      salesReturns,
      salesReturnItems,
      payments,
      purchases,
      purchaseItems,
      expenses,
      stockMovements,
      stocktakes,
      stocktakeItems,
      cashMovements,
      inventoryTransfers,
      backups,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل تحميل بيانات النظام' });
  }
});

// ==================== SETTINGS & OPENING CASH ====================

app.put('/api/settings', requireAuth, (req: Request, res: Response) => {
  try {
    const {
      store_name = 'فيفي 50×50',
      store_subtitle = 'للمنظفات المنزلية والورقيات',
      phone = '',
      address = '',
      low_stock_threshold = 10,
      receipt_header = '',
      receipt_footer = '',
      setup_completed,
    } = req.body || {};

    db.prepare(
      `UPDATE settings
       SET store_name = ?,
           store_subtitle = ?,
           phone = ?,
           address = ?,
           low_stock_threshold = ?,
           receipt_header = ?,
           receipt_footer = ?,
           setup_completed = COALESCE(?, setup_completed),
           updated_at = datetime('now')
       WHERE id = 1`
    ).run(
      String(store_name).trim() || 'فيفي 50×50',
      String(store_subtitle).trim(),
      String(phone).trim(),
      String(address).trim(),
      Math.max(0, Number(low_stock_threshold) || 10),
      String(receipt_header).trim(),
      String(receipt_footer).trim(),
      setup_completed !== undefined ? (setup_completed ? 1 : 0) : null
    );

    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/settings/opening-cash', requireAuth, (req: Request, res: Response) => {
  try {
    const { amount, movementDate, notes } = req.body || {};
    const numAmount = roundMoney(Number(amount));
    if (numAmount < 0 || !Number.isFinite(numAmount)) {
      res.status(400).json({ error: 'رصيد الخزنة الافتتاحي يجب أن يكون رقماً موجباً أو صفراً' });
      return;
    }

    const dateStr = movementDate || new Date().toISOString().slice(0, 10);

    runInTransaction(() => {
      const existing = db
        .prepare("SELECT id FROM cash_movements WHERE movement_type = 'opening_balance' LIMIT 1")
        .get() as any;

      if (existing) {
        db.prepare(
          `UPDATE cash_movements
           SET amount = ?, movement_date = ?, description = ?
           WHERE id = ?`
        ).run(
          numAmount,
          dateStr,
          notes ? String(notes).trim() : 'رصيد الخزنة الافتتاحي عند بدء التشغيل',
          existing.id
        );
      } else {
        db.prepare(
          `INSERT INTO cash_movements (
            reference_number, movement_type, direction, amount, payment_method, source_type, description, movement_date
          ) VALUES (?, 'opening_balance', 'in', ?, 'cash', 'opening_setup', ?, ?)`
        ).run(
          generateReference('OPN'),
          numAmount,
          notes ? String(notes).trim() : 'رصيد الخزنة الافتتاحي عند بدء التشغيل',
          dateStr
        );
      }

      db.prepare('UPDATE settings SET opening_cash_configured = 1, updated_at = datetime(\'now\') WHERE id = 1').run();
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== CATEGORIES ====================

app.post('/api/categories', requireAuth, (req: Request, res: Response) => {
  try {
    const { name, description = '' } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'يرجى إدخال اسم التصنيف' });
      return;
    }
    const existing = db.prepare('SELECT id FROM product_categories WHERE name = ?').get(cleanName);
    if (existing) {
      res.status(400).json({ error: 'هذا التصنيف موجود بالفعل' });
      return;
    }
    const info = db
      .prepare('INSERT INTO product_categories (name, description) VALUES (?, ?)')
      .run(cleanName, String(description).trim());
    res.json({ id: Number(info.lastInsertRowid), name: cleanName });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/categories/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { name, description = '' } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'يرجى إدخال اسم التصنيف' });
      return;
    }
    db.prepare(
      `UPDATE product_categories SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(cleanName, String(description).trim(), id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM product_categories WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== SELLING METHODS ====================

app.post('/api/selling-methods', requireAuth, (req: Request, res: Response) => {
  try {
    const { name, product_type, default_units_per_carton = 1 } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'يرجى إدخال اسم طريقة البيع' });
      return;
    }
    const existing = db.prepare('SELECT id FROM selling_methods WHERE name = ?').get(cleanName);
    if (existing) {
      res.status(400).json({ error: 'طريقة البيع هذه موجودة بالفعل' });
      return;
    }

    // Automatically infer product_type if not explicitly provided
    let resolvedType: 'individual' | 'carton' | 'bulk_liquid' = 'individual';
    if (product_type === 'carton' || product_type === 'bulk_liquid' || product_type === 'individual') {
      resolvedType = product_type;
    } else if (cleanName.includes('كرتون') || cleanName.includes('دست') || cleanName.includes('باكيت')) {
      resolvedType = 'carton';
    } else if (cleanName.includes('لتر') || cleanName.includes('سائل')) {
      resolvedType = 'bulk_liquid';
    }

    const units = resolvedType === 'carton' ? Math.max(2, Number(default_units_per_carton) || 12) : 1;

    const info = db
      .prepare(
        'INSERT INTO selling_methods (name, product_type, default_units_per_carton) VALUES (?, ?, ?)'
      )
      .run(cleanName, resolvedType, units);

    res.json({
      id: Number(info.lastInsertRowid),
      name: cleanName,
      product_type: resolvedType,
      default_units_per_carton: units,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/selling-methods/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM selling_methods WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== PRODUCTS & INVENTORY ====================

app.post('/api/products', requireAuth, (req: Request, res: Response) => {
  try {
    const {
      name,
      sku,
      category_id,
      product_type,
      units_per_carton = 1,
      container_size_ml = 0,
      container_unit_label = 'عبوة',
      initial_quantity = 0,
      initial_unit_mode,
      purchase_cost_input = 0,
      selling_price_primary = 0,
      selling_price_carton = 0,
      selling_price_per_liter = 0,
      min_stock_threshold = 5,
      notes = '',
      opening_date,
    } = req.body || {};

    const cleanName = String(name || '').trim();
    const autoSku = `PRD-${Date.now().toString().slice(-5)}-${Math.floor(10 + Math.random() * 89)}`;
    const cleanSku = String(sku || '').trim().toUpperCase() || autoSku;
    if (!cleanName) {
      res.status(400).json({ error: 'يرجى إدخال اسم المنتج' });
      return;
    }

    const duplicateSku = db.prepare('SELECT id FROM products WHERE sku = ?').get(cleanSku);
    if (duplicateSku) {
      res.status(400).json({ error: `كود المنتج (${cleanSku}) مستخدم بالفعل لمنتج آخر` });
      return;
    }

    const validTypes: ProductType[] = ['individual', 'carton', 'bulk_liquid', 'packaged_liquid'];
    if (!validTypes.includes(product_type)) {
      res.status(400).json({ error: 'نوع المنتج غير صالح' });
      return;
    }

    const baseUnit =
      product_type === 'bulk_liquid'
        ? 'ml'
        : product_type === 'packaged_liquid'
        ? 'container'
        : 'unit';

    const numUnitsPerCarton =
      product_type === 'carton' ? Math.max(1, Math.floor(Number(units_per_carton) || 1)) : 1;
    if (product_type === 'carton' && numUnitsPerCarton < 2) {
      res.status(400).json({ error: 'منتج الكرتونة يجب أن يحتوي على وحدتين أو أكثر داخل الكرتونة' });
      return;
    }

    const numContainerSizeMl =
      product_type === 'packaged_liquid' ? Math.max(1, Number(container_size_ml) || 1000) : 0;

    const initQtyInput = Math.max(0, Number(initial_quantity) || 0);
    const defaultMode =
      product_type === 'carton'
        ? 'carton'
        : product_type === 'bulk_liquid'
        ? 'liter'
        : product_type === 'packaged_liquid'
        ? 'container'
        : 'unit';

    const stockBaseQty = toBaseQuantity({
      productType: product_type,
      quantity: initQtyInput,
      unitMode: initial_unit_mode || defaultMode,
      unitsPerCarton: numUnitsPerCarton,
    });

    // Compute base unit purchase cost:
    // - individual: purchase_cost_input is cost per 1 unit
    // - carton: purchase_cost_input is cost per 1 carton => cost per base unit = carton_cost / units_per_carton
    // - bulk_liquid: purchase_cost_input is total purchase cost for initial volume (or cost per liter if initial_quantity == 0)
    // - packaged_liquid: purchase_cost_input is cost per 1 container
    const rawPurchaseInput = Math.max(0, Number(purchase_cost_input) || 0);
    let avgCostPerBase = 0;

    if (product_type === 'individual') {
      avgCostPerBase = roundUnitCost(rawPurchaseInput);
    } else if (product_type === 'carton') {
      avgCostPerBase = roundUnitCost(rawPurchaseInput / numUnitsPerCarton);
    } else if (product_type === 'bulk_liquid') {
      // For bulk liquid, purchase_cost_input can be specified as total cost for the initial volume,
      // or if initial_quantity === 0, cost per liter
      if (stockBaseQty > 0) {
        avgCostPerBase = roundUnitCost(rawPurchaseInput / stockBaseQty);
      } else {
        avgCostPerBase = roundUnitCost(rawPurchaseInput / 1000);
      }
    } else if (product_type === 'packaged_liquid') {
      avgCostPerBase = roundUnitCost(rawPurchaseInput);
    }

    const costIncompleteFlag = stockBaseQty > 0 && avgCostPerBase <= 0 ? 1 : 0;

    const minThresholdInput = Math.max(0, Number(min_stock_threshold) || 0);
    const minThresholdBase =
      product_type === 'bulk_liquid' && (initial_unit_mode || defaultMode) === 'liter'
        ? roundQty(minThresholdInput * 1000)
        : minThresholdInput;

    const primarySellingPrice = roundMoney(Math.max(0, Number(selling_price_primary) || 0));
    const cartonSellingPrice = roundMoney(Math.max(0, Number(selling_price_carton) || 0));
    const literSellingPrice =
      product_type === 'bulk_liquid'
        ? roundMoney(Math.max(0, Number(selling_price_per_liter || selling_price_primary) || 0))
        : 0;

    const dateStr = opening_date || new Date().toISOString().slice(0, 10);

    const productId = runInTransaction(() => {
      const info = db
        .prepare(
          `INSERT INTO products (
            name, sku, category_id, product_type, base_unit, units_per_carton,
            container_size_ml, container_unit_label, stock_base_qty, avg_cost_per_base,
            purchase_price_input, selling_price_primary, selling_price_carton, selling_price_per_liter,
            min_stock_threshold_base, cost_incomplete_flag, notes, last_movement_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          cleanName,
          cleanSku,
          category_id ? Number(category_id) : null,
          product_type,
          baseUnit,
          numUnitsPerCarton,
          numContainerSizeMl,
          String(container_unit_label || 'عبوة').trim(),
          stockBaseQty,
          avgCostPerBase,
          rawPurchaseInput,
          product_type === 'bulk_liquid' ? literSellingPrice : primarySellingPrice,
          cartonSellingPrice,
          literSellingPrice,
          minThresholdBase,
          costIncompleteFlag,
          String(notes || '').trim(),
          stockBaseQty > 0 ? new Date().toISOString() : null
        );

      const newProdId = Number(info.lastInsertRowid);

      if (stockBaseQty > 0) {
        db.prepare(
          `INSERT INTO stock_movements (
            reference_number, product_id, movement_type, base_qty_change,
            balance_after_base, unit_cost_per_base, source_type, source_id, notes, movement_date
          ) VALUES (?, ?, 'opening_stock', ?, ?, ?, 'opening_stock', ?, ?, ?)`
        ).run(
          generateReference('STK-OPN'),
          newProdId,
          stockBaseQty,
          stockBaseQty,
          avgCostPerBase,
          newProdId,
          costIncompleteFlag
            ? 'رصيد افتتاحي للمنتج (تنبيه: لم يتم إدخال تكلفة شراء معتمدة بعد)'
            : 'رصيد افتتاحي للمنتج عند التأسيس',
          dateStr
        );
      }

      return newProdId;
    });

    res.json({ id: productId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/products/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
    if (!existing) {
      res.status(404).json({ error: 'المنتج غير موجود' });
      return;
    }

    const {
      name,
      sku,
      category_id,
      units_per_carton,
      container_size_ml,
      container_unit_label,
      purchase_cost_input,
      selling_price_primary,
      selling_price_carton,
      selling_price_per_liter,
      min_stock_threshold,
      notes,
    } = req.body || {};

    const cleanName = String(name ?? existing.name).trim();
    const cleanSku = String(sku ?? existing.sku).trim().toUpperCase();

    const duplicate = db
      .prepare('SELECT id FROM products WHERE sku = ? AND id != ?')
      .get(cleanSku, productId);
    if (duplicate) {
      res.status(400).json({ error: `كود المنتج (${cleanSku}) مستخدم بالفعل لمنتج آخر` });
      return;
    }

    const numUnitsPerCarton =
      existing.product_type === 'carton'
        ? Math.max(2, Math.floor(Number(units_per_carton ?? existing.units_per_carton)))
        : 1;

    const rawPurchaseInput =
      purchase_cost_input !== undefined
        ? Math.max(0, Number(purchase_cost_input))
        : Number(existing.purchase_price_input);

    let avgCostPerBase = Number(existing.avg_cost_per_base);
    if (purchase_cost_input !== undefined && rawPurchaseInput > 0) {
      if (existing.product_type === 'individual' || existing.product_type === 'packaged_liquid') {
        avgCostPerBase = roundUnitCost(rawPurchaseInput);
      } else if (existing.product_type === 'carton') {
        avgCostPerBase = roundUnitCost(rawPurchaseInput / numUnitsPerCarton);
      } else if (existing.product_type === 'bulk_liquid') {
        // When editing a bulk liquid product, purchase_cost_input represents cost per liter
        avgCostPerBase = roundUnitCost(rawPurchaseInput / 1000);
      }
    }

    const costIncompleteFlag =
      Number(existing.stock_base_qty) > 0 && avgCostPerBase <= 0 ? 1 : 0;

    const literPrice =
      existing.product_type === 'bulk_liquid'
        ? roundMoney(
            Number(
              selling_price_per_liter ?? selling_price_primary ?? existing.selling_price_per_liter
            )
          )
        : 0;

    const primaryPrice =
      existing.product_type === 'bulk_liquid'
        ? literPrice
        : roundMoney(Number(selling_price_primary ?? existing.selling_price_primary));

    const minThresholdBase =
      min_stock_threshold !== undefined
        ? existing.product_type === 'bulk_liquid'
          ? roundQty(Number(min_stock_threshold) * 1000)
          : roundQty(Number(min_stock_threshold))
        : Number(existing.min_stock_threshold_base);

    db.prepare(
      `UPDATE products
       SET name = ?,
           sku = ?,
           category_id = ?,
           units_per_carton = ?,
           container_size_ml = ?,
           container_unit_label = ?,
           avg_cost_per_base = ?,
           purchase_price_input = ?,
           selling_price_primary = ?,
           selling_price_carton = ?,
           selling_price_per_liter = ?,
           min_stock_threshold_base = ?,
           cost_incomplete_flag = ?,
           notes = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      cleanName,
      cleanSku,
      category_id ? Number(category_id) : null,
      numUnitsPerCarton,
      container_size_ml !== undefined ? Number(container_size_ml) : existing.container_size_ml,
      container_unit_label ?? existing.container_unit_label,
      avgCostPerBase,
      rawPurchaseInput,
      primaryPrice,
      roundMoney(Number(selling_price_carton ?? existing.selling_price_carton)),
      literPrice,
      minThresholdBase,
      costIncompleteFlag,
      notes !== undefined ? String(notes).trim() : existing.notes,
      productId
    );

    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/products/:id/archive', requireAuth, (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.id);
    const { is_archived } = req.body || {};
    db.prepare('UPDATE products SET is_archived = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
      is_archived ? 1 : 0,
      productId
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== INTERNAL LIQUID FILLING TRANSFER ====================

app.post('/api/inventory/fill-liquid', requireAuth, (req: Request, res: Response) => {
  try {
    const {
      idempotency_key,
      bulk_product_id,
      packaged_product_id,
      containers_to_fill,
      notes = '',
      transfer_date,
    } = req.body || {};

    if (idempotency_key) {
      const dup = db
        .prepare('SELECT id, reference_number FROM inventory_transfers WHERE idempotency_key = ?')
        .get(String(idempotency_key)) as any;
      if (dup) {
        res.json({ id: dup.id, reference_number: dup.reference_number, duplicate: true });
        return;
      }
    }

    const result = runInTransaction(() => {
      const bulkProd = db
        .prepare('SELECT * FROM products WHERE id = ?')
        .get(Number(bulk_product_id)) as any;
      const packProd = db
        .prepare('SELECT * FROM products WHERE id = ?')
        .get(Number(packaged_product_id)) as any;

      if (!bulkProd || bulkProd.product_type !== 'bulk_liquid') {
        throw new Error('يرجى اختيار منتج سائل سائب صحيح كمصدر للتعبئة');
      }
      if (!packProd || packProd.product_type !== 'packaged_liquid') {
        throw new Error('يرجى اختيار منتج عبوات سائل جاهز صحيح كوجهة للتعبئة');
      }

      const containerSizeMl = Number(packProd.container_size_ml) || 1000;
      const calc = calculateLiquidFillingTransfer({
        bulkAvailableMl: Number(bulkProd.stock_base_qty),
        bulkAvgCostPerMl: Number(bulkProd.avg_cost_per_base),
        containerSizeMl,
        containersToFill: Number(containers_to_fill),
        packagedExistingQty: Number(packProd.stock_base_qty),
        packagedExistingAvgCost: Number(packProd.avg_cost_per_base),
      });

      const refNum = generateReference('FILL');
      const dateStr = transfer_date || new Date().toISOString().slice(0, 10);

      const info = db
        .prepare(
          `INSERT INTO inventory_transfers (
            reference_number, idempotency_key, bulk_product_id, packaged_product_id,
            bulk_ml_used, containers_filled, container_size_ml, transferred_cost, notes, transfer_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          refNum,
          idempotency_key ? String(idempotency_key) : null,
          bulkProd.id,
          packProd.id,
          calc.bulkMlUsed,
          Number(containers_to_fill),
          containerSizeMl,
          calc.transferredCost,
          String(notes).trim(),
          dateStr
        );

      const transferId = Number(info.lastInsertRowid);

      // Update bulk product stock
      db.prepare(
        `UPDATE products SET stock_base_qty = ?, last_movement_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).run(calc.remainingBulkMl, bulkProd.id);

      // Update packaged product stock & moving average cost
      db.prepare(
        `UPDATE products SET stock_base_qty = ?, avg_cost_per_base = ?, purchase_price_input = ?, last_movement_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).run(calc.newPackagedQty, calc.newPackagedAvgCost, calc.newPackagedAvgCost, packProd.id);

      // Create traceable stock movements
      db.prepare(
        `INSERT INTO stock_movements (
          reference_number, product_id, movement_type, base_qty_change, balance_after_base,
          unit_cost_per_base, source_type, source_id, notes, movement_date
        ) VALUES (?, ?, 'liquid_filling_out', ?, ?, ?, 'inventory_transfer', ?, ?, ?)`
      ).run(
        generateReference('SM-FOUT'),
        bulkProd.id,
        -calc.bulkMlUsed,
        calc.remainingBulkMl,
        Number(bulkProd.avg_cost_per_base),
        transferId,
        `سحب سائل لتعبئة ${containers_to_fill} عبوة من (${packProd.name})`,
        dateStr
      );

      db.prepare(
        `INSERT INTO stock_movements (
          reference_number, product_id, movement_type, base_qty_change, balance_after_base,
          unit_cost_per_base, source_type, source_id, notes, movement_date
        ) VALUES (?, ?, 'liquid_filling_in', ?, ?, ?, 'inventory_transfer', ?, ?, ?)`
      ).run(
        generateReference('SM-FIN'),
        packProd.id,
        Number(containers_to_fill),
        calc.newPackagedQty,
        calc.newPackagedAvgCost,
        transferId,
        `إضافة عبوات معبأة من السائل السائب (${bulkProd.name})`,
        dateStr
      );

      return { id: transferId, reference_number: refNum };
    });

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== PURCHASES & STOCK INTAKE ====================

app.post('/api/purchases', requireAuth, (req: Request, res: Response) => {
  try {
    const {
      idempotency_key,
      product_id,
      quantity_purchased,
      purchase_unit_mode,
      total_purchase_cost,
      purchase_date,
      payment_status = 'paid',
      payment_method = 'cash',
      supplier_name = '',
      notes = '',
    } = req.body || {};

    if (idempotency_key) {
      const existing = db
        .prepare('SELECT id, reference_number FROM purchases WHERE idempotency_key = ?')
        .get(String(idempotency_key)) as any;
      if (existing) {
        res.json({ id: existing.id, reference_number: existing.reference_number, duplicate: true });
        return;
      }
    }

    const result = runInTransaction(() => {
      const product = db
        .prepare('SELECT * FROM products WHERE id = ?')
        .get(Number(product_id)) as any;

      if (!product) {
        throw new Error('يرجى اختيار منتج صحيح لتسجيل الشراء');
      }

      const qtyPurchased = Number(quantity_purchased);
      const totalCost = roundMoney(Number(total_purchase_cost));
      if (!qtyPurchased || qtyPurchased <= 0) {
        throw new Error('الكمية المشتراة يجب أن تكون أكبر من صفر');
      }
      if (totalCost < 0 || !Number.isFinite(totalCost)) {
        throw new Error('إجمالي تكلفة الشراء غير صالح');
      }

      const unitMode =
        purchase_unit_mode ||
        (product.product_type === 'carton'
          ? 'carton'
          : product.product_type === 'bulk_liquid'
          ? 'liter'
          : product.product_type === 'packaged_liquid'
          ? 'container'
          : 'unit');

      const baseUnitQty = toBaseQuantity({
        productType: product.product_type,
        quantity: qtyPurchased,
        unitMode,
        unitsPerCarton: Number(product.units_per_carton) || 1,
      });

      const prevStockBase = Number(product.stock_base_qty);
      const prevAvgCost = Number(product.avg_cost_per_base);

      const { newStockBaseQty, newAvgCostPerBase, purchaseCostPerBase } =
        calculateMovingAverageCost({
          existingBaseQty: prevStockBase,
          existingAvgCostPerBase: prevAvgCost,
          purchasedBaseQty: baseUnitQty,
          totalPurchaseCost: totalCost,
        });

      const refNum = generateReference('PUR');
      const dateStr = purchase_date || new Date().toISOString().slice(0, 10);
      const isPaid = payment_status === 'paid';
      const amountPaid = isPaid ? totalCost : 0;

      const purInfo = db
        .prepare(
          `INSERT INTO purchases (
            reference_number, idempotency_key, supplier_name, purchase_date,
            total_cost, amount_paid, payment_status, payment_method, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          refNum,
          idempotency_key ? String(idempotency_key) : null,
          String(supplier_name || '').trim(),
          dateStr,
          totalCost,
          amountPaid,
          isPaid ? 'paid' : 'unpaid',
          payment_method,
          String(notes || '').trim()
        );

      const purchaseId = Number(purInfo.lastInsertRowid);

      const unitLabelMap: Record<string, string> = {
        carton: 'كرتونة',
        unit: 'وحدة/قطعة',
        liter: 'لتر',
        ml: 'ملليلتر',
        container: product.container_unit_label || 'عبوة',
      };

      db.prepare(
        `INSERT INTO purchase_items (
          purchase_id, product_id, product_name_snapshot, purchase_unit_mode,
          purchase_unit_label, purchased_qty, base_unit_qty, total_cost,
          unit_cost_per_base, prev_stock_base, prev_avg_cost_per_base, new_avg_cost_per_base
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        purchaseId,
        product.id,
        product.name,
        unitMode,
        unitLabelMap[unitMode] || 'وحدة',
        qtyPurchased,
        baseUnitQty,
        totalCost,
        purchaseCostPerBase,
        prevStockBase,
        prevAvgCost,
        newAvgCostPerBase
      );

      // Update product stock & weighted average cost
      const updatedDisplayPurchaseCost =
        product.product_type === 'carton'
          ? roundMoney(newAvgCostPerBase * Number(product.units_per_carton))
          : product.product_type === 'bulk_liquid'
          ? roundMoney(newAvgCostPerBase * 1000)
          : roundMoney(newAvgCostPerBase);

      db.prepare(
        `UPDATE products
         SET stock_base_qty = ?,
             avg_cost_per_base = ?,
             purchase_price_input = ?,
             cost_incomplete_flag = ?,
             last_movement_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        newStockBaseQty,
        newAvgCostPerBase,
        updatedDisplayPurchaseCost,
        newAvgCostPerBase > 0 ? 0 : product.cost_incomplete_flag,
        product.id
      );

      // Record stock movement
      db.prepare(
        `INSERT INTO stock_movements (
          reference_number, product_id, movement_type, base_qty_change,
          balance_after_base, unit_cost_per_base, source_type, source_id, notes, movement_date
        ) VALUES (?, ?, 'purchase', ?, ?, ?, 'purchase', ?, ?, ?)`
      ).run(
        generateReference('SM-PUR'),
        product.id,
        baseUnitQty,
        newStockBaseQty,
        purchaseCostPerBase,
        purchaseId,
        `توريد مخزون (${qtyPurchased} ${unitLabelMap[unitMode] || ''}) - فاتورة ${refNum}`,
        dateStr
      );

      // Record actual cash outflow ONLY when payment is made
      if (isPaid && totalCost > 0) {
        db.prepare(
          `INSERT INTO cash_movements (
            reference_number, movement_type, direction, amount, payment_method,
            source_type, source_id, description, movement_date
          ) VALUES (?, 'purchase_payment', 'out', ?, ?, 'purchase', ?, ?, ?)`
        ).run(
          generateReference('CSH-PUR'),
          totalCost,
          payment_method,
          purchaseId,
          `سداد فاتورة مشتريات (${product.name}) رقم ${refNum}`,
          dateStr
        );
      }

      return { id: purchaseId, reference_number: refNum };
    });

    createAutomatedBackup('after_purchase');
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/purchases/:id/pay', requireAuth, (req: Request, res: Response) => {
  try {
    const purchaseId = Number(req.params.id);
    const { payment_method = 'cash', payment_date } = req.body || {};

    runInTransaction(() => {
      const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId) as any;
      if (!purchase) {
        throw new Error('فاتورة الشراء غير موجودة');
      }
      if (purchase.payment_status === 'paid') {
        throw new Error('هذه الفاتورة مسددة بالفعل');
      }

      const unpaidAmount = roundMoney(Number(purchase.total_cost) - Number(purchase.amount_paid));
      const dateStr = payment_date || new Date().toISOString().slice(0, 10);

      db.prepare(
        `UPDATE purchases
         SET payment_status = 'paid', amount_paid = total_cost, payment_method = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(payment_method, purchaseId);

      if (unpaidAmount > 0) {
        db.prepare(
          `INSERT INTO cash_movements (
            reference_number, movement_type, direction, amount, payment_method,
            source_type, source_id, description, movement_date
          ) VALUES (?, 'purchase_payment', 'out', ?, ?, 'purchase', ?, ?, ?)`
        ).run(
          generateReference('CSH-PUR'),
          unpaidAmount,
          payment_method,
          purchaseId,
          `سداد مستحقات فاتورة مشتريات آجلة رقم ${purchase.reference_number}`,
          dateStr
        );
      }
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== SALES / POS ====================

app.post('/api/sales', requireAuth, (req: Request, res: Response) => {
  try {
    const {
      idempotency_key,
      sale_type = 'cash', // 'cash' | 'credit' | 'partial'
      customer_id,
      new_customer_name,
      new_customer_phone,
      items = [],
      discount = 0,
      amount_paid,
      payment_method = 'cash',
      notes = '',
      sale_date,
    } = req.body || {};

    if (idempotency_key) {
      const existingSale = db
        .prepare('SELECT id, invoice_number FROM sales WHERE idempotency_key = ?')
        .get(String(idempotency_key)) as any;
      if (existingSale) {
        res.json({
          id: existingSale.id,
          invoice_number: existingSale.invoice_number,
          duplicate: true,
        });
        return;
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'السلة فارغة، يرجى إضافة منتج واحد على الأقل لإتمام البيع' });
      return;
    }

    const result = runInTransaction(() => {
      const dateStr = sale_date || new Date().toISOString().slice(0, 10);

      // Resolve or create customer if credit or partial sale (or optional customer on cash sale)
      let resolvedCustomerId: number | null = customer_id ? Number(customer_id) : null;
      if (!resolvedCustomerId && new_customer_name && String(new_customer_name).trim()) {
        const custInfo = db
          .prepare(
            `INSERT INTO customers (name, phone, status, last_transaction_at)
             VALUES (?, ?, 'settled', datetime('now'))`
          )
          .run(String(new_customer_name).trim(), String(new_customer_phone || '').trim());
        resolvedCustomerId = Number(custInfo.lastInsertRowid);
      }

      if ((sale_type === 'credit' || sale_type === 'partial') && !resolvedCustomerId) {
        throw new Error('يرجى اختيار عميل أو إضافة عميل جديد لتسجيل فاتورة شكك / دفع جزئي');
      }

      // First pass: aggregate base quantities per product to prevent multi-line over-selling
      const requiredBaseByProduct = new Map<number, number>();
      const preparedLines: Array<{
        product: any;
        sellingUnitMode: 'unit' | 'carton' | 'ml' | 'liter' | 'container';
        sellingUnitLabel: string;
        sellingQty: number;
        baseQty: number;
        unitSellingPrice: number;
        lineTotal: number;
        unitCostPerBase: number;
        lineCost: number;
        costIncomplete: number;
      }> = [];

      let subtotal = 0;
      let totalCogs = 0;

      for (const rawItem of items) {
        const prodId = Number(rawItem.product_id);
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(prodId) as any;
        if (!product || product.is_archived) {
          throw new Error(`المنتج غير متاح أو مؤرشف`);
        }

        const sellingQty = Number(rawItem.quantity);
        if (!sellingQty || sellingQty <= 0) {
          throw new Error(`الكمية للمنتج (${product.name}) يجب أن تكون أكبر من صفر`);
        }

        const sellingUnitMode = rawItem.selling_unit_mode || 'unit';
        const baseQty = toBaseQuantity({
          productType: product.product_type,
          quantity: sellingQty,
          unitMode: sellingUnitMode,
          unitsPerCarton: Number(product.units_per_carton) || 1,
        });

        const cumulativeRequired = roundQty((requiredBaseByProduct.get(prodId) || 0) + baseQty);
        requiredBaseByProduct.set(prodId, cumulativeRequired);

        if (cumulativeRequired > Number(product.stock_base_qty)) {
          throw new Error(
            `الكمية المطلوبة من (${product.name}) تتجاوز الرصيد المتاح في المخزن (${product.stock_base_qty} ${
              product.base_unit === 'ml' ? 'مل' : 'وحدة'
            })`
          );
        }

        // Determine unit price based on selling mode or explicit price override
        let unitSellingPrice = Number(rawItem.unit_selling_price);
        if (!Number.isFinite(unitSellingPrice) || unitSellingPrice <= 0) {
          if (product.product_type === 'carton' && sellingUnitMode === 'carton') {
            unitSellingPrice =
              Number(product.selling_price_carton) > 0
                ? Number(product.selling_price_carton)
                : roundMoney(
                    Number(product.selling_price_primary) * Number(product.units_per_carton)
                  );
          } else if (product.product_type === 'bulk_liquid') {
            const pricePerLiter =
              Number(product.selling_price_per_liter) || Number(product.selling_price_primary);
            unitSellingPrice =
              sellingUnitMode === 'liter'
                ? roundMoney(pricePerLiter)
                : roundUnitCost(pricePerLiter / 1000);
          } else {
            unitSellingPrice = roundMoney(Number(product.selling_price_primary));
          }
        }

        const lineTotal = roundMoney(sellingQty * unitSellingPrice);
        const unitCostPerBase = Number(product.avg_cost_per_base);
        const lineCost = roundMoney(baseQty * unitCostPerBase);

        subtotal = roundMoney(subtotal + lineTotal);
        totalCogs = roundMoney(totalCogs + lineCost);

        const labelMap: Record<string, string> = {
          unit: 'قطعة',
          carton: `كرتونة (${product.units_per_carton} قطعة)`,
          liter: 'لتر',
          ml: 'مل',
          container: product.container_unit_label || 'عبوة',
        };

        preparedLines.push({
          product,
          sellingUnitMode,
          sellingUnitLabel: labelMap[sellingUnitMode] || 'وحدة',
          sellingQty,
          baseQty,
          unitSellingPrice,
          lineTotal,
          unitCostPerBase,
          lineCost,
          costIncomplete: Number(product.cost_incomplete_flag) ? 1 : 0,
        });
      }

      const cleanDiscount = roundMoney(Math.max(0, Number(discount) || 0));
      if (cleanDiscount > subtotal) {
        throw new Error('قيمة الخصم لا يمكن أن تتجاوز إجمالي الفاتورة');
      }

      const totalAmount = roundMoney(subtotal - cleanDiscount);

      let finalPaid = 0;
      if (sale_type === 'cash') {
        finalPaid = totalAmount;
      } else if (sale_type === 'credit') {
        finalPaid = 0;
      } else if (sale_type === 'partial') {
        finalPaid = roundMoney(Number(amount_paid) || 0);
        if (finalPaid <= 0 || finalPaid >= totalAmount) {
          throw new Error(
            'في حالة الدفع الجزئي، يجب أن يكون المبلغ المدفوع أكبر من صفر وأقل من إجمالي الفاتورة'
          );
        }
      }

      const remainingAmount = roundMoney(totalAmount - finalPaid);
      const invoiceNumber = generateReference('INV');

      const saleInfo = db
        .prepare(
          `INSERT INTO sales (
            invoice_number, idempotency_key, customer_id, sale_type,
            subtotal, discount, total_amount, total_cogs, amount_paid,
            remaining_amount, payment_method, status, notes, sale_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`
        )
        .run(
          invoiceNumber,
          idempotency_key ? String(idempotency_key) : null,
          resolvedCustomerId,
          sale_type,
          subtotal,
          cleanDiscount,
          totalAmount,
          totalCogs,
          finalPaid,
          remainingAmount,
          payment_method,
          String(notes || '').trim(),
          dateStr
        );

      const saleId = Number(saleInfo.lastInsertRowid);

      // Deduct stock and insert sale_items + stock_movements
      for (const line of preparedLines) {
        db.prepare(
          `INSERT INTO sale_items (
            sale_id, product_id, product_name_snapshot, sku_snapshot,
            product_type_snapshot, selling_unit_mode, selling_unit_label,
            selling_unit_qty, base_unit_qty, unit_selling_price,
            unit_cost_snapshot_per_base, total_line_cost, line_total, cost_incomplete_snapshot
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          saleId,
          line.product.id,
          line.product.name,
          line.product.sku,
          line.product.product_type,
          line.sellingUnitMode,
          line.sellingUnitLabel,
          line.sellingQty,
          line.baseQty,
          line.unitSellingPrice,
          line.unitCostPerBase,
          line.lineCost,
          line.lineTotal,
          line.costIncomplete
        );

        const currentProd = db
          .prepare('SELECT stock_base_qty FROM products WHERE id = ?')
          .get(line.product.id) as any;
        const newStock = roundQty(Number(currentProd.stock_base_qty) - line.baseQty);
        if (newStock < 0) {
          throw new Error(`الرصيد غير كافٍ للمنتج ${line.product.name}`);
        }

        db.prepare(
          `UPDATE products
           SET stock_base_qty = ?, last_movement_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        ).run(newStock, line.product.id);

        db.prepare(
          `INSERT INTO stock_movements (
            reference_number, product_id, movement_type, base_qty_change,
            balance_after_base, unit_cost_per_base, source_type, source_id, notes, movement_date
          ) VALUES (?, ?, 'sale', ?, ?, ?, 'sale', ?, ?, ?)`
        ).run(
          generateReference('SM-SAL'),
          line.product.id,
          -line.baseQty,
          newStock,
          line.unitCostPerBase,
          saleId,
          `بيع فاتورة رقم ${invoiceNumber} (${line.sellingQty} ${line.sellingUnitLabel})`,
          dateStr
        );
      }

      // Record cash / payment receipt ONLY for actual paid amount
      if (finalPaid > 0) {
        db.prepare(
          `INSERT INTO cash_movements (
            reference_number, movement_type, direction, amount, payment_method,
            source_type, source_id, description, movement_date
          ) VALUES (?, ?, 'in', ?, ?, 'sale', ?, ?, ?)`
        ).run(
          generateReference('CSH-SAL'),
          sale_type === 'partial' ? 'partial_sale_payment' : 'cash_sale',
          finalPaid,
          payment_method,
          saleId,
          sale_type === 'partial'
            ? `دفعة مقدمة من فاتورة بيع رقم ${invoiceNumber}`
            : `تحصيل فاتورة بيع نقدي رقم ${invoiceNumber}`,
          dateStr
        );
      }

      // Update customer credit account if customer is attached
      if (resolvedCustomerId) {
        const cust = db
          .prepare('SELECT * FROM customers WHERE id = ?')
          .get(resolvedCustomerId) as any;
        const prevBalance = roundMoney(Number(cust.current_balance));

        if (remainingAmount > 0) {
          // Record initial partial payment in payments ledger if partial sale
          if (finalPaid > 0) {
            db.prepare(
              `INSERT INTO payments (
                reference_number, customer_id, sale_id, payment_type, amount,
                payment_method, balance_before, balance_after, notes, payment_date
              ) VALUES (?, ?, ?, 'sale_initial', ?, ?, ?, ?, ?, ?)`
            ).run(
              generateReference('PAY-INI'),
              resolvedCustomerId,
              saleId,
              finalPaid,
              payment_method,
              roundMoney(prevBalance + totalAmount),
              roundMoney(prevBalance + remainingAmount),
              `دفعة مقدمة عند إصدار الفاتورة ${invoiceNumber}`,
              dateStr
            );
          }

          const newCreditPurchases = roundMoney(
            Number(cust.total_credit_purchases) + totalAmount
          );
          const newTotalPayments = roundMoney(Number(cust.total_payments) + finalPaid);
          const newBalance = roundMoney(prevBalance + remainingAmount);

          db.prepare(
            `UPDATE customers
             SET total_credit_purchases = ?,
                 total_payments = ?,
                 current_balance = ?,
                 status = ?,
                 last_transaction_at = datetime('now'),
                 updated_at = datetime('now')
             WHERE id = ?`
          ).run(
            newCreditPurchases,
            newTotalPayments,
            newBalance,
            newBalance > 0 ? 'outstanding' : 'settled',
            resolvedCustomerId
          );
        } else {
          db.prepare(
            `UPDATE customers SET last_transaction_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
          ).run(resolvedCustomerId);
        }
      }

      return { id: saleId, invoice_number: invoiceNumber };
    });

    createAutomatedBackup('after_sale');
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== SALES RETURNS & CORRECTIONS ====================

app.post('/api/sales/:id/return', requireAuth, (req: Request, res: Response) => {
  try {
    const saleId = Number(req.params.id);
    const {
      idempotency_key,
      items = [], // [{ sale_item_id, return_selling_qty }]
      condition_type = 'resellable', // 'resellable' | 'damaged'
      refund_cash_amount = 0,
      payment_method = 'cash',
      reason = '',
      return_date,
    } = req.body || {};

    if (!String(reason || '').trim()) {
      res.status(400).json({ error: 'يرجى كتابة سبب المرتجع لتوثيق العملية' });
      return;
    }

    if (idempotency_key) {
      const dup = db
        .prepare('SELECT id, return_number FROM sales_returns WHERE idempotency_key = ?')
        .get(String(idempotency_key)) as any;
      if (dup) {
        res.json({ id: dup.id, return_number: dup.return_number, duplicate: true });
        return;
      }
    }

    const result = runInTransaction(() => {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as any;
      if (!sale) {
        throw new Error('الفاتورة الأصلية غير موجودة');
      }

      const dateStr = return_date || new Date().toISOString().slice(0, 10);
      const returnNumber = generateReference('RET');

      let totalReturnAmount = 0;
      let totalReturnCogs = 0;
      const preparedReturns: Array<{
        saleItem: any;
        returnSellingQty: number;
        returnBaseQty: number;
        refundLineAmount: number;
        costReversed: number;
      }> = [];

      for (const reqItem of items) {
        const returnSellingQty = Number(reqItem.return_selling_qty);
        if (!returnSellingQty || returnSellingQty <= 0) continue;

        const saleItem = db
          .prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?')
          .get(Number(reqItem.sale_item_id), saleId) as any;

        if (!saleItem) {
          throw new Error('بند الفاتورة غير موجود');
        }

        const ratioBasePerSelling =
          Number(saleItem.base_unit_qty) / Number(saleItem.selling_unit_qty);
        const returnBaseQty = roundQty(returnSellingQty * ratioBasePerSelling);
        const remainingReturnableBase = roundQty(
          Number(saleItem.base_unit_qty) - Number(saleItem.returned_base_qty)
        );

        if (returnBaseQty > remainingReturnableBase + 0.001) {
          throw new Error(
            `الكمية المرتجعة من (${saleItem.product_name_snapshot}) تتجاوز الكمية القابلة للاسترجاع في الفاتورة`
          );
        }

        // Discount-adjusted line refund proportion
        const invoiceDiscountRatio =
          Number(sale.subtotal) > 0
            ? (Number(sale.subtotal) - Number(sale.discount)) / Number(sale.subtotal)
            : 1;
        const grossLineRefund = returnSellingQty * Number(saleItem.unit_selling_price);
        const refundLineAmount = roundMoney(grossLineRefund * invoiceDiscountRatio);
        const costReversed = roundMoney(
          returnBaseQty * Number(saleItem.unit_cost_snapshot_per_base)
        );

        totalReturnAmount = roundMoney(totalReturnAmount + refundLineAmount);
        totalReturnCogs = roundMoney(totalReturnCogs + costReversed);

        preparedReturns.push({
          saleItem,
          returnSellingQty,
          returnBaseQty,
          refundLineAmount,
          costReversed,
        });
      }

      if (preparedReturns.length === 0) {
        throw new Error('يرجى تحديد كمية مرتجعة لبند واحد على الأقل');
      }

      // How much lowers customer debt vs cash refund
      let creditBalanceReduction = 0;
      let actualCashRefund = roundMoney(Math.max(0, Number(refund_cash_amount) || 0));

      if (sale.customer_id && Number(sale.remaining_amount) > 0) {
        const currentSaleRemaining = Number(sale.remaining_amount);
        creditBalanceReduction = roundMoney(Math.min(totalReturnAmount, currentSaleRemaining));
        const maxPossibleCashRefund = roundMoney(totalReturnAmount - creditBalanceReduction);
        actualCashRefund = roundMoney(Math.min(actualCashRefund, maxPossibleCashRefund));
      } else {
        actualCashRefund = totalReturnAmount;
      }

      const resellableCogsReversed = condition_type === 'resellable' ? totalReturnCogs : 0;
      const damagedLossAmount = condition_type === 'damaged' ? totalReturnCogs : 0;

      const retInfo = db
        .prepare(
          `INSERT INTO sales_returns (
            return_number, idempotency_key, sale_id, customer_id,
            total_return_amount, total_return_cogs, resellable_cogs_reversed,
            damaged_loss_amount, refund_cash_amount, credit_balance_reduction,
            payment_method, condition_type, reason, return_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          returnNumber,
          idempotency_key ? String(idempotency_key) : null,
          saleId,
          sale.customer_id,
          totalReturnAmount,
          totalReturnCogs,
          resellableCogsReversed,
          damagedLossAmount,
          actualCashRefund,
          creditBalanceReduction,
          payment_method,
          condition_type,
          String(reason).trim(),
          dateStr
        );

      const returnId = Number(retInfo.lastInsertRowid);

      for (const item of preparedReturns) {
        db.prepare(
          `INSERT INTO sales_return_items (
            return_id, sale_item_id, product_id, product_name_snapshot,
            returned_selling_qty, returned_base_qty, refund_amount, cost_reversed, condition_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          returnId,
          item.saleItem.id,
          item.saleItem.product_id,
          item.saleItem.product_name_snapshot,
          item.returnSellingQty,
          item.returnBaseQty,
          item.refundLineAmount,
          item.costReversed,
          condition_type
        );

        db.prepare(
          `UPDATE sale_items SET returned_base_qty = returned_base_qty + ? WHERE id = ?`
        ).run(item.returnBaseQty, item.saleItem.id);

        const product = db
          .prepare('SELECT stock_base_qty FROM products WHERE id = ?')
          .get(item.saleItem.product_id) as any;

        if (condition_type === 'resellable') {
          const newStock = roundQty(Number(product.stock_base_qty) + item.returnBaseQty);
          db.prepare(
            `UPDATE products SET stock_base_qty = ?, last_movement_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
          ).run(newStock, item.saleItem.product_id);

          db.prepare(
            `INSERT INTO stock_movements (
              reference_number, product_id, movement_type, base_qty_change,
              balance_after_base, unit_cost_per_base, source_type, source_id, notes, movement_date
            ) VALUES (?, ?, 'sale_return_resellable', ?, ?, ?, 'sales_return', ?, ?, ?)`
          ).run(
            generateReference('SM-RET'),
            item.saleItem.product_id,
            item.returnBaseQty,
            newStock,
            Number(item.saleItem.unit_cost_snapshot_per_base),
            returnId,
            `مرتجع مبيعات سليم قابل لإعادة البيع (${returnNumber}) للفاتورة ${sale.invoice_number}`,
            dateStr
          );
        } else {
          // Damaged return: record stock movement with 0 available stock increase so damaged goods are tracked separately
          db.prepare(
            `INSERT INTO stock_movements (
              reference_number, product_id, movement_type, base_qty_change,
              balance_after_base, unit_cost_per_base, source_type, source_id, notes, movement_date
            ) VALUES (?, ?, 'sale_return_damaged', 0, ?, ?, 'sales_return', ?, ?, ?)`
          ).run(
            generateReference('SM-DMG'),
            item.saleItem.product_id,
            Number(product.stock_base_qty),
            Number(item.saleItem.unit_cost_snapshot_per_base),
            returnId,
            `مرتجع مبيعات تالف (${item.returnBaseQty} وحدة أساسية) غير مضاف للمخزون المتاح - (${returnNumber})`,
            dateStr
          );
        }
      }

      // Check if all items in the sale have been returned
      const allSaleItems = db
        .prepare('SELECT base_unit_qty, returned_base_qty FROM sale_items WHERE sale_id = ?')
        .all(saleId) as any[];
      const fullyReturned = allSaleItems.every(
        (si) => Number(si.returned_base_qty) >= Number(si.base_unit_qty) - 0.001
      );

      const newSaleRemaining = roundMoney(
        Math.max(0, Number(sale.remaining_amount) - creditBalanceReduction)
      );

      db.prepare(
        `UPDATE sales
         SET status = ?, remaining_amount = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(fullyReturned ? 'returned' : 'partially_returned', newSaleRemaining, saleId);

      // If cash refund > 0, record cash outflow
      if (actualCashRefund > 0) {
        db.prepare(
          `INSERT INTO cash_movements (
            reference_number, movement_type, direction, amount, payment_method,
            source_type, source_id, description, movement_date
          ) VALUES (?, 'sales_refund', 'out', ?, ?, 'sales_return', ?, ?, ?)`
        ).run(
          generateReference('CSH-REF'),
          actualCashRefund,
          payment_method,
          returnId,
          `رد نقدية لمرتجع مبيعات رقم ${returnNumber} (فاتورة ${sale.invoice_number})`,
          dateStr
        );
      }

      // If credit balance reduction > 0, update customer balance
      if (sale.customer_id && creditBalanceReduction > 0) {
        const customer = db
          .prepare('SELECT * FROM customers WHERE id = ?')
          .get(sale.customer_id) as any;
        if (customer) {
          const newCustBalance = roundMoney(
            Math.max(0, Number(customer.current_balance) - creditBalanceReduction)
          );
          const newTotalReturns = roundMoney(
            Number(customer.total_returns) + creditBalanceReduction
          );
          db.prepare(
            `UPDATE customers
             SET current_balance = ?,
                 total_returns = ?,
                 status = ?,
                 last_transaction_at = datetime('now'),
                 updated_at = datetime('now')
             WHERE id = ?`
          ).run(
            newCustBalance,
            newTotalReturns,
            newCustBalance === 0 ? 'settled' : 'outstanding',
            customer.id
          );
        }
      }

      return { id: returnId, return_number: returnNumber };
    });

    createAutomatedBackup('after_return');
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== CUSTOMERS & DEBT COLLECTION (الشكك) ====================

app.post('/api/customers', requireAuth, (req: Request, res: Response) => {
  try {
    const { name, phone = '', notes = '', opening_balance = 0 } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'يرجى إدخال اسم العميل' });
      return;
    }

    const openBal = roundMoney(Math.max(0, Number(opening_balance) || 0));
    const info = db
      .prepare(
        `INSERT INTO customers (
          name, phone, notes, total_credit_purchases, current_balance, status, last_transaction_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        cleanName,
        String(phone || '').trim(),
        String(notes || '').trim(),
        openBal,
        openBal,
        openBal > 0 ? 'outstanding' : 'settled',
        openBal > 0 ? new Date().toISOString() : null
      );

    res.json({ id: info.lastInsertRowid });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/customers/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.id);
    const { name, phone = '', notes = '' } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'يرجى إدخال اسم العميل' });
      return;
    }
    db.prepare(
      `UPDATE customers SET name = ?, phone = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(cleanName, String(phone).trim(), String(notes).trim(), customerId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/customers/:id/collect', requireAuth, (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.id);
    const {
      idempotency_key,
      amount,
      payment_method = 'cash',
      sale_id,
      notes = '',
      payment_date,
    } = req.body || {};

    if (idempotency_key) {
      const existing = db
        .prepare('SELECT id, reference_number FROM payments WHERE idempotency_key = ?')
        .get(String(idempotency_key)) as any;
      if (existing) {
        res.json({
          id: existing.id,
          reference_number: existing.reference_number,
          duplicate: true,
        });
        return;
      }
    }

    const result = runInTransaction(() => {
      const customer = db
        .prepare('SELECT * FROM customers WHERE id = ?')
        .get(customerId) as any;
      if (!customer) {
        throw new Error('العميل غير موجود');
      }

      const currentBalance = roundMoney(Number(customer.current_balance));
      const collectedAmount = roundMoney(Number(amount));

      const { newOutstandingBalance, status } = calculateCustomerReceivableAfterCollection({
        currentOutstandingBalance: currentBalance,
        collectionAmount: collectedAmount,
      });

      const refNum = generateReference('COL');
      const dateStr = payment_date || new Date().toISOString().slice(0, 10);

      const payInfo = db
        .prepare(
          `INSERT INTO payments (
            reference_number, idempotency_key, customer_id, sale_id,
            payment_type, amount, payment_method, balance_before, balance_after,
            notes, payment_date
          ) VALUES (?, ?, ?, ?, 'debt_collection', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          refNum,
          idempotency_key ? String(idempotency_key) : null,
          customerId,
          sale_id ? Number(sale_id) : null,
          collectedAmount,
          payment_method,
          currentBalance,
          newOutstandingBalance,
          String(notes || '').trim() || `تحصيل دفعة من حساب الشكك للعميل ${customer.name}`,
          dateStr
        );

      const paymentId = Number(payInfo.lastInsertRowid);

      // Update customer balance and total payments (never touches sales revenue!)
      const newTotalPayments = roundMoney(Number(customer.total_payments) + collectedAmount);
      db.prepare(
        `UPDATE customers
         SET total_payments = ?,
             current_balance = ?,
             status = ?,
             last_transaction_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(newTotalPayments, newOutstandingBalance, status, customerId);

      // Allocate collection against oldest unpaid invoices of this customer
      let remainingToAllocate = collectedAmount;
      const openInvoices = db
        .prepare(
          `SELECT id, remaining_amount, amount_paid FROM sales
           WHERE customer_id = ? AND remaining_amount > 0
           ORDER BY id ASC`
        )
        .all(customerId) as any[];

      for (const inv of openInvoices) {
        if (remainingToAllocate <= 0) break;
        const alloc = roundMoney(Math.min(remainingToAllocate, Number(inv.remaining_amount)));
        db.prepare(
          `UPDATE sales
           SET amount_paid = round(amount_paid + ?, 2),
               remaining_amount = round(remaining_amount - ?, 2),
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(alloc, alloc, inv.id);
        remainingToAllocate = roundMoney(remainingToAllocate - alloc);
      }

      // Increase cash/payment balance
      db.prepare(
        `INSERT INTO cash_movements (
          reference_number, movement_type, direction, amount, payment_method,
          source_type, source_id, description, movement_date
        ) VALUES (?, 'debt_collection', 'in', ?, ?, 'payment', ?, ?, ?)`
      ).run(
        generateReference('CSH-COL'),
        collectedAmount,
        payment_method,
        paymentId,
        `تحصيل شكك من العميل (${customer.name}) - إيصال ${refNum}`,
        dateStr
      );

      return {
        id: paymentId,
        reference_number: refNum,
        new_balance: newOutstandingBalance,
        status,
      };
    });

    createAutomatedBackup('after_collection');
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== STOCKTAKING (الجرد) ====================

app.post('/api/stocktakes', requireAuth, (req: Request, res: Response) => {
  try {
    const {
      idempotency_key,
      scope_type = 'full', // 'full' | 'partial'
      items = [], // [{ product_id, physical_base_qty, discrepancy_reason }]
      notes = '',
      stocktake_date,
    } = req.body || {};

    if (idempotency_key) {
      const dup = db
        .prepare('SELECT id, reference_number FROM stocktakes WHERE idempotency_key = ?')
        .get(String(idempotency_key)) as any;
      if (dup) {
        res.json({ id: dup.id, reference_number: dup.reference_number, duplicate: true });
        return;
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'يرجى اختيار منتج واحد على الأقل لإجراء الجرد' });
      return;
    }

    const result = runInTransaction(() => {
      const refNum = generateReference('STKT');
      const dateStr = stocktake_date || new Date().toISOString().slice(0, 10);

      let discrepancyCount = 0;
      let totalDiscrepancyValue = 0;

      const preparedItems: Array<{
        product: any;
        systemQty: number;
        physicalQty: number;
        diffQty: number;
        unitCost: number;
        financialImpact: number;
        reason: string;
      }> = [];

      for (const raw of items) {
        const product = db
          .prepare('SELECT * FROM products WHERE id = ?')
          .get(Number(raw.product_id)) as any;
        if (!product) {
          throw new Error('أحد المنتجات المختارة في الجرد غير موجود');
        }

        const physicalQty = roundQty(Number(raw.physical_base_qty));
        if (physicalQty < 0 || !Number.isFinite(physicalQty)) {
          throw new Error(`الكمية الفعلية للمنتج (${product.name}) لا يمكن أن تكون سالبة`);
        }

        const systemQty = roundQty(Number(product.stock_base_qty));
        const diffQty = roundQty(physicalQty - systemQty);
        const reason = String(raw.discrepancy_reason || '').trim() || (diffQty !== 0 ? 'تسوية جرد فعلي' : 'مطابق');

        const unitCost = Number(product.avg_cost_per_base);
        const financialImpact = roundMoney(diffQty * unitCost);

        if (diffQty !== 0) {
          discrepancyCount += 1;
          totalDiscrepancyValue = roundMoney(totalDiscrepancyValue + financialImpact);
        }

        preparedItems.push({
          product,
          systemQty,
          physicalQty,
          diffQty,
          unitCost,
          financialImpact,
          reason,
        });
      }

      const stInfo = db
        .prepare(
          `INSERT INTO stocktakes (
            reference_number, idempotency_key, scope_type, status,
            total_items_counted, discrepancy_items_count, total_discrepancy_value,
            notes, stocktake_date
          ) VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?)`
        )
        .run(
          refNum,
          idempotency_key ? String(idempotency_key) : null,
          scope_type === 'partial' ? 'partial' : 'full',
          preparedItems.length,
          discrepancyCount,
          totalDiscrepancyValue,
          String(notes || '').trim(),
          dateStr
        );

      const stocktakeId = Number(stInfo.lastInsertRowid);

      for (const item of preparedItems) {
        db.prepare(
          `INSERT INTO stocktake_items (
            stocktake_id, product_id, product_name_snapshot, sku_snapshot,
            base_unit_snapshot, system_base_qty, physical_base_qty,
            difference_base_qty, unit_cost_per_base, financial_impact, discrepancy_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          stocktakeId,
          item.product.id,
          item.product.name,
          item.product.sku,
          item.product.base_unit,
          item.systemQty,
          item.physicalQty,
          item.diffQty,
          item.unitCost,
          item.financialImpact,
          item.reason || 'مطابق للرصيد الدفتري'
        );

        if (item.diffQty !== 0) {
          db.prepare(
            `UPDATE products
             SET stock_base_qty = ?, last_movement_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ?`
          ).run(item.physicalQty, item.product.id);

          db.prepare(
            `INSERT INTO stock_movements (
              reference_number, product_id, movement_type, base_qty_change,
              balance_after_base, unit_cost_per_base, source_type, source_id, notes, movement_date
            ) VALUES (?, ?, 'stocktake_adjustment', ?, ?, ?, 'stocktake', ?, ?, ?)`
          ).run(
            generateReference('SM-ADJ'),
            item.product.id,
            item.diffQty,
            item.physicalQty,
            item.unitCost,
            stocktakeId,
            `تسوية جرد رقم ${refNum} - السبب: ${item.reason}`,
            dateStr
          );
        }
      }

      return { id: stocktakeId, reference_number: refNum };
    });

    createAutomatedBackup('after_stocktake');
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== OPERATING EXPENSES (المصروفات) ====================

app.post('/api/expenses', requireAuth, (req: Request, res: Response) => {
  try {
    const {
      idempotency_key,
      category,
      amount,
      expense_date,
      payment_method = 'cash',
      description = '',
      attachment_name = '',
    } = req.body || {};

    if (idempotency_key) {
      const dup = db
        .prepare('SELECT id, reference_number FROM expenses WHERE idempotency_key = ?')
        .get(String(idempotency_key)) as any;
      if (dup) {
        res.json({ id: dup.id, reference_number: dup.reference_number, duplicate: true });
        return;
      }
    }

    const cleanCategory = String(category || '').trim();
    const numAmount = roundMoney(Number(amount));
    if (!cleanCategory) {
      res.status(400).json({ error: 'يرجى تحديد تصنيف المصروف' });
      return;
    }
    if (!numAmount || numAmount <= 0) {
      res.status(400).json({ error: 'قيمة المصروف يجب أن تكون أكبر من صفر' });
      return;
    }

    const result = runInTransaction(() => {
      const refNum = generateReference('EXP');
      const dateStr = expense_date || new Date().toISOString().slice(0, 10);

      const info = db
        .prepare(
          `INSERT INTO expenses (
            reference_number, idempotency_key, category, amount,
            expense_date, payment_method, description, attachment_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          refNum,
          idempotency_key ? String(idempotency_key) : null,
          cleanCategory,
          numAmount,
          dateStr,
          payment_method,
          String(description || '').trim(),
          String(attachment_name || '').trim()
        );

      const expenseId = Number(info.lastInsertRowid);

      db.prepare(
        `INSERT INTO cash_movements (
          reference_number, movement_type, direction, amount, payment_method,
          source_type, source_id, description, movement_date
        ) VALUES (?, 'expense_payment', 'out', ?, ?, 'expense', ?, ?, ?)`
      ).run(
        generateReference('CSH-EXP'),
        numAmount,
        payment_method,
        expenseId,
        `مصروف تشغيلي (${cleanCategory})${description ? ` - ${String(description).trim()}` : ''}`,
        dateStr
      );

      return { id: expenseId, reference_number: refNum };
    });

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== BACKUPS & RESTORATION ====================

app.get('/api/backups/export', requireAuth, (_req: Request, res: Response) => {
  try {
    const snapshot = exportDatabaseSnapshot();
    res.json(snapshot);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backups/create', requireAuth, (_req: Request, res: Response) => {
  try {
    const filename = createAutomatedBackup('manual');
    res.json({ filename, backups: listSavedBackups() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backups/restore', requireAuth, (req: Request, res: Response) => {
  try {
    const { snapshot } = req.body || {};
    createAutomatedBackup('pre_restore_safety');
    restoreDatabaseSnapshot(snapshot);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل استعادة النسخة الاحتياطية' });
  }
});

// ==================== SERVER STARTUP ====================

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Fifi 50x50 server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

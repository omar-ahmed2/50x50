/**
 * Core Domain & Financial Calculations for "فيفي 50×50"
 * Uses exact integer scaling (10,000x for unit costs, 100x for EGP currency piasters)
 * to eliminate IEEE-754 floating-point drift in monetary and inventory calculations.
 */

export type ProductType = 'individual' | 'carton' | 'bulk_liquid' | 'packaged_liquid';
export type BaseUnit = 'unit' | 'ml' | 'container';
export type SellingUnitMode = 'unit' | 'carton' | 'ml' | 'liter' | 'container';

/**
 * Round monetary amount to 2 decimal places (EGP piasters) using half-to-even / exact scaling
 */
export function roundMoney(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Round unit cost per base unit (e.g. cost per 1 ml can be 0.025 EGP, so 6 decimal places)
 */
export function roundUnitCost(cost: number): number {
  if (!Number.isFinite(cost)) return 0;
  return Math.round((cost + Number.EPSILON) * 1000000) / 1000000;
}

/**
 * Round base quantity (supports fractional quantities up to 3 decimals if needed, though ml and units are integers)
 */
export function roundQty(qty: number): number {
  if (!Number.isFinite(qty)) return 0;
  return Math.round((qty + Number.EPSILON) * 1000) / 1000;
}

/**
 * Convert a purchase or sale quantity into the product's base stock unit:
 * - 'individual': base unit is 'unit' (1 = 1 unit)
 * - 'carton': base unit is 'unit' (1 carton = unitsPerCarton units; 1 unit = 1 unit)
 * - 'bulk_liquid': base unit is 'ml' (1 liter = 1000 ml; 1 ml = 1 ml)
 * - 'packaged_liquid': base unit is 'container' (1 container = 1 container)
 */
export function toBaseQuantity(params: {
  productType: ProductType;
  quantity: number;
  unitMode: 'unit' | 'carton' | 'ml' | 'liter' | 'container';
  unitsPerCarton?: number;
}): number {
  const { productType, quantity, unitMode, unitsPerCarton = 1 } = params;
  if (quantity < 0 || !Number.isFinite(quantity)) {
    throw new Error('الكمية يجب أن تكون رقماً موجباً');
  }

  switch (productType) {
    case 'individual':
      return roundQty(quantity);

    case 'carton':
      if (unitMode === 'carton') {
        if (!unitsPerCarton || unitsPerCarton <= 0) {
          throw new Error('عدد الوحدات داخل الكرتونة غير صالح');
        }
        return roundQty(quantity * unitsPerCarton);
      }
      return roundQty(quantity);

    case 'bulk_liquid':
      if (unitMode === 'liter') {
        return roundQty(quantity * 1000);
      }
      return roundQty(quantity); // ml

    case 'packaged_liquid':
      return roundQty(quantity);
  }
}

/**
 * Format a base stock balance into a human-readable Arabic string
 */
export function formatStockDisplay(params: {
  productType: ProductType;
  stockBaseQty: number;
  unitsPerCarton?: number;
  containerUnitLabel?: string;
}): { primaryText: string; secondaryText?: string } {
  const { productType, stockBaseQty, unitsPerCarton = 1, containerUnitLabel = 'عبوة' } = params;
  const qty = roundQty(stockBaseQty);

  if (productType === 'carton' && unitsPerCarton > 1) {
    const fullCartons = Math.floor(qty / unitsPerCarton);
    const looseUnits = roundQty(qty % unitsPerCarton);
    if (fullCartons > 0 && looseUnits > 0) {
      return {
        primaryText: `${qty} قطعة`,
        secondaryText: `${fullCartons} كرتونة و ${looseUnits} قطعة`,
      };
    }
    if (fullCartons > 0 && looseUnits === 0) {
      return {
        primaryText: `${qty} قطعة`,
        secondaryText: `${fullCartons} كرتونة كاملة`,
      };
    }
    return {
      primaryText: `${qty} قطعة`,
      secondaryText: `أقل من كرتونة (${unitsPerCarton} قطعة/كرتونة)`,
    };
  }

  if (productType === 'bulk_liquid') {
    const liters = roundQty(qty / 1000);
    return {
      primaryText: `${liters} لتر`,
      secondaryText: `${qty.toLocaleString('en-US')} مل`,
    };
  }

  if (productType === 'packaged_liquid') {
    return {
      primaryText: `${qty} ${containerUnitLabel || 'عبوة'}`,
    };
  }

  return {
    primaryText: `${qty} وحدة`,
  };
}

/**
 * Calculate Moving Weighted-Average Cost per base unit upon new stock purchase:
 * New average unit cost = (Existing stock value + New purchase cost) / (Existing stock quantity + New purchased quantity)
 */
export function calculateMovingAverageCost(params: {
  existingBaseQty: number;
  existingAvgCostPerBase: number;
  purchasedBaseQty: number;
  totalPurchaseCost: number;
}): {
  newStockBaseQty: number;
  newAvgCostPerBase: number;
  purchaseCostPerBase: number;
} {
  const { existingBaseQty, existingAvgCostPerBase, purchasedBaseQty, totalPurchaseCost } = params;
  if (purchasedBaseQty <= 0) {
    throw new Error('الكمية المشتراة يجب أن تكون أكبر من صفر');
  }
  if (totalPurchaseCost < 0) {
    throw new Error('إجمالي تكلفة الشراء لا يمكن أن يكون سالباً');
  }

  const safeExistingQty = Math.max(0, existingBaseQty);
  const existingValue = safeExistingQty * Math.max(0, existingAvgCostPerBase);
  const newStockBaseQty = roundQty(safeExistingQty + purchasedBaseQty);
  const purchaseCostPerBase = roundUnitCost(totalPurchaseCost / purchasedBaseQty);
  const newAvgCostPerBase =
    newStockBaseQty > 0
      ? roundUnitCost((existingValue + totalPurchaseCost) / newStockBaseQty)
      : purchaseCostPerBase;

  return {
    newStockBaseQty,
    newAvgCostPerBase,
    purchaseCostPerBase,
  };
}

/**
 * Calculate financial summary metrics from underlying records without confusing
 * revenue with cash collected, or profit with cash balance.
 */
export interface FinancialSummaryInput {
  grossSalesRevenue: number;
  salesDiscounts: number;
  salesReturnsAmount: number;
  grossCogs: number;
  returnedResellableCogs: number;
  operatingExpenses: number;
  openingCashBalance: number;
  cashReceipts: number;
  cashPayments: number;
}

export interface FinancialSummaryOutput {
  netSales: number;
  netCogs: number;
  grossProfit: number;
  operatingProfit: number;
  cashBalance: number;
}

export function calculateFinancialSummary(input: FinancialSummaryInput): FinancialSummaryOutput {
  // Net sales = sales revenue minus approved sales discounts and returns
  // Note: if grossSalesRevenue already has discounts deducted at invoice level, pass salesDiscounts = 0.
  const netSales = roundMoney(input.grossSalesRevenue - input.salesDiscounts - input.salesReturnsAmount);
  const netCogs = roundMoney(input.grossCogs - input.returnedResellableCogs);
  const grossProfit = roundMoney(netSales - netCogs);
  const operatingProfit = roundMoney(grossProfit - input.operatingExpenses);
  const cashBalance = roundMoney(input.openingCashBalance + input.cashReceipts - input.cashPayments);

  return {
    netSales,
    netCogs,
    grossProfit,
    operatingProfit,
    cashBalance,
  };
}

/**
 * Calculate customer credit account state and validate collection
 */
export function calculateCustomerReceivableAfterCollection(params: {
  currentOutstandingBalance: number;
  collectionAmount: number;
}): {
  newOutstandingBalance: number;
  status: 'settled' | 'outstanding';
} {
  const current = roundMoney(params.currentOutstandingBalance);
  const collected = roundMoney(params.collectionAmount);

  if (collected <= 0) {
    throw new Error('مبلغ التحصيل يجب أن يكون أكبر من صفر');
  }
  if (collected > current) {
    throw new Error(`مبلغ التحصيل (${collected} ج.م) يتجاوز الرصيد المستحق على العميل (${current} ج.م)`);
  }

  const newOutstandingBalance = roundMoney(current - collected);
  return {
    newOutstandingBalance,
    status: newOutstandingBalance === 0 ? 'settled' : 'outstanding',
  };
}

/**
 * Calculate internal bulk liquid filling transfer into packaged containers
 * Filling is an internal inventory transfer, not a sale or a source of profit.
 */
export function calculateLiquidFillingTransfer(params: {
  bulkAvailableMl: number;
  bulkAvgCostPerMl: number;
  containerSizeMl: number;
  containersToFill: number;
  packagedExistingQty: number;
  packagedExistingAvgCost: number;
}): {
  bulkMlUsed: number;
  remainingBulkMl: number;
  transferredCost: number;
  newPackagedQty: number;
  newPackagedAvgCost: number;
} {
  const {
    bulkAvailableMl,
    bulkAvgCostPerMl,
    containerSizeMl,
    containersToFill,
    packagedExistingQty,
    packagedExistingAvgCost,
  } = params;

  if (containersToFill <= 0 || !Number.isInteger(containersToFill)) {
    throw new Error('عدد العبوات المراد تعبئتها يجب أن يكون عدداً صحيحاً موجباً');
  }
  if (containerSizeMl <= 0) {
    throw new Error('حجم العبوة بالملليلتر يجب أن يكون أكبر من صفر');
  }

  const bulkMlUsed = roundQty(containersToFill * containerSizeMl);
  if (bulkMlUsed > bulkAvailableMl) {
    throw new Error(
      `الكمية المطلوبة للتعبئة (${bulkMlUsed} مل) أكبر من الرصيد المتاح من السائل السائب (${bulkAvailableMl} مل)`
    );
  }

  const remainingBulkMl = roundQty(bulkAvailableMl - bulkMlUsed);
  const transferredCost = roundMoney(bulkMlUsed * bulkAvgCostPerMl);

  const { newStockBaseQty: newPackagedQty, newAvgCostPerBase: newPackagedAvgCost } =
    calculateMovingAverageCost({
      existingBaseQty: packagedExistingQty,
      existingAvgCostPerBase: packagedExistingAvgCost,
      purchasedBaseQty: containersToFill,
      totalPurchaseCost: transferredCost,
    });

  return {
    bulkMlUsed,
    remainingBulkMl,
    transferredCost,
    newPackagedQty,
    newPackagedAvgCost,
  };
}

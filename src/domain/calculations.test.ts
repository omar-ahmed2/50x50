import { describe, expect, it } from 'vitest';
import {
  calculateCustomerReceivableAfterCollection,
  calculateFinancialSummary,
  calculateLiquidFillingTransfer,
  calculateMovingAverageCost,
  toBaseQuantity,
} from './calculations';

describe('Fifi 50x50 Store Calculations & Business Rules', () => {
  it('converts carton quantities and individual units to the same base unit accurately', () => {
    // 1 carton containing 12 units adds 12 individual units to stock
    const addedFromCarton = toBaseQuantity({
      productType: 'carton',
      quantity: 1,
      unitMode: 'carton',
      unitsPerCarton: 12,
    });
    expect(addedFromCarton).toBe(12);

    // Selling 3 individual units removes 3 units
    const soldIndividual = toBaseQuantity({
      productType: 'carton',
      quantity: 3,
      unitMode: 'unit',
      unitsPerCarton: 12,
    });
    expect(soldIndividual).toBe(3);
    expect(addedFromCarton - soldIndividual).toBe(9);
  });

  it('tracks bulk liquid quantities in milliliters accurately', () => {
    // 20 liters = 20,000 ml
    const initialStockMl = toBaseQuantity({
      productType: 'bulk_liquid',
      quantity: 20,
      unitMode: 'liter',
    });
    expect(initialStockMl).toBe(20000);

    // Selling 750 ml from 20 liters leaves 19,250 ml
    const soldMl = toBaseQuantity({
      productType: 'bulk_liquid',
      quantity: 750,
      unitMode: 'ml',
    });
    expect(initialStockMl - soldMl).toBe(19250);
  });

  it('calculates moving weighted-average cost accurately on stock intake', () => {
    // Existing: 10 units @ 50 EGP = 500 EGP
    // Purchase: 10 units for total 700 EGP (70 EGP/unit)
    // New avg cost should be (500 + 700) / 20 = 60 EGP
    const res = calculateMovingAverageCost({
      existingBaseQty: 10,
      existingAvgCostPerBase: 50,
      purchasedBaseQty: 10,
      totalPurchaseCost: 700,
    });
    expect(res.newStockBaseQty).toBe(20);
    expect(res.newAvgCostPerBase).toBe(60);
    expect(res.purchaseCostPerBase).toBe(70);
  });

  it('separates revenue, COGS, operating profit, and cash balance accurately', () => {
    // Suppose:
    // - Cash sale of 500 EGP + Credit sale of 300 EGP = 800 EGP total revenue (with 20 EGP discount)
    // - Sales return of 50 EGP (resellable COGS reversed: 30 EGP)
    // - Gross COGS = 450 EGP
    // - Operating expenses = 100 EGP
    // - Opening cash = 1000 EGP, cash receipts = 500 (cash sale) + 150 (debt collection) = 650 EGP
    // - Cash payments = 100 (expense) + 200 (paid purchase) = 300 EGP
    // Note: debt collection of 150 EGP increases cash balance, NOT sales revenue!
    const summary = calculateFinancialSummary({
      grossSalesRevenue: 800,
      salesDiscounts: 20,
      salesReturnsAmount: 50,
      grossCogs: 450,
      returnedResellableCogs: 30,
      operatingExpenses: 100,
      openingCashBalance: 1000,
      cashReceipts: 650,
      cashPayments: 300,
    });

    expect(summary.netSales).toBe(730); // 800 - 20 - 50
    expect(summary.netCogs).toBe(420); // 450 - 30
    expect(summary.grossProfit).toBe(310); // 730 - 420
    expect(summary.operatingProfit).toBe(210); // 310 - 100
    expect(summary.cashBalance).toBe(1350); // 1000 + 650 - 300
  });

  it('handles partial and full customer debt collections and prevents overpayment', () => {
    const partial = calculateCustomerReceivableAfterCollection({
      currentOutstandingBalance: 1250,
      collectionAmount: 450,
    });
    expect(partial.newOutstandingBalance).toBe(800);
    expect(partial.status).toBe('outstanding');

    const settled = calculateCustomerReceivableAfterCollection({
      currentOutstandingBalance: 800,
      collectionAmount: 800,
    });
    expect(settled.newOutstandingBalance).toBe(0);
    expect(settled.status).toBe('settled');

    expect(() =>
      calculateCustomerReceivableAfterCollection({
        currentOutstandingBalance: 800,
        collectionAmount: 900,
      })
    ).toThrow();
  });

  it('handles internal liquid filling from bulk stock into packaged containers', () => {
    // 20,000 ml bulk liquid @ 0.02 EGP/ml (20 EGP/liter)
    // Fill 10 containers of 1,000 ml each => uses 10,000 ml, transfers 200 EGP cost
    const transfer = calculateLiquidFillingTransfer({
      bulkAvailableMl: 20000,
      bulkAvgCostPerMl: 0.02,
      containerSizeMl: 1000,
      containersToFill: 10,
      packagedExistingQty: 5,
      packagedExistingAvgCost: 20,
    });

    expect(transfer.bulkMlUsed).toBe(10000);
    expect(transfer.remainingBulkMl).toBe(10000);
    expect(transfer.transferredCost).toBe(200);
    expect(transfer.newPackagedQty).toBe(15);
    expect(transfer.newPackagedAvgCost).toBe(20);
  });
});

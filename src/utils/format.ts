import { Product, PaymentMethod } from '../types/store';
import { formatStockDisplay, roundMoney } from '../domain/calculations';

export function formatCurrency(amount: number | string | null | undefined): string {
  const num = roundMoney(Number(amount || 0));
  return `${num.toLocaleString('en-US', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} ج.م`;
}

export function formatNumber(val: number | string | null | undefined, maxDecimals = 2): string {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

export function formatDateAr(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const clean = dateStr.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

export function formatDateTimeAr(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr.replace(' ', 'T')}Z`);
    if (isNaN(d.getTime())) return formatDateAr(dateStr);
    return d.toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return formatDateAr(dateStr);
  }
}

export function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getProductTypeLabel(
  typeOrProduct: Product['product_type'] | Product,
  customLabel?: string
): string {
  if (typeof typeOrProduct === 'object' && typeOrProduct !== null) {
    if (typeOrProduct.container_unit_label && typeOrProduct.container_unit_label.trim()) {
      return typeOrProduct.container_unit_label;
    }
    return getProductTypeLabel(typeOrProduct.product_type);
  }
  if (customLabel && customLabel.trim()) {
    return customLabel.trim();
  }
  switch (typeOrProduct) {
    case 'individual':
      return 'وحدة فردية';
    case 'carton':
      return 'كرتونة / قطعة';
    case 'bulk_liquid':
      return 'سائل باللتر';
    case 'packaged_liquid':
      return 'عبوة جاهزة';
    default:
      return 'وحدة';
  }
}

export function getBaseUnitLabel(
  product: Pick<Product, 'product_type' | 'base_unit' | 'container_unit_label'>
): string {
  if (product.product_type === 'bulk_liquid') return 'ملليلتر (مل)';
  if (product.container_unit_label && product.container_unit_label.trim()) {
    return product.container_unit_label;
  }
  return 'وحدة';
}

export function getPaymentMethodLabel(method: PaymentMethod | string): string {
  switch (method) {
    case 'cash':
      return 'نقدي (الخزنة)';
    case 'card':
      return 'بطاقة بنكية';
    case 'bank_transfer':
      return 'تحويل بنكي / محفظة';
    default:
      return 'نقدي';
  }
}

export function getSaleTypeLabel(type: 'cash' | 'credit' | 'partial' | string): string {
  switch (type) {
    case 'cash':
      return 'بيع نقدي';
    case 'credit':
      return 'بيع شكك (آجل)';
    case 'partial':
      return 'دفع جزئي (شكك)';
    default:
      return 'بيع';
  }
}

export function getProductStockStatus(product: Product): {
  status: 'available' | 'low' | 'out';
  label: string;
} {
  const qty = Number(product.stock_base_qty);
  const threshold = Number(product.min_stock_threshold_base);
  if (qty <= 0) {
    return { status: 'out', label: 'نفذ من المخزون' };
  }
  if (qty <= threshold) {
    return { status: 'low', label: 'منخفض (أوشك على النفاذ)' };
  }
  return { status: 'available', label: 'متوفر' };
}

export function getFormattedProductStock(product: Product) {
  if (product.product_type === 'individual' && product.container_unit_label?.trim()) {
    const qty = Number(product.stock_base_qty || 0);
    return {
      primaryText: `${formatNumber(qty)} ${product.container_unit_label.trim()}`,
      secondaryText: '',
    };
  }
  return formatStockDisplay({
    productType: product.product_type,
    stockBaseQty: Number(product.stock_base_qty),
    unitsPerCarton: Number(product.units_per_carton) || 1,
    containerUnitLabel: product.container_unit_label || 'عبوة',
  });
}

export function exportToCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escapeCell = (val: string | number) => {
    const str = String(val ?? '').replace(/"/g, '""');
    return `"${str}"`;
  };

  const csvContent =
    '\uFEFF' + // UTF-8 BOM for Arabic support in Excel
    [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

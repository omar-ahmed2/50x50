import { StoreBootstrapData } from '../types/store';

const TOKEN_KEY = 'fifi_50x50_auth_token';
const EXPLICIT_LOGOUT_KEY = 'fifi_50x50_explicit_logout';

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function markExplicitLogout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.setItem(EXPLICIT_LOGOUT_KEY, '1');
}

export function hasExplicitLogout(): boolean {
  return localStorage.getItem(EXPLICIT_LOGOUT_KEY) === '1';
}

export function generateIdempotencyKey(prefix = 'op'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `حدث خطأ في الاتصال بالخادم (${res.status})`);
  }
  return data as T;
}

export const api = {
  bootstrapSession: () =>
    request<{ token: string; user: { id: number; username: string; displayName: string; role: string } }>(
      '/api/auth/bootstrap-session',
      {
        method: 'POST',
        body: JSON.stringify({ explicitLogout: hasExplicitLogout() }),
      }
    ),

  login: (username: string, password: string) =>
    request<{ token: string; user: { id: number; username: string; displayName: string; role: string } }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }
    ),

  logout: () =>
    request<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),

  changePassword: (payload: { currentPassword: string; newPassword: string; displayName?: string }) =>
    request<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getBootstrapData: () => request<StoreBootstrapData>('/api/bootstrap'),

  updateSettings: (payload: Record<string, unknown>) =>
    request<{ ok: boolean }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  setOpeningCash: (payload: { amount: number; movementDate?: string; notes?: string }) =>
    request<{ ok: boolean }>('/api/settings/opening-cash', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createCategory: (payload: { name: string; description?: string }) =>
    request<{ id: number; name: string }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCategory: (id: number, payload: { name: string; description?: string }) =>
    request<{ ok: boolean }>(`/api/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteCategory: (id: number) =>
    request<{ ok: boolean }>(`/api/categories/${id}`, {
      method: 'DELETE',
    }),

  createSellingMethod: (payload: {
    name: string;
    product_type?: 'individual' | 'carton' | 'bulk_liquid';
    default_units_per_carton?: number;
  }) =>
    request<{ id: number; name: string; product_type: string; default_units_per_carton: number }>(
      '/api/selling-methods',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  deleteSellingMethod: (id: number) =>
    request<{ ok: boolean }>(`/api/selling-methods/${id}`, {
      method: 'DELETE',
    }),

  createProduct: (payload: Record<string, unknown>) =>
    request<{ id: number }>('/api/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProduct: (id: number, payload: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  toggleArchiveProduct: (id: number, is_archived: boolean) =>
    request<{ ok: boolean }>(`/api/products/${id}/archive`, {
      method: 'PATCH',
      body: JSON.stringify({ is_archived }),
    }),

  fillLiquidContainers: (payload: {
    idempotency_key: string;
    bulk_product_id: number;
    packaged_product_id: number;
    containers_to_fill: number;
    notes?: string;
    transfer_date?: string;
  }) =>
    request<{ id: number; reference_number: string }>('/api/inventory/fill-liquid', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  recordPurchase: (payload: Record<string, unknown>) =>
    request<{ id: number; reference_number: string }>('/api/purchases', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  payPurchase: (id: number, payload: { payment_method: string; payment_date?: string }) =>
    request<{ ok: boolean }>(`/api/purchases/${id}/pay`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createSale: (payload: Record<string, unknown>) =>
    request<{ id: number; invoice_number: string }>('/api/sales', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createSalesReturn: (saleId: number, payload: Record<string, unknown>) =>
    request<{ id: number; return_number: string }>(`/api/sales/${saleId}/return`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createCustomer: (payload: { name: string; phone?: string; notes?: string; opening_balance?: number }) =>
    request<{ id: number }>('/api/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCustomer: (id: number, payload: { name: string; phone?: string; notes?: string }) =>
    request<{ ok: boolean }>(`/api/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  collectCustomerDebt: (
    customerId: number,
    payload: {
      idempotency_key: string;
      amount: number;
      payment_method: string;
      sale_id?: number;
      notes?: string;
      payment_date?: string;
    }
  ) =>
    request<{ id: number; reference_number: string; new_balance: number; status: string }>(
      `/api/customers/${customerId}/collect`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  createStocktake: (payload: Record<string, unknown>) =>
    request<{ id: number; reference_number: string }>('/api/stocktakes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createExpense: (payload: Record<string, unknown>) =>
    request<{ id: number; reference_number: string }>('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  exportBackup: () => request<Record<string, unknown>>('/api/backups/export'),

  createManualBackup: () =>
    request<{ filename: string; backups: any[] }>('/api/backups/create', {
      method: 'POST',
    }),

  restoreBackup: (snapshot: Record<string, unknown>) =>
    request<{ ok: boolean }>('/api/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ snapshot }),
    }),
};

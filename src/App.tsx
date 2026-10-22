/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CreditAccountsView } from './components/CreditAccountsView';
import { DashboardView } from './components/DashboardView';
import { FinanceView } from './components/FinanceView';
import { InventoryView } from './components/InventoryView';
import { Layout } from './components/Layout';
import { LoginView } from './components/LoginView';
import { PosSalesView } from './components/PosSalesView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { StocktakingView } from './components/StocktakingView';
import { TransactionsView } from './components/TransactionsView';
import { api, markExplicitLogout, setAuthToken } from './services/api';
import { NavSection, StoreBootstrapData } from './types/store';

export default function App() {
  const [user, setUser] = useState<{
    id: number;
    username: string;
    displayName: string;
    role: string;
  } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [storeData, setStoreData] = useState<StoreBootstrapData | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [contextId, setContextId] = useState<number | undefined>(undefined);
  const [contextAction, setContextAction] = useState<'view' | 'purchase' | undefined>(
    undefined
  );

  const fetchStoreData = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await api.getBootstrapData();
      setStoreData(data);
    } catch (err: any) {
      setLoadError(err.message || 'تعذر تحميل بيانات المحل');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sessionRes = await api.bootstrapSession();
        if (!mounted) return;
        setAuthToken(sessionRes.token);
        setUser(sessionRes.user);
        setAuthChecked(true);
        await fetchStoreData();
      } catch {
        if (!mounted) return;
        setUser(null);
        setAuthChecked(true);
        setLoadingData(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [fetchStoreData]);

  const handleNavigate = (
    section: NavSection,
    id?: number,
    action?: 'view' | 'purchase'
  ) => {
    setContextId(id);
    setContextAction(action);
    setActiveSection(section);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore logout error
    }
    markExplicitLogout();
    setUser(null);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F7FB]" dir="rtl">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <div className="text-xs font-bold text-slate-600">
            جارٍ تهيئة نظام محل فيفي 50×50...
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        onLoginSuccess={async (loggedInUser) => {
          setUser(loggedInUser);
          setLoadingData(true);
          await fetchStoreData();
        }}
      />
    );
  }

  if (loadingData || !storeData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F7FB]" dir="rtl">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs text-center space-y-3 max-w-sm w-full">
          {loadError ? (
            <>
              <div className="text-sm font-bold text-rose-600">{loadError}</div>
              <button
                onClick={fetchStoreData}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold cursor-pointer"
              >
                إعادة المحاولة
              </button>
            </>
          ) : (
            <>
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <div className="text-xs font-bold text-slate-600">
                جارٍ تحميل سجلات المخزون والمبيعات والخزنة...
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <Layout
      activeSection={activeSection}
      onNavigate={handleNavigate}
      data={storeData}
      user={user}
      onLogout={handleLogout}
    >
      {activeSection === 'dashboard' && (
        <DashboardView
          data={storeData}
          onNavigate={handleNavigate}
          onRefresh={fetchStoreData}
        />
      )}

      {activeSection === 'pos' && (
        <PosSalesView data={storeData} onRefresh={fetchStoreData} />
      )}

      {activeSection === 'inventory' && (
        <InventoryView
          data={storeData}
          onRefresh={fetchStoreData}
          initialProductId={contextId}
          initialAction={contextAction}
          onClearInitialAction={() => setContextAction(undefined)}
        />
      )}

      {activeSection === 'credit' && (
        <CreditAccountsView
          data={storeData}
          onRefresh={fetchStoreData}
          initialCustomerId={contextId}
        />
      )}

      {activeSection === 'transactions' && (
        <TransactionsView data={storeData} initialSaleId={contextId} />
      )}

      {activeSection === 'stocktaking' && (
        <StocktakingView data={storeData} onRefresh={fetchStoreData} />
      )}

      {activeSection === 'finance' && (
        <FinanceView data={storeData} onRefresh={fetchStoreData} />
      )}

      {activeSection === 'reports' && <ReportsView data={storeData} />}

      {activeSection === 'settings' && (
        <SettingsView data={storeData} onRefresh={fetchStoreData} />
      )}
    </Layout>
  );
}

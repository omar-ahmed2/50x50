import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  ChevronDown,
  ClipboardCheck,
  FileSpreadsheet,
  History,
  Home,
  LogOut,
  Menu,
  Search,
  Settings,
  ShoppingCart,
  Sparkles,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { NavSection, StoreBootstrapData } from '../types/store';
import { formatCurrency, getProductStockStatus } from '../utils/format';

interface LayoutProps {
  activeSection: NavSection;
  onNavigate: (
    section: NavSection,
    contextId?: number,
    action?: 'view' | 'purchase'
  ) => void;
  data: StoreBootstrapData;
  user: { id: number; username: string; displayName: string; role: string };
  onLogout: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'الرئيسية', subtitle: 'نظرة سريعة على أداء المحل', icon: Home },
  { id: 'pos', label: 'المبيعات', subtitle: 'نقطة البيع وتسجيل الفواتير', icon: ShoppingCart },
  { id: 'inventory', label: 'المخزون', subtitle: 'إدارة المنتجات والكميات والتوريد', icon: Boxes },
  { id: 'credit', label: 'الشكك', subtitle: 'إدارة حسابات ومديونيات العملاء', icon: Users },
  { id: 'transactions', label: 'العمليات', subtitle: 'سجل جميع عمليات البيع والمخزون', icon: History },
  { id: 'stocktaking', label: 'الجرد', subtitle: 'مطابقة المخزون الفعلي والتسويات', icon: ClipboardCheck },
  { id: 'finance', label: 'المالية', subtitle: 'إدارة الخزنة والمقبوضات والأرباح', icon: Wallet },
  { id: 'reports', label: 'التقارير', subtitle: 'التقارير التفصيلية والتصدير', icon: BarChart3 },
  { id: 'settings', label: 'الإعدادات', subtitle: 'إعدادات المحل والنسخ الاحتياطي', icon: Settings },
];

export const Layout: React.FC<LayoutProps> = ({
  activeSection,
  onNavigate,
  data,
  user,
  onLogout,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const currentNav = NAV_ITEMS.find((n) => n.id === activeSection) || NAV_ITEMS[0];

  const alerts = useMemo(() => {
    const activeProducts = data.products.filter((p) => !p.is_archived);
    const lowStock = activeProducts.filter((p) => {
      const st = getProductStockStatus(p);
      return st.status === 'low' || st.status === 'out';
    });
    const incompleteCost = activeProducts.filter((p) => Number(p.cost_incomplete_flag) === 1);
    const debtors = data.customers.filter((c) => Number(c.current_balance) > 0);

    return {
      lowStock,
      incompleteCost,
      debtors,
      totalCount:
        (lowStock.length > 0 ? 1 : 0) +
        (incompleteCost.length > 0 ? 1 : 0) +
        (debtors.length > 0 ? 1 : 0),
    };
  }, [data.products, data.customers]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;

    const matchingProducts = data.products
      .filter(
        (p) =>
          !p.is_archived &&
          (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      )
      .slice(0, 5);

    const matchingCustomers = data.customers
      .filter(
        (c) => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q))
      )
      .slice(0, 4);

    const matchingSales = data.sales
      .filter(
        (s) =>
          s.invoice_number.toLowerCase().includes(q) ||
          (s.customer_name && s.customer_name.toLowerCase().includes(q))
      )
      .slice(0, 4);

    return {
      products: matchingProducts,
      customers: matchingCustomers,
      sales: matchingSales,
      hasAny:
        matchingProducts.length > 0 ||
        matchingCustomers.length > 0 ||
        matchingSales.length > 0,
    };
  }, [searchQuery, data.products, data.customers, data.sales]);

  return (
    <div className="min-h-screen bg-[#F4F7FB] text-slate-900" dir="rtl">
      {/* Fixed Desktop Right Sidebar (Never scrolls with the page) */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:w-64 xl:w-72 fixed top-0 right-0 bottom-0 h-screen z-40 bg-gradient-to-b from-[#111C35] to-[#0B1324] text-white select-none border-l border-slate-800/80 shadow-xl">
        {/* Brand Header */}
        <div className="px-6 py-6 border-b border-white/10 flex items-center justify-between shrink-0">
          <div>
            <div className="text-2xl font-extrabold tracking-tight text-white leading-none">
              {data.settings?.store_name?.split(' ')[0] || 'فيفي'}
            </div>
            <div className="text-sm font-bold text-sky-400 mt-1 tracking-wider tabular-nums">
              50×50
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shadow-md shadow-sky-950/50 border border-white/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-5 space-y-1.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#1D4ED8] text-white shadow-md shadow-blue-950/40'
                    : 'text-slate-300 hover:bg-white/8 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </span>
                {item.id === 'credit' && alerts.debtors.length > 0 && (
                  <span className="text-xs font-mono tabular-nums px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300">
                    {alerts.debtors.length}
                  </span>
                )}
                {item.id === 'inventory' && alerts.lowStock.length > 0 && (
                  <span className="text-xs font-mono tabular-nums px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300">
                    {alerts.lowStock.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Quick POS CTA in Sidebar Footer */}
        <div className="p-4 border-t border-white/10 shrink-0">
          <button
            onClick={() => onNavigate('pos')}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer whitespace-nowrap"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>فاتورة بيع جديدة</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-gradient-to-b from-[#111C35] to-[#0B1324] text-white flex flex-col h-full z-10 shadow-2xl">
            <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="text-lg font-extrabold text-white">فيفي 50×50</div>
                  <div className="text-xs text-slate-400">نظام إدارة المحل</div>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-lg text-slate-300 hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onNavigate(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                      isActive
                        ? 'bg-[#1D4ED8] text-white'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area offset by fixed right sidebar width on desktop */}
      <div className="lg:mr-64 xl:mr-72 min-h-screen flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="no-print bg-white border-b border-slate-200/90 px-4 sm:px-6 lg:px-8 py-3.5 sticky top-0 z-30">
          <div className="flex items-center justify-between gap-4">
            {/* Right Zone: Mobile Menu + Current Section Title */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                aria-label="القائمة"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 truncate">
                  {currentNav.label}
                </h1>
                <p className="text-xs text-slate-500 hidden sm:block truncate">
                  {currentNav.subtitle}
                </p>
              </div>
            </div>

            {/* Center Zone: Global Quick Search */}
            <div className="relative flex-1 max-w-md">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                  placeholder="ابحث عن منتج أو عميل أو فاتورة..."
                  className="w-full bg-slate-100/80 hover:bg-slate-100 focus:bg-white text-sm text-slate-900 rounded-xl pr-10 pl-8 py-2 border border-slate-200/80 focus:border-blue-500 focus:outline-none transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Search Dropdown Results */}
              {searchFocused && searchResults && (
                <div className="absolute right-0 left-0 mt-2 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden z-50 max-h-96 overflow-y-auto">
                  {!searchResults.hasAny ? (
                    <div className="p-4 text-center text-sm text-slate-500">
                      لا توجد نتائج مطابقة لـ "{searchQuery}"
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {searchResults.products.length > 0 && (
                        <div className="p-2">
                          <div className="px-2 py-1 text-xs font-bold text-slate-400">
                            المنتجات والمخزون
                          </div>
                          {searchResults.products.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => {
                                onNavigate('inventory', p.id, 'view');
                                setSearchQuery('');
                              }}
                              className="w-full text-right px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between text-sm"
                            >
                              <div>
                                <span className="font-bold text-slate-800">{p.name}</span>
                                <span className="text-xs text-slate-400 mr-2 font-mono">
                                  {p.sku}
                                </span>
                              </div>
                              <span className="text-xs font-bold text-emerald-700 tabular-nums">
                                {formatCurrency(p.selling_price_primary)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {searchResults.customers.length > 0 && (
                        <div className="p-2">
                          <div className="px-2 py-1 text-xs font-bold text-slate-400">
                            حسابات العملاء (الشكك)
                          </div>
                          {searchResults.customers.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => {
                                onNavigate('credit', c.id);
                                setSearchQuery('');
                              }}
                              className="w-full text-right px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between text-sm"
                            >
                              <span className="font-bold text-slate-800">{c.name}</span>
                              <span className="text-xs font-bold text-rose-600 tabular-nums">
                                مديونية: {formatCurrency(c.current_balance)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {searchResults.sales.length > 0 && (
                        <div className="p-2">
                          <div className="px-2 py-1 text-xs font-bold text-slate-400">
                            الفواتير والعمليات
                          </div>
                          {searchResults.sales.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => {
                                onNavigate('transactions', s.id);
                                setSearchQuery('');
                              }}
                              className="w-full text-right px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between text-sm"
                            >
                              <span className="font-mono font-bold text-slate-800">
                                {s.invoice_number}
                              </span>
                              <span className="text-xs font-bold text-blue-700 tabular-nums">
                                {formatCurrency(s.total_amount)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Left Zone: Notifications + User Menu */}
            <div className="flex items-center gap-2.5 shrink-0">
              {/* Notifications Button */}
              <div className="relative">
                <button
                  onClick={() => {
                    setNotificationsOpen((prev) => !prev);
                    setUserMenuOpen(false);
                  }}
                  className="relative p-2.5 rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
                  title="التنبيهات المهمة"
                >
                  <Bell className="w-4 h-4" />
                  {alerts.totalCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {alerts.totalCount}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div className="absolute left-0 mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-800">تنبيهات المحل</span>
                      <button
                        onClick={() => setNotificationsOpen(false)}
                        className="text-xs text-slate-400 hover:text-slate-600"
                      >
                        إغلاق
                      </button>
                    </div>
                    <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                      {alerts.lowStock.length > 0 && (
                        <button
                          onClick={() => {
                            onNavigate('inventory');
                            setNotificationsOpen(false);
                          }}
                          className="w-full text-right p-3 rounded-lg bg-rose-50/70 hover:bg-rose-50 border border-rose-200/70 flex items-start gap-3 transition-colors"
                        >
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          <div>
                            <div className="text-xs font-bold text-rose-900">
                              منتجات وصلت لحد إعادة الطلب ({alerts.lowStock.length})
                            </div>
                            <div className="text-[11px] text-rose-700 mt-0.5">
                              اضغط لمراجعة أرصدة المخزون وإعادة التوريد
                            </div>
                          </div>
                        </button>
                      )}

                      {alerts.debtors.length > 0 && (
                        <button
                          onClick={() => {
                            onNavigate('credit');
                            setNotificationsOpen(false);
                          }}
                          className="w-full text-right p-3 rounded-lg bg-amber-50/70 hover:bg-amber-50 border border-amber-200/70 flex items-start gap-3 transition-colors"
                        >
                          <Users className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <div className="text-xs font-bold text-amber-900">
                              عملاء لديهم رصيد شكك مستحق ({alerts.debtors.length})
                            </div>
                            <div className="text-[11px] text-amber-700 mt-0.5">
                              إجمالي المستحقات:{' '}
                              {formatCurrency(
                                alerts.debtors.reduce((acc, c) => acc + Number(c.current_balance), 0)
                              )}
                            </div>
                          </div>
                        </button>
                      )}

                      {alerts.incompleteCost.length > 0 && (
                        <button
                          onClick={() => {
                            onNavigate('inventory');
                            setNotificationsOpen(false);
                          }}
                          className="w-full text-right p-3 rounded-lg bg-blue-50/70 hover:bg-blue-50 border border-blue-200/70 flex items-start gap-3 transition-colors"
                        >
                          <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                          <div>
                            <div className="text-xs font-bold text-blue-900">
                              منتجات بدون تكلفة شراء ({alerts.incompleteCost.length})
                            </div>
                            <div className="text-[11px] text-blue-700 mt-0.5">
                              يرجى تحديث تكلفة الشراء لضمان دقة حساب الأرباح
                            </div>
                          </div>
                        </button>
                      )}

                      {alerts.totalCount === 0 && (
                        <div className="py-6 text-center text-xs text-slate-500">
                          لا توجد تنبيهات عاجلة حالياً. جميع الأرصدة منتظمة.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* User Menu Dropdown */}
              <div className="relative">
                <button
                  onClick={() => {
                    setUserMenuOpen((prev) => !prev);
                    setNotificationsOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-slate-100 text-xs font-bold text-slate-700 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <UserCheck className="w-4 h-4 text-slate-600" />
                  <span className="hidden sm:inline">{user.displayName || 'مستخدم واحد'}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {userMenuOpen && (
                  <div className="absolute left-0 mt-2 w-56 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                      <div className="text-xs font-bold text-slate-900">{user.displayName}</div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        @{user.username}
                      </div>
                    </div>
                    <div className="p-1.5">
                      <button
                        onClick={() => {
                          onNavigate('settings');
                          setUserMenuOpen(false);
                        }}
                        className="w-full text-right px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                      >
                        <Settings className="w-4 h-4 text-slate-500" />
                        <span>إعدادات المحل والحساب</span>
                      </button>
                      <button
                        onClick={() => {
                          setUserMenuOpen(false);
                          onLogout();
                        }}
                        className="w-full text-right px-3 py-2 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2 mt-0.5"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>تسجيل الخروج</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

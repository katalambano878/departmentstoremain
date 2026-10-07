'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useCMS } from '@/context/CMSContext';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [canViewLogs, setCanViewLogs] = useState(false);
  const { getSetting } = useCMS();
  const siteName = getSetting('site_name') || 'Discount Discovery Zone';
  const adminLogo = getSetting('site_logo');

  // Module Filtering State
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [clearingCache, setClearingCache] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceUntil, setMaintenanceUntil] = useState('');
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);

  const parseSettingValue = (raw: string) => {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  const formatTime24 = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();

      if (pathname === '/admin/login') {
        setIsLoading(false);
        return;
      }

      if (!session) {
        router.push('/admin/login');
        return;
      }

      // Ensure auth cookie is set (in case user already had a session from before)
      document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax; Secure`;

      // Check user role from profiles table
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', session.user.id)
        .single();

      if (profileError || !profile) {
        console.error('Failed to fetch user profile');
        router.push('/admin/login');
        return;
      }

      // Admin, full staff, or POS-only staff
      if (profile.role !== 'admin' && profile.role !== 'staff' && profile.role !== 'staff_pos') {
        console.warn('User does not have admin/staff role');
        document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax; Secure';
        await supabase.auth.signOut();
        router.push('/admin/login?error=unauthorized');
        return;
      }

      if (profile.role === 'admin') {
        const { data: logsAccess } = await supabase.rpc('can_view_audit_logs');
        setCanViewLogs(logsAccess === true);
      }

      setUser(session.user);
      setUserRole(profile.role);
      setIsAuthenticated(true);
      setIsLoading(false);
    }

    checkAuth();

    // Keep cookie in sync when session refreshes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) {
        document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax; Secure`;
      }
      if (event === 'SIGNED_OUT') {
        document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax; Secure';
        document.cookie = 'sb-refresh-token=; path=/; max-age=0; SameSite=Lax; Secure';
      }
    });

    return () => subscription.unsubscribe();
  }, [pathname, router]);

  // Restrict staff_pos to Orders + POS only
  useEffect(() => {
    if (!userRole || pathname === '/admin/login') return;
    if (userRole !== 'staff_pos') return;
    const allowed =
      pathname === '/admin/pos' || pathname.startsWith('/admin/orders');
    if (!allowed) {
      router.replace('/admin/pos');
    }
  }, [userRole, pathname, router]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showUserMenu && !target.closest('.user-menu-container')) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu]);

  // Fetch Modules Effect
  useEffect(() => {
    async function fetchModules() {
      try {
        const { data, error } = await supabase.from('store_modules').select('id, enabled');
        if (error) {
          console.warn('Error fetching modules:', error);
          return;
        }
        if (data) {
          setEnabledModules(data.filter((m: any) => m.enabled).map((m: any) => m.id));
        }
      } catch (err) {
        console.warn('Fetch modules failed:', err);
      }
    }
    fetchModules();
  }, []);

  useEffect(() => {
    async function fetchMaintenanceSettings() {
      try {
        const { data, error } = await supabase
          .from('site_settings')
          .select('key, value')
          .in('key', ['maintenance_mode', 'maintenance_until']);
        if (error) {
          console.warn('Error fetching maintenance settings:', error);
          return;
        }
        if (!data) return;

        const map: Record<string, any> = {};
        data.forEach((row: any) => {
          map[row.key] = parseSettingValue(row.value);
        });

        setMaintenanceMode(map.maintenance_mode === true || map.maintenance_mode === 'true');
        setMaintenanceUntil(typeof map.maintenance_until === 'string' ? map.maintenance_until : '');
      } catch (err) {
        console.warn('Failed to fetch maintenance settings:', err);
      }
    }
    fetchMaintenanceSettings();
  }, []);

  // Screen size check for initial state
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        // Only set to false if it's currently true? 
        // Actually, let's just default to open on desktop, closed on mobile on mount only
      }
    };

    // Set initial state based on width
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }

    // Optional: Auto-close on resize to mobile? For now, leave as is.
  }, []);

  const handleLogout = async () => {
    // Clear auth cookies set during login
    document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax; Secure';
    document.cookie = 'sb-refresh-token=; path=/; max-age=0; SameSite=Lax; Secure';
    await supabase.auth.signOut();
    router.push('/admin/login');
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }

      const registrations = await navigator.serviceWorker?.getRegistrations();
      if (registrations) {
        await Promise.all(registrations.map(r => r.unregister()));
      }

      localStorage.clear();
      sessionStorage.clear();

      alert('Cache cleared successfully. The page will now reload.');
      window.location.reload();
    } catch (err) {
      console.error('Cache clear error:', err);
      alert('Cache partially cleared. The page will now reload.');
      window.location.reload();
    }
  };

  const handleToggleMaintenance = async () => {
    try {
      setMaintenanceSaving(true);

      let nextMode = !maintenanceMode;
      let nextUntil = maintenanceUntil;

      if (nextMode) {
        const now = new Date();
        const defaultTime = new Date(now.getTime() + (24 * 60 * 60 * 1000))
          .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
        const input = window.prompt('Set expected completion time (24-hour format HH:mm)', defaultTime);

        if (input === null) {
          setMaintenanceSaving(false);
          return;
        }

        const match = input.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
        if (!match) {
          alert('Invalid time format. Please use 24-hour format, e.g. 23:30.');
          setMaintenanceSaving(false);
          return;
        }

        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        const target = new Date();
        target.setHours(hours, minutes, 0, 0);
        if (target.getTime() <= Date.now()) {
          target.setDate(target.getDate() + 1);
        }
        nextUntil = target.toISOString();
      }

      const maintenanceMessage = "We're currently performing scheduled maintenance. Please check back soon.";

      const rows = [
        { key: 'maintenance_mode', value: JSON.stringify(nextMode) },
        { key: 'maintenance_until', value: JSON.stringify(nextMode ? nextUntil : '') },
        { key: 'maintenance_message', value: JSON.stringify(maintenanceMessage) },
      ];

      const { error } = await supabase
        .from('site_settings')
        .upsert(rows, { onConflict: 'key' });
      if (error) throw error;

      setMaintenanceMode(nextMode);
      setMaintenanceUntil(nextMode ? nextUntil : '');
      alert(nextMode ? 'Maintenance mode is now ON.' : 'Maintenance mode is now OFF.');
    } catch (err) {
      console.error('Failed to toggle maintenance mode:', err);
      alert('Failed to update maintenance mode.');
    } finally {
      setMaintenanceSaving(false);
    }
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">Loading Admin...</div>;
  }

  const menuItems = [
    {
      title: 'Dashboard',
      icon: 'ri-dashboard-line',
      path: '/admin',
      exact: true
    },
    {
      title: 'Orders',
      icon: 'ri-shopping-bag-line',
      path: '/admin/orders',
      badge: ''
    },
    {
      title: 'POS System',
      icon: 'ri-store-3-line',
      path: '/admin/pos'
    },
    {
      title: 'Products',
      icon: 'ri-box-3-line',
      path: '/admin/products'
    },
    {
      title: 'Sales',
      icon: 'ri-price-tag-3-line',
      path: '/admin/sales'
    },
    {
      title: 'Categories',
      icon: 'ri-folder-line',
      path: '/admin/categories'
    },
    {
      title: 'Customers',
      icon: 'ri-group-line',
      path: '/admin/customers'
    },
    {
      title: 'Staff',
      icon: 'ri-shield-user-line',
      path: '/admin/staff'
    },
    {
      title: 'Affiliates',
      icon: 'ri-user-star-line',
      path: '/admin/affiliates'
    },
    {
      title: 'Reviews',
      icon: 'ri-chat-smile-2-line',
      path: '/admin/reviews'
    },
    {
      title: 'Inventory',
      icon: 'ri-stack-line',
      path: '/admin/inventory'
    },
    {
      title: 'Barcodes',
      icon: 'ri-barcode-line',
      path: '/admin/barcodes'
    },
    {
      title: 'Analytics',
      icon: 'ri-bar-chart-line',
      path: '/admin/analytics'
    },
    {
      title: 'Coupons',
      icon: 'ri-coupon-2-line',
      path: '/admin/coupons'
    },
    {
      title: 'Customer Insights',
      icon: 'ri-user-search-line',
      path: '/admin/customer-insights',
      moduleId: 'customer-insights'
    },
    {
      title: 'Notifications',
      icon: 'ri-notification-3-line',
      path: '/admin/notifications',
      moduleId: 'notifications'
    },
    {
      title: 'SMS Debugger',
      icon: 'ri-message-2-line',
      path: '/admin/test-sms'
    },
    {
      title: 'Payment reconciliation',
      icon: 'ri-exchange-dollar-line',
      path: '/admin/reconcile-payments'
    },

    {
      title: 'Blog',
      icon: 'ri-article-line',
      path: '/admin/blog',
      moduleId: 'blog'
    },
    {
      title: 'Modules',
      icon: 'ri-puzzle-line',
      path: '/admin/modules'
    },
    {
      title: 'Activity Logs',
      icon: 'ri-history-line',
      path: '/admin/activity-logs',
      requiresLogAccess: true
    },
    {
      title: 'Settings',
      icon: 'ri-settings-3-line',
      path: '/admin/settings'
    },
  ];

  const visibleMenuItems = menuItems.filter(item => {
    if (userRole === 'staff_pos') {
      return item.path === '/admin/orders' || item.path === '/admin/pos';
    }
    // @ts-ignore
    if (item.requiresLogAccess && !canViewLogs) return false;
    // @ts-ignore
    if (!item.moduleId) return true;
    // @ts-ignore
    return enabledModules.includes(item.moduleId);
  });

  // Special layout for Login Page
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden glass-overlay"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Mobile: Transform / Desktop: Width transition */}
      <aside
        className={`fixed top-0 left-0 z-40 h-screen bg-white border-r border-gray-200 transition-all duration-300
          w-64
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
          ${isSidebarOpen ? 'lg:w-64' : 'lg:w-0 lg:overflow-hidden'}
          lg:translate-x-0
        `}
      >
        <div className="h-full px-4 py-6 overflow-y-auto">
          <Link href={userRole === 'staff_pos' ? '/admin/pos' : '/admin'} className="flex items-center mb-8 px-2 cursor-pointer">
            {adminLogo ? (
              <img src={adminLogo} alt={siteName} className="h-10 w-auto object-contain" />
            ) : (
              <>
                <span className="text-xl font-['Pacifico'] text-blue-700">DDZ</span>
                <span className="ml-3 text-sm font-semibold text-gray-500">ADMIN</span>
              </>
            )}
          </Link>

          <nav className="space-y-1">
            {visibleMenuItems.map((item) => {
              const isActive = item.exact ? pathname === item.path : pathname.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => window.innerWidth < 1024 && setIsSidebarOpen(false)} // Close on mobile click
                  className={`flex items-center justify-between px-4 py-3 rounded-lg transition-colors cursor-pointer ${isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <div className="flex items-center space-x-3">
                    <i className={`${item.icon} text-xl w-5 h-5 flex items-center justify-center`}></i>
                    <span>{item.title}</span>
                  </div>
                  {item.badge && (
                    <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-1 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {userRole !== 'staff_pos' && (
          <div className="mt-4 px-2">
            <button
              onClick={handleToggleMaintenance}
              disabled={maintenanceSaving}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${maintenanceMode
                ? 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
            >
              <div className="flex items-center gap-3">
                <i className={`${maintenanceSaving ? 'ri-loader-4-line animate-spin' : 'ri-tools-line'} text-xl`}></i>
                <div className="text-left">
                  <p className="text-sm font-semibold">Maintenance Mode</p>
                  {maintenanceMode && maintenanceUntil && (
                    <p className="text-xs opacity-80">Until {formatTime24(maintenanceUntil)}</p>
                  )}
                </div>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${maintenanceMode ? 'bg-amber-200 text-amber-900' : 'bg-gray-200 text-gray-700'}`}>
                {maintenanceMode ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
          )}

          <div className={`mt-8 pt-8 border-t border-gray-200 ${userRole === 'staff_pos' ? 'mt-4 pt-4 border-0' : ''}`}>
            {userRole !== 'staff_pos' && (
            <button
              onClick={handleClearCache}
              disabled={clearingCache}
              className="w-full flex items-center space-x-3 px-4 py-3 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <i className={`${clearingCache ? 'ri-loader-4-line animate-spin' : 'ri-delete-bin-2-line'} text-xl w-5 h-5 flex items-center justify-center`}></i>
              <span>{clearingCache ? 'Clearing...' : 'Clear Cache'}</span>
            </button>
            )}
            <Link
              href="/"
              target="_blank"
              onClick={() => window.innerWidth < 1024 && setIsSidebarOpen(false)}
              className="flex items-center space-x-3 px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
            >
              <i className="ri-external-link-line text-xl w-5 h-5 flex items-center justify-center"></i>
              <span>View Store</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`transition-all duration-300 ml-0 ${isSidebarOpen ? 'lg:ml-64' : 'lg:ml-0'}`}>
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-4 py-4 lg:px-6 flex items-center justify-between">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="w-10 h-10 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
            >
              <i className={`${isSidebarOpen ? 'ri-menu-fold-line' : 'ri-menu-unfold-line'} text-xl`}></i>
            </button>

            <div className="flex items-center space-x-2 lg:space-x-4">
              <button className="relative w-10 h-10 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer">
                <i className="ri-notification-3-line text-xl"></i>
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
              </button>

              <div className="relative user-menu-container">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center space-x-2 lg:space-x-3 px-2 lg:px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                >
                  <div className="w-8 h-8 lg:w-9 lg:h-9 flex items-center justify-center bg-blue-100 text-blue-700 rounded-full font-semibold">
                    {user?.email?.charAt(0).toUpperCase() || 'A'}
                  </div>
                  <div className="text-left hidden md:block">
                    <p className="text-sm font-semibold text-gray-900 capitalize">{userRole || 'Admin'}</p>
                    <p className="text-xs text-gray-500 max-w-[100px] truncate">{user?.email}</p>
                  </div>
                  <i className="ri-arrow-down-s-line text-gray-600"></i>
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-20">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center space-x-3 px-4 py-3 hover:bg-gray-50 transition-colors border-t border-gray-200 text-left cursor-pointer"
                    >
                      <i className="ri-logout-box-line text-red-600 w-5 h-5 flex items-center justify-center"></i>
                      <span className="text-red-600">Logout</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

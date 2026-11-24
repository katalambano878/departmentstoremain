'use client';

import Link from 'next/link';
import { thumb } from '@/lib/thumb';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/supabase-paginate';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function AdminDashboard() {
  const [dateRange, setDateRange] = useState<'7days' | '30days'>('7days');
  // Real sales (paid, not cancelled/refunded) — the chart is built from these for the chosen range.
  const [realOrders, setRealOrders] = useState<{ total: number | null; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Real Stats
  const [stats, setStats] = useState<{ title: string; value: string; note: string; icon: string; color: string }[]>([
    { title: 'Revenue (all time)', value: 'GH₵ 0.00', note: 'Paid orders', icon: 'ri-money-dollar-circle-line', color: 'blue' },
    { title: 'Paid Orders', value: '0', note: 'All time', icon: 'ri-shopping-bag-line', color: 'blue' },
    { title: 'Paying Customers', value: '0', note: 'Unique emails', icon: 'ri-group-line', color: 'purple' },
    { title: 'Avg Order Value', value: 'GH₵ 0.00', note: 'Paid orders', icon: 'ri-line-chart-line', color: 'amber' }
  ]);

  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);

  const chartData = useMemo(() => {
    const days = dateRange === '30days' ? 30 : 7;
    const keys = Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      return d.toISOString().split('T')[0];
    });
    const map: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
    realOrders.forEach((order) => {
      const key = new Date(order.created_at).toISOString().split('T')[0];
      if (map[key] !== undefined) map[key] += Number(order.total || 0);
    });
    return keys.map((key) => ({
      date: new Date(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      revenue: map[key],
    }));
  }, [realOrders, dateRange]);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        // 1. Fetch ALL Orders for count & customers.  We page through
        //    1000-row chunks because PostgREST silently caps a bare
        //    SELECT at max-rows (Supabase default = 1000), which used
        //    to make the "Orders" tile freeze at 1000 once the shop
        //    crossed that threshold.
        const allOrdersData = await fetchAllPaged<{
          total: number | null;
          status: string;
          payment_status: string;
          created_at: string;
          email: string;
        }>(() =>
          supabase
            .from('orders')
            .select('total, status, payment_status, created_at, email')
            .order('created_at', { ascending: false })
        );

        // Real sales only: paid, and not cancelled or refunded. Unpaid
        // (abandoned) checkouts and cancelled/refunded orders are not counted.
        const paidOrders = allOrdersData.filter(
          o => o.payment_status === 'paid' && o.status !== 'cancelled' && o.status !== 'refunded'
        );
        const totalRevenue = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
        const paidOrderCount = paidOrders.length;
        const avgOrderValue = paidOrderCount > 0 ? totalRevenue / paidOrderCount : 0;
        const uniqueCustomers = new Set(
          paidOrders.map(o => (o.email || '').trim().toLowerCase()).filter(Boolean)
        ).size;

        setRealOrders(paidOrders);

        setStats([
          { title: 'Revenue (all time)', value: `GH₵ ${totalRevenue.toFixed(2)}`, note: 'Paid orders', icon: 'ri-money-dollar-circle-line', color: 'blue' },
          { title: 'Paid Orders', value: paidOrderCount.toString(), note: 'All time', icon: 'ri-shopping-bag-line', color: 'blue' },
          { title: 'Paying Customers', value: uniqueCustomers.toString(), note: 'Unique emails', icon: 'ri-group-line', color: 'purple' },
          { title: 'Avg Order Value', value: `GH₵ ${avgOrderValue.toFixed(2)}`, note: 'Paid orders', icon: 'ri-line-chart-line', color: 'amber' }
        ]);

        // 3. Fetch Recent Orders (paid, not cancelled or refunded)
        const { data: recentOrdersData } = await supabase
          .from('orders')
          .select('id, order_number, user_id, email, created_at, total, status, shipping_address')
          .eq('payment_status', 'paid')
          .not('status', 'in', '(cancelled,refunded)')
          .order('created_at', { ascending: false })
          .limit(5);

        if (recentOrdersData) {
          const formattedRecent = recentOrdersData.map((o: any) => {
            const addr = o.shipping_address || {};
            const customerName = (addr.firstName && addr.lastName)
              ? `${addr.firstName.trim()} ${addr.lastName.trim()}`
              : addr.full_name || addr.firstName || o.email.split('@')[0];
            return {
              id: o.id,
              displayId: o.order_number,
              customer: customerName,
              email: o.email,
              date: new Date(o.created_at).toLocaleDateString(),
              total: o.total,
              status: o.status,
              items: 1
            };
          });
          setRecentOrders(formattedRecent);
        }

        // 4. Fetch Low Stock Products
        const { data: lowStockData } = await supabase
          .from('products')
          .select('name, quantity')
          .lt('quantity', 10)
          .limit(5);

        if (lowStockData) {
          setLowStockProducts(lowStockData.map((p: any) => ({
            name: p.name,
            stock: p.quantity,
            status: p.quantity === 0 ? 'critical' : 'low'
          })));
        }

        // 5. Fetch Top Products (Approximation: High Price or just Random for now, 
        // real top selling requires aggregation on order_items which is complex for client-side)
        // real top selling requires aggregation on order_items which is complex for client-side)
        const { data: productData } = await supabase.from('products').select('*, product_images(url)').limit(4);
        if (productData) {
          setTopProducts(productData.map((p: any) => ({
            id: p.id,
            name: p.name,
            image: p.product_images?.[0]?.url || 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2780%27 height=%2780%27 viewBox=%270 0 80 80%27%3E%3Crect width=%2780%27 height=%2780%27 fill=%27%23f3f4f6%27/%3E%3Cpath d=%27M24 54l10-12 8 9 6-7 8 10z%27 fill=%27%23d1d5db%27/%3E%3Ccircle cx=%2730%27 cy=%2730%27 r=%275%27 fill=%27%23d1d5db%27/%3E%3C/svg%3E',
            sales: 0, // Mocked for now
            revenue: 0, // Mocked for now
            stock: p.quantity
          })));
        }

      } catch (error) {
        console.error('Error loading dashboard:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  const statusColors: any = {
    'pending': 'bg-amber-100 text-amber-700',
    'processing': 'bg-blue-100 text-blue-700',
    'shipped': 'bg-purple-100 text-purple-700',
    'picked_up': 'bg-indigo-100 text-indigo-700',
    'completed': 'bg-emerald-100 text-emerald-700',
    'delivered': 'bg-blue-100 text-blue-700',
    'cancelled': 'bg-red-100 text-red-700'
  };

  const quickActions = [
    {
      title: 'Feature Modules',
      description: 'Manage 40+ store features',
      icon: 'ri-puzzle-line',
      color: 'purple',
      link: '/admin/modules',
      badge: '40 Features'
    },
    {
      title: 'Inventory Management',
      description: 'Track stock & manage reorders',
      icon: 'ri-stack-line',
      color: 'amber',
      link: '/admin/inventory'
    },
    // ... reduced list for brevity or keep all if desired
  ];

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading Dashboard...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-2 sm:py-8">
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-600 mt-1">Welcome back! Here's what's happening with your store.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
          {stats.map((stat, index) => (
            <div key={stat.title} className={`min-w-0 bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 hover:shadow-md transition-shadow ${index === 0 || (stats.length % 2 === 0 && index === stats.length - 1) ? 'col-span-2 md:col-span-1' : ''}`}>
              <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
                <div className={`w-10 h-10 sm:w-12 sm:h-12 shrink-0 flex items-center justify-center bg-${stat.color}-100 text-${stat.color}-700 rounded-lg`}>
                  <i className={`${stat.icon} text-xl sm:text-2xl`}></i>
                </div>
                <span className="text-xs font-medium text-gray-500 text-right">
                  {stat.note}
                </span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1 break-words">{stat.value}</h3>
              <p className="text-gray-600 text-sm">{stat.title}</p>
            </div>
          ))}
        </div>

        {/* Revenue Chart & Quick Actions */}
        <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <div className="min-w-0 lg:col-span-2 bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Revenue Trend</h2>
              <select
                className="bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value === '30days' ? '30days' : '7days')}
              >
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
              </select>
            </div>
            <div className="h-64 sm:h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(value) => `GH₵${value}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value) => [`GH₵${(value as number)?.toFixed(2) ?? '0.00'}`, 'Revenue']}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <Link href="/admin/products/new" className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded-lg transition-colors group">
                <div className="flex items-center font-medium">
                  <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center mr-3 group-hover:bg-blue-100 transition-colors shadow-sm">
                    <i className="ri-add-line"></i>
                  </span>
                  Add Product
                </div>
                <i className="ri-arrow-right-line"></i>
              </Link>
              <Link href="/admin/pos" className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded-lg transition-colors group">
                <div className="flex items-center font-medium">
                  <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center mr-3 group-hover:bg-blue-100 transition-colors shadow-sm">
                    <i className="ri-computer-line"></i>
                  </span>
                  Open POS
                </div>
                <i className="ri-arrow-right-line"></i>
              </Link>
              <Link href="/admin/orders" className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded-lg transition-colors group">
                <div className="flex items-center font-medium">
                  <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center mr-3 group-hover:bg-blue-100 transition-colors shadow-sm">
                    <i className="ri-file-list-line"></i>
                  </span>
                  Manage Orders
                </div>
                <i className="ri-arrow-right-line"></i>
              </Link>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <div className="min-w-0 lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">Recent Orders</h2>
              <Link href="/admin/orders" className="text-blue-700 hover:text-blue-800 font-medium text-sm whitespace-nowrap cursor-pointer">
                View All <i className="ri-arrow-right-line ml-1"></i>
              </Link>
            </div>

            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              {recentOrders.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No recent orders.</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Order ID</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Customer</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Date</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Total</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map((order) => (
                      <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-4">
                          <Link href={`/admin/orders/${order.id}`} className="text-blue-700 hover:text-blue-800 font-medium whitespace-nowrap cursor-pointer">
                            {order.displayId}
                          </Link>
                        </td>
                        <td className="py-4 px-4">
                          <p className="font-medium text-gray-900 whitespace-nowrap">{order.customer}</p>
                          <p className="text-sm text-gray-500">{order.email}</p>
                        </td>
                        <td className="py-4 px-4 text-gray-700 whitespace-nowrap">{order.date}</td>
                        <td className="py-4 px-4 font-semibold text-gray-900 whitespace-nowrap">GH₵ {Number(order.total || 0).toFixed(2)}</td>
                        <td className="py-4 px-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[order.status] || 'bg-gray-100'}`}>
                            {order.status === 'shipped'
                              ? 'Packaged'
                              : order.status === 'picked_up'
                                ? 'Picked Up by Rider'
                                : order.status === 'completed'
                                  ? 'Completed'
                                : order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Low Stock Alert</h2>
              {lowStockProducts.length === 0 ? (
                <p className="text-gray-500">Inventory looks good!</p>
              ) : (
                <div className="space-y-3">
                  {lowStockProducts.map((product, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 text-sm truncate pr-2">{product.name}</p>
                        <p className="text-xs text-gray-600 mt-1">Stock: {product.stock} units</p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${product.status === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                        {product.status === 'critical' ? 'Critical' : 'Low'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Link href="/admin/inventory" className="block text-center mt-4 text-blue-700 hover:text-blue-800 font-medium text-sm whitespace-nowrap cursor-pointer">
                Open Inventory (low stock tab) <i className="ri-arrow-right-line ml-1"></i>
              </Link>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Products</h2>
            <Link href="/admin/products" className="text-blue-700 hover:text-blue-800 font-medium text-sm whitespace-nowrap cursor-pointer">
              View All <i className="ri-arrow-right-line ml-1"></i>
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {topProducts.map((product) => (
              <div key={product.id} className="min-w-0 border border-gray-200 rounded-xl p-3 sm:p-4 hover:shadow-md transition-shadow">
                <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden mb-3">
                  <img src={thumb(product.image, 160)} alt={product.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">{product.name}</h3>
                <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
                  <span className="text-sm text-gray-600">Stock: {product.stock}</span>
                  <Link href={`/admin/products/${product.id}`} className="text-blue-700 hover:text-blue-800 text-sm font-medium whitespace-nowrap cursor-pointer">
                    Edit <i className="ri-arrow-right-line ml-1"></i>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

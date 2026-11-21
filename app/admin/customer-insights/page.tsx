'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/supabase-paginate';
import { downloadCsv, csvMoney } from '@/lib/csv';

const STAFF_ROLES = ['admin', 'staff', 'staff_pos'];

/** Last 9 digits of a phone number, so 024…, +23324… and 23324… match. */
const phoneKey = (phone?: string | null) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
};
const emailKey = (email?: string | null) => String(email || '').trim().toLowerCase();

// Helper for currency formatting
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS'
  }).format(amount);
};

export default function CustomerInsightsPage() {
  const [selectedSegment, setSelectedSegment] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Statistics
  const [stats, setStats] = useState({
    vip: 0,
    returning: 0,
    new: 0,
    atRisk: 0,
    noOrders: 0,
    avgCLV: 0
  });

  useEffect(() => {
    fetchCustomerData();
  }, []);

  const fetchCustomerData = async () => {
    try {
      setLoading(true);

      // 1. Every customer record: registered shoppers, guests and till customers.
      const customerRows = await fetchAllPaged<any>(() =>
        supabase
          .from('customers')
          .select('id, user_id, email, phone, secondary_email, secondary_phone, full_name, first_name, last_name, created_at')
          .order('created_at', { ascending: false })
      );

      // 2. Staff accounts are not customers.
      const staffProfiles = await fetchAllPaged<any>(() =>
        supabase.from('profiles').select('id, email, role').in('role', STAFF_ROLES)
      );
      const staffIds = new Set(staffProfiles.map((p: any) => p.id));
      const staffEmails = new Set(staffProfiles.map((p: any) => emailKey(p.email)).filter(Boolean));

      // 3. Real sales only: paid, not cancelled or refunded.
      const orders = await fetchAllPaged<any>(() =>
        supabase
          .from('orders')
          .select('id, user_id, email, phone, total, created_at, status')
          .eq('payment_status', 'paid')
          .not('status', 'in', '(cancelled,refunded)')
          .order('created_at', { ascending: false })
      );

      const byUser = new Map<string, any[]>();
      const byEmail = new Map<string, any[]>();
      const byPhone = new Map<string, any[]>();
      const push = (map: Map<string, any[]>, key: string, o: any) => {
        if (!key) return;
        const list = map.get(key) || [];
        list.push(o);
        map.set(key, list);
      };
      for (const o of orders) {
        if (o.user_id) push(byUser, o.user_id, o);
        push(byEmail, emailKey(o.email), o);
        push(byPhone, phoneKey(o.phone), o);
      }

      const now = Date.now();
      const aggregated = customerRows
        .filter((c: any) => !(c.user_id && staffIds.has(c.user_id)) && !staffEmails.has(emailKey(c.email)))
        .map((c: any) => {
          // Orders placed signed in, or as a guest / at the till with this email or phone.
          const matched = new Map<string, any>();
          const add = (list?: any[]) => list?.forEach((o) => matched.set(o.id, o));
          if (c.user_id) add(byUser.get(c.user_id));
          add(byEmail.get(emailKey(c.email)));
          add(byEmail.get(emailKey(c.secondary_email)));
          add(byPhone.get(phoneKey(c.phone)));
          add(byPhone.get(phoneKey(c.secondary_phone)));
          const userOrders = Array.from(matched.values());

          const totalSpent = userOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
          const orderCount = userOrders.length;
          const lastPaidAt = userOrders.reduce<string | null>(
            (latest, o) => (!latest || o.created_at > latest ? o.created_at : latest),
            null
          );
          const lastOrderDate = lastPaidAt;

          const joinDate = c.created_at;
          const daysSinceJoin = (now - new Date(joinDate).getTime()) / (1000 * 3600 * 24);
          const daysSinceLastOrder = lastOrderDate
            ? (now - new Date(lastOrderDate).getTime()) / (1000 * 3600 * 24)
            : Infinity;

          let segment = 'new';
          if (totalSpent > 1000) segment = 'vip';
          else if (orderCount > 0 && daysSinceLastOrder > 90) segment = 'at-risk';
          else if (orderCount > 1) segment = 'returning';
          else if (orderCount === 1 || daysSinceJoin < 30) segment = 'new';
          else segment = 'no-orders';

          let riskLevel = 'low';
          if (daysSinceLastOrder > 60) riskLevel = 'medium';
          if (daysSinceLastOrder > 120) riskLevel = 'high';

          let engagementScore = 50;
          if (segment === 'vip') engagementScore += 40;
          if (riskLevel === 'high') engagementScore -= 30;
          if (daysSinceLastOrder < 30) engagementScore += 20;

          const name =
            c.full_name ||
            [c.first_name, c.last_name].filter(Boolean).join(' ') ||
            (c.email ? String(c.email).split('@')[0] : '') ||
            'Unknown';

          return {
            id: c.id,
            name,
            email: c.email || '',
            phone: c.phone || '-',
            isGuest: !c.user_id,
            segment,
            totalSpent,
            orders: orderCount,
            avgOrderValue: orderCount > 0 ? totalSpent / orderCount : 0,
            lifetimeValue: totalSpent,
            joinDate,
            lastOrder: lastOrderDate,
            riskLevel,
            engagementScore: Math.min(100, Math.max(0, engagementScore)),
            tags: []
          };
        });

      setCustomers(aggregated);

      // Calculate Stats
      const totalCLV = aggregated.reduce((sum, c) => sum + c.lifetimeValue, 0);
      const buyers = aggregated.filter(c => c.orders > 0);
      setStats({
        vip: aggregated.filter(c => c.segment === 'vip').length,
        returning: aggregated.filter(c => c.segment === 'returning').length,
        new: aggregated.filter(c => c.segment === 'new').length,
        atRisk: aggregated.filter(c => c.segment === 'at-risk').length,
        noOrders: aggregated.filter(c => c.segment === 'no-orders').length,
        // Average over customers who have bought something.
        avgCLV: buyers.length > 0 ? totalCLV / buyers.length : 0
      });

    } catch (err) {
      console.error('Error fetching customer insights:', err);
    } finally {
      setLoading(false);
    }
  };


  const filteredCustomers = customers.filter(customer => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = customer.name.toLowerCase().includes(q) ||
      customer.email.toLowerCase().includes(q) ||
      String(customer.phone || '').toLowerCase().includes(q);
    const matchesSegment = selectedSegment === 'all' || customer.segment === selectedSegment;
    return matchesSearch && matchesSegment;
  });

  const handleExport = () => {
    downloadCsv(
      `customer-insights-${selectedSegment}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Name', 'Email', 'Phone', 'Type', 'Segment', 'Paid Orders', 'Total Spent (GHS)', 'Avg Order (GHS)', 'Risk', 'Joined', 'Last Paid Order'],
      filteredCustomers.map(c => [
        c.name,
        c.email,
        c.phone === '-' ? '' : c.phone,
        c.isGuest ? 'Guest / till' : 'Registered',
        getSegmentLabel(c.segment),
        c.orders,
        csvMoney(c.totalSpent),
        csvMoney(c.avgOrderValue),
        c.riskLevel,
        c.joinDate ? new Date(c.joinDate).toLocaleDateString('en-GB') : '',
        c.lastOrder ? new Date(c.lastOrder).toLocaleDateString('en-GB') : '',
      ])
    );
  };

  const getSegmentBadge = (segment: string) => {
    const badges: any = {
      vip: 'bg-blue-100 text-blue-700',
      returning: 'bg-blue-100 text-blue-700',
      new: 'bg-amber-100 text-amber-700',
      'at-risk': 'bg-red-100 text-red-700',
      'no-orders': 'bg-gray-100 text-gray-700'
    };
    return badges[segment] || 'bg-gray-100 text-gray-700';
  };

  const getSegmentLabel = (segment: string) => {
    const labels: any = {
      vip: 'VIP Customer',
      returning: 'Returning',
      new: 'New Customer',
      'at-risk': 'At Risk',
      'no-orders': 'No Paid Orders'
    };
    return labels[segment] || segment;
  };

  const getRiskBadge = (risk: string) => {
    const badges: any = {
      low: 'bg-blue-100 text-blue-700',
      medium: 'bg-amber-100 text-amber-700',
      high: 'bg-red-100 text-red-700'
    };
    return badges[risk] || 'bg-gray-100';
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Insights...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto sm:px-6 lg:px-8 sm:py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 mb-6 sm:mb-8">
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Customer Insights</h1>
            <p className="text-gray-600 mt-1 md:mt-2 text-sm md:text-base">Deep dive into customer behavior and lifetime value</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <button
              onClick={handleExport}
              disabled={filteredCustomers.length === 0}
              className="flex-1 sm:flex-none border-2 border-gray-300 hover:border-gray-400 text-gray-700 px-4 sm:px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="ri-download-line mr-2"></i>
              Export List ({filteredCustomers.length})
            </button>
            <Link
              href="/admin"
              className="flex-1 sm:flex-none bg-gray-900 hover:bg-gray-800 text-white px-4 sm:px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap text-center"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 min-w-0">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center bg-blue-100 rounded-lg">
                <i className="ri-vip-crown-line text-2xl text-blue-700"></i>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-1">VIP Customers</p>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900 break-words">{stats.vip}</p>
            <p className="text-sm text-blue-700 font-semibold mt-2">Spent &gt; GH₵1,000</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 min-w-0">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center bg-blue-100 rounded-lg">
                <i className="ri-refresh-line text-2xl text-blue-700"></i>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-1">Returning Customers</p>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900 break-words">{stats.returning}</p>
            <p className="text-sm text-blue-700 font-semibold mt-2">More than 1 order</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 min-w-0">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center bg-red-100 rounded-lg">
                <i className="ri-alert-line text-2xl text-red-700"></i>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-1">At Risk</p>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900 break-words">{stats.atRisk}</p>
            <p className="text-sm text-red-700 font-semibold mt-2">Inactive &gt; 90 days</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 min-w-0">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center bg-purple-100 rounded-lg">
                <i className="ri-line-chart-line text-2xl text-purple-700"></i>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-1">Avg. Lifetime Value</p>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900 break-words">{formatCurrency(stats.avgCLV)}</p>
            <p className="text-sm text-gray-500 mt-2">Per paying customer</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
            <div className="w-full md:flex-1 md:max-w-md">
              <div className="relative">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl"></i>
                <input
                  type="text"
                  placeholder="Search customers by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base sm:text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto md:flex-wrap md:overflow-visible bg-gray-100 rounded-lg p-1">
              {[
                { value: 'all', label: 'All', count: customers.length },
                { value: 'vip', label: 'VIP', count: stats.vip },
                { value: 'returning', label: 'Returning', count: stats.returning },
                { value: 'new', label: 'New', count: stats.new },
                { value: 'at-risk', label: 'At Risk', count: stats.atRisk },
                { value: 'no-orders', label: 'No Orders', count: stats.noOrders }
              ].map((segment) => (
                <button
                  key={segment.value}
                  onClick={() => setSelectedSegment(segment.value)}
                  className={`px-3 py-2 rounded-md font-medium text-sm transition-colors whitespace-nowrap shrink-0 min-h-[44px] md:min-h-0 flex-grow md:flex-grow-0 ${selectedSegment === segment.value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  {segment.label} ({segment.count})
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {filteredCustomers.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl">
              <p className="text-gray-500">No customers found matching this criteria.</p>
            </div>
          ) : (
            filteredCustomers.map((customer) => (
              <div key={customer.id} className="bg-white rounded-xl shadow-sm p-4 sm:p-6 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-3 sm:gap-0 sm:space-x-4 min-w-0">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 shrink-0 flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-700 rounded-full text-white text-xl sm:text-2xl font-bold">
                      {customer.name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg sm:text-xl font-bold text-gray-900 break-words">{customer.name}</h3>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-gray-600">
                        <span className="flex items-center min-w-0 break-all">
                          <i className="ri-mail-line mr-1"></i>
                          {customer.email}
                        </span>
                        <span className="flex items-center">
                          <i className="ri-phone-line mr-1"></i>
                          {customer.phone}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getSegmentBadge(customer.segment)} whitespace-nowrap`}>
                          {getSegmentLabel(customer.segment)}
                        </span>
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getRiskBadge(customer.riskLevel)} whitespace-nowrap`}>
                          {customer.riskLevel === 'low' && 'Low Risk'}
                          {customer.riskLevel === 'medium' && 'Medium Risk'}
                          {customer.riskLevel === 'high' && 'High Risk'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* <button className="text-gray-400 hover:text-gray-600 transition-colors">
                    <i className="ri-more-2-fill text-2xl"></i>
                    </button> */}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4 mb-4">
                  <div className="bg-gray-50 rounded-lg p-3 sm:p-4 min-w-0">
                    <p className="text-sm text-gray-600 mb-1">Total Spent</p>
                    <p className="text-lg sm:text-2xl break-words font-bold text-gray-900">{formatCurrency(customer.totalSpent)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 sm:p-4 min-w-0">
                    <p className="text-sm text-gray-600 mb-1">Orders</p>
                    <p className="text-lg sm:text-2xl break-words font-bold text-gray-900">{customer.orders}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 sm:p-4 min-w-0">
                    <p className="text-sm text-gray-600 mb-1">Avg. Order</p>
                    <p className="text-lg sm:text-2xl break-words font-bold text-gray-900">{formatCurrency(customer.avgOrderValue)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 sm:p-4 min-w-0">
                    <p className="text-sm text-gray-600 mb-1">Lifetime Value</p>
                    <p className="text-lg sm:text-2xl break-words font-bold text-blue-700">{formatCurrency(customer.lifetimeValue)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 sm:p-4 col-span-2 md:col-span-1">
                    <p className="text-sm text-gray-600 mb-1">Engagement</p>
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${customer.engagementScore >= 80 ? 'bg-blue-600' :
                            customer.engagementScore >= 60 ? 'bg-blue-600' :
                              customer.engagementScore >= 40 ? 'bg-amber-600' : 'bg-red-600'
                            }`}
                          style={{ width: `${customer.engagementScore}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-bold text-gray-900">{customer.engagementScore}%</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
                    <span>
                      <span className="font-medium">Joined:</span> {new Date(customer.joinDate).toLocaleDateString('en-GB')}
                    </span>
                    <span>
                      <span className="font-medium">Last Paid Order:</span> {customer.lastOrder ? new Date(customer.lastOrder).toLocaleDateString('en-GB') : 'None'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

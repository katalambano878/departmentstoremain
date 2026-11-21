'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/supabase-paginate';
import { downloadCsv, csvMoney } from '@/lib/csv';

export default function AdminCustomersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortOption, setSortOption] = useState('Sort by Join Date');
  const [filterStatus, setFilterStatus] = useState('All Customers');

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      setLoading(true);

      // Fetch from new customers table (includes both guests and registered users)
      const { data: customerData, error: cError } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (cError) {
        // Fallback to old profiles-based approach if customers table doesn't exist yet
        console.warn('Customers table not available, falling back to profiles');
        await fetchCustomersFromProfiles();
        return;
      }

      if (customerData) {
        const processed = customerData.map((customer: any) => {
          // Determine status dynamically
          let status = 'New';
          const totalSpent = Number(customer.total_spent) || 0;
          const totalOrders = customer.total_orders || 0;

          if (totalSpent > 1000) status = 'VIP';
          else if (totalOrders > 0) status = 'Active';
          else if (new Date(customer.created_at).getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000) status = 'Inactive';

          const displayName = customer.full_name ||
            (customer.first_name && customer.last_name ? `${customer.first_name} ${customer.last_name}` : null) ||
            customer.first_name ||
            'No Name';

          return {
            id: customer.id,
            name: displayName,
            email: customer.email,
            phone: customer.phone || 'N/A',
            avatar: getInitials(displayName !== 'No Name' ? displayName : customer.email),
            orders: totalOrders,
            totalSpent: totalSpent,
            joined: new Date(customer.created_at).toLocaleDateString(),
            lastOrder: customer.last_order_at ? timeAgo(new Date(customer.last_order_at)) : 'Never',
            status: status,
            rawJoined: new Date(customer.created_at),
            rawLastOrder: customer.last_order_at ? new Date(customer.last_order_at) : null,
            isGuest: !customer.user_id
          };
        });
        setCustomers(processed);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fallback for when customers table doesn't exist
  const fetchCustomersFromProfiles = async () => {
    try {
      // Page through profiles + orders so the customer list never silently
      // truncates once the shop has more than 1000 of either.
      const profiles = await fetchAllPaged<any>(() =>
        supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false })
      );

      const orders = await fetchAllPaged<any>(() =>
        supabase
          .from('orders')
          .select('id, user_id, email, total, created_at, status, shipping_address')
      );

      // Process registered users
      const registeredCustomers = (profiles || []).map((profile: any) => {
        const userOrders = orders?.filter(o => o.user_id === profile.id && o.status !== 'cancelled') || [];
        const totalSpent = userOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
        let lastOrderDate: Date | null = null;
        if (userOrders.length > 0) {
          const dates = userOrders.map(o => new Date(o.created_at).getTime());
          lastOrderDate = new Date(Math.max(...dates));
        }

        let status = 'New';
        if (totalSpent > 1000) status = 'VIP';
        else if (userOrders.length > 0) status = 'Active';

        return {
          id: profile.id,
          name: profile.full_name || 'No Name',
          email: profile.email,
          phone: profile.phone || 'N/A',
          avatar: getInitials(profile.full_name || profile.email),
          orders: userOrders.length,
          totalSpent,
          joined: new Date(profile.created_at).toLocaleDateString(),
          lastOrder: lastOrderDate ? timeAgo(lastOrderDate) : 'Never',
          status,
          rawJoined: new Date(profile.created_at),
          rawLastOrder: lastOrderDate,
          isGuest: false
        };
      });

      // Process guest orders (no user_id)
      const guestOrders = orders?.filter(o => !o.user_id && o.email) || [];
      const guestMap = new Map<string, any>();

      guestOrders.forEach(order => {
        const existing = guestMap.get(order.email);
        const orderTotal = Number(order.total) || 0;
        const orderDate = new Date(order.created_at);

        const firstName = order.shipping_address?.firstName || '';
        const lastName = order.shipping_address?.lastName || '';
        const fullName = order.shipping_address?.full_name || `${firstName} ${lastName}`.trim();

        if (!existing) {
          guestMap.set(order.email, {
            email: order.email,
            name: fullName || 'Guest',
            phone: order.shipping_address?.phone || 'N/A',
            orders: order.status !== 'cancelled' ? 1 : 0,
            totalSpent: order.status !== 'cancelled' ? orderTotal : 0,
            firstOrder: orderDate,
            lastOrder: orderDate
          });
        } else {
          if (order.status !== 'cancelled') {
            existing.orders += 1;
            existing.totalSpent += orderTotal;
          }
          if (orderDate < existing.firstOrder) existing.firstOrder = orderDate;
          if (orderDate > existing.lastOrder) existing.lastOrder = orderDate;
          if (!existing.name || existing.name === 'Guest') existing.name = fullName || existing.name;
        }
      });

      const guestCustomers = Array.from(guestMap.values()).map((guest, idx) => {
        let status = 'New';
        if (guest.totalSpent > 1000) status = 'VIP';
        else if (guest.orders > 0) status = 'Active';

        return {
          id: `guest-${idx}-${guest.email}`,
          name: guest.name || 'Guest',
          email: guest.email,
          phone: guest.phone,
          avatar: getInitials(guest.name || guest.email),
          orders: guest.orders,
          totalSpent: guest.totalSpent,
          joined: guest.firstOrder.toLocaleDateString(),
          lastOrder: timeAgo(guest.lastOrder),
          status,
          rawJoined: guest.firstOrder,
          rawLastOrder: guest.lastOrder,
          isGuest: true
        };
      });

      setCustomers([...registeredCustomers, ...guestCustomers]);
    } catch (error) {
      console.error('Error in fallback fetch:', error);
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const timeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    return "Just now";
  }

  const statusColors: any = {
    'New': 'bg-blue-100 text-blue-700',
    'Active': 'bg-blue-100 text-blue-700',
    'VIP': 'bg-purple-100 text-purple-700',
    'Inactive': 'bg-gray-100 text-gray-700'
  };

  /** Select-all covers the rows currently shown (search + status filter), not the whole list. */
  const handleSelectAll = () => {
    const visibleIds = filteredCustomers.map(c => c.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedCustomers.includes(id));
    setSelectedCustomers(allVisibleSelected ? [] : visibleIds);
  };

  /** Selected customers that are still visible under the current search/filter. */
  const visibleSelectedCustomers = () => {
    const visible = new Set(filteredCustomers.map(c => c.id));
    return customers.filter(c => selectedCustomers.includes(c.id) && visible.has(c.id));
  };

  const handleSelectCustomer = (customerId: string) => {
    if (selectedCustomers.includes(customerId)) {
      setSelectedCustomers(selectedCustomers.filter(id => id !== customerId));
    } else {
      setSelectedCustomers([...selectedCustomers, customerId]);
    }
  };

  const handleExportCustomers = (subset?: any[]) => {
    const data = subset || filteredCustomers;
    downloadCsv(
      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Name', 'Email', 'Phone', 'Orders', 'Total Spent (GHS)', 'Status', 'Type', 'Joined', 'Last Order'],
      data.map(c => [
        c.name,
        c.email,
        c.phone === 'N/A' ? '' : c.phone,
        c.orders,
        csvMoney(c.totalSpent),
        c.status,
        c.isGuest ? 'Guest' : 'Registered',
        c.joined,
        c.rawLastOrder ? new Date(c.rawLastOrder).toLocaleDateString() : '',
      ])
    );
  };

  const handleDeleteCustomer = async (customerId: string) => {
    if (!confirm('Are you sure you want to delete this customer?')) return;
    if (customerId.startsWith('guest-')) {
      setCustomers(customers.filter(c => c.id !== customerId));
      return;
    }
    const { error } = await supabase.from('customers').delete().eq('id', customerId);
    if (!error) {
      setCustomers(customers.filter(c => c.id !== customerId));
    } else {
      alert('Failed to delete customer: ' + error.message);
    }
  };

  const handleEmailCustomer = (customer: any) => {
    window.open(`mailto:${customer.email}?subject=Hello from Discount Discovery Zone`);
  };

  const handleBulkExport = () => {
    handleExportCustomers(visibleSelectedCustomers());
  };

  // Memoized filter and sort
  const filteredCustomers = useMemo(() => {
    let result = customers;

    // Filter by Status
    if (filterStatus !== 'All Customers') {
      result = result.filter(c => c.status === filterStatus);
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortOption === 'Sort by Name') return a.name.localeCompare(b.name);
      if (sortOption === 'Sort by Orders') return b.orders - a.orders;
      if (sortOption === 'Sort by Spent') return b.totalSpent - a.totalSpent;
      if (sortOption === 'Sort by Join Date') return b.rawJoined.getTime() - a.rawJoined.getTime();
      return 0;
    });

    return result;
  }, [customers, searchQuery, sortOption, filterStatus]);

  // Hidden customers must not stay selected after the search or filter changes.
  useEffect(() => {
    setSelectedCustomers([]);
  }, [searchQuery, filterStatus]);

  // Derived Stats
  const stats = useMemo(() => ({
    total: customers.length,
    newThisMonth: customers.filter(c => {
      const d = new Date(c.rawJoined);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
    vip: customers.filter(c => c.status === 'VIP').length,
    avgLTV: customers.length > 0 ? (customers.reduce((sum, c) => sum + c.totalSpent, 0) / customers.length) : 0
  }), [customers]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-600 mt-1">Manage your customer base and relationships</p>
        </div>
        <button
          onClick={() => handleExportCustomers()}
          className="w-full sm:w-auto bg-blue-700 hover:bg-blue-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer"
        >
          <i className="ri-download-line mr-2"></i>
          Export Customers ({filteredCustomers.length})
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Customers</p>
          <p className="text-xl sm:text-2xl break-words font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">New This Month</p>
          <p className="text-xl sm:text-2xl break-words font-bold text-blue-700">{stats.newThisMonth}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">VIP Customers</p>
          <p className="text-xl sm:text-2xl break-words font-bold text-purple-700">{stats.vip}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Avg Lifetime Value</p>
          <p className="text-xl sm:text-2xl break-words font-bold text-gray-900">GH₵ {stats.avgLTV.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-4 sm:p-6 border-b border-gray-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
            <div className="w-full md:flex-1 md:max-w-md">
              <div className="relative">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg flex items-center justify-center"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, email, or phone..."
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base sm:text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="min-w-0 flex-1 sm:flex-none px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer"
              >
                <option>All Customers</option>
                <option>New</option>
                <option>Active</option>
                <option>VIP</option>
                <option>Inactive</option>
              </select>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
                className="min-w-0 flex-1 sm:flex-none px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium cursor-pointer"
              >
                <option>Sort by Join Date</option>
                <option>Sort by Name</option>
                <option>Sort by Orders</option>
                <option>Sort by Spent</option>
              </select>
            </div>
          </div>
        </div>

        {selectedCustomers.length > 0 && (
          <div className="p-4 bg-blue-50 border-b border-blue-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-blue-800 font-semibold">
              {selectedCustomers.length} customer{selectedCustomers.length > 1 ? 's' : ''} selected
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  // Bcc so customers never see each other's addresses.
                  const emails = Array.from(new Set(
                    visibleSelectedCustomers().map(c => String(c.email || '').trim()).filter(e => e.includes('@'))
                  ));
                  if (emails.length === 0) {
                    alert('None of the selected customers has an email address.');
                    return;
                  }
                  const bcc = emails.map(e => encodeURIComponent(e)).join(',');
                  window.open(`mailto:?bcc=${bcc}&subject=${encodeURIComponent('Hello from Discount Discovery Zone')}`);
                }}
                className="flex-1 sm:flex-none min-h-[44px] sm:min-h-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <i className="ri-mail-line mr-2"></i>
                Send Email
              </button>
              <button
                onClick={handleBulkExport}
                className="flex-1 sm:flex-none min-h-[44px] sm:min-h-0 px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <i className="ri-download-line mr-2"></i>
                Export
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="py-4 px-6">
                  <input
                    type="checkbox"
                    checked={filteredCustomers.length > 0 && filteredCustomers.every(c => selectedCustomers.includes(c.id))}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Customer</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Contact</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Orders</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Total Spent</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Last Order</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-10 text-center text-gray-500">Loading customers...</td></tr>
              ) : filteredCustomers.length === 0 ? (
                <tr><td colSpan={8} className="p-10 text-center text-gray-500">No customers found.</td></tr>
              ) : (
                filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <input
                        type="checkbox"
                        checked={selectedCustomers.includes(customer.id)}
                        onChange={() => handleSelectCustomer(customer.id)}
                        className="w-4 h-4 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="w-10 h-10 shrink-0 flex items-center justify-center bg-blue-100 text-blue-700 rounded-full font-semibold">
                          {customer.avatar}
                        </div>
                        <div className="min-w-0">
                          <Link href={`/admin/customers/${customer.id}`} className="font-semibold text-gray-900 hover:text-blue-700 break-words md:whitespace-nowrap">
                            {customer.name}
                          </Link>
                          <p className="text-sm text-gray-500">Joined {customer.joined}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="min-w-0">
                        <p className="text-gray-700 text-sm break-all">{customer.email}</p>
                        <p className="text-gray-600 text-sm">{customer.phone}</p>
                      </div>
                    </td>
                    <td className="py-4 px-4 font-semibold text-gray-900">{customer.orders}</td>
                    <td className="py-4 px-4 font-semibold text-blue-700 whitespace-nowrap">GH₵ {customer.totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="py-4 px-4 text-gray-700 text-sm whitespace-nowrap">{customer.lastOrder}</td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[customer.status]}`}>
                          {customer.status}
                        </span>
                        {customer.isGuest && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            Guest
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/admin/customers/${customer.id}`}
                          className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <i className="ri-eye-line text-lg"></i>
                        </Link>
                        <button
                          onClick={() => handleEmailCustomer(customer)}
                          className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="Send Email"
                        >
                          <i className="ri-mail-line text-lg"></i>
                        </button>
                        <button
                          onClick={() => handleDeleteCustomer(customer.id)}
                          className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete Customer"
                        >
                          <i className="ri-delete-bin-line text-lg"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 sm:p-6 border-t border-gray-200 flex items-center justify-between">
          <p className="text-gray-600">Showing {filteredCustomers.length} of {customers.length} customers</p>
          <div className="flex items-center space-x-2">
            {/* Simple pagination place holder logic or hidden if few */}
          </div>
        </div>
      </div>
    </div>
  );
}

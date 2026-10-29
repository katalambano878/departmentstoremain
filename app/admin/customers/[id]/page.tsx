'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

export default function CustomerDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const customerId = params.id as string;
    
    const [customer, setCustomer] = useState<any>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ full_name: '', email: '', phone: '' });

    useEffect(() => {
        if (customerId) {
            fetchCustomerData();
        }
    }, [customerId]);

    const fetchCustomerData = async () => {
        try {
            // The customer list links with customers.id (guests and registered
            // shoppers alike). Older links used the profile id, so fall back to it.
            let record: any = null;
            const { data: customerRow } = await supabase
                .from('customers')
                .select('*')
                .eq('id', customerId)
                .maybeSingle();

            if (customerRow) {
                record = {
                    ...customerRow,
                    source: 'customers',
                    full_name: customerRow.full_name ||
                        [customerRow.first_name, customerRow.last_name].filter(Boolean).join(' ') || null,
                };
            } else {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', customerId)
                    .maybeSingle();
                if (profile) record = { ...profile, user_id: profile.id, source: 'profiles' };
            }

            if (!record) {
                setCustomer(null);
                return;
            }

            // Orders placed while signed in, or as a guest with this email or phone.
            const lookups: Array<[string, string]> = [];
            if (record.user_id) lookups.push(['user_id', record.user_id]);
            for (const email of [record.email, record.secondary_email]) {
                if (email) lookups.push(['email', email]);
            }
            for (const phone of [record.phone, record.secondary_phone]) {
                if (phone) lookups.push(['phone', phone]);
            }
            const results = await Promise.all(
                lookups.map(([col, value]) =>
                    supabase.from('orders').select('*').eq(col, value).order('created_at', { ascending: false })
                )
            );
            const byId = new Map<string, any>();
            for (const { data } of results) {
                for (const order of data || []) byId.set(order.id, order);
            }
            const merged = Array.from(byId.values()).sort(
                (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

            setCustomer(record);
            setOrders(merged);
        } catch (err) {
            console.error('Error fetching customer:', err);
        } finally {
            setLoading(false);
        }
    };

    const openEdit = () => {
        setForm({
            full_name: customer.full_name || '',
            email: customer.email || '',
            phone: customer.phone || '',
        });
        setEditing(true);
    };

    const saveCustomer = async () => {
        setSaving(true);
        try {
            const full_name = form.full_name.trim() || null;
            const updates =
                customer.source === 'customers'
                    ? { full_name, email: form.email.trim().toLowerCase() || null, phone: form.phone.trim() || null }
                    : { full_name, phone: form.phone.trim() || null };
            const { error } = await supabase
                .from(customer.source === 'customers' ? 'customers' : 'profiles')
                .update(updates)
                .eq('id', customer.id);
            if (error) throw error;
            setCustomer({ ...customer, ...updates });
            setEditing(false);
        } catch (err: any) {
            alert('Could not save the customer: ' + (err?.message || 'unknown error'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-gray-500">Loading customer details...</div>;
    if (!customer) return <div className="p-8 text-center text-red-500">Customer not found</div>;

    // Spend and order count cover paid orders only; unpaid checkouts still show in the history.
    const paidOrders = orders.filter((order) => order.payment_status === 'paid' && order.status !== 'cancelled');
    const totalSpent = paidOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    const getOrderStatusLabel = (status: string) => {
        if (status === 'shipped') return 'Packaged';
        if (status === 'picked_up') return 'Picked Up by Rider';
        return status.replace('_', ' ');
    };

    return (
        <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center space-x-4">
                    <Link href="/admin/customers" className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
                        <i className="ri-arrow-left-line text-xl"></i>
                    </Link>
                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 text-2xl font-bold">
                        {(customer.full_name || customer.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">{customer.full_name || 'No Name'}</h1>
                        <p className="text-gray-500">{customer.email}</p>
                    </div>
                </div>
                <div className="flex space-x-3">
                    <button
                        onClick={() => window.open(`mailto:${customer.email}?subject=Hello from Discount Discovery Zone`)}
                        disabled={!customer.email}
                        className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <i className="ri-mail-send-line mr-2"></i>
                        Send Email
                    </button>
                    <button
                        onClick={openEdit}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 cursor-pointer"
                    >
                        Edit Customer
                    </button>
                </div>
            </div>

            {editing && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-lg font-bold text-gray-900 mb-4">Edit Customer</h2>
                        <div className="space-y-4">
                            <label className="block">
                                <span className="block text-sm font-semibold text-gray-700 mb-1">Full name</span>
                                <input
                                    type="text"
                                    value={form.full_name}
                                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg"
                                />
                            </label>
                            {customer.source === 'customers' && (
                                <label className="block">
                                    <span className="block text-sm font-semibold text-gray-700 mb-1">Email</span>
                                    <input
                                        type="email"
                                        value={form.email}
                                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg"
                                    />
                                </label>
                            )}
                            <label className="block">
                                <span className="block text-sm font-semibold text-gray-700 mb-1">Phone</span>
                                <input
                                    type="tel"
                                    value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg"
                                />
                            </label>
                        </div>
                        <div className="flex justify-end space-x-3 mt-6">
                            <button
                                onClick={() => setEditing(false)}
                                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveCustomer}
                                disabled={saving}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                            >
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <p className="text-sm font-medium text-gray-500 mb-1">Total Spent</p>
                    <p className="text-2xl font-bold text-gray-900">GH₵{totalSpent.toFixed(2)}</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <p className="text-sm font-medium text-gray-500 mb-1">Paid Orders</p>
                    <p className="text-2xl font-bold text-gray-900">{paidOrders.length}</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <p className="text-sm font-medium text-gray-500 mb-1">Last Order</p>
                    <p className="text-xl font-bold text-gray-900">
                        {orders[0] ? new Date(orders[0].created_at).toLocaleDateString() : 'Never'}
                    </p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <p className="text-sm font-medium text-gray-500 mb-1">Phone</p>
                    <p className="text-lg font-bold text-gray-900">{customer.phone || 'N/A'}</p>
                </div>
            </div>

            {/* Orders History */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900">Order History</h2>
                </div>

                {orders.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">No orders found.</div>
                ) : (
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 text-gray-600 text-xs uppercase font-semibold">
                            <tr>
                                <th className="px-6 py-4">Order ID</th>
                                <th className="px-6 py-4">Date</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Total</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {orders.map(order => (
                                <tr key={order.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-sm font-medium text-blue-600">
                                        <Link href={`/admin/orders/${order.id}`}>#{order.id.slice(0, 8)}</Link>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">
                                        {new Date(order.created_at).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                                            ${order.status === 'completed' || order.status === 'delivered' ? 'bg-blue-100 text-blue-800' :
                                                order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                                    order.status === 'picked_up' ? 'bg-indigo-100 text-indigo-800' :
                                                    order.status === 'cancelled' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>
                                            {getOrderStatusLabel(order.status)}
                                        </span>
                                        {order.payment_status !== 'paid' && (
                                            <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                                                Unpaid
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-sm font-bold text-gray-900">
                                        GH₵{(order.total || 0).toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <Link href={`/admin/orders/${order.id}`} className="text-gray-400 hover:text-blue-600">
                                            <i className="ri-eye-line text-lg"></i>
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

import { useState, useEffect, Fragment } from 'react';
import { supabase } from '@/lib/supabase';

interface SalesStat {
    productId: string;
    productName: string;
    ordersCount: number;
    itemsSold: number;
    totalRevenue: number;
    _orderIds: Set<string>;
    variants: Map<string, { quantity: number; revenue: number }>;
}

interface VariantDisplay {
    name: string;
    quantity: number;
    revenue: number;
}

export default function ProductSalesStats({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const [period, setPeriod] = useState<'24h' | '7d' | '30d' | 'all'>('7d');
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState<(Omit<SalesStat, '_orderIds' | 'variants'> & { variants: VariantDisplay[] })[]>([]);
    const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) fetchStats();
    }, [isOpen, period]);

    const fetchStats = async () => {
        setLoading(true);

        // Calculate the start date based on period
        let startDate: string | null = null;
        const now = new Date();

        if (period === '24h') {
            const d = new Date(now);
            d.setHours(d.getHours() - 24);
            startDate = d.toISOString();
        } else if (period === '7d') {
            const d = new Date(now);
            d.setDate(d.getDate() - 7);
            startDate = d.toISOString();
        } else if (period === '30d') {
            const d = new Date(now);
            d.setDate(d.getDate() - 30);
            startDate = d.toISOString();
        }
        // 'all' leaves startDate as null

        try {
            // We fetch order_items and filter by the parent order's created_at
            let query = supabase
                .from('order_items')
                .select(`
          quantity,
          product_name,
          product_id,
          variant_name,
          total_price,
          orders!inner (
            id,
            created_at,
            status,
            payment_status
          )
        `);

            // Real sales only: paid, and not cancelled or refunded
            query = query.eq('orders.payment_status', 'paid').not('orders.status', 'in', '(cancelled,refunded)');

            if (startDate) {
                query = query.gte('orders.created_at', startDate);
            }

            const { data, error } = await query;

            if (error) throw error;

            if (data) {
                const map = new Map<string, SalesStat>();

                data.forEach((item: any) => {
                    const pid = item.product_id || item.product_name;

                    if (!map.has(pid)) {
                        map.set(pid, {
                            productId: pid,
                            productName: item.product_name,
                            ordersCount: 0,
                            itemsSold: 0,
                            totalRevenue: 0,
                            _orderIds: new Set(),
                            variants: new Map()
                        });
                    }

                    const entry = map.get(pid)!;
                    entry.itemsSold += (item.quantity || 0);
                    entry.totalRevenue += Number(item.total_price || 0);

                    // Track variants
                    const variantName = item.variant_name || 'Default';
                    const existing = entry.variants.get(variantName) || { quantity: 0, revenue: 0 };
                    existing.quantity += (item.quantity || 0);
                    existing.revenue += Number(item.total_price || 0);
                    entry.variants.set(variantName, existing);

                    const orderId = item.orders?.id;
                    if (orderId && !entry._orderIds.has(orderId)) {
                        entry.ordersCount++;
                        entry._orderIds.add(orderId);
                    }
                });

                // Convert to array and sort by items sold
                const result = Array.from(map.values())
                    .map(({ _orderIds, variants, ...rest }) => ({
                        ...rest,
                        variants: Array.from(variants.entries())
                            .map(([name, data]) => ({ name, ...data }))
                            .sort((a, b) => b.quantity - a.quantity)
                    }))
                    .sort((a, b) => b.itemsSold - a.itemsSold);

                setStats(result);
            }
        } catch (err) {
            console.error('Error fetching product stats:', err);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">

                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Product Sales Breakdown</h2>
                        <p className="text-sm text-gray-500 mt-1">See which products are performing best</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
                    >
                        <i className="ri-close-line text-2xl text-gray-500"></i>
                    </button>
                </div>

                {/* Filters */}
                <div className="px-6 py-4 bg-white border-b border-gray-100 flex gap-2">
                    {(['24h', '7d', '30d', 'all'] as const).map((p) => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${period === p
                                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-transparent'
                                }`}
                        >
                            {p === 'all' ? 'All Time' : p === '24h' ? 'Last 24 Hours' : p === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto bg-gray-50/30">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-gray-500 font-semibold uppercase tracking-wider sticky top-0 border-b border-gray-200">
                            <tr>
                                <th className="p-4 pl-6">Product Name</th>
                                <th className="p-4 text-center">Orders Count</th>
                                <th className="p-4 text-center">Items Sold (Qty)</th>
                                <th className="p-4 text-right pr-6">Revenue (Est.)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {loading ? (
                                <tr>
                                    <td colSpan={4} className="p-12 text-center text-gray-500">
                                        <i className="ri-loader-4-line text-3xl animate-spin text-blue-600 mb-2 block"></i>
                                        Loading sales data...
                                    </td>
                                </tr>
                            ) : stats.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="p-12 text-center text-gray-500">
                                        <i className="ri-inbox-line text-3xl mb-2 block text-gray-300"></i>
                                        No products sold in this period.
                                    </td>
                                </tr>
                            ) : (
                                stats.map((s) => (
                                    <Fragment key={s.productId}>
                                    {(() => {
                                        const hasVariants = s.variants.length > 1 || (s.variants.length === 1 && s.variants[0].name !== 'Default');
                                        return (
                                    <>
                                    <tr 
                                        className={`hover:bg-blue-50/30 transition-colors ${hasVariants ? 'cursor-pointer' : ''}`}
                                        onClick={() => hasVariants && setExpandedProduct(expandedProduct === s.productId ? null : s.productId)}
                                    >
                                        <td className="p-4 pl-6 font-medium text-gray-900">
                                            <div className="flex items-center space-x-2">
                                                {hasVariants ? (
                                                    <i className={`ri-arrow-${expandedProduct === s.productId ? 'down' : 'right'}-s-line text-gray-400`}></i>
                                                ) : (
                                                    <span className="w-4"></span>
                                                )}
                                                <span>{s.productName}</span>
                                                {hasVariants && (
                                                    <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">
                                                        {s.variants.length} variants
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                {s.ordersCount}
                                            </span>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="font-bold text-blue-700 text-base">{s.itemsSold}</span>
                                        </td>
                                        <td className="p-4 text-right pr-6 text-gray-600 font-mono">
                                            {s.totalRevenue > 0 ? s.totalRevenue.toLocaleString() : '-'}
                                        </td>
                                    </tr>
                                    {expandedProduct === s.productId && hasVariants && (
                                        s.variants.map((v) => (
                                            <tr key={`${s.productId}-${v.name}`} className="bg-gray-50/80 border-l-2 border-purple-200">
                                                <td className="p-3 pl-14 text-gray-600 text-xs">
                                                    <span className="inline-flex items-center space-x-1.5">
                                                        <i className="ri-price-tag-3-line text-purple-400"></i>
                                                        <span className="font-medium">{v.name}</span>
                                                    </span>
                                                </td>
                                                <td className="p-3 text-center text-xs text-gray-400">—</td>
                                                <td className="p-3 text-center text-xs font-semibold text-gray-700">{v.quantity}</td>
                                                <td className="p-3 text-right pr-6 text-xs text-gray-500 font-mono">
                                                    {v.revenue > 0 ? v.revenue.toLocaleString() : '-'}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                    </>
                                        );
                                    })()}
                                    </Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="p-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 flex justify-between">
                    <span>* Only paid/confirmed orders · Click a row to see variant breakdown</span>
                    <span>Showing top {stats.length} products</span>
                </div>
            </div>
        </div>
    );
}

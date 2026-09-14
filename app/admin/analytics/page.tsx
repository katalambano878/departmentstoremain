'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/supabase-paginate';
import { PieChart, Pie, AreaChart, Area, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

type TimeRange = 'day' | 'week' | 'month';
type SalesChannel = 'all' | 'website' | 'pos';

function isPosSale(metadata: any): boolean {
  return metadata?.pos_sale === true || metadata?.pos_sale === 'true';
}

type SalesRow = {
  date: string;
  sales: number;
  orders: number;
  fullDate: number;
};

/** Store timezone — all day/week/month boundaries use Accra local time. */
const STORE_TIMEZONE = 'Africa/Accra';

function getStoreParts(date: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: STORE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
}

/** Accra is GMT+0 year-round; keep the helper so DST elsewhere never skews audits. */
function getStoreOffsetMinutes(at: Date = new Date()) {
  const nowStr = new Intl.DateTimeFormat('en-US', {
    timeZone: STORE_TIMEZONE,
    timeZoneName: 'shortOffset',
  }).formatToParts(at).find(p => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(nowStr);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0));
}

function ymd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseYmd(value: string) {
  const [y, m, d] = value.split('-').map(Number);
  return { year: y, month: m, day: d };
}

function addDaysYmd(value: string, days: number) {
  const { year, month, day } = parseYmd(value);
  const base = new Date(Date.UTC(year, month - 1, day + days));
  return ymd(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}

function mondayOf(value: string) {
  const { year, month, day } = parseYmd(value);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sun
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  return addDaysYmd(value, -diffToMonday);
}

function endOfMonth(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0));
  return ymd(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate());
}

function formatDisplayDate(value: string) {
  const { year, month, day } = parseYmd(value);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMonthLabel(value: string) {
  const { year, month } = parseYmd(value);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function AnalyticsPage() {
  const todayParts = getStoreParts();
  const todayYmd = ymd(Number(todayParts.year), Number(todayParts.month), Number(todayParts.day));

  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [channel, setChannel] = useState<SalesChannel>('all');
  const [anchorDate, setAnchorDate] = useState(todayYmd);
  const [loading, setLoading] = useState(true);

  const [salesData, setSalesData] = useState<SalesRow[]>([]);
  const [categoryRevenue, setCategoryRevenue] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);

  const [metrics, setMetrics] = useState({
    revenue: 0,
    orders: 0,
    aov: 0,
  });

  const period = useMemo(() => {
    const offsetMinutes = getStoreOffsetMinutes();
    let startYmd = anchorDate;
    let endYmd = anchorDate;

    if (timeRange === 'week') {
      startYmd = mondayOf(anchorDate);
      endYmd = addDaysYmd(startYmd, 6);
    } else if (timeRange === 'month') {
      const { year, month } = parseYmd(anchorDate);
      startYmd = ymd(year, month, 1);
      endYmd = endOfMonth(year, month);
    }

    // Cap the end at today so future empty days don't inflate charts for "this month".
    if (endYmd > todayYmd) endYmd = todayYmd;

    const startParts = parseYmd(startYmd);
    const endParts = parseYmd(endYmd);
    const start = new Date(
      Date.UTC(startParts.year, startParts.month - 1, startParts.day, 0, 0, 0, 0) - offsetMinutes * 60_000
    );
    const end = new Date(
      Date.UTC(endParts.year, endParts.month - 1, endParts.day, 23, 59, 59, 999) - offsetMinutes * 60_000
    );

    let label = formatDisplayDate(startYmd);
    if (timeRange === 'week') {
      label = `${formatDisplayDate(startYmd)} – ${formatDisplayDate(endYmd)}`;
    } else if (timeRange === 'month') {
      label = formatMonthLabel(startYmd);
    }

    const isCurrent =
      timeRange === 'day'
        ? startYmd === todayYmd
        : timeRange === 'week'
          ? mondayOf(anchorDate) === mondayOf(todayYmd)
          : parseYmd(anchorDate).year === Number(todayParts.year) &&
            parseYmd(anchorDate).month === Number(todayParts.month);

    return { start, end, startYmd, endYmd, label, isCurrent };
  }, [timeRange, anchorDate, todayYmd, todayParts.year, todayParts.month]);

  useEffect(() => {
    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.startYmd, period.endYmd, timeRange, channel]);

  const shiftPeriod = (direction: -1 | 1) => {
    if (timeRange === 'day') {
      setAnchorDate(addDaysYmd(anchorDate, direction));
      return;
    }
    if (timeRange === 'week') {
      setAnchorDate(addDaysYmd(mondayOf(anchorDate), direction * 7));
      return;
    }
    const { year, month } = parseYmd(anchorDate);
    const next = new Date(Date.UTC(year, month - 1 + direction, 1));
    setAnchorDate(ymd(next.getUTCFullYear(), next.getUTCMonth() + 1, 1));
  };

  const goToCurrent = () => setAnchorDate(todayYmd);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);

      const isoStart = period.start.toISOString();
      const isoEnd = period.end.toISOString();

      const allOrders = await fetchAllPaged<{
        id: string;
        created_at: string;
        total: number | null;
        payment_status: string;
        metadata: any;
      }>(() =>
        supabase
          .from('orders')
          .select('id, created_at, total, payment_status, metadata')
          .gte('created_at', isoStart)
          .lte('created_at', isoEnd)
          .eq('payment_status', 'paid')
          .neq('status', 'cancelled')
          .order('created_at')
      );

      const orders = allOrders.filter((o) => {
        const pos = isPosSale(o.metadata);
        if (channel === 'pos') return pos;
        if (channel === 'website') return !pos;
        return true;
      });

      let validItems: any[] = [];
      if (orders.length > 0) {
        const orderIds = orders.map(o => o.id);
        try {
          validItems = await fetchAllPaged<any>(() =>
            supabase
              .from('order_items')
              .select(`
                quantity,
                unit_price,
                total_price,
                product_id,
                products!inner(name, category_id, categories(name))
              `)
              .in('order_id', orderIds)
          );
        } catch (itemFetchError) {
          console.error('Error fetching order items:', itemFetchError);
        }
      }

      const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
      const totalOrders = orders.length;
      const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      setMetrics({
        revenue: totalRevenue,
        orders: totalOrders,
        aov,
      });

      // Zero-fill every day in the selected period so audits show quiet days too.
      const salesMap: Record<string, SalesRow> = {};
      let cursor = period.startYmd;
      while (cursor <= period.endYmd) {
        const { year, month, day } = parseYmd(cursor);
        const dateKey = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        });
        salesMap[cursor] = {
          date: dateKey,
          sales: 0,
          orders: 0,
          fullDate: Date.UTC(year, month - 1, day),
        };
        cursor = addDaysYmd(cursor, 1);
      }

      orders.forEach(o => {
        const parts = getStoreParts(new Date(o.created_at));
        const key = ymd(Number(parts.year), Number(parts.month), Number(parts.day));
        if (salesMap[key]) {
          salesMap[key].sales += o.total || 0;
          salesMap[key].orders += 1;
        }
      });

      setSalesData(Object.values(salesMap).sort((a, b) => a.fullDate - b.fullDate));

      const catMap: Record<string, any> = {};
      validItems.forEach(item => {
        const catName = item.products?.categories?.name || 'Uncategorized';
        if (!catMap[catName]) catMap[catName] = { name: catName, value: 0 };
        const itemRevenue = item.total_price || (item.unit_price * item.quantity) || 0;
        catMap[catName].value += itemRevenue;
      });
      setCategoryRevenue(Object.values(catMap).map((c: any) => ({ name: c.name, value: c.value })));

      const prodMap: Record<string, any> = {};
      validItems.forEach(item => {
        const pName = item.products?.name || 'Unknown';
        if (!prodMap[pName]) prodMap[pName] = { name: pName, revenue: 0, units: 0 };
        const itemRevenue = item.total_price || (item.unit_price * item.quantity) || 0;
        prodMap[pName].revenue += itemRevenue;
        prodMap[pName].units += item.quantity;
      });
      setTopProducts(
        Object.values(prodMap)
          .sort((a: any, b: any) => b.revenue - a.revenue)
          .slice(0, 5)
      );
    } catch (err) {
      console.error('Error fetching analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

  const rangeTabs: { key: TimeRange; label: string }[] = [
    { key: 'day', label: 'Daily' },
    { key: 'week', label: 'Weekly' },
    { key: 'month', label: 'Monthly' },
  ];

  const exportCsv = () => {
    const csvContent = `Date,Revenue,Orders\n${salesData.map(d => `${d.date},${d.sales},${d.orders}`).join('\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${timeRange}-${channel}-${period.startYmd}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Advanced Analytics</h1>
            <p className="text-gray-600 mt-1 md:mt-2 text-sm md:text-base">
              Audit paid sales by day, week, or month
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              onClick={exportCsv}
              className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center"
            >
              <i className="ri-download-line mr-2"></i>
              Export
            </button>
            <Link
              href="/admin"
              className="border-2 border-gray-300 hover:border-gray-400 text-gray-700 px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap text-center"
            >
              Back
            </Link>
          </div>
        </div>

        {/* Period filter — Daily / Weekly / Monthly */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden self-start">
                {rangeTabs.map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setTimeRange(tab.key)}
                    className={`px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                      timeRange === tab.key
                        ? 'bg-blue-700 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden self-start">
                {([
                  { key: 'all', label: 'All sales' },
                  { key: 'website', label: 'Website' },
                  { key: 'pos', label: 'POS' },
                ] as const).map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setChannel(tab.key)}
                    className={`px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                      channel === tab.key
                        ? 'bg-emerald-700 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => shiftPeriod(-1)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
                aria-label="Previous period"
              >
                <i className="ri-arrow-left-s-line text-lg"></i>
              </button>

              {timeRange === 'day' && (
                <input
                  type="date"
                  value={anchorDate}
                  max={todayYmd}
                  onChange={(e) => e.target.value && setAnchorDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              )}

              {timeRange === 'week' && (
                <input
                  type="date"
                  value={mondayOf(anchorDate)}
                  max={todayYmd}
                  onChange={(e) => e.target.value && setAnchorDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  title="Pick any day in the week"
                />
              )}

              {timeRange === 'month' && (
                <input
                  type="month"
                  value={anchorDate.slice(0, 7)}
                  max={todayYmd.slice(0, 7)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setAnchorDate(`${e.target.value}-01`);
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              )}

              <button
                type="button"
                onClick={() => shiftPeriod(1)}
                disabled={period.isCurrent}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Next period"
              >
                <i className="ri-arrow-right-s-line text-lg"></i>
              </button>

              {!period.isCurrent && (
                <button
                  type="button"
                  onClick={goToCurrent}
                  className="px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm font-semibold hover:bg-emerald-100 cursor-pointer"
                >
                  {timeRange === 'day' ? 'Today' : timeRange === 'week' ? 'This Week' : 'This Month'}
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-800">
              <i className="ri-calendar-line"></i>
              {period.label}
            </span>
            <span>
              Showing paid {channel === 'all' ? 'website + POS' : channel === 'pos' ? 'POS' : 'website'} orders only · Africa/Accra timezone
            </span>
            {loading && (
              <span className="inline-flex items-center gap-1 text-blue-600">
                <i className="ri-loader-4-line animate-spin"></i>
                Loading…
              </span>
            )}
          </div>
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-lg">
                <i className="ri-money-dollar-circle-line text-2xl text-blue-700"></i>
              </div>
              <span className="text-blue-700 font-semibold text-sm capitalize">{timeRange}</span>
            </div>
            <p className="text-sm text-gray-600 mb-1">Revenue</p>
            <p className="text-3xl font-bold text-gray-900">GH₵{metrics.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-lg">
                <i className="ri-shopping-cart-line text-2xl text-blue-700"></i>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-1">Paid Orders</p>
            <p className="text-3xl font-bold text-gray-900">{metrics.orders}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 flex items-center justify-center bg-purple-100 rounded-lg">
                <i className="ri-bar-chart-box-line text-2xl text-purple-700"></i>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-1">Avg. Order Value</p>
            <p className="text-3xl font-bold text-gray-900">GH₵{metrics.aov.toFixed(2)}</p>
          </div>
        </div>

        {/* Sales breakdown table — for end-of-day / week / month audits */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">
              {timeRange === 'day' ? 'Day Sales Detail' : timeRange === 'week' ? 'Daily Breakdown (This Week)' : 'Daily Breakdown (This Month)'}
              {channel !== 'all' && (
                <span className="ml-2 text-sm font-semibold text-emerald-700">
                  · {channel === 'pos' ? 'POS' : 'Website'}
                </span>
              )}
            </h2>
            <p className="text-sm font-semibold text-gray-700">
              Total: GH₵{metrics.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-gray-100">
                <tr>
                  <th className="text-left pb-3 text-sm font-semibold text-gray-600">Date</th>
                  <th className="text-right pb-3 text-sm font-semibold text-gray-600">Orders</th>
                  <th className="text-right pb-3 text-sm font-semibold text-gray-600">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {salesData.map((row) => (
                  <tr key={row.fullDate} className={row.sales === 0 ? 'text-gray-400' : ''}>
                    <td className="py-3 text-sm font-medium text-gray-900">{row.date}</td>
                    <td className="py-3 text-right text-sm text-gray-600">{row.orders}</td>
                    <td className="py-3 text-right text-sm font-semibold text-blue-600">
                      GH₵{row.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                {salesData.length === 0 && !loading && (
                  <tr>
                    <td colSpan={3} className="text-center py-6 text-gray-500">No paid sales in this period.</td>
                  </tr>
                )}
              </tbody>
              {salesData.length > 0 && (
                <tfoot className="border-t-2 border-gray-200">
                  <tr>
                    <td className="pt-3 text-sm font-bold text-gray-900">Total</td>
                    <td className="pt-3 text-right text-sm font-bold text-gray-900">{metrics.orders}</td>
                    <td className="pt-3 text-right text-sm font-bold text-blue-700">
                      GH₵{metrics.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Charts */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Revenue & Performance Trends</h2>
          </div>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <AreaChart data={salesData.length > 0 ? salesData : [{ date: 'No Data', sales: 0 }]}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="sales" stroke="#10b981" fillOpacity={1} fill="url(#colorSales)" name="Sales (GH₵)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Revenue by Category</h2>
            <div className="flex items-center justify-center mb-6">
              <div style={{ width: '100%', height: 250 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={categoryRevenue.length > 0 ? categoryRevenue : [{ name: 'No Data', value: 1 }]}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {categoryRevenue.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Top Performing Products</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-gray-100">
                  <tr>
                    <th className="text-left pb-3 text-sm font-semibold text-gray-600">Product</th>
                    <th className="text-right pb-3 text-sm font-semibold text-gray-600">Units</th>
                    <th className="text-right pb-3 text-sm font-semibold text-gray-600">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {topProducts.map((product, index) => (
                    <tr key={index}>
                      <td className="py-3 text-sm font-medium text-gray-900">{product.name}</td>
                      <td className="py-3 text-right text-sm text-gray-600">{product.units}</td>
                      <td className="py-3 text-right text-sm font-semibold text-blue-600">GH₵{product.revenue.toLocaleString()}</td>
                    </tr>
                  ))}
                  {topProducts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-center py-4 text-gray-500">No sales data yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import ActivityLogChanges from '@/components/admin/ActivityLogChanges';

const PAGE_SIZE = 50;

const SECTION_LABELS: Record<string, string> = {
  products: 'Products',
  product_variants: 'Product variants',
  product_images: 'Product images',
  categories: 'Categories',
  orders: 'Orders',
  order_items: 'Order items',
  customers: 'Customers',
  profiles: 'Staff & accounts',
  coupons: 'Coupons',
  banners: 'Banners',
  site_settings: 'Site settings',
  store_settings: 'Store settings',
  store_modules: 'Modules',
  cms_content: 'Content',
  pages: 'Pages',
  blog_posts: 'Blog',
  navigation_menus: 'Navigation menus',
  navigation_items: 'Navigation items',
  reviews: 'Reviews',
  return_requests: 'Returns',
  return_items: 'Return items',
  support_tickets: 'Support tickets',
  affiliates: 'Affiliates',
  affiliate_commissions: 'Affiliate commissions',
  affiliate_payouts: 'Affiliate payouts',
  affiliate_product_markups: 'Affiliate markups',
  'auth.users': 'Logins & passwords',
};

const ACTION_STYLES: Record<string, { label: string; className: string }> = {
  insert: { label: 'Created', className: 'bg-green-100 text-green-800' },
  update: { label: 'Updated', className: 'bg-blue-100 text-blue-800' },
  delete: { label: 'Deleted', className: 'bg-red-100 text-red-800' },
  sign_in: { label: 'Signed in', className: 'bg-gray-100 text-gray-800' },
  password_change: { label: 'Password changed', className: 'bg-amber-100 text-amber-900' },
  email_change: { label: 'Email changed', className: 'bg-amber-100 text-amber-900' },
  print_stock_list: { label: 'Printed', className: 'bg-purple-100 text-purple-800' },
  export_csv: { label: 'Exported', className: 'bg-purple-100 text-purple-800' },
};

const ACTOR_FALLBACK: Record<string, string> = {
  guest: 'Website visitor',
  system: 'System (automatic)',
  database: 'Database',
};

type LogRow = {
  id: string;
  created_at: string;
  action: string;
  table_name: string | null;
  summary: string | null;
  actor_email: string | null;
  actor_role: string | null;
  changes: Record<string, unknown> | null;
};

type Filters = { actor: string; section: string; action: string; from: string; to: string; search: string };

const EMPTY_FILTERS: Filters = { actor: '', section: '', action: '', from: '', to: '', search: '' };

function actorLabel(row: LogRow) {
  if (row.actor_email) return row.actor_email;
  return ACTOR_FALLBACK[row.actor_role || ''] || 'Unknown';
}

export default function ActivityLogsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [staff, setStaff] = useState<{ email: string; full_name: string | null }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('can_view_audit_logs');
      setAllowed(!rpcError && data === true);
      if (rpcError || data !== true) return;
      const { data: people } = await supabase
        .from('profiles')
        .select('email, full_name')
        .in('role', ['admin', 'staff', 'staff_pos'])
        .order('email');
      setStaff((people || []).filter((p: any) => p.email));
    })();
  }, []);

  const loadPage = useCallback(async (pageIndex: number, f: Filters) => {
    setLoading(true);
    setError('');
    let query = supabase
      .from('audit_logs')
      .select('id, created_at, action, table_name, summary, actor_email, actor_role, changes')
      .order('created_at', { ascending: false })
      .range(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);

    if (f.actor === '__system') query = query.is('actor_email', null);
    else if (f.actor) query = query.eq('actor_email', f.actor);
    if (f.section) query = query.eq('table_name', f.section);
    if (f.action) query = query.eq('action', f.action);
    if (f.from) query = query.gte('created_at', `${f.from}T00:00:00Z`);
    if (f.to) query = query.lte('created_at', `${f.to}T23:59:59.999Z`);
    if (f.search.trim()) query = query.ilike('summary', `%${f.search.trim()}%`);

    const { data, error: queryError } = await query;
    if (queryError) {
      setError(queryError.message);
      setRows([]);
      setHasMore(false);
    } else {
      const list = (data || []) as LogRow[];
      setHasMore(list.length > PAGE_SIZE);
      setRows(list.slice(0, PAGE_SIZE));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (allowed) loadPage(page, applied);
  }, [allowed, page, applied, loadPage]);

  const applyFilters = (next: Filters) => {
    setPage(0);
    setExpanded(null);
    setApplied(next);
  };

  if (allowed === null) {
    return <div className="py-20 text-center text-gray-500">Checking access…</div>;
  }

  if (!allowed) {
    return (
      <div className="max-w-md mx-auto mt-20 bg-white border border-gray-200 rounded-xl p-8 text-center">
        <i className="ri-lock-2-line text-4xl text-gray-400"></i>
        <h1 className="text-xl font-bold text-gray-900 mt-3">No access</h1>
        <p className="text-gray-600 mt-2">Activity logs are only available to approved administrators.</p>
      </div>
    );
  }

  const selectClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
  const setField = (key: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters({ ...filters, [key]: e.target.value });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Activity Logs</h1>
        <p className="text-gray-600 mt-1">Every change made in the store, who made it, and when. Logs cannot be edited or deleted.</p>
      </div>

      <form
        className="bg-white border border-gray-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3"
        onSubmit={(e) => { e.preventDefault(); applyFilters(filters); }}
      >
        <input value={filters.search} onChange={setField('search')} placeholder="Search product, order number…" className={`${selectClass} lg:col-span-2`} />
        <select value={filters.actor} onChange={setField('actor')} className={selectClass}>
          <option value="">Everyone</option>
          {staff.map((s) => (
            <option key={s.email} value={s.email}>{s.full_name ? `${s.full_name} (${s.email})` : s.email}</option>
          ))}
          <option value="__system">Website visitors & system</option>
        </select>
        <select value={filters.section} onChange={setField('section')} className={selectClass}>
          <option value="">All sections</option>
          {Object.entries(SECTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select value={filters.action} onChange={setField('action')} className={selectClass}>
          <option value="">All actions</option>
          {Object.entries(ACTION_STYLES).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <input type="date" value={filters.from} onChange={setField('from')} className={selectClass} aria-label="From date" />
          <input type="date" value={filters.to} onChange={setField('to')} className={selectClass} aria-label="To date" />
        </div>
        <div className="flex gap-2 lg:col-span-6 justify-end">
          <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); applyFilters(EMPTY_FILTERS); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer">
            Clear
          </button>
          <button type="submit" className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-semibold cursor-pointer">
            Apply filters
          </button>
        </div>
      </form>

      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">Could not load logs: {error}</div>}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-600">
                <th className="py-3 px-4 font-semibold">When</th>
                <th className="py-3 px-4 font-semibold">Who</th>
                <th className="py-3 px-4 font-semibold">Action</th>
                <th className="py-3 px-4 font-semibold">Section</th>
                <th className="py-3 px-4 font-semibold">Item</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && rows.length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-gray-500">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-gray-500">No activity matches these filters yet.</td></tr>
              )}
              {rows.map((row) => {
                const style = ACTION_STYLES[row.action] || { label: row.action, className: 'bg-gray-100 text-gray-800' };
                const isOpen = expanded === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr className={`hover:bg-gray-50 cursor-pointer ${isOpen ? 'bg-gray-50' : ''}`} onClick={() => setExpanded(isOpen ? null : row.id)}>
                      <td className="py-3 px-4 whitespace-nowrap text-gray-700">
                        {new Date(row.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-gray-900 font-medium break-all">{actorLabel(row)}</p>
                        {row.actor_role && row.actor_email && <p className="text-xs text-gray-500 capitalize">{row.actor_role.replace('_', ' ')}</p>}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${style.className}`}>{style.label}</span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-gray-700">
                        {row.table_name ? SECTION_LABELS[row.table_name] || row.table_name : 'Admin'}
                      </td>
                      <td className="py-3 px-4 text-gray-900 max-w-xs truncate" title={row.summary || ''}>{row.summary || '—'}</td>
                      <td className="py-3 px-4 text-gray-400">
                        <i className={isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}></i>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50">
                        <td colSpan={6} className="px-4 pb-4 pt-1">
                          <ActivityLogChanges action={row.action} changes={row.changes} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
          <p className="text-sm text-gray-600">Page {page + 1}</p>
          <div className="flex gap-2">
            <button disabled={page === 0 || loading} onClick={() => setPage(page - 1)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
              Newer
            </button>
            <button disabled={!hasMore || loading} onClick={() => setPage(page + 1)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
              Older
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

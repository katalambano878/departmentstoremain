'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { Affiliate, AffiliateSettings } from '@/lib/affiliate';
import { DEFAULT_AFFILIATE_SETTINGS } from '@/lib/affiliate';

type AffiliateRow = Affiliate & { clicks: number; orders: number };

interface Stats {
  total: number;
  byStatus: Record<string, number>;
  totalEarned: number;
  totalPaid: number;
  pending: number;
  available: number;
  clicks: number;
  conversions: number;
  conversionRate: number;
  pendingPrices?: number;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  active: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  suspended: 'bg-gray-200 text-gray-700 border-gray-300',
  rejected: 'bg-rose-100 text-rose-700 border-rose-200',
};

const PROVIDERS = ['MTN', 'Vodafone', 'AirtelTigo'];

const AVATAR_TONES = [
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-blue-100 text-blue-700',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
];

function ghs(n: number | null | undefined) {
  return `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function initials(name: string | null, email: string | null) {
  const src = (name || email || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function toneFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export default function AdminAffiliatesPage() {
  const [affiliates, setAffiliates] = useState<AffiliateRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'earnings' | 'commission' | 'clicks'>('recent');
  const [editing, setEditing] = useState<Affiliate | null>(null);
  const [form, setForm] = useState({ commission_pct: '', payout_provider: '', payout_number: '', payout_name: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [editError, setEditError] = useState('');
  const [settingsError, setSettingsError] = useState('');

  // Program settings
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AffiliateSettings>(DEFAULT_AFFILIATE_SETTINGS);
  const [settingsForm, setSettingsForm] = useState<AffiliateSettings>(DEFAULT_AFFILIATE_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const { data: { session } } = await supabase.auth.getSession();
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`;
    return h;
  }, []);

  const fetchAffiliates = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const url = filter ? `/api/admin/affiliates?status=${filter}` : '/api/admin/affiliates';
      const res = await fetch(url, { headers, credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(`Could not load affiliates: ${data?.error || `request failed (${res.status})`}`);
        return;
      }
      if (data.affiliates) setAffiliates(data.affiliates);
      if (data.stats) setStats(data.stats);
    } catch (e: any) {
      console.error('Error loading affiliates:', e);
      setActionError(`Could not load affiliates: ${e?.message || 'network error'}`);
    } finally {
      setLoading(false);
    }
  }, [filter, authHeaders]);

  useEffect(() => { fetchAffiliates(); }, [fetchAffiliates]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/affiliates/settings', { headers: await authHeaders(), credentials: 'include' });
      const data = await res.json();
      if (data.settings) { setSettings(data.settings); setSettingsForm(data.settings); }
    } catch { /* noop */ }
  }, [authHeaders]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  /** PATCH an affiliate. Returns null on success, or the server's error message. */
  async function patch(id: string, body: Record<string, any>): Promise<string | null> {
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/admin/affiliates', {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify({ id, ...body }),
      });
      if (res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return data?.error || `Request failed (${res.status})`;
    } catch (e: any) {
      return e?.message || 'Network error';
    }
  }

  async function setStatus(a: Affiliate, status: string) {
    setBusyId(a.id);
    setActionError('');
    const err = await patch(a.id, { status });
    if (err) setActionError(`${a.full_name || a.email}: status not changed. ${err}`);
    else await fetchAffiliates();
    setBusyId(null);
  }

  async function commissionAction(a: Affiliate, action: 'approve' | 'reject') {
    setBusyId(a.id);
    setActionError('');
    const err = await patch(a.id, { commission_action: action });
    if (err) setActionError(`${a.full_name || a.email}: commission request not ${action === 'approve' ? 'approved' : 'rejected'}. ${err}`);
    else await fetchAffiliates();
    setBusyId(null);
  }

  function openEdit(a: Affiliate) {
    setEditError('');
    setEditing(a);
    setForm({
      commission_pct: String(a.commission_pct ?? ''),
      payout_provider: a.payout_provider || '',
      payout_number: a.payout_number || '',
      payout_name: a.payout_name || '',
      notes: a.notes || '',
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    // Send only what changed: the server clears a pending commission request
    // whenever commission_pct is sent, even if it is the same value.
    const changes: Record<string, any> = {};
    if (form.commission_pct !== String(editing.commission_pct ?? '')) changes.commission_pct = Number(form.commission_pct);
    if (form.payout_provider !== (editing.payout_provider || '')) changes.payout_provider = form.payout_provider;
    if (form.payout_number !== (editing.payout_number || '')) changes.payout_number = form.payout_number;
    if (form.payout_name !== (editing.payout_name || '')) changes.payout_name = form.payout_name;
    if (form.notes !== (editing.notes || '')) changes.notes = form.notes;
    if (Object.keys(changes).length === 0) { setEditing(null); return; }
    setSaving(true);
    setEditError('');
    const err = await patch(editing.id, changes);
    setSaving(false);
    if (err) { setEditError(err); return; }
    setEditing(null);
    await fetchAffiliates();
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsError('');
    try {
      const res = await fetch('/api/admin/affiliates/settings', {
        method: 'PUT',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify(settingsForm),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.settings) {
        setSettings(data.settings);
        setSettingsForm(data.settings);
        setSettingsOpen(false);
      } else {
        setSettingsError(data?.error || `Settings not saved (${res.status})`);
      }
    } catch (e: any) {
      setSettingsError(e?.message || 'Network error, settings not saved');
    } finally {
      setSavingSettings(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const counts = stats?.byStatus || {};

  const visible = useMemo(() => {
    let rows = [...affiliates];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((a) =>
        (a.full_name || '').toLowerCase().includes(q) ||
        (a.email || '').toLowerCase().includes(q) ||
        (a.code || '').toLowerCase().includes(q) ||
        (a.phone || '').toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => {
      switch (sortBy) {
        case 'earnings': return Number(b.total_earned) - Number(a.total_earned);
        case 'commission': return Number(b.commission_pct) - Number(a.commission_pct);
        case 'clicks': return b.clicks - a.clicks;
        default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    return rows;
  }, [affiliates, search, sortBy]);

  const pendingReqCount = affiliates.filter((a) => a.pending_commission_pct !== null && a.pending_commission_pct !== undefined).length;

  const kpis = [
    { label: 'Affiliates', value: String(stats?.total ?? 0), sub: `${counts.active || 0} active`, tone: 'violet', icon: 'ri-team-line' },
    { label: 'Pending Approval', value: String(counts.pending || 0), sub: counts.pending ? 'needs review' : 'all clear', tone: 'amber', icon: 'ri-user-add-line' },
    { label: 'Rate Requests', value: String(pendingReqCount), sub: pendingReqCount ? 'awaiting approval' : 'none', tone: 'rose', icon: 'ri-price-tag-3-line' },
    { label: 'Price Requests', value: String(stats?.pendingPrices ?? 0), sub: (stats?.pendingPrices ?? 0) ? 'open a ledger to approve' : 'none', tone: 'amber', icon: 'ri-price-tag-2-line' },
    { label: 'Total Clicks', value: String(stats?.clicks ?? 0), sub: `${stats?.conversions ?? 0} orders`, tone: 'blue', icon: 'ri-cursor-line' },
    { label: 'Conversion Rate', value: `${stats?.conversionRate ?? 0}%`, sub: 'clicks → orders', tone: 'teal', icon: 'ri-line-chart-line' },
    { label: 'Available to Pay', value: ghs(stats?.available), sub: 'matured, unpaid', tone: 'emerald', icon: 'ri-bank-card-line' },
    { label: 'Pending Balance', value: ghs(stats?.pending), sub: 'not yet matured', tone: 'amber', icon: 'ri-time-line' },
    { label: 'Lifetime Earned', value: ghs(stats?.totalEarned), sub: 'all commissions', tone: 'violet', icon: 'ri-money-dollar-circle-line' },
    { label: 'Lifetime Paid', value: ghs(stats?.totalPaid), sub: 'disbursed', tone: 'gray', icon: 'ri-checkbox-circle-line' },
  ];

  const toneClasses: Record<string, { bg: string; text: string }> = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
    rose: { bg: 'bg-rose-50', text: 'text-rose-700' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700' },
    blue: { bg: 'bg-blue-50', text: 'text-blue-700' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-700' },
    teal: { bg: 'bg-teal-50', text: 'text-teal-700' },
    gray: { bg: 'bg-gray-100', text: 'text-gray-700' },
  };

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm" role="alert">
          <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError('')} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><i className="ri-close-line"></i></button>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Affiliates</h1>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${settings.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${settings.enabled ? 'bg-emerald-500' : 'bg-gray-400'}`} />
              Program {settings.enabled ? 'live' : 'off'}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Approve affiliates, tune commissions, and pay out earnings.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchAffiliates()}
            className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 flex items-center gap-1.5"
          >
            <i className={`ri-refresh-line ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => { setSettingsForm(settings); setSettingsOpen(true); }}
            className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 flex items-center gap-1.5"
          >
            <i className="ri-settings-3-line" />
            Program Settings
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => {
          const tone = toneClasses[k.tone] ?? toneClasses.gray;
          return (
            <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{k.label}</span>
                <span className={`w-9 h-9 rounded-lg ${tone.bg} ${tone.text} flex items-center justify-center text-lg`}>
                  <i className={k.icon} />
                </span>
              </div>
              <p className="text-2xl font-bold text-gray-900 leading-none">{loading && !stats ? '…' : k.value}</p>
              <p className="text-xs text-gray-400 mt-1.5">{k.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Pending nudge */}
      {(counts.pending || 0) > 0 && filter !== 'pending' && (
        <button
          onClick={() => setFilter('pending')}
          className="w-full flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm hover:bg-amber-100 transition text-left"
        >
          <i className="ri-error-warning-line text-lg" />
          <span><strong>{counts.pending}</strong> affiliate{counts.pending === 1 ? '' : 's'} waiting for approval.</span>
          <span className="ml-auto font-medium flex items-center gap-1">Review <i className="ri-arrow-right-line" /></span>
        </button>
      )}

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or code…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300"
          />
        </div>
        <div className="flex flex-wrap gap-2 flex-1">
          {['', 'pending', 'active', 'suspended', 'rejected'].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-full text-sm border transition ${filter === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
            >
              {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              {s && counts[s] ? ` (${counts[s]})` : ''}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
        >
          <option value="recent">Newest first</option>
          <option value="earnings">Top earners</option>
          <option value="commission">Highest commission</option>
          <option value="clicks">Most clicks</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><i className="ri-loader-4-line animate-spin text-2xl" /></div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-violet-50 text-violet-500 flex items-center justify-center mx-auto mb-4">
              <i className="ri-user-star-line text-2xl" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">
              {search ? 'No matches' : affiliates.length === 0 ? 'No affiliates yet' : 'Nothing in this filter'}
            </h3>
            <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
              {search
                ? 'Try a different name, email or code.'
                : 'Customers can apply from the “Become an Affiliate” link in the storefront footer. New applications land here for approval.'}
            </p>
            {affiliates.length === 0 && !search && (
              <button
                onClick={() => copy(`${typeof window !== 'undefined' ? window.location.origin : ''}/affiliate`)}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800"
              >
                <i className={copied ? 'ri-check-line' : 'ri-link'} />
                {copied ? 'Link copied' : 'Copy sign-up link'}
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Affiliate</th>
                  <th className="text-left px-4 py-3">Code</th>
                  <th className="text-center px-4 py-3">Comm.</th>
                  <th className="text-center px-4 py-3">Clicks</th>
                  <th className="text-center px-4 py-3">Orders</th>
                  <th className="text-right px-4 py-3">Available</th>
                  <th className="text-right px-4 py-3">Pending</th>
                  <th className="text-center px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((a) => {
                  const conv = a.clicks > 0 ? Math.round((a.orders / a.clicks) * 1000) / 10 : 0;
                  return (
                    <tr key={a.id} className="hover:bg-gray-50/70">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${toneFor(a.id)}`}>
                            {initials(a.full_name, a.email)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 truncate">{a.full_name || '—'}</div>
                            <div className="text-gray-500 text-xs truncate">{a.email}</div>
                            {a.phone && <div className="text-gray-400 text-xs">{a.phone}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => copy(a.code)}
                          title="Copy code"
                          className="inline-flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-xs font-mono text-gray-700 transition"
                        >
                          {a.code}
                          <i className={copied === a.code ? 'ri-check-line text-emerald-600' : 'ri-file-copy-line text-gray-400'} />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="font-semibold text-gray-900">{a.commission_pct}%</div>
                        {a.pending_commission_pct !== null && a.pending_commission_pct !== undefined && (
                          <div className="mt-1.5">
                            <div className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                              <i className="ri-arrow-right-up-line" /> wants {a.pending_commission_pct}%
                            </div>
                            <div className="flex items-center justify-center gap-1 mt-1">
                              <button disabled={busyId === a.id} onClick={() => commissionAction(a, 'approve')} className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[11px] hover:bg-emerald-700 disabled:opacity-50">Approve</button>
                              <button disabled={busyId === a.id} onClick={() => commissionAction(a, 'reject')} className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-[11px] hover:bg-gray-200 disabled:opacity-50">Reject</button>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-700">{a.clicks}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-gray-900 font-medium">{a.orders}</span>
                        {a.clicks > 0 && <span className="text-gray-400 text-xs ml-1">({conv}%)</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-700 font-medium">{ghs(a.balance_available)}</td>
                      <td className="px-4 py-3 text-right text-amber-600">{ghs(a.balance_pending)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-1 rounded-full text-xs border capitalize ${STATUS_BADGE[a.status]}`}>{a.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {a.status === 'pending' && (
                            <>
                              <button disabled={busyId === a.id} onClick={() => setStatus(a, 'active')} className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs hover:bg-emerald-700 disabled:opacity-50">Approve</button>
                              <button disabled={busyId === a.id} onClick={() => setStatus(a, 'rejected')} className="px-2.5 py-1 rounded-md bg-rose-100 text-rose-700 text-xs hover:bg-rose-200 disabled:opacity-50">Reject</button>
                            </>
                          )}
                          {a.status === 'active' && (
                            <button disabled={busyId === a.id} onClick={() => setStatus(a, 'suspended')} className="px-2.5 py-1 rounded-md bg-gray-100 text-gray-700 text-xs hover:bg-gray-200 disabled:opacity-50">Suspend</button>
                          )}
                          {(a.status === 'suspended' || a.status === 'rejected') && (
                            <button disabled={busyId === a.id} onClick={() => setStatus(a, 'active')} className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs hover:bg-emerald-700 disabled:opacity-50">Reactivate</button>
                          )}
                          <Link href={`/admin/affiliates/${a.id}`} className="px-2.5 py-1 rounded-md bg-gray-100 text-gray-700 text-xs hover:bg-gray-200">Ledger</Link>
                          <button onClick={() => openEdit(a)} className="w-7 h-7 flex items-center justify-center rounded-md bg-gray-900 text-white text-xs hover:bg-gray-800" title="Edit">
                            <i className="ri-pencil-line" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveEdit} className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Edit affiliate</h2>
              <p className="text-sm text-gray-500">{editing.full_name || editing.email} · <code className="text-xs">{editing.code}</code></p>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Commission %</span>
              <input type="number" min={0} max={100} step={0.5} value={form.commission_pct}
                onChange={(e) => setForm({ ...form, commission_pct: e.target.value })}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" required />
              <span className="text-xs text-gray-400">Markup the customer pays on top of the base price.</span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">MoMo network</span>
                <select value={form.payout_provider} onChange={(e) => setForm({ ...form, payout_provider: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="">—</option>
                  {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">MoMo number</span>
                <input value={form.payout_number} onChange={(e) => setForm({ ...form, payout_number: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="0XXXXXXXXX" />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Account name</span>
              <input value={form.payout_name} onChange={(e) => setForm({ ...form, payout_name: e.target.value })}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Admin notes</span>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" rows={2} />
            </label>

            {editError && <p className="text-sm text-red-700" role="alert">Not saved: {editError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSettingsOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveSettings} className="bg-white rounded-xl w-full max-w-lg p-6 space-y-5 shadow-xl max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Program settings</h2>
              <p className="text-sm text-gray-500">Defaults and rules for the whole affiliate program.</p>
            </div>

            <Toggle
              label="Program enabled"
              hint="Turn affiliate links and markup pricing on or off site-wide."
              checked={settingsForm.enabled}
              onChange={(v) => setSettingsForm({ ...settingsForm, enabled: v })}
            />
            <Toggle
              label="Auto-disburse via Moolre"
              hint="Automatically pay matured commissions to MoMo instead of recording manual payouts."
              checked={settingsForm.auto_disburse}
              onChange={(v) => setSettingsForm({ ...settingsForm, auto_disburse: v })}
            />

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Default commission %</span>
                <input type="number" min={0} max={100} step={0.5} value={settingsForm.default_commission_pct}
                  onChange={(e) => setSettingsForm({ ...settingsForm, default_commission_pct: Number(e.target.value) })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" />
                <span className="text-xs text-gray-400">Applied to new affiliates.</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Max markup %</span>
                <input type="number" min={0} max={100} step={0.5} value={settingsForm.max_commission_pct}
                  onChange={(e) => setSettingsForm({ ...settingsForm, max_commission_pct: Number(e.target.value) })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" />
                <span className="text-xs text-gray-400">Ceiling affiliates can set (default or per-product).</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Min payout (GHS)</span>
                <input type="number" min={0} step={1} value={settingsForm.min_payout}
                  onChange={(e) => setSettingsForm({ ...settingsForm, min_payout: Number(e.target.value) })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" />
                <span className="text-xs text-gray-400">Balance needed before payout.</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Attribution (days)</span>
                <input type="number" min={0} max={365} step={1} value={settingsForm.attribution_days}
                  onChange={(e) => setSettingsForm({ ...settingsForm, attribution_days: Number(e.target.value) })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" />
                <span className="text-xs text-gray-400">How long a referral cookie lasts.</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Maturity (days)</span>
                <input type="number" min={0} max={365} step={1} value={settingsForm.maturity_days}
                  onChange={(e) => setSettingsForm({ ...settingsForm, maturity_days: Number(e.target.value) })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" />
                <span className="text-xs text-gray-400">Hold before commission is payable.</span>
              </label>
            </div>

            {settingsError && <p className="text-sm text-red-700" role="alert">{settingsError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setSettingsOpen(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={savingSettings} className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">{savingSettings ? 'Saving…' : 'Save settings'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3">
      <div>
        <div className="text-sm font-medium text-gray-800">{label}</div>
        <div className="text-xs text-gray-400">{hint}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-emerald-500' : 'bg-gray-300'}`}
        role="switch"
        aria-checked={checked}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type ReturnStatus = 'pending' | 'approved' | 'rejected' | 'processing' | 'completed';

type ReturnRow = {
  id: string;
  order_id: string | null;
  status: ReturnStatus | null;
  reason: string;
  description: string | null;
  refund_amount: number | null;
  refund_method: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string | null;
  orders: { order_number: string; email: string | null; phone: string | null; total: number | null } | null;
};

const STATUS_LABEL: Record<ReturnStatus, string> = {
  pending: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Rejected',
  processing: 'Processing',
  completed: 'Completed',
};

const STATUS_BADGE: Record<ReturnStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
  processing: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
};

/** Same reference the customer sees in their confirmation email. */
function referenceFor(id: string) {
  return `RET-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminReturnsPage() {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'pending' | 'open' | 'all'>('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('return_requests')
      .select('id, order_id, status, reason, description, refund_amount, refund_method, admin_notes, created_at, updated_at, orders(order_number, email, phone, total)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) setError(`Could not load return requests: ${error.message}`);
    else {
      setError('');
      const list = (data || []).map((r: any) => ({
        ...r,
        orders: Array.isArray(r.orders) ? r.orders[0] || null : r.orders,
      })) as ReturnRow[];
      setRows(list);
      setNotes(Object.fromEntries(list.map(r => [r.id, r.admin_notes || ''])));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const update = async (row: ReturnRow, changes: Partial<Pick<ReturnRow, 'status' | 'admin_notes'>>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusyId(row.id);
    setSavedId(null);
    setError('');
    const { data, error } = await supabase
      .from('return_requests')
      .update(changes)
      .eq('id', row.id)
      .select('id, status, admin_notes, updated_at');
    setBusyId(null);
    if (error || !data || data.length === 0) {
      setError(`Return ${referenceFor(row.id)} not updated: ${error?.message || 'not allowed'}`);
      return;
    }
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, ...data[0] } : r)));
    setSavedId(row.id);
  };

  const status = (r: ReturnRow): ReturnStatus => r.status || 'pending';
  const pendingCount = rows.filter(r => status(r) === 'pending').length;
  const openCount = rows.filter(r => ['pending', 'approved', 'processing'].includes(status(r))).length;
  const visible = rows.filter(r =>
    filter === 'all' ? true :
    filter === 'pending' ? status(r) === 'pending' :
    ['pending', 'approved', 'processing'].includes(status(r))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Returns</h1>
        <p className="text-gray-600 mt-1">
          Return requests customers sent from the Returns page.{!loading && ` ${pendingCount} waiting for review.`}
        </p>
        <p className="text-sm text-gray-500 mt-1">Changing a status here does not message the customer or refund money. Do those yourself, then record it in the notes.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg" role="alert">
          <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss" className="shrink-0 -my-3 -mr-3 p-3 opacity-70 hover:opacity-100"><i className="ri-close-line"></i></button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(['pending', 'open', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`min-h-[44px] sm:min-h-0 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${filter === f ? 'bg-blue-700 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
          >
            {f === 'pending' ? `Waiting (${pendingCount})` : f === 'open' ? `Open (${openCount})` : `All (${rows.length})`}
          </button>
        ))}
        <button onClick={load} className="ml-auto w-11 h-11 sm:w-10 sm:h-10 shrink-0 flex items-center justify-center border border-gray-200 bg-white rounded-lg text-gray-600 hover:bg-gray-50" aria-label="Refresh">
          <i className={`ri-refresh-line ${loading ? 'animate-spin' : ''}`}></i>
        </button>
      </div>

      {loading ? (
        <p className="p-10 text-center text-gray-500">Loading return requests...</p>
      ) : visible.length === 0 ? (
        <p className="p-10 text-center text-gray-500 bg-white rounded-xl border border-gray-200">
          {rows.length === 0 ? 'No return requests yet.' : 'Nothing in this list.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map(r => {
            const st = status(r);
            const noteChanged = (notes[r.id] ?? '') !== (r.admin_notes || '');
            return (
              <li key={r.id} className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">
                      {referenceFor(r.id)}
                      <span className={`ml-2 align-middle px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[st]}`}>{STATUS_LABEL[st]}</span>
                    </p>
                    <p className="text-sm text-gray-600 mt-0.5 break-words">
                      Order{' '}
                      {r.order_id && r.orders ? (
                        <Link href={`/admin/orders/${r.order_id}`} className="text-blue-700 hover:underline font-medium">{r.orders.order_number}</Link>
                      ) : (
                        <span className="text-gray-400">unknown</span>
                      )}
                      {r.orders?.total != null && ` · GH₵ ${Number(r.orders.total).toFixed(2)}`}
                      {r.orders?.email && <> · <a href={`mailto:${r.orders.email}`} className="text-blue-700 hover:underline break-all">{r.orders.email}</a></>}
                      {r.orders?.phone && <> · <a href={`tel:${r.orders.phone}`} className="text-blue-700 hover:underline">{r.orders.phone}</a></>}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">Requested {formatDateTime(r.created_at)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 flex-shrink-0">
                    {st === 'pending' && (
                      <>
                        <button
                          onClick={() => update(r, { status: 'approved' }, `Approve return ${referenceFor(r.id)}?`)}
                          disabled={busyId === r.id}
                          className="min-h-[44px] flex-1 sm:min-h-0 sm:flex-none px-4 py-2 rounded-lg text-sm font-semibold bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => update(r, { status: 'rejected' }, `Reject return ${referenceFor(r.id)}?`)}
                          disabled={busyId === r.id}
                          className="min-h-[44px] flex-1 sm:min-h-0 sm:flex-none px-4 py-2 rounded-lg text-sm font-semibold border-2 border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {st !== 'pending' && (
                      <select
                        value={st}
                        disabled={busyId === r.id}
                        onChange={(e) => update(r, { status: e.target.value as ReturnStatus })}
                        aria-label="Return status"
                        className="min-h-[44px] w-full sm:min-h-0 sm:w-auto px-3 py-2 border-2 border-gray-300 rounded-lg text-base sm:text-sm cursor-pointer disabled:opacity-50"
                      >
                        {(Object.keys(STATUS_LABEL) as ReturnStatus[]).map(s => (
                          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                <div className="mt-3 text-sm">
                  <p className="font-medium text-gray-900 break-words">{r.reason}</p>
                  {r.description && <p className="text-gray-700 mt-1 whitespace-pre-wrap break-words">{r.description}</p>}
                  {(r.refund_amount != null || r.refund_method) && (
                    <p className="text-gray-600 mt-1">
                      Refund: {r.refund_amount != null ? `GH₵ ${Number(r.refund_amount).toFixed(2)}` : 'amount not set'}
                      {r.refund_method && ` by ${r.refund_method}`}
                    </p>
                  )}
                </div>

                <div className="mt-4">
                  <label htmlFor={`notes-${r.id}`} className="block text-xs font-semibold text-gray-600 mb-1">Staff notes (not shown to the customer)</label>
                  <textarea
                    id={`notes-${r.id}`}
                    rows={2}
                    value={notes[r.id] ?? ''}
                    onChange={(e) => { setSavedId(null); setNotes(prev => ({ ...prev, [r.id]: e.target.value })); }}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={() => update(r, { admin_notes: (notes[r.id] || '').trim() || null })}
                      disabled={busyId === r.id || !noteChanged}
                      className="min-h-[44px] sm:min-h-0 px-4 py-2 rounded-lg text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40"
                    >
                      {busyId === r.id ? 'Saving...' : 'Save notes'}
                    </button>
                    {savedId === r.id && !noteChanged && <span className="text-sm text-green-700">Saved</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

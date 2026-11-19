'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { Affiliate, AffiliateCommission, AffiliatePayout } from '@/lib/affiliate';

const COMMISSION_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  matured: 'bg-green-100 text-green-800',
  paid: 'bg-gray-200 text-gray-700',
  clawed_back: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

interface ProductMarkup {
  id: string;
  product_id: string;
  markup_type: 'pct' | 'price';
  markup_pct: number;
  fixed_price: number | null;
  status: 'pending' | 'approved' | 'rejected';
  product_name: string;
  product_slug: string;
  base_price: number;
  customer_price: number;
  image: string | null;
}

function ghs(n: number | null | undefined) {
  return `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function date(s: string) {
  return new Date(s).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AdminAffiliateDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [loading, setLoading] = useState(true);
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [commissions, setCommissions] = useState<AffiliateCommission[]>([]);
  const [payouts, setPayouts] = useState<AffiliatePayout[]>([]);
  const [markups, setMarkups] = useState<ProductMarkup[]>([]);
  const [busyMarkup, setBusyMarkup] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [confirmPay, setConfirmPay] = useState(false);
  const [error, setError] = useState('');
  const [payError, setPayError] = useState('');

  /** The server's error message from a failed response. */
  const errorFrom = async (res: Response) => {
    const data = await res.json().catch(() => ({}));
    return data?.error || `Request failed (${res.status})`;
  };

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const { data: { session } } = await supabase.auth.getSession();
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`;
    return h;
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/affiliates/${id}`, { headers: await authHeaders(), credentials: 'include' });
      if (!res.ok && res.status !== 404) {
        setError(`Could not load this affiliate: ${await errorFrom(res)}`);
        setLoading(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.affiliate) {
        setAffiliate(data.affiliate);
        setCommissions(data.commissions || []);
        setPayouts(data.payouts || []);
        setMarkups(data.markups || []);
      }
    } catch (e: any) {
      setError(`Could not load this affiliate: ${e?.message || 'network error'}`);
    }
    setLoading(false);
  }, [id, authHeaders]);

  useEffect(() => { load(); }, [load]);

  async function markupAction(markupId: string, action: 'approve' | 'reject') {
    setBusyMarkup(markupId);
    setError('');
    try {
      const res = await fetch(`/api/admin/affiliates/${id}`, {
        method: 'PATCH', headers: await authHeaders(), credentials: 'include',
        body: JSON.stringify({ markup_id: markupId, action }),
      });
      if (res.ok) await load();
      else setError(`Price not ${action === 'approve' ? 'approved' : 'rejected'}: ${await errorFrom(res)}`);
    } catch (e: any) {
      setError(`Price not updated: ${e?.message || 'network error'}`);
    } finally {
      setBusyMarkup(null);
    }
  }

  async function payNow() {
    setPaying(true);
    setPayError('');
    try {
      const res = await fetch(`/api/admin/affiliates/${id}`, { method: 'POST', headers: await authHeaders(), credentials: 'include', body: JSON.stringify({}) });
      if (res.ok) { setConfirmPay(false); await load(); }
      else setPayError(`Payout not recorded: ${await errorFrom(res)}`);
    } catch (e: any) {
      setPayError(`Payout not recorded: ${e?.message || 'network error'}`);
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return <div className="p-12 text-center text-gray-400"><i className="ri-loader-4-line animate-spin text-2xl" /></div>;
  }
  if (!affiliate) {
    if (error) return <div className="p-12 text-center text-red-700">{error} <Link href="/admin/affiliates" className="text-gray-900 underline">Back</Link></div>;
    return <div className="p-12 text-center text-gray-400">Affiliate not found. <Link href="/admin/affiliates" className="text-gray-900 underline">Back</Link></div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/admin/affiliates" className="text-sm text-gray-500 hover:text-gray-900">← All affiliates</Link>
      {error && (
        <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm" role="alert">
          <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><i className="ri-close-line"></i></button>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4 mt-2 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{affiliate.full_name || affiliate.email}</h1>
          <p className="text-sm text-gray-500">
            <code className="bg-gray-100 px-1.5 py-0.5 rounded">{affiliate.code}</code> · {affiliate.commission_pct}% · {affiliate.status}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Payout: {affiliate.payout_provider || '—'} {affiliate.payout_number || ''} {affiliate.payout_name ? `(${affiliate.payout_name})` : ''}
          </p>
        </div>
        <button
          onClick={() => { setPayError(''); setConfirmPay(true); }}
          disabled={Number(affiliate.balance_available) <= 0}
          className="px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Pay now · {ghs(affiliate.balance_available)}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <Stat label="Available" value={affiliate.balance_available} accent="text-green-600" />
        <Stat label="Pending" value={affiliate.balance_pending} accent="text-amber-600" />
        <Stat label="Total earned" value={affiliate.total_earned} accent="text-gray-900" />
        <Stat label="Total paid" value={affiliate.total_paid} accent="text-gray-500" />
      </div>

      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-gray-900">Custom product prices</h2>
        {markups.some((m) => m.status === 'pending') && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            {markups.filter((m) => m.status === 'pending').length} awaiting approval
          </span>
        )}
      </div>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-8">
        {markups.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No custom product prices set.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {markups.map((m) => (
              <div key={m.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-11 h-11 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                    {m.image ? <img src={m.image} alt="" className="w-full h-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{m.product_name}</p>
                    <p className="text-xs text-gray-500">
                      Base {ghs(m.base_price)} → Sells at <span className="font-medium text-gray-700">{ghs(m.customer_price)}</span> · {m.markup_pct}% markup
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.status === 'pending' ? (
                    <>
                      <button disabled={busyMarkup === m.id} onClick={() => markupAction(m.id, 'approve')} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">Approve</button>
                      <button disabled={busyMarkup === m.id} onClick={() => markupAction(m.id, 'reject')} className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 disabled:opacity-50">Reject</button>
                    </>
                  ) : m.status === 'approved' ? (
                    <>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded"><i className="ri-check-line" /> Live</span>
                      <button disabled={busyMarkup === m.id} onClick={() => markupAction(m.id, 'reject')} className="px-2.5 py-1 rounded-lg border border-gray-300 text-gray-500 text-xs hover:bg-gray-50 disabled:opacity-50">Disable</button>
                    </>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 px-2 py-1 rounded"><i className="ri-close-line" /> Rejected</span>
                      <button disabled={busyMarkup === m.id} onClick={() => markupAction(m.id, 'approve')} className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-700 disabled:opacity-50">Approve</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 className="text-lg font-semibold text-gray-900 mb-3">Commissions</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-8">
        {commissions.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No commissions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5">Order</th>
                  <th className="text-left px-4 py-2.5">Date</th>
                  <th className="text-right px-4 py-2.5">Base</th>
                  <th className="text-right px-4 py-2.5">Commission</th>
                  <th className="text-center px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {commissions.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{c.order_number}</td>
                    <td className="px-4 py-2.5 text-gray-500">{date(c.created_at)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">{ghs(c.base_amount)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{ghs(c.commission_amount)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${COMMISSION_BADGE[c.status]}`}>
                        {c.status === 'clawed_back' ? 'reversed' : c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2 className="text-lg font-semibold text-gray-900 mb-3">Payouts</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {payouts.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No payouts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5">Date</th>
                  <th className="text-left px-4 py-2.5">To</th>
                  <th className="text-right px-4 py-2.5">Amount</th>
                  <th className="text-center px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 text-gray-500">{date(p.created_at)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{p.provider} {p.destination}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{ghs(p.amount)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmPay && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setConfirmPay(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Confirm payout</h2>
            <p className="text-sm text-gray-600 mb-1">
              Record a payout of <strong>{ghs(affiliate.balance_available)}</strong> to:
            </p>
            <p className="text-sm text-gray-800 mb-4">{affiliate.payout_provider} {affiliate.payout_number} {affiliate.payout_name ? `(${affiliate.payout_name})` : ''}</p>
            <p className="text-xs text-gray-400 mb-4">
              Send the mobile money transfer first, then confirm here. This marks all matured commissions as paid.
            </p>
            {payError && <p className="text-sm text-red-700 mb-3" role="alert">{payError}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmPay(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={payNow} disabled={paying} className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                {paying ? 'Recording…' : 'Confirm paid'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
      <div className={`text-lg font-bold ${accent}`}>{ghs(value)}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

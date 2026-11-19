'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

type Row = {
    id: string;
    order_number: string | null;
    total: number | null;
    payment_status: string | null;
    payment_method: string | null;
    created_at: string | null;
    email: string | null;
    hubtel_client_reference: string | null;
    hubtel_checkout_id: string | null;
    moolre_externalref: string | null;
    moolre_reference: string | null;
};

export default function ReconcilePaymentsPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reconcilingId, setReconcilingId] = useState<string | null>(null);
    const [actionMsg, setActionMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

    const load = useCallback(async () => {
        setError(null);
        setLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) {
                setError('Not signed in');
                setLoading(false);
                return;
            }
            const res = await fetch('/api/admin/reconcile-payments', {
                headers: { Authorization: `Bearer ${token}` }
            });
            const json = await res.json();
            if (!res.ok) {
                setError(json.error || 'Request failed');
                setRows([]);
                return;
            }
            setRows(json.orders || []);
            setNote(json.note || '');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load');
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const reverify = useCallback(async (id: string) => {
        setActionMsg(null);
        setReconcilingId(id);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) {
                setActionMsg({ id, text: 'Not signed in', ok: false });
                return;
            }
            const res = await fetch('/api/admin/reconcile-payments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ orderId: id })
            });
            const json = await res.json();
            const ok = res.ok && json.success && json.payment_status === 'paid';
            setActionMsg({ id, text: json.message || json.error || (ok ? 'Marked paid' : 'Not confirmed'), ok });
            if (ok) {
                setRows((prev) => prev.filter((r) => r.id !== id));
            }
        } catch (e) {
            setActionMsg({ id, text: e instanceof Error ? e.message : 'Re-verify failed', ok: false });
        } finally {
            setReconcilingId(null);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div className="p-6 max-w-6xl">
            <h1 className="text-2xl font-bold mb-2">Payment reconciliation (Hubtel)</h1>
            <p className="text-gray-600 mb-4 max-w-3xl">
                This list shows orders where a payment link was generated but the order is still
                not marked paid — the usual suspects when money arrived at the gateway but our
                callback or success flow did not complete. For Hubtel orders, click
                <strong> Re-verify</strong> to re-query Hubtel and auto-mark the order paid if the
                payment actually succeeded. Legacy Moolre orders must be confirmed in the Moolre
                dashboard and marked paid manually.
            </p>
            {note && <p className="text-sm text-gray-700 mb-4 border-l-4 border-amber-400 pl-3">{note}</p>}

            <div className="flex gap-3 mb-6">
                <button
                    type="button"
                    onClick={() => load()}
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? 'Loading…' : 'Refresh list'}
                </button>
                <Link
                    href="/admin/orders"
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 inline-flex items-center"
                >
                    All orders
                </Link>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-800 rounded border border-red-200">{error}</div>
            )}

            {!loading && !error && rows.length === 0 && (
                <p className="text-gray-600">No unmatched payment-link orders in the recent window.</p>
            )}

            {rows.length > 0 && (
                <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white shadow-sm">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 text-left border-b">
                                <th className="p-3 font-semibold">Order</th>
                                <th className="p-3 font-semibold">Total</th>
                                <th className="p-3 font-semibold">Status</th>
                                <th className="p-3 font-semibold">Gateway</th>
                                <th className="p-3 font-semibold">Created</th>
                                <th className="p-3 font-semibold">Client ref</th>
                                <th className="p-3 font-semibold">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                                    <td className="p-3">
                                        <div className="font-medium">{r.order_number || r.id}</div>
                                        <div className="text-gray-500 text-xs truncate max-w-[200px]">{r.email}</div>
                                    </td>
                                    <td className="p-3 whitespace-nowrap">{r.total != null ? `₵${Number(r.total).toFixed(2)}` : '—'}</td>
                                    <td className="p-3">
                                        <span className="text-amber-700">{r.payment_status || '—'}</span>
                                    </td>
                                    <td className="p-3 whitespace-nowrap">
                                        <span className="text-xs uppercase tracking-wide text-gray-600">
                                            {r.payment_method || '—'}
                                        </span>
                                    </td>
                                    <td className="p-3 whitespace-nowrap text-gray-600">
                                        {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                                    </td>
                                    <td className="p-3 font-mono text-xs max-w-[180px] break-all">
                                        {r.hubtel_client_reference || r.moolre_externalref || '—'}
                                    </td>
                                    <td className="p-3">
                                        <div className="flex flex-col gap-1.5">
                                            {/* POS MoMo links are Hubtel even when payment_method says 'moolre', so key on the stored reference. */}
                                            {(r.hubtel_client_reference || r.payment_method === 'hubtel') && (
                                                <button
                                                    type="button"
                                                    onClick={() => reverify(r.id)}
                                                    disabled={reconcilingId === r.id}
                                                    className="px-3 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                                                >
                                                    {reconcilingId === r.id ? 'Checking…' : 'Re-verify'}
                                                </button>
                                            )}
                                            <Link
                                                href={`/admin/orders/${r.id}`}
                                                className="text-blue-600 hover:underline whitespace-nowrap text-xs"
                                            >
                                                Open order
                                            </Link>
                                            {actionMsg?.id === r.id && (
                                                <span className={`text-xs ${actionMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
                                                    {actionMsg.text}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <p className="mt-8 text-sm text-gray-500 max-w-3xl">
                Hubtel orders can be reconciled directly here with <strong>Re-verify</strong>, which
                re-queries Hubtel using the stored{' '}
                <code className="bg-gray-100 px-1 rounded">hubtel_client_reference</code> and only marks
                the order paid when Hubtel reports the transaction as Paid and the settled amount matches
                the order total. Legacy Moolre orders still require manual confirmation in the Moolre
                dashboard before being marked paid.
            </p>
        </div>
    );
}

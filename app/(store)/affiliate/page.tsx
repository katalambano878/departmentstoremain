'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { Affiliate } from '@/lib/affiliate';

const PROVIDERS = ['MTN', 'Vodafone', 'AirtelTigo'];

export default function AffiliatePage() {
  const [checking, setChecking] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [form, setForm] = useState({ full_name: '', phone: '', payout_provider: '', payout_number: '', payout_name: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const { data: { session } } = await supabase.auth.getSession();
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`;
    return h;
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoggedIn(false); setChecking(false); return; }
      setLoggedIn(true);
      try {
        const res = await fetch('/api/affiliate/register', { headers: await authHeaders(), credentials: 'include' });
        const data = await res.json();
        if (data.affiliate) {
          setAffiliate(data.affiliate);
        } else {
          const { data: profile } = await supabase.from('profiles').select('full_name, phone').eq('id', session.user.id).single();
          if (profile) setForm((f) => ({ ...f, full_name: profile.full_name || '', phone: profile.phone || '' }));
        }
      } catch { /* noop */ }
      setChecking(false);
    })();
  }, [authHeaders]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const momo = form.payout_number.replace(/\D/g, '');
    if (form.payout_number.trim() && !/^0[25]\d{8}$/.test(momo) && !/^233[25]\d{8}$/.test(momo)) {
      setError('Enter a valid mobile money number, for example 024 123 4567.');
      return;
    }
    if (form.payout_number.trim() && !form.payout_provider) {
      setError('Choose the network for your mobile money number.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/affiliate/register', {
        method: 'POST',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); }
      else { setAffiliate(data.affiliate); }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const refLink = affiliate ? `${origin}/?ref=${affiliate.code}` : '';

  function copyLink() {
    navigator.clipboard.writeText(refLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (checking) {
    return <div className="min-h-[50vh] flex items-center justify-center text-gray-400"><i className="ri-loader-4-line animate-spin text-2xl" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900">Affiliate Program</h1>
        <p className="text-gray-500 mt-2 max-w-xl mx-auto">
          Share products you love and earn a commission on every sale made through your link.
        </p>
      </div>

      {!loggedIn && (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
          <i className="ri-lock-2-line text-3xl text-gray-300 mb-3 block" />
          <p className="text-gray-600 mb-5">Sign in or create an account to join the affiliate program.</p>
          <div className="flex justify-center gap-3">
            <Link href="/auth/login?redirect=/affiliate" className="px-5 py-2.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800">Sign in</Link>
            <Link href="/auth/signup?redirect=/affiliate" className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Create account</Link>
          </div>
        </div>
      )}

      {loggedIn && affiliate && affiliate.status === 'active' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-gray-900 to-gray-700 text-white rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm uppercase tracking-wide text-gray-300">Your commission</span>
              <span className="text-2xl font-bold">{affiliate.commission_pct}%</span>
            </div>
            <label className="text-xs text-gray-300">Your referral link</label>
            <div className="flex gap-2 mt-1">
              <input readOnly value={refLink} className="flex-1 bg-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              <button onClick={copyLink} className="px-4 py-2 rounded-lg bg-white text-gray-900 text-sm font-medium hover:bg-gray-100">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">Anyone who buys within 30 days of clicking your link earns you commission.</p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Stat label="Available" value={affiliate.balance_available} accent="text-green-600" />
            <Stat label="Pending" value={affiliate.balance_pending} accent="text-amber-600" />
            <Stat label="Total paid" value={affiliate.total_paid} accent="text-gray-700" />
          </div>

          <Link href="/affiliate/dashboard" className="block text-center px-5 py-3 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
            View earnings & payouts →
          </Link>
        </div>
      )}

      {loggedIn && affiliate && affiliate.status === 'pending' && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
          <i className="ri-time-line text-3xl text-amber-500 mb-3 block" />
          <h2 className="text-lg font-semibold text-gray-900">Application under review</h2>
          <p className="text-gray-600 mt-1">We&apos;ve received your application. Once it is approved, your link and earnings appear here and under My Account → Affiliate.</p>
        </div>
      )}

      {loggedIn && affiliate && (affiliate.status === 'suspended' || affiliate.status === 'rejected') && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 text-center">
          <i className="ri-information-line text-3xl text-gray-400 mb-3 block" />
          <p className="text-gray-600">
            {affiliate.status === 'rejected'
              ? 'Your application was not approved. Please contact support for details.'
              : 'Your affiliate account is currently suspended. Please contact support.'}
          </p>
        </div>
      )}

      {loggedIn && !affiliate && (
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Apply to become an affiliate</h2>
          {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Full name</span>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" required />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Phone</span>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="0XXXXXXXXX" required />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">MoMo network</span>
              <select value={form.payout_provider} onChange={(e) => setForm({ ...form, payout_provider: e.target.value })}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2">
                <option value="">Select…</option>
                {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">MoMo number</span>
              <input type="tel" inputMode="tel" value={form.payout_number} onChange={(e) => setForm({ ...form, payout_number: e.target.value })}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="0XXXXXXXXX" />
            </label>
          </div>
          <p className="text-xs text-gray-400">MoMo details are where we&apos;ll send your commission payouts. You can change them later under My Account → Affiliate.</p>
          <button type="submit" disabled={submitting}
            className="w-full px-5 py-3 rounded-lg bg-gray-900 text-white font-medium hover:bg-gray-800 disabled:opacity-50">
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        </form>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
      <div className={`text-xl font-bold ${accent}`}>GHS {Number(value || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

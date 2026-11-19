import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { matureDueCommissions } from '@/lib/affiliate-server';
import { clampPct, DEFAULT_AFFILIATE_SETTINGS } from '@/lib/affiliate';

function getAccessToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/\bsb-access-token=([^;]+)/);
  if (match) return decodeURIComponent(match[1].trim());
  const authCookie = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('sb-') && (c.includes('-auth-token') || c.includes('auth')));
  if (!authCookie) return null;
  const value = authCookie.split('=').slice(1).join('=').trim();
  const decoded = decodeURIComponent(value);
  try {
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed) && parsed[0]) return parsed[0];
    if (parsed?.access_token) return parsed.access_token;
    if (typeof parsed === 'string') return parsed;
  } catch {
    return decoded;
  }
  return null;
}

// Columns an affiliate may see about themselves (never the admin `notes`).
const AFFILIATE_SELF_COLUMNS =
  'id, user_id, code, status, commission_pct, pending_commission_pct, commission_requested_at, full_name, email, phone, payout_method, payout_number, payout_provider, payout_name, total_earned, total_paid, balance_pending, balance_available, approved_at, created_at, updated_at';
const COMMISSION_SELF_COLUMNS =
  'id, affiliate_id, order_id, order_number, base_amount, commission_pct, commission_amount, status, matures_at, payout_id, matured_at, paid_at, created_at, updated_at';
const PAYOUT_SELF_COLUMNS =
  'id, affiliate_id, amount, method, destination, provider, status, moolre_ref, failure_reason, created_at, processed_at';

// GET — affiliate's own dashboard: record, commissions, payouts.
export async function GET(request: Request) {
  const token = getAccessToken(request);
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

  const { data: affiliate } = await supabaseAdmin
    .from('affiliates').select('id').eq('user_id', user.id).maybeSingle();
  if (!affiliate) return NextResponse.json({ affiliate: null, commissions: [], payouts: [] });

  // Mature any commissions whose hold window has elapsed, then re-read balances.
  await matureDueCommissions(affiliate.id);

  const [{ data: fresh }, { data: commissions }, { data: payouts }] = await Promise.all([
    supabaseAdmin.from('affiliates').select(AFFILIATE_SELF_COLUMNS).eq('id', affiliate.id).single(),
    supabaseAdmin.from('affiliate_commissions').select(COMMISSION_SELF_COLUMNS).eq('affiliate_id', affiliate.id).order('created_at', { ascending: false }).limit(100),
    supabaseAdmin.from('affiliate_payouts').select(PAYOUT_SELF_COLUMNS).eq('affiliate_id', affiliate.id).order('created_at', { ascending: false }).limit(50),
  ]);

  return NextResponse.json({ affiliate: fresh, commissions: commissions || [], payouts: payouts || [] });
}

// PATCH — affiliate updates their own payout details.
export async function PATCH(request: Request) {
  const token = getAccessToken(request);
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (body.payout_provider !== undefined) updates.payout_provider = body.payout_provider || null;
  if (body.payout_number !== undefined) updates.payout_number = body.payout_number || null;
  if (body.payout_name !== undefined) updates.payout_name = body.payout_name || null;
  if (body.phone !== undefined) updates.phone = body.phone || null;

  // Affiliates can REQUEST a new general commission %, clamped to the program
  // cap. It stays pending until an admin approves it — the active rate
  // (commission_pct) is unchanged here. Requesting the current rate cancels any
  // outstanding request.
  if (body.commission_pct !== undefined) {
    let cap = DEFAULT_AFFILIATE_SETTINGS.max_commission_pct;
    try {
      const { data: setting } = await supabaseAdmin
        .from('site_settings').select('value').eq('key', 'affiliate').single();
      if (typeof setting?.value?.max_commission_pct === 'number') cap = setting.value.max_commission_pct;
    } catch { /* default cap */ }

    const requested = clampPct(Number(body.commission_pct), cap);
    const { data: current } = await supabaseAdmin
      .from('affiliates').select('commission_pct').eq('user_id', user.id).maybeSingle();

    if (current && Number(current.commission_pct) === requested) {
      // Asking for the rate they already have — clear any pending request.
      updates.pending_commission_pct = null;
      updates.commission_requested_at = null;
    } else {
      updates.pending_commission_pct = requested;
      updates.commission_requested_at = new Date().toISOString();
    }
  }

  const { data, error: updErr } = await supabaseAdmin
    .from('affiliates').update(updates).eq('user_id', user.id).select(AFFILIATE_SELF_COLUMNS).single();
  if (updErr) {
    console.error('[AffiliateDashboard] update failed:', updErr.message);
    return NextResponse.json({ error: 'Could not save your details.' }, { status: 500 });
  }
  return NextResponse.json({ affiliate: data });
}

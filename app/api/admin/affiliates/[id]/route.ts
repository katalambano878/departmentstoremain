import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { matureDueCommissions, disburseViaMoolre } from '@/lib/affiliate-server';
import { round2 } from '@/lib/affiliate';

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

async function requireAdmin(
  request: Request,
  allowed: string[] = ['admin', 'staff'],
): Promise<{ user: any } | NextResponse> {
  const token = getAccessToken(request);
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
  const role = profile?.role != null ? String(profile.role) : '';
  if (!allowed.includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return { user };
}

// GET — affiliate detail with commissions + payouts
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  await matureDueCommissions(id);

  const [{ data: affiliate }, { data: commissions }, { data: payouts }, { data: markupRows }] = await Promise.all([
    supabaseAdmin.from('affiliates').select('*').eq('id', id).single(),
    supabaseAdmin.from('affiliate_commissions').select('*').eq('affiliate_id', id).order('created_at', { ascending: false }).limit(200),
    supabaseAdmin.from('affiliate_payouts').select('*').eq('affiliate_id', id).order('created_at', { ascending: false }).limit(50),
    supabaseAdmin.from('affiliate_product_markups')
      .select('id, product_id, markup_type, markup_pct, fixed_price, status, updated_at, products(name, slug, price)')
      .eq('affiliate_id', id)
      .order('updated_at', { ascending: false }),
  ]);

  if (!affiliate) return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 });

  // First image per product for the markups list.
  const productIds = (markupRows || []).map((r: any) => r.product_id);
  const imageMap = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: imgs } = await supabaseAdmin
      .from('product_images').select('product_id, url, position').in('product_id', productIds).order('position', { ascending: true });
    for (const img of imgs || []) {
      if (!imageMap.has(img.product_id as string)) imageMap.set(img.product_id as string, img.url as string);
    }
  }

  const markups = (markupRows || []).map((r: any) => {
    const base = Number(r.products?.price) || 0;
    const pct = Number(r.markup_pct) || 0;
    return {
      id: r.id,
      product_id: r.product_id,
      markup_type: r.markup_type,
      markup_pct: pct,
      fixed_price: r.fixed_price !== null ? Number(r.fixed_price) : null,
      status: r.status || 'approved',
      product_name: r.products?.name || 'Product',
      product_slug: r.products?.slug || '',
      base_price: base,
      customer_price: Math.round(base * (1 + pct / 100) * 100) / 100,
      image: imageMap.get(r.product_id) || null,
    };
  });

  return NextResponse.json({ affiliate, commissions: commissions || [], payouts: payouts || [], markups });
}

// PATCH — approve / reject a per-product markup. body: { markup_id, action }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const markupId = String(body.markup_id || '');
  const action = body.action;
  if (!markupId || (action !== 'approve' && action !== 'reject')) {
    return NextResponse.json({ error: 'markup_id and a valid action are required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('affiliate_product_markups')
    .update({ status: action === 'approve' ? 'approved' : 'rejected', updated_at: new Date().toISOString() })
    .eq('id', markupId)
    .eq('affiliate_id', id)
    .select()
    .single();

  if (error) {
    console.error('[AdminAffiliate] markup update failed:', error.message);
    return NextResponse.json({ error: 'Could not update this markup.' }, { status: 500 });
  }
  return NextResponse.json({ markup: data });
}

// POST — pay out the affiliate's matured balance (admin only).
// Atomic in the database (affiliate_begin_payout / affiliate_finish_payout):
// one payout at a time per affiliate, active affiliates only, min_payout
// enforced, balances moved in the same transaction as the payout row.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));

  const { data: affiliate } = await supabaseAdmin
    .from('affiliates').select('id, code, status, payout_number, payout_provider').eq('id', id).maybeSingle();
  if (!affiliate) return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 });

  // Is automatic disbursement enabled + configured?
  let autoDisburse = false;
  try {
    const { data: setting } = await supabaseAdmin.from('site_settings').select('value').eq('key', 'affiliate').single();
    autoDisburse = setting?.value?.auto_disburse === true;
  } catch { /* default off */ }
  // `body.manual === true` lets the admin force a manual record even when auto is on.
  const tryAuto = autoDisburse && body.manual !== true && !!process.env.MOOLRE_API_KEY;

  if (tryAuto && (!affiliate.payout_number || !affiliate.payout_provider)) {
    return NextResponse.json({ error: 'This affiliate has no mobile money payout details yet.' }, { status: 400 });
  }

  const externalref = `AFFPAY-${id.slice(0, 8)}-${Date.now()}`;
  const manualRef = typeof body.reference === 'string' ? body.reference.trim().slice(0, 120) || null : null;

  const { data: payout, error: beginErr } = await supabaseAdmin.rpc('affiliate_begin_payout', {
    p_affiliate_id: id,
    p_processed_by: auth.user.id,
    p_auto: tryAuto,
    p_reference: tryAuto ? externalref : manualRef,
  });
  if (beginErr || !payout) {
    const msg = String(beginErr?.message || '');
    const refusal = msg.match(/payout:\s*(.+)$/i);
    if (refusal) {
      const text = refusal[1].trim();
      return NextResponse.json({ error: text.charAt(0).toUpperCase() + text.slice(1) }, { status: 400 });
    }
    console.error('[AdminAffiliate] affiliate_begin_payout failed:', msg);
    return NextResponse.json({ error: 'Could not start the payout.' }, { status: 500 });
  }

  if (!tryAuto) {
    return NextResponse.json({ success: true, payout, auto: false });
  }

  // Automatic Moolre transfer for the reserved amount.
  const result = await disburseViaMoolre({
    amount: round2(Number(payout.amount)),
    receiver: affiliate.payout_number,
    provider: affiliate.payout_provider,
    externalref,
    reference: `Affiliate ${affiliate.code} commission`,
  });

  const { data: finished, error: finishErr } = await supabaseAdmin.rpc('affiliate_finish_payout', {
    p_payout_id: payout.id,
    p_success: result.ok,
    p_moolre_ref: result.ok ? (result.transactionid || externalref) : null,
    p_failure_reason: result.ok ? null : result.message,
  });
  if (finishErr) {
    // The transfer outcome is known but the ledger update failed: the payout
    // stays 'processing' (blocking new payouts) until staff resolve it.
    console.error('[AdminAffiliate] affiliate_finish_payout failed:', finishErr.message, '| payout', payout.id, '| transfer ok:', result.ok);
    return NextResponse.json(
      { error: `Transfer ${result.ok ? 'succeeded' : 'failed'} but the payout record could not be updated. Payout ${payout.id} is still marked processing.` },
      { status: 500 },
    );
  }

  if (!result.ok) {
    return NextResponse.json({ error: `Payout failed: ${result.message}` }, { status: 502 });
  }
  return NextResponse.json({ success: true, payout: finished || payout, auto: true });
}

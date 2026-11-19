/**
 * Server-only affiliate ledger helpers. Use supabaseAdmin (service role) — never
 * import into client components.
 *
 * Lifecycle of a commission:
 *   pending  → created when the order is paid (held for the maturity window)
 *   matured  → maturity window elapsed; counts toward payable balance
 *   paid     → included in a payout
 *   clawed_back → order refunded/cancelled before payout
 */
import { supabaseAdmin } from '@/lib/supabase-admin';
import { round2, clampPct, effectivePct, DEFAULT_AFFILIATE_SETTINGS, type ProductMarkupMap } from '@/lib/affiliate';

/** Reads the affiliate settings JSON (maturity + markup cap), with defaults. */
async function getAffiliateSettings(): Promise<{ maturityDays: number; cap: number }> {
  try {
    const { data } = await supabaseAdmin
      .from('site_settings').select('value').eq('key', 'affiliate').single();
    return {
      maturityDays: typeof data?.value?.maturity_days === 'number' ? data.value.maturity_days : DEFAULT_AFFILIATE_SETTINGS.maturity_days,
      cap: typeof data?.value?.max_commission_pct === 'number' ? data.value.max_commission_pct : DEFAULT_AFFILIATE_SETTINGS.max_commission_pct,
    };
  } catch {
    return { maturityDays: DEFAULT_AFFILIATE_SETTINGS.maturity_days, cap: DEFAULT_AFFILIATE_SETTINGS.max_commission_pct };
  }
}

/** Map a stored MoMo provider name to Moolre's transfer channel code. */
export function providerToChannel(provider?: string | null): string | null {
  const p = (provider || '').toLowerCase();
  if (p.includes('mtn')) return '1';
  if (p.includes('telecel') || p.includes('vodafone')) return '6';
  if (p.includes('airtel') || p.includes('tigo') || p === 'at') return '7';
  return null;
}

export interface DisburseResult {
  ok: boolean;
  transactionid?: string;
  fee?: string;
  message: string;
}

/**
 * Sends a mobile-money payout via Moolre's transfer API.
 * Requires MOOLRE_API_USER, MOOLRE_API_KEY (PRIVATE key), MOOLRE_ACCOUNT_NUMBER,
 * and sufficient float in the Moolre wallet. Returns ok=false on any failure
 * (caller should mark the payout failed and NOT touch balances).
 */
export async function disburseViaMoolre(opts: {
  amount: number;
  receiver: string;
  provider?: string | null;
  externalref: string;
  reference?: string;
}): Promise<DisburseResult> {
  const { MOOLRE_API_USER, MOOLRE_API_KEY, MOOLRE_ACCOUNT_NUMBER } = process.env;
  if (!MOOLRE_API_USER || !MOOLRE_API_KEY || !MOOLRE_ACCOUNT_NUMBER) {
    return { ok: false, message: 'Moolre transfer credentials not configured (MOOLRE_API_KEY required).' };
  }
  const channel = providerToChannel(opts.provider);
  if (!channel) return { ok: false, message: `Unknown MoMo provider: ${opts.provider || 'none'}` };
  if (!opts.receiver) return { ok: false, message: 'Missing recipient MoMo number.' };
  if (!opts.amount || opts.amount <= 0) return { ok: false, message: 'Invalid payout amount.' };

  try {
    const res = await fetch('https://api.moolre.com/open/transact/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-USER': MOOLRE_API_USER,
        'X-API-KEY': MOOLRE_API_KEY,
      },
      body: JSON.stringify({
        type: 1,
        channel,
        currency: 'GHS',
        amount: opts.amount.toFixed(2),
        receiver: opts.receiver,
        externalref: opts.externalref,
        reference: opts.reference || 'Affiliate commission payout',
        accountnumber: MOOLRE_ACCOUNT_NUMBER,
      }),
    });
    const result = await res.json();
    const apiOk = result.status === 1 || result.status === '1';
    const txOk = result.data?.txstatus === 1 || result.data?.txstatus === '1';
    if (apiOk && txOk) {
      return {
        ok: true,
        transactionid: String(result.data?.transactionid || ''),
        fee: String(result.data?.fee || ''),
        message: Array.isArray(result.message) ? result.message.join(' ') : String(result.message || 'Payout successful'),
      };
    }
    return { ok: false, message: Array.isArray(result.message) ? result.message.join(' ') : String(result.message || 'Transfer rejected') };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Network error contacting Moolre.' };
  }
}


/**
 * Markup pricing for an attributed affiliate, read from the database. The
 * storefront applies exactly this rule for display (context/AffiliateContext):
 *   pct  = approved per-product override, else the affiliate's default
 *          commission_pct — both clamped to the program cap
 *   paid = round2(base * (1 + pct/100)) per unit
 * Only ACTIVE affiliates get a markup.
 */
export interface AffiliatePricing {
  affiliateId: string;
  code: string;
  defaultPct: number;
  cap: number;
  markups: ProductMarkupMap;
}

export async function loadActiveAffiliatePricing(code?: string | null): Promise<AffiliatePricing | null> {
  const clean = typeof code === 'string' ? code.trim() : '';
  if (!clean || clean.length > 64) return null;
  const { data: affiliate } = await supabaseAdmin
    .from('affiliates')
    .select('id, code, commission_pct, status')
    .eq('code', clean)
    .maybeSingle();
  if (!affiliate || affiliate.status !== 'active') return null;

  const { cap } = await getAffiliateSettings();
  const { data: rows } = await supabaseAdmin
    .from('affiliate_product_markups')
    .select('product_id, markup_pct')
    .eq('affiliate_id', affiliate.id)
    .eq('status', 'approved');
  const markups: ProductMarkupMap = {};
  for (const r of rows || []) markups[r.product_id as string] = clampPct(Number(r.markup_pct), cap);

  return {
    affiliateId: affiliate.id as string,
    code: affiliate.code as string,
    defaultPct: clampPct(Number(affiliate.commission_pct) || 0, cap),
    cap,
    markups,
  };
}

/** Markup percent for one product under the given pricing (0 without an affiliate). */
export function affiliateMarkupPct(pricing: AffiliatePricing | null, productId: string | null | undefined): number {
  if (!pricing) return 0;
  return effectivePct(productId || undefined, pricing.markups, pricing.defaultPct, pricing.cap);
}

/** Customer unit price: base plus the affiliate markup, rounded like the storefront. */
export function affiliateUnitPrice(base: number, pct: number): number {
  return pct > 0 ? round2(base * (1 + pct / 100)) : round2(base);
}

/**
 * Current base (pre-markup) unit price of each line, from the catalogue:
 * the variant's price when the line has a variant, else the product's price.
 * Keyed by order_items.id. Lines whose price can't be found are left out.
 */
export async function catalogBasePrices(
  items: Array<{ id: string; product_id: string | null; variant_id: string | null }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const productIds = Array.from(new Set(items.map((i) => i.product_id).filter(Boolean) as string[]));
  const variantIds = Array.from(new Set(items.map((i) => i.variant_id).filter(Boolean) as string[]));
  const productPrice = new Map<string, number>();
  const variantPrice = new Map<string, number>();
  if (productIds.length > 0) {
    const { data } = await supabaseAdmin.from('products').select('id, price').in('id', productIds);
    for (const p of data || []) if (p.price != null) productPrice.set(p.id as string, Number(p.price));
  }
  if (variantIds.length > 0) {
    const { data } = await supabaseAdmin.from('product_variants').select('id, price').in('id', variantIds);
    for (const v of data || []) if (v.price != null) variantPrice.set(v.id as string, Number(v.price));
  }
  for (const it of items) {
    const v = it.variant_id ? variantPrice.get(it.variant_id) : undefined;
    const p = it.product_id ? productPrice.get(it.product_id) : undefined;
    const base = v ?? p;
    if (base != null && Number.isFinite(base)) out.set(it.id, base);
  }
  return out;
}

/**
 * Records the affiliate commission for a paid order. Idempotent — safe to call
 * from both the webhook and the verify path. Commission is recomputed
 * authoritatively, per line item, from the affiliate's current markup config
 * (default rate + per-product overrides, clamped to the program cap) applied to
 * each item's base price.
 *
 * Base price comes from the database only: the server-written
 * metadata.base_unit_price on orders priced by /api/storefront/orders/create
 * (metadata.server_priced = true), otherwise the current catalogue price.
 * Client-supplied numbers are never used.
 */
export async function recordAffiliateCommission(orderRefOrId: string): Promise<void> {
  try {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderRefOrId);
    const { data: order } = await (isUUID
      ? supabaseAdmin.from('orders').select('id, order_number, metadata').eq('id', orderRefOrId).single()
      : supabaseAdmin.from('orders').select('id, order_number, metadata').eq('order_number', orderRefOrId).single());

    if (!order) return;
    const aff = order.metadata?.affiliate;
    if (!aff || !aff.code) return; // not an affiliate order

    // Idempotency: skip if a commission already exists for this order.
    const { data: existing } = await supabaseAdmin
      .from('affiliate_commissions').select('id').eq('order_id', order.id).maybeSingle();
    if (existing) return;

    const { data: affiliate } = await supabaseAdmin
      .from('affiliates').select('id, commission_pct, balance_pending').eq('code', aff.code).maybeSingle();
    if (!affiliate) return;

    const { maturityDays, cap } = await getAffiliateSettings();
    const defaultPct = clampPct(Number(affiliate.commission_pct) || 0, cap);

    // Per-product overrides for this affiliate (admin-approved only).
    const { data: markupRows } = await supabaseAdmin
      .from('affiliate_product_markups')
      .select('product_id, markup_pct')
      .eq('affiliate_id', affiliate.id)
      .eq('status', 'approved');
    const markups: ProductMarkupMap = {};
    for (const r of markupRows || []) markups[r.product_id as string] = clampPct(Number(r.markup_pct), cap);

    const { data: items } = await supabaseAdmin
      .from('order_items')
      .select('id, product_id, variant_id, quantity, metadata')
      .eq('order_id', order.id);

    const serverPriced = order.metadata?.server_priced === true;
    const catalog = await catalogBasePrices(
      (items || []).map((it: any) => ({ id: it.id, product_id: it.product_id, variant_id: it.variant_id })),
    );

    let baseAmount = 0;
    let commission = 0;
    for (const it of items || []) {
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      const stored = Number(it.metadata?.base_unit_price);
      const base = serverPriced && Number.isFinite(stored) && stored >= 0
        ? stored
        : catalog.get(it.id as string);
      if (base == null) continue; // product deleted and no trusted price: no commission for this line
      const pct = effectivePct(it.product_id as string, markups, defaultPct, cap);
      baseAmount = round2(baseAmount + base * qty);
      commission = round2(commission + base * qty * (pct / 100));
    }
    baseAmount = round2(baseAmount);
    commission = round2(commission);
    if (commission <= 0) return;

    // Blended effective rate, for reporting on the commission row.
    const blendedPct = baseAmount > 0 ? round2((commission / baseAmount) * 100) : defaultPct;

    const maturesAt = new Date(Date.now() + maturityDays * 24 * 60 * 60 * 1000).toISOString();

    // Insert + pending-balance increment in one transaction.
    const { data: inserted, error: rpcErr } = await supabaseAdmin.rpc('affiliate_record_commission', {
      p_affiliate_id: affiliate.id,
      p_order_id: order.id,
      p_order_number: order.order_number,
      p_base_amount: baseAmount,
      p_commission_pct: blendedPct,
      p_commission_amount: commission,
      p_matures_at: maturesAt,
    });
    if (rpcErr) {
      console.error('[Affiliate] affiliate_record_commission failed:', rpcErr.message);
      return;
    }
    if (inserted) {
      console.log(`[Affiliate] Recorded commission GHS ${commission} for order ${order.order_number}`);
    }
  } catch (e: any) {
    console.error('[Affiliate] recordAffiliateCommission error:', e?.message || e);
  }
}

/**
 * Reverses a commission when its order is refunded/cancelled. Only commissions
 * that haven't been paid out (or reserved by a payout in progress) can be
 * clawed back. Atomic in the database.
 */
export async function clawbackAffiliateCommission(orderId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin.rpc('affiliate_clawback_commission', { p_order_id: orderId });
    if (error) {
      console.error('[Affiliate] affiliate_clawback_commission failed:', error.message);
      return;
    }
    if (data) console.log(`[Affiliate] Clawed back commission for order ${orderId}`);
  } catch (e: any) {
    console.error('[Affiliate] clawbackAffiliateCommission error:', e?.message || e);
  }
}

/**
 * Matures commissions whose hold window has elapsed (pending → matured),
 * moving the amount from pending to available balance. Called on dashboard/admin
 * reads so we don't need a cron. Pass an affiliateId to scope it. Runs as one
 * statement in the database, so concurrent calls can't double-count.
 */
export async function matureDueCommissions(affiliateId?: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('affiliate_mature_due_commissions', {
      p_affiliate_id: affiliateId ?? null,
    });
    if (error) console.error('[Affiliate] affiliate_mature_due_commissions failed:', error.message);
  } catch (e: any) {
    console.error('[Affiliate] matureDueCommissions error:', e?.message || e);
  }
}

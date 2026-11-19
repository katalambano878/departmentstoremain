/**
 * Shared, server-authoritative pricing + access checks for the payment routes
 * (Hubtel and Moolre init, verify, callbacks, admin reconcile).
 *
 * Charge for an order = Σ round2(base × (1 + affiliate markup %)) × qty
 *                       − coupon discount (re-applied from metadata.coupon_code)
 * where base is the CURRENT catalogue price (variant price, else product
 * price). Nothing written by the browser is used.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { withAuditActor } from '@/lib/db/pool';
import { getPublicSiteUrl } from '@/lib/site-url';
import { normalizeGhPhone, type HubtelStatusResult } from '@/lib/hubtel';
import { round2 } from '@/lib/affiliate';
import {
    loadActiveAffiliatePricing,
    affiliateMarkupPct,
    affiliateUnitPrice,
    catalogBasePrices,
} from '@/lib/affiliate-server';
import { evaluateCoupon } from '@/app/api/storefront/coupons/validate-coupon';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ORDER_PAYMENT_SELECT =
    'id, order_number, user_id, total, subtotal, discount_total, email, phone, status, payment_status, shipping_address, metadata';

export interface ChargeItem {
    id: string;
    product_id: string | null;
    variant_id: string | null;
    quantity: number;
    unit_price?: number | null;
    total_price?: number | null;
    metadata?: Record<string, any> | null;
}

export interface ChargeLine {
    id: string;
    quantity: number;
    base: number;
    unit: number;
    total: number;
}

export interface OrderCharge {
    lines: ChargeLine[];
    /** order_items ids with no catalogue price (deleted product/variant). */
    missing: string[];
    subtotal: number;
    discount: number;
    total: number;
    /** Coupon code still applied (null when none or it no longer applies). */
    couponCode: string | null;
    couponMessage: string | null;
    /** The order names an affiliate but they are no longer active. */
    affiliateInactive: boolean;
}

/** Server price for the given order lines (see file header). */
export async function computeOrderCharge(
    order: { metadata?: Record<string, any> | null },
    items: ChargeItem[],
): Promise<OrderCharge> {
    const meta = order.metadata || {};
    const affiliateCode = typeof meta.affiliate?.code === 'string' ? meta.affiliate.code : null;
    const pricing = affiliateCode ? await loadActiveAffiliatePricing(affiliateCode) : null;
    const bases = await catalogBasePrices(items);

    const lines: ChargeLine[] = [];
    const missing: string[] = [];
    for (const it of items) {
        const base = bases.get(it.id);
        if (base == null) {
            missing.push(it.id);
            continue;
        }
        const qty = Number(it.quantity) || 0;
        const unit = affiliateUnitPrice(base, affiliateMarkupPct(pricing, it.product_id));
        lines.push({ id: it.id, quantity: qty, base, unit, total: round2(unit * qty) });
    }
    const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));

    let discount = 0;
    let couponCode: string | null = null;
    let couponMessage: string | null = null;
    if (typeof meta.coupon_code === 'string' && meta.coupon_code) {
        const ev = await evaluateCoupon(meta.coupon_code, subtotal, { mode: 'payment' });
        if (ev.valid) {
            discount = ev.discount;
            couponCode = ev.code;
        } else {
            couponMessage = ev.message;
        }
    }

    return {
        lines,
        missing,
        subtotal,
        discount,
        total: round2(Math.max(0, subtotal - discount)),
        couponCode,
        couponMessage,
        affiliateInactive: !!affiliateCode && !pricing,
    };
}

/**
 * Amounts a confirmed payment for this order may be checked against: the
 * charge recomputed now, plus the server amount recorded when the checkout
 * was opened (prices can change between opening checkout and paying).
 */
export async function expectedChargeAmounts(order: {
    id: string;
    metadata?: Record<string, any> | null;
}): Promise<number[]> {
    const { data: items, error } = await supabaseAdmin
        .from('order_items')
        .select('id, product_id, variant_id, quantity, metadata')
        .eq('order_id', order.id);
    const out: number[] = [];
    if (!error && items && items.length > 0) {
        const charge = await computeOrderCharge(order, items as ChargeItem[]);
        if (charge.missing.length === 0 && charge.total > 0) out.push(charge.total);
    }
    const recorded = Number(order.metadata?.payment_server_amount);
    if (Number.isFinite(recorded) && recorded > 0) out.push(round2(recorded));
    return out;
}

/**
 * What the customer paid according to Hubtel's status API. RMSC reports
 * TransactionAmount (→ amount, what the CUSTOMER paid), Fee (→ charges) and
 * AmountAfterFees (→ amountAfterCharges, what the MERCHANT settles). The
 * order total is what we asked Hubtel to collect, so it is compared to the
 * customer-paid amount, not the after-fees settlement (which is lower
 * whenever the merchant bears the fee).
 */
export function hubtelCustomerPaidAmount(status: HubtelStatusResult | null | undefined): number | null {
    const d = status?.data;
    if (!d) return null;
    if (typeof d.amount === 'number' && Number.isFinite(d.amount)) return d.amount;
    if (typeof d.amountAfterCharges === 'number' && Number.isFinite(d.amountAfterCharges)) {
        const fee = typeof d.charges === 'number' && Number.isFinite(d.charges) ? d.charges : 0;
        return round2(d.amountAfterCharges + fee);
    }
    return null;
}

/** True when `paid` covers at least one of the expected amounts (1 pesewa slack). */
export function paidCoversExpected(paid: number | null, expected: number[]): boolean {
    if (paid == null || !Number.isFinite(paid) || expected.length === 0) return false;
    return expected.some((e) => paid + 0.01 >= e);
}

/** The order ref inside a Hubtel clientReference belongs to this order. */
export function hubtelReferenceMatchesOrder(
    clientReference: string | null | undefined,
    orderNumber: string | null | undefined,
    strip: (ref: string) => string,
): boolean {
    if (!clientReference || !orderNumber) return false;
    const ref = String(clientReference);
    if (strip(ref) === orderNumber) return true;
    // Over-long order refs are truncated to 32 chars with no suffix.
    return ref.length === 32 && orderNumber.length > 32 && orderNumber.startsWith(ref);
}

function digitsTail(input: unknown): string {
    const n = normalizeGhPhone(typeof input === 'string' ? input : '');
    return n.length >= 9 ? n.slice(-9) : '';
}

/**
 * Who may open a payment for an order (and so trigger re-pricing / removal of
 * out-of-stock lines): any ONE of
 *   (a) body customerEmail/email or phone matching the order,
 *   (b) body orderUuid (or orderId) equal to the order's uuid,
 *   (c) a bearer token for the order's owner or a staff member.
 */
export async function callerMayPayOrder(
    req: Request,
    order: { id: string; email?: string | null; phone?: string | null; user_id?: string | null; shipping_address?: any },
    body: Record<string, any>,
): Promise<boolean> {
    const email = typeof body.customerEmail === 'string' ? body.customerEmail : typeof body.email === 'string' ? body.email : '';
    if (email && order.email && email.trim().toLowerCase() === String(order.email).trim().toLowerCase()) return true;

    const phoneTail = digitsTail(body.phone);
    if (phoneTail) {
        const stored = [order.phone, order.shipping_address?.phone].map(digitsTail).filter(Boolean);
        if (stored.includes(phoneTail)) return true;
    }

    const uuid = typeof body.orderUuid === 'string' ? body.orderUuid.trim() : typeof body.orderId === 'string' ? body.orderId.trim() : '';
    if (uuid && UUID_RE.test(uuid) && uuid.toLowerCase() === String(order.id).toLowerCase()) return true;

    if (req.headers.get('authorization')) {
        const auth = await verifyAuth(req);
        if (auth.authenticated && auth.user?.id) {
            if (order.user_id && auth.user.id === order.user_id) return true;
            const staff = await verifyAuth(req, { requireAdmin: true });
            if (staff.authenticated) return true;
        }
    }
    return false;
}

/** redirectUrl only when it points at this site; otherwise the default. */
export function safeSiteRedirect(redirectUrl: unknown, fallback: string): string {
    if (typeof redirectUrl !== 'string' || !redirectUrl) return fallback;
    try {
        const site = new URL(getPublicSiteUrl());
        const target = new URL(redirectUrl, site);
        return target.origin === site.origin ? target.toString() : fallback;
    } catch {
        return fallback;
    }
}

export async function findOrderByRef(ref: string): Promise<any | null> {
    if (UUID_RE.test(ref)) {
        const byId = await supabaseAdmin.from('orders').select(ORDER_PAYMENT_SELECT).eq('id', ref).maybeSingle();
        if (!byId.error && byId.data) return byId.data;
    }
    const byRef = await supabaseAdmin.from('orders').select(ORDER_PAYMENT_SELECT).eq('order_number', ref).maybeSingle();
    return byRef.error ? null : byRef.data;
}

export type PreparedPayment =
    | {
          ok: true;
          order: any;
          orderRef: string;
          amount: number;
          removedItems: Array<{ name: string; variant?: string }>;
          metadata: Record<string, any>;
      }
    | { ok: false; response: NextResponse };

function fail(status: number, message: string, extra?: Record<string, unknown>): PreparedPayment {
    return { ok: false, response: NextResponse.json({ success: false, message, ...(extra || {}) }, { status }) };
}

/**
 * Everything payment init needs before talking to a gateway:
 * find the order, check the caller may pay it, check stock, remove
 * out-of-stock lines, re-price surviving lines from the catalogue (with the
 * affiliate markup and coupon), and save those server prices on the order.
 */
export async function preparePaymentForOrder(
    req: Request,
    body: Record<string, any>,
    logTag: string,
): Promise<PreparedPayment> {
    const orderId = body?.orderId;
    if (!orderId || typeof orderId !== 'string' || orderId.length > 64) {
        return fail(400, 'Missing or invalid orderId');
    }

    const order = await findOrderByRef(orderId.trim());
    if (!order) {
        console.error(`[${logTag}] Order not found:`, orderId);
        return fail(404, 'Order not found');
    }

    if (!(await callerMayPayOrder(req, order, body))) {
        console.warn(`[${logTag}] Payment init refused (no ownership proof) for`, order.order_number);
        return fail(403, 'We could not confirm this order belongs to you.');
    }

    if (order.payment_status === 'paid') return fail(400, 'Order is already paid');
    if (order.status === 'cancelled' || order.status === 'refunded') {
        return fail(400, 'This order is closed and can no longer be paid.');
    }

    const { data: orderItems, error: orderItemsError } = await supabaseAdmin
        .from('order_items')
        .select('id, product_id, variant_id, product_name, variant_name, quantity, total_price, unit_price, metadata')
        .eq('order_id', order.id);
    if (orderItemsError || !orderItems) return fail(500, 'Could not validate stock');
    if (orderItems.length === 0) return fail(409, 'This order has no items to pay for.');

    if (orderItems.some((i: any) => !Number.isInteger(Number(i.quantity)) || Number(i.quantity) <= 0)) {
        console.error(`[${logTag}] Non-positive quantity on order`, order.order_number);
        return fail(400, 'This order has an invalid item quantity. Please contact support.');
    }

    // --- Stock ---------------------------------------------------------------
    const variantIds = orderItems.filter((i: any) => i.variant_id).map((i: any) => i.variant_id as string);
    const productIds = orderItems.filter((i: any) => i.product_id).map((i: any) => i.product_id as string);
    const variantStock: Record<string, number> = {};
    if (variantIds.length > 0) {
        const { data: variants } = await supabaseAdmin.from('product_variants').select('id, quantity').in('id', variantIds);
        for (const v of variants ?? []) variantStock[v.id] = Number(v.quantity ?? 0);
    }
    const productStock: Record<string, { quantity: number; bypass: boolean }> = {};
    if (productIds.length > 0) {
        const { data: products } = await supabaseAdmin
            .from('products')
            .select('id, quantity, track_quantity, continue_selling')
            .in('id', productIds);
        for (const p of products ?? []) {
            productStock[p.id] = {
                quantity: Number(p.quantity ?? 0),
                bypass: Boolean(p.continue_selling) || p.track_quantity === false,
            };
        }
    }

    const outOfStock: any[] = [];
    const surviving: any[] = [];
    for (const item of orderItems as any[]) {
        const needed = Number(item.quantity);
        let oos = false;
        if (item.variant_id) {
            oos = (variantStock[item.variant_id] ?? -1) < needed;
        } else if (item.product_id) {
            const p = productStock[item.product_id];
            oos = !p?.bypass && (p?.quantity ?? 0) < needed;
        }
        (oos ? outOfStock : surviving).push(item);
    }

    if (surviving.length === 0) {
        return fail(409, 'All items in this order are out of stock and cannot be paid for.', {
            all_out_of_stock: true,
            outOfStock: outOfStock.map((i) => ({ name: i.product_name, variant: i.variant_name ?? undefined })),
        });
    }

    // --- Server price ----------------------------------------------------------
    const charge = await computeOrderCharge(order, surviving as ChargeItem[]);
    if (charge.missing.length > 0) {
        console.error(`[${logTag}] Missing server price for items`, charge.missing, 'order', order.order_number);
        return fail(500, 'Could not verify item prices. Please try again.');
    }
    if (!charge.total || charge.total <= 0) return fail(400, 'Invalid order amount');

    const metaIn: Record<string, any> = order.metadata || {};
    const nowIso = new Date().toISOString();
    const metadata: Record<string, any> = { ...metaIn, payment_server_amount: charge.total };
    if (Math.abs(Number(order.total) - charge.total) > 0.01) {
        console.warn(`[${logTag}] Re-priced order`, order.order_number, '| stored:', order.total, '| server:', charge.total);
        metadata.server_repriced_at = nowIso;
        metadata.client_total_attempt = metaIn.client_total_attempt ?? Number(order.total);
    }
    if (outOfStock.length > 0) {
        metadata.auto_removed_items = [
            ...((metaIn.auto_removed_items as any[]) || []),
            ...outOfStock.map((i) => ({
                name: i.product_name,
                variant: i.variant_name ?? null,
                removed_at: nowIso,
                reason: 'out_of_stock_at_payment',
            })),
        ];
    }
    if (metaIn.coupon_code && !charge.couponCode) {
        // Coupon no longer applies (e.g. below its minimum after removals).
        metadata.coupon_dropped = { code: metaIn.coupon_code, reason: charge.couponMessage, at: nowIso };
        delete metadata.coupon_code;
    }
    if (charge.affiliateInactive) {
        // No markup is charged, so no commission is owed.
        metadata.affiliate_dropped = { ...(metaIn.affiliate || {}), reason: 'affiliate_not_active', at: nowIso };
        delete metadata.affiliate;
    }

    const lineById = new Map(charge.lines.map((l) => [l.id, l]));
    let actorId = '';
    try {
        if (req.headers.get('authorization')) {
            const a = await verifyAuth(req);
            if (a.authenticated && a.user?.id) actorId = a.user.id;
        }
    } catch {
        /* anonymous */
    }

    try {
        await withAuditActor(actorId, async () => {
            if (outOfStock.length > 0) {
                const { error } = await supabaseAdmin
                    .from('order_items')
                    .delete()
                    .in('id', outOfStock.map((i) => i.id));
                if (error) throw new Error(`remove OOS: ${error.message}`);
            }
            for (const item of surviving) {
                const line = lineById.get(item.id)!;
                const sameUnit = Math.abs(Number(item.unit_price) - line.unit) <= 0.001;
                const sameTotal = Math.abs(Number(item.total_price) - line.total) <= 0.001;
                const sameBase = Math.abs(Number(item.metadata?.base_unit_price) - line.base) <= 0.001;
                if (sameUnit && sameTotal && sameBase) continue;
                const { error } = await supabaseAdmin
                    .from('order_items')
                    .update({
                        unit_price: line.unit,
                        total_price: line.total,
                        metadata: { ...(item.metadata || {}), base_unit_price: line.base },
                    })
                    .eq('id', item.id);
                if (error) throw new Error(`reprice item: ${error.message}`);
            }
            const { error: orderErr } = await supabaseAdmin
                .from('orders')
                .update({
                    subtotal: charge.subtotal,
                    discount_total: charge.discount,
                    total: charge.total,
                    metadata,
                })
                .eq('id', order.id)
                .neq('payment_status', 'paid');
            if (orderErr) throw new Error(`update order: ${orderErr.message}`);
        });
    } catch (e: any) {
        console.error(`[${logTag}] Failed to save server prices:`, e?.message || e);
        return fail(500, 'Could not recalculate order. Please try again.');
    }

    order.total = charge.total;
    order.metadata = metadata;

    return {
        ok: true,
        order,
        orderRef: order.order_number || orderId,
        amount: charge.total,
        removedItems: outOfStock.map((i) => ({ name: i.product_name, variant: i.variant_name ?? undefined })),
        metadata,
    };
}

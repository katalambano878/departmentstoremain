import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { isStorefrontVisible } from '@/lib/product-visibility';
import { verifyAuth } from '@/lib/auth';
import { withAuditActor } from '@/lib/db/pool';
import { round2, AFFILIATE_COOKIE } from '@/lib/affiliate';
import { loadActiveAffiliatePricing, affiliateMarkupPct, affiliateUnitPrice } from '@/lib/affiliate-server';
import { evaluateCoupon, normalizeCouponCode } from '@/app/api/storefront/coupons/validate-coupon';

const CREATE_RATE_LIMIT = { maxRequests: 12, windowSeconds: 60 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_NUMBER_RE = /^ORD-\d+-\d+$/;
const TRACKING_RE = /^SLI-[A-Z0-9]{4,12}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_QTY = 999;

/**
 * Creates a storefront order. Everything that decides money is computed here
 * from the database; the browser's prices, totals and affiliate numbers are
 * ignored (the client total is only compared, to report `priceChanged`).
 *
 * Body: { orderNumber, trackingNumber, email, phone, shippingData,
 *         deliveryMethod, paymentMethod, total?, couponCode?,
 *         affiliate?: { code }, items: [{ id, variantId?, variant?, quantity, image? }],
 *         birthdayMonth?, birthdayDay? }
 * Auth:   optional `Authorization: Bearer <token>` — the ONLY source of user_id.
 * 201 →   { id, order_number, subtotal, discount_total, total, priceChanged }
 */
interface IncomingItem {
    id: string; // product id or slug
    name?: string;
    variant?: string | null;
    variantId?: string | null;
    quantity: number;
    image?: string | null;
}

interface CreateOrderPayload {
    orderNumber: string;
    trackingNumber?: string;
    email: string;
    phone: string;
    shippingData: Record<string, unknown> & {
        firstName?: string;
        lastName?: string;
        preferredDate?: string | null;
    };
    deliveryMethod?: string;
    paymentMethod?: string;
    total?: number;
    couponCode?: string | null;
    affiliate?: { code?: string } | null;
    items: IncomingItem[];
    /** Optional birthday for the yearly birthday message (no year). */
    birthdayMonth?: number | string | null;
    birthdayDay?: number | string | null;
}

function badRequest(message: string, extra?: Record<string, unknown>) {
    return NextResponse.json({ error: message, ...(extra || {}) }, { status: 400 });
}

function serverError(message = 'We could not place your order. Please try again.') {
    return NextResponse.json({ error: message }, { status: 500 });
}

/** A real day of the year (Feb 29 allowed), or null. */
function parseBirthday(rawMonth: unknown, rawDay: unknown): { month: number; day: number } | null {
    const month = Number(rawMonth);
    const day = Number(rawDay);
    if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return null;
    const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    return day <= daysInMonth ? { month, day } : null;
}

function cleanText(v: unknown, max: number): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t ? t.slice(0, max) : null;
}

function cleanImage(v: unknown): string | null {
    const t = cleanText(v, 1000);
    if (!t) return null;
    return /^https:\/\//i.test(t) || t.startsWith('/') ? t : null;
}

function cookieValue(req: Request, name: string): string | null {
    const header = req.headers.get('cookie') || '';
    const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (!m) return null;
    try {
        return decodeURIComponent(m[1].trim());
    } catch {
        return null;
    }
}

type ProductRow = { id: string; name: string; slug: string; price: number | string; status?: string; metadata?: any };
type VariantRow = { id: string; product_id: string; name: string; price: number | string };

export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rl = checkRateLimit(`orders-create:${clientId}`, CREATE_RATE_LIMIT);
        if (!rl.success) {
            return NextResponse.json({ error: 'Too many checkout attempts. Please wait a moment.' }, { status: 429 });
        }

        let body: CreateOrderPayload;
        try {
            body = (await req.json()) as CreateOrderPayload;
        } catch {
            return badRequest('Invalid JSON body');
        }

        // --- Basic validation ------------------------------------------------
        if (!body || typeof body !== 'object') return badRequest('Missing body');
        if (!body.orderNumber || typeof body.orderNumber !== 'string' || !ORDER_NUMBER_RE.test(body.orderNumber)) {
            return badRequest('Invalid order number');
        }
        if (!body.email || typeof body.email !== 'string' || body.email.length > 254 || !/^\S+@\S+\.\S+$/.test(body.email)) {
            return badRequest('Invalid email');
        }
        if (!body.phone || typeof body.phone !== 'string' || body.phone.length < 5 || body.phone.length > 32) {
            return badRequest('Invalid phone');
        }
        if (!body.shippingData || typeof body.shippingData !== 'object' || Array.isArray(body.shippingData)) {
            return badRequest('Missing shipping details');
        }
        if (JSON.stringify(body.shippingData).length > 5000) {
            return badRequest('Shipping details are too long');
        }
        if (!Array.isArray(body.items) || body.items.length === 0) {
            return badRequest('Cart is empty');
        }
        if (body.items.length > 200) {
            return badRequest('Too many items');
        }
        for (const item of body.items) {
            if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200) {
                return badRequest('Invalid item in cart');
            }
            const q = Number(item.quantity);
            if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) {
                return badRequest(`Quantity must be a whole number from 1 to ${MAX_QTY}.`);
            }
        }
        const email = body.email.trim();
        const phone = body.phone.trim();
        const trackingNumber =
            typeof body.trackingNumber === 'string' && TRACKING_RE.test(body.trackingNumber) ? body.trackingNumber : null;

        // --- Who is ordering: ONLY a verified bearer token sets user_id -------
        let userId: string | null = null;
        let userEmail: string | null = null;
        if (req.headers.get('authorization')) {
            const auth = await verifyAuth(req);
            if (auth.authenticated && auth.user?.id && UUID_RE.test(String(auth.user.id))) {
                userId = String(auth.user.id);
                userEmail = typeof auth.user.email === 'string' ? auth.user.email : null;
            }
            // An invalid/expired token checks out as a guest.
        }

        // --- Resolve products (uuid or slug) ---------------------------------
        const productById = new Map<string, ProductRow>();
        const directIds = Array.from(new Set(body.items.filter((i) => UUID_RE.test(i.id)).map((i) => i.id)));
        if (directIds.length > 0) {
            const { data: prods, error } = await supabaseAdmin
                .from('products')
                .select('id, name, slug, price, status, metadata')
                .in('id', directIds);
            if (error) {
                console.error('[OrdersCreate] product lookup failed:', error.message);
                return serverError();
            }
            for (const p of (prods || []) as ProductRow[]) productById.set(p.id, p);
        }

        const slugToId = new Map<string, string>();
        const slugs = Array.from(new Set(body.items.filter((i) => !UUID_RE.test(i.id)).map((i) => i.id.trim())));
        for (const slug of slugs) {
            if (!SLUG_RE.test(slug)) {
                return badRequest(`Product not found: ${slug.slice(0, 60)}`);
            }
            const { data: prod, error } = await supabaseAdmin
                .from('products')
                .select('id, name, slug, price, status, metadata')
                .eq('slug', slug)
                .maybeSingle();
            if (error) {
                console.error('[OrdersCreate] slug lookup failed:', error.message);
                return serverError();
            }
            if (!prod) return badRequest(`Product not found: ${slug.slice(0, 60)}`);
            slugToId.set(slug, (prod as ProductRow).id);
            productById.set((prod as ProductRow).id, prod as ProductRow);
        }
        const productIdOf = (item: IncomingItem) => (UUID_RE.test(item.id) ? item.id : slugToId.get(item.id.trim()));

        // --- Reject unavailable (draft / POS-only / unknown) products -------
        const unavailable: string[] = [];
        for (const item of body.items) {
            const pid = productIdOf(item);
            const prod = pid ? productById.get(pid) : undefined;
            if (!prod || !isStorefrontVisible({ status: prod.status, metadata: prod.metadata })) {
                unavailable.push(cleanText(item.name, 120) || item.id.slice(0, 60));
            }
        }
        if (unavailable.length > 0) {
            return badRequest(
                `Some items are no longer available and were removed: ${unavailable.join(', ')}. Please review your cart and try again.`,
                { unavailable }
            );
        }

        // --- Resolve variants --------------------------------------------------
        const variantById = new Map<string, VariantRow>();
        const variantIds = Array.from(
            new Set(body.items.map((i) => i.variantId).filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)))
        );
        if (variantIds.length > 0) {
            const { data: vars, error } = await supabaseAdmin
                .from('product_variants')
                .select('id, product_id, name, price')
                .in('id', variantIds);
            if (error) {
                console.error('[OrdersCreate] variant lookup failed:', error.message);
                return serverError();
            }
            for (const v of (vars || []) as VariantRow[]) variantById.set(v.id, v);
        }

        const resolvedVariant: (VariantRow | null)[] = [];
        for (const item of body.items) {
            const pid = productIdOf(item)!;
            if (typeof item.variantId === 'string' && UUID_RE.test(item.variantId)) {
                const v = variantById.get(item.variantId);
                if (!v || v.product_id !== pid) {
                    return badRequest(`An option you chose for ${productById.get(pid)?.name || 'a product'} is no longer available. Please review your cart.`);
                }
                resolvedVariant.push(v);
                continue;
            }
            const variantName = cleanText(item.variant, 200);
            if (variantName) {
                const { data: byName } = await supabaseAdmin
                    .from('product_variants')
                    .select('id, product_id, name, price')
                    .eq('product_id', pid)
                    .eq('name', variantName)
                    .limit(1);
                resolvedVariant.push(((byName || [])[0] as VariantRow) || null);
            } else {
                resolvedVariant.push(null);
            }
        }

        // --- Server prices (base + approved affiliate markup) -----------------
        const affiliateCode =
            (typeof body.affiliate?.code === 'string' && body.affiliate.code.trim()) || cookieValue(req, AFFILIATE_COOKIE);
        const pricing = affiliateCode ? await loadActiveAffiliatePricing(affiliateCode) : null;

        type Line = {
            productId: string;
            product: ProductRow;
            variant: VariantRow | null;
            variantLabel: string | null;
            qty: number;
            base: number;
            unit: number;
            total: number;
            image: string | null;
        };
        const lines: Line[] = [];
        for (let i = 0; i < body.items.length; i++) {
            const item = body.items[i];
            const productId = productIdOf(item)!;
            const product = productById.get(productId)!;
            const variant = resolvedVariant[i];
            const base = Number(variant?.price ?? product.price);
            if (!Number.isFinite(base) || base < 0) {
                console.error('[OrdersCreate] missing server price for product', productId);
                return serverError('We could not price an item in your cart. Please try again.');
            }
            const qty = Number(item.quantity);
            const unit = affiliateUnitPrice(base, affiliateMarkupPct(pricing, productId));
            lines.push({
                productId,
                product,
                variant,
                variantLabel: variant?.name || cleanText(item.variant, 200),
                qty,
                base: round2(base),
                unit,
                total: round2(unit * qty),
                image: cleanImage(item.image),
            });
        }

        const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
        const baseSubtotal = round2(lines.reduce((s, l) => s + l.base * l.qty, 0));

        // --- Coupon ------------------------------------------------------------
        let discount = 0;
        let couponCode: string | null = null;
        const rawCoupon = normalizeCouponCode(body.couponCode);
        if (rawCoupon) {
            const ev = await evaluateCoupon(rawCoupon, subtotal, { mode: 'checkout', email });
            if (!ev.valid) {
                return badRequest(ev.message, { coupon_invalid: true, coupon: ev });
            }
            discount = ev.discount;
            couponCode = ev.code;
        }
        const total = round2(Math.max(0, subtotal - discount));
        const clientTotal = Number(body.total);
        const priceChanged = !Number.isFinite(clientTotal) || Math.abs(clientTotal - total) > 0.01;

        // --- Affiliate attribution (server-computed) ---------------------------
        const commissionAmount = round2(subtotal - baseSubtotal);
        const affiliateMeta =
            pricing && commissionAmount > 0
                ? {
                      affiliate: {
                          code: pricing.code,
                          commission_pct: pricing.defaultPct,
                          base_subtotal: baseSubtotal,
                          commission_amount: commissionAmount,
                      },
                  }
                : {};

        // --- Build the order row -------------------------------------------
        const preferredDate = cleanText(body.shippingData?.preferredDate, 40);
        const firstName = cleanText(body.shippingData?.firstName, 100);
        const lastName = cleanText(body.shippingData?.lastName, 100);

        const orderRow = {
            order_number: body.orderNumber,
            user_id: userId,
            email,
            phone,
            status: 'pending',
            payment_status: 'pending',
            currency: 'GHS',
            subtotal,
            tax_total: 0,
            shipping_total: 0, // delivery is quoted by the rider at hand-off
            discount_total: discount,
            total,
            shipping_method: cleanText(body.deliveryMethod, 50),
            payment_method: cleanText(body.paymentMethod, 50),
            shipping_address: body.shippingData,
            billing_address: body.shippingData,
            metadata: {
                guest_checkout: !userId,
                server_priced: true,
                first_name: firstName,
                last_name: lastName,
                tracking_number: trackingNumber,
                ...(preferredDate ? { customer_preferred_date: preferredDate } : {}),
                ...(couponCode ? { coupon_code: couponCode } : {}),
                ...(priceChanged && Number.isFinite(clientTotal) ? { client_total_attempt: clientTotal } : {}),
                ...affiliateMeta,
            },
        };

        // --- Insert order + items in one transaction ---------------------------
        let createdOrder: { id: string; order_number: string };
        try {
            createdOrder = await withAuditActor(userId || '', async () => {
                const { data: order, error: orderError } = await supabaseAdmin
                    .from('orders')
                    .insert([orderRow])
                    .select('id, order_number')
                    .single();
                if (orderError || !order) throw new Error(`order insert: ${orderError?.message || 'no row'}`);

                const orderItems = lines.map((l) => ({
                    order_id: order.id,
                    product_id: l.productId,
                    variant_id: l.variant?.id || null,
                    product_name: l.product.name,
                    variant_name: l.variantLabel,
                    quantity: l.qty,
                    unit_price: l.unit,
                    total_price: l.total,
                    metadata: {
                        image: l.image,
                        slug: l.product.slug || null,
                        base_unit_price: l.base,
                        preorder_shipping: l.product.metadata?.preorder_shipping || null,
                    },
                }));
                const { error: itemsError } = await supabaseAdmin.from('order_items').insert(orderItems);
                if (itemsError) throw new Error(`order_items insert: ${itemsError.message}`);
                return order as { id: string; order_number: string };
            });
        } catch (e: any) {
            console.error('[OrdersCreate] create failed:', e?.message || e);
            return serverError();
        }

        // --- Customer record (best-effort) ---------------------------------
        // upsert_customer_from_order overwrites name/address/user_id of an
        // existing customer matched by email or phone. Only let it run for a
        // new customer, or when the signed-in user owns the matched record;
        // otherwise leave the existing record alone (order stats are added by
        // update_customer_stats when the order is paid).
        try {
            const findOne = async (col: string, val: string) => {
                if (!val) return null;
                const { data } = await supabaseAdmin
                    .from('customers')
                    .select('id, email, user_id')
                    .eq(col, val)
                    .limit(1);
                return ((data || [])[0] as { id: string; email: string; user_id: string | null }) || null;
            };
            const existing =
                (await findOne('email', email)) ||
                (await findOne('secondary_email', email)) ||
                (await findOne('phone', phone)) ||
                (await findOne('secondary_phone', phone));

            const ownsExisting =
                !!existing &&
                !!userId &&
                (existing.user_id === userId ||
                    (!existing.user_id && !!userEmail && existing.email?.toLowerCase() === userEmail.toLowerCase()));

            let customerId: string | null = null;
            if (!existing || ownsExisting) {
                const fullName = `${firstName || ''} ${lastName || ''}`.trim();
                const { data, error } = await supabaseAdmin.rpc('upsert_customer_from_order', {
                    p_email: email,
                    p_phone: phone,
                    p_full_name: fullName,
                    p_first_name: firstName,
                    p_last_name: lastName,
                    p_user_id: userId,
                    p_address: body.shippingData,
                });
                if (error) console.error('[OrdersCreate] upsert_customer_from_order failed (non-fatal):', error.message);
                else if (typeof data === 'string') customerId = data;
            }

            // Optional birthday (day and month) for the yearly birthday message.
            const birthday = parseBirthday(body.birthdayMonth, body.birthdayDay);
            if (birthday && customerId) {
                const { error: bdayErr } = await supabaseAdmin
                    .from('customers')
                    .update({ birthday_month: birthday.month, birthday_day: birthday.day })
                    .eq('id', customerId);
                if (bdayErr) console.error('[OrdersCreate] birthday save failed (non-fatal):', bdayErr.message);
            }
        } catch (custErr: any) {
            console.error('[OrdersCreate] customer upsert failed (non-fatal):', custErr?.message || custErr);
        }

        return NextResponse.json(
            {
                id: createdOrder.id,
                order_number: createdOrder.order_number,
                subtotal,
                discount_total: discount,
                total,
                priceChanged,
            },
            { status: 201 }
        );
    } catch (err: any) {
        console.error('[OrdersCreate] unexpected error:', err?.message, err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

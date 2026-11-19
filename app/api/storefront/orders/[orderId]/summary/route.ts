import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { maskEmail } from '@/lib/sanitize';

function maskPhone(phone: unknown): string | null {
    const digits = String(phone || '').replace(/\D+/g, '');
    if (digits.length < 4) return null;
    return `${'*'.repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`;
}

const LOOKUP_RATE_LIMIT = { maxRequests: 30, windowSeconds: 60 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_NUMBER_RE = /^ORD-\d+-\d+$/;

/**
 * Order summary (full) for the order-success page.  The caller is assumed
 * to have obtained the unguessable order number via the checkout redirect
 * they initiated seconds earlier; we still rate-limit lookups to prevent
 * brute-force enumeration and strip the raw email address from the
 * response (we only send back a masked form for display).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ orderId: string }> }) {
    try {
        const { orderId } = await ctx.params;
        const raw = (orderId || '').trim();

        if (!raw || (!UUID_RE.test(raw) && !ORDER_NUMBER_RE.test(raw))) {
            return NextResponse.json({ error: 'Invalid order reference' }, { status: 400 });
        }

        const clientId = getClientIdentifier(_req);
        const rl = checkRateLimit(`order-summary:${clientId}`, LOOKUP_RATE_LIMIT);
        if (!rl.success) {
            return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }

        const column = UUID_RE.test(raw) ? 'id' : 'order_number';

        const { data: order, error } = await supabaseAdmin
            .from('orders')
            .select(`
                id,
                order_number,
                status,
                payment_status,
                payment_method,
                shipping_method,
                subtotal,
                shipping_total,
                discount_total,
                tax_total,
                total,
                currency,
                created_at,
                shipping_address,
                metadata,
                email,
                phone,
                order_items (
                    id,
                    product_id,
                    variant_id,
                    product_name,
                    variant_name,
                    quantity,
                    unit_price,
                    total_price,
                    metadata
                )
            `)
            .eq(column, raw)
            .maybeSingle();

        if (error || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        // Email and phone are masked: the order number in the URL is the only
        // credential here. /api/payment/hubtel/verify no longer needs the email
        // (it asks Hubtel directly), so nothing downstream needs the raw value.
        const shipping = (order.shipping_address ?? {}) as Record<string, any>;
        return NextResponse.json({
            order: {
                ...order,
                email: order.email ? maskEmail(String(order.email)) : null,
                phone: maskPhone(order.phone),
                shipping_address: {
                    ...shipping,
                    ...(shipping.email ? { email: maskEmail(String(shipping.email)) } : {}),
                    ...(shipping.phone ? { phone: maskPhone(shipping.phone) } : {}),
                },
            },
        });
    } catch (err: any) {
        console.error('[OrderSummary] Error:', err?.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

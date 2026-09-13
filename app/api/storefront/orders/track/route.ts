import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { normalizeGhPhone } from '@/lib/hubtel';

const TRACK_RATE_LIMIT = { maxRequests: 10, windowSeconds: 60 };
const ORDER_NUMBER_RE = /^[A-Za-z0-9-]{1,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_SELECT = `
    id,
    order_number,
    status,
    payment_status,
    total,
    email,
    phone,
    created_at,
    shipping_address,
    metadata,
    order_items (
        id,
        product_name,
        variant_name,
        quantity,
        unit_price,
        metadata,
        product_variants ( image_url ),
        products (
            product_images ( url )
        )
    )
`;

function notFound() {
    return NextResponse.json(
        { error: 'No order found. Check your email, order number, or phone and try again.' },
        { status: 404 }
    );
}

function phonesMatch(stored: string | null | undefined, input: string): boolean {
    const a = normalizeGhPhone(stored);
    const b = normalizeGhPhone(input);
    if (!a || !b) return false;
    return a === b || a.endsWith(b.slice(-9)) || b.endsWith(a.slice(-9));
}

function phoneLookupVariants(input: string): string[] {
    const digits = String(input).replace(/\D+/g, '');
    if (digits.length < 9) return [];
    const local9 = digits.slice(-9);
    return Array.from(new Set([
        input.trim(),
        local9,
        `0${local9}`,
        `233${local9}`,
        `+233${local9}`,
    ]));
}

function sanitizeOrder(order: any) {
    const { email: _email, phone: _phone, ...safe } = order;
    return safe;
}

export async function POST(request: Request) {
    try {
        const clientId = getClientIdentifier(request);
        const rateLimitResult = checkRateLimit(`track:${clientId}`, TRACK_RATE_LIMIT);

        if (!rateLimitResult.success) {
            return NextResponse.json(
                { error: 'Too many requests. Please try again later.' },
                { status: 429, headers: { 'X-RateLimit-Reset': rateLimitResult.resetIn.toString() } }
            );
        }

        const body = await request.json();
        const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim() : '';
        const email = typeof body.email === 'string' ? body.email.trim() : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';

        if (!orderNumber && !email && !phone) {
            return NextResponse.json(
                { error: 'Enter your email, order number, or phone number' },
                { status: 400 }
            );
        }

        if (orderNumber && !ORDER_NUMBER_RE.test(orderNumber)) {
            return NextResponse.json({ error: 'Invalid order number format' }, { status: 400 });
        }
        if (email && !EMAIL_RE.test(email)) {
            return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
        }
        if (phone && phone.replace(/\D+/g, '').length < 9) {
            return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
        }

        let query = supabaseAdmin
            .from('orders')
            .select(ORDER_SELECT)
            .order('created_at', { ascending: false })
            .limit(20);

        if (orderNumber) {
            if (UUID_RE.test(orderNumber)) {
                query = query.or(`order_number.eq.${orderNumber},id.eq.${orderNumber}`);
            } else {
                query = query.eq('order_number', orderNumber);
            }
        } else if (email) {
            query = query.ilike('email', email);
        } else if (phone) {
            const last9 = phone.replace(/\D+/g, '').slice(-9);
            const variants = phoneLookupVariants(phone).filter((v) => /^\+?\d+$/.test(v));
            const orParts = [
                ...variants.map((v) => `phone.eq.${v}`),
                `phone.ilike.%${last9}%`,
            ];
            query = query.or(orParts.join(','));
        }

        const { data: rows, error: orderError } = await query;

        if (orderError || !rows || rows.length === 0) {
            return notFound();
        }

        const matches = rows.filter((order) => {
            if (email && order.email?.toLowerCase() !== email.toLowerCase()) return false;
            if (phone) {
                const shippingPhone = (order.shipping_address as any)?.phone;
                if (!phonesMatch(order.phone, phone) && !phonesMatch(shippingPhone, phone)) {
                    return false;
                }
            }
            return true;
        });

        if (matches.length === 0) {
            return notFound();
        }

        return NextResponse.json({
            orders: matches.map(sanitizeOrder),
        });
    } catch (error: any) {
        console.error('[Track] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

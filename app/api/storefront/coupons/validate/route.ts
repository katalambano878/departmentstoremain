import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { evaluateCoupon } from '../validate-coupon';

const VALIDATE_RATE_LIMIT = { maxRequests: 15, windowSeconds: 60 };

/**
 * POST /api/storefront/coupons/validate
 * Body: { code: string, subtotal: number, email?: string }
 * → { valid, code, type, value, discount, message }
 *
 * Preview only: the order-create route re-validates the code and computes the
 * discount itself from server prices; the subtotal sent here is just for the
 * preview figure.
 */
export async function POST(req: Request) {
    const clientId = getClientIdentifier(req);
    const rl = checkRateLimit(`coupon-validate:${clientId}`, VALIDATE_RATE_LIMIT);
    if (!rl.success) {
        return NextResponse.json(
            { valid: false, code: '', type: null, value: null, discount: 0, message: 'Too many attempts. Please wait a moment.' },
            { status: 429 },
        );
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { valid: false, code: '', type: null, value: null, discount: 0, message: 'Invalid request.' },
            { status: 400 },
        );
    }

    const subtotal = Number(body?.subtotal);
    try {
        const result = await evaluateCoupon(body?.code, Number.isFinite(subtotal) ? subtotal : 0, {
            mode: 'checkout',
            email: typeof body?.email === 'string' ? body.email : null,
        });
        return NextResponse.json(result);
    } catch (e: any) {
        console.error('[CouponValidate] error:', e?.message || e);
        return NextResponse.json(
            { valid: false, code: '', type: null, value: null, discount: 0, message: 'Could not check this coupon right now.' },
            { status: 500 },
        );
    }
}

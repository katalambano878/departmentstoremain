/**
 * Server-side coupon evaluation shared by:
 *   - POST /api/storefront/coupons/validate   (checkout preview)
 *   - POST /api/storefront/orders/create       (authoritative, writes discount)
 *   - payment init / verify                    (re-applies the code stored in
 *                                               orders.metadata.coupon_code)
 *
 * Coupons are readable only by staff/server, so this must run server-side.
 * Usage is counted by mark_order_paid (once, when the order is paid).
 */
import { supabaseAdmin } from '@/lib/supabase-admin';
import { round2 } from '@/lib/affiliate';

export type CouponType = 'percentage' | 'fixed_amount' | 'free_shipping';

export interface CouponEvaluation {
    valid: boolean;
    code: string;
    type: CouponType | null;
    value: number | null;
    discount: number;
    message: string;
}

/**
 * 'checkout' — every rule: active, start/end date, usage limit, per-customer
 *              limit, minimum purchase, maximum discount.
 * 'payment'  — the code was already accepted when the order was created
 *              (metadata.coupon_code is server-written), so only the amount
 *              rules are re-applied (type/value, minimum purchase, maximum
 *              discount). Expiry or deactivation after checkout doesn't change
 *              what the customer was promised.
 */
export type CouponMode = 'checkout' | 'payment';

const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

function invalid(code: string, message: string, extra?: Partial<CouponEvaluation>): CouponEvaluation {
    return { valid: false, code, type: null, value: null, discount: 0, message, ...(extra || {}) };
}

export function normalizeCouponCode(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim() : '';
}

/** Escapes LIKE wildcards so the code matches literally (case-insensitive). */
function likeLiteral(s: string): string {
    return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function evaluateCoupon(
    rawCode: unknown,
    rawSubtotal: number,
    opts: { mode?: CouponMode; email?: string | null } = {},
): Promise<CouponEvaluation> {
    const mode: CouponMode = opts.mode || 'checkout';
    const code = normalizeCouponCode(rawCode);
    if (!code) return invalid('', 'Enter a coupon code.');
    if (!CODE_RE.test(code)) return invalid(code, 'This coupon code is not valid.');

    const subtotal = Number.isFinite(rawSubtotal) && rawSubtotal > 0 ? round2(rawSubtotal) : 0;

    const { data: rows, error } = await supabaseAdmin
        .from('coupons')
        .select('id, code, type, value, minimum_purchase, maximum_discount, usage_limit, usage_count, per_user_limit, start_date, end_date, is_active')
        .ilike('code', likeLiteral(code))
        .limit(5);
    if (error) {
        console.error('[Coupon] lookup failed:', error.message);
        return invalid(code, 'Could not check this coupon right now. Please try again.');
    }
    const list = (rows || []) as any[];
    const coupon = list.find((c) => c.code === code) || list.find((c) => String(c.code).toLowerCase() === code.toLowerCase());
    if (!coupon) return invalid(code, 'This coupon code is not valid.');

    const type = String(coupon.type) as CouponType;
    const value = Number(coupon.value) || 0;
    const canonical = String(coupon.code);
    const base = { code: canonical, type, value };

    if (mode === 'checkout') {
        if (coupon.is_active === false) return invalid(canonical, 'This coupon is no longer active.', base);
        const now = Date.now();
        if (coupon.start_date && new Date(coupon.start_date).getTime() > now) {
            return invalid(canonical, 'This coupon is not active yet.', base);
        }
        if (coupon.end_date && new Date(coupon.end_date).getTime() < now) {
            return invalid(canonical, 'This coupon has expired.', base);
        }
        const limit = coupon.usage_limit != null ? Number(coupon.usage_limit) : null;
        if (limit != null && limit >= 0 && (Number(coupon.usage_count) || 0) >= limit) {
            return invalid(canonical, 'This coupon has reached its usage limit.', base);
        }
        const perUser = coupon.per_user_limit != null ? Number(coupon.per_user_limit) : null;
        const email = typeof opts.email === 'string' ? opts.email.trim() : '';
        if (perUser != null && perUser > 0 && email) {
            const { data: used } = await supabaseAdmin
                .from('orders')
                .select('id')
                .ilike('email', likeLiteral(email))
                .eq('metadata->>coupon_code', canonical)
                .eq('payment_status', 'paid')
                .limit(perUser);
            if ((used || []).length >= perUser) {
                return invalid(canonical, 'You have already used this coupon.', base);
            }
        }
    }

    if (type === 'free_shipping') {
        // Delivery is quoted by the rider at hand-off, so there is no online
        // shipping charge to waive.
        return invalid(canonical, 'This coupon can’t be used for online orders.', base);
    }
    if (type !== 'percentage' && type !== 'fixed_amount') {
        return invalid(canonical, 'This coupon code is not valid.', base);
    }

    const minimum = Number(coupon.minimum_purchase) || 0;
    if (minimum > 0 && subtotal < minimum) {
        return invalid(canonical, `Spend at least GH₵${minimum.toFixed(2)} to use this coupon.`, base);
    }

    let discount =
        type === 'percentage'
            ? subtotal * (Math.min(Math.max(value, 0), 100) / 100)
            : Math.max(value, 0);
    const maxDiscount = coupon.maximum_discount != null ? Number(coupon.maximum_discount) : null;
    if (maxDiscount != null && Number.isFinite(maxDiscount) && maxDiscount >= 0) {
        discount = Math.min(discount, maxDiscount);
    }
    discount = round2(Math.min(discount, subtotal));

    if (discount <= 0) {
        return invalid(canonical, 'This coupon doesn’t reduce this order.', base);
    }

    return {
        valid: true,
        code: canonical,
        type,
        value,
        discount,
        message: `Coupon applied: you save GH₵${discount.toFixed(2)}.`,
    };
}

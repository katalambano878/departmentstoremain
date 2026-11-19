import { NextResponse } from 'next/server';

/**
 * Retired. This route used to mark an order paid on "redirect trust" alone
 * (a stored moolre_externalref + the order email + order age), without asking
 * Moolre, which has no transaction-status API we can query. Anyone who knew an
 * order number and email could mark it paid for free.
 *
 * Moolre payments are confirmed only by the secret-verified callback
 * (/api/payment/moolre/callback). The storefront verifies via
 * /api/payment/hubtel/verify. Stuck legacy Moolre orders are confirmed in the
 * Moolre dashboard and marked paid by staff.
 */
export async function POST() {
    return NextResponse.json(
        {
            success: false,
            message: 'This verification method is no longer available. Payments are confirmed automatically by the payment provider.',
        },
        { status: 410 },
    );
}

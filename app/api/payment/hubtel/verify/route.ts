import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { checkHubtelStatus, isHubtelPaid, stripHubtelReferenceSuffix } from '@/lib/hubtel';
import {
    expectedChargeAmounts,
    hubtelCustomerPaidAmount,
    hubtelReferenceMatchesOrder,
    paidCoversExpected,
} from '../../_lib/order-charge';
import { runPaidSideEffects } from '../../_lib/after-paid';

/**
 * Server-side Hubtel verification, called from /order-success after the
 * customer returns from the hosted checkout.
 *
 * Body: { orderNumber } (an `email` field is accepted and ignored — the order
 * is only marked paid when Hubtel itself confirms it, so knowing the email
 * adds nothing, and the success page only has a masked email now).
 *
 * The order is marked paid only when Hubtel's status API reports "Paid" for
 * THIS order's client reference AND the customer-paid amount covers the
 * server-recomputed charge.
 */
export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`hubtel-verify:${clientId}`, RATE_LIMITS.payment);
        if (!rateLimitResult.success) {
            return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
        }

        // Same-origin only.
        const origin = req.headers.get('origin') || '';
        const host = req.headers.get('host') || '';
        const allowedOrigins = [
            process.env.NEXT_PUBLIC_APP_URL,
            process.env.NEXT_PUBLIC_SITE_URL,
            host ? `https://${host}` : null,
            host ? `http://${host}` : null,
        ].filter(Boolean) as string[];
        if (origin && !allowedOrigins.some((o) => origin === o)) {
            console.warn('[Hubtel Verify] Rejected cross-origin request from:', origin);
            return NextResponse.json({ success: false, message: 'Cross-origin requests not allowed' }, { status: 403 });
        }

        let body: any;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ success: false, message: 'Invalid request body' }, { status: 400 });
        }
        const orderNumber = body?.orderNumber;

        if (!orderNumber || typeof orderNumber !== 'string' || !/^ORD-\d+-\d+$/.test(orderNumber)) {
            return NextResponse.json({ success: false, message: 'Missing or invalid orderNumber' }, { status: 400 });
        }

        const { data: order, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, order_number, payment_status, status, total, metadata')
            .eq('order_number', orderNumber)
            .maybeSingle();

        if (fetchError || !order) {
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        if (order.payment_status === 'paid') {
            return NextResponse.json({
                success: true,
                status: order.status,
                payment_status: order.payment_status,
                message: 'Order already paid',
            });
        }

        const notConfirmed = (message = 'Payment not yet confirmed by payment provider') =>
            NextResponse.json({
                success: false,
                status: order.status,
                payment_status: order.payment_status,
                message,
            });

        // The reference must have been written by our init route for THIS order.
        const clientReference = (order.metadata as any)?.hubtel_client_reference as string | undefined;
        if (!clientReference || !hubtelReferenceMatchesOrder(clientReference, order.order_number, stripHubtelReferenceSuffix)) {
            console.warn('[Hubtel Verify] Missing or foreign hubtel_client_reference on order:', orderNumber);
            return notConfirmed('Payment reference not found');
        }

        if (
            !process.env.HUBTEL_API_ID ||
            !process.env.HUBTEL_API_KEY ||
            !process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER
        ) {
            return NextResponse.json(
                {
                    success: false,
                    status: order.status,
                    payment_status: order.payment_status,
                    message: 'Payment verification unavailable',
                },
                { status: 503 },
            );
        }

        let status;
        try {
            status = await checkHubtelStatus(clientReference);
        } catch (e: any) {
            console.warn('[Hubtel Verify] Status API failed:', e?.message || e);
            return notConfirmed();
        }

        if (!isHubtelPaid(String(status?.data?.status || ''), status?.responseCode)) {
            return notConfirmed();
        }

        const returnedRef = status?.data?.clientReference;
        if (returnedRef && !hubtelReferenceMatchesOrder(String(returnedRef), order.order_number, stripHubtelReferenceSuffix)) {
            console.error('[Hubtel Verify] Hubtel returned a different client reference:', returnedRef, 'for order', orderNumber);
            return notConfirmed();
        }

        const paid = hubtelCustomerPaidAmount(status);
        const expected = await expectedChargeAmounts(order);
        if (!paidCoversExpected(paid, expected)) {
            console.error('[Hubtel Verify] AMOUNT MISMATCH for', orderNumber, '| paid:', paid, '| expected one of:', expected,
                '| amountAfterCharges:', status?.data?.amountAfterCharges);
            return notConfirmed('Payment amount does not match this order. Please contact support.');
        }

        const { data: orderJson, error: updateError } = await supabaseAdmin.rpc('mark_order_paid', {
            order_ref: orderNumber,
            moolre_ref: 'hubtel-api-verify',
        });

        if (updateError) {
            console.error('[Hubtel Verify] RPC Error:', updateError.message);
            return NextResponse.json({ success: false, message: 'Failed to update order' }, { status: 500 });
        }

        await runPaidSideEffects(orderJson, 'Hubtel Verify');

        return NextResponse.json({
            success: true,
            status: orderJson?.status || 'processing',
            payment_status: 'paid',
            message: 'Payment verified and order updated',
        });
    } catch (error: any) {
        console.error('[Hubtel Verify] Error:', error?.message || error);
        return NextResponse.json({ success: false, message: 'Internal error' }, { status: 500 });
    }
}

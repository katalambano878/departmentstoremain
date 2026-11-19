import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import {
    checkHubtelStatus,
    isHubtelPaid,
    isHubtelFailure,
    stripHubtelReferenceSuffix,
    type HubtelStatusResult,
} from '@/lib/hubtel';
import {
    expectedChargeAmounts,
    hubtelCustomerPaidAmount,
    hubtelReferenceMatchesOrder,
    paidCoversExpected,
} from '../../_lib/order-charge';
import { runPaidSideEffects } from '../../_lib/after-paid';

/**
 * Hubtel Online Checkout callback handler.
 *
 * Sample payload (Success):
 *  {
 *    "ResponseCode": "0000",
 *    "Status": "Success",
 *    "Data": {
 *      "CheckoutId": "...",
 *      "ClientReference": "<orderRef>-r<base36>",
 *      "Status": "Success",
 *      "Amount": 99.0,
 *      "CustomerPhoneNumber": "...",
 *      "PaymentDetails": { "MobileMoneyNumber": "...", "PaymentType": "mobilemoney", "Channel": "mtn-gh" },
 *      "Description": "..."
 *    }
 *  }
 *
 * Security note: Hubtel doesn't sign callbacks, so every callback (success OR
 * failure) is checked against the RMSC status endpoint with the same
 * clientReference. The order is marked paid only if Hubtel's own API says
 * "Paid" AND the customer-paid amount covers the server-recomputed charge; a
 * failure is recorded only if Hubtel's API says the payment failed, and never
 * over a paid order. A forged callback alone can't change the order.
 */
export async function POST(req: Request) {
    console.log('[Hubtel Callback] POST received at', new Date().toISOString());

    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`hubtel-callback:${clientId}`, RATE_LIMITS.callback);
        if (!rateLimitResult.success) {
            return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
        }

        let body: any = {};
        const contentType = req.headers.get('content-type') || '';
        try {
            if (contentType.includes('application/json')) {
                body = await req.json();
            } else if (contentType.includes('form')) {
                const formData = await req.formData();
                body = Object.fromEntries(formData.entries());
            } else {
                const raw = await req.text();
                try {
                    body = JSON.parse(raw);
                } catch {
                    body = Object.fromEntries(new URLSearchParams(raw).entries());
                }
            }
        } catch {
            return NextResponse.json({ success: false, message: 'Invalid request body' }, { status: 400 });
        }

        const responseCode = body.ResponseCode ?? body.responseCode ?? body.code;
        const topStatus = body.Status ?? body.status;
        const data = body.Data ?? body.data ?? {};

        const rawClientReference = (
            data.ClientReference ??
            data.clientReference ??
            body.ClientReference ??
            body.clientReference ??
            ''
        ).toString();
        const merchantOrderRef = stripHubtelReferenceSuffix(rawClientReference);

        const checkoutId = (data.CheckoutId ?? data.checkoutId ?? body.CheckoutId ?? '').toString();
        const callbackAmount =
            data.Amount !== undefined && data.Amount !== null
                ? parseFloat(String(data.Amount))
                : null;

        console.log(
            '[Hubtel Callback] ref:',
            merchantOrderRef,
            '| ResponseCode:',
            responseCode,
            '| Status:',
            topStatus,
            '| innerStatus:',
            data.Status,
            '| amount:',
            callbackAmount,
            '| checkoutId:',
            checkoutId,
        );

        if (!merchantOrderRef) {
            console.error('[Hubtel Callback] Missing client reference. Body:', JSON.stringify(body).slice(0, 500));
            return NextResponse.json({ success: false, message: 'Missing client reference' }, { status: 400 });
        }

        const innerStatus = String(data.Status ?? topStatus ?? '').toLowerCase();
        const looksSuccessful =
            isHubtelPaid(String(topStatus || ''), responseCode) || isHubtelPaid(innerStatus, responseCode);

        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, order_number, payment_status, total, email, metadata')
            .eq('order_number', merchantOrderRef)
            .maybeSingle();

        if (fetchError || !existingOrder) {
            console.error('[Hubtel Callback] Order not found:', merchantOrderRef);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        // Already paid - idempotent
        if (existingOrder.payment_status === 'paid') {
            return NextResponse.json({ success: true, message: 'Order already processed' });
        }

        // Callbacks are unsigned: whatever the body claims, ask Hubtel.
        const queryRef = rawClientReference || merchantOrderRef;
        let status: HubtelStatusResult | null = null;
        try {
            status = await checkHubtelStatus(queryRef);
        } catch (e: any) {
            console.warn('[Hubtel Callback] Status re-verification failed:', e?.message || e);
        }
        const gatewayStatus = String(status?.data?.status || '');
        console.log(
            '[Hubtel Callback] RMSC status:',
            gatewayStatus,
            '| responseCode:',
            status?.responseCode,
            '| amount:',
            status?.data?.amount,
            '| amountAfterCharges:',
            status?.data?.amountAfterCharges,
        );

        const returnedRef = status?.data?.clientReference;
        if (returnedRef && !hubtelReferenceMatchesOrder(String(returnedRef), existingOrder.order_number, stripHubtelReferenceSuffix)) {
            console.error('[Hubtel Callback] Status API returned another order\'s reference:', returnedRef);
            return NextResponse.json({ success: false, message: 'Reference mismatch' }, { status: 400 });
        }

        if (!status || !isHubtelPaid(gatewayStatus, status?.responseCode)) {
            // Record a failure only when Hubtel itself says the payment failed.
            if (status && isHubtelFailure(gatewayStatus, null)) {
                console.log('[Hubtel Callback] Hubtel confirms failure for', merchantOrderRef);
                await supabaseAdmin
                    .from('orders')
                    .update({
                        payment_status: 'failed',
                        metadata: {
                            ...(existingOrder.metadata || {}),
                            hubtel_checkout_id: checkoutId || (existingOrder.metadata as any)?.hubtel_checkout_id || null,
                            hubtel_response_code: String(responseCode || ''),
                            failure_reason: String(data.Description || body.Message || gatewayStatus || 'Payment failed').slice(0, 300),
                            failure_at: new Date().toISOString(),
                        },
                    })
                    .eq('id', existingOrder.id)
                    .neq('payment_status', 'paid');
                return NextResponse.json({ success: false, message: 'Payment not successful' });
            }
            console.warn('[Hubtel Callback] Hubtel has not confirmed payment for', merchantOrderRef, '(callback said:', innerStatus || topStatus, ')');
            return NextResponse.json(
                { success: false, message: 'Payment not confirmed by gateway' },
                { status: looksSuccessful ? 400 : 200 },
            );
        }

        const paid = hubtelCustomerPaidAmount(status);
        const expected = await expectedChargeAmounts(existingOrder);
        if (!paidCoversExpected(paid, expected)) {
            console.error('[Hubtel Callback] AMOUNT MISMATCH! Expected one of:', expected, 'Paid:', paid);
            return NextResponse.json(
                { success: false, message: 'Payment amount does not match expected charge' },
                { status: 400 },
            );
        }

        const { data: orderJson, error: updateError } = await supabaseAdmin.rpc('mark_order_paid', {
            order_ref: merchantOrderRef,
            moolre_ref: checkoutId || 'hubtel-callback',
        });

        if (updateError) {
            console.error('[Hubtel Callback] RPC error:', updateError.message);
            return NextResponse.json({ success: false, message: 'Database update failed' }, { status: 500 });
        }
        if (!orderJson) {
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        console.log('[Hubtel Callback] Order updated! ID:', orderJson.id, '| Status:', orderJson.status, '| already_paid:', !!orderJson.already_paid);

        await runPaidSideEffects(orderJson, 'Hubtel Callback');

        return NextResponse.json({ success: true, message: 'Payment verified and order updated' });
    } catch (error: any) {
        console.error('[Hubtel Callback] Critical error:', error?.message || error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}

export async function GET() {
    // Return 405 rather than exposing a "ready" probe that helps attackers fingerprint the endpoint.
    return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}

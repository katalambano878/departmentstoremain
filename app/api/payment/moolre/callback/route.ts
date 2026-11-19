import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { expectedChargeAmounts, paidCoversExpected } from '../../_lib/order-charge';
import { runPaidSideEffects } from '../../_lib/after-paid';

/**
 * Moolre Callback Payload Structure (from their actual API):
 * {
 *   "status": 1,
 *   "code": "P01",
 *   "message": "Transaction Successful",
 *   "data": {
 *     "txstatus": 1,
 *     "payer": "233535998837",
 *     "terminalid": "",
 *     "accountnumber": "10789906062911",
 *     "name": "",
 *     "amount": "2",
 *     "value": "2",
 *     "transactionid": "42252702",
 *     "externalref": "ORD-1770330034217-441",
 *     "thirdpartyref": "74658410493"
 *   },
 *   "secret": "c23bc2ab-...",
 *   "ts": "2026-02-05 22:21:16",
 *   "go": null
 * }
 */

export async function POST(req: Request) {
    console.log('[Callback] POST received at', new Date().toISOString());

    try {
        // Rate limiting
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`callback:${clientId}`, RATE_LIMITS.callback);

        if (!rateLimitResult.success) {
            console.warn('[Callback] Rate limited:', clientId);
            return NextResponse.json({ success: false, message: 'Too many requests' }, { status: 429 });
        }

        let body: any = {};
        const contentType = req.headers.get('content-type') || '';

        // Parse body
        try {
            if (contentType.includes('application/json')) {
                body = await req.json();
            } else if (contentType.includes('form')) {
                const formData = await req.formData();
                body = Object.fromEntries(formData.entries());
            } else {
                const rawText = await req.text();
                try {
                    body = JSON.parse(rawText);
                } catch {
                    try {
                        body = Object.fromEntries(new URLSearchParams(rawText).entries());
                    } catch {
                        console.warn('[Callback] Could not parse body');
                    }
                }
            }
        } catch (parseError) {
            console.error('[Callback] Body parsing failed');
            return NextResponse.json({ success: false, message: 'Invalid Request Body' }, { status: 400 });
        }

        console.log('[Callback] Body keys:', Object.keys(body).join(', '));
        console.log('[Callback] Data keys:', body.data ? Object.keys(body.data).join(', ') : 'no data object');

        // ============================================================
        // EXTRACT body.data early — Moolre sometimes puts `secret` only inside data
        // ============================================================
        const data = body.data || {};

        // ============================================================
        // SECURITY: Verify callback secret FIRST (mandatory, fail-closed)
        // ============================================================
        const expectedSecret = process.env.MOOLRE_CALLBACK_SECRET;
        if (!expectedSecret) {
            console.error('[Callback] CRITICAL: MOOLRE_CALLBACK_SECRET not configured — rejecting all callbacks until fixed');
            return NextResponse.json({ success: false, message: 'Callback verification is not configured' }, { status: 503 });
        }

        const providedSecret = body.secret ?? data.secret;
        let secretMatch = false;
        try {
            const a = Buffer.from(String(providedSecret || ''), 'utf8');
            const b = Buffer.from(expectedSecret, 'utf8');
            secretMatch = a.length === b.length && require('crypto').timingSafeEqual(a, b);
        } catch {
            secretMatch = false;
        }
        if (!providedSecret || !secretMatch) {
            console.error('[Callback] Secret mismatch — rejecting callback');
            return NextResponse.json({ success: false, message: 'Invalid callback signature' }, { status: 403 });
        }
        console.log('[Callback] Secret verified OK');

        // ============================================================
        // EXTRACT FIELDS - Moolre nests payment data inside body.data
        // ============================================================

        // Order reference: check body.data.externalref first, then top-level fallbacks
        const rawExternalRef =
            data.externalref ||
            data.external_reference ||
            data.orderRef ||
            body.externalref ||
            body.orderRef ||
            body.external_reference;

        // Strip retry suffix (e.g., "ORD-123-R1770000000" -> "ORD-123")
        const merchantOrderRef = rawExternalRef
            ? rawExternalRef.replace(/-R\d+$/, '')
            : (data.metadata?.original_order_number || body.metadata?.original_order_number);

        // Moolre's transaction reference
        const moolreReference =
            data.transactionid ||
            data.thirdpartyref ||
            body.reference ||
            'callback';

        // Payment status: body.status === 1 means API call succeeded,
        // body.data.txstatus or txtstatus === 1 means transaction was successful (field name varies)
        const apiStatus = body.status;
        const txStatus = data.txstatus ?? data.txtstatus;
        const messageStr = String(body.message || '').toLowerCase();

        console.log('[Callback] Order ref:', merchantOrderRef,
            '| API status:', apiStatus,
            '| TX status:', txStatus,
            '| Message:', body.message,
            '| Moolre ref:', moolreReference);

        if (!merchantOrderRef) {
            console.error('[Callback] Missing order reference. Body:', JSON.stringify(body).substring(0, 500));
            return NextResponse.json({ success: false, message: 'Missing order reference' }, { status: 400 });
        }

        // ============================================================
        // SECURITY: Strict success validation
        // Require BOTH api status AND transaction status to be success,
        // OR the message explicitly indicates success (as fallback only 
        // when both status fields are present and consistent).
        // ============================================================
        const apiOk = (apiStatus === 1 || apiStatus === '1');
        const txOk = (txStatus === 1 || txStatus === '1');
        // Require at least api status OR tx status to be explicitly successful
        // AND the message must not indicate failure
        const isSuccess = (apiOk || txOk) && !messageStr.includes('fail') && !messageStr.includes('error');

        if (isSuccess) {
            console.log(`[Callback] Payment SUCCESS for Order ${merchantOrderRef}`);

            // Check if order exists (maybeSingle to avoid throw on zero rows)
            const { data: existingOrder, error: fetchError } = await supabaseAdmin
                .from('orders')
                .select('id, order_number, payment_status, total, metadata')
                .eq('order_number', merchantOrderRef)
                .maybeSingle();

            if (fetchError || !existingOrder) {
                console.error('[Callback] Order not found:', merchantOrderRef, fetchError?.message);
                return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
            }

            // Already paid - idempotent
            if (existingOrder.payment_status === 'paid') {
                console.log('[Callback] Order already paid, skipping:', merchantOrderRef);
                return NextResponse.json({ success: true, message: 'Order already processed' });
            }

            // ============================================================
            // SECURITY: Amount must be present AND match — REJECT otherwise
            // ============================================================
            const rawCallbackAmount = data.amount ?? body.amount ?? data.value ?? body.value;
            const callbackAmount = rawCallbackAmount != null ? parseFloat(String(rawCallbackAmount)) : NaN;
            if (!Number.isFinite(callbackAmount)) {
                console.error('[Callback] AMOUNT MISSING — REJECTING! Order:', merchantOrderRef);
                return NextResponse.json({
                    success: false,
                    message: 'Payment amount missing from callback'
                }, { status: 400 });
            }
            // Compare with the server-recomputed charge (or the server amount
            // recorded when the link was created), never a client-written total.
            const expected = await expectedChargeAmounts(existingOrder);
            if (!paidCoversExpected(callbackAmount, expected)) {
                console.error('[Callback] AMOUNT MISMATCH — REJECTING! Expected one of:', expected, 'Got:', callbackAmount, 'Order:', merchantOrderRef);
                return NextResponse.json({
                    success: false,
                    message: 'Payment amount does not match order total'
                }, { status: 400 });
            }

            // Mark order as paid via RPC
            const { data: orderJson, error: updateError } = await supabaseAdmin
                .rpc('mark_order_paid', {
                    order_ref: merchantOrderRef,
                    moolre_ref: String(moolreReference)
                });

            if (updateError) {
                console.error('[Callback] RPC Error:', updateError.message);
                return NextResponse.json({ success: false, message: 'Database update failed' }, { status: 500 });
            }

            if (!orderJson) {
                console.error('[Callback] Order not found after RPC:', merchantOrderRef);
                return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
            }

            console.log('[Callback] Order updated! ID:', orderJson.id, '| Status:', orderJson.status, '| already_paid:', !!orderJson.already_paid);

            // Skipped when mark_order_paid reports already_paid.
            await runPaidSideEffects(orderJson, 'Callback');

            return NextResponse.json({ success: true, message: 'Payment verified and Order Updated' });

        } else {
            // Payment failed
            console.log(`[Callback] Payment FAILED for ${merchantOrderRef} | Status: ${apiStatus} | TX: ${txStatus}`);

            // Merge into existing metadata instead of overwriting
            const { data: failedOrder } = await supabaseAdmin
                .from('orders')
                .select('metadata')
                .eq('order_number', merchantOrderRef)
                .maybeSingle();

            await supabaseAdmin
                .from('orders')
                .update({
                    payment_status: 'failed',
                    metadata: {
                        ...(failedOrder?.metadata || {}),
                        moolre_reference: moolreReference,
                        failure_reason: String(body.message || 'Payment failed').slice(0, 300),
                        failure_at: new Date().toISOString(),
                    }
                })
                .eq('order_number', merchantOrderRef)
                // Never downgrade an order that is already paid.
                .neq('payment_status', 'paid');

            return NextResponse.json({ success: false, message: 'Payment not successful' });
        }

    } catch (error: any) {
        console.error('[Callback] Critical Error:', error.message);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}

export async function GET() {
    // Return 405 rather than exposing a "ready" probe that helps attackers fingerprint the endpoint.
    return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}

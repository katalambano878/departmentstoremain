import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { getPublicSiteUrl } from '@/lib/site-url';
import {
    initiateHubtelCheckout,
    makeHubtelClientReference,
    normalizeGhPhone,
} from '@/lib/hubtel';
import { preparePaymentForOrder, safeSiteRedirect } from '../_lib/order-charge';

/**
 * Starts a Hubtel Online Checkout session for an order and returns the URL we
 * should redirect the customer to.
 *
 * Body: { orderId, customerEmail? | phone? | orderUuid?, redirectUrl? }
 * plus optional `Authorization: Bearer` (order owner or staff).
 *
 * Security posture:
 *  - The caller must prove the order is theirs (see callerMayPayOrder).
 *  - Every surviving line is re-priced from the catalogue (affiliate markup +
 *    coupon included) and written back; the charge is that server total.
 *  - Out-of-stock lines are removed before the checkout link is minted.
 *  - redirectUrl is honoured only when it points at this site.
 *  - clientReference is `<orderNumber>-r<base36Timestamp>` (<= 32 chars per
 *    Hubtel's hard limit) so a retry doesn't collide and the callback can
 *    resolve back to the order by stripping the "-r<...>" suffix.
 */
export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`hubtel:${clientId}`, RATE_LIMITS.payment);

        if (!rateLimitResult.success) {
            return NextResponse.json(
                { success: false, message: 'Too many requests. Please try again later.' },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': rateLimitResult.resetIn.toString()
                    }
                }
            );
        }

        let body: any;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ success: false, message: 'Invalid request body' }, { status: 400 });
        }

        if (
            !process.env.HUBTEL_API_ID ||
            !process.env.HUBTEL_API_KEY ||
            !process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER
        ) {
            console.error('[Hubtel] Missing credentials');
            return NextResponse.json({ success: false, message: 'Payment gateway configuration error' }, { status: 500 });
        }

        const prepared = await preparePaymentForOrder(req, body || {}, 'Hubtel');
        if (!prepared.ok) return prepared.response;

        const { order, orderRef, amount, removedItems, metadata } = prepared;
        // Hubtel allows max 2 decimal places.
        const roundedAmount = Math.round(amount * 100) / 100;
        const clientReference = makeHubtelClientReference(orderRef);

        const baseUrl = getPublicSiteUrl();

        // Hubtel validates URLs and only accepts public HTTPS, so we always
        // build absolute return/callback URLs from the canonical site URL.
        const defaultRedirectUrl = `${baseUrl}/order-success?order=${encodeURIComponent(orderRef)}&payment_success=true`;
        const safeRedirectUrl = safeSiteRedirect(body?.redirectUrl, defaultRedirectUrl);
        const cancellationUrl = `${baseUrl}/pay/${encodeURIComponent(orderRef)}?cancelled=true`;

        const shipping = (order.shipping_address as any) || {};
        const customerName =
            [shipping.firstName, shipping.lastName].filter(Boolean).join(' ').trim() ||
            order.email ||
            'Customer';
        const customerPhone = normalizeGhPhone(order.phone || shipping.phone || '');
        const customerMail = order.email || undefined;

        const payload = {
            totalAmount: roundedAmount,
            description: `Order ${orderRef}`,
            callbackUrl: `${baseUrl}/api/payment/hubtel/callback`,
            returnUrl: safeRedirectUrl,
            cancellationUrl,
            merchantAccountNumber: process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER,
            clientReference,
            ...(customerName ? { payeeName: customerName } : {}),
            ...(customerPhone ? { payeeMobileNumber: customerPhone } : {}),
            ...(customerMail ? { payeeEmail: customerMail } : {}),
        };

        console.log('[Hubtel] Initiating for order:', orderRef, '| Server amount:', roundedAmount, '| Callback:', payload.callbackUrl);

        const result = await initiateHubtelCheckout(payload as any);

        const checkoutUrl = result?.data?.checkoutUrl || result?.data?.checkoutDirectUrl;
        const checkoutId = result?.data?.checkoutId;

        if (!checkoutUrl) {
            console.error('[Hubtel] No checkout URL in response:', JSON.stringify(result));
            return NextResponse.json(
                { success: false, message: 'Could not open the payment page. Please try again.' },
                { status: 502 },
            );
        }

        // Store the Hubtel reference on the order so verify/callback can use it.
        const { error: metaError } = await supabaseAdmin
            .from('orders')
            .update({
                metadata: {
                    ...metadata,
                    payment_gateway: 'hubtel',
                    payment_method: 'hubtel',
                    hubtel_client_reference: clientReference,
                    hubtel_checkout_id: checkoutId || null,
                    hubtel_initiated_at: new Date().toISOString(),
                    payment_server_amount: roundedAmount,
                }
            })
            .eq('id', order.id);

        if (metaError) {
            console.error('[Hubtel] Failed to store hubtel_client_reference:', metaError.message);
        } else {
            console.log('[Hubtel] Stored clientReference:', clientReference, 'for order:', orderRef);
        }

        return NextResponse.json({
            success: true,
            url: checkoutUrl,
            checkoutDirectUrl: result?.data?.checkoutDirectUrl || null,
            checkoutId,
            externalRef: clientReference,
            reference: checkoutId || clientReference,
            amount: roundedAmount,
            removedItems
        });

    } catch (error: any) {
        console.error('[Hubtel] Init error:', error?.message || error);
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    }
}

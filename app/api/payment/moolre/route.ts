import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { getPublicSiteUrl } from '@/lib/site-url';
import { preparePaymentForOrder } from '../_lib/order-charge';

/**
 * Legacy Moolre payment link (the storefront uses Hubtel). Same guards as the
 * Hubtel route: ownership proof, stock check, server re-pricing (affiliate
 * markup + coupon) before the link is created.
 *
 * Body: { orderId, customerEmail? | phone? | orderUuid? } (+ optional bearer).
 */
export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rateLimitResult = checkRateLimit(`payment:${clientId}`, RATE_LIMITS.payment);

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

        if (!process.env.MOOLRE_API_USER || !process.env.MOOLRE_API_PUBKEY || !process.env.MOOLRE_ACCOUNT_NUMBER) {
            console.error('Missing Moolre credentials');
            return NextResponse.json({ success: false, message: 'Payment gateway configuration error' }, { status: 500 });
        }

        const prepared = await preparePaymentForOrder(req, body || {}, 'Payment');
        if (!prepared.ok) return prepared.response;

        const { order, orderRef, amount, removedItems, metadata } = prepared;
        const baseUrl = getPublicSiteUrl();

        // Generate a unique external reference for Moolre
        const uniqueRef = `${orderRef}-R${Date.now()}`;

        const payload = {
            type: 1,
            amount: amount.toFixed(2),
            email: process.env.MOOLRE_MERCHANT_EMAIL || 'info@discountdiscoveryzone.com',
            externalref: uniqueRef,
            callback: `${baseUrl}/api/payment/moolre/callback`,
            redirect: `${baseUrl}/order-success?order=${encodeURIComponent(orderRef)}&payment_success=true`,
            reusable: "0",
            currency: "GHS",
            accountnumber: process.env.MOOLRE_ACCOUNT_NUMBER,
            metadata: {
                customer_email: order.email,
                original_order_number: orderRef
            }
        };

        console.log('[Payment] Initiating for order:', orderRef, '| Server amount:', amount, '| Callback:', payload.callback);

        const response = await fetch('https://api.moolre.com/embed/link', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-USER': process.env.MOOLRE_API_USER,
                'X-API-PUBKEY': process.env.MOOLRE_API_PUBKEY
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        console.log('[Payment] Response status:', result.status, '| Has URL:', !!result.data?.authorization_url);

        if (result.status === 1 && result.data?.authorization_url) {
            const { error: metaError } = await supabaseAdmin
                .from('orders')
                .update({
                    metadata: {
                        ...metadata,
                        moolre_externalref: uniqueRef,
                        moolre_reference: result.data.reference || null,
                        payment_server_amount: amount,
                    }
                })
                .eq('id', order.id);

            if (metaError) {
                console.error('[Payment] Failed to store moolre_externalref:', metaError.message);
            } else {
                console.log('[Payment] Stored externalref:', uniqueRef, 'for order:', orderRef);
            }

            return NextResponse.json({
                success: true,
                url: result.data.authorization_url,
                reference: result.data.reference,
                amount,
                removedItems
            });
        }

        console.error('[Payment] Moolre rejected link request:', result?.message);
        return NextResponse.json({ success: false, message: 'Failed to generate payment link' }, { status: 400 });

    } catch (error: any) {
        console.error('Payment API Error:', error?.message || error);
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    }
}

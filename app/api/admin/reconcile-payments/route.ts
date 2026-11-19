import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { checkHubtelStatus, isHubtelPaid, stripHubtelReferenceSuffix } from '@/lib/hubtel';
import {
    expectedChargeAmounts,
    hubtelCustomerPaidAmount,
    hubtelReferenceMatchesOrder,
    paidCoversExpected,
} from '@/app/api/payment/_lib/order-charge';
import { runPaidSideEffects } from '@/app/api/payment/_lib/after-paid';

type ReconcileRow = {
    id: string;
    order_number: string | null;
    total: number | null;
    payment_status: string | null;
    payment_method: string | null;
    created_at: string | null;
    email: string | null;
    metadata: Record<string, any> | null;
};

/**
 * Lists Hubtel orders where a checkout was initiated (metadata.hubtel_client_reference)
 * but payment_status is not "paid". These are candidates for missed callbacks or
 * redirect/verify failures.
 *
 * Legacy Moolre orders (metadata.moolre_externalref) are also surfaced so older
 * stuck orders remain visible after the gateway switch.
 */
export async function GET(request: Request) {
    const auth = await verifyAuth(request, { requireAdmin: true, requireFullStaff: true });
    if (!auth.authenticated) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 150, 1), 500);

    const { data: rows, error } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, total, payment_status, payment_method, created_at, email, metadata')
        .neq('payment_status', 'paid')
        .in('payment_method', ['hubtel', 'moolre'])
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('[reconcile-payments]', error);
        return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
    }

    const orders = (rows || []).filter((row: ReconcileRow) => {
        const hubtelRef = row.metadata?.hubtel_client_reference;
        const moolreRef = row.metadata?.moolre_externalref;
        return (
            (typeof hubtelRef === 'string' && hubtelRef.trim().length > 0) ||
            (typeof moolreRef === 'string' && moolreRef.trim().length > 0)
        );
    });

    return NextResponse.json({
        orders: orders.map((o: ReconcileRow) => ({
            id: o.id,
            order_number: o.order_number,
            total: o.total,
            payment_status: o.payment_status,
            payment_method: o.payment_method,
            created_at: o.created_at,
            email: o.email,
            hubtel_client_reference: o.metadata?.hubtel_client_reference ?? null,
            hubtel_checkout_id: o.metadata?.hubtel_checkout_id ?? null,
            moolre_externalref: o.metadata?.moolre_externalref ?? null,
            moolre_reference: o.metadata?.moolre_reference ?? null,
        })),
        count: orders.length,
        note:
            'Orders where a payment link was created but the order is still not paid. For Hubtel orders, use "Re-verify" to re-query Hubtel and auto-mark paid if the payment succeeded. Legacy Moolre orders must be confirmed in the Moolre dashboard, then marked paid manually.',
    });
}

/**
 * Actively re-reconciles a single Hubtel order by re-querying Hubtel's status
 * endpoint with the stored clientReference. Marks the order paid only if Hubtel
 * confirms "Paid" AND the settlement amount matches the order total.
 */
export async function POST(request: Request) {
    const auth = await verifyAuth(request, { requireAdmin: true, requireFullStaff: true });
    if (!auth.authenticated) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
    }

    let body: any = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const orderId = body?.orderId;
    if (!orderId || typeof orderId !== 'string') {
        return NextResponse.json({ error: 'Missing orderId' }, { status: 400 });
    }

    if (
        !process.env.HUBTEL_API_ID ||
        !process.env.HUBTEL_API_KEY ||
        !process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER
    ) {
        return NextResponse.json({ error: 'Hubtel is not configured' }, { status: 503 });
    }

    const { data: order, error: fetchError } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, payment_status, total, email, metadata')
        .eq('id', orderId)
        .maybeSingle();

    if (fetchError || !order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.payment_status === 'paid') {
        return NextResponse.json({ success: true, payment_status: 'paid', message: 'Order already paid' });
    }

    const clientReference = (order.metadata as any)?.hubtel_client_reference as string | undefined;
    if (!clientReference) {
        return NextResponse.json({ error: 'No Hubtel reference on this order' }, { status: 400 });
    }
    if (!hubtelReferenceMatchesOrder(clientReference, order.order_number, stripHubtelReferenceSuffix)) {
        return NextResponse.json({ error: 'The Hubtel reference on this order belongs to a different order number.' }, { status: 400 });
    }

    let verified = false;
    let paid: number | null = null;
    let settlement: number | null = null;
    try {
        const status = await checkHubtelStatus(clientReference);
        verified = isHubtelPaid(String(status?.data?.status || ''), status?.responseCode);
        const returnedRef = status?.data?.clientReference;
        if (verified && returnedRef && !hubtelReferenceMatchesOrder(String(returnedRef), order.order_number, stripHubtelReferenceSuffix)) {
            return NextResponse.json({
                success: false,
                payment_status: order.payment_status,
                message: `Hubtel returned a different reference (${returnedRef}). Not marking paid.`,
            });
        }
        // Compare what the CUSTOMER paid (TransactionAmount) with the order
        // charge. AmountAfterFees is the merchant settlement, lower by the fee.
        paid = hubtelCustomerPaidAmount(status);
        settlement = status?.data?.amountAfterCharges ?? null;
    } catch (e: any) {
        console.error('[reconcile-payments] Hubtel status failed:', e?.message || e);
        return NextResponse.json({ error: 'Could not reach Hubtel' }, { status: 502 });
    }

    if (!verified) {
        return NextResponse.json({
            success: false,
            payment_status: order.payment_status,
            message: 'Hubtel has not confirmed this payment as Paid yet.',
        });
    }

    const expected = await expectedChargeAmounts(order);
    if (!paidCoversExpected(paid, expected)) {
        return NextResponse.json({
            success: false,
            payment_status: order.payment_status,
            message: `Hubtel reports Paid but the amount doesn't match (customer paid ${paid ?? 'unknown'}${settlement != null ? `, settled ${settlement}` : ''}; expected ${expected.join(' or ') || 'unknown'}). Not marking paid.`,
        });
    }

    const { data: orderJson, error: updateError } = await supabaseAdmin.rpc('mark_order_paid', {
        order_ref: order.order_number,
        moolre_ref: (order.metadata as any)?.hubtel_checkout_id || 'hubtel-reconcile',
    });

    if (updateError) {
        console.error('[reconcile-payments] RPC error:', updateError.message);
        return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
    }

    // Skipped when mark_order_paid reports already_paid.
    await runPaidSideEffects(orderJson, 'reconcile-payments');

    return NextResponse.json({
        success: true,
        payment_status: 'paid',
        message: orderJson?.already_paid
            ? 'Order was already marked paid.'
            : 'Hubtel confirmed payment — order marked paid.',
    });
}

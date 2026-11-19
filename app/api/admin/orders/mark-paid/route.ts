import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';
import { recordAffiliateCommission } from '@/lib/affiliate-server';
import { withAuditActor } from '@/lib/db/pool';
import { isPosSale, posCustomerStatsEmail } from '@/app/api/admin/pos/shared';

/**
 * Staff route to call mark_order_paid (manual "Mark as paid" on an order).
 *
 * - admin / staff may mark any order paid.
 * - staff_pos (till staff) may only mark till sales (metadata.pos_sale) paid.
 * - An existing gateway reference on the order is never overwritten.
 * - When the order was already paid, nothing else runs (no stats, no commission).
 */
export async function POST(request: Request) {
    const clientId = getClientIdentifier(request);
    const rl = checkRateLimit(`admin-mark-paid:${clientId}`, RATE_LIMITS.payment);
    if (!rl.success) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await verifyAuth(request, { requireRole: ['admin', 'staff', 'staff_pos'] });
    if (!auth.authenticated || !auth.user?.id) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json().catch(() => null);
        const { orderNumber, reference } = body ?? {};

        if (!orderNumber || typeof orderNumber !== 'string' || !/^ORD-\d+-\d+$/.test(orderNumber)) {
            return NextResponse.json({ error: 'Invalid order number' }, { status: 400 });
        }

        const { data: existing, error: lookupError } = await supabaseAdmin
            .from('orders')
            .select('id, order_number, email, total, payment_status, metadata')
            .eq('order_number', orderNumber)
            .maybeSingle();
        if (lookupError) {
            console.error('[admin/mark-paid] lookup error:', lookupError.message);
            return NextResponse.json({ error: 'Failed to load the order' }, { status: 500 });
        }
        if (!existing) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        if (auth.role === 'staff_pos' && !isPosSale(existing.metadata)) {
            return NextResponse.json(
                { error: 'Till staff can only mark till sales as paid. Ask a manager for website orders.' },
                { status: 403 }
            );
        }

        if (existing.payment_status === 'paid') {
            return NextResponse.json({ success: true, order: { ...existing, already_paid: true } });
        }

        // Keep a reference the gateway already stored; only fill one in when there is none.
        const storedRef =
            typeof existing.metadata?.moolre_reference === 'string' && existing.metadata.moolre_reference.trim()
                ? existing.metadata.moolre_reference.trim()
                : null;
        const suppliedRef = typeof reference === 'string' && reference.trim() ? reference.trim().slice(0, 120) : null;
        const moolreRef = storedRef || suppliedRef || `admin-${auth.user.id}-${Date.now()}`;

        const order = await withAuditActor(auth.user.id, async () => {
            const { data, error } = await supabaseAdmin.rpc('mark_order_paid', {
                order_ref: orderNumber,
                moolre_ref: moolreRef,
            });
            if (error) throw new Error(error.message);
            const paid = data as any;
            if (!paid) throw new Error('Order not found');

            // Walk-in regulars: count this sale on their customer record.
            if (!paid.already_paid && isPosSale(paid.metadata)) {
                const statsEmail = posCustomerStatsEmail(paid);
                if (statsEmail) {
                    const { error: statsError } = await supabaseAdmin.rpc('update_customer_stats', {
                        p_customer_email: statsEmail,
                        p_order_total: Number(paid.total) || 0,
                    });
                    if (statsError) throw new Error(statsError.message);
                }
            }
            return paid;
        });

        if (!order.already_paid) {
            // Record affiliate commission (best-effort, idempotent — no-op for POS sales).
            await recordAffiliateCommission(orderNumber);
        }

        return NextResponse.json({ success: true, order });
    } catch (err: any) {
        console.error('[admin/mark-paid] Error:', err?.message);
        return NextResponse.json({ error: 'Failed to mark order as paid' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { query, withAuditActor } from '@/lib/db/pool';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';

/**
 * Cancel or refund an order (admin / full staff only, not till staff).
 *
 * Body: { orderId: uuid, action: 'cancel' | 'refund' }
 *
 * In one transaction:
 *  - sets status to 'cancelled' or 'refunded'
 *  - on refund of a paid order, sets payment_status = 'refunded'
 *  - if the order's stock was taken (metadata.stock_reduced), puts it back the
 *    same way mark_order_paid took it (variant by id, else by name, else the
 *    product; then re-sums product quantity from its variants), removes
 *    stock_reduced and sets stock_restored = true so it can never run twice
 *  - records the change in metadata.status_changes (like lib/orderStatusHistory)
 *    and in the order_status_history table
 *
 * Response: { success, order: { id, order_number, status, payment_status },
 *             stockRestored: boolean, alreadyDone?: boolean }
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Bulk actions call this once per order, so allow more than the payment limit.
const REFUND_RATE_LIMIT = { maxRequests: 120, windowSeconds: 60 };

class HttpError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

export async function POST(request: Request) {
    const clientId = getClientIdentifier(request);
    const rl = checkRateLimit(`admin-order-refund:${clientId}`, REFUND_RATE_LIMIT);
    if (!rl.success) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await verifyAuth(request, { requireAdmin: true, requireFullStaff: true });
    if (!auth.authenticated || !auth.user?.id) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const orderId = body?.orderId;
    const action = body?.action;
    if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) {
        return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
    }
    if (action !== 'cancel' && action !== 'refund') {
        return NextResponse.json({ error: "action must be 'cancel' or 'refund'" }, { status: 400 });
    }

    const actorId: string = auth.user.id;
    let actorName = auth.user.email?.split('@')[0] || 'Staff';
    try {
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('full_name')
            .eq('id', actorId)
            .maybeSingle();
        if (profile?.full_name && String(profile.full_name).trim()) {
            actorName = String(profile.full_name).trim();
        }
    } catch {
        /* name is cosmetic */
    }

    const newStatus = action === 'refund' ? 'refunded' : 'cancelled';

    try {
        const result = await withAuditActor(actorId, async () => {
            const { rows } = await query<any>(
                `SELECT id, order_number, status, payment_status, metadata
                   FROM orders WHERE id = $1 FOR UPDATE`,
                [orderId]
            );
            const order = rows[0];
            if (!order) throw new HttpError(404, 'Order not found');

            const wasPaid = order.payment_status === 'paid' || order.payment_status === 'partially_refunded';
            const newPaymentStatus = action === 'refund' && wasPaid ? 'refunded' : order.payment_status;

            if (order.status === newStatus && order.payment_status === newPaymentStatus) {
                return {
                    order: {
                        id: order.id,
                        order_number: order.order_number,
                        status: order.status,
                        payment_status: order.payment_status,
                    },
                    stockRestored: false,
                    alreadyDone: true,
                };
            }
            if (order.status === 'refunded' && action === 'cancel') {
                throw new HttpError(409, 'This order is already refunded');
            }

            const meta = order.metadata && typeof order.metadata === 'object' ? order.metadata : {};
            const stockTaken = meta.stock_reduced != null && meta.stock_reduced !== false && !meta.stock_restored;
            let stockRestored = false;

            if (stockTaken) {
                // 1. Variants by variant_id
                await query(
                    `UPDATE product_variants pv
                        SET quantity = COALESCE(pv.quantity, 0) + oi.qty, updated_at = now()
                       FROM (SELECT variant_id, SUM(quantity)::int AS qty
                               FROM order_items
                              WHERE order_id = $1 AND variant_id IS NOT NULL
                              GROUP BY variant_id) oi
                      WHERE pv.id = oi.variant_id`,
                    [orderId]
                );
                // 2. Variants by name when the item has no variant_id
                await query(
                    `UPDATE product_variants pv
                        SET quantity = COALESCE(pv.quantity, 0) + oi.qty, updated_at = now()
                       FROM (SELECT product_id, variant_name, SUM(quantity)::int AS qty
                               FROM order_items
                              WHERE order_id = $1 AND variant_id IS NULL
                                AND product_id IS NOT NULL AND variant_name IS NOT NULL
                              GROUP BY product_id, variant_name) oi
                      WHERE pv.product_id = oi.product_id AND pv.name = oi.variant_name`,
                    [orderId]
                );
                // 3. Products without variants
                await query(
                    `UPDATE products p
                        SET quantity = COALESCE(p.quantity, 0) + oi.qty, updated_at = now()
                       FROM (SELECT product_id, SUM(quantity)::int AS qty
                               FROM order_items
                              WHERE order_id = $1 AND product_id IS NOT NULL
                              GROUP BY product_id) oi
                      WHERE p.id = oi.product_id
                        AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)`,
                    [orderId]
                );
                // 4. Re-sum products that have variants
                await query(
                    `UPDATE products p
                        SET quantity = s.total, updated_at = now()
                       FROM (SELECT v.product_id, COALESCE(SUM(v.quantity), 0)::int AS total
                               FROM product_variants v
                              WHERE v.product_id IN (SELECT DISTINCT product_id FROM order_items
                                                      WHERE order_id = $1 AND product_id IS NOT NULL)
                              GROUP BY v.product_id) s
                      WHERE p.id = s.product_id`,
                    [orderId]
                );
                stockRestored = true;
            }

            const changeEntry = {
                status: newStatus,
                changed_at: new Date().toISOString(),
                changed_by_name: actorName,
                changed_by_email: auth.user?.email ?? null,
                changed_by_id: actorId,
            };
            const extra: Record<string, unknown> = {};
            if (stockRestored) {
                extra.stock_restored = true;
                extra.stock_restored_at = changeEntry.changed_at;
            }
            if (action === 'refund' && wasPaid) {
                extra.refunded_at = changeEntry.changed_at;
                extra.refunded_by = actorName;
            }

            const { rows: updated } = await query<any>(
                `UPDATE orders
                    SET status = $2::order_status,
                        payment_status = $3::payment_status,
                        metadata = jsonb_set(
                            (COALESCE(metadata, '{}'::jsonb) - (CASE WHEN $6 THEN 'stock_reduced' ELSE '' END)) || $4::jsonb,
                            '{status_changes}',
                            COALESCE(
                              CASE WHEN jsonb_typeof(metadata->'status_changes') = 'array'
                                   THEN metadata->'status_changes' END,
                              '[]'::jsonb
                            ) || jsonb_build_array($5::jsonb)
                        )
                  WHERE id = $1
                  RETURNING id, order_number, status, payment_status`,
                [orderId, newStatus, newPaymentStatus, JSON.stringify(extra), JSON.stringify(changeEntry), stockRestored]
            );

            const note =
                action === 'refund'
                    ? `Refunded by ${actorName}${wasPaid ? ' (payment marked refunded)' : ''}${stockRestored ? '; stock returned' : ''}`
                    : `Cancelled by ${actorName}${stockRestored ? '; stock returned' : ''}`;
            await query(
                `INSERT INTO order_status_history (order_id, status, notes, created_by)
                 VALUES ($1, $2::order_status, $3, $4)`,
                [orderId, newStatus, note, actorId]
            );

            return { order: updated[0], stockRestored, alreadyDone: false };
        });

        return NextResponse.json({ success: true, ...result });
    } catch (err: any) {
        if (err instanceof HttpError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error('[admin/orders/refund] Error:', err?.message);
        return NextResponse.json({ error: 'Could not update the order' }, { status: 500 });
    }
}

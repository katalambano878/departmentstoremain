/**
 * Side effects after mark_order_paid. mark_order_paid is idempotent: when the
 * order was already paid it returns the order JSON with `already_paid: true`,
 * and then the confirmation email/SMS, customer stats and affiliate
 * commission have already run — so they are skipped here.
 */
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendOrderConfirmation, sendPosReceiptSmsByOrderRef, isPosSaleOrder } from '@/lib/notifications';
import { recordAffiliateCommission } from '@/lib/affiliate-server';

/** Returns true when side effects ran (false when already paid / no order). */
export async function runPaidSideEffects(orderJson: any, logTag: string): Promise<boolean> {
    if (!orderJson) return false;
    if (orderJson.already_paid === true) {
        console.log(`[${logTag}] Order already paid, side effects skipped:`, orderJson.order_number);
        return false;
    }

    if (orderJson.email) {
        try {
            await supabaseAdmin.rpc('update_customer_stats', {
                p_customer_email: orderJson.email,
                p_order_total: orderJson.total,
            });
        } catch (e: any) {
            console.error(`[${logTag}] Customer stats failed:`, e?.message || e);
        }
    }

    // Email (and web-order SMS); POS gets the receipt SMS after payment instead.
    try {
        await sendOrderConfirmation(orderJson);
        if (isPosSaleOrder(orderJson.metadata) && orderJson.order_number) {
            const receipt = await sendPosReceiptSmsByOrderRef(orderJson.order_number);
            if (!receipt.ok) console.warn(`[${logTag}] POS receipt SMS:`, receipt.error);
        }
    } catch (e: any) {
        console.error(`[${logTag}] Notification failed:`, e?.message || e);
    }

    // Best-effort and idempotent.
    if (orderJson.order_number || orderJson.id) {
        await recordAffiliateCommission(orderJson.order_number || orderJson.id);
    }
    return true;
}

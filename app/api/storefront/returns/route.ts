import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { escapeHtml, isValidEmail } from '@/lib/sanitize';
import { emailLayout, sendEmail } from '@/lib/notifications';
import { normalizeGhPhone } from '@/lib/hubtel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same default as lib/notifications.ts (ADMIN_EMAIL is not exported there).
const STORE_EMAIL = process.env.ADMIN_EMAIL || 'info@discountdiscoveryzone.com';

const IP_LIMIT = { maxRequests: 10, windowSeconds: 600 };
const ORDER_NUMBER_RE = /^[A-Za-z0-9-]{1,64}$/;

const RETURN_REASONS = [
    'Wrong item received',
    'Item damaged or not working',
    'Wrong size or fit',
    'Not as described',
    'Changed my mind',
    'Other',
] as const;

function error(message: string, status: number) {
    return NextResponse.json({ error: message }, { status });
}

function phonesMatch(stored: string | null | undefined, input: string): boolean {
    const a = normalizeGhPhone(stored);
    const b = normalizeGhPhone(input);
    if (!a || !b || b.length < 9) return false;
    return a.slice(-9) === b.slice(-9);
}

function referenceFor(id: string): string {
    return `RET-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

const NOT_FOUND = 'We could not find a paid order with that order number and contact detail. Check both and try again.';

/**
 * Start a return.
 * Body: { orderNumber, email | phone, reason, description, lookupOnly? }
 * With lookupOnly the order is only verified and its items are returned.
 */
export async function POST(request: Request) {
    const ip = getClientIdentifier(request);
    if (!checkRateLimit(`returns:ip:${ip}`, IP_LIMIT).success) {
        return error('Too many attempts. Please wait a few minutes and try again.', 429);
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return error('Invalid request.', 400);
    }

    const orderNumber = typeof body?.orderNumber === 'string' ? body.orderNumber.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const lookupOnly = body?.lookupOnly === true;

    if (!orderNumber || !ORDER_NUMBER_RE.test(orderNumber)) return error('Please enter your order number.', 400);
    if (!email && !phone) return error('Enter the email or phone number used on the order.', 400);
    if (email && !isValidEmail(email)) return error('Please enter a valid email address.', 400);
    if (!email && phone.replace(/\D/g, '').length < 9) return error('Please enter a valid phone number.', 400);

    const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, user_id, email, phone, payment_status, status, created_at, order_items ( product_name, variant_name, quantity )')
        .eq('order_number', orderNumber)
        .maybeSingle();
    if (orderError) {
        console.error('[returns] order lookup failed:', orderError);
        return error('We could not check your order right now. Please try again.', 500);
    }

    const contactMatches = !!order && (
        email
            ? (order.email || '').trim().toLowerCase() === email
            : phonesMatch(order.phone, phone)
    );
    if (!order || !contactMatches) return error(NOT_FOUND, 404);
    if (order.payment_status !== 'paid') {
        return error('This order has not been paid, so there is nothing to return. If you think this is wrong, contact us.', 409);
    }

    const items = ((order as any).order_items || []).map((item: any) => ({
        name: item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name,
        quantity: item.quantity,
    }));

    if (lookupOnly) {
        return NextResponse.json({
            order: { orderNumber: order.order_number, createdAt: order.created_at, items },
        });
    }

    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 2000) : '';
    if (!(RETURN_REASONS as readonly string[]).includes(reason)) return error('Please choose a reason for the return.', 400);
    if (description.length < 5) return error('Please tell us which item and what happened.', 400);

    // One open request per order: answer with the existing reference instead of a duplicate.
    const { data: existing } = await supabaseAdmin
        .from('return_requests')
        .select('id')
        .eq('order_id', order.id)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();
    if (existing?.id) {
        return NextResponse.json({ reference: referenceFor(existing.id), duplicate: true });
    }

    const { data: saved, error: insertError } = await supabaseAdmin
        .from('return_requests')
        .insert({
            order_id: order.id,
            user_id: order.user_id || null,
            reason,
            description,
            status: 'pending',
        })
        .select('id')
        .single();
    if (insertError || !saved) {
        console.error('[returns] insert failed:', insertError);
        return error('We could not save your request right now. Please try again, or WhatsApp us on 0248615775.', 500);
    }

    const reference = referenceFor(saved.id);
    const contact = email || phone;
    const itemList = items
        .map((item: { name: string; quantity: number }) => `<li>${escapeHtml(item.name)} &times; ${item.quantity}</li>`)
        .join('');

    try {
        await sendEmail({
            to: STORE_EMAIL,
            subject: `Return request ${reference} for order ${order.order_number}`,
            html: emailLayout(`
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;">New return request</h2>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 4px;"><strong>Reference:</strong> ${escapeHtml(reference)}</p>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 4px;"><strong>Order:</strong> ${escapeHtml(order.order_number)}</p>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 4px;"><strong>Customer contact given:</strong> ${escapeHtml(contact)}</p>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>
<div style="background-color:#f9fafb;border-radius:8px;padding:16px 20px;color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(description).replace(/\n/g, '<br>')}</div>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:16px 0 4px;"><strong>Items on the order:</strong></p>
<ul style="color:#374151;font-size:14px;line-height:1.7;margin:0;padding-left:20px;">${itemList}</ul>
<p style="color:#6b7280;font-size:12px;margin:16px 0 0;">We told the customer we will contact them within 2 working days.</p>
`, `Return request ${reference}`),
        });
    } catch (err) {
        console.error('[returns] store alert failed:', err);
    }

    return NextResponse.json({ reference });
}

import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { escapeHtml } from '@/lib/sanitize';
import { getPublicSiteUrl } from '@/lib/site-url';
import { PUBLIC_CONTACT_PHONE } from '@/lib/brand-contact';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'info@discountdiscoveryzone.com';
const ADMIN_PHONE = process.env.ADMIN_PHONE || '';
const ADMIN_PHONES = Array.from(
    new Set(
        ADMIN_PHONE
            .split(/[,\n;]+/)
            .map((p) => p.trim())
            .filter(Boolean)
    )
);
const EMAIL_FROM = process.env.EMAIL_FROM || 'Discount Discovery Zone <noreply@discountdiscoveryzone.com>';
const POSTAL_API_URL = (process.env.POSTAL_API_URL || 'https://postal.zoepayhub.com').replace(/\/+$/, '');
const BRAND = {
    name: 'Discount Discovery Zone',
    color: '#2563eb',
    colorLight: '#eff6ff',
    colorDark: '#064e3b',
    phone: PUBLIC_CONTACT_PHONE,
};

// Reusable branded email layout
export function emailLayout(body: string, preheader?: string): string {
    const siteUrl = getPublicSiteUrl();
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${BRAND.name}</title>
${preheader ? `<span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>` : ''}
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07);">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,${BRAND.color},${BRAND.colorDark});padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">${BRAND.name}</h1>
<p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:12px;letter-spacing:1.5px;text-transform:uppercase;">Premium Quality Products</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:40px 40px 32px;">
${body}
</td></tr>

<!-- Footer -->
<tr><td style="background-color:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="text-align:center;">
<p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Need help? Contact us at <a href="tel:${BRAND.phone}" style="color:${BRAND.color};text-decoration:none;">${BRAND.phone}</a></p>
<p style="margin:0 0 12px;color:#6b7280;font-size:13px;"><a href="${siteUrl}" style="color:${BRAND.color};text-decoration:none;">Visit our store</a> &nbsp;·&nbsp; <a href="${siteUrl}/order-tracking" style="color:${BRAND.color};text-decoration:none;">Track order</a></p>
<p style="margin:0;color:#9ca3af;font-size:11px;">&copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</p>
</td></tr>
</table>
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// Reusable styled button
function emailButton(text: string, href: string, color?: string): string {
    const bg = color || BRAND.color;
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;"><tr>
<td style="background-color:${bg};border-radius:8px;"><a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">${text}</a></td>
</tr></table>`;
}

// Reusable info row
function emailInfoRow(label: string, value: string): string {
    return `<tr>
<td style="padding:10px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #f3f4f6;width:40%;">${label}</td>
<td style="padding:10px 16px;color:#111827;font-size:14px;font-weight:600;border-bottom:1px solid #f3f4f6;">${value}</td>
</tr>`;
}

// Shipping notes block
function emailShippingNotes(notes: string[]): string {
    if (notes.length === 0) return '';
    return `<div style="background-color:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:14px 16px;margin:20px 0;">
<p style="font-weight:600;color:#92400e;margin:0 0 6px;font-size:13px;">&#9200; Shipping Notes</p>
${notes.map(n => `<p style="color:#78350f;margin:3px 0;font-size:13px;">${n}</p>`).join('')}
</div>`;
}

// Helper to mask sensitive data in logs
function maskPhone(phone: string): string {
    if (!phone || phone.length < 6) return '***';
    return phone.slice(0, 4) + '****' + phone.slice(-2);
}

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
    const apiKey = process.env.POSTAL_API_KEY;
    if (!apiKey) {
        console.warn('[Email] POSTAL_API_KEY not configured');
        return null;
    }
    try {
        const response = await fetch(`${POSTAL_API_URL}/api/v1/send/message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Server-API-Key': apiKey,
            },
            body: JSON.stringify({
                to: [to],
                from: EMAIL_FROM,
                subject,
                html_body: html,
            }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.status === 'error') {
            const detail = data?.data?.message || data?.message || response.statusText;
            console.error('[Email] Postal rejected send:', detail);
            return null;
        }
        console.log('[Email] Sent successfully to:', to.split('@')[0] + '@***');
        return data;
    } catch (error: any) {
        console.error('[Email] Failed:', error.message);
        return null;
    }
}

// Helper to format phone number for SMS (Ghana specific for now)
// Helper to format phone number for SMS (Ghana specific for now)
function formatPhoneNumber(phone: string): string {
    // Remove all non-digit characters (including + for now)
    let cleaned = phone.replace(/\D/g, '');

    // If starts with 0 (e.g. 024...), replace 0 with 233
    if (cleaned.startsWith('0')) {
        cleaned = '233' + cleaned.substring(1);
    }

    // If length is 9 (e.g. 24...), prepend 233
    if (cleaned.length === 9) {
        cleaned = '233' + cleaned;
    }

    // Ensure it starts with correct country code before prepending +
    if (!cleaned.startsWith('233') && cleaned.length === 12) {
        // Assuming it's some other format, but if it starts with 233, it's fine.
    }

    // Return with + prefix as per E.164
    return '+' + cleaned;
}

export async function sendSMS({ to, message }: { to: string; message: string }) {
    // Moolre SMS API only requires X-API-VASKEY header for authentication
    // See: https://docs.moolre.com/#/send-sms
    // Allow MOOLRE_SMS_API_KEY or fall back to MOOLRE_API_KEY
    const smsVasKey = process.env.MOOLRE_SMS_API_KEY || process.env.MOOLRE_API_KEY;

    if (!smsVasKey) {
        console.warn('[SMS] Missing MOOLRE_SMS_API_KEY or MOOLRE_API_KEY');
        return null;
    }

    const recipient = formatPhoneNumber(to);

    try {
        console.log(`[SMS] Sending to ${maskPhone(recipient)}`);
        const response = await fetch('https://api.moolre.com/open/sms/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-VASKEY': smsVasKey
            },
            body: JSON.stringify({
                type: 1,
                senderid: process.env.MOOLRE_SMS_SENDER_ID || 'DD Zone',
                messages: [
                    {
                        recipient: recipient,
                        message: message
                    }
                ]
            })
        });

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await response.text();
            console.error('[SMS] Non-JSON response:', text.slice(0, 200));
            return { status: 0, error: text.slice(0, 200) };
        }

        const result = await response.json();
        console.log('[SMS] Result:', result.status === 1 ? 'Success' : 'Failed', '| Code:', result.code);
        if (result.status !== 1) {
            console.log('[SMS] Full Response:', JSON.stringify(result, null, 2));
        }
        return result;
    } catch (error: any) {
        console.error('[SMS] Error:', error.message);
        return null;
    }
}

/** POS orders use a dedicated receipt SMS; avoid doubling with sendOrderConfirmation. */
export function isPosSaleOrder(metadata: any): boolean {
    if (!metadata || typeof metadata !== 'object') return false;
    return metadata.pos_sale === true || metadata.pos_sale === 'true';
}

/**
 * Short paid receipt SMS for in-store (POS) orders. Same rules as /api/notifications pos_receipt_sms.
 */
const UUID_ORDER_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function sendPosReceiptSmsByOrderRef(
    orderRef: string
): Promise<{ ok: boolean; error?: string }> {
    const ref = orderRef.trim();
    const byNumber = !UUID_ORDER_REF.test(ref);

    const orderQuery = supabaseAdmin
        .from('orders')
        .select('id, order_number, created_at, total, phone, shipping_address, metadata');

    const { data: order, error: orderError } = byNumber
        ? await orderQuery.eq('order_number', ref).maybeSingle()
        : await orderQuery.eq('id', ref).maybeSingle();

    if (orderError || !order) {
        console.error('[POS receipt SMS] Order not found:', ref, orderError);
        return { ok: false, error: 'Order not found' };
    }

    const orderAge = Date.now() - new Date(order.created_at).getTime();
    if (orderAge > 30 * 60 * 1000) {
        return { ok: false, error: 'Order too old' };
    }

    const addr = order.shipping_address as Record<string, unknown> | null;
    const phone =
        (order.phone && String(order.phone).trim()) ||
        (addr?.phone && String(addr.phone).trim()) ||
        '';
    if (!phone) {
        return { ok: false, error: 'No phone number' };
    }

    const { data: orderItems } = await supabaseAdmin
        .from('order_items')
        .select('product_name, variant_name, quantity')
        .eq('order_id', order.id)
        .limit(3);

    const itemSummary = (orderItems || [])
        .slice(0, 2)
        .map((item: { product_name: string; variant_name: string | null; quantity: number }) => {
            const label = item.variant_name
                ? `${item.product_name} (${item.variant_name})`
                : item.product_name;
            return `${item.quantity}x ${label}`;
        })
        .join(', ');
    const extraCount = Math.max(0, (orderItems || []).length - 2);
    const itemsText = itemSummary
        ? `${itemSummary}${extraCount > 0 ? ` +${extraCount} more` : ''}`
        : '';

    const meta = order.metadata as Record<string, unknown> | null;
    const customerName =
        (addr?.firstName as string) || (meta?.first_name as string) || 'Customer';
    const smsMessage = `Hi ${customerName}, receipt #${order.order_number || order.id}: GH₵${Number(order.total || 0).toFixed(2)} paid.${itemsText ? ` Items: ${itemsText}.` : ''} Thank you.`;

    const smsResult = await sendSMS({ to: phone, message: smsMessage });
    if (smsResult === null) {
        console.error('[POS receipt SMS] sendSMS returned null (missing MOOLRE_SMS_API_KEY / MOOLRE_API_KEY?)');
        return { ok: false, error: 'SMS is not configured on the server' };
    }
    if (
        typeof smsResult === 'object' &&
        'status' in smsResult &&
        (smsResult as { status: number }).status !== 1
    ) {
        console.error('[POS receipt SMS] Provider error:', JSON.stringify(smsResult));
        return { ok: false, error: 'SMS provider rejected the message' };
    }
    return { ok: true };
}

export async function sendOrderConfirmation(order: any) {
    const { id, email, phone: orderPhone, shipping_address, total, created_at, order_number, metadata } = order;

    const baseUrl = getPublicSiteUrl();

    // Build customer name from available sources
    const getName = () => {
        // Try shipping_address first
        if (shipping_address?.full_name) return shipping_address.full_name;
        if (shipping_address?.firstName) {
            return shipping_address.lastName
                ? `${shipping_address.firstName} ${shipping_address.lastName}`
                : shipping_address.firstName;
        }
        // Fall back to metadata
        if (metadata?.first_name) {
            return metadata.last_name
                ? `${metadata.first_name} ${metadata.last_name}`
                : metadata.first_name;
        }
        return 'Customer';
    };
    const name = getName();

    // Prefer top-level phone, then shipping address phone
    const phone = orderPhone || shipping_address?.phone;

    // Get tracking number from metadata
    const trackingNumber = metadata?.tracking_number || '';
    const trackingUrl = `${baseUrl}/order-tracking?order=${order_number || id}`;

    console.log(`[Notification] Preparing for Order #${order_number} | Phone: ${phone ? 'Present' : 'Missing'} | Tracking: ${trackingNumber || 'None'}`);

    // Fetch order items to get preorder_shipping info
    let shippingNotes: string[] = [];
    try {
        const { data: items } = await supabase
            .from('order_items')
            .select('product_name, metadata')
            .eq('order_id', id);
        if (items) {
            for (const item of items) {
                const preorder = item.metadata?.preorder_shipping;
                if (preorder) {
                    shippingNotes.push(`${item.product_name}: ${preorder}`);
                }
            }
        }
    } catch (err) {
        console.warn('[Notification] Could not fetch order items for shipping notes');
    }

    const shippingNotesSms = shippingNotes.length > 0
        ? ` Note: ${shippingNotes.join('; ')}.`
        : '';

    // 1. Email to Customer
    const customerEmailHtml = emailLayout(`
<div style="text-align:center;margin-bottom:24px;">
  <div style="width:64px;height:64px;background-color:${BRAND.colorLight};border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">&#10003;</div>
  <h2 style="margin:0 0 4px;color:#111827;font-size:24px;">Order Confirmed!</h2>
  <p style="margin:0;color:#6b7280;font-size:15px;">Thank you for your purchase, ${name}.</p>
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:12px;overflow:hidden;margin:20px 0;">
  ${emailInfoRow('Order Number', `#${order_number || id}`)}
  ${emailInfoRow('Order Date', new Date(created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}
  ${trackingNumber ? emailInfoRow('Tracking', trackingNumber) : ''}
  ${emailInfoRow('Total', `GH₵${Number(total).toFixed(2)}`)}
</table>

${emailShippingNotes(shippingNotes)}

<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0;">We're getting your order ready. You'll receive updates as it's processed, packaged, and picked up by the rider.</p>

${emailButton('Track Your Order', trackingUrl)}

<p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">Or copy this link: <a href="${trackingUrl}" style="color:${BRAND.color};">${trackingUrl}</a></p>
`, `Your order #${order_number || id} is confirmed!`);

    await sendEmail({
        to: email,
        subject: `Order Confirmed! #${order_number || id}`,
        html: customerEmailHtml
    });

    // 2. Email to Admin
    const adminEmailHtml = emailLayout(`
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;">&#128230; New Order Received</h2>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:12px;overflow:hidden;margin:16px 0;">
  ${emailInfoRow('Order', `#${order_number || id}`)}
  ${emailInfoRow('Customer', `${name}`)}
  ${emailInfoRow('Email', email)}
  ${emailInfoRow('Total', `GH₵${Number(total).toFixed(2)}`)}
  ${trackingNumber ? emailInfoRow('Tracking', trackingNumber) : ''}
</table>

${emailShippingNotes(shippingNotes)}

${emailButton('View Order in Admin', `${baseUrl}/admin/orders/${id}`)}
`, `New order #${order_number} from ${name}`);

    await sendEmail({
        to: ADMIN_EMAIL,
        subject: `New Order #${order_number || id}`,
        html: adminEmailHtml
    });

    // 3. SMS to Customer (POS uses sendPosReceiptSmsByOrderRef after payment — skip duplicate)
    if (phone && !isPosSaleOrder(metadata)) {
        const smsMessage = trackingNumber
            ? `Hi ${name}, your order #${order_number || id} is confirmed! Tracking: ${trackingNumber}. Track here: ${trackingUrl}${shippingNotesSms}`
            : `Hi ${name}, your order #${order_number || id} at Discount Discovery Zone is confirmed! Track here: ${trackingUrl}${shippingNotesSms}`;

        await sendSMS({
            to: phone,
            message: smsMessage
        });
    }

    // 4. SMS to Admin (supports multiple numbers via ADMIN_PHONE comma/semicolon/newline separated)
    if (ADMIN_PHONES.length > 0) {
        const adminSms = `New order #${order_number || id} from ${name} — GH₵${Number(total).toFixed(2)}. View: ${baseUrl}/admin/orders/${id}`;
        await Promise.all(
            ADMIN_PHONES.map((to) =>
                sendSMS({
                    to,
                    message: adminSms
                })
            )
        );
    }
}

export async function sendOrderStatusUpdate(order: any, newStatus: string) {
    const { id, email, phone: orderPhone, shipping_address, order_number, metadata } = order;

    const baseUrl = getPublicSiteUrl();

    // Build customer name from available sources
    const getName = () => {
        if (shipping_address?.full_name) return shipping_address.full_name;
        if (shipping_address?.firstName) {
            return shipping_address.lastName
                ? `${shipping_address.firstName} ${shipping_address.lastName}`
                : shipping_address.firstName;
        }
        if (metadata?.first_name) {
            return metadata.last_name
                ? `${metadata.first_name} ${metadata.last_name}`
                : metadata.first_name;
        }
        return 'Customer';
    };
    const name = getName();
    const phone = orderPhone || shipping_address?.phone;
    const trackingNumber = metadata?.tracking_number || '';
    const trackingUrl = `${baseUrl}/order-tracking?order=${order_number || id}`;

    console.log(`[Notification] Status update for Order #${order_number} to ${newStatus} | Tracking: ${trackingNumber}`);

    const subject = `Order Update #${order_number || id}`;
    const statusLabel = newStatus.replace(/_/g, ' ');
    let message = `Your order #${order_number || id} status has been updated to ${statusLabel}.`;
    let smsMessage = message;

    if (newStatus === 'shipped') {
        message = `Good news! Your order #${order_number || id} has been packaged and is ready.`;
        smsMessage = trackingNumber
            ? `Good news ${name}! Order #${order_number || id} has been packaged. Tracking: ${trackingNumber}. Track: ${trackingUrl}`
            : `Good news ${name}! Order #${order_number || id} has been packaged. Track: ${trackingUrl}`;
    } else if (newStatus === 'picked_up') {
        message = `Update: Package has been picked up by the rider for order #${order_number || id}.`;
        smsMessage = trackingNumber
            ? `Update ${name}: package for order #${order_number || id} has been picked up by the rider. Tracking: ${trackingNumber}. Track: ${trackingUrl}`
            : `Update ${name}: package for order #${order_number || id} has been picked up by the rider. Track: ${trackingUrl}`;
    } else if (newStatus === 'delivered') {
        message = `Your order #${order_number || id} has been delivered. Enjoy!`;
        smsMessage = `Hi ${name}, your order #${order_number || id} has been delivered. Enjoy your purchase!`;
    } else if (newStatus === 'completed') {
        message = `Your order #${order_number || id} has been completed. Thank you for shopping with us!`;
        smsMessage = `Hi ${name}, your order #${order_number || id} has been completed. Thank you for shopping with us!`;
    } else if (newStatus === 'processing') {
        smsMessage = trackingNumber
            ? `Hi ${name}, your order #${order_number || id} is being processed. Tracking: ${trackingNumber}. Track: ${trackingUrl}`
            : `Hi ${name}, your order #${order_number || id} is being processed. Track: ${trackingUrl}`;
    } else {
        smsMessage = `Hi ${name}, order #${order_number || id} status: ${newStatus}. Track: ${trackingUrl}`;
    }

    // Status icons/colors
    const statusConfig: Record<string, { icon: string; color: string; bg: string }> = {
        processing: { icon: '&#9881;', color: '#2563eb', bg: '#eff6ff' },
        shipped: { icon: '&#128666;', color: '#2563eb', bg: '#eff6ff' },
        picked_up: { icon: '&#128757;', color: '#4338ca', bg: '#eef2ff' },
        completed: { icon: '&#9989;', color: '#047857', bg: '#ecfdf5' },
        delivered: { icon: '&#127881;', color: '#16a34a', bg: '#f0fdf4' },
        cancelled: { icon: '&#10060;', color: '#dc2626', bg: '#fef2f2' },
    };
    const sc = statusConfig[newStatus] || { icon: '&#128276;', color: '#6b7280', bg: '#f9fafb' };

    await sendEmail({
        to: email,
        subject: subject,
        html: emailLayout(`
<div style="text-align:center;margin-bottom:24px;">
  <div style="width:64px;height:64px;background-color:${sc.bg};border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">${sc.icon}</div>
  <h2 style="margin:0 0 4px;color:#111827;font-size:22px;">Order Update</h2>
  <p style="margin:0;color:#6b7280;font-size:14px;">Hi ${name}, here's an update on your order.</p>
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:12px;overflow:hidden;margin:20px 0;">
  ${emailInfoRow('Order Number', `#${order_number || id}`)}
  ${emailInfoRow('New Status', `<span style="display:inline-block;background-color:${sc.bg};color:${sc.color};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;text-transform:uppercase;">${statusLabel}</span>`)}
  ${trackingNumber ? emailInfoRow('Tracking Number', trackingNumber) : ''}
</table>

<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0;">${message}</p>

${emailButton('Track Your Order', trackingUrl)}
`, `Your order #${order_number} is now ${statusLabel}`)
    });

    // SMS
    if (phone) {
        await sendSMS({
            to: phone,
            message: smsMessage
        });
    }
}

export async function sendWelcomeMessage(user: { email: string, firstName: string, phone?: string }) {
    const { email, firstName, phone } = user;

    // Email
    await sendEmail({
        to: email,
        subject: `Welcome to ${BRAND.name}!`,
        html: emailLayout(`
<div style="text-align:center;margin-bottom:24px;">
  <div style="width:64px;height:64px;background-color:${BRAND.colorLight};border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">&#128075;</div>
  <h2 style="margin:0 0 4px;color:#111827;font-size:24px;">Welcome, ${firstName}!</h2>
  <p style="margin:0;color:#6b7280;font-size:15px;">We're so glad you're here.</p>
</div>

<p style="color:#374151;font-size:14px;line-height:1.7;margin:16px 0;">Thank you for joining the ${BRAND.name} family. We source premium quality products directly from China at unbeatable prices &mdash; perfect for homes, businesses, and resellers.</p>

<div style="background-color:#f9fafb;border-radius:12px;padding:20px;margin:20px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="text-align:center;padding:8px;width:33%;">
        <p style="font-size:20px;margin:0 0 4px;">&#128666;</p>
        <p style="color:#374151;font-size:12px;font-weight:600;margin:0;">Free Pickup</p>
        <p style="color:#9ca3af;font-size:11px;margin:2px 0 0;">Available in store</p>
      </td>
      <td style="text-align:center;padding:8px;width:33%;">
        <p style="font-size:20px;margin:0 0 4px;">&#9989;</p>
        <p style="color:#374151;font-size:12px;font-weight:600;margin:0;">Verified Quality</p>
        <p style="color:#9ca3af;font-size:11px;margin:2px 0 0;">Hand-inspected</p>
      </td>
      <td style="text-align:center;padding:8px;width:33%;">
        <p style="font-size:20px;margin:0 0 4px;">&#128176;</p>
        <p style="color:#374151;font-size:12px;font-weight:600;margin:0;">Best Prices</p>
        <p style="color:#9ca3af;font-size:11px;margin:2px 0 0;">Unbeatable value</p>
      </td>
    </tr>
  </table>
</div>

${emailButton('Start Shopping', `${getPublicSiteUrl()}/shop`)}
`, `Welcome to ${BRAND.name}, ${firstName}!`)
    });

    // SMS
    if (phone) {
        await sendSMS({
            to: phone,
            message: `Welcome ${firstName}! Thanks for joining Discount Discovery Zone.`
        });
    }
}

export async function sendPaymentLink(order: any) {
    const { id, email, phone: orderPhone, shipping_address, total, order_number, metadata } = order;

    const baseUrl = getPublicSiteUrl();
    const paymentUrl = `${baseUrl}/pay/${id}`;

    // Build customer name from available sources
    const getName = () => {
        if (shipping_address?.full_name) return shipping_address.full_name;
        if (shipping_address?.firstName) {
            return shipping_address.lastName
                ? `${shipping_address.firstName} ${shipping_address.lastName}`
                : shipping_address.firstName;
        }
        if (metadata?.first_name) {
            return metadata.last_name
                ? `${metadata.first_name} ${metadata.last_name}`
                : metadata.first_name;
        }
        return 'Customer';
    };
    const name = getName();
    const phone = orderPhone || shipping_address?.phone;

    console.log(`[Notification] Sending payment link for Order #${order_number} | Phone: ${phone ? 'Present' : 'Missing'}`);

    // Email with payment link
    await sendEmail({
        to: email,
        subject: `Complete Your Order #${order_number}`,
        html: emailLayout(`
<div style="text-align:center;margin-bottom:24px;">
  <div style="width:64px;height:64px;background-color:#fef3c7;border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">&#128179;</div>
  <h2 style="margin:0 0 4px;color:#111827;font-size:22px;">Complete Your Order</h2>
  <p style="margin:0;color:#6b7280;font-size:14px;">Hi ${name}, your order is waiting for payment.</p>
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:12px;overflow:hidden;margin:20px 0;">
  ${emailInfoRow('Order Number', `#${order_number}`)}
  ${emailInfoRow('Amount Due', `<span style="color:${BRAND.color};font-size:18px;font-weight:700;">GH₵${Number(total).toFixed(2)}</span>`)}
</table>

<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0;">Click the button below to securely complete your payment. This link will remain active until your order is completed or cancelled.</p>

${emailButton('Pay Now — GH₵' + Number(total).toFixed(2), paymentUrl, '#d97706')}

<p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">Or copy this link: <a href="${paymentUrl}" style="color:${BRAND.color};">${paymentUrl}</a></p>
`, `Complete payment for order #${order_number}`)
    });

    // SMS with payment link
    if (phone) {
        const smsMessage = `Hi ${name}, complete your order #${order_number} (GH₵${Number(total).toFixed(2)}) here: ${paymentUrl}`;

        await sendSMS({
            to: phone,
            message: smsMessage
        });
    }
}

export async function sendContactMessage(data: { name: string, email: string, subject: string, message: string }) {
    const { name, email, subject, message } = data;

    // SECURITY: Sanitize all user input before injecting into HTML
    const safeName = escapeHtml(name);
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message);
    const safeEmail = escapeHtml(email);

    // 1. Acknowledge to User
    await sendEmail({
        to: email,
        subject: `We received your message: ${subject}`,
        html: emailLayout(`
<div style="text-align:center;margin-bottom:24px;">
  <div style="width:64px;height:64px;background-color:${BRAND.colorLight};border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">&#128172;</div>
  <h2 style="margin:0 0 4px;color:#111827;font-size:22px;">Message Received</h2>
  <p style="margin:0;color:#6b7280;font-size:14px;">We'll get back to you soon.</p>
</div>

<p style="color:#374151;font-size:14px;line-height:1.7;margin:16px 0;">Hi ${safeName},</p>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;">Thank you for reaching out to ${BRAND.name}. We've received your message regarding <strong>"${safeSubject}"</strong> and our team will respond as soon as possible.</p>

<div style="background-color:#f9fafb;border-left:4px solid ${BRAND.color};border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0;">
  <p style="color:#6b7280;font-size:12px;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px;">Your message</p>
  <p style="color:#374151;font-size:14px;margin:0;line-height:1.6;">${safeMessage}</p>
</div>

<p style="color:#6b7280;font-size:13px;margin:16px 0 0;">We typically respond within 24 hours.</p>
`, `Thanks for contacting us, ${safeName}`)
    });

    // 2. Alert Admin
    await sendEmail({
        to: ADMIN_EMAIL,
        subject: `Contact: ${subject}`,
        html: emailLayout(`
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;">&#128233; New Contact Message</h2>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:12px;overflow:hidden;margin:16px 0;">
  ${emailInfoRow('From', safeName)}
  ${emailInfoRow('Email', `<a href="mailto:${safeEmail}" style="color:${BRAND.color};">${safeEmail}</a>`)}
  ${emailInfoRow('Subject', safeSubject)}
</table>

<div style="background-color:#f9fafb;border-left:4px solid ${BRAND.color};border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0;">
  <p style="color:#6b7280;font-size:12px;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
  <p style="color:#374151;font-size:14px;margin:0;line-height:1.6;">${safeMessage}</p>
</div>

${emailButton('Reply to ' + safeName, `mailto:${safeEmail}?subject=Re: ${encodeURIComponent(subject)}`)}
`, `New contact from ${safeName}: ${safeSubject}`)
    });
}

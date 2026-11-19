import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import { escapeHtml } from '@/lib/sanitize';
import { sendOrderConfirmation, sendOrderStatusUpdate, sendWelcomeMessage, sendContactMessage, sendPaymentLink, sendEmail, sendSMS, emailLayout, sendPosReceiptSmsByOrderRef } from '@/lib/notifications';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_CONTACT_COLUMNS =
    'id, order_number, email, phone, shipping_address, metadata, total, created_at, status, payment_status';

/** Walk-in POS sales store made-up addresses; never send mail to them. */
function isPlaceholderEmail(email: unknown): boolean {
    if (typeof email !== 'string') return true;
    const e = email.trim().toLowerCase();
    return !e || !e.includes('@') || e.endsWith('@pos.local') || e.endsWith('@store.local');
}

/** Blank a placeholder address so the send helpers skip email for this order. */
function withRealEmailOnly<T extends { email?: string | null }>(order: T): T {
    return isPlaceholderEmail(order.email) ? { ...order, email: '' } : order;
}

/** Load an order by its id (or order number) using only server-side contact fields. */
async function loadOrderForNotification(ref: unknown) {
    const value = typeof ref === 'string' ? ref.trim() : '';
    if (!value) return null;
    let query = supabaseAdmin.from('orders').select(ORDER_CONTACT_COLUMNS);
    if (UUID_RE.test(value)) {
        query = query.eq('id', value);
    } else if (/^[A-Za-z0-9\-]{1,64}$/.test(value)) {
        query = query.eq('order_number', value);
    } else {
        return null;
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return data as any;
}

/** sendSMS returns null on failure and a provider result with status 1 on success. */
function smsSucceeded(result: any): boolean {
    return !!result && Number(result.status) === 1;
}

export async function POST(request: Request) {
    try {
        // Rate limiting
        const clientId = getClientIdentifier(request);
        const rateLimitResult = checkRateLimit(`notification:${clientId}`, RATE_LIMITS.notification);

        if (!rateLimitResult.success) {
            return NextResponse.json(
                { error: 'Too many requests. Please try again later.' },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': rateLimitResult.resetIn.toString()
                    }
                }
            );
        }

        const body = await request.json();
        const { type, payload } = body;

        if (!type || !payload) {
            return NextResponse.json({ error: 'Type and payload required' }, { status: 400 });
        }

        // ============================================================
        // SECURITY: Authentication requirements
        // Admin-only types require admin auth token
        // 'order_created' requires a valid order to exist (verified below)
        // 'contact' is public but rate-limited
        // ============================================================
        // campaign = marketing HTML — admin + full staff only
        const fullStaffOnlyTypes = ['campaign'];
        // Order workflows — POS / orders staff need these
        const adminPanelTypes = ['order_updated', 'order_status', 'payment_link', 'pos_receipt_sms'];
        const requiresFullStaffAuth = fullStaffOnlyTypes.includes(type);
        const requiresAdminPanelAuth =
            requiresFullStaffAuth || adminPanelTypes.includes(type);

        if (requiresAdminPanelAuth) {
            const auth = await verifyAuth(request, {
                requireRole: requiresFullStaffAuth ? ['admin', 'staff'] : ['admin', 'staff', 'staff_pos'],
            });
            if (!auth.authenticated) {
                return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.role ? 403 : 401 });
            }
        }

        // ============================================================
        // order_created — verify the order exists in the database
        // ============================================================
        if (type === 'order_created') {
            // Verify the order actually exists before sending confirmation
            if (!payload.order_number && !payload.id) {
                return NextResponse.json({ error: 'Missing order identifier' }, { status: 400 });
            }

            const rawOrderRef = String(payload.order_number || payload.id).trim();

            // SECURITY: Validate orderRef format before using in query to prevent injection
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawOrderRef);
            const isOrderNumber = /^[A-Za-z0-9\-]{1,64}$/.test(rawOrderRef);
            if (!isUUID && !isOrderNumber) {
                return NextResponse.json({ error: 'Invalid order identifier format' }, { status: 400 });
            }

            // SECURITY: Fetch full order from DB — NEVER use client-supplied contact details.
            // Using DB data prevents email spoofing / SMS redirection.
            let orderQuery = supabaseAdmin
                .from('orders')
                .select(ORDER_CONTACT_COLUMNS);

            if (isUUID) {
                orderQuery = orderQuery.or(`order_number.eq.${rawOrderRef},id.eq.${rawOrderRef}`);
            } else {
                orderQuery = orderQuery.eq('order_number', rawOrderRef);
            }

            const { data: order, error: orderError } = await orderQuery.single();

            if (orderError || !order) {
                return NextResponse.json({ error: 'Order not found' }, { status: 404 });
            }

            // Verify the order was created recently (within last 10 minutes)
            const orderAge = Date.now() - new Date(order.created_at).getTime();
            if (orderAge > 10 * 60 * 1000) {
                return NextResponse.json({ error: 'Order confirmation can only be sent for recent orders' }, { status: 400 });
            }

            // SECURITY: Send using only DB order data — ignore any client-provided payload fields
            await sendOrderConfirmation(withRealEmailOnly(order));
            return NextResponse.json({ success: true, message: 'Order confirmation sent' });
        }

        if (type === 'order_updated') {
            const { order, status } = payload;
            if (!order || !status) {
                return NextResponse.json({ error: 'Missing order or status' }, { status: 400 });
            }
            // SECURITY: use only the stored contact details and the stored status —
            // never the phone/email/status the browser sent.
            const fullOrder = await loadOrderForNotification(order.id || order.order_number);
            if (!fullOrder) {
                return NextResponse.json({ error: 'Order not found' }, { status: 404 });
            }
            await sendOrderStatusUpdate(withRealEmailOnly(fullOrder), String(fullOrder.status || status));
            return NextResponse.json({ success: true, message: 'Status update sent' });
        }

        // Handle order_status from admin panel
        if (type === 'order_status') {
            const { email, name, orderNumber, status, trackingNumber, phone } = payload;

            if (!orderNumber || !status) {
                return NextResponse.json({ error: 'Missing orderNumber or status' }, { status: 400 });
            }

            // SECURITY: Fetch order from DB — never fall back to client-supplied contact
        // details. A rogue staff account could otherwise redirect status notifications
        // to attacker-controlled email/phone addresses.
            const { data: fullOrder, error: orderLookupError } = await supabaseAdmin
                .from('orders')
                .select('id, order_number, email, phone, shipping_address, metadata')
                .eq('order_number', orderNumber)
                .single();

            if (orderLookupError || !fullOrder) {
                return NextResponse.json({ error: 'Order not found' }, { status: 404 });
            }

            await sendOrderStatusUpdate(withRealEmailOnly(fullOrder), status);
            return NextResponse.json({ success: true, message: 'Status update sent' });
        }

        if (type === 'welcome') {
            const welcomeRl = checkRateLimit(`welcome:${clientId}`, RATE_LIMITS.welcome);
            if (!welcomeRl.success) {
                return NextResponse.json(
                    { error: 'Too many welcome requests. Please try again later.' },
                    {
                        status: 429,
                        headers: {
                            'X-RateLimit-Remaining': '0',
                            'X-RateLimit-Reset': welcomeRl.resetIn.toString(),
                        },
                    }
                );
            }

            if (!payload.email || typeof payload.firstName !== 'string') {
                return NextResponse.json({ error: 'Missing email or firstName' }, { status: 400 });
            }

            const emailRaw = String(payload.email).trim();
            const firstName = String(payload.firstName).trim();
            if (!emailRaw || !firstName || firstName.length > 80) {
                return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
            }

            const { data: profile, error: profileError } = await supabaseAdmin
                .from('profiles')
                .select('created_at')
                .ilike('email', emailRaw)
                .maybeSingle();

            if (profileError || !profile?.created_at) {
                return NextResponse.json({ error: 'Invalid signup request' }, { status: 400 });
            }

            const profileAge = Date.now() - new Date(profile.created_at).getTime();
            if (profileAge > 15 * 60 * 1000) {
                return NextResponse.json(
                    { error: 'Welcome can only be sent for recent signups' },
                    { status: 400 }
                );
            }

            await sendWelcomeMessage({
                email: emailRaw,
                firstName,
                phone: typeof payload.phone === 'string' ? payload.phone.trim() : undefined,
            });
            return NextResponse.json({ success: true, message: 'Welcome message sent' });
        }

        // ============================================================
        // contact — public but strictly validated and rate-limited
        // ============================================================
        if (type === 'contact') {
            const { name, email, subject, message } = payload;
            if (!name || !email || !subject || !message) {
                return NextResponse.json({ error: 'All contact fields required' }, { status: 400 });
            }
            // Basic email format check
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
            }
            // Length limits to prevent abuse
            if (name.length > 100 || subject.length > 200 || message.length > 5000) {
                return NextResponse.json({ error: 'Input too long' }, { status: 400 });
            }
            await sendContactMessage(payload);
            return NextResponse.json({ success: true, message: 'Contact message sent' });
        }

        if (type === 'payment_link') {
            if (!payload.id && !payload.order_number) {
                return NextResponse.json({ error: 'Missing order details' }, { status: 400 });
            }
            // SECURITY: look the order up — the link, amount and contact details
            // all come from the database, not the request body.
            const fullOrder = await loadOrderForNotification(payload.id || payload.order_number);
            if (!fullOrder) {
                return NextResponse.json({ error: 'Order not found' }, { status: 404 });
            }
            if (fullOrder.payment_status === 'paid') {
                return NextResponse.json({ error: 'This order is already paid' }, { status: 400 });
            }
            await sendPaymentLink(withRealEmailOnly(fullOrder));
            return NextResponse.json({ success: true, message: 'Payment link sent' });
        }

        // POS receipt SMS (order must exist, recent, with phone).
        // Admin-auth gate applied above via adminPanelTypes.
        if (type === 'pos_receipt_sms') {
            if (!payload.order_number && !payload.id) {
                return NextResponse.json({ error: 'Missing order identifier' }, { status: 400 });
            }

            const orderRef = String(payload.order_number || payload.id);
            const ORDER_NUMBER_RE = /^ORD-\d+-\d+$/;
            if (!UUID_RE.test(orderRef) && !ORDER_NUMBER_RE.test(orderRef)) {
                return NextResponse.json({ error: 'Invalid order reference' }, { status: 400 });
            }

            const result = await sendPosReceiptSmsByOrderRef(orderRef);
            if (!result.ok) {
                if (result.error === 'Order not found') {
                    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
                }
                if (result.error === 'Order too old') {
                    return NextResponse.json(
                        { error: 'Receipt SMS can only be sent for recent orders' },
                        { status: 400 }
                    );
                }
                if (result.error === 'No phone number') {
                    return NextResponse.json(
                        { error: 'No phone number found for this order' },
                        { status: 400 }
                    );
                }
                return NextResponse.json({ error: result.error || 'Failed to send SMS' }, { status: 400 });
            }

            return NextResponse.json({ success: true, message: 'POS receipt SMS sent' });
        }

        // ============================================================
        // campaign — admin only, with HTML sanitization
        // ============================================================
        if (type === 'campaign') {
            const { recipients, subject, message, channels } = payload;

            if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
                return NextResponse.json({ error: 'Recipients required' }, { status: 400 });
            }
            if (!channels?.email && !channels?.sms) {
                return NextResponse.json({ error: 'Select at least one channel (Email or SMS)' }, { status: 400 });
            }
            if (!message || typeof message !== 'string' || !message.trim()) {
                return NextResponse.json({ error: 'Message is required' }, { status: 400 });
            }
            // Subject is only used for email — only enforce it when email is enabled.
            if (channels?.email && (!subject || typeof subject !== 'string' || !subject.trim())) {
                return NextResponse.json({ error: 'Email subject is required when sending email' }, { status: 400 });
            }

            if (recipients.length > 100) {
                return NextResponse.json({ error: 'Send at most 100 recipients per request' }, { status: 400 });
            }

            // Deduplicate phone numbers and emails server-side
            const seenPhones = new Set<string>();
            const seenEmails = new Set<string>();
            const sent = { email: 0, sms: 0 };
            const failed = { email: 0, sms: 0 };
            let skippedPlaceholder = 0;

            // SECURITY: Sanitize subject and message to prevent XSS in emails
            const safeSubject = escapeHtml(subject || '');
            const safeMessage = escapeHtml(message);

            for (const recipient of recipients) {
                if (!recipient || typeof recipient !== 'object') continue;
                const recipientEmail = typeof recipient.email === 'string' ? recipient.email.trim() : '';
                const recipientPhone = typeof recipient.phone === 'string' ? recipient.phone.trim() : '';

                // Send email (skip duplicates and POS placeholder addresses)
                if (channels?.email && recipientEmail) {
                    const emailKey = recipientEmail.toLowerCase();
                    if (isPlaceholderEmail(emailKey)) {
                        skippedPlaceholder++;
                    } else if (!seenEmails.has(emailKey)) {
                        seenEmails.add(emailKey);
                        try {
                            const recipientName = escapeHtml(String(recipient.name || 'Valued Customer'));
                            const brandedHtml = emailLayout(`
<h2 style="margin:0 0 16px;color:#111827;font-size:22px;text-align:center;">${safeSubject}</h2>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:16px 0;">Hi ${recipientName},</p>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;">${safeMessage.replace(/\n/g, '</p><p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;">')}</p>
`, safeSubject);
                            // The send helpers return null on failure instead of throwing.
                            const result = await sendEmail({
                                to: recipientEmail,
                                subject: subject, // Keep original for email subject header
                                html: brandedHtml
                            });
                            if (result) sent.email++;
                            else failed.email++;
                        } catch (err: any) {
                            console.error('[Campaign] Email failed:', err?.message);
                            failed.email++;
                        }
                    }
                }

                // Send SMS (skip duplicates)
                if (channels?.sms && recipientPhone) {
                    const phoneKey = recipientPhone.replace(/[\s\-\(\)\.]+/g, '');
                    if (!seenPhones.has(phoneKey)) {
                        seenPhones.add(phoneKey);
                        try {
                            const result = await sendSMS({
                                to: recipientPhone,
                                message: message // SMS is plain text, no XSS risk
                            });
                            if (smsSucceeded(result)) sent.sms++;
                            else failed.sms++;
                        } catch (err: any) {
                            console.error('[Campaign] SMS failed:', err?.message);
                            failed.sms++;
                        }
                    }
                }
            }

            const failedTotal = failed.email + failed.sms;
            return NextResponse.json({
                success: true,
                sent,
                failed,
                skippedPlaceholder,
                message: `Campaign batch: ${sent.email} emails and ${sent.sms} SMS sent.${failedTotal > 0 ? ` ${failedTotal} failed.` : ''}`
            });
        }

        return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 });

    } catch (error: any) {
        console.error('Notification API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

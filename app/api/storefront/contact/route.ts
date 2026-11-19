import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { escapeHtml, isValidEmail } from '@/lib/sanitize';
import { emailLayout, sendEmail } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same default as lib/notifications.ts (ADMIN_EMAIL is not exported there).
const STORE_EMAIL = process.env.ADMIN_EMAIL || 'info@discountdiscoveryzone.com';

const IP_LIMIT = { maxRequests: 5, windowSeconds: 900 };
const EMAIL_LIMIT = { maxRequests: 3, windowSeconds: 3600 };

function error(message: string, status: number) {
    return NextResponse.json({ error: message }, { status });
}

function clean(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Contact form. Saves the message, alerts the store, and sends the visitor a
 * fixed acknowledgement that never repeats what they typed (the address is
 * not verified, so echoing their text would let anyone send our mail to anyone).
 */
export async function POST(request: Request) {
    const ip = getClientIdentifier(request);
    if (!checkRateLimit(`contact:ip:${ip}`, IP_LIMIT).success) {
        return error('Too many messages. Please wait a few minutes and try again.', 429);
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return error('Invalid request.', 400);
    }

    const name = clean(body?.name, 120);
    const email = clean(body?.email, 254).toLowerCase();
    const phone = clean(body?.phone, 30);
    const subject = clean(body?.subject, 150);
    const message = clean(body?.message, 5000);

    if (!name) return error('Please enter your name.', 400);
    if (!email || !isValidEmail(email)) return error('Please enter a valid email address.', 400);
    if (phone && phone.replace(/\D/g, '').length < 9) return error('Please enter a valid phone number or leave it empty.', 400);
    if (!subject) return error('Please choose a subject.', 400);
    if (message.length < 10) return error('Please write a message of at least 10 characters.', 400);

    if (!checkRateLimit(`contact:email:${email}`, EMAIL_LIMIT).success) {
        return error('You have sent several messages already. We will reply soon.', 429);
    }

    const { data: saved, error: insertError } = await supabaseAdmin
        .from('contact_submissions')
        .insert({ name, email, phone: phone || null, subject, message, status: 'new' })
        .select('id')
        .single();
    if (insertError) {
        console.error('[contact] insert failed:', insertError);
        return error('We could not send your message right now. Please try again, or WhatsApp us on 0248615775.', 500);
    }

    const safe = {
        name: escapeHtml(name),
        email: escapeHtml(email),
        phone: escapeHtml(phone || 'Not given'),
        subject: escapeHtml(subject),
        message: escapeHtml(message).replace(/\n/g, '<br>'),
    };

    try {
        await sendEmail({
            to: STORE_EMAIL,
            subject: `Contact form: ${subject.replace(/[\r\n]+/g, ' ')}`,
            html: emailLayout(`
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;">New contact message</h2>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 4px;"><strong>From:</strong> ${safe.name}</p>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 4px;"><strong>Email:</strong> ${safe.email}</p>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 4px;"><strong>Phone:</strong> ${safe.phone}</p>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;"><strong>Subject:</strong> ${safe.subject}</p>
<div style="background-color:#f9fafb;border-radius:8px;padding:16px 20px;color:#374151;font-size:14px;line-height:1.6;">${safe.message}</div>
<p style="color:#6b7280;font-size:12px;margin:16px 0 0;">The sender's email address has not been verified.</p>
`, `New contact message from ${safe.name}`),
        });
    } catch (err) {
        console.error('[contact] store alert failed:', err);
    }

    try {
        await sendEmail({
            to: email,
            subject: 'We received your message',
            html: emailLayout(`
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;">Thank you for contacting Discount Discovery Zone. We received your message and will reply by email, usually within one working day.</p>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0;">For anything urgent, call or WhatsApp us on 0248615775.</p>
<p style="color:#6b7280;font-size:12px;line-height:1.6;margin:16px 0 0;">If you did not send us a message, you can ignore this email.</p>
`, 'We received your message'),
        });
    } catch (err) {
        console.error('[contact] acknowledgement failed:', err);
    }

    return NextResponse.json({ ok: true, reference: saved?.id ?? null });
}

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { isValidEmail } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const IP_LIMIT = { maxRequests: 5, windowSeconds: 600 };
const EMAIL_LIMIT = { maxRequests: 3, windowSeconds: 3600 };
const SOURCE_RE = /^[a-z0-9_-]{1,40}$/;

function error(message: string, status: number) {
    return NextResponse.json({ error: message }, { status });
}

/** Subscribe an email to store news. Re-subscribes an address that had unsubscribed. */
export async function POST(request: Request) {
    const ip = getClientIdentifier(request);
    if (!checkRateLimit(`newsletter:ip:${ip}`, IP_LIMIT).success) {
        return error('Too many attempts. Please try again in a few minutes.', 429);
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return error('Invalid request.', 400);
    }

    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const rawSource = typeof body?.source === 'string' ? body.source.trim().toLowerCase() : '';
    const source = SOURCE_RE.test(rawSource) ? rawSource : 'website';

    if (!email || email.length > 254 || !isValidEmail(email)) {
        return error('Please enter a valid email address.', 400);
    }
    if (!checkRateLimit(`newsletter:email:${email}`, EMAIL_LIMIT).success) {
        return error('Too many attempts for this email. Please try again later.', 429);
    }

    try {
        const { data: existing, error: findError } = await supabaseAdmin
            .from('newsletter_subscribers')
            .select('id, unsubscribed_at')
            .eq('email', email)
            .maybeSingle();
        if (findError) throw findError;

        if (existing) {
            if (existing.unsubscribed_at) {
                const { error: updateError } = await supabaseAdmin
                    .from('newsletter_subscribers')
                    .update({ unsubscribed_at: null, source })
                    .eq('id', existing.id);
                if (updateError) throw updateError;
            }
            return NextResponse.json({ ok: true });
        }

        const { error: insertError } = await supabaseAdmin
            .from('newsletter_subscribers')
            .insert({ email, source });
        // 23505: someone subscribed the same address (any case) at the same moment.
        if (insertError && (insertError as any).code !== '23505') throw insertError;

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[newsletter] subscribe failed:', err);
        return error('We could not save your email right now. Please try again.', 500);
    }
}

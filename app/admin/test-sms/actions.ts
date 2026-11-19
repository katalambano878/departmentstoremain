'use server';

import { cookies } from 'next/headers';
import { verifyAdminToken } from '@/lib/auth';
import { sendSMS } from '@/lib/notifications';
import { checkRateLimit } from '@/lib/rate-limit';

/** Test sends per staff member: enough to debug, not enough to spam. */
const TEST_SMS_LIMIT = { maxRequests: 5, windowSeconds: 10 * 60 };

function maskPhone(phone: string) {
    return phone.length < 6 ? '***' : `${phone.slice(0, 4)}****${phone.slice(-2)}`;
}

export async function testSmsAction(phone: string, message: string, authToken: string) {
    // SECURITY: verify the caller is admin or full staff (not till-only staff).
    // Use the token the page passes; fall back to the admin session cookie.
    let token = typeof authToken === 'string' ? authToken.trim() : '';
    if (!token) {
        try {
            const jar = await cookies();
            token = jar.get('sb-access-token')?.value || '';
        } catch {
            token = '';
        }
    }
    const auth = await verifyAdminToken(token, { requireRole: ['admin', 'staff'] });
    if (!auth.authenticated || !auth.user?.id) {
        return {
            success: false,
            error: 'Unauthorized: ' + (auth.error || 'Admin access required')
        };
    }

    // Validate input before spending a rate-limit slot.
    if (!phone || typeof phone !== 'string' || phone.replace(/\D/g, '').length < 9 || phone.length > 20) {
        return { success: false, error: 'Enter a valid phone number' };
    }
    if (!message || typeof message !== 'string' || !message.trim() || message.length > 480) {
        return { success: false, error: 'Message is empty or too long (480 characters max)' };
    }

    const rl = checkRateLimit(`test-sms:${auth.user.id}`, TEST_SMS_LIMIT);
    if (!rl.success) {
        return {
            success: false,
            error: `Too many test messages. Try again in ${Math.ceil(rl.resetIn / 60)} minute(s).`
        };
    }

    try {
        console.log('[Test SMS] to', maskPhone(phone), '| by user:', auth.user.id);
        // Same send path as receipts and campaigns (Taysend, then Moolre fallback).
        const result: any = await sendSMS({ to: phone, message: message.trim() });
        const ok = !!result && Number(result.status) === 1;
        return {
            success: ok,
            provider: result?.provider || (result ? 'moolre' : null),
            result: result ?? { error: 'No provider accepted the message. Check the SMS settings and logs.' },
            remainingThisWindow: rl.remaining,
        };
    } catch (error: any) {
        console.error('[Test SMS] Error:', error?.message);
        return {
            success: false,
            error: 'SMS sending failed'
        };
    }
}

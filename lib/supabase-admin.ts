import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from './db/supabase-compat';
import { verifyAccessToken } from './db/auth';

/**
 * Server-side service-role client: runs as the database owner on plain
 * Postgres and bypasses row-level security.
 * ONLY use this in API routes and server actions — NEVER in client components.
 * Always verify the caller is authorized first.
 */

function bearerFrom(headers: Headers): string | null {
    const value = headers.get('authorization') || '';
    return value.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

/**
 * The signed-in staff member behind the current request (bearer token or the
 * admin session cookie), so service-role writes are attributed to them in the
 * activity log. Only tokens this store signed count.
 */
async function currentRequestActorId(): Promise<string | null> {
    try {
        const { headers } = await import('next/headers');
        const incoming = await headers();
        const candidates: string[] = [];
        const bearer = bearerFrom(incoming);
        if (bearer) candidates.push(bearer);
        for (const part of (incoming.get('cookie') || '').split(';')) {
            const [name, ...rest] = part.split('=');
            if (name.trim() === 'sb-access-token') candidates.push(decodeURIComponent(rest.join('=').trim()));
        }
        for (const token of candidates) {
            const verified = await verifyAccessToken(token);
            if (verified) return verified.userId;
        }
    } catch {
        // Outside a request scope (scripts, background jobs): no actor.
    }
    return null;
}

// Typed as supabase-js so call sites keep their inferred row types; the
// compat client implements the part of that API this app uses.
export const supabaseAdmin = createClient({ auditActor: currentRequestActorId }) as unknown as SupabaseClient;

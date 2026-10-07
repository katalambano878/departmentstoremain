import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client with service role key.
 * ONLY use this in API routes and server actions — NEVER in client components.
 * This bypasses RLS, so always verify the caller is authorized first.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
}

if (!supabaseServiceKey) {
    console.error('CRITICAL: Missing SUPABASE_SERVICE_ROLE_KEY — admin operations will fail');
}

// Access tokens that GoTrue has confirmed (via auth.getUser) mapped to their user id.
// Only these are trusted to attribute service-role writes in the activity log.
const VERIFIED_TOKEN_LIMIT = 500;
const verifiedTokens = new Map<string, string>();

function rememberVerifiedToken(token: string, userId: string) {
    if (verifiedTokens.size >= VERIFIED_TOKEN_LIMIT) {
        const oldest = verifiedTokens.keys().next().value;
        if (oldest) verifiedTokens.delete(oldest);
    }
    verifiedTokens.set(token, userId);
}

function bearerFrom(headers: Headers): string | null {
    const value = headers.get('authorization') || '';
    return value.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

async function currentRequestActorId(): Promise<string | null> {
    try {
        const { headers } = await import('next/headers');
        const incoming = await headers();
        const candidates: string[] = [];
        const bearer = bearerFrom(incoming);
        if (bearer) candidates.push(bearer);
        for (const part of (incoming.get('cookie') || '').split(';')) {
            const value = part.split('=').slice(1).join('=').trim();
            if (value) candidates.push(decodeURIComponent(value));
        }
        for (const token of candidates) {
            const id = verifiedTokens.get(token);
            if (id) return id;
        }
    } catch {
        // Outside a request scope (scripts, background jobs): no actor.
    }
    return null;
}

const auditingFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const requestHeaders = new Headers(init?.headers);

    if (url.includes('/auth/v1/user') && (!init?.method || init.method === 'GET')) {
        const response = await fetch(input, init);
        const token = bearerFrom(requestHeaders);
        if (response.ok && token && token !== supabaseServiceKey) {
            try {
                const user = await response.clone().json();
                if (user?.id) rememberVerifiedToken(token, user.id);
            } catch {
                // Non-JSON body: nothing to remember.
            }
        }
        return response;
    }

    if (url.includes('/rest/v1/')) {
        const actorId = await currentRequestActorId();
        if (actorId) {
            requestHeaders.set('x-audit-actor', actorId);
            return fetch(input, { ...init, headers: requestHeaders });
        }
    }

    return fetch(input, init);
};

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || '', {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
    global: { fetch: auditingFetch },
});

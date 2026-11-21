import { createClient, processLock } from '@supabase/supabase-js';
import { recordAuthStep } from '@/lib/client-diagnostics';

// The store serves the Supabase REST, auth and storage APIs from its own
// origin (app/rest, app/auth/v1, app/storage), backed by plain Postgres.
// In the browser that is always the current origin, so the same build works
// on the staging host and on the live domain.
const supabaseUrl =
    typeof window !== 'undefined'
        ? window.location.origin
        : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
// supabase-js requires a key; the self-hosted API does not use it.
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'public-anon-key';

/** Longest wait for the server to start answering an ordinary request. */
const REQUEST_TIMEOUT_MS = 20_000;
/** A photo upload sends its whole file before the server answers. */
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * fetch that gives up when the server has not started answering in time.
 *
 * On a phone a dropped connection leaves a request waiting forever, and the
 * sign-in library makes every later request wait behind one that hangs: the
 * Add Product page sat on "Loading categories..." with no error. Giving up
 * turns the hang into an error, which the page reports or tries again. The
 * limit covers only the wait for the first answer, so a large list that is
 * already arriving is never cut off.
 */
function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    if (typeof AbortController === 'undefined') return fetch(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET') || 'GET').toUpperCase();
    const isUpload = /\/storage\/v1\/object\//.test(url) && method !== 'GET' && method !== 'HEAD';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), isUpload ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    // Keep honouring a caller's own cancel signal.
    const outer = init.signal;
    if (outer) {
        if (outer.aborted) controller.abort();
        else outer.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { fetch: fetchWithTimeout },
    auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        // Sessions signed by hosted Supabase are not valid here; a new key
        // means browsers simply start signed out instead of holding a dead one.
        storageKey: 'ddz-auth-token',
        // One sign-in lock per tab, not one shared by every tab of the site.
        // Phones freeze tabs in the background; a frozen tab holding the
        // shared lock made every request in the tab in use wait. This site's
        // sign-in renewals are independent signed tokens, so two tabs renewing
        // at the same moment is harmless.
        lock: processLock,
        // Keep a short log of the sign-in library's steps, so a page stuck on
        // a phone can report where it stopped (lib/client-diagnostics.ts).
        debug: typeof window !== 'undefined' ? recordAuthStep : false,
    },
});

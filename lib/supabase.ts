import { createClient } from '@supabase/supabase-js';

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

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        // Sessions signed by hosted Supabase are not valid here; a new key
        // means browsers simply start signed out instead of holding a dead one.
        storageKey: 'ddz-auth-token',
    },
});

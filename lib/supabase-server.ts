import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from './db/supabase-compat';

/**
 * Server-side client with the public (anon) role: row-level security applies,
 * so it sees exactly what a signed-out shopper sees. Use in server components
 * and public API routes instead of the browser client.
 */
// Typed as supabase-js so call sites keep their inferred row types; the
// compat client implements the part of that API this app uses.
export const supabaseAnon = createClient({ role: 'anon' }) as unknown as SupabaseClient;

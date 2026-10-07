import { supabase } from '@/lib/supabase';

/**
 * Record an admin action that does not change a database row (exports, prints…).
 * Row changes are logged automatically by database triggers.
 */
export async function logActivity(action: string, summary: string, details?: Record<string, unknown>) {
  const { error } = await supabase.rpc('log_activity', {
    p_action: action,
    p_summary: summary,
    p_details: details ?? null,
  });
  if (error) console.warn('[activity-log] failed to record', action, error.message);
}

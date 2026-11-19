import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAuth } from '@/lib/auth';
import {
  DEFAULT_STAFF_ROLE,
  STAFF_ROLES,
  isStaffRole,
  roleLabel,
  type StaffRole,
} from '@/lib/admin-staff-shared';

export {
  DEFAULT_STAFF_ROLE,
  STAFF_ROLES,
  isStaffRole,
  roleLabel,
  type StaffRole,
};

/** Extract Bearer token, including cookie fallbacks used elsewhere in admin APIs. */
export function getAccessToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();

  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/\bsb-access-token=([^;]+)/);
  if (match) return decodeURIComponent(match[1].trim());

  const authCookie = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('sb-') && (c.includes('-auth-token') || c.includes('auth')));
  if (!authCookie) return null;

  const value = authCookie.split('=').slice(1).join('=').trim();
  const decoded = decodeURIComponent(value);
  try {
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed) && parsed[0]) return parsed[0];
    if (parsed?.access_token) return parsed.access_token;
    if (typeof parsed === 'string') return parsed;
  } catch {
    return decoded;
  }
  return null;
}

type StaffGateRole = 'admin' | 'staff' | 'staff_pos';

async function gateByRole(request: Request, roles: StaffGateRole | StaffGateRole[], forbiddenMessage?: string) {
  const token = getAccessToken(request);
  if (!token) {
    return {
      error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
      auth: null as null,
      token: null as null,
    };
  }

  const auth = await verifyAuth(
    new Request(request.url, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    { requireRole: roles }
  );

  if (!auth.authenticated) {
    // A role was read but is not allowed: signed in, just not permitted.
    const forbidden = Boolean(auth.role) || String(auth.error || '').toLowerCase().includes('admin');
    return {
      error: NextResponse.json(
        { error: forbidden ? forbiddenMessage || auth.error || 'Forbidden' : auth.error || 'Not authenticated' },
        { status: forbidden ? 403 : 401 }
      ),
      auth: null as null,
      token: null as null,
    };
  }

  return { error: null, auth, token };
}

/** Full staff (admin/staff) only — POS-only users cannot see staff accounts. */
export async function requireFullStaff(request: Request) {
  return gateByRole(request, ['admin', 'staff']);
}

export async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const needle = email.trim().toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === needle);
    if (hit) return hit.id;
    if (users.length < 200) break;
  }
  return null;
}

/** Admin only — every staff account write (create, edit, role, password, remove). */
export async function requireAdminOnly(request: Request) {
  return gateByRole(request, 'admin', 'Only an admin can change staff accounts.');
}

export type StaffLogAction =
  | 'staff.create'
  | 'staff.promote'
  | 'staff.update'
  | 'staff.role_change'
  | 'staff.password_reset'
  | 'staff.remove'
  | 'staff.restore_access';

/**
 * Server-side twin of `logActivity` (lib/activity-log.ts, browser only): writes the
 * same kind of row to audit_logs, attributed to the signed-in admin. Never put a
 * password in `details`. Runs on the current transaction when inside withAuditActor.
 */
export async function logStaffActivity(
  actor: { id: string; email?: string | null; role?: string | null },
  action: StaffLogAction,
  summary: string,
  target: { id: string; email?: string | null },
  details?: Record<string, unknown>
) {
  const { error } = await supabaseAdmin.from('audit_logs').insert({
    user_id: actor.id,
    actor_email: actor.email ?? null,
    actor_role: actor.role ?? null,
    action,
    entity_type: 'staff',
    entity_id: target.id,
    table_name: 'profiles',
    record_id: target.id,
    summary: summary.slice(0, 300),
    changes: { target_email: target.email ?? null, ...(details ?? {}) },
  });
  if (error) throw new Error(`Could not record the activity log: ${error.message}`);
}

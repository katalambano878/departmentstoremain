import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getExecutor, withAuditActor } from '@/lib/db/pool';
import { isStaffRole, logStaffActivity, requireAdminOnly, roleLabel, type StaffRole } from '@/lib/admin-staff';

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_ROLE_LIST = ['admin', 'staff', 'staff_pos'];

class StaffError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function fail(e: any, fallback: string) {
  if (e instanceof StaffError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error('[admin/staff]', fallback, e?.message);
  return NextResponse.json({ error: e?.message || fallback }, { status: 500 });
}

/** Lock admin-count checks so two demotions cannot both pass the last-admin guard. */
async function lockAdminCount() {
  await getExecutor().query("SELECT pg_advisory_xact_lock(hashtext('ddz-staff-admin-count'))");
}

async function countAdmins() {
  const { count, error } = await supabaseAdmin
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'admin');
  if (error) throw new Error(error.message);
  return count || 0;
}

async function loadStaff(id: string) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, phone, role')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !STAFF_ROLE_LIST.includes(String(data.role))) {
    throw new StaffError('Staff member not found', 404);
  }
  return data as { id: string; email: string | null; full_name: string | null; phone: string | null; role: StaffRole };
}

async function gateAndId(request: Request, context: RouteContext) {
  const gate = await requireAdminOnly(request);
  if (gate.error) return { error: gate.error };
  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) {
    return { error: NextResponse.json({ error: 'Missing staff id' }, { status: 400 }) };
  }
  const user = gate.auth!.user;
  return {
    error: null,
    id,
    actor: { id: user.id as string, email: (user.email as string) || null, role: 'admin' },
  };
}

/** Edit name, phone or role. Admin only; nobody can change their own role. */
export async function PATCH(request: Request, context: RouteContext) {
  const g = await gateAndId(request, context);
  if (g.error) return g.error;
  const { id, actor } = g as { id: string; actor: { id: string; email: string | null; role: string } };

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const updated = await withAuditActor(actor.id, async () => {
      const existing = await loadStaff(id);
      const updates: Record<string, any> = {};

      if (body.full_name !== undefined) {
        const name = String(body.full_name || '').trim().slice(0, 120);
        if (!name) throw new StaffError('Name cannot be empty');
        if (name !== existing.full_name) updates.full_name = name;
      }

      if (body.phone !== undefined) {
        const phone = String(body.phone || '').trim().slice(0, 30) || null;
        if (phone !== existing.phone) updates.phone = phone;
      }

      let roleChange: { from: string; to: StaffRole } | null = null;
      if (body.role !== undefined) {
        const nextRole = String(body.role || '').trim();
        if (!isStaffRole(nextRole)) throw new StaffError('Role must be admin, staff, or staff_pos');
        if (nextRole !== existing.role) {
          if (id === actor.id) throw new StaffError('You cannot change your own role');
          if (existing.role === 'admin') {
            await lockAdminCount();
            if ((await countAdmins()) <= 1) throw new StaffError('Cannot demote the last admin account');
          }
          updates.role = nextRole;
          roleChange = { from: existing.role, to: nextRole };
        }
      }

      if (Object.keys(updates).length === 0) throw new StaffError('No changes provided');

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update(updates)
        .eq('id', id)
        .select('id, email, full_name, phone, role, created_at, updated_at')
        .single();
      if (error) throw new Error(error.message);

      if (roleChange) {
        await logStaffActivity(
          actor,
          'staff.role_change',
          `Changed ${existing.email || existing.full_name || id} from ${roleLabel(roleChange.from)} to ${roleLabel(roleChange.to)}`,
          { id, email: existing.email },
          { from_role: roleChange.from, to_role: roleChange.to }
        );
      }
      if (updates.full_name !== undefined || updates.phone !== undefined) {
        await logStaffActivity(
          actor,
          'staff.update',
          `Edited staff details for ${existing.email || id}`,
          { id, email: existing.email },
          { fields: Object.keys(updates).filter((k) => k !== 'role') }
        );
      }
      return data;
    });

    if (body.full_name !== undefined && updated?.full_name) {
      await supabaseAdmin.auth.admin
        .updateUserById(id, { user_metadata: { full_name: updated.full_name } })
        .catch(() => undefined);
    }

    return NextResponse.json({ staff: updated });
  } catch (e: any) {
    return fail(e, 'Could not update staff member');
  }
}

/** Reset a staff password. Admin only. Body: { password: string } */
export async function PUT(request: Request, context: RouteContext) {
  const g = await gateAndId(request, context);
  if (g.error) return g.error;
  const { id, actor } = g as { id: string; actor: { id: string; email: string | null; role: string } };

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const password = String(body.password || '');
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }

  try {
    await withAuditActor(actor.id, async () => {
      const existing = await loadStaff(id);
      const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password });
      if (error) throw new Error(error.message);
      await logStaffActivity(
        actor,
        'staff.password_reset',
        `Reset the password for ${existing.email || id}`,
        { id, email: existing.email },
        { role: existing.role }
      );
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return fail(e, 'Could not reset the password');
  }
}

/**
 * Remove staff access: demote profile to customer and ban the Auth user
 * so they can no longer sign in to /admin. Keeps the account for order history.
 * Admin only; nobody can remove themselves; the last admin stays.
 */
export async function DELETE(request: Request, context: RouteContext) {
  const g = await gateAndId(request, context);
  if (g.error) return g.error;
  const { id, actor } = g as { id: string; actor: { id: string; email: string | null; role: string } };

  if (id === actor.id) {
    return NextResponse.json({ error: 'You cannot remove your own account' }, { status: 400 });
  }

  try {
    await withAuditActor(actor.id, async () => {
      const existing = await loadStaff(id);
      if (existing.role === 'admin') {
        await lockAdminCount();
        if ((await countAdmins()) <= 1) throw new StaffError('Cannot remove the last admin account');
      }

      const { error: profErr } = await supabaseAdmin.from('profiles').update({ role: 'customer' }).eq('id', id);
      if (profErr) throw new Error(profErr.message);

      await logStaffActivity(
        actor,
        'staff.remove',
        `Removed ${roleLabel(existing.role)} ${existing.email || id} from staff`,
        { id, email: existing.email },
        { from_role: existing.role }
      );

      // Ban for ~100 years so /admin login fails; account retained for history.
      // A failure throws and rolls the role change back.
      const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
      if (banErr) throw new Error(banErr.message);
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return fail(e, 'Could not remove staff member');
  }
}

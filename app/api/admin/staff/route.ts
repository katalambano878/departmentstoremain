import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { withAuditActor } from '@/lib/db/pool';
import {
  DEFAULT_STAFF_ROLE,
  findAuthUserIdByEmail,
  isStaffRole,
  logStaffActivity,
  requireAdminOnly,
  requireFullStaff,
  roleLabel,
  type StaffRole,
} from '@/lib/admin-staff';

export async function GET(request: Request) {
  const gate = await requireFullStaff(request);
  if (gate.error) return gate.error;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, phone, role, created_at, updated_at')
    .in('role', ['admin', 'staff', 'staff_pos'])
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const staff = data || [];

  // Attach last sign-in when available (best-effort; never fail the list).
  const enriched = await Promise.all(
    staff.map(async (row) => {
      try {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(row.id);
        return {
          ...row,
          last_sign_in_at: authUser?.user?.last_sign_in_at || null,
          banned: Boolean((authUser?.user as any)?.banned_until),
        };
      } catch {
        return { ...row, last_sign_in_at: null, banned: false };
      }
    })
  );

  const counts = {
    total: enriched.length,
    admin: enriched.filter((s) => s.role === 'admin').length,
    staff: enriched.filter((s) => s.role === 'staff').length,
    staff_pos: enriched.filter((s) => s.role === 'staff_pos').length,
  };

  return NextResponse.json({
    staff: enriched,
    counts,
    viewerId: gate.auth!.user.id,
    viewerRole: gate.auth!.role,
  });
}

export async function POST(request: Request) {
  // Only an admin may add staff (any role).
  const gate = await requireAdminOnly(request);
  if (gate.error) return gate.error;
  const actorUser = gate.auth!.user;
  const actor = { id: actorUser.id as string, email: actorUser.email as string | null, role: 'admin' };

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const fullName = String(body.full_name || '').trim().slice(0, 120);
  const roleInput = String(body.role || DEFAULT_STAFF_ROLE).trim();
  if (!isStaffRole(roleInput)) {
    return NextResponse.json({ error: 'Role must be admin, staff, or staff_pos' }, { status: 400 });
  }
  const role: StaffRole = roleInput;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const displayName =
    fullName ||
    email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c: string) => c.toUpperCase());

  // Does an account with this email already exist?
  const { data: existingProfile, error: lookupErr } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name')
    .eq('email', email)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  let existingId: string | null = existingProfile?.id ?? null;
  let existing = existingProfile as { id: string; role: string | null; full_name: string | null } | null;
  if (!existingId) {
    try {
      existingId = await findAuthUserIdByEmail(email);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Could not check existing accounts' }, { status: 500 });
    }
    if (existingId) {
      // The profile may store the email with different capitals: read it by id.
      const { data: byId, error: byIdErr } = await supabaseAdmin
        .from('profiles')
        .select('id, role, full_name')
        .eq('id', existingId)
        .maybeSingle();
      if (byIdErr) return NextResponse.json({ error: byIdErr.message }, { status: 500 });
      existing = byId as typeof existing;
    }
  }

  if (existingId) {
    const existingRole = String(existing?.role || 'customer');
    if (existingRole !== 'customer') {
      return NextResponse.json(
        {
          error: isStaffRole(existingRole)
            ? 'This email already belongs to a staff member. Edit them in the list instead.'
            : 'This email already belongs to an account that cannot be added as staff.',
        },
        { status: 409 }
      );
    }

    // Promote the existing customer. Their password and sign-in state are left alone.
    let banned = false;
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(existingId);
      banned = Boolean((authUser?.user as any)?.banned_until);
    } catch {
      banned = false;
    }

    try {
      const profile = await withAuditActor(actor.id, async () => {
        const { data, error } = await supabaseAdmin
          .from('profiles')
          .upsert(
            {
              id: existingId,
              email,
              full_name: existing?.full_name || displayName,
              role,
            },
            { onConflict: 'id' }
          )
          .select('id, email, full_name, phone, role, created_at, updated_at')
          .single();
        if (error) throw new Error(error.message);
        await logStaffActivity(actor, 'staff.promote', `Made customer ${email} ${roleLabel(role)}`, { id: existingId!, email }, {
          from_role: 'customer',
          to_role: role,
        });
        return data;
      });

      const notes = ['This person keeps their existing password.'];
      if (password) notes.push('The password you typed was not used.');
      if (banned) {
        // An admin adding someone back as staff means they should be able to sign in again.
        const { error: unbanErr } = await supabaseAdmin.auth.admin.updateUserById(existingId, { ban_duration: 'none' });
        if (unbanErr) {
          notes.push('Their sign-in is still blocked from an earlier removal and could not be restored automatically.');
        } else {
          notes.push('Their sign-in was blocked from an earlier removal and is now restored.');
          await logStaffActivity(actor, 'staff.restore_access', `Restored sign-in for ${email}`, { id: existingId!, email }, {});
        }
      }
      return NextResponse.json({ staff: profile, promoted: true, message: notes.join(' ') }, { status: 200 });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Could not add this person as staff' }, { status: 500 });
    }
  }

  // Brand-new account.
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: displayName },
  });
  const userId = created?.user?.id ?? null;
  if (createErr || !userId) {
    const msg = String(createErr?.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return NextResponse.json({ error: 'An account with this email was just created. Refresh and try again.' }, { status: 409 });
    }
    return NextResponse.json({ error: createErr?.message || 'Could not create the account' }, { status: 500 });
  }

  try {
    const profile = await withAuditActor(actor.id, async () => {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .upsert(
          {
            id: userId,
            email,
            full_name: displayName,
            role,
          },
          { onConflict: 'id' }
        )
        .select('id, email, full_name, phone, role, created_at, updated_at')
        .single();
      if (error) throw new Error(error.message);
      await logStaffActivity(actor, 'staff.create', `Added ${roleLabel(role)} account ${email}`, { id: userId, email }, {
        role,
      });
      return data;
    });
    return NextResponse.json({ staff: profile }, { status: 201 });
  } catch (e: any) {
    // The sign-in exists but has no staff role; it is a plain customer account.
    return NextResponse.json(
      { error: `The account was created but could not be given a staff role: ${e?.message || 'unknown error'}. Add the same email again to finish.` },
      { status: 500 }
    );
  }
}

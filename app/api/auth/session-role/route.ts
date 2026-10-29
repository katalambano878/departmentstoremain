import { NextResponse } from 'next/server';
import { getUserForToken } from '@/lib/db/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The caller's live account role, for the middleware (which runs on the edge
 * and cannot reach the database). A revoked, banned or deleted account gets
 * 401 right away, as the hosted Supabase check did.
 */
export async function GET(request: Request) {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const user = token ? await getUserForToken(token) : null;
    if (!user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
    if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 401 });

    return NextResponse.json(
        { userId: user.id, role: String(profile.role) },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}

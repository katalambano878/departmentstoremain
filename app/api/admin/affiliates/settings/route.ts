import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { DEFAULT_AFFILIATE_SETTINGS, type AffiliateSettings } from '@/lib/affiliate';

function getAccessToken(request: Request): string | null {
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

async function requireAdmin(request: Request, allowed: string[] = ['admin', 'staff']): Promise<NextResponse | null> {
  const token = getAccessToken(request);
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
  const role = profile?.role != null ? String(profile.role) : '';
  if (!allowed.includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

async function readSettings(): Promise<AffiliateSettings> {
  const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', 'affiliate').single();
  return { ...DEFAULT_AFFILIATE_SETTINGS, ...(data?.value || {}) };
}

// GET — current affiliate program settings (merged with defaults)
export async function GET(request: Request) {
  const err = await requireAdmin(request);
  if (err) return err;
  return NextResponse.json({ settings: await readSettings() });
}

// PUT — update affiliate program settings (admin only: these set markup caps,
// payout minimums and automatic disbursement).
export async function PUT(request: Request) {
  const err = await requireAdmin(request, ['admin']);
  if (err) return err;

  const body = await request.json().catch(() => ({}));
  const current = await readSettings();
  const next: AffiliateSettings = { ...current };

  if (body.enabled !== undefined) next.enabled = !!body.enabled;
  if (body.auto_disburse !== undefined) next.auto_disburse = !!body.auto_disburse;

  if (body.default_commission_pct !== undefined) {
    const pct = Number(body.default_commission_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return NextResponse.json({ error: 'Default commission must be between 0 and 100' }, { status: 400 });
    }
    next.default_commission_pct = pct;
  }
  if (body.max_commission_pct !== undefined) {
    const pct = Number(body.max_commission_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return NextResponse.json({ error: 'Max markup must be between 0 and 100' }, { status: 400 });
    }
    next.max_commission_pct = pct;
  }
  if (body.attribution_days !== undefined) {
    const d = Math.round(Number(body.attribution_days));
    if (!Number.isFinite(d) || d < 0 || d > 365) {
      return NextResponse.json({ error: 'Attribution window must be between 0 and 365 days' }, { status: 400 });
    }
    next.attribution_days = d;
  }
  if (body.maturity_days !== undefined) {
    const d = Math.round(Number(body.maturity_days));
    if (!Number.isFinite(d) || d < 0 || d > 365) {
      return NextResponse.json({ error: 'Maturity window must be between 0 and 365 days' }, { status: 400 });
    }
    next.maturity_days = d;
  }
  if (body.min_payout !== undefined) {
    const m = Number(body.min_payout);
    if (!Number.isFinite(m) || m < 0) {
      return NextResponse.json({ error: 'Minimum payout must be 0 or more' }, { status: 400 });
    }
    next.min_payout = m;
  }

  const { error } = await supabaseAdmin
    .from('site_settings')
    .upsert({ key: 'affiliate', value: next, category: 'affiliate' }, { onConflict: 'key' });

  if (error) {
    console.error('[AffiliateSettings] save failed:', error.message);
    return NextResponse.json({ error: 'Could not save settings.' }, { status: 500 });
  }
  return NextResponse.json({ settings: next });
}

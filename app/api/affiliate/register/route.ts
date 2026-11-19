import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateAffiliateCode, DEFAULT_AFFILIATE_SETTINGS } from '@/lib/affiliate';

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

// GET — return the current user's affiliate record (or null)
// Columns an affiliate may see about themselves (never the admin `notes`).
const AFFILIATE_SELF_COLUMNS =
  'id, user_id, code, status, commission_pct, pending_commission_pct, commission_requested_at, full_name, email, phone, payout_method, payout_number, payout_provider, payout_name, total_earned, total_paid, balance_pending, balance_available, approved_at, created_at, updated_at';

export async function GET(request: Request) {
  const token = getAccessToken(request);
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

  const { data } = await supabaseAdmin
    .from('affiliates')
    .select(AFFILIATE_SELF_COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({ affiliate: data || null });
}

// POST — apply to become an affiliate
export async function POST(request: Request) {
  const token = getAccessToken(request);
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

  // Already an affiliate?
  const { data: existing } = await supabaseAdmin
    .from('affiliates')
    .select('id, status')
    .eq('user_id', user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ affiliate: existing, message: 'You have already applied.' });
  }

  const body = await request.json().catch(() => ({}));
  const { full_name, phone, payout_number, payout_provider, payout_name } = body;

  // Default commission from settings
  let defaultPct = DEFAULT_AFFILIATE_SETTINGS.default_commission_pct;
  let enabled = DEFAULT_AFFILIATE_SETTINGS.enabled;
  try {
    const { data: setting } = await supabaseAdmin
      .from('site_settings')
      .select('value')
      .eq('key', 'affiliate')
      .single();
    if (setting?.value) {
      if (typeof setting.value.default_commission_pct === 'number') defaultPct = setting.value.default_commission_pct;
      if (typeof setting.value.enabled === 'boolean') enabled = setting.value.enabled;
    }
  } catch { /* fall back to defaults */ }

  if (!enabled) {
    return NextResponse.json({ error: 'The affiliate program is currently closed.' }, { status: 403 });
  }

  // Pull profile for sensible name/email defaults
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name, email, phone')
    .eq('id', user.id)
    .single();

  // Generate a unique code (retry on the rare collision)
  let code = generateAffiliateCode(full_name || profile?.full_name);
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await supabaseAdmin.from('affiliates').select('id').eq('code', code).maybeSingle();
    if (!clash) break;
    code = generateAffiliateCode(full_name || profile?.full_name);
  }

  const { data, error } = await supabaseAdmin
    .from('affiliates')
    .insert({
      user_id: user.id,
      code,
      status: 'pending',
      commission_pct: defaultPct,
      full_name: full_name || profile?.full_name || null,
      email: profile?.email || user.email || null,
      phone: phone || profile?.phone || null,
      payout_method: 'momo',
      payout_number: payout_number || null,
      payout_provider: payout_provider || null,
      payout_name: payout_name || null,
    })
    .select(AFFILIATE_SELF_COLUMNS)
    .single();

  if (error) {
    console.error('[AffiliateRegister] insert failed:', error.message);
    return NextResponse.json({ error: 'Could not submit your application. Please try again.' }, { status: 500 });
  }
  return NextResponse.json({ affiliate: data, message: 'Application received! We will review it shortly.' });
}

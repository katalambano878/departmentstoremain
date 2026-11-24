import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getDashboardSmsCredit } from '@/lib/sms-credit-cache';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request, { requireRole: ['admin', 'staff'] });
  if (!auth.authenticated) {
    const forbidden = Boolean(auth.role);
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: forbidden ? 403 : 401 });
  }
  const smsCredit = await getDashboardSmsCredit();
  return NextResponse.json(smsCredit);
}

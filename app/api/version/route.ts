import { NextResponse } from 'next/server';
import { APP_BUILD } from '@/lib/app-version';

export const dynamic = 'force-dynamic';

/**
 * The build the server is running now. Open dashboard and till tabs compare it
 * with the build they loaded and refresh when it differs. No sign-in needed:
 * the value is an opaque build stamp.
 */
export async function GET() {
  return NextResponse.json({ build: APP_BUILD }, { headers: { 'Cache-Control': 'no-store' } });
}

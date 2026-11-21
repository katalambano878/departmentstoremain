import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 16 * 1024;

/**
 * Receives a "this page is stuck" report from the dashboard (see
 * lib/client-diagnostics.ts) and writes it to the server log. No data is
 * stored; the report holds step names and timings, never tokens.
 */
export async function POST(request: Request) {
  const ip = (request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for') || 'unknown')
    .split(',')[0]
    .trim();
  const rl = checkRateLimit(`client-report:${ip}`, { maxRequests: 10, windowSeconds: 60 });
  if (!rl.success) return new NextResponse(null, { status: 429 });

  const text = await request.text().catch(() => '');
  if (!text || text.length > MAX_BYTES) return new NextResponse(null, { status: 413 });
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!report || typeof report !== 'object') return new NextResponse(null, { status: 400 });

  console.log('[client-report]', JSON.stringify({ at: new Date().toISOString(), ip, ...(report as object) }));
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

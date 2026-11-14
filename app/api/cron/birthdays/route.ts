import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { sendTodaysBirthdayMessages } from '@/lib/birthdays';

export const dynamic = 'force-dynamic';

/**
 * Daily birthday messages (SMS + email). Called once a day by a Coolify
 * scheduled task with `Authorization: Bearer $CRON_SECRET`.
 * `?dry=1` lists who would be greeted today without sending anything.
 */
export async function GET(request: Request) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || cronSecret.length < 16) {
        console.error('[Birthdays] CRON_SECRET is not configured or too short. Endpoint is disabled.');
        return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
    }

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const a = Buffer.from(authHeader.slice(7).trim(), 'utf8');
    const b = Buffer.from(cronSecret, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRun = new URL(request.url).searchParams.get('dry') === '1';
    try {
        const result = await sendTodaysBirthdayMessages({ dryRun });
        console.log(
            `[Birthdays] ${result.date}: due ${result.due}, greeted ${result.greeted}, failed ${result.failed}${dryRun ? ' (dry run)' : ''}`,
        );
        return NextResponse.json({ success: true, ...result });
    } catch (err: any) {
        console.error('[Birthdays] run failed:', err?.message || err);
        return NextResponse.json({ error: 'Birthday run failed' }, { status: 500 });
    }
}

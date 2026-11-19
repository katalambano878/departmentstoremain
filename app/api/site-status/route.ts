import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseSettingValue(raw: unknown): any {
    if (typeof raw !== 'string') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/** Maintenance-mode settings for the middleware (edge runtime, no database access). */
export async function GET() {
    const { data, error } = await supabaseAdmin
        .from('site_settings')
        .select('key, value')
        .in('key', ['maintenance_mode', 'maintenance_until', 'maintenance_message']);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const map: Record<string, any> = {};
    (data || []).forEach((row: any) => {
        map[row.key] = parseSettingValue(row.value);
    });

    const until = typeof map.maintenance_until === 'string' ? map.maintenance_until : '';
    const untilMs = until ? new Date(until).getTime() : NaN;
    const stillRunning = !until || Number.isNaN(untilMs) || untilMs > Date.now();
    return NextResponse.json(
        {
            enabled: (map.maintenance_mode === true || map.maintenance_mode === 'true') && stillRunning,
            until,
            message: typeof map.maintenance_message === 'string' ? map.maintenance_message : '',
        },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}

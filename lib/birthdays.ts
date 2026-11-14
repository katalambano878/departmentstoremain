import { supabaseAdmin } from '@/lib/supabase-admin';
import { emailButton, emailLayout, sendEmail, sendSMS } from '@/lib/notifications';
import { escapeHtml } from '@/lib/sanitize';
import { getPublicSiteUrl } from '@/lib/site-url';

/** Default wording; staff can change it in Admin → Settings. {name} is the first name. */
export const DEFAULT_BIRTHDAY_MESSAGE =
    'Happy birthday, {name}! Everyone at Discount Discovery Zone wishes you a wonderful day. Thank you for shopping with us.';

const STORE_TIME_ZONE = 'Africa/Accra';
const MAX_PER_RUN = 300;

/** Today's year, month and day in the store's time zone. */
export function storeToday(now = new Date()): { year: number; month: number; day: number } {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: STORE_TIME_ZONE,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return { year: get('year'), month: get('month'), day: get('day') };
}

function isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Birthdays (month, day) to greet today. 29 February is greeted on 28 February in other years. */
export function birthdaysFor(today: { year: number; month: number; day: number }): Array<[number, number]> {
    const dates: Array<[number, number]> = [[today.month, today.day]];
    if (today.month === 2 && today.day === 28 && !isLeapYear(today.year)) dates.push([2, 29]);
    return dates;
}

/** site_settings values are stored JSON-encoded by the dashboard. */
function settingText(value: unknown): string {
    if (typeof value !== 'string') return value == null ? '' : String(value);
    try {
        const parsed = JSON.parse(value);
        return typeof parsed === 'string' ? parsed : String(parsed);
    } catch {
        return value;
    }
}

async function birthdaySettings(): Promise<{ enabled: boolean; message: string }> {
    const { data } = await supabaseAdmin
        .from('site_settings')
        .select('key, value')
        .in('key', ['birthday_messages_enabled', 'birthday_message']);
    const byKey = new Map((data || []).map((r: any) => [r.key, settingText(r.value)]));
    const message = (byKey.get('birthday_message') || '').trim() || DEFAULT_BIRTHDAY_MESSAGE;
    return { enabled: byKey.get('birthday_messages_enabled') !== 'false', message };
}

function firstName(c: { first_name?: string | null; full_name?: string | null }): string {
    const name = (c.first_name || c.full_name || '').trim().split(/\s+/)[0];
    return name || 'there';
}

export function personalise(message: string, name: string): string {
    return message.replace(/\{name\}/gi, name);
}

function birthdayEmailHtml(text: string, name: string): string {
    const paragraphs = escapeHtml(text)
        .split(/\n+/)
        .map((p) => `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px;">${p}</p>`)
        .join('');
    return emailLayout(
        `
<div style="text-align:center;margin-bottom:24px;">
  <div style="width:64px;height:64px;background-color:#fef3c7;border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">&#127874;</div>
  <h2 style="margin:0;color:#111827;font-size:24px;">Happy birthday, ${escapeHtml(name)}!</h2>
</div>
${paragraphs}
${emailButton('Visit the shop', `${getPublicSiteUrl()}/shop`)}
`,
        `Happy birthday, ${name}!`,
    );
}

export type BirthdayRunResult = {
    date: string;
    enabled: boolean;
    due: number;
    greeted: number;
    failed: number;
    dryRun: boolean;
    recipients?: Array<{ id: string; name: string; sms: boolean; email: boolean }>;
};

/**
 * Send today's birthday messages (SMS and email) once per customer per year.
 * Each customer is claimed before sending, so overlapping runs cannot double-send;
 * the claim is released when no message went out, so a later run can retry.
 */
export async function sendTodaysBirthdayMessages(opts: { dryRun?: boolean; now?: Date } = {}): Promise<BirthdayRunResult> {
    const today = storeToday(opts.now);
    const date = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
    const settings = await birthdaySettings();
    const result: BirthdayRunResult = {
        date,
        enabled: settings.enabled,
        due: 0,
        greeted: 0,
        failed: 0,
        dryRun: !!opts.dryRun,
    };
    if (!settings.enabled && !opts.dryRun) return result;

    const due: any[] = [];
    for (const [month, day] of birthdaysFor(today)) {
        const { data, error } = await supabaseAdmin
            .from('customers')
            .select('id, first_name, full_name, email, phone, birthday_greeted_year')
            .eq('birthday_month', month)
            .eq('birthday_day', day)
            .or(`birthday_greeted_year.is.null,birthday_greeted_year.lt.${today.year}`)
            .limit(MAX_PER_RUN);
        if (error) throw new Error(error.message);
        due.push(...(data || []));
    }
    result.due = due.length;

    if (opts.dryRun) {
        result.recipients = due.map((c) => ({
            id: c.id,
            name: firstName(c),
            sms: !!c.phone,
            email: !!c.email,
        }));
        return result;
    }

    for (const c of due) {
        const { data: claimed } = await supabaseAdmin
            .from('customers')
            .update({ birthday_greeted_year: today.year })
            .eq('id', c.id)
            .or(`birthday_greeted_year.is.null,birthday_greeted_year.lt.${today.year}`)
            .select('id');
        if (!claimed?.length) continue;

        const name = firstName(c);
        const text = personalise(settings.message, name);
        let sent = false;
        try {
            if (c.phone) {
                const sms = await sendSMS({ to: c.phone, message: text });
                if ((sms as any)?.status === 1) sent = true;
            }
            if (c.email) {
                const email = await sendEmail({
                    to: c.email,
                    subject: `Happy birthday, ${name}!`,
                    html: birthdayEmailHtml(text, name),
                });
                if (email) sent = true;
            }
        } catch (err: any) {
            console.error('[Birthdays] send failed:', err?.message || err);
        }

        if (sent) {
            result.greeted += 1;
        } else {
            result.failed += 1;
            await supabaseAdmin
                .from('customers')
                .update({ birthday_greeted_year: c.birthday_greeted_year ?? null })
                .eq('id', c.id);
        }
    }
    return result;
}

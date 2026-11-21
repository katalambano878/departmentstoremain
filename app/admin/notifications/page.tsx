'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/supabase-paginate';

type Audience = 'all' | 'newsletter';
type Channels = { email: boolean; sms: boolean };
type Recipient = { email: string | null; phone: string | null; name: string | null };

const AUDIENCES: { value: Audience; label: string; note: string }[] = [
    { value: 'all', label: 'All customers', note: 'Every customer with an email address or phone number.' },
    { value: 'newsletter', label: 'Newsletter subscribers', note: 'People who signed up to the newsletter and have not unsubscribed. Email only.' },
];

/** Walk-in POS sales store made-up addresses; never send mail to them. */
function isPlaceholderEmail(email: string) {
    const e = email.trim().toLowerCase();
    return !e.includes('@') || e.endsWith('@pos.local') || e.endsWith('@store.local');
}

const normalizePhone = (p: string) => p.replace(/[\s\-\(\)\.]+/g, '').replace(/^00/, '+');

/** Build the deduplicated recipient list for an audience and the chosen channels. */
async function loadRecipients(audience: Audience, channels: Channels): Promise<Recipient[]> {
    const recipients: Recipient[] = [];

    if (audience === 'newsletter') {
        if (!channels.email) return [];
        const subscribers = await fetchAllPaged<{ email: string | null }>(() =>
            supabase
                .from('newsletter_subscribers')
                .select('email')
                .is('unsubscribed_at', null)
                .order('id', { ascending: true })
        );
        const seen = new Set<string>();
        for (const row of subscribers) {
            const email = (row.email || '').trim().toLowerCase();
            if (!email || isPlaceholderEmail(email) || seen.has(email)) continue;
            seen.add(email);
            recipients.push({ email, phone: null, name: null });
        }
        return recipients;
    }

    // All customers (includes secondary contacts). Page through rows — the API caps bare selects at 1000.
    const customers = await fetchAllPaged<{
        email: string | null;
        phone: string | null;
        full_name: string | null;
        secondary_phone: string | null;
        secondary_email: string | null;
    }>(() =>
        supabase
            .from('customers')
            .select('email, phone, full_name, secondary_phone, secondary_email')
            .order('id', { ascending: true })
    );

    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();
    for (const c of customers) {
        const phones = [c.phone, c.secondary_phone]
            .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
            .map((p) => normalizePhone(p));
        const emails = [c.email, c.secondary_email]
            .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
            .map((e) => e.toLowerCase().trim())
            .filter((e) => !isPlaceholderEmail(e));

        const uniquePhone = channels.sms ? phones.find((p) => !seenPhones.has(p)) || null : null;
        const uniqueEmail = channels.email ? emails.find((e) => !seenEmails.has(e)) || null : null;

        // Mark all their contact info as seen so other customers don't repeat it.
        phones.forEach((p) => seenPhones.add(p));
        emails.forEach((e) => seenEmails.add(e));

        if (!uniqueEmail && !uniquePhone) continue;
        recipients.push({ email: uniqueEmail, phone: uniquePhone, name: c.full_name });
    }
    return recipients;
}

export default function NotificationsPage() {
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState('');
    const [error, setError] = useState('');
    const [preview, setPreview] = useState<{ email: number; sms: number } | null>(null);
    const [previewError, setPreviewError] = useState('');

    const [form, setForm] = useState<{ subject: string; message: string; channels: Channels; audience: Audience }>({
        subject: '',
        message: '',
        channels: { email: true, sms: false },
        audience: 'all'
    });

    const smsAvailable = form.audience !== 'newsletter';
    const effectiveChannels: Channels = { email: form.channels.email, sms: form.channels.sms && smsAvailable };

    // Real recipient count for the chosen audience and channels, before sending.
    useEffect(() => {
        let cancelled = false;
        setPreview(null);
        setPreviewError('');
        if (!effectiveChannels.email && !effectiveChannels.sms) {
            setPreview({ email: 0, sms: 0 });
            return;
        }
        loadRecipients(form.audience, effectiveChannels)
            .then((list) => {
                if (cancelled) return;
                setPreview({
                    email: list.filter((r) => r.email).length,
                    sms: list.filter((r) => r.phone).length,
                });
            })
            .catch((err) => {
                if (!cancelled) setPreviewError(err?.message || 'Could not count recipients');
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.audience, effectiveChannels.email, effectiveChannels.sms]);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                throw new Error('You must be logged in as admin to send campaigns');
            }

            const recipients = await loadRecipients(form.audience, effectiveChannels);
            const emailCount = recipients.filter((r) => r.email).length;
            const smsCount = recipients.filter((r) => r.phone).length;
            if (emailCount + smsCount === 0) throw new Error('No recipients found with valid contact info for this audience');

            const audienceLabel = AUDIENCES.find((a) => a.value === form.audience)?.label.toLowerCase() || 'customers';
            const summary: string[] = [];
            if (effectiveChannels.email) summary.push(`${emailCount} email${emailCount === 1 ? '' : 's'}`);
            if (effectiveChannels.sms) summary.push(`${smsCount} SMS`);
            if (!window.confirm(`This will send ${summary.join(' and ')} to ${audienceLabel}. Continue?`)) {
                setLoading(false);
                return;
            }

            // Send in batches to avoid API timeouts.
            const BATCH_SIZE = 50;
            const sent = { email: 0, sms: 0 };
            const failed = { email: 0, sms: 0 };
            let batchError = '';

            for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
                const batch = recipients.slice(i, i + BATCH_SIZE);
                const batchNo = Math.floor(i / BATCH_SIZE) + 1;

                const res = await fetch('/api/notifications', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify({
                        type: 'campaign',
                        payload: {
                            recipients: batch,
                            subject: form.subject,
                            message: form.message,
                            channels: effectiveChannels,
                        }
                    })
                });

                const contentType = res.headers.get('content-type') || '';
                const data = contentType.includes('application/json') ? await res.json() : null;
                if (!res.ok || !data) {
                    // Stop here: earlier batches already went out, so report what was sent.
                    batchError = `Batch ${batchNo} failed: ${data?.error || `server error ${res.status}`}. Later batches were not sent.`;
                    break;
                }
                sent.email += Number(data.sent?.email || 0);
                sent.sms += Number(data.sent?.sms || 0);
                failed.email += Number(data.failed?.email || 0);
                failed.sms += Number(data.failed?.sms || 0);
            }

            const parts: string[] = [];
            if (effectiveChannels.email) parts.push(`${sent.email} email${sent.email === 1 ? '' : 's'} sent${failed.email ? `, ${failed.email} failed` : ''}`);
            if (effectiveChannels.sms) parts.push(`${sent.sms} SMS sent${failed.sms ? `, ${failed.sms} failed` : ''}`);
            const report = parts.join('. ') + '.';

            if (batchError) {
                setError(`${batchError} So far: ${report}`);
            } else if (sent.email + sent.sms === 0) {
                setError(`Nothing was delivered. ${report} Check the email and SMS settings.`);
            } else {
                setSuccess(`Campaign finished. ${report}`);
                setForm(prev => ({ ...prev, subject: '', message: '' }));
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">Marketing & Notifications</h1>

            <div className="bg-white p-4 sm:p-8 rounded-xl shadow-sm border border-gray-200">
                <h2 className="text-lg sm:text-xl font-semibold mb-4 sm:mb-6">Send New Campaign</h2>

                {success && <div className="bg-blue-50 text-blue-700 p-4 rounded-lg mb-4 break-words">{success}</div>}
                {error && <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-4 break-words">{error}</div>}

                <form onSubmit={handleSend} className="space-y-6">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Audience</label>
                        <select
                            value={form.audience}
                            onChange={e => setForm({ ...form, audience: e.target.value as Audience })}
                            className="w-full p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {AUDIENCES.map((a) => (
                                <option key={a.value} value={a.value}>{a.label}</option>
                            ))}
                        </select>
                        <p className="text-sm text-gray-500 mt-1">{AUDIENCES.find((a) => a.value === form.audience)?.note}</p>
                        <p className="text-sm font-medium text-gray-800 mt-2" aria-live="polite">
                            {previewError
                                ? <span className="text-red-600">{previewError}</span>
                                : preview === null
                                    ? 'Counting recipients…'
                                    : [
                                        effectiveChannels.email ? `${preview.email} email recipient${preview.email === 1 ? '' : 's'}` : null,
                                        effectiveChannels.sms ? `${preview.sms} SMS recipient${preview.sms === 1 ? '' : 's'}` : null,
                                    ].filter(Boolean).join(' · ') || 'Choose at least one channel'}
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-x-6 gap-y-2 p-4 bg-gray-50 rounded-lg border border-gray-100">
                        <label className="flex min-h-[44px] sm:min-h-0 items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.channels.email}
                                onChange={e => setForm({ ...form, channels: { ...form.channels, email: e.target.checked } })}
                                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                            />
                            <span className="font-medium text-gray-900">Send Email</span>
                        </label>
                        <label className={`flex min-h-[44px] sm:min-h-0 items-center gap-2 ${smsAvailable ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`} title={smsAvailable ? undefined : 'Newsletter subscribers have no phone numbers'}>
                            <input
                                type="checkbox"
                                disabled={!smsAvailable}
                                checked={form.channels.sms && smsAvailable}
                                onChange={e => setForm({ ...form, channels: { ...form.channels, sms: e.target.checked } })}
                                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                            />
                            <span className="font-medium text-gray-900">Send SMS</span>
                        </label>
                    </div>

                    {effectiveChannels.email && (
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Email Subject</label>
                            <input
                                type="text"
                                value={form.subject}
                                onChange={e => setForm({ ...form, subject: e.target.value })}
                                className="w-full p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="e.g., Summer Sale Starts Now!"
                                required={effectiveChannels.email}
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Message Content</label>
                        <textarea
                            value={form.message}
                            onChange={e => setForm({ ...form, message: e.target.value })}
                            className="w-full p-3 border border-gray-300 rounded-lg h-40 outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Write your message here... For emails, this supports plain text."
                            required
                        />
                        <p className="text-sm text-gray-500 mt-1">This message will be used for the email body (wrapped in a template) and SMS content (if selected).</p>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || (!effectiveChannels.email && !effectiveChannels.sms) || (preview !== null && preview.email + preview.sms === 0)}
                        className="w-full bg-blue-700 text-white py-4 rounded-lg font-bold text-lg hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                        {loading ? (
                            <span className="flex items-center justify-center">
                                <i className="ri-loader-4-line animate-spin mr-2"></i> Sending...
                            </span>
                        ) : 'Send Campaign'}
                    </button>
                </form>
            </div>
        </div>
    );
}

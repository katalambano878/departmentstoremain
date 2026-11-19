'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

type Message = {
  id: string;
  ticket_id: string;
  user_id: string | null;
  message: string;
  is_internal: boolean | null;
  created_at: string;
};

type Ticket = {
  id: string;
  ticket_number: number;
  user_id: string | null;
  email: string;
  subject: string;
  description: string | null;
  category: string | null;
  status: TicketStatus | null;
  priority: TicketPriority | null;
  created_at: string;
  updated_at: string | null;
  support_messages: Message[];
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_customer: 'Waiting for customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

const STATUS_BADGE: Record<TicketStatus, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-purple-100 text-purple-700',
  waiting_customer: 'bg-amber-100 text-amber-800',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
};

const PRIORITY_BADGE: Record<TicketPriority, string> = {
  low: 'text-gray-500',
  medium: 'text-gray-700',
  high: 'text-orange-700',
  urgent: 'text-red-700 font-semibold',
};

const OPEN_STATUSES: TicketStatus[] = ['open', 'in_progress', 'waiting_customer'];

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('support_tickets')
      .select('id, ticket_number, user_id, email, subject, description, category, status, priority, created_at, updated_at, support_messages(id, ticket_id, user_id, message, is_internal, created_at)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) setError(`Could not load tickets: ${error.message}`);
    else {
      setError('');
      setTickets(((data || []) as Ticket[]).map(t => ({
        ...t,
        support_messages: [...(t.support_messages || [])].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
      })));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    supabase.auth.getSession().then(({ data: { session } }) => setUserId(session?.user.id || null));
  }, []);

  const status = (t: Ticket): TicketStatus => t.status || 'open';
  const openCount = tickets.filter(t => OPEN_STATUSES.includes(status(t))).length;
  const visible = tickets.filter(t => filter === 'all' || OPEN_STATUSES.includes(status(t)));
  const selected = tickets.find(t => t.id === selectedId) || null;

  const changeStatus = async (t: Ticket, next: TicketStatus) => {
    setStatusSaving(true);
    setError('');
    const { data, error } = await supabase
      .from('support_tickets')
      .update({ status: next })
      .eq('id', t.id)
      .select('id, status, updated_at');
    setStatusSaving(false);
    if (error || !data || data.length === 0) {
      setError(`Status not changed: ${error?.message || 'not allowed'}`);
      return;
    }
    setTickets(prev => prev.map(x => (x.id === t.id ? { ...x, ...data[0] } : x)));
  };

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    setError('');
    const { data, error } = await supabase
      .from('support_messages')
      .insert([{ ticket_id: selected.id, user_id: userId, message: text, is_internal: internal }])
      .select('id, ticket_id, user_id, message, is_internal, created_at')
      .single();
    setSending(false);
    if (error || !data) {
      setError(`Reply not saved: ${error?.message || 'unknown error'}`);
      return;
    }
    setTickets(prev => prev.map(t => (t.id === selected.id ? { ...t, support_messages: [...t.support_messages, data as Message] } : t)));
    setReply('');
    setInternal(false);
  };

  const authorLabel = (t: Ticket, m: Message) => {
    if (m.user_id && m.user_id === t.user_id) return 'Customer';
    if (m.user_id && m.user_id === userId) return 'You';
    return 'Staff';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Support tickets</h1>
        <p className="text-gray-600 mt-1">
          Questions customers raised as tickets.{!loading && ` ${openCount} still open.`}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg" role="alert">
          <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><i className="ri-close-line"></i></button>
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-6 items-start">
        {/* List */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-3 border-b border-gray-100 flex items-center gap-2">
            {(['open', 'all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === f ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {f === 'open' ? `Open (${openCount})` : `All (${tickets.length})`}
              </button>
            ))}
            <button onClick={load} className="ml-auto w-9 h-9 flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100" aria-label="Refresh">
              <i className={`ri-refresh-line ${loading ? 'animate-spin' : ''}`}></i>
            </button>
          </div>
          {loading ? (
            <p className="p-8 text-center text-gray-500">Loading tickets...</p>
          ) : visible.length === 0 ? (
            <p className="p-8 text-center text-gray-500">{tickets.length === 0 ? 'No tickets yet.' : 'No open tickets.'}</p>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
              {visible.map(t => (
                <li key={t.id}>
                  <button
                    onClick={() => { setSelectedId(t.id); setReply(''); setInternal(false); }}
                    className={`w-full text-left p-4 hover:bg-gray-50 ${selectedId === t.id ? 'bg-blue-50' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500">#{t.ticket_number}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[status(t)]}`}>{STATUS_LABEL[status(t)]}</span>
                    </div>
                    <p className="font-semibold text-gray-900 mt-1 line-clamp-1">{t.subject}</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                      {t.email} · {formatDateTime(t.created_at)} · {t.support_messages.length} message{t.support_messages.length === 1 ? '' : 's'}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-5">
          {!selected ? (
            <p className="py-16 text-center text-gray-500">Choose a ticket to read it.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">
                    Ticket #{selected.ticket_number}
                    {selected.category && ` · ${selected.category}`}
                    {selected.priority && <> · <span className={PRIORITY_BADGE[selected.priority]}>{selected.priority} priority</span></>}
                  </p>
                  <h2 className="text-lg font-bold text-gray-900 break-words">{selected.subject}</h2>
                  <p className="text-sm text-gray-600">
                    <a href={`mailto:${selected.email}?subject=${encodeURIComponent(`Re: ${selected.subject} (ticket #${selected.ticket_number})`)}`} className="text-blue-700 hover:underline">{selected.email}</a>
                    {' · '}opened {formatDateTime(selected.created_at)}
                  </p>
                </div>
                <select
                  value={status(selected)}
                  disabled={statusSaving}
                  onChange={(e) => changeStatus(selected, e.target.value as TicketStatus)}
                  aria-label="Ticket status"
                  className="px-3 py-2 border-2 border-gray-300 rounded-lg text-sm cursor-pointer disabled:opacity-50"
                >
                  {(Object.keys(STATUS_LABEL) as TicketStatus[]).map(s => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </div>

              {selected.description && (
                <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-800 whitespace-pre-wrap break-words">{selected.description}</div>
              )}

              <ul className="space-y-3">
                {selected.support_messages.length === 0 && (
                  <li className="text-sm text-gray-500">No replies yet.</li>
                )}
                {selected.support_messages.map(m => {
                  const who = authorLabel(selected, m);
                  return (
                    <li
                      key={m.id}
                      className={`rounded-lg p-3 text-sm border ${m.is_internal ? 'bg-amber-50 border-amber-200' : who === 'Customer' ? 'bg-white border-gray-200' : 'bg-blue-50 border-blue-100'}`}
                    >
                      <p className="text-xs text-gray-500 mb-1">
                        <span className="font-semibold text-gray-700">{who}</span>
                        {m.is_internal && ' · internal note'} · {formatDateTime(m.created_at)}
                      </p>
                      <p className="text-gray-800 whitespace-pre-wrap break-words">{m.message}</p>
                    </li>
                  );
                })}
              </ul>

              <form onSubmit={sendReply} className="space-y-3 border-t border-gray-100 pt-4">
                <label htmlFor="ticket-reply" className="block text-sm font-semibold text-gray-900">Add a reply</label>
                <textarea
                  id="ticket-reply"
                  rows={4}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500">
                  Replies are saved on the ticket. The customer is not emailed or texted automatically, so contact them at {selected.email} as well.
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="w-4 h-4 rounded" />
                    Internal note (staff only)
                  </label>
                  <button
                    type="submit"
                    disabled={sending || !reply.trim()}
                    className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
                  >
                    {sending ? 'Saving...' : internal ? 'Save note' : 'Save reply'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

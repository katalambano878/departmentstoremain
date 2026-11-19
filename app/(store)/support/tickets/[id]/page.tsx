'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import { STATUS_LABELS, categoryLabel, formatDateTime, statusColor, ticketRef, useSupportUser } from '../../support-shared';
import GuestNotice from '../../GuestNotice';

type Ticket = {
  id: string;
  ticket_number: number;
  subject: string;
  description: string | null;
  category: string | null;
  status: string;
  created_at: string;
  metadata: Record<string, any> | null;
};

type Message = {
  id: string;
  user_id: string | null;
  message: string;
  created_at: string;
};

function TicketThread() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const justCreated = searchParams.get('created') === '1';
  const { user, checking, guest } = useSupportUser();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const { data: t, error } = await supabase
      .from('support_tickets')
      .select('id, ticket_number, subject, description, category, status, created_at, metadata')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) { setState('error'); return; }
    if (!t) { setState('missing'); return; }
    const { data: msgs, error: msgError } = await supabase
      .from('support_messages')
      .select('id, user_id, message, created_at')
      .eq('ticket_id', t.id)
      .eq('is_internal', false)
      .order('created_at', { ascending: true });
    if (msgError) { setState('error'); return; }
    setTicket(t as Ticket);
    setMessages((msgs || []) as Message[]);
    setState('ready');
  }, [user, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !ticket) return;
    const text = reply.trim();
    if (text.length < 2) {
      setReplyError('Please write a reply.');
      return;
    }
    setSending(true);
    setReplyError('');
    const { error } = await supabase.from('support_messages').insert({
      ticket_id: ticket.id,
      user_id: user.id,
      message: text.slice(0, 5000),
      is_internal: false,
    });
    if (error) {
      setSending(false);
      setReplyError('Your reply could not be sent. Please try again.');
      return;
    }
    // A customer reply puts the ticket back in the team's queue.
    if (['waiting_customer', 'resolved', 'closed'].includes(ticket.status)) {
      await supabase
        .from('support_tickets')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('id', ticket.id)
        .eq('user_id', user.id);
    }
    setReply('');
    setSending(false);
    await load();
  };

  if (checking) {
    return (
      <div className="py-16 text-center">
        <i className="ri-loader-4-line animate-spin text-3xl text-emerald-700" aria-label="Loading"></i>
      </div>
    );
  }

  if (guest) return <GuestNotice returnTo={`/support/tickets/${params.id}`} />;

  if (state === 'loading') {
    return (
      <div className="py-16 text-center">
        <i className="ri-loader-4-line animate-spin text-3xl text-emerald-700" aria-label="Loading ticket"></i>
      </div>
    );
  }

  if (state !== 'ready' || !ticket) {
    return (
      <div role="alert" className="bg-white rounded-xl shadow-sm p-12 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {state === 'missing' ? 'Ticket not found' : 'We could not load this ticket'}
        </h1>
        <p className="text-gray-600 mb-6">
          {state === 'missing' ? 'This ticket does not exist or is not on your account.' : 'Please try again in a moment.'}
        </p>
        <Link href="/support/tickets" className="text-emerald-700 font-semibold hover:underline">Back to my tickets</Link>
      </div>
    );
  }

  return (
    <>
      {justCreated && (
        <div role="status" className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg">
          Your ticket was sent. We will reply here and by email.
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-6 sm:p-8 mb-6">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-gray-900">{ticket.subject}</h1>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColor(ticket.status)}`}>
            {STATUS_LABELS[ticket.status] || ticket.status}
          </span>
        </div>
        <p className="text-sm text-gray-600">
          Ticket {ticketRef(ticket.ticket_number)} · {categoryLabel(ticket.category)}
          {ticket.metadata?.order_number ? ` · Order ${ticket.metadata.order_number}` : ''}
        </p>
      </div>

      <ol className="space-y-4 mb-6" aria-label="Conversation">
        {ticket.description && (
          <li className="bg-emerald-50 border border-emerald-100 rounded-xl p-5 sm:ml-12">
            <p className="text-xs font-semibold text-emerald-800 mb-2">You · {formatDateTime(ticket.created_at)}</p>
            <p className="text-gray-800 whitespace-pre-line break-words">{ticket.description}</p>
          </li>
        )}
        {messages.map((m) => {
          const mine = m.user_id === user?.id;
          return (
            <li
              key={m.id}
              className={`rounded-xl p-5 border ${mine ? 'bg-emerald-50 border-emerald-100 sm:ml-12' : 'bg-white border-gray-200 sm:mr-12'}`}
            >
              <p className={`text-xs font-semibold mb-2 ${mine ? 'text-emerald-800' : 'text-gray-700'}`}>
                {mine ? 'You' : 'Discount Discovery Zone'} · {formatDateTime(m.created_at)}
              </p>
              <p className="text-gray-800 whitespace-pre-line break-words">{m.message}</p>
            </li>
          );
        })}
        {messages.length === 0 && (
          <li className="text-sm text-gray-500 text-center py-2">No replies yet. We usually answer within one working day.</li>
        )}
      </ol>

      <form onSubmit={handleReply} className="bg-white rounded-xl shadow-sm p-6">
        <label htmlFor="ticket-reply" className="block text-sm font-semibold text-gray-900 mb-2">
          Add a reply
        </label>
        <textarea
          id="ticket-reply"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={4}
          maxLength={5000}
          className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
        />
        {replyError && <p role="alert" className="mt-2 text-sm text-red-600">{replyError}</p>}
        <button
          type="submit"
          disabled={sending}
          className="mt-4 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send reply'}
        </button>
      </form>
    </>
  );
}

export default function TicketDetailPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-3xl mx-auto px-4">
        <Link href="/support/tickets" className="inline-flex items-center text-emerald-700 hover:text-emerald-900 font-semibold mb-6">
          <i className="ri-arrow-left-line mr-2" aria-hidden="true"></i>
          My tickets
        </Link>
        <Suspense fallback={null}>
          <TicketThread />
        </Suspense>
      </div>
    </main>
  );
}

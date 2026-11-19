'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { STATUS_LABELS, categoryLabel, formatDateTime, statusColor, ticketRef, useSupportUser } from '../support-shared';
import GuestNotice from '../GuestNotice';

type Ticket = {
  id: string;
  ticket_number: number;
  subject: string;
  category: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Open' },
  { id: 'done', label: 'Resolved or closed' },
];

export default function MyTicketsPage() {
  const { user, checking, guest } = useSupportUser();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase
      .from('support_tickets')
      .select('id, ticket_number, subject, category, status, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) setLoadError(true);
    else setTickets((data || []) as Ticket[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = tickets.filter((t) => {
    if (filter === 'active') return !['resolved', 'closed'].includes(t.status);
    if (filter === 'done') return ['resolved', 'closed'].includes(t.status);
    return true;
  });

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-5xl mx-auto px-4">
        {checking && (
          <div className="py-16 text-center">
            <i className="ri-loader-4-line animate-spin text-3xl text-emerald-700" aria-label="Loading"></i>
          </div>
        )}

        {guest && <GuestNotice returnTo="/support/tickets" />}

        {user && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">My support tickets</h1>
                <p className="text-gray-600">Follow your requests and read our replies.</p>
              </div>
              <Link
                href="/support/ticket"
                className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors text-center"
              >
                <i className="ri-add-line mr-2" aria-hidden="true"></i>
                New ticket
              </Link>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
              <div className="flex border-b border-gray-200 overflow-x-auto" role="group" aria-label="Filter tickets">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    aria-pressed={filter === f.id}
                    className={`px-6 py-4 font-semibold whitespace-nowrap border-b-2 transition-colors ${
                      filter === f.id ? 'border-emerald-700 text-emerald-700' : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="py-16 text-center">
                <i className="ri-loader-4-line animate-spin text-3xl text-emerald-700" aria-label="Loading tickets"></i>
              </div>
            ) : loadError ? (
              <div role="alert" className="bg-white rounded-xl shadow-sm p-12 text-center">
                <h2 className="text-xl font-bold text-gray-900 mb-2">We could not load your tickets</h2>
                <button type="button" onClick={load} className="mt-4 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors">
                  Try again
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                <div className="w-20 h-20 flex items-center justify-center bg-gray-100 rounded-full mx-auto mb-6">
                  <i className="ri-ticket-line text-4xl text-gray-400" aria-hidden="true"></i>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  {tickets.length === 0 ? 'No tickets yet' : 'No tickets here'}
                </h2>
                <p className="text-gray-600 mb-6">
                  {tickets.length === 0 ? 'When you contact us with a ticket, it appears here.' : 'Try another filter.'}
                </p>
                {tickets.length === 0 && (
                  <Link href="/support/ticket" className="inline-block bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors">
                    Create a ticket
                  </Link>
                )}
              </div>
            ) : (
              <ul className="space-y-4">
                {filtered.map((ticket) => (
                  <li key={ticket.id}>
                    <Link
                      href={`/support/tickets/${ticket.id}`}
                      className="block bg-white rounded-xl shadow-sm p-6 hover:shadow-lg transition-all border-2 border-transparent hover:border-emerald-700"
                    >
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <h2 className="text-lg font-bold text-gray-900">{ticket.subject}</h2>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColor(ticket.status)}`}>
                          {STATUS_LABELS[ticket.status] || ticket.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">
                        Ticket {ticketRef(ticket.ticket_number)} · {categoryLabel(ticket.category)} · opened {formatDateTime(ticket.created_at)}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">Last updated {formatDateTime(ticket.updated_at || ticket.created_at)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  );
}

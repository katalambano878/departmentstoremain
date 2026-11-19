'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Submission = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  status: string;
  created_at: string;
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminMessagesPage() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'new' | 'handled' | 'all'>('new');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('contact_submissions')
      .select('id, name, email, phone, subject, message, status, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) setError(`Could not load messages: ${error.message}`);
    else {
      setError('');
      setRows((data || []) as Submission[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const setStatus = async (row: Submission, status: 'new' | 'handled') => {
    setBusyId(row.id);
    setError('');
    // .select() so a row hidden by row-level security reports as "not changed"
    // instead of looking like a silent success.
    const { data, error } = await supabase
      .from('contact_submissions')
      .update({ status })
      .eq('id', row.id)
      .select('id');
    setBusyId(null);
    if (error || !data || data.length === 0) {
      setError(`Not changed: ${error?.message || 'your account is not allowed to update messages yet. Ask an admin.'}`);
      return;
    }
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, status } : r)));
  };

  const isHandled = (r: Submission) => r.status === 'handled';
  const newCount = rows.filter(r => !isHandled(r)).length;
  const q = search.trim().toLowerCase();
  const visible = rows.filter(r =>
    (filter === 'all' || (filter === 'handled' ? isHandled(r) : !isHandled(r))) &&
    (!q || [r.name, r.email, r.phone, r.subject, r.message].some(v => (v || '').toLowerCase().includes(q)))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Messages</h1>
        <p className="text-gray-600 mt-1">
          What customers sent through the contact form.{!loading && ` ${newCount} not handled yet.`}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg" role="alert">
          <i className="ri-error-warning-line text-red-600 mt-0.5"></i>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><i className="ri-close-line"></i></button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-2">
          {(['new', 'handled', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === f ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {f === 'new' ? `Not handled (${newCount})` : f === 'handled' ? 'Handled' : 'All'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative md:w-72">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, message"
              className="w-full pl-10 pr-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </div>
          <button onClick={load} className="w-10 h-10 flex items-center justify-center border-2 border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50" aria-label="Refresh">
            <i className={`ri-refresh-line ${loading ? 'animate-spin' : ''}`}></i>
          </button>
        </div>
      </div>

      {loading ? (
        <p className="p-10 text-center text-gray-500">Loading messages...</p>
      ) : visible.length === 0 ? (
        <p className="p-10 text-center text-gray-500 bg-white rounded-xl border border-gray-200">
          {rows.length === 0 ? 'No messages yet.' : filter === 'new' && !q ? 'Every message has been handled.' : 'No messages match.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map(r => (
            <li key={r.id} className={`bg-white rounded-xl border p-5 ${isHandled(r) ? 'border-gray-200' : 'border-blue-200'}`}>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">
                    {r.subject || 'No subject'}
                    {!isHandled(r) && <span className="ml-2 align-middle px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">New</span>}
                  </p>
                  <p className="text-sm text-gray-600 mt-0.5 break-words">
                    {r.name} · <a href={`mailto:${r.email}`} className="text-blue-700 hover:underline">{r.email}</a>
                    {r.phone && <> · <a href={`tel:${r.phone}`} className="text-blue-700 hover:underline">{r.phone}</a></>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(r.created_at)}</p>
                </div>
                <button
                  onClick={() => setStatus(r, isHandled(r) ? 'new' : 'handled')}
                  disabled={busyId === r.id}
                  className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 ${isHandled(r) ? 'border-2 border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-blue-700 text-white hover:bg-blue-800'}`}
                >
                  {busyId === r.id ? 'Saving...' : isHandled(r) ? 'Mark as not handled' : 'Mark as handled'}
                </button>
              </div>
              <p className="mt-3 text-sm text-gray-800 whitespace-pre-wrap break-words">{r.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

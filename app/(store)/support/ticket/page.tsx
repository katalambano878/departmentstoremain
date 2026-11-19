'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { TICKET_CATEGORIES, useSupportUser } from '../support-shared';
import GuestNotice from '../GuestNotice';

const inputCls =
  'w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500';

export default function SupportTicketPage() {
  const router = useRouter();
  const { user, checking, guest } = useSupportUser();
  const [category, setCategory] = useState('order');
  const [orderNumber, setOrderNumber] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    if (subject.trim().length < 3) {
      setError('Please add a short subject.');
      return;
    }
    if (description.trim().length < 10) {
      setError('Please describe the problem in at least 10 characters.');
      return;
    }
    setIsSubmitting(true);
    const order = orderNumber.trim();
    const { data, error: insertError } = await supabase
      .from('support_tickets')
      .insert({
        user_id: user.id,
        email: user.email,
        subject: subject.trim().slice(0, 150),
        description: description.trim().slice(0, 5000),
        category,
        metadata: order ? { order_number: order.slice(0, 64) } : {},
      })
      .select('id')
      .single();
    setIsSubmitting(false);
    if (insertError || !data) {
      console.error('Ticket create failed:', insertError);
      setError('Your ticket could not be sent. Please try again, or call or WhatsApp us on 0248615775.');
      return;
    }
    router.push(`/support/tickets/${data.id}?created=1`);
  };

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <Link
          href="/help"
          className="inline-flex items-center text-emerald-700 hover:text-emerald-900 font-semibold mb-6"
        >
          <i className="ri-arrow-left-line mr-2" aria-hidden="true"></i>
          Back to Help Centre
        </Link>

        {checking && (
          <div className="py-16 text-center">
            <i className="ri-loader-4-line animate-spin text-3xl text-emerald-700" aria-label="Loading"></i>
          </div>
        )}

        {guest && <GuestNotice returnTo="/support/ticket" />}

        {user && (
          <div className="bg-white rounded-xl shadow-sm p-6 sm:p-8">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Create a support ticket</h1>
              <p className="text-gray-600">
                Tell us what you need. We reply here and by email to {user.email}.{' '}
                <Link href="/support/tickets" className="text-emerald-700 font-semibold hover:underline">See my tickets</Link>
              </p>
            </div>

            {error && (
              <div role="alert" className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <fieldset>
                <legend className="block text-sm font-semibold text-gray-900 mb-3">What is it about? *</legend>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {TICKET_CATEGORIES.map((cat) => (
                    <label
                      key={cat.value}
                      className={`p-4 rounded-lg border-2 text-center transition-all cursor-pointer focus-within:ring-2 focus-within:ring-emerald-500 ${
                        category === cat.value ? 'border-emerald-700 bg-emerald-50' : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <input
                        type="radio"
                        name="category"
                        value={cat.value}
                        checked={category === cat.value}
                        onChange={() => setCategory(cat.value)}
                        className="sr-only"
                      />
                      <i className={`${cat.icon} text-2xl text-emerald-700 block mb-2`} aria-hidden="true"></i>
                      <span className="text-sm font-semibold text-gray-900">{cat.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="ticket-order" className="block text-sm font-semibold text-gray-900 mb-2">
                  Order number (if it is about an order)
                </label>
                <input
                  id="ticket-order"
                  type="text"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  maxLength={64}
                  className={inputCls}
                />
              </div>

              <div>
                <label htmlFor="ticket-subject" className="block text-sm font-semibold text-gray-900 mb-2">
                  Subject *
                </label>
                <input
                  id="ticket-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={150}
                  className={inputCls}
                  required
                />
              </div>

              <div>
                <label htmlFor="ticket-description" className="block text-sm font-semibold text-gray-900 mb-2">
                  Details *
                </label>
                <textarea
                  id="ticket-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  maxLength={5000}
                  className={inputCls}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Sending…' : 'Send ticket'}
              </button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}

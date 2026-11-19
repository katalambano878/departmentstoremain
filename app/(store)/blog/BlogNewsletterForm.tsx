'use client';

import { useState } from 'react';

export default function BlogNewsletterForm({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setMessage('');
    try {
      const res = await fetch('/api/storefront/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'blog' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus('error');
        setMessage(data.error || 'We could not sign you up. Please try again.');
        return;
      }
      setStatus('success');
      setMessage('You are signed up.');
      setEmail('');
    } catch {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  };

  const dark = tone === 'dark';

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto w-full">
      <div className="flex flex-col sm:flex-row gap-3">
        <label htmlFor={`blog-newsletter-${tone}`} className="sr-only">Email address</label>
        <input
          id={`blog-newsletter-${tone}`}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email address"
          className={`flex-1 px-6 py-4 rounded-full text-gray-900 border ${dark ? 'border-transparent focus:ring-2 focus:ring-white' : 'border-gray-300 focus:ring-2 focus:ring-emerald-500'}`}
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className={`px-8 py-4 rounded-full font-medium transition-colors whitespace-nowrap disabled:opacity-60 ${dark ? 'bg-white text-emerald-700 hover:bg-emerald-50' : 'bg-emerald-700 text-white hover:bg-emerald-800'}`}
        >
          {status === 'sending' ? 'Signing up…' : 'Subscribe'}
        </button>
      </div>
      <p
        aria-live="polite"
        className={`mt-3 text-sm min-h-[1.25rem] ${status === 'error' ? (dark ? 'text-red-100' : 'text-red-700') : (dark ? 'text-emerald-100' : 'text-emerald-700')}`}
      >
        {message}
      </p>
    </form>
  );
}

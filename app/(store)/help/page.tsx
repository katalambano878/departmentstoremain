'use client';

import { useState } from 'react';
import Link from 'next/link';
import { HELP_ARTICLES, HELP_CATEGORIES, STORE_EMAIL, STORE_PHONE } from './articles';

export default function HelpCenterPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const query = searchQuery.trim().toLowerCase();

  const results = query
    ? HELP_ARTICLES.filter((a) =>
        a.title.toLowerCase().includes(query) ||
        a.summary.toLowerCase().includes(query) ||
        a.sections.some((s) =>
          [...(s.paragraphs || []), ...(s.list || []), s.heading || ''].some((t) => t.toLowerCase().includes(query))
        )
      )
    : [];

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">How can we help you?</h1>
          <p className="text-emerald-100 mb-8 text-lg">Answers about ordering, paying, delivery, returns and your account.</p>

          <div className="relative max-w-2xl mx-auto" role="search">
            <label htmlFor="help-search" className="sr-only">Search help articles</label>
            <input
              id="help-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search, for example “delivery fee”"
              className="w-full px-6 py-4 pl-14 pr-14 rounded-xl text-gray-900 text-lg focus:outline-none focus:ring-4 focus:ring-emerald-300"
            />
            <i className="ri-search-line absolute left-5 top-1/2 -translate-y-1/2 text-2xl text-gray-400" aria-hidden="true"></i>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
              >
                <i className="ri-close-line text-xl" aria-hidden="true"></i>
              </button>
            )}
          </div>

          {query && (
            <div className="mt-4 bg-white rounded-xl shadow-lg text-left max-w-2xl mx-auto max-h-96 overflow-y-auto" aria-live="polite">
              {results.length > 0 ? (
                <ul>
                  {results.map((article) => (
                    <li key={article.id} className="border-b border-gray-200 last:border-0">
                      <Link href={`/help/article/${article.id}`} className="block p-4 hover:bg-gray-50">
                        <p className="font-semibold text-gray-900">{article.title}</p>
                        <p className="text-sm text-gray-600 mt-1">{article.summary}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-6 text-center">
                  <p className="text-gray-900 font-semibold">No articles match</p>
                  <p className="text-sm text-gray-600 mt-1">Try other words, or contact us below.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-8">Browse by topic</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {HELP_CATEGORIES.map((category) => {
            const articles = HELP_ARTICLES.filter((a) => a.category === category.id);
            return (
              <section key={category.id} aria-labelledby={`help-cat-${category.id}`} className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 flex items-center justify-center bg-emerald-100 rounded-lg">
                    <i className={`${category.icon} text-2xl text-emerald-700`} aria-hidden="true"></i>
                  </div>
                  <h3 id={`help-cat-${category.id}`} className="text-lg font-bold text-gray-900">{category.title}</h3>
                </div>
                <ul className="space-y-1">
                  {articles.map((article) => (
                    <li key={article.id}>
                      <Link
                        href={`/help/article/${article.id}`}
                        className="flex items-start gap-2 py-2 text-gray-700 hover:text-emerald-700"
                      >
                        <i className="ri-file-text-line mt-0.5 text-gray-400" aria-hidden="true"></i>
                        <span>{article.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="mt-12 bg-white rounded-xl shadow-sm p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Still need help?</h2>
          <p className="text-gray-600 mb-6">Talk to our team. We usually reply within one working day.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <a href={`https://wa.me/233${STORE_PHONE.slice(1)}`} target="_blank" rel="noopener noreferrer" className="p-4 border-2 border-gray-200 rounded-lg hover:border-emerald-700 transition-colors">
              <i className="ri-whatsapp-line text-2xl text-emerald-700" aria-hidden="true"></i>
              <p className="font-semibold text-gray-900 mt-2">WhatsApp</p>
              <p className="text-sm text-gray-600">{STORE_PHONE}</p>
            </a>
            <a href={`tel:${STORE_PHONE}`} className="p-4 border-2 border-gray-200 rounded-lg hover:border-emerald-700 transition-colors">
              <i className="ri-phone-line text-2xl text-emerald-700" aria-hidden="true"></i>
              <p className="font-semibold text-gray-900 mt-2">Call us</p>
              <p className="text-sm text-gray-600">{STORE_PHONE}</p>
            </a>
            <a href={`mailto:${STORE_EMAIL}`} className="p-4 border-2 border-gray-200 rounded-lg hover:border-emerald-700 transition-colors">
              <i className="ri-mail-line text-2xl text-emerald-700" aria-hidden="true"></i>
              <p className="font-semibold text-gray-900 mt-2">Email</p>
              <p className="text-sm text-gray-600 break-all">{STORE_EMAIL}</p>
            </a>
            <Link href="/support/ticket" className="p-4 border-2 border-gray-200 rounded-lg hover:border-emerald-700 transition-colors">
              <i className="ri-ticket-line text-2xl text-emerald-700" aria-hidden="true"></i>
              <p className="font-semibold text-gray-900 mt-2">Support ticket</p>
              <p className="text-sm text-gray-600">For signed-in customers</p>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

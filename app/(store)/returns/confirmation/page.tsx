'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const REF_RE = /^RET-[A-Z0-9]{8}$/;

function ConfirmationContent() {
  const searchParams = useSearchParams();
  const rawRef = (searchParams.get('ref') || '').toUpperCase();
  const reference = REF_RE.test(rawRef) ? rawRef : '';
  const existing = searchParams.get('existing') === '1';

  if (!reference) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">No return request to show</h1>
        <p className="text-gray-600 mb-6">Start a return from the returns page to get a reference.</p>
        <Link
          href="/returns"
          className="inline-block bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          Start a return
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg p-8 text-center">
      <div className="w-20 h-20 flex items-center justify-center bg-emerald-100 rounded-full mx-auto mb-6">
        <i className="ri-check-line text-4xl text-emerald-700" aria-hidden="true"></i>
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-4">
        {existing ? 'We already have your request' : 'Return request received'}
      </h1>
      <p className="text-gray-600 mb-2">
        {existing
          ? 'There is already an open return request for this order, so we did not create another one.'
          : 'We received your request and will contact you within 2 working days.'}
      </p>
      <p className="text-sm text-gray-500 mb-8">
        Your reference: <span className="font-semibold text-gray-900">{reference}</span>
      </p>

      <div className="mb-8 p-6 bg-emerald-50 border border-emerald-200 rounded-xl text-left">
        <h2 className="font-bold text-gray-900 mb-3">What happens next</h2>
        <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li>Our team reviews your request.</li>
          <li>We contact you by phone, WhatsApp or email to agree how the item comes back to us.</li>
          <li>Please keep the item and its packaging until we have spoken.</li>
          <li>Quote your reference if you call or WhatsApp us on <a href="tel:0248615775" className="font-semibold text-emerald-800 underline">0248615775</a>.</li>
        </ul>
      </div>

      <div className="space-y-3">
        <Link
          href="/shop"
          className="block w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-lg font-semibold transition-colors"
        >
          Continue shopping
        </Link>
        <Link
          href="/contact"
          className="block text-emerald-700 hover:text-emerald-900 font-semibold"
        >
          Need help? Contact us
        </Link>
      </div>
    </div>
  );
}

export default function ReturnConfirmationPage() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12">
      <div className="max-w-2xl w-full mx-auto px-4">
        <Suspense fallback={<div className="py-16 text-center text-gray-500">Loading…</div>}>
          <ConfirmationContent />
        </Suspense>
      </div>
    </main>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const REASONS = [
  'Wrong item received',
  'Item damaged or not working',
  'Wrong size or fit',
  'Not as described',
  'Changed my mind',
  'Other',
];

type FoundOrder = {
  orderNumber: string;
  createdAt: string;
  items: { name: string; quantity: number }[];
};

const inputCls =
  'w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500';

export default function ReturnsPortalPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [orderNumber, setOrderNumber] = useState('');
  const [contactType, setContactType] = useState<'email' | 'phone'>('email');
  const [contact, setContact] = useState('');
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [foundOrder, setFoundOrder] = useState<FoundOrder | null>(null);

  const requestBody = (extra: Record<string, unknown>) => ({
    orderNumber: orderNumber.trim(),
    ...(contactType === 'email' ? { email: contact.trim() } : { phone: contact.trim() }),
    ...extra,
  });

  const handleFindOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const res = await fetch('/api/storefront/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody({ lookupOnly: true })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'We could not find that order. Please check and try again.');
        return;
      }
      setFoundOrder(data.order);
      setStep(2);
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const res = await fetch('/api/storefront/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody({ reason, description: description.trim() })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reference) {
        setError(data.error || 'We could not send your request. Please try again.');
        return;
      }
      router.push(`/returns/confirmation?ref=${encodeURIComponent(data.reference)}${data.duplicate ? '&existing=1' : ''}`);
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const steps = ['Find order', 'Tell us why', 'Done'];

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Returns</h1>
        <p className="text-gray-600 mb-8">Tell us about a problem with your order and we will sort it out with you.</p>

        <ol className="mb-8 flex items-center" aria-label="Progress">
          {steps.map((label, idx) => {
            const i = idx + 1;
            return (
              <li key={label} className="flex items-center flex-1 last:flex-none" aria-current={i === step ? 'step' : undefined}>
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-10 h-10 flex items-center justify-center rounded-full font-bold ${i <= step ? 'bg-emerald-700 text-white' : 'bg-gray-200 text-gray-500'}`}>
                    {i < step ? <i className="ri-check-line" aria-hidden="true"></i> : i}
                  </div>
                  <span className="text-xs sm:text-sm font-semibold text-gray-900 whitespace-nowrap">{label}</span>
                </div>
                {i < steps.length && (
                  <div className={`flex-1 h-1 mx-2 sm:mx-4 mb-6 ${i < step ? 'bg-emerald-700' : 'bg-gray-200'}`}></div>
                )}
              </li>
            );
          })}
        </ol>

        {error && (
          <div role="alert" className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-start gap-2">
            <i className="ri-error-warning-line mt-0.5" aria-hidden="true"></i>
            <span>{error}</span>
          </div>
        )}

        {step === 1 && (
          <div className="bg-white rounded-xl shadow-sm p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Find your order</h2>
            <form onSubmit={handleFindOrder} className="space-y-6">
              <div>
                <label htmlFor="return-order" className="block text-sm font-semibold text-gray-900 mb-2">
                  Order number *
                </label>
                <input
                  id="return-order"
                  type="text"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  className={inputCls}
                  placeholder="As shown in your order confirmation"
                  autoComplete="off"
                  required
                />
              </div>

              <fieldset>
                <legend className="block text-sm font-semibold text-gray-900 mb-2">Contact used on the order *</legend>
                <div className="flex gap-2 mb-3">
                  {(['email', 'phone'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={contactType === type}
                      onClick={() => { setContactType(type); setContact(''); }}
                      className={`px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-colors ${contactType === type ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'border-gray-300 text-gray-700 hover:border-gray-400'}`}
                    >
                      {type === 'email' ? 'Email' : 'Phone'}
                    </button>
                  ))}
                </div>
                <label htmlFor="return-contact" className="sr-only">
                  {contactType === 'email' ? 'Email address' : 'Phone number'}
                </label>
                <input
                  id="return-contact"
                  type={contactType === 'email' ? 'email' : 'tel'}
                  inputMode={contactType === 'email' ? 'email' : 'tel'}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  className={inputCls}
                  placeholder={contactType === 'email' ? 'you@example.com' : '024 123 4567'}
                  autoComplete={contactType === 'email' ? 'email' : 'tel'}
                  required
                />
              </fieldset>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Checking your order…' : 'Find order'}
              </button>
            </form>

            <div className="mt-8 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <div className="flex items-start space-x-3">
                <i className="ri-information-line text-xl text-emerald-700 mt-0.5" aria-hidden="true"></i>
                <div className="text-sm text-emerald-800">
                  <p className="font-semibold mb-1">How returns work</p>
                  <ul className="space-y-1 list-disc pl-4">
                    <li>Start a request within 14 days of receiving your order.</li>
                    <li>Items should be unused and in their original packaging, unless they arrived damaged or wrong.</li>
                    <li>We will contact you within 2 working days to agree the next step.</li>
                    <li>
                      Questions? Call or WhatsApp <a href="tel:0248615775" className="font-semibold underline">0248615775</a>.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && foundOrder && (
          <form onSubmit={handleSubmitReturn} className="bg-white rounded-xl shadow-sm p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Tell us what went wrong</h2>

            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-2">
                Order {foundOrder.orderNumber} · placed{' '}
                {new Date(foundOrder.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
              <ul className="text-sm text-gray-900 space-y-1">
                {foundOrder.items.map((item, i) => (
                  <li key={i}>{item.name} × {item.quantity}</li>
                ))}
              </ul>
            </div>

            <div className="mb-6">
              <label htmlFor="return-reason" className="block text-sm font-semibold text-gray-900 mb-2">
                Reason *
              </label>
              <select
                id="return-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={`${inputCls} pr-8 bg-white`}
                required
              >
                <option value="">Choose a reason</option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="mb-8">
              <label htmlFor="return-description" className="block text-sm font-semibold text-gray-900 mb-2">
                Which item, and what happened? *
              </label>
              <textarea
                id="return-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                maxLength={2000}
                minLength={5}
                className={inputCls}
                placeholder="For example: the blue dress arrived in size M but I ordered L."
                required
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-3 sm:gap-4">
              <button
                type="button"
                onClick={() => { setStep(1); setError(''); }}
                className="flex-1 py-4 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isLoading || !reason || description.trim().length < 5}
                className="flex-1 py-4 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Sending…' : 'Send return request'}
              </button>
            </div>
          </form>
        )}

        <p className="mt-8 text-sm text-gray-600 text-center">
          Want to check where an order is instead? <Link href="/order-tracking" className="text-emerald-700 font-semibold hover:underline">Track your order</Link>
        </p>
      </div>
    </main>
  );
}

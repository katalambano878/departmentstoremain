'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { usePageTitle } from '@/hooks/usePageTitle';

export default function PaymentPage() {
  usePageTitle('Complete Payment');
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = params.orderId as string;
  const initFailed = searchParams.get('init') === 'failed';
  const stockEmpty = searchParams.get('stock') === 'empty';

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stockIssues, setStockIssues] = useState<{ name: string; variant?: string }[]>([]);
  const [allOutOfStock, setAllOutOfStock] = useState(stockEmpty);
  const [removedNotice, setRemovedNotice] = useState<{ items: { name: string; variant?: string }[]; newTotal: number } | null>(null);

  useEffect(() => {
    async function fetchOrder() {
      try {
        // SECURITY: Fetch via server route that only returns payment-summary fields.
        // The direct supabase query here was leaking full order PII via RLS.
        const res = await fetch(`/api/storefront/orders/${encodeURIComponent(orderId)}/payment-summary`, {
          method: 'GET',
          cache: 'no-store',
        });

        if (res.status === 404) {
          setError('Order not found. Please check your link and try again.');
          setLoading(false);
          return;
        }

        if (!res.ok) {
          setError('Failed to load order details.');
          setLoading(false);
          return;
        }

        const { order: data } = await res.json();
        if (!data) {
          setError('Order not found. Please check your link and try again.');
          setLoading(false);
          return;
        }

        setOrder(data);

        if (data.payment_status === 'paid') {
          router.push(`/order-success?order=${data.order_number}`);
          return;
        }

        const stockRes = await fetch(`/api/orders/${data.id}/validate-stock`);
        if (stockRes.ok) {
          const stockData = await stockRes.json();
          if (!stockData.valid) {
            setStockIssues(stockData.outOfStock ?? []);
          }
        }

      } catch (err) {
        console.error('Error fetching order:', err);
        setError('Failed to load order details.');
      } finally {
        setLoading(false);
      }
    }

    if (orderId) {
      fetchOrder();
    }
  }, [orderId, router]);

  const handlePayNow = async () => {
    if (!order) return;

    setProcessing(true);
    setError(null);
    setRemovedNotice(null);

    try {
      // The server re-reads amount and email from the DB. It needs the order
      // number plus the order's uuid as proof that this page loaded the order.
      const paymentRes = await fetch('/api/payment/hubtel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.order_number,
          orderUuid: order.id,
        })
      });

      const paymentResult = await paymentRes.json();

      // Every remaining item went out of stock — nothing to pay for.
      if (paymentResult?.all_out_of_stock) {
        setAllOutOfStock(true);
        setStockIssues(paymentResult.outOfStock ?? []);
        setProcessing(false);
        return;
      }

      if (!paymentResult.success) {
        throw new Error(paymentResult.message || 'Payment initialization failed');
      }

      // Server auto-removed some items — show the customer what happened
      // and let them confirm before redirecting to the gateway.
      if (Array.isArray(paymentResult.removedItems) && paymentResult.removedItems.length > 0) {
        setRemovedNotice({
          items: paymentResult.removedItems,
          newTotal: Number(paymentResult.amount ?? 0)
        });
        setStockIssues([]);
        setOrder((prev: any) => prev ? { ...prev, total: Number(paymentResult.amount ?? prev.total) } : prev);
      }

      // Redirect to Hubtel hosted checkout
      window.location.href = paymentResult.url;

    } catch (err: any) {
      console.error('Payment error:', err);
      setError(err.message || 'Failed to initialize payment. Please try again.');
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-emerald-200 border-t-emerald-700 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading order details...</p>
        </div>
      </main>
    );
  }

  if (error && !order) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 bg-red-50 rounded-full flex items-center justify-center">
            <i className="ri-error-warning-line text-4xl text-red-500"></i>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Order Not Found</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link
            href="/"
            className="inline-flex items-center px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold transition-colors"
          >
            <i className="ri-home-line mr-2"></i>
            Go to Homepage
          </Link>
        </div>
      </main>
    );
  }

  const shippingAddress = order?.shipping_address || {};
  const customerName = order?.metadata?.first_name || shippingAddress.firstName || 'Customer';

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <span className="text-2xl font-['Pacifico'] text-emerald-700">DDZ</span>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Complete Your Payment</h1>
          <p className="text-gray-600 mt-2">Hi {customerName}, your order is waiting for payment.</p>
        </div>

        {/* Order Summary Card */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-100">
            <span className="text-sm text-gray-500">Order Number</span>
            <span className="font-semibold text-gray-900">{order?.order_number}</span>
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Subtotal</span>
              <span className="text-gray-900">GH₵ {order?.subtotal?.toFixed(2)}</span>
            </div>
            {order?.shipping_method === 'pickup' ? (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Store Pickup</span>
                <span className="text-emerald-700 font-semibold">Free</span>
              </div>
            ) : (
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Delivery</span>
                  <span className="text-amber-600 font-semibold">At a Cost</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  The rider will tell you the delivery fee at hand-off.
                </p>
              </div>
            )}
            {order?.discount_total > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Discount</span>
                <span className="text-green-600">-GH₵ {order?.discount_total?.toFixed(2)}</span>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-gray-200">
            <span className="text-lg font-semibold text-gray-900">Total</span>
            <span className="text-2xl font-bold text-emerald-700">GH₵ {order?.total?.toFixed(2)}</span>
          </div>
        </div>

        {/* Payment Status */}
        {initFailed && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <i className="ri-information-line text-xl text-emerald-600 mt-0.5"></i>
              <div>
                <p className="text-sm font-semibold text-emerald-800">Order saved successfully</p>
                <p className="text-sm text-emerald-700 mt-1">
                  We could not open the payment gateway from checkout. Tap the button below to continue payment.
                </p>
              </div>
            </div>
          </div>
        )}

        {order?.payment_status === 'pending' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <i className="ri-time-line text-xl text-yellow-600 mt-0.5"></i>
              <div>
                <p className="text-sm font-semibold text-yellow-800">Payment Pending</p>
                <p className="text-sm text-yellow-700 mt-1">
                  Complete your payment to confirm your order.
                </p>
              </div>
            </div>
          </div>
        )}

        {order?.payment_status === 'failed' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <i className="ri-error-warning-line text-xl text-red-600 mt-0.5"></i>
              <div>
                <p className="text-sm font-semibold text-red-800">Payment Failed</p>
                <p className="text-sm text-red-700 mt-1">
                  Your previous payment attempt was unsuccessful. Please try again.
                </p>
              </div>
            </div>
          </div>
        )}

        {allOutOfStock && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <i className="ri-close-circle-line text-xl text-red-600 mt-0.5 flex-shrink-0"></i>
              <div>
                <p className="text-sm font-semibold text-red-800 mb-1">All items in this order are unavailable</p>
                <p className="text-sm text-red-700">
                  The items in your order have gone out of stock. Please reach out to our support team for assistance.
                </p>
                {stockIssues.length > 0 && (
                  <ul className="text-sm text-red-800 space-y-1 mt-2">
                    {stockIssues.map((issue, i) => (
                      <li key={i} className="flex items-center space-x-1">
                        <i className="ri-close-circle-line text-red-500"></i>
                        <span>{issue.name}{issue.variant ? ` — ${issue.variant}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {!allOutOfStock && stockIssues.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <i className="ri-information-line text-xl text-orange-600 mt-0.5 flex-shrink-0"></i>
              <div>
                <p className="text-sm font-semibold text-orange-800 mb-1">Some items went out of stock</p>
                <p className="text-sm text-orange-700 mb-2">
                  The following item(s) will be removed automatically when you tap Pay so you can checkout with the remaining items:
                </p>
                <ul className="text-sm text-orange-800 space-y-1">
                  {stockIssues.map((issue, i) => (
                    <li key={i} className="flex items-center space-x-1">
                      <i className="ri-close-circle-line text-orange-500"></i>
                      <span>{issue.name}{issue.variant ? ` — ${issue.variant}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {removedNotice && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <i className="ri-check-line text-xl text-emerald-600 mt-0.5 flex-shrink-0"></i>
              <div>
                <p className="text-sm font-semibold text-emerald-800 mb-1">Order updated</p>
                <p className="text-sm text-emerald-700 mb-2">
                  Out-of-stock item(s) were removed and your new total is <strong>GH₵ {removedNotice.newTotal.toFixed(2)}</strong>. Redirecting you to payment…
                </p>
                <ul className="text-sm text-emerald-800 space-y-1">
                  {removedNotice.items.map((it, i) => (
                    <li key={i} className="flex items-center space-x-1">
                      <i className="ri-close-circle-line text-emerald-400"></i>
                      <span>{it.name}{it.variant ? ` — ${it.variant}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Pay Button */}
        <button
          onClick={handlePayNow}
          disabled={processing || allOutOfStock}
          className={`w-full py-4 rounded-xl font-semibold text-lg transition-colors disabled:opacity-70 flex items-center justify-center cursor-pointer ${allOutOfStock ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-emerald-700 hover:bg-emerald-800 text-white'}`}
        >
          {processing ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processing...
            </>
          ) : (
            <>
              <i className="ri-secure-payment-line mr-2"></i>
              Pay GH₵ {order?.total?.toFixed(2)} with Mobile Money
            </>
          )}
        </button>

        {/* Security Note */}
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500 flex items-center justify-center">
            <i className="ri-lock-line mr-1"></i>
            Secure payment powered by Hubtel
          </p>
        </div>

        {/* Help Link */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-600">
            Having issues? <Link href="/contact" className="text-emerald-700 hover:underline">Contact Support</Link>
          </p>
        </div>
      </div>
    </main>
  );
}

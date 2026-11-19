'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect } from 'react';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 150 150'><rect width='150' height='150' fill='%23f3f4f6'/><path d='M50 95l18-22 14 16 10-12 18 18z' fill='%23d1d5db'/><circle cx='60' cy='58' r='8' fill='%23d1d5db'/></svg>";

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get('order');
  const paymentSuccess = searchParams.get('payment_success');
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    async function fetchOrder() {
      if (!orderNumber) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/storefront/orders/${encodeURIComponent(orderNumber)}/summary`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const { order: orderData } = await res.json();
        setOrder(orderData);

        // Never trust the redirect alone: if the order is not marked paid yet,
        // poll and ask the gateway before showing a confirmation.
        if (orderData && orderData.payment_status !== 'paid' && paymentSuccess === 'true') {
          verifyPayment(orderNumber, orderData.email);
        }
      } catch (err) {
        console.error('Error fetching order:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchOrder();
  }, [orderNumber]);

  // Payment verification - called when user is redirected from Moolre with payment_success=true
  const verifyPayment = async (orderNum: string, orderEmail: string) => {
    setVerifying(true);

    const fetchSummary = async () => {
      try {
        const res = await fetch(`/api/storefront/orders/${encodeURIComponent(orderNum)}/summary`, {
          cache: 'no-store',
        });
        if (!res.ok) return null;
        const { order: ord } = await res.json();
        return ord;
      } catch {
        return null;
      }
    };

    // Poll: give the callback up to ~12 seconds to fire before falling back.
    const pollIntervals = [3000, 4000, 5000];
    for (const delay of pollIntervals) {
      await new Promise(resolve => setTimeout(resolve, delay));
      const refreshed = await fetchSummary();
      if (refreshed?.payment_status === 'paid') {
        setOrder(refreshed);
        setVerifying(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/payment/hubtel/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: orderNum, email: orderEmail })
      });

      const result = await res.json();
      console.log('Payment verification result:', result);

      if (result.success && result.payment_status === 'paid') {
        const updated = await fetchSummary();
        if (updated) setOrder(updated);
      }
    } catch (err) {
      console.error('Payment verification failed:', err);
    } finally {
      setVerifying(false);
    }
  };

  if (loading || verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" role="status" aria-live="polite">
        <div className="text-center">
          <i className="ri-loader-4-line text-4xl text-emerald-700 animate-spin mb-4 block" aria-hidden="true"></i>
          <p className="text-gray-700 font-semibold">
            {verifying ? 'Checking your payment…' : 'Loading order details…'}
          </p>
          {verifying && (
            <p className="mt-2 text-sm text-gray-500">This can take a few seconds. Please don&apos;t close this page.</p>
          )}
        </div>
      </div>
    );
  }

  // Use a fallback or nice error if order not found
  if (!order) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <i className="ri-error-warning-line text-4xl text-red-500 mb-4 block"></i>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Order Not Found</h1>
          <p className="text-gray-600 mb-6">We couldn't locate the order details.</p>
          <Link href="/shop" className="text-emerald-700 font-semibold hover:underline">
            Return to Shop
          </Link>
        </div>
      </main>
    );
  }

  const orderCreatedAt = new Date(order.created_at);
  const orderDate = orderCreatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const addCalendarDays = (base: Date, days: number) => {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + days);
    return d;
  };
  const deliveryEarliest = addCalendarDays(orderCreatedAt, 1);
  const deliveryLatest = addCalendarDays(orderCreatedAt, 3);
  const formatDeliveryDate = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const estimatedDeliveryRange = `${formatDeliveryDate(deliveryEarliest)} – ${formatDeliveryDate(deliveryLatest)}`;
  const isPaid = order.payment_status === 'paid';
  // Cash-style orders are confirmed without an online payment.
  const isOfflinePayment = order.payment_method && order.payment_method !== 'hubtel' && order.payment_method !== 'moolre';
  const isConfirmed = isPaid || (isOfflinePayment && order.payment_status !== 'failed');
  const payLink = `/pay/${encodeURIComponent(order.order_number || order.id)}`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-emerald-50">
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 md:p-12 text-center mb-8">
            {isConfirmed ? (
              <>
                <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6 bg-emerald-100 rounded-full">
                  <i className="ri-checkbox-circle-fill text-6xl text-emerald-600" aria-hidden="true"></i>
                </div>

                <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">Order Confirmed</h1>
                <p className="text-lg sm:text-xl text-gray-600 mb-8">
                  {isPaid
                    ? 'Thank you. Your payment went through and we are preparing your order.'
                    : 'Thank you. We have your order and will be in touch about payment.'}
                </p>
              </>
            ) : (
              <>
                <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6 bg-amber-100 rounded-full">
                  <i className="ri-error-warning-fill text-6xl text-amber-600" aria-hidden="true"></i>
                </div>

                <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">Payment not completed</h1>
                <p className="text-lg sm:text-xl text-gray-600 mb-6">
                  {order.payment_status === 'failed'
                    ? 'Your payment did not go through, so we have not started on this order yet.'
                    : 'We have not received payment for this order yet. If you just paid, it can take a minute to show here.'}
                </p>
                <Link
                  href={payLink}
                  className="mb-8 inline-flex items-center justify-center rounded-lg bg-emerald-700 px-8 py-4 font-semibold text-white transition-colors hover:bg-emerald-800"
                >
                  <i className="ri-secure-payment-line mr-2" aria-hidden="true"></i>
                  Complete payment
                </Link>
              </>
            )}

            <div className="bg-emerald-50 rounded-xl p-6 mb-8">
              <div className="grid md:grid-cols-3 gap-6 text-center">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Order Number</p>
                  <p className="text-lg font-bold text-gray-900">{order.order_number}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Order Date</p>
                  <p className="text-lg font-bold text-gray-900">{orderDate}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Estimated Delivery</p>
                  <p className="text-lg font-bold text-emerald-700">1–3 days</p>
                  <p className="text-xs text-gray-600 mt-1 leading-snug">from your order date</p>
                  <p className="text-xs text-gray-500 mt-1 leading-snug">{estimatedDeliveryRange}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <Link
                href={`/account?tab=orders`}
                className="bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-4 rounded-lg font-semibold transition-colors inline-flex items-center justify-center whitespace-nowrap"
              >
                <i className="ri-file-list-3-line mr-2"></i>
                View Order
              </Link>
              <Link
                href="/shop"
                className="border-2 border-gray-300 hover:border-gray-400 text-gray-700 px-8 py-4 rounded-lg font-semibold transition-colors inline-flex items-center justify-center whitespace-nowrap"
              >
                <i className="ri-shopping-bag-line mr-2"></i>
                Continue Shopping
              </Link>
            </div>

            <p className="text-sm text-gray-500">
              Want to see your orders in one place?{' '}
              <Link href="/auth/signup" className="font-semibold text-emerald-700 hover:underline">
                Create an account
              </Link>{' '}
              with the same email.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 mb-8">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Order Items</h2>
              <div className="space-y-4">
                {order.order_items.map((item: any) => (
                  <div key={item.id} className="flex items-center space-x-4">
                    <div className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 border border-gray-200">
                      <img
                        src={getOptimizedImageUrl(
                          item.metadata?.image || PLACEHOLDER_IMAGE,
                          { width: 160 }
                        )}
                        alt={item.product_name}
                        className="w-full h-full object-cover object-center"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 line-clamp-2">{item.product_name}</p>
                      <p className="text-sm text-gray-600">Quantity: {item.quantity}</p>
                      {item.variant_name && (
                        <p className="text-xs text-gray-500">{item.variant_name}</p>
                      )}
                      {item.metadata?.preorder_shipping && (
                        <p className="text-xs text-amber-700 bg-amber-50 inline-flex items-center gap-1 px-2 py-0.5 rounded mt-1 border border-amber-200">
                          <i className="ri-time-line"></i> {item.metadata.preorder_shipping}
                        </p>
                      )}
                    </div>
                    <p className="font-bold text-gray-900">GH₵{Number(item.unit_price).toFixed(2)}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-200 mt-4 pt-4">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>Subtotal</span>
                  <span>GH₵{Number(order.subtotal).toFixed(2)}</span>
                </div>
                {Number(order.discount_total) > 0 && (
                  <div className="flex justify-between text-sm text-emerald-700 mb-2">
                    <span>Discount</span>
                    <span>− GH₵{Number(order.discount_total).toFixed(2)}</span>
                  </div>
                )}
                {order.shipping_method === 'pickup' ? (
                  <div className="flex justify-between text-sm text-gray-600 mb-2">
                    <span>Store Pickup</span>
                    <span className="text-emerald-700 font-semibold">Free</span>
                  </div>
                ) : (
                  <div className="mb-2">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Delivery</span>
                      <span className="text-amber-600 font-semibold">At a Cost</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      The rider will tell you the delivery fee at hand-off.
                    </p>
                  </div>
                )}

                <div className="flex justify-between text-xl font-bold text-gray-900 border-t border-gray-200 pt-2">
                  <span>{isPaid ? 'Total Paid' : 'Total to Pay'}</span>
                  <span>GH₵{Number(order.total).toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Delivery Details</h2>
              <div className="space-y-3">
                {order.shipping_address && (
                  <>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Recipient</p>
                      <p className="font-semibold text-gray-900">
                        {order.shipping_address.firstName} {order.shipping_address.lastName}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Address</p>
                      <p className="text-gray-900">{order.shipping_address.address}</p>
                      <p className="text-gray-900">{order.shipping_address.city}, {order.shipping_address.region}</p>
                      {order.shipping_address.postalCode && (
                        <p className="text-gray-900">{order.shipping_address.postalCode}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Phone</p>
                      <p className="text-gray-900">{order.phone}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Email</p>
                      <p className="text-gray-900">{order.email}</p>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-3">What's Next?</h3>
                <div className="space-y-3">
                  <div className="flex items-start space-x-3">
                    <i className="ri-mail-line text-emerald-700 mt-1"></i>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Email Confirmation</p>
                      <p className="text-sm text-gray-600">
                        {isPaid ? `Sent to ${order.email}` : `Sent to ${order.email} once payment is received`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <i className="ri-box-3-line text-emerald-700 mt-1"></i>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Processing</p>
                      <p className="text-sm text-gray-600">
                        {isPaid ? 'We start packing once your payment is confirmed' : 'We start packing after payment'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <i className="ri-truck-line text-emerald-700 mt-1"></i>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Shipping Updates</p>
                      <p className="text-sm text-gray-600">Track via email & SMS</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className="text-gray-600 mb-4">Need help with your order?</p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/contact" className="text-emerald-700 hover:text-emerald-900 font-semibold whitespace-nowrap">
                <i className="ri-customer-service-line mr-1"></i>
                Contact Support
              </Link>
              <Link href="/account?tab=orders" className="text-emerald-700 hover:text-emerald-900 font-semibold whitespace-nowrap">
                <i className="ri-question-line mr-1"></i>
                Order Help
              </Link>
              <Link href="/returns" className="text-emerald-700 hover:text-emerald-900 font-semibold whitespace-nowrap">
                <i className="ri-arrow-left-right-line mr-1"></i>
                Returns Policy
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-emerald-700 border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <OrderSuccessContent />
    </Suspense>
  );
}

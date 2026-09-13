'use client';

import Link from 'next/link';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { orderLineItemImageUrl } from '@/lib/orderLineItemImage';

function OrderTrackingContent() {
  const searchParams = useSearchParams();
  // Pre-fill order number from URL if present — but never auto-submit without email
  const urlOrderNumber = searchParams.get('order') || '';

  const [orderNumber, setOrderNumber] = useState(urlOrderNumber);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchOrder = async () => {
    const orderNum = orderNumber.trim();
    const emailVal = email.trim();
    const phoneVal = phone.trim();

    if (!orderNum && !emailVal && !phoneVal) {
      setError('Enter your email, order number, or phone number.');
      return;
    }

    setLoading(true);
    setError('');
    setMatches([]);

    try {
      const res = await fetch('/api/storefront/orders/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: orderNum || undefined,
          email: emailVal || undefined,
          phone: phoneVal || undefined,
        }),
      });

      if (res.status === 429) {
        setError('Too many requests. Please try again in a moment.');
        setIsTracking(false);
        return;
      }

      if (res.status === 404) {
        setError('No order found. Check your email, order number, or phone and try again.');
        setIsTracking(false);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Something went wrong. Please try again.');
        setIsTracking(false);
        return;
      }

      const body = await res.json();
      const orders = Array.isArray(body.orders)
        ? body.orders
        : body.order
          ? [body.order]
          : [];

      if (orders.length === 0) {
        setError('No order found. Check your email, order number, or phone and try again.');
        setIsTracking(false);
        return;
      }

      if (orders.length === 1) {
        setOrder(orders[0]);
        setMatches([]);
      } else {
        setMatches(orders);
        setOrder(null);
      }
      setIsTracking(true);
    } catch (err) {
      console.error('Error fetching order:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleTrack = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    fetchOrder();
  };

  // Build tracking timeline from real order data
  const getTrackingSteps = () => {
    if (!order) return [];

    const status = order.status || 'pending';
    const normalizedStatus = status === 'completed' ? 'delivered' : status;
    const paymentStatus = order.payment_status || 'pending';

    const statusOrder = ['pending', 'processing', 'shipped', 'picked_up', 'delivered'];
    const currentIndex = statusOrder.indexOf(normalizedStatus);

    const steps = [
      {
        key: 'placed',
        title: 'Order Placed',
        description: 'Your order has been confirmed',
        date: new Date(order.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        icon: 'ri-checkbox-circle-line',
        status: 'completed' as const
      },
      {
        key: 'payment',
        title: 'Payment',
        description: paymentStatus === 'paid' ? 'Payment confirmed' : 'Awaiting payment',
        date: paymentStatus === 'paid' 
          ? (order.metadata?.payment_verified_at 
            ? new Date(order.metadata.payment_verified_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : 'Confirmed')
          : 'Pending',
        icon: 'ri-bank-card-line',
        status: paymentStatus === 'paid' ? 'completed' as const : 'pending' as const
      },
      {
        key: 'processing',
        title: 'Processing',
        description: 'Your order is being prepared',
        date: currentIndex >= 1 ? 'In progress' : 'Pending',
        icon: 'ri-box-3-line',
        status: currentIndex >= 1 ? 'completed' as const : currentIndex === 0 && paymentStatus === 'paid' ? 'active' as const : 'pending' as const
      },
      {
        key: 'shipped',
        title: 'Packaged',
        description: 'Your order has been packaged',
        date: currentIndex >= 2 ? 'Packaged' : 'Pending',
        icon: 'ri-truck-line',
        status: currentIndex >= 2 ? 'completed' as const : currentIndex === 1 ? 'active' as const : 'pending' as const
      },
      {
        key: 'picked_up',
        title: 'Picked Up by Rider',
        description: 'Package has been picked up by the rider',
        date: currentIndex >= 3 ? 'Picked up' : 'Pending',
        icon: 'ri-e-bike-2-line',
        status: currentIndex >= 3 ? 'completed' as const : currentIndex === 2 ? 'active' as const : 'pending' as const
      },
      {
        key: 'delivered',
        title: 'Delivered',
        description: 'Your order has been delivered',
        date: currentIndex >= 4 ? 'Delivered' : 'Pending',
        icon: 'ri-home-smile-line',
        status: currentIndex >= 4 ? 'completed' as const : currentIndex === 3 ? 'active' as const : 'pending' as const
      }
    ];

    return steps;
  };

  const getStatusBadge = () => {
    if (!order) return { label: 'Unknown', color: 'bg-gray-100 text-gray-800' };
    
    const statusMap: Record<string, { label: string; color: string }> = {
      'pending': { label: 'Pending', color: 'bg-amber-100 text-amber-800' },
      'processing': { label: 'Processing', color: 'bg-emerald-100 text-emerald-800' },
      'shipped': { label: 'Packaged', color: 'bg-purple-100 text-purple-800' },
      'picked_up': { label: 'Picked Up by Rider', color: 'bg-emerald-100 text-emerald-800' },
      'completed': { label: 'Completed', color: 'bg-emerald-100 text-emerald-800' },
      'delivered': { label: 'Delivered', color: 'bg-emerald-100 text-emerald-800' },
      'cancelled': { label: 'Cancelled', color: 'bg-red-100 text-red-800' }
    };

    return statusMap[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-800' };
  };

  // Search form
  if (!isTracking || (!order && matches.length === 0)) {
    return (
      <main className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Track Your Order</h1>
            <p className="text-gray-600">Use your email, order number, or phone number — any one is enough</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-8">
            <form onSubmit={handleTrack} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Order Number
                </label>
                <input
                  type="text"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="e.g. ORD-1770328211911-915"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="e.g. 0248615775"
                />
              </div>

              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <i className="ri-loader-4-line animate-spin mr-2"></i>
                    Searching...
                  </span>
                ) : 'Track Order'}
              </button>
            </form>

            <div className="mt-8 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <div className="flex items-start space-x-3">
                <i className="ri-information-line text-xl text-emerald-700 mt-0.5"></i>
                <div>
                  <p className="text-sm font-semibold text-emerald-900">Need Help?</p>
                  <p className="text-sm text-emerald-700 mt-1">
                    Fill in any one field — the email, order number, or phone you used at checkout. You can find these in the SMS or email we sent after your order was confirmed.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 text-center">
            <Link href="/" className="text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap">
              <i className="ri-arrow-left-line mr-2"></i>
              Back to Home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const resetSearch = () => {
    setIsTracking(false);
    setOrder(null);
    setMatches([]);
    setOrderNumber('');
    setEmail('');
    setPhone('');
    setError('');
  };

  // Multiple matches — pick one
  if (isTracking && !order && matches.length > 1) {
    return (
      <main className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={resetSearch}
            className="text-gray-600 hover:text-gray-900 font-medium inline-flex items-center whitespace-nowrap cursor-pointer mb-6"
          >
            <i className="ri-arrow-left-line mr-2"></i>
            New search
          </button>
          <div className="bg-white rounded-xl shadow-sm p-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">We found {matches.length} orders</h1>
            <p className="text-gray-600 mb-6">Select an order to see its tracking status.</p>
            <div className="space-y-3">
              {matches.map((item) => {
                const statusMap: Record<string, { label: string; color: string }> = {
                  pending: { label: 'Pending', color: 'bg-amber-100 text-amber-800' },
                  processing: { label: 'Processing', color: 'bg-emerald-100 text-emerald-800' },
                  shipped: { label: 'Packaged', color: 'bg-purple-100 text-purple-800' },
                  picked_up: { label: 'Picked Up by Rider', color: 'bg-emerald-100 text-emerald-800' },
                  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-800' },
                  delivered: { label: 'Delivered', color: 'bg-emerald-100 text-emerald-800' },
                  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800' },
                };
                const badge = statusMap[item.status] || { label: item.status, color: 'bg-gray-100 text-gray-800' };
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setOrder(item)}
                    className="w-full text-left p-4 rounded-xl border-2 border-gray-200 hover:border-emerald-500 hover:bg-emerald-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-gray-900">{item.order_number}</p>
                        <p className="text-sm text-gray-500 mt-1">
                          {new Date(item.created_at).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                          {' · '}
                          {item.order_items?.length || 0} item{(item.order_items?.length || 0) !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${badge.color}`}>
                          {badge.label}
                        </span>
                        <p className="text-sm font-semibold text-gray-900 mt-2">
                          GH₵ {Number(item.total).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Order tracking results
  const trackingSteps = getTrackingSteps();
  const statusBadge = getStatusBadge();
  const trackingNumber = order.metadata?.tracking_number || '';
  const shippingAddress = order.shipping_address || {};
  const createdAt = new Date(order.created_at);
  const addDays = (n: number) => {
    const d = new Date(createdAt.getTime());
    d.setDate(d.getDate() + n);
    return d;
  };
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const estimatedDeliveryText = `1–3 days from order date (${fmt(addDays(1))} – ${fmt(addDays(3))})`;

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <button 
            onClick={() => {
              if (matches.length > 1) {
                setOrder(null);
                return;
              }
              resetSearch();
            }}
            className="text-gray-600 hover:text-gray-900 font-medium inline-flex items-center whitespace-nowrap cursor-pointer"
          >
            <i className="ri-arrow-left-line mr-2"></i>
            {matches.length > 1 ? 'Back to orders' : 'Track Another Order'}
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-8 mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{order.order_number}</h1>
              {trackingNumber && (
                <p className="text-gray-600 mt-1">
                  <span className="font-medium">Tracking:</span>{' '}
                  <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-sm">{trackingNumber}</span>
                </p>
              )}
              <p className="text-gray-500 text-sm mt-1">Estimated delivery: {estimatedDeliveryText}</p>
            </div>
            <div className={`px-4 py-2 rounded-full font-semibold whitespace-nowrap ${statusBadge.color}`}>
              {statusBadge.label}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 flex items-center justify-center bg-emerald-100 rounded-full">
                  <i className="ri-map-pin-line text-xl text-emerald-700"></i>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Shipping To</p>
                  <p className="font-semibold text-gray-900">
                    {shippingAddress.city || shippingAddress.region || 'Ghana'}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 flex items-center justify-center bg-emerald-100 rounded-full">
                  <i className="ri-money-cny-circle-line text-xl text-emerald-700"></i>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total</p>
                  <p className="font-semibold text-gray-900">GH₵ {Number(order.total).toFixed(2)}</p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 flex items-center justify-center bg-emerald-100 rounded-full">
                  <i className="ri-box-3-line text-xl text-emerald-700"></i>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Items</p>
                  <p className="font-semibold text-gray-900">
                    {order.order_items?.length || 0} Product{(order.order_items?.length || 0) !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Tracking Timeline */}
          <div className="relative">
            {trackingSteps.map((step, index) => (
              <div key={step.key} className="flex items-start mb-8 last:mb-0">
                <div className="relative flex flex-col items-center mr-6">
                  <div className={`w-12 h-12 flex items-center justify-center rounded-full font-bold transition-colors ${
                    step.status === 'completed'
                      ? 'bg-emerald-700 text-white'
                      : step.status === 'active'
                      ? 'bg-emerald-100 text-emerald-700 ring-4 ring-emerald-200'
                      : 'bg-gray-200 text-gray-500'
                  }`}>
                    <i className={`${step.icon} text-xl`}></i>
                  </div>
                  {index < trackingSteps.length - 1 && (
                    <div className={`w-0.5 h-16 mt-2 ${
                      step.status === 'completed' ? 'bg-emerald-700' : 'bg-gray-200'
                    }`}></div>
                  )}
                </div>
                <div className="flex-1 pt-2">
                  <h3 className={`font-bold text-lg ${
                    step.status === 'pending' ? 'text-gray-500' : 'text-gray-900'
                  }`}>
                    {step.title}
                  </h3>
                  <p className={`text-sm mt-1 ${
                    step.status === 'pending' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {step.description}
                  </p>
                  <p className={`text-sm mt-1 font-semibold ${
                    step.status === 'pending' ? 'text-gray-400' : 'text-emerald-700'
                  }`}>
                    {step.date}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Order Items */}
        <div className="bg-white rounded-xl shadow-sm p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Order Items</h2>
          <div className="space-y-4">
            {order.order_items?.map((item: any) => {
              const lineImg = orderLineItemImageUrl(item);
              return (
              <div key={item.id} className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
                <div className="w-20 h-20 bg-gray-200 rounded-lg overflow-hidden flex-shrink-0 border border-gray-200">
                  {lineImg ? (
                    <img
                      src={getOptimizedImageUrl(lineImg, { width: 160 })}
                      alt={item.product_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <i className="ri-image-line text-2xl text-gray-300"></i>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{item.product_name}</h3>
                  <p className="text-sm text-gray-600 mt-1">Quantity: {item.quantity}</p>
                  {item.variant_name && (
                    <p className="text-xs text-gray-500">{item.variant_name}</p>
                  )}
                </div>
                <p className="font-bold text-emerald-700">GH₵ {Number(item.unit_price).toFixed(2)}</p>
              </div>
              );
            })}
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-gray-600 mb-4">Need help with your order?</p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/contact" className="text-emerald-700 hover:text-emerald-900 font-semibold whitespace-nowrap">
              <i className="ri-customer-service-line mr-1"></i>
              Contact Support
            </Link>
            <Link href="/returns" className="text-emerald-700 hover:text-emerald-900 font-semibold whitespace-nowrap">
              <i className="ri-arrow-left-right-line mr-1"></i>
              Returns Policy
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function OrderTrackingPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-700 border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      </main>
    }>
      <OrderTrackingContent />
    </Suspense>
  );
}

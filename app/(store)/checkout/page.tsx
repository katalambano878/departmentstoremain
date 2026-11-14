'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CheckoutSteps from '@/components/CheckoutSteps';
import OrderSummary from '@/components/OrderSummary';
import { useCart } from '@/context/CartContext';
import { useAffiliate } from '@/context/AffiliateContext';
import { round2 } from '@/lib/affiliate';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRecaptcha } from '@/hooks/useRecaptcha';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function CheckoutPage() {
  usePageTitle('Checkout');
  const router = useRouter();
  const { cart, clearCart } = useCart();
  const { mk, affiliate, commissionPct } = useAffiliate();

  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [checkoutType, setCheckoutType] = useState<'guest' | 'account'>('guest');
  const [saveAddress, setSaveAddress] = useState(false);
  const [savePayment, setSavePayment] = useState(false);
  const [user, setUser] = useState<any>(null);
  const { getToken, verifying } = useRecaptcha();

  const [shippingData, setShippingData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    region: '',
    /** ISO date YYYY-MM-DD — optional, shown to staff on order details */
    preferredDate: ''
  });

  // Optional birthday (day and month) for the yearly birthday message.
  const [birthday, setBirthday] = useState({ month: '', day: '' });
  const birthdayDays = birthday.month
    ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(birthday.month) - 1]
    : 31;

  // Ghana Regions for dropdown
  const ghanaRegions = [
    'Greater Accra',
    'Ashanti',
    'Western',
    'Central',
    'Eastern',
    'Northern',
    'Volta',
    'Upper East',
    'Upper West',
    'Brong-Ahafo',
    'Ahafo',
    'Bono',
    'Bono East',
    'North East',
    'Savannah',
    'Oti',
    'Western North'
  ];

  // Default to doorstep so the Order Summary shows "At a Cost" upfront and
  // the customer actively opts in to free Store Pickup if that's what they
  // want — pickup is no longer assumed.
  const [deliveryMethod, setDeliveryMethod] = useState('doorstep');
  const [paymentMethod, setPaymentMethod] = useState('hubtel');
  const [errors, setErrors] = useState<any>({});

  // Check auth and cart
  useEffect(() => {
    async function checkUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        setCheckoutType('account'); // Auto-select account checkout if logged in
        // Pre-fill email if available
        setShippingData(prev => ({ ...prev, email: session.user.email || '' }));
      }
    }
    checkUser();

    // Small delay to ensure cart load
    const timer = setTimeout(() => {
      if (cart.length === 0 && !isLoading) {
        // router.push('/cart'); // Optional: redirect if empty
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [cart, router, isLoading]);

  // Scroll to top when step changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);

  // Calculate Totals.  Delivery is never priced at checkout — the rider
  // quotes the customer at hand-off (or pickup is free).  Sales tax is
  // not charged either, so the order total is just the items subtotal.
  //
  // Affiliate markup: the cart stores base prices, so the marked subtotal is
  // what the customer actually pays. The pre-markup base + per-line affiliate
  // commission are persisted with the order for server-side verification.
  const baseSubtotal = round2(cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const subtotal = round2(cart.reduce((sum, item) => sum + round2(mk(item.price, item.id)) * item.quantity, 0));
  const shippingCost = 0;
  const tax = 0;
  const total = subtotal;

  // Marked-up line items for the Order Summary so the displayed prices match
  // what is charged. The cart itself is untouched (still base prices).
  const displayItems = cart.map((item) => ({ ...item, price: round2(mk(item.price, item.id)) }));

  const validateShipping = () => {
    const newErrors: any = {};
    if (!shippingData.firstName) newErrors.firstName = 'First name is required';
    if (!shippingData.lastName) newErrors.lastName = 'Last name is required';
    if (!shippingData.email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(shippingData.email)) newErrors.email = 'Invalid email';
    if (!shippingData.phone) newErrors.phone = 'Phone is required';
    if (!shippingData.address) newErrors.address = 'Address is required';
    if (!shippingData.city) newErrors.city = 'City is required';
    if (!shippingData.region) newErrors.region = 'Region is required';
    if (!!birthday.month !== !!birthday.day) newErrors.birthday = 'Choose both the month and the day, or leave both empty';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinueToDelivery = () => {
    if (validateShipping()) {
      setCurrentStep(2);
    }
  };

  const handleContinueToPayment = async () => {
    // Skip step 3 and directly initiate payment with default method (Hubtel/Mobile Money)
    await handlePlaceOrder();
  };

  const handlePlaceOrder = async () => {
    if (cart.length === 0) {
      alert('Your cart is empty');
      return;
    }

    setIsLoading(true);

    // reCAPTCHA verification
    const isHuman = await getToken('checkout');
    if (!isHuman) {
      alert('Security verification failed. Please try again.');
      setIsLoading(false);
      return;
    }

    try {
      const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      // Generate tracking number: SLI-XXXXXX (6-char alphanumeric)
      const trackingId = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      const trackingNumber = `SLI-${trackingId}`;

      // Affiliate attribution: the commission is the sum of per-line markup
      // deltas. It's re-verified server-side from the affiliate's locked-in %
      // when the order is marked paid.
      const commissionAmount = round2(subtotal - baseSubtotal);
      const affiliate_meta =
        affiliate?.code && commissionAmount > 0
          ? {
              code: affiliate.code,
              commission_pct: commissionPct,
              base_subtotal: baseSubtotal,
              commission_amount: commissionAmount,
            }
          : null;

      // 1. Create the order + items server-side.  Guests can't insert rows
      // into `orders` directly because RLS requires the inserted row to
      // pass a SELECT policy for `RETURNING` to succeed, and we intentionally
      // removed the permissive guest-SELECT policy to stop PII enumeration.
      // The server route uses the service role to do this atomically.
      const createRes = await fetch('/api/storefront/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber,
          trackingNumber,
          userId: user?.id || null,
          email: shippingData.email,
          phone: shippingData.phone,
          shippingData,
          birthdayMonth: birthday.month && birthday.day ? Number(birthday.month) : null,
          birthdayDay: birthday.month && birthday.day ? Number(birthday.day) : null,
          deliveryMethod,
          paymentMethod,
          currency: 'GHS',
          subtotal,
          tax,
          shippingCost,
          total,
          affiliate: affiliate_meta,
          items: cart.map((item) => ({
            id: item.id,
            name: item.name,
            variant: item.variant,
            variantId: item.variantId,
            quantity: item.quantity,
            price: round2(mk(item.price, item.id)),
            basePrice: item.price,
            image: item.image,
            slug: item.slug,
          })),
        }),
      });

      let createdOrderPayload: { id?: string; order_number?: string; error?: string } = {};
      try {
        createdOrderPayload = await createRes.json();
      } catch {
        throw new Error(`Checkout server returned an invalid response (${createRes.status})`);
      }

      if (!createRes.ok || !createdOrderPayload.id) {
        throw new Error(createdOrderPayload.error || 'Failed to place order. Please try again.');
      }

      const order = { id: createdOrderPayload.id, order_number: createdOrderPayload.order_number || orderNumber };

      // Stock reduction happens in mark_order_paid when payment is confirmed.

      // 4. Handle Payment Redirects or Completion
      if (paymentMethod === 'hubtel') {
        try {
          // Payment link reminder will be sent automatically after 15 mins if unpaid (via cron)
          const paymentRes = await fetch('/api/payment/hubtel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: orderNumber,
              amount: total,
              customerEmail: shippingData.email
            })
          });

          let paymentResult: any = null;
          try {
            paymentResult = await paymentRes.json();
          } catch {
            throw new Error(`Payment gateway returned an invalid response (${paymentRes.status})`);
          }

          // Special case: every item went out of stock between cart and payment.
          // Send the customer to the dedicated pay page where the issue is shown.
          if (paymentResult?.all_out_of_stock) {
            clearCart();
            router.push(`/pay/${orderNumber}?stock=empty`);
            return;
          }

          if (!paymentRes.ok || !paymentResult?.success) {
            throw new Error(paymentResult?.message || 'Payment initialization failed');
          }

          // If the server auto-removed any out-of-stock items, let the customer know
          // briefly before the redirect so the new total is not a surprise.
          if (Array.isArray(paymentResult.removedItems) && paymentResult.removedItems.length > 0) {
            const lines = paymentResult.removedItems
              .map((it: { name: string; variant?: string }) =>
                `• ${it.name}${it.variant ? ` — ${it.variant}` : ''}`
              )
              .join('\n');
            const newTotal = typeof paymentResult.amount === 'number'
              ? `GH₵ ${paymentResult.amount.toFixed(2)}`
              : 'the updated amount';
            alert(
              `Some items went out of stock and were removed from your order:\n\n${lines}\n\n` +
              `You'll be charged ${newTotal} for the remaining items. ` +
              `If you'd like the removed items, please reach out to our support team.`
            );
          }

          // Clear cart before redirecting
          clearCart();

          // Redirect to Hubtel hosted checkout
          window.location.href = paymentResult.url;
          return;

        } catch (paymentErr: any) {
          console.error('Payment Error:', paymentErr);
          // Do not lose the created order on transient network/payment init errors.
          // Send customer to hosted payment retry page for this order instead.
          clearCart();
          router.push(`/pay/${orderNumber}?init=failed`);
          return; // Stop execution
        }
      }

      // 5. Send Notifications (For COD or others)
      fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'order_created',
          payload: order
        })
      }).catch(err => console.error('Notification trigger error:', err));

      // 6. Clear Cart & Redirect (For COD)
      clearCart();
      router.push(`/order-success?order=${orderNumber}`);

    } catch (err: any) {
      console.error('Checkout error:', err);
      alert('Failed to place order: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fieldClass = (hasError?: boolean) =>
    `w-full rounded-xl border px-4 py-3.5 text-[#0B1B3A] outline-none transition placeholder:text-gray-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 ${
      hasError ? 'border-red-400' : 'border-[#d1fae5]'
    }`;
  const labelClass = 'block text-sm font-semibold text-[#0B1B3A] mb-2';
  const cardClass =
    'rounded-2xl border border-[#d1fae5] bg-white p-6 shadow-[0_16px_40px_-28px_rgba(11,27,58,0.35)] sm:p-8';

  if (cart.length === 0 && !isLoading) {
    return (
      <main className="bg-white">
        <div className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-28 text-center">
          <div className="flex size-24 items-center justify-center rounded-full bg-emerald-50">
            <i className="ri-shopping-bag-3-line text-4xl text-emerald-600/50"></i>
          </div>
          <h1 className="mt-8 font-serif text-2xl font-semibold text-[#0B1B3A]">Your bag is empty</h1>
          <p className="mt-2 text-gray-500">Add some items before checking out.</p>
          <Link
            href="/shop"
            className="mt-8 rounded-full bg-emerald-600 px-10 py-3.5 text-base font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Continue Shopping
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-white pb-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav className="py-6">
          <ol className="flex items-center gap-2 text-sm text-gray-500">
            <li><Link href="/" className="transition-colors hover:text-emerald-700">Home</Link></li>
            <li><i className="ri-arrow-right-s-line"></i></li>
            <li><Link href="/cart" className="transition-colors hover:text-emerald-700">Your Bag</Link></li>
            <li><i className="ri-arrow-right-s-line"></i></li>
            <li className="font-medium text-[#0B1B3A]">Checkout</li>
          </ol>
        </nav>

        <h1 className="mb-6 font-serif text-4xl font-semibold text-[#0B1B3A] sm:text-5xl">Checkout</h1>

        <div className="mb-8 flex gap-3 rounded-2xl border border-emerald-200 bg-[#ecfdf5] p-4">
          <i className="ri-truck-line mt-0.5 flex-shrink-0 text-xl text-emerald-700"></i>
          <div className="text-sm text-emerald-900">
            <p className="mb-1 font-semibold">Delivery Information</p>
            <p>Orders are delivered within <strong>24 – 72 hours</strong> after payment is confirmed. For faster or urgent deliveries, please reach out to our customer support team. Have your <strong>order number</strong> ready as you may be asked to provide it.</p>
          </div>
        </div>

        <div className="mb-8">
          <CheckoutSteps currentStep={currentStep} />
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            {currentStep === 1 && (
              <>
                <div className={cardClass}>
                  <h2 className="mb-6 font-serif text-2xl font-semibold text-[#0B1B3A]">Checkout As</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <button
                      onClick={() => !user && setCheckoutType('guest')}
                      className={`rounded-2xl border-2 p-6 text-left transition-all cursor-pointer ${
                        checkoutType === 'guest' ? 'border-emerald-600 bg-emerald-50' : 'border-[#d1fae5] hover:border-emerald-300'
                      } ${user ? 'opacity-50 cursor-not-allowed' : ''}`}
                      disabled={!!user}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <i className="ri-user-line text-3xl text-emerald-700"></i>
                        <div className={`flex size-6 items-center justify-center rounded-full border-2 ${checkoutType === 'guest' ? 'border-emerald-600 bg-emerald-600' : 'border-gray-300'}`}>
                          {checkoutType === 'guest' && <i className="ri-check-line text-sm text-white"></i>}
                        </div>
                      </div>
                      <h3 className="mb-1 text-lg font-semibold text-[#0B1B3A]">Guest Checkout</h3>
                      <p className="text-sm text-gray-500">Quick checkout without creating an account</p>
                      {user && <p className="mt-2 text-xs text-emerald-600">You are logged in</p>}
                    </button>

                    <button
                      onClick={() => setCheckoutType('account')}
                      className={`rounded-2xl border-2 p-6 text-left transition-all cursor-pointer ${
                        checkoutType === 'account' ? 'border-emerald-600 bg-emerald-50' : 'border-[#d1fae5] hover:border-emerald-300'
                      }`}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <i className="ri-account-circle-line text-3xl text-emerald-700"></i>
                        <div className={`flex size-6 items-center justify-center rounded-full border-2 ${checkoutType === 'account' ? 'border-emerald-600 bg-emerald-600' : 'border-gray-300'}`}>
                          {checkoutType === 'account' && <i className="ri-check-line text-sm text-white"></i>}
                        </div>
                      </div>
                      <h3 className="mb-1 text-lg font-semibold text-[#0B1B3A]">{user ? 'My Account' : 'Create Account'}</h3>
                      <p className="text-sm text-gray-500">
                        {user ? `Logged in as ${user.email}` : 'Save info, track orders & earn loyalty points'}
                      </p>
                    </button>
                  </div>
                </div>

                <div className={cardClass}>
                  <h2 className="mb-6 font-serif text-2xl font-semibold text-[#0B1B3A]">Your Details</h2>

                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className={labelClass}>First Name *</label>
                        <input
                          type="text"
                          value={shippingData.firstName}
                          onChange={(e) => setShippingData({ ...shippingData, firstName: e.target.value })}
                          className={fieldClass(errors.firstName)}
                          placeholder="John"
                        />
                        {errors.firstName && <p className="mt-1 text-sm text-red-600">{errors.firstName}</p>}
                      </div>
                      <div>
                        <label className={labelClass}>Last Name *</label>
                        <input
                          type="text"
                          value={shippingData.lastName}
                          onChange={(e) => setShippingData({ ...shippingData, lastName: e.target.value })}
                          className={fieldClass(errors.lastName)}
                          placeholder="Doe"
                        />
                        {errors.lastName && <p className="mt-1 text-sm text-red-600">{errors.lastName}</p>}
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>Email Address *</label>
                      <input
                        type="email"
                        value={shippingData.email}
                        readOnly={!!user}
                        onChange={(e) => setShippingData({ ...shippingData, email: e.target.value })}
                        className={`${fieldClass(errors.email)} ${user ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                        placeholder="you@example.com"
                      />
                      {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
                    </div>

                    <div>
                      <label className={labelClass}>Phone Number *</label>
                      <input
                        type="tel"
                        value={shippingData.phone}
                        onChange={(e) => setShippingData({ ...shippingData, phone: e.target.value })}
                        className={fieldClass(errors.phone)}
                        placeholder="+233 XX XXX XXXX"
                      />
                      {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone}</p>}
                    </div>

                    <fieldset>
                      <legend className={labelClass}>
                        Birthday <span className="font-normal text-gray-400">(optional)</span>
                      </legend>
                      <div className="grid grid-cols-2 gap-4">
                        <select
                          aria-label="Birthday month"
                          value={birthday.month}
                          onChange={(e) => {
                            const month = e.target.value;
                            const max = month ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1] : 31;
                            setBirthday((b) => ({ month, day: b.day && Number(b.day) > max ? '' : b.day }));
                          }}
                          className={`${fieldClass(false)} bg-white`}
                        >
                          <option value="">Month</option>
                          {MONTHS.map((name, i) => (
                            <option key={name} value={String(i + 1)}>{name}</option>
                          ))}
                        </select>
                        <select
                          aria-label="Birthday day"
                          value={birthday.day}
                          onChange={(e) => setBirthday((b) => ({ ...b, day: e.target.value }))}
                          className={`${fieldClass(false)} bg-white`}
                        >
                          <option value="">Day</option>
                          {Array.from({ length: birthdayDays }, (_, i) => (
                            <option key={i + 1} value={String(i + 1)}>{i + 1}</option>
                          ))}
                        </select>
                      </div>
                      {errors.birthday && <p className="mt-1 text-sm text-red-600">{errors.birthday}</p>}
                      <p className="mt-1 text-xs text-gray-400">
                        We&apos;ll send you a birthday message on the day. Just the day and month, no year.
                      </p>
                    </fieldset>

                    <div>
                      <label className={labelClass}>Street Address *</label>
                      <input
                        type="text"
                        value={shippingData.address}
                        onChange={(e) => setShippingData({ ...shippingData, address: e.target.value })}
                        className={fieldClass(errors.address)}
                        placeholder="House number and street name"
                      />
                      {errors.address && <p className="mt-1 text-sm text-red-600">{errors.address}</p>}
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className={labelClass}>City *</label>
                        <input
                          type="text"
                          value={shippingData.city}
                          onChange={(e) => setShippingData({ ...shippingData, city: e.target.value })}
                          className={fieldClass(errors.city)}
                          placeholder="Accra"
                        />
                        {errors.city && <p className="mt-1 text-sm text-red-600">{errors.city}</p>}
                      </div>
                      <div>
                        <label className={labelClass}>Region *</label>
                        <select
                          value={shippingData.region}
                          onChange={(e) => setShippingData({ ...shippingData, region: e.target.value })}
                          className={`${fieldClass(errors.region)} bg-white`}
                        >
                          <option value="">Select Region</option>
                          {ghanaRegions.map((region) => (
                            <option key={region} value={region}>{region}</option>
                          ))}
                        </select>
                        {errors.region && <p className="mt-1 text-sm text-red-600">{errors.region}</p>}
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>
                        Preferred delivery or pickup date <span className="font-normal text-gray-400">(optional)</span>
                      </label>
                      <input
                        type="date"
                        value={shippingData.preferredDate}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setShippingData({ ...shippingData, preferredDate: e.target.value })}
                        className={`${fieldClass(false)} bg-white`}
                      />
                      <p className="mt-1 text-xs text-gray-400">
                        If you need delivery or pickup on a specific day, choose it here. Our team will see it on your order.
                      </p>
                    </div>

                    {checkoutType === 'account' && (
                      <label className="flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={saveAddress}
                          onChange={(e) => setSaveAddress(e.target.checked)}
                          className="size-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="text-sm text-gray-600">Save this address for future orders</span>
                      </label>
                    )}
                  </div>

                  <button
                    onClick={handleContinueToDelivery}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 py-4 font-semibold text-white transition-colors hover:bg-emerald-700 cursor-pointer"
                  >
                    Continue to Delivery
                    <i className="ri-arrow-right-line"></i>
                  </button>
                </div>
              </>
            )}

            {currentStep === 2 && (
              <div className={cardClass}>
                <h2 className="mb-6 font-serif text-2xl font-semibold text-[#0B1B3A]">Delivery Method</h2>
                <div className="space-y-4">
                  <label className={`flex cursor-pointer items-center justify-between rounded-2xl border-2 p-4 transition-colors ${deliveryMethod === 'pickup' ? 'border-emerald-600 bg-emerald-50' : 'border-[#d1fae5] hover:border-emerald-300'}`}>
                    <div className="flex items-center gap-4">
                      <input
                        type="radio"
                        name="delivery"
                        value="pickup"
                        checked={deliveryMethod === 'pickup'}
                        onChange={(e) => setDeliveryMethod(e.target.value)}
                        className="size-5 text-emerald-600"
                      />
                      <div className="flex items-center gap-3">
                        <i className="ri-store-2-line text-xl text-[#0B1B3A]"></i>
                        <div>
                          <p className="font-semibold text-[#0B1B3A]">Store Pickup</p>
                          <p className="text-sm text-gray-500">Pick up from our store — Ready in 24 hours</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-emerald-700">FREE</p>
                  </label>

                  <label className={`flex cursor-pointer items-center justify-between rounded-2xl border-2 p-4 transition-colors ${deliveryMethod === 'doorstep' ? 'border-emerald-600 bg-emerald-50' : 'border-[#d1fae5] hover:border-emerald-300'}`}>
                    <div className="flex items-center gap-4">
                      <input
                        type="radio"
                        name="delivery"
                        value="doorstep"
                        checked={deliveryMethod === 'doorstep'}
                        onChange={(e) => setDeliveryMethod(e.target.value)}
                        className="size-5 text-emerald-600"
                      />
                      <div className="flex items-center gap-3">
                        <i className="ri-truck-line text-xl text-[#0B1B3A]"></i>
                        <div>
                          <p className="font-semibold text-[#0B1B3A]">Doorstep Delivery</p>
                          <p className="text-sm text-gray-500">We will contact you with the delivery cost</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-amber-600">At a Cost</p>
                  </label>
                </div>

                <div className="mt-6 flex flex-col-reverse gap-4 md:flex-row">
                  <button
                    onClick={() => setCurrentStep(1)}
                    disabled={isLoading}
                    className="flex-1 rounded-full border border-[#0B1B3A] py-4 font-semibold text-[#0B1B3A] transition-colors hover:bg-[#0B1B3A] hover:text-white cursor-pointer disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleContinueToPayment}
                    disabled={isLoading}
                    className="flex flex-1 items-center justify-center rounded-full bg-emerald-600 py-4 font-semibold text-white transition-colors hover:bg-emerald-700 cursor-pointer disabled:opacity-70"
                  >
                    {isLoading ? (
                      <>
                        <svg className="-ml-1 mr-3 h-5 w-5 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Processing...
                      </>
                    ) : (
                      'Pay with Mobile Money'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <OrderSummary
              items={displayItems}
              subtotal={subtotal}
              shipping={shippingCost}
              tax={tax}
              total={total}
              deliveryMethod={deliveryMethod}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

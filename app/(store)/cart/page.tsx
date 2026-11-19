'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCart } from '@/context/CartContext';
import { useAffiliate } from '@/context/AffiliateContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { round2 } from '@/lib/affiliate';
import { useEffect, useState } from 'react';

export default function CartPage() {
  usePageTitle('Shopping Cart');
  const { cart: cartItems, removeFromCart, updateQuantity, ready, refreshCart } = useCart();
  const { mk } = useAffiliate();
  const [cartChanges, setCartChanges] = useState<string[]>([]);

  // Re-read current prices and stock once the saved bag has loaded.
  useEffect(() => {
    if (!ready) return;
    let active = true;
    refreshCart().then((changes) => {
      if (active && changes && changes.length > 0) setCartChanges(changes.map((c) => c.message));
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Cart stores base prices; affiliate markup is applied for display + the
  // running subtotal here, then re-priced authoritatively server-side.
  // Same rounding as checkout so the totals match to the pesewa.
  const unitPrice = (item: { price: number; id: string }) => round2(mk(item.price, item.id));
  const subtotal = round2(cartItems.reduce((sum, item) => sum + unitPrice(item) * item.quantity, 0));
  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const total = subtotal;

  return (
    <main className="bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav className="py-6">
          <ol className="flex items-center gap-2 text-sm text-gray-500">
            <li>
              <Link href="/" className="transition-colors hover:text-emerald-700">Home</Link>
            </li>
            <li><i className="ri-arrow-right-s-line"></i></li>
            <li className="font-medium text-[#0B1B3A]">Your Bag</li>
          </ol>
        </nav>

        <div className="mb-8">
          <h1 className="font-serif text-4xl font-semibold text-[#0B1B3A] sm:text-5xl">
            Your Bag
            {itemCount > 0 && (
              <span className="ml-3 text-xl font-normal text-gray-400 sm:text-2xl">
                ({itemCount} {itemCount === 1 ? 'item' : 'items'})
              </span>
            )}
          </h1>
        </div>

        {cartChanges.length > 0 && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
            <p className="font-semibold">Your bag was updated</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {cartChanges.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        {!ready ? (
          <div className="flex justify-center py-24" role="status" aria-live="polite">
            <i className="ri-loader-4-line animate-spin text-4xl text-emerald-600" aria-hidden="true"></i>
            <span className="sr-only">Loading your bag…</span>
          </div>
        ) : cartItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="flex size-28 items-center justify-center rounded-full bg-emerald-50">
              <i className="ri-shopping-bag-3-line text-5xl text-emerald-600/50"></i>
            </div>
            <h3 className="mt-8 font-serif text-2xl font-semibold text-[#0B1B3A]">Your bag is empty</h3>
            <p className="mt-2 text-gray-500">Discover something you&apos;ll love</p>
            <Link
              href="/shop"
              className="mt-8 rounded-full bg-emerald-600 px-10 py-3.5 text-base font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              Continue Shopping
            </Link>
          </div>
        ) : (
          <div className="grid gap-10 pb-16 lg:grid-cols-[1fr_380px] lg:gap-14">
            {/* Items */}
            <div>
              <div className="space-y-4">
                {cartItems.map((item) => {
                  const linePrice = unitPrice(item);
                  return (
                    <div
                      key={`${item.id}-${item.variantId || item.variant || ''}`}
                      className="rounded-2xl border border-[#d1fae5] bg-white px-5 py-5 shadow-[0_8px_26px_-20px_rgba(11,27,58,0.45)]"
                    >
                      <div className="flex gap-4 sm:gap-5">
                        <Link href={`/product/${item.slug || item.id}`} className="shrink-0">
                          <div className="size-[76px] overflow-hidden rounded-xl bg-emerald-50 ring-1 ring-black/5 sm:size-[88px]">
                            <Image
                              src={getOptimizedImageUrl(item.image, { width: 200 })}
                              alt={item.name}
                              width={88}
                              height={88}
                              unoptimized
                              className="size-full object-cover object-top"
                            />
                          </div>
                        </Link>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <Link
                                href={`/product/${item.slug || item.id}`}
                                className="font-serif text-lg font-semibold leading-tight text-[#0B1B3A] transition-colors hover:text-emerald-700 line-clamp-2"
                              >
                                {item.name}
                              </Link>
                              {item.variant && (
                                <p className="mt-1 text-sm text-gray-500">{item.variant}</p>
                              )}
                              <p className="mt-2 text-xl font-semibold leading-none text-emerald-700">
                                GH₵{linePrice.toFixed(2)}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => removeFromCart(item.id, item.variant, item.variantId)}
                              className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                              aria-label={`Remove ${item.name} from bag`}
                            >
                              <i className="ri-delete-bin-line text-lg"></i>
                            </button>
                          </div>

                          <div className="mt-4 flex items-end justify-between gap-3">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => updateQuantity(item.id, item.quantity - 1, item.variant, item.variantId)}
                                  className="flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition-colors hover:bg-emerald-200"
                                  aria-label={item.quantity <= (item.moq || 1) ? `Remove ${item.name} from bag` : `Decrease quantity of ${item.name}`}
                                >
                                  {item.quantity <= (item.moq || 1) ? (
                                    <i className="ri-delete-bin-line text-red-500"></i>
                                  ) : (
                                    <i className="ri-subtract-line"></i>
                                  )}
                                </button>
                                <span className="w-8 text-center text-base font-semibold text-[#0B1B3A]" aria-label={`Quantity ${item.quantity}`}>{item.quantity}</span>
                                <button
                                  type="button"
                                  onClick={() => updateQuantity(item.id, item.quantity + 1, item.variant, item.variantId)}
                                  className="flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition-colors hover:bg-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed"
                                  disabled={item.quantity >= item.maxStock}
                                  aria-label={`Increase quantity of ${item.name}`}
                                >
                                  <i className="ri-add-line"></i>
                                </button>
                              </div>
                              {(item.moq || 1) > 1 && (
                                <span className="text-xs text-amber-600">Min. order: {item.moq} units</span>
                              )}
                            </div>

                            <div className="text-right">
                              <p className="text-sm text-gray-500">Subtotal</p>
                              <span className="text-xl font-semibold leading-none text-[#0B1B3A]">
                                GH₵{round2(linePrice * item.quantity).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            <div>
              <div className="sticky top-24 overflow-hidden rounded-2xl border border-[#d1fae5] bg-[#ecfdf5] shadow-[0_14px_34px_-24px_rgba(11,27,58,0.5)]">
                <div className="space-y-5 p-6">
                  <h3 className="font-serif text-2xl font-semibold text-[#0B1B3A]">Order Summary</h3>

                  <div className="space-y-3.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Subtotal</span>
                      <span className="font-semibold text-[#0B1B3A]">GH₵{subtotal.toFixed(2)}</span>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Delivery</span>
                        <span className="font-medium text-gray-500">Not included</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">Store pickup is free. For doorstep delivery the rider tells you the fee at hand-off.</p>
                    </div>
                  </div>

                  <div className="h-px bg-[#d1fae5]" />

                  <div className="flex items-center justify-between">
                    <span className="text-xl font-semibold text-[#0B1B3A]">Total</span>
                    <span className="text-2xl font-semibold leading-none text-emerald-700">GH₵{total.toFixed(2)}</span>
                  </div>

                  <Link
                    href="/checkout"
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-700"
                  >
                    <i className="ri-bank-card-line"></i>
                    Proceed to Checkout
                  </Link>

                  <Link
                    href="/shop"
                    className="flex w-full items-center justify-center rounded-full border border-emerald-600/70 py-4 text-base font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
                  >
                    Continue Shopping
                  </Link>

                  <div className="space-y-2 pt-1 text-sm text-gray-500">
                    <p className="flex items-center gap-2">
                      <i className="ri-truck-line text-emerald-700"></i>
                      Delivery across Ghana in 24 – 72 hours
                    </p>
                    <p className="flex items-center gap-2">
                      <i className="ri-shield-check-line text-emerald-700"></i>
                      Secure checkout &amp; trusted payments
                    </p>
                    <p className="flex items-center gap-2">
                      <i className="ri-customer-service-2-line text-emerald-700"></i>
                      Friendly support whenever you need it
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCart } from '@/context/CartContext';
import { useAffiliate } from '@/context/AffiliateContext';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { round2 } from '@/lib/affiliate';

interface MiniCartProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MiniCart({ isOpen, onClose }: MiniCartProps) {
  const { cart, removeFromCart, updateQuantity } = useCart();
  const { mk } = useAffiliate();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Cart stores base prices; affiliate markup is applied for display only.
  // Same rounding as checkout: round each marked-up unit price, then the sum.
  const unitPrice = (item: { price: number; id: string }) => round2(mk(item.price, item.id));
  const subtotal = round2(cart.reduce((sum, item) => sum + unitPrice(item) * item.quantity, 0));
  const itemCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  // Lock body scroll when cart is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  const drawer = (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-[#0B1B3A]/40 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
        aria-hidden
      ></div>

      <div className="absolute top-0 right-0 bottom-0 flex w-full max-w-md flex-col bg-white shadow-2xl slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d1fae5] px-6 py-5">
          <h2 className="font-serif text-lg font-semibold text-[#0B1B3A]">
            Your Bag
            {itemCount > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">
                ({itemCount} {itemCount === 1 ? 'item' : 'items'})
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-[#0B1B3A]/70 transition-colors hover:bg-emerald-50 hover:text-[#0B1B3A] cursor-pointer"
            aria-label="Close cart"
          >
            <i className="ri-close-line text-2xl"></i>
          </button>
        </div>

        {cart.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-12 text-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-emerald-50">
              <i className="ri-shopping-bag-3-line text-4xl text-emerald-600"></i>
            </div>
            <div>
              <p className="font-serif text-lg font-semibold text-[#0B1B3A]">Your bag is empty</p>
              <p className="mt-1 text-sm text-gray-500">Discover something you love</p>
            </div>
            <Link
              href="/shop"
              onClick={onClose}
              className="mt-2 rounded-full bg-emerald-600 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 cursor-pointer"
            >
              Continue Shopping
            </Link>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-5">
                {cart.map((item) => (
                  <div
                    key={`${item.id}-${item.variantId || item.variant || ''}`}
                    className="flex gap-3.5"
                  >
                    <Link
                      href={`/product/${item.slug}`}
                      onClick={onClose}
                      className="size-20 shrink-0 overflow-hidden rounded-xl bg-emerald-50 ring-1 ring-black/5"
                    >
                      <img
                        src={getOptimizedImageUrl(item.image, { width: 200 })}
                        alt={item.name}
                        className="size-full object-cover object-center"
                        loading="lazy"
                      />
                    </Link>

                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/product/${item.slug}`}
                            onClick={onClose}
                            className="line-clamp-1 text-sm font-medium text-[#0B1B3A] hover:text-emerald-700"
                          >
                            {item.name}
                          </Link>
                          {item.variant && (
                            <p className="mt-0.5 text-xs text-gray-400">{item.variant}</p>
                          )}
                        </div>
                        <button
                          onClick={() => removeFromCart(item.id, item.variant, item.variantId)}
                          className="shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 cursor-pointer"
                          aria-label={`Remove ${item.name}`}
                        >
                          <i className="ri-delete-bin-line text-base"></i>
                        </button>
                      </div>

                      <div className="mt-auto flex items-center justify-between pt-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity - 1, item.variant, item.variantId)}
                            className="flex size-7 items-center justify-center rounded-lg border border-[#d1fae5] text-[#0B1B3A]/70 transition-colors hover:bg-emerald-50 cursor-pointer"
                            aria-label="Decrease quantity"
                          >
                            {item.quantity <= (item.moq || 1) ? (
                              <i className="ri-delete-bin-line text-red-500"></i>
                            ) : (
                              <i className="ri-subtract-line"></i>
                            )}
                          </button>
                          <span className="w-6 text-center text-sm font-semibold text-[#0B1B3A]">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity + 1, item.variant, item.variantId)}
                            className="flex size-7 items-center justify-center rounded-lg border border-[#d1fae5] text-[#0B1B3A]/70 transition-colors hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            disabled={item.quantity >= item.maxStock}
                            aria-label="Increase quantity"
                          >
                            <i className="ri-add-line"></i>
                          </button>
                        </div>
                        <p className="text-sm font-semibold text-[#0B1B3A]">
                          GH₵{round2(unitPrice(item) * item.quantity).toFixed(2)}
                        </p>
                      </div>
                      {item.quantity >= item.maxStock && (
                        <p className="mt-1 text-xs text-amber-600">Max stock reached</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-[#d1fae5] px-6 py-5">
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-500">Subtotal</span>
                <span className="font-serif text-xl font-semibold text-[#0B1B3A]">GH₵{subtotal.toFixed(2)}</span>
              </div>
              <p className="mt-1 mb-4 text-xs text-gray-400">Shipping calculated at checkout</p>

              <div className="space-y-2.5">
                <Link
                  href="/checkout"
                  onClick={onClose}
                  className="flex h-12 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 cursor-pointer"
                >
                  Checkout
                </Link>
                <Link
                  href="/cart"
                  onClick={onClose}
                  className="flex h-12 items-center justify-center rounded-full border border-[#0B1B3A] text-sm font-semibold text-[#0B1B3A] transition-colors hover:bg-[#0B1B3A] hover:text-white cursor-pointer"
                >
                  View Cart
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(drawer, document.body);
}

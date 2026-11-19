import { getOptimizedImageUrl } from '@/lib/imageOptimization';

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
  variant?: string;
}

interface OrderSummaryProps {
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  /** Coupon discount already taken off `total`. */
  discount?: number;
  couponCode?: string;
  deliveryMethod?: string;
}

export default function OrderSummary({ items, subtotal, total, discount = 0, couponCode, deliveryMethod }: OrderSummaryProps) {
  return (
    <div className="sticky top-24 overflow-hidden rounded-2xl border border-[#d1fae5] bg-[#ecfdf5] shadow-[0_14px_34px_-24px_rgba(11,27,58,0.5)]">
      <div className="space-y-5 p-6">
        <h2 className="font-serif text-2xl font-semibold text-[#0B1B3A]">Order Summary</h2>

        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {items.map((item) => (
            <div key={`${item.id}-${item.variant || 'novar'}`} className="flex items-center gap-3">
              <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
                <img
                  src={getOptimizedImageUrl(item.image, { width: 160 })}
                  alt={item.name}
                  className="size-full object-cover"
                  loading="lazy"
                />
                <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                  {item.quantity}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-1 text-sm font-medium text-[#0B1B3A]">{item.name}</h3>
                {item.variant && <p className="text-[11px] text-gray-500">{item.variant}</p>}
              </div>
              <span className="shrink-0 text-sm font-semibold text-[#0B1B3A]">
                <span className="sr-only">{item.quantity} × </span>GH₵{item.price.toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        <div className="h-px bg-[#d1fae5]" />

        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Subtotal</span>
            <span className="font-semibold text-[#0B1B3A]">GH₵{subtotal.toFixed(2)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">
                Discount{couponCode ? <span className="ml-1 font-mono text-xs">({couponCode})</span> : null}
              </span>
              <span className="font-semibold text-emerald-700">− GH₵{discount.toFixed(2)}</span>
            </div>
          )}
          {deliveryMethod === 'pickup' ? (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Store Pickup</span>
              <span className="font-semibold text-emerald-700">Free</span>
            </div>
          ) : (
            <div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Delivery</span>
                <span className="font-semibold text-amber-600">At a Cost</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">The rider will tell you the delivery fee at hand-off.</p>
            </div>
          )}
        </div>

        <div className="h-px bg-[#d1fae5]" />

        <div className="flex items-center justify-between">
          <span className="text-xl font-semibold text-[#0B1B3A]">Total</span>
          <span className="text-2xl font-semibold leading-none text-emerald-700">GH₵{total.toFixed(2)}</span>
        </div>

        <div className="flex items-center justify-center gap-2 pt-1 text-sm font-medium text-[#0B1B3A]/80">
          <i className="ri-shield-check-line text-emerald-700" aria-hidden="true"></i>
          <span>Secure Checkout</span>
        </div>
      </div>
    </div>
  );
}

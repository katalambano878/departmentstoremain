'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useCart } from '@/context/CartContext';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';

interface Order {
  id: string;
  orderNumber: string;
  date: string;
  status: string;
  paymentStatus: string;
  total: number;
  items: {
    id: string;
    productId: string | null;
    variantId: string | null;
    variantName: string | null;
    name: string;
    image: string;
    quantity: number;
    price: number;
  }[];
}

export default function OrderHistory() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [reorderState, setReorderState] = useState<{ orderId: string; busy: boolean; message: string; tone: 'ok' | 'warn' | 'error' } | null>(null);
  const { addToCart } = useCart();

  useEffect(() => {
    async function fetchOrders() {
      setLoading(true);
      setLoadError(false);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const { data, error } = await supabase
          .from('orders')
          .select(`
                    *,
                    order_items (*)
                `)
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (data) {
          const formattedOrders = data.map((order: any) => ({
            id: order.id,
            orderNumber: order.order_number,
            date: order.created_at,
            status: order.status,
            paymentStatus: order.payment_status,
            total: Number(order.total) || 0,
            items: (order.order_items || []).map((item: any) => ({
              id: item.id,
              productId: item.product_id || null,
              variantId: item.variant_id || null,
              variantName: item.variant_name || null,
              name: item.product_name,
              image: item.metadata?.image || '',
              quantity: item.quantity,
              price: Number(item.unit_price) || 0
            }))
          }));
          setOrders(formattedOrders);
        }
      } catch (err) {
        console.error('Error fetching orders:', err);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchOrders();
  }, [reloadKey]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered': return 'bg-green-100 text-green-700';
      case 'shipped': return 'bg-emerald-100 text-emerald-700';
      case 'picked_up': return 'bg-emerald-100 text-emerald-700';
      case 'completed': return 'bg-emerald-100 text-emerald-700';
      case 'processing': return 'bg-yellow-100 text-yellow-700';
      case 'cancelled': return 'bg-red-100 text-red-700';
      case 'refund_requested': return 'bg-orange-100 text-orange-700';
      case 'refunded': return 'bg-purple-100 text-purple-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'shipped': return 'Packaged';
      case 'picked_up': return 'Picked Up by Rider';
      case 'completed': return 'Completed';
      case 'refund_requested': return 'Refund Requested';
      case 'refunded': return 'Refunded';
      default: return status.replace('_', ' ').replace(/^\w/, (c: string) => c.toUpperCase());
    }
  };

  /** Add the order's items that are still on sale, at today's price and stock. */
  const handleReorder = async (order: Order) => {
    setReorderState({ orderId: order.id, busy: true, message: '', tone: 'ok' });
    try {
      const productIds = Array.from(new Set(order.items.map((i) => i.productId).filter(Boolean))) as string[];
      if (productIds.length === 0) {
        setReorderState({ orderId: order.id, busy: false, message: 'These items are no longer available.', tone: 'warn' });
        return;
      }
      const { data: products, error } = await supabase
        .from('products')
        .select('id, name, slug, price, quantity, track_quantity, continue_selling, moq, status, product_images(url, position), product_variants(id, name, price, quantity, image_url)')
        .in('id', productIds);
      if (error) throw error;

      const byId = new Map((products || []).map((p: any) => [p.id, p]));
      let added = 0;
      let skipped = 0;
      for (const item of order.items) {
        const product: any = item.productId ? byId.get(item.productId) : null;
        if (!product || product.status !== 'active') { skipped++; continue; }
        const variant = item.variantId
          ? (product.product_variants || []).find((v: any) => v.id === item.variantId)
          : null;
        if (item.variantId && !variant) { skipped++; continue; }
        const unlimited = product.track_quantity === false || product.continue_selling === true;
        const stock = unlimited ? 9999 : Number(variant ? variant.quantity : product.quantity) || 0;
        const moq = Math.max(1, Number(product.moq) || 1);
        const quantity = Math.min(Math.max(item.quantity, moq), stock);
        if (stock <= 0 || quantity < moq) { skipped++; continue; }
        const images = [...(product.product_images || [])].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
        addToCart({
          id: product.id,
          name: product.name,
          price: Number(variant?.price ?? product.price) || 0,
          image: variant?.image_url || images[0]?.url || '',
          quantity,
          variant: variant ? (item.variantName || variant.name) : undefined,
          variantId: variant?.id,
          slug: product.slug,
          maxStock: stock,
          moq,
        });
        added++;
      }

      if (added === 0) {
        setReorderState({ orderId: order.id, busy: false, message: 'None of these items are available right now.', tone: 'warn' });
      } else if (skipped > 0) {
        setReorderState({ orderId: order.id, busy: false, message: `Added ${added} item${added === 1 ? '' : 's'} to your bag at today's price. ${skipped} item${skipped === 1 ? ' is' : 's are'} no longer available.`, tone: 'warn' });
      } else {
        setReorderState({ orderId: order.id, busy: false, message: "Added to your bag at today's price.", tone: 'ok' });
      }
    } catch (err) {
      console.error('Reorder failed:', err);
      setReorderState({ orderId: order.id, busy: false, message: 'We could not add these items. Please try again.', tone: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center">
        <i className="ri-loader-4-line animate-spin text-3xl text-emerald-700"></i>
        <p className="mt-2 text-gray-500">Loading orders...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="py-12 text-center bg-white rounded-lg border border-gray-200">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="ri-error-warning-line text-3xl text-red-500" aria-hidden="true"></i>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">We could not load your orders</h3>
        <p className="text-gray-500 mb-6">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="inline-block bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium hover:bg-emerald-800 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="py-12 text-center bg-white rounded-lg border border-gray-200">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="ri-shopping-bag-line text-3xl text-gray-400"></i>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">No orders yet</h3>
        <p className="text-gray-500 mb-6">Start shopping to see your orders here.</p>
        <Link href="/shop" className="inline-block bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium hover:bg-emerald-800 transition-colors">
          Go to Shop
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Order History</h2>
        <div className="text-sm text-gray-600">
          Total Orders: <span className="font-bold text-gray-900">{orders.length}</span>
        </div>
      </div>

      <div className="space-y-6">
        {orders.map((order) => (
          <div key={order.id} className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
              <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-4">
                <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-4 sm:gap-6 w-full sm:w-auto">
                  <div className="w-full sm:w-auto">
                    <p className="text-xs text-gray-600 mb-1">Order Number</p>
                    <p className="font-bold text-gray-900">{order.orderNumber}</p>
                  </div>
                  <div className="w-full sm:w-auto">
                    <p className="text-xs text-gray-600 mb-1">Date</p>
                    <p className="font-semibold text-gray-900">
                      {new Date(order.date).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </p>
                  </div>
                  <div className="w-full sm:w-auto">
                    <p className="text-xs text-gray-600 mb-1">Total</p>
                    <p className="font-bold text-emerald-700">GH₵{order.total.toFixed(2)}</p>
                  </div>
                </div>
                <div className="w-full sm:w-auto">
                  <span className={`inline-block px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${getStatusColor(order.status)}`}>
                    {getStatusLabel(order.status)}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="space-y-4 mb-4">
                {order.items.map((item) => (
                  <div key={item.id} className="flex space-x-4">
                    <div className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 border border-gray-200">
                      {item.image ? (
                        <img
                          src={getOptimizedImageUrl(item.image, { width: 160 })}
                          alt={item.name}
                          className="w-full h-full object-cover object-center"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300" aria-hidden="true">
                          <i className="ri-image-line text-2xl"></i>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 mb-1">{item.name}</h4>
                      {item.variantName && <p className="text-sm text-gray-600">{item.variantName}</p>}
                      <p className="text-sm text-gray-600">Quantity: {item.quantity}</p>
                      <p className="text-sm font-bold text-gray-900 mt-1">GH₵{item.price.toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>

              {order.status === 'refund_requested' && (
                <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-start gap-2">
                  <i className="ri-information-line text-orange-600 mt-0.5 flex-shrink-0"></i>
                  <p className="text-sm text-orange-800">
                    <strong>Refund requested.</strong> Our team is reviewing your request and will process the refund manually. Please keep your order number handy.
                  </p>
                </div>
              )}
              {order.status === 'refunded' && (
                <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg flex items-start gap-2">
                  <i className="ri-checkbox-circle-line text-purple-600 mt-0.5 flex-shrink-0"></i>
                  <p className="text-sm text-purple-800">
                    <strong>Refund processed.</strong> Your refund has been completed. Please allow a few business days for it to reflect.
                  </p>
                </div>
              )}

              {reorderState?.orderId === order.id && reorderState.message && (
                <p
                  role="status"
                  className={`mb-4 p-3 rounded-lg text-sm ${reorderState.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : reorderState.tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}
                >
                  {reorderState.message}
                </p>
              )}

              <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-4 border-t border-gray-200">
                <Link
                  href={`/order-tracking?order=${order.orderNumber}`}
                  className="flex-1 sm:flex-none text-center px-4 py-2 bg-emerald-700 text-white rounded-lg font-semibold hover:bg-emerald-800 transition-colors whitespace-nowrap"
                >
                  <i className="ri-map-pin-line mr-2"></i>
                  Track Order
                </Link>
                <button
                  type="button"
                  onClick={() => handleReorder(order)}
                  disabled={reorderState?.orderId === order.id && reorderState.busy}
                  className="flex-1 sm:flex-none px-4 py-2 border-2 border-gray-300 text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  <i className="ri-refresh-line mr-2" aria-hidden="true"></i>
                  {reorderState?.orderId === order.id && reorderState.busy ? 'Adding…' : 'Reorder'}
                </button>
                <Link
                  href={`/account/orders/${order.id}`}
                  className="flex-1 sm:flex-none text-center px-4 py-2 border-2 border-gray-300 text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  <i className="ri-file-list-3-line mr-2" aria-hidden="true"></i>
                  Receipt
                </Link>
                <Link
                  href="/contact"
                  className="flex-1 sm:flex-none text-center px-4 py-2 border-2 border-gray-300 text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  <i className="ri-customer-service-line mr-2"></i>
                  Get Help
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

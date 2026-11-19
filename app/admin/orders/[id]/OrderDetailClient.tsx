'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { orderLineItemImageUrl } from '@/lib/orderLineItemImage';
import { PUBLIC_CONTACT_EMAIL } from '@/lib/brand-contact';
import {
  appendOrderStatusChange,
  fetchCurrentStaffActor,
  ORDER_STATUS_CHANGES_KEY,
  type OrderStatusChangeEntry,
} from '@/lib/orderStatusHistory';
import FraudDetectionAlert from '@/components/FraudDetectionAlert';

interface OrderDetailClientProps {
  orderId: string;
}

type RiskLevel = 'low' | 'medium' | 'high';

function formatCustomerPreferredDate(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

interface FraudAnalysis {
  riskLevel: RiskLevel;
  reasons: string[];
}

export default function OrderDetailClient({ orderId }: OrderDetailClientProps) {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  // Inject print styles
  useEffect(() => {
    const styleId = 'order-print-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = '@media print { body * { visibility: hidden; } .print-section, .print-section * { visibility: visible; } .print-section { position: absolute; left: 0; top: 0; width: 100%; padding: 20px; } .no-print { display: none !important; } }';
      document.head.appendChild(style);
    }
    return () => {
      const el = document.getElementById(styleId);
      if (el) el.remove();
    };
  }, []);

  useEffect(() => {
    fetchOrderDetails();
  }, [orderId]);

  // The orders list links here with ?print=true: open the print dialog once the slip has data.
  const [autoPrinted, setAutoPrinted] = useState(false);
  useEffect(() => {
    if (!order || autoPrinted || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('print') !== 'true') return;
    setAutoPrinted(true);
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [order, autoPrinted]);

  const fetchOrderDetails = async () => {
    try {
      setLoading(true);
      // Try to fetch by ID or order_number
      let query = supabase
        .from('orders')
        .select(`
          *,
          order_items (
            id,
            product_id,
            variant_id,
            product_name,
            variant_name,
            sku,
            quantity,
            unit_price,
            total_price,
            metadata,
            product_variants ( image_url ),
            products (
              product_images (url)
            )
          )
        `)
        .eq('id', orderId);

      let { data, error } = await query.single();

      if (error && error.code === 'PGRST116') {
        // Not found by ID, try order_number
        const { data: dataByNum, error: errorByNum } = await supabase
          .from('orders')
          .select(`
            *,
            order_items (
              id,
              product_id,
              variant_id,
              product_name,
              variant_name,
              sku,
              quantity,
              unit_price,
              total_price,
              metadata,
              product_variants ( image_url ),
              products (
                product_images (url)
              )
            )
          `)
          .eq('order_number', orderId)
          .single();

        if (dataByNum) {
          data = dataByNum;
          error = null;
        } else {
          error = errorByNum;
        }
      }

      if (error) throw error;
      setOrder(data);
      setTrackingNumber(data.metadata?.tracking_number || '');
      setAdminNotes(data.notes || '');

    } catch (err: any) {
      console.error('Error fetching order:', err);
      setError('Failed to load order details');
    } finally {
      setLoading(false);
    }
  };

  const getAuthToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  };

  /** Send the order-status email/SMS. Returns a warning string when it failed. */
  const sendStatusNotification = async (status: string): Promise<string | null> => {
    const addr = order?.shipping_address || {};
    const name = (addr.firstName && addr.lastName)
      ? `${addr.firstName.trim()} ${addr.lastName.trim()}`
      : addr.full_name || addr.firstName || order?.email?.split('@')[0] || 'Customer';
    try {
      const authToken = await getAuthToken();
      const notifRes = await fetch('/api/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        body: JSON.stringify({
          type: 'order_status',
          payload: {
            email: order.email,
            name,
            orderId: orderId,
            orderNumber: order.order_number || orderId,
            status,
            trackingNumber: trackingNumber,
            phone: addr.phone || order.phone
          }
        })
      });
      if (!notifRes.ok) {
        const body = await notifRes.json().catch(() => ({}));
        console.error('[OrderDetail] Notification non-2xx:', notifRes.status, body);
        return `Customer notification failed (${notifRes.status}): ${(body && (body as { error?: string }).error) || 'unknown error'}`;
      }
      return null;
    } catch (err: any) {
      console.error('[OrderDetail] Notification threw:', err);
      return `Notification could not be sent: ${err?.message || 'network error'}`;
    }
  };

  /**
   * Cancel or refund through the server so payment status and stock are
   * handled in one transaction. Asks for confirmation first.
   */
  const handleCancelOrRefund = async (action: 'cancel' | 'refund') => {
    if (!order) return;
    const wasPaid = order.payment_status === 'paid' || order.payment_status === 'partially_refunded';
    const stockTaken = !!order.metadata?.stock_reduced && !order.metadata?.stock_restored;
    const lines: string[] = [
      action === 'refund'
        ? `Mark order ${order.order_number} as REFUNDED?`
        : `Cancel order ${order.order_number}?`,
      '',
    ];
    if (action === 'refund') {
      lines.push(wasPaid
        ? '• Payment status will change to "refunded". This does not send money back: refund the customer through your payment provider (or in cash) yourself.'
        : '• The order was not paid, so payment status stays as it is.');
    } else if (wasPaid) {
      lines.push('• The order is paid. Cancelling does NOT mark the payment refunded. If you are giving the money back, use "Refunded" instead.');
    }
    lines.push(stockTaken
      ? '• The items will be put back into stock.'
      : '• Stock is not changed (it was never taken for this order, or was already returned).');
    lines.push('• The customer will be notified of the new status.');
    if (!confirm(lines.join('\n'))) return;

    try {
      setStatusUpdating(true);
      const authToken = await getAuthToken();
      const res = await fetch('/api/admin/orders/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { Authorization: `Bearer ${authToken}` }),
        },
        body: JSON.stringify({ orderId: order.id, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);

      const newStatus = action === 'refund' ? 'refunded' : 'cancelled';
      await fetchOrderDetails();
      const warning = body?.alreadyDone ? null : await sendStatusNotification(newStatus);
      alert(
        (body?.alreadyDone ? 'Order was already in that state.' : `Order ${newStatus}.`) +
          (body?.stockRestored ? ' Stock was returned.' : '') +
          (warning ? `\n\nThe customer was not notified: ${warning}` : '')
      );
      setShowStatusMenu(false);
    } catch (err: any) {
      console.error('Error cancelling/refunding order:', err);
      alert('Failed to update order: ' + (err?.message || 'Unknown error'));
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleUpdateStatus = async (newStatus?: string) => {
    if (newStatus && newStatus !== order.status && (newStatus === 'cancelled' || newStatus === 'refunded')) {
      await handleCancelOrRefund(newStatus === 'refunded' ? 'refund' : 'cancel');
      return;
    }
    try {
      setStatusUpdating(true);
      const previousStatus = order.status;
      const statusToUpdate = newStatus || order.status;
      const statusChanged = statusToUpdate !== previousStatus;

      let nextMetadata: Record<string, unknown> = {
        ...(order.metadata && typeof order.metadata === 'object' ? order.metadata : {}),
        tracking_number: trackingNumber,
      };

      if (statusChanged) {
        const actor = await fetchCurrentStaffActor(supabase);
        const entry: OrderStatusChangeEntry = {
          status: statusToUpdate,
          changed_at: new Date().toISOString(),
          changed_by_name: actor.name,
          changed_by_email: actor.email,
          changed_by_id: actor.id,
        };
        nextMetadata = appendOrderStatusChange(nextMetadata, entry);
      }

      const { error } = await supabase
        .from('orders')
        .update({
          status: statusToUpdate,
          notes: adminNotes,
          metadata: nextMetadata,
        })
        .eq('id', order.id);

      if (error) throw error;

      // Update local state
      setOrder({
        ...order,
        status: statusToUpdate,
        notes: adminNotes,
        metadata: nextMetadata,
      });

      // Send Notification (Email + SMS)
      // Only send if status changed OR tracking number was added/changed
      const trackingChanged = trackingNumber !== order.metadata?.tracking_number;

      let notificationWarning: string | null = null;
      if (statusChanged || (trackingChanged && trackingNumber)) {
        notificationWarning = await sendStatusNotification(statusToUpdate);
      }

      alert(
        notificationWarning
          ? `Order updated, but the customer was not notified.\n\n${notificationWarning}`
          : 'Order updated successfully'
      );
      setShowStatusMenu(false);
    } catch (err) {
      console.error('Error updating order:', err);
      alert('Failed to update order');
    } finally {
      setStatusUpdating(false);
    }
  };

  const [markingPaid, setMarkingPaid] = useState(false);
  const [resendingPayment, setResendingPayment] = useState(false);
  const [resendingNotification, setResendingNotification] = useState(false);

  const handleMarkAsPaid = async () => {
    if (!order) return;
    if (!confirm('Are you sure you want to mark this order as paid? This should only be done after confirming payment was received.')) return;

    try {
      setMarkingPaid(true);
      // The server route runs mark_order_paid: it takes the stock, moves a
      // pending order to processing, counts the coupon and records affiliate commission.
      const authToken = await getAuthToken();
      const res = await fetch('/api/admin/orders/mark-paid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { Authorization: `Bearer ${authToken}` }),
        },
        body: JSON.stringify({ orderNumber: order.order_number }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) {
        throw new Error(body?.error || `Request failed (${res.status})`);
      }

      await fetchOrderDetails();
      alert(body?.order?.already_paid ? 'This order was already marked as paid.' : 'Order marked as paid successfully!');
    } catch (err: any) {
      console.error('Error marking as paid:', err);
      alert('Failed to mark as paid: ' + (err.message || 'Unknown error'));
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleResendPaymentLink = async () => {
    if (!order) return;
    try {
      setResendingPayment(true);
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        body: JSON.stringify({
          type: 'payment_link',
          payload: order
        })
      });

      if (!response.ok) throw new Error('Failed to send payment link');
      alert('Payment link sent successfully!');
    } catch (err: any) {
      console.error('Error resending payment link:', err);
      alert('Failed to send payment link: ' + (err.message || 'Unknown error'));
    } finally {
      setResendingPayment(false);
    }
  };

  const handleResendNotification = async () => {
    if (!order) return;

    try {
      setResendingNotification(true);

      // Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const shippingAddress = order.shipping_address || {};
      const customerName = (shippingAddress.firstName && shippingAddress.lastName)
        ? `${shippingAddress.firstName.trim()} ${shippingAddress.lastName.trim()}`
        : shippingAddress.full_name || shippingAddress.firstName || order.email?.split('@')[0] || 'Customer';

      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        body: JSON.stringify({
          type: 'order_status',
          payload: {
            email: order.email,
            name: customerName,
            orderNumber: order.order_number || order.id,
            status: order.status,
            trackingNumber: order.metadata?.tracking_number || '',
            phone: order.phone || shippingAddress.phone
          }
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send notification');
      }

      alert('Notification sent successfully! (Email + SMS if phone available)');
    } catch (err: any) {
      console.error('Error resending notification:', err);
      alert(`Failed to resend notification: ${err.message || 'Unknown error'}`);
    } finally {
      setResendingNotification(false);
    }
  };

  const statusOptions = ['pending', 'processing', 'shipped', 'picked_up', 'completed', 'delivered', 'cancelled', 'refunded'];
  const statusLabel = (s: string) => {
    const labels: Record<string, string> = {
      shipped: 'Packaged',
      picked_up: 'Picked Up by Rider',
      completed: 'Completed',
      refunded: 'Refunded',
      awaiting_payment: 'Awaiting Payment'
    };
    return labels[s] || s.charAt(0).toUpperCase() + s.slice(1);
  };
  const statusColors: any = {
    'pending': 'bg-amber-100 text-amber-700 border-amber-200',
    'processing': 'bg-blue-100 text-blue-700 border-blue-200',
    'shipped': 'bg-purple-100 text-purple-700 border-purple-200',
    'picked_up': 'bg-indigo-100 text-indigo-700 border-indigo-200',
    'completed': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'delivered': 'bg-green-100 text-green-700 border-green-200',
    'cancelled': 'bg-red-100 text-red-700 border-red-200',
    'awaiting_payment': 'bg-gray-100 text-gray-700 border-gray-200',
    'refunded': 'bg-purple-100 text-purple-700 border-purple-200'
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (error || !order) return <div className="p-8 text-center text-red-500">{error || 'Order not found'}</div>;

  const currentStatus = order.status || 'pending';
  const shippingAddress = order.shipping_address || {};
  const customerName = (shippingAddress.firstName && shippingAddress.lastName)
    ? `${shippingAddress.firstName.trim()} ${shippingAddress.lastName.trim()}`
    : shippingAddress.full_name || shippingAddress.firstName || order.email?.split('@')[0] || 'Customer';

  const statusChangeLog: OrderStatusChangeEntry[] = Array.isArray(
    (order.metadata as Record<string, unknown> | undefined)?.[ORDER_STATUS_CHANGES_KEY]
  )
    ? [
        ...((order.metadata as Record<string, unknown>)[ORDER_STATUS_CHANGES_KEY] as OrderStatusChangeEntry[]),
      ].reverse()
    : [];

  // Derive timeline from status (simplified logic as we don't have full history table joined here yet)
  const timeline = [
    { status: 'Order Placed', date: new Date(order.created_at).toLocaleString(), completed: true },
    { status: 'Payment', date: order.payment_status, completed: order.payment_status === 'paid' },
    { status: 'Processing', date: '', completed: ['processing', 'shipped', 'picked_up', 'completed', 'delivered'].includes(order.status) },
    { status: 'Packaged', date: '', completed: ['shipped', 'picked_up', 'completed', 'delivered'].includes(order.status) },
    { status: 'Picked Up by Rider', date: '', completed: ['picked_up', 'completed', 'delivered'].includes(order.status) },
    { status: 'Completed', date: '', completed: ['completed', 'delivered'].includes(order.status) },
    { status: 'Delivered', date: '', completed: order.status === 'delivered' }
  ];

  // Mock fraud analysis for now (or implement real logic later)
  const fraudAnalysis: FraudAnalysis = {
    riskLevel: 'low',
    reasons: []
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Print styles injected via useEffect */}

      {/* Printable Order Slip */}
      <div className="print-section hidden print:block bg-white p-8">
        <div className="border-2 border-gray-800 p-6">
          {/* Header */}
          <div className="flex justify-between items-start border-b-2 border-gray-800 pb-4 mb-4">
            <div>
              <h1 className="text-2xl font-bold">Discount Discovery Zone</h1>
              <p className="text-sm text-gray-600">Order Packing Slip</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-lg">{order?.order_number}</p>
              <p className="text-sm">{order ? new Date(order.created_at).toLocaleDateString() : ''}</p>
            </div>
          </div>

          {/* Ship To */}
          <div className="mb-6">
            <h2 className="font-bold text-lg mb-2 bg-gray-200 px-2 py-1">SHIP TO:</h2>
            <div className="pl-2">
              <p className="font-bold text-lg">{customerName}</p>
              <p>{shippingAddress.phone || order?.phone}</p>
              <p>{shippingAddress.address || shippingAddress.address_line1}</p>
              <p>{shippingAddress.city}{(shippingAddress.region || shippingAddress.state) && `, ${shippingAddress.region || shippingAddress.state}`}</p>
              {order?.metadata?.customer_preferred_date && (
                <p className="mt-2 font-semibold">
                  Preferred date: {formatCustomerPreferredDate(String(order.metadata.customer_preferred_date))}
                </p>
              )}
            </div>
          </div>

          {/* Order Items */}
          <div className="mb-6">
            <h2 className="font-bold text-lg mb-2 bg-gray-200 px-2 py-1">ORDER ITEMS:</h2>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="text-left py-2 px-2 w-16"> </th>
                  <th className="text-left py-2 px-2">Product</th>
                  <th className="text-left py-2 px-2">Variant</th>
                  <th className="text-center py-2 px-2">Qty</th>
                  <th className="text-right py-2 px-2">Price</th>
                </tr>
              </thead>
              <tbody>
                {order?.order_items?.map((item: any) => {
                  const lineImg = orderLineItemImageUrl(item);
                  return (
                  <tr key={item.id} className="border-b border-gray-200">
                    <td className="py-2 px-2 align-middle w-16">
                      {lineImg ? (
                        <img src={lineImg} alt="" className="w-12 h-12 object-cover rounded border border-gray-300" />
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2 font-medium">{item.product_name}</td>
                    <td className="py-2 px-2 text-sm">{item.variant_name || '-'}</td>
                    <td className="py-2 px-2 text-center font-bold">{item.quantity}</td>
                    <td className="py-2 px-2 text-right">GH₵ {item.unit_price?.toFixed(2)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Order Summary */}
          <div className="flex justify-between mb-6">
            <div>
              <p><span className="font-semibold">Shipping Method:</span> {order?.shipping_method || 'Standard'}</p>
              <p><span className="font-semibold">Payment:</span> {order?.payment_method} ({order?.payment_status})</p>
              {trackingNumber && <p><span className="font-semibold">Tracking #:</span> {trackingNumber}</p>}
            </div>
            <div className="text-right">
              <p>Subtotal: GH₵ {order?.subtotal?.toFixed(2)}</p>
              <p>Shipping: GH₵ {Number(order?.shipping_total || 0).toFixed(2)}</p>
              {Number(order?.discount_total || 0) > 0 && (
                <p>Discount: -GH₵ {Number(order.discount_total).toFixed(2)}</p>
              )}
              {Number(order?.tax_total || 0) > 0 && (
                <p>Tax: GH₵ {Number(order.tax_total).toFixed(2)}</p>
              )}
              <p className="font-bold text-lg border-t border-gray-400 pt-1 mt-1">Total: GH₵ {order?.total?.toFixed(2)}</p>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t-2 border-gray-800 pt-4 text-center text-sm text-gray-600">
            <p>Thank you for shopping with Discount Discovery Zone!</p>
            <p>Questions? Contact us at {PUBLIC_CONTACT_EMAIL}</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 no-print">
        {/* Page Header with Print Button */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <Link href="/admin/orders" className="text-gray-600 hover:text-gray-900">
              <i className="ri-arrow-left-line text-2xl"></i>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{order?.order_number}</h1>
              <p className="text-sm text-gray-600">Order placed on {order ? new Date(order.created_at).toLocaleDateString() : ''}</p>
            </div>
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center space-x-2 bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <i className="ri-printer-line text-lg"></i>
            <span>Print Order</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {fraudAnalysis.riskLevel !== 'low' && (
              <FraudDetectionAlert
                riskLevel={fraudAnalysis.riskLevel}
                reasons={fraudAnalysis.reasons}
                orderId={orderId}
              />
            )}

            {currentStatus === 'refunded' && (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex gap-3">
                <i className="ri-checkbox-circle-line text-xl text-purple-600 flex-shrink-0 mt-0.5"></i>
                <p className="text-sm text-purple-900"><strong>Refund completed.</strong> This order has been marked as refunded.</p>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">Order Items</h2>
                <span className="text-gray-600">{order.order_items?.length || 0} items</span>
              </div>

              <div className="space-y-4">
                {order.order_items?.map((item: any) => {
                  const lineImg = orderLineItemImageUrl(item);
                  return (
                  <div key={item.id} className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg">
                    <div className="w-20 h-20 bg-white rounded-lg overflow-hidden border border-gray-200 flex items-center justify-center relative shrink-0">
                      {lineImg ? (
                        <img
                          src={lineImg}
                          alt={item.product_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <i className="ri-image-line text-2xl text-gray-300"></i>
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 mb-1">{item.product_name}</h3>
                      <p className="text-sm text-gray-600 mb-1">{item.variant_name}</p>
                      <p className="text-xs text-gray-500">SKU: {item.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900 mb-1">GH₵ {item.unit_price?.toFixed(2)}</p>
                      <p className="text-sm text-gray-600">Qty: {item.quantity}</p>
                    </div>
                  </div>
                  );
                })}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200 space-y-3">
                <div className="flex justify-between text-gray-700">
                  <span>Subtotal</span>
                  <span>GH₵ {order.subtotal?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>Shipping</span>
                  <span>GH₵ {order.shipping_total?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>Tax</span>
                  <span>GH₵ {order.tax_total?.toFixed(2)}</span>
                </div>
                {order.discount_total > 0 && (
                  <div className="flex justify-between text-blue-700 font-semibold">
                    <span>Discount</span>
                    <span>-GH₵ {order.discount_total?.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xl font-bold text-gray-900 pt-3 border-t border-gray-200">
                  <span>Total</span>
                  <span>GH₵ {order.total?.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Order Timeline</h2>
              <div className="space-y-4">
                {timeline.map((event, index) => (
                  <div key={index} className="flex items-start space-x-4">
                    <div className={`w-10 h-10 flex items-center justify-center rounded-full border-2 ${event.completed ? 'bg-blue-700 border-blue-700' : 'bg-white border-gray-300'
                      }`}>
                      {event.completed ? (
                        <i className="ri-check-line text-white text-xl"></i>
                      ) : (
                        <span className="w-3 h-3 bg-gray-300 rounded-full"></span>
                      )}
                    </div>
                    <div className="flex-1 pb-6 border-b border-gray-200 last:border-0">
                      <p className={`font-semibold ${event.completed ? 'text-gray-900' : 'text-gray-500'}`}>
                        {event.status}
                      </p>
                      {event.date && (
                        <p className="text-sm text-gray-600 mt-1">{event.date}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Order Status</h2>
              <div className="relative">
                <button
                  onClick={() => setShowStatusMenu(!showStatusMenu)}
                  className={`w-full px-4 py-3 rounded-lg border-2 font-semibold text-left flex items-center justify-between ${statusColors[currentStatus] || 'bg-gray-100'}`}
                >
                  <span>{statusLabel(currentStatus)}</span>
                  <i className="ri-arrow-down-s-line text-xl"></i>
                </button>
                {showStatusMenu && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-gray-200 rounded-lg shadow-lg overflow-hidden z-10">
                    {statusOptions.map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          handleUpdateStatus(status);
                        }}
                        className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${status === currentStatus ? 'bg-blue-50 font-semibold' : ''
                          }`}
                      >
                        {statusLabel(status)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Tracking Number
                </label>
                <input
                  type="text"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <button
                onClick={() => handleUpdateStatus()}
                disabled={statusUpdating}
                className="w-full mt-4 bg-blue-700 hover:bg-blue-800 text-white py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {statusUpdating ? 'Updating...' : 'Update Status'}
              </button>
            </div>

            {statusChangeLog.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-2">Who changed the status</h2>
                <p className="text-sm text-gray-600 mb-4">
                  Newest first. Each row is recorded when an admin or staff member saves a new order status.
                </p>
                <ul className="space-y-3 max-h-64 overflow-y-auto">
                  {statusChangeLog.map((entry, idx) => (
                    <li
                      key={`${entry.changed_at}-${idx}`}
                      className="text-sm border-b border-gray-100 last:border-0 pb-3 last:pb-0"
                    >
                      <p className="font-semibold text-gray-900">
                        {statusLabel(entry.status)}
                        <span className="font-normal text-gray-500">
                          {' '}
                          · {new Date(entry.changed_at).toLocaleString()}
                        </span>
                      </p>
                      <p className="text-gray-700 mt-0.5">
                        By <span className="font-medium">{entry.changed_by_name}</span>
                        {entry.changed_by_email ? (
                          <span className="text-gray-500"> ({entry.changed_by_email})</span>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Customer</h2>
              <div className="flex items-start space-x-3 mb-4">
                <div className="w-12 h-12 flex items-center justify-center bg-blue-100 text-blue-700 rounded-full font-semibold uppercase">
                  {customerName.substring(0, 2)}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{customerName}</p>
                  <p className="text-sm text-gray-600">{order.email}</p>
                  <p className="text-sm text-gray-600">{shippingAddress.phone || order.phone}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Shipping Address</h2>
              {order.metadata?.customer_preferred_date && (
                <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-100">
                  <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide mb-0.5">
                    Customer preferred date
                  </p>
                  <p className="text-sm font-medium text-gray-900">
                    {formatCustomerPreferredDate(String(order.metadata.customer_preferred_date))}
                  </p>
                </div>
              )}
              <div className="text-gray-700 space-y-1">
                {/* Support both old field names (address_line1) and new (address) */}
                <p>{shippingAddress.address || shippingAddress.address_line1}</p>
                {(shippingAddress.address_line2) && <p>{shippingAddress.address_line2}</p>}
                <p>
                  {shippingAddress.city}
                  {(shippingAddress.region || shippingAddress.state) && `, ${shippingAddress.region || shippingAddress.state}`}
                </p>
                {shippingAddress.postal_code && <p>{shippingAddress.postal_code}</p>}
                {shippingAddress.country && <p className="font-semibold">{shippingAddress.country}</p>}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Payment Info</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Method</span>
                  <span className="font-semibold text-gray-900 capitalize">{order.payment_method}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Status</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold whitespace-nowrap capitalize ${
                    order.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {order.payment_status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Transaction</span>
                  <span className="text-sm text-gray-900 font-mono truncate max-w-[150px]">
                    {order.metadata?.hubtel_checkout_id || order.metadata?.moolre_reference || order.payment_transaction_id || 'N/A'}
                  </span>
                </div>
              </div>

              {(order.payment_status === 'pending' || order.payment_status === 'failed') && order.status !== 'cancelled' && order.status !== 'refunded' && (
                <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                  <button
                    onClick={handleMarkAsPaid}
                    disabled={markingPaid}
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50 flex items-center justify-center cursor-pointer"
                  >
                    {markingPaid ? (
                      <><i className="ri-loader-4-line animate-spin mr-2"></i>Processing...</>
                    ) : (
                      <><i className="ri-checkbox-circle-line mr-2"></i>Mark as Paid</>
                    )}
                  </button>
                  <button
                    onClick={handleResendPaymentLink}
                    disabled={resendingPayment}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50 flex items-center justify-center cursor-pointer"
                  >
                    {resendingPayment ? (
                      <><i className="ri-loader-4-line animate-spin mr-2"></i>Sending...</>
                    ) : (
                      <><i className="ri-send-plane-line mr-2"></i>Resend Payment Link</>
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Notifications</h2>
              <p className="text-sm text-gray-600 mb-4">
                Resend email and SMS notifications to the customer about the current order status.
              </p>
              <button
                onClick={handleResendNotification}
                disabled={resendingNotification}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50 flex items-center justify-center"
              >
                {resendingNotification ? (
                  <>
                    <i className="ri-loader-4-line animate-spin mr-2"></i>
                    Sending...
                  </>
                ) : (
                  <>
                    <i className="ri-notification-3-line mr-2"></i>
                    Resend Notifications
                  </>
                )}
              </button>
              <p className="text-xs text-gray-500 mt-2">
                Phone: {order.phone || shippingAddress.phone || 'Not provided'}
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Admin Notes</h2>
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Add internal notes about this order..."
                rows={4}
                maxLength={500}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              />
              <button
                onClick={() => handleUpdateStatus()}
                disabled={statusUpdating}
                className="w-full mt-3 bg-gray-700 hover:bg-gray-800 text-white py-2 rounded-lg font-medium transition-colors whitespace-nowrap disabled:opacity-50"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

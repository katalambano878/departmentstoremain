'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export const TICKET_CATEGORIES = [
  { value: 'order', label: 'Order', icon: 'ri-shopping-bag-line' },
  { value: 'delivery', label: 'Delivery or pickup', icon: 'ri-truck-line' },
  { value: 'payment', label: 'Payment', icon: 'ri-bank-card-line' },
  { value: 'return', label: 'Return', icon: 'ri-arrow-left-right-line' },
  { value: 'product', label: 'Product question', icon: 'ri-gift-line' },
  { value: 'account', label: 'Account', icon: 'ri-user-line' },
  { value: 'other', label: 'Other', icon: 'ri-question-line' },
];

export function categoryLabel(value: string | null | undefined): string {
  return TICKET_CATEGORIES.find((c) => c.value === value)?.label || 'Other';
}

// ticket_status enum: open, in_progress, waiting_customer, resolved, closed
export const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_customer: 'Waiting for your reply',
  resolved: 'Resolved',
  closed: 'Closed',
};

export function statusColor(status: string): string {
  switch (status) {
    case 'open': return 'bg-emerald-100 text-emerald-800';
    case 'in_progress': return 'bg-amber-100 text-amber-800';
    case 'waiting_customer': return 'bg-orange-100 text-orange-800';
    case 'resolved': return 'bg-blue-100 text-blue-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}

export function ticketRef(n: number | null | undefined): string {
  return n ? `#${n}` : '';
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Accra',
  });
}

/** The signed-in customer, or guest = true when nobody is signed in. */
export function useSupportUser() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setUser({ id: session.user.id, email: session.user.email || '' });
      setChecking(false);
    });
  }, []);

  return { user, checking, guest: !checking && !user };
}

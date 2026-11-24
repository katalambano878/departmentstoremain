'use client';

import { useEffect, useState } from 'react';
import { SmsCreditDashboardCard } from '@/components/admin/SmsCreditDashboardCard';
import type { DashboardSmsCredit } from '@/lib/sms-credit-types';

export function SmsCreditLiveCard() {
  const [smsCredit, setSmsCredit] = useState<DashboardSmsCredit | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/sms-dashboard-credit', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('balance');
        return res.json() as Promise<DashboardSmsCredit>;
      })
      .then((data) => {
        if (!cancelled) setSmsCredit(data);
      })
      .catch(() => {
        if (!cancelled) setSmsCredit({ status: 'load_failed' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!smsCredit) return null;
  return <SmsCreditDashboardCard smsCredit={smsCredit} />;
}

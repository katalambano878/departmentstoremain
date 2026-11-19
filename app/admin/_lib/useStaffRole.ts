'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type StaffRole = 'admin' | 'staff' | 'staff_pos' | null;

/**
 * The signed-in dashboard user's role from `profiles`. `loading` stays true
 * until it is known, so pages can avoid flashing admin-only controls.
 * This only decides what to show: the database policies are the real gate.
 */
export function useStaffRole(): { role: StaffRole; userId: string | null; loading: boolean } {
  const [role, setRole] = useState<StaffRole>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle();
        if (cancelled) return;
        setUserId(session.user.id);
        const r = data?.role;
        setRole(r === 'admin' || r === 'staff' || r === 'staff_pos' ? r : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { role, userId, loading };
}

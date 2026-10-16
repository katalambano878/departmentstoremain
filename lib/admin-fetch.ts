'use client';

import { supabase } from '@/lib/supabase';

/** Calls an admin API route with the signed-in session and returns parsed JSON or throws a readable error. */
export async function adminFetch<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(url, { ...init, headers, credentials: 'include', cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || json?.message || `Request failed (${res.status})`);
  }
  return json as T;
}

export function cedis(n: number | null | undefined): string {
  const value = Number(n) || 0;
  return `GH₵ ${value.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

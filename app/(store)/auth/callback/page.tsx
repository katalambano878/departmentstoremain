'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * Completes Supabase email confirmation / OAuth redirect (PKCE).
 * Add this exact URL to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState('Signing you in…');

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        const next = url.searchParams.get('next') || '/account';

        // supabase-js already exchanges ?code= while it initializes
        // (detectSessionInUrl); exchanging it again would fail, so only do it
        // when that left no session.
        const {
          data: { session: existing },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        if (existing) {
          router.replace(next);
          router.refresh();
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (cancelled) return;
          if (error) {
            setMessage('Your email is confirmed, but this link could not sign you in on this device. Please sign in with your email and password.');
            return;
          }
          router.replace(next);
          router.refresh();
          return;
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (cancelled) return;
        if (sessionError) {
          setMessage(`Could not complete sign-in: ${sessionError.message}`);
          return;
        }
        if (session) {
          router.replace(next);
          router.refresh();
          return;
        }

        setMessage('No active session. Try signing in again, or use the link from your latest email.');
      } catch (e: unknown) {
        if (!cancelled) {
          setMessage(e instanceof Error ? e.message : 'Something went wrong.');
        }
      }
    };

    void finish();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm p-8 text-center">
        <p className="text-gray-800 mb-6">{message}</p>
        <Link
          href="/auth/login"
          className="text-emerald-700 font-semibold hover:text-emerald-900"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}

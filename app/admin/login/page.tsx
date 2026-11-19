'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useRecaptcha } from '@/hooks/useRecaptcha';
import { useCMS } from '@/context/CMSContext';

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { getToken, verifying } = useRecaptcha();
  const { getSetting } = useCMS();
  const siteName = getSetting('site_name') || 'Discount Discovery Zone';
  const siteLogo = getSetting('site_logo');

  useEffect(() => {
    const q = searchParams.get('error');
    if (q === 'unauthorized') {
      setError(
        'Your account does not have admin access. Sign in with an admin, staff, or POS staff account.'
      );
    } else if (q === 'session_expired') {
      setNotice('Your session expired, please sign in again.');
    }
  }, [searchParams]);

  // Only follow a redirect back into the dashboard: a same-site path under /admin,
  // never a protocol-relative (//host) or absolute URL.
  const safeRedirect = (): string => {
    const raw = searchParams.get('redirect') || '';
    if (!raw.startsWith('/admin') || raw.startsWith('//') || raw.includes('\\')) return '/admin';
    if (raw.startsWith('/admin/login')) return '/admin';
    try {
      const url = new URL(raw, window.location.origin);
      const inAdmin = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
      if (url.origin !== window.location.origin || !inAdmin) return '/admin';
      return url.pathname + url.search + url.hash;
    } catch {
      return '/admin';
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setIsLoading(true);

    const isHuman = await getToken('admin_login');
    if (!isHuman) {
      setError('Security verification failed. Please try again.');
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      if (data.session) {
        document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax; Secure`;
        document.cookie = `sb-refresh-token=${data.session.refresh_token}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax; Secure`;

        router.push(safeRedirect());
        router.refresh();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] min-h-screen w-full overflow-x-hidden overflow-y-auto bg-gradient-to-br from-blue-50 via-white to-gray-50 flex flex-col items-center justify-start sm:justify-center pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] px-4 sm:px-6">
      <div className="w-full max-w-md mx-auto flex-1 flex flex-col justify-center sm:flex-none sm:justify-start py-4 sm:py-0">
        <div className="text-center mb-6 sm:mb-8">
          <Link href="/" className="inline-block max-w-full">
            {siteLogo ? (
              <img
                src={siteLogo}
                alt={siteName}
                className="h-10 sm:h-12 w-auto max-h-12 max-w-[min(100%,min(280px,90vw))] mx-auto object-contain"
              />
            ) : (
              <span className="text-xl sm:text-2xl font-bold text-blue-700 tracking-tight px-1 break-words">
                {siteName}
              </span>
            )}
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-4 sm:mt-6 mb-2 px-1">
            Admin Login
          </h1>
          <p className="text-gray-600 text-sm sm:text-base px-2">
            Sign in to access the admin dashboard
          </p>
        </div>

        <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-5 sm:p-8 border border-gray-100 w-full">
          {notice && !error && (
            <div className="mb-5 sm:mb-6 p-3 sm:p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3" role="status">
              <i className="ri-time-line text-amber-600 text-xl mt-0.5 shrink-0" aria-hidden />
              <p className="text-amber-800 text-sm sm:text-base min-w-0 text-left">{notice}</p>
            </div>
          )}

          {error && (
            <div className="mb-5 sm:mb-6 p-3 sm:p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <i className="ri-error-warning-line text-red-600 text-xl mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 text-left">
                <p className="text-red-800 font-semibold text-sm sm:text-base">Login Failed</p>
                <p className="text-red-700 text-xs sm:text-sm mt-1 break-words">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2" htmlFor="admin-email">
                Email Address
              </label>
              <div className="relative">
                <i
                  className="ri-mail-line absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg pointer-events-none"
                  aria-hidden
                />
                <input
                  id="admin-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full min-h-[44px] pl-10 sm:pl-12 pr-3 sm:pr-4 py-2.5 sm:py-3 text-base border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2" htmlFor="admin-password">
                Password
              </label>
              <div className="relative">
                <i
                  className="ri-lock-line absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg pointer-events-none"
                  aria-hidden
                />
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[44px] pl-10 sm:pl-12 pr-11 sm:pr-12 py-2.5 sm:py-3 text-base border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 min-w-[44px] min-h-[44px] flex items-center justify-center touch-manipulation"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <i className={`${showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-lg`} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || verifying}
              className="w-full min-h-[48px] bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation text-base"
            >
              {isLoading || verifying ? (
                <span className="flex items-center justify-center gap-2">
                  <i className="ri-loader-4-line animate-spin shrink-0" aria-hidden />
                  <span>{verifying ? 'Verifying...' : 'Signing in...'}</span>
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <div className="mt-5 sm:mt-6 text-center pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 text-sm text-gray-600 hover:text-blue-700 transition-colors py-2 touch-manipulation"
          >
            <i className="ri-arrow-left-line shrink-0" aria-hidden />
            <span>Back to Store</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-gray-50 text-gray-500 text-sm">
      Loading…
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <AdminLoginForm />
    </Suspense>
  );
}

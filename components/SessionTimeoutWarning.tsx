'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

const IDLE_TIMEOUT = 25 * 60 * 1000;
const WARNING_TIME = 60 * 1000;

/**
 * Signs a signed-in customer out after 25 minutes without activity, with a
 * one-minute warning. Guests never see it (nothing to sign out of).
 */
export default function SessionTimeoutWarning() {
  const [signedIn, setSignedIn] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const lastActivity = useRef(Date.now());
  const loggingOut = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSignedIn(!!session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      lastActivity.current = Date.now();
      if (!session) setShowWarning(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = useCallback(async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    try {
      await supabase.auth.signOut();
    } catch {
      // Sign-out clears the local session even if the server call fails.
    }
    const here = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/auth/login?redirect=${encodeURIComponent(here)}`;
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    lastActivity.current = Date.now();
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];

    const resetTimer = () => {
      lastActivity.current = Date.now();
      setShowWarning(false);
    };

    activityEvents.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }));

    const checkInterval = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= IDLE_TIMEOUT) {
        handleLogout();
      } else if (idle >= IDLE_TIMEOUT - WARNING_TIME) {
        setShowWarning(true);
        setCountdown(Math.ceil((IDLE_TIMEOUT - idle) / 1000));
      }
    }, 1000);

    return () => {
      activityEvents.forEach((event) => window.removeEventListener(event, resetTimer));
      clearInterval(checkInterval);
    };
  }, [signedIn, handleLogout]);

  const handleStayLoggedIn = () => {
    lastActivity.current = Date.now();
    setShowWarning(false);
    setCountdown(60);
  };

  if (!signedIn || !showWarning) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-timeout-title"
        aria-describedby="session-timeout-desc"
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
            <i className="ri-time-line text-2xl text-orange-600" aria-hidden="true"></i>
          </div>
          <div>
            <h3 id="session-timeout-title" className="font-bold text-lg">Are you still there?</h3>
            <p id="session-timeout-desc" className="text-sm text-gray-600">You will be signed out soon because of inactivity.</p>
          </div>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-700 mb-2">Signing out in:</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-orange-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 transition-all duration-1000"
                style={{ width: `${(countdown / 60) * 100}%` }}
              />
            </div>
            <span className="text-2xl font-bold text-orange-600 tabular-nums">{countdown}s</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleLogout}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium whitespace-nowrap"
          >
            Sign out now
          </button>
          <button
            type="button"
            autoFocus
            onClick={handleStayLoggedIn}
            className="flex-1 px-4 py-2.5 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium whitespace-nowrap"
          >
            Stay signed in
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-4">
          For your security, you are signed out after 25 minutes without activity. Your bag is kept.
        </p>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { APP_BUILD, hasReloadGuard, onReloadGuardChange, reloadGuardBusy } from '@/lib/app-version';

const CHECK_EVERY_MS = 2 * 60 * 1000;
/** Do not refresh for the same build twice within this time (the old server can still answer mid-deploy). */
const REFRESH_GAP_MS = 60 * 1000;
/** After this many refreshes for one build that did not bring it, stop refreshing by itself and only show the notice. */
const MAX_AUTO_REFRESHES = 3;
const REFRESH_MARK_KEY = 'ddz_update_refresh';

type RefreshMark = { build: string; at: number; count: number };

function readMark(): RefreshMark | null {
  try {
    const raw = sessionStorage.getItem(REFRESH_MARK_KEY);
    const mark = raw ? JSON.parse(raw) : null;
    if (!mark || typeof mark.build !== 'string' || typeof mark.at !== 'number') return null;
    return { build: mark.build, at: mark.at, count: typeof mark.count === 'number' ? mark.count : 1 };
  } catch {
    return null;
  }
}

function writeMark(build: string) {
  try {
    const prev = readMark();
    const count = prev && prev.build === build ? prev.count + 1 : 1;
    sessionStorage.setItem(REFRESH_MARK_KEY, JSON.stringify({ build, at: Date.now(), count }));
  } catch {
    // Private mode or blocked storage: the refresh still happens.
  }
}

/** Typing into a search box is not work a refresh would lose. */
function isWorkField(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return target.type !== 'search';
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}

/**
 * Keeps an open dashboard or till tab on the build the server is running.
 *
 * It asks `/api/version` every two minutes and whenever the tab comes back
 * into view. When the server has a newer build it refreshes the page, unless a
 * refresh would lose work: a page with a reload guard that is busy (the till's
 * open sale), or a page with no guard where something has been typed. Then it
 * shows a notice and refreshes as soon as the work is done.
 */
export default function AppUpdateWatcher() {
  const pathname = usePathname();
  const [newBuild, setNewBuild] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [, setTick] = useState(0);
  const refreshing = useRef(false);
  const lastAsked = useRef(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  const check = useCallback(async () => {
    if (!APP_BUILD) return;
    const asked = ++lastAsked.current;
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      // Only the newest answer counts; a slow earlier one must not undo it.
      if (asked !== lastAsked.current) return;
      const build = typeof body?.build === 'string' ? body.build : '';
      setNewBuild(build && build !== APP_BUILD ? build : null);
    } catch {
      // Offline, or the server is restarting. The next check tries again.
    }
  }, []);

  // Ask now, on a timer, and whenever the tab is looked at again.
  useEffect(() => {
    if (!APP_BUILD) return;
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    window.addEventListener('pageshow', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      window.removeEventListener('pageshow', check);
    };
  }, [check]);

  // Has anything been typed on this page? Starts again on each page.
  useEffect(() => {
    setTyped(false);
    const onInput = (event: Event) => {
      if (isWorkField(event.target)) setTyped(true);
    };
    document.addEventListener('input', onInput, true);
    return () => document.removeEventListener('input', onInput, true);
  }, [pathname]);

  useEffect(() => onReloadGuardChange(bump), [bump]);

  const busy = hasReloadGuard() ? reloadGuardBusy() : typed;
  const mark = newBuild ? readMark() : null;
  const sameBuild = !!newBuild && !!mark && mark.build === newBuild;
  const waitMs = sameBuild && mark ? Math.max(0, REFRESH_GAP_MS - (Date.now() - mark.at)) : 0;
  // Refreshing has not brought this build several times running: leave it to the person.
  const gaveUp = sameBuild && !!mark && mark.count >= MAX_AUTO_REFRESHES;

  const refresh = useCallback(() => {
    if (!newBuild || refreshing.current) return;
    refreshing.current = true;
    writeMark(newBuild);
    window.location.reload();
  }, [newBuild]);

  // Refresh as soon as it is safe.
  useEffect(() => {
    if (!newBuild || busy || gaveUp) return;
    if (waitMs > 0) {
      const timer = window.setTimeout(bump, waitMs + 50);
      return () => window.clearTimeout(timer);
    }
    refresh();
  }, [newBuild, busy, gaveUp, waitMs, refresh, bump]);

  // The notice shows only while the refresh is being held back.
  if (!newBuild || hidden || (!busy && !gaveUp && waitMs === 0)) return null;

  const guarded = hasReloadGuard();
  const message = !busy
    ? gaveUp
      ? 'Refresh this page to get it.'
      : 'This page will refresh by itself in a moment.'
    : guarded
      ? 'This page will refresh by itself when you close this sale.'
      : 'Save your work, then refresh this page.';

  const refreshNow = () => {
    if (busy && guarded && !window.confirm('Refreshing now clears the sale on this screen. Refresh anyway?')) return;
    refresh();
  };

  return (
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[70] flex justify-center">
      {/* Phone: message and close on the first row, the button across the second. Wider: one row. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto grid w-full max-w-xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl bg-gray-900 p-3 pl-4 text-white shadow-lg sm:flex sm:py-2.5 sm:pr-2"
      >
        <i className="ri-refresh-line hidden flex-none text-xl text-emerald-300 sm:block" aria-hidden="true"></i>
        <div className="min-w-0 sm:flex-1">
          <p className="font-semibold leading-snug">An update is ready</p>
          <p className="text-sm leading-snug text-gray-300">{message}</p>
        </div>
        <button
          type="button"
          onClick={refreshNow}
          className="col-span-2 row-start-2 min-h-[44px] flex-none rounded-lg bg-white px-4 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Refresh now
        </button>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="Hide this notice"
          className="col-start-2 row-start-1 flex h-11 w-11 flex-none items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <i className="ri-close-line text-xl" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  );
}

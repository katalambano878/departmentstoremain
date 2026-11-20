/**
 * The build this bundle came from, and a way for a page to say "do not
 * refresh me right now".
 *
 * A dashboard or till tab left open keeps running the code it loaded. After a
 * deploy that code can be out of step with the server (on 2026-11-20 the till
 * could not save a sale for hours). `AppUpdateWatcher` compares APP_BUILD with
 * `/api/version` and refreshes the tab once it is safe.
 */

/** Set at build time in next.config.ts. Empty when the build did not set it. */
export const APP_BUILD: string = process.env.NEXT_PUBLIC_APP_BUILD || '';

type Listener = () => void;

const guards = new Map<string, boolean>();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn());
}

/**
 * A page that holds work a refresh would lose (the till's open sale) reports
 * it here. While any guard is busy the tab is not refreshed automatically.
 */
export function setReloadGuard(key: string, busy: boolean) {
  if (guards.get(key) === busy) return;
  guards.set(key, busy);
  notify();
}

/** Call when the page that set the guard goes away. */
export function clearReloadGuard(key: string) {
  if (!guards.has(key)) return;
  guards.delete(key);
  notify();
}

/** True when the current page has told us how to judge "busy". */
export function hasReloadGuard(): boolean {
  return guards.size > 0;
}

/** True while a page holds work a refresh would lose. */
export function reloadGuardBusy(): boolean {
  for (const busy of guards.values()) if (busy) return true;
  return false;
}

export function onReloadGuardChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

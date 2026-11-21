/**
 * Evidence for faults that only happen on staff phones.
 *
 * The sign-in library calls `recordAuthStep` for every internal step (its
 * `debug` hook, set in lib/supabase.ts). We keep the last steps in memory, as
 * short text only: objects become "{…}" and anything that looks like a token
 * becomes "[token]". When a page is stuck it calls `reportStuck`, which sends
 * those steps to /api/client-report so they appear in the server log.
 */

type Step = { t: number; m: string };

const MAX_STEPS = 120;
const pageStart = Date.now();
const steps: Step[] = [];
const reported = new Set<string>();

const TOKEN_LIKE = /eyJ[\w-]{6,}\.[\w-]{6,}(\.[\w-]+)?/g;

function describe(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value.replace(TOKEN_LIKE, '[token]').slice(0, 90);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`.replace(TOKEN_LIKE, '[token]').slice(0, 120);
  if (Array.isArray(value)) return `[${value.length}]`;
  return '{…}';
}

/** The sign-in library's debug hook. The first argument is its log prefix. */
export function recordAuthStep(...args: unknown[]): void {
  const text = args.slice(1).map(describe).join(' ').slice(0, 200);
  steps.push({ t: Date.now() - pageStart, m: text });
  if (steps.length > MAX_STEPS) steps.splice(0, steps.length - MAX_STEPS);
}

/** Milliseconds since this page's code started. */
export function sincePageStart(): number {
  return Date.now() - pageStart;
}

/**
 * Send what the page was doing to the server log, once per `context` per page.
 * Never throws and never waits on the sign-in library.
 */
export async function reportStuck(context: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (typeof window === 'undefined' || reported.has(context)) return;
  reported.add(context);
  try {
    let locks: unknown = null;
    try {
      const q = await navigator.locks?.query?.();
      if (q) locks = { held: (q.held || []).map((l) => l.name), pending: (q.pending || []).map((l) => l.name) };
    } catch {
      locks = 'unavailable';
    }
    const body = {
      context,
      path: window.location.pathname,
      ua: navigator.userAgent,
      visibility: document.visibilityState,
      online: navigator.onLine,
      msSincePageStart: sincePageStart(),
      locks,
      extra,
      steps: steps.slice(-70),
    };
    await fetch('/api/client-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body).slice(0, 15_000),
      keepalive: true,
    });
  } catch {
    // A report that cannot be sent is simply lost.
  }
}

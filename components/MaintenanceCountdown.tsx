'use client';

import { useEffect, useState } from 'react';

type SiteStatus = { enabled: boolean; until: string; message: string };

const POLL_MS = 30 * 1000;

function pad(value: number) {
  return String(value).padStart(2, '0');
}

/**
 * Shows when the store is due back, from /api/site-status (set by the team in
 * Admin → Settings). No time is invented: without an end time there is no
 * countdown. Polls the status and returns to the shop once maintenance is off.
 */
export default function MaintenanceCountdown() {
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/site-status', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as SiteStatus;
        if (cancelled) return;
        setStatus(data);
        if (data.enabled === false) window.location.assign('/');
      } catch {
        // Offline or server busy: try again on the next poll.
      }
    };
    check();
    const poll = window.setInterval(check, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, []);

  if (!status || status.enabled === false) {
    return status?.enabled === false ? (
      <p className="mt-10 text-2xl text-[#f4efe6]" role="status">The store is open again. Taking you there…</p>
    ) : null;
  }

  const untilMs = status.until ? new Date(status.until).getTime() : NaN;
  const hasEnd = Number.isFinite(untilMs) && untilMs > now;

  return (
    <div className="mt-10">
      {status.message && (
        <p className="mb-6 max-w-lg font-sans text-lg leading-relaxed text-[#c9d3e2]">{status.message}</p>
      )}
      {hasEnd ? (
        <>
          <p className="font-sans text-[11px] uppercase tracking-[0.28em] text-[#9fb0c9]">
            Back at{' '}
            {new Date(untilMs).toLocaleString('en-GH', {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'Africa/Accra',
            })}{' '}
            Accra time
          </p>
          <Countdown remainingMs={untilMs - now} />
        </>
      ) : (
        <p className="font-sans text-[11px] uppercase tracking-[0.28em] text-[#9fb0c9]" role="status">
          {Number.isFinite(untilMs)
            ? 'Almost there. This page will reopen the store as soon as we are done.'
            : 'This page will take you back to the store as soon as we are done.'}
        </p>
      )}
    </div>
  );
}

function Countdown({ remainingMs }: { remainingMs: number }) {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const units = [
    { label: 'Hours', value: Math.floor(total / 3600) },
    { label: 'Minutes', value: Math.floor((total % 3600) / 60) },
    { label: 'Seconds', value: total % 60 },
  ];
  return (
    <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4" aria-hidden="true">
      {units.map((unit) => (
        <div key={unit.label} className="rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-5 sm:px-4">
          <div className="text-5xl tabular-nums tracking-tight text-[#f7f3ea] sm:text-6xl">{pad(unit.value)}</div>
          <div className="mt-2 font-sans text-[11px] uppercase tracking-[0.22em] text-[#8ea0b8]">{unit.label}</div>
        </div>
      ))}
    </div>
  );
}

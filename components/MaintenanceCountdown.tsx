'use client';

import { useEffect, useState } from 'react';

type Parts = { hours: number; minutes: number; seconds: number; done: boolean };

function split(endsAtMs: number, now: number): Parts {
  const remain = Math.max(0, endsAtMs - now);
  const total = Math.floor(remain / 1000);
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    done: remain === 0,
  };
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export default function MaintenanceCountdown({ endsAt }: { endsAt: string }) {
  const endsAtMs = new Date(endsAt).getTime();
  const valid = !Number.isNaN(endsAtMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!valid || endsAtMs > Date.now()) return;
    const key = 'ddz-maintenance-reopen';
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    const id = window.setTimeout(() => {
      window.location.assign('/');
    }, 1500);
    return () => window.clearTimeout(id);
  }, [endsAtMs, valid, now]);

  if (!valid) return null;

  const parts = split(endsAtMs, now);
  const reopenLabel = new Date(endsAtMs).toLocaleTimeString('en-GH', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Accra',
  });

  const units = [
    { label: 'Hours', value: parts.hours },
    { label: 'Minutes', value: parts.minutes },
    { label: 'Seconds', value: parts.seconds },
  ];

  return (
    <div className="mt-10">
      <p className="text-[11px] uppercase tracking-[0.28em] text-[#9fb0c9]">
        {parts.done ? 'Opening the store' : `Back around ${reopenLabel} Accra time`}
      </p>
      {parts.done ? (
        <p className="mt-4 text-2xl text-[#f4efe6]">The updates are finished. Taking you back in.</p>
      ) : (
        <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4" aria-label="Time remaining">
          {units.map((unit) => (
            <div key={unit.label} className="rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-5 sm:px-4">
              <div className="text-5xl tabular-nums tracking-tight text-[#f7f3ea] sm:text-6xl">
                {pad(unit.value)}
              </div>
              <div className="mt-2 font-sans text-[11px] uppercase tracking-[0.22em] text-[#8ea0b8]">{unit.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

const WAIT_MS = 5 * 60 * 60 * 1000;
const STORAGE_KEY = 'ddz-maintenance-ends-at';
const COOKIE = 'ddz_wait_until';

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

function rememberEnd(endsAtMs: number) {
  localStorage.setItem(STORAGE_KEY, String(endsAtMs));
  document.cookie = `${COOKIE}=${endsAtMs}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
}

function personalEnd(): number {
  const saved = Number(localStorage.getItem(STORAGE_KEY));
  if (Number.isFinite(saved) && saved > 0) {
    rememberEnd(saved);
    return saved;
  }
  const endsAtMs = Date.now() + WAIT_MS;
  rememberEnd(endsAtMs);
  return endsAtMs;
}

export default function MaintenanceCountdown() {
  const [endsAtMs, setEndsAtMs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setEndsAtMs(personalEnd());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (endsAtMs == null || endsAtMs > Date.now()) return;
    const key = 'ddz-maintenance-reopen';
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    const id = window.setTimeout(() => {
      window.location.assign('/');
    }, 1200);
    return () => window.clearTimeout(id);
  }, [endsAtMs, now]);

  if (endsAtMs == null) {
    return (
      <div className="mt-10">
        <p className="text-[11px] uppercase tracking-[0.28em] text-[#9fb0c9]">Your 5 hours start now</p>
        <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4">
          {['05', '00', '00'].map((value) => (
            <div key={value} className="rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-5 sm:px-4">
              <div className="text-5xl tabular-nums tracking-tight text-[#f7f3ea] sm:text-6xl">{value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

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
      <p className="font-sans text-[11px] uppercase tracking-[0.28em] text-[#9fb0c9]">
        {parts.done ? 'Your wait is over' : `Your store opens around ${reopenLabel} Accra time`}
      </p>
      {parts.done ? (
        <p className="mt-4 text-2xl text-[#f4efe6]">Taking you into the store.</p>
      ) : (
        <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4" aria-label="Your time remaining">
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

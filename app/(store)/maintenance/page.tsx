import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import MaintenanceCountdown from '@/components/MaintenanceCountdown';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  PUBLIC_CONTACT_EMAIL,
  PUBLIC_CONTACT_PHONE,
  PUBLIC_CONTACT_PHONE_DISPLAY,
  PUBLIC_CONTACT_PHONE_WHATSAPP,
} from '@/lib/brand-contact';

const display = Fraunces({
  subsets: ['latin'],
  weight: ['500', '600'],
});

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: "We'll be right back",
  robots: { index: false, follow: false },
};

const DEFAULT_MESSAGE =
  "We're making a few updates to the website. They're almost done, and the store will open again when this countdown ends.";

function parseSettingValue(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export default async function MaintenancePage() {
  const envMessage = process.env.MAINTENANCE_MESSAGE?.trim();
  const envUntil = process.env.MAINTENANCE_UNTIL?.trim();
  let message = envMessage || DEFAULT_MESSAGE;
  let endsAt = envUntil && !Number.isNaN(new Date(envUntil).getTime())
    ? envUntil
    : new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();

  if (envUntil) {
    return renderPage(message, endsAt);
  }

  try {
    const { data } = await supabaseAdmin
      .from('site_settings')
      .select('key, value')
      .in('key', ['maintenance_message', 'maintenance_until']);

    const map: Record<string, unknown> = {};
    (data || []).forEach((row: { key: string; value: string }) => {
      map[row.key] = parseSettingValue(row.value);
    });

    if (typeof map.maintenance_message === 'string' && map.maintenance_message.trim()) {
      message = map.maintenance_message;
    }
    if (typeof map.maintenance_until === 'string' && !Number.isNaN(new Date(map.maintenance_until).getTime())) {
      endsAt = map.maintenance_until;
    }
  } catch {
    // Keep the five-hour fallback if settings cannot be read.
  }

  return renderPage(message, endsAt);
}

function renderPage(message: string, endsAt: string) {
  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#07111f] text-[#f7f3ea]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 480px at 12% -10%, rgba(37,99,235,0.45), transparent 60%), radial-gradient(700px 420px at 100% 110%, rgba(180,140,74,0.18), transparent 55%)',
        }}
      />
      <div className="relative mx-auto flex min-h-[100dvh] max-w-3xl flex-col justify-between px-6 py-10 sm:px-10">
        <img src="/ddz-logo-white.png" alt="Discount Discovery Zone" className="h-12 w-auto self-start object-contain sm:h-14" />

        <div className="py-12">
          <p className="text-[11px] uppercase tracking-[0.32em] text-[#c4a574]">Almost done</p>
          <h1 className={`${display.className} mt-4 max-w-xl text-5xl leading-[0.95] text-[#f7f3ea] sm:text-7xl`}>
            We&apos;re updating the store.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#c9d3e2]">{message}</p>
          <div className={display.className}>
            <MaintenanceCountdown endsAt={endsAt} />
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-white/10 pt-6 text-sm text-[#9fb0c9] sm:flex-row sm:items-center sm:justify-between">
          <p>The shop is closed for a short while. We can still help you directly.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <a className="text-[#f7f3ea] underline decoration-white/30 underline-offset-4" href={`tel:${PUBLIC_CONTACT_PHONE}`}>
              {PUBLIC_CONTACT_PHONE_DISPLAY}
            </a>
            <a
              className="text-[#f7f3ea] underline decoration-white/30 underline-offset-4"
              href={`https://wa.me/${PUBLIC_CONTACT_PHONE_WHATSAPP}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp
            </a>
            <a className="text-[#f7f3ea] underline decoration-white/30 underline-offset-4" href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>
              {PUBLIC_CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}

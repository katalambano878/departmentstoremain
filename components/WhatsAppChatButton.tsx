'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useCMS } from '@/context/CMSContext';
import { PUBLIC_CONTACT_PHONE_WHATSAPP } from '@/lib/brand-contact';

/** Digits only, Ghana local numbers (0XX...) turned into 233XX... for wa.me. */
export function toWhatsAppDigits(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  return digits;
}

/**
 * Floating "Chat with us" button that opens the store's WhatsApp.
 * Number: Settings > WhatsApp chat number, else the contact phone, else the
 * store default. Settings can also hide it.
 */
export default function WhatsAppChatButton() {
  const pathname = usePathname();
  const { getSetting } = useCMS();
  // Read after mount so the server and first client render match.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  if (getSetting('whatsapp_button_enabled') === 'false') return null;

  const number =
    toWhatsAppDigits(getSetting('whatsapp_number')) ||
    toWhatsAppDigits(getSetting('contact_phone')) ||
    PUBLIC_CONTACT_PHONE_WHATSAPP;

  const onProductPage = pathname?.startsWith('/product/');
  const text = onProductPage && origin
    ? `Hi Discount Discovery Zone, I'm interested in this product: ${origin}${pathname}`
    : 'Hi Discount Discovery Zone, I need some help.';
  const href = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      className="group fixed right-4 z-40 flex items-center gap-2 rounded-full bg-[#25D366] text-white shadow-[0_6px_20px_-4px_rgba(15,23,42,0.35)] transition-transform duration-200 ease-out hover:scale-[1.04] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#128C7E] motion-reduce:transition-none motion-reduce:hover:scale-100 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:right-6 size-14 justify-center lg:size-auto lg:h-12 lg:px-5"
    >
      <i className="ri-whatsapp-line text-[28px] leading-none lg:text-2xl" aria-hidden="true"></i>
      <span className="hidden text-sm font-semibold lg:inline">Chat with us</span>
    </a>
  );
}

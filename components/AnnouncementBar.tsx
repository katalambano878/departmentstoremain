'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

interface Banner {
    id: string;
    title: string;
    subtitle?: string;
    background_color: string;
    text_color: string;
    button_text?: string;
    button_url?: string;
}

export default function AnnouncementBar() {
    const [banners, setBanners] = useState<Banner[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());

    useEffect(() => {
        fetchBanners();
    }, []);

    useEffect(() => {
        // Auto-rotate banners if multiple
        if (banners.length > 1) {
            const interval = setInterval(() => {
                setCurrentIndex((prev) => (prev + 1) % banners.length);
            }, 5000);
            return () => clearInterval(interval);
        }
    }, [banners.length]);

    const fetchBanners = async () => {
        try {
            const now = new Date().toISOString();

            const { data, error } = await supabase
                .from('banners')
                .select('*')
                .eq('is_active', true)
                .eq('position', 'top')
                .or(`start_date.is.null,start_date.lte.${now}`)
                .or(`end_date.is.null,end_date.gte.${now}`)
                .order('sort_order', { ascending: true });

            if (error) {
                console.log('Banners table may not exist yet');
                return;
            }

            setBanners(data || []);
        } catch (error) {
            console.error('Error fetching banners:', error);
        }
    };

    const dismissBanner = (id: string) => {
        const newDismissed = new Set(dismissed);
        newDismissed.add(id);
        setDismissed(newDismissed);

        // Move to next banner if available
        const remainingBanners = banners.filter(b => !newDismissed.has(b.id));
        if (remainingBanners.length > 0) {
            setCurrentIndex(0);
        }
    };

    const visibleBanners = banners.filter(b => !dismissed.has(b.id));

    if (visibleBanners.length === 0) {
        // Show default banner if no custom banners
        return (
            <div className="relative z-[60] shrink-0 border-b border-[#d1fae5]/60 bg-[#ecfdf5]">
                <div className="relative flex items-center justify-center px-10 py-2.5">
                    <p className="max-w-[min(100%,52rem)] text-center text-xs font-light tracking-wide text-slate-700 sm:text-sm">
                        Doorstep delivery across Ghana · Free pickup at our Accra store · Pay with mobile money or card
                    </p>
                </div>
            </div>
        );
    }

    const currentBanner = visibleBanners[currentIndex % visibleBanners.length];

    return (
        <div
            className="py-2 px-4 text-center text-sm relative"
            style={{
                backgroundColor: currentBanner.background_color,
                color: currentBanner.text_color,
            }}
        >
            <div className="max-w-7xl mx-auto flex items-center justify-center gap-4">
                <p className="font-medium">
                    {currentBanner.title}
                    {currentBanner.subtitle && (
                        <span className="opacity-90 ml-2">{currentBanner.subtitle}</span>
                    )}
                </p>

                {currentBanner.button_text && currentBanner.button_url && (
                    <Link
                        href={currentBanner.button_url}
                        className="px-3 py-1 rounded-full text-xs font-semibold transition-opacity hover:opacity-80"
                        style={{
                            backgroundColor: currentBanner.text_color,
                            color: currentBanner.background_color,
                        }}
                    >
                        {currentBanner.button_text}
                    </Link>
                )}
            </div>

            {/* Dismiss button */}
            <button
                onClick={() => dismissBanner(currentBanner.id)}
                className="absolute right-4 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100 transition-opacity"
                style={{ color: currentBanner.text_color }}
                aria-label="Dismiss banner"
            >
                <i className="ri-close-line"></i>
            </button>

            {/* Dots indicator for multiple banners */}
            {visibleBanners.length > 1 && (
                <div className="absolute left-4 top-1/2 -translate-y-1/2 flex gap-1">
                    {visibleBanners.map((_, idx) => (
                        <button
                            key={idx}
                            onClick={() => setCurrentIndex(idx)}
                            className={`w-1.5 h-1.5 rounded-full transition-opacity ${idx === currentIndex % visibleBanners.length ? 'opacity-100' : 'opacity-40'
                                }`}
                            style={{ backgroundColor: currentBanner.text_color }}
                            aria-label={`Go to banner ${idx + 1}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

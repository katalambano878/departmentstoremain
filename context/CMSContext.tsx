'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import {
  PUBLIC_CONTACT_EMAIL,
  PUBLIC_CONTACT_PHONE,
  effectiveContactEmail,
  effectiveContactPhone,
} from '@/lib/brand-contact';

interface SiteSettings {
    site_name: string;
    site_tagline: string;
    site_logo: string;
    site_logo_white: string;
    contact_email: string;
    contact_phone: string;
    contact_address: string;
    social_facebook: string;
    social_instagram: string;
    social_twitter: string;
    social_tiktok: string;
    social_snapchat: string;
    social_youtube: string;
    primary_color: string;
    secondary_color: string;
    currency: string;
    currency_symbol: string;
    [key: string]: string;
}

interface CMSContent {
    id: string;
    section: string;
    block_key: string;
    title: string | null;
    subtitle: string | null;
    content: string | null;
    image_url: string | null;
    button_text: string | null;
    button_url: string | null;
    metadata: Record<string, any>;
    is_active: boolean;
}

interface Banner {
    id: string;
    name: string;
    type: string;
    title: string | null;
    subtitle: string | null;
    image_url: string | null;
    background_color: string;
    text_color: string;
    button_text: string | null;
    button_url: string | null;
    is_active: boolean;
    position: string;
    start_date: string | null;
    end_date: string | null;
}

interface CMSContextType {
    settings: SiteSettings;
    content: CMSContent[];
    banners: Banner[];
    loading: boolean;
    getContent: (section: string, blockKey: string) => CMSContent | undefined;
    getSetting: (key: string) => string;
    getActiveBanners: (position?: string) => Banner[];
    refreshCMS: () => Promise<void>;
    updateSetting: (key: string, value: string) => Promise<void>;
}

const defaultSettings: SiteSettings = {
    site_name: 'Discount Discovery Zone',
    site_tagline: 'Dresses, Electronics, Bags, Shoes & More',
    site_logo: '/ddz-logo.png',
    site_logo_white: '/ddz-logo-white.png',
    contact_email: PUBLIC_CONTACT_EMAIL,
    contact_phone: PUBLIC_CONTACT_PHONE,
    contact_address: 'Accra, Ghana',
    social_facebook: '',
    social_instagram: '',
    social_twitter: '',
    social_tiktok: '',
    social_snapchat: '',
    social_youtube: '',
    primary_color: '#059669',
    secondary_color: '#0D9488',
    currency: 'GHS',
    currency_symbol: 'GH₵',
};

const CMSContext = createContext<CMSContextType>({
    settings: defaultSettings,
    content: [],
    banners: [],
    loading: true,
    getContent: () => undefined,
    getSetting: () => '',
    getActiveBanners: () => [],
    refreshCMS: async () => { },
    updateSetting: async () => { },
});

export function CMSProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<SiteSettings>({
        site_name: 'Discount Discovery Zone',
        site_tagline: 'Dresses, Electronics, Bags, Shoes & More',
        site_logo: '/ddz-logo.png',
        site_logo_white: '/ddz-logo-white.png',
        contact_email: PUBLIC_CONTACT_EMAIL,
        contact_phone: PUBLIC_CONTACT_PHONE,
        contact_address: 'Accra, Ghana',
        social_facebook: '',
        social_instagram: '',
        social_twitter: '',
        social_tiktok: '',
        social_snapchat: '',
        social_youtube: '',
        primary_color: '#059669',
        secondary_color: '#FBF6F2',
        currency: 'GHS',
        currency_symbol: 'GH₵',
    });
    const [content, setContent] = useState<CMSContent[]>([]);
    const [banners, setBanners] = useState<Banner[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchCMSData = async () => {
        try {
            const { data } = await supabase.from('site_settings').select('key, value');
            if (data && data.length > 0) {
                const dbSettings: Partial<SiteSettings> = {};
                data.forEach((row: any) => {
                    try {
                        dbSettings[row.key as keyof SiteSettings] = JSON.parse(row.value);
                    } catch {
                        dbSettings[row.key as keyof SiteSettings] = row.value;
                    }
                });
                setSettings(prev => ({ ...prev, ...(dbSettings as SiteSettings) }));
            }
        } catch (err) {
            console.warn('Could not load site settings from DB:', err);
        }
    };

    const updateSetting = async (key: string, value: string) => {
        const jsonValue = JSON.stringify(value);
        const { error } = await supabase.from('site_settings')
            .upsert({ key, value: jsonValue }, { onConflict: 'key' });
        if (error) {
            // Only admins can write site_settings; surface the real reason instead of
            // letting the caller report a save that never happened.
            throw new Error(error.message || 'Could not save the setting');
        }
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    useEffect(() => {
        fetchCMSData();
    }, []);

    const getContent = (section: string, blockKey: string): CMSContent | undefined => {
        return content.find(c => c.section === section && c.block_key === blockKey);
    };

    const getSetting = (key: string): string => {
        const fallback = defaultSettings[key as keyof SiteSettings];
        const raw = settings[key];
        const val =
            raw !== undefined && raw !== null && String(raw).trim() !== ''
                ? String(raw)
                : fallback !== undefined && fallback !== null
                  ? String(fallback)
                  : '';
        if (key === 'contact_email') return effectiveContactEmail(val);
        if (key === 'contact_phone') return effectiveContactPhone(val);
        return val;
    };

    const getActiveBanners = (position?: string): Banner[] => {
        const now = new Date();
        return banners.filter(b => {
            if (position && b.position !== position) return false;
            if (b.start_date && new Date(b.start_date) > now) return false;
            if (b.end_date && new Date(b.end_date) < now) return false;
            return b.is_active;
        });
    };

    return (
        <CMSContext.Provider
            value={{
                settings,
                content,
                banners,
                loading,
                getContent,
                getSetting,
                getActiveBanners,
                refreshCMS: fetchCMSData,
                updateSetting,
            }}
        >
            {children}
        </CMSContext.Provider>
    );
}

export function useCMS() {
    const context = useContext(CMSContext);
    if (!context) {
        throw new Error('useCMS must be used within a CMSProvider');
    }
    return context;
}

export default CMSContext;

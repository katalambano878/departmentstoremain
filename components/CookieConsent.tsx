'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Script from 'next/script';

const CONSENT_KEY = 'cookieConsent';
const CONSENT_EVENT = 'ddz-cookie-consent';

type Consent = { necessary: true; analytics: boolean; timestamp: string };

function readConsent(): Consent | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Consent) : null;
  } catch {
    return null;
  }
}

function writeConsent(analytics: boolean) {
  const value: Consent = { necessary: true, analytics, timestamp: new Date().toISOString() };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
}

/**
 * Loads Google Analytics only after the visitor accepted analytics cookies,
 * and starts it without a reload when they accept.
 */
export function ConsentedAnalytics({ measurementId }: { measurementId: string }) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(readConsent()?.analytics === true);
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Consent>).detail;
      setAllowed(detail?.analytics === true);
    };
    window.addEventListener(CONSENT_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_EVENT, onChange);
  }, []);

  // Withdrawing consent: stop sending hits for the rest of this visit.
  useEffect(() => {
    if (!allowed) (window as any)[`ga-disable-${measurementId}`] = true;
    else (window as any)[`ga-disable-${measurementId}`] = false;
  }, [allowed, measurementId]);

  if (!allowed || !/^[A-Z0-9-]+$/i.test(measurementId)) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${measurementId}', { page_path: window.location.pathname });
        `}
      </Script>
    </>
  );
}

export default function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    const existing = readConsent();
    if (!existing) {
      const t = setTimeout(() => setShowBanner(true), 1000);
      return () => clearTimeout(t);
    }
    setAnalytics(existing.analytics === true);
  }, []);

  const acceptAll = () => {
    writeConsent(true);
    setShowBanner(false);
    setShowPreferences(false);
  };

  const rejectAll = () => {
    writeConsent(false);
    setShowBanner(false);
    setShowPreferences(false);
  };

  const savePreferences = () => {
    writeConsent(analytics);
    setShowBanner(false);
    setShowPreferences(false);
  };

  if (!showBanner) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998]" aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-consent-title"
        className="fixed bottom-0 left-0 right-0 max-h-[90vh] overflow-y-auto bg-white border-t-4 border-emerald-700 shadow-2xl z-[9999] animate-slide-up"
      >
        <div className="max-w-7xl mx-auto px-4 py-6">
          {!showPreferences ? (
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-start space-x-4 flex-1">
                <div className="w-12 h-12 flex items-center justify-center bg-emerald-100 rounded-lg flex-shrink-0">
                  <i className="ri-cookie-line text-2xl text-emerald-700"></i>
                </div>
                <div>
                  <h3 id="cookie-consent-title" className="text-lg font-bold text-gray-900 mb-2">Cookies on this site</h3>
                  <p className="text-sm text-gray-600 leading-relaxed mb-3">
                    We use necessary cookies to keep you signed in and remember your bag. With your permission we also
                    use analytics cookies (Google Analytics) to see how the site is used. 
                    <Link href="/privacy" className="text-emerald-700 hover:text-emerald-900 font-medium ml-1 whitespace-nowrap">
                      Read our Privacy Policy
                    </Link>
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                <button
                  type="button"
                  onClick={() => setShowPreferences(true)}
                  className="px-6 py-3 border-2 border-gray-300 hover:border-gray-400 text-gray-700 rounded-lg font-semibold transition-colors whitespace-nowrap"
                >
                  Customize
                </button>
                <button
                  type="button"
                  onClick={rejectAll}
                  className="px-6 py-3 border-2 border-gray-300 hover:border-gray-400 text-gray-700 rounded-lg font-semibold transition-colors whitespace-nowrap"
                >
                  Reject All
                </button>
                <button
                  type="button"
                  onClick={acceptAll}
                  className="px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer"
                >
                  Accept All
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3 id="cookie-consent-title" className="text-xl font-bold text-gray-900">Cookie Preferences</h3>
                <button
                  type="button"
                  aria-label="Back"
                  onClick={() => setShowPreferences(false)}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <i className="ri-close-line text-2xl"></i>
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <div className="flex items-start justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1 pr-4">
                    <div className="flex items-center space-x-2 mb-2">
                      <h4 className="font-semibold text-gray-900">Necessary Cookies</h4>
                      <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-full whitespace-nowrap">Always Active</span>
                    </div>
                    <p className="text-sm text-gray-600">
                      Keep you signed in, remember your bag and your cookie choice. The site does not work without them.
                    </p>
                  </div>
                  <div className="w-12 h-6 bg-gray-300 rounded-full flex items-center px-1 cursor-not-allowed">
                    <div className="w-4 h-4 bg-white rounded-full shadow-sm ml-auto"></div>
                  </div>
                </div>

                <div className="flex items-start justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1 pr-4">
                    <h4 className="font-semibold text-gray-900 mb-2">Analytics Cookies</h4>
                    <p className="text-sm text-gray-600">
                      Google Analytics, to see which pages are visited and how the site performs. Off unless you turn it on.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={analytics}
                    aria-label="Analytics cookies"
                    onClick={() => setAnalytics(!analytics)}
                    className={`w-12 h-6 flex-shrink-0 rounded-full flex items-center px-1 transition-colors cursor-pointer ${
                      analytics ? 'bg-emerald-700' : 'bg-gray-300'
                    }`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                      analytics ? 'translate-x-6' : 'translate-x-0'
                    }`}></div>
                  </button>
                </div>

              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={rejectAll}
                  className="flex-1 px-6 py-3 border-2 border-gray-300 hover:border-gray-400 text-gray-700 rounded-lg font-semibold transition-colors whitespace-nowrap"
                >
                  Reject All
                </button>
                <button
                  type="button"
                  onClick={savePreferences}
                  className="flex-1 px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer"
                >
                  Save Preferences
                </button>
                <button
                  type="button"
                  onClick={acceptAll}
                  className="flex-1 px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap bg-gray-900 hover:bg-emerald-700 text-white cursor-pointer"
                >
                  Accept All
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

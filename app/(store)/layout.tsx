'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import MobileBottomNav from '@/components/MobileBottomNav';
import ScrollToTop from '@/components/ScrollToTop';
import ErrorBoundary from '@/components/ErrorBoundary';
import NavigationProgress from '@/components/NavigationProgress';
import CookieConsent from '@/components/CookieConsent';
import { AffiliateProvider } from '@/context/AffiliateContext';
// Lazy-load non-critical components
import dynamic from 'next/dynamic';
const SessionTimeoutWarning = dynamic(() => import('@/components/SessionTimeoutWarning'), { ssr: false });
const PWAPrompt = dynamic(() => import('@/components/PWAPrompt'), { ssr: false });
const PWAInstaller = dynamic(() => import('@/components/PWAInstaller'), { ssr: false });
const PWASplash = dynamic(() => import('@/components/PWASplash'), { ssr: false });
const OfflineIndicator = dynamic(() => import('@/components/OfflineIndicator'), { ssr: false });
const NetworkStatusMonitor = dynamic(() => import('@/components/NetworkStatusMonitor'), { ssr: false });
const UpdatePrompt = dynamic(() => import('@/components/UpdatePrompt'), { ssr: false });
const LiveSalesNotification = dynamic(() => import('@/components/LiveSalesNotification'), { ssr: false });
const AffiliateBanner = dynamic(() => import('@/components/AffiliateBanner'), { ssr: false });

export default function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === '/maintenance') {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <AffiliateProvider>
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <ScrollToTop />
      <div className="min-h-screen bg-gray-50">
        <PWASplash />
        <PWAInstaller />
        <AffiliateBanner />
        <Header />
        <ErrorBoundary>
          <div className="pwa-page-enter">
            {children}
          </div>
        </ErrorBoundary>
        <Footer />
        <MobileBottomNav />
        <SessionTimeoutWarning />
        <PWAPrompt />
        <OfflineIndicator />
        <NetworkStatusMonitor />
        <UpdatePrompt />
        <LiveSalesNotification />
        <CookieConsent />
      </div>
    </AffiliateProvider>
  );
}

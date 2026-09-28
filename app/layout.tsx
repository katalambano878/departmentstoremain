import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { CartProvider } from "@/context/CartContext";
import { WishlistProvider } from "@/context/WishlistContext";
import { CMSProvider } from "@/context/CMSContext";
import "./globals.css";
import { PUBLIC_CONTACT_EMAIL, PUBLIC_CONTACT_PHONE } from "@/lib/brand-contact";

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#2563eb',
};

const PRIMARY_SITE_URL = 'https://www.discountdiscoveryzone.com';
const configuredSiteUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
const siteUrl = configuredSiteUrl && !configuredSiteUrl.includes('vercel.app')
  ? configuredSiteUrl
  : PRIMARY_SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Discount Discovery Zone | Department Store Ghana",
    template: "%s | Discount Discovery Zone"
  },
  description: "Shop dresses, electronics, bags, shoes & more at Discount Discovery Zone Department Store. Quality products delivered across Ghana from Accra.",
  keywords: [
    "Discount Discovery Zone",
    "Department Store Ghana",
    "Online Store Ghana",
    "Buy Dresses Online Ghana",
    "Electronics Ghana",
    "Bags and Shoes Accra",
    "Affordable Fashion Ghana",
    "Accra Online Shopping",
    "Ghana E-commerce",
    "Quality Products Accra"
  ],
  authors: [{ name: "Discount Discovery Zone" }],
  creator: "Discount Discovery Zone",
  publisher: "Discount Discovery Zone",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.png?v=ddz-2026-04-17', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-16x16.png?v=ddz-2026-04-17', sizes: '16x16', type: 'image/png' },
      { url: '/icons/icon-32x32.png?v=ddz-2026-04-17', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-48x48.png?v=ddz-2026-04-17', sizes: '48x48', type: 'image/png' },
      { url: '/icons/icon-96x96.png?v=ddz-2026-04-17', sizes: '96x96', type: 'image/png' },
      { url: '/icons/icon-192x192.png?v=ddz-2026-04-17', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png?v=ddz-2026-04-17', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/icon-152x152.png?v=ddz-2026-04-17', sizes: '152x152', type: 'image/png' },
      { url: '/icons/icon-192x192.png?v=ddz-2026-04-17', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-384x384.png?v=ddz-2026-04-17', sizes: '384x384', type: 'image/png' },
      { url: '/icons/icon-512x512.png?v=ddz-2026-04-17', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon.png?v=ddz-2026-04-17',
  },
  manifest: '/manifest.json?v=ddz-2026-04-17',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Discount Discovery Zone',
  },
  formatDetection: {
    telephone: true,
  },
  verification: {
    // Add your Google Search Console verification code here
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || '',
  },
  openGraph: {
    type: "website",
    locale: "en_GH",
    url: siteUrl,
    title: "Discount Discovery Zone | Department Store Ghana",
    description: "Shop dresses, electronics, bags, shoes and more at Discount Discovery Zone. Quality products delivered across Ghana.",
    siteName: "Discount Discovery Zone",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Discount Discovery Zone",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Discount Discovery Zone | Department Store Ghana",
    description: "Dresses, electronics, bags, shoes and more. Quality products delivered across Ghana from Accra.",
    images: ["/og-image.png"],
    creator: "@mey_phua",
  },
  alternates: {
    canonical: siteUrl,
  },
};

// Google Analytics Measurement ID
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
// Google reCAPTCHA v3 Site Key
const RECAPTCHA_SITE_KEY =
  process.env.NEXT_PUBLIC_RECAPTCHA_DISABLED === 'true'
    ? ''
    : process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* PWA Meta Tags */}
        <meta name="theme-color" content="#2563eb" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Discount Discovery Zone" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-TileColor" content="#2563eb" />
        <meta name="msapplication-tap-highlight" content="no" />

        {/* Apple Touch Icons (versioned to bust the old multimey cache) */}
        <link rel="apple-touch-icon" href="/icons/icon-152x152.png?v=ddz-2026-04-17" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192x192.png?v=ddz-2026-04-17" />
        <link rel="apple-touch-icon" sizes="384x384" href="/icons/icon-384x384.png?v=ddz-2026-04-17" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icons/icon-512x512.png?v=ddz-2026-04-17" />

        {/* Apple Splash Screens */}
        <link rel="apple-touch-startup-image" href="/icons/icon-512x512.png?v=ddz-2026-04-17" />

        <link
          href="https://cdn.jsdelivr.net/npm/remixicon@4.1.0/fonts/remixicon.css"
          rel="stylesheet"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://wsrv.nl" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://wsrv.nl" />
        <link href="https://fonts.googleapis.com/css2?family=Pacifico&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

        {/* Structured Data - Organization */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "Discount Discovery Zone",
              "url": siteUrl,
              "logo": `${siteUrl}/icons/icon-512x512.png?v=ddz-2026-04-17`,
              "description": "Shop dresses, electronics, bags, shoes and more at Discount Discovery Zone. Quality products delivered across Ghana from Accra.",
              "address": {
                "@type": "PostalAddress",
                "addressCountry": "GH",
                "addressLocality": "Accra"
              },
              "contactPoint": {
                "@type": "ContactPoint",
                "contactType": "customer service",
                "telephone": PUBLIC_CONTACT_PHONE,
                "email": PUBLIC_CONTACT_EMAIL,
                "availableLanguage": "English"
              }
            })
          }}
        />
      </head>

      {/* Google Analytics */}
      {GA_MEASUREMENT_ID && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
            strategy="afterInteractive"
          />
          <Script id="google-analytics" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_MEASUREMENT_ID}', {
                page_path: window.location.pathname,
              });
            `}
          </Script>
        </>
      )}

      {/* Google reCAPTCHA v3 */}
      {RECAPTCHA_SITE_KEY && (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`}
          strategy="afterInteractive"
        />
      )}

      <body className="antialiased font-sans overflow-x-hidden pwa-body">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[10000] focus:px-6 focus:py-3 focus:bg-blue-600 focus:text-white focus:rounded-lg focus:font-semibold focus:shadow-lg"
        >
          Skip to main content
        </a>
        <CMSProvider>
          <CartProvider>
            <WishlistProvider>
              <div id="main-content">
                {children}
              </div>
            </WishlistProvider>
          </CartProvider>
        </CMSProvider>
      </body>
    </html>
  );
}

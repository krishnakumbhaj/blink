import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { Toaster } from '@/components/ui/toaster';
import ServiceWorkerRegistrar from '@/components/pwa/ServiceWorkerRegistrar';
import InstallPrompt from '@/components/pwa/InstallPrompt';

/**
 * Inter, not Space Grotesk.
 *
 * Space Grotesk is a display face — it is drawn to be looked at, at size. A chat
 * app is the opposite job: thousands of words at 13–14px that must be *read*
 * without being noticed. Inter was designed for exactly that (tall x-height,
 * open apertures, unambiguous 1/l/I), which is why it ends up under most modern
 * product UI. The variable font also means we get every weight for one download.
 */
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Blink',
  description: 'Real-time chat built with Next.js, Express and Socket.io',

  // Next serves this from src/app/manifest.ts.
  manifest: '/manifest.webmanifest',

  // iOS ignores the manifest almost entirely and reads these instead. Without
  // them an installed app on iPhone gets a screenshot for an icon and opens in
  // a Safari chrome with an address bar — i.e. not an app at all.
  appleWebApp: {
    capable: true,
    title: 'Blink',
    statusBarStyle: 'default',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },

  other: {
    /**
     * Next 15's `appleWebApp.capable` now emits the *standardised*
     * `mobile-web-app-capable` — and iOS Safari does not read it. It only honours
     * the legacy Apple-prefixed name.
     *
     * Ship both. Without this exact tag an installed app on iPhone launches inside
     * Safari chrome, complete with an address bar, which is precisely the thing
     * installing it was supposed to remove.
     */
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Fill the display on notched phones, so the app owns the whole screen rather
  // than sitting in a letterbox. The safe-area insets in globals.css then keep
  // content out from under the notch and the home indicator.
  viewportFit: 'cover',
  themeColor: '#FAFAF9',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        <AuthProvider>
          {children}
          <Toaster />
          <InstallPrompt />
        </AuthProvider>

        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}

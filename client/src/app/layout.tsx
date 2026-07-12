import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { Toaster } from '@/components/ui/toaster';

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
};

// Next 15 expects themeColor and viewport here rather than inside `metadata`.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
        </AuthProvider>
      </body>
    </html>
  );
}

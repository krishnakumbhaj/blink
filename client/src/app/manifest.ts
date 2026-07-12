import type { MetadataRoute } from 'next';

/**
 * The web app manifest, served at /manifest.webmanifest.
 *
 * Written as a Next metadata route rather than a static public/manifest.json so
 * it is typed — a manifest with a typo in an icon path fails installability
 * silently, and a JSON file cannot tell you that.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/chat',
    name: 'Blink — Real-time chat',
    short_name: 'Blink',
    description:
      'Find people, follow each other, and chat in real time. Messages, photos and files land instantly.',

    // Open straight into the app, not the marketing landing page. Someone who
    // installed it has already decided.
    start_url: '/chat',
    scope: '/',

    display: 'standalone',
    orientation: 'portrait',

    // The canvas colour, so the splash screen and the status bar match the app
    // instead of flashing white before the first paint.
    background_color: '#FAFAF9',
    theme_color: '#FAFAF9',

    categories: ['social', 'communication'],

    icons: [
      // `any` is shown as-is — the logo can fill most of the square.
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },

      // `maskable` is CROPPED by the launcher into a circle/squircle/teardrop.
      // Only the middle 80% survives, so these are the same logo with far more
      // padding. Shipping only `any` icons is why so many PWAs end up with their
      // edges sliced off on Android.
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],

    shortcuts: [
      {
        name: 'Messages',
        url: '/chat',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Community',
        url: '/chat/people',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}

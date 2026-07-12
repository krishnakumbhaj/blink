'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker. Renders nothing.
 *
 * Deliberately NOT registered in development. A service worker caching a dev
 * bundle is a special kind of misery: you change a file, nothing happens, and
 * you spend an hour blaming your code. It only ever runs in a production build.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    // Wait for load: registering during startup competes with the app's own
    // resources for bandwidth, on exactly the connection that can least afford it.
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        // A failed registration must never take the app down with it. The app
        // works perfectly without a service worker; it just will not install.
        console.error('[pwa] service worker registration failed:', error);
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register);

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}

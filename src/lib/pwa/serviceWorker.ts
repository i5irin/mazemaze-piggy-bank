const APP_CACHE_PREFIX = "mazemaze-piggy-bank-static-";
const DEV_RELOAD_KEY = "mazemaze-dev-service-worker-cleanup-v1";

const isAppWorker = (registration: ServiceWorkerRegistration): boolean =>
  [registration.active, registration.waiting, registration.installing].some((worker) => {
    if (!worker) return false;
    try {
      const url = new URL(worker.scriptURL);
      return url.origin === window.location.origin && url.pathname === "/sw.js";
    } catch {
      return false;
    }
  });

export async function configureAppServiceWorker(production: boolean): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  if (production) {
    await navigator.serviceWorker.register("/sw.js");
    return;
  }

  const controlledByApp = (() => {
    const scriptUrl = navigator.serviceWorker.controller?.scriptURL;
    if (!scriptUrl) return false;
    try {
      const url = new URL(scriptUrl);
      return url.origin === window.location.origin && url.pathname === "/sw.js";
    } catch {
      return false;
    }
  })();
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.filter(isAppWorker).map((registration) => registration.unregister()),
  );
  if ("caches" in window) {
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(APP_CACHE_PREFIX))
        .map((cacheName) => window.caches.delete(cacheName)),
    );
  }

  if (controlledByApp) {
    try {
      if (window.sessionStorage.getItem(DEV_RELOAD_KEY) !== "done") {
        window.sessionStorage.setItem(DEV_RELOAD_KEY, "done");
        window.location.reload();
      }
    } catch {
      // Cleanup still applies on the next manual reload when session storage is unavailable.
    }
    return;
  }
  try {
    window.sessionStorage.removeItem(DEV_RELOAD_KEY);
  } catch {
    // Session storage is optional for cleanup bookkeeping.
  }
}

/* KST business Web retirement v1. No account data or unrelated caches touched. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Vite/Workbox default cache key includes this exact registration scope.
    const ownedCaches = new Set([`workbox-precache-v2-${self.registration.scope}`]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => ownedCaches.has(key)).map(key => caches.delete(key)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map(client => client.navigate('https://kesaitong.top/#').catch(() => {})));
  })());
});

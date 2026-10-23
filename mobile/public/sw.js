// Folume's service worker exists so browsers treat the web app as installable (and so it can receive shared links).
// It caches nothing: the app always comes fresh from the server, and papers live in the browser's own storage.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // no handling: requests go to the network as if this worker were not here
});

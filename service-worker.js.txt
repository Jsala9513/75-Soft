// service-worker.js - shows notification on push (payload-less)
// picks a random quote locally, shows notification and handles click

const QUOTES = [
  "CT Fletcher: It’s still your m—f— set.",
  "CT Fletcher: Command your body to grow. The mind is the master.",
  "CT Fletcher: Don’t quit. Suffer now. Respect later.",
  "Ronnie Coleman: Everybody wanna be a bodybuilder...",
  "Dorian Yates: Consistency over everything.",
  "Jay Cutler: Work is the only shortcut.",
  "No excuses. Execute.",
  "Get uncomfortable. That’s where growth happens.",
  "Discipline beats motivation.",
  "You don’t need permission—just reps."
];

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  self.clients.claim();
});

self.addEventListener('push', event => {
  // payload-less: choose a random quote locally
  const body = QUOTES[Math.floor(Math.random()*QUOTES.length)];
  const options = {
    body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    vibrate: [60,40,60],
    data: { url: '/' }
  };
  event.waitUntil(self.registration.showNotification('Hardcore Reminder', options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) {
      all[0].focus();
    } else {
      clients.openWindow('/');
    }
  })());
});

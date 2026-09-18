self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Life Log', body: 'Time for a check-in.', url: self.registration.scope };
  }
  const title = data.title || 'Life Log';
  const options = {
    body: data.body || 'Time for a check-in.',
    icon: 'https://em-content.zobj.net/source/apple/391/notebook_1f4d3.png',
    badge: 'https://em-content.zobj.net/source/apple/391/notebook_1f4d3.png',
    data: { url: data.url || self.registration.scope },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

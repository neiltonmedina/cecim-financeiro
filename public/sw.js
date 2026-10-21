// Service worker do painel instalado como app: só cuida das notificações.
// Não guarda cache - o painel sempre abre a versão mais nova do servidor.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let dados = {};
  try { dados = event.data ? event.data.json() : {}; } catch (e) { dados = { corpo: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(dados.titulo || 'CECIM Cobrança', {
    body: dados.corpo || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { aba: dados.aba || '' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = '/painel/' + (event.notification.data.aba ? '#' + event.notification.data.aba : '');
  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const j of janelas) {
      if (j.url.includes('/painel')) { await j.focus(); j.postMessage({ aba: event.notification.data.aba }); return; }
    }
    await self.clients.openWindow(url);
  })());
});

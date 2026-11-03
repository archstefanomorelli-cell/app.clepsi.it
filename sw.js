// Il "postino" di Clepsi sul telefono (service worker).
//
// 1. Tiene una copia di Clepsi sul telefono, così si apre in fretta anche con
//    poca rete: i file con il nome "impronta" (programma, caratteri, icone,
//    suoni) non cambiano mai e si leggono dalla copia; la pagina si apre dalla
//    copia e intanto si scarica quella nuova, per la volta successiva.
//    I dati (database, funzioni del server) passano sempre dalla rete.
// 2. Riceve le notifiche mandate dal server anche ad app chiusa e, quando si
//    toccano, apre la schermata giusta. I testi arrivano già pronti dal server.

const VERSIONE = 'clepsi-v1';
const FILE = `${VERSIONE}-file`;
const PAGINE = `${VERSIONE}-pagine`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomi) => Promise.all(nomi.filter((n) => !n.startsWith(VERSIONE)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// File che non cambiano mai: il loro nome contiene un'impronta del contenuto.
function fileFisso(url) {
  return url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icone/');
}

self.addEventListener('fetch', (evento) => {
  const richiesta = evento.request;
  if (richiesta.method !== 'GET') return;
  const url = new URL(richiesta.url);
  if (url.origin !== self.location.origin) return; // database e server: sempre dalla rete

  if (fileFisso(url)) {
    // Dalla copia; se non c'è, dalla rete (e se ne tiene copia).
    evento.respondWith(
      caches.open(FILE).then((cache) =>
        cache.match(richiesta).then(
          (copia) =>
            copia ||
            fetch(richiesta).then((risposta) => {
              if (risposta.ok) cache.put(richiesta, risposta.clone());
              return risposta;
            }),
        ),
      ),
    );
    return;
  }

  if (richiesta.mode === 'navigate') {
    // Tutte le schermate sono la stessa pagina: si apre dalla copia e intanto
    // si aggiorna. La prima volta (o senza copia) si aspetta la rete.
    const dallaRete = fetch(richiesta);
    // La copia si rinnova sempre dalla pagina principale, qualunque schermata
    // si apra: su app.clepsi.it le altre (per esempio quella aperta da una
    // notifica) arrivano come "pagina non trovata" e non si potrebbero salvare.
    const nuovaCopia = fetch(new Request('/', { cache: 'no-cache' }))
      .then(async (risposta) => {
        if (risposta.ok) await (await caches.open(PAGINE)).put('/', risposta);
      })
      .catch(() => undefined);
    evento.waitUntil(nuovaCopia);
    evento.respondWith(
      caches
        .open(PAGINE)
        .then((cache) => cache.match('/'))
        .then((copia) => copia || dallaRete)
        .catch(() => dallaRete),
    );
  }
});

self.addEventListener('push', (evento) => {
  let dati = {};
  try {
    dati = evento.data ? evento.data.json() : {};
  } catch {
    dati = { body: evento.data ? evento.data.text() : '' };
  }
  // Su iPhone ogni notifica ricevuta va mostrata: niente notifiche silenziose.
  evento.waitUntil(
    self.registration.showNotification(dati.title || 'Clepsi', {
      body: dati.body || '',
      icon: '/icone/icona-192.png',
      badge: '/icone/icona-192.png',
      tag: dati.tag,
      data: { url: dati.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const indirizzo = new URL((evento.notification.data && evento.notification.data.url) || '/', self.location.origin).href;
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((finestre) => {
      for (const finestra of finestre) {
        if ('focus' in finestra) {
          if ('navigate' in finestra) finestra.navigate(indirizzo);
          return finestra.focus();
        }
      }
      return self.clients.openWindow(indirizzo);
    }),
  );
});

/* FLUX: guarda uma cópia do app no aparelho para abrir sem internet */
const VERSION = "flux-v10";
const SHELL = ["./", "./index.html", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-rounded-192.png", "./icons/icon-rounded-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"];

self.addEventListener("install", e => {
  // busca direto da internet (ignora o cache do navegador) para nunca guardar uma versão antiga
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => fetch(u, { cache: "reload" }).then(r => { if (r && (r.ok || r.type === "opaque")) return c.put(u, r); }).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  // o navegador já começa a buscar a página enquanto esta cópia acorda (a abertura não espera por ela)
  const pre = self.registration.navigationPreload ? self.registration.navigationPreload.enable().catch(() => null) : null;
  e.waitUntil(Promise.all([pre, caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("flux-") && k !== VERSION).map(k => caches.delete(k))))]).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return; // dados e login: sempre direto na internet

  // manifest: sempre a versão nova da internet; sem internet, usa a cópia guardada
  if (url.origin === location.origin && url.pathname.endsWith("/manifest.json")) {
    e.respondWith(fetch(req, { cache: "no-cache" }).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put("./manifest.json", cp)); } return r; })
      .catch(() => caches.open(VERSION).then(c => c.match("./manifest.json"))));
    return;
  }

  // páginas: tenta a versão nova na internet; sem internet, usa a cópia guardada
  // se a internet não responder em 4 segundos, abre com a cópia guardada (a página nunca fica presa carregando)
  if (req.mode === "navigate") {
    const net = (async () => {
      let r = null;
      try { r = await e.preloadResponse; } catch { }
      if (!r) r = await fetch(req);
      if (r && r.ok) { const cp = r.clone(); await caches.open(VERSION).then(c => c.put("./index.html", cp)); }
      return r;
    })();
    e.waitUntil(net.catch(() => null));
    const saved = () => caches.match("./index.html").then(r => r || caches.match("./"));
    e.respondWith((async () => {
      try {
        const first = await Promise.race([net, new Promise(res => setTimeout(res, 4000, null))]);
        if (first) return first;
        return (await saved()) || await net;
      } catch {
        const s = await saved(); if (s) return s;
        return net;
      }
    })());
    return;
  }
  // demais arquivos (biblioteca, fonte, ícones): usa a cópia e atualiza por trás
  const isAsset = url.origin === location.origin || url.hostname === "cdn.jsdelivr.net" || url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com");
  if (!isAsset) return;
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});

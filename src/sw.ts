/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", () => {
  void self.clients.claim();
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), {
  denylist: [/^\/api/, /^\/auth/],
}));

registerRoute(
  ({ url }) => /\.supabase\.co$/.test(url.host),
  new NetworkFirst({
    cacheName: "supabase-api",
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

registerRoute(
  ({ url }) => /^fonts\.(googleapis|gstatic)\.com$/.test(url.host),
  new CacheFirst({
    cacheName: "google-fonts",
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// ---- Push notifications ----

type PushPayload = {
  title?: string;
  body?: string;
  link?: string;
  severity?: "info" | "warning" | "danger" | "celebrate";
};

self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { title: event.data?.text() || "Finance Family" };
  }

  const title = payload.title || "Finance Family";
  const options: NotificationOptions = {
    body: payload.body || "",
    icon: "/apple-touch-icon.png",
    badge: "/apple-touch-icon.png",
    data: { link: payload.link || "/" },
    tag: payload.link || "default",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data as { link?: string } | undefined)?.link || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => "focus" in c);
      if (existing) {
        (existing as WindowClient).navigate(link);
        (existing as WindowClient).focus();
        return;
      }
      void self.clients.openWindow(link);
    }),
  );
});

// ---- Push subscription rotation (F51) ----
// Quando o navegador rotaciona/expira a subscription, re-inscreve e persiste o
// novo endpoint via edge function (o SW não tem sessão Supabase). Sem isso, o
// endpoint antigo era deletado (410 pelo send-push) e o novo nunca chegava ao
// banco, então o usuário parava de receber push silenciosamente até reativar.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
  return arr;
};

self.addEventListener("pushsubscriptionchange", (event) => {
  const evt = event as ExtendableEvent & { oldSubscription?: PushSubscription };
  evt.waitUntil(
    (async () => {
      if (!VAPID_PUBLIC_KEY || !SUPABASE_URL) return;
      const oldEndpoint = evt.oldSubscription?.endpoint;
      try {
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        const data = sub.toJSON();
        await fetch(`${SUPABASE_URL}/functions/v1/rotate-push-subscription`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
          },
          body: JSON.stringify({
            old_endpoint: oldEndpoint,
            endpoint: sub.endpoint,
            p256dh: data.keys?.p256dh,
            auth: data.keys?.auth,
          }),
        });
      } catch {
        /* best-effort — o usuário pode reativar push nas Configurações */
      }
    })(),
  );
});

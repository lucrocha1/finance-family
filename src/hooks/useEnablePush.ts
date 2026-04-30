import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
};

const arrayBufferToBase64 = (buf: ArrayBuffer | null) => {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

type Status = "unsupported" | "denied" | "default" | "subscribed" | "loading";

export const useEnablePush = (userId: string | null | undefined) => {
  const [status, setStatus] = useState<Status>("loading");

  const refresh = useCallback(async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    setStatus(sub ? "subscribed" : Notification.permission === "granted" ? "default" : "default");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!userId) return;
    if (!VAPID_PUBLIC_KEY) {
      toast.error("VAPID_PUBLIC_KEY não configurada no ambiente");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast.error("Este navegador não suporta notificações push");
      return;
    }

    setStatus("loading");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus(permission === "denied" ? "denied" : "default");
      toast.error("Permissão de notificações negada");
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = sub.toJSON();
    const p256dh = json.keys?.p256dh ?? arrayBufferToBase64(sub.getKey("p256dh"));
    const auth = json.keys?.auth ?? arrayBufferToBase64(sub.getKey("auth"));

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: userId,
          endpoint: sub.endpoint,
          p256dh,
          auth,
          user_agent: navigator.userAgent,
        },
        { onConflict: "user_id,endpoint" },
      );

    if (error) {
      toast.error("Falha ao salvar inscrição no servidor");
      setStatus("default");
      return;
    }

    toast.success("Notificações ativadas neste dispositivo");
    setStatus("subscribed");
  }, [userId]);

  const disable = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    toast.success("Notificações desativadas neste dispositivo");
    setStatus("default");
  }, []);

  return { status, enable, disable, refresh };
};

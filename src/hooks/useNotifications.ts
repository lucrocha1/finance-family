import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";

export type NotificationSeverity = "info" | "warning" | "danger" | "celebrate";

export type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link_to: string | null;
  metadata: Record<string, unknown> | null;
  dedup_key: string | null;
  read_at: string | null;
  created_at: string;
};

const toastForSeverity = (severity: NotificationSeverity) =>
  severity === "danger" ? toast.error
    : severity === "warning" ? toast.warning
      : severity === "celebrate" ? toast.success
        : toast.info;

export const useNotifications = (userId: string | null | undefined) => {
  const [items, setItems] = useState<NotificationRow[]>([]);
  // Contagem de não-lidas vem de um count(*) exato (não das 40 buscadas), então
  // não subestima quando há mais de 40 não-lidas.
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const itemsRef = useRef<NotificationRow[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const load = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    setLoading(true);
    const [listRes, countRes] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .order("read_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null)
        .eq("user_id", userId),
    ]);
    if (!listRes.error) setItems((listRes.data as NotificationRow[] | null) ?? []);
    setUnreadCount(countRes.count ?? 0);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: uma notificação nova aparece na hora no sino + dispara um toast
  // com ação de abrir o link. Requer a tabela na publicação supabase_realtime.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notif:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as NotificationRow;
          setItems((prev) => (prev.some((i) => i.id === row.id) ? prev : [row, ...prev]));
          if (!row.read_at) setUnreadCount((c) => c + 1);
          toastForSeverity(row.severity)(row.title, {
            description: row.body ?? undefined,
            action: row.link_to ? { label: "Ver", onClick: () => navigate(row.link_to as string) } : undefined,
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, navigate]);

  const markAsRead = useCallback(async (id: string) => {
    const it = itemsRef.current.find((i) => i.id === id);
    const wasUnread = Boolean(it && !it.read_at);
    const now = new Date().toISOString();
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read_at: i.read_at ?? now } : i)));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
    await supabase.from("notifications").update({ read_at: now }).eq("id", id);
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((i) => (i.read_at ? i : { ...i, read_at: now })));
    setUnreadCount(0);
    await supabase.from("notifications").update({ read_at: now }).is("read_at", null).eq("user_id", userId);
  }, [userId]);

  return { items, unreadCount, loading, markAsRead, markAllAsRead, reload: load };
};

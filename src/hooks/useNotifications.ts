import { useCallback, useEffect, useState } from "react";

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

export const useNotifications = (userId: string | null | undefined) => {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("read_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false })
      .limit(40);
    if (!error) {
      setItems((data as NotificationRow[] | null) ?? []);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const markAsRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read_at: new Date().toISOString() } : i)));
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((i) => (i.read_at ? i : { ...i, read_at: now })));
    await supabase.from("notifications").update({ read_at: now }).is("read_at", null).eq("user_id", userId);
  }, [userId]);

  const unreadCount = items.filter((i) => !i.read_at).length;

  return { items, unreadCount, loading, markAsRead, markAllAsRead, reload: load };
};

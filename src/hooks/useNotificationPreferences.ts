import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

// Preferências de notificação (espelha a tabela notification_preferences).
// Ausência de linha = tudo ligado (defaults). Os toggles de categoria e o
// quiet hours são lidos pela Edge Function generate-notifications.
export type NotificationPrefs = {
  push_enabled: boolean;
  cat_compromissos: boolean;
  cat_orcamento: boolean;
  cat_atrasados: boolean;
  cat_fatura: boolean;
  cat_saldo: boolean;
  cat_metas: boolean;
  cat_investimentos: boolean;
  cat_recorrencias: boolean;
  cat_resumos: boolean;
  quiet_start: number | null;
  quiet_end: number | null;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  push_enabled: true,
  cat_compromissos: true,
  cat_orcamento: true,
  cat_atrasados: true,
  cat_fatura: true,
  cat_saldo: true,
  cat_metas: true,
  cat_investimentos: true,
  cat_recorrencias: true,
  cat_resumos: true,
  quiet_start: null,
  quiet_end: null,
};

export const useNotificationPreferences = (userId: string | null | undefined) => {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (data) setPrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...(data as Partial<NotificationPrefs>) });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const update = useCallback(
    async (patch: Partial<NotificationPrefs>) => {
      if (!userId) return;
      const prev = prefs;
      const next = { ...prefs, ...patch };
      setPrefs(next); // otimista
      const { error } = await supabase.from("notification_preferences").upsert(
        { user_id: userId, ...next, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      if (error) setPrefs(prev); // reverte se falhar
    },
    [prefs, userId],
  );

  return { prefs, loading, update };
};

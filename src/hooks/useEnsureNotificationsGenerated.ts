import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "finance-family-notifications-last-run";
const COOLDOWN_HOURS = 6;

// Calls generate-notifications at most once every 6h per browser. Backup
// for setups without pg_cron — once cron is wired server-side this hook
// becomes redundant but harmless.
export const useEnsureNotificationsGenerated = (userId: string | null | undefined) => {
  useEffect(() => {
    if (!userId) return;
    const last = localStorage.getItem(STORAGE_KEY);
    const now = Date.now();
    if (last && now - Number(last) < COOLDOWN_HOURS * 60 * 60 * 1000) return;

    void supabase.functions
      .invoke("generate-notifications", { body: {} })
      .then(({ error }) => {
        if (!error) localStorage.setItem(STORAGE_KEY, String(now));
      })
      .catch(() => {
        // function may not be deployed yet — silent
      });
  }, [userId]);
};

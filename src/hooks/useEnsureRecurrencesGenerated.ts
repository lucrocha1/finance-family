import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "finance-family-recurrences-last-run";
const COOLDOWN_HOURS = 12;

// Calls the generate-recurrences edge function at most once every 12 hours
// per browser. This is a fallback for setups without pg_cron — once pg_cron
// is configured server-side, this hook becomes redundant but harmless.
export const useEnsureRecurrencesGenerated = (familyId: string | null | undefined) => {
  useEffect(() => {
    if (!familyId) return;

    const last = localStorage.getItem(STORAGE_KEY);
    const now = Date.now();
    if (last && now - Number(last) < COOLDOWN_HOURS * 60 * 60 * 1000) return;

    void supabase.functions
      .invoke("generate-recurrences", { body: {} })
      .then(({ error }) => {
        if (!error) localStorage.setItem(STORAGE_KEY, String(now));
      })
      .catch(() => {
        // Silently swallow — function may not be deployed yet
      });
  }, [familyId]);
};

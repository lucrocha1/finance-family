import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { generateRecurrencesForFamily } from "@/lib/generateRecurrences";

const STORAGE_KEY = "finance-family-recurrences-last-run";
const COOLDOWN_HOURS = 6;

// Garante que as instâncias futuras de transações recorrentes existam até
// ~90 dias à frente. Roda no máximo a cada 6h por browser. Faz a geração
// client-side via supabase.from(...).insert — não depende de edge function
// deployada.
export const useEnsureRecurrencesGenerated = (familyId: string | null | undefined) => {
  const { user } = useAuth();

  useEffect(() => {
    if (!familyId || !user?.id) return;

    const cooldownKey = `${STORAGE_KEY}-${familyId}`;
    const last = localStorage.getItem(cooldownKey);
    const now = Date.now();
    if (last && now - Number(last) < COOLDOWN_HOURS * 60 * 60 * 1000) return;

    void generateRecurrencesForFamily(familyId, user.id)
      .then(() => {
        localStorage.setItem(cooldownKey, String(now));
      })
      .catch(() => {
        // Silently swallow — RLS or transient error
      });
  }, [familyId, user?.id]);
};

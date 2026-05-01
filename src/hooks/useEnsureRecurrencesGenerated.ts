import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { generateRecurrencesForFamily } from "@/lib/generateRecurrences";

// Bootstrap inicial: roda o gerador uma vez ao abrir o app, com horizonte
// default (90 dias). Páginas que dependem de horizontes maiores (Dashboard,
// Transactions) usam o useEnsureRecurrencesUpTo passando o monthEnd
// visualizado, que estende sob demanda.
const ranInSession = new Set<string>();

export const useEnsureRecurrencesGenerated = (familyId: string | null | undefined) => {
  const { user } = useAuth();

  useEffect(() => {
    if (!familyId || !user?.id) return;
    const key = `${familyId}:${user.id}`;
    if (ranInSession.has(key)) return;
    ranInSession.add(key);

    void generateRecurrencesForFamily(familyId, user.id).catch(() => {
      ranInSession.delete(key);
    });
  }, [familyId, user?.id]);
};

import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { generateRecurrencesForFamily } from "@/lib/generateRecurrences";

// Cache em memória pra rodar no máximo uma vez por (familyId, userId) na
// sessão atual. Trocamos o cooldown via localStorage por isso porque ele
// segurava regenerações depois de fixes/migrations — agora abrir o app
// sempre cobre qualquer instância faltante (a função é idempotente).
const ranInSession = new Set<string>();

export const useEnsureRecurrencesGenerated = (familyId: string | null | undefined) => {
  const { user } = useAuth();

  useEffect(() => {
    if (!familyId || !user?.id) return;
    const key = `${familyId}:${user.id}`;
    if (ranInSession.has(key)) return;
    ranInSession.add(key);

    void generateRecurrencesForFamily(familyId, user.id).catch(() => {
      // Permite retry numa próxima visita se algo falhou
      ranInSession.delete(key);
    });
  }, [familyId, user?.id]);
};

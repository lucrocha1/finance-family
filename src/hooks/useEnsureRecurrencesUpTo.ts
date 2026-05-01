import { useEffect, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { generateRecurrencesForFamily } from "@/lib/generateRecurrences";

// Cache em memória: pra cada (family, user), guarda o horizonte máximo
// já gerado nesta sessão. Evita re-disparar a geração ao re-renderizar
// na mesma navegação de mês. Se o user navegar pra um mês mais futuro,
// o horizonte é estendido e o gerador roda de novo.
const horizonCache = new Map<string, string>();

// Cache de promises em voo: previne RACE CONDITION quando o useEffect
// dispara 2× em paralelo (React StrictMode em dev, ou usuário abre
// múltiplas abas, ou navegação rápida entre meses). Sem isso, ambas as
// chamadas viam cache vazio e disparavam o gerador ao mesmo tempo,
// computando max(date) idêntico e inserindo as MESMAS filhas duas vezes
// — causando duplicação de recorrentes.
const inFlightCache = new Map<string, Promise<{ created: number }>>();

const toIso = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

// Garante que recorrências da família estão materializadas até pelo
// menos `targetDate` (com buffer interno na função). Chamado pelo
// Dashboard e Transactions ao navegar entre meses. Retorna `version`
// que muda quando uma geração nova completa — páginas usam isso pra
// triggerar reload das queries.
export const useEnsureRecurrencesUpTo = (targetDate: Date | null | undefined) => {
  const { family } = useFamily();
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!family?.id || !user?.id || !targetDate) return;

    const targetIso = toIso(targetDate);
    const cacheKey = `${family.id}:${user.id}`;
    const lastHorizon = horizonCache.get(cacheKey);

    // Se já geramos pelo menos até esse target, não refaz
    if (lastHorizon && lastHorizon >= targetIso) return;

    let cancelled = false;
    setGenerating(true);

    // Dedup: se já existe uma chamada em voo pro mesmo (family, user) E
    // pra um horizonte >= targetIso, reutilizamos. Senão, dispara nova.
    const inFlightKey = `${cacheKey}:${targetIso}`;
    let promise = inFlightCache.get(inFlightKey);
    if (!promise) {
      promise = generateRecurrencesForFamily(family.id, user.id, targetIso);
      inFlightCache.set(inFlightKey, promise);
    }

    void promise
      .then((res) => {
        if (cancelled) return;
        horizonCache.set(cacheKey, targetIso);
        if (res.created > 0) setVersion((v) => v + 1);
      })
      .catch(() => {
        // Permite retry numa próxima navegação
        horizonCache.delete(cacheKey);
      })
      .finally(() => {
        inFlightCache.delete(inFlightKey);
        if (!cancelled) setGenerating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [family?.id, user?.id, targetDate]);

  return { version, generating };
};

// Permite invalidar o cache externamente (ex: depois de criar uma nova
// recorrente, força próxima geração a rodar de novo).
export const invalidateRecurrenceHorizon = (familyId: string, userId: string) => {
  horizonCache.delete(`${familyId}:${userId}`);
};

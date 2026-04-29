import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

const WINDOW_DAYS = 7;

export type DueItem = {
  id: string;
  source: "transaction" | "scheduled" | "card_invoice" | "debt";
  description: string;
  amount: number;
  date: string;
  type: "income" | "expense" | "invoice";
  routeTarget?: string;
};

const toIso = (d: Date) => d.toISOString().slice(0, 10);

const clampDay = (y: number, m: number, d: number) => {
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d, last));
};

export const useUpcomingDueDates = (familyId: string | null | undefined) => {
  const [items, setItems] = useState<DueItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!familyId) {
      setItems([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const horizon = new Date(todayDate);
    horizon.setDate(horizon.getDate() + WINDOW_DAYS);
    const today = toIso(todayDate);
    const end = toIso(horizon);

    const fetch = async () => {
      // RLS already scopes results to user_id = auth.uid(); the
      // .eq("family_id", ...) filter is redundant and was hiding rows
      // with drifted family_id.
      const [txRes, schedRes, debtsRes, cardsRes, cardTxRes] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, description, amount, date, type")
          .eq("status", "pending")
          .is("card_id", null)
          .gte("date", today)
          .lte("date", end)
          .order("date", { ascending: true }),
        supabase
          .from("scheduled_payments")
          .select("id, description, amount, due_date, type, is_paid")
          .gte("due_date", today)
          .lte("due_date", end)
          .order("due_date", { ascending: true }),
        supabase
          .from("debts")
          .select("id, name, total_with_interest, original_amount, due_date, status, direction")
          .neq("status", "paid")
          .not("due_date", "is", null)
          .gte("due_date", today)
          .lte("due_date", end),
        supabase.from("cards").select("id, name, closing_day, due_day"),
        supabase
          .from("transactions")
          .select("card_id, amount, date")
          .eq("type", "expense")
          .not("card_id", "is", null)
          .gte("date", toIso(new Date(todayDate.getTime() - 45 * 86400000)))
          .lte("date", end),
      ]);

      if (cancelled) return;

      const txItems: DueItem[] = (txRes.data ?? []).map((t: any) => ({
        id: `tx-${t.id}`,
        source: "transaction",
        description: t.description ?? "Transação",
        amount: Number(t.amount ?? 0),
        date: t.date,
        type: t.type === "income" ? "income" : "expense",
        routeTarget: "/transactions",
      }));

      const schedItems: DueItem[] = (schedRes.data ?? [])
        .filter((s: any) => !s.is_paid)
        .map((s: any) => ({
          id: `sched-${s.id}`,
          source: "scheduled",
          description: s.description ?? "Compromisso",
          amount: Number(s.amount ?? 0),
          date: s.due_date,
          type: s.type === "receivable" || s.type === "income" ? "income" : "expense",
          routeTarget: "/schedule",
        }));

      const debtItems: DueItem[] = (debtsRes.data ?? []).map((d: any) => ({
        id: `debt-${d.id}`,
        source: "debt",
        description: `${d.direction === "they_owe" ? "Receber" : "Pagar"} — ${d.name ?? "Dívida"}`,
        amount: Number(d.total_with_interest ?? d.original_amount ?? 0),
        date: d.due_date,
        type: d.direction === "they_owe" ? "income" : "expense",
        routeTarget: `/debts/${d.id}`,
      }));

      // Card invoice due dates within the window
      const cards = (cardsRes.data ?? []) as Array<{ id: string; name: string; closing_day: number | null; due_day: number | null }>;
      const cardTxs = (cardTxRes.data ?? []) as Array<{ card_id: string | null; amount: number; date: string }>;
      const cardItems: DueItem[] = [];
      cards.forEach((card) => {
        const closingDay = Number(card.closing_day || 0);
        const dueDay = Number(card.due_day || 0);
        if (!closingDay || !dueDay) return;
        // Look at this and next month's cycles
        for (let offset = 0; offset <= 1; offset++) {
          const ref = new Date(todayDate.getFullYear(), todayDate.getMonth() + offset, 1);
          const closingDate = clampDay(ref.getFullYear(), ref.getMonth(), closingDay);
          const dueOffset = dueDay >= closingDay ? 0 : 1;
          const dueDate = clampDay(ref.getFullYear(), ref.getMonth() + dueOffset, dueDay);
          const dueIso = toIso(dueDate);
          if (dueIso < today || dueIso > end) continue;

          const prevClosing = clampDay(ref.getFullYear(), ref.getMonth() - 1, closingDay);
          const cycleStart = new Date(prevClosing);
          cycleStart.setDate(cycleStart.getDate() + 1);
          const startIso = toIso(cycleStart);
          const endIsoCycle = toIso(closingDate);
          const total = cardTxs
            .filter((tx) => tx.card_id === card.id && tx.date >= startIso && tx.date <= endIsoCycle)
            .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
          if (total <= 0) continue;
          cardItems.push({
            id: `card-${card.id}-${dueIso}`,
            source: "card_invoice",
            description: `Fatura — ${card.name}`,
            amount: total,
            date: dueIso,
            type: "expense",
            routeTarget: `/cards/${card.id}`,
          });
        }
      });

      const merged = [...txItems, ...schedItems, ...debtItems, ...cardItems].sort((a, b) => a.date.localeCompare(b.date));
      setItems(merged);
      setLoading(false);
    };

    void fetch();

    return () => {
      cancelled = true;
    };
  }, [familyId]);

  return { items, loading, count: items.length };
};

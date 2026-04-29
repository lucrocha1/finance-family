import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

const WINDOW_DAYS = 7;

export type DueItem = {
  id: string;
  source: "transaction" | "scheduled" | "card_invoice";
  description: string;
  amount: number;
  date: string;
  type: "income" | "expense" | "invoice";
};

const toIso = (d: Date) => d.toISOString().slice(0, 10);

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
      const [txRes, schedRes] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, description, amount, date, type")
          .eq("family_id", familyId)
          .eq("status", "pending")
          .gte("date", today)
          .lte("date", end)
          .order("date", { ascending: true }),
        supabase
          .from("scheduled_payments")
          .select("id, description, amount, due_date, type, is_paid")
          .eq("family_id", familyId)
          .gte("due_date", today)
          .lte("due_date", end)
          .order("due_date", { ascending: true }),
      ]);

      if (cancelled) return;

      const txItems: DueItem[] = (txRes.data ?? []).map((t: any) => ({
        id: `tx-${t.id}`,
        source: "transaction",
        description: t.description ?? "Transação",
        amount: Number(t.amount ?? 0),
        date: t.date,
        type: t.type === "income" ? "income" : "expense",
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
        }));

      const merged = [...txItems, ...schedItems].sort((a, b) => a.date.localeCompare(b.date));
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

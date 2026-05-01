import { supabase } from "@/integrations/supabase/client";

const LOOK_AHEAD_DAYS = 90;

type RecurrenceType = "weekly" | "monthly" | "yearly";

type Parent = {
  id: string;
  family_id: string;
  user_id: string | null;
  type: string;
  description: string;
  amount: number;
  date: string;
  notes: string | null;
  category_id: string | null;
  account_id: string | null;
  card_id: string | null;
  recurrence_type: RecurrenceType;
  recurrence_end_date: string | null;
  recurrence_day: number | null;
  linked_user_id: string | null;
  linked_pair_id: string | null;
};

const toIso = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const addInterval = (iso: string, type: RecurrenceType, anchorDay: number | null): string => {
  const d = new Date(`${iso}T00:00:00`);
  if (type === "weekly") {
    d.setDate(d.getDate() + 7);
  } else if (type === "monthly") {
    d.setMonth(d.getMonth() + 1);
    if (anchorDay) {
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(anchorDay, lastDay));
    }
  } else if (type === "yearly") {
    d.setFullYear(d.getFullYear() + 1);
  }
  return toIso(d);
};

// Client-side fallback that mirrors the generate-recurrences edge function.
// Iterates parent recorrentes da família e cria as instâncias faltantes até
// LOOK_AHEAD_DAYS no futuro. Idempotente: usa a maior data existente
// (parent + filhos) como ponto de partida, então rodar várias vezes é seguro.
export const generateRecurrencesForFamily = async (familyId: string, authUserId: string): Promise<{ created: number }> => {
  const today = toIso(new Date());
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + LOOK_AHEAD_DAYS);
  const horizonIso = toIso(horizon);

  const { data: parents, error: parentsErr } = await supabase
    .from("transactions")
    .select(
      "id, family_id, user_id, type, description, amount, date, notes, category_id, account_id, card_id, recurrence_type, recurrence_end_date, recurrence_day, linked_user_id, linked_pair_id",
    )
    .eq("family_id", familyId)
    .eq("is_recurring", true)
    .is("recurrence_parent_id", null)
    .or(`recurrence_end_date.is.null,recurrence_end_date.gte.${today}`);

  if (parentsErr || !parents) return { created: 0 };

  let created = 0;

  for (const parent of parents as Parent[]) {
    if (!parent.recurrence_type) continue;

    // Linked parents: handled by security-definer RPC porque o lado espelho
    // pertence a outro user_id e RLS bloqueia insert direto.
    if (parent.linked_user_id && parent.user_id === authUserId) {
      const { error: rpcErr } = await supabase.rpc("generate_linked_pair_recurrences", { p_my_parent_id: parent.id });
      if (!rpcErr) created += 1; // count rough — RPC retorna nº de pares
      continue;
    }
    // Pula parent espelho de outra ponta — só o "dono" gera via RPC
    if (parent.linked_user_id && parent.user_id !== authUserId) continue;

    const { data: latestRows } = await supabase
      .from("transactions")
      .select("date")
      .or(`id.eq.${parent.id},recurrence_parent_id.eq.${parent.id}`)
      .order("date", { ascending: false })
      .limit(1);

    const latestDate = latestRows?.[0]?.date ?? parent.date;
    const cap = parent.recurrence_end_date && parent.recurrence_end_date < horizonIso ? parent.recurrence_end_date : horizonIso;

    let nextDate = addInterval(latestDate, parent.recurrence_type, parent.recurrence_day);
    const toInsert: Record<string, unknown>[] = [];
    while (nextDate <= cap) {
      toInsert.push({
        family_id: parent.family_id,
        user_id: authUserId,
        type: parent.type,
        description: parent.description,
        amount: parent.amount,
        date: nextDate,
        notes: parent.notes,
        category_id: parent.category_id,
        account_id: parent.account_id,
        card_id: parent.card_id,
        status: "pending",
        is_recurring: false,
        recurrence_parent_id: parent.id,
      });
      nextDate = addInterval(nextDate, parent.recurrence_type, parent.recurrence_day);
    }

    if (toInsert.length > 0) {
      const { error: insertErr } = await supabase.from("transactions").insert(toInsert);
      if (!insertErr) created += toInsert.length;
    }
  }

  return { created };
};

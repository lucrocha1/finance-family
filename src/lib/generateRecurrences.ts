import { supabase } from "@/integrations/supabase/client";

const DEFAULT_LOOK_AHEAD_DAYS = 90;
const TARGET_BUFFER_DAYS = 30; // buffer aplicado em cima de targetEndIso

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

// Calcula horizon efetivo: max(today + 90d, targetEndIso + 30d). Se
// targetEndIso não vier, usa só o default. Sempre como ISO date.
const computeHorizonIso = (targetEndIso?: string | null): string => {
  const horizonDefault = new Date();
  horizonDefault.setDate(horizonDefault.getDate() + DEFAULT_LOOK_AHEAD_DAYS);
  if (!targetEndIso) return toIso(horizonDefault);
  const targetWithBuffer = new Date(`${targetEndIso}T00:00:00`);
  targetWithBuffer.setDate(targetWithBuffer.getDate() + TARGET_BUFFER_DAYS);
  return toIso(horizonDefault > targetWithBuffer ? horizonDefault : targetWithBuffer);
};

// Diferença em dias entre hoje e horizonIso. Usado pra calcular o
// p_horizon_days passado pra RPC linked.
const daysFromTodayToIso = (horizonIso: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${horizonIso}T00:00:00`);
  const diff = Math.ceil((target.getTime() - today.getTime()) / 86400000);
  return Math.max(diff, 1);
};

// Gera instâncias futuras de transações recorrentes pra família. Por
// padrão estende até hoje+90 dias; quando o usuário navega pra um mês
// distante, passe `targetEndIso` (ex: fim do mês visualizado) e o
// gerador estende até max(default, targetEndIso + 30 dias).
//
// Idempotente: usa max(date) por parent, então rodar várias vezes só
// insere o que falta. Pra parents linked (linked_user_id presente),
// delega na RPC security definer porque RLS impede insert com
// user_id alheio.
export const generateRecurrencesForFamily = async (
  familyId: string,
  authUserId: string,
  targetEndIso?: string | null,
): Promise<{ created: number }> => {
  const today = toIso(new Date());
  const horizonIso = computeHorizonIso(targetEndIso);
  const horizonDays = daysFromTodayToIso(horizonIso);

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

    // Linked parents — RPC security definer cobre os dois lados
    if (parent.linked_user_id && parent.user_id === authUserId) {
      const { data: nCreated, error: rpcErr } = await supabase.rpc("generate_linked_pair_recurrences", {
        p_my_parent_id: parent.id,
        p_horizon_days: horizonDays,
      });
      if (!rpcErr) created += Number(nCreated ?? 0);
      continue;
    }
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

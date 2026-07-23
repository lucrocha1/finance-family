// Generate-recurrences edge function.
//
// Roda a geração de ocorrências recorrentes no servidor (todos os usuários),
// agendada via pg_cron (job finance-family-recurrences, 06:00 UTC), garantindo
// materialização mesmo sem ninguém abrir o app. O cliente também gera (via
// src/lib/generateRecurrences.ts, horizonte dinâmico); ambos são idempotentes.
// Lookahead alinhado com o cliente: 90 dias.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOOK_AHEAD_DAYS = 90;

type Parent = {
  id: string;
  family_id: string;
  user_id: string;
  type: string;
  description: string;
  amount: number;
  date: string;
  notes: string | null;
  category_id: string | null;
  account_id: string | null;
  card_id: string | null;
  recurrence_type: "weekly" | "monthly" | "yearly";
  recurrence_end_date: string | null;
  recurrence_day: number | null;
};

const addInterval = (iso: string, type: Parent["recurrence_type"], anchorDay: number | null): string => {
  const [y, m, day] = iso.split("-").map(Number); // m é 1-based
  if (type === "weekly") {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }
  if (type === "monthly") {
    // Aritmética por ano/mês (NÃO setMonth): dias 29-31 estouravam o mês e
    // pulavam meses inteiros (F6, mesmo bug do gerador client-side).
    const targetIndex = m; // próximo mês, 0-based
    const year = y + Math.floor(targetIndex / 12);
    const month = ((targetIndex % 12) + 12) % 12;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const dd = Math.min(anchorDay ?? day, lastDay);
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  if (type === "yearly") {
    const year = y + 1;
    const lastDay = new Date(year, m, 0).getDate();
    const dd = Math.min(anchorDay ?? day, lastDay);
    return `${year}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  return iso;
};

Deno.serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + LOOK_AHEAD_DAYS);
  const horizonIso = horizon.toISOString().slice(0, 10);

  const { data: parents, error: parentsErr } = await supabase
    .from("transactions")
    .select(
      "id, family_id, user_id, type, description, amount, date, notes, category_id, account_id, card_id, recurrence_type, recurrence_end_date, recurrence_day",
    )
    .eq("is_recurring", true)
    .is("recurrence_parent_id", null)
    .or(`recurrence_end_date.is.null,recurrence_end_date.gte.${today}`);

  if (parentsErr) {
    return new Response(JSON.stringify({ error: parentsErr.message }), { status: 500 });
  }

  let created = 0;
  const errors: string[] = [];

  for (const parent of (parents ?? []) as Parent[]) {
    if (!parent.recurrence_type) continue;

    // Find the latest existing date among parent + children
    const { data: latestRows } = await supabase
      .from("transactions")
      .select("date")
      .or(`id.eq.${parent.id},recurrence_parent_id.eq.${parent.id}`)
      .order("date", { ascending: false })
      .limit(1);

    const latestDate = latestRows?.[0]?.date ?? parent.date;
    let nextDate = addInterval(latestDate, parent.recurrence_type, parent.recurrence_day);
    const cap = parent.recurrence_end_date && parent.recurrence_end_date < horizonIso ? parent.recurrence_end_date : horizonIso;

    const toInsert: any[] = [];
    while (nextDate <= cap) {
      toInsert.push({
        family_id: parent.family_id,
        user_id: parent.user_id,
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
      const { error: insertErr } = await supabase
        .from("transactions")
        .upsert(toInsert, { onConflict: "recurrence_parent_id,date", ignoreDuplicates: true });
      if (insertErr) {
        errors.push(`parent=${parent.id}: ${insertErr.message}`);
      } else {
        created += toInsert.length;
        await supabase
          .from("transactions")
          .update({ recurrence_last_generated_at: new Date().toISOString() })
          .eq("id", parent.id);
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, created, errors, parents_checked: parents?.length ?? 0 }),
    { headers: { "Content-Type": "application/json" } },
  );
});

// generate-notifications: runs daily, scans rules, inserts notifications
// rows for each user. Idempotent thanks to dedup_key unique index.

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type Severity = "info" | "warning" | "danger" | "celebrate";
type Notif = {
  user_id: string;
  family_id?: string | null;
  kind: string;
  severity: Severity;
  title: string;
  body?: string;
  link_to?: string;
  metadata?: Record<string, unknown>;
  dedup_key?: string;
};

const ptCurrency = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

const toIso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => toIso(new Date());
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toIso(d);
};
const isoWeek = (d = new Date()) => {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  const week = 1 + Math.ceil((firstThursday - target.valueOf()) / (7 * 86400000));
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
};
const monthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const insertNotifications = async (sb: SupabaseClient, items: Notif[]) => {
  if (items.length === 0) return;
  const { error } = await sb.from("notifications").upsert(items, {
    onConflict: "user_id,dedup_key",
    ignoreDuplicates: true,
  });
  if (error) console.error("[notify] insert failed:", error.message);
};

// ---- Snapshots de investimentos ----
const snapshotInvestments = async (sb: SupabaseClient, userId: string) => {
  const { data: invs } = await sb.from("investments").select("id, current_value").eq("user_id", userId);
  if (!invs || invs.length === 0) return;
  await sb.from("investment_snapshots").upsert(
    invs.map((i: any) => ({
      investment_id: i.id,
      user_id: userId,
      value: Number(i.current_value || 0),
      snapshot_date: today(),
    })),
    { onConflict: "investment_id,snapshot_date", ignoreDuplicates: true },
  );
};

// ---- 1. Compromissos do dia ----
const checkDailyDue = async (sb: SupabaseClient, userId: string) => {
  const tdy = today();
  const [tx, sched, debts] = await Promise.all([
    sb.from("transactions").select("id, description, amount, type")
      .eq("user_id", userId).eq("status", "pending").is("card_id", null).eq("date", tdy),
    sb.from("scheduled_payments").select("id, description, amount, type")
      .eq("user_id", userId).eq("is_paid", false).eq("due_date", tdy),
    sb.from("debts").select("id, name, total_with_interest, original_amount, direction")
      .eq("user_id", userId).neq("status", "paid").eq("due_date", tdy),
  ]);
  const total =
    (tx.data ?? []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0) +
    (sched.data ?? []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0) +
    (debts.data ?? []).reduce((s: number, t: any) => s + Number(t.total_with_interest ?? t.original_amount ?? 0), 0);
  const count = (tx.data?.length ?? 0) + (sched.data?.length ?? 0) + (debts.data?.length ?? 0);
  if (count === 0) return;
  await insertNotifications(sb, [{
    user_id: userId, kind: "daily_due", severity: "info",
    title: `${count} compromisso${count === 1 ? "" : "s"} hoje`,
    body: `Total a movimentar: ${ptCurrency(total)}.`,
    link_to: "/schedule",
    dedup_key: `daily_due:${tdy}`,
  }]);
};

// ---- 2. Resumo da semana (segunda) ----
const checkWeeklySummary = async (sb: SupabaseClient, userId: string) => {
  if (new Date().getDay() !== 1) return;
  const start = today();
  const end = new Date();
  end.setDate(end.getDate() + 7);
  const endIso = toIso(end);
  const [tx, sched, debts] = await Promise.all([
    sb.from("transactions").select("amount, type")
      .eq("user_id", userId).eq("status", "pending").is("card_id", null)
      .gte("date", start).lte("date", endIso),
    sb.from("scheduled_payments").select("amount, type")
      .eq("user_id", userId).eq("is_paid", false)
      .gte("due_date", start).lte("due_date", endIso),
    sb.from("debts").select("total_with_interest, original_amount, direction")
      .eq("user_id", userId).neq("status", "paid").not("due_date", "is", null)
      .gte("due_date", start).lte("due_date", endIso),
  ]);
  const total =
    (tx.data ?? []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0) +
    (sched.data ?? []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0) +
    (debts.data ?? []).reduce((s: number, t: any) => s + Number(t.total_with_interest ?? t.original_amount ?? 0), 0);
  const count = (tx.data?.length ?? 0) + (sched.data?.length ?? 0) + (debts.data?.length ?? 0);
  if (count === 0) return;
  await insertNotifications(sb, [{
    user_id: userId, kind: "weekly_summary", severity: "info",
    title: `Sua semana financeira`,
    body: `${count} compromisso${count === 1 ? "" : "s"} pra próximos 7 dias — total ${ptCurrency(total)}.`,
    link_to: "/schedule",
    dedup_key: `weekly_summary:${isoWeek()}`,
  }]);
};

// ---- 3. Orçamento 80% e 100% ----
const checkBudgets = async (sb: SupabaseClient, userId: string) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startIso = toIso(new Date(year, now.getMonth(), 1));
  const endIso = toIso(new Date(year, now.getMonth() + 1, 0));

  const [budgetsRes, txRes, catsRes] = await Promise.all([
    sb.from("budgets").select("category_id, amount, year, month").eq("user_id", userId),
    sb.from("transactions").select("category_id, amount")
      .eq("user_id", userId).eq("type", "expense")
      .gte("date", startIso).lte("date", endIso),
    sb.from("categories").select("id, name").eq("user_id", userId),
  ]);

  const cap = year * 12 + month;
  const budgetByCat = new Map<string, number>();
  (budgetsRes.data ?? []).forEach((b: any) => {
    if (b.year * 12 + b.month > cap) return;
    const current = budgetByCat.get(b.category_id);
    const order = b.year * 12 + b.month;
    if (current === undefined || order > (current as any).order) {
      budgetByCat.set(b.category_id, { amount: Number(b.amount || 0), order } as any);
    }
  });
  const spentByCat = new Map<string, number>();
  (txRes.data ?? []).forEach((t: any) => {
    if (!t.category_id) return;
    spentByCat.set(t.category_id, (spentByCat.get(t.category_id) ?? 0) + Number(t.amount || 0));
  });
  const catName = new Map<string, string>(
    (catsRes.data ?? []).map((c: any) => [c.id, c.name]),
  );

  const items: Notif[] = [];
  budgetByCat.forEach((value: any, catId: string) => {
    const limit = value.amount;
    if (limit <= 0) return;
    const spent = spentByCat.get(catId) ?? 0;
    const pct = (spent / limit) * 100;
    const name = catName.get(catId) || "categoria";
    if (pct >= 100) {
      items.push({
        user_id: userId, kind: "budget_over", severity: "danger",
        title: `Orçamento estourado — ${name}`,
        body: `Gastou ${ptCurrency(spent)} de ${ptCurrency(limit)} (${pct.toFixed(0)}%).`,
        link_to: "/goals",
        dedup_key: `budget_over:${catId}:${monthKey(now)}`,
      });
    } else if (pct >= 80) {
      items.push({
        user_id: userId, kind: "budget_warn", severity: "warning",
        title: `${name} chegou em ${pct.toFixed(0)}% do limite`,
        body: `${ptCurrency(spent)} de ${ptCurrency(limit)}.`,
        link_to: "/goals",
        dedup_key: `budget_warn:${catId}:${monthKey(now)}`,
      });
    }
  });
  await insertNotifications(sb, items);
};

// ---- 4. Transações atrasadas (despesa + receita) ----
const checkOverdueTx = async (sb: SupabaseClient, userId: string) => {
  const tdy = today();
  const { data } = await sb.from("transactions")
    .select("id, description, amount, type, date")
    .eq("user_id", userId).eq("status", "pending").is("card_id", null)
    .lt("date", tdy);
  const items: Notif[] = (data ?? []).map((t: any) => ({
    user_id: userId,
    kind: t.type === "income" ? "income_overdue" : "tx_overdue",
    severity: t.type === "income" ? "info" : "warning",
    title: t.type === "income" ? `Receita atrasada — ${t.description}` : `Despesa atrasada — ${t.description}`,
    body: `${ptCurrency(Number(t.amount || 0))} • venceu em ${new Date(`${t.date}T00:00:00`).toLocaleDateString("pt-BR")}.`,
    link_to: "/transactions",
    metadata: { transaction_id: t.id },
    dedup_key: `tx_overdue:${t.id}`,
  }));
  await insertNotifications(sb, items);
};

// ---- 5. Dívidas atrasadas ----
const checkOverdueDebts = async (sb: SupabaseClient, userId: string) => {
  const tdy = today();
  const { data } = await sb.from("debts")
    .select("id, name, due_date, total_with_interest, original_amount, direction")
    .eq("user_id", userId).neq("status", "paid").not("due_date", "is", null)
    .lt("due_date", tdy);
  const items: Notif[] = (data ?? []).map((d: any) => ({
    user_id: userId,
    kind: "debt_overdue",
    severity: "warning",
    title: `${d.direction === "they_owe" ? "Receber" : "Pagar"} atrasado — ${d.name}`,
    body: `${ptCurrency(Number(d.total_with_interest ?? d.original_amount ?? 0))} • venceu em ${new Date(`${d.due_date}T00:00:00`).toLocaleDateString("pt-BR")}.`,
    link_to: `/debts/${d.id}`,
    metadata: { debt_id: d.id },
    dedup_key: `debt_overdue:${d.id}`,
  }));
  await insertNotifications(sb, items);
};

// ---- 6/7. Cartão fecha amanhã / vence amanhã ----
const checkCardClosingDue = async (sb: SupabaseClient, userId: string) => {
  const { data: cards } = await sb.from("cards")
    .select("id, name, closing_day, due_day")
    .eq("user_id", userId);
  if (!cards) return;

  const tomorrowDay = new Date();
  tomorrowDay.setDate(tomorrowDay.getDate() + 1);
  const tDay = tomorrowDay.getDate();
  const items: Notif[] = [];
  for (const c of cards) {
    if (Number(c.closing_day) === tDay) {
      items.push({
        user_id: userId,
        kind: "card_closing",
        severity: "info",
        title: `Fatura de ${c.name} fecha amanhã`,
        body: `Compras feitas a partir de amanhã entram na próxima fatura.`,
        link_to: `/cards/${c.id}`,
        metadata: { card_id: c.id },
        dedup_key: `card_closing:${c.id}:${monthKey()}`,
      });
    }
    if (Number(c.due_day) === tDay) {
      items.push({
        user_id: userId,
        kind: "card_due",
        severity: "warning",
        title: `Fatura de ${c.name} vence amanhã`,
        body: `Não esqueça de pagar pra evitar juros.`,
        link_to: `/cards/${c.id}`,
        metadata: { card_id: c.id },
        dedup_key: `card_due:${c.id}:${monthKey()}`,
      });
    }
  }
  await insertNotifications(sb, items);
};

// ---- 8. Saldo bancário negativo ----
const checkNegativeBalance = async (sb: SupabaseClient, userId: string) => {
  const { data } = await sb.from("accounts")
    .select("id, name, balance")
    .eq("user_id", userId).lt("balance", 0);
  const tdy = today();
  const items: Notif[] = (data ?? []).map((a: any) => ({
    user_id: userId,
    kind: "negative_balance",
    severity: "danger",
    title: `Conta ${a.name} no negativo`,
    body: `Saldo atual: ${ptCurrency(Number(a.balance || 0))}.`,
    link_to: "/settings",
    metadata: { account_id: a.id },
    dedup_key: `negative_balance:${a.id}:${tdy}`,
  }));
  await insertNotifications(sb, items);
};

// ---- 9. Limite do cartão > 80% ----
const checkCardLimitHigh = async (sb: SupabaseClient, userId: string) => {
  const { data: cards } = await sb.from("cards")
    .select("id, name, credit_limit").eq("user_id", userId);
  if (!cards) return;
  const ids = cards.map((c: any) => c.id);
  if (ids.length === 0) return;
  const { data: tx } = await sb.from("transactions")
    .select("card_id, amount")
    .eq("user_id", userId).eq("type", "expense").neq("status", "paid")
    .in("card_id", ids);
  const usedByCard = new Map<string, number>();
  (tx ?? []).forEach((t: any) => {
    usedByCard.set(t.card_id, (usedByCard.get(t.card_id) ?? 0) + Number(t.amount || 0));
  });
  const items: Notif[] = [];
  for (const c of cards) {
    const limit = Number(c.credit_limit || 0);
    const used = usedByCard.get(c.id) ?? 0;
    if (limit <= 0) continue;
    const pct = (used / limit) * 100;
    if (pct >= 80) {
      items.push({
        user_id: userId,
        kind: "card_limit_high",
        severity: pct >= 100 ? "danger" : "warning",
        title: `${c.name} em ${pct.toFixed(0)}% do limite`,
        body: `${ptCurrency(used)} de ${ptCurrency(limit)}.`,
        link_to: `/cards/${c.id}`,
        metadata: { card_id: c.id },
        dedup_key: `card_limit:${c.id}:${monthKey()}`,
      });
    }
  }
  await insertNotifications(sb, items);
};

// ---- 10. Recorrência criada ----
const checkRecurrenceGenerated = async (sb: SupabaseClient, userId: string) => {
  const since = new Date();
  since.setDate(since.getDate() - 1);
  const { data } = await sb.from("transactions")
    .select("id")
    .eq("user_id", userId)
    .not("recurrence_parent_id", "is", null)
    .gte("created_at", since.toISOString());
  const count = data?.length ?? 0;
  if (count === 0) return;
  await insertNotifications(sb, [{
    user_id: userId,
    kind: "recurrence_generated",
    severity: "info",
    title: `${count} recorrência${count === 1 ? "" : "s"} criada${count === 1 ? "" : "s"}`,
    body: `Confira em Transações.`,
    link_to: "/transactions",
    dedup_key: `recurrence_generated:${today()}`,
  }]);
};

// ---- 11. Marcos de meta (50/90/100) ----
const checkGoalMilestones = async (sb: SupabaseClient, userId: string) => {
  const { data } = await sb.from("goals").select("*").eq("user_id", userId);
  const items: Notif[] = [];
  for (const g of data ?? []) {
    const target = Number(g.target_amount || 0);
    const current = Number(g.current_amount || 0);
    if (target <= 0) continue;
    const pct = (current / target) * 100;
    if (pct >= 100) {
      items.push({
        user_id: userId, kind: "goal_done", severity: "celebrate",
        title: `Meta atingida — ${g.name} 🎉`,
        body: `${ptCurrency(current)} / ${ptCurrency(target)}.`,
        link_to: "/goals",
        metadata: { goal_id: g.id },
        dedup_key: `goal_done:${g.id}`,
      });
    } else if (pct >= 90) {
      items.push({
        user_id: userId, kind: "goal_90", severity: "info",
        title: `Quase lá — ${g.name}`,
        body: `${pct.toFixed(0)}% — falta ${ptCurrency(target - current)}.`,
        link_to: "/goals",
        metadata: { goal_id: g.id },
        dedup_key: `goal_90:${g.id}`,
      });
    } else if (pct >= 50) {
      items.push({
        user_id: userId, kind: "goal_50", severity: "info",
        title: `Metade do caminho — ${g.name}`,
        body: `${pct.toFixed(0)}% concluído.`,
        link_to: "/goals",
        metadata: { goal_id: g.id },
        dedup_key: `goal_50:${g.id}`,
      });
    }
  }
  await insertNotifications(sb, items);
};

// ---- 12. Investimento ±5% (vs ~7 dias atrás) ----
const checkInvestmentVariation = async (sb: SupabaseClient, userId: string) => {
  const { data: invs } = await sb.from("investments")
    .select("id, name, current_value")
    .eq("user_id", userId);
  if (!invs || invs.length === 0) return;
  const items: Notif[] = [];
  for (const inv of invs) {
    const current = Number(inv.current_value || 0);
    const since = new Date();
    since.setDate(since.getDate() - 8);
    const { data: prevSnap } = await sb.from("investment_snapshots")
      .select("value, snapshot_date")
      .eq("investment_id", inv.id)
      .lte("snapshot_date", toIso(since))
      .order("snapshot_date", { ascending: false })
      .limit(1);
    const previous = Number(prevSnap?.[0]?.value || 0);
    if (previous <= 0) continue;
    const variation = ((current - previous) / previous) * 100;
    if (variation >= 5) {
      items.push({
        user_id: userId, kind: "invest_up", severity: "celebrate",
        title: `${inv.name} valorizou ${variation.toFixed(1)}%`,
        body: `De ${ptCurrency(previous)} para ${ptCurrency(current)}.`,
        link_to: "/investments",
        metadata: { investment_id: inv.id },
        dedup_key: `invest_up:${inv.id}:${isoWeek()}`,
      });
    } else if (variation <= -5) {
      items.push({
        user_id: userId, kind: "invest_down", severity: "warning",
        title: `${inv.name} caiu ${Math.abs(variation).toFixed(1)}%`,
        body: `De ${ptCurrency(previous)} para ${ptCurrency(current)}.`,
        link_to: "/investments",
        metadata: { investment_id: inv.id },
        dedup_key: `invest_down:${inv.id}:${isoWeek()}`,
      });
    }
  }
  await insertNotifications(sb, items);
};

Deno.serve(async (_req: Request) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  const { data: profiles } = await sb.from("profiles").select("id");
  if (!profiles) {
    return new Response(JSON.stringify({ ok: false, error: "no profiles" }), { status: 500 });
  }

  let processed = 0;
  for (const p of profiles) {
    const uid = String((p as any).id);
    try {
      await snapshotInvestments(sb, uid);
      await Promise.all([
        checkDailyDue(sb, uid),
        checkWeeklySummary(sb, uid),
        checkBudgets(sb, uid),
        checkOverdueTx(sb, uid),
        checkOverdueDebts(sb, uid),
        checkCardClosingDue(sb, uid),
        checkNegativeBalance(sb, uid),
        checkCardLimitHigh(sb, uid),
        checkRecurrenceGenerated(sb, uid),
        checkGoalMilestones(sb, uid),
        checkInvestmentVariation(sb, uid),
      ]);
      processed += 1;
    } catch (err) {
      console.error(`[notify] user ${uid} failed:`, err);
    }
  }

  return new Response(JSON.stringify({ ok: true, processed }), {
    headers: { "Content-Type": "application/json" },
  });
});

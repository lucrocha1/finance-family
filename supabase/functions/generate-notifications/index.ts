// generate-notifications: runs daily (pg_cron), scans rules, inserts
// notifications rows for each user. Idempotent thanks to the (user_id,dedup_key)
// unique index. Respeita notification_preferences (gate por categoria + quiet
// hours + push_enabled): in-app é sempre gravado; o PUSH do sistema só dispara
// se a categoria está ligada, push_enabled=true e fora do horário de silêncio.

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

// ---- Preferências ----
type Prefs = {
  push_enabled: boolean;
  cat_compromissos: boolean;
  cat_orcamento: boolean;
  cat_atrasados: boolean;
  cat_fatura: boolean;
  cat_saldo: boolean;
  cat_metas: boolean;
  cat_investimentos: boolean;
  cat_recorrencias: boolean;
  cat_resumos: boolean;
  quiet_start: number | null;
  quiet_end: number | null;
};
const DEFAULT_PREFS: Prefs = {
  push_enabled: true,
  cat_compromissos: true,
  cat_orcamento: true,
  cat_atrasados: true,
  cat_fatura: true,
  cat_saldo: true,
  cat_metas: true,
  cat_investimentos: true,
  cat_recorrencias: true,
  cat_resumos: true,
  quiet_start: null,
  quiet_end: null,
};

const ptCurrency = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

const toIso = (d: Date) => d.toISOString().slice(0, 10);
// Datas no fuso America/Sao_Paulo (BRT). Usar UTC fazia "hoje"/"amanhã" virarem
// cedo demais no fim do dia (após ~21h BRT já é o dia seguinte em UTC), gerando
// alertas de "hoje"/"atrasado" no dia errado (F49).
const BRT_TZ = "America/Sao_Paulo";
const brtParts = (base = new Date()) => {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: BRT_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
  const p = fmt.formatToParts(base);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24 };
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const { y, m, d } = brtParts();
  return `${y}-${pad2(m)}-${pad2(d)}`;
};
const tomorrow = () => {
  const { y, m, d } = brtParts();
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
};
const hourBrt = () => brtParts().h;
const weekdayBrt = () => {
  const { y, m, d } = brtParts();
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom..6=Sáb
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

// Silêncio: hora BRT dentro de [start, end). Janela pode cruzar meia-noite.
const inQuietHours = (prefs: Prefs, hour: number) => {
  const { quiet_start: s, quiet_end: e } = prefs;
  if (s === null || e === null || s === e) return false;
  return s < e ? hour >= s && hour < e : hour >= s || hour < e;
};

// Valor "a vencer" de uma dívida: a PARCELA (parceladas) ou o RESTANTE = total -
// pago (à vista). Antes somava-se sempre o total_with_interest cheio, ignorando
// parcela e amount_paid, superestimando os alertas frente a Agenda/Dashboard.
const debtDueAmount = (d: any) => {
  if (d.has_installments && Number(d.installment_amount ?? 0) > 0) return Number(d.installment_amount);
  return Math.max(0, Number(d.total_with_interest ?? d.original_amount ?? 0) - Number(d.amount_paid ?? 0));
};

// "Pagamento Fatura" (card_id null, descrição começa com "Pagamento Fatura") é
// transferência, não gasto — excluído dos resumos (mesma regra do app).
const isInvoicePayment = (tx: { card_id?: string | null; description?: string | null }) =>
  !tx.card_id && (tx.description ?? "").startsWith("Pagamento Fatura");

// ---- Ciclo de fatura (portado de src/lib/cardCycle.ts, fonte única) ----
const clampDay = (year: number, month: number, day: number) => {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
};
const getInvoiceCycleForMonth = (closingDay: number, dueDay: number, year: number, month: number) => {
  const dueDate = clampDay(year, month, dueDay);
  const closingOffset = dueDay >= closingDay ? 0 : -1;
  const closingDate = clampDay(year, month + closingOffset, closingDay);
  const prevClosing = clampDay(year, month + closingOffset - 1, closingDay);
  const cycleStart = new Date(prevClosing);
  const cycleEnd = new Date(closingDate);
  cycleEnd.setDate(cycleEnd.getDate() - 1);
  return { dueDate, cycleStart, cycleEnd };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Dispara web push pra cada notificação recém-inserida. Best-effort.
const dispatchPush = async (item: Notif) => {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push-notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        user_id: item.user_id,
        title: item.title,
        body: item.body,
        link: item.link_to,
        severity: item.severity,
      }),
    });
  } catch (err) {
    console.warn("[notify] push dispatch failed:", err);
  }
};

// Insere idempotente (ON CONFLICT DO NOTHING por (user_id,dedup_key)) e recupera
// SOMENTE as linhas realmente inseridas via RETURNING. Só dispara push se
// allowPush (push_enabled && fora do quiet hours). O in-app é sempre gravado.
const insertNotifications = async (sb: SupabaseClient, items: Notif[], allowPush: boolean) => {
  if (items.length === 0) return;
  const { data: inserted, error } = await sb
    .from("notifications")
    .upsert(items, { onConflict: "user_id,dedup_key", ignoreDuplicates: true })
    .select("user_id, title, body, link_to, severity");
  if (error) {
    console.error("[notify] insert failed:", error.message);
    return;
  }
  if (allowPush) {
    await Promise.all((inserted ?? []).map((row) => dispatchPush(row as Notif)));
  }
};

// ---- Snapshots de investimentos (não é notificação) ----
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

// ================= CHECKS (cada um retorna Notif[]) =================

// 1. Compromissos do dia
const checkDailyDue = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  const tdy = today();
  const [tx, sched, debts] = await Promise.all([
    sb.from("transactions").select("id, description, amount, type").eq("user_id", userId).eq("status", "pending").is("card_id", null).eq("date", tdy),
    sb.from("scheduled_payments").select("id, description, amount, type").eq("user_id", userId).eq("is_paid", false).eq("due_date", tdy),
    sb.from("debts").select("id, name, total_with_interest, original_amount, amount_paid, has_installments, installment_amount, direction").eq("user_id", userId).eq("status", "active").eq("due_date", tdy),
  ]);
  const total =
    (tx.data ?? []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0) +
    (sched.data ?? []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0) +
    (debts.data ?? []).reduce((s: number, t: any) => s + debtDueAmount(t), 0);
  const count = (tx.data?.length ?? 0) + (sched.data?.length ?? 0) + (debts.data?.length ?? 0);
  if (count === 0) return [];
  return [{
    user_id: userId, kind: "daily_due", severity: "info",
    title: `${count} compromisso${count === 1 ? "" : "s"} hoje`,
    body: `Total a movimentar: ${ptCurrency(total)}.`,
    link_to: "/schedule",
    dedup_key: `daily_due:${tdy}`,
  }];
};

// 2. Resumo da semana (segunda)
const checkWeeklySummary = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  if (weekdayBrt() !== 1) return [];
  const start = today();
  const end = new Date();
  end.setDate(end.getDate() + 7);
  const endIso = toIso(end);
  const [tx, sched, debts] = await Promise.all([
    sb.from("transactions").select("amount, type").eq("user_id", userId).eq("status", "pending").is("card_id", null).gte("date", start).lte("date", endIso),
    sb.from("scheduled_payments").select("amount, type").eq("user_id", userId).eq("is_paid", false).gte("due_date", start).lte("due_date", endIso),
    sb.from("debts").select("total_with_interest, original_amount, amount_paid, has_installments, installment_amount, direction").eq("user_id", userId).eq("status", "active").not("due_date", "is", null).gte("due_date", start).lte("due_date", endIso),
  ]);
  const total =
    (tx.data ?? []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0) +
    (sched.data ?? []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0) +
    (debts.data ?? []).reduce((s: number, t: any) => s + debtDueAmount(t), 0);
  const count = (tx.data?.length ?? 0) + (sched.data?.length ?? 0) + (debts.data?.length ?? 0);
  if (count === 0) return [];
  return [{
    user_id: userId, kind: "weekly_summary", severity: "info",
    title: `Sua semana financeira`,
    body: `${count} compromisso${count === 1 ? "" : "s"} pra próximos 7 dias — total ${ptCurrency(total)}.`,
    link_to: "/schedule",
    dedup_key: `weekly_summary:${isoWeek()}`,
  }];
};

// 3. Orçamento 80% e 100% (categorias avulsas + GRUPOS de orçamento)
const checkBudgets = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startIso = toIso(new Date(year, now.getMonth(), 1));
  const endIso = toIso(new Date(year, now.getMonth() + 1, 0));

  const [budgetsRes, txRes, catsRes, groupsRes, groupLimitsRes, groupCatsRes] = await Promise.all([
    sb.from("budgets").select("category_id, amount, year, month").eq("user_id", userId),
    sb.from("transactions").select("category_id, amount, card_id, description").eq("user_id", userId).eq("type", "expense").gte("date", startIso).lte("date", endIso),
    sb.from("categories").select("id, name").eq("user_id", userId),
    sb.from("budget_groups").select("id, name").eq("user_id", userId),
    sb.from("budget_group_limits").select("group_id, amount, year, month").eq("user_id", userId),
    sb.from("budget_group_categories").select("group_id, category_id, created_at").eq("user_id", userId),
  ]);

  const cap = year * 12 + month;

  // Regra "sticky" (mesma do app em src/lib/budgetSticky.ts): teto vigente = o
  // registro mais recente com (year*12+month) <= cap; amount<=0 encerra vigência.
  const stickyAmount = (rows: Array<{ amount: number; year: number; month: number }>): number | null => {
    let best: { amount: number; order: number } | null = null;
    for (const r of rows) {
      const order = r.year * 12 + r.month;
      if (order > cap) continue;
      if (!best || order > best.order) best = { amount: Number(r.amount || 0), order };
    }
    return best && best.amount > 0 ? best.amount : null;
  };

  const budgetByCat = new Map<string, any>();
  (budgetsRes.data ?? []).forEach((b: any) => {
    if (b.year * 12 + b.month > cap) return;
    const current = budgetByCat.get(b.category_id);
    const order = b.year * 12 + b.month;
    if (current === undefined || order > current.order) {
      budgetByCat.set(b.category_id, { amount: Number(b.amount || 0), order });
    }
  });
  const spentByCat = new Map<string, number>();
  (txRes.data ?? []).forEach((t: any) => {
    if (!t.category_id || isInvoicePayment(t)) return;
    spentByCat.set(t.category_id, (spentByCat.get(t.category_id) ?? 0) + Number(t.amount || 0));
  });
  const catName = new Map<string, string>((catsRes.data ?? []).map((c: any) => [c.id, c.name]));

  // ————— Grupos de orçamento (teto combinado) —————
  const groupName = new Map<string, string>((groupsRes.data ?? []).map((g: any) => [g.id, g.name]));
  const limitsByGroup = new Map<string, Array<{ amount: number; year: number; month: number }>>();
  (groupLimitsRes.data ?? []).forEach((l: any) => {
    const arr = limitsByGroup.get(l.group_id) ?? [];
    arr.push({ amount: Number(l.amount || 0), year: l.year, month: l.month });
    limitsByGroup.set(l.group_id, arr);
  });
  const groupActiveLimit = new Map<string, number>(); // só grupos com teto ativo (>0)
  (groupsRes.data ?? []).forEach((g: any) => {
    const amt = stickyAmount(limitsByGroup.get(g.id) ?? []);
    if (amt != null) groupActiveLimit.set(g.id, amt);
  });

  // Categorias cujo teto individual é SUPRIMIDO (notificam via grupo) + gasto do
  // grupo = soma dos membros a partir do mês de entrada. Grupo sem teto ativo não
  // suprime nada (o teto individual da categoria continua valendo/notificando).
  const suppressedCats = new Set<string>();
  const spentByGroup = new Map<string, number>();
  (groupCatsRes.data ?? []).forEach((m: any) => {
    if (!groupActiveLimit.has(m.group_id)) return;
    const d = new Date(m.created_at);
    const joinOrd = d.getFullYear() * 12 + (d.getMonth() + 1);
    if (cap < joinOrd) return;
    suppressedCats.add(m.category_id);
    spentByGroup.set(m.group_id, (spentByGroup.get(m.group_id) ?? 0) + (spentByCat.get(m.category_id) ?? 0));
  });

  const items: Notif[] = [];
  budgetByCat.forEach((value: any, catId: string) => {
    if (suppressedCats.has(catId)) return; // coberta pelo alerta do grupo
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

  // Alertas por GRUPO (teto combinado sobre as categorias membros).
  groupActiveLimit.forEach((limit: number, groupId: string) => {
    if (limit <= 0) return;
    const spent = spentByGroup.get(groupId) ?? 0;
    const pct = (spent / limit) * 100;
    const name = groupName.get(groupId) || "grupo";
    if (pct >= 100) {
      items.push({
        user_id: userId, kind: "budget_group_over", severity: "danger",
        title: `Grupo estourado — ${name}`,
        body: `O grupo gastou ${ptCurrency(spent)} de ${ptCurrency(limit)} (${pct.toFixed(0)}%).`,
        link_to: "/goals",
        dedup_key: `budget_group_over:${groupId}:${monthKey(now)}`,
      });
    } else if (pct >= 80) {
      items.push({
        user_id: userId, kind: "budget_group_warn", severity: "warning",
        title: `Grupo ${name} em ${pct.toFixed(0)}% do teto`,
        body: `${ptCurrency(spent)} de ${ptCurrency(limit)}.`,
        link_to: "/goals",
        dedup_key: `budget_group_warn:${groupId}:${monthKey(now)}`,
      });
    }
  });

  return items;
};

// 4. Transações atrasadas — AGRUPADAS (uma p/ despesas, uma p/ receitas)
const checkOverdueTx = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  const tdy = today();
  const { data } = await sb.from("transactions")
    .select("id, amount, type")
    .eq("user_id", userId).eq("status", "pending").is("card_id", null)
    .lt("date", tdy);
  const rows = data ?? [];
  const expenses = rows.filter((t: any) => t.type !== "income");
  const incomes = rows.filter((t: any) => t.type === "income");
  const items: Notif[] = [];
  if (expenses.length > 0) {
    const total = expenses.reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
    items.push({
      user_id: userId, kind: "tx_overdue", severity: "warning",
      title: `${expenses.length} despesa${expenses.length === 1 ? "" : "s"} atrasada${expenses.length === 1 ? "" : "s"}`,
      body: `Total ${ptCurrency(total)}. Toque para ver e regularizar.`,
      link_to: "/transactions",
      dedup_key: `tx_overdue:${tdy}`,
    });
  }
  if (incomes.length > 0) {
    const total = incomes.reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
    items.push({
      user_id: userId, kind: "income_overdue", severity: "info",
      title: `${incomes.length} receita${incomes.length === 1 ? "" : "s"} atrasada${incomes.length === 1 ? "" : "s"}`,
      body: `${ptCurrency(total)} a receber que já venceu.`,
      link_to: "/transactions",
      dedup_key: `income_overdue:${tdy}`,
    });
  }
  return items;
};

// 5. Dívidas atrasadas — AGRUPADAS (a pagar / a receber)
const checkOverdueDebts = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  const tdy = today();
  const { data } = await sb.from("debts")
    .select("id, name, total_with_interest, original_amount, amount_paid, has_installments, installment_amount, direction")
    .eq("user_id", userId).eq("status", "active").not("due_date", "is", null)
    .lt("due_date", tdy);
  const rows = data ?? [];
  const pay = rows.filter((d: any) => d.direction !== "they_owe");
  const recv = rows.filter((d: any) => d.direction === "they_owe");
  const items: Notif[] = [];
  if (pay.length > 0) {
    const total = pay.reduce((s: number, d: any) => s + debtDueAmount(d), 0);
    items.push({
      user_id: userId, kind: "debt_overdue", severity: "warning",
      title: `${pay.length} dívida${pay.length === 1 ? "" : "s"} a pagar atrasada${pay.length === 1 ? "" : "s"}`,
      body: `Total ${ptCurrency(total)}.`,
      link_to: "/debts",
      dedup_key: `debt_overdue:${tdy}`,
    });
  }
  if (recv.length > 0) {
    const total = recv.reduce((s: number, d: any) => s + debtDueAmount(d), 0);
    items.push({
      user_id: userId, kind: "debt_overdue", severity: "info",
      title: `${recv.length} valor${recv.length === 1 ? "" : "es"} a receber atrasado${recv.length === 1 ? "" : "s"}`,
      body: `Total ${ptCurrency(total)}.`,
      link_to: "/debts",
      dedup_key: `debt_receivable_overdue:${tdy}`,
    });
  }
  return items;
};

// 6/7. Cartão fecha amanhã / vence amanhã
const checkCardClosingDue = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  const { data: cards } = await sb.from("cards").select("id, name, closing_day, due_day").eq("user_id", userId);
  if (!cards) return [];
  const tIso = tomorrow();
  const [tY, tM, tDay] = tIso.split("-").map(Number);
  const lastDayTMonth = new Date(Date.UTC(tY, tM, 0)).getUTCDate();
  const items: Notif[] = [];
  for (const c of cards) {
    if (Math.min(Number(c.closing_day), lastDayTMonth) === tDay) {
      items.push({
        user_id: userId, kind: "card_closing", severity: "info",
        title: `Fatura de ${c.name} fecha amanhã`,
        body: `Compras feitas a partir de amanhã entram na próxima fatura.`,
        link_to: `/cards/${c.id}`, metadata: { card_id: c.id },
        dedup_key: `card_closing:${c.id}:${monthKey()}`,
      });
    }
    if (Math.min(Number(c.due_day), lastDayTMonth) === tDay) {
      items.push({
        user_id: userId, kind: "card_due", severity: "warning",
        title: `Fatura de ${c.name} vence amanhã`,
        body: `Não esqueça de pagar pra evitar juros.`,
        link_to: `/cards/${c.id}`, metadata: { card_id: c.id },
        dedup_key: `card_due:${c.id}:${monthKey()}`,
      });
    }
  }
  return items;
};

// 8. Saldo bancário negativo
const checkNegativeBalance = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  const { data } = await sb.from("accounts").select("id, name, balance").eq("user_id", userId).lt("balance", 0);
  const tdy = today();
  return (data ?? []).map((a: any) => ({
    user_id: userId, kind: "negative_balance", severity: "danger" as Severity,
    title: `Conta ${a.name} no negativo`,
    body: `Saldo atual: ${ptCurrency(Number(a.balance || 0))}.`,
    link_to: "/settings", metadata: { account_id: a.id },
    dedup_key: `negative_balance:${a.id}:${tdy}`,
  }));
};

// 9. Limite do cartão > 80%
const checkCardLimitHigh = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  const { data: cards } = await sb.from("cards").select("id, name, credit_limit").eq("user_id", userId);
  if (!cards) return [];
  const ids = cards.map((c: any) => c.id);
  if (ids.length === 0) return [];
  const { data: tx } = await sb.from("transactions").select("card_id, amount").eq("user_id", userId).eq("type", "expense").neq("status", "paid").in("card_id", ids);
  const usedByCard = new Map<string, number>();
  (tx ?? []).forEach((t: any) => usedByCard.set(t.card_id, (usedByCard.get(t.card_id) ?? 0) + Number(t.amount || 0)));
  const items: Notif[] = [];
  for (const c of cards) {
    const limit = Number(c.credit_limit || 0);
    const used = usedByCard.get(c.id) ?? 0;
    if (limit <= 0) continue;
    const pct = (used / limit) * 100;
    if (pct >= 80) {
      items.push({
        user_id: userId, kind: "card_limit_high", severity: pct >= 100 ? "danger" : "warning",
        title: `${c.name} em ${pct.toFixed(0)}% do limite`,
        body: `${ptCurrency(used)} de ${ptCurrency(limit)}.`,
        link_to: `/cards/${c.id}`, metadata: { card_id: c.id },
        dedup_key: `card_limit:${c.id}:${monthKey()}`,
      });
    }
  }
  return items;
};

// 10. Recorrência criada
const checkRecurrenceGenerated = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  const since = new Date();
  since.setDate(since.getDate() - 1);
  const { data } = await sb.from("transactions").select("id").eq("user_id", userId).not("recurrence_parent_id", "is", null).gte("created_at", since.toISOString());
  const count = data?.length ?? 0;
  if (count === 0) return [];
  return [{
    user_id: userId, kind: "recurrence_generated", severity: "info",
    title: `${count} recorrência${count === 1 ? "" : "s"} criada${count === 1 ? "" : "s"}`,
    body: `Confira em Transações.`,
    link_to: "/transactions",
    dedup_key: `recurrence_generated:${today()}`,
  }];
};

// 11. Marcos de meta (50/90/100)
const checkGoalMilestones = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  const { data } = await sb.from("goals").select("*").eq("user_id", userId);
  const items: Notif[] = [];
  for (const g of data ?? []) {
    const target = Number(g.target_amount || 0);
    const current = Number(g.current_amount || 0);
    if (target <= 0) continue;
    const pct = (current / target) * 100;
    if (pct >= 100) {
      items.push({ user_id: userId, kind: "goal_done", severity: "celebrate", title: `Meta atingida — ${g.name} 🎉`, body: `${ptCurrency(current)} / ${ptCurrency(target)}.`, link_to: "/goals", metadata: { goal_id: g.id }, dedup_key: `goal_done:${g.id}` });
    } else if (pct >= 90) {
      items.push({ user_id: userId, kind: "goal_90", severity: "info", title: `Quase lá — ${g.name}`, body: `${pct.toFixed(0)}% — falta ${ptCurrency(target - current)}.`, link_to: "/goals", metadata: { goal_id: g.id }, dedup_key: `goal_90:${g.id}` });
    } else if (pct >= 50) {
      items.push({ user_id: userId, kind: "goal_50", severity: "info", title: `Metade do caminho — ${g.name}`, body: `${pct.toFixed(0)}% concluído.`, link_to: "/goals", metadata: { goal_id: g.id }, dedup_key: `goal_50:${g.id}` });
    }
  }
  return items;
};

// 12. Investimento ±5% (vs ~7 dias atrás)
const checkInvestmentVariation = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  const { data: invs } = await sb.from("investments").select("id, name, current_value").eq("user_id", userId);
  if (!invs || invs.length === 0) return [];
  const items: Notif[] = [];
  for (const inv of invs) {
    const current = Number(inv.current_value || 0);
    const since = new Date();
    since.setDate(since.getDate() - 8);
    const { data: prevSnap } = await sb.from("investment_snapshots").select("value, snapshot_date").eq("investment_id", inv.id).lte("snapshot_date", toIso(since)).order("snapshot_date", { ascending: false }).limit(1);
    const previous = Number(prevSnap?.[0]?.value || 0);
    if (previous <= 0) continue;
    const variation = ((current - previous) / previous) * 100;
    if (variation >= 5) {
      items.push({ user_id: userId, kind: "invest_up", severity: "celebrate", title: `${inv.name} valorizou ${variation.toFixed(1)}%`, body: `De ${ptCurrency(previous)} para ${ptCurrency(current)}.`, link_to: "/investments", metadata: { investment_id: inv.id }, dedup_key: `invest_up:${inv.id}:${isoWeek()}` });
    } else if (variation <= -5) {
      items.push({ user_id: userId, kind: "invest_down", severity: "warning", title: `${inv.name} caiu ${Math.abs(variation).toFixed(1)}%`, body: `De ${ptCurrency(previous)} para ${ptCurrency(current)}.`, link_to: "/investments", metadata: { investment_id: inv.id }, dedup_key: `invest_down:${inv.id}:${isoWeek()}` });
    }
  }
  return items;
};

// 13. NOVO — Caixa projetado do mês negativo (mês no vermelho)
const checkMonthDeficit = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  const { y, m } = brtParts(); // m 1-based
  const tdy = today();
  const monthEndDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEndIso = `${y}-${pad2(m)}-${pad2(monthEndDay)}`;
  // Compras de cartão desde ~62 dias antes do início do mês (cobre a janela do
  // ciclo cuja fatura vence neste mês) até o fim do mês.
  const cardTxStartIso = toIso(new Date(Date.UTC(y, m - 1, 1) - 62 * 86400000));

  const [accRes, pendRes, cardsRes, cardTxRes, debtsRes] = await Promise.all([
    sb.from("accounts").select("balance").eq("user_id", userId),
    sb.from("transactions").select("amount, type").eq("user_id", userId).neq("status", "paid").is("card_id", null).in("type", ["income", "expense"]).gte("date", tdy).lte("date", monthEndIso),
    sb.from("cards").select("id, closing_day, due_day").eq("user_id", userId),
    sb.from("transactions").select("card_id, amount, date, status").eq("user_id", userId).eq("type", "expense").not("card_id", "is", null).neq("status", "paid").gte("date", cardTxStartIso).lte("date", monthEndIso),
    sb.from("debts").select("direction, due_date, total_with_interest, original_amount, amount_paid, has_installments, installment_amount, status").eq("user_id", userId).eq("status", "active").not("due_date", "is", null).gte("due_date", tdy).lte("due_date", monthEndIso),
  ]);

  const bank = (accRes.data ?? []).reduce((s: number, a: any) => s + Number(a.balance || 0), 0);
  let pendingIncome = 0, pendingExpense = 0;
  (pendRes.data ?? []).forEach((t: any) => {
    if (t.type === "income") pendingIncome += Number(t.amount || 0);
    else pendingExpense += Number(t.amount || 0);
  });

  // Faturas de cartão que vencem entre hoje e o fim do mês (não pagas).
  let cardInvoicesDue = 0;
  const cardTxs = cardTxRes.data ?? [];
  for (const card of cardsRes.data ?? []) {
    const closingDay = Number(card.closing_day || 0);
    const dueDay = Number(card.due_day || 0);
    if (!closingDay || !dueDay) continue;
    // vencimento no mês corrente
    const cycle = getInvoiceCycleForMonth(closingDay, dueDay, y, m - 1);
    const dueIso = toIso(cycle.dueDate);
    if (dueIso < tdy || dueIso > monthEndIso) continue;
    const startIso = toIso(cycle.cycleStart);
    const endIso = toIso(cycle.cycleEnd);
    cardInvoicesDue += cardTxs
      .filter((tx: any) => tx.card_id === card.id && tx.date >= startIso && tx.date <= endIso && tx.status !== "paid")
      .reduce((s: number, tx: any) => s + Number(tx.amount || 0), 0);
  }

  let debtOut = 0, debtIn = 0;
  (debtsRes.data ?? []).forEach((d: any) => {
    const amt = debtDueAmount(d);
    if (amt <= 0) return;
    if (d.direction === "they_owe") debtIn += amt;
    else debtOut += amt;
  });

  const projected = bank + pendingIncome - pendingExpense - cardInvoicesDue - debtOut + debtIn;
  if (projected >= -0.005) return [];
  return [{
    user_id: userId, kind: "month_deficit", severity: "danger",
    title: `Mês no vermelho`,
    body: `Seu caixa projetado pro fim do mês está em ${ptCurrency(projected)}. Segure novos gastos e aportes até equilibrar.`,
    link_to: "/dashboard",
    dedup_key: `month_deficit:${monthKey()}`,
  }];
};

// 14. NOVO — Fechamento do mês (dia 1, resumo do mês anterior)
const checkMonthlyClose = async (sb: SupabaseClient, userId: string): Promise<Notif[]> => {
  if (brtParts().d !== 1) return [];
  const { y, m } = brtParts(); // mês atual; queremos o anterior
  const prevMonthIdx = m - 2; // 0-based do mês anterior relativo a Jan
  const py = y + Math.floor(prevMonthIdx / 12);
  const pmZero = ((prevMonthIdx % 12) + 12) % 12; // 0..11
  const startIso = `${py}-${pad2(pmZero + 1)}-01`;
  const endDay = new Date(Date.UTC(py, pmZero + 1, 0)).getUTCDate();
  const endIso = `${py}-${pad2(pmZero + 1)}-${pad2(endDay)}`;
  const prevKey = `${py}-${pad2(pmZero + 1)}`;

  const { data } = await sb.from("transactions")
    .select("amount, type, card_id, description, category_id")
    .eq("user_id", userId).gte("date", startIso).lte("date", endIso);
  const rows = data ?? [];
  let income = 0, expense = 0;
  const byCat = new Map<string, number>();
  rows.forEach((t: any) => {
    const amt = Number(t.amount || 0);
    if (t.type === "income") { income += amt; return; }
    if (t.type !== "expense" || isInvoicePayment(t)) return;
    expense += amt;
    const k = t.category_id || "sem";
    byCat.set(k, (byCat.get(k) ?? 0) + amt);
  });
  if (income === 0 && expense === 0) return [];

  let topName = "";
  let topVal = 0;
  let topId = "";
  byCat.forEach((v, k) => { if (v > topVal) { topVal = v; topId = k; } });
  if (topId && topId !== "sem") {
    const { data: cat } = await sb.from("categories").select("name").eq("id", topId).maybeSingle();
    topName = (cat as any)?.name ?? "";
  }
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(py, pmZero, 1)));
  const net = income - expense;
  const topPart = topName ? ` Maior gasto: ${topName} (${ptCurrency(topVal)}).` : "";
  return [{
    user_id: userId, kind: "monthly_close", severity: "info",
    title: `Fechamento de ${monthLabel}`,
    body: `Gastou ${ptCurrency(expense)}, recebeu ${ptCurrency(income)}, saldo ${ptCurrency(net)}.${topPart}`,
    link_to: "/reports",
    dedup_key: `monthly_close:${prevKey}`,
  }];
};

// ================= ORQUESTRADOR =================
Deno.serve(async (_req: Request) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  const { data: profiles } = await sb.from("profiles").select("id");
  if (!profiles) {
    return new Response(JSON.stringify({ ok: false, error: "no profiles" }), { status: 500 });
  }

  // Preferências de todos de uma vez (ausência = defaults).
  const prefsMap = new Map<string, Prefs>();
  const { data: prefRows } = await sb.from("notification_preferences").select("*");
  (prefRows ?? []).forEach((p: any) => prefsMap.set(String(p.user_id), { ...DEFAULT_PREFS, ...p }));

  const hour = hourBrt();
  let processed = 0;
  for (const p of profiles) {
    const uid = String((p as any).id);
    const prefs = prefsMap.get(uid) ?? DEFAULT_PREFS;
    const allowPush = prefs.push_enabled && !inQuietHours(prefs, hour);
    try {
      await snapshotInvestments(sb, uid);
      const groups = await Promise.all([
        prefs.cat_compromissos ? checkDailyDue(sb, uid) : [],
        prefs.cat_resumos ? checkWeeklySummary(sb, uid) : [],
        prefs.cat_orcamento ? checkBudgets(sb, uid) : [],
        prefs.cat_atrasados ? checkOverdueTx(sb, uid) : [],
        prefs.cat_atrasados ? checkOverdueDebts(sb, uid) : [],
        prefs.cat_fatura ? checkCardClosingDue(sb, uid) : [],
        prefs.cat_saldo ? checkNegativeBalance(sb, uid) : [],
        prefs.cat_fatura ? checkCardLimitHigh(sb, uid) : [],
        prefs.cat_recorrencias ? checkRecurrenceGenerated(sb, uid) : [],
        prefs.cat_metas ? checkGoalMilestones(sb, uid) : [],
        prefs.cat_investimentos ? checkInvestmentVariation(sb, uid) : [],
        prefs.cat_saldo ? checkMonthDeficit(sb, uid) : [],
        prefs.cat_resumos ? checkMonthlyClose(sb, uid) : [],
      ]);
      await insertNotifications(sb, groups.flat(), allowPush);
      processed += 1;
    } catch (err) {
      console.error(`[notify] user ${uid} failed:`, err);
    }
  }

  return new Response(JSON.stringify({ ok: true, processed }), {
    headers: { "Content-Type": "application/json" },
  });
});

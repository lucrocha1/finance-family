import { supabase } from "@/integrations/supabase/client";
import { ensureFamily } from "@/lib/familyGuard";

export type PlannedKind = "investment" | "expense" | "income";
export type PlannedPriority = "low" | "medium" | "high";

export type PlannedItemRow = {
  id: string;
  user_id: string;
  family_id: string | null;
  kind: PlannedKind;
  description: string;
  amount: number;
  category_id: string | null;
  account_id: string | null;
  notes: string | null;
  target_date: string | null;
  priority: PlannedPriority;
  created_at: string;
};

export const priorityLabel: Record<PlannedPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};

// Convert a planned expense/income into a real pending transaction.
// Returns the new transaction id on success.
export const schedulePlannedTransaction = async (
  item: PlannedItemRow,
  date: string,
  options: { familyId: string | null | undefined; userId: string | null | undefined; accountIdOverride?: string | null },
): Promise<{ ok: true; transactionId: string } | { ok: false; message: string }> => {
  if (item.kind === "investment") {
    return { ok: false, message: "Use schedulePlannedInvestment para itens de investimento" };
  }
  const ctx = ensureFamily(options.familyId, options.userId);
  if (!ctx) return { ok: false, message: "Família não carregada" };

  const accountId = options.accountIdOverride ?? item.account_id ?? null;

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      family_id: ctx.familyId,
      user_id: ctx.userId,
      type: item.kind,
      description: item.description,
      amount: item.amount,
      date,
      status: "pending",
      category_id: item.category_id,
      account_id: accountId,
      notes: item.notes,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, message: error?.message ?? "Falha ao criar transação" };

  const del = await supabase.from("planned_items").delete().eq("id", item.id);
  if (del.error) return { ok: false, message: del.error.message };

  void supabase.from("notifications").insert({
    user_id: ctx.userId,
    family_id: ctx.familyId,
    kind: "planned_scheduled",
    severity: "celebrate",
    title: `Planejado virou pendente — ${item.description}`,
    body: `${item.kind === "income" ? "Receita" : "Despesa"} agendada para ${new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR")}.`,
    link_to: "/transactions",
    metadata: { transaction_id: String(data.id), planned_item_id: item.id },
    dedup_key: `planned_scheduled:${item.id}`,
  });

  return { ok: true, transactionId: String(data.id) };
};

// Convert a planned investment into a real investment row.
export const schedulePlannedInvestment = async (
  item: PlannedItemRow,
  date: string,
  options: { familyId: string | null | undefined; userId: string | null | undefined },
): Promise<{ ok: true; investmentId: string } | { ok: false; message: string }> => {
  if (item.kind !== "investment") {
    return { ok: false, message: "Use schedulePlannedTransaction para itens de transação" };
  }
  const ctx = ensureFamily(options.familyId, options.userId);
  if (!ctx) return { ok: false, message: "Família não carregada" };

  const { data, error } = await supabase
    .from("investments")
    .insert({
      family_id: ctx.familyId,
      user_id: ctx.userId,
      name: item.description,
      type: "fund",
      amount_invested: item.amount,
      current_value: item.amount,
      target_date: date,
      notes: item.notes,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, message: error?.message ?? "Falha ao criar investimento" };

  const del = await supabase.from("planned_items").delete().eq("id", item.id);
  if (del.error) return { ok: false, message: del.error.message };

  void supabase.from("notifications").insert({
    user_id: ctx.userId,
    family_id: ctx.familyId,
    kind: "planned_scheduled",
    severity: "celebrate",
    title: `Investimento agendado — ${item.description}`,
    body: `Aporte de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.amount)} para ${new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR")}.`,
    link_to: "/investments",
    metadata: { investment_id: String(data.id), planned_item_id: item.id },
    dedup_key: `planned_scheduled:${item.id}`,
  });

  return { ok: true, investmentId: String(data.id) };
};

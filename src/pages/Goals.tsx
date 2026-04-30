import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Pencil,
  Plus,
  Target,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Tab = "budget" | "goals";
type GoalStatus = "active" | "paused" | "completed";

type CategoryRow = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  type: string | null;
};

type BudgetRow = {
  id: string;
  category_id: string;
  amount: number;
  month: number;
  year: number;
  user_id: string;
  family_id: string;
};

type GoalRow = {
  id: string;
  user_id: string;
  family_id: string;
  name: string;
  emoji: string;
  color: string | null;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  description: string | null;
  status: GoalStatus;
  created_at: string;
};

type GoalContributionRow = {
  id: string;
  goal_id: string;
  user_id: string;
  family_id: string;
  amount: number;
  date: string;
  notes: string | null;
};

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const GOAL_EMOJIS = ["🎯", "🏠", "🚗", "✈️", "💰", "📚", "💻", "🎓", "💍", "🏖️", "🎮", "📱"];
const GOAL_COLORS = [
  "hsl(var(--accent))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--destructive))",
  "hsl(256 85% 64%)",
  "hsl(198 93% 58%)",
  "hsl(330 81% 60%)",
  "hsl(35 92% 58%)",
];

const toIsoDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const moneyDigitsToValue = (digits: string) => Number(digits || "0") / 100;
const moneyValueToDigits = (value: number) => String(Math.round(value * 100));
const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
const daysUntil = (iso: string | null) => {
  if (!iso) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(`${iso}T00:00:00`);
  return Math.floor((target.getTime() - now.getTime()) / 86400000);
};

const GoalsPage = () => {
  const { family } = useFamily();
  const { user } = useAuth();

  const [tab, setTab] = useState<Tab>("budget");
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [monthExpenses, setMonthExpenses] = useState<Map<string, number>>(new Map());
  const [monthExpenseTotal, setMonthExpenseTotal] = useState(0);

  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [contributions, setContributions] = useState<GoalContributionRow[]>([]);

  const [editingBudgetCategoryId, setEditingBudgetCategoryId] = useState<string | null>(null);
  const [budgetAmountDigits, setBudgetAmountDigits] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);

  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalRow | null>(null);
  const [goalName, setGoalName] = useState("");
  const [goalEmoji, setGoalEmoji] = useState("🎯");
  const [goalColor, setGoalColor] = useState(GOAL_COLORS[0]);
  const [goalTargetDigits, setGoalTargetDigits] = useState("");
  const [goalCurrentDigits, setGoalCurrentDigits] = useState("");
  const [goalDeadline, setGoalDeadline] = useState<Date | undefined>(undefined);
  const [goalDescription, setGoalDescription] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);

  const [deleteGoalId, setDeleteGoalId] = useState<string | null>(null);

  const [contributionModalOpen, setContributionModalOpen] = useState(false);
  const [contributionGoal, setContributionGoal] = useState<GoalRow | null>(null);
  const [contributionDigits, setContributionDigits] = useState("");
  const [contributionDate, setContributionDate] = useState<Date | undefined>(new Date());
  const [contributionNotes, setContributionNotes] = useState("");
  const [contributionSaving, setContributionSaving] = useState(false);

  const [expandedGoals, setExpandedGoals] = useState<string[]>([]);

  const month = selectedMonth.getMonth() + 1;
  const year = selectedMonth.getFullYear();
  const from = toIsoDate(startOfMonth(selectedMonth));
  const to = toIsoDate(endOfMonth(selectedMonth));

  const loadData = useCallback(async () => {
    if (!family?.id) {
      setLoading(false);
      setCategories([]);
      setBudgets([]);
      setGoals([]);
      setContributions([]);
      setMonthExpenses(new Map());
      setMonthExpenseTotal(0);
      return;
    }

    setLoading(true);

    // RLS already enforces user_id = auth.uid() on every financial table,
    // so .eq("family_id", family.id) is redundant — and actively hides
    // rows whose family_id drifted from the current FamilyContext.
    const [categoriesRes, budgetsRes, txRes, goalsRes, contribRes] = await Promise.all([
      supabase.from("categories").select("id, name, color, icon, type").or("type.eq.expense,type.is.null").order("name", { ascending: true }),
      supabase.from("budgets").select("id, category_id, amount, month, year, user_id, family_id").eq("month", month).eq("year", year),
      supabase.from("transactions").select("category_id, amount, type, date").eq("type", "expense").gte("date", from).lte("date", to),
      supabase.from("goals").select("*").order("created_at", { ascending: false }),
      supabase.from("goal_contributions").select("*").order("date", { ascending: false }),
    ]);

    // Goals/contrib errors são tolerados — a aba Orçamento não depende deles.
    if (goalsRes.error) console.warn("[Goals] goals query failed:", goalsRes.error);
    if (contribRes.error) console.warn("[Goals] goal_contributions query failed:", contribRes.error);

    if (categoriesRes.error || budgetsRes.error || txRes.error) {
      toast.error("Erro ao carregar Metas & Orçamento");
      setLoading(false);
      return;
    }

    const nextCategories = ((categoriesRes.data as CategoryRow[] | null) ?? []).map((c) => ({
      ...c,
      color: c.color || "hsl(var(--accent))",
    }));

    const nextBudgets = ((budgetsRes.data as BudgetRow[] | null) ?? []).map((b) => ({
      ...b,
      amount: Number(b.amount ?? 0),
    }));

    const nextGoals = ((goalsRes.data as GoalRow[] | null) ?? []).map((g) => ({
      ...g,
      target_amount: Number(g.target_amount ?? 0),
      current_amount: Number(g.current_amount ?? 0),
      emoji: g.emoji || "🎯",
      color: g.color || GOAL_COLORS[0],
      status: ((g.status as GoalStatus | null) ?? "active") as GoalStatus,
    }));

    const nextContrib = ((contribRes.data as GoalContributionRow[] | null) ?? []).map((c) => ({
      ...c,
      amount: Number(c.amount ?? 0),
    }));

    const expenseMap = new Map<string, number>();
    let totalExpenses = 0;

    ((txRes.data as Array<{ category_id: string | null; amount: number }> | null) ?? []).forEach((tx) => {
      const value = Number(tx.amount || 0);
      totalExpenses += value;
      const key = tx.category_id || "uncategorized";
      expenseMap.set(key, (expenseMap.get(key) ?? 0) + value);
    });

    setCategories(nextCategories);
    setBudgets(nextBudgets);
    setGoals(nextGoals);
    setContributions(nextContrib);
    setMonthExpenses(expenseMap);
    setMonthExpenseTotal(totalExpenses);
    setLoading(false);
  }, [family?.id, from, month, to, year]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const monthLabel = selectedMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^(.)/, (m) => m.toUpperCase());

  const budgetByCategory = useMemo(() => {
    const map = new Map<string, BudgetRow>();
    budgets.forEach((b) => map.set(b.category_id, b));
    return map;
  }, [budgets]);

  const budgetCards = useMemo(() => {
    const rows = categories.map((category) => {
      const spent = monthExpenses.get(category.id) ?? 0;
      const budget = budgetByCategory.get(category.id);
      const limit = budget ? Number(budget.amount || 0) : null;
      const percent = limit && limit > 0 ? (spent / limit) * 100 : 0;
      const overAmount = limit ? Math.max(spent - limit, 0) : 0;
      return { category, spent, budget, limit, percent, overAmount };
    });

    return rows.sort((a, b) => {
      if (a.budget && !b.budget) return -1;
      if (!a.budget && b.budget) return 1;
      if (a.budget && b.budget) return b.percent - a.percent;
      return a.category.name.localeCompare(b.category.name, "pt-BR");
    });
  }, [budgetByCategory, categories, monthExpenses]);

  const budgetSummary = useMemo(() => {
    const totalBudget = budgets.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const available = totalBudget - monthExpenseTotal;
    return { totalBudget, totalSpent: monthExpenseTotal, available };
  }, [budgets, monthExpenseTotal]);

  const budgetChartData = useMemo(() => {
    return budgetCards
      .filter((row) => row.budget && row.limit && row.limit > 0)
      .map((row) => ({
        id: row.category.id,
        category: row.category.name,
        budget: row.limit ?? 0,
        spent: row.spent,
        spentFill: row.spent > (row.limit ?? 0) ? "hsl(var(--destructive))" : row.category.color || "hsl(var(--accent))",
      }));
  }, [budgetCards]);

  const goalsSummary = useMemo(() => {
    const active = goals.filter((goal) => goal.status !== "completed");
    const totalCurrent = active.reduce((sum, goal) => sum + goal.current_amount, 0);
    const totalRemaining = active.reduce((sum, goal) => sum + Math.max(goal.target_amount - goal.current_amount, 0), 0);
    return { totalCurrent, totalRemaining };
  }, [goals]);

  const contributionsByGoal = useMemo(() => {
    const map = new Map<string, GoalContributionRow[]>();
    contributions.forEach((item) => {
      const list = map.get(item.goal_id) ?? [];
      list.push(item);
      map.set(item.goal_id, list);
    });
    map.forEach((list) => list.sort((a, b) => b.date.localeCompare(a.date)));
    return map;
  }, [contributions]);

  const openBudgetEditor = (categoryId: string, currentLimit: number | null) => {
    setEditingBudgetCategoryId(categoryId);
    setBudgetAmountDigits(currentLimit && currentLimit > 0 ? moneyValueToDigits(currentLimit) : "");
  };

  const cancelBudgetEditor = () => {
    setEditingBudgetCategoryId(null);
    setBudgetAmountDigits("");
  };

  const saveBudget = async (categoryId: string) => {
    if (!family?.id || !user?.id) return;
    const amount = moneyDigitsToValue(budgetAmountDigits);

    if (amount <= 0) {
      toast.error("Informe um valor maior que zero");
      return;
    }

    setSavingBudget(true);
    const existing = budgetByCategory.get(categoryId);

    const payload = {
      family_id: family.id,
      user_id: user.id,
      category_id: categoryId,
      amount,
      month,
      year,
    };

    const { error } = existing
      ? await supabase.from("budgets").update({ amount }).eq("id", existing.id)
      : await supabase.from("budgets").insert(payload);

    setSavingBudget(false);

    if (error) {
      toast.error("Não foi possível salvar o limite");
      return;
    }

    toast.success(existing ? "Limite atualizado" : "Limite criado");
    cancelBudgetEditor();
    void loadData();
  };

  const removeBudget = async (budgetId: string) => {
    const { error } = await supabase.from("budgets").delete().eq("id", budgetId);
    if (error) {
      toast.error("Não foi possível remover o limite");
      return;
    }
    toast.success("Limite removido");
    cancelBudgetEditor();
    void loadData();
  };

  const openCreateGoal = () => {
    setEditingGoal(null);
    setGoalName("");
    setGoalEmoji("🎯");
    setGoalColor(GOAL_COLORS[0]);
    setGoalTargetDigits("");
    setGoalCurrentDigits("0");
    setGoalDeadline(undefined);
    setGoalDescription("");
    setGoalModalOpen(true);
  };

  const openEditGoal = (goal: GoalRow) => {
    setEditingGoal(goal);
    setGoalName(goal.name);
    setGoalEmoji(goal.emoji || "🎯");
    setGoalColor(goal.color || GOAL_COLORS[0]);
    setGoalTargetDigits(moneyValueToDigits(goal.target_amount));
    setGoalCurrentDigits(moneyValueToDigits(goal.current_amount));
    setGoalDeadline(goal.target_date ? new Date(`${goal.target_date}T00:00:00`) : undefined);
    setGoalDescription(goal.description ?? "");
    setGoalModalOpen(true);
  };

  const saveGoal = async () => {
    if (!family?.id || !user?.id) return;

    const target = moneyDigitsToValue(goalTargetDigits);
    const current = moneyDigitsToValue(goalCurrentDigits);

    if (goalName.trim().length < 2) {
      toast.error("Nome da meta é obrigatório");
      return;
    }

    if (target <= 0) {
      toast.error("Valor alvo deve ser maior que zero");
      return;
    }

    if (current < 0) {
      toast.error("Valor atual inválido");
      return;
    }

    setGoalSaving(true);

    const nextStatus: GoalStatus = current >= target ? "completed" : editingGoal?.status === "paused" ? "paused" : "active";

    const payload = {
      name: goalName.trim(),
      emoji: goalEmoji,
      color: goalColor,
      target_amount: target,
      current_amount: current,
      target_date: goalDeadline ? toIsoDate(goalDeadline) : null,
      description: goalDescription.trim() || null,
      status: nextStatus,
      family_id: family.id,
      user_id: user.id,
    };

    const { error } = editingGoal
      ? await supabase.from("goals").update(payload).eq("id", editingGoal.id)
      : await supabase.from("goals").insert(payload);

    setGoalSaving(false);

    if (error) {
      toast.error("Não foi possível salvar a meta");
      return;
    }

    toast.success(editingGoal ? "Meta atualizada" : "Meta criada");
    setGoalModalOpen(false);
    void loadData();
  };

  const toggleGoalPause = async () => {
    if (!editingGoal) return;
    const nextStatus: GoalStatus = editingGoal.status === "paused" ? "active" : "paused";
    const { error } = await supabase.from("goals").update({ status: nextStatus }).eq("id", editingGoal.id);
    if (error) {
      toast.error("Não foi possível atualizar o status");
      return;
    }
    toast.success(nextStatus === "paused" ? "Meta pausada" : "Meta reativada");
    setGoalModalOpen(false);
    void loadData();
  };

  const confirmDeleteGoal = async () => {
    if (!deleteGoalId) return;
    const { error } = await supabase.from("goals").delete().eq("id", deleteGoalId);
    if (error) {
      toast.error("Não foi possível excluir a meta");
      return;
    }
    toast.success("Meta excluída");
    setDeleteGoalId(null);
    setGoalModalOpen(false);
    void loadData();
  };

  const openContributionModal = (goal: GoalRow) => {
    setContributionGoal(goal);
    setContributionDigits("");
    setContributionDate(new Date());
    setContributionNotes("");
    setContributionModalOpen(true);
  };

  const saveContribution = async () => {
    if (!family?.id || !user?.id || !contributionGoal || !contributionDate) return;
    const amount = moneyDigitsToValue(contributionDigits);

    if (amount <= 0) {
      toast.error("Valor do aporte deve ser maior que zero");
      return;
    }

    setContributionSaving(true);

    const insertPayload = {
      goal_id: contributionGoal.id,
      family_id: family.id,
      user_id: user.id,
      amount,
      date: toIsoDate(contributionDate),
      notes: contributionNotes.trim() || null,
    };

    const { error: insertError } = await supabase.from("goal_contributions").insert(insertPayload);

    if (insertError) {
      setContributionSaving(false);
      toast.error("Não foi possível registrar o aporte");
      return;
    }

    const nextCurrent = contributionGoal.current_amount + amount;
    const reached = nextCurrent >= contributionGoal.target_amount;
    const nextStatus: GoalStatus = reached ? "completed" : contributionGoal.status;

    const { error: updateError } = await supabase
      .from("goals")
      .update({ current_amount: nextCurrent, status: nextStatus })
      .eq("id", contributionGoal.id);

    setContributionSaving(false);

    if (updateError) {
      toast.error("Aporte salvo, mas não foi possível atualizar o progresso");
      return;
    }

    toast.success(reached ? "🎉 Meta alcançada!" : "Aporte registrado");
    setContributionModalOpen(false);
    void loadData();
  };

  const deleteContribution = async (contribution: GoalContributionRow) => {
    const goal = goals.find((g) => g.id === contribution.goal_id);
    if (!goal) return;

    const { error: deleteError } = await supabase.from("goal_contributions").delete().eq("id", contribution.id);
    if (deleteError) {
      toast.error("Não foi possível excluir o aporte");
      return;
    }

    const nextCurrent = Math.max(goal.current_amount - contribution.amount, 0);
    const nextStatus: GoalStatus = nextCurrent >= goal.target_amount ? "completed" : goal.status === "paused" ? "paused" : "active";

    const { error: updateError } = await supabase
      .from("goals")
      .update({ current_amount: nextCurrent, status: nextStatus })
      .eq("id", goal.id);

    if (updateError) {
      toast.error("Aporte removido, mas o saldo da meta não foi atualizado");
      return;
    }

    toast.success("Aporte removido");
    void loadData();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Metas & Orçamento</h1>
          <p className="text-sm text-muted-foreground">Planeje limites por categoria e acompanhe objetivos financeiros com aportes.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary p-1">
          <button
            type="button"
            className={cn(
              "rounded-lg px-6 py-2 text-sm font-semibold",
              tab === "budget" ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab("budget")}
          >
            Orçamento
          </button>
          <button
            type="button"
            className={cn(
              "rounded-lg px-6 py-2 text-sm font-semibold",
              tab === "goals" ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab("goals")}
          >
            Metas
          </button>
        </div>
      </header>

      {tab === "budget" ? (
        <div className="space-y-6">
          <div className="mx-auto flex w-full max-w-sm items-center justify-between rounded-xl border border-border bg-card px-2 py-2">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="min-w-[190px] text-center text-base font-bold text-foreground">{monthLabel}</p>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-muted-foreground">Orçamento Total</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-2xl font-bold text-foreground">{ptCurrency.format(budgetSummary.totalBudget)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-muted-foreground">Gasto Real</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-2xl font-bold text-foreground">{ptCurrency.format(budgetSummary.totalSpent)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-muted-foreground">Disponível</CardTitle>
              </CardHeader>
              <CardContent className={cn("pt-0 text-2xl font-bold", budgetSummary.available >= 0 ? "text-success" : "text-destructive")}>
                {ptCurrency.format(budgetSummary.available)}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            {loading ? (
              <SectionEmpty text="Carregando orçamento..." />
            ) : budgetCards.length === 0 ? (
              <SectionEmpty text="Sem categorias de despesa para orçar" />
            ) : (
              budgetCards.map((row) => {
                const isEditing = editingBudgetCategoryId === row.category.id;
                const usage = row.limit && row.limit > 0 ? clampPercent(row.percent) : 0;
                const usageColor = row.percent < 70 ? "bg-success" : row.percent < 90 ? "bg-warning" : "bg-destructive";

                return (
                  <Card key={row.category.id} className="rounded-xl border-border bg-card">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: row.category.color || "hsl(var(--accent))" }} />
                          <span className="text-base">{row.category.icon || "🏷️"}</span>
                          <p className="font-semibold text-foreground">{row.category.name}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          {row.budget ? (
                            <>
                              <Button variant="outline" size="sm" onClick={() => openBudgetEditor(row.category.id, row.limit)}>
                                <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                              </Button>
                              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => removeBudget(row.budget!.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => openBudgetEditor(row.category.id, null)}>
                              Definir limite
                            </Button>
                          )}
                        </div>
                      </div>

                      {row.budget && row.limit ? (
                        <>
                          <div className="h-3 w-full rounded-full bg-secondary">
                            <div className={cn("h-3 rounded-full", usageColor)} style={{ width: `${Math.min(usage, 100)}%` }} />
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="text-muted-foreground">
                              {ptCurrency.format(row.spent)} de {ptCurrency.format(row.limit)}
                            </span>
                            <span className="font-semibold text-foreground">{row.percent.toFixed(1)}% usado</span>
                          </div>
                          {row.overAmount > 0 ? (
                            <div className="inline-flex rounded-full bg-destructive/15 px-3 py-1 text-xs font-semibold text-destructive">
                              Estourou! +{ptCurrency.format(row.overAmount)}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="space-y-1 text-sm">
                          <p className="text-muted-foreground">Sem limite definido</p>
                          <p className="font-semibold text-foreground">Gasto real: {ptCurrency.format(row.spent)}</p>
                        </div>
                      )}

                      {isEditing ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 p-3">
                          <Input
                            value={ptCurrency.format(moneyDigitsToValue(budgetAmountDigits))}
                            onChange={(event) => setBudgetAmountDigits(event.target.value.replace(/\D/g, ""))}
                            className="max-w-[220px]"
                            placeholder="R$ 0,00"
                          />
                          <Button size="icon" disabled={savingBudget} onClick={() => void saveBudget(row.category.id)}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={cancelBudgetEditor}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          <Card className="rounded-xl border-border bg-card">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-foreground">Orçado vs Gasto Real</CardTitle>
            </CardHeader>
            <CardContent>
              {budgetChartData.length === 0 ? (
                <SectionEmpty text="Sem dados no período selecionado" />
              ) : (
                <div className="h-[320px] w-full">
                  <ResponsiveContainer>
                    <BarChart data={budgetChartData}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <XAxis dataKey="category" stroke="hsl(var(--muted-foreground))" />
                      <YAxis stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => ptCurrency.format(v)} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "0.75rem",
                          color: "hsl(var(--foreground))",
                        }}
                        formatter={(value: number, key: string) => [ptCurrency.format(value), key === "budget" ? "Orçamento" : "Gasto"]}
                      />
                      <Bar dataKey="budget" fill="hsl(var(--muted-foreground))" fillOpacity={0.35} radius={[6, 6, 0, 0]} />
                      <Bar dataKey="spent" radius={[6, 6, 0, 0]}>
                        {budgetChartData.map((entry) => (
                          <Cell key={entry.id} fill={entry.spentFill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground">Total em Metas</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-2xl font-bold text-foreground">{ptCurrency.format(goalsSummary.totalCurrent)}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground">Falta Juntar</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-2xl font-bold text-foreground">{ptCurrency.format(goalsSummary.totalRemaining)}</CardContent>
              </Card>
            </div>

            <Button onClick={openCreateGoal}>
              <Plus className="mr-2 h-4 w-4" /> Nova Meta
            </Button>
          </div>

          {loading ? (
            <SectionEmpty text="Carregando metas..." />
          ) : goals.length === 0 ? (
            <SectionEmpty text="Nenhuma meta cadastrada" />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {goals.map((goal) => {
                const progress = goal.target_amount > 0 ? clampPercent((goal.current_amount / goal.target_amount) * 100) : 0;
                const remaining = Math.max(goal.target_amount - goal.current_amount, 0);
                const daysLeft = daysUntil(goal.target_date);
                const warnDeadline = daysLeft !== null && daysLeft >= 0 && daysLeft < 30 && progress < 80;
                const monthsLeft = daysLeft !== null ? Math.max(1, Math.ceil(daysLeft / 30)) : null;
                const perMonth = monthsLeft ? remaining / monthsLeft : null;
                const expanded = expandedGoals.includes(goal.id);
                const goalContributions = contributionsByGoal.get(goal.id) ?? [];

                return (
                  <Card key={goal.id} className="rounded-xl border-border bg-card transition-all hover:border-accent/70">
                    <CardContent className="space-y-4 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">{goal.emoji || "🎯"}</span>
                          <div>
                            <h3 className="text-lg font-bold text-foreground">{goal.name}</h3>
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                                goal.status === "completed"
                                  ? "bg-success/20 text-success"
                                  : goal.status === "paused"
                                    ? "bg-muted text-muted-foreground"
                                    : "bg-accent/20 text-accent",
                              )}
                            >
                              {goal.status === "completed" ? "Alcançada! 🎉" : goal.status === "paused" ? "Pausada" : "Ativa"}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => openContributionModal(goal)}>
                            Fazer aporte
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openEditGoal(goal)}>
                            Editar
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="h-4 w-full rounded-full bg-secondary">
                          <div
                            className={cn("h-4 rounded-full", progress >= 100 ? "bg-success" : "bg-accent")}
                            style={{ width: `${progress}%`, backgroundColor: progress >= 100 ? "hsl(var(--success))" : goal.color || "hsl(var(--accent))" }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            {ptCurrency.format(goal.current_amount)} de {ptCurrency.format(goal.target_amount)}
                          </span>
                          <span className="font-semibold text-foreground">{progress.toFixed(1)}%</span>
                        </div>
                      </div>

                      <div className="space-y-1 text-sm">
                        <p className="text-muted-foreground">Prazo: {goal.target_date ? new Date(`${goal.target_date}T00:00:00`).toLocaleDateString("pt-BR") : "Não definido"}</p>
                        {warnDeadline ? <p className="font-medium text-warning">⚠️ Prazo próximo</p> : null}
                        {perMonth !== null && remaining > 0 ? <p className="text-muted-foreground">Precisa de {ptCurrency.format(perMonth)}/mês para alcançar no prazo</p> : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setExpandedGoals((prev) => (prev.includes(goal.id) ? prev.filter((id) => id !== goal.id) : [...prev, goal.id]))}>
                          {expanded ? "Ocultar aportes" : "Ver aportes"}
                        </Button>
                      </div>

                      {expanded ? (
                        <div className="space-y-2 rounded-lg border border-border bg-secondary/25 p-3">
                          {goalContributions.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Sem aportes registrados</p>
                          ) : (
                            goalContributions.map((item) => (
                              <div key={item.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-sm">
                                <span className="text-muted-foreground">{new Date(`${item.date}T00:00:00`).toLocaleDateString("pt-BR")}</span>
                                <span className="font-medium text-foreground">{ptCurrency.format(item.amount)}</span>
                                <span className="truncate text-muted-foreground">{item.notes || "—"}</span>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => void deleteContribution(item)}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Dialog open={goalModalOpen} onOpenChange={setGoalModalOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editingGoal ? "Editar Meta" : "Nova Meta"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={goalName} onChange={(event) => setGoalName(event.target.value)} placeholder="Ex: Fundo de emergência" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Ícone</Label>
                <div className="flex flex-wrap gap-2">
                  {GOAL_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className={cn("rounded-md border border-border px-2 py-1 text-xl", goalEmoji === emoji && "border-accent bg-accent/10")}
                      onClick={() => setGoalEmoji(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Cor</Label>
                <div className="flex flex-wrap gap-2">
                  {GOAL_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={cn("h-7 w-7 rounded-full border border-border", goalColor === color && "ring-2 ring-accent ring-offset-2 ring-offset-background")}
                      style={{ backgroundColor: color }}
                      onClick={() => setGoalColor(color)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Valor alvo</Label>
                <Input value={ptCurrency.format(moneyDigitsToValue(goalTargetDigits))} onChange={(event) => setGoalTargetDigits(event.target.value.replace(/\D/g, ""))} placeholder="R$ 0,00" />
              </div>
              <div className="space-y-1.5">
                <Label>Valor atual</Label>
                <Input value={ptCurrency.format(moneyDigitsToValue(goalCurrentDigits))} onChange={(event) => setGoalCurrentDigits(event.target.value.replace(/\D/g, ""))} placeholder="R$ 0,00" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Prazo (opcional)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !goalDeadline && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {goalDeadline ? goalDeadline.toLocaleDateString("pt-BR") : "Até quando?"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={goalDeadline} onSelect={setGoalDeadline} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label>Descrição (opcional)</Label>
              <Textarea value={goalDescription} onChange={(event) => setGoalDescription(event.target.value)} rows={3} />
            </div>
          </div>

          <DialogFooter className="flex-wrap justify-between gap-2">
            {editingGoal ? (
              <div className="flex gap-2">
                <Button variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteGoalId(editingGoal.id)}>
                  Excluir
                </Button>
                <Button variant="ghost" onClick={() => void toggleGoalPause()}>
                  {editingGoal.status === "paused" ? "Retomar" : "Pausar"}
                </Button>
              </div>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setGoalModalOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => void saveGoal()} disabled={goalSaving}>
                Salvar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contributionModalOpen} onOpenChange={setContributionModalOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Aporte — {contributionGoal?.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Falta {ptCurrency.format(Math.max((contributionGoal?.target_amount ?? 0) - (contributionGoal?.current_amount ?? 0), 0))}
            </p>

            <div className="space-y-1.5">
              <Label>Valor</Label>
              <Input value={ptCurrency.format(moneyDigitsToValue(contributionDigits))} onChange={(event) => setContributionDigits(event.target.value.replace(/\D/g, ""))} placeholder="R$ 0,00" />
            </div>

            <div className="space-y-1.5">
              <Label>Data</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !contributionDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {contributionDate ? contributionDate.toLocaleDateString("pt-BR") : "Selecione a data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={contributionDate} onSelect={setContributionDate} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <Input value={contributionNotes} onChange={(event) => setContributionNotes(event.target.value)} maxLength={120} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setContributionModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void saveContribution()} disabled={contributionSaving}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteGoalId)} onOpenChange={(open) => !open && setDeleteGoalId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir meta?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação remove a meta e todos os aportes associados.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDeleteGoal()}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const SectionEmpty = ({ text }: { text: string }) => (
  <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
    <Target className="h-10 w-10 text-muted-foreground" />
    <p className="text-sm text-muted-foreground">{text}</p>
  </div>
);

export default GoalsPage;

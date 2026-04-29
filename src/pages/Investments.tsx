import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bitcoin,
  Check,
  Home,
  Landmark,
  LineChart,
  Package,
  Pencil,
  PiggyBank,
  RefreshCw,
  TrendingUp,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { Pie, PieChart, Cell } from "recharts";
import { z } from "zod";

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
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type InvestmentType = "stocks" | "crypto" | "fixed_income" | "fund" | "savings" | "real_estate" | "other";
type SortOption = "highest_value" | "highest_return" | "newest" | "name_az";

type InvestmentRow = {
  id: string;
  user_id: string;
  family_id: string;
  name: string;
  type: InvestmentType;
  amount_invested: number;
  current_value: number;
  target_value: number | null;
  target_date: string | null;
  institution: string | null;
  notes: string | null;
  created_at: string;
};

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const INVESTMENT_TYPES: Array<{ value: InvestmentType; label: string; color: string; Icon: typeof BarChart3 }> = [
  { value: "stocks", label: "Ações", color: "#3b82f6", Icon: BarChart3 },
  { value: "crypto", label: "Cripto", color: "#f59e0b", Icon: Bitcoin },
  { value: "fixed_income", label: "Renda Fixa", color: "#22c55e", Icon: Landmark },
  { value: "fund", label: "Fundos", color: "#8b5cf6", Icon: LineChart },
  { value: "savings", label: "Poupança", color: "#06b6d4", Icon: PiggyBank },
  { value: "real_estate", label: "Imóveis", color: "#ec4899", Icon: Home },
  { value: "other", label: "Outro", color: "#6b7280", Icon: Package },
];

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "highest_value", label: "Maior valor" },
  { value: "highest_return", label: "Maior rendimento %" },
  { value: "newest", label: "Mais recente" },
  { value: "name_az", label: "Nome A-Z" },
];

const formSchema = z
  .object({
    name: z.string().trim().min(2, "Nome obrigatório").max(120, "Máximo de 120 caracteres"),
    type: z.enum(["stocks", "crypto", "fixed_income", "fund", "savings", "real_estate", "other"]),
    amountInvestedCents: z.number().int().min(1, "Valor investido obrigatório"),
    currentValueCents: z.number().int().min(1, "Valor atual obrigatório"),
    targetValueCents: z.number().int().min(0),
    targetDate: z.string().nullable(),
    institution: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.targetValueCents > 0 && !values.targetDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetDate"], message: "Informe a data alvo" });
    }
  });

const toMoneyDigits = (value: number) => String(Math.round(value * 100));
const toMoneyValue = (digits: string) => Number(digits || "0") / 100;
const toISODate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const formatDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR") : "-");

const InvestmentsPage = () => {
  const { family, members } = useFamily();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [investments, setInvestments] = useState<InvestmentRow[]>([]);

  const [sortBy, setSortBy] = useState<SortOption>("highest_value");
  const [typeFilter, setTypeFilter] = useState<"all" | InvestmentType>("all");
  const [memberFilter, setMemberFilter] = useState("all");

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<InvestmentRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [quickEditId, setQuickEditId] = useState<string | null>(null);
  const [quickValueDigits, setQuickValueDigits] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState<InvestmentType>("stocks");
  const [amountInvestedDigits, setAmountInvestedDigits] = useState("");
  const [currentValueDigits, setCurrentValueDigits] = useState("");
  const [isCurrentEdited, setIsCurrentEdited] = useState(false);
  const [institution, setInstitution] = useState("");
  const [targetValueDigits, setTargetValueDigits] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!family?.id) {
      setInvestments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.from("investments").select("*").eq("family_id", family.id).order("created_at", { ascending: false });
    if (error) {
      toast.error("Erro ao carregar investimentos");
      setLoading(false);
      return;
    }

    const normalized = ((data as Record<string, unknown>[] | null) ?? []).map<InvestmentRow>((row) => ({
      id: String(row.id ?? ""),
      user_id: String(row.user_id ?? ""),
      family_id: String(row.family_id ?? family.id),
      name: String(row.name ?? "Investimento"),
      type: ((row.type as InvestmentType | null) ?? "other") as InvestmentType,
      amount_invested: Number(row.amount_invested ?? 0),
      current_value: Number(row.current_value ?? 0),
      target_value: row.target_value === null || row.target_value === undefined ? null : Number(row.target_value),
      target_date: (row.target_date as string | null) ?? null,
      institution: (row.institution as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      created_at: String(row.created_at ?? new Date().toISOString()),
    }));

    setInvestments(normalized);
    setLoading(false);
  }, [family?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const memberMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((member) => {
      const nameLabel = member.profiles?.full_name?.trim() || member.profiles?.email || "Usuário";
      map.set(member.user_id, nameLabel);
    });
    return map;
  }, [members]);

  const summary = useMemo(() => {
    const invested = investments.reduce((sum, item) => sum + Number(item.amount_invested || 0), 0);
    const current = investments.reduce((sum, item) => sum + Number(item.current_value || 0), 0);
    const profit = current - invested;
    const profitPct = invested > 0 ? (profit / invested) * 100 : 0;
    return { invested, current, profit, profitPct };
  }, [investments]);

  const distribution = useMemo(() => {
    const total = Math.max(summary.current, 0);
    return INVESTMENT_TYPES.map((meta) => {
      const value = investments.filter((item) => item.type === meta.value).reduce((sum, item) => sum + Number(item.current_value || 0), 0);
      const pct = total > 0 ? (value / total) * 100 : 0;
      return { type: meta.value, label: meta.label, value, pct, fill: meta.color };
    }).filter((entry) => entry.value > 0);
  }, [investments, summary.current]);

  const chartConfig = useMemo(
    () =>
      INVESTMENT_TYPES.reduce<ChartConfig>((acc, meta) => {
        acc[meta.value] = { label: meta.label, color: meta.color };
        return acc;
      }, {}),
    [],
  );

  const filteredAndSorted = useMemo(() => {
    const filtered = investments.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (memberFilter !== "all" && item.user_id !== memberFilter) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === "highest_value") return b.current_value - a.current_value;
      if (sortBy === "highest_return") {
        const pctA = a.amount_invested > 0 ? (a.current_value - a.amount_invested) / a.amount_invested : 0;
        const pctB = b.amount_invested > 0 ? (b.current_value - b.amount_invested) / b.amount_invested : 0;
        return pctB - pctA;
      }
      if (sortBy === "name_az") return a.name.localeCompare(b.name, "pt-BR");
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [investments, memberFilter, sortBy, typeFilter]);

  const resetForm = () => {
    setEditing(null);
    setName("");
    setType("stocks");
    setAmountInvestedDigits("");
    setCurrentValueDigits("");
    setIsCurrentEdited(false);
    setInstitution("");
    setTargetValueDigits("");
    setTargetDate("");
    setNotes("");
    setFormError(null);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (item: InvestmentRow) => {
    setEditing(item);
    setName(item.name);
    setType(item.type);
    setAmountInvestedDigits(toMoneyDigits(item.amount_invested));
    setCurrentValueDigits(toMoneyDigits(item.current_value));
    setIsCurrentEdited(true);
    setInstitution(item.institution ?? "");
    setTargetValueDigits(item.target_value ? toMoneyDigits(item.target_value) : "");
    setTargetDate(item.target_date ?? "");
    setNotes(item.notes ?? "");
    setFormError(null);
    setOpen(true);
  };

  const onInvestedChange = (digits: string) => {
    const clean = digits.replace(/\D/g, "");
    setAmountInvestedDigits(clean);
    if (!editing && !isCurrentEdited) {
      setCurrentValueDigits(clean);
    }
  };

  const saveInvestment = async () => {
    if (!family?.id || !user?.id) return;

    const parsed = formSchema.safeParse({
      name,
      type,
      amountInvestedCents: Number(amountInvestedDigits || "0"),
      currentValueCents: Number(currentValueDigits || "0"),
      targetValueCents: Number(targetValueDigits || "0"),
      targetDate: targetDate || null,
      institution,
      notes,
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    setSaving(true);
    setFormError(null);

    const payload = {
      name: parsed.data.name,
      type: parsed.data.type,
      amount_invested: parsed.data.amountInvestedCents / 100,
      current_value: parsed.data.currentValueCents / 100,
      target_value: parsed.data.targetValueCents > 0 ? parsed.data.targetValueCents / 100 : null,
      target_date: parsed.data.targetValueCents > 0 ? parsed.data.targetDate : null,
      institution: parsed.data.institution?.trim() || null,
      notes: parsed.data.notes?.trim() || null,
    };

    const { error } = editing
      ? await supabase.from("investments").update(payload).eq("id", editing.id)
      : await supabase.from("investments").insert({ ...payload, user_id: user.id, family_id: family.id });

    setSaving(false);

    if (error) {
      toast.error(error.message || "Não foi possível salvar");
      return;
    }

    setOpen(false);
    toast.success(editing ? "Investimento atualizado" : "Investimento criado");
    await loadData();
  };

  const deleteInvestment = async () => {
    if (!editing) return;
    setDeleting(true);
    const { error } = await supabase.from("investments").delete().eq("id", editing.id);
    setDeleting(false);
    if (error) {
      toast.error(error.message || "Não foi possível excluir");
      return;
    }
    setDeleteOpen(false);
    setOpen(false);
    toast.success("Investimento excluído");
    await loadData();
  };

  const startQuickUpdate = (item: InvestmentRow) => {
    setQuickEditId(item.id);
    setQuickValueDigits(toMoneyDigits(item.current_value));
  };

  const cancelQuickUpdate = () => {
    setQuickEditId(null);
    setQuickValueDigits("");
  };

  const saveQuickUpdate = async (itemId: string) => {
    const cents = Number(quickValueDigits || "0");
    if (cents <= 0) {
      toast.error("Informe um valor atual válido");
      return;
    }
    setQuickSaving(true);
    const newValue = cents / 100;
    const { error } = await supabase.from("investments").update({ current_value: newValue }).eq("id", itemId);
    setQuickSaving(false);
    if (error) {
      toast.error(error.message || "Erro ao atualizar valor");
      return;
    }
    setInvestments((prev) => prev.map((item) => (item.id === itemId ? { ...item, current_value: newValue } : item)));
    setQuickEditId(null);
    setQuickValueDigits("");
    toast.success("Valor atualizado");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Label className="sr-only">Ordenação</Label>
          <Select value={sortBy} onValueChange={(value: SortOption) => setSortBy(value)}>
            <SelectTrigger className="h-10 w-[190px] rounded-lg border-border bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-border bg-card text-card-foreground">
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={memberFilter} onValueChange={setMemberFilter}>
            <SelectTrigger className="h-10 w-[190px] rounded-lg border-border bg-card">
              <SelectValue placeholder="Membro" />
            </SelectTrigger>
            <SelectContent className="border-border bg-card text-card-foreground">
              <SelectItem value="all">Todos</SelectItem>
              {members.map((member) => (
                <SelectItem key={member.user_id} value={member.user_id}>
                  {member.profiles?.full_name?.trim() || member.profiles?.email || "Usuário"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={openCreate} className="h-10 rounded-lg font-semibold">
          + Novo Investimento
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={typeFilter === "all" ? "default" : "outline"} className="h-9 rounded-full px-4" onClick={() => setTypeFilter("all")}>
          Todos
        </Button>
        {INVESTMENT_TYPES.map((meta) => (
          <Button
            key={meta.value}
            variant={typeFilter === meta.value ? "default" : "outline"}
            className="h-9 rounded-full px-4"
            onClick={() => setTypeFilter(meta.value)}
          >
            {meta.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">Total Investido</p>
            <Wallet className="h-4 w-4 text-accent" />
          </div>
          <p className="mt-3 text-2xl font-bold text-foreground">{ptCurrency.format(summary.invested)}</p>
        </div>

        <div className="rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">Valor Atual</p>
            <TrendingUp className="h-4 w-4 text-accent" />
          </div>
          <p className="mt-3 text-2xl font-bold text-foreground">{ptCurrency.format(summary.current)}</p>
        </div>

        <div className="rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">Rendimento</p>
            {summary.profit >= 0 ? <ArrowUpRight className="h-4 w-4 text-[hsl(var(--success))]" /> : <ArrowDownRight className="h-4 w-4 text-destructive" />}
          </div>
          <p className={cn("mt-3 text-2xl font-bold", summary.profit >= 0 ? "text-[hsl(var(--success))]" : "text-destructive")}>
            {ptCurrency.format(summary.profit)} ({summary.profit >= 0 ? "+" : ""}
            {summary.profitPct.toFixed(1)}%)
          </p>
        </div>

        <div className="rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">Distribuição</p>
          <div className="mt-2 flex items-center gap-4">
            <div className="h-[120px] w-[120px] shrink-0">
              <ChartContainer config={chartConfig} className="h-[120px] w-[120px]">
                <PieChart>
                  <Pie data={distribution} dataKey="value" nameKey="type" innerRadius={36} outerRadius={54} strokeWidth={2}>
                    {distribution.map((entry) => (
                      <Cell key={entry.type} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            </div>
            <div className="space-y-1 text-xs">
              {distribution.length === 0 ? (
                <p className="text-muted-foreground">Sem dados</p>
              ) : (
                distribution.map((item) => (
                  <div key={item.type} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.fill }} />
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-semibold text-foreground">{item.pct.toFixed(1)}%</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Carregando investimentos...</div>
      ) : filteredAndSorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-10 text-center">
          <TrendingUp className="mx-auto h-14 w-14 text-[hsl(var(--placeholder-icon))]" />
          <p className="mt-4 text-lg font-semibold text-foreground">Nenhum investimento cadastrado</p>
          <p className="mt-1 text-sm text-muted-foreground">Comece a acompanhar seus investimentos</p>
          <Button onClick={openCreate} className="mt-5 h-10 rounded-lg font-semibold">
            + Novo Investimento
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredAndSorted.map((item) => {
            const typeMeta = INVESTMENT_TYPES.find((meta) => meta.value === item.type) ?? INVESTMENT_TYPES[6];
            const profit = item.current_value - item.amount_invested;
            const profitPct = item.amount_invested > 0 ? (profit / item.amount_invested) * 100 : 0;
            const targetPct = item.target_value && item.target_value > 0 ? Math.min((item.current_value / item.target_value) * 100, 100) : 0;
            const isQuickEditing = quickEditId === item.id;

            return (
              <div
                key={item.id}
                className="group rounded-xl border p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${typeMeta.color}33` }}>
                      <typeMeta.Icon className="h-4 w-4" style={{ color: typeMeta.color }} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-foreground">{item.name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {typeMeta.label}
                        {item.institution ? ` · ${item.institution}` : ""}
                      </p>
                    </div>
                  </div>

                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold",
                      profitPct >= 0 ? "text-[hsl(var(--success))]" : "text-destructive",
                    )}
                    style={{ backgroundColor: profitPct >= 0 ? "hsl(var(--success) / 0.15)" : "hsl(var(--destructive) / 0.15)" }}
                  >
                    {profitPct >= 0 ? "+" : ""}
                    {profitPct.toFixed(1)}%
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Investido</span>
                    <span className="font-medium text-foreground">{ptCurrency.format(item.amount_invested)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Valor atual</span>
                    {isQuickEditing ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={ptCurrency.format(toMoneyValue(quickValueDigits))}
                          onChange={(event) => setQuickValueDigits(event.target.value.replace(/\D/g, ""))}
                          className="h-8 w-[130px] text-right text-sm"
                          inputMode="numeric"
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={quickSaving} onClick={() => void saveQuickUpdate(item.id)}>
                          <Check className="h-4 w-4 text-[hsl(var(--success))]" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={quickSaving} onClick={cancelQuickUpdate}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-lg font-semibold text-foreground">{ptCurrency.format(item.current_value)}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Rendimento</span>
                    <span className={cn("font-semibold", profit >= 0 ? "text-[hsl(var(--success))]" : "text-destructive")}>
                      {profit >= 0 ? "+" : ""}
                      {ptCurrency.format(profit)}
                    </span>
                  </div>
                </div>

                {item.target_value && item.target_value > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full" style={{ width: `${targetPct}%`, backgroundColor: targetPct >= 100 ? "hsl(var(--success))" : "hsl(var(--accent))" }} />
                    </div>
                    <p className="text-xs text-[hsl(var(--section-label))]">
                      Meta: {ptCurrency.format(item.target_value)} até {formatDate(item.target_date)}
                    </p>
                  </div>
                )}

                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  {item.notes ? <p className="truncate text-xs italic text-[hsl(var(--section-label))]">{item.notes}</p> : null}
                  <p className="text-xs text-muted-foreground">Adicionado em {new Date(item.created_at).toLocaleDateString("pt-BR")}</p>
                  <p className="text-xs text-muted-foreground">Responsável: {memberMap.get(item.user_id) ?? "Usuário"}</p>
                </div>

                <div className="mt-3 flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startQuickUpdate(item)} aria-label="Atualizar valor">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(item)} aria-label="Editar investimento">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => openEdit(item)} aria-label="Excluir investimento">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[560px] rounded-xl border bg-card text-card-foreground" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Investimento" : "Novo Investimento"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Tesouro Selic 2029, PETR4, Bitcoin..." maxLength={120} />
            </div>

            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={(value: InvestmentType) => setType(value)}>
                <SelectTrigger className="h-10 rounded-lg border-border bg-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-card text-card-foreground">
                  {INVESTMENT_TYPES.map((meta) => (
                    <SelectItem key={meta.value} value={meta.value}>
                      {meta.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Valor investido</Label>
                <Input
                  value={ptCurrency.format(toMoneyValue(amountInvestedDigits))}
                  onChange={(event) => onInvestedChange(event.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label>Valor atual</Label>
                <Input
                  value={ptCurrency.format(toMoneyValue(currentValueDigits))}
                  onChange={(event) => {
                    setCurrentValueDigits(event.target.value.replace(/\D/g, ""));
                    setIsCurrentEdited(true);
                  }}
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Instituição (opcional)</Label>
              <Input value={institution} onChange={(event) => setInstitution(event.target.value)} placeholder="Ex: Nubank, XP, Binance..." maxLength={100} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Meta de valor (opcional)</Label>
                <Input
                  value={ptCurrency.format(toMoneyValue(targetValueDigits))}
                  onChange={(event) => setTargetValueDigits(event.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  placeholder="Quanto quer alcançar?"
                />
              </div>
              {Number(targetValueDigits || "0") > 0 ? (
                <div className="space-y-2">
                  <Label>Até quando?</Label>
                  <Input value={targetDate} onChange={(event) => setTargetDate(event.target.value)} type="date" min={toISODate(new Date())} />
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={500} />
            </div>

            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>

          <DialogFooter className="mt-2 gap-2 sm:justify-between">
            {editing ? (
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                Excluir
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void saveInvestment()} disabled={saving}>
                {saving ? "Salvando..." : editing ? "Salvar alterações" : "Salvar"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza que deseja excluir este investimento?</AlertDialogTitle>
            <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteInvestment()} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default InvestmentsPage;

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, CreditCard, Loader2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type CardBrand = "visa" | "mastercard" | "elo" | "amex" | "hipercard" | "outro";

type CardRow = {
  id: string;
  name: string;
  brand: CardBrand | null;
  credit_limit: number | null;
  closing_day: number | null;
  due_day: number | null;
  color: string | null;
  last4: string | null;
};

type CategoryRow = { id: string; name: string; color: string | null; type: string | null };

type TransactionRow = {
  id: string;
  description: string | null;
  amount: number;
  date: string;
  status: "paid" | "pending" | string | null;
  type: string;
  category_id: string | null;
  notes: string | null;
  categories?: { id?: string; name?: string; color?: string | null } | { id?: string; name?: string; color?: string | null }[] | null;
};

const formSchema = z.object({
  description: z.string().trim().min(2, "Descrição obrigatória").max(120),
  amountCents: z.number().int().min(1, "Valor inválido"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId: z.string().min(1, "Categoria obrigatória"),
  status: z.enum(["paid", "pending"]),
  notes: z.string().trim().max(600).optional(),
});

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const asSingle = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));
const startOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth(), 1);
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const formatMonthYear = (date: Date) => capitalize(date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
const formatDateDDMM = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const formatDateDDMMYYYY = (date: Date) => date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const toISODate = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const getBrandDefaultColor = (brand: CardBrand) => {
  if (brand === "visa") return "#1e40af";
  if (brand === "mastercard") return "#dc2626";
  if (brand === "elo") return "#ca8a04";
  if (brand === "amex") return "#0891b2";
  if (brand === "hipercard") return "#7c3aed";
  return "#374151";
};

const getBrandGradientEnd = (brand: CardBrand) => {
  if (brand === "visa") return "#1e3a5f";
  if (brand === "mastercard") return "#991b1b";
  if (brand === "elo") return "#854d0e";
  if (brand === "amex") return "#155e75";
  if (brand === "hipercard") return "#4c1d95";
  return "#1f2937";
};

const darkenHex = (hex: string, factor = 0.64) => {
  const safe = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(safe.slice(0, 2), 16) * factor));
  const g = Math.max(0, Math.round(parseInt(safe.slice(2, 4), 16) * factor));
  const b = Math.max(0, Math.round(parseInt(safe.slice(4, 6), 16) * factor));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

const getCycleWindow = (closingDay: number, invoiceMonth: Date) => {
  const year = invoiceMonth.getFullYear();
  const month = invoiceMonth.getMonth();
  const prevMonthDate = new Date(year, month - 1, 1);
  const prevMonthLastDay = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0).getDate();
  const currentMonthLastDay = new Date(year, month + 1, 0).getDate();
  const prevClosing = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), Math.min(closingDay, prevMonthLastDay));
  const cycleStart = new Date(prevClosing);
  cycleStart.setDate(cycleStart.getDate() + 1);
  const cycleEnd = new Date(year, month, Math.min(closingDay, currentMonthLastDay));
  return { start: toISODate(cycleStart), end: toISODate(cycleEnd) };
};

const getDueDate = (invoiceMonth: Date, dueDay: number) => {
  const next = new Date(invoiceMonth.getFullYear(), invoiceMonth.getMonth() + 1, 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  return new Date(next.getFullYear(), next.getMonth(), Math.min(dueDay, lastDay));
};

const CardInvoiceDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { family } = useFamily();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState<CardRow | null>(null);
  const [selectedInvoiceMonth, setSelectedInvoiceMonth] = useState(() => startOfMonth(new Date()));
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [history, setHistory] = useState<{ month: Date; total: number; status: "paid" | "open" }[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<TransactionRow | null>(null);
  const [description, setDescription] = useState("");
  const [amountDigits, setAmountDigits] = useState("");
  const [txDate, setTxDate] = useState<Date>(new Date());
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<"paid" | "pending">("pending");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!family?.id || !id) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const [cardRes, categoriesRes] = await Promise.all([
      supabase.from("cards").select("*").eq("family_id", family.id).eq("id", id).maybeSingle(),
      supabase.from("categories").select("id, name, color, type").eq("family_id", family.id).eq("type", "expense").order("name", { ascending: true }),
    ]);

    if (cardRes.error || !cardRes.data) {
      toast.error("Cartão não encontrado");
      navigate("/cards");
      return;
    }

    const raw = cardRes.data as Record<string, unknown>;
    const currentCard: CardRow = {
      id: String(raw.id),
      name: String(raw.name ?? "Cartão"),
      brand: (String(raw.brand ?? "outro") as CardBrand) ?? "outro",
      credit_limit: Number(raw.credit_limit ?? 0),
      closing_day: Number(raw.closing_day ?? 1),
      due_day: Number(raw.due_day ?? 1),
      color: (raw.color as string | null) ?? null,
      last4: (raw.last4 as string | null) ?? (raw.last_digits as string | null) ?? null,
    };

    setCard(currentCard);
    setCategories((categoriesRes.data as CategoryRow[] | null) ?? []);

    const cycle = getCycleWindow(Number(currentCard.closing_day || 1), selectedInvoiceMonth);
    const txRes = await supabase
      .from("transactions")
      .select("id, description, amount, date, status, type, category_id, notes, categories(id, name, color)")
      .eq("family_id", family.id)
      .eq("card_id", currentCard.id)
      .eq("type", "expense")
      .gte("date", cycle.start)
      .lte("date", cycle.end)
      .order("date", { ascending: false });

    if (txRes.error) {
      toast.error("Erro ao carregar fatura");
      setLoading(false);
      return;
    }

    setTransactions((txRes.data as TransactionRow[] | null) ?? []);

    const months = Array.from({ length: 6 }, (_, index) => startOfMonth(new Date(new Date().getFullYear(), new Date().getMonth() - index, 1)));
    const windows = months.map((month) => ({ month, ...getCycleWindow(Number(currentCard.closing_day || 1), month) }));
    const minStart = windows.map((item) => item.start).sort()[0];
    const maxEnd = windows.map((item) => item.end).sort().slice(-1)[0];

    const historyRes = await supabase
      .from("transactions")
      .select("amount, date, status")
      .eq("family_id", family.id)
      .eq("card_id", currentCard.id)
      .eq("type", "expense")
      .gte("date", minStart)
      .lte("date", maxEnd);

    if (!historyRes.error) {
      const rows = (historyRes.data as { amount: number; date: string; status: string | null }[] | null) ?? [];
      setHistory(
        windows.map((window) => {
          const monthRows = rows.filter((row) => row.date >= window.start && row.date <= window.end);
          const total = monthRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
          const statusValue: "paid" | "open" = monthRows.length > 0 && monthRows.every((row) => row.status === "paid") ? "paid" : "open";
          return { month: window.month, total, status: statusValue };
        }),
      );
    }

    setLoading(false);
  }, [family?.id, id, navigate, selectedInvoiceMonth]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const invoiceTotal = useMemo(() => transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0), [transactions]);
  const dueDate = useMemo(() => getDueDate(selectedInvoiceMonth, Number(card?.due_day || 1)), [card?.due_day, selectedInvoiceMonth]);

  const invoiceStatus = useMemo(() => {
    if (!transactions.length) return { label: "Aberta", className: "text-yellow-400" };
    if (transactions.every((tx) => tx.status === "paid")) return { label: "Fechada", className: "text-emerald-500" };
    if (toISODate(new Date()) > toISODate(dueDate)) return { label: "Vencida", className: "text-destructive" };
    return { label: "Aberta", className: "text-yellow-400" };
  }, [dueDate, transactions]);

  const donutData = useMemo(() => {
    const grouped = new Map<string, { name: string; value: number; color: string }>();
    transactions.forEach((tx) => {
      const category = asSingle(tx.categories);
      const key = tx.category_id || category?.id || "sem_categoria";
      const name = category?.name || "Sem categoria";
      const color = category?.color || "#6b7280";
      const existing = grouped.get(key);
      if (existing) existing.value += Number(tx.amount || 0);
      else grouped.set(key, { name, value: Number(tx.amount || 0), color });
    });
    return [...grouped.values()].sort((a, b) => b.value - a.value);
  }, [transactions]);

  const amountCents = Number(amountDigits || "0");
  const amountLabel = ptCurrency.format(amountCents / 100);

  const openEdit = (tx: TransactionRow) => {
    setEditing(tx);
    setDescription(tx.description ?? "");
    setAmountDigits(String(Math.round(Number(tx.amount || 0) * 100)));
    setTxDate(new Date(`${tx.date}T00:00:00`));
    setCategoryId(tx.category_id ?? "");
    setStatus(tx.status === "paid" ? "paid" : "pending");
    setNotes(tx.notes ?? "");
    setFormError(null);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const parsed = formSchema.safeParse({
      description,
      amountCents,
      date: toISODate(txDate),
      categoryId,
      status,
      notes,
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("transactions")
      .update({
        description: parsed.data.description,
        amount: parsed.data.amountCents / 100,
        date: parsed.data.date,
        category_id: parsed.data.categoryId,
        status: parsed.data.status,
        notes: parsed.data.notes?.trim() || null,
      })
      .eq("id", editing.id);
    setSaving(false);

    if (error) {
      toast.error(error.message || "Erro ao salvar transação");
      return;
    }

    toast.success("Transação atualizada!");
    setEditOpen(false);
    await loadData();
  };

  if (loading) {
    return <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Carregando fatura...</div>;
  }

  if (!card) {
    return null;
  }

  const baseColor = card.color || getBrandDefaultColor((card.brand ?? "outro") as CardBrand);
  const endColor = card.color ? darkenHex(baseColor) : getBrandGradientEnd((card.brand ?? "outro") as CardBrand);

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" className="h-9 px-2 text-sm text-muted-foreground">
          <Link to="/cards" className="hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Link>
        </Button>
      </div>

      <div className="mx-auto min-h-[250px] w-full max-w-[400px] overflow-hidden rounded-2xl p-6 text-white shadow-[0_10px_28px_rgba(0,0,0,0.38)]" style={{ backgroundImage: `linear-gradient(145deg, ${baseColor}, ${endColor})`, aspectRatio: "1.6 / 1" }}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">{card.name}</h2>
          <span className="rounded-md border border-white/30 px-2 py-1 text-xs font-semibold uppercase">{card.brand || "outro"}</span>
        </div>
        <p className="mt-10 font-mono text-xl tracking-[2px]">•••• •••• •••• {card.last4 || "0000"}</p>
        <div className="mt-5 space-y-1 text-sm text-white/75">
          <p>Fechamento: dia {card.closing_day || 1}</p>
          <p>Vencimento: dia {card.due_day || 1}</p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={() => setSelectedInvoiceMonth((prev) => startOfMonth(new Date(prev.getFullYear(), prev.getMonth() - 1, 1)))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-[220px] text-center text-sm font-semibold text-foreground">Fatura de {formatMonthYear(selectedInvoiceMonth)}</div>
        <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={() => setSelectedInvoiceMonth((prev) => startOfMonth(new Date(prev.getFullYear(), prev.getMonth() + 1, 1)))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
        <div className="flex flex-wrap gap-4">
          <div className="min-w-[220px] flex-1 rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">TOTAL DA FATURA</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{ptCurrency.format(invoiceTotal)}</p>
          </div>
          <div className="min-w-[220px] flex-1 rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">VENCIMENTO</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{formatDateDDMMYYYY(dueDate)}</p>
          </div>
          <div className="min-w-[220px] flex-1 rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">STATUS</p>
            <p className={cn("mt-2 text-3xl font-bold", invoiceStatus.className)}>{invoiceStatus.label}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por categoria</p>
          <div className="mx-auto h-[200px] w-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {donutData.length ? (
                  <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={2} stroke="none">
                    {donutData.map((entry) => (
                      <Cell key={`${entry.name}-${entry.color}`} fill={entry.color} />
                    ))}
                  </Pie>
                ) : (
                  <Pie data={[{ value: 1 }]} dataKey="value" innerRadius={52} outerRadius={84} stroke="none" fill="hsl(var(--border))" />
                )}
                <Tooltip formatter={(value: number) => ptCurrency.format(Number(value || 0))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
            <CreditCard className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm">Nenhum gasto nesta fatura</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border bg-background hover:bg-background">
                  <TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Data</TableHead>
                  <TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Descrição</TableHead>
                  <TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Categoria</TableHead>
                  <TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => {
                  const category = asSingle(tx.categories);
                  return (
                    <TableRow key={tx.id} className="cursor-pointer border-b border-border bg-transparent hover:bg-secondary" onClick={() => openEdit(tx)}>
                      <TableCell className="px-4 py-3 text-sm text-muted-foreground">{formatDateDDMM(tx.date)}</TableCell>
                      <TableCell className="px-4 py-3 text-sm font-medium text-foreground">{tx.description || "Sem descrição"}</TableCell>
                      <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: category?.color || "hsl(var(--muted-foreground))" }} />
                          {category?.name || "Sem categoria"}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-destructive">{ptCurrency.format(Number(tx.amount || 0))}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex justify-end border-t border-border px-4 py-3 text-right text-sm font-bold text-foreground">Total da Fatura: {ptCurrency.format(invoiceTotal)}</div>
          </>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-base font-semibold text-foreground">Histórico</h3>
        <div className="mt-3 space-y-2">
          {history.map((item) => (
            <button
              key={toISODate(item.month)}
              type="button"
              className="flex w-full items-center justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2 text-left transition-colors hover:bg-secondary"
              onClick={() => setSelectedInvoiceMonth(item.month)}
            >
              <span className="text-sm text-foreground">{formatMonthYear(item.month)}</span>
              <span className="inline-flex items-center gap-3">
                <span className="text-sm font-semibold text-foreground">{ptCurrency.format(item.total)}</span>
                <span className={cn("text-xs font-semibold", item.status === "paid" ? "text-emerald-500" : "text-yellow-400")}>{item.status === "paid" ? "Paga" : "Aberta"}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-[520px] overflow-y-auto rounded-2xl border-border bg-card p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-foreground">Editar Transação</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input value={description} onChange={(event) => setDescription(event.target.value)} className="h-[42px] rounded-lg border-border bg-secondary text-foreground" />
            </div>

            <div className="space-y-2">
              <Label>Valor</Label>
              <Input value={amountLabel} onChange={(event) => setAmountDigits(event.target.value.replace(/\D/g, ""))} className="h-[42px] rounded-lg border-border bg-secondary text-foreground" inputMode="numeric" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Data</Label>
                <Input type="date" value={toISODate(txDate)} onChange={(event) => setTxDate(new Date(`${event.target.value}T00:00:00`))} className="h-[42px] rounded-lg border-border bg-secondary text-foreground" />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as "paid" | "pending")}>
                  <SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-card text-card-foreground">
                    <SelectItem value="paid">Pago</SelectItem>
                    <SelectItem value="pending">Pendente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={categoryId || ""} onValueChange={setCategoryId}>
                <SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent className="border-border bg-card text-card-foreground">
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} className="h-[42px] rounded-lg border-border bg-secondary text-foreground" />
            </div>

            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>

          <DialogFooter className="mt-2 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CardInvoiceDetailPage;
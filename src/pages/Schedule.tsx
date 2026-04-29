import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpCircle,
  CalendarCheck2,
  Check,
  Pencil,
  Trash2,
} from "lucide-react";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type PaymentType = "payable" | "receivable";
type RecurrenceType = "once" | "weekly" | "monthly" | "yearly";

type CategoryRow = {
  id: string;
  name: string;
  color: string | null;
  type: string | null;
};

type ScheduledRow = {
  id: string;
  description: string;
  amount: number;
  due_date: string;
  type: string | null;
  recurrence: string | null;
  recurrence_type: string | null;
  category_id: string | null;
  status: string | null;
  is_paid: boolean | null;
  paid_at: string | null;
  categories?: CategoryRow | CategoryRow[] | null;
  created_at: string | null;
};

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const monthTitle = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long" });

const todayIso = () => toISODate(new Date());

const formSchema = z.object({
  type: z.enum(["payable", "receivable"]),
  description: z.string().trim().min(2, "Descrição obrigatória").max(120, "Máximo 120 caracteres"),
  amountCents: z.number().int().min(1, "Valor obrigatório"),
  dueDate: z.string().min(10, "Data obrigatória"),
  categoryId: z.string().optional(),
  recurrence: z.enum(["once", "weekly", "monthly", "yearly"]),
});

const toISODate = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toISODate(date);
};

const addMonths = (iso: string, months: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(y, m - 1 + months, d);
  if (next.getMonth() !== ((m - 1 + months) % 12 + 12) % 12) next.setDate(0);
  return toISODate(next);
};

const addYears = (iso: string, years: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return toISODate(new Date(y + years, m - 1, d));
};

const startOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth(), 1);
const endOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth() + 1, 0);
const startOfCalendar = (monthStart: Date) => {
  const copy = new Date(monthStart);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
};

const asSingle = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));
const formatDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
const normalizeType = (value: string | null): PaymentType => (value === "receivable" || value === "income" ? "receivable" : "payable");
const normalizeRecurrence = (row: ScheduledRow): RecurrenceType => {
  const value = (row.recurrence || row.recurrence_type || "once").toLowerCase();
  if (value === "weekly" || value === "monthly" || value === "yearly") return value;
  return "once";
};
const isPaid = (row: ScheduledRow) => Boolean(row.is_paid) || row.status === "paid";
const isOverdue = (row: ScheduledRow) => !isPaid(row) && row.due_date < todayIso();

const SchedulePage = () => {
  const { family } = useFamily();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayIso());

  const [monthRows, setMonthRows] = useState<ScheduledRow[]>([]);
  const [dayRows, setDayRows] = useState<ScheduledRow[]>([]);
  const [overdueRows, setOverdueRows] = useState<ScheduledRow[]>([]);
  const [next7Rows, setNext7Rows] = useState<ScheduledRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ScheduledRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [type, setType] = useState<PaymentType>("payable");
  const [description, setDescription] = useState("");
  const [amountDigits, setAmountDigits] = useState("");
  const [dueDate, setDueDate] = useState(todayIso());
  const [categoryId, setCategoryId] = useState<string>("none");
  const [recurrence, setRecurrence] = useState<RecurrenceType>("once");

  const loadData = useCallback(async () => {
    if (!family?.id) {
      setLoading(false);
      setMonthRows([]);
      setDayRows([]);
      setOverdueRows([]);
      setNext7Rows([]);
      setCategories([]);
      return;
    }

    setLoading(true);

    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const nextWeek = addDays(todayIso(), 7);

    const [monthRes, dayRes, overdueRes, next7Res, categoriesRes] = await Promise.all([
      supabase
        .from("scheduled_payments")
        .select("*, categories(id, name, color, type)")
        .eq("family_id", family.id)
        .gte("due_date", toISODate(monthStart))
        .lte("due_date", toISODate(monthEnd)),
      supabase
        .from("scheduled_payments")
        .select("*, categories(id, name, color, type)")
        .eq("family_id", family.id)
        .eq("due_date", selectedDate),
      supabase
        .from("scheduled_payments")
        .select("*")
        .eq("family_id", family.id)
        .or("is_paid.eq.false,status.eq.pending,status.is.null")
        .lt("due_date", todayIso()),
      supabase
        .from("scheduled_payments")
        .select("*")
        .eq("family_id", family.id)
        .or("is_paid.eq.false,status.eq.pending,status.is.null")
        .gte("due_date", todayIso())
        .lte("due_date", nextWeek),
      supabase.from("categories").select("id, name, color, type").eq("family_id", family.id).order("name", { ascending: true }),
    ]);

    if (monthRes.error || dayRes.error || overdueRes.error || next7Res.error || categoriesRes.error) {
      toast.error("Erro ao carregar agenda");
      setLoading(false);
      return;
    }

    setMonthRows((monthRes.data as ScheduledRow[] | null) ?? []);
    setDayRows((dayRes.data as ScheduledRow[] | null) ?? []);
    setOverdueRows((overdueRes.data as ScheduledRow[] | null) ?? []);
    setNext7Rows((next7Res.data as ScheduledRow[] | null) ?? []);
    setCategories((categoriesRes.data as CategoryRow[] | null) ?? []);
    setLoading(false);
  }, [family?.id, selectedDate, viewMonth]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedDateLabel = useMemo(() => {
    const base = new Date(`${selectedDate}T00:00:00`);
    const day = base.toLocaleDateString("pt-BR", { day: "2-digit" });
    const month = monthLabel.format(base);
    return `${day} de ${month.charAt(0).toUpperCase()}${month.slice(1)}`;
  }, [selectedDate]);

  const sortedDayRows = useMemo(() => {
    return [...dayRows].sort((a, b) => {
      if (isPaid(a) !== isPaid(b)) return isPaid(a) ? 1 : -1;
      if (normalizeType(a.type) !== normalizeType(b.type)) return normalizeType(a.type) === "payable" ? -1 : 1;
      return (a.created_at || "").localeCompare(b.created_at || "");
    });
  }, [dayRows]);

  const monthSummary = useMemo(() => {
    const payable = monthRows.filter((row) => normalizeType(row.type) === "payable" && !isPaid(row)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const receivable = monthRows.filter((row) => normalizeType(row.type) === "receivable" && !isPaid(row)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return {
      payable,
      receivable,
      overdueCount: overdueRows.length,
      next7Count: next7Rows.length,
    };
  }, [monthRows, next7Rows.length, overdueRows.length]);

  const monthGrid = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const cursor = startOfCalendar(monthStart);
    const cells: Date[] = [];

    while (cells.length < 42) {
      cells.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
      if (cursor > monthEnd && cursor.getDay() === 0 && cells.length >= 35) break;
    }

    return cells;
  }, [viewMonth]);

  const rowsByDate = useMemo(() => {
    const map = new Map<string, ScheduledRow[]>();
    monthRows.forEach((row) => {
      const list = map.get(row.due_date) ?? [];
      list.push(row);
      map.set(row.due_date, list);
    });
    return map;
  }, [monthRows]);

  const filteredCategories = useMemo(() => {
    const target = type === "payable" ? "expense" : "income";
    return categories.filter((category) => (category.type || "").toLowerCase() === target);
  }, [categories, type]);

  const resetForm = () => {
    setEditing(null);
    setType("payable");
    setDescription("");
    setAmountDigits("");
    setDueDate(selectedDate || todayIso());
    setCategoryId("none");
    setRecurrence("once");
    setFormError(null);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (row: ScheduledRow) => {
    setEditing(row);
    setType(normalizeType(row.type));
    setDescription(row.description || "");
    setAmountDigits(String(Math.round(Number(row.amount || 0) * 100)));
    setDueDate(row.due_date || selectedDate);
    setCategoryId(row.category_id || "none");
    setRecurrence(normalizeRecurrence(row));
    setFormError(null);
    setOpen(true);
  };

  const updatePaidState = async (rowId: string, paid: boolean) => {
    const paidAt = paid ? new Date().toISOString() : null;
    const primary = await supabase
      .from("scheduled_payments")
      .update({ is_paid: paid, status: paid ? "paid" : "pending", paid_at: paidAt })
      .eq("id", rowId);

    if (!primary.error) return { ok: true as const };

    const fallback = await supabase
      .from("scheduled_payments")
      .update({ status: paid ? "paid" : "pending", paid_at: paidAt })
      .eq("id", rowId);

    if (!fallback.error) return { ok: true as const };

    const finalTry = await supabase.from("scheduled_payments").update({ status: paid ? "paid" : "pending" }).eq("id", rowId);
    if (!finalTry.error) return { ok: true as const };

    return { ok: false as const, message: finalTry.error.message || fallback.error.message || primary.error.message };
  };

  const insertPayment = async (payload: Record<string, unknown>) => {
    const withPaidFields = await supabase.from("scheduled_payments").insert(payload);
    if (!withPaidFields.error) return { ok: true as const };

    const fallbackPayload = { ...payload };
    delete fallbackPayload.is_paid;
    delete fallbackPayload.paid_at;
    const fallback = await supabase.from("scheduled_payments").insert(fallbackPayload);
    if (!fallback.error) return { ok: true as const };

    return { ok: false as const, message: fallback.error.message || withPaidFields.error.message };
  };

  const saveCommitment = async () => {
    if (!family?.id || !user?.id) return;

    const parsed = formSchema.safeParse({
      type,
      description,
      amountCents: Number(amountDigits || "0"),
      dueDate,
      categoryId,
      recurrence,
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    setSaving(true);
    setFormError(null);

    const payload = {
      description: parsed.data.description,
      amount: parsed.data.amountCents / 100,
      due_date: parsed.data.dueDate,
      type: parsed.data.type,
      recurrence: parsed.data.recurrence,
      category_id: parsed.data.categoryId === "none" ? null : parsed.data.categoryId,
      status: "pending",
      is_paid: false,
      paid_at: null,
    };

    const result = editing
      ? await supabase
          .from("scheduled_payments")
          .update(payload)
          .eq("id", editing.id)
      : await supabase.from("scheduled_payments").insert({ ...payload, user_id: user.id, family_id: family.id });

    setSaving(false);

    if (result.error) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.is_paid;
      delete fallbackPayload.paid_at;
      const fallback = editing
        ? await supabase.from("scheduled_payments").update(fallbackPayload).eq("id", editing.id)
        : await supabase.from("scheduled_payments").insert({ ...fallbackPayload, user_id: user.id, family_id: family.id });

      if (fallback.error) {
        toast.error(fallback.error.message || result.error.message || "Erro ao salvar compromisso");
        return;
      }
    }

    setOpen(false);
    toast.success(editing ? "Compromisso atualizado" : "Compromisso criado");
    await loadData();
  };

  const createNextRecurring = async (row: ScheduledRow) => {
    const recurrenceType = normalizeRecurrence(row);
    if (recurrenceType === "once") return null;

    const nextDue = recurrenceType === "weekly" ? addDays(row.due_date, 7) : recurrenceType === "monthly" ? addMonths(row.due_date, 1) : addYears(row.due_date, 1);

    const createRes = await insertPayment({
      description: row.description,
      amount: row.amount,
      due_date: nextDue,
      type: normalizeType(row.type),
      recurrence: recurrenceType,
      category_id: row.category_id,
      status: "pending",
      is_paid: false,
      paid_at: null,
      user_id: user?.id,
      family_id: family?.id,
    });

    if (!createRes.ok) {
      toast.error(createRes.message || "Pagamento marcado, mas não foi possível criar recorrência");
      return null;
    }

    return nextDue;
  };

  const togglePaid = async (row: ScheduledRow) => {
    const currentlyPaid = isPaid(row);

    const updateRes = await updatePaidState(row.id, !currentlyPaid);
    if (!updateRes.ok) {
      toast.error(updateRes.message || "Não foi possível atualizar o status");
      return;
    }

    if (!currentlyPaid) {
      const nextDue = await createNextRecurring(row);
      if (nextDue) {
        toast.success(`Pago! Próximo compromisso criado para ${formatDate(nextDue)}`);
      } else {
        toast.success("Compromisso marcado como pago");
      }
    } else {
      toast.success("Pagamento desfeito");
    }

    await loadData();
  };

  const deleteCommitment = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("scheduled_payments").delete().eq("id", deleteTarget.id);
    setDeleting(false);

    if (error) {
      toast.error(error.message || "Erro ao excluir compromisso");
      return;
    }

    setDeleteTarget(null);
    if (open && editing?.id === deleteTarget.id) setOpen(false);
    toast.success("Compromisso excluído");
    await loadData();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <Button onClick={openCreate} className="h-10 rounded-lg font-semibold">
          + Novo Compromisso
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
        <section className="rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <div className="mb-4 flex items-center justify-center gap-3">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => setViewMonth((prev) => startOfMonth(new Date(prev.getFullYear(), prev.getMonth() - 1, 1)))}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <p className="text-lg font-semibold text-foreground">{monthTitle.format(viewMonth).replace(/^./, (l) => l.toUpperCase())}</p>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => setViewMonth((prev) => startOfMonth(new Date(prev.getFullYear(), prev.getMonth() + 1, 1)))}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 border-b border-border/60">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((letter, index) => (
              <div key={`${letter}-${index}`} className="py-2 text-center text-xs font-semibold uppercase text-muted-foreground">
                {letter}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 border-l border-t border-border/60">
            {monthGrid.map((date) => {
              const iso = toISODate(date);
              const inMonth = date.getMonth() === viewMonth.getMonth();
              const selected = iso === selectedDate;
              const isToday = iso === todayIso();
              const rows = rowsByDate.get(iso) ?? [];
              const overdue = rows.some((row) => isOverdue(row));
              const allPaid = rows.length > 0 && rows.every((row) => isPaid(row));
              const visibleDots = rows.slice(0, 3);

              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelectedDate(iso)}
                  className={cn(
                    "group min-h-[50px] border-b border-r border-border/60 p-2 text-left transition-colors hover:bg-muted/30 sm:min-h-[80px]",
                    !inMonth && "bg-black/10",
                    selected && "border-accent bg-accent/10",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full text-sm",
                        inMonth ? "text-foreground" : "text-muted-foreground/50",
                        isToday && "bg-accent text-accent-foreground",
                      )}
                    >
                      {date.getDate()}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-1">
                    {overdue ? (
                      <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
                    ) : allPaid ? (
                      <span className="inline-flex h-2 w-2 items-center justify-center rounded-full bg-muted" />
                    ) : (
                      visibleDots.map((row) => {
                        const rowType = normalizeType(row.type);
                        return (
                          <span
                            key={row.id}
                            className={cn(
                              "h-2 w-2 rounded-full",
                              rowType === "payable" ? "bg-destructive" : "bg-[hsl(var(--success))]",
                            )}
                          />
                        );
                      })
                    )}

                    {rows.length > 3 && <span className="text-[10px] text-muted-foreground">+{rows.length - 3}</span>}
                    {allPaid && <Check className="h-3 w-3 text-muted-foreground" />}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border p-4" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
            <p className="mb-3 text-sm font-semibold text-foreground">Resumo do Mês</p>

            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <span className="text-muted-foreground">A pagar este mês</span>
                <span className="font-semibold text-destructive">{ptCurrency.format(monthSummary.payable)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <span className="text-muted-foreground">A receber este mês</span>
                <span className="font-semibold text-[hsl(var(--success))]">{ptCurrency.format(monthSummary.receivable)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <span className="text-muted-foreground">Atrasados</span>
                {monthSummary.overdueCount === 0 ? (
                  <span className="font-semibold text-[hsl(var(--success))]">Nenhum ✓</span>
                ) : (
                  <span className="font-bold text-destructive">{monthSummary.overdueCount}</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Próximos 7 dias</span>
                <span className="font-semibold text-yellow-300">{monthSummary.next7Count}</span>
              </div>
            </div>
          </div>

          {overdueRows.length > 0 && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
              <p className="mb-3 text-sm font-semibold text-destructive">⚠️ Atrasados</p>
              <div className="space-y-2">
                {overdueRows.slice(0, 6).map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-2 rounded-md border border-destructive/20 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{row.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {ptCurrency.format(Number(row.amount || 0))} • Venceu {formatDate(row.due_date)}
                      </p>
                    </div>
                    <Button size="sm" className="rounded-md" onClick={() => togglePaid(row)}>
                      Pagar agora
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border p-4" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
            <p className="mb-3 text-sm font-semibold text-foreground">Compromissos — {selectedDateLabel}</p>

            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : sortedDayRows.length === 0 ? (
              <div className="py-7 text-center">
                <CalendarCheck2 className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">Nenhum compromisso neste dia</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sortedDayRows.map((row) => {
                  const rowType = normalizeType(row.type);
                  const paid = isPaid(row);
                  const overdue = isOverdue(row);
                  const category = asSingle(row.categories);
                  const rec = normalizeRecurrence(row);

                  return (
                    <div key={row.id} className="rounded-lg border p-4" style={{ backgroundColor: "#0d0d14", borderColor: "#1e1e2e", borderLeftWidth: 3, borderLeftColor: rowType === "payable" ? "#ef4444" : "#22c55e" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            {rowType === "payable" ? <ArrowUpCircle className="h-4 w-4 text-destructive" /> : <ArrowDownCircle className="h-4 w-4 text-[hsl(var(--success))]" />}
                            <p className="text-sm font-semibold text-foreground">{row.description}</p>
                          </div>
                          <p className={cn("mt-1 text-sm font-semibold", rowType === "payable" ? "text-destructive" : "text-[hsl(var(--success))]", paid && "line-through opacity-70")}>
                            {ptCurrency.format(Number(row.amount || 0))}
                          </p>

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {category && (
                              <span className="inline-flex items-center gap-1">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color || "#6b7280" }} />
                                {category.name}
                              </span>
                            )}
                            {rec !== "once" && (
                              <span className="rounded-md bg-muted px-2 py-0.5">
                                {rec === "weekly" ? "Semanal" : rec === "monthly" ? "Mensal" : "Anual"}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right">
                          {paid ? (
                            <span className="rounded-md bg-[hsl(var(--success))/0.15] px-2 py-1 text-xs font-semibold text-[hsl(var(--success))]">Pago ✓</span>
                          ) : overdue ? (
                            <span className="rounded-md bg-destructive/20 px-2 py-1 text-xs font-semibold text-destructive">Atrasado!</span>
                          ) : (
                            <span className="rounded-md bg-yellow-500/20 px-2 py-1 text-xs font-semibold text-yellow-300">Pendente</span>
                          )}

                          <div className="mt-2 flex justify-end gap-1">
                            <Button size="sm" className="h-7 rounded-md px-2 text-xs" variant={paid ? "ghost" : "default"} onClick={() => togglePaid(row)}>
                              {paid ? "Desfazer" : "Marcar como pago"}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(row)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(row)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[480px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Compromisso" : "Novo Compromisso"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <div className="flex gap-2">
                <Button variant={type === "payable" ? "default" : "outline"} className="flex-1" onClick={() => setType("payable")}>
                  <ArrowUpCircle className="h-4 w-4 text-destructive" /> A Pagar
                </Button>
                <Button variant={type === "receivable" ? "default" : "outline"} className="flex-1" onClick={() => setType("receivable")}>
                  <ArrowDownCircle className="h-4 w-4 text-[hsl(var(--success))]" /> A Receber
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex: Aluguel, Fatura Nubank, Freelance..." maxLength={120} />
            </div>

            <div className="space-y-2">
              <Label>Valor</Label>
              <Input value={ptCurrency.format(Number(amountDigits || "0") / 100)} onChange={(event) => setAmountDigits(event.target.value.replace(/\D/g, ""))} inputMode="numeric" />
            </div>

            <div className="space-y-2">
              <Label>Data de vencimento</Label>
              <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent className="border-border bg-card text-card-foreground">
                  <SelectItem value="none">Sem categoria</SelectItem>
                  {filteredCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Recorrência</Label>
              <Select value={recurrence} onValueChange={(value: RecurrenceType) => setRecurrence(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-card text-card-foreground">
                  <SelectItem value="once">Única</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="monthly">Mensal</SelectItem>
                  <SelectItem value="yearly">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {recurrence !== "once" && (
              <p className="text-xs text-muted-foreground">Este compromisso será criado automaticamente no próximo período ao marcar como pago.</p>
            )}

            {editing && normalizeRecurrence(editing) !== "once" && (
              <p className="text-xs text-muted-foreground">Alterações afetam apenas este compromisso, não os futuros.</p>
            )}

            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {editing && (
                <Button
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteTarget(editing)}
                >
                  Excluir
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={saveCommitment} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(openState) => !openState && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir compromisso?</AlertDialogTitle>
            <AlertDialogDescription>Essa ação remove o compromisso permanentemente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteCommitment} disabled={deleting}>{deleting ? "Excluindo..." : "Excluir"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SchedulePage;

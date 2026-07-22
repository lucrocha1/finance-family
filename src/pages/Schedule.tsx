import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpCircle,
  CalendarCheck2,
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
  source?: "scheduled" | "transaction" | "debt" | "card_closing" | "card_due";
  source_id?: string;
  transfer_group_id?: string | null;
};

// Tipos de evento — legenda do calendário + cor das pills.
const EVENT_KINDS = [
  { key: "receivable", label: "A Receber", color: "#22c55e" },
  { key: "payable", label: "A Pagar", color: "#ef4444" },
  { key: "debt", label: "Dívida", color: "#eab308" },
  { key: "invoice", label: "Fatura", color: "#8b5cf6" },
] as const;
const KIND_COLOR: Record<string, string> = Object.fromEntries(EVENT_KINDS.map((k) => [k.key, k.color]));

const buildCardEvents = (
  cards: Array<{ id: string; name: string; closing_day: number | null; due_day: number | null }>,
  cardTransactions: Array<{ card_id: string | null; amount: number; date: string }>,
  monthStart: Date,
  monthEnd: Date,
): ScheduledRow[] => {
  const events: ScheduledRow[] = [];
  const clampDay = (y: number, m: number, d: number) => {
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(d, last));
  };

  cards.forEach((card) => {
    const closingDay = Number(card.closing_day || 0);
    const dueDay = Number(card.due_day || 0);
    if (!closingDay || !dueDay) return;

    // Generate closing + due events for THIS month and NEXT month, then filter into the requested range
    const candidates: Date[] = [
      new Date(monthStart.getFullYear(), monthStart.getMonth(), 1),
      new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1),
      new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1),
    ];

    candidates.forEach((monthRef) => {
      const closingDate = clampDay(monthRef.getFullYear(), monthRef.getMonth(), closingDay);
      const dueOffset = dueDay >= closingDay ? 0 : 1;
      const dueDate = clampDay(monthRef.getFullYear(), monthRef.getMonth() + dueOffset, dueDay);

      // Cycle of THIS closing: previous closing day + 1 → closingDate
      const prevClosing = clampDay(monthRef.getFullYear(), monthRef.getMonth() - 1, closingDay);
      // Convenção alinhada com lib/cardCycle: ciclo = [prevClosing (inclusive),
      // closingDate - 1]; compra no dia do fechamento entra na PRÓXIMA fatura.
      // Antes era [prevClosing+1, closingDate], deslocado 1 dia e divergindo do
      // CardInvoiceDetail/Dashboard pro mesmo cartão (F54).
      const cycleStartIso = toISODate(prevClosing);
      const cycleEndDate = new Date(closingDate);
      cycleEndDate.setDate(cycleEndDate.getDate() - 1);
      const cycleEndIso = toISODate(cycleEndDate);
      const total = cardTransactions
        .filter((tx) => tx.card_id === card.id && tx.date >= cycleStartIso && tx.date <= cycleEndIso)
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

      // Skip cycles with no purchases — no point showing a R$ 0,00 invoice.
      if (total <= 0) return;

      const closingIso = toISODate(closingDate);
      const dueIso = toISODate(dueDate);

      if (closingIso >= toISODate(monthStart) && closingIso <= toISODate(monthEnd)) {
        events.push({
          id: `card-close-${card.id}-${closingIso}`,
          description: `Fechamento — ${card.name}`,
          amount: total,
          due_date: closingIso,
          type: "info",
          recurrence: "monthly",
          recurrence_type: "monthly",
          category_id: null,
          status: "info",
          is_paid: null,
          paid_at: null,
          created_at: null,
          source: "card_closing",
          source_id: card.id,
        });
      }

      if (dueIso >= toISODate(monthStart) && dueIso <= toISODate(monthEnd)) {
        events.push({
          id: `card-due-${card.id}-${dueIso}`,
          description: `Vencimento — ${card.name}`,
          amount: total,
          due_date: dueIso,
          type: "payable",
          recurrence: "monthly",
          recurrence_type: "monthly",
          category_id: null,
          status: "pending",
          is_paid: false,
          paid_at: null,
          created_at: null,
          source: "card_due",
          source_id: card.id,
        });
      }
    });
  });

  // Dedupe by id (in case multiple monthRef candidates produced the same event)
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
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

// Mapeia uma transação pendente (não-cartão) para a linha da agenda.
const mapPendingTx = (t: Record<string, unknown>): ScheduledRow => ({
  id: `tx-${t.id}`,
  description: (t.description as string) ?? "Transação pendente",
  amount: Number(t.amount ?? 0),
  due_date: String(t.date ?? ""),
  type: (t.type as string) === "income" ? "receivable" : "payable",
  recurrence: "once",
  recurrence_type: "once",
  category_id: (t.category_id as string | null) ?? null,
  status: "pending",
  is_paid: false,
  paid_at: null,
  created_at: null,
  source: "transaction",
  source_id: String(t.id),
  transfer_group_id: (t.transfer_group_id as string | null) ?? null,
});
const TX_SELECT = "id, description, amount, date, type, status, category_id, transfer_group_id";
// Eventos informativos (type "info", ex.: fechamento de fatura) nunca são
// "atrasados" — não representam um pagamento a fazer.
const isOverdue = (row: ScheduledRow) => !isPaid(row) && row.type !== "info" && row.due_date < todayIso();

const SchedulePage = () => {
  const { family } = useFamily();
  const navigate = useNavigate();
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

    // RLS already restricts every financial table to user_id = auth.uid().
    // Keeping a redundant .eq("family_id", family.id) hides rows whose
    // family_id drifted from the current FamilyContext, so we drop it
    // across all queries.
    const [monthRes, dayRes, overdueRes, next7Res, categoriesRes, txMonthRes, debtsMonthRes, cardsRes, cardTxRes, txOverdueRes, txNext7Res, cardTxTodayRes] = await Promise.all([
      supabase
        .from("scheduled_payments")
        .select("*, categories(id, name, color, type)")
        .gte("due_date", toISODate(monthStart))
        .lte("due_date", toISODate(monthEnd)),
      supabase
        .from("scheduled_payments")
        .select("*, categories(id, name, color, type)")
        .eq("due_date", selectedDate),
      supabase
        .from("scheduled_payments")
        .select("*")
        .eq("is_paid", false)
        .lt("due_date", todayIso()),
      supabase
        .from("scheduled_payments")
        .select("*")
        .eq("is_paid", false)
        .gte("due_date", todayIso())
        .lte("due_date", nextWeek),
      supabase.from("categories").select("id, name, color, type").order("name", { ascending: true }),
      supabase
        .from("transactions")
        .select(TX_SELECT)
        .eq("status", "pending")
        .is("card_id", null)
        .gte("date", toISODate(monthStart))
        .lte("date", toISODate(monthEnd)),
      supabase
        .from("debts")
        .select("id, name, total_with_interest, original_amount, amount_paid, due_date, status, direction, has_installments, total_installments, installments_paid, installment_amount, start_date")
        // Só dívidas ativas: renegociadas são tratadas como encerradas
        // (substituídas por novos termos) e não aparecem na agenda/projeções.
        .eq("status", "active"),
      supabase.from("cards").select("id, name, closing_day, due_day"),
      supabase
        .from("transactions")
        .select("card_id, amount, date")
        .eq("type", "expense")
        .not("card_id", "is", null)
        .neq("status", "paid")
        .gte("date", addDays(toISODate(monthStart), -45))
        .lte("date", addDays(toISODate(monthEnd), 45)),
      // Atrasados e Próximos 7 são relativos a HOJE (globais), independentes do
      // mês visualizado — senão navegar o calendário escondia transações
      // atrasadas de meses anteriores e faturas do ciclo atual.
      supabase
        .from("transactions")
        .select(TX_SELECT)
        .eq("status", "pending")
        .is("card_id", null)
        .lt("date", todayIso()),
      supabase
        .from("transactions")
        .select(TX_SELECT)
        .eq("status", "pending")
        .is("card_id", null)
        .gte("date", todayIso())
        .lte("date", nextWeek),
      supabase
        .from("transactions")
        .select("card_id, amount, date")
        .eq("type", "expense")
        .not("card_id", "is", null)
        .neq("status", "paid")
        .gte("date", addDays(todayIso(), -75))
        .lte("date", addDays(todayIso(), 45)),
    ]);

    if (monthRes.error || dayRes.error || overdueRes.error || next7Res.error || categoriesRes.error) {
      toast.error("Erro ao carregar agenda");
      setLoading(false);
      return;
    }

    const txAsScheduled: ScheduledRow[] = ((txMonthRes.data ?? []) as Array<Record<string, unknown>>).map(mapPendingTx);
    const txOverdue: ScheduledRow[] = ((txOverdueRes.data ?? []) as Array<Record<string, unknown>>).map(mapPendingTx);
    const txNext7: ScheduledRow[] = ((txNext7Res.data ?? []) as Array<Record<string, unknown>>).map(mapPendingTx);

    // Expand parceled debts into one event per installment (start_date
    // + n months). Non-parceled debts get a single event at due_date.
    const debtsAsScheduled: ScheduledRow[] = ((debtsMonthRes.data ?? []) as Array<Record<string, unknown>>).flatMap((d) => {
      const direction = (d.direction as string) === "they_owe" ? "receivable" : "payable";
      const verbo = direction === "receivable" ? "Receber" : "Pagar";
      const baseLabel = (d.name as string) ?? "Dívida";
      const hasInstallments = Boolean(d.has_installments) && Number(d.total_installments ?? 0) >= 2;

      if (!hasInstallments) {
        const dueIso = String(d.due_date ?? "");
        if (!dueIso) return [];
        // Mostra o valor RESTANTE (total - já pago) e omite dívida já quitada.
        // O filtro status != 'paid_off' na query cobre o caso normal; isto é a
        // rede de segurança caso o status não tenha sido atualizado.
        const total = Number((d.total_with_interest as number | null) ?? d.original_amount ?? 0);
        const remaining = total - Number(d.amount_paid ?? 0);
        if (remaining <= 0.005) return [];
        return [{
          id: `debt-${d.id}`,
          description: `${verbo}: ${baseLabel}`,
          amount: remaining,
          due_date: dueIso,
          type: direction,
          recurrence: "once",
          recurrence_type: "once",
          category_id: null,
          status: "pending",
          is_paid: false,
          paid_at: null,
          created_at: null,
          source: "debt",
          source_id: String(d.id),
        }] as ScheduledRow[];
      }

      const totalInstallments = Number(d.total_installments ?? 0);
      const installmentsPaid = Number(d.installments_paid ?? 0);
      const installmentAmount = Number(d.installment_amount ?? 0);
      const startIso = String(d.start_date ?? "");
      if (!startIso) return [];
      const out: ScheduledRow[] = [];
      for (let i = 0; i < totalInstallments; i++) {
        // Parcela 1 vence start + 1 mês (mesma convenção do DebtDetail e do
        // trigger), com clamp de fim de mês via addMonths — setMonth cru
        // estourava para o mês seguinte quando start_date era dia 29-31.
        const dueIso = addMonths(startIso, i + 1);
        const number = i + 1;
        const isPaidParcel = number <= installmentsPaid;
        out.push({
          id: `debt-${d.id}-${number}`,
          description: `${verbo}: ${baseLabel} (${number}/${totalInstallments})`,
          amount: installmentAmount,
          due_date: dueIso,
          type: direction,
          recurrence: "monthly",
          recurrence_type: "monthly",
          category_id: null,
          status: isPaidParcel ? "paid" : "pending",
          is_paid: isPaidParcel,
          paid_at: null,
          created_at: null,
          source: "debt",
          source_id: String(d.id),
        });
      }
      return out;
    });

    const cardsList = ((cardsRes.data ?? []) as Array<{ id: string; name: string; closing_day: number | null; due_day: number | null }>);
    const cardTxs = ((cardTxRes.data ?? []) as Array<{ card_id: string | null; amount: number; date: string }>);
    const cardTxToday = ((cardTxTodayRes.data ?? []) as Array<{ card_id: string | null; amount: number; date: string }>);
    const cardEvents = buildCardEvents(cardsList, cardTxs, monthStart, monthEnd);
    // Compute window for each list separately
    const todayDate = new Date();
    const next7DateEnd = new Date(todayDate);
    next7DateEnd.setDate(next7DateEnd.getDate() + 8);
    // Atrasados/Próximos 7 usam compras ancoradas em HOJE (cardTxToday), não na
    // janela do mês visualizado — senão as faturas sumiam ao navegar o calendário.
    const cardEventsOverdue = buildCardEvents(cardsList, cardTxToday, new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1), new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - 1));
    const cardEventsNext7 = buildCardEvents(cardsList, cardTxToday, todayDate, next7DateEnd);

    const monthStartIso = toISODate(monthStart);
    const monthEndIso = toISODate(monthEnd);
    const debtsInMonth = debtsAsScheduled.filter((r) => r.due_date >= monthStartIso && r.due_date <= monthEndIso);
    const monthRows = [...((monthRes.data as ScheduledRow[] | null) ?? []), ...txAsScheduled, ...debtsInMonth, ...cardEvents];
    const dayRows = [
      ...((dayRes.data as ScheduledRow[] | null) ?? []),
      ...txAsScheduled.filter((r) => r.due_date === selectedDate),
      ...debtsAsScheduled.filter((r) => r.due_date === selectedDate),
      ...cardEvents.filter((r) => r.due_date === selectedDate),
    ];
    // Atrasados e Próximos 7: transações vêm das queries GLOBAIS (txOverdue/
    // txNext7), não do recorte do mês. O .filter(!isPaid) final tira parcelas de
    // dívida já quitadas e compromissos marcados só no status. Eventos de
    // fechamento (card_closing) são informativos e ficam de fora (só card_due).
    const overdueRows = [
      ...((overdueRes.data as ScheduledRow[] | null) ?? []),
      ...txOverdue,
      ...debtsAsScheduled.filter((r) => r.due_date < todayIso()),
      ...cardEventsOverdue.filter((r) => r.source === "card_due" && r.due_date < todayIso()),
    ].filter((r) => !isPaid(r));
    const next7Rows = [
      ...((next7Res.data as ScheduledRow[] | null) ?? []),
      ...txNext7,
      ...debtsAsScheduled.filter((r) => r.due_date >= todayIso() && r.due_date <= nextWeek),
      ...cardEventsNext7.filter((r) => r.source === "card_due" && r.due_date >= todayIso() && r.due_date <= nextWeek),
    ].filter((r) => !isPaid(r));

    setMonthRows(monthRows);
    setDayRows(dayRows);
    setOverdueRows(overdueRows);
    setNext7Rows(next7Rows);
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
    // row.type !== "info": o evento de FECHAMENTO de fatura é informativo e tem o
    // mesmo valor do vencimento; sem excluí-lo, a fatura era contada em dobro em
    // "A pagar este mês" (normalizeType("info") caía em "payable").
    const payable = monthRows.filter((row) => row.type !== "info" && normalizeType(row.type) === "payable" && !isPaid(row)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const receivable = monthRows.filter((row) => row.type !== "info" && normalizeType(row.type) === "receivable" && !isPaid(row)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
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
    if (row.source === "transaction") {
      navigate("/transactions");
      return;
    }
    if (row.source === "debt") {
      navigate(`/debts/${row.source_id}`);
      return;
    }
    if (row.source === "card_closing" || row.source === "card_due") {
      navigate(`/cards/${row.source_id}`);
      return;
    }
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
      // Ao editar, preserva o estado de pagamento — antes toda edição de um
      // compromisso já pago o revertia para pendente (status/is_paid/paid_at
      // fixos), fazendo sumir o "Pago ✓" e reabrir risco de pagar de novo.
      status: editing ? (editing.status ?? "pending") : "pending",
      is_paid: editing ? Boolean(editing.is_paid) : false,
      paid_at: editing ? editing.paid_at : null,
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

    // Evita duplicar: marcar -> desfazer -> marcar não deve criar 2 ocorrências.
    // Se já existe um compromisso igual naquela data, não cria de novo.
    const existing = await supabase
      .from("scheduled_payments")
      .select("id")
      .eq("description", row.description)
      .eq("due_date", nextDue)
      .eq("type", normalizeType(row.type))
      .limit(1);
    if (existing.data && existing.data.length > 0) return nextDue;

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
    if (row.source === "transaction" && row.source_id) {
      // Transferência: marca as DUAS pernas (mesmo transfer_group_id), senão o
      // efeito no saldo seria aplicado de um lado só.
      const base = supabase.from("transactions").update({ status: "paid" });
      const { error } = row.transfer_group_id
        ? await base.eq("transfer_group_id", row.transfer_group_id)
        : await base.eq("id", row.source_id);
      if (error) toast.error("Não foi possível marcar como paga");
      else {
        toast.success("Transação marcada como paga");
        await loadData();
      }
      return;
    }
    if (row.source === "debt") {
      navigate(`/debts/${row.source_id}`);
      return;
    }
    // Eventos de cartão não vivem em scheduled_payments (id sintético); o
    // pagamento da fatura é feito na tela do cartão. Antes caíam no update com
    // id inválido e davam erro.
    if (row.source === "card_closing" || row.source === "card_due") {
      navigate(`/cards/${row.source_id}`);
      return;
    }
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

  const monthTitleCap = monthTitle.format(viewMonth).replace(/^./, (l) => l.toUpperCase());
  const todayNow = new Date();
  const badgeMon = todayNow.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "").toUpperCase();
  const fmtDM = (d: Date) => d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
  const rangeLabel = `${fmtDM(startOfMonth(viewMonth))} – ${fmtDM(endOfMonth(viewMonth))}, ${viewMonth.getFullYear()}`;
  const prevMonth = () => setViewMonth((prev) => startOfMonth(new Date(prev.getFullYear(), prev.getMonth() - 1, 1)));
  const nextMonth = () => setViewMonth((prev) => startOfMonth(new Date(prev.getFullYear(), prev.getMonth() + 1, 1)));
  const goToday = () => { setViewMonth(startOfMonth(new Date())); setSelectedDate(todayIso()); };

  return (
    <div className="space-y-5">
      {/* Header estilo Vorne: badge de data + título + navegação + novo */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex w-16 flex-col items-center justify-center rounded-xl border border-border bg-card py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{badgeMon}</span>
            <span className="metric-value text-2xl font-bold leading-none text-foreground">{todayNow.getDate()}</span>
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">{monthTitleCap}</h2>
            <p className="text-sm text-muted-foreground">{rangeLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            <Button size="icon" variant="ghost" className="h-9 w-9 rounded-none" onClick={prevMonth} aria-label="Mês anterior">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <button type="button" onClick={goToday} className="border-x border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/40">
              Hoje
            </button>
            <Button size="icon" variant="ghost" className="h-9 w-9 rounded-none" onClick={nextMonth} aria-label="Próximo mês">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={openCreate} className="h-9 gap-1.5 rounded-lg font-semibold">+ Novo compromisso</Button>
        </div>
      </div>

      {/* Legenda de tipos */}
      <div className="flex flex-wrap gap-2">
        {EVENT_KINDS.map((k) => (
          <span key={k.key} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: k.color }} />
            {k.label}
          </span>
        ))}
      </div>

      <div className="space-y-4">
        <div className="glass-card overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-7 border-b border-border/60">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
              <div key={d} className="border-r border-border/60 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground last:border-r-0">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {monthGrid.map((date) => {
              const iso = toISODate(date);
              const inMonth = date.getMonth() === viewMonth.getMonth();
              const selected = iso === selectedDate;
              const isToday = iso === todayIso();
              const rows = rowsByDate.get(iso) ?? [];
              const visible = rows.slice(0, 4);

              return (
                <div
                  key={iso}
                  onClick={() => setSelectedDate(iso)}
                  className={cn(
                    "flex min-h-[92px] cursor-pointer flex-col gap-1 border-b border-r border-border/60 p-1.5 transition-colors last:border-r-0 hover:bg-muted/20 sm:min-h-[116px]",
                    !inMonth && "bg-black/20 text-muted-foreground/60",
                    selected && "ring-1 ring-inset ring-primary/40",
                  )}
                >
                  <div className="flex items-center justify-end">
                    <span
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                        isToday ? "bg-primary text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground/50",
                      )}
                    >
                      {date.getDate()}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1 overflow-hidden">
                    {visible.map((row) => {
                      const kind =
                        row.source === "debt"
                          ? "debt"
                          : row.source === "card_closing" || row.source === "card_due"
                            ? "invoice"
                            : normalizeType(row.type) === "receivable"
                              ? "receivable"
                              : "payable";
                      const color = KIND_COLOR[kind];
                      const paid = isPaid(row);
                      const overdue = isOverdue(row);
                      return (
                        <button
                          key={row.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(row);
                          }}
                          title={row.description}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight transition-opacity hover:opacity-80",
                            paid && "opacity-50",
                          )}
                          style={{ borderColor: `${color}55`, backgroundColor: `${color}1f`, color }}
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          <span className={cn("truncate font-medium", paid && "line-through")}>{row.description}</span>
                          {overdue && !paid && <span className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-destructive" />}
                        </button>
                      );
                    })}
                    {rows.length > 4 && <span className="px-1 text-[10px] font-medium text-muted-foreground">+{rows.length - 4} mais</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-4">
          <div className="glass-card rounded-xl border border-border bg-card p-4">
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
                      {normalizeType(row.type) === "receivable" ? "Receber" : "Pagar agora"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>

          <div className="glass-card rounded-xl border border-border bg-card p-4">
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
                  // Só compromissos manuais (scheduled_payments) podem ser
                  // editados/excluídos aqui; linhas agregadas (transação, dívida,
                  // fatura) têm id sintético e devem abrir a tela de origem.
                  const isManaged = !row.source || row.source === "scheduled";
                  const isInfo = row.source === "card_closing";

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
                            <span className="rounded-md bg-[hsl(var(--success))/0.15] px-2 py-1 text-xs font-semibold text-[hsl(var(--success))]">{normalizeType(row.type) === "receivable" ? "Recebido ✓" : "Pago ✓"}</span>
                          ) : overdue ? (
                            <span className="rounded-md bg-destructive/20 px-2 py-1 text-xs font-semibold text-destructive">Atrasado!</span>
                          ) : (
                            <span className="rounded-md bg-yellow-500/20 px-2 py-1 text-xs font-semibold text-yellow-300">Pendente</span>
                          )}

                          <div className="mt-2 flex justify-end gap-1">
                            {!isInfo && (
                              <Button size="sm" className="h-7 rounded-md px-2 text-xs" variant={paid ? "ghost" : "default"} onClick={() => togglePaid(row)}>
                                {row.source === "debt" || row.source === "card_due"
                                  ? "Ver"
                                  : paid ? "Desfazer" : rowType === "receivable" ? "Marcar recebido" : "Marcar como pago"}
                              </Button>
                            )}
                            {isManaged && (
                              <>
                                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Editar compromisso" onClick={() => openEdit(row)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label="Excluir compromisso" onClick={() => setDeleteTarget(row)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
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

          {!editing && (
            <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
              Use compromisso para <span className="font-semibold text-foreground">contas recorrentes ou pontuais</span> (luz, aluguel, salário). Para algo com <span className="font-semibold text-foreground">juros ou várias parcelas</span>, prefira cadastrar em <a href="/debts" className="font-semibold text-primary hover:underline">Dívidas & Empréstimos</a> — as parcelas aparecem aqui na agenda automaticamente.
            </div>
          )}

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

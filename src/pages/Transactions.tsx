import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CalendarIcon,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Loader2,
  Pencil,
  Repeat,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { z } from "zod";

import { PageSkeleton } from "@/components/PageSkeleton";
import { TagsInput } from "@/components/TagsInput";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { buildCSV, downloadCSV } from "@/lib/csvExport";
import { ensureFamily } from "@/lib/familyGuard";
import { generateRecurrencesForFamily } from "@/lib/generateRecurrences";
import { priorityLabel, type PlannedItemRow } from "@/lib/plannedItems";
import { PlannedItemDialog } from "@/components/PlannedItemDialog";
import { SchedulePlannedDialog } from "@/components/SchedulePlannedDialog";
import { cn } from "@/lib/utils";

type TxType = "income" | "expense" | "transfer" | string;
type TxStatus = "paid" | "pending" | string | null;
type StatusFilter = "all" | "paid" | "pending" | "overdue";

type TransactionRow = {
  id: string;
  family_id: string;
  user_id: string | null;
  category_id: string | null;
  account_id?: string | null;
  card_id: string | null;
  description: string | null;
  amount: number;
  type: TxType;
  status: TxStatus;
  date: string;
  notes?: string | null;
  is_installment?: boolean | null;
  installment_current?: number | null;
  installment_total?: number | null;
  installment_group_id?: string | null;
  is_recurring?: boolean | null;
  recurrence_type?: string | null;
  recurrence_parent_id?: string | null;
  linked_user_id?: string | null;
  linked_pair_id?: string | null;
  categories?: { id?: string; name?: string; color?: string | null; type?: string | null; icon?: string | null } | { id?: string; name?: string; color?: string | null; type?: string | null; icon?: string | null }[] | null;
  accounts?: { id?: string; name?: string; institution?: string | null } | { id?: string; name?: string; institution?: string | null }[] | null;
  cards?: { id?: string; name?: string; brand?: string | null } | { id?: string; name?: string; brand?: string | null }[] | null;
  profiles?: { full_name?: string | null; email?: string | null } | { full_name?: string | null; email?: string | null }[] | null;
};

type CategoryRow = { id: string; name: string; color: string | null; type: string | null; icon: string | null };
type AccountRow = { id: string; name: string; institution: string | null };
type CardRow = { id: string; name: string; brand: string | null };
type RecurrenceType = "weekly" | "monthly" | "yearly";

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const startOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth(), 1);
const endOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth() + 1, 0);
const formatMonthYear = (date: Date) => date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const asSingle = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));
const toISODate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const formatDateDDMM = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const PAGE_SIZE = 20;

const formSchema = z
  .object({
    type: z.enum(["income", "expense", "transfer"]),
    description: z.string().trim().min(2).max(120),
    amountCents: z.number().int().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["paid", "pending"]),
    categoryId: z.string().nullable(),
    accountId: z.string().nullable(),
    fromAccountId: z.string().nullable(),
    toAccountId: z.string().nullable(),
    cardId: z.string().nullable(),
    isInstallment: z.boolean(),
    installments: z.number().int().min(2).max(48),
    isRecurring: z.boolean(),
    recurrenceType: z.enum(["weekly", "monthly", "yearly"]),
    notes: z.string().trim().max(600).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.type !== "transfer" && !values.categoryId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["categoryId"], message: "Categoria obrigatória" });
    if (values.type === "transfer") {
      if (!values.fromAccountId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fromAccountId"], message: "Conta origem obrigatória" });
      if (!values.toAccountId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountId"], message: "Conta destino obrigatória" });
      if (values.fromAccountId && values.toAccountId && values.fromAccountId === values.toAccountId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountId"], message: "Contas devem ser diferentes" });
    }
    if (values.type === "expense" && !values.cardId && !values.accountId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accountId"], message: "Conta obrigatória" });
    if (values.type === "income" && !values.accountId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accountId"], message: "Conta obrigatória" });
  });

const getComputedStatus = (tx: TransactionRow): "paid" | "pending" | "overdue" => {
  if (tx.status === "paid") return "paid";
  const todayIso = toISODate(new Date());
  if (tx.date < todayIso) return "overdue";
  return "pending";
};

const TransactionsPage = () => {
  const { family, members } = useFamily();
  const { user } = useAuth();

  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);

  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense" | "transfer">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [cardFilter, setCardFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<TransactionRow | null>(null);
  const [editAllInstallments, setEditAllInstallments] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TransactionRow | null>(null);

  const [listView, setListView] = useState<"transactions" | "planned">("transactions");
  const [plannedItems, setPlannedItems] = useState<PlannedItemRow[]>([]);
  const [plannedKindFilter, setPlannedKindFilter] = useState<"all" | "expense" | "income">("all");
  const [plannedSort, setPlannedSort] = useState<"created" | "date" | "value" | "priority">("created");
  const [plannedDialogOpen, setPlannedDialogOpen] = useState(false);
  const [plannedKind, setPlannedKind] = useState<"expense" | "income">("expense");
  const [plannedEditing, setPlannedEditing] = useState<PlannedItemRow | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<PlannedItemRow | null>(null);

  const [formType, setFormType] = useState<"income" | "expense" | "transfer">("expense");
  const [description, setDescription] = useState("");
  const [amountDigits, setAmountDigits] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [status, setStatus] = useState<"paid" | "pending">("paid");
  const [categoryId, setCategoryId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [fromAccountId, setFromAccountId] = useState<string>("");
  const [toAccountId, setToAccountId] = useState<string>("");
  const [cardId, setCardId] = useState<string>("none");
  const [isInstallment, setIsInstallment] = useState(false);
  const [installments, setInstallments] = useState(2);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("monthly");
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [linkedMemberId, setLinkedMemberId] = useState<string>("none");
  const [formError, setFormError] = useState<string | null>(null);

  const monthStart = useMemo(() => startOfMonth(selectedMonth), [selectedMonth]);
  const monthEnd = useMemo(() => endOfMonth(selectedMonth), [selectedMonth]);

  const loadData = useCallback(async () => {
    if (!family?.id) {
      setTransactions([]);
      setCategories([]);
      setAccounts([]);
      setCards([]);
      setPlannedItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [txRes, categoriesRes, accountsRes, cardsRes, plannedRes] = await Promise.all([
      supabase
        .from("transactions")
        .select("*, categories(*), accounts(*), cards(*)")
        .gte("date", toISODate(monthStart))
        .lte("date", toISODate(monthEnd))
        .order("date", { ascending: false }),
      supabase.from("categories").select("id, name, color, type, icon").order("name", { ascending: true }),
      supabase.from("accounts").select("id, name, institution").order("name", { ascending: true }),
      supabase.from("cards").select("id, name, brand").order("name", { ascending: true }),
      supabase.from("planned_items").select("*").in("kind", ["expense", "income"]).order("created_at", { ascending: false }),
    ]);
    setPlannedItems((plannedRes.data as PlannedItemRow[] | null) ?? []);

    if (cardsRes.error) {
      console.warn("[Transactions] cards query failed:", cardsRes.error);
    }

    if (txRes.error) {
      const fallback = await supabase
        .from("transactions")
        .select("*, categories(*), accounts(*), cards(*)")
        .gte("date", toISODate(monthStart))
        .lte("date", toISODate(monthEnd))
        .order("date", { ascending: false });
      setTransactions((fallback.data as TransactionRow[] | null) ?? []);
    } else {
      setTransactions((txRes.data as TransactionRow[] | null) ?? []);
    }

    setCategories((categoriesRes.data as CategoryRow[] | null) ?? []);
    setAccounts((accountsRes.data as AccountRow[] | null) ?? []);
    setCards((cardsRes.data as CardRow[] | null) ?? []);
    setLoading(false);
  }, [family?.id, monthEnd, monthStart]);

  useEffect(() => {
    setPage(1);
  }, [typeFilter, statusFilter, categoryFilter, accountFilter, cardFilter, memberFilter, selectedMonth]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const memberMap = useMemo(() => {
    const map = new Map<string, { name: string; initials: string }>();
    members.forEach((member) => {
      const fullName = member.profiles?.full_name?.trim() || member.profiles?.email || "Usuário";
      const firstName = fullName.split(" ")[0] || "Usuário";
      const initials = fullName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("") || "U";
      map.set(member.user_id, { name: firstName, initials });
    });
    return map;
  }, [members]);

  const filteredCategories = useMemo(() => {
    if (formType === "transfer") return [];
    return categories.filter((c) => c.type === (formType === "income" ? "income" : "expense"));
  }, [categories, formType]);

  const filtered = useMemo(
    () =>
      transactions.filter((tx) => {
        if (typeFilter !== "all" && tx.type !== typeFilter) return false;
        if (statusFilter !== "all" && getComputedStatus(tx) !== statusFilter) return false;
        if (categoryFilter !== "all" && tx.category_id !== categoryFilter) return false;
        const account = tx.account_id ?? asSingle(tx.accounts)?.id ?? null;
        if (accountFilter !== "all" && account !== accountFilter) return false;
        if (cardFilter === "none" && tx.card_id) return false;
        if (cardFilter !== "all" && cardFilter !== "none" && tx.card_id !== cardFilter) return false;
        if (memberFilter !== "all" && tx.user_id !== memberFilter) return false;
        return true;
      }),
    [accountFilter, cardFilter, categoryFilter, memberFilter, statusFilter, transactions, typeFilter],
  );

  const totals = useMemo(() => {
    const income = filtered.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const expense = filtered.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    return { income, expense, balance: income - expense };
  }, [filtered]);

  const plannedStats = useMemo(() => {
    const expenses = plannedItems.filter((p) => p.kind === "expense");
    const incomes = plannedItems.filter((p) => p.kind === "income");
    const totalExpense = expenses.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalIncome = incomes.reduce((s, p) => s + Number(p.amount || 0), 0);
    const byPriority = { high: 0, medium: 0, low: 0 } as Record<"high" | "medium" | "low", number>;
    plannedItems.forEach((p) => { byPriority[p.priority] += 1; });
    const withDate = plannedItems
      .filter((p) => p.target_date)
      .sort((a, b) => (a.target_date! < b.target_date! ? -1 : 1));
    const nextItem = withDate[0] ?? null;
    return {
      totalExpense,
      totalIncome,
      balance: totalIncome - totalExpense,
      countExpense: expenses.length,
      countIncome: incomes.length,
      byPriority,
      nextItem,
      withoutDate: plannedItems.filter((p) => !p.target_date).length,
    };
  }, [plannedItems]);

  const plannedRows = useMemo(() => {
    const filteredP = plannedKindFilter === "all" ? plannedItems : plannedItems.filter((p) => p.kind === plannedKindFilter);
    const priorityWeight = { high: 0, medium: 1, low: 2 } as const;
    const sorted = [...filteredP].sort((a, b) => {
      if (plannedSort === "date") {
        if (!a.target_date && !b.target_date) return 0;
        if (!a.target_date) return 1;
        if (!b.target_date) return -1;
        return a.target_date < b.target_date ? -1 : 1;
      }
      if (plannedSort === "value") return Number(b.amount || 0) - Number(a.amount || 0);
      if (plannedSort === "priority") return priorityWeight[a.priority] - priorityWeight[b.priority];
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return sorted;
  }, [plannedItems, plannedKindFilter, plannedSort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filtered.length);
  const pageRows = filtered.slice(startIndex, endIndex);

  const amountCents = Number(amountDigits || "0");
  const amountValue = amountCents / 100;
  const amountDisplay = ptCurrency.format(amountValue);

  const resetForm = () => {
    setEditing(null);
    setEditAllInstallments(false);
    setFormType("expense");
    setDescription("");
    setAmountDigits("");
    setDate(new Date());
    setStatus("paid");
    setCategoryId("");
    setAccountId("");
    setFromAccountId("");
    setToAccountId("");
    setCardId("none");
    setIsInstallment(false);
    setInstallments(2);
    setIsRecurring(false);
    setRecurrenceType("monthly");
    setTags([]);
    setNotes("");
    setLinkedMemberId("none");
    setFormError(null);
  };

  const openCreate = () => {
    resetForm();
    setStatus(toISODate(new Date()) >= toISODate(new Date()) ? "paid" : "pending");
    setOpen(true);
  };

  const openEdit = (tx: TransactionRow) => {
    resetForm();
    setEditing(tx);
    setFormType((tx.type === "income" || tx.type === "expense" || tx.type === "transfer" ? tx.type : "expense") as "income" | "expense" | "transfer");
    setDescription(tx.description ?? "");
    setAmountDigits(String(Math.round(Number(tx.amount || 0) * 100)));
    setDate(new Date(`${tx.date}T00:00:00`));
    setStatus(tx.status === "paid" ? "paid" : "pending");
    setCategoryId(tx.category_id ?? "");
    setAccountId(tx.account_id ?? "");
    setFromAccountId(tx.type === "transfer" ? tx.account_id ?? "" : "");
    setToAccountId("");
    setCardId(tx.card_id ?? "none");
    setIsInstallment(Boolean(tx.is_installment));
    setInstallments(tx.installment_total ?? 2);
    setIsRecurring(Boolean(tx.is_recurring));
    setRecurrenceType(((tx.recurrence_type as RecurrenceType) || "monthly") as RecurrenceType);
    setTags(Array.isArray((tx as { tags?: string[] }).tags) ? (tx as { tags: string[] }).tags : []);
    setNotes(tx.notes ?? "");
    setOpen(true);
  };

  const canSave = useMemo(() => {
    if (!description.trim() || amountCents <= 0) return false;
    if (formType === "transfer") return Boolean(fromAccountId && toAccountId && fromAccountId !== toAccountId);
    if (formType === "income") return Boolean(categoryId && accountId);
    return Boolean(categoryId && (cardId !== "none" || accountId));
  }, [accountId, amountCents, cardId, categoryId, description, formType, fromAccountId, toAccountId]);

  const exportTransactionsCSV = () => {
    if (filtered.length === 0) {
      toast.error("Sem transações no período pra exportar");
      return;
    }
    const rows = filtered.map((tx) => {
      const cat = asSingle(tx.categories);
      const acc = asSingle(tx.accounts);
      const card = asSingle(tx.cards);
      return {
        date: formatDateDDMM(tx.date),
        description: tx.description ?? "",
        type: tx.type === "income" ? "Receita" : tx.type === "expense" ? "Despesa" : "Transferência",
        amount: Number(tx.amount || 0).toFixed(2).replace(".", ","),
        category: cat?.name ?? "",
        account: acc?.name ?? "",
        card: card?.name ?? "",
        status: tx.status === "paid" ? "Pago" : "Pendente",
        notes: tx.notes ?? "",
      };
    });
    const csv = buildCSV(rows, [
      { key: "date", label: "Data" },
      { key: "description", label: "Descrição" },
      { key: "type", label: "Tipo" },
      { key: "amount", label: "Valor" },
      { key: "category", label: "Categoria" },
      { key: "account", label: "Conta" },
      { key: "card", label: "Cartão" },
      { key: "status", label: "Status" },
      { key: "notes", label: "Notas" },
    ]);
    downloadCSV(csv, `transacoes_${formatMonthYear(selectedMonth).replace(/\s+/g, "_")}.csv`);
    toast.success(`${rows.length} transações exportadas`);
  };

  const persist = async () => {
    const ctx = ensureFamily(family?.id, user?.id);
    if (!ctx) return;
    const parsed = formSchema.safeParse({
      type: formType,
      description,
      amountCents,
      date: toISODate(date),
      status,
      categoryId: categoryId || null,
      accountId: accountId || null,
      fromAccountId: fromAccountId || null,
      toAccountId: toAccountId || null,
      cardId: cardId === "none" ? null : cardId,
      isInstallment,
      installments,
      isRecurring,
      recurrenceType,
      notes,
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    setSaving(true);
    setFormError(null);

    // Compras no cartão sempre nascem com status="pending" — o limite só é
    // liberado quando a fatura é paga (via "Pagar Fatura" em /cards/:id).
    // Se o user marcou como "Pago" no form e selecionou cartão, ignoramos
    // pra manter a lógica de limite/fluxo coerente.
    const isCardExpense = parsed.data.type === "expense" && Boolean(parsed.data.cardId);
    const baseStatus = isCardExpense ? "pending" : parsed.data.status;

    const base = {
      description: parsed.data.description.trim(),
      amount: parsed.data.amountCents / 100,
      date: parsed.data.date,
      notes: parsed.data.notes?.trim() || null,
      tags,
      status: baseStatus,
      category_id: parsed.data.type === "transfer" ? null : parsed.data.categoryId,
      account_id: parsed.data.type === "transfer" ? parsed.data.fromAccountId : parsed.data.type === "expense" && parsed.data.cardId ? null : parsed.data.accountId,
      card_id: parsed.data.type === "expense" ? parsed.data.cardId : null,
      is_recurring: parsed.data.type !== "transfer" ? parsed.data.isRecurring : false,
      recurrence_type: parsed.data.type !== "transfer" && parsed.data.isRecurring ? parsed.data.recurrenceType : null,
      recurrence_day: parsed.data.type !== "transfer" && parsed.data.isRecurring && parsed.data.recurrenceType === "monthly"
        ? Number(parsed.data.date.slice(8, 10))
        : null,
      is_installment: parsed.data.type === "expense" ? parsed.data.isInstallment : false,
    };

    let errorMessage: string | null = null;

    if (editing) {
      if (editAllInstallments && editing.installment_group_id) {
        const { data: rows, error } = await supabase
          .from("transactions")
          .select("id, installment_current, installment_total")
          .eq("installment_group_id", editing.installment_group_id)
          .order("installment_current", { ascending: true });
        if (error) errorMessage = error.message;
        if (!error && rows) {
          const count = rows.length;
          const totalCents = parsed.data.amountCents;
          const baseCents = Math.floor(totalCents / count);
          const remainder = totalCents % count;
          const updates = rows.map((row, index) =>
            supabase
              .from("transactions")
              .update({
                description: parsed.data.description.trim(),
                amount: (baseCents + (index < remainder ? 1 : 0)) / 100,
                category_id: base.category_id,
                account_id: base.account_id,
                card_id: base.card_id,
                notes: base.notes,
                status: base.status,
              })
              .eq("id", row.id),
          );
          const result = await Promise.all(updates);
          const failed = result.find((r) => r.error);
          if (failed?.error) errorMessage = failed.error.message;
        }
      } else {
        const { error } = await supabase
          .from("transactions")
          .update({
            description: base.description,
            amount: base.amount,
            date: base.date,
            category_id: base.category_id,
            account_id: base.account_id,
            card_id: base.card_id,
            notes: base.notes,
            status: base.status,
          })
          .eq("id", editing.id);
        if (error) errorMessage = error.message;
        // Espelha amount/date/description/notes pra outra ponta do par,
        // sem mexer em status/conta/categoria (cada lado mantém o seu).
        if (!error && editing.linked_pair_id) {
          const { error: pairErr } = await supabase.rpc("update_linked_pair", {
            p_pair_id: editing.linked_pair_id,
            p_amount: base.amount,
            p_date: base.date,
            p_description: base.description,
            p_notes: base.notes,
          });
          if (pairErr) errorMessage = pairErr.message;
        }
      }
    } else if (parsed.data.type === "transfer") {
      const payload = [
        { ...base, type: "transfer", account_id: parsed.data.fromAccountId, user_id: ctx.userId, family_id: ctx.familyId },
        { ...base, type: "transfer", account_id: parsed.data.toAccountId, user_id: ctx.userId, family_id: ctx.familyId },
      ];
      const { error } = await supabase.from("transactions").insert(payload);
      if (error) errorMessage = error.message;
    } else if (parsed.data.type === "expense" && parsed.data.isInstallment) {
      const count = parsed.data.installments;
      const groupId = crypto.randomUUID();
      const baseCents = Math.floor(parsed.data.amountCents / count);
      const remainder = parsed.data.amountCents % count;
      // Compras parceladas no cartão: TODAS as parcelas nascem pending
      // (a fatura precisa ser paga pra liberar o limite). Sem cartão (parcela
      // direto da conta), só a primeira herda o status do form.
      const isCardPurchase = Boolean(parsed.data.cardId);
      const rows = Array.from({ length: count }, (_, index) => {
        const due = new Date(date);
        due.setMonth(due.getMonth() + index);
        return {
          ...base,
          status: isCardPurchase ? "pending" : index === 0 ? base.status : "pending",
          description: `${parsed.data.description.trim()} (${index + 1}/${count})`,
          amount: (baseCents + (index < remainder ? 1 : 0)) / 100,
          date: toISODate(due),
          installment_group_id: groupId,
          installment_current: index + 1,
          installment_total: count,
          type: "expense",
          user_id: ctx.userId,
          family_id: ctx.familyId,
        };
      });
      const { error } = await supabase.from("transactions").insert(rows);
      if (error) errorMessage = error.message;
    } else if (linkedMemberId && linkedMemberId !== "none" && parsed.data.type !== "transfer" && !parsed.data.isInstallment) {
      // Transação vinculada com outro membro: cria o par via RPC.
      // O espelho aparece pra outra pessoa com tipo invertido + status pending.
      // Se for recorrente, ambos os parents nascem com is_recurring=true e
      // depois chamamos generate_linked_pair_recurrences pra criar pares
      // mensais até 90 dias.
      const recurringEnabled = parsed.data.isRecurring;
      const recurrenceDay = recurringEnabled && parsed.data.recurrenceType === "monthly"
        ? Number(parsed.data.date.slice(8, 10))
        : null;
      const { data: parentId, error } = await supabase.rpc("create_linked_transaction", {
        p_amount: parsed.data.amountCents / 100,
        p_date: parsed.data.date,
        p_description: parsed.data.description.trim(),
        p_type: parsed.data.type,
        p_status: baseStatus,
        p_other_user_id: linkedMemberId,
        p_category_id: parsed.data.type === "transfer" ? null : parsed.data.categoryId,
        p_account_id: parsed.data.type === "transfer" ? parsed.data.fromAccountId : parsed.data.type === "expense" && parsed.data.cardId ? null : parsed.data.accountId,
        p_notes: parsed.data.notes?.trim() || null,
        p_is_recurring: recurringEnabled,
        p_recurrence_type: recurringEnabled ? parsed.data.recurrenceType : null,
        p_recurrence_day: recurrenceDay,
        p_recurrence_end_date: null,
      });
      if (error) errorMessage = error.message;
      if (!error && recurringEnabled && parentId) {
        const { error: genErr } = await supabase.rpc("generate_linked_pair_recurrences", { p_my_parent_id: parentId });
        if (genErr) console.warn("[linked-recurrence] generate failed:", genErr.message);
      }
    } else {
      const { error } = await supabase.from("transactions").insert({ ...base, type: parsed.data.type, user_id: ctx.userId, family_id: ctx.familyId });
      if (error) errorMessage = error.message;
    }

    if (errorMessage) {
      setFormError("Não foi possível salvar a transação");
      setSaving(false);
      return;
    }

    // Recorrência recém-criada: gera instâncias futuras imediatamente sem
    // esperar o cooldown do hook. Limpa também a chave de cooldown pra
    // não atrasar a próxima rodada.
    if (!editing && parsed.data.type !== "transfer" && parsed.data.isRecurring && family?.id && user?.id) {
      try {
        await generateRecurrencesForFamily(family.id, user.id);
        localStorage.removeItem(`finance-family-recurrences-last-run-${family.id}`);
      } catch {
        /* swallow */
      }
    }

    await loadData();
    setSaving(false);
    setOpen(false);
    toast.success(editing ? "Transação atualizada!" : "Transação criada!");
    resetForm();
  };

  const openDelete = (tx: TransactionRow) => {
    setDeleteTarget(tx);
    setDeleteOpen(true);
  };

  const executeDelete = async (mode: "one" | "remaining" | "all" | "pair") => {
    if (!deleteTarget) return;
    if (mode === "pair" && deleteTarget.linked_pair_id) {
      const { error } = await supabase.rpc("delete_linked_pair", { p_pair_id: deleteTarget.linked_pair_id });
      if (error) {
        toast.error("Não foi possível excluir o par");
        return;
      }
      setDeleteOpen(false);
      setDeleteTarget(null);
      await loadData();
      toast.success("Par excluído nos dois membros");
      return;
    }
    const isRecurringTarget = Boolean(deleteTarget.is_recurring) || Boolean(deleteTarget.recurrence_parent_id);
    const recurrenceRootId = deleteTarget.recurrence_parent_id ?? (deleteTarget.is_recurring ? deleteTarget.id : null);
    let query = supabase.from("transactions").delete();

    if (mode === "one") {
      query = query.eq("id", deleteTarget.id);
    } else if (deleteTarget.installment_group_id) {
      if (mode === "remaining") {
        query = query.eq("installment_group_id", deleteTarget.installment_group_id).gte("installment_current", deleteTarget.installment_current ?? 1);
      } else {
        query = query.eq("installment_group_id", deleteTarget.installment_group_id);
      }
    } else if (isRecurringTarget && recurrenceRootId) {
      if (mode === "remaining") {
        query = query
          .or(`id.eq.${recurrenceRootId},recurrence_parent_id.eq.${recurrenceRootId}`)
          .gte("date", deleteTarget.date);
      } else {
        query = query.or(`id.eq.${recurrenceRootId},recurrence_parent_id.eq.${recurrenceRootId}`);
      }
    } else {
      query = query.eq("id", deleteTarget.id);
    }

    const { error } = await query;
    if (error) {
      toast.error("Não foi possível excluir a transação");
      return;
    }

    setDeleteOpen(false);
    setDeleteTarget(null);
    if (editing?.id === deleteTarget.id) {
      setOpen(false);
      resetForm();
    }
    await loadData();
    toast.success("Transação excluída");
  };

  const markPaid = async (tx: TransactionRow) => {
    const { error } = await supabase.from("transactions").update({ status: "paid" }).eq("id", tx.id);
    if (error) {
      toast.error("Não foi possível atualizar o status");
      return;
    }
    await loadData();
    toast.success("Transação marcada como paga");
  };

  const openPlannedCreate = (kind: "expense" | "income") => {
    setPlannedKind(kind);
    setPlannedEditing(null);
    setPlannedDialogOpen(true);
  };
  const openPlannedEdit = (item: PlannedItemRow) => {
    setPlannedKind(item.kind === "income" ? "income" : "expense");
    setPlannedEditing(item);
    setPlannedDialogOpen(true);
  };
  const openSchedule = (item: PlannedItemRow) => {
    setScheduleTarget(item);
    setScheduleDialogOpen(true);
  };
  const deletePlanned = async (item: PlannedItemRow) => {
    const { error } = await supabase.from("planned_items").delete().eq("id", item.id);
    if (error) {
      toast.error(error.message || "Erro ao excluir");
      return;
    }
    toast.success("Planejado excluído");
    await loadData();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-secondary/40 p-1">
          <button
            type="button"
            onClick={() => setListView("transactions")}
            className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", listView === "transactions" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
          >
            Transações
          </button>
          <button
            type="button"
            onClick={() => setListView("planned")}
            className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", listView === "planned" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
          >
            Planejadas {plannedItems.length > 0 && <span className="ml-1 opacity-70">({plannedItems.length})</span>}
          </button>
        </div>

        {listView === "transactions" ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportTransactionsCSV} className="h-10 rounded-lg" aria-label="Exportar CSV">
              Exportar CSV
            </Button>
            <Button onClick={openCreate} className="h-10 rounded-lg px-4 font-semibold">+ Nova Transação</Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button onClick={() => openPlannedCreate("expense")} variant="outline" className="h-10 rounded-lg px-3 font-semibold">+ Despesa</Button>
            <Button onClick={() => openPlannedCreate("income")} variant="outline" className="h-10 rounded-lg px-3 font-semibold">+ Receita</Button>
          </div>
        )}
      </div>

      {listView === "planned" ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            Despesas e receitas que você quer fazer no futuro mas <span className="font-semibold text-foreground">ainda sem data</span>. Não entram em Dashboard, Caixa Projetado, Agenda ou sino. Quando definir uma data, clique em Agendar para virar pendente.
          </div>

          {plannedItems.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Card className="rounded-xl border-border bg-card">
                  <CardContent className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Despesas planejadas</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-destructive">{ptCurrency.format(plannedStats.totalExpense)}</p>
                    <p className="text-xs text-muted-foreground">{plannedStats.countExpense} {plannedStats.countExpense === 1 ? "item" : "itens"}</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl border-border bg-card">
                  <CardContent className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Receitas planejadas</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-success">{ptCurrency.format(plannedStats.totalIncome)}</p>
                    <p className="text-xs text-muted-foreground">{plannedStats.countIncome} {plannedStats.countIncome === 1 ? "item" : "itens"}</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl border-border bg-card">
                  <CardContent className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo planejado</p>
                    <p className={cn("mt-1 text-xl font-bold tabular-nums", plannedStats.balance >= 0 ? "text-foreground" : "text-destructive")}>
                      {plannedStats.balance >= 0 ? "+" : ""}{ptCurrency.format(plannedStats.balance)}
                    </p>
                    <p className="text-xs text-muted-foreground">Receitas − despesas</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl border-border bg-card">
                  <CardContent className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Próximo alvo</p>
                    {plannedStats.nextItem ? (
                      <>
                        <p className="mt-1 truncate text-sm font-bold text-foreground">{plannedStats.nextItem.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(`${plannedStats.nextItem.target_date}T00:00:00`).toLocaleDateString("pt-BR")} · {ptCurrency.format(Number(plannedStats.nextItem.amount || 0))}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="mt-1 text-sm font-bold text-foreground">Sem data definida</p>
                        <p className="text-xs text-muted-foreground">{plannedStats.withoutDate} sem alvo</p>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-xl border-border bg-card">
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por prioridade</p>
                    <p className="text-xs text-muted-foreground">{plannedItems.length} no total</p>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
                    {(["high", "medium", "low"] as const).map((p) => {
                      const count = plannedStats.byPriority[p];
                      if (count === 0) return null;
                      const width = (count / plannedItems.length) * 100;
                      const color = p === "high" ? "bg-destructive" : p === "medium" ? "bg-warning" : "bg-info";
                      return <div key={p} className={cn("h-full", color)} style={{ width: `${width}%` }} />;
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" />Alta {plannedStats.byPriority.high}</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" />Média {plannedStats.byPriority.medium}</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-info" />Baixa {plannedStats.byPriority.low}</span>
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg bg-secondary p-1">
                  {(["all", "expense", "income"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setPlannedKindFilter(k)}
                      className={cn("rounded-md px-3 py-1 text-xs font-semibold", plannedKindFilter === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                    >
                      {k === "all" ? "Todos" : k === "expense" ? "Despesas" : "Receitas"}
                    </button>
                  ))}
                </div>
                <Select value={plannedSort} onValueChange={(v) => setPlannedSort(v as typeof plannedSort)}>
                  <SelectTrigger className="h-8 w-auto rounded-lg border-border bg-secondary text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-card">
                    <SelectItem value="created">Mais recentes</SelectItem>
                    <SelectItem value="date">Por data alvo</SelectItem>
                    <SelectItem value="value">Por valor</SelectItem>
                    <SelectItem value="priority">Por prioridade</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {plannedItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-10 text-center">
              <p className="text-base font-semibold text-foreground">Nenhuma transação planejada</p>
              <p className="mt-1 text-sm text-muted-foreground">Adicione algo que você quer comprar ou receber sem precisar de data agora.</p>
            </div>
          ) : (
            <Card className="rounded-lg border-border bg-card">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Data alvo</TableHead>
                      <TableHead>Prioridade</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plannedRows.map((item) => (
                      <TableRow key={item.id} className="border-b border-border">
                        <TableCell className="px-4 py-3 text-sm font-medium text-foreground">{item.description}</TableCell>
                        <TableCell className="px-4 py-3 text-sm">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            item.kind === "income" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                            {item.kind === "income" ? "Receita" : "Despesa"}
                          </span>
                        </TableCell>
                        <TableCell className={cn("px-4 py-3 text-right text-sm font-semibold tabular-nums",
                          item.kind === "income" ? "text-success" : "text-destructive")}>
                          {item.kind === "income" ? "+" : "-"}{ptCurrency.format(item.amount)}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                          {item.target_date ? new Date(`${item.target_date}T00:00:00`).toLocaleDateString("pt-BR") : <span className="opacity-50">—</span>}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground">{priorityLabel[item.priority]}</TableCell>
                        <TableCell className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" onClick={() => openSchedule(item)} className="h-8">Agendar</Button>
                            <Button size="sm" variant="ghost" onClick={() => openPlannedEdit(item)} className="h-8 w-8 p-0"><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => void deletePlanned(item)} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}

      {listView === "transactions" && (<>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-2 py-1.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <p className="min-w-[150px] text-center text-sm font-bold text-foreground">{capitalize(formatMonthYear(selectedMonth))}</p>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[{ value: "all", label: "Todos", activeClass: "text-muted-foreground" }, { value: "income", label: "Receita", activeClass: "text-success" }, { value: "expense", label: "Despesa", activeClass: "text-destructive" }, { value: "transfer", label: "Transferência", activeClass: "text-info" }].map((option) => (
            <button key={option.value} type="button" onClick={() => setTypeFilter(option.value as "all" | "income" | "expense" | "transfer")} className={cn("h-[38px] rounded-lg border border-border bg-secondary px-3 text-sm font-semibold", typeFilter === option.value ? option.activeClass : "text-muted-foreground")}>{option.label}</button>
          ))}
        </div>

        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
          <SelectTrigger className="h-[38px] w-[160px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent className="border-border bg-card text-card-foreground"><SelectItem value="all">Todos</SelectItem><SelectItem value="paid">Pago</SelectItem><SelectItem value="pending">Pendente</SelectItem><SelectItem value="overdue">Atrasado</SelectItem></SelectContent>
        </Select>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}><SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Categoria" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground"><SelectItem value="all">Todas</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent></Select>
        <Select value={accountFilter} onValueChange={setAccountFilter}><SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Conta" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground"><SelectItem value="all">Todas</SelectItem>{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent></Select>
        <Select value={cardFilter} onValueChange={setCardFilter}><SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Cartão" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground"><SelectItem value="all">Todos</SelectItem><SelectItem value="none">Sem cartão</SelectItem>{cards.map((card) => <SelectItem key={card.id} value={card.id}>{card.name}</SelectItem>)}</SelectContent></Select>
        <Select value={memberFilter} onValueChange={setMemberFilter}><SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Membro" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground"><SelectItem value="all">Todos</SelectItem>{members.map((member) => <SelectItem key={member.user_id} value={member.user_id}>{member.profiles?.full_name || member.profiles?.email || "Usuário"}</SelectItem>)}</SelectContent></Select>
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        <Card className="flex-1 rounded-lg border-border bg-card"><CardContent className="flex items-center gap-3 p-4"><span className="rounded-full bg-success/20 p-2 text-success"><ArrowUp className="h-4 w-4" /></span><div><p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">Receitas</p><p className="text-lg font-semibold tabular-nums text-success">{ptCurrency.format(totals.income)}</p></div></CardContent></Card>
        <Card className="flex-1 rounded-lg border-border bg-card"><CardContent className="flex items-center gap-3 p-4"><span className="rounded-full bg-destructive/20 p-2 text-destructive"><ArrowDown className="h-4 w-4" /></span><div><p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">Despesas</p><p className="text-lg font-semibold tabular-nums text-destructive">{ptCurrency.format(totals.expense)}</p></div></CardContent></Card>
        <Card className="flex-1 rounded-lg border-border bg-card"><CardContent className="p-4"><p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">Saldo</p><p className={cn("text-lg font-semibold tabular-nums", totals.balance >= 0 ? "text-success" : "text-destructive")}>{ptCurrency.format(totals.balance)}</p></CardContent></Card>
      </div>

      <Card className="rounded-xl border-border bg-card">
        <CardContent className="p-0">
          {loading ? (
            <PageSkeleton rows={6} withHeader={false} />
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 text-center"><ArrowLeftRight className="h-10 w-10 text-[hsl(var(--placeholder-icon))]" /><p className="text-base font-semibold text-foreground">Nenhuma transação encontrada</p><p className="text-sm text-muted-foreground">Adicione sua primeira transação</p><Button className="mt-2" onClick={openCreate}>+ Nova Transação</Button></div>
          ) : (
            <>
              <Table>
                <TableHeader><TableRow className="border-b border-border bg-background hover:bg-background"><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Data</TableHead><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Descrição</TableHead><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Categoria</TableHead><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Valor</TableHead><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Conta</TableHead><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Membro</TableHead><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground text-right">Ações</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pageRows.map((tx) => {
                    const computedStatus = getComputedStatus(tx);
                    const category = asSingle(tx.categories);
                    const account = asSingle(tx.accounts);
                    const card = asSingle(tx.cards);
                    const profileJoined = asSingle(tx.profiles);
                    const member = tx.user_id ? memberMap.get(tx.user_id) : null;
                    const memberName = member?.name || profileJoined?.full_name?.split(" ")[0] || "Usuário";
                    const memberInitials = member?.initials || memberName.slice(0, 1).toUpperCase();
                    const installmentLabel = tx.installment_current && tx.installment_total ? ` (${tx.installment_current}/${tx.installment_total})` : "";
                    const isRecurringRow = Boolean(tx.is_recurring) || Boolean(tx.recurrence_parent_id);
                    const linkedMember = tx.linked_user_id ? memberMap.get(tx.linked_user_id) : null;
                    const valuePrefix = tx.type === "income" ? "+" : tx.type === "expense" ? "-" : "";
                    const valueColor = tx.type === "income" ? "text-success" : tx.type === "expense" ? "text-destructive" : "text-info";

                    return (
                      <TableRow key={tx.id} className="group cursor-pointer border-b border-border bg-transparent hover:bg-secondary" onClick={() => openEdit(tx)}>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground">{formatDateDDMM(tx.date)}</TableCell>
                        <TableCell className="px-4 py-3 text-sm font-medium text-foreground"><span>{tx.description || "Sem descrição"}</span>{installmentLabel && <span className="text-muted-foreground">{installmentLabel}</span>}{isRecurringRow && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary"><Repeat className="h-3 w-3" />Recorrente</span>}{tx.linked_pair_id && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-semibold text-info">↔ {linkedMember?.name ?? "Vinculada"}</span>}</TableCell>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: category?.color || "hsl(var(--muted-foreground))" }} />{category?.name || "Sem categoria"}</div></TableCell>
                        <TableCell className={cn("px-4 py-3 text-sm font-semibold tabular-nums", valueColor)}>
                          {computedStatus !== "paid" && (
                            <span className={cn("mr-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", computedStatus === "overdue" ? "bg-destructive/20 text-destructive" : "bg-warning/20 text-warning")}>{computedStatus === "overdue" ? "Atrasado" : "Pendente"}</span>
                          )}
                          {valuePrefix}
                          {ptCurrency.format(Number(tx.amount || 0))}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground">{tx.card_id ? <span className="inline-flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" />{card?.name || "Cartão"}</span> : account?.name || "Sem conta"}</TableCell>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-foreground">{memberInitials}</span><span className="text-foreground">{memberName}</span></span></TableCell>
                        <TableCell className="px-4 py-3"><div className="flex justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100"><button type="button" className="text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); openEdit(tx); }}><Pencil className="h-4 w-4" /></button>{computedStatus !== "paid" && <button type="button" className="text-muted-foreground hover:text-success" onClick={(e) => { e.stopPropagation(); void markPaid(tx); }}><CheckCircle className="h-4 w-4" /></button>}<button type="button" className="text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); openDelete(tx); }}><Trash2 className="h-4 w-4" /></button></div></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground"><p>Mostrando {filtered.length === 0 ? 0 : startIndex + 1}-{endIndex} de {filtered.length}</p><div className="flex items-center gap-2"><Button variant="outline" className="h-8 rounded-lg border-border bg-secondary" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={currentPage <= 1}>Anterior</Button><Button variant="outline" className="h-8 rounded-lg border-border bg-secondary" onClick={() => setPage((prev) => Math.min(prev + 1, pageCount))} disabled={currentPage >= pageCount}>Próxima</Button></div></div>
            </>
          )}
        </CardContent>
      </Card>
      </>)}

      <PlannedItemDialog
        open={plannedDialogOpen}
        kind={plannedKind}
        editing={plannedEditing}
        onClose={() => setPlannedDialogOpen(false)}
        onSaved={() => void loadData()}
      />

      <SchedulePlannedDialog
        open={scheduleDialogOpen}
        item={scheduleTarget}
        onClose={() => setScheduleDialogOpen(false)}
        onScheduled={() => void loadData()}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-[520px] overflow-y-auto rounded-2xl border-border bg-card p-6 shadow-2xl">
          <DialogHeader><DialogTitle className="text-xl font-bold text-foreground">{editing ? "Editar Transação" : "Nova Transação"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {(() => {
              const showTransfer = accounts.length >= 2 || (editing && editing.type === "transfer");
              const types = [
                { key: "income", label: "Receita", icon: TrendingUp, active: "border-success bg-success/15 text-success", inactive: "border-success/60 text-success/80" },
                { key: "expense", label: "Despesa", icon: TrendingDown, active: "border-destructive bg-destructive/15 text-destructive", inactive: "border-destructive/60 text-destructive/80" },
                ...(showTransfer
                  ? [{ key: "transfer", label: "Transferência", icon: ArrowLeftRight, active: "border-info bg-info/15 text-info", inactive: "border-info/60 text-info/80" }]
                  : []),
              ];
              return (
                <div className={cn("grid gap-2", showTransfer ? "grid-cols-3" : "grid-cols-2")}>
                  {types.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      disabled={Boolean(editing)}
                      onClick={() => setFormType(item.key as "income" | "expense" | "transfer")}
                      className={cn("h-10 rounded-lg border text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60", formType === item.key ? item.active : item.inactive)}
                    >
                      <span className="inline-flex items-center gap-1">
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })()}

            {editing?.is_installment && editing.installment_current && editing.installment_total && (
              <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3"><p className="text-sm text-foreground">Parcela {editing.installment_current} de {editing.installment_total}</p><div className="flex items-center justify-between"><Label className="text-sm text-foreground">Editar todas as parcelas?</Label><Switch checked={editAllInstallments} onCheckedChange={setEditAllInstallments} /></div></div>
            )}

            <div className="space-y-2"><Label className="text-xs text-muted-foreground">Descrição</Label><Input value={description} onChange={(e) => setDescription(e.target.value.slice(0, 120))} placeholder="Ex: Supermercado, Salário, Aluguel..." className="h-[42px] rounded-lg border-border bg-secondary text-foreground" /></div>
            <div className="space-y-2"><Label className="text-xs text-muted-foreground">Valor</Label><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">R$</span><Input inputMode="numeric" value={amountDisplay.replace("R$", "").trim()} onChange={(e) => setAmountDigits(e.target.value.replace(/\D/g, "").slice(0, 12))} className="h-[42px] rounded-lg border-border bg-secondary pl-11 text-lg font-semibold text-foreground" /></div></div>
            <div className="space-y-2"><Label className="text-xs text-muted-foreground">Data</Label><Popover><PopoverTrigger asChild><Button type="button" variant="outline" className="h-[42px] w-full justify-start rounded-lg border-border bg-secondary text-left font-normal"><CalendarIcon className="mr-2 h-4 w-4" />{date.toLocaleDateString("pt-BR")}</Button></PopoverTrigger><PopoverContent align="start" className="w-auto border-border bg-card p-0"><Calendar mode="single" selected={date} onSelect={(value) => value && setDate(value)} initialFocus className="p-3 pointer-events-auto" /></PopoverContent></Popover></div>
            <div className="space-y-2"><Label className="text-xs text-muted-foreground">Status</Label><Select value={status} onValueChange={(value) => setStatus(value as "paid" | "pending")}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground"><SelectItem value="paid">Pago</SelectItem><SelectItem value="pending">Pendente</SelectItem></SelectContent></Select></div>

            {formType !== "transfer" && (
              <div className="space-y-2"><Label className="text-xs text-muted-foreground">Categoria</Label>{filteredCategories.length ? <Select value={categoryId || "none"} onValueChange={(value) => setCategoryId(value === "none" ? "" : value)}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground">{filteredCategories.map((category) => <SelectItem key={category.id} value={category.id}><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color || "hsl(var(--muted-foreground))" }} />{category.icon ? `${category.icon} ` : ""}{category.name}</span></SelectItem>)}</SelectContent></Select> : <p className="text-sm text-muted-foreground">Nenhuma categoria</p>}</div>
            )}

            {formType === "transfer" ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2"><div className="space-y-2"><Label className="text-xs text-muted-foreground">De (conta origem)</Label><Select value={fromAccountId || "none"} onValueChange={(value) => setFromAccountId(value === "none" ? "" : value)}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground">{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label className="text-xs text-muted-foreground">Para (conta destino)</Label><Select value={toAccountId || "none"} onValueChange={(value) => setToAccountId(value === "none" ? "" : value)}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground">{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent></Select></div></div>
            ) : formType === "expense" ? (
              <>
                <div className="space-y-2"><Label className="text-xs text-muted-foreground">Cartão (opcional)</Label><Select value={cardId} onValueChange={setCardId}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground"><SelectItem value="none">Sem cartão</SelectItem>{cards.map((card) => <SelectItem key={card.id} value={card.id}>{card.name}</SelectItem>)}</SelectContent></Select>{cards.length === 0 && <p className="text-xs text-muted-foreground">Nenhum cartão cadastrado. <button type="button" onClick={() => { setOpen(false); window.location.href = "/cards"; }} className="font-semibold text-primary underline-offset-2 hover:underline">Cadastrar agora</button></p>}</div>
                {cardId === "none" && <div className="space-y-2"><Label className="text-xs text-muted-foreground">Conta</Label><Select value={accountId || "none"} onValueChange={(value) => setAccountId(value === "none" ? "" : value)}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground">{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent></Select></div>}
              </>
            ) : (
              <div className="space-y-2"><Label className="text-xs text-muted-foreground">Conta</Label><Select value={accountId || "none"} onValueChange={(value) => setAccountId(value === "none" ? "" : value)}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground">{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent></Select></div>
            )}

            {formType !== "transfer" && !editing && (
              <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium text-foreground">Repetir</Label>
                    <p className="text-xs text-muted-foreground">Cria uma {formType === "income" ? "receita" : "despesa"} recorrente</p>
                  </div>
                  <Switch
                    checked={isRecurring}
                    onCheckedChange={(checked) => {
                      setIsRecurring(checked);
                      if (checked) setIsInstallment(false);
                    }}
                  />
                </div>
                {isRecurring && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Frequência</Label>
                    <Select value={recurrenceType} onValueChange={(value) => setRecurrenceType(value as RecurrenceType)}>
                      <SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="border-border bg-card text-card-foreground">
                        <SelectItem value="weekly">Semanal</SelectItem>
                        <SelectItem value="monthly">Mensal</SelectItem>
                        <SelectItem value="yearly">Anual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {formType === "expense" && !editing && (
              <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium text-foreground">Parcelar</Label>
                    <p className="text-xs text-muted-foreground">Divide o valor em várias parcelas mensais</p>
                  </div>
                  <Switch
                    checked={isInstallment}
                    onCheckedChange={(checked) => {
                      setIsInstallment(checked);
                      if (checked) setIsRecurring(false);
                    }}
                  />
                </div>
                {isInstallment && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Número de parcelas (2 a 48)</Label>
                    <Input
                      type="number"
                      min={2}
                      max={48}
                      value={installments}
                      onChange={(e) => setInstallments(Math.min(48, Math.max(2, Number(e.target.value) || 2)))}
                      className="h-[42px] rounded-lg border-border bg-secondary text-foreground"
                    />
                  </div>
                )}
              </div>
            )}

            {!editing && formType !== "transfer" && !isInstallment && members.filter((m) => m.user_id !== user?.id).length > 0 && (
              <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3">
                <Label className="text-sm font-medium text-foreground">Vincular com outro membro (opcional)</Label>
                <p className="text-xs text-muted-foreground">
                  {formType === "income"
                    ? "Cria uma despesa pendente pra essa pessoa no mesmo dia/valor."
                    : "Cria uma receita pendente pra essa pessoa no mesmo dia/valor."}
                </p>
                <Select value={linkedMemberId} onValueChange={setLinkedMemberId}>
                  <SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground">
                    <SelectValue placeholder="Sem vínculo" />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-card text-card-foreground">
                    <SelectItem value="none">Sem vínculo</SelectItem>
                    {members
                      .filter((m) => m.user_id !== user?.id)
                      .map((m) => {
                        const fullName = m.profiles?.full_name?.trim() || m.profiles?.email || "Membro";
                        return (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {fullName}
                          </SelectItem>
                        );
                      })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2"><Label className="text-xs text-muted-foreground">Tags (opcional)</Label><TagsInput value={tags} onChange={setTags} placeholder="ex: trabalho, viagem, presente" /></div>
            <div className="space-y-2"><Label className="text-xs text-muted-foreground">Notas</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 600))} rows={3} className="resize-y rounded-lg border-border bg-secondary text-foreground" /></div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <div className="flex items-center justify-between gap-2 pt-2">
              {editing ? <Button variant="destructive" className="h-10 rounded-lg" onClick={() => openDelete(editing)}>Excluir</Button> : <span />}
              <div className="flex items-center gap-2"><Button variant="outline" className="h-10 rounded-lg border-border bg-secondary text-muted-foreground" onClick={() => { setOpen(false); resetForm(); }}>Cancelar</Button><Button className="h-10 rounded-lg px-4 font-semibold" onClick={persist} disabled={!canSave || saving}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</> : editing ? "Salvar alterações" : "Salvar"}</Button></div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md rounded-xl border-border bg-card">
          <DialogHeader><DialogTitle className="text-lg font-bold text-foreground">Excluir transação</DialogTitle></DialogHeader>
          {deleteTarget?.installment_group_id ? (
            <div className="space-y-3"><p className="text-sm text-muted-foreground">Escolha como excluir esta transação parcelada:</p><Button variant="outline" className="w-full justify-start border-border bg-secondary" onClick={() => void executeDelete("one")}>Excluir só esta parcela</Button><Button variant="outline" className="w-full justify-start border-border bg-secondary" onClick={() => void executeDelete("remaining")}>Excluir todas as parcelas restantes</Button><Button variant="destructive" className="w-full justify-start" onClick={() => void executeDelete("all")}>Excluir todas as parcelas</Button><Button variant="ghost" className="w-full" onClick={() => setDeleteOpen(false)}>Cancelar</Button></div>
          ) : (deleteTarget?.is_recurring || deleteTarget?.recurrence_parent_id) ? (
            <div className="space-y-3"><p className="text-sm text-muted-foreground">Escolha como excluir esta transação recorrente:</p><Button variant="outline" className="w-full justify-start border-border bg-secondary" onClick={() => void executeDelete("one")}>Excluir só esta ocorrência</Button><Button variant="outline" className="w-full justify-start border-border bg-secondary" onClick={() => void executeDelete("remaining")}>Excluir esta e as futuras</Button><Button variant="destructive" className="w-full justify-start" onClick={() => void executeDelete("all")}>Excluir todas as ocorrências</Button><Button variant="ghost" className="w-full" onClick={() => setDeleteOpen(false)}>Cancelar</Button></div>
          ) : deleteTarget?.linked_pair_id ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Esta transação está vinculada com outro membro. Como deseja excluir?</p>
              <Button variant="outline" className="w-full justify-start border-border bg-secondary" onClick={() => void executeDelete("one")}>Excluir só a minha</Button>
              <Button variant="destructive" className="w-full justify-start" onClick={() => void executeDelete("pair")}>Excluir nos dois membros</Button>
              <Button variant="ghost" className="w-full" onClick={() => setDeleteOpen(false)}>Cancelar</Button>
            </div>
          ) : (
            <div className="space-y-4"><p className="text-sm text-muted-foreground">Tem certeza que deseja excluir esta transação?</p><div className="flex justify-end gap-2"><Button variant="outline" className="border-border bg-secondary" onClick={() => setDeleteOpen(false)}>Cancelar</Button><Button variant="destructive" onClick={() => void executeDelete("one")}>Excluir</Button></div></div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TransactionsPage;
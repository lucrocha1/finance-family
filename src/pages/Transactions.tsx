import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Loader2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { z } from "zod";

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
import { cn } from "@/lib/utils";

type TxType = "income" | "expense" | "transfer" | string;
type TxStatus = "paid" | "pending" | string | null;

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
  is_installment?: boolean | null;
  installment_number?: number | null;
  installment_current?: number | null;
  current_installment?: number | null;
  installments?: number | null;
  installment_total?: number | null;
  total_installments?: number | null;
  categories?: { id?: string; name?: string; color?: string | null; type?: string | null; icon?: string | null } | { id?: string; name?: string; color?: string | null; type?: string | null; icon?: string | null }[] | null;
  accounts?: { id?: string; name?: string; institution?: string | null } | { id?: string; name?: string; institution?: string | null }[] | null;
  cards?: { id?: string; name?: string; brand?: string | null; last4?: string | null } | { id?: string; name?: string; brand?: string | null; last4?: string | null }[] | null;
  profiles?: { full_name?: string | null; email?: string | null } | { full_name?: string | null; email?: string | null }[] | null;
};

type CategoryRow = { id: string; name: string; color: string | null; type: string | null; icon: string | null };
type AccountRow = { id: string; name: string; institution: string | null };
type CardRow = { id: string; name: string; brand: string | null; last4: string | null };
type RecurrenceType = "weekly" | "monthly" | "yearly";

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const startOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth(), 1);
const endOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth() + 1, 0);
const formatMonthYear = (date: Date) => date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const toISODate = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const asSingle = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));
const formatDateDDMM = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const PAGE_SIZE = 20;

const transactionSchema = z
  .object({
    type: z.enum(["income", "expense", "transfer"]),
    description: z.string().trim().min(2, "Descrição obrigatória").max(120, "Descrição muito longa"),
    amountCents: z.number().int().min(1, "Valor obrigatório"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
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
    if (values.type !== "transfer" && !values.categoryId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["categoryId"], message: "Categoria é obrigatória" });
    }
    if (values.type === "transfer") {
      if (!values.fromAccountId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fromAccountId"], message: "Conta origem é obrigatória" });
      if (!values.toAccountId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountId"], message: "Conta destino é obrigatória" });
      if (values.fromAccountId && values.toAccountId && values.fromAccountId === values.toAccountId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountId"], message: "Contas devem ser diferentes" });
      }
    }
    if (values.type !== "transfer" && values.type !== "expense" && !values.accountId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accountId"], message: "Conta é obrigatória" });
    }
    if (values.type === "expense" && !values.cardId && !values.accountId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accountId"], message: "Conta é obrigatória quando sem cartão" });
    }
    if (values.type !== "expense" && values.isInstallment) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["isInstallment"], message: "Parcelamento só para despesas" });
    }
  });

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
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [cardFilter, setCardFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formType, setFormType] = useState<"income" | "expense" | "transfer">("expense");
  const [description, setDescription] = useState("");
  const [amountDigits, setAmountDigits] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [categoryId, setCategoryId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [fromAccountId, setFromAccountId] = useState<string>("");
  const [toAccountId, setToAccountId] = useState<string>("");
  const [cardId, setCardId] = useState<string>("none");
  const [isInstallment, setIsInstallment] = useState(false);
  const [installments, setInstallments] = useState(2);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("monthly");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const monthStart = useMemo(() => startOfMonth(selectedMonth), [selectedMonth]);
  const monthEnd = useMemo(() => endOfMonth(selectedMonth), [selectedMonth]);

  const loadData = useCallback(async () => {
    if (!family?.id) {
      setTransactions([]);
      setCategories([]);
      setAccounts([]);
      setCards([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [txRes, categoriesRes, accountsRes, cardsRes] = await Promise.all([
      supabase
        .from("transactions")
        .select("*, categories(*), accounts(*), cards(*), profiles:user_id(full_name, email)")
        .eq("family_id", family.id)
        .gte("date", toISODate(monthStart))
        .lte("date", toISODate(monthEnd))
        .order("date", { ascending: false }),
      supabase.from("categories").select("id, name, color, type, icon").eq("family_id", family.id).order("name", { ascending: true }),
      supabase.from("accounts").select("id, name, institution").eq("family_id", family.id).order("name", { ascending: true }),
      supabase.from("cards").select("id, name, brand, last4").eq("family_id", family.id).order("name", { ascending: true }),
    ]);

    if (txRes.error) {
      const fallback = await supabase
        .from("transactions")
        .select("*, categories(*), accounts(*), cards(*)")
        .eq("family_id", family.id)
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
  }, [typeFilter, categoryFilter, accountFilter, cardFilter, memberFilter, selectedMonth]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setFormError(null);
    if (formType === "transfer") {
      setCategoryId("");
      setCardId("none");
      setIsInstallment(false);
      setIsRecurring(false);
      setAccountId("");
    }
    if (formType === "income") {
      setCardId("none");
      setIsInstallment(false);
    }
  }, [formType]);

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
    if (formType === "income") return categories.filter((c) => c.type === "income");
    return categories.filter((c) => c.type === "expense");
  }, [categories, formType]);

  const filtered = useMemo(
    () =>
      transactions.filter((tx) => {
        if (typeFilter !== "all" && tx.type !== typeFilter) return false;
        if (categoryFilter !== "all" && tx.category_id !== categoryFilter) return false;
        const txAccount = asSingle(tx.accounts);
        const account = tx.account_id ?? txAccount?.id ?? null;
        if (accountFilter !== "all" && account !== accountFilter) return false;
        if (cardFilter === "none" && tx.card_id) return false;
        if (cardFilter !== "all" && cardFilter !== "none" && tx.card_id !== cardFilter) return false;
        if (memberFilter !== "all" && tx.user_id !== memberFilter) return false;
        return true;
      }),
    [accountFilter, cardFilter, categoryFilter, memberFilter, transactions, typeFilter],
  );

  const totals = useMemo(() => {
    const income = filtered.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const expense = filtered.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    return { income, expense, balance: income - expense };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filtered.length);
  const pageRows = filtered.slice(startIndex, endIndex);

  const amountCents = Number(amountDigits || "0");
  const amountValue = amountCents / 100;
  const amountDisplay = ptCurrency.format(amountValue);
  const installmentPreview = isInstallment && installments > 1 ? `${installments}x de ${ptCurrency.format(amountValue / installments)}` : "";

  const canSave = useMemo(() => {
    if (!description.trim() || amountCents <= 0) return false;
    if (formType === "transfer") return Boolean(fromAccountId && toAccountId && fromAccountId !== toAccountId);
    if (formType === "expense") return Boolean(categoryId && (cardId !== "none" || accountId));
    return Boolean(categoryId && accountId);
  }, [accountId, amountCents, cardId, categoryId, description, formType, fromAccountId, toAccountId]);

  const resetForm = () => {
    setFormType("expense");
    setDescription("");
    setAmountDigits("");
    setDate(new Date());
    setCategoryId("");
    setAccountId("");
    setFromAccountId("");
    setToAccountId("");
    setCardId("none");
    setIsInstallment(false);
    setInstallments(2);
    setIsRecurring(false);
    setRecurrenceType("monthly");
    setNotes("");
    setFormError(null);
  };

  const saveTransaction = async () => {
    if (!family?.id || !user?.id) return;

    const parsed = transactionSchema.safeParse({
      type: formType,
      description,
      amountCents,
      date: toISODate(date),
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

    const todayIso = toISODate(new Date());
    const status = parsed.data.date <= todayIso ? "paid" : "pending";
    const base = {
      description: parsed.data.description.trim(),
      amount: parsed.data.amountCents / 100,
      date: parsed.data.date,
      notes: parsed.data.notes?.trim() || null,
      user_id: user.id,
      family_id: family.id,
      status,
    };

    let insertError: string | null = null;

    if (parsed.data.type === "transfer") {
      const payload = [
        { ...base, type: "transfer", account_id: parsed.data.fromAccountId, category_id: null, card_id: null, is_installment: false, is_recurring: false, recurrence_type: null },
        { ...base, type: "transfer", account_id: parsed.data.toAccountId, category_id: null, card_id: null, is_installment: false, is_recurring: false, recurrence_type: null },
      ];
      const { error } = await supabase.from("transactions").insert(payload);
      if (error) insertError = error.message;
    } else if (parsed.data.type === "expense" && parsed.data.isInstallment) {
      const groupId = crypto.randomUUID();
      const count = parsed.data.installments;
      const baseCents = Math.floor(parsed.data.amountCents / count);
      const remainder = parsed.data.amountCents % count;
      const rows = Array.from({ length: count }, (_, index) => {
        const due = new Date(date);
        due.setMonth(due.getMonth() + index);
        const cents = baseCents + (index < remainder ? 1 : 0);
        return {
          ...base,
          date: toISODate(due),
          description: `${parsed.data.description.trim()} (${index + 1}/${count})`,
          type: parsed.data.type,
          amount: cents / 100,
          is_recurring: false,
          recurrence_type: null,
          is_installment: true,
          installment_current: index + 1,
          installment_total: count,
          installment_group_id: groupId,
          category_id: parsed.data.categoryId,
          account_id: parsed.data.cardId ? null : parsed.data.accountId,
          card_id: parsed.data.cardId,
        };
      });
      const { error } = await supabase.from("transactions").insert(rows);
      if (error) insertError = error.message;
    } else {
      const payload = {
        ...base,
        type: parsed.data.type,
        is_recurring: parsed.data.isRecurring,
        recurrence_type: parsed.data.isRecurring ? parsed.data.recurrenceType : null,
        is_installment: false,
        category_id: parsed.data.categoryId,
        account_id: parsed.data.type === "expense" && parsed.data.cardId ? null : parsed.data.accountId,
        card_id: parsed.data.type === "expense" ? parsed.data.cardId : null,
      };
      const { error } = await supabase.from("transactions").insert(payload);
      if (error) insertError = error.message;
    }

    if (insertError) {
      setFormError("Não foi possível salvar a transação");
      setSaving(false);
      return;
    }

    await loadData();
    setSaving(false);
    setOpen(false);
    resetForm();
    toast.success("Transação criada!");
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)} className="h-10 rounded-lg px-4 font-semibold">
          + Nova Transação
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-2 py-1.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="min-w-[150px] text-center text-sm font-bold text-foreground">{capitalize(formatMonthYear(selectedMonth))}</p>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            { value: "all", label: "Todos", activeClass: "text-muted-foreground" },
            { value: "income", label: "Receita", activeClass: "text-success" },
            { value: "expense", label: "Despesa", activeClass: "text-destructive" },
            { value: "transfer", label: "Transferência", activeClass: "text-info" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTypeFilter(option.value as "all" | "income" | "expense" | "transfer")}
              className={cn("h-[38px] rounded-lg border border-border bg-secondary px-3 text-sm font-semibold", typeFilter === option.value ? option.activeClass : "text-muted-foreground")}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent className="border-border bg-card text-card-foreground">
            <SelectItem value="all">Todas</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Conta" /></SelectTrigger>
          <SelectContent className="border-border bg-card text-card-foreground">
            <SelectItem value="all">Todas</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={cardFilter} onValueChange={setCardFilter}>
          <SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Cartão" /></SelectTrigger>
          <SelectContent className="border-border bg-card text-card-foreground">
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="none">Sem cartão</SelectItem>
            {cards.map((card) => (
              <SelectItem key={card.id} value={card.id}>{card.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={memberFilter} onValueChange={setMemberFilter}>
          <SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Membro" /></SelectTrigger>
          <SelectContent className="border-border bg-card text-card-foreground">
            <SelectItem value="all">Todos</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.user_id} value={member.user_id}>{member.profiles?.full_name || member.profiles?.email || "Usuário"}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        <Card className="flex-1 rounded-lg border-border bg-card"><CardContent className="flex items-center gap-3 p-4"><span className="rounded-full bg-success/20 p-2 text-success"><ArrowUp className="h-4 w-4" /></span><div><p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">Receitas</p><p className="text-lg font-semibold tabular-nums text-success">{ptCurrency.format(totals.income)}</p></div></CardContent></Card>
        <Card className="flex-1 rounded-lg border-border bg-card"><CardContent className="flex items-center gap-3 p-4"><span className="rounded-full bg-destructive/20 p-2 text-destructive"><ArrowDown className="h-4 w-4" /></span><div><p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">Despesas</p><p className="text-lg font-semibold tabular-nums text-destructive">{ptCurrency.format(totals.expense)}</p></div></CardContent></Card>
        <Card className="flex-1 rounded-lg border-border bg-card"><CardContent className="p-4"><p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">Saldo</p><p className={cn("text-lg font-semibold tabular-nums", totals.balance >= 0 ? "text-success" : "text-destructive")}>{ptCurrency.format(totals.balance)}</p></CardContent></Card>
      </div>

      <Card className="rounded-xl border-border bg-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-[300px] items-center justify-center text-sm text-muted-foreground">Carregando transações...</div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 text-center"><ArrowLeftRight className="h-10 w-10 text-[hsl(var(--placeholder-icon))]" /><p className="text-base font-semibold text-foreground">Nenhuma transação encontrada</p><p className="text-sm text-muted-foreground">Adicione sua primeira transação</p><Button className="mt-2" onClick={() => setOpen(true)}>+ Nova Transação</Button></div>
          ) : (
            <>
              <Table>
                <TableHeader><TableRow className="border-b border-border bg-background hover:bg-background"><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Data</TableHead><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Descrição</TableHead><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Categoria</TableHead><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Valor</TableHead><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Conta</TableHead><TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Membro</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pageRows.map((tx) => {
                    const category = asSingle(tx.categories);
                    const account = asSingle(tx.accounts);
                    const card = asSingle(tx.cards);
                    const profileJoined = asSingle(tx.profiles);
                    const member = tx.user_id ? memberMap.get(tx.user_id) : null;
                    const memberName = member?.name || profileJoined?.full_name?.split(" ")[0] || "Usuário";
                    const memberInitials = member?.initials || memberName.slice(0, 1).toUpperCase();
                    const installmentCurrent = tx.installment_number ?? tx.installment_current ?? tx.current_installment ?? null;
                    const installmentTotal = tx.installments ?? tx.installment_total ?? tx.total_installments ?? null;
                    const installmentLabel = installmentCurrent && installmentTotal ? ` (${installmentCurrent}/${installmentTotal})` : "";
                    const valuePrefix = tx.type === "income" ? "+" : tx.type === "expense" ? "-" : "";
                    const valueColor = tx.type === "income" ? "text-success" : tx.type === "expense" ? "text-destructive" : "text-info";
                    return (
                      <TableRow key={tx.id} className="cursor-pointer border-b border-border bg-transparent hover:bg-secondary">
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground">{formatDateDDMM(tx.date)}</TableCell>
                        <TableCell className="px-4 py-3 text-sm font-medium text-foreground"><span>{tx.description || "Sem descrição"}</span>{installmentLabel && <span className="text-muted-foreground">{installmentLabel}</span>}</TableCell>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: category?.color || "hsl(var(--muted-foreground))" }} />{category?.name || "Sem categoria"}</div></TableCell>
                        <TableCell className={cn("px-4 py-3 text-sm font-semibold tabular-nums", valueColor)}>{valuePrefix}{ptCurrency.format(Number(tx.amount || 0))}</TableCell>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground">{tx.card_id ? <span className="inline-flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" />{card?.name || "Cartão"}</span> : account?.name || "Sem conta"}</TableCell>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-foreground">{memberInitials}</span><span className="text-foreground">{memberName}</span></span></TableCell>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-[520px] overflow-y-auto rounded-2xl border-border bg-card p-6 shadow-2xl backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-foreground">Nova Transação</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setFormType("income")} className={cn("h-10 rounded-lg border text-sm font-semibold", formType === "income" ? "border-success bg-success/15 text-success" : "border-success/60 text-success/80")}><span className="inline-flex items-center gap-1"><TrendingUp className="h-4 w-4" />Receita</span></button>
              <button type="button" onClick={() => setFormType("expense")} className={cn("h-10 rounded-lg border text-sm font-semibold", formType === "expense" ? "border-destructive bg-destructive/15 text-destructive" : "border-destructive/60 text-destructive/80")}><span className="inline-flex items-center gap-1"><TrendingDown className="h-4 w-4" />Despesa</span></button>
              <button type="button" onClick={() => setFormType("transfer")} className={cn("h-10 rounded-lg border text-sm font-semibold", formType === "transfer" ? "border-info bg-info/15 text-info" : "border-info/60 text-info/80")}><span className="inline-flex items-center gap-1"><ArrowLeftRight className="h-4 w-4" />Transferência</span></button>
            </div>

            <div className="space-y-2"><Label className="text-xs text-muted-foreground">Descrição</Label><Input value={description} onChange={(e) => setDescription(e.target.value.slice(0, 120))} placeholder="Ex: Supermercado, Salário, Aluguel..." className="h-[42px] rounded-lg border-border bg-secondary text-foreground" /></div>

            <div className="space-y-2"><Label className="text-xs text-muted-foreground">Valor</Label><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">R$</span><Input inputMode="numeric" value={amountDisplay.replace("R$", "").trim()} onChange={(e) => setAmountDigits(e.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="0,00" className="h-[42px] rounded-lg border-border bg-secondary pl-11 text-lg font-semibold text-foreground" /></div></div>

            <div className="space-y-2"><Label className="text-xs text-muted-foreground">Data</Label><Popover><PopoverTrigger asChild><Button type="button" variant="outline" className="h-[42px] w-full justify-start rounded-lg border-border bg-secondary text-left font-normal"><CalendarIcon className="mr-2 h-4 w-4" />{date.toLocaleDateString("pt-BR")}</Button></PopoverTrigger><PopoverContent align="start" className="w-auto border-border bg-card p-0"><Calendar mode="single" selected={date} onSelect={(value) => value && setDate(value)} initialFocus className="p-3 pointer-events-auto" /></PopoverContent></Popover></div>

            {formType !== "transfer" && (
              <div className="space-y-2"><Label className="text-xs text-muted-foreground">Categoria</Label>{filteredCategories.length ? <Select value={categoryId || "none"} onValueChange={(value) => setCategoryId(value === "none" ? "" : value)}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground">{filteredCategories.map((category) => (<SelectItem key={category.id} value={category.id}><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color || "hsl(var(--muted-foreground))" }} />{category.icon ? `${category.icon} ` : ""}{category.name}</span></SelectItem>))}</SelectContent></Select> : <p className="text-sm text-muted-foreground">Nenhuma categoria. <button type="button" className="text-primary hover:underline">Criar categoria</button></p>}</div>
            )}

            {formType === "transfer" ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2"><Label className="text-xs text-muted-foreground">De (conta origem)</Label><Select value={fromAccountId || "none"} onValueChange={(value) => setFromAccountId(value === "none" ? "" : value)}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground">{accounts.map((account) => (<SelectItem key={account.id} value={account.id}>{account.name}{account.institution ? ` • ${account.institution}` : ""}</SelectItem>))}</SelectContent></Select></div>
                <div className="space-y-2"><Label className="text-xs text-muted-foreground">Para (conta destino)</Label><Select value={toAccountId || "none"} onValueChange={(value) => setToAccountId(value === "none" ? "" : value)}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground">{accounts.map((account) => (<SelectItem key={account.id} value={account.id}>{account.name}{account.institution ? ` • ${account.institution}` : ""}</SelectItem>))}</SelectContent></Select></div>
              </div>
            ) : formType === "expense" ? (
              <>
                <div className="space-y-2"><Label className="text-xs text-muted-foreground">Cartão (opcional)</Label><Select value={cardId} onValueChange={setCardId}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground"><SelectItem value="none">Sem cartão</SelectItem>{cards.map((card) => (<SelectItem key={card.id} value={card.id}>{card.name}{card.last4 ? ` • **** ${card.last4}` : ""}{card.brand ? ` • ${card.brand}` : ""}</SelectItem>))}</SelectContent></Select></div>
                {cardId === "none" && <div className="space-y-2"><Label className="text-xs text-muted-foreground">Conta</Label><Select value={accountId || "none"} onValueChange={(value) => setAccountId(value === "none" ? "" : value)}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground">{accounts.map((account) => (<SelectItem key={account.id} value={account.id}>{account.name}{account.institution ? ` • ${account.institution}` : ""}</SelectItem>))}</SelectContent></Select></div>}
              </>
            ) : (
              <div className="space-y-2"><Label className="text-xs text-muted-foreground">Conta</Label><Select value={accountId || "none"} onValueChange={(value) => setAccountId(value === "none" ? "" : value)}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground">{accounts.map((account) => (<SelectItem key={account.id} value={account.id}>{account.name}{account.institution ? ` • ${account.institution}` : ""}</SelectItem>))}</SelectContent></Select></div>
            )}

            {formType === "expense" && (
              <>
                <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 p-3"><Label htmlFor="parcelado" className="text-sm text-foreground">Parcelado?</Label><Switch id="parcelado" checked={isInstallment} onCheckedChange={(checked) => { setIsInstallment(checked); if (checked) setIsRecurring(false); }} /></div>
                {isInstallment ? (
                  <div className="space-y-2"><Label className="text-xs text-muted-foreground">Número de parcelas</Label><Input type="number" min={2} max={48} value={installments} onChange={(e) => setInstallments(Math.max(2, Math.min(48, Number(e.target.value || 2))))} className="h-[42px] rounded-lg border-border bg-secondary text-foreground" /><p className="text-sm text-muted-foreground">{installmentPreview}</p></div>
                ) : (
                  <>
                    <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 p-3"><Label htmlFor="recorrente" className="text-sm text-foreground">Recorrente?</Label><Switch id="recorrente" checked={isRecurring} onCheckedChange={setIsRecurring} /></div>
                    {isRecurring && <div className="space-y-2"><Label className="text-xs text-muted-foreground">Frequência</Label><Select value={recurrenceType} onValueChange={(value: RecurrenceType) => setRecurrenceType(value)}><SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground"><SelectValue /></SelectTrigger><SelectContent className="border-border bg-card text-card-foreground"><SelectItem value="weekly">Semanal</SelectItem><SelectItem value="monthly">Mensal</SelectItem><SelectItem value="yearly">Anual</SelectItem></SelectContent></Select></div>}
                  </>
                )}
              </>
            )}

            <div className="space-y-2"><Label className="text-xs text-muted-foreground">Notas (opcional)</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 600))} placeholder="Observações..." rows={3} className="resize-y rounded-lg border-border bg-secondary text-foreground" /></div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <div className="flex items-center justify-end gap-2 pt-2"><Button variant="outline" className="h-10 rounded-lg border-border bg-secondary text-muted-foreground" onClick={() => { setOpen(false); resetForm(); }}>Cancelar</Button><Button className="h-10 rounded-lg px-4 font-semibold" onClick={saveTransaction} disabled={!canSave || saving}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</> : "Salvar"}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TransactionsPage;
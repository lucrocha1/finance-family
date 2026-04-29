import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Handshake,
  Pencil,
  Trash2,
  User,
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
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type DebtType = "debt" | "loan";
type DebtDirection = "i_owe" | "they_owe";
type CounterpartType = "person" | "company" | "family_member";
type DebtStatus = "active" | "paid_off" | "renegotiated";
type InterestType = "monthly" | "yearly" | "total";
type Priority = "low" | "medium" | "high" | "urgent";

type UiStatus = "active" | "overdue" | "paid_off" | "renegotiated";
type SortOption = "highest_remaining" | "nearest_due" | "priority" | "newest" | "oldest";

type DebtRow = {
  id: string;
  user_id: string;
  family_id: string;
  name: string;
  description: string | null;
  type: DebtType;
  direction: DebtDirection;
  counterpart_name: string | null;
  counterpart_type: CounterpartType;
  counterpart_member_id: string | null;
  original_amount: number;
  total_with_interest: number | null;
  amount_paid: number;
  has_interest: boolean;
  interest_rate: number | null;
  interest_type: InterestType | null;
  has_installments: boolean;
  total_installments: number | null;
  installments_paid: number | null;
  installment_amount: number | null;
  start_date: string;
  due_date: string | null;
  status: DebtStatus;
  priority: Priority;
  created_at: string;
};

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const todayIso = () => new Date().toISOString().slice(0, 10);

const debtSchema = z
  .object({
    type: z.enum(["debt", "loan"]),
    direction: z.enum(["i_owe", "they_owe"]),
    name: z.string().trim().min(2, "Nome obrigatório").max(120, "Máximo 120 caracteres"),
    counterpartType: z.enum(["person", "company", "family_member"]),
    counterpartName: z.string().trim().max(120).optional(),
    counterpartMemberId: z.string().trim().optional(),
    originalAmountCents: z.number().int().min(1, "Valor original obrigatório"),
    hasInterest: z.boolean(),
    interestRate: z.number().min(0).max(999).optional(),
    interestType: z.enum(["monthly", "yearly", "total"]).optional(),
    hasInstallments: z.boolean(),
    totalInstallments: z.number().int().min(2).max(360).optional(),
    startDate: z.string().min(10, "Data de início obrigatória"),
    dueDate: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    description: z.string().trim().max(400).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.counterpartType === "family_member" && !values.counterpartMemberId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["counterpartMemberId"],
        message: "Selecione o membro da família",
      });
    }

    if (values.counterpartType !== "family_member" && !(values.counterpartName ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["counterpartName"],
        message: "Informe o nome da outra parte",
      });
    }

    if (values.type === "loan" && values.hasInterest) {
      if (!values.interestType) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["interestType"], message: "Selecione o tipo de juros" });
      }
      if ((values.interestRate ?? 0) <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["interestRate"], message: "Taxa de juros inválida" });
      }
    }

    if (values.type === "loan" && values.hasInstallments && !values.totalInstallments) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalInstallments"], message: "Informe o número de parcelas" });
    }

    if (values.type === "debt" && !values.dueDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dueDate"], message: "Data de vencimento obrigatória" });
    }
  });

const paymentSchema = z.object({
  amountCents: z.number().int().min(1, "Valor do pagamento obrigatório"),
  date: z.string().min(10, "Data obrigatória"),
  notes: z.string().trim().max(200).optional(),
});

const toMoneyDigits = (value: number) => String(Math.round(value * 100));
const digitsToValue = (digits: string) => Number(digits || "0") / 100;
const formatDate = (value: string | null) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR") : "-");
const isOverdue = (dueDate: string | null) => Boolean(dueDate && dueDate < todayIso());
const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

const addMonths = (iso: string, months: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const candidate = new Date(y, m - 1 + months, d);
  if (candidate.getMonth() !== ((m - 1 + months) % 12 + 12) % 12) {
    candidate.setDate(0);
  }
  const local = new Date(candidate.getTime() - candidate.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const priorityOrder: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const priorityColor: Record<Priority, string> = {
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#6b7280",
};

const DebtsPage = () => {
  const { family, members } = useFamily();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<DebtRow[]>([]);

  const [directionFilter, setDirectionFilter] = useState<"all" | DebtDirection>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | DebtType>("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "paid_off" | "overdue" | "all">("active");
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");
  const [sortBy, setSortBy] = useState<SortOption>("highest_remaining");

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<DebtRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentDebt, setPaymentDebt] = useState<DebtRow | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [type, setType] = useState<DebtType>("debt");
  const [direction, setDirection] = useState<DebtDirection>("i_owe");
  const [name, setName] = useState("");
  const [counterpartType, setCounterpartType] = useState<CounterpartType>("person");
  const [counterpartName, setCounterpartName] = useState("");
  const [counterpartMemberId, setCounterpartMemberId] = useState<string>("");
  const [originalAmountDigits, setOriginalAmountDigits] = useState("");
  const [hasInterest, setHasInterest] = useState(false);
  const [interestRate, setInterestRate] = useState("1.99");
  const [interestType, setInterestType] = useState<InterestType>("monthly");
  const [hasInstallments, setHasInstallments] = useState(false);
  const [totalInstallments, setTotalInstallments] = useState("12");
  const [startDate, setStartDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(todayIso());
  const [priority, setPriority] = useState<Priority>("medium");
  const [description, setDescription] = useState("");

  const [paymentAmountDigits, setPaymentAmountDigits] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [paymentNotes, setPaymentNotes] = useState("");

  const loadData = useCallback(async () => {
    if (!family?.id) {
      setDebts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.from("debts").select("*").eq("family_id", family.id).order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar dívidas");
      setLoading(false);
      return;
    }

    const normalized = ((data as Record<string, unknown>[] | null) ?? []).map<DebtRow>((row) => ({
      id: String(row.id ?? ""),
      user_id: String(row.user_id ?? ""),
      family_id: String(row.family_id ?? family.id),
      name: String(row.name ?? "Dívida"),
      description: (row.description as string | null) ?? null,
      type: ((row.type as DebtType | null) ?? "debt") as DebtType,
      direction: ((row.direction as DebtDirection | null) ?? "i_owe") as DebtDirection,
      counterpart_name: (row.counterpart_name as string | null) ?? null,
      counterpart_type: ((row.counterpart_type as CounterpartType | null) ?? "person") as CounterpartType,
      counterpart_member_id: (row.counterpart_member_id as string | null) ?? null,
      original_amount: Number(row.original_amount ?? 0),
      total_with_interest: row.total_with_interest === null || row.total_with_interest === undefined ? null : Number(row.total_with_interest),
      amount_paid: Number(row.amount_paid ?? 0),
      has_interest: Boolean(row.has_interest),
      interest_rate: row.interest_rate === null || row.interest_rate === undefined ? null : Number(row.interest_rate),
      interest_type: (row.interest_type as InterestType | null) ?? null,
      has_installments: Boolean(row.has_installments),
      total_installments: row.total_installments === null || row.total_installments === undefined ? null : Number(row.total_installments),
      installments_paid: row.installments_paid === null || row.installments_paid === undefined ? null : Number(row.installments_paid),
      installment_amount: row.installment_amount === null || row.installment_amount === undefined ? null : Number(row.installment_amount),
      start_date: String(row.start_date ?? todayIso()),
      due_date: (row.due_date as string | null) ?? null,
      status: ((row.status as DebtStatus | null) ?? "active") as DebtStatus,
      priority: ((row.priority as Priority | null) ?? "medium") as Priority,
      created_at: String(row.created_at ?? new Date().toISOString()),
    }));

    setDebts(normalized);
    setLoading(false);
  }, [family?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((member) => {
      const label = member.profiles?.full_name?.trim() || member.profiles?.email || "Membro";
      map.set(member.user_id, label);
      map.set(member.id, label);
    });
    return map;
  }, [members]);

  const resolveCounterpartName = useCallback(
    (debt: DebtRow) => {
      if (debt.counterpart_type === "family_member") {
        return debt.counterpart_member_id ? memberNameMap.get(debt.counterpart_member_id) || debt.counterpart_name || "Membro" : "Membro";
      }
      return debt.counterpart_name || "Sem nome";
    },
    [memberNameMap],
  );

  const getTotal = (debt: DebtRow) => debt.total_with_interest ?? debt.original_amount;
  const getRemaining = (debt: DebtRow) => Math.max(0, getTotal(debt) - Number(debt.amount_paid || 0));

  const getUiStatus = (debt: DebtRow): UiStatus => {
    if (debt.status === "paid_off") return "paid_off";
    if (debt.status === "renegotiated") return "renegotiated";
    if (debt.status === "active" && getRemaining(debt) > 0 && isOverdue(debt.due_date)) return "overdue";
    return "active";
  };

  const summary = useMemo(() => {
    const active = debts.filter((debt) => debt.status === "active");
    const iOwe = active.filter((debt) => debt.direction === "i_owe").reduce((sum, debt) => sum + getRemaining(debt), 0);
    const theyOwe = active.filter((debt) => debt.direction === "they_owe").reduce((sum, debt) => sum + getRemaining(debt), 0);

    const nonOverdueUpcoming = active
      .filter((debt) => Boolean(debt.due_date && debt.due_date >= todayIso()))
      .sort((a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31"))[0];

    const overdueUpcoming = active
      .filter((debt) => Boolean(debt.due_date && debt.due_date < todayIso()))
      .sort((a, b) => (b.due_date ?? "0000-01-01").localeCompare(a.due_date ?? "0000-01-01"))[0];

    const upcoming = nonOverdueUpcoming ?? overdueUpcoming ?? null;

    return { iOwe, theyOwe, net: theyOwe - iOwe, upcoming };
  }, [debts]);

  const filteredDebts = useMemo(() => {
    const list = debts.filter((debt) => {
      const uiStatus = getUiStatus(debt);
      if (directionFilter !== "all" && debt.direction !== directionFilter) return false;
      if (typeFilter !== "all" && debt.type !== typeFilter) return false;
      if (statusFilter !== "all" && uiStatus !== statusFilter) return false;
      if (priorityFilter !== "all" && debt.priority !== priorityFilter) return false;
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === "highest_remaining") return getRemaining(b) - getRemaining(a);
      if (sortBy === "nearest_due") return (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31");
      if (sortBy === "priority") {
        const order = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (order !== 0) return order;
        return getRemaining(b) - getRemaining(a);
      }
      if (sortBy === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [debts, directionFilter, priorityFilter, sortBy, statusFilter, typeFilter]);

  const originalAmount = digitsToValue(originalAmountDigits);
  const installmentsCount = Number(totalInstallments || "0");
  const monthlyRate = Number(interestRate.replace(",", ".") || "0");

  const totalWithInterestPreview = useMemo(() => {
    const base = originalAmount;
    if (type !== "loan" || !hasInterest || monthlyRate <= 0) return base;

    if (interestType === "monthly") {
      const months = hasInstallments && installmentsCount > 0 ? installmentsCount : 1;
      return base * Math.pow(1 + monthlyRate / 100, months);
    }
    if (interestType === "yearly") {
      const months = hasInstallments && installmentsCount > 0 ? installmentsCount : 1;
      return base * Math.pow(1 + monthlyRate / 100, months / 12);
    }
    return base * (1 + monthlyRate / 100);
  }, [hasInstallments, hasInterest, installmentsCount, interestType, monthlyRate, originalAmount, type]);

  const installmentAmountPreview = useMemo(() => {
    if (type !== "loan" || !hasInstallments || installmentsCount < 2) return 0;
    return totalWithInterestPreview / installmentsCount;
  }, [hasInstallments, installmentsCount, totalWithInterestPreview, type]);

  useEffect(() => {
    if (type === "loan" && hasInstallments && installmentsCount >= 2 && startDate) {
      setDueDate(addMonths(startDate, installmentsCount));
    }
  }, [hasInstallments, installmentsCount, startDate, type]);

  const resetForm = () => {
    setEditing(null);
    setType("debt");
    setDirection("i_owe");
    setName("");
    setCounterpartType("person");
    setCounterpartName("");
    setCounterpartMemberId("");
    setOriginalAmountDigits("");
    setHasInterest(false);
    setInterestRate("1.99");
    setInterestType("monthly");
    setHasInstallments(false);
    setTotalInstallments("12");
    setStartDate(todayIso());
    setDueDate(todayIso());
    setPriority("medium");
    setDescription("");
    setFormError(null);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (debt: DebtRow) => {
    setEditing(debt);
    setType(debt.type);
    setDirection(debt.direction);
    setName(debt.name);
    setCounterpartType(debt.counterpart_type);
    setCounterpartName(debt.counterpart_name ?? "");
    setCounterpartMemberId(debt.counterpart_member_id ?? "");
    setOriginalAmountDigits(toMoneyDigits(debt.original_amount));
    setHasInterest(Boolean(debt.has_interest));
    setInterestRate(debt.interest_rate ? String(debt.interest_rate).replace(".", ",") : "1,99");
    setInterestType((debt.interest_type ?? "monthly") as InterestType);
    setHasInstallments(Boolean(debt.has_installments));
    setTotalInstallments(String(debt.total_installments ?? 12));
    setStartDate(debt.start_date ?? todayIso());
    setDueDate(debt.due_date ?? todayIso());
    setPriority(debt.priority ?? "medium");
    setDescription(debt.description ?? "");
    setFormError(null);
    setOpen(true);
  };

  const saveDebt = async () => {
    if (!family?.id || !user?.id) return;

    const parsed = debtSchema.safeParse({
      type,
      direction,
      name,
      counterpartType,
      counterpartName,
      counterpartMemberId,
      originalAmountCents: Number(originalAmountDigits || "0"),
      hasInterest,
      interestRate: Number(interestRate.replace(",", ".") || "0"),
      interestType,
      hasInstallments,
      totalInstallments: Number(totalInstallments || "0"),
      startDate,
      dueDate,
      priority,
      description,
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    const totalWithInterest = parsed.data.type === "loan" ? totalWithInterestPreview : parsed.data.originalAmountCents / 100;
    const installmentAmount = parsed.data.type === "loan" && parsed.data.hasInstallments ? totalWithInterest / Number(parsed.data.totalInstallments || 1) : null;

    const selectedMemberName = parsed.data.counterpartMemberId ? memberNameMap.get(parsed.data.counterpartMemberId) : null;

    const payload = {
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      type: parsed.data.type,
      direction: parsed.data.direction,
      counterpart_name:
        parsed.data.counterpartType === "family_member"
          ? selectedMemberName || parsed.data.counterpartName?.trim() || "Membro"
          : parsed.data.counterpartName?.trim() || null,
      counterpart_type: parsed.data.counterpartType,
      counterpart_member_id: parsed.data.counterpartType === "family_member" ? parsed.data.counterpartMemberId || null : null,
      original_amount: parsed.data.originalAmountCents / 100,
      total_with_interest: totalWithInterest,
      amount_paid: editing ? editing.amount_paid : 0,
      has_interest: parsed.data.type === "loan" ? parsed.data.hasInterest : false,
      interest_rate: parsed.data.type === "loan" && parsed.data.hasInterest ? parsed.data.interestRate : null,
      interest_type: parsed.data.type === "loan" && parsed.data.hasInterest ? parsed.data.interestType : null,
      has_installments: parsed.data.type === "loan" ? parsed.data.hasInstallments : false,
      total_installments: parsed.data.type === "loan" && parsed.data.hasInstallments ? parsed.data.totalInstallments : null,
      installments_paid: parsed.data.type === "loan" && parsed.data.hasInstallments ? (editing?.installments_paid ?? 0) : null,
      installment_amount: parsed.data.type === "loan" && parsed.data.hasInstallments ? installmentAmount : null,
      start_date: parsed.data.startDate,
      due_date: parsed.data.dueDate || null,
      status: editing ? editing.status : "active",
      priority: parsed.data.priority,
    };

    setSaving(true);
    setFormError(null);

    const { error } = editing
      ? await supabase.from("debts").update(payload).eq("id", editing.id)
      : await supabase.from("debts").insert({ ...payload, user_id: user.id, family_id: family.id });

    setSaving(false);

    if (error) {
      toast.error(error.message || "Erro ao salvar dívida");
      return;
    }

    setOpen(false);
    toast.success(editing ? "Dívida atualizada" : "Dívida criada");
    await loadData();
  };

  const deleteDebt = async () => {
    if (!editing) return;
    setDeleting(true);

    const paymentsDelete = await supabase.from("debt_payments").delete().eq("debt_id", editing.id);
    if (paymentsDelete.error) {
      setDeleting(false);
      toast.error(paymentsDelete.error.message || "Erro ao excluir pagamentos");
      return;
    }

    const { error } = await supabase.from("debts").delete().eq("id", editing.id);

    setDeleting(false);
    if (error) {
      toast.error(error.message || "Erro ao excluir dívida");
      return;
    }

    setDeleteOpen(false);
    setOpen(false);
    toast.success("Dívida excluída");
    await loadData();
  };

  const openPaymentModal = (debt: DebtRow) => {
    const remaining = getRemaining(debt);
    const defaultValue = debt.has_installments ? debt.installment_amount || remaining : remaining;
    setPaymentDebt(debt);
    setPaymentAmountDigits(toMoneyDigits(defaultValue));
    setPaymentDate(todayIso());
    setPaymentNotes("");
    setPaymentError(null);
    setPaymentOpen(true);
  };

  const registerPayment = async () => {
    if (!family?.id || !user?.id || !paymentDebt) return;

    const parsed = paymentSchema.safeParse({
      amountCents: Number(paymentAmountDigits || "0"),
      date: paymentDate,
      notes: paymentNotes,
    });

    if (!parsed.success) {
      setPaymentError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    const amount = parsed.data.amountCents / 100;
    const remaining = getRemaining(paymentDebt);
    if (amount > remaining + 0.009) {
      setPaymentError("Valor maior que o restante");
      return;
    }

    const nextInstallment = paymentDebt.has_installments ? Math.min((paymentDebt.installments_paid ?? 0) + 1, paymentDebt.total_installments ?? 1) : null;

    setPaymentSaving(true);
    setPaymentError(null);

    const paymentInsert = await supabase.from("debt_payments").insert({
      debt_id: paymentDebt.id,
      amount,
      date: parsed.data.date,
      installment_number: nextInstallment,
      notes: parsed.data.notes?.trim() || null,
      user_id: user.id,
      family_id: family.id,
    });

    if (paymentInsert.error) {
      setPaymentSaving(false);
      toast.error(paymentInsert.error.message || "Erro ao registrar pagamento");
      return;
    }

    const updatedPaid = Number(paymentDebt.amount_paid || 0) + amount;
    const total = getTotal(paymentDebt);
    const paidOff = updatedPaid >= total - 0.009;

    const updates: Record<string, unknown> = {
      amount_paid: updatedPaid,
      status: paidOff ? "paid_off" : "active",
    };

    if (paymentDebt.has_installments) {
      updates.installments_paid = Math.min((paymentDebt.installments_paid ?? 0) + 1, paymentDebt.total_installments ?? 1);
      if (!paidOff && paymentDebt.due_date) {
        updates.due_date = addMonths(paymentDebt.due_date, 1);
      }
    }

    const debtUpdate = await supabase.from("debts").update(updates).eq("id", paymentDebt.id);

    setPaymentSaving(false);

    if (debtUpdate.error) {
      toast.error(debtUpdate.error.message || "Erro ao atualizar dívida");
      return;
    }

    setPaymentOpen(false);
    toast.success(`Pagamento de ${ptCurrency.format(amount)} registrado`);
    await loadData();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={sortBy} onValueChange={(value: SortOption) => setSortBy(value)}>
            <SelectTrigger className="h-10 w-[240px] rounded-lg border-border bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-border bg-card text-card-foreground">
              <SelectItem value="highest_remaining">Maior valor restante</SelectItem>
              <SelectItem value="nearest_due">Vencimento mais próximo</SelectItem>
              <SelectItem value="priority">Prioridade (urgente primeiro)</SelectItem>
              <SelectItem value="newest">Mais recente</SelectItem>
              <SelectItem value="oldest">Mais antigo</SelectItem>
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={(value: "all" | Priority) => setPriorityFilter(value)}>
            <SelectTrigger className="h-10 w-[170px] rounded-lg border-border bg-card">
              <SelectValue placeholder="Prioridade" />
            </SelectTrigger>
            <SelectContent className="border-border bg-card text-card-foreground">
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="urgent">Urgente</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="medium">Média</SelectItem>
              <SelectItem value="low">Baixa</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={openCreate} className="h-10 rounded-lg font-semibold">
          + Nova Dívida
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Eu devo</p>
            <ArrowUpRight className="h-4 w-4 text-destructive" />
          </div>
          <p className="mt-3 text-2xl font-bold text-destructive">{ptCurrency.format(summary.iOwe)}</p>
        </div>

        <div className="rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Me devem</p>
            <ArrowDownLeft className="h-4 w-4 text-[hsl(var(--success))]" />
          </div>
          <p className="mt-3 text-2xl font-bold text-[hsl(var(--success))]">{ptCurrency.format(summary.theyOwe)}</p>
        </div>

        <div className="rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Saldo líquido</p>
          <p className={cn("mt-3 text-2xl font-bold", summary.net >= 0 ? "text-[hsl(var(--success))]" : "text-destructive")}>{ptCurrency.format(summary.net)}</p>
        </div>

        <div className="rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Próximo vencimento</p>
          {!summary.upcoming ? (
            <p className="mt-3 text-sm text-muted-foreground">Nenhuma dívida</p>
          ) : isOverdue(summary.upcoming.due_date) ? (
            <div className="mt-3 space-y-1">
              <p className="text-sm text-foreground">{summary.upcoming.name}</p>
              <p className="text-sm font-semibold text-destructive">ATRASADO</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-foreground">
              {summary.upcoming.name} — {formatDate(summary.upcoming.due_date)}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {[{ label: "Todas", value: "all" }, { label: "Eu devo", value: "i_owe" }, { label: "Me devem", value: "they_owe" }].map((option) => (
            <Button
              key={option.value}
              variant={directionFilter === option.value ? "default" : "outline"}
              className="h-9 rounded-full px-4"
              onClick={() => setDirectionFilter(option.value as "all" | DebtDirection)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {[{ label: "Todos", value: "all" }, { label: "Dívidas", value: "debt" }, { label: "Empréstimos", value: "loan" }].map((option) => (
            <Button
              key={option.value}
              variant={typeFilter === option.value ? "default" : "outline"}
              className="h-9 rounded-full px-4"
              onClick={() => setTypeFilter(option.value as "all" | DebtType)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { label: "Ativos", value: "active" },
            { label: "Quitados", value: "paid_off" },
            { label: "Atrasados", value: "overdue" },
            { label: "Todos", value: "all" },
          ].map((option) => (
            <Button
              key={option.value}
              variant={statusFilter === option.value ? "default" : "outline"}
              className="h-9 rounded-full px-4"
              onClick={() => setStatusFilter(option.value as "active" | "paid_off" | "overdue" | "all")}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border p-8 text-center text-muted-foreground">Carregando...</div>
      ) : filteredDebts.length === 0 ? (
        <div className="rounded-xl border border-border px-6 py-12 text-center">
          <Handshake className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-lg font-semibold text-foreground">Nenhuma dívida ou empréstimo cadastrado</p>
          <p className="mt-1 text-sm text-muted-foreground">Quando tiver uma dívida ou receber um pagamento, cadastre aqui</p>
          <Button className="mt-5 rounded-lg" onClick={openCreate}>
            + Nova Dívida
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDebts.map((debt) => {
            const total = getTotal(debt);
            const remaining = getRemaining(debt);
            const percent = clampPercent(total > 0 ? (Number(debt.amount_paid || 0) / total) * 100 : 0);
            const uiStatus = getUiStatus(debt);
            const isFamily = debt.counterpart_type === "family_member";

            const nextInstallment = debt.has_installments ? Math.min((debt.installments_paid ?? 0) + 1, debt.total_installments ?? 1) : null;

            return (
              <div
                key={debt.id}
                className="rounded-xl border p-5"
                style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e", borderLeftWidth: 4, borderLeftColor: priorityColor[debt.priority] }}
              >
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr_1fr]">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                          debt.counterpart_type === "person" && "bg-blue-500/20",
                          debt.counterpart_type === "company" && "bg-violet-500/20",
                          debt.counterpart_type === "family_member" && "bg-accent/20",
                        )}
                      >
                        {debt.counterpart_type === "person" ? (
                          <User className="h-5 w-5 text-blue-400" />
                        ) : debt.counterpart_type === "company" ? (
                          <Building2 className="h-5 w-5 text-violet-300" />
                        ) : (
                          <span className="text-sm font-semibold text-accent">{resolveCounterpartName(debt).slice(0, 2).toUpperCase()}</span>
                        )}
                      </div>

                      <div>
                        <p className="text-base font-semibold text-foreground">{debt.name}</p>
                        <p className="text-sm text-muted-foreground">{resolveCounterpartName(debt)}</p>
                      </div>
                    </div>

                    <span
                      className={cn(
                        "inline-flex rounded-md px-2 py-1 text-xs font-semibold",
                        debt.direction === "i_owe" ? "bg-destructive/15 text-destructive" : "bg-[hsl(var(--success))/0.15] text-[hsl(var(--success))]",
                      )}
                    >
                      {debt.direction === "i_owe" ? "Eu devo" : "Me devem"}
                    </span>

                    {isFamily && <p className="text-xs text-muted-foreground">Membro da família</p>}
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Original: {ptCurrency.format(debt.original_amount)}</p>
                    {debt.has_interest && <p className="text-sm text-muted-foreground">Com juros: {ptCurrency.format(total)}</p>}
                    <p className="text-sm text-[hsl(var(--success))]">Pago: {ptCurrency.format(debt.amount_paid)}</p>
                    <p className="text-base font-semibold text-foreground">Restante: {ptCurrency.format(remaining)}</p>

                    <div className="flex items-center gap-3">
                      <Progress value={percent} className="h-2 bg-secondary" />
                      <span className="text-xs text-muted-foreground">{Math.round(percent)}% quitado</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span
                      className={cn(
                        "inline-flex rounded-md px-2 py-1 text-xs font-semibold",
                        uiStatus === "active" && "bg-accent/15 text-accent",
                        uiStatus === "paid_off" && "bg-[hsl(var(--success))/0.15] text-[hsl(var(--success))]",
                        uiStatus === "overdue" && "animate-pulse bg-destructive/20 text-destructive",
                        uiStatus === "renegotiated" && "bg-yellow-500/20 text-yellow-300",
                      )}
                    >
                      {uiStatus === "active" && "Ativo"}
                      {uiStatus === "paid_off" && "Quitado ✓"}
                      {uiStatus === "overdue" && "Atrasado!"}
                      {uiStatus === "renegotiated" && "Renegociado"}
                    </span>

                    <p className="text-sm text-muted-foreground">Vence: {formatDate(debt.due_date)}</p>
                    {debt.has_installments && debt.total_installments && (
                      <p className="text-sm text-muted-foreground">
                        Parcela {Math.min((debt.installments_paid ?? 0) + 1, debt.total_installments)}/{debt.total_installments}
                      </p>
                    )}
                    {debt.has_interest && debt.interest_rate && (
                      <p className="text-sm text-muted-foreground">
                        Juros: {debt.interest_rate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% {debt.interest_type === "monthly" ? "a.m." : debt.interest_type === "yearly" ? "a.a." : "total"}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                      <Button size="sm" className="rounded-md" onClick={() => openPaymentModal(debt)} disabled={uiStatus === "paid_off"}>
                        Registrar pagamento
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toast("Detalhes completos chegam na Fase 6B")}>Ver detalhes</Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(debt)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          setEditing(debt);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {nextInstallment && debt.has_installments && uiStatus !== "paid_off" && (
                      <p className="text-xs text-right text-muted-foreground">Parcela {nextInstallment} de {debt.total_installments}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-[580px] overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar Dívida/Empréstimo" : type === "loan" ? "Novo Empréstimo" : "Nova Dívida"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <div className="flex gap-2">
                <Button variant={type === "debt" ? "default" : "outline"} className="flex-1" onClick={() => setType("debt")}>Dívida simples</Button>
                <Button variant={type === "loan" ? "default" : "outline"} className="flex-1" onClick={() => setType("loan")}>Empréstimo (com juros)</Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Direção</Label>
              <div className="flex gap-2">
                <Button variant={direction === "i_owe" ? "default" : "outline"} className="flex-1" onClick={() => setDirection("i_owe")}>
                  <ArrowUpRight className="h-4 w-4 text-destructive" /> Eu devo
                </Button>
                <Button variant={direction === "they_owe" ? "default" : "outline"} className="flex-1" onClick={() => setDirection("they_owe")}>
                  <ArrowDownLeft className="h-4 w-4 text-[hsl(var(--success))]" /> Me devem
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="debt-name">Nome</Label>
              <Input id="debt-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Empréstimo carro, Dívida com João..." maxLength={120} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Quem é a outra parte?</Label>
                <Select value={counterpartType} onValueChange={(value: CounterpartType) => setCounterpartType(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-card text-card-foreground">
                    <SelectItem value="person">Pessoa</SelectItem>
                    <SelectItem value="company">Empresa/Banco</SelectItem>
                    <SelectItem value="family_member">Membro da família</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {counterpartType === "family_member" ? (
                <div className="space-y-2">
                  <Label>Membro</Label>
                  <Select value={counterpartMemberId || "none"} onValueChange={(value) => setCounterpartMemberId(value === "none" ? "" : value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent className="border-border bg-card text-card-foreground">
                      <SelectItem value="none">Selecione</SelectItem>
                      {members.map((member) => (
                        <SelectItem key={member.user_id} value={member.user_id}>
                          {member.profiles?.full_name?.trim() || member.profiles?.email || "Membro"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>{counterpartType === "person" ? "Nome da pessoa" : "Nome da empresa/banco"}</Label>
                  <Input
                    value={counterpartName}
                    onChange={(event) => setCounterpartName(event.target.value)}
                    placeholder={counterpartType === "person" ? "Nome da pessoa" : "Nome da empresa/banco"}
                    maxLength={120}
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Valor original</Label>
              <Input
                value={ptCurrency.format(digitsToValue(originalAmountDigits))}
                onChange={(event) => setOriginalAmountDigits(event.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
              />
            </div>

            {type === "loan" && (
              <>
                <div className="space-y-2">
                  <Label>Juros</Label>
                  <div className="flex gap-2">
                    <Button variant={hasInterest ? "default" : "outline"} className="flex-1" onClick={() => setHasInterest(true)}>Tem juros</Button>
                    <Button variant={!hasInterest ? "default" : "outline"} className="flex-1" onClick={() => setHasInterest(false)}>Sem juros</Button>
                  </div>
                </div>

                {hasInterest && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Taxa de juros (%)</Label>
                      <Input value={interestRate} onChange={(event) => setInterestRate(event.target.value.replace(/[^\d.,]/g, ""))} placeholder="1,99" />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Select value={interestType} onValueChange={(value: InterestType) => setInterestType(value)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-card text-card-foreground">
                          <SelectItem value="monthly">Ao mês</SelectItem>
                          <SelectItem value="yearly">Ao ano</SelectItem>
                          <SelectItem value="total">Total</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {hasInterest && (
                  <p className="text-sm text-muted-foreground">Valor total com juros: <span className="font-semibold text-foreground">{ptCurrency.format(totalWithInterestPreview)}</span></p>
                )}

                <div className="space-y-2">
                  <Label>Parcelas</Label>
                  <div className="flex gap-2">
                    <Button variant={hasInstallments ? "default" : "outline"} className="flex-1" onClick={() => setHasInstallments(true)}>Parcelado</Button>
                    <Button variant={!hasInstallments ? "default" : "outline"} className="flex-1" onClick={() => setHasInstallments(false)}>À vista</Button>
                  </div>
                </div>

                {hasInstallments && (
                  <>
                    <div className="space-y-2">
                      <Label>Número de parcelas</Label>
                      <Input type="number" min={2} max={360} value={totalInstallments} onChange={(event) => setTotalInstallments(event.target.value)} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {Math.max(2, installmentsCount || 2)}x de <span className="font-semibold text-foreground">{ptCurrency.format(installmentAmountPreview || 0)}</span>
                    </p>
                  </>
                )}
              </>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Data de início</Label>
                <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Data de vencimento</Label>
                <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={(value: Priority) => setPriority(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-card text-card-foreground">
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={400} />
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {editing && (
                <Button
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  Excluir
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={saveDebt} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-[400px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Registrar Pagamento — {paymentDebt?.name}</DialogTitle>
          </DialogHeader>

          {paymentDebt && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Restante: <span className="font-semibold text-foreground">{ptCurrency.format(getRemaining(paymentDebt))}</span></p>
              {paymentDebt.has_installments && paymentDebt.total_installments && (
                <p className="text-sm text-muted-foreground">Parcela {Math.min((paymentDebt.installments_paid ?? 0) + 1, paymentDebt.total_installments)} de {paymentDebt.total_installments}</p>
              )}

              <div className="space-y-2">
                <Label>Valor do pagamento</Label>
                <Input value={ptCurrency.format(digitsToValue(paymentAmountDigits))} onChange={(event) => setPaymentAmountDigits(event.target.value.replace(/\D/g, ""))} inputMode="numeric" />
              </div>

              <div className="space-y-2">
                <Label>Data</Label>
                <Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Notas</Label>
                <Input value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} maxLength={200} />
              </div>

              {paymentError && <p className="text-sm text-destructive">{paymentError}</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancelar</Button>
            <Button onClick={registerPayment} disabled={paymentSaving}>{paymentSaving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza? O histórico de pagamentos será excluído.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteDebt} disabled={deleting}>
              {deleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DebtsPage;

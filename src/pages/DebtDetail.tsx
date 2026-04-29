import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
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

type DebtRow = {
  id: string;
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
};

type DebtPaymentRow = {
  id: string;
  debt_id: string;
  amount: number;
  date: string;
  installment_number: number | null;
  notes: string | null;
  created_at: string | null;
};

type ScheduleRow = {
  installment: number;
  dueDate: string;
  amount: number;
  payment: DebtPaymentRow | null;
  status: "paid" | "pending" | "overdue" | "future";
  isCurrent: boolean;
};

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const todayIso = () => new Date().toISOString().slice(0, 10);
const formatDate = (value: string | null) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR") : "-");
const toMoneyDigits = (value: number) => String(Math.round(value * 100));
const digitsToValue = (digits: string) => Number(digits || "0") / 100;

const paymentSchema = z.object({
  amountCents: z.number().int().min(1, "Valor obrigatório"),
  date: z.string().min(10, "Data obrigatória"),
  notes: z.string().trim().max(200).optional(),
});

const addMonths = (iso: string, months: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const candidate = new Date(y, m - 1 + months, d);
  if (candidate.getMonth() !== ((m - 1 + months) % 12 + 12) % 12) candidate.setDate(0);
  const local = new Date(candidate.getTime() - candidate.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const priorityClasses: Record<Priority, string> = {
  urgent: "bg-destructive/15 text-destructive",
  high: "bg-orange-500/15 text-orange-300",
  medium: "bg-yellow-500/15 text-yellow-300",
  low: "bg-muted text-muted-foreground",
};

const DebtDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { family, members } = useFamily();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [debt, setDebt] = useState<DebtRow | null>(null);
  const [payments, setPayments] = useState<DebtPaymentRow[]>([]);

  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payAmountDigits, setPayAmountDigits] = useState("");
  const [payDate, setPayDate] = useState(todayIso());
  const [payNotes, setPayNotes] = useState("");
  const [targetInstallment, setTargetInstallment] = useState<number | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DebtPaymentRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [simMonthlyDigits, setSimMonthlyDigits] = useState("");

  const memberMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((member) => {
      const label = member.profiles?.full_name?.trim() || member.profiles?.email || "Membro";
      map.set(member.user_id, label);
      map.set(member.id, label);
    });
    return map;
  }, [members]);

  const getTotal = useCallback((item: DebtRow) => item.total_with_interest ?? item.original_amount, []);

  const getUiStatus = useCallback(
    (item: DebtRow): UiStatus => {
      if (item.status === "paid_off") return "paid_off";
      if (item.status === "renegotiated") return "renegotiated";
      const remaining = Math.max(0, getTotal(item) - Number(item.amount_paid || 0));
      if (item.status === "active" && remaining > 0 && item.due_date && item.due_date < todayIso()) return "overdue";
      return "active";
    },
    [getTotal],
  );

  const loadData = useCallback(async () => {
    if (!family?.id || !id) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const [debtRes, paymentsRes] = await Promise.all([
      supabase.from("debts").select("*").eq("family_id", family.id).eq("id", id).maybeSingle(),
      supabase.from("debt_payments").select("*").eq("family_id", family.id).eq("debt_id", id).order("date", { ascending: false }),
    ]);

    if (debtRes.error || !debtRes.data) {
      toast.error("Dívida não encontrada");
      navigate("/debts");
      return;
    }

    const raw = debtRes.data as Record<string, unknown>;
    const normalizedDebt: DebtRow = {
      id: String(raw.id ?? ""),
      name: String(raw.name ?? "Dívida"),
      description: (raw.description as string | null) ?? null,
      type: ((raw.type as DebtType | null) ?? "debt") as DebtType,
      direction: ((raw.direction as DebtDirection | null) ?? "i_owe") as DebtDirection,
      counterpart_name: (raw.counterpart_name as string | null) ?? null,
      counterpart_type: ((raw.counterpart_type as CounterpartType | null) ?? "person") as CounterpartType,
      counterpart_member_id: (raw.counterpart_member_id as string | null) ?? null,
      original_amount: Number(raw.original_amount ?? 0),
      total_with_interest: raw.total_with_interest === null || raw.total_with_interest === undefined ? null : Number(raw.total_with_interest),
      amount_paid: Number(raw.amount_paid ?? 0),
      has_interest: Boolean(raw.has_interest),
      interest_rate: raw.interest_rate === null || raw.interest_rate === undefined ? null : Number(raw.interest_rate),
      interest_type: (raw.interest_type as InterestType | null) ?? null,
      has_installments: Boolean(raw.has_installments),
      total_installments: raw.total_installments === null || raw.total_installments === undefined ? null : Number(raw.total_installments),
      installments_paid: raw.installments_paid === null || raw.installments_paid === undefined ? null : Number(raw.installments_paid),
      installment_amount: raw.installment_amount === null || raw.installment_amount === undefined ? null : Number(raw.installment_amount),
      start_date: String(raw.start_date ?? todayIso()),
      due_date: (raw.due_date as string | null) ?? null,
      status: ((raw.status as DebtStatus | null) ?? "active") as DebtStatus,
      priority: ((raw.priority as Priority | null) ?? "medium") as Priority,
    };

    const normalizedPayments = ((paymentsRes.data as Record<string, unknown>[] | null) ?? []).map<DebtPaymentRow>((row) => ({
      id: String(row.id ?? ""),
      debt_id: String(row.debt_id ?? normalizedDebt.id),
      amount: Number(row.amount ?? 0),
      date: String(row.date ?? todayIso()),
      installment_number: row.installment_number === null || row.installment_number === undefined ? null : Number(row.installment_number),
      notes: (row.notes as string | null) ?? null,
      created_at: (row.created_at as string | null) ?? null,
    }));

    setDebt(normalizedDebt);
    setPayments(normalizedPayments);

    const remaining = Math.max(0, getTotal(normalizedDebt) - normalizedDebt.amount_paid);
    const simDefault = normalizedDebt.installment_amount && normalizedDebt.installment_amount > 0 ? normalizedDebt.installment_amount : remaining / 12;
    setSimMonthlyDigits(toMoneyDigits(simDefault || 0));
    setLoading(false);
  }, [family?.id, getTotal, id, navigate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const counterpartLabel = useMemo(() => {
    if (!debt) return "-";
    if (debt.counterpart_type === "family_member") {
      return debt.counterpart_member_id ? memberMap.get(debt.counterpart_member_id) || debt.counterpart_name || "Membro" : "Membro";
    }
    return debt.counterpart_name || "Sem nome";
  }, [debt, memberMap]);

  const total = debt ? getTotal(debt) : 0;
  const remaining = debt ? Math.max(0, total - Number(debt.amount_paid || 0)) : 0;
  const paidPercent = total > 0 ? Math.max(0, Math.min(100, (Number(debt?.amount_paid || 0) / total) * 100)) : 0;
  const uiStatus = debt ? getUiStatus(debt) : "active";

  const paymentsByInstallment = useMemo(() => {
    const map = new Map<number, DebtPaymentRow>();
    payments
      .filter((payment) => payment.installment_number)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .forEach((payment) => {
        const installment = payment.installment_number as number;
        if (!map.has(installment)) map.set(installment, payment);
      });
    return map;
  }, [payments]);

  const schedule = useMemo<ScheduleRow[]>(() => {
    if (!debt?.has_installments || !debt.total_installments) return [];

    const rows: ScheduleRow[] = [];
    let nextPendingInstallment: number | null = null;

    for (let installment = 1; installment <= debt.total_installments; installment += 1) {
      const dueDate = addMonths(debt.start_date, installment);
      const payment = paymentsByInstallment.get(installment) ?? null;
      let status: ScheduleRow["status"] = "future";

      if (payment) {
        status = "paid";
      } else if (dueDate < todayIso()) {
        status = "overdue";
      } else {
        status = "pending";
      }

      if (!payment && nextPendingInstallment === null && (status === "pending" || status === "overdue")) {
        nextPendingInstallment = installment;
      }

      if (!payment && status === "pending" && nextPendingInstallment !== installment) {
        status = "future";
      }

      rows.push({
        installment,
        dueDate,
        amount: debt.installment_amount ?? total / debt.total_installments,
        payment,
        status,
        isCurrent: false,
      });
    }

    return rows.map((row) => ({ ...row, isCurrent: row.installment === nextPendingInstallment }));
  }, [debt, paymentsByInstallment, total]);

  const recalcDebtFromPayments = useCallback(
    (item: DebtRow, currentPayments: DebtPaymentRow[]) => {
      const nextAmountPaid = currentPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const nextInstallmentsPaid = item.has_installments
        ? new Set(currentPayments.map((payment) => payment.installment_number).filter((value): value is number => Boolean(value))).size
        : null;

      const paidOff = nextAmountPaid >= getTotal(item) - 0.009;

      let nextDueDate = item.due_date;
      if (item.has_installments && item.total_installments) {
        const paidSet = new Set(currentPayments.map((payment) => payment.installment_number).filter((value): value is number => Boolean(value)));
        const nextOpenInstallment = Array.from({ length: item.total_installments }, (_, index) => index + 1).find((n) => !paidSet.has(n));
        nextDueDate = nextOpenInstallment ? addMonths(item.start_date, nextOpenInstallment) : addMonths(item.start_date, item.total_installments);
      }

      return {
        amount_paid: nextAmountPaid,
        installments_paid: nextInstallmentsPaid,
        due_date: nextDueDate,
        status: paidOff ? "paid_off" : item.status === "renegotiated" ? "renegotiated" : "active",
      };
    },
    [getTotal],
  );

  const openPayModal = (installment: number | null) => {
    if (!debt) return;
    const defaultValue = installment
      ? debt.installment_amount || remaining
      : debt.installment_amount || remaining;

    setTargetInstallment(installment);
    setPayAmountDigits(toMoneyDigits(defaultValue));
    setPayDate(todayIso());
    setPayNotes("");
    setPayError(null);
    setPayOpen(true);
  };

  const registerPayment = async () => {
    if (!debt || !family?.id || !user?.id) return;

    const parsed = paymentSchema.safeParse({
      amountCents: Number(payAmountDigits || "0"),
      date: payDate,
      notes: payNotes,
    });

    if (!parsed.success) {
      setPayError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    const amount = parsed.data.amountCents / 100;
    if (amount > remaining + 0.009) {
      setPayError("Valor maior que o restante");
      return;
    }

    setPaying(true);
    setPayError(null);

    const insertRes = await supabase.from("debt_payments").insert({
      debt_id: debt.id,
      amount,
      date: parsed.data.date,
      installment_number: targetInstallment,
      notes: parsed.data.notes?.trim() || null,
      user_id: user.id,
      family_id: family.id,
    });

    if (insertRes.error) {
      setPaying(false);
      toast.error(insertRes.error.message || "Erro ao registrar pagamento");
      return;
    }

    const nextPayments = [
      ...payments,
      {
        id: "tmp",
        debt_id: debt.id,
        amount,
        date: parsed.data.date,
        installment_number: targetInstallment,
        notes: parsed.data.notes?.trim() || null,
        created_at: null,
      },
    ];

    const nextDebt = recalcDebtFromPayments(debt, nextPayments);
    const updateRes = await supabase.from("debts").update(nextDebt).eq("id", debt.id);
    setPaying(false);

    if (updateRes.error) {
      toast.error(updateRes.error.message || "Erro ao atualizar dívida");
      return;
    }

    setPayOpen(false);
    toast.success(`Pagamento de ${ptCurrency.format(amount)} registrado`);
    await loadData();
  };

  const deletePayment = async () => {
    if (!debt || !deleteTarget) return;

    setDeleting(true);
    const deleteRes = await supabase.from("debt_payments").delete().eq("id", deleteTarget.id);
    if (deleteRes.error) {
      setDeleting(false);
      toast.error(deleteRes.error.message || "Erro ao excluir pagamento");
      return;
    }

    const nextPayments = payments.filter((payment) => payment.id !== deleteTarget.id);
    const nextDebt = recalcDebtFromPayments(debt, nextPayments);
    const updateRes = await supabase.from("debts").update(nextDebt).eq("id", debt.id);
    setDeleting(false);

    if (updateRes.error) {
      toast.error(updateRes.error.message || "Erro ao atualizar dívida");
      return;
    }

    setDeleteTarget(null);
    toast.success("Pagamento removido");
    await loadData();
  };

  const simulator = useMemo(() => {
    if (!debt) return { months: 0, endDate: "-", monthlyValue: 0, saving: 0 };

    const monthlyValue = digitsToValue(simMonthlyDigits);
    if (monthlyValue <= 0 || remaining <= 0) return { months: 0, endDate: "-", monthlyValue, saving: 0 };

    let months = 0;
    if (debt.has_interest && debt.interest_type === "monthly" && (debt.interest_rate ?? 0) > 0) {
      const r = (debt.interest_rate ?? 0) / 100;
      const minPayment = remaining * r;
      if (monthlyValue <= minPayment) months = 999;
      else {
        const numerator = Math.log(monthlyValue / (monthlyValue - remaining * r));
        const denominator = Math.log(1 + r);
        months = Math.ceil(numerator / denominator);
      }
    } else {
      months = Math.ceil(remaining / monthlyValue);
    }

    const safeMonths = Number.isFinite(months) ? Math.max(1, months) : 999;
    const endDate = safeMonths >= 999 ? "-" : formatDate(addMonths(todayIso(), safeMonths));
    const projectedPaid = safeMonths >= 999 ? 0 : monthlyValue * safeMonths;
    const saving = Math.max(0, total - Number(debt.amount_paid || 0) - projectedPaid);

    return { months: safeMonths, endDate, monthlyValue, saving };
  }, [debt, remaining, simMonthlyDigits, total]);

  if (loading) {
    return <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Carregando dívida...</div>;
  }

  if (!debt) return null;

  const overdue = uiStatus === "overdue";

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" className="h-9 px-2 text-sm" style={{ color: "#888" }}>
        <Link to="/debts" className="hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Link>
      </Button>

      {overdue && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">⚠️ Esta dívida está atrasada! Vencimento era {formatDate(debt.due_date)}</p>
          <Button size="sm" className="rounded-md" onClick={() => openPayModal(null)}>
            Registrar Pagamento
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground">{debt.name}</h1>
        <span
          className={cn(
            "inline-flex rounded-md px-2 py-1 text-xs font-semibold",
            uiStatus === "active" && "bg-accent/15 text-accent",
            uiStatus === "paid_off" && "bg-[hsl(var(--success))/0.15] text-[hsl(var(--success))]",
            uiStatus === "overdue" && "bg-destructive/20 text-destructive",
            uiStatus === "renegotiated" && "bg-yellow-500/20 text-yellow-300",
          )}
        >
          {uiStatus === "active" && "Ativo"}
          {uiStatus === "paid_off" && "Quitado ✓"}
          {uiStatus === "overdue" && "Atrasado!"}
          {uiStatus === "renegotiated" && "Renegociado"}
        </span>
        <span
          className={cn(
            "inline-flex rounded-md px-2 py-1 text-xs font-semibold",
            debt.direction === "i_owe" ? "bg-destructive/15 text-destructive" : "bg-[hsl(var(--success))/0.15] text-[hsl(var(--success))]",
          )}
        >
          {debt.direction === "i_owe" ? "Eu devo" : "Me devem"}
        </span>
      </div>

      <section className="rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Tipo: <span className="text-foreground">{debt.type === "loan" ? "Empréstimo" : "Dívida"}</span></p>
            <p className="text-sm text-muted-foreground">
              Outra parte: <span className="text-foreground">{counterpartLabel}</span> <span className="text-muted-foreground/80">({debt.counterpart_type === "person" ? "Pessoa" : debt.counterpart_type === "company" ? "Empresa" : "Membro"})</span>
            </p>
            <p className="text-sm text-muted-foreground">Data início: <span className="text-foreground">{formatDate(debt.start_date)}</span></p>
            <p className="text-sm text-muted-foreground">Vencimento: <span className="text-foreground">{formatDate(debt.due_date)}</span></p>
            <div className="pt-1">
              <span className={cn("inline-flex rounded-md px-2 py-1 text-xs font-semibold", priorityClasses[debt.priority])}>
                {debt.priority === "urgent" ? "Urgente" : debt.priority === "high" ? "Alta" : debt.priority === "medium" ? "Média" : "Baixa"}
              </span>
            </div>
            {debt.description && <p className="pt-2 text-sm text-muted-foreground">{debt.description}</p>}
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Valor original: <span className="text-foreground">{ptCurrency.format(debt.original_amount)}</span></p>
            <p className="text-sm text-muted-foreground">
              Juros: <span className="text-foreground">{debt.has_interest && debt.interest_rate ? `${debt.interest_rate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% ${debt.interest_type === "monthly" ? "ao mês" : debt.interest_type === "yearly" ? "ao ano" : "total"}` : "Sem juros"}</span>
            </p>
            <p className="text-sm text-muted-foreground">Valor total: <span className="text-foreground">{ptCurrency.format(total)}</span></p>
            <p className="text-sm text-[hsl(var(--success))]">Já pago: {ptCurrency.format(debt.amount_paid)}</p>
            <p className="text-2xl font-bold text-foreground">Restante: {ptCurrency.format(remaining)}</p>
            <Progress value={paidPercent} className="h-3 rounded-full bg-secondary" />
            <p className="text-xs text-muted-foreground">{Math.round(paidPercent)}% quitado</p>
          </div>
        </div>
      </section>

      {debt.has_installments && debt.total_installments ? (
        <section className="space-y-3 rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Cronograma de Parcelas</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground">
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Vencimento</th>
                  <th className="px-3 py-2 text-left">Valor</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((row) => (
                  <tr
                    key={row.installment}
                    className={cn(
                      "border-b border-border/40",
                      row.payment && "opacity-60",
                      row.status === "overdue" && "bg-destructive/10",
                    )}
                    style={row.isCurrent ? { boxShadow: "inset 3px 0 0 hsl(var(--accent))" } : undefined}
                  >
                    <td className="px-3 py-3">{row.installment}</td>
                    <td className="px-3 py-3">{formatDate(row.dueDate)}</td>
                    <td className={cn("px-3 py-3", row.payment && "line-through")}>{ptCurrency.format(row.amount)}</td>
                    <td className="px-3 py-3">
                      {row.payment ? (
                        <span className="text-[hsl(var(--success))]">✓ Paga em {formatDate(row.payment.date)}</span>
                      ) : row.status === "overdue" ? (
                        <span className="rounded-md bg-destructive/20 px-2 py-1 text-xs font-semibold text-destructive">Atrasada</span>
                      ) : row.status === "pending" ? (
                        <span className="rounded-md bg-yellow-500/20 px-2 py-1 text-xs font-semibold text-yellow-300">Pendente</span>
                      ) : (
                        <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">Futura</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.payment ? (
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(row.payment)}>
                          Desfazer
                        </Button>
                      ) : (
                        <Button size="sm" className="rounded-md" onClick={() => openPayModal(row.installment)}>
                          Pagar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Pagamentos Realizados</h2>
          <Button size="sm" className="rounded-md" onClick={() => openPayModal(null)}>
            Registrar Pagamento
          </Button>
        </div>

        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground">
                  <th className="px-3 py-2 text-left">Data</th>
                  <th className="px-3 py-2 text-left">Valor</th>
                  <th className="px-3 py-2 text-left">Notas</th>
                  <th className="px-3 py-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-border/40">
                    <td className="px-3 py-3">{formatDate(payment.date)}</td>
                    <td className="px-3 py-3 text-[hsl(var(--success))]">{ptCurrency.format(payment.amount)}</td>
                    <td className="px-3 py-3 text-muted-foreground">{payment.notes || "-"}</td>
                    <td className="px-3 py-3 text-right">
                      <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(payment)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
        <h2 className="text-lg font-semibold text-foreground">Simulador de Quitação</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr] md:items-end">
          <div className="space-y-2">
            <Label>Pagamento mensal</Label>
            <Input value={ptCurrency.format(digitsToValue(simMonthlyDigits))} onChange={(event) => setSimMonthlyDigits(event.target.value.replace(/\D/g, ""))} inputMode="numeric" />
          </div>
          <p className="text-sm text-muted-foreground">
            Se pagar <span className="font-semibold text-foreground">{ptCurrency.format(simulator.monthlyValue)}</span> por mês, quita em{" "}
            <span className="font-semibold text-foreground">{simulator.months >= 999 ? "valor insuficiente" : `${simulator.months} meses`}</span>
            {simulator.months < 999 ? <span> (até <span className="font-semibold text-foreground">{simulator.endDate}</span>)</span> : null}.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Economia de juros: <span className="font-semibold text-[hsl(var(--success))]">{ptCurrency.format(simulator.saving)}</span> se quitar antecipado.
        </p>
      </section>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-[400px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Registrar Pagamento — {debt.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Restante: <span className="font-semibold text-foreground">{ptCurrency.format(remaining)}</span></p>
            {targetInstallment && debt.total_installments ? (
              <p className="text-sm text-muted-foreground">Parcela {targetInstallment} de {debt.total_installments}</p>
            ) : null}

            <div className="space-y-2">
              <Label>Valor do pagamento</Label>
              <Input value={ptCurrency.format(digitsToValue(payAmountDigits))} onChange={(event) => setPayAmountDigits(event.target.value.replace(/\D/g, ""))} inputMode="numeric" />
            </div>

            <div className="space-y-2">
              <Label>Data</Label>
              <Input type="date" value={payDate} onChange={(event) => setPayDate(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Notas</Label>
              <Input value={payNotes} onChange={(event) => setPayNotes(event.target.value)} maxLength={200} />
            </div>

            {payError && <p className="text-sm text-destructive">{payError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button>
            <Button onClick={registerPayment} disabled={paying}>{paying ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir pagamento?</AlertDialogTitle>
            <AlertDialogDescription>Essa ação vai remover o registro e recalcular os saldos da dívida.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deletePayment} disabled={deleting}>{deleting ? "Excluindo..." : "Excluir"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DebtDetailPage;

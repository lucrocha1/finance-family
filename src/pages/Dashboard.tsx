import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Layers,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFamily } from "@/contexts/FamilyContext";
import { useUpcomingDueDates } from "@/hooks/useUpcomingDueDates";
import { useEnsureRecurrencesUpTo } from "@/hooks/useEnsureRecurrencesUpTo";
import { supabase } from "@/integrations/supabase/client";
import { getInvoiceCycleForMonth, getOpenInvoiceWindow } from "@/lib/cardCycle";
import { useChartColors } from "@/lib/chartColors";
import { computeProjectedCash } from "@/lib/projectedCash";
import { cn } from "@/lib/utils";

type TransactionRow = {
  id: string;
  family_id: string;
  user_id: string | null;
  card_id: string | null;
  category_id: string | null;
  amount: number;
  type: "income" | "expense" | string;
  status: "paid" | "pending" | string | null;
  date: string;
  is_installment: boolean | null;
  is_recurring: boolean | null;
  categories?:
    | {
        id: string;
        name: string;
        icon: string | null;
        color: string | null;
      }
    | {
        id: string;
        name: string;
        icon: string | null;
        color: string | null;
      }[]
    | null;
};

type AccountRow = { id: string; family_id: string; balance: number };
type CardRow = {
  id: string;
  family_id: string;
  name: string;
  brand: string | null;
  credit_limit: number | null;
  closing_day: number | null;
  due_day: number | null;
};
type ScheduledPaymentRow = {
  id: string;
  family_id: string;
  due_date: string;
  amount: number | null;
  type: string | null;
  is_paid: boolean | null;
};

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const weekdayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "long" });

const toISODate = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const startOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth(), 1);
const endOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth() + 1, 0);
const formatMonthYear = (date: Date) => date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const startOfWeekMonday = (base: Date) => {
  const copy = new Date(base);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
};
const endOfWeekSunday = (base: Date) => {
  const start = startOfWeekMonday(base);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
};

const formatCompactBRL = (value: number) => {
  if (Math.abs(value) >= 1000) return `R$ ${(value / 1000).toFixed(1).replace(".", ",")} mil`;
  return ptCurrency.format(value);
};

const formatShortDate = (date: Date) => date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const daysBetween = (a: Date, b: Date) => Math.ceil((b.getTime() - a.getTime()) / 86400000);

type DonutTooltipPayload = {
  payload?: { name?: string; value?: number; percentage?: number; color?: string };
};

const DonutTooltip = ({ active, payload }: { active?: boolean; payload?: DonutTooltipPayload[] }) => {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  return (
    <div className="rounded-xl border border-border bg-popover/95 px-3 py-2 shadow-lg backdrop-blur-md">
      <div className="mb-1 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
        <span className="text-xs font-semibold text-foreground">{item.name}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold tabular-nums text-foreground">{ptCurrency.format(Number(item.value || 0))}</span>
        <span className="text-xs text-muted-foreground">{(item.percentage ?? 0).toFixed(1)}%</span>
      </div>
    </div>
  );
};

const DashboardPage = () => {
  const { family } = useFamily();
  const navigate = useNavigate();
  const chartColors = useChartColors();
  const { items: weekItems } = useUpcomingDueDates(family?.id);
  const tooltipStyle = useMemo(
    () => ({
      background: chartColors.tooltipBg,
      border: `1px solid ${chartColors.tooltipBorder}`,
      borderRadius: "0.75rem",
      color: chartColors.tooltipText,
      boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
    }),
    [chartColors],
  );

  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [previousTransactions, setPreviousTransactions] = useState<TransactionRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [cardCommitments, setCardCommitments] = useState<Pick<TransactionRow, "card_id" | "amount" | "type">[]>([]);
  const [cardTransactions, setCardTransactions] = useState<Pick<TransactionRow, "card_id" | "amount" | "date" | "status" | "category_id" | "categories">[]>([]);
  const [cumulativePendingTxs, setCumulativePendingTxs] = useState<Pick<TransactionRow, "id" | "card_id" | "amount" | "type" | "status" | "date">[]>([]);
  const [scheduledMonth, setScheduledMonth] = useState<ScheduledPaymentRow[]>([]);
  const [scheduledWeek, setScheduledWeek] = useState<ScheduledPaymentRow[]>([]);

  const [categoriesTab, setCategoriesTab] = useState<"paid" | "pending">("paid");
  const [incomeTab, setIncomeTab] = useState<"paid" | "pending">("paid");
  const [flowTab, setFlowTab] = useState<"realized" | "projected">("realized");

  const monthStart = useMemo(() => startOfMonth(selectedMonth), [selectedMonth]);
  const monthEnd = useMemo(() => endOfMonth(selectedMonth), [selectedMonth]);
  const prevMonthStart = useMemo(() => startOfMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1)), [selectedMonth]);
  const prevMonthEnd = useMemo(() => endOfMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1)), [selectedMonth]);
  const weekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weekEnd = useMemo(() => endOfWeekSunday(new Date()), []);

  // Garante que recorrências estejam materializadas até o mês visualizado.
  // Quando o usuário navega pra meses distantes, o hook estende o horizonte
  // de geração — version muda quando novas linhas são inseridas, triggando
  // reload do loadDashboard.
  const { version: recurrenceVersion } = useEnsureRecurrencesUpTo(monthEnd);

  useEffect(() => {
    if (!family?.id) {
      setLoading(false);
      setTransactions([]);
      setPreviousTransactions([]);
      setAccounts([]);
      setCards([]);
      setCardCommitments([]);
      setCardTransactions([]);
      setCumulativePendingTxs([]);
      setScheduledMonth([]);
      setScheduledWeek([]);
      return;
    }

    const loadDashboard = async () => {
      setLoading(true);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = toISODate(today);
      // Janela cumulativa: de hoje até o fim do mês visualizado.
      // Se o mês visualizado é passado, o range fica vazio (start > end) → sem projeção.
      const cumulativeEndIso = toISODate(monthEnd);
      const [txCurrent, txPrev, accountsRes, cardsRes, schedMonthRes, schedWeekRes, cardCommitRes, cardTxRes, cumulativePendingRes] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, family_id, user_id, card_id, category_id, amount, type, status, date, is_installment, is_recurring, categories ( id, name, icon, color )")
          .eq("family_id", family.id)
          .gte("date", toISODate(monthStart))
          .lte("date", toISODate(monthEnd)),
        supabase
          .from("transactions")
          .select("id, family_id, user_id, card_id, category_id, amount, type, status, date, is_installment, is_recurring")
          .eq("family_id", family.id)
          .gte("date", toISODate(prevMonthStart))
          .lte("date", toISODate(prevMonthEnd)),
        supabase.from("accounts").select("id, family_id, balance").eq("family_id", family.id),
        supabase.from("cards").select("id, family_id, name, brand, credit_limit, closing_day, due_day").eq("family_id", family.id),
        supabase
          .from("scheduled_payments")
          .select("id, family_id, due_date, amount, type, is_paid")
          .eq("family_id", family.id)
          .gte("due_date", toISODate(monthStart))
          .lte("due_date", toISODate(monthEnd)),
        supabase
          .from("scheduled_payments")
          .select("id, family_id, due_date, amount, type, is_paid")
          .eq("family_id", family.id)
          .gte("due_date", toISODate(weekStart))
          .lte("due_date", toISODate(weekEnd)),
        // Compromissos do cartão = todas as despesas com cartão ainda não pagas
        // (parcelas pending de qualquer mês). É o que define "limite utilizado".
        supabase
          .from("transactions")
          .select("card_id, amount, type")
          .eq("family_id", family.id)
          .eq("type", "expense")
          .neq("status", "paid")
          .not("card_id", "is", null),
        // Todas as despesas no cartão num range que cobre o mês visualizado.
        // Range dinâmico: min(today-60d, monthStart-60d) a max(today+90d,
        // monthEnd+30d) — garante que faturas de meses muito futuros
        // capturem assinaturas/recorrentes de cartão já geradas.
        supabase
          .from("transactions")
          .select("card_id, amount, date, status, category_id, categories(id, name, color, icon)")
          .eq("family_id", family.id)
          .eq("type", "expense")
          .not("card_id", "is", null)
          .gte("date", toISODate(new Date(Math.min(
            Date.now() - 60 * 86400000,
            monthStart.getTime() - 60 * 86400000,
          ))))
          .lte("date", toISODate(new Date(Math.max(
            Date.now() + 90 * 86400000,
            monthEnd.getTime() + 30 * 86400000,
          )))),
        // Pendências cumulativas (não-cartão) entre hoje e o fim do mês visualizado.
        // Usado pra Caixa Projetado acumular meses futuros corretamente.
        supabase
          .from("transactions")
          .select("id, card_id, amount, type, status, date")
          .eq("family_id", family.id)
          .neq("status", "paid")
          .is("card_id", null)
          .gte("date", todayIso)
          .lte("date", cumulativeEndIso),
      ]);

      setTransactions((txCurrent.data as TransactionRow[] | null) ?? []);
      setPreviousTransactions((txPrev.data as TransactionRow[] | null) ?? []);
      setAccounts((accountsRes.data as AccountRow[] | null) ?? []);
      setCards((cardsRes.data as CardRow[] | null) ?? []);
      setCardCommitments((cardCommitRes.data as Pick<TransactionRow, "card_id" | "amount" | "type">[] | null) ?? []);
      setCardTransactions((cardTxRes.data as Pick<TransactionRow, "card_id" | "amount" | "date" | "status" | "category_id" | "categories">[] | null) ?? []);
      setCumulativePendingTxs((cumulativePendingRes.data as Pick<TransactionRow, "id" | "card_id" | "amount" | "type" | "status" | "date">[] | null) ?? []);
      setScheduledMonth((schedMonthRes.data as ScheduledPaymentRow[] | null) ?? []);
      setScheduledWeek((schedWeekRes.data as ScheduledPaymentRow[] | null) ?? []);
      setLoading(false);
    };

    void loadDashboard();
  }, [family?.id, monthEnd, monthStart, prevMonthEnd, prevMonthStart, weekEnd, weekStart, recurrenceVersion]);

  // Transações de cartão cuja fatura VENCE no mês visualizado, separadas
  // por status. Usadas para popular o donut "A Pagar" (pending) e "Pago"
  // (paid) com as categorias originais das compras. Declarado ANTES de
  // totals/donutData porque eles dependem disso.
  const cardTxsDueInMonth = useMemo(() => {
    const result: Array<typeof cardTransactions[number]> = [];
    cards.forEach((card) => {
      const closingDay = Number(card.closing_day || 0);
      const dueDay = Number(card.due_day || 0);
      if (!closingDay || !dueDay) return;
      const cycle = getInvoiceCycleForMonth(closingDay, dueDay, monthStart.getFullYear(), monthStart.getMonth());
      const cycleStartIso = toISODate(cycle.cycleStart);
      const cycleEndIso = toISODate(cycle.cycleEnd);
      cardTransactions
        .filter((tx) => tx.card_id === card.id && tx.date >= cycleStartIso && tx.date <= cycleEndIso)
        .forEach((tx) => result.push(tx));
    });
    return result;
  }, [cards, cardTransactions, monthStart]);

  const totals = useMemo(() => {
    const isCash = (tx: TransactionRow) => !tx.card_id;
    const income = transactions.filter((tx) => tx.type === "income" && isCash(tx)).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const expenseDirect = transactions.filter((tx) => tx.type === "expense" && isCash(tx)).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const expenseCardPending = cardTxsDueInMonth
      .filter((tx) => tx.status !== "paid")
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const expense = expenseDirect + expenseCardPending;
    const previousIncome = previousTransactions.filter((tx) => tx.type === "income" && isCash(tx)).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const previousExpense = previousTransactions.filter((tx) => tx.type === "expense" && isCash(tx)).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    return { income, expense, balance: income - expense, previousBalance: previousIncome - previousExpense };
  }, [cardTxsDueInMonth, previousTransactions, transactions]);

  const balanceVariation = useMemo(() => {
    const current = totals.balance;
    const previous = totals.previousBalance;
    const improved = current >= previous;
    const percentage = previous === 0 ? (current === 0 ? 0 : 100) : Math.abs(((current - previous) / previous) * 100);
    return { improved, value: percentage };
  }, [totals.balance, totals.previousBalance]);

  const totalBankBalance = useMemo(() => accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0), [accounts]);

  // Faturas de cartão que vencem no mês visível, tratadas como UMA despesa
  // pendente única na data de vencimento. Se a fatura já foi paga (via
  // "Pagar Fatura"), todas as txs do ciclo viraram status=paid → unpaid=0
  // → não geramos evento sintético (o "Pagamento Fatura" não-cartão já
  // está em transactions e é contado normalmente).
  const cardInvoiceProjections = useMemo(() => {
    const events: Array<{ dueDate: Date; amount: number; cardId: string }> = [];
    cards.forEach((card) => {
      const closingDay = Number(card.closing_day || 0);
      const dueDay = Number(card.due_day || 0);
      if (!closingDay || !dueDay) return;
      const cycle = getInvoiceCycleForMonth(closingDay, dueDay, monthStart.getFullYear(), monthStart.getMonth());
      const cycleStartIso = toISODate(cycle.cycleStart);
      const cycleEndIso = toISODate(cycle.cycleEnd);
      const unpaid = cardTransactions
        .filter((tx) => tx.card_id === card.id && tx.date >= cycleStartIso && tx.date <= cycleEndIso && tx.status !== "paid")
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      if (unpaid > 0) {
        events.push({ dueDate: cycle.dueDate, amount: unpaid, cardId: card.id });
      }
    });
    return events;
  }, [cards, cardTransactions, monthStart]);

  // Projeção cumulativa: do saldo atual, somamos todas as pendências (não-cartão)
  // entre hoje e o fim do mês visualizado, e descontamos todas as faturas de cartão
  // cujo vencimento cai nessa mesma janela. Assim, ao navegar pra meses futuros, o
  // saldo projetado acumula os meses intermediários (ex: maio +500 + junho +300 = 800
  // de variação sobre o saldo atual). Pra meses passados, a janela fica vazia e a
  // projeção iguala o saldo atual.
  const projectedResult = useMemo(
    () =>
      computeProjectedCash({
        totalBankBalance,
        cumulativePendingTxs,
        cards,
        cardTransactions,
        monthEnd,
      }),
    [cumulativePendingTxs, cards, cardTransactions, monthEnd, totalBankBalance],
  );
  const projectedCash = projectedResult.projected;
  const projectedDelta = projectedResult.delta;

  const quickSummary = useMemo(() => {
    const pendingInMonth = scheduledMonth.filter((item) => !item.is_paid);
    const predictedIncome = pendingInMonth.filter((item) => item.type === "income").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const predictedExpense = pendingInMonth.filter((item) => item.type === "expense").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      predictedIncome,
      predictedExpense,
      installmentCount: transactions.filter((tx) => Boolean(tx.is_installment)).length,
      installmentPending: pendingInMonth.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      recurringCount: transactions.filter((tx) => Boolean(tx.is_recurring)).length,
    };
  }, [scheduledMonth, transactions]);

  const expensesByCard = useMemo(() => {
    // Same rule as Cards.tsx: committed limit = sum of unpaid card expenses.
    // Parcels still pending continue to hold the limit; paid parcels release it.
    const totalsByCard = new Map<string, number>();
    cardCommitments
      .filter((tx) => tx.type === "expense" && tx.card_id)
      .forEach((tx) => {
        if (!tx.card_id) return;
        totalsByCard.set(tx.card_id, (totalsByCard.get(tx.card_id) ?? 0) + Number(tx.amount || 0));
      });

    return cards.map((card) => {
      const spent = totalsByCard.get(card.id) ?? 0;
      const limit = Number(card.credit_limit || 0);
      const ratio = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
      const available = Math.max(limit - spent, 0);
      return { ...card, spent, limit, ratio, available };
    });
  }, [cardCommitments, cards]);

  // Faturas abertas (próxima a vencer) por cartão.
  const openInvoices = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return cards
      .filter((card) => Number(card.closing_day) > 0 && Number(card.due_day) > 0)
      .map((card) => {
        const window = getOpenInvoiceWindow(Number(card.closing_day), Number(card.due_day), today);
        const startIso = toISODate(window.invoiceStart);
        const endIso = toISODate(window.invoiceEnd);
        const total = cardTransactions
          .filter((tx) => tx.card_id === card.id && tx.date >= startIso && tx.date <= endIso)
          .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        const daysToClose = daysBetween(today, window.invoiceEnd);
        const daysToDue = daysBetween(today, window.dueDate);
        return {
          id: card.id,
          name: card.name,
          brand: card.brand,
          total,
          invoiceStart: window.invoiceStart,
          invoiceEnd: window.invoiceEnd,
          dueDate: window.dueDate,
          daysToClose,
          daysToDue,
        };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  }, [cardTransactions, cards]);

  const busiestDay = useMemo(() => {
    if (!scheduledWeek.length) return null;
    const map = new Map<string, number>();
    scheduledWeek.forEach((item) => {
      const dayName = capitalize(weekdayFormatter.format(new Date(`${item.due_date}T00:00:00`)));
      map.set(dayName, (map.get(dayName) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [scheduledWeek]);

  const donutData = useMemo(() => {
    const grouped = new Map<string, { name: string; value: number; color: string }>();
    const addTx = (tx: { amount: number; category_id?: string | null; categories?: TransactionRow["categories"] }) => {
      const rawCategory = Array.isArray(tx.categories) ? tx.categories[0] : tx.categories;
      const key = tx.category_id || rawCategory?.id || "sem_categoria";
      const name = rawCategory?.name || "Sem categoria";
      const color = rawCategory?.color || "#6b7280";
      const value = Number(tx.amount || 0);
      const current = grouped.get(key);
      if (current) current.value += value;
      else grouped.set(key, { name, value, color });
    };

    // Despesas não-cartão do mês visível.
    transactions
      .filter((tx) => tx.type === "expense" && !tx.card_id)
      .filter((tx) => (categoriesTab === "paid" ? tx.status === "paid" : tx.status === "pending"))
      .forEach(addTx);

    // Despesas de cartão cuja fatura VENCE no mês visualizado, agrupadas
    // pelas categorias das compras (não pelo cartão). Pago/A Pagar é
    // determinado pelo status: paid (fatura quitada) vs pending (fatura
    // ainda aberta). Isso garante que faturas a vencer apareçam em
    // "A Pagar" e faturas pagas via "Pagar Fatura" apareçam em "Pago".
    cardTxsDueInMonth
      .filter((tx) => (categoriesTab === "paid" ? tx.status === "paid" : tx.status !== "paid"))
      .forEach(addTx);

    const total = [...grouped.values()].reduce((sum, item) => sum + item.value, 0);
    const sorted = [...grouped.values()].sort((a, b) => b.value - a.value);
    const TOP = 6;
    const top = sorted.slice(0, TOP);
    const rest = sorted.slice(TOP);
    const rows = top.map((item) => ({ ...item, percentage: total > 0 ? (item.value / total) * 100 : 0 }));
    if (rest.length > 0) {
      const restValue = rest.reduce((sum, item) => sum + item.value, 0);
      rows.push({ name: `Outros (${rest.length})`, value: restValue, color: "#6b7280", percentage: total > 0 ? (restValue / total) * 100 : 0 });
    }
    return { rows, total };
  }, [cardTxsDueInMonth, categoriesTab, transactions]);

  const incomeDonutData = useMemo(() => {
    const grouped = new Map<string, { name: string; value: number; color: string }>();
    transactions
      .filter((tx) => tx.type === "income")
      .filter((tx) => (incomeTab === "paid" ? tx.status === "paid" : tx.status === "pending"))
      .forEach((tx) => {
        const rawCategory = Array.isArray(tx.categories) ? tx.categories[0] : tx.categories;
        const key = tx.category_id || rawCategory?.id || "sem_categoria";
        const name = rawCategory?.name || "Sem categoria";
        const color = rawCategory?.color || "#22c55e";
        const value = Number(tx.amount || 0);
        const current = grouped.get(key);
        if (current) current.value += value;
        else grouped.set(key, { name, value, color });
      });

    const total = [...grouped.values()].reduce((sum, item) => sum + item.value, 0);
    const sorted = [...grouped.values()].sort((a, b) => b.value - a.value);
    const TOP = 6;
    const top = sorted.slice(0, TOP);
    const rest = sorted.slice(TOP);
    const rows = top.map((item) => ({ ...item, percentage: total > 0 ? (item.value / total) * 100 : 0 }));
    if (rest.length > 0) {
      const restValue = rest.reduce((sum, item) => sum + item.value, 0);
      rows.push({ name: `Outros (${rest.length})`, value: restValue, color: "#6b7280", percentage: total > 0 ? (restValue / total) * 100 : 0 });
    }
    return { rows, total };
  }, [incomeTab, transactions]);

  const flowData = useMemo(() => {
    const daysInMonth = monthEnd.getDate();
    const rows = Array.from({ length: daysInMonth }, (_, index) => ({ day: index + 1, change: 0, saldo: 0 }));

    // Card-funded transactions don't affect cash flow individually —
    // the invoice payment does, as a single event on its due date.
    transactions
      .filter((tx) => !tx.card_id)
      .filter((tx) => (flowTab === "realized" ? tx.status === "paid" : tx.status === "paid" || tx.status === "pending" || tx.status === null))
      .forEach((tx) => {
        const day = new Date(`${tx.date}T00:00:00`).getDate();
        const index = day - 1;
        if (index < 0 || index >= rows.length) return;
        rows[index].change += tx.type === "income" ? Number(tx.amount || 0) : -Number(tx.amount || 0);
      });

    // Inject projected card-invoice payments on their due date (only on
    // the projected tab — realized shows real payments only).
    if (flowTab === "projected") {
      cardInvoiceProjections.forEach((ev) => {
        if (ev.dueDate.getMonth() !== monthEnd.getMonth() || ev.dueDate.getFullYear() !== monthEnd.getFullYear()) return;
        const index = ev.dueDate.getDate() - 1;
        if (index < 0 || index >= rows.length) return;
        rows[index].change -= ev.amount;
      });
    }

    let running = 0;
    return rows.map((row) => {
      running += row.change;
      return { ...row, saldo: running };
    });
  }, [cardInvoiceProjections, flowTab, monthEnd, transactions]);

  const flowLastValue = flowData[flowData.length - 1]?.saldo ?? 0;

  return (
    <div className="space-y-6">
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-2">
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-2 py-2">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))} aria-label="◀ Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="min-w-[190px] text-center text-base font-bold text-foreground">{capitalize(formatMonthYear(selectedMonth))}</p>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))} aria-label="Próximo mês ▶">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-lg border-border bg-card text-xs font-medium"
          onClick={() => setSelectedMonth(startOfMonth(new Date()))}
          disabled={selectedMonth.getFullYear() === new Date().getFullYear() && selectedMonth.getMonth() === new Date().getMonth()}
        >
          Mês atual
        </Button>
      </div>

      <div className="relative overflow-hidden rounded-2xl bg-brandDark p-6 text-white shadow-card sm:p-8">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 h-full w-1/2 text-white/[0.05]"
          viewBox="0 0 400 200"
          preserveAspectRatio="xMaxYMid slice"
        >
          <defs>
            <pattern id="heroPattern" x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M0 24 L24 0 L48 24 L24 48 Z" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="400" height="200" fill="url(#heroPattern)" />
        </svg>

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[1px] text-brandDark-muted">Saldo bancário</p>
            <div className="flex items-baseline gap-3">
              <p className="text-4xl font-bold tabular-nums sm:text-5xl">{ptCurrency.format(totalBankBalance)}</p>
              <span className="text-sm font-medium text-brandDark-muted">
                {accounts.length} conta{accounts.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="pill" onClick={() => navigate("/transactions")} className="gap-2">
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
            <Button size="pill" variant="outline-dark" onClick={() => navigate("/transactions")} className="gap-2">
              <Send className="h-4 w-4" />
              Transferir
            </Button>
            <Button size="pill" variant="outline-dark" onClick={() => navigate("/schedule")} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Agendar
            </Button>
            <Button size="icon-pill" variant="ghost-dark" onClick={() => navigate("/settings")} aria-label="Mais ações">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <Card className="rounded-xl border-border bg-card">
        <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Saldo atual</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{ptCurrency.format(totalBankBalance)}</p>
            <p className="text-xs text-muted-foreground">Soma das contas</p>
          </div>
          <div className="sm:border-l sm:border-border sm:pl-4">
            <p className="text-xs font-semibold uppercase tracking-[0.5px] text-primary">Caixa Projetado</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", projectedCash >= 0 ? "text-foreground" : "text-destructive")}>
              {ptCurrency.format(projectedCash)}
            </p>
            <p className="text-xs text-muted-foreground">Saldo + pendências até fim do mês</p>
          </div>
          <div className="sm:border-l sm:border-border sm:pl-4">
            <p className="text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Variação prevista</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", projectedDelta >= 0 ? "text-success" : "text-destructive")}>
              {projectedDelta >= 0 ? "+" : ""}{ptCurrency.format(projectedDelta)}
            </p>
            <p className="text-xs text-muted-foreground">Receitas − despesas pendentes</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="rounded-xl border-border bg-card">
          <CardHeader className="space-y-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold">Categorias</CardTitle>
              <div className="flex rounded-lg bg-secondary p-1">
                <button type="button" onClick={() => setCategoriesTab("paid")} className={cn("rounded-md px-3 py-1 text-xs font-semibold", categoriesTab === "paid" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Pago</button>
                <button type="button" onClick={() => setCategoriesTab("pending")} className={cn("rounded-md px-3 py-1 text-xs font-semibold", categoriesTab === "pending" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>A Pagar</button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <div className="relative aspect-square h-[200px] w-full max-w-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {donutData.rows.length ? (
                    <Pie data={donutData.rows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="none">
                      {donutData.rows.map((entry, idx) => (
                        <Cell key={`${entry.name}-${idx}`} fill={entry.color} />
                      ))}
                    </Pie>
                  ) : (
                    <Pie data={[{ value: 1 }]} dataKey="value" innerRadius="55%" outerRadius="85%" stroke="none" fill="hsl(var(--border))" />
                  )}
                  <Tooltip content={<DonutTooltip />} cursor={false} offset={16} wrapperStyle={{ outline: "none" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-sm font-semibold text-foreground">{formatCompactBRL(donutData.total)}</p>
                <p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">TOTAL</p>
                {!donutData.rows.length && <p className="mt-2 text-xs text-muted-foreground">Sem despesas no período</p>}
              </div>
            </div>

            <div className="w-full min-w-0 space-y-2">
              {donutData.rows.length ? (
                donutData.rows.map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-1.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="truncate text-sm text-foreground">{item.name}</span>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
                      <span className="text-sm font-semibold text-foreground">{ptCurrency.format(item.value)}</span>
                      <span className="text-xs text-muted-foreground">{item.percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem dados no período</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border bg-card">
          <CardHeader className="space-y-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold">Receitas por Categoria</CardTitle>
              <div className="flex rounded-lg bg-secondary p-1">
                <button type="button" onClick={() => setIncomeTab("paid")} className={cn("rounded-md px-3 py-1 text-xs font-semibold", incomeTab === "paid" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Recebido</button>
                <button type="button" onClick={() => setIncomeTab("pending")} className={cn("rounded-md px-3 py-1 text-xs font-semibold", incomeTab === "pending" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>A Receber</button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <div className="relative aspect-square h-[200px] w-full max-w-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {incomeDonutData.rows.length ? (
                    <Pie data={incomeDonutData.rows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="none">
                      {incomeDonutData.rows.map((entry, idx) => (
                        <Cell key={`${entry.name}-${idx}`} fill={entry.color} />
                      ))}
                    </Pie>
                  ) : (
                    <Pie data={[{ value: 1 }]} dataKey="value" innerRadius="55%" outerRadius="85%" stroke="none" fill="hsl(var(--border))" />
                  )}
                  <Tooltip content={<DonutTooltip />} cursor={false} offset={16} wrapperStyle={{ outline: "none" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-sm font-semibold text-foreground">{formatCompactBRL(incomeDonutData.total)}</p>
                <p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">TOTAL</p>
                {!incomeDonutData.rows.length && <p className="mt-2 text-xs text-muted-foreground">Sem receitas no período</p>}
              </div>
            </div>

            <div className="w-full min-w-0 space-y-2">
              {incomeDonutData.rows.length ? (
                incomeDonutData.rows.map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-1.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="truncate text-sm text-foreground">{item.name}</span>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
                      <span className="text-sm font-semibold text-foreground">{ptCurrency.format(item.value)}</span>
                      <span className="text-xs text-muted-foreground">{item.percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem dados no período</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border bg-card">
          <CardHeader className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Fluxo de Caixa</p>
                <p className={cn("mt-2 text-3xl font-bold tabular-nums", flowLastValue >= 0 ? "text-success" : "text-destructive")}>{ptCurrency.format(flowLastValue)}</p>
              </div>
              <div className="flex rounded-lg bg-secondary p-1">
                <button type="button" onClick={() => setFlowTab("realized")} className={cn("rounded-md px-3 py-1 text-xs font-semibold", flowTab === "realized" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Realizado</button>
                <button type="button" onClick={() => setFlowTab("projected")} className={cn("rounded-md px-3 py-1 text-xs font-semibold", flowTab === "projected" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Projetado</button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={flowData}>
                  <defs>
                    <linearGradient id="flowGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.55} />
                      <stop offset="60%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartColors.grid} strokeOpacity={0.65} vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: chartColors.axis, fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: chartColors.axis, fontSize: 11 }} tickFormatter={(value) => formatCompactBRL(value)} tickLine={false} axisLine={false} width={72} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => ptCurrency.format(Number(value || 0))} labelFormatter={(label) => `Dia ${label}`} />
                  <Area type="monotone" dataKey="saldo" stroke="hsl(var(--primary))" strokeWidth={2} strokeOpacity={flowTab === "projected" ? 0.4 : 1} fill="url(#flowGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {!flowData.some((row) => row.change !== 0) && <p className="mt-2 text-center text-sm text-muted-foreground">Sem movimentações no período</p>}
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border bg-card">
          <CardHeader className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Fluxo do período</p>
            <CardDescription className="text-sm text-muted-foreground">Receitas menos despesas no mês</CardDescription>
            <div className="flex items-baseline gap-3">
              <CardTitle className={cn("text-3xl font-bold tabular-nums", totals.balance >= 0 ? "text-success" : "text-destructive")}>
                {ptCurrency.format(totals.balance)}
              </CardTitle>
              <span className={cn("text-sm font-semibold", balanceVariation.improved ? "text-success" : "text-destructive")}>
                {balanceVariation.improved ? "↗" : "↘"} {balanceVariation.value.toFixed(1)}%
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Receitas</span>
              <span className="font-semibold tabular-nums text-success">{ptCurrency.format(totals.income)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Despesas</span>
              <span className="font-semibold tabular-nums text-destructive">{ptCurrency.format(totals.expense)}</span>
            </div>
            <div className="border-t border-border pt-2 text-xs">
              vs. {ptCurrency.format(totals.previousBalance)} no período anterior
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Resumo rápido</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="mb-2 flex items-center gap-2 text-success"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/20"><ArrowUpRight className="h-3.5 w-3.5" /></span><span className="text-sm font-semibold">Receitas</span></div>
              <p className="text-lg font-bold tabular-nums">{ptCurrency.format(totals.income)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Previsto: {ptCurrency.format(quickSummary.predictedIncome)}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="mb-2 flex items-center gap-2 text-destructive"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/20"><ArrowDownRight className="h-3.5 w-3.5" /></span><span className="text-sm font-semibold">Despesas</span></div>
              <p className="text-lg font-bold tabular-nums">{ptCurrency.format(totals.expense)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Previsto: {ptCurrency.format(quickSummary.predictedExpense)}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="mb-2 flex items-center gap-2 text-info"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-info/20"><Layers className="h-3.5 w-3.5" /></span><span className="text-sm font-semibold">Parceladas</span></div>
              <p className="text-lg font-bold tabular-nums">{quickSummary.installmentCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">A pagar: {ptCurrency.format(quickSummary.installmentPending)}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="mb-2 flex items-center gap-2 text-primary"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20"><RefreshCw className="h-3.5 w-3.5" /></span><span className="text-sm font-semibold">Recorrentes</span></div>
              <p className="text-lg font-bold tabular-nums">{quickSummary.recurringCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">No período</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border bg-card">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold">Gastos por Cartão</CardTitle>
              <Link to="/cards" className="text-sm font-medium text-primary hover:opacity-80">Ver todos →</Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {expensesByCard.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground"><p>Nenhum cartão cadastrado.</p><Link to="/cards" className="mt-2 inline-block font-medium text-primary hover:opacity-80">Ir para cartões →</Link></div>
            ) : (
              expensesByCard.map((card) => {
                const usageColor = card.ratio >= 80 ? "bg-destructive" : card.ratio >= 50 ? "bg-warning" : "bg-success";
                return (
                  <div key={card.id} className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
                    <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm font-semibold"><CreditCard className="h-4 w-4 text-muted-foreground" />{card.name} {card.brand ? `- ${card.brand}` : ""}</p><p className="text-sm font-semibold tabular-nums">{ptCurrency.format(card.spent)}</p></div>
                    <p className="text-xs text-muted-foreground">de {ptCurrency.format(card.limit)}</p>
                    <div className="h-2 w-full rounded-full bg-secondary"><div className={cn("h-2 rounded-full transition-all", usageColor)} style={{ width: `${card.ratio}%` }} /></div>
                    <p className="text-xs text-muted-foreground">Disponível: {ptCurrency.format(card.available)} ({Math.max(100 - card.ratio, 0).toFixed(0)}%)</p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border bg-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold">Próximas Faturas</CardTitle>
              <Link to="/cards" className="text-sm font-medium text-primary hover:opacity-80">Ver cartões →</Link>
            </div>
            <CardDescription className="text-xs text-muted-foreground">Compras feitas após o fechamento entram na fatura seguinte</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {openInvoices.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
                Nenhuma fatura aberta com lançamentos.
              </div>
            ) : (
              openInvoices.map((inv) => {
                const urgent = inv.daysToDue <= 7;
                return (
                  <div key={inv.id} className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                        {inv.name} {inv.brand ? `· ${inv.brand}` : ""}
                      </p>
                      <p className="text-base font-bold tabular-nums">{ptCurrency.format(inv.total)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>
                        <p className="uppercase tracking-wide">Fecha</p>
                        <p className="font-semibold text-foreground">
                          {formatShortDate(inv.invoiceEnd)} <span className="font-normal text-muted-foreground">({inv.daysToClose === 0 ? "hoje" : `em ${inv.daysToClose}d`})</span>
                        </p>
                      </div>
                      <div>
                        <p className="uppercase tracking-wide">Vence</p>
                        <p className={cn("font-semibold", urgent ? "text-warning" : "text-foreground")}>
                          {formatShortDate(inv.dueDate)} <span className="font-normal text-muted-foreground">({inv.daysToDue === 0 ? "hoje" : `em ${inv.daysToDue}d`})</span>
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border bg-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold">Compromissos da Semana</CardTitle>
              <Link to="/schedule" className="text-sm font-medium text-primary hover:opacity-80">Ver Agenda →</Link>
            </div>
            <CardDescription className="text-xs text-muted-foreground">Vencimentos, faturas e dívidas dos próximos 7 dias</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {weekItems.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarCheck2 className="h-4 w-4 text-success" />Nada vencendo nos próximos dias</div>
            ) : (
              weekItems.slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.routeTarget ?? "/schedule")}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2 text-left hover:bg-secondary/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{item.description}</p>
                    <p className="text-xs text-muted-foreground">{new Date(`${item.date}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</p>
                  </div>
                  <span className={cn("shrink-0 text-sm font-semibold tabular-nums", item.type === "income" ? "text-success" : "text-destructive")}>
                    {item.type === "income" ? "+" : "-"}{ptCurrency.format(item.amount)}
                  </span>
                </button>
              ))
            )}
          </CardContent>
        </Card>

      </div>

      {loading && <p className="text-center text-sm text-muted-foreground">Atualizando dados do dashboard...</p>}
    </div>
  );
};

export default DashboardPage;
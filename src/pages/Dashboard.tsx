import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarCheck2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Layers,
  RefreshCw,
  UserCircle2,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
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
type CardRow = { id: string; family_id: string; name: string; brand: string | null; credit_limit: number | null };
type ScheduledPaymentRow = {
  id: string;
  family_id: string;
  due_date: string;
  amount: number | null;
  type: string | null;
  status: string | null;
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

const getSparklinePath = (values: number[], width = 100, height = 60) => {
  if (values.length < 2) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 6) - 3;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
};

const tooltipStyle = {
  background: "#1a1a24",
  border: "1px solid #2e2e3e",
  borderRadius: "0.75rem",
  color: "#fff",
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
};

const DashboardPage = () => {
  const { user } = useAuth();
  const { family, members } = useFamily();

  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [previousTransactions, setPreviousTransactions] = useState<TransactionRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [scheduledMonth, setScheduledMonth] = useState<ScheduledPaymentRow[]>([]);
  const [scheduledToday, setScheduledToday] = useState<ScheduledPaymentRow[]>([]);
  const [scheduledWeek, setScheduledWeek] = useState<ScheduledPaymentRow[]>([]);

  const [categoriesTab, setCategoriesTab] = useState<"paid" | "pending">("paid");
  const [flowTab, setFlowTab] = useState<"realized" | "projected">("realized");
  const [dailyTab, setDailyTab] = useState<"realized" | "projected">("realized");

  const monthStart = useMemo(() => startOfMonth(selectedMonth), [selectedMonth]);
  const monthEnd = useMemo(() => endOfMonth(selectedMonth), [selectedMonth]);
  const prevMonthStart = useMemo(() => startOfMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1)), [selectedMonth]);
  const prevMonthEnd = useMemo(() => endOfMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1)), [selectedMonth]);
  const weekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weekEnd = useMemo(() => endOfWeekSunday(new Date()), []);

  useEffect(() => {
    if (!family?.id) {
      setLoading(false);
      setTransactions([]);
      setPreviousTransactions([]);
      setAccounts([]);
      setCards([]);
      setScheduledMonth([]);
      setScheduledToday([]);
      setScheduledWeek([]);
      return;
    }

    const loadDashboard = async () => {
      setLoading(true);
      const [txCurrent, txPrev, accountsRes, cardsRes, schedMonthRes, schedTodayRes, schedWeekRes] = await Promise.all([
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
        supabase.from("cards").select("id, family_id, name, brand, credit_limit").eq("family_id", family.id),
        supabase
          .from("scheduled_payments")
          .select("id, family_id, due_date, amount, type, status")
          .eq("family_id", family.id)
          .gte("due_date", toISODate(monthStart))
          .lte("due_date", toISODate(monthEnd)),
        supabase.from("scheduled_payments").select("id, family_id, due_date, amount, type, status").eq("family_id", family.id).eq("due_date", toISODate(new Date())),
        supabase
          .from("scheduled_payments")
          .select("id, family_id, due_date, amount, type, status")
          .eq("family_id", family.id)
          .gte("due_date", toISODate(weekStart))
          .lte("due_date", toISODate(weekEnd)),
      ]);

      setTransactions((txCurrent.data as TransactionRow[] | null) ?? []);
      setPreviousTransactions((txPrev.data as TransactionRow[] | null) ?? []);
      setAccounts((accountsRes.data as AccountRow[] | null) ?? []);
      setCards((cardsRes.data as CardRow[] | null) ?? []);
      setScheduledMonth((schedMonthRes.data as ScheduledPaymentRow[] | null) ?? []);
      setScheduledToday((schedTodayRes.data as ScheduledPaymentRow[] | null) ?? []);
      setScheduledWeek((schedWeekRes.data as ScheduledPaymentRow[] | null) ?? []);
      setLoading(false);
    };

    void loadDashboard();
  }, [family?.id, monthEnd, monthStart, prevMonthEnd, prevMonthStart, weekEnd, weekStart]);

  const totals = useMemo(() => {
    const income = transactions.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const expense = transactions.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const previousIncome = previousTransactions.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const previousExpense = previousTransactions.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    return { income, expense, balance: income - expense, previousBalance: previousIncome - previousExpense };
  }, [previousTransactions, transactions]);

  const balanceVariation = useMemo(() => {
    const current = totals.balance;
    const previous = totals.previousBalance;
    const improved = current >= previous;
    const percentage = previous === 0 ? (current === 0 ? 0 : 100) : Math.abs(((current - previous) / previous) * 100);
    return { improved, value: percentage };
  }, [totals.balance, totals.previousBalance]);

  const dailyCumulative = useMemo(() => {
    const daysInMonth = monthEnd.getDate();
    const dailyChanges = Array.from({ length: daysInMonth }, () => 0);
    transactions.forEach((tx) => {
      const txDate = new Date(`${tx.date}T00:00:00`);
      const dayIndex = txDate.getDate() - 1;
      if (dayIndex < 0 || dayIndex >= dailyChanges.length) return;
      dailyChanges[dayIndex] += tx.type === "income" ? Number(tx.amount || 0) : -Number(tx.amount || 0);
    });
    let running = 0;
    return dailyChanges.map((change) => {
      running += change;
      return running;
    });
  }, [monthEnd, transactions]);

  const totalBankBalance = useMemo(() => accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0), [accounts]);

  const quickSummary = useMemo(() => {
    const pendingInMonth = scheduledMonth.filter((item) => item.status !== "paid");
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
    const totalsByCard = new Map<string, number>();
    transactions
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
  }, [cards, transactions]);

  const busiestDay = useMemo(() => {
    if (!scheduledWeek.length) return null;
    const map = new Map<string, number>();
    scheduledWeek.forEach((item) => {
      const dayName = capitalize(weekdayFormatter.format(new Date(`${item.due_date}T00:00:00`)));
      map.set(dayName, (map.get(dayName) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [scheduledWeek]);

  const expensesByUser = useMemo(() => {
    const totalsByUser = new Map<string, number>();
    transactions
      .filter((tx) => tx.type === "expense" && tx.user_id)
      .forEach((tx) => {
        if (!tx.user_id) return;
        totalsByUser.set(tx.user_id, (totalsByUser.get(tx.user_id) ?? 0) + Number(tx.amount || 0));
      });

    const rows = members.map((member) => {
      const name = member.profiles?.full_name?.trim() || member.profiles?.email || "Usuário";
      const total = totalsByUser.get(member.user_id) ?? 0;
      const initials = name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("") || "U";
      return { id: member.user_id, name, initials, total };
    });

    const max = rows.reduce((highest, item) => Math.max(highest, item.total), 0);
    return rows.map((row) => ({ ...row, progress: max > 0 ? (row.total / max) * 100 : 0 })).sort((a, b) => b.total - a.total);
  }, [members, transactions]);

  const donutData = useMemo(() => {
    const grouped = new Map<string, { name: string; value: number; color: string }>();
    transactions
      .filter((tx) => tx.type === "expense")
      .filter((tx) => (categoriesTab === "paid" ? tx.status === "paid" : tx.status === "pending"))
      .forEach((tx) => {
        const rawCategory = Array.isArray(tx.categories) ? tx.categories[0] : tx.categories;
        const key = tx.category_id || rawCategory?.id || "sem_categoria";
        const name = rawCategory?.name || "Sem categoria";
        const color = rawCategory?.color || "#6b7280";
        const value = Number(tx.amount || 0);
        const current = grouped.get(key);
        if (current) current.value += value;
        else grouped.set(key, { name, value, color });
      });

    const total = [...grouped.values()].reduce((sum, item) => sum + item.value, 0);
    const rows = [...grouped.values()]
      .map((item) => ({ ...item, percentage: total > 0 ? (item.value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);

    return { rows, total };
  }, [categoriesTab, transactions]);

  const flowData = useMemo(() => {
    const daysInMonth = monthEnd.getDate();
    const rows = Array.from({ length: daysInMonth }, (_, index) => ({ day: index + 1, change: 0, saldo: 0 }));

    transactions
      .filter((tx) => (flowTab === "realized" ? tx.status === "paid" : tx.status === "paid" || tx.status === "pending" || tx.status === null))
      .forEach((tx) => {
        const day = new Date(`${tx.date}T00:00:00`).getDate();
        const index = day - 1;
        if (index < 0 || index >= rows.length) return;
        rows[index].change += tx.type === "income" ? Number(tx.amount || 0) : -Number(tx.amount || 0);
      });

    let running = 0;
    return rows.map((row) => {
      running += row.change;
      return { ...row, saldo: running };
    });
  }, [flowTab, monthEnd, transactions]);

  const dailyMovementData = useMemo(() => {
    const daysInMonth = monthEnd.getDate();
    const rows = Array.from({ length: daysInMonth }, (_, index) => ({ day: index + 1, income: 0, expense: 0 }));

    transactions
      .filter((tx) => (dailyTab === "realized" ? tx.status === "paid" : tx.status === "paid" || tx.status === "pending" || tx.status === null))
      .forEach((tx) => {
        const day = new Date(`${tx.date}T00:00:00`).getDate() - 1;
        if (day < 0 || day >= rows.length) return;
        if (tx.type === "income") rows[day].income += Number(tx.amount || 0);
        if (tx.type === "expense") rows[day].expense += Number(tx.amount || 0);
      });

    return rows.map((row) => ({ ...row, expenseNegative: row.expense * -1 }));
  }, [dailyTab, monthEnd, transactions]);

  const flowLastValue = flowData[flowData.length - 1]?.saldo ?? 0;
  const totalMovements = dailyMovementData.reduce((sum, row) => sum + row.income + row.expense, 0);
  const sparkPath = useMemo(() => getSparklinePath(dailyCumulative), [dailyCumulative]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="min-w-[170px] text-center text-base font-bold text-foreground">{capitalize(formatMonthYear(selectedMonth))}</p>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))} aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="rounded-xl border-border bg-card">
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Saldo do período</p>
                <CardDescription className="mt-2 text-sm text-muted-foreground">Saldo (Receitas - Despesas) no período selecionado.</CardDescription>
              </div>
              <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", balanceVariation.improved ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive")}>
                {balanceVariation.improved ? "↗" : "↘"} {balanceVariation.value.toFixed(1)}%
              </span>
            </div>
            <CardTitle className={cn("text-3xl font-bold tabular-nums", totals.balance >= 0 ? "text-success" : "text-destructive")}>{ptCurrency.format(totals.balance)}</CardTitle>
          </CardHeader>
          <CardContent>
            {sparkPath ? (
              <svg viewBox="0 0 100 60" className="h-[60px] w-full" role="img" aria-label="Evolução diária do saldo acumulado">
                <path d={sparkPath} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            ) : (
              <div className="flex h-[60px] items-center justify-center gap-2 text-sm text-muted-foreground">
                <CalendarCheck2 className="h-4 w-4 text-muted-foreground" />
                Sem dados no período
              </div>
            )}
          </CardContent>
        </Card>

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
          <CardContent className="flex flex-col gap-4 lg:flex-row">
            <div className="relative h-[220px] w-full lg:w-1/2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {donutData.rows.length ? (
                    <Pie data={donutData.rows} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2} stroke="none">
                      {donutData.rows.map((entry, idx) => (
                        <Cell key={`${entry.name}-${idx}`} fill={entry.color} />
                      ))}
                    </Pie>
                  ) : (
                    <Pie data={[{ value: 1 }]} dataKey="value" innerRadius={60} outerRadius={90} stroke="none" fill="hsl(var(--border))" />
                  )}
                  <Tooltip
                    formatter={(value: number, _name: string, payload: { payload?: { percentage?: number } }) => [
                      ptCurrency.format(Number(value || 0)),
                      `${(payload.payload?.percentage ?? 0).toFixed(1)}%`,
                    ]}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "#fff" }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-sm font-semibold text-foreground">{formatCompactBRL(donutData.total)}</p>
                <p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">TOTAL</p>
                {!donutData.rows.length && <p className="mt-2 text-xs text-muted-foreground">Sem despesas no período</p>}
              </div>
            </div>

            <div className="max-h-[220px] flex-1 space-y-2 overflow-y-auto pr-1">
              {donutData.rows.length ? (
                donutData.rows.map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-sm text-foreground">{item.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-foreground">{ptCurrency.format(item.value)}</p>
                      <p className="text-xs text-muted-foreground">{item.percentage.toFixed(1)}%</p>
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
                <LineChart data={flowData}>
                  <XAxis dataKey="day" tick={{ fill: "#666", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} tickFormatter={(value) => formatCompactBRL(value)} tickLine={false} axisLine={false} width={72} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => ptCurrency.format(Number(value || 0))} labelFormatter={(label) => `Dia ${label}`} />
                  <Line type="monotone" dataKey="saldo" stroke="#d946ef" strokeOpacity={flowTab === "projected" ? 0.4 : 1} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {!flowData.some((row) => row.change !== 0) && <p className="mt-2 text-center text-sm text-muted-foreground">Sem movimentações no período</p>}
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border bg-card">
          <CardHeader className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Saldo bancário total</p>
            <CardDescription className="text-sm text-muted-foreground">Soma de todas as contas cadastradas</CardDescription>
            <CardTitle className="text-3xl font-bold tabular-nums">{ptCurrency.format(totalBankBalance)}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link to="/settings" className="text-sm font-medium text-primary hover:opacity-80">Ver todas as contas →</Link>
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
          <CardHeader className="space-y-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold">Movimentação Diária</CardTitle>
              <div className="flex rounded-lg bg-secondary p-1">
                <button type="button" onClick={() => setDailyTab("realized")} className={cn("rounded-md px-3 py-1 text-xs font-semibold", dailyTab === "realized" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Realizado</button>
                <button type="button" onClick={() => setDailyTab("projected")} className={cn("rounded-md px-3 py-1 text-xs font-semibold", dailyTab === "projected" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Projetado</button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Total no mês: <span className="font-semibold text-foreground">{ptCurrency.format(totalMovements)}</span></p>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyMovementData}>
                  <XAxis dataKey="day" tick={{ fill: "#666", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} tickFormatter={(value) => formatCompactBRL(value)} tickLine={false} axisLine={false} width={72} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [ptCurrency.format(Math.abs(Number(value || 0))), name === "income" ? "Receitas" : "Despesas"]} labelFormatter={(label) => `Dia ${label}`} />
                  <Bar dataKey="income" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="expenseNegative" fill="#ef4444" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {!dailyMovementData.some((row) => row.income > 0 || row.expense > 0) && <p className="mt-2 text-center text-sm text-muted-foreground">Sem movimentações</p>}
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border bg-card">
          <CardHeader><div className="flex items-center justify-between"><CardTitle className="text-lg font-semibold">Compromissos Hoje</CardTitle><Link to="/schedule" className="text-sm font-medium text-primary hover:opacity-80">Ver Agenda →</Link></div></CardHeader>
          <CardContent className="space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Total de Compromissos</p><p className="text-3xl font-bold tabular-nums">{scheduledToday.length}</p>{scheduledToday.length === 0 && <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-success" />Nenhum compromisso hoje</div>}</CardContent>
        </Card>

        <Card className="rounded-xl border-border bg-card">
          <CardHeader><div className="flex items-center justify-between"><CardTitle className="text-lg font-semibold">Compromissos da Semana</CardTitle><Link to="/schedule" className="text-sm font-medium text-primary hover:opacity-80">Ver Agenda →</Link></div></CardHeader>
          <CardContent className="space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Dia mais movimentado</p>{busiestDay ? <p className="text-2xl font-bold">{busiestDay}</p> : <div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarCheck2 className="h-4 w-4 text-muted-foreground" />Sem dados no período</div>}</CardContent>
        </Card>

        <Card className="rounded-xl border-border bg-card md:col-span-2 lg:col-span-3">
          <CardHeader><CardTitle className="text-lg font-semibold">Despesas por Usuário</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {expensesByUser.every((entry) => entry.total === 0) ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><UserCircle2 className="h-4 w-4 text-muted-foreground" />Sem dados no período</div>
            ) : (
              expensesByUser.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-bold">{entry.initials}</span>{entry.name}</p><p className="text-sm font-semibold tabular-nums">{ptCurrency.format(entry.total)}</p></div>
                  <div className="h-2 w-full rounded-full bg-secondary"><div className={cn("h-2 rounded-full", entry.id === user?.id ? "bg-primary" : "bg-muted-foreground")} style={{ width: `${entry.progress}%` }} /></div>
                </div>
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
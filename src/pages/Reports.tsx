import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { isInvoicePayment } from "@/lib/invoicePayment";

type PeriodOption = "month" | "3months" | "6months" | "year" | "custom";
type TxRow = {
  id: string;
  family_id: string;
  user_id: string | null;
  amount: number;
  type: string;
  date: string;
  status: string | null;
  card_id: string | null;
  description: string | null;
  category_id: string | null;
  categories?: { id?: string; name?: string; color?: string | null } | { id?: string; name?: string; color?: string | null }[] | null;
};

type MonthSummary = { key: string; label: string; income: number; expense: number; balance: number };

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const toIso = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
};
const asSingle = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const getRangeFromPeriod = (period: PeriodOption, customFrom: string, customTo: string) => {
  const today = new Date();
  if (period === "custom") {
    const f = customFrom || toIso(startOfMonth(today));
    const t = customTo || toIso(today);
    // Se o usuário inverter as datas, troca em vez de retornar intervalo vazio.
    return f <= t ? { from: f, to: t } : { from: t, to: f };
  }

  if (period === "month") return { from: toIso(startOfMonth(today)), to: toIso(endOfMonth(today)) };
  if (period === "3months") return { from: toIso(startOfMonth(new Date(today.getFullYear(), today.getMonth() - 2, 1))), to: toIso(today) };
  if (period === "6months") return { from: toIso(startOfMonth(new Date(today.getFullYear(), today.getMonth() - 5, 1))), to: toIso(today) };
  return { from: toIso(new Date(today.getFullYear(), 0, 1)), to: toIso(today) };
};

const ReportsPage = () => {
  const { family } = useFamily();

  const [period, setPeriod] = useState<PeriodOption>("6months");
  const [customFrom, setCustomFrom] = useState<string>(toIso(startOfMonth(new Date())));
  const [customTo, setCustomTo] = useState<string>(toIso(new Date()));
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TxRow[]>([]);
  const [hiddenTrendKeys, setHiddenTrendKeys] = useState<string[]>([]);

  const { from, to } = useMemo(() => getRangeFromPeriod(period, customFrom, customTo), [period, customFrom, customTo]);

  // "Realizado" = pago OU despesa de cartão (que conta pela data da compra mesmo
  // antes da fatura ser paga). Exclui pendentes NÃO-cartão (agendados/recorrências
  // futuras), que não devem inflar receitas/despesas de um relatório do efetivado.
  const realizedRows = useMemo(
    () => rows.filter((tx) => tx.status === "paid" || Boolean(tx.card_id)),
    [rows],
  );

  useEffect(() => {
    if (!family?.id) {
      setRows([]);
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      // Sem filtro de family_id: a RLS (user_id = auth.uid()) já isola por
      // usuário. card_id/description são necessários pro guard de pagamento de
      // fatura; status pra distinguir realizado de pendente.
      const { data } = await supabase
        .from("transactions")
        .select("id, family_id, user_id, amount, type, date, status, card_id, description, category_id, categories(id, name, color)")
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true });

      setRows((data as TxRow[] | null) ?? []);
      setLoading(false);
    };

    void load();
  }, [family?.id, from, to]);

  const monthly = useMemo<MonthSummary[]>(() => {
    const grouped = new Map<string, MonthSummary>();
    // Semeia TODOS os meses do intervalo [from, to] com zero, pra a série não ter
    // buracos — assim o comparativo mês-a-mês sempre compara meses consecutivos,
    // não pula um mês vazio (F63).
    const end = new Date(`${to}T00:00:00`);
    const cursor = new Date(`${from}T00:00:00`);
    cursor.setDate(1);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      grouped.set(key, { key, label: monthLabel(key), income: 0, expense: 0, balance: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    realizedRows.forEach((tx) => {
      const key = monthKey(tx.date);
      const row = grouped.get(key) ?? { key, label: monthLabel(key), income: 0, expense: 0, balance: 0 };
      if (tx.type === "income") row.income += Number(tx.amount || 0);
      if (tx.type === "expense" && !isInvoicePayment(tx)) row.expense += Number(tx.amount || 0);
      row.balance = row.income - row.expense;
      grouped.set(key, row);
    });
    return [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [realizedRows, from, to]);

  const balanceEvolution = useMemo(() => {
    const dayDiff = Math.max(1, Math.floor((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000));
    if (dayDiff <= 95) {
      const byDay = new Map<string, number>();
      realizedRows.forEach((tx) => {
        const delta = tx.type === "income" ? Number(tx.amount || 0) : tx.type === "expense" && !isInvoicePayment(tx) ? Number(tx.amount || 0) * -1 : 0;
        byDay.set(tx.date, (byDay.get(tx.date) ?? 0) + delta);
      });
      let running = 0;
      return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, delta]) => {
        running += delta;
        return { label: new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), saldo: running, rawDate: date };
      });
    }

    let running = 0;
    return monthly.map((item) => {
      running += item.balance;
      return { label: item.label, saldo: running, rawDate: item.key };
    });
  }, [realizedRows, monthly, from, to]);

  const categoryExpenses = useMemo(() => {
    const grouped = new Map<string, { id: string; category: string; color: string; value: number }>();
    realizedRows.filter((tx) => tx.type === "expense" && !isInvoicePayment(tx)).forEach((tx) => {
      const cat = asSingle(tx.categories);
      const id = tx.category_id || cat?.id || "none";
      const entry = grouped.get(id) ?? {
        id,
        category: cat?.name || "Sem categoria",
        color: cat?.color || "hsl(var(--muted-foreground))",
        value: 0,
      };
      entry.value += Number(tx.amount || 0);
      grouped.set(id, entry);
    });

    const total = [...grouped.values()].reduce((s, i) => s + i.value, 0);
    const items = [...grouped.values()].sort((a, b) => b.value - a.value).map((item, index) => ({ ...item, rank: index + 1, percent: total > 0 ? (item.value / total) * 100 : 0 }));
    return { total, items };
  }, [realizedRows]);

  const trendByCategory = useMemo(() => {
    const top5 = categoryExpenses.items.slice(0, 5);
    const topIds = new Set(top5.map((c) => c.id));
    // "Outros" agrega as categorias fora do top-5, pra o gráfico não esconder
    // gasto nem divergir do total das outras seções.
    const hasOthers = categoryExpenses.items.length > 5;
    const keys = hasOthers
      ? [...top5, { id: "__others__", category: "Outros", color: "hsl(var(--muted-foreground))", value: 0, rank: 6, percent: 0 }]
      : top5;
    const monthList = monthly.map((m) => m.key);
    const catIdOf = (tx: TxRow) => tx.category_id || asSingle(tx.categories)?.id || "none";

    return {
      keys,
      data: monthList.map((month) => {
        const base: Record<string, string | number> = { label: monthLabel(month), month };
        const monthExp = realizedRows.filter((tx) => tx.type === "expense" && !isInvoicePayment(tx) && monthKey(tx.date) === month);
        top5.forEach((cat) => {
          base[cat.id] = monthExp.filter((tx) => catIdOf(tx) === cat.id).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        });
        if (hasOthers) {
          base["__others__"] = monthExp.filter((tx) => !topIds.has(catIdOf(tx))).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        }
        return base;
      }),
    };
  }, [categoryExpenses.items, monthly, realizedRows]);

  const monthlyComparison = useMemo(() => {
    // O mês corrente está incompleto — comparar seu gasto parcial com o mês
    // anterior (completo) engana. Anulamos a variação e marcamos "em andamento".
    const ongoingKey = toIso(new Date()).slice(0, 7);
    return monthly.map((item, index) => {
      const prev = monthly[index - 1];
      const isOngoing = item.key === ongoingKey;
      const variation = !prev || prev.expense === 0 || isOngoing ? null : ((item.expense - prev.expense) / prev.expense) * 100;
      return { ...item, variation, currentMonth: isOngoing };
    });
  }, [monthly]);

  const sectionHasData = {
    incomeExpense: monthly.length > 0,
    balanceEvolution: balanceEvolution.length > 0,
    categories: categoryExpenses.items.length > 0,
    trends: trendByCategory.data.length > 0 && trendByCategory.keys.length > 0,
    comparison: monthlyComparison.length > 0,
  };

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Relatórios</h1>
            <p className="text-sm text-muted-foreground">Visão analítica das suas finanças por período.</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Período</Label>
              <Select value={period} onValueChange={(v) => setPeriod(v as PeriodOption)}>
                <SelectTrigger className="w-full min-w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Este mês</SelectItem>
                  <SelectItem value="3months">Últimos 3 meses</SelectItem>
                  <SelectItem value="6months">Últimos 6 meses</SelectItem>
                  <SelectItem value="year">Este ano</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {period === "custom" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>De</Label>
                  <Input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Até</Label>
                  <Input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <Card className="rounded-xl border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg font-bold text-foreground">Receitas vs Despesas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!sectionHasData.incomeExpense ? (
            <EmptySection loading={loading} />
          ) : (
            <>
              <div className="h-[300px] w-full">
                <ResponsiveContainer>
                  <BarChart data={monthly}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" />
                    <YAxis stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => ptCurrency.format(v)} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.75rem",
                        color: "hsl(var(--foreground))",
                      }}
                      formatter={(value: number, key: string, item: { payload?: MonthSummary }) => {
                        if (key === "income") return [ptCurrency.format(value), "Receitas"];
                        if (key === "expense") return [ptCurrency.format(value), "Despesas"];
                        return [ptCurrency.format(value), "Saldo"];
                      }}
                      labelFormatter={(_, data) => {
                        const p = data?.[0]?.payload as MonthSummary | undefined;
                        return p ? `${p.label} • Saldo: ${ptCurrency.format(p.balance)}` : "";
                      }}
                    />
                    <Bar dataKey="income" fill="hsl(var(--success))" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="expense" fill="hsl(var(--destructive))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="overflow-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="p-3 text-left">Mês</th>
                      <th className="p-3 text-right">Receitas</th>
                      <th className="p-3 text-right">Despesas</th>
                      <th className="p-3 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map((item) => (
                      <tr key={item.key} className="border-t border-border">
                        <td className="p-3">{item.label}</td>
                        <td className="p-3 text-right text-success">{ptCurrency.format(item.income)}</td>
                        <td className="p-3 text-right text-destructive">{ptCurrency.format(item.expense)}</td>
                        <td className={cn("p-3 text-right font-medium", item.balance >= 0 ? "text-success" : "text-destructive")}>{ptCurrency.format(item.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg font-bold text-foreground">Fluxo acumulado no período</CardTitle>
        </CardHeader>
        <CardContent>
          {!sectionHasData.balanceEvolution ? (
            <EmptySection loading={loading} />
          ) : (
            <div className="h-[300px] w-full">
              <ResponsiveContainer>
                <AreaChart data={balanceEvolution}>
                  <defs>
                    <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => ptCurrency.format(v)} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.75rem", color: "hsl(var(--foreground))" }}
                    formatter={(value: number) => [ptCurrency.format(value), "Saldo"]}
                    labelFormatter={(label) => `Data: ${label}`}
                  />
                  <Area type="monotone" dataKey="saldo" stroke="hsl(var(--accent))" fill="url(#balanceFill)" strokeWidth={2.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg font-bold text-foreground">Gastos por Categoria</CardTitle>
        </CardHeader>
        <CardContent>
          {!sectionHasData.categories ? (
            <EmptySection loading={loading} />
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr] lg:items-start">
              <div className="h-[250px] w-[250px] max-w-full justify-self-center">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={categoryExpenses.items} dataKey="value" nameKey="category" innerRadius={60} outerRadius={100} paddingAngle={2}>
                      {categoryExpenses.items.map((entry) => (
                        <Cell key={entry.id} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.75rem", color: "hsl(var(--foreground))" }}
                      formatter={(v: number) => [ptCurrency.format(v), "Valor"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-2">
                {categoryExpenses.items.map((item) => (
                  <div key={item.id} className={cn("rounded-lg border p-3", item.rank <= 3 ? "border-accent/60 bg-accent/5" : "border-border bg-card")}>
                    <div className="mb-2 grid grid-cols-[32px_1fr_auto_auto] items-center gap-3 text-sm">
                      <span className="text-muted-foreground">#{item.rank}</span>
                      <span className="font-medium text-foreground">{item.category}</span>
                      <span className="text-foreground">{ptCurrency.format(item.value)}</span>
                      <span className="text-muted-foreground">{item.percent.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full" style={{ width: `${Math.min(item.percent, 100)}%`, backgroundColor: item.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg font-bold text-foreground">Tendência por Categoria</CardTitle>
        </CardHeader>
        <CardContent>
          {!sectionHasData.trends ? (
            <EmptySection loading={loading} />
          ) : (
            <div className="h-[320px] w-full">
              <ResponsiveContainer>
                <LineChart data={trendByCategory.data}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => ptCurrency.format(v)} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.75rem", color: "hsl(var(--foreground))" }}
                    formatter={(v: number) => [ptCurrency.format(v), "Valor"]}
                  />
                  <Legend
                    onClick={(data) => {
                      const rawKey = data?.dataKey;
                      const key = typeof rawKey === "string" ? rawKey : typeof rawKey === "number" ? String(rawKey) : null;
                      if (!key) return;
                      setHiddenTrendKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
                    }}
                  />
                  {trendByCategory.keys.map((cat) => (
                    <Line
                      key={cat.id}
                      type="monotone"
                      dataKey={cat.id}
                      name={cat.category}
                      stroke={cat.color}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      hide={hiddenTrendKeys.includes(cat.id)}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg font-bold text-foreground">Comparativo Mês a Mês</CardTitle>
        </CardHeader>
        <CardContent>
          {!sectionHasData.comparison ? (
            <EmptySection loading={loading} />
          ) : (
            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">Mês</th>
                    <th className="p-3 text-right">Receitas</th>
                    <th className="p-3 text-right">Despesas</th>
                    <th className="p-3 text-right">Saldo</th>
                    <th className="p-3 text-right">Variação</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyComparison.map((item) => (
                    <tr key={item.key} className={cn("border-t border-border", item.currentMonth && "border-l-2 border-l-accent bg-accent/5")}>
                      <td className="p-3">{item.label}</td>
                      <td className="p-3 text-right text-success">{ptCurrency.format(item.income)}</td>
                      <td className="p-3 text-right text-destructive">{ptCurrency.format(item.expense)}</td>
                      <td className={cn("p-3 text-right font-medium", item.balance >= 0 ? "text-success" : "text-destructive")}>{ptCurrency.format(item.balance)}</td>
                      <td className="p-3 text-right">
                        {item.variation === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={cn("font-medium", item.variation <= 0 ? "text-success" : "text-destructive")}>{item.variation <= 0 ? "↓" : "↑"} {Math.abs(item.variation).toFixed(1)}%</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Período ativo: {dateFmt.format(new Date(`${from}T00:00:00`))} até {dateFmt.format(new Date(`${to}T00:00:00`))}
      </p>
    </div>
  );
};

const EmptySection = ({ loading }: { loading?: boolean }) => (
  <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/15 p-6 text-center">
    <BarChart3 className="h-10 w-10 text-muted-foreground" />
    <p className="text-sm text-muted-foreground">{loading ? "Carregando dados..." : "Sem dados no período selecionado"}</p>
  </div>
);

export default ReportsPage;

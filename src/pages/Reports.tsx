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

type PeriodOption = "month" | "3months" | "6months" | "year" | "custom";
type TxRow = {
  id: string;
  family_id: string;
  user_id: string | null;
  amount: number;
  type: string;
  date: string;
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
    return { from: customFrom || toIso(startOfMonth(today)), to: customTo || toIso(today) };
  }

  if (period === "month") return { from: toIso(startOfMonth(today)), to: toIso(endOfMonth(today)) };
  if (period === "3months") return { from: toIso(startOfMonth(new Date(today.getFullYear(), today.getMonth() - 2, 1))), to: toIso(today) };
  if (period === "6months") return { from: toIso(startOfMonth(new Date(today.getFullYear(), today.getMonth() - 5, 1))), to: toIso(today) };
  return { from: toIso(new Date(today.getFullYear(), 0, 1)), to: toIso(today) };
};

const ReportsPage = () => {
  const { family, members } = useFamily();

  const [period, setPeriod] = useState<PeriodOption>("6months");
  const [customFrom, setCustomFrom] = useState<string>(toIso(startOfMonth(new Date())));
  const [customTo, setCustomTo] = useState<string>(toIso(new Date()));
  const [memberFilter, setMemberFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TxRow[]>([]);
  const [hiddenTrendKeys, setHiddenTrendKeys] = useState<string[]>([]);

  const { from, to } = useMemo(() => getRangeFromPeriod(period, customFrom, customTo), [period, customFrom, customTo]);

  useEffect(() => {
    if (!family?.id) {
      setRows([]);
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      let query = supabase
        .from("transactions")
        .select("id, family_id, user_id, amount, type, date, category_id, categories(id, name, color)")
        .eq("family_id", family.id)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true });

      if (memberFilter !== "all") query = query.eq("user_id", memberFilter);

      const { data } = await query;
      setRows((data as TxRow[] | null) ?? []);
      setLoading(false);
    };

    void load();
  }, [family?.id, from, to, memberFilter]);

  const monthly = useMemo<MonthSummary[]>(() => {
    const grouped = new Map<string, MonthSummary>();
    rows.forEach((tx) => {
      const key = monthKey(tx.date);
      const row = grouped.get(key) ?? { key, label: monthLabel(key), income: 0, expense: 0, balance: 0 };
      if (tx.type === "income") row.income += Number(tx.amount || 0);
      if (tx.type === "expense") row.expense += Number(tx.amount || 0);
      row.balance = row.income - row.expense;
      grouped.set(key, row);
    });
    return [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [rows]);

  const balanceEvolution = useMemo(() => {
    const dayDiff = Math.max(1, Math.floor((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000));
    if (dayDiff <= 95) {
      const byDay = new Map<string, number>();
      rows.forEach((tx) => {
        const delta = tx.type === "income" ? Number(tx.amount || 0) : tx.type === "expense" ? Number(tx.amount || 0) * -1 : 0;
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
  }, [rows, monthly, from, to]);

  const categoryExpenses = useMemo(() => {
    const grouped = new Map<string, { id: string; category: string; color: string; value: number }>();
    rows.filter((tx) => tx.type === "expense").forEach((tx) => {
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
  }, [rows]);

  const memberExpenses = useMemo(() => {
    const grouped = new Map<string, number>();
    rows.filter((tx) => tx.type === "expense" && tx.user_id).forEach((tx) => {
      if (!tx.user_id) return;
      grouped.set(tx.user_id, (grouped.get(tx.user_id) ?? 0) + Number(tx.amount || 0));
    });

    return members
      .map((m) => ({
        id: m.user_id,
        name: m.profiles?.full_name?.trim() || m.profiles?.email || "Usuário",
        value: grouped.get(m.user_id) ?? 0,
      }))
      .filter((m) => m.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [rows, members]);

  const trendByCategory = useMemo(() => {
    const top5 = categoryExpenses.items.slice(0, 5);
    const monthList = monthly.map((m) => m.key);

    return {
      keys: top5,
      data: monthList.map((month) => {
        const base: Record<string, string | number> = { label: monthLabel(month), month };
        top5.forEach((cat) => {
          const total = rows
            .filter((tx) => tx.type === "expense" && monthKey(tx.date) === month)
            .filter((tx) => {
              const c = asSingle(tx.categories);
              const id = tx.category_id || c?.id || "none";
              return id === cat.id;
            })
            .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
          base[cat.id] = total;
        });
        return base;
      }),
    };
  }, [categoryExpenses.items, monthly, rows]);

  const monthlyComparison = useMemo(() => {
    return monthly.map((item, index) => {
      const prev = monthly[index - 1];
      const variation = !prev || prev.expense === 0 ? null : ((item.expense - prev.expense) / prev.expense) * 100;
      const currentMonth = monthKey(to) === item.key;
      return { ...item, variation, currentMonth };
    });
  }, [monthly, to]);

  const sectionHasData = {
    incomeExpense: monthly.length > 0,
    balanceEvolution: balanceEvolution.length > 0,
    categories: categoryExpenses.items.length > 0,
    memberExpenses: memberExpenses.length > 0,
    trends: trendByCategory.data.length > 0 && trendByCategory.keys.length > 0,
    comparison: monthlyComparison.length > 0,
  };

  const memberName = (userId: string) => {
    const member = members.find((m) => m.user_id === userId);
    return member?.profiles?.full_name?.trim() || member?.profiles?.email || "Membro";
  };

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Relatórios</h1>
            <p className="text-sm text-muted-foreground">Visão analítica das finanças por período e membro.</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

            <div className="space-y-1">
              <Label>Membro</Label>
              <Select value={memberFilter} onValueChange={setMemberFilter}>
                <SelectTrigger className="w-full min-w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.profiles?.full_name?.trim() || member.profiles?.email || "Membro"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {period === "custom" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>De</Label>
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Até</Label>
                  <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
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
          <CardTitle className="text-lg font-bold text-foreground">Evolução do Saldo</CardTitle>
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
          <CardTitle className="text-lg font-bold text-foreground">Gastos por Membro da Família</CardTitle>
        </CardHeader>
        <CardContent>
          {!sectionHasData.memberExpenses ? (
            <EmptySection loading={loading} />
          ) : (
            <div className="h-[300px] w-full">
              <ResponsiveContainer>
                <BarChart data={memberExpenses} layout="vertical" margin={{ left: 16, right: 24 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => ptCurrency.format(v)} />
                  <YAxis type="category" dataKey="name" width={120} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.75rem", color: "hsl(var(--foreground))" }}
                    formatter={(v: number) => [ptCurrency.format(v), "Despesas"]}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {memberExpenses.map((m) => (
                      <Cell key={m.id} fill={m.id === memberFilter ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
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
        {memberFilter !== "all" ? ` • ${memberName(memberFilter)}` : ""}
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

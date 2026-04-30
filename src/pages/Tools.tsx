import { useMemo, useState } from "react";
import { Calculator, Coins, Percent, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ptCurrency } from "@/lib/formatting";

const ToolsPage = () => {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ferramentas</h1>
        <p className="text-sm text-muted-foreground">Calculadoras financeiras pra simular cenários antes de decidir.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CompoundInterest />
        <LoanSimulator />
      </div>
    </div>
  );
};

// Juros compostos: aporte inicial + aporte mensal + taxa + período
const CompoundInterest = () => {
  const [initial, setInitial] = useState("1000");
  const [monthly, setMonthly] = useState("500");
  const [rate, setRate] = useState("1");
  const [months, setMonths] = useState("12");

  const result = useMemo(() => {
    const P = Number(initial.replace(",", ".")) || 0;
    const PMT = Number(monthly.replace(",", ".")) || 0;
    const i = (Number(rate.replace(",", ".")) || 0) / 100;
    const n = Number(months) || 0;

    let total = P;
    let invested = P;
    for (let m = 0; m < n; m++) {
      total = total * (1 + i) + PMT;
      invested += PMT;
    }
    const earnings = total - invested;
    return { total, invested, earnings };
  }, [initial, monthly, rate, months]);

  return (
    <Card className="rounded-xl border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-primary" />
          Juros Compostos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Quanto rende um aporte mensal por X meses a Y% ao mês.</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Aporte inicial (R$)</Label>
            <Input value={initial} onChange={(e) => setInitial(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Aporte mensal (R$)</Label>
            <Input value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Taxa (% ao mês)</Label>
            <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Período (meses)</Label>
            <Input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-2">
          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Investido</p>
            <p className="text-sm font-bold tabular-nums">{ptCurrency.format(result.invested)}</p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Juros</p>
            <p className="text-sm font-bold tabular-nums text-success">{ptCurrency.format(result.earnings)}</p>
          </div>
          <div className="rounded-lg border border-border bg-primary/10 p-3">
            <p className="text-[10px] uppercase tracking-wide text-primary">Total</p>
            <p className="text-sm font-bold tabular-nums text-primary">{ptCurrency.format(result.total)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Simulador de empréstimo (Tabela Price simplificada)
const LoanSimulator = () => {
  const [principal, setPrincipal] = useState("10000");
  const [rate, setRate] = useState("2");
  const [months, setMonths] = useState("12");

  const result = useMemo(() => {
    const P = Number(principal.replace(",", ".")) || 0;
    const i = (Number(rate.replace(",", ".")) || 0) / 100;
    const n = Number(months) || 1;
    if (P <= 0 || n <= 0) return { installment: 0, total: 0, interest: 0 };
    if (i === 0) return { installment: P / n, total: P, interest: 0 };
    const installment = (P * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
    const total = installment * n;
    return { installment, total, interest: total - P };
  }, [principal, rate, months]);

  return (
    <Card className="rounded-xl border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4 text-warning" />
          Simulador de Empréstimo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Tabela Price: parcela fixa por N meses a taxa Y% a.m.</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Valor (R$)</Label>
            <Input value={principal} onChange={(e) => setPrincipal(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Taxa (% a.m.)</Label>
            <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Parcelas</Label>
            <Input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-2">
          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Parcela</p>
            <p className="text-sm font-bold tabular-nums">{ptCurrency.format(result.installment)}</p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Juros total</p>
            <p className="text-sm font-bold tabular-nums text-destructive">{ptCurrency.format(result.interest)}</p>
          </div>
          <div className="rounded-lg border border-border bg-primary/10 p-3">
            <p className="text-[10px] uppercase tracking-wide text-primary">Total</p>
            <p className="text-sm font-bold tabular-nums text-primary">{ptCurrency.format(result.total)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ToolsPage;

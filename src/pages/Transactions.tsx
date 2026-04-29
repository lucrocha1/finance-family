import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronLeft, ChevronRight, CreditCard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  categories?: { id?: string; name?: string; color?: string | null } | { id?: string; name?: string; color?: string | null }[] | null;
  accounts?: { id?: string; name?: string } | { id?: string; name?: string }[] | null;
  cards?: { id?: string; name?: string } | { id?: string; name?: string }[] | null;
  profiles?: { full_name?: string | null; email?: string | null } | { full_name?: string | null; email?: string | null }[] | null;
};

type CategoryRow = { id: string; name: string; color: string | null };
type AccountRow = { id: string; name: string };
type CardRow = { id: string; name: string };

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

const getInstallmentLabel = (tx: TransactionRow) => {
  const current = tx.installment_number ?? tx.installment_current ?? tx.current_installment ?? null;
  const total = tx.installments ?? tx.installment_total ?? tx.total_installments ?? null;
  if (current && total) return ` (${current}/${total})`;
  return "";
};

const formatDateDDMM = (iso: string) => {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "--/--";
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

const PAGE_SIZE = 20;

const TransactionsPage = () => {
  const { family, members } = useFamily();

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

  const monthStart = useMemo(() => startOfMonth(selectedMonth), [selectedMonth]);
  const monthEnd = useMemo(() => endOfMonth(selectedMonth), [selectedMonth]);

  useEffect(() => {
    setPage(1);
  }, [typeFilter, categoryFilter, accountFilter, cardFilter, memberFilter, selectedMonth]);

  useEffect(() => {
    if (!family?.id) {
      setTransactions([]);
      setCategories([]);
      setAccounts([]);
      setCards([]);
      setLoading(false);
      return;
    }

    const loadData = async () => {
      setLoading(true);

      const [txRes, categoriesRes, accountsRes, cardsRes] = await Promise.all([
        supabase
          .from("transactions")
          .select("*, categories(*), accounts(*), cards(*), profiles:user_id(full_name, email)")
          .eq("family_id", family.id)
          .gte("date", toISODate(monthStart))
          .lte("date", toISODate(monthEnd))
          .order("date", { ascending: false }),
        supabase.from("categories").select("id, name, color").eq("family_id", family.id).order("name", { ascending: true }),
        supabase.from("accounts").select("id, name").eq("family_id", family.id).order("name", { ascending: true }),
        supabase.from("cards").select("id, name").eq("family_id", family.id).order("name", { ascending: true }),
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
    };

    void loadData();
  }, [family?.id, monthEnd, monthStart]);

  const memberMap = useMemo(() => {
    const map = new Map<string, { name: string; email: string | null; initials: string }>();
    members.forEach((member) => {
      const fullName = member.profiles?.full_name?.trim() || member.profiles?.email || "Usuário";
      const firstName = fullName.split(" ")[0] || "Usuário";
      const initials = fullName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("") || "U";
      map.set(member.user_id, { name: firstName, email: member.profiles?.email ?? null, initials });
    });
    return map;
  }, [members]);

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;
      if (categoryFilter !== "all" && tx.category_id !== categoryFilter) return false;

      const txAccount = asSingle(tx.accounts);
      const accountId = tx.account_id ?? txAccount?.id ?? null;
      if (accountFilter !== "all" && accountId !== accountFilter) return false;

      if (cardFilter === "none" && tx.card_id) return false;
      if (cardFilter !== "all" && cardFilter !== "none" && tx.card_id !== cardFilter) return false;
      if (memberFilter !== "all" && tx.user_id !== memberFilter) return false;

      return true;
    });
  }, [accountFilter, cardFilter, categoryFilter, memberFilter, transactions, typeFilter]);

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

  return (
    <div className="space-y-6">
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
              className={cn(
                "h-[38px] rounded-lg border border-border bg-secondary px-3 text-sm font-semibold",
                typeFilter === option.value ? option.activeClass : "text-muted-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent className="border-border bg-card text-card-foreground">
            <SelectItem value="all">Todas</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground">
            <SelectValue placeholder="Conta" />
          </SelectTrigger>
          <SelectContent className="border-border bg-card text-card-foreground">
            <SelectItem value="all">Todas</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={cardFilter} onValueChange={setCardFilter}>
          <SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground">
            <SelectValue placeholder="Cartão" />
          </SelectTrigger>
          <SelectContent className="border-border bg-card text-card-foreground">
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="none">Sem cartão</SelectItem>
            {cards.map((card) => (
              <SelectItem key={card.id} value={card.id}>
                {card.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={memberFilter} onValueChange={setMemberFilter}>
          <SelectTrigger className="h-[38px] w-[170px] rounded-lg border-border bg-secondary text-foreground">
            <SelectValue placeholder="Membro" />
          </SelectTrigger>
          <SelectContent className="border-border bg-card text-card-foreground">
            <SelectItem value="all">Todos</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.user_id} value={member.user_id}>
                {member.profiles?.full_name || member.profiles?.email || "Usuário"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        <Card className="flex-1 rounded-lg border-border bg-card">
          <CardContent className="flex items-center gap-3 p-4">
            <span className="rounded-full bg-success/20 p-2 text-success">
              <ArrowUp className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">Receitas</p>
              <p className="text-lg font-semibold tabular-nums text-success">{ptCurrency.format(totals.income)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="flex-1 rounded-lg border-border bg-card">
          <CardContent className="flex items-center gap-3 p-4">
            <span className="rounded-full bg-destructive/20 p-2 text-destructive">
              <ArrowDown className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">Despesas</p>
              <p className="text-lg font-semibold tabular-nums text-destructive">{ptCurrency.format(totals.expense)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="flex-1 rounded-lg border-border bg-card">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-[0.5px] text-muted-foreground">Saldo</p>
            <p className={cn("text-lg font-semibold tabular-nums", totals.balance >= 0 ? "text-success" : "text-destructive")}>{ptCurrency.format(totals.balance)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl border-border bg-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-[300px] items-center justify-center text-sm text-muted-foreground">Carregando transações...</div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 text-center">
              <ArrowLeftRight className="h-10 w-10 text-[hsl(var(--placeholder-icon))]" />
              <p className="text-base font-semibold text-foreground">Nenhuma transação encontrada</p>
              <p className="text-sm text-muted-foreground">Adicione sua primeira transação</p>
              <Button className="mt-2">+ Nova Transação</Button>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border bg-background hover:bg-background">
                    <TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Data</TableHead>
                    <TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Descrição</TableHead>
                    <TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Categoria</TableHead>
                    <TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Valor</TableHead>
                    <TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Conta</TableHead>
                    <TableHead className="h-11 px-4 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">Membro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((tx) => {
                    const category = asSingle(tx.categories);
                    const account = asSingle(tx.accounts);
                    const card = asSingle(tx.cards);
                    const profileJoined = asSingle(tx.profiles);
                    const member = tx.user_id ? memberMap.get(tx.user_id) : null;
                    const memberName = member?.name || profileJoined?.full_name?.split(" ")[0] || "Usuário";
                    const memberInitials = member?.initials || memberName.slice(0, 1).toUpperCase();
                    const valuePrefix = tx.type === "income" ? "+" : tx.type === "expense" ? "-" : "";
                    const valueColor = tx.type === "income" ? "text-success" : tx.type === "expense" ? "text-destructive" : "text-info";

                    return (
                      <TableRow key={tx.id} className="cursor-pointer border-b border-border bg-transparent hover:bg-secondary">
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground">{formatDateDDMM(tx.date)}</TableCell>
                        <TableCell className="px-4 py-3 text-sm font-medium text-foreground">
                          <span>{tx.description || "Sem descrição"}</span>
                          {getInstallmentLabel(tx) && <span className="text-muted-foreground">{getInstallmentLabel(tx)}</span>}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: category?.color || "hsl(var(--muted-foreground))" }} />
                            {category?.name || "Sem categoria"}
                          </div>
                        </TableCell>
                        <TableCell className={cn("px-4 py-3 text-sm font-semibold tabular-nums", valueColor)}>
                          {valuePrefix}
                          {ptCurrency.format(Number(tx.amount || 0))}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                          {tx.card_id ? (
                            <span className="inline-flex items-center gap-1">
                              <CreditCard className="h-3.5 w-3.5" />
                              {card?.name || "Cartão"}
                            </span>
                          ) : (
                            account?.name || "Sem conta"
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                          <span className="inline-flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-foreground">{memberInitials}</span>
                            <span className="text-foreground">{memberName}</span>
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
                <p>
                  Mostrando {filtered.length === 0 ? 0 : startIndex + 1}-{endIndex} de {filtered.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" className="h-8 rounded-lg border-border bg-secondary" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={currentPage <= 1}>
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    className="h-8 rounded-lg border-border bg-secondary"
                    onClick={() => setPage((prev) => Math.min(prev + 1, pageCount))}
                    disabled={currentPage >= pageCount}
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TransactionsPage;

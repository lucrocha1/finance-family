import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, CreditCard, Handshake, Search, Target, TrendingUp, Wallet } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { ptCurrency } from "@/lib/formatting";
import { cn } from "@/lib/utils";

type Result = {
  id: string;
  kind: "transaction" | "card" | "debt" | "goal" | "account" | "category" | "investment";
  title: string;
  subtitle?: string;
  link: string;
};

const KIND_META: Record<Result["kind"], { label: string; icon: typeof Search }> = {
  transaction: { label: "Transação", icon: ArrowLeftRight },
  card: { label: "Cartão", icon: CreditCard },
  debt: { label: "Dívida", icon: Handshake },
  goal: { label: "Meta", icon: Target },
  account: { label: "Conta", icon: Wallet },
  category: { label: "Categoria", icon: Search },
  investment: { label: "Investimento", icon: TrendingUp },
};

export const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { family } = useFamily();

  // Cmd+K / Ctrl+K opens the overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const q = `%${query.trim()}%`;

    void Promise.all([
      supabase.from("transactions").select("id, description, amount, type, date").ilike("description", q).limit(8),
      supabase.from("cards").select("id, name, brand").ilike("name", q).limit(5),
      supabase.from("debts").select("id, name, total_with_interest, original_amount").ilike("name", q).limit(5),
      supabase.from("goals").select("id, name, target_amount").ilike("name", q).limit(5),
      supabase.from("accounts").select("id, name, balance").ilike("name", q).limit(5),
      supabase.from("categories").select("id, name").ilike("name", q).limit(5),
      supabase.from("investments").select("id, name, current_value").ilike("name", q).limit(5),
    ]).then((responses) => {
      if (cancelled) return;
      const [txs, cards, debts, goals, accounts, categories, investments] = responses;
      const merged: Result[] = [
        ...((txs.data ?? []) as any[]).map((t) => ({
          id: `tx-${t.id}`,
          kind: "transaction" as const,
          title: t.description ?? "Sem descrição",
          subtitle: `${ptCurrency.format(Number(t.amount || 0))} · ${new Date(`${t.date}T00:00:00`).toLocaleDateString("pt-BR")}`,
          link: "/transactions",
        })),
        ...((cards.data ?? []) as any[]).map((c) => ({
          id: `card-${c.id}`,
          kind: "card" as const,
          title: c.name,
          subtitle: c.brand ?? undefined,
          link: `/cards/${c.id}`,
        })),
        ...((debts.data ?? []) as any[]).map((d) => ({
          id: `debt-${d.id}`,
          kind: "debt" as const,
          title: d.name,
          subtitle: ptCurrency.format(Number(d.total_with_interest ?? d.original_amount ?? 0)),
          link: `/debts/${d.id}`,
        })),
        ...((goals.data ?? []) as any[]).map((g) => ({
          id: `goal-${g.id}`,
          kind: "goal" as const,
          title: g.name,
          subtitle: ptCurrency.format(Number(g.target_amount || 0)),
          link: "/goals",
        })),
        ...((accounts.data ?? []) as any[]).map((a) => ({
          id: `acc-${a.id}`,
          kind: "account" as const,
          title: a.name,
          subtitle: ptCurrency.format(Number(a.balance || 0)),
          link: "/settings",
        })),
        ...((categories.data ?? []) as any[]).map((c) => ({
          id: `cat-${c.id}`,
          kind: "category" as const,
          title: c.name,
          link: "/settings",
        })),
        ...((investments.data ?? []) as any[]).map((i) => ({
          id: `inv-${i.id}`,
          kind: "investment" as const,
          title: i.name,
          subtitle: ptCurrency.format(Number(i.current_value || 0)),
          link: "/investments",
        })),
      ];
      setResults(merged);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, query, family?.id]);

  const grouped = useMemo(() => {
    const map = new Map<Result["kind"], Result[]>();
    for (const r of results) {
      const list = map.get(r.kind) ?? [];
      list.push(r);
      map.set(r.kind, list);
    }
    return [...map.entries()];
  }, [results]);

  const open_ = open;

  return (
    <Dialog open={open_} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl p-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar transações, cartões, dívidas, metas..."
            className="h-9 border-none bg-transparent focus-visible:ring-0"
          />
          <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Digite ao menos 2 caracteres</p>
          ) : loading ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Buscando...</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nada encontrado</p>
          ) : (
            grouped.map(([kind, list]) => {
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              return (
                <div key={kind} className="mb-2">
                  <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{meta.label}</p>
                  {list.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        navigate(r.link);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-secondary")}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
                        {r.subtitle && <p className="truncate text-xs text-muted-foreground">{r.subtitle}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

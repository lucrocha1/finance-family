import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { ensureFamily } from "@/lib/familyGuard";

type CardBrand = "visa" | "mastercard" | "elo" | "amex" | "hipercard" | "outro";

type CardRow = {
  id: string;
  name: string;
  brand: CardBrand | null;
  credit_limit: number | null;
  closing_day: number | null;
  due_day: number | null;
  color: string | null;
  last4: string | null;
};

type TxExpenseRow = {
  card_id: string | null;
  amount: number;
  date: string;
};

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const BRAND_OPTIONS: { value: CardBrand; label: string; icon: string }[] = [
  { value: "visa", label: "Visa", icon: "V" },
  { value: "mastercard", label: "Mastercard", icon: "MC" },
  { value: "elo", label: "Elo", icon: "E" },
  { value: "amex", label: "Amex", icon: "AX" },
  { value: "hipercard", label: "Hipercard", icon: "H" },
  { value: "outro", label: "Outro", icon: "•" },
];

const COLOR_OPTIONS = ["#7c3aed", "#1e40af", "#dc2626", "#ca8a04", "#059669", "#0891b2", "#374151", "#000000"];

const formSchema = z.object({
  name: z.string().trim().min(2, "Nome obrigatório").max(80, "Máximo de 80 caracteres"),
  last4: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d{4}$/.test(value), "Últimos 4 dígitos devem ter 4 números"),
  brand: z.enum(["visa", "mastercard", "elo", "amex", "hipercard", "outro"]),
  creditLimitCents: z.number().int().min(1, "Limite obrigatório"),
  closingDay: z.number().int().min(1, "Dia inválido").max(31, "Dia inválido"),
  dueDay: z.number().int().min(1, "Dia inválido").max(31, "Dia inválido"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const toISODate = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const getBrandDefaultColor = (brand: CardBrand) => {
  if (brand === "visa") return "#1e40af";
  if (brand === "mastercard") return "#dc2626";
  if (brand === "elo") return "#ca8a04";
  if (brand === "amex") return "#0891b2";
  if (brand === "hipercard") return "#7c3aed";
  return "#374151";
};

const getBrandGradientEnd = (brand: CardBrand) => {
  if (brand === "visa") return "#1e3a5f";
  if (brand === "mastercard") return "#991b1b";
  if (brand === "elo") return "#854d0e";
  if (brand === "amex") return "#155e75";
  if (brand === "hipercard") return "#4c1d95";
  return "#1f2937";
};

const darkenHex = (hex: string, factor = 0.64) => {
  const safe = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(safe.slice(0, 2), 16) * factor));
  const g = Math.max(0, Math.round(parseInt(safe.slice(2, 4), 16) * factor));
  const b = Math.max(0, Math.round(parseInt(safe.slice(4, 6), 16) * factor));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

const getCycleWindow = (closingDay: number, baseDate = new Date()) => {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const prevMonthDate = new Date(year, month - 1, 1);
  const prevMonthLastDay = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0).getDate();
  const currentMonthLastDay = new Date(year, month + 1, 0).getDate();
  const prevClosing = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), Math.min(closingDay, prevMonthLastDay));
  const cycleStart = new Date(prevClosing);
  cycleStart.setDate(cycleStart.getDate() + 1);
  const cycleEnd = new Date(year, month, Math.min(closingDay, currentMonthLastDay));
  return { start: toISODate(cycleStart), end: toISODate(cycleEnd) };
};

const CardsPage = () => {
  const { family } = useFamily();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [monthlySpentByCard, setMonthlySpentByCard] = useState<Record<string, number>>({});

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CardRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [brand, setBrand] = useState<CardBrand>("visa");
  const [creditLimitDigits, setCreditLimitDigits] = useState("");
  const [closingDay, setClosingDay] = useState("15");
  const [dueDay, setDueDay] = useState("22");
  const [color, setColor] = useState(getBrandDefaultColor("visa"));
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!family?.id) {
      setCards([]);
      setMonthlySpentByCard({});
      setLoading(false);
      return;
    }

    setLoading(true);
    const cardsRes = await supabase.from("cards").select("*").eq("family_id", family.id).order("name", { ascending: true });
    if (cardsRes.error) {
      toast.error("Erro ao carregar cartões");
      setLoading(false);
      return;
    }

    const normalizedCards = ((cardsRes.data as Record<string, unknown>[] | null) ?? []).map<CardRow>((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? "Cartão"),
      brand: (String(row.brand ?? "outro") as CardBrand) ?? "outro",
      credit_limit: Number(row.credit_limit ?? 0),
      closing_day: Number(row.closing_day ?? 1),
      due_day: Number(row.due_day ?? 1),
      color: (row.color as string | null) ?? null,
      last4: (row.last4 as string | null) ?? (row.last_digits as string | null) ?? null,
    }));

    setCards(normalizedCards);

    if (!normalizedCards.length) {
      setMonthlySpentByCard({});
      setLoading(false);
      return;
    }

    const windows = normalizedCards
      .filter((card) => Number(card.closing_day) > 0)
      .map((card) => ({ id: card.id, ...getCycleWindow(Number(card.closing_day || 1)) }));

    const minStart = windows.map((w) => w.start).sort()[0];
    const maxEnd = windows.map((w) => w.end).sort().slice(-1)[0];

    const txRes = await supabase
      .from("transactions")
      .select("card_id, amount, date")
      .eq("family_id", family.id)
      .eq("type", "expense")
      .in(
        "card_id",
        normalizedCards.map((card) => card.id),
      )
      .gte("date", minStart)
      .lte("date", maxEnd);

    if (txRes.error) {
      toast.error("Erro ao calcular gastos dos cartões");
      setLoading(false);
      return;
    }

    const expenses = (txRes.data as TxExpenseRow[] | null) ?? [];
    const totals: Record<string, number> = {};

    normalizedCards.forEach((card) => {
      const cycle = getCycleWindow(Number(card.closing_day || 1));
      totals[card.id] = expenses
        .filter((tx) => tx.card_id === card.id && tx.date >= cycle.start && tx.date <= cycle.end)
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    });

    setMonthlySpentByCard(totals);
    setLoading(false);
  }, [family?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const resetForm = () => {
    setEditing(null);
    setName("");
    setLast4("");
    setBrand("visa");
    setCreditLimitDigits("");
    setClosingDay("15");
    setDueDay("22");
    setColor(getBrandDefaultColor("visa"));
    setFormError(null);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (card: CardRow) => {
    setEditing(card);
    setName(card.name ?? "");
    setLast4((card.last4 ?? "").replace(/\D/g, "").slice(0, 4));
    setBrand((card.brand ?? "outro") as CardBrand);
    setCreditLimitDigits(String(Math.round(Number(card.credit_limit || 0) * 100)));
    setClosingDay(String(card.closing_day ?? 1));
    setDueDay(String(card.due_day ?? 1));
    setColor(card.color ?? getBrandDefaultColor((card.brand ?? "outro") as CardBrand));
    setFormError(null);
    setOpen(true);
  };

  const creditLimitCents = Number(creditLimitDigits || "0");
  const creditLimitLabel = ptCurrency.format(creditLimitCents / 100);

  const canSave = name.trim().length >= 2 && creditLimitCents > 0 && Number(closingDay) >= 1 && Number(closingDay) <= 31 && Number(dueDay) >= 1 && Number(dueDay) <= 31;

  const saveCard = async () => {
    const ctx = ensureFamily(family?.id, user?.id);
    if (!ctx) return;

    const parsed = formSchema.safeParse({
      name,
      last4,
      brand,
      creditLimitCents,
      closingDay: Number(closingDay),
      dueDay: Number(dueDay),
      color,
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    setSaving(true);
    setFormError(null);

    const payloadBase = {
      name: parsed.data.name,
      brand: parsed.data.brand,
      credit_limit: parsed.data.creditLimitCents / 100,
      closing_day: parsed.data.closingDay,
      due_day: parsed.data.dueDay,
      color: parsed.data.color,
    };

    const payloadWithLast4 = { ...payloadBase, last4: parsed.data.last4 || null };
    const payloadWithLastDigits = { ...payloadBase, last_digits: parsed.data.last4 || null };

    let result;
    if (editing) {
      result = await supabase.from("cards").update(payloadWithLast4).eq("id", editing.id);
      if (result.error && result.error.message.toLowerCase().includes("last4")) {
        result = await supabase.from("cards").update(payloadWithLastDigits).eq("id", editing.id);
      }
    } else {
      result = await supabase.from("cards").insert({ ...payloadWithLast4, user_id: ctx.userId, family_id: ctx.familyId });
      if (result.error && result.error.message.toLowerCase().includes("last4")) {
        result = await supabase.from("cards").insert({ ...payloadWithLastDigits, user_id: ctx.userId, family_id: ctx.familyId });
      }
    }

    setSaving(false);

    if (result.error) {
      toast.error(result.error.message || "Não foi possível salvar o cartão");
      return;
    }

    setOpen(false);
    toast.success(editing ? "Cartão atualizado!" : "Cartão criado!");
    await loadData();
  };

  const deleteCard = async () => {
    if (!editing) return;
    setDeleting(true);
    const { error } = await supabase.from("cards").delete().eq("id", editing.id);
    setDeleting(false);
    if (error) {
      toast.error(error.message || "Não foi possível excluir");
      return;
    }
    setDeleteOpen(false);
    setOpen(false);
    toast.success("Cartão excluído!");
    await loadData();
  };

  const cardsWithUsage = useMemo(
    () =>
      cards.map((card) => {
        const spent = Number(monthlySpentByCard[card.id] ?? 0);
        const limit = Number(card.credit_limit ?? 0);
        const usedPct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
        const available = Math.max(limit - spent, 0);
        return { ...card, spent, limit, usedPct, available };
      }),
    [cards, monthlySpentByCard],
  );

  const summary = useMemo(() => {
    const totalLimit = cardsWithUsage.reduce((sum, card) => sum + card.limit, 0);
    const totalUsed = cardsWithUsage.reduce((sum, card) => sum + card.spent, 0);
    return { totalLimit, totalUsed, totalAvailable: Math.max(totalLimit - totalUsed, 0) };
  }, [cardsWithUsage]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <Button onClick={openCreate} className="h-10 rounded-lg font-semibold">
          <Plus className="mr-2 h-4 w-4" />
          + Novo Cartão
        </Button>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-[220px] flex-1 rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground">LIMITE TOTAL</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{ptCurrency.format(summary.totalLimit)}</p>
        </div>
        <div className="min-w-[220px] flex-1 rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground">UTILIZADO</p>
          <p className="mt-2 text-3xl font-bold text-destructive">{ptCurrency.format(summary.totalUsed)}</p>
        </div>
        <div className="min-w-[220px] flex-1 rounded-xl border p-5" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground">DISPONÍVEL</p>
          <p className="mt-2 text-3xl font-bold text-emerald-500">{ptCurrency.format(summary.totalAvailable)}</p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Carregando cartões...</div>
      ) : cardsWithUsage.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-8 text-sm text-muted-foreground">Nenhum cartão cadastrado ainda.</div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {cardsWithUsage.map((card) => {
            const base = card.color || getBrandDefaultColor((card.brand ?? "outro") as CardBrand);
            const end = card.color ? darkenHex(base) : getBrandGradientEnd((card.brand ?? "outro") as CardBrand);
            const brandMeta = BRAND_OPTIONS.find((option) => option.value === card.brand) ?? BRAND_OPTIONS[5];
            const progressClass = card.usedPct >= 80 ? "bg-red-400" : card.usedPct >= 50 ? "bg-yellow-300" : "bg-white/80";

            return (
              <div
                key={card.id}
                className="group relative min-h-[200px] overflow-hidden rounded-2xl p-6 text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-transform duration-200 hover:scale-[1.02]"
                style={{ backgroundImage: `linear-gradient(145deg, ${base}, ${end})`, aspectRatio: "1.6 / 1" }}
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-base font-semibold">{card.name}</h3>
                  <span className="rounded-md border border-white/30 px-2 py-1 text-xs font-semibold">{brandMeta.icon}</span>
                </div>

                <p className="mt-8 font-mono text-lg tracking-[2px]">•••• •••• •••• {card.last4 || "0000"}</p>

                <div className="mt-4 space-y-1 text-sm text-white/70">
                  <p>Fechamento: dia {card.closing_day || 1}</p>
                  <p>Vencimento: dia {card.due_day || 1}</p>
                </div>

                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-white/20">
                    <div className={`h-full rounded-full ${progressClass}`} style={{ width: `${card.usedPct}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-white/70">
                    <span>
                      {ptCurrency.format(card.spent)} / {ptCurrency.format(card.limit)}
                    </span>
                    <span>{Math.round(card.usedPct)}%</span>
                  </div>
                </div>

                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <div className="pointer-events-auto flex gap-2">
                    <Button size="sm" className="h-9 rounded-lg px-4 text-xs font-semibold" onClick={() => navigate(`/cards/${card.id}`)}>Ver fatura</Button>
                    <Button size="sm" variant="outline" className="h-9 rounded-lg border-white/50 bg-transparent px-4 text-xs font-semibold text-white hover:bg-white/10" onClick={() => openEdit(card)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Editar
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[480px] rounded-2xl border bg-card text-card-foreground" style={{ backgroundColor: "#12121a", borderColor: "#1e1e2e" }}>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Cartão" : "Novo Cartão"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do cartão</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Nubank Gold, Itaú Platinum..." className="h-10" />
            </div>

            <div className="space-y-2">
              <Label>Últimos 4 dígitos</Label>
              <Input
                value={last4}
                onChange={(event) => setLast4(event.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="0000"
                maxLength={4}
                inputMode="numeric"
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label>Bandeira</Label>
              <Select
                value={brand}
                onValueChange={(value) => {
                  const nextBrand = value as CardBrand;
                  setBrand(nextBrand);
                  if (!editing) setColor(getBrandDefaultColor(nextBrand));
                }}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BRAND_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex h-5 min-w-6 items-center justify-center rounded bg-secondary px-1 text-[10px] font-semibold">{option.icon}</span>
                        <span>{option.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Limite de crédito</Label>
              <Input
                value={creditLimitLabel}
                onChange={(event) => setCreditLimitDigits(event.target.value.replace(/\D/g, ""))}
                placeholder="R$ 0,00"
                inputMode="numeric"
                className="h-10"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Dia de fechamento</Label>
                <Input value={closingDay} onChange={(event) => setClosingDay(event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="Ex: 15" inputMode="numeric" className="h-10" />
              </div>
              <div className="space-y-2">
                <Label>Dia de vencimento</Label>
                <Input value={dueDay} onChange={(event) => setDueDay(event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="Ex: 22" inputMode="numeric" className="h-10" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Cor do cartão</Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((option) => {
                  const active = option.toLowerCase() === color.toLowerCase();
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setColor(option)}
                      className="relative h-7 w-7 rounded-full border border-white/30 transition-transform hover:scale-105"
                      style={{ backgroundColor: option }}
                      aria-label={`Selecionar cor ${option}`}
                    >
                      {active ? <Check className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 text-white" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>

          <DialogFooter className="mt-2 flex items-center justify-between sm:justify-between">
            {editing ? (
              <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void saveCard()} disabled={!canSave || saving}>
                {editing ? "Salvar alterações" : "Salvar"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>Transações associadas a este cartão ficarão sem cartão.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (!deleting) void deleteCard();
              }}
            >
              {deleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CardsPage;

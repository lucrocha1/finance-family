import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { ensureFamily } from "@/lib/familyGuard";
import type { PlannedItemRow, PlannedKind, PlannedPriority } from "@/lib/plannedItems";

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type CategoryOption = { id: string; name: string; type: string | null };
type AccountOption = { id: string; name: string };

type Props = {
  open: boolean;
  kind: PlannedKind;
  editing: PlannedItemRow | null;
  onClose: () => void;
  onSaved: () => void;
};

export const PlannedItemDialog = ({ open, kind, editing, onClose, onSaved }: Props) => {
  const { family } = useFamily();
  const { user } = useAuth();

  const [description, setDescription] = useState("");
  const [amountDigits, setAmountDigits] = useState("");
  const [categoryId, setCategoryId] = useState<string>("none");
  const [accountId, setAccountId] = useState<string>("none");
  const [priority, setPriority] = useState<PlannedPriority>("medium");
  const [targetDate, setTargetDate] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [catsRes, accRes] = await Promise.all([
        supabase.from("categories").select("id, name, type").order("name", { ascending: true }),
        supabase.from("accounts").select("id, name").order("name", { ascending: true }),
      ]);
      if (cancelled) return;
      setCategories((catsRes.data as CategoryOption[] | null) ?? []);
      setAccounts((accRes.data as AccountOption[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDescription(editing.description);
      setAmountDigits(String(Math.round(Number(editing.amount || 0) * 100)));
      setCategoryId(editing.category_id ?? "none");
      setAccountId(editing.account_id ?? "none");
      setPriority(editing.priority);
      setTargetDate(editing.target_date ?? "");
      setNotes(editing.notes ?? "");
    } else {
      setDescription("");
      setAmountDigits("");
      setCategoryId("none");
      setAccountId("none");
      setPriority("medium");
      setTargetDate("");
      setNotes("");
    }
  }, [editing, open]);

  const filteredCategories = categories.filter((c) => {
    if (kind === "investment") return false;
    return c.type === kind || c.type === null;
  });

  const amountValue = Number(amountDigits || "0") / 100;
  const canSave = description.trim().length >= 2 && amountValue > 0;

  const persist = async () => {
    if (!canSave) return;
    const ctx = ensureFamily(family?.id, user?.id);
    if (!ctx) return;

    setSaving(true);
    const payload = {
      kind,
      description: description.trim(),
      amount: amountValue,
      category_id: categoryId === "none" ? null : categoryId,
      account_id: accountId === "none" ? null : accountId,
      priority,
      target_date: targetDate || null,
      notes: notes.trim() || null,
    };

    let error: { message: string } | null = null;
    if (editing) {
      const { error: updErr } = await supabase.from("planned_items").update(payload).eq("id", editing.id);
      error = updErr;
    } else {
      const { error: insErr } = await supabase
        .from("planned_items")
        .insert({ ...payload, family_id: ctx.familyId, user_id: ctx.userId });
      error = insErr;
    }

    setSaving(false);
    if (error) {
      toast.error(error.message || "Erro ao salvar planejado");
      return;
    }
    toast.success(editing ? "Planejado atualizado" : "Planejado criado");
    onSaved();
    onClose();
  };

  const titleByKind: Record<PlannedKind, { create: string; edit: string }> = {
    investment: { create: "Novo Investimento Planejado", edit: "Editar Investimento Planejado" },
    expense: { create: "Nova Despesa Planejada", edit: "Editar Despesa Planejada" },
    income: { create: "Nova Receita Planejada", edit: "Editar Receita Planejada" },
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{editing ? titleByKind[kind].edit : titleByKind[kind].create}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
            Itens planejados ficam <span className="font-semibold text-foreground">fora</span> de Dashboard, Agenda e cálculos. Quando definir uma data, clique em <span className="font-semibold text-foreground">Agendar</span> para virar pendente.
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Descrição</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value.slice(0, 120))} placeholder="Ex: Comprar TV 65 polegadas" className="h-[42px] rounded-lg border-border bg-secondary text-foreground" />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Valor estimado</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">R$</span>
              <Input
                inputMode="numeric"
                value={ptCurrency.format(amountValue).replace("R$", "").trim()}
                onChange={(e) => setAmountDigits(e.target.value.replace(/\D/g, "").slice(0, 12))}
                className="h-[42px] rounded-lg border-border bg-secondary pl-11 text-lg font-semibold text-foreground"
              />
            </div>
          </div>

          {kind !== "investment" && filteredCategories.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Categoria (opcional)</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem categoria</SelectItem>
                  {filteredCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {kind !== "investment" && accounts.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Conta sugerida (opcional)</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Definir depois</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Prioridade</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as PlannedPriority)}>
                <SelectTrigger className="h-[42px] rounded-lg border-border bg-secondary text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Data alvo (opcional)</Label>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="h-[42px] rounded-lg border-border bg-secondary text-foreground" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Notas</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 600))} rows={2} className="resize-y rounded-lg border-border bg-secondary text-foreground" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void persist()} disabled={!canSave || saving}>
            {saving ? "Salvando..." : editing ? "Salvar alterações" : "Criar planejado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

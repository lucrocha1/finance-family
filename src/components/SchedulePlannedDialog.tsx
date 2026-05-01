import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { ensureFamily } from "@/lib/familyGuard";
import { supabase } from "@/integrations/supabase/client";
import { schedulePlannedInvestment, schedulePlannedTransaction, type PlannedItemRow } from "@/lib/plannedItems";

type Props = {
  open: boolean;
  item: PlannedItemRow | null;
  onClose: () => void;
  onScheduled: () => void;
};

const toIsoDate = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const SchedulePlannedDialog = ({ open, item, onClose, onScheduled }: Props) => {
  const { family } = useFamily();
  const { user } = useAuth();

  const [date, setDate] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [isInstallment, setIsInstallment] = useState(false);
  const [installments, setInstallments] = useState(2);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !item) return;
    setDate(item.target_date ?? new Date().toISOString().slice(0, 10));
    setAccountId(item.account_id ?? "");
    setIsInstallment(false);
    setInstallments(2);
  }, [item, open]);

  useEffect(() => {
    if (!open) return;
    if (item?.kind === "investment") return;
    let cancelled = false;
    void supabase
      .from("accounts")
      .select("id, name")
      .order("name", { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setAccounts((data as Array<{ id: string; name: string }> | null) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [item, open]);

  if (!item) return null;

  const canInstallment = item.kind === "expense";
  const installmentValue = isInstallment ? Number(item.amount || 0) / installments : Number(item.amount || 0);

  const submit = async () => {
    if (!date) {
      toast.error("Escolha uma data");
      return;
    }
    setSaving(true);

    if (item.kind === "investment") {
      const result = await schedulePlannedInvestment(item, date, { familyId: family?.id, userId: user?.id });
      setSaving(false);
      if (!result.ok) { toast.error(result.message); return; }
      toast.success("Agendado!");
      onScheduled();
      onClose();
      return;
    }

    if (!isInstallment) {
      const result = await schedulePlannedTransaction(item, date, { familyId: family?.id, userId: user?.id, accountIdOverride: accountId || null });
      setSaving(false);
      if (!result.ok) { toast.error(result.message); return; }
      toast.success("Agendado! Aparece como pendente nessa data.");
      onScheduled();
      onClose();
      return;
    }

    // Parcelar: cria N transações pending com mesmo installment_group_id,
    // depois remove o planned_item.
    const ctx = ensureFamily(family?.id, user?.id);
    if (!ctx) { setSaving(false); toast.error("Família não carregada"); return; }
    const totalCents = Math.round(Number(item.amount || 0) * 100);
    const baseCents = Math.floor(totalCents / installments);
    const remainder = totalCents % installments;
    const groupId = crypto.randomUUID();
    // Calcula data de cada parcela trabalhando com a string ISO direto
    // (evita bugs de timezone que Date.setMonth pode gerar em GMT-3).
    const [baseYear, baseMonth, baseDay] = date.split("-").map(Number);
    const rows = Array.from({ length: installments }, (_, index) => {
      const targetMonthIndex = baseMonth - 1 + index;
      const year = baseYear + Math.floor(targetMonthIndex / 12);
      const month = ((targetMonthIndex % 12) + 12) % 12;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const day = Math.min(baseDay, lastDay);
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return {
        family_id: ctx.familyId,
        user_id: ctx.userId,
        type: "expense",
        description: `${item.description} (${index + 1}/${installments})`,
        amount: (baseCents + (index < remainder ? 1 : 0)) / 100,
        date: dateStr,
        status: "pending",
        category_id: item.category_id,
        account_id: accountId || item.account_id || null,
        notes: item.notes,
        is_installment: true,
        installment_group_id: groupId,
        installment_current: index + 1,
        installment_total: installments,
      };
    });

    const { error: insErr } = await supabase.from("transactions").insert(rows);
    if (insErr) { setSaving(false); toast.error(insErr.message); return; }
    const { error: delErr } = await supabase.from("planned_items").delete().eq("id", item.id);
    if (delErr) { setSaving(false); toast.error(delErr.message); return; }

    setSaving(false);
    toast.success(`Parcelado em ${installments}x e agendado!`);
    onScheduled();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Agendar — {item.description}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Define a data e o item vira {item.kind === "investment" ? "um investimento" : "uma transação pendente"}.
          </p>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{isInstallment ? "Data da 1ª parcela" : "Data"}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-[42px] rounded-lg border-border bg-secondary text-foreground" />
          </div>

          {item.kind !== "investment" && accounts.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Conta (opcional)</Label>
              <Select value={accountId || "none"} onValueChange={(value) => setAccountId(value === "none" ? "" : value)}>
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

          {canInstallment && (
            <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium text-foreground">Parcelar</Label>
                  <p className="text-xs text-muted-foreground">Divide em parcelas mensais começando na data acima</p>
                </div>
                <Switch checked={isInstallment} onCheckedChange={setIsInstallment} />
              </div>
              {isInstallment && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Número de parcelas (2 a 48)</Label>
                  <Input
                    type="number"
                    min={2}
                    max={48}
                    value={installments}
                    onChange={(e) => setInstallments(Math.min(48, Math.max(2, Number(e.target.value) || 2)))}
                    className="h-[42px] rounded-lg border-border bg-secondary text-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    {installments}× de {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(installmentValue)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void submit()} disabled={saving || !date}>
            {saving ? "Agendando..." : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

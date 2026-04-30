import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { schedulePlannedInvestment, schedulePlannedTransaction, type PlannedItemRow } from "@/lib/plannedItems";

type Props = {
  open: boolean;
  item: PlannedItemRow | null;
  onClose: () => void;
  onScheduled: () => void;
};

export const SchedulePlannedDialog = ({ open, item, onClose, onScheduled }: Props) => {
  const { family } = useFamily();
  const { user } = useAuth();

  const [date, setDate] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !item) return;
    setDate(item.target_date ?? new Date().toISOString().slice(0, 10));
    setAccountId(item.account_id ?? "");
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

  const submit = async () => {
    if (!date) {
      toast.error("Escolha uma data");
      return;
    }
    setSaving(true);
    const result = item.kind === "investment"
      ? await schedulePlannedInvestment(item, date, { familyId: family?.id, userId: user?.id })
      : await schedulePlannedTransaction(item, date, { familyId: family?.id, userId: user?.id, accountIdOverride: accountId || null });
    setSaving(false);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Agendado! Aparece como pendente nessa data.");
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
            <Label className="text-xs text-muted-foreground">Data</Label>
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

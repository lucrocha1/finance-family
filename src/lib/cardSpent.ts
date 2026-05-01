import { getOpenInvoiceWindow } from "@/lib/cardCycle";

// computeSpentByCard — fonte da verdade pro "limite utilizado" em cartão.
//
// Definição: limite comprometido = soma de despesas pending no cartão
// COM data >= cycleStart_aberto (ciclo de fatura atualmente em aberto).
//
// Isso captura:
// - Compras do ciclo atual (próxima fatura a fechar)
// - Parcelas e recorrentes em ciclos FUTUROS (banco real cobra do limite)
//
// E EXCLUI:
// - Compras de ciclos PASSADOS que ainda estão pending (faturas que o
//   usuário esqueceu de marcar como pagas via "Pagar Fatura"). Essas
//   ficam separadas como "Em atraso" — exigem reconciliação manual mas
//   não inflacionam o limite atual.
//
// Retorna por cartão:
//   spent: total no ciclo aberto + futuros
//   overdue: total em ciclos passados não pagos (lixo a reconciliar)
//   ratio, available: derivados do limit do cartão
//   overdueCount: quantas transações em atraso

const toIso = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export type CardSpentInput = {
  id: string;
  credit_limit: number | null;
  closing_day: number | null;
  due_day: number | null;
};

export type CardCommitment = {
  card_id: string | null;
  amount: number | null;
  status: string | null;
  date: string;
};

export type CardSpentResult = {
  cardId: string;
  spent: number;
  overdue: number;
  overdueCount: number;
  limit: number;
  available: number;
  ratio: number;
};

export const computeSpentByCard = (
  cards: CardSpentInput[],
  commitments: CardCommitment[],
  today: Date = new Date(),
): Map<string, CardSpentResult> => {
  const result = new Map<string, CardSpentResult>();
  const todayLocal = new Date(today);
  todayLocal.setHours(0, 0, 0, 0);

  for (const card of cards) {
    const closingDay = Number(card.closing_day || 0);
    const dueDay = Number(card.due_day || 0);
    const limit = Number(card.credit_limit || 0);

    let cycleStartIso: string | null = null;
    if (closingDay > 0 && dueDay > 0) {
      const cycle = getOpenInvoiceWindow(closingDay, dueDay, todayLocal);
      cycleStartIso = toIso(cycle.invoiceStart);
    }

    let spent = 0;
    let overdue = 0;
    let overdueCount = 0;

    for (const tx of commitments) {
      if (tx.card_id !== card.id) continue;
      if (tx.status === "paid") continue;
      const amount = Number(tx.amount || 0);

      if (cycleStartIso && tx.date < cycleStartIso) {
        overdue += amount;
        overdueCount += 1;
      } else {
        spent += amount;
      }
    }

    const available = Math.max(limit - spent, 0);
    const ratio = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;

    result.set(card.id, { cardId: card.id, spent, overdue, overdueCount, limit, available, ratio });
  }

  return result;
};

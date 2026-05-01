import { getInvoiceCycleForMonth } from "@/lib/cardCycle";

// computeProjectedCash — fonte da verdade pro saldo projetado em
// Dashboard e Transactions.
//
// Invariante: janela cumulativa de hoje até o fim do mês visualizado.
// A função soma TODAS as pendências não-cartão nessa janela e desconta
// as faturas de cartão cujo vencimento cai dentro dela. Isso faz com
// que navegar pra meses futuros acumule todos os meses intermediários
// (ex: maio +500 + junho +300 sobre saldo de 5000 vira 5800 ao olhar
// junho, e 6000 ao olhar julho com +200).
//
// Dependência crítica: a função depende dos filhos de recorrências
// estarem materializados no DB (a query de pendências só vê o que
// está inserido). Esse contrato é mantido pelo hook
// useEnsureRecurrencesUpTo nas páginas que consomem.
//
// Pra meses passados (monthEnd < hoje), não há projeção — retorna
// só o saldo atual sem retroceder.

const toIso = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export type PendingTx = {
  type: string | null;
  amount: number | null;
  // status, card_id, date podem existir no row, não precisamos aqui — o
  // chamador já filtra antes de passar.
};

export type CardForCycle = {
  id: string;
  closing_day?: number | null;
  due_day?: number | null;
};

export type CardTxForCycle = {
  card_id: string | null;
  amount: number | null;
  date: string;
  status: string | null;
};

// Dívidas/empréstimos ativos com vencimento dentro da janela de projeção.
// Esperamos pré-filtragem leve no chamador (status != 'paid_off',
// due_date IS NOT NULL), mas a função revalida pra ser robusta.
export type DebtForProjection = {
  status: string | null;
  direction: string | null; // 'i_owe' (cash out) | 'they_owe' (cash in)
  due_date: string | null;
  total_with_interest: number | null;
  original_amount: number | null;
  amount_paid: number | null;
  has_installments: boolean | null;
  installment_amount: number | null;
};

export type ProjectedCashInput = {
  totalBankBalance: number;
  cumulativePendingTxs: PendingTx[]; // já filtrados: status != paid, card_id IS NULL, date entre hoje e monthEnd
  cards: CardForCycle[];
  cardTransactions: CardTxForCycle[]; // gastos de cartão num range que cobre [hoje-60d, monthEnd+30d]
  monthEnd: Date;
  today?: Date;
  debts?: DebtForProjection[]; // ativos com due_date entre hoje e monthEnd
};

export type ProjectedCashResult = {
  projected: number;
  delta: number;
  cardInvoiceTotal: number;
  pendingIncome: number;
  pendingExpense: number;
  debtOutflow: number; // total a pagar (i_owe) na janela
  debtInflow: number; // total a receber (they_owe) na janela
};

export const computeProjectedCash = (input: ProjectedCashInput): ProjectedCashResult => {
  const today = input.today ?? new Date();
  today.setHours(0, 0, 0, 0);

  if (input.monthEnd < today) {
    return {
      projected: input.totalBankBalance,
      delta: 0,
      cardInvoiceTotal: 0,
      pendingIncome: 0,
      pendingExpense: 0,
      debtOutflow: 0,
      debtInflow: 0,
    };
  }

  const todayIso = toIso(today);
  const monthEndIso = toIso(input.monthEnd);

  const pendingIncome = input.cumulativePendingTxs
    .filter((tx) => tx.type === "income")
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const pendingExpense = input.cumulativePendingTxs
    .filter((tx) => tx.type === "expense")
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

  let cardInvoiceTotal = 0;
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endMonth = new Date(input.monthEnd.getFullYear(), input.monthEnd.getMonth(), 1);
  for (const card of input.cards) {
    const closingDay = Number(card.closing_day || 0);
    const dueDay = Number(card.due_day || 0);
    if (!closingDay || !dueDay) continue;
    const cursor = new Date(startMonth);
    while (cursor <= endMonth) {
      const cycle = getInvoiceCycleForMonth(closingDay, dueDay, cursor.getFullYear(), cursor.getMonth());
      if (cycle.dueDate >= today && cycle.dueDate <= input.monthEnd) {
        const cycleStartIso = toIso(cycle.cycleStart);
        const cycleEndIso = toIso(cycle.cycleEnd);
        const unpaid = input.cardTransactions
          .filter(
            (tx) =>
              tx.card_id === card.id &&
              tx.date >= cycleStartIso &&
              tx.date <= cycleEndIso &&
              tx.status !== "paid",
          )
          .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        cardInvoiceTotal += unpaid;
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  // Dívidas/empréstimos ativos com vencimento na janela.
  // Para dívidas parceladas, o schema só guarda um único due_date (próxima
  // parcela), então projetamos apenas installment_amount nessa janela. Para
  // dívidas à vista, projetamos o restante (total - pago).
  let debtOutflow = 0;
  let debtInflow = 0;
  for (const debt of input.debts ?? []) {
    if (!debt.due_date) continue;
    if (debt.status && debt.status !== "active") continue;
    if (debt.due_date < todayIso || debt.due_date > monthEndIso) continue;
    const total = Number(debt.total_with_interest ?? debt.original_amount ?? 0);
    const remaining = Math.max(0, total - Number(debt.amount_paid ?? 0));
    if (remaining <= 0) continue;
    const installment = Number(debt.installment_amount ?? 0);
    const amount = debt.has_installments && installment > 0
      ? Math.min(installment, remaining)
      : remaining;
    if (amount <= 0) continue;
    if (debt.direction === "they_owe") {
      debtInflow += amount;
    } else {
      debtOutflow += amount;
    }
  }

  const projected =
    input.totalBankBalance + pendingIncome - pendingExpense - cardInvoiceTotal + debtInflow - debtOutflow;
  return {
    projected,
    delta: projected - input.totalBankBalance,
    cardInvoiceTotal,
    pendingIncome,
    pendingExpense,
    debtOutflow,
    debtInflow,
  };
};

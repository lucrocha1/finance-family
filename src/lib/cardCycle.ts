// Helpers de ciclo de fatura de cartão. Extraído de Dashboard.tsx pra
// permitir reuso entre Dashboard, Transactions e CardInvoiceDetail.
//
// Convenção: compras feitas NO dia do fechamento entram na PRÓXIMA fatura
// (igual padrão de banco real). Ou seja, o ciclo de uma fatura M é:
//   [closingDay do mês M-1, closingDay do mês M - 1 dia]
// Compras no dia closingDay caem na fatura M+1 (cycleStart = closingDay).

const clampDay = (year: number, month: number, day: number) => {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
};

// Retorna o ciclo de fatura cujo VENCIMENTO cai no mês/ano fornecido.
// Usado pra projetar o pagamento da fatura como um único evento de
// caixa na data de vencimento (em vez de N entradas por compra).
export const getInvoiceCycleForMonth = (
  closingDay: number,
  dueDay: number,
  year: number,
  month: number,
): { dueDate: Date; cycleStart: Date; cycleEnd: Date } => {
  const dueDate = clampDay(year, month, dueDay);
  // Se o vencimento é >= fechamento, o ciclo fecha no MESMO mês do
  // vencimento. Senão, fecha no mês anterior.
  const closingOffset = dueDay >= closingDay ? 0 : -1;
  const closingDate = clampDay(year, month + closingOffset, closingDay);
  const prevClosing = clampDay(year, month + closingOffset - 1, closingDay);
  // cycleStart = dia do fechamento anterior (compra nesse dia entra nesta fatura)
  const cycleStart = new Date(prevClosing);
  // cycleEnd = dia ANTERIOR ao fechamento atual (compra no closingDay vai pra próxima)
  const cycleEnd = new Date(closingDate);
  cycleEnd.setDate(cycleEnd.getDate() - 1);
  return { dueDate, cycleStart, cycleEnd };
};

// Retorna a janela do ciclo de fatura ABERTA agora (a próxima a vencer).
export const getOpenInvoiceWindow = (
  closingDay: number,
  dueDay: number,
  today: Date = new Date(),
): { invoiceStart: Date; invoiceEnd: Date; dueDate: Date } => {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  // Com regra de "closingDay vai pra próxima", se hoje >= closingDay já
  // estamos no ciclo que fecha no PRÓXIMO mês.
  const nextClosing = day >= closingDay
    ? clampDay(year, month + 1, closingDay)
    : clampDay(year, month, closingDay);
  const prevClosing = clampDay(nextClosing.getFullYear(), nextClosing.getMonth() - 1, closingDay);
  // invoiceStart = dia do fechamento anterior (compra nesse dia entra aqui)
  const invoiceStart = new Date(prevClosing);
  // invoiceEnd = dia ANTERIOR ao próximo fechamento
  const invoiceEnd = new Date(nextClosing);
  invoiceEnd.setDate(invoiceEnd.getDate() - 1);
  const dueOffset = dueDay >= closingDay ? 0 : 1;
  const dueDate = clampDay(nextClosing.getFullYear(), nextClosing.getMonth() + dueOffset, dueDay);
  return { invoiceStart, invoiceEnd, dueDate };
};

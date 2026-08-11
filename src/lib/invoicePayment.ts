// "Pagamento Fatura" é o lançamento criado ao pagar a fatura do cartão
// (RPC pay_card_invoice): sai da conta (card_id null) e quita as compras do
// ciclo. Ele DEBITA o saldo da conta — o dinheiro realmente saiu — mas NÃO é
// uma despesa nova: as compras já foram lançadas na data da compra. Portanto
// deve ser invisível em TODO cálculo de GASTO (Transações, Dashboard,
// Orçamento, Relatórios); contá-lo somaria o mesmo dinheiro duas vezes e ainda
// entope a categoria "Sem categoria". É, na prática, uma transferência entre a
// conta e o cartão.
//
// Fonte única da regra — use em qualquer agregação de despesa.
// Identificação: a COLUNA is_invoice_payment (gravada pela RPC pay_card_invoice)
// é a fonte da verdade. O fallback pelo PREFIXO da descrição só vale quando a
// coluna não veio na query (linhas antigas / queries que ainda não a trazem) —
// evita regressão na transição e o falso-positivo de uma despesa real chamada
// "Pagamento Fatura ..." (ex.: conta de luz) some dos totais.
export const isInvoicePayment = (
  tx: { card_id?: string | null; description?: string | null; is_invoice_payment?: boolean | null },
): boolean => {
  if (typeof tx.is_invoice_payment === "boolean") return tx.is_invoice_payment;
  return !tx.card_id && (tx.description ?? "").startsWith("Pagamento Fatura");
};

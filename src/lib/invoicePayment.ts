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
export const isInvoicePayment = (tx: { card_id?: string | null; description?: string | null }): boolean =>
  !tx.card_id && (tx.description ?? "").startsWith("Pagamento Fatura");

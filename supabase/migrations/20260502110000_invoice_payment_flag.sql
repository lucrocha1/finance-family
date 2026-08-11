-- F10: pagamento de fatura de cartão passa a ser identificado por COLUNA dedicada
-- (is_invoice_payment), não mais pelo PREFIXO da descrição ("Pagamento Fatura").
-- Motivo: uma despesa real como "Pagamento Fatura Enel" (conta de luz) casava o
-- prefixo e sumia de TODOS os totais de despesa, mesmo debitando o saldo.
--
-- Sequência de aplicação (IMPORTANTE, pra não dobrar contagem em nenhum momento):
--   1) Esta migration (coluna + backfill) — seguro rodar a qualquer hora.
--   2) Ajuste da RPC pay_card_invoice: setar is_invoice_payment = true na
--      transação de pagamento que ela insere (ver arquivo/def ajustada à parte).
--   3) Deploy do client: isInvoicePayment passa a ler a flag (com fallback de
--      prefixo pras linhas/queries sem a coluna) + selects incluindo a coluna.
--   4) Redeploy da edge generate-notifications (cópia Deno da regra).

-- 1) Coluna dedicada. NOT NULL default false (nova transação nasce "não é pagamento
--    de fatura"; só a RPC pay_card_invoice marca true).
alter table public.transactions
  add column if not exists is_invoice_payment boolean not null default false;

-- 2) Backfill dos pagamentos de fatura JÁ existentes (mesma heurística de hoje),
--    pra continuarem sendo excluídos do gasto após a troca. Idempotente. Preserva
--    o comportamento atual pras linhas antigas; a correção do falso-positivo
--    ("Pagamento Fatura Enel") vale pras transações NOVAS (flag=false por padrão).
update public.transactions
set is_invoice_payment = true
where is_invoice_payment = false
  and card_id is null
  and type = 'expense'
  and coalesce(description, '') like 'Pagamento Fatura%';

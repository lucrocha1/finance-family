-- MESMO BUG do dedup das notificações (20260501120000), agora nas recorrências:
-- o gerador (src/lib/generateRecurrences.ts e a Edge Function generate-recurrences)
-- usa upsert onConflict (recurrence_parent_id, date). O indice era PARCIAL
-- (transactions_recurrence_parent_date_uniq WHERE recurrence_parent_id IS NOT NULL)
-- e o PostgREST/ON CONFLICT nao casa indice parcial -> falhava com 42P10 e a
-- geracao parou de materializar novas ocorrencias (comprovado: re-inserir uma
-- filha existente com ON CONFLICT dava 42P10; as filhas ate 2027 eram legado do
-- tempo em que o gerador usava insert puro).
--
-- Troca por UNIQUE CONSTRAINT real. NULLs sao distintos, entao as transacoes
-- normais (recurrence_parent_id NULL) seguem sem restricao. Conserta a geracao
-- no cliente E habilita o cron no servidor.

drop index if exists public.transactions_recurrence_parent_date_uniq;

alter table public.transactions
  add constraint transactions_recurrence_parent_date_uniq unique (recurrence_parent_id, date);

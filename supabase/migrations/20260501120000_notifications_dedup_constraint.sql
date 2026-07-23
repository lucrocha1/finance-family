-- FIX CRÍTICO: o upsert onConflict (user_id, dedup_key) do PostgREST usado pela
-- Edge Function generate-notifications NÃO casava o índice PARCIAL
-- (notifications_dedup, where dedup_key is not null) -> ON CONFLICT falhava com
-- "42P10: there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" e NENHUMA notificação era inserida (tabela ficava vazia).
--
-- Troca o índice parcial por uma UNIQUE CONSTRAINT real. Em constraint UNIQUE os
-- NULLs são distintos, então dedup_key null continua permitindo múltiplas linhas
-- (comportamento idêntico ao índice parcial), mas agora o ON CONFLICT funciona.

begin;

drop index if exists public.notifications_dedup;

alter table public.notifications
  add constraint notifications_user_dedup_uniq unique (user_id, dedup_key);

commit;

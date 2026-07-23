-- Habilita Realtime (postgres_changes) na tabela notifications, pra o sino
-- in-app atualizar na hora + tocar toast quando chega notificação nova.
-- A RLS já isola por user_id; o filtro do client é user_id=eq.<uid>.

begin;

-- REPLICA IDENTITY FULL garante todas as colunas no WAL (robusto pra filtros).
alter table public.notifications replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;

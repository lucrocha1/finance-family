-- Preferências de notificação por usuário. Lidas pela Edge Function
-- generate-notifications (gate por categoria + quiet hours) e editadas no
-- Settings via useNotificationPreferences. Ausência de linha = tudo ligado
-- (defaults). in-app é sempre gerado; push_enabled/quiet_hours só afetam o
-- disparo de push do sistema operacional.

begin;

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  push_enabled boolean not null default true,
  -- toggles por categoria (mapeamento kind->categoria vive na função e no client)
  cat_compromissos boolean not null default true,   -- daily_due
  cat_orcamento boolean not null default true,       -- budget_warn/over
  cat_atrasados boolean not null default true,       -- tx_overdue/income_overdue/debt_overdue
  cat_fatura boolean not null default true,          -- card_closing/card_due/card_limit_high
  cat_saldo boolean not null default true,           -- negative_balance/month_deficit
  cat_metas boolean not null default true,           -- goal_50/90/done
  cat_investimentos boolean not null default true,   -- invest_up/down
  cat_recorrencias boolean not null default true,    -- recurrence_generated
  cat_resumos boolean not null default true,         -- weekly_summary/monthly_close
  -- horário de silêncio (0-23, BRT). null/null = sem silêncio. Janela pode
  -- cruzar meia-noite (ex.: start=22, end=7).
  quiet_start smallint check (quiet_start is null or (quiet_start between 0 and 23)),
  quiet_end smallint check (quiet_end is null or (quiet_end between 0 and 23)),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'notification_preferences'
  loop
    execute format('drop policy if exists %I on public.notification_preferences', pol.policyname);
  end loop;
end $$;

create policy "notif_prefs_select_own" on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());
create policy "notif_prefs_insert_own" on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());
create policy "notif_prefs_update_own" on public.notification_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

commit;

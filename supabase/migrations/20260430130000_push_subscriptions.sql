-- Web Push subscriptions per user/device. Each subscription is
-- identified by its endpoint URL (returned by the browser's
-- PushManager). The Edge Function send-push-notifications uses the
-- p256dh + auth keys to encrypt the payload.

begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists idx_push_subs_user on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions'
  loop
    execute format('drop policy if exists %I on public.push_subscriptions', pol.policyname);
  end loop;
end $$;

create policy "ps_select_own" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy "ps_insert_own" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());
create policy "ps_delete_own" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

commit;

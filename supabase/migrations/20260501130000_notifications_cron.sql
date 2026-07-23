-- Agenda a Edge Function generate-notifications pra rodar 1x/dia via pg_cron +
-- pg_net, sem depender de o usuário abrir o app. (Aplicado no projeto via MCP.)
--
-- O header Authorization usa a ANON KEY (pública — a mesma do frontend,
-- VITE_SUPABASE_ANON_KEY): ela é um JWT válido e passa o gateway verify_jwt=true.
-- A função por dentro usa a service_role do ambiente pra fazer o trabalho, então
-- NÃO é preciso expor a service_role key aqui.
--
-- generate-recurrences NÃO é agendada: não está deployada (recorrências rodam no
-- client via useEnsureRecurrencesUpTo). Se um dia for deployada, agende igual.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- cron.schedule faz upsert por nome (idempotente). 10:00 UTC ~= 07:00 BRT.
-- Substitua o <ANON_KEY> abaixo caso rode manualmente (é a chave pública anon).
select cron.schedule(
  'finance-family-notifications',
  '0 10 * * *',
  $job$
  select net.http_post(
    url := 'https://vydjzvehxlkbtsciemtq.supabase.co/functions/v1/generate-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>'
    ),
    body := '{}'::jsonb
  );
  $job$
);

-- Conferir:   select jobname, schedule, active from cron.job;
-- Remover:    select cron.unschedule('finance-family-notifications');

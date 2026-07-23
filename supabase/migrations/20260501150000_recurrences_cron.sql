-- Agenda generate-recurrences 1x/dia via pg_cron + pg_net (extensoes ja
-- habilitadas em 20260501130000). Garante que as ocorrencias recorrentes sao
-- materializadas no servidor mesmo que ninguem abra o app — igual generate-
-- notifications. Roda 06:00 UTC (~03:00 BRT), ANTES das notificacoes (10:00 UTC),
-- pra as notificacoes verem as ocorrencias ja criadas.
--
-- Header usa a ANON KEY (publica, JWT valido) -> passa verify_jwt=true; a funcao
-- usa a service_role do ambiente por dentro. Substitua <ANON_KEY> ao rodar manual.
-- Aplicado no projeto via MCP.

select cron.schedule(
  'finance-family-recurrences',
  '0 6 * * *',
  $job$
  select net.http_post(
    url := 'https://vydjzvehxlkbtsciemtq.supabase.co/functions/v1/generate-recurrences',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>'
    ),
    body := '{}'::jsonb
  );
  $job$
);

-- Conferir:  select jobname, schedule, active from cron.job;
-- Remover:   select cron.unschedule('finance-family-recurrences');

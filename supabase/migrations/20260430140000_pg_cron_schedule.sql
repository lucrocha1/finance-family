-- Schedule the recurring edge functions via pg_cron + http extension.
-- This makes notifications and recurring transactions run reliably
-- without depending on a user opening the app.
--
-- Manual setup (run once before this migration if extensions aren't on):
-- 1. Supabase Dashboard → Database → Extensions → enable `pg_cron` and `pg_net` (or `http`)
-- 2. Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> below with your values
-- 3. Run this migration in SQL Editor

-- generate-recurrences: every day at 06:00 UTC (~03:00 BRT)
-- generate-notifications: every day at 10:00 UTC (~07:00 BRT)
--
-- Adjust times to taste. Use jobid to remove later if needed.

-- IMPORTANT: replace the two placeholders before running this file.
-- If you keep the placeholders, the SELECT cron.schedule lines below
-- will silently 404 every day — uncomment them only after editing.

/*
select cron.schedule(
  'finance-family-recurrences',
  '0 6 * * *',
  $$ select net.http_post(
       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/generate-recurrences',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
       ),
       body := '{}'::jsonb
     ) $$
);

select cron.schedule(
  'finance-family-notifications',
  '0 10 * * *',
  $$ select net.http_post(
       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/generate-notifications',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
       ),
       body := '{}'::jsonb
     ) $$
);
*/

-- Listing existing jobs:
--   select * from cron.job;
-- Removing a job:
--   select cron.unschedule('finance-family-notifications');

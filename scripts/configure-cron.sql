-- Run once per Supabase project (SQL editor or `psql`), after the migrations.
-- It stores where Postgres should call the job runner. Nothing is sent until
-- both secrets exist, and the secret never leaves Supabase Vault.
--
-- 1. Replace the URL with your deployment (the route is /api/jobs/tick).
-- 2. Use the same value as FUNLABS_CRON_SECRET in the app environment.

select vault.create_secret('https://YOUR-DEPLOYMENT.vercel.app/api/jobs/tick', 'funlabs_jobs_tick_url');
select vault.create_secret('REPLACE_WITH_FUNLABS_CRON_SECRET', 'funlabs_jobs_tick_secret');

-- Check: both should be true, and the cron jobs should be active.
select exists (select 1 from vault.decrypted_secrets where name = 'funlabs_jobs_tick_url') as url_configured,
       exists (select 1 from vault.decrypted_secrets where name = 'funlabs_jobs_tick_secret') as secret_configured;
select jobname, schedule, active from cron.job where jobname like 'funlabs-%';

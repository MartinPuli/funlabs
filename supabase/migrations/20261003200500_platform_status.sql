-- Read-only platform facts for the public status page. Executable only by the
-- backend; it reports booleans and counts, never secrets.

create or replace function public.platform_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cron_jobs jsonb := '[]'::jsonb;
begin
  if not private.is_worker() then
    raise exception 'Solo el backend consulta el estado de la plataforma' using errcode = '42501';
  end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active) order by jobname), '[]'::jsonb)
      into v_cron_jobs from cron.job where jobname like 'funlabs-%';
  exception when others then
    v_cron_jobs := '[]'::jsonb;
  end;
  return jsonb_build_object(
    'extensions', (select coalesce(jsonb_agg(extname order by extname), '[]'::jsonb) from pg_extension where extname in ('pg_cron', 'pg_net', 'supabase_vault', 'pgcrypto')),
    'cron_jobs', v_cron_jobs,
    'wakeup_configured', exists (select 1 from vault.decrypted_secrets where name = 'funlabs_jobs_tick_url')
                         and exists (select 1 from vault.decrypted_secrets where name = 'funlabs_jobs_tick_secret'),
    'realtime_tables', (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'),
    'buckets', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public) order by id), '[]'::jsonb) from storage.buckets where id in ('recordings', 'exports')),
    'jobs', (select jsonb_build_object(
               'queued', count(*) filter (where status = 'queued'),
               'running', count(*) filter (where status = 'running'),
               'failed', count(*) filter (where status = 'failed'),
               'succeeded', count(*) filter (where status = 'succeeded')) from public.jobs),
    'rls_tables', (select count(*) from pg_tables t where t.schemaname = 'public' and t.rowsecurity),
    'public_tables', (select count(*) from pg_tables t where t.schemaname = 'public')
  );
end;
$$;

revoke execute on function public.platform_status() from public, anon;
grant execute on function public.platform_status() to authenticated, service_role;

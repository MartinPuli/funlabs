-- Storage, Realtime and scheduled work.

-- ---------------------------------------------------------------------------
-- Private buckets. Paths always start with the study id: <study_id>/...
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('recordings', 'recordings', false, 52428800, array['video/webm', 'video/mp4', 'video/quicktime', 'audio/webm']),
  ('exports', 'exports', false, 52428800, array['application/json', 'application/x-ndjson'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.path_study(p_name text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

-- The backend creates signed upload URLs and reads material for analysis.
create policy funlabs_worker_objects on storage.objects for all to authenticated
  using (bucket_id in ('recordings', 'exports') and private.is_worker())
  with check (bucket_id in ('recordings', 'exports') and private.is_worker());

-- Creators of a study can stream its recordings (signed URLs).
-- Researchers cannot: downloading an export never grants access to video.
create policy funlabs_recordings_creators on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and private.can_work(private.path_study(name)));

-- Exports are private downloads for members of the study.
create policy funlabs_exports_members on storage.objects for select to authenticated
  using (bucket_id = 'exports' and private.has_role(private.path_study(name), array['owner', 'collaborator', 'researcher']));

-- ---------------------------------------------------------------------------
-- Realtime: the lab updates live as material arrives and jobs progress.
-- postgres_changes respects RLS, so each creator only receives their studies.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['studies', 'jobs', 'sessions', 'recordings', 'deliveries', 'evidence', 'evidence_reviews',
                           'checks', 'interventions', 'comparisons', 'agent_submissions', 'agent_tool_calls', 'dataset_exports'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduled work with pg_cron + pg_net.
-- Every minute, if jobs are waiting, Postgres wakes the job runner endpoint.
-- The endpoint URL and shared secret live in Supabase Vault; nothing runs
-- until they are configured (see scripts/configure-cron.sql).
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function private.tick_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'funlabs_jobs_tick_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'funlabs_jobs_tick_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  if not exists (select 1 from public.jobs where status = 'queued' and run_after <= now()) then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-funlabs-cron', v_secret),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 8000
  );
end;
$$;

create or replace function private.expire_exports()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.dataset_exports set status = 'expired' where status = 'ready' and expires_at < now();
$$;

revoke execute on function private.tick_jobs() from public, anon, authenticated;
revoke execute on function private.expire_exports() from public, anon, authenticated;

select cron.schedule('funlabs-jobs-tick', '* * * * *', $$select private.tick_jobs()$$);
select cron.schedule('funlabs-expire-exports', '17 * * * *', $$select private.expire_exports()$$);

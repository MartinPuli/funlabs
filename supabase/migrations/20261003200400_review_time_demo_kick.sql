-- Review time (an impact criterion), public demo products and instant job kick.

-- ---------------------------------------------------------------------------
-- Products that anyone can play (version list at /jugar). Off by default.
-- ---------------------------------------------------------------------------
alter table public.products add column if not exists is_public_demo boolean not null default false;

-- ---------------------------------------------------------------------------
-- Time a team member spends reviewing a study's evidence (active time only).
-- ---------------------------------------------------------------------------
create table public.review_time (
  study_id uuid not null references public.studies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seconds integer not null default 0 check (seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (study_id, user_id)
);

alter table public.review_time enable row level security;
revoke all on public.review_time from anon;
create policy worker_all_review_time on public.review_time for all to authenticated
  using (private.is_worker()) with check (private.is_worker());
create policy review_time_select on public.review_time for select to authenticated
  using (private.can_work(study_id));

-- Each heartbeat adds at most 120 seconds, so a script cannot inflate it quickly.
create or replace function public.add_review_time(p_study uuid, p_seconds integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_add integer := least(greatest(coalesce(p_seconds, 0), 0), 120);
begin
  if (select auth.uid()) is null or not private.can_work(p_study) then
    raise exception 'Sin acceso al estudio' using errcode = '42501';
  end if;
  insert into public.review_time (study_id, user_id, seconds)
  values (p_study, (select auth.uid()), v_add)
  on conflict (study_id, user_id)
  do update set seconds = public.review_time.seconds + v_add, updated_at = now()
  returning seconds into v_total;
  return v_total;
end;
$$;

revoke execute on function public.add_review_time(uuid, integer) from public, anon;
grant execute on function public.add_review_time(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Wake the job runner as soon as a job is queued (pg_net is asynchronous, so
-- the INSERT never waits on the HTTP call). pg_cron remains the safety net.
-- ---------------------------------------------------------------------------
create or replace function private.kick_jobs()
returns trigger
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
    return new;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-funlabs-cron', v_secret),
    body := jsonb_build_object('source', 'job_insert', 'job_id', new.id),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  -- Never block the transaction that queued the job.
  return new;
end;
$$;

revoke execute on function private.kick_jobs() from public, anon, authenticated;

create trigger jobs_kick
  after insert on public.jobs
  for each row when (new.status = 'queued')
  execute function private.kick_jobs();

-- Row level security for FUNLABS.
--
-- Who can see what:
--   * Creators (owner/collaborator of a study) see that study's material,
--     evidence, jobs, agent activity and budget.
--   * Researchers see the study, its versions and exports; never the raw
--     recordings, sessions or comments.
--   * Testers and agents have no database identity. They reach the backend
--     with scoped tokens and the backend acts through the worker identity.
--   * anon has no access to any table.

-- ---------------------------------------------------------------------------
-- Enable RLS and a worker policy everywhere
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'products', 'versions', 'version_files', 'check_suites', 'studies', 'study_members',
    'study_versions', 'bounties', 'invitations', 'assignments', 'deliveries', 'sessions', 'recordings',
    'game_events', 'feedback', 'consent_records', 'analysis_runs', 'agent_credentials', 'agent_submissions',
    'evidence', 'evidence_sources', 'evidence_reviews', 'agent_tool_calls', 'interventions', 'checks',
    'comparisons', 'jobs', 'budget_entries', 'payment_events', 'dataset_exports'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.is_worker()) with check (private.is_worker())',
      'worker_all_' || t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.study_members a
      join public.study_members b on a.study_id = b.study_id
      where a.user_id = (select auth.uid()) and b.user_id = profiles.id
    )
  );
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Products, versions, suites
-- ---------------------------------------------------------------------------
-- Cross-table checks go through security definer helpers so that policies on
-- one table never expand into policies on another (no recursion).
create or replace function private.owns_product(p_product uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.products p where p.id = p_product and p.owner_id = (select auth.uid()))
$$;

create or replace function private.member_of_product(p_product uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.studies s join public.study_members m on m.study_id = s.id
    where s.product_id = p_product and m.user_id = (select auth.uid())
  )
$$;

create policy products_select on public.products for select to authenticated
  using (owner_id = (select auth.uid()) or private.member_of_product(id));
create policy products_insert on public.products for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy products_update on public.products for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create or replace function private.can_see_version(p_version uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.versions v join public.products p on p.id = v.product_id
    where v.id = p_version and p.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.study_versions sv
    where sv.version_id = p_version and private.has_role(sv.study_id, array['owner', 'collaborator', 'researcher'])
  )
$$;

create policy versions_select on public.versions for select to authenticated
  using (private.can_see_version(id));
create policy version_files_select on public.version_files for select to authenticated
  using (private.can_see_version(version_id));
create policy check_suites_select on public.check_suites for select to authenticated
  using (private.owns_product(product_id) or private.member_of_product(product_id));

-- ---------------------------------------------------------------------------
-- Studies and membership
-- ---------------------------------------------------------------------------
-- Owners see their study directly (the membership row is added by an AFTER
-- trigger, after INSERT ... RETURNING is checked).
create policy studies_select on public.studies for select to authenticated
  using (owner_id = (select auth.uid()) or private.has_role(id, array['owner', 'collaborator', 'researcher']));
create policy studies_insert on public.studies for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and status = 'draft'
    and private.owns_product(product_id)
  );
create policy studies_update on public.studies for update to authenticated
  using (owner_id = (select auth.uid()) or private.can_work(id))
  with check (owner_id = (select auth.uid()) or private.can_work(id));
create policy studies_delete_draft on public.studies for delete to authenticated
  using (owner_id = (select auth.uid()) and status = 'draft');

create policy study_members_select on public.study_members for select to authenticated
  using (private.has_role(study_id, array['owner', 'collaborator', 'researcher']));
create policy study_members_insert on public.study_members for insert to authenticated
  with check (private.has_role(study_id, array['owner']) and role <> 'owner');
create policy study_members_delete on public.study_members for delete to authenticated
  using (private.has_role(study_id, array['owner']) and role <> 'owner');

create policy study_versions_select on public.study_versions for select to authenticated
  using (private.has_role(study_id, array['owner', 'collaborator', 'researcher']));
-- Creators choose the baseline while drafting. Variants are added by the
-- backend only after the fixed checks pass.
create policy study_versions_insert_baseline on public.study_versions for insert to authenticated
  with check (
    role = 'baseline' and private.can_work(study_id)
    and exists (select 1 from public.studies s where s.id = study_id and s.status = 'draft')
    and private.can_see_version(version_id)
  );

-- ---------------------------------------------------------------------------
-- Bounties, invitations, assignments, deliveries
-- ---------------------------------------------------------------------------
create policy bounties_select on public.bounties for select to authenticated
  using (private.has_role(study_id, array['owner', 'collaborator', 'researcher']));
create policy bounties_insert on public.bounties for insert to authenticated
  with check (private.can_work(study_id));
create policy bounties_update on public.bounties for update to authenticated
  using (private.can_work(study_id)) with check (private.can_work(study_id));

create policy invitations_select on public.invitations for select to authenticated
  using (private.can_work(study_id));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (private.can_work(study_id) and created_by = (select auth.uid()));
create policy invitations_update on public.invitations for update to authenticated
  using (private.can_work(study_id)) with check (private.can_work(study_id));

create policy assignments_select on public.assignments for select to authenticated
  using (private.can_work(study_id));

create policy deliveries_select on public.deliveries for select to authenticated
  using (private.can_work(study_id));
create policy deliveries_review on public.deliveries for update to authenticated
  using (private.can_work(study_id)) with check (private.can_work(study_id) and reviewed_by = (select auth.uid()));

create or replace function private.deliveries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_worker() then return new; end if;
  if new.assignment_id <> old.assignment_id or new.phase <> old.phase or new.auto_checks <> old.auto_checks
     or new.created_at <> old.created_at or new.study_id <> old.study_id then
    raise exception 'Only the evaluation of the submission can be recorded' using errcode = 'P0001';
  end if;
  new.reviewed_at := now();
  return new;
end;
$$;

create trigger deliveries_guard
  before update on public.deliveries
  for each row execute function private.deliveries_guard();

-- ---------------------------------------------------------------------------
-- Original material: creators only (not researchers)
-- ---------------------------------------------------------------------------
create policy sessions_select on public.sessions for select to authenticated using (private.can_work(study_id));
create policy recordings_select on public.recordings for select to authenticated using (private.can_work(study_id));
create policy game_events_select on public.game_events for select to authenticated using (private.can_work(study_id));
create policy feedback_select on public.feedback for select to authenticated using (private.can_work(study_id));
create policy consent_select on public.consent_records for select to authenticated using (private.can_work(study_id));
create policy consent_creator_insert on public.consent_records for insert to authenticated
  with check (subject = 'creator' and user_id = (select auth.uid()) and private.has_role(study_id, array['owner']));

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------
create policy analysis_runs_select on public.analysis_runs for select to authenticated using (private.can_work(study_id));
create policy evidence_select on public.evidence for select to authenticated using (private.can_work(study_id));
-- Creators can add their own findings (origin = human), with sources.
create policy evidence_insert_human on public.evidence for insert to authenticated
  with check (private.can_work(study_id) and origin = 'human' and created_by = (select auth.uid()) and analysis_run_id is null and agent_submission_id is null);
create policy evidence_sources_select on public.evidence_sources for select to authenticated
  using (exists (select 1 from public.evidence e where e.id = evidence_id and private.can_work(e.study_id)));
create policy evidence_sources_insert_human on public.evidence_sources for insert to authenticated
  with check (exists (select 1 from public.evidence e where e.id = evidence_id and e.origin = 'human' and e.created_by = (select auth.uid()) and private.can_work(e.study_id)));
create policy evidence_reviews_select on public.evidence_reviews for select to authenticated using (private.can_work(study_id));
create policy evidence_reviews_insert on public.evidence_reviews for insert to authenticated
  with check (
    private.can_work(study_id) and reviewer_kind = 'creator' and reviewer_id = (select auth.uid())
    and action in ('confirm', 'correct', 'reject')
    and exists (select 1 from public.evidence e where e.id = evidence_id and e.study_id = evidence_reviews.study_id)
  );

-- ---------------------------------------------------------------------------
-- Agents, interventions, checks, comparisons
-- ---------------------------------------------------------------------------
create policy agent_credentials_select on public.agent_credentials for select to authenticated
  using (created_by = (select auth.uid()) or (study_id is not null and private.can_work(study_id)));
create policy agent_credentials_revoke on public.agent_credentials for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
create policy agent_tool_calls_select on public.agent_tool_calls for select to authenticated
  using ((study_id is not null and private.can_work(study_id))
         or exists (select 1 from public.agent_credentials c where c.id = credential_id and c.created_by = (select auth.uid())));
create policy agent_submissions_select on public.agent_submissions for select to authenticated using (private.can_work(study_id));
create policy interventions_select on public.interventions for select to authenticated using (private.can_work(study_id));
create policy checks_select on public.checks for select to authenticated using (private.has_role(study_id, array['owner', 'collaborator', 'researcher']));
create policy comparisons_select on public.comparisons for select to authenticated using (private.has_role(study_id, array['owner', 'collaborator', 'researcher']));

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create policy jobs_select on public.jobs for select to authenticated using (study_id is not null and private.can_work(study_id));
create policy budget_select on public.budget_entries for select to authenticated using (private.can_work(study_id));
create policy payment_events_select on public.payment_events for select to authenticated using (study_id is not null and private.can_work(study_id));
create policy exports_select on public.dataset_exports for select to authenticated
  using (private.has_role(study_id, array['owner', 'collaborator', 'researcher']));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Budget summary for a study (respects RLS of the caller).
create or replace function public.study_budget(p_study uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  with s as (
    select budget_cap_cents, client_contribution_cents, tester_payment_cents, agent_reward_cents,
           analysis_estimate_cents, operation_estimate_cents, participants_target
    from public.studies where id = p_study
  ), e as (
    select kind, coalesce(sum(amount_cents), 0)::bigint as total
    from public.budget_entries where study_id = p_study group by kind
  ), t as (
    select
      coalesce((select total from e where kind = 'contribution'), 0) as contribution,
      coalesce((select total from e where kind = 'reservation'), 0) - coalesce((select total from e where kind = 'release'), 0) as reserved,
      coalesce((select total from e where kind = 'payout'), 0) as paid,
      coalesce((select total from e where kind = 'agent_reward'), 0) as agent_rewards,
      coalesce((select total from e where kind = 'analysis_cost'), 0) as analysis,
      coalesce((select total from e where kind = 'operation_cost'), 0) as operation
  )
  select jsonb_build_object(
    'cap', s.budget_cap_cents,
    'reserved', t.reserved,
    'paid', t.paid,
    'agent_rewards', t.agent_rewards,
    'analysis', t.analysis,
    'operation', t.operation,
    'committed', t.reserved + t.paid + t.agent_rewards + t.analysis + t.operation,
    'remaining', s.budget_cap_cents - (t.reserved + t.paid + t.agent_rewards + t.analysis + t.operation),
    'contribution_recorded', t.contribution,
    'contribution_planned', s.client_contribution_cents,
    'subsidy_required', greatest(0, (t.reserved + t.paid + t.agent_rewards + t.analysis + t.operation) - greatest(t.contribution, 0)),
    'planned', jsonb_build_object(
      'testers', s.tester_payment_cents * s.participants_target,
      'agent_rewards', s.agent_reward_cents,
      'analysis', s.analysis_estimate_cents,
      'operation', s.operation_estimate_cents,
      'contribution', s.client_contribution_cents,
      'subsidy', greatest(0, s.tester_payment_cents * s.participants_target + s.agent_reward_cents + s.analysis_estimate_cents + s.operation_estimate_cents - s.client_contribution_cents)
    ),
    'test_mode', true
  )
  from s, t
$$;
revoke execute on function public.study_budget(uuid) from public, anon;
grant execute on function public.study_budget(uuid) to authenticated, service_role;

-- Atomic reservation under the study cap. Backend only.
create or replace function public.reserve_budget(p_study uuid, p_kind text, p_amount integer, p_key text,
  p_assignment uuid default null, p_delivery uuid default null, p_submission uuid default null, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer;
  v_committed bigint;
  v_existing uuid;
begin
  if not private.is_worker() then
    raise exception 'Only the backend reserves budget' using errcode = '42501';
  end if;
  if p_kind not in ('reservation', 'agent_reward', 'analysis_cost', 'operation_cost') then
    raise exception 'Invalid spend type: %', p_kind using errcode = '22023';
  end if;
  select id into v_existing from public.budget_entries where idempotency_key = p_key;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'entry_id', v_existing);
  end if;
  select budget_cap_cents into v_cap from public.studies where id = p_study for update;
  if not found then
    raise exception 'Study does not exist' using errcode = 'P0002';
  end if;
  select coalesce(sum(case kind when 'release' then -amount_cents when 'contribution' then 0 else amount_cents end), 0)
    into v_committed from public.budget_entries where study_id = p_study;
  if v_committed + p_amount > v_cap then
    return jsonb_build_object('ok', false, 'reason', 'budget_exhausted', 'cap', v_cap, 'committed', v_committed, 'requested', p_amount);
  end if;
  insert into public.budget_entries (study_id, kind, amount_cents, assignment_id, delivery_id, submission_id, idempotency_key, note)
  values (p_study, p_kind, p_amount, p_assignment, p_delivery, p_submission, p_key, coalesce(p_note, ''))
  returning id into v_existing;
  return jsonb_build_object('ok', true, 'duplicate', false, 'entry_id', v_existing, 'committed', v_committed + p_amount, 'cap', v_cap);
end;
$$;
revoke execute on function public.reserve_budget(uuid, text, integer, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.reserve_budget(uuid, text, integer, text, uuid, uuid, uuid, text) to authenticated, service_role;

-- Claim the next queued job (SKIP LOCKED). Backend only.
create or replace function public.claim_job(p_kinds text[], p_worker text, p_runner text)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_worker() then
    raise exception 'Only the backend claims jobs' using errcode = '42501';
  end if;
  -- Leases older than 10 minutes are considered abandoned.
  update public.jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         last_error = coalesce(last_error, '') || case when last_error is null then '' else E'\n' end || 'Lease vencido: el trabajo se reintenta',
         locked_at = null, locked_by = null,
         finished_at = case when attempts >= max_attempts then now() else null end
   where status = 'running' and locked_at < now() - interval '10 minutes';

  return query
  update public.jobs j
     set status = 'running', attempts = j.attempts + 1, locked_at = now(), locked_by = p_worker,
         runner = p_runner, started_at = coalesce(j.started_at, now())
   where j.id = (
     select id from public.jobs
      where status = 'queued' and kind = any (p_kinds) and run_after <= now()
      order by created_at
      for update skip locked
      limit 1
   )
  returning j.*;
end;
$$;
revoke execute on function public.claim_job(text[], text, text) from public, anon;
grant execute on function public.claim_job(text[], text, text) to authenticated, service_role;

-- Finish a job: success, or failure with retry/backoff while attempts remain.
create or replace function public.finish_job(p_job uuid, p_ok boolean, p_result jsonb, p_error text)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
begin
  if not private.is_worker() then
    raise exception 'Only the backend finishes jobs' using errcode = '42501';
  end if;
  update public.jobs
     set status = case when p_ok then 'succeeded' when attempts >= max_attempts then 'failed' else 'queued' end,
         result = coalesce(p_result, result),
         last_error = case when p_ok then last_error else p_error end,
         run_after = case when p_ok then run_after else now() + make_interval(secs => least(300, 15 * power(2, attempts)::int)) end,
         finished_at = case when p_ok or attempts >= max_attempts then now() else null end,
         locked_at = null, locked_by = null
   where id = p_job
  returning * into j;
  return j;
end;
$$;
revoke execute on function public.finish_job(uuid, boolean, jsonb, text) from public, anon;
grant execute on function public.finish_job(uuid, boolean, jsonb, text) to authenticated, service_role;

-- Nothing else in public is callable by anon.
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

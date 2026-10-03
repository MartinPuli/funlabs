-- FUNLABS core schema.
-- Every study links: version A -> prediction -> human experience -> evidence
-- -> intervention -> version B -> preferences, with consent and budget.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------

-- The backend acts through a dedicated user whose app_metadata marks it as the
-- worker. app_metadata cannot be changed by the user, only by the service role
-- or SQL. Agents and testers never receive this identity.
create or replace function private.is_worker()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'funlabs_role') = 'worker', false)
      or coalesce(auth.role() = 'service_role', false)
$$;

create or replace function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: it cannot be modified or deleted', tg_table_name using errcode = 'P0001';
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, 'persona'), '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Products and immutable versions
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null check (char_length(name) between 2 and 120),
  description text not null default '',
  kind text not null default 'web_game' check (kind in ('web_game', 'web_experience')),
  -- Spending policy set by the budget holder. An agent can publish paid work
  -- only inside this policy; otherwise publishing requires explicit approval.
  spending_policy jsonb not null default '{"agent_can_publish": false, "max_budget_cents": 0}'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 40),
  parent_version_id uuid references public.versions (id),
  status text not null default 'ready' check (status in ('checking', 'ready', 'rejected')),
  origin text not null check (origin in ('repository', 'agent_intervention', 'upload')),
  entry_path text not null default 'index.html',
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer not null check (bytes > 0),
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (product_id, content_sha256)
);
create index versions_product_idx on public.versions (product_id);

create table public.version_files (
  version_id uuid not null references public.versions (id) on delete cascade,
  path text not null,
  content text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer not null,
  primary key (version_id, path)
);

create trigger version_files_append_only
  before update on public.version_files
  for each row execute function private.forbid_change();

create or replace function private.versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content_sha256 <> old.content_sha256
     or new.product_id <> old.product_id
     or new.parent_version_id is distinct from old.parent_version_id
     or new.origin <> old.origin
     or new.bytes <> old.bytes
     or new.entry_path <> old.entry_path then
    raise exception 'The content of a version is immutable' using errcode = 'P0001';
  end if;
  if old.status in ('ready', 'rejected') and new.status <> old.status then
    raise exception 'A % version does not change status', old.status using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger versions_guard
  before update on public.versions
  for each row execute function private.versions_guard();

-- Fixed check suites. Frozen before any intervention; hashed; append-only.
create table public.check_suites (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  suite_key text not null,
  suite_version integer not null,
  definition jsonb not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (product_id, sha256)
);

create trigger check_suites_append_only
  before update on public.check_suites
  for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Studies
-- ---------------------------------------------------------------------------

create table public.studies (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 140),
  question text not null check (char_length(question) between 10 and 1000),
  objective text not null check (objective in ('clarity', 'fun', 'challenge', 'pacing', 'controls')),
  objective_detail text not null default '',
  audience text not null check (char_length(audience) between 3 and 500),
  protocol jsonb not null,
  participants_target integer not null check (participants_target between 1 and 50),
  session_minutes integer not null check (session_minutes between 1 and 30),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'collecting', 'analyzing', 'evidence_ready', 'comparing', 'completed', 'archived')),
  currency text not null default 'usd',
  budget_cap_cents integer not null check (budget_cap_cents >= 0),
  tester_payment_cents integer not null check (tester_payment_cents >= 0),
  agent_reward_cents integer not null default 0 check (agent_reward_cents >= 0),
  analysis_estimate_cents integer not null default 0 check (analysis_estimate_cents >= 0),
  operation_estimate_cents integer not null default 0 check (operation_estimate_cents >= 0),
  client_contribution_cents integer not null default 0 check (client_contribution_cents >= 0),
  -- MVP: every payment is test mode. There is no live mode to switch to.
  payments_mode text not null default 'test' check (payments_mode = 'test'),
  creator_research_consent boolean not null default false,
  creator_research_consent_at timestamptz,
  check_suite_id uuid references public.check_suites (id),
  created_via text not null default 'ui' check (created_via in ('ui', 'agent_api', 'seed')),
  is_rehearsal boolean not null default false,
  published_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index studies_product_idx on public.studies (product_id);
create index studies_owner_idx on public.studies (owner_id);

create trigger studies_touch
  before update on public.studies
  for each row execute function private.touch_updated_at();

create table public.study_members (
  study_id uuid not null references public.studies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'collaborator', 'researcher')),
  created_at timestamptz not null default now(),
  primary key (study_id, user_id)
);
create index study_members_user_idx on public.study_members (user_id);

create or replace function private.add_owner_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.study_members (study_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (study_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

create trigger studies_add_owner
  after insert on public.studies
  for each row execute function private.add_owner_member();

-- Role check used by policies. Security definer avoids policy recursion.
create or replace function private.has_role(p_study uuid, p_roles text[])
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.study_members m
    where m.study_id = p_study and m.user_id = (select auth.uid()) and m.role = any (p_roles)
  )
$$;

create or replace function private.can_work(p_study uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.has_role(p_study, array['owner', 'collaborator'])
$$;

-- The objective and protocol are fixed before collecting data. After
-- publication a creator may only rename the study or change their research
-- consent; status transitions are made by the backend.
create or replace function private.studies_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_worker() then
    if old.check_suite_id is not null and new.check_suite_id is distinct from old.check_suite_id then
      raise exception 'The check suite is already fixed' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.owner_id <> old.owner_id or new.product_id <> old.product_id then
    raise exception 'The owner and the product cannot be changed' using errcode = 'P0001';
  end if;
  if new.status <> old.status or new.check_suite_id is distinct from old.check_suite_id
     or new.published_at is distinct from old.published_at or new.is_rehearsal <> old.is_rehearsal
     or new.created_via <> old.created_via then
    raise exception 'These fields are managed by FUNLABS' using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and (
       new.question <> old.question or new.objective <> old.objective or new.objective_detail <> old.objective_detail
       or new.audience <> old.audience or new.protocol <> old.protocol or new.participants_target <> old.participants_target
       or new.session_minutes <> old.session_minutes or new.budget_cap_cents <> old.budget_cap_cents
       or new.tester_payment_cents <> old.tester_payment_cents or new.agent_reward_cents <> old.agent_reward_cents
       or new.client_contribution_cents <> old.client_contribution_cents) then
    raise exception 'The question, objective, protocol and budget are fixed when published' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger studies_guard
  before update on public.studies
  for each row execute function private.studies_guard();

create table public.study_versions (
  study_id uuid not null references public.studies (id) on delete cascade,
  version_id uuid not null references public.versions (id) on delete restrict,
  role text not null check (role in ('baseline', 'variant')),
  added_at timestamptz not null default now(),
  primary key (study_id, version_id)
);
create unique index study_versions_one_baseline on public.study_versions (study_id) where role = 'baseline';

-- ---------------------------------------------------------------------------
-- Bounties, invitations, assignments, deliveries
-- ---------------------------------------------------------------------------

create table public.bounties (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  kind text not null check (kind in ('human_playtest', 'agent_prediction', 'agent_analysis', 'agent_intervention')),
  title text not null check (char_length(title) between 3 and 140),
  instructions text not null,
  deliverable text not null,
  criteria jsonb not null check (jsonb_typeof(criteria) = 'array'),
  reward_cents integer not null default 0 check (reward_cents >= 0),
  slots integer not null default 1 check (slots between 1 and 100),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_at timestamptz not null default now()
);
create index bounties_study_idx on public.bounties (study_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  bounty_id uuid not null references public.bounties (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint text not null,
  label text not null default '',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index invitations_study_idx on public.invitations (study_id);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  bounty_id uuid not null references public.bounties (id) on delete cascade,
  invitation_id uuid not null unique references public.invitations (id) on delete cascade,
  participant_code text not null,
  status text not null default 'accepted' check (status in ('accepted', 'active', 'withdrawn', 'expired')),
  -- Parity used to alternate the order of A/B in the comparison.
  order_seed integer not null default 0 check (order_seed in (0, 1)),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (study_id, participant_code)
);
create index assignments_study_idx on public.assignments (study_id);

-- Each phase a participant completes is a delivery that is evaluated on its
-- own. Validity never depends on whether the person liked the experience.
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  phase text not null check (phase in ('playtest', 'comparison')),
  status text not null default 'submitted' check (status in ('submitted', 'valid', 'invalid')),
  auto_checks jsonb not null default '{}'::jsonb,
  note text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (assignment_id, phase)
);
create index deliveries_study_idx on public.deliveries (study_id);

-- ---------------------------------------------------------------------------
-- Original material
-- ---------------------------------------------------------------------------

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  version_id uuid not null references public.versions (id),
  phase text not null check (phase in ('playtest', 'comparison')),
  position integer not null default 1 check (position between 1 and 4),
  neutral_label text not null,
  status text not null default 'started' check (status in ('started', 'recorded', 'submitted', 'abandoned', 'failed')),
  capture jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (assignment_id, phase, position)
);
create index sessions_study_idx on public.sessions (study_id);

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  session_id uuid not null unique references public.sessions (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  bytes bigint check (bytes is null or bytes >= 0),
  duration_ms integer check (duration_ms is null or duration_ms > 0),
  has_audio boolean not null default false,
  method text not null check (method in ('tab_capture', 'window_capture', 'screen_capture', 'manual_upload')),
  status text not null default 'pending' check (status in ('pending', 'uploaded', 'verified', 'failed')),
  verify_note text,
  sha256 text,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  verified_at timestamptz
);
create index recordings_study_idx on public.recordings (study_id);

create table public.game_events (
  id bigint generated always as identity primary key,
  study_id uuid not null references public.studies (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  seq integer not null check (seq >= 0),
  t_ms integer not null check (t_ms >= 0),
  type text not null check (char_length(type) <= 40),
  payload jsonb not null default '{}'::jsonb,
  -- 'recording': timestamp measured on the same clock as the recording.
  -- 'session': measured from session start without a recording.
  clock text not null default 'recording' check (clock in ('recording', 'session')),
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);
create index game_events_session_idx on public.game_events (session_id, t_ms);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  kind text not null check (kind in ('moment', 'answer')),
  t_ms integer check (t_ms is null or t_ms >= 0),
  question_key text,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index feedback_session_idx on public.feedback (session_id);

create trigger feedback_append_only
  before update on public.feedback
  for each row execute function private.forbid_change();

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  subject text not null check (subject in ('participant', 'creator')),
  purpose text not null check (purpose in ('participation_recording', 'research_sharing', 'model_training')),
  granted boolean not null,
  text_version text not null,
  created_at timestamptz not null default now(),
  check ((subject = 'participant' and assignment_id is not null) or (subject = 'creator' and user_id is not null))
);
create index consent_study_idx on public.consent_records (study_id);

create trigger consent_append_only
  before update on public.consent_records
  for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  job_id uuid,
  provider text not null,
  model text not null,
  prompt_version text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  input_summary jsonb not null default '{}'::jsonb,
  raw_output jsonb,
  validation jsonb,
  usage jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index analysis_runs_session_idx on public.analysis_runs (session_id);

create table public.agent_credentials (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  study_id uuid references public.studies (id) on delete cascade,
  bounty_id uuid references public.bounties (id) on delete cascade,
  kind text not null check (kind in ('creator_agent', 'participant_agent')),
  label text not null check (char_length(label) between 2 and 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint text not null,
  capabilities text[] not null check (cardinality(capabilities) > 0),
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  -- First time this credential received human comparison results.
  labels_seen_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind = 'creator_agent' or bounty_id is not null)
);
create index agent_credentials_product_idx on public.agent_credentials (product_id);

create table public.agent_submissions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  bounty_id uuid references public.bounties (id) on delete set null,
  credential_id uuid references public.agent_credentials (id) on delete set null,
  actor text not null,
  kind text not null check (kind in ('prediction', 'analysis', 'intervention')),
  input_version_ids uuid[] not null default '{}',
  payload jsonb not null,
  evidence_refs uuid[] not null default '{}',
  -- A prediction made after its author saw human results is a retrospective
  -- analysis and never counts as a prediction.
  is_retrospective boolean not null default false,
  results_existed boolean not null default false,
  status text not null default 'received' check (status in ('received', 'evaluated', 'rejected')),
  evaluation jsonb,
  evaluated_at timestamptz,
  created_at timestamptz not null default now()
);
create index agent_submissions_study_idx on public.agent_submissions (study_id);

create or replace function private.submissions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at <> old.created_at or new.payload <> old.payload or new.kind <> old.kind
     or new.is_retrospective <> old.is_retrospective or new.results_existed <> old.results_existed
     or new.study_id <> old.study_id or new.credential_id is distinct from old.credential_id then
    raise exception 'An agent submission is timestamped and is not rewritten' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger agent_submissions_guard
  before update on public.agent_submissions
  for each row execute function private.submissions_guard();

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  version_id uuid not null references public.versions (id),
  session_id uuid not null references public.sessions (id) on delete cascade,
  origin text not null check (origin in ('model', 'human', 'agent')),
  analysis_run_id uuid references public.analysis_runs (id) on delete set null,
  agent_submission_id uuid references public.agent_submissions (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  interval_start_ms integer not null check (interval_start_ms >= 0),
  interval_end_ms integer not null,
  observation text not null check (char_length(observation) between 3 and 2000),
  -- Verbatim copy of a feedback item; never generated text.
  human_statement text,
  human_statement_feedback_id uuid references public.feedback (id) on delete set null,
  hypothesis text,
  alternative text,
  next_test text,
  category text not null default 'other' check (category in ('clarity', 'difficulty', 'enjoyment', 'controls', 'pacing', 'bug', 'other')),
  preserve boolean not null default false,
  structural_status text not null check (structural_status in ('verified', 'partial', 'unsupported')),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'confirmed', 'corrected', 'rejected')),
  current jsonb,
  generated_by jsonb,
  created_at timestamptz not null default now(),
  check (interval_end_ms > interval_start_ms)
);
create index evidence_study_idx on public.evidence (study_id);
create index evidence_session_idx on public.evidence (session_id);

-- A human statement is always a verbatim copy of a feedback item from the same
-- session. Whatever text the caller sends is replaced by the stored comment.
create or replace function private.evidence_statement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fb record;
begin
  if new.human_statement_feedback_id is null then
    if new.human_statement is not null then
      raise exception 'A human statement needs the comment that supports it' using errcode = 'P0001';
    end if;
    return new;
  end if;
  select body, session_id, assignment_id, study_id into fb from public.feedback where id = new.human_statement_feedback_id;
  if not found or fb.study_id <> new.study_id then
    raise exception 'The cited comment does not belong to this study' using errcode = 'P0001';
  end if;
  if fb.session_id is not null and fb.session_id <> new.session_id then
    raise exception 'The cited comment belongs to another session' using errcode = 'P0001';
  end if;
  new.human_statement := fb.body;
  return new;
end;
$$;

create trigger evidence_statement
  before insert on public.evidence
  for each row execute function private.evidence_statement();

create table public.evidence_sources (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.evidence (id) on delete cascade,
  kind text not null check (kind in ('recording', 'game_event', 'feedback')),
  source_id text not null,
  t_ms integer,
  verified boolean not null,
  note text
);
create index evidence_sources_evidence_idx on public.evidence_sources (evidence_id);

create table public.evidence_reviews (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.evidence (id) on delete cascade,
  study_id uuid not null references public.studies (id) on delete cascade,
  reviewer_id uuid references auth.users (id) on delete set null,
  reviewer_kind text not null check (reviewer_kind in ('creator', 'participant')),
  assignment_id uuid references public.assignments (id) on delete set null,
  action text not null check (action in ('confirm', 'correct', 'reject', 'participant_note')),
  note text,
  corrected jsonb,
  created_at timestamptz not null default now()
);
create index evidence_reviews_evidence_idx on public.evidence_reviews (evidence_id);

create trigger evidence_reviews_append_only
  before update on public.evidence_reviews
  for each row execute function private.forbid_change();

-- The evidence row keeps the original finding. Reviews are history; the row
-- only tracks the latest review state and an overlay of corrected fields.
create or replace function private.apply_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action = 'confirm' then
    update public.evidence set review_status = 'confirmed' where id = new.evidence_id;
  elsif new.action = 'reject' then
    update public.evidence set review_status = 'rejected' where id = new.evidence_id;
  elsif new.action = 'correct' then
    update public.evidence set review_status = 'corrected', current = coalesce(current, '{}'::jsonb) || coalesce(new.corrected, '{}'::jsonb)
    where id = new.evidence_id;
  end if;
  return new;
end;
$$;

create trigger evidence_reviews_apply
  after insert on public.evidence_reviews
  for each row execute function private.apply_review();

create or replace function private.evidence_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.observation <> old.observation or new.interval_start_ms <> old.interval_start_ms
     or new.interval_end_ms <> old.interval_end_ms or new.human_statement is distinct from old.human_statement
     or new.hypothesis is distinct from old.hypothesis or new.origin <> old.origin
     or new.structural_status <> old.structural_status or new.session_id <> old.session_id then
    raise exception 'A finding is not rewritten: record a review' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger evidence_guard
  before update on public.evidence
  for each row execute function private.evidence_guard();

-- ---------------------------------------------------------------------------
-- Agent activity, interventions, checks, comparisons
-- ---------------------------------------------------------------------------

create table public.agent_tool_calls (
  id bigint generated always as identity primary key,
  credential_id uuid not null references public.agent_credentials (id) on delete cascade,
  study_id uuid references public.studies (id) on delete cascade,
  tool text not null,
  transport text not null check (transport in ('rest', 'mcp')),
  input jsonb not null default '{}'::jsonb,
  output_summary jsonb not null default '{}'::jsonb,
  status text not null check (status in ('ok', 'error', 'denied')),
  error_code text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index agent_tool_calls_credential_idx on public.agent_tool_calls (credential_id, created_at desc);
create index agent_tool_calls_study_idx on public.agent_tool_calls (study_id, created_at desc);

create trigger agent_tool_calls_append_only
  before update on public.agent_tool_calls
  for each row execute function private.forbid_change();

create table public.interventions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  base_version_id uuid not null references public.versions (id),
  result_version_id uuid references public.versions (id),
  submission_id uuid references public.agent_submissions (id) on delete set null,
  actor text not null,
  objective text not null,
  summary text not null,
  rationale text not null,
  preserve text not null default '',
  evidence_ids uuid[] not null default '{}',
  edits jsonb not null,
  diff text,
  model jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'rejected', 'checking', 'checks_failed', 'ready')),
  errors jsonb,
  created_at timestamptz not null default now()
);
create index interventions_study_idx on public.interventions (study_id);

create table public.checks (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  version_id uuid not null references public.versions (id) on delete cascade,
  suite_id uuid not null references public.check_suites (id),
  job_id uuid,
  runner text not null,
  check_key text not null,
  label text not null,
  status text not null check (status in ('passed', 'failed', 'error', 'skipped')),
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);
create index checks_version_idx on public.checks (version_id, created_at desc);

create trigger checks_append_only
  before update on public.checks
  for each row execute function private.forbid_change();

create table public.comparisons (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  assignment_id uuid not null unique references public.assignments (id) on delete cascade,
  first_version_id uuid not null references public.versions (id),
  second_version_id uuid not null references public.versions (id),
  first_label text not null,
  second_label text not null,
  choice text not null check (choice in ('first', 'second', 'none')),
  preferred_version_id uuid references public.versions (id),
  reason text not null check (char_length(reason) between 1 and 2000),
  prior_exposure boolean not null,
  created_at timestamptz not null default now(),
  check (first_version_id <> second_version_id),
  check ((choice = 'none') = (preferred_version_id is null))
);
create index comparisons_study_idx on public.comparisons (study_id);

create trigger comparisons_append_only
  before update on public.comparisons
  for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Jobs, budget, payments, exports
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  study_id uuid references public.studies (id) on delete cascade,
  kind text not null check (kind in ('analyze_session', 'run_checks', 'intervention', 'export_dataset')),
  idempotency_key text not null unique,
  input jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  runner text,
  last_error text,
  result jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index jobs_queue_idx on public.jobs (status, run_after) where status = 'queued';
create index jobs_study_idx on public.jobs (study_id, created_at desc);

create trigger jobs_touch
  before update on public.jobs
  for each row execute function private.touch_updated_at();

create table public.budget_entries (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  kind text not null check (kind in ('contribution', 'reservation', 'release', 'payout', 'agent_reward', 'analysis_cost', 'operation_cost')),
  amount_cents integer not null check (amount_cents >= 0),
  assignment_id uuid references public.assignments (id) on delete set null,
  delivery_id uuid references public.deliveries (id) on delete set null,
  submission_id uuid references public.agent_submissions (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  idempotency_key text not null unique,
  note text not null default '',
  test_mode boolean not null default true check (test_mode),
  created_at timestamptz not null default now()
);
create index budget_entries_study_idx on public.budget_entries (study_id);

create trigger budget_entries_append_only
  before update on public.budget_entries
  for each row execute function private.forbid_change();

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  study_id uuid references public.studies (id) on delete set null,
  provider text not null check (provider in ('stripe', 'internal')),
  event_type text not null,
  external_id text unique,
  livemode boolean not null default false check (not livemode),
  signature_verified boolean not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table public.dataset_exports (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  requested_via text not null default 'ui' check (requested_via in ('ui', 'agent_api')),
  purpose text not null check (char_length(purpose) between 5 and 500),
  fields text[] not null,
  format text not null default 'json' check (format in ('json', 'jsonl')),
  include_raw_media boolean not null default false,
  status text not null default 'preparing' check (status in ('blocked', 'preparing', 'ready', 'failed', 'expired')),
  blocked_reason text,
  storage_path text,
  manifest jsonb,
  item_count integer,
  excluded jsonb,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  expires_at timestamptz
);
create index dataset_exports_study_idx on public.dataset_exports (study_id);

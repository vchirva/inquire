-- =============================================================================
-- Inquire — initial schema migration
-- =============================================================================
-- Run this in Supabase SQL editor (or via supabase CLI).
-- All tables have Row Level Security enabled and explicit policies.
-- =============================================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- =============================================================================
-- ENUMS
-- =============================================================================

create type user_role as enum ('admin', 'client');

create type questionnaire_status as enum ('draft', 'live', 'closed');

create type question_type as enum (
  'single_choice',
  'multi_choice',
  'text',
  'rating',
  'date',
  'ranking'
);

create type link_group_status as enum ('open', 'closed');

create type session_status as enum ('in_progress', 'submitted');

-- =============================================================================
-- PROFILES — extends auth.users with role + metadata
-- =============================================================================
-- Each row in auth.users (Supabase Auth) gets a matching profile row.
-- Created automatically via trigger when a new user signs up.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'client',
  full_name text,
  client_id uuid,  -- FK added below after clients table exists
  created_at timestamptz not null default now()
);

create index profiles_client_id_idx on profiles(client_id);

-- =============================================================================
-- CLIENTS — Sigma's customer organizations
-- =============================================================================

create table clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  contact_email text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- Add the FK from profiles → clients
alter table profiles
  add constraint profiles_client_id_fkey
  foreign key (client_id) references clients(id) on delete set null;

-- =============================================================================
-- CLIENT REGISTRATION INVITES — tokens admin generates so client can sign up
-- =============================================================================

create table client_registration_invites (
  token uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,
  email text not null,
  used_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index registration_invites_email_idx on client_registration_invites(email);

-- =============================================================================
-- TAGS — free-form labels
-- =============================================================================

create table tags (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- QUESTIONNAIRES
-- =============================================================================

create table questionnaires (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  status questionnaire_status not null default 'draft',
  parent_id uuid references questionnaires(id) on delete set null,  -- "build from existing"
  locked_at timestamptz,  -- set when first invitation is generated; questions can't change after this
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index questionnaires_status_idx on questionnaires(status);
create index questionnaires_created_by_idx on questionnaires(created_by);

-- =============================================================================
-- QUESTIONNAIRE ↔ CLIENT (many-to-many)
-- =============================================================================
-- Same questionnaire can be assigned to multiple clients.

create table questionnaire_clients (
  questionnaire_id uuid not null references questionnaires(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  primary key (questionnaire_id, client_id)
);

create index questionnaire_clients_client_idx on questionnaire_clients(client_id);

-- =============================================================================
-- QUESTIONNAIRE ↔ TAG (many-to-many)
-- =============================================================================

create table questionnaire_tags (
  questionnaire_id uuid not null references questionnaires(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (questionnaire_id, tag_id)
);

create index questionnaire_tags_tag_idx on questionnaire_tags(tag_id);

-- =============================================================================
-- QUESTIONS
-- =============================================================================

create table questions (
  id uuid primary key default uuid_generate_v4(),
  questionnaire_id uuid not null references questionnaires(id) on delete cascade,
  order_index int not null,
  type question_type not null,
  text text not null,
  required boolean not null default false,

  -- For single_choice / multi_choice / ranking: array of option strings
  -- For rating: { "min": 1, "max": 5, "min_label": "Poor", "max_label": "Excellent" }
  -- For date / text: null
  options jsonb,

  -- Single-condition show rule. null = always show.
  -- Shape: { "question_id": "<uuid>", "operator": "equals" | "not_equals" | "contains", "value": <any> }
  show_if jsonb,

  unique (questionnaire_id, order_index)
);

create index questions_questionnaire_idx on questions(questionnaire_id);

-- =============================================================================
-- LINK GROUPS — Mode C distribution
-- =============================================================================
-- One shareable group URL per questionnaire (per client target).
-- Respondents land here, system auto-claims a fresh response_session.

create table link_groups (
  id uuid primary key default uuid_generate_v4(),
  questionnaire_id uuid not null references questionnaires(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  group_token uuid not null unique default uuid_generate_v4(),  -- this is what goes in the URL
  status link_group_status not null default 'open',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index link_groups_token_idx on link_groups(group_token);
create index link_groups_questionnaire_idx on link_groups(questionnaire_id);
create index link_groups_client_idx on link_groups(client_id);

-- =============================================================================
-- RESPONSE SESSIONS — in-progress + submitted respondent sessions
-- =============================================================================
-- Created when a respondent first opens a group link and the cookie hands them
-- a fresh session_token. Answers are saved as they progress (resume support).
-- On Submit: status flips to 'submitted', responses are finalized.

create table response_sessions (
  id uuid primary key default uuid_generate_v4(),
  session_token uuid not null unique default uuid_generate_v4(),  -- stored in respondent's cookie
  link_group_id uuid not null references link_groups(id) on delete cascade,
  questionnaire_id uuid not null references questionnaires(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  status session_status not null default 'in_progress',
  current_question_index int not null default 0,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  last_activity_at timestamptz not null default now()
);

create index sessions_token_idx on response_sessions(session_token);
create index sessions_link_group_idx on response_sessions(link_group_id);
create index sessions_status_idx on response_sessions(status);

-- =============================================================================
-- RESPONSES — individual answers within a session
-- =============================================================================
-- Append-only. Updated only via upsert (one row per session × question).

create table responses (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references response_sessions(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  answer jsonb,  -- shape depends on question type
  answered_at timestamptz not null default now(),
  unique (session_id, question_id)
);

create index responses_session_idx on responses(session_id);
create index responses_question_idx on responses(question_id);

-- =============================================================================
-- LLM CONFIG — per-admin LLM provider settings (for PDF report enrichment)
-- =============================================================================
-- Optional. If absent, PDF reports use template-only output.

create table llm_configs (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  provider text not null,  -- 'claude' | 'openai' | 'mistral' | 'grok' | 'ollama'
  api_key_encrypted text,  -- encrypted server-side; null for ollama
  base_url text,  -- for ollama / custom endpoints
  model text,  -- e.g. 'claude-opus-4-7', 'gpt-4o', 'llama3'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- TRIGGER: auto-create profile on signup
-- =============================================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into profiles (id, role, full_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'client'),
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =============================================================================
-- HELPER FUNCTIONS — used by RLS and the frontend
-- =============================================================================

-- Returns true if the calling user is an admin
create or replace function is_admin()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Returns the client_id for the calling user (null if admin or unaffiliated)
create or replace function current_client_id()
returns uuid
language sql
stable
security definer
as $$
  select client_id from profiles where id = auth.uid();
$$;

-- =============================================================================
-- RPC: claim_session — called from the respondent's browser
-- =============================================================================
-- Public function. Given a group_token (from URL) and optional cookie session_token,
-- returns/creates an in-progress session.
--
-- - If cookie present and session belongs to this group and is in_progress → resume
-- - Else → create a new session
-- - If group is closed and no existing session → reject

create or replace function claim_session(
  p_group_token uuid,
  p_existing_session_token uuid default null
)
returns table (
  session_token uuid,
  questionnaire_id uuid,
  status session_status,
  current_question_index int
)
language plpgsql
security definer
as $$
declare
  v_group link_groups%rowtype;
  v_session response_sessions%rowtype;
begin
  -- Find the link group
  select * into v_group from link_groups where group_token = p_group_token;
  if not found then
    raise exception 'invalid_group_token';
  end if;

  -- Try to resume existing session
  if p_existing_session_token is not null then
    select * into v_session
    from response_sessions
    where session_token = p_existing_session_token
      and link_group_id = v_group.id
      and status = 'in_progress';

    if found then
      update response_sessions set last_activity_at = now() where id = v_session.id;
      return query select v_session.session_token, v_session.questionnaire_id,
                          v_session.status, v_session.current_question_index;
      return;
    end if;
  end if;

  -- No resume — create new (only if group is open)
  if v_group.status = 'closed' then
    raise exception 'group_closed';
  end if;

  insert into response_sessions (link_group_id, questionnaire_id, client_id)
  values (v_group.id, v_group.questionnaire_id, v_group.client_id)
  returning * into v_session;

  return query select v_session.session_token, v_session.questionnaire_id,
                      v_session.status, v_session.current_question_index;
end;
$$;

-- =============================================================================
-- RPC: save_answer — upsert a single answer for a session
-- =============================================================================

create or replace function save_answer(
  p_session_token uuid,
  p_question_id uuid,
  p_answer jsonb,
  p_current_index int default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_session response_sessions%rowtype;
begin
  select * into v_session
  from response_sessions
  where session_token = p_session_token and status = 'in_progress';

  if not found then
    raise exception 'session_not_found_or_already_submitted';
  end if;

  -- Verify question belongs to this session's questionnaire
  if not exists (
    select 1 from questions
    where id = p_question_id and questionnaire_id = v_session.questionnaire_id
  ) then
    raise exception 'question_not_in_questionnaire';
  end if;

  insert into responses (session_id, question_id, answer)
  values (v_session.id, p_question_id, p_answer)
  on conflict (session_id, question_id)
  do update set answer = excluded.answer, answered_at = now();

  update response_sessions
  set last_activity_at = now(),
      current_question_index = coalesce(p_current_index, current_question_index)
  where id = v_session.id;
end;
$$;

-- =============================================================================
-- RPC: submit_session — finalize a session
-- =============================================================================

create or replace function submit_session(p_session_token uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_session response_sessions%rowtype;
begin
  select * into v_session
  from response_sessions
  where session_token = p_session_token and status = 'in_progress';

  if not found then
    raise exception 'session_not_found_or_already_submitted';
  end if;

  -- Validate required questions are answered
  if exists (
    select 1 from questions q
    where q.questionnaire_id = v_session.questionnaire_id
      and q.required = true
      and not exists (
        select 1 from responses r
        where r.session_id = v_session.id and r.question_id = q.id
      )
  ) then
    raise exception 'required_questions_unanswered';
  end if;

  update response_sessions
  set status = 'submitted',
      submitted_at = now()
  where id = v_session.id;
end;
$$;

-- =============================================================================
-- RPC: register_client_user — consume a registration invite during signup
-- =============================================================================
-- Called from the registration page after Supabase Auth signUp succeeds.

create or replace function register_client_user(p_token uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_invite client_registration_invites%rowtype;
begin
  select * into v_invite
  from client_registration_invites
  where token = p_token and used_at is null and expires_at > now();

  if not found then
    raise exception 'invalid_or_expired_registration_token';
  end if;

  update profiles
  set role = 'client', client_id = v_invite.client_id
  where id = auth.uid();

  update client_registration_invites set used_at = now() where token = p_token;
end;
$$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table profiles enable row level security;
alter table clients enable row level security;
alter table client_registration_invites enable row level security;
alter table tags enable row level security;
alter table questionnaires enable row level security;
alter table questionnaire_clients enable row level security;
alter table questionnaire_tags enable row level security;
alter table questions enable row level security;
alter table link_groups enable row level security;
alter table response_sessions enable row level security;
alter table responses enable row level security;
alter table llm_configs enable row level security;

-- ----- profiles -----
create policy "users read own profile" on profiles
  for select using (id = auth.uid());

create policy "admins read all profiles" on profiles
  for select using (is_admin());

-- ----- clients -----
create policy "admins manage clients" on clients
  for all using (is_admin()) with check (is_admin());

create policy "client users read own client" on clients
  for select using (id = current_client_id());

-- ----- client_registration_invites -----
create policy "admins manage registration invites" on client_registration_invites
  for all using (is_admin()) with check (is_admin());

-- (registration page reads invite via the register_client_user RPC — security definer)

-- ----- tags -----
create policy "admins manage tags" on tags
  for all using (is_admin()) with check (is_admin());

create policy "clients read tags" on tags
  for select using (current_client_id() is not null);

-- ----- questionnaires -----
create policy "admins manage questionnaires" on questionnaires
  for all using (is_admin()) with check (is_admin());

create policy "clients read assigned questionnaires" on questionnaires
  for select using (
    exists (
      select 1 from questionnaire_clients qc
      where qc.questionnaire_id = questionnaires.id
        and qc.client_id = current_client_id()
    )
  );

-- ----- questionnaire_clients -----
create policy "admins manage questionnaire_clients" on questionnaire_clients
  for all using (is_admin()) with check (is_admin());

create policy "clients read own assignments" on questionnaire_clients
  for select using (client_id = current_client_id());

-- ----- questionnaire_tags -----
create policy "admins manage questionnaire_tags" on questionnaire_tags
  for all using (is_admin()) with check (is_admin());

create policy "clients read tags of assigned questionnaires" on questionnaire_tags
  for select using (
    exists (
      select 1 from questionnaire_clients qc
      where qc.questionnaire_id = questionnaire_tags.questionnaire_id
        and qc.client_id = current_client_id()
    )
  );

-- ----- questions -----
create policy "admins manage questions" on questions
  for all using (is_admin()) with check (is_admin());

create policy "clients read questions of assigned questionnaires" on questions
  for select using (
    exists (
      select 1 from questionnaire_clients qc
      where qc.questionnaire_id = questions.questionnaire_id
        and qc.client_id = current_client_id()
    )
  );

-- (respondents access questions through the claim_session RPC, not direct select)

-- ----- link_groups -----
create policy "admins manage link_groups" on link_groups
  for all using (is_admin()) with check (is_admin());

create policy "clients read own link_groups" on link_groups
  for select using (client_id = current_client_id());

-- ----- response_sessions -----
create policy "admins read all sessions" on response_sessions
  for select using (is_admin());

create policy "clients read own sessions" on response_sessions
  for select using (client_id = current_client_id());

-- (respondents interact via RPCs only, no direct policies needed)

-- ----- responses -----
create policy "admins read all responses" on responses
  for select using (is_admin());

create policy "clients read responses for own sessions" on responses
  for select using (
    exists (
      select 1 from response_sessions rs
      where rs.id = responses.session_id
        and rs.client_id = current_client_id()
    )
  );

-- ----- llm_configs -----
create policy "users manage own llm config" on llm_configs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- =============================================================================
-- VIEW: questionnaire_summary — convenience for dashboards
-- =============================================================================

create view questionnaire_summary as
select
  q.id,
  q.title,
  q.status,
  q.created_at,
  (select count(*) from questions where questionnaire_id = q.id) as question_count,
  (select count(*) from response_sessions where questionnaire_id = q.id and status = 'submitted') as submitted_count,
  (select count(*) from response_sessions where questionnaire_id = q.id and status = 'in_progress') as in_progress_count
from questionnaires q;

-- Grant view access to authenticated users; row visibility flows through table RLS
grant select on questionnaire_summary to authenticated;

-- =============================================================================
-- DONE
-- =============================================================================

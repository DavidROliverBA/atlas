-- Atlas multi-user schema (M8). Same logical model as the file format,
-- normalised into tables with jsonb for open-ended attributes.
-- Apply with: supabase db push  (or psql -f schema.sql)

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  format_version int not null default 1,
  stencil_packs jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  primary key (workspace_id, user_id)
);

create table if not exists elements (
  id text primary key check (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('person','system','container','component','group')),
  name text not null,
  parent_id text references elements(id),
  description text,
  documentation text,
  team text,
  status text,
  criticality text,
  technology jsonb,
  owners jsonb,
  tags jsonb,
  links jsonb,
  properties jsonb,
  stencil jsonb,
  temporal jsonb,
  state_overrides jsonb,
  version bigint not null default 1
);

create table if not exists relationships (
  id text primary key check (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_id text not null references elements(id) on delete cascade,
  target_id text not null references elements(id) on delete cascade,
  name text,
  description text,
  direction text,
  technology jsonb,
  tags jsonb,
  properties jsonb,
  temporal jsonb,
  version bigint not null default 1
);

create table if not exists views (
  id text primary key check (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null,
  name text not null,
  scope_id text references elements(id) on delete set null,
  description text,
  render_mode text,
  hidden_relationship_ids jsonb,
  version bigint not null default 1
);

create table if not exists view_placements (
  view_id text not null references views(id) on delete cascade,
  element_id text not null references elements(id) on delete cascade,
  x double precision not null,
  y double precision not null,
  width double precision,
  height double precision,
  primary key (view_id, element_id)
);

create table if not exists states (
  id text primary key check (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  date date,
  description text,
  version bigint not null default 1
);

create index if not exists elements_workspace on elements(workspace_id);
create index if not exists relationships_workspace on relationships(workspace_id);
create index if not exists views_workspace on views(workspace_id);
create index if not exists states_workspace on states(workspace_id);

-- Row Level Security: membership gates everything.
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table elements enable row level security;
alter table relationships enable row level security;
alter table views enable row level security;
alter table view_placements enable row level security;
alter table states enable row level security;

create or replace function is_member(ws uuid, min_role text default 'viewer')
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
      and case min_role
        when 'viewer' then true
        when 'editor' then m.role in ('owner', 'editor')
        when 'owner' then m.role = 'owner'
      end
  );
$$;

create policy workspaces_select on workspaces for select using (is_member(id));
create policy workspaces_update on workspaces for update using (is_member(id, 'owner'));
create policy members_select on workspace_members for select using (is_member(workspace_id));

create policy elements_select on elements for select using (is_member(workspace_id));
create policy elements_write on elements for all using (is_member(workspace_id, 'editor'));
create policy relationships_select on relationships for select using (is_member(workspace_id));
create policy relationships_write on relationships for all using (is_member(workspace_id, 'editor'));
create policy views_select on views for select using (is_member(workspace_id));
create policy views_write on views for all using (is_member(workspace_id, 'editor'));
create policy states_select on states for select using (is_member(workspace_id));
create policy states_write on states for all using (is_member(workspace_id, 'editor'));
create policy placements_select on view_placements for select
  using (exists (select 1 from views v where v.id = view_id and is_member(v.workspace_id)));
create policy placements_write on view_placements for all
  using (exists (select 1 from views v where v.id = view_id and is_member(v.workspace_id, 'editor')));

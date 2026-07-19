-- Atlas multi-user schema (M8). Same logical model as the file format,
-- normalised into tables with jsonb for open-ended attributes.
-- Apply with: supabase db push  (or psql -f schema.sql)

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  format_version int not null default 1,
  stencil_packs jsonb not null default '[]',
  revision bigint not null default 0,
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
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  costs jsonb,
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
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
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
  edge_anchors jsonb,
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

-- Atomic whole-workspace save with optimistic concurrency. The row lock +
-- single transaction closes the read-bump-write race: writers serialise on
-- the workspace row, and a stale expected revision aborts with 40001.
create or replace function atlas_save_workspace(
  p_workspace_id uuid,
  p_expected_revision bigint,
  p_payload jsonb
) returns bigint
language plpgsql
security definer
as $$
declare
  v_rev bigint;
begin
  select revision into v_rev from workspaces where id = p_workspace_id for update;
  if v_rev is null then
    raise exception 'workspace not found';
  end if;
  if p_expected_revision is not null and v_rev <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;

  update workspaces set
    name = coalesce(p_payload->'workspace'->>'name', name),
    description = p_payload->'workspace'->>'description',
    format_version = coalesce((p_payload->'workspace'->>'format_version')::int, 1),
    stencil_packs = coalesce(p_payload->'workspace'->'stencil_packs', '[]'::jsonb),
    revision = v_rev + 1
  where id = p_workspace_id;

  -- Children before parents (FKs), then rebuild from the payload.
  delete from view_placements vp using views v where vp.view_id = v.id and v.workspace_id = p_workspace_id;
  delete from relationships where workspace_id = p_workspace_id;
  delete from views where workspace_id = p_workspace_id;
  delete from states where workspace_id = p_workspace_id;
  delete from elements where workspace_id = p_workspace_id;

  insert into elements (id, workspace_id, kind, name, parent_id, description, documentation, team,
                        status, criticality, technology, owners, tags, links, properties, color,
                        costs, stencil, temporal, state_overrides)
  select r.id, p_workspace_id, r.kind, r.name, r.parent_id, r.description, r.documentation, r.team,
         r.status, r.criticality, r.technology, r.owners, r.tags, r.links, r.properties, r.color,
         r.costs, r.stencil, r.temporal, r.state_overrides
  from jsonb_to_recordset(coalesce(p_payload->'elements', '[]'::jsonb)) as r(
    id text, kind text, name text, parent_id text, description text, documentation text, team text,
    status text, criticality text, technology jsonb, owners jsonb, tags jsonb, links jsonb,
    properties jsonb, color text, costs jsonb, stencil jsonb, temporal jsonb, state_overrides jsonb
  );

  insert into relationships (id, workspace_id, source_id, target_id, name, description, direction,
                             technology, tags, properties, color, temporal)
  select r.id, p_workspace_id, r.source_id, r.target_id, r.name, r.description, r.direction,
         r.technology, r.tags, r.properties, r.color, r.temporal
  from jsonb_to_recordset(coalesce(p_payload->'relationships', '[]'::jsonb)) as r(
    id text, source_id text, target_id text, name text, description text, direction text,
    technology jsonb, tags jsonb, properties jsonb, color text, temporal jsonb
  );

  insert into views (id, workspace_id, kind, name, scope_id, description, render_mode,
                     hidden_relationship_ids, edge_anchors)
  select r.id, p_workspace_id, r.kind, r.name, r.scope_id, r.description, r.render_mode,
         r.hidden_relationship_ids, r.edge_anchors
  from jsonb_to_recordset(coalesce(p_payload->'views', '[]'::jsonb)) as r(
    id text, kind text, name text, scope_id text, description text, render_mode text,
    hidden_relationship_ids jsonb, edge_anchors jsonb
  );

  insert into view_placements (view_id, element_id, x, y, width, height)
  select r.view_id, r.element_id, r.x, r.y, r.width, r.height
  from jsonb_to_recordset(coalesce(p_payload->'placements', '[]'::jsonb)) as r(
    view_id text, element_id text, x double precision, y double precision,
    width double precision, height double precision
  );

  insert into states (id, workspace_id, name, date, description)
  select r.id, p_workspace_id, r.name, r.date, r.description
  from jsonb_to_recordset(coalesce(p_payload->'states', '[]'::jsonb)) as r(
    id text, name text, date date, description text
  );

  return v_rev + 1;
end;
$$;

-- Cost entries for TCO (docs/tco-plan.md phase 1).
alter table elements add column if not exists costs jsonb;

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

-- A save that cannot finish promptly must abort rather than queue behind the
-- workspace row lock indefinitely (prevents pool-starvation pile-ups).
alter function atlas_save_workspace(uuid, bigint, jsonb) set statement_timeout = '10s';
alter function atlas_save_workspace(uuid, bigint, jsonb) set lock_timeout = '8s';

-- SECURITY: re-assert the lock-down from 20260718000008 (CREATE OR REPLACE
-- keeps existing grants, but this migration is the function's source of
-- truth going forward and must not depend on that migration having applied
-- cleanly — the anon key must never reach this security definer function).
revoke execute on function atlas_save_workspace(uuid, bigint, jsonb) from public;
revoke execute on function atlas_save_workspace(uuid, bigint, jsonb) from anon;
revoke execute on function atlas_save_workspace(uuid, bigint, jsonb) from authenticated;
grant execute on function atlas_save_workspace(uuid, bigint, jsonb) to service_role;

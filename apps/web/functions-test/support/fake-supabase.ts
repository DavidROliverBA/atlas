/**
 * Minimal in-memory stand-in for the slice of the Supabase JS client that
 * the model API router (`functions/api/v1/[[path]].ts`) and
 * `@atlas/storage-supabase`'s `SupabaseStorageAdapter` actually call:
 *
 *   db.from(table).select(cols).eq(col, val).single() / .maybeSingle()
 *   db.from(table).upsert(rows)
 *   db.rpc("atlas_save_workspace", { p_workspace_id, p_expected_revision, p_payload })
 *
 * It backs the contract tests so they exercise the real router and the real
 * adapter (no mocking of either) without touching the network. It does not
 * attempt to implement the rest of the SupabaseClient surface (auth,
 * storage, realtime, functions) — nothing under test calls those, and the
 * router talks to Supabase Auth via plain `fetch`, not this client.
 *
 * Modelled on the normalised schema in `packages/storage-supabase` (see
 * `rows.ts`): one flat table per resource, workspace-scoped by
 * `workspace_id` (placements are scoped indirectly via `view_id`, matching
 * the real schema — there's no `workspace_id` column on that table).
 */

export type Row = Record<string, unknown>;

interface PgResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

type Tables = {
  workspaces: Row[];
  elements: Row[];
  relationships: Row[];
  views: Row[];
  view_placements: Row[];
  states: Row[];
};

const emptyTables = (): Tables => ({
  workspaces: [],
  elements: [],
  relationships: [],
  views: [],
  view_placements: [],
  states: [],
});

interface SaveWorkspacePayload {
  workspace: Row;
  elements: Row[];
  relationships: Row[];
  views: Row[];
  placements: Row[];
  states: Row[];
}

/** Chainable, awaitable query builder — mirrors the shape of a PostgrestFilterBuilder closely enough for this router's usage. */
class FakeQueryBuilder implements PromiseLike<PgResult<unknown>> {
  private filters: Array<[string, unknown]> = [];
  private mode: "select" | "upsert" = "select";
  private upsertRows: Row[] = [];
  private singleness: "single" | "maybeSingle" | null = null;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: keyof Tables,
  ) {}

  select(_columns?: string): this {
    this.mode = "select";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  single(): this {
    this.singleness = "single";
    return this;
  }

  maybeSingle(): this {
    this.singleness = "maybeSingle";
    return this;
  }

  upsert(rows: Row[]): this {
    this.mode = "upsert";
    this.upsertRows = rows;
    return this;
  }

  then<TResult1 = PgResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: PgResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<PgResult<unknown>> {
    if (this.mode === "upsert") {
      return this.db.upsert(this.table, this.upsertRows);
    }
    const rows = this.db.select(this.table, this.filters);
    if (this.singleness === "single") {
      if (rows.length === 0) return { data: null, error: { message: "No rows found", code: "PGRST116" } };
      return { data: rows[0]!, error: null };
    }
    if (this.singleness === "maybeSingle") {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }
}

/**
 * In-memory workspace store. One instance per test keeps tests isolated;
 * cast to `SupabaseClient` at the injection site (the one deliberate `as`
 * in this harness — matching the full client interface structurally would
 * mean reimplementing auth/storage/realtime this router never calls).
 */
export class FakeSupabase {
  private tables: Tables = emptyTables();

  from(table: keyof Tables): FakeQueryBuilder {
    return new FakeQueryBuilder(this, table);
  }

  select(table: keyof Tables, filters: Array<[string, unknown]>): Row[] {
    return this.tables[table].filter((row) => filters.every(([col, val]) => row[col] === val));
  }

  upsert(table: keyof Tables, rows: Row[]): PgResult<Row[]> {
    const list = this.tables[table];
    for (const row of rows) {
      const idx = list.findIndex((r) => r.id === row.id);
      if (idx >= 0) list[idx] = { ...list[idx], ...row };
      else list.push({ ...row });
    }
    return { data: rows, error: null };
  }

  async rpc(name: string, params: Record<string, unknown>): Promise<PgResult<null>> {
    if (name !== "atlas_save_workspace") {
      return { data: null, error: { message: `FakeSupabase: unsupported rpc "${name}"` } };
    }
    const workspaceId = params.p_workspace_id as string;
    const expectedRevision = params.p_expected_revision as number | null;
    const payload = params.p_payload as SaveWorkspacePayload;

    const current = this.tables.workspaces.find((r) => r.id === workspaceId);
    const currentRevision = Number(current?.revision ?? 0);
    if (expectedRevision !== null && expectedRevision !== undefined && expectedRevision !== currentRevision) {
      return { data: null, error: { message: "revision_conflict", code: "40001" } };
    }

    const nextRow = { ...payload.workspace, revision: currentRevision + 1 };
    const idx = this.tables.workspaces.findIndex((r) => r.id === workspaceId);
    if (idx >= 0) this.tables.workspaces[idx] = nextRow;
    else this.tables.workspaces.push(nextRow);

    const viewIdsForWorkspace = new Set(
      this.tables.views.filter((r) => r.workspace_id === workspaceId).map((r) => r.id),
    );
    this.tables.elements = [
      ...this.tables.elements.filter((r) => r.workspace_id !== workspaceId),
      ...payload.elements,
    ];
    this.tables.relationships = [
      ...this.tables.relationships.filter((r) => r.workspace_id !== workspaceId),
      ...payload.relationships,
    ];
    this.tables.views = [...this.tables.views.filter((r) => r.workspace_id !== workspaceId), ...payload.views];
    this.tables.view_placements = [
      ...this.tables.view_placements.filter((r) => !viewIdsForWorkspace.has(r.view_id)),
      ...payload.placements,
    ];
    this.tables.states = [...this.tables.states.filter((r) => r.workspace_id !== workspaceId), ...payload.states];

    return { data: null, error: null };
  }
}

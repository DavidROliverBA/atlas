# Atlas — improvement review round 2 (2026-07-19)

Three-seat review (architect · developer/operator · AI consumers), each finding
verified against code or the live deployment. This supersedes the 2026-07-18 review:
every P0 from that round is done, as are its P1 items A.1/A.2/A.4/A.5 (temporal
editing, view management, resize + group re-parenting, ⌘K), D.1/D.3/D.6 (functions
tests/typecheck, bundle slimming, wrangler.toml) and I.1/I.5 (AI delete tools,
read-side API).

## Fixed in this round (2026-07-19 fix wave)

| Finding | Fix |
|---|---|
| Mixed-currency TCO totals were a raw cross-currency sum | Per-currency totals (`EstateTco.byCurrency`) in the drawer, run-rate chip and diff panel; single-currency behaviour unchanged |
| Lint: 3 generic rules, no severity | `severity` on every issue + `unowned-critical`, `agent-without-guardrail`, `estimate-cost-on-live`, `undocumented-system`; duplicate-name chips cycle offenders |
| Compare locked to first-vs-last state; no state ordering | `diff-a`/`diff-b` pickers; `NamedState.order` + ▲▼ reorder |
| TCO always whole-estate | `tco-scope` subtree scoping (`subtreeTco`) |
| AI couldn't set stencils (prompt demanded it) | `stencil` on create/update tools, registry-validated in the planning clone |
| `query_model` blind to stencils/geometry/packs | Summary lists packs; element detail shows stencil ref + attributes + per-view placement coords |
| No relationship update path for AI | `update_relationships` (+ `color` on create) |
| No AI geometry control | x/y/w/h on `place_on_view`, new `move_placement`, `pin_route` for edge anchors |
| No AI TCO read | `get_tco` (estate/subtree, optional two-state diff) |
| No AI state-override authoring | `set_state_override` |
| Chat: no streaming, no persistence, blind to selection, free-text model id | SSE streaming with tool status, localStorage persistence incl. revalidated proposals, `<selected>` context, model dropdown |
| ⌘K searched names only | Tiered scoring over tags/technology/stencil attributes/documentation; relationships searchable |
| Flat views list | Grouped by kind |
| Costs hand-typed only | CSV import with per-row validation |
| No bulk restore endpoint | `POST /workspace` (atomic replace + `?dryRun=1`) |
| No cheap change detection | `ETag`/`x-atlas-revision` + 304s + revision on every mutation |
| OpenAPI imprecision (commands untyped, stencil undocumented, error shapes implicit) | `oneOf` per-command schemas, `stencil` documented, name-resolution error shapes |
| Zero observability in functions | `[observability]` enabled, request ids on every response, structured completion logs, 500s hide internals |
| No rate limiting | Per-token fixed-window limiter (API 120/min, AI 20/min, env-tunable) — best-effort per isolate; dashboard rule documented as backstop |
| Single all-powerful service token | `ATLAS_API_TOKEN_READONLY` tier (GET/HEAD only; AI proxy rejects) |
| AI proxy: no CORS/timeout | OPTIONS + CORS parity, 55s upstream timeout → 504 |
| Swagger UI from unpkg without SRI | Pinned version + real sha384 hashes |
| Outage = repeating toast | Persistent banner after 3 failures + poll backoff (8→30→60s) |
| `view_placements` unscoped by workspace | Migration 20260720000001 (column, backfill, FK, save-function re-create) — **push pending** |
| No CI previews/shards/backups/dependabot | PR preview deploys (secret-gated), 2-way Playwright shards, nightly backup workflow, dependabot |
| No contributor/ops docs | CONTRIBUTING.md + docs/operations.md (secrets inventory + rotation runbooks) |
| CLI: tsx shim, no git diff | esbuild-built `dist/`, `atlas diff --git a..b` |

## Outstanding — needs the owner (cannot be done from the repo)

(none — all closed as of 2026-07-19)

## Closed 2026-07-19

- **`CLOUDFLARE_API_TOKEN` GitHub secret** — DONE. Account-owned token with
  Pages Read+Edit on the BA account; verified against the Pages API before setting the
  secret; CI deploy job ran green end-to-end. CI now deploys `main` automatically —
  manual `pnpm run deploy` is no longer the only path to production.
- **Supabase PITR** — effectively confirmed enabled: WAL archiving on with
  `archive_timeout=120` (the 2-minute WAL-G shipping signature of the PITR add-on).
  Retention window visible only in the dashboard (Database → Backups → Point in Time).

- **`ATLAS_API_TOKEN_READONLY` Pages secret + `ATLAS_BACKUP_TOKEN` GitHub secret** —
  DONE. Same generated value set in both (never written to disk; rotate to a
  password-manager-held value if a plaintext copy is ever needed). Verified end-to-end:
  manual backup-workflow run succeeded and committed a snapshot to the `backups` branch.
- **Cloudflare rate-limiting rule on `/api/*`** — INFEASIBLE as specified: rate rules
  are zone-scoped and the BA account has no zones; `atlas-modelling.pages.dev` sits on
  Cloudflare's own zone. Revisit only if the app moves to a custom domain. The
  in-function limiter is the only rate-limiting layer.
- **`supabase db push` for `20260720000001_placement_workspace.sql`** — DONE; all 11
  migrations confirmed applied via the Supabase MCP (`list_migrations`).

## Deferred — features needing their own design phase

| # | Item | Why deferred |
|---|---|---|
| R2-1 | **Multi-workspace + templates** (A.3) | Touches auth, schema, UI switcher, API scoping; `view_placements` scoping fix has cleared the path |
| R2-2 | **Command-log persistence → history/blame/events/webhooks** (D.5, I.4) | The single foundation for governance, realtime and audit; deserves an ADR |
| R2-3 | **Governance: propose→approve gates for human edits** | Builds on R2-2 |
| R2-4 | **Deployment topology modelling** (environments/regions/instances) | Metamodel extension; decide relationship-type vs environment-group approach first |
| R2-5 | **MCP server** | `commandSchemas` + `POST /commands` are ~ready-made tools; the work is transport + OAuth/token bridging |
| R2-6 | **Element lineage/supersession** | Metamodel addition (`supersedes`), interacts with temporal semantics |
| R2-7 | **Cost value schedules + FX table** (price rises; true multi-currency totals) | CSV import shipped; schedules change the CostEntry shape |
| R2-8 | **Roadmap swimlane view** | New visualisation over validFrom/validTo |
| R2-9 | **Deck-ready multi-view export** (PDF/report) | New export pipeline |
| R2-10 | **Per-item proposal apply + canvas ghosts** (I.6) | Change-set UX redesign |
| R2-11 | **Chat resume-after-cap** (builder state survives the 8-round cap) | Needs a persistent-builder seam in `runChatTurn` |
| R2-12 | **Whole-snapshot save ceiling** (OPS-8) | Solved properly by R2-2's delta saves |
| R2-13 | **Doc-coverage & search depth** (missing-documentation audit view) | Partially covered by `undocumented-system` lint + ⌘K doc search |

Prior P2 hygiene items (accessibility, mobile, PixiJS perf ceiling, File System
Access mode, ArchiMate import depth, legacy anon-key format) carry forward unchanged.

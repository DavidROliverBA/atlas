# Atlas — improvement review (2026-07-18)

An honest assessment of what Atlas needs next, reviewed from three seats: an
**architect** modelling their estate, a **developer** maintaining or integrating with
it, and an **AI agent** (in-app or external) driving it. Every finding was verified
against the code or the live deployment, not assumed.

**What already stands**: model/view separation enforced in core; command bus with
exact-inverse undo everywhere (UI, AI, CLI, API); deterministic git-friendly format
with golden byte-identity tests; four C4 levels with drill; iso mode off the same
scene graph; stencil packs with schema-validated attributes; temporal engine with
diff; connections/lint/matrix analysis; OpenAPI'd REST API where every mutation runs
the same validation; GitHub SSO; 68 unit tests + 76 e2e journeys, all green.

Priorities: **P0** = blocks real adoption or risks data/work · **P1** = the gap an
adopter hits in week one · **P2** = quality/scale improvements.

---

> **Status update (later on 2026-07-18):** 0.2 CI workflow committed (activates on first
> push); 0.3 done (proxy key set, verified end-to-end); 0.4 done (atomic
> `atlas_save_workspace` with row-lock + revision guard + jittered retries, statement/lock
> timeouts, fetch timeouts in functions); 0.5 done (GitHub allow-list on API + AI proxy).
> 0.1 (git remote) remains — the push needs to be run by the owner.
> A.1/A.2 done (temporal editor, states manager, view create/rename/delete).
> **New P0-class finding fixed during the incident:** the security-definer save function
> was EXECUTE-granted to PUBLIC by Postgres default — publicly invocable with the shipped
> anon key, bypassing RLS (now revoked; lesson: audit EXECUTE grants on every
> security-definer function). **Open question:** a sustained ~1.4k req/s PostgREST flood
> of unknown origin was observed during load-testing recovery; check Supabase dashboard
> API logs to attribute it.

## P0 — before anyone else touches it

| # | Finding | Detail |
|---|---|---|
| 0.1 | **The repo has no remote** | The entire codebase exists only on this Mac (`git remote -v` is empty). One disk failure loses everything. Push to GitHub (BA org or personal — decide deliberately, given the hosting is on the BA Cloudflare account). |
| 0.2 | **No CI** | Tests only run when someone remembers. A GitHub Actions workflow running `pnpm -r typecheck && pnpm -r test` + Playwright on PR, and `wrangler pages deploy` on main, closes the gap between "tested locally" and "what's deployed". |
| 0.3 | **Hosted AI chat is non-functional** | `ATLAS_API_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` secrets are set; `ANTHROPIC_API_KEY` is not. Signed-in users get "AI proxy not configured". Either set the key or hide the chat tab until configured. |
| 0.4 | **API concurrency window** | Every mutation is load-whole-workspace → apply → save-whole-workspace with no locking; two concurrent API writes can silently drop one client's change (last write wins across the *entire* snapshot, not per object). The `version` columns exist but are never checked. Fix: optimistic version check on save, or append commands to a log table and materialise. |
| 0.5 | **Authorisation is binary** | Any GitHub account = full write to the single shared workspace; the `workspace_members`/roles tables and all the RLS policies are dead code because the API uses the service-role key. A stranger who finds the URL and signs in with any GitHub account can edit or delete the estate. Minimum: an allow-list check in the API; proper: membership rows + role enforcement. |

## P1 — the first-week gaps

### For architects

| # | Finding | Detail |
|---|---|---|
| A.1 | **No temporal editing in the UI** | The flagship time features (validFrom/validTo, state membership, per-state overrides) can only be set via API or AI — the inspector has no temporal section, and named states can't be created/renamed/deleted in the UI at all. The timeline scrubber shows data you can't author. |
| A.2 | **No "new view" button** | Views are only born via drill-down, AI, or API. An architect cannot create a custom or landscape view, rename a view, set its description, or delete it from the UI. |
| A.3 | **Single shared workspace** | The DB mode hard-wires one workspace. No create/switch/browse workspaces, so two teams (or two initiatives) can't be separated. The API already accepts `workspace_id` — the UI and a workspace-picker are the missing half. |
| A.4 | **Groups are second-class** | No resize handles (the model supports width/height), no drag-into-group re-parenting — membership changes require the AI or API. Boundaries are half of C4 landscape hygiene. |
| A.5 | **No element search** | Beyond ~30 elements, finding things means scrolling the tree. A ⌘K palette (find element → select/jump/place) is the single biggest navigation win. |
| A.6 | **Custom stencil pack import missing** | The pack format and loader exist, but only built-ins register; there's no "import pack" UI, so the extensibility story (brief §3.2) stops at the docs. |
| A.7 | **Collaboration is polling + last-write-wins** | 8s pull with no presence, no conflict surfacing, and local undo history is discarded on every remote sync. Fine for two people taking turns; misleading for simultaneous editing. The realtime broadcast channel in the adapter is written but unused. |
| A.8 | **Iso mode can't be authored or exported** | No drag in iso, and SVG/PNG export always renders the 2D projection. |

### For developers

| # | Finding | Detail |
|---|---|---|
| D.1 | **API functions are untested and untyped in CI** | `functions/` is excluded from `tsc`, has no unit tests (only my one-off curl passes), and duplicates the Supabase URL/anon constants in three files. A contract-test suite hitting `wrangler pages dev` locally would catch regressions the e2e stub can't. |
| D.2 | **No observability** | No structured logs, no request IDs, no error tracking on the Pages Functions; a production 500 is invisible unless a user reports it. |
| D.3 | **Bundle size** | ~750KB main JS chunk (React Flow + elkjs + supabase + Anthropic SDK all eagerly loaded). Lazy-load elkjs (auto-layout), the AI SDK (chat open), and iso view for a much faster first paint. |
| D.4 | **No API rate limiting / abuse controls** | The AI proxy spends your Anthropic budget for any signed-in GitHub user; the model API accepts unbounded writes. Cloudflare rate-limit rules or a per-user quota in the function are cheap insurance. |
| D.5 | **Command history isn't persisted** | The audit trail the command bus makes possible (who changed what, when) is discarded; persisting the command log per workspace would give history, blame, and cheap realtime replay in one move. |
| D.6 | **Deploy reproducibility** | No `wrangler.toml` in the repo — project name/branch live in the `deploy` script and dashboard only. Secrets have no documented rotation path (service token sits in a session scratchpad). |
| D.7 | **CLI not distributable** | `atlas` runs via a tsx shim from the repo; publishing (or bundling) it plus a `--git a..b` diff mode would make the CI story from the brief real. |

### For AI users

| # | Finding | Detail |
|---|---|---|
| I.1 | **In-app AI can create but not destroy** | The tool set has no `delete_elements`/`delete_relationships`/`remove_from_view`, so "remove the legacy mainframe" politely fails. Also missing: place-with-layout control and view deletion. |
| I.2 | **No streaming, no persistence** | Chat turns block silently (no token streaming), conversations vanish on reload, and the 8-iteration tool cap is silent when hit. |
| I.3 | **External agents lack an MCP surface** | The REST API + OpenAPI is good for code; an MCP server wrapping it (tools: query_model, create_elements, …) would let Claude/other agents drive Atlas without bespoke glue. The AI-facing command schema in OpenAPI is `additionalProperties: true` — per-command schemas would let agents self-validate. |
| I.4 | **No events for agents** | Nothing to subscribe to — an agent keeping documentation or reviews in sync has to poll `GET /workspace`. Webhooks or an SSE feed off a persisted command log (D.5) unlocks reactive agents. |
| I.5 | **No read-side analysis via API** | Ego networks, impact traversal, orphan lint, and the Mermaid/SVG exporters are UI/CLI-only. Agents summarising or reviewing an estate want `GET /elements/{id}/connections`, `GET /lint`, `GET /views/{id}/export?format=mermaid`. |
| I.6 | **Change-set preview is a list, not ghosts** | Accepted v1 deviation, but for AI-heavy use the canvas ghost preview (brief §3.7) is what makes large proposals reviewable. |

## P2 — quality and scale

- **Accessibility**: canvas is mouse-only (no keyboard node navigation/move), custom nodes lack ARIA labels, colour choices aren't contrast-checked against the tinted fills.
- **Mobile/tablet**: unusable below ~1100px width (three fixed panels).
- **Performance ceiling**: React Flow DOM nodes cap a single view around ~1k elements (ADR 0003's PixiJS escape hatch remains unexercised); the API's whole-snapshot round trip grows linearly with model size.
- **File mode parity** (brief §3.8A): no File System Access API directory open/save and no zip import/export — only the JSON bundle. CLI covers git workflows, the browser doesn't.
- **ArchiMate import depth**: Composition→containment nesting and Business-layer mapping are still skipped (documented).
- **Anon key style**: Supabase "legacy" JWT keys in use; migrate to the new publishable/secret key format when convenient.
- **UI polish debt**: inspector links/properties editors are minimal; tag editing is a comma string; no dark theme (tag overlays shipped instead); error toasts are the only feedback channel (no success confirmation for API-mode pushes).
- **Docs**: no CONTRIBUTING/setup guide for a second developer; screenshots in README already lag the current UI (no source switcher, minimap, ports).

## Suggested order of attack

1. **0.1 + 0.2** (remote + CI) — an afternoon, removes existential risk.
2. **0.5 + 0.4** (allow-list authz + optimistic versioning) — makes the shared DB trustworthy.
3. **A.1 + A.2** (temporal editing + view management UI) — completes the product's own headline features.
4. **I.1 + 0.3** (AI delete tools + proxy key) — makes the AI genuinely useful hosted.
5. **D.5 → A.7/I.4** (persist command log, then realtime + events fall out of it).
6. **A.5** (⌘K search) — cheap, transformative day-to-day.

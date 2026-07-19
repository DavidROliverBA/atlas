# Atlas model API

REST API over the Atlas workspace database. Everything you create here lands in the
model immediately — ready to place on diagrams in the app, or already visible if you
also place it on a view via the API.

- **Base URL**: `https://atlas-modelling.pages.dev/api/v1`
- **Spec (OpenAPI 3.1)**: [`GET /api/v1/openapi.json`](https://atlas-modelling.pages.dev/api/v1/openapi.json) — public
- **Swagger UI**: [`/api/docs`](https://atlas-modelling.pages.dev/api/docs) — public, supports "Try it out"
- **Storage**: the Supabase `atlas` project (normalised schema, `packages/storage-supabase/schema.sql`)

## Authentication

Every data endpoint requires a token, sent either way:

```
Authorization: Bearer <token>     # or
x-api-key: <token>
```

Three token types are accepted on the model API; the AI proxy (`/api/anthropic/v1/messages`) accepts only the first two, since it spends real money on every call:

| Token | Who it's for | How to get it | AI proxy? |
|---|---|---|---|
| GitHub session token | People using the app | Sign in at atlas-modelling.pages.dev; the app's Supabase session `access_token` is the token | Yes |
| Service token (`ATLAS_API_TOKEN`) | Scripts, CI, AI agents | Held by the workspace owner (Cloudflare Pages secret) | Yes |
| Read-only token (`ATLAS_API_TOKEN_READONLY`) | Dashboards, reporting, anything that should never be able to write | Held by the workspace owner (Cloudflare Pages secret) | **No** — 403 |

The read-only token authenticates `GET`/`HEAD` normally; any mutating method
(`POST`/`PATCH`/`PUT`/`DELETE`) with that token gets `403 {"error": "This
token is read-only"}` instead of running.

Unauthenticated → `401 {"error": "..."}`.

## Rate limiting

Both the model API and the AI proxy enforce a fixed-window, per-token rate
limit inside the Cloudflare Pages Function itself — 120 requests/minute for
the model API, 20 requests/minute for the AI proxy by default (configurable
via the `ATLAS_RATE_LIMIT_API` / `ATLAS_RATE_LIMIT_AI` env vars; `0` disables
a tier). Over the limit → `429` with a `retry-after` header (seconds).

This in-function limiter is **best-effort per Cloudflare point-of-presence,
not a global guarantee** — it's counted in the memory of whichever isolate
happens to handle a given request, and Cloudflare may run many isolates
across many POPs simultaneously. It catches accidental floods and misbehaving
clients cheaply; it is not a substitute for a proper cap. The real backstop
is a **Cloudflare dashboard rate-limiting rule** in front of these routes —
configure one (Security → WAF → Rate limiting rules) for production-grade
enforcement that holds regardless of isolate/POP distribution.

Every response — success or error — carries an `x-request-id` header; quote
it when reporting an issue so the corresponding server-side log line can be
found.

## The one rule that matters

**Mutations run through the Atlas command bus**, the same code path as the UI and the
in-app AI. That means the metamodel is enforced server-side and violations return
`400` with a human-readable message:

- `person` and `system` live at the top level; `container` inside a `system`;
  `component` inside a `container`; `group` boundaries nest anywhere but can never be
  relationship endpoints.
- Deleting an element that still contains children is refused; deleting an element
  cascades its relationships and view placements.
- Removing an element **from a view** (`DELETE /views/{id}/placements/{elementId}`)
  never deletes it from the model — deletion is a separate, explicit call.
- Ids are server-assigned ULIDs, stable forever. Names can change; identity cannot.

## Resources at a glance

| Method + path | Purpose |
|---|---|
| `GET/HEAD /workspace` | Whole workspace snapshot (meta, elements, relationships, views, states). Carries `ETag`/`x-atlas-revision`; `HEAD` for headers only |
| `POST /workspace` | Atomic bulk import — replace the whole workspace (restore a backup). `?dryRun=1` validates only |
| `GET/POST /elements`, `GET/PATCH/DELETE /elements/{id}` | Model elements. `GET /elements?name=X` filters by exact name |
| `GET/POST /relationships`, `GET/PATCH/DELETE /relationships/{id}` | Connections between elements |
| `GET/POST /views`, `GET/PATCH/DELETE /views/{id}` | Diagrams (projections of the model) |
| `POST /views/{id}/placements`, `PATCH/DELETE /views/{id}/placements/{elementId}` | Put/move/remove elements on a diagram (grid units, 1 = 20px) |
| `GET/POST /states`, `PATCH/DELETE /states/{id}` | Named temporal states |
| `POST /commands` | Atomic batch of raw commands — full command-bus power |
| `GET /commands/schema` | Per-command-type JSON-schema map, for validating a batch before posting it |
| `GET /lint` | Consistency report: orphans, duplicate names, unplaced relationships |
| `GET /elements/{id}/connections` | Ego network around an element (depth/direction-bounded graph traversal) |
| `GET /views/{id}/export` | Export a view as Mermaid, PlantUML or SVG |

Convenience for humans and AI agents: creation endpoints accept `parentName`,
`sourceName`/`targetName`, and `elementName` in place of ids — resolved
case-insensitively against existing element names. Two failure shapes:

```sh
# Zero matches
# → 400 {"error": "No element named \"Crew Rostering\""}

# More than one element shares the name
# → 400 {"error": "Element name \"Crew Rostering\" is ambiguous"}
```

On `PATCH`, send only the fields to change; an explicit `null` clears an
optional field.

## Polling cheaply

`GET /workspace` carries an `ETag: "r<revision>"` header and an
`x-atlas-revision` header — the storage revision behind the snapshot you just
read. Send the ETag back via `If-None-Match` on the next poll: if nothing has
changed you get a bodyless `304` instead of the whole workspace. `HEAD
/workspace` returns the same two headers with no body at all, for a poll loop
that only needs to know *whether* something changed, not *what*.

Every mutating endpoint (`POST`/`PATCH`/`DELETE` across elements,
relationships, views, placements, states, `POST /commands`, `POST /workspace`)
returns the **new** revision as `x-atlas-revision` on success — one more than
whatever revision preceded the write. A client that keeps the last revision it
saw can tell, from response headers alone, whether it needs to re-fetch
anything:

```sh
# First read: note the ETag
curl -si "${auth[@]}" $API/workspace | grep -i etag
# < etag: "r7"

# Later: ask "has anything changed since r7?"
curl -s -o /dev/null -w '%{http_code}\n' "${auth[@]}" -H 'If-None-Match: "r7"' $API/workspace
# 304 (nothing changed) or 200 (something did — re-fetch the body)

# Cheaper still: HEAD, no body either way
curl -sI "${auth[@]}" $API/workspace
```

## Worked example (curl)

```sh
TOKEN="<your token>"
API="https://atlas-modelling.pages.dev/api/v1"
auth=(-H "Authorization: Bearer $TOKEN" -H "content-type: application/json")

# 1. Create a system and a container inside it (parent by name)
curl -s "${auth[@]}" -d '{"kind":"system","name":"Crew Rostering","description":"Plans crew duty","tags":["ops"]}' $API/elements
curl -s "${auth[@]}" -d '{"kind":"container","name":"Roster API","parentName":"Crew Rostering","technology":["Go"]}' $API/elements

# 2. Connect it to an existing system, by name
curl -s "${auth[@]}" -d '{"sourceName":"Crew Rostering","targetName":"Booking Engine","name":"reads schedules from","technology":["Kafka"]}' $API/relationships

# 3. Create a diagram and place the system on it
VIEW=$(curl -s "${auth[@]}" -d '{"kind":"landscape","name":"Ops landscape"}' $API/views | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -s "${auth[@]}" -d '{"elementName":"Crew Rostering","x":0,"y":0}' $API/views/$VIEW/placements

# 4. Read the whole model back
curl -s "${auth[@]}" $API/workspace
```

A metamodel violation, for comparison:

```sh
curl -s "${auth[@]}" -d '{"kind":"component","name":"Rogue"}' $API/elements
# → 400 {"error": "A Component cannot live at the top level. Legal parents: Container."}
```

## Costs and TCO

Elements carry an optional `costs` array — the input to the TCO analysis in the
app (Analysis drawer → TCO). Each entry:

| Field | Notes |
|---|---|
| `label` | Required. e.g. "Enterprise licence" |
| `category` | Required. `licences` \| `infrastructure` \| `people` \| `vendor-services` \| `change` \| `decommission` \| `other` |
| `classification` | Required. `run` \| `change` \| `acquire` \| `retire` |
| `kind` | Required. `recurring` or `one-off` |
| `amount` | Required, > 0, whole currency units |
| `currency` | ISO 4217; `GBP` when omitted |
| `period` | Recurring only: `monthly` or `annual` (default). Monthly is normalised ×12 |
| `amortiseYears` | One-off only: straight-line amortisation window (default 3) |
| `confidence` | `estimate` \| `quoted` \| `actual` |
| `validFrom` / `validTo` / `states` | Temporal scope, same semantics as element validity — lets a target-state architecture carry different costs |
| `id` | ULID; assigned by the server when omitted |

Costs roll up through containment (component → container → system), so attach
each cost to the element that actually incurs it — never to both an element and
its parent.

```sh
# A recurring licence and an amortised migration on one element
curl -s "${auth[@]}" -X PATCH $API/elements/$ID -d '{
  "costs": [
    {"label":"SaaS licence","category":"licences","classification":"run","kind":"recurring","amount":42000,"period":"annual","confidence":"quoted"},
    {"label":"Migration project","category":"change","classification":"change","kind":"one-off","amount":250000,"amortiseYears":3,"validFrom":"2026-01-01"}
  ]
}'
```

`PATCH` replaces the whole array; send `"costs": null` to clear it.

## Bulk import / restore-a-backup — `POST /workspace`

`GET /workspace` and `POST /workspace` are a pair: export the whole model,
later replay that exact snapshot back in — the standard way to restore a
backup, seed a new environment, or move a workspace between databases. The
request body is the exact `WorkspaceData` shape `GET /workspace` returns.

The write is atomic and total: on success, every element, relationship, view
and state currently stored is replaced by what's in the body — this is an
overwrite, not a merge. Validation happens first and is dispatch-free
(construct the workspace, check referential integrity, validate stencil
refs against the registry) rather than a full command-bus replay, so it stays
fast even for a large workspace; a validation failure returns `400` and never
touches the stored data. Add `?dryRun=1` to run validation only:

```sh
curl -s "${auth[@]}" -o /dev/null -w '%{http_code}\n' -d @snapshot.json "$API/workspace?dryRun=1"
# 200 {"valid": true}   — or 400 {"error": "..."} without persisting anything
```

Same optimistic-revision retry as every other mutation — a concurrent writer
racing the import just means one more attempt, not a lost update.

```sh
# 1. Back up the current workspace
curl -s "${auth[@]}" $API/workspace > snapshot.json

# 2. ...later, restore it (e.g. into a freshly provisioned workspace)
curl -s "${auth[@]}" -X POST -d @snapshot.json $API/workspace
```

`400` causes: a dangling reference (e.g. an element's `parentId` pointing at
nothing — `checkIntegrity`'s job), or a `stencil` ref whose `attributes` fail
that stencil's own JSON Schema.

## Raw commands (advanced)

`POST /commands` applies any Atlas commands atomically (all-or-nothing):

```json
{
  "label": "Seed payments slice",
  "commands": [
    { "type": "createElement", "element": { "id": "<new ULID>", "kind": "system", "name": "Payments", "parentId": null } },
    { "type": "updateWorkspaceMeta", "changes": { "name": "BA estate" } }
  ]
}
```

Unlike the resource endpoints, you supply ULIDs yourself here (26 chars,
Crockford base32). The response is the resulting workspace snapshot.

## Read-side analysis

Everything below is derived from the model, never drawn or computed by hand — the
same `@atlas/core` graph/export functions the app's Analysis drawer, Connections
view and Toolbar export menu call, exposed read-only over the API.

### Consistency report — `GET /lint`

Orphan elements (in the model but on no view), duplicate names sharing a scope,
and relationships that appear on no view:

```sh
curl -s "${auth[@]}" $API/lint
```

```json
[
  { "code": "orphan-element", "message": "\"Payments\" is in the model but not on any view", "ids": ["01J..."] },
  { "code": "unplaced-relationship", "message": "Relationship Crew Rostering → Booking Engine appears on no view", "ids": ["01J..."] }
]
```

### Ego network / impact traversal — `GET /elements/{id}/connections`

The same breadth-first traversal the Connections view runs: every element and
relationship within `depth` hops of the centre element.

```sh
curl -s "${auth[@]}" "$API/elements/$ID/connections?depth=2&direction=out"
```

- `depth` — integer 1–3, default 1.
- `direction` — `both` (default), `out`, or `in`.
- `404` if the element id doesn't exist; `400` for an out-of-range `depth` or an
  unrecognised `direction`.

Response shape:

```json
{ "center": "01J...", "nodes": [{ "id": "01J...", "kind": "system", "name": "Payments", "hop": 1 }], "edges": [ /* Relationship objects */ ] }
```

### Diagram export — `GET /views/{id}/export`

Renders a view as Mermaid, PlantUML or SVG — the same output the Toolbar's
export menu downloads, generated straight from the model:

```sh
curl -s "${auth[@]}" "$API/views/$VIEW/export?format=mermaid"   # text/plain, C4Context Mermaid
curl -s "${auth[@]}" "$API/views/$VIEW/export?format=plantuml"  # text/plain, C4-PlantUML
curl -s "${auth[@]}" "$API/views/$VIEW/export?format=svg"       # image/svg+xml, standalone SVG
```

`404` for an unknown view id; `400` for an unrecognised `format`.

### Command schema map — `GET /commands/schema`

A JSON-schema fragment for every command type the bus in `POST /commands`
accepts (`createElement`, `updateElement`, `deleteElement`,
`createRelationship`, `updateRelationship`, `deleteRelationship`,
`createView`, `updateView`, `deleteView`, `placeOnView`, `updatePlacement`,
`removeFromView`, `createState`, `updateState`, `deleteState`,
`updateWorkspaceMeta`, `batch`) — useful for validating a batch client-side
before posting it:

```sh
curl -s "${auth[@]}" $API/commands/schema
```

## Notes for AI agents

- Fetch `GET /api/v1/openapi.json` for the full machine-readable contract.
- Prefer name-based references (`parentName`, `sourceName`…) when you know display
  names; fall back to `GET /elements?name=` to resolve ids.
- Error messages are written for humans — surface them verbatim; they explain the
  metamodel rule you hit.
- The database workspace is shared: read `GET /workspace` first to see what exists
  rather than assuming an empty model.
- The web app can edit either a browser-local workspace or the shared database
  workspace (source switcher in the toolbar). In shared mode the app polls for
  changes, so API writes appear in open sessions within a few seconds.
- For read-side reasoning about the model — consistency checks, blast-radius/impact
  analysis, or handing a diagram to something else — use `GET /lint`,
  `GET /elements/{id}/connections`, and `GET /views/{id}/export` before falling back
  to fetching the whole workspace and computing it yourself; validate a raw command
  batch shape against `GET /commands/schema` before `POST /commands`.
- Polling a shared workspace for changes? Use `HEAD /workspace` (or `GET` with
  `If-None-Match`) and compare `x-atlas-revision` instead of diffing whole
  snapshots — see "Polling cheaply" above.
- Restoring or seeding a workspace wholesale (as opposed to incremental
  `create*`/`update*` calls)? `POST /workspace` is the atomic bulk-import path —
  see "Bulk import / restore-a-backup" above.

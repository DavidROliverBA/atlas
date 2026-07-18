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

Two token types are accepted:

| Token | Who it's for | How to get it |
|---|---|---|
| GitHub session token | People using the app | Sign in at atlas-modelling.pages.dev; the app's Supabase session `access_token` is the token |
| Service token (`ATLAS_API_TOKEN`) | Scripts, CI, AI agents | Held by the workspace owner (Cloudflare Pages secret) |

Unauthenticated → `401 {"error": "..."}`.

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
| `GET /workspace` | Whole workspace snapshot (meta, elements, relationships, views, states) |
| `GET/POST /elements`, `GET/PATCH/DELETE /elements/{id}` | Model elements. `GET /elements?name=X` filters by exact name |
| `GET/POST /relationships`, `GET/PATCH/DELETE /relationships/{id}` | Connections between elements |
| `GET/POST /views`, `GET/PATCH/DELETE /views/{id}` | Diagrams (projections of the model) |
| `POST /views/{id}/placements`, `PATCH/DELETE /views/{id}/placements/{elementId}` | Put/move/remove elements on a diagram (grid units, 1 = 20px) |
| `GET/POST /states`, `PATCH/DELETE /states/{id}` | Named temporal states |
| `POST /commands` | Atomic batch of raw commands — full command-bus power |

Convenience for humans and AI agents: creation endpoints accept `parentName`,
`sourceName`/`targetName`, and `elementName` in place of ids — resolved against
unique element names (`400` if missing or ambiguous). On `PATCH`, send only the
fields to change; an explicit `null` clears an optional field.

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

## Notes for AI agents

- Fetch `GET /api/v1/openapi.json` for the full machine-readable contract.
- Prefer name-based references (`parentName`, `sourceName`…) when you know display
  names; fall back to `GET /elements?name=` to resolve ids.
- Error messages are written for humans — surface them verbatim; they explain the
  metamodel rule you hit.
- The database workspace is shared: read `GET /workspace` first to see what exists
  rather than assuming an empty model.
- The web app's canvas currently edits its own browser-local workspace; the database
  workspace is the API's. Export/import bridges them today; live DB-backed editing in
  the app arrives with the multi-user milestone wiring.

# Operations

Runbook for the secrets, deploy paths, and backup/restore procedure behind the hosted
app at [atlas-modelling.pages.dev](https://atlas-modelling.pages.dev). See
[`docs/api.md`](api.md) for the API contract these secrets unlock, and
[`CONTRIBUTING.md`](../CONTRIBUTING.md) for local dev (which should almost never need
any of these — browser-local mode needs nothing).

## Secrets inventory

Everything below is a **Cloudflare Pages secret** on the `atlas-modelling` project
unless noted otherwise. Pages secrets are per-project environment variables, set once
(not per deploy), and read by the Functions under `apps/web/functions/` via `env.<NAME>`.

| Secret | Used by | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `functions/api/anthropic/v1/messages.js` | Server-side key for the AI chat proxy — the browser never sees the real Anthropic key. |
| `ATLAS_API_TOKEN` | `functions/api/v1/[[path]].ts` | Service token for scripts/CI/AI agents to call the model REST API without a GitHub session (`Authorization: Bearer` or `x-api-key`). |
| `SUPABASE_SERVICE_ROLE_KEY` | `functions/api/v1/[[path]].ts` | Lets the API Function bypass RLS to read/write the single production workspace via `@atlas/storage-supabase`. Without it the API returns `503`. |
| `ATLAS_ALLOWED_GITHUB` | `functions/api/v1/[[path]].ts`, the AI proxy | Optional comma-separated GitHub usernames allow-listed to write via a GitHub session token. Unset = any signed-in GitHub user can write. |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions (`.github/workflows/ci.yml`) — **not** a Pages secret | Lets CI deploy to Cloudflare Pages (`wrangler pages deploy`) on push to `main` and for PR previews. A **GitHub repo secret**, not read by the app itself. |
| `ATLAS_BACKUP_TOKEN` | GitHub Actions (`.github/workflows/backup.yml`) — **not** a Pages secret | Lets the nightly backup job `GET /api/v1/workspace`. A **GitHub repo secret**. |

### `ATLAS_BACKUP_TOKEN` — use the read-only tier

The model API accepts a second, narrower service token: `ATLAS_API_TOKEN_READONLY`
(Pages secret; GET/HEAD only, mutations get 403, rejected outright by the AI proxy).
The nightly backup only ever performs a GET, so **`ATLAS_BACKUP_TOKEN` (the GitHub
secret) should hold the read-only token's value, not the full-write one** — a leaked
CI secret then exposes read access, not write access or AI spend. Rotating
`ATLAS_API_TOKEN_READONLY` means updating both places (see below).

## Rotation runbook

General pattern for the four Pages secrets: rotate in Cloudflare, then nothing else to
update (Functions read `env.<NAME>` fresh on every request — no redeploy needed).

```sh
# from apps/web, or pass --project-name explicitly from anywhere:
npx wrangler pages secret put <NAME> --project-name=atlas-modelling
# prompts for the new value on stdin; overwrites the existing secret in place.
```

Equivalent dashboard path: **Cloudflare dashboard → Workers & Pages → atlas-modelling →
Settings → Environment variables → (Production) → Secrets → Edit**.

### `ANTHROPIC_API_KEY`

- **Where set**: Cloudflare Pages secret (`atlas-modelling`).
- **Blast radius if leaked**: spend on the linked Anthropic account; no access to the
  Atlas model or Supabase data (the AI proxy only forwards chat turns).
- **Rotate**:
  1. Generate a new key in the [Anthropic Console](https://console.anthropic.com/settings/keys).
  2. `npx wrangler pages secret put ANTHROPIC_API_KEY --project-name=atlas-modelling`,
     paste the new key.
  3. Revoke the old key in the Console.
  4. Smoke-test: open the app, AI chat tab, send a message — the proxy should respond.

### `ATLAS_API_TOKEN`

- **Where set**: Cloudflare Pages secret (`atlas-modelling`).
- **Blast radius if leaked**: full read/write on the single production workspace via
  the REST API (same power as a signed-in editor) — no GitHub account needed. For
  read-only consumers use `ATLAS_API_TOKEN_READONLY` instead.
- **Rotate**:
  1. Generate a new random token (e.g. `openssl rand -hex 32`).
  2. `npx wrangler pages secret put ATLAS_API_TOKEN --project-name=atlas-modelling`.
  3. Update any scripts/CI/AI-agent configs holding the old token.
  4. Smoke-test: `curl -H "Authorization: Bearer <new token>" .../api/v1/workspace`
     returns `200`; the old token now returns `401`.

### `ATLAS_API_TOKEN_READONLY`

- **Where set**: Cloudflare Pages secret (`atlas-modelling`). Copy the same value into
  the `ATLAS_BACKUP_TOKEN` **GitHub Actions** secret for the nightly backup.
- **Blast radius if leaked**: read access to the workspace (GET/HEAD only); mutations
  return 403 and the AI proxy rejects it outright.
- **Rotate**: as `ATLAS_API_TOKEN`, but for the `ATLAS_API_TOKEN_READONLY` secret name,
  then update the `ATLAS_BACKUP_TOKEN` GitHub secret to match.

### `SUPABASE_SERVICE_ROLE_KEY`

- **Where set**: Cloudflare Pages secret (`atlas-modelling`).
- **Blast radius if leaked**: full bypass of Row Level Security on the Supabase
  project — read/write **every** table directly, not just through the API's command-bus
  validation. Treat as the highest-severity secret in this list.
- **Rotate**:
  1. Supabase dashboard → Project Settings → API → reset/regenerate the `service_role`
     key (this immediately invalidates the old one).
  2. `npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name=atlas-modelling`.
  3. Smoke-test: `GET /api/v1/workspace` with a valid token still returns `200` (a
     `503 API not configured` means the new key didn't take).

### `ATLAS_ALLOWED_GITHUB`

- **Where set**: Cloudflare Pages secret (`atlas-modelling`) — note it's a plain
  allow-list string, not a credential; treated as a secret here only because it's set
  the same way (`wrangler pages secret put`) and lives alongside the others.
- **Blast radius if leaked**: none directly (it's not a credential) — but an
  unauthorised *edit* of it (widening or emptying the list) would open write access to
  any signed-in GitHub user. Protect via normal Cloudflare account access control, not
  rotation.
- **Rotate/update**: `npx wrangler pages secret put ATLAS_ALLOWED_GITHUB --project-name=atlas-modelling`,
  paste a comma-separated list of GitHub usernames (unset it — delete via the
  dashboard — to allow any signed-in user).

### `CLOUDFLARE_API_TOKEN`

- **Where set**: **GitHub repo secret** (Settings → Secrets and variables → Actions),
  read by `.github/workflows/ci.yml`'s `deploy` and `preview` jobs. Not a Pages secret —
  the app itself never sees it.
- **Blast radius if leaked**: whatever the token is scoped to in Cloudflare — at
  minimum, the ability to deploy arbitrary code to the `atlas-modelling` Pages project
  (i.e. to production). Scope it to *Cloudflare Pages: Edit* on the specific account
  when creating it, not a broader account-level token.
- **Rotate**:
  1. Cloudflare dashboard → My Profile → API Tokens → create a new token scoped to
     Pages:Edit for account `edc54adeeb89138ef55778faa9306d2e` (see `apps/web/wrangler.toml`
     for the account id CI uses).
  2. Update the `CLOUDFLARE_API_TOKEN` GitHub repo secret.
  3. Revoke the old token in Cloudflare.
  4. Smoke-test: push to `main` (or open a PR) and confirm the `deploy`/`preview` job
     in Actions deploys successfully instead of skipping.
  5. If the secret is simply unset/missing, both jobs already no-op with an
     `::notice::` instead of failing — that's the intended "not configured yet" state,
     not a bug.

### `ATLAS_BACKUP_TOKEN`

- **Where set**: **GitHub repo secret**, read by `.github/workflows/backup.yml`. Holds
  the same value as `ATLAS_API_TOKEN_READONLY` (the read-only tier — see above).
- **Blast radius if leaked**: read-only workspace access; no writes, no AI spend.
- **Rotate**: follow the `ATLAS_API_TOKEN_READONLY` rotation steps — they update this
  secret too.

## Deploy paths

Two ways the app reaches Cloudflare Pages, both driven by `apps/web/wrangler.toml`
(project name, build output dir) so neither has to repeat that configuration:

- **CI (normal path)**: `.github/workflows/ci.yml`'s `deploy` job runs on every push to
  `main` after `test` → `e2e` pass, building with `pnpm --filter @atlas/web build` and
  deploying with `wrangler pages deploy --branch main`. Gated on `CLOUDFLARE_API_TOKEN`
  — skips with a notice if unset. PRs get the same treatment via the `preview` job,
  deploying to a `pr-<number>` branch alias instead of `main`.
- **Local/manual**: `pnpm --filter @atlas/web run deploy` (== `vite build && wrangler
  pages deploy --branch main --commit-dirty=true`) from a machine with Cloudflare
  credentials configured (`wrangler login`, or `CLOUDFLARE_API_TOKEN` in the
  environment). Use this only for an out-of-band deploy — prefer letting CI do it so
  the deployed code always matches what passed CI.

Either path deploys the built static assets **and** the Cloudflare Pages Functions
under `apps/web/functions/` — there's no separate deploy step for the API.

## Backup and restore

- **Backup**: `.github/workflows/backup.yml` runs nightly (03:17 UTC) plus on-demand
  via `workflow_dispatch`. It `GET`s `/api/v1/workspace` from production with
  `ATLAS_BACKUP_TOKEN` and commits the resulting JSON as `workspace.json` on an orphan
  `backups` branch (created on first run if it doesn't exist). Each night's snapshot is
  one commit — the branch's git history *is* the backup history; a no-op night (no
  change since the last snapshot) skips the commit instead of creating an empty one.
  Skips with an `::notice::` (not a failure) if `ATLAS_BACKUP_TOKEN` is unset.
- **Restore**: another agent is adding `POST /api/v1/workspace` (whole-snapshot
  replace) to the model API — that endpoint is the restore path. To restore a
  snapshot from the `backups` branch:
  ```sh
  git show backups:workspace.json > restore.json
  curl -sS -X POST \
    -H "Authorization: Bearer $ATLAS_API_TOKEN" \
    -H "content-type: application/json" \
    --data @restore.json \
    https://atlas-modelling.pages.dev/api/v1/workspace
  ```
  Confirm the shape of that endpoint against `GET /api/v1/openapi.json` before relying
  on this in an emergency — it may accept the raw `GET /workspace` response shape
  directly, or expect it wrapped, depending on how the other agent lands it.
- **Manual/ad hoc backup**: the same `GET` the workflow does works from any machine
  with a valid token — useful before a risky migration:
  ```sh
  curl -sS -H "Authorization: Bearer $ATLAS_API_TOKEN" \
    https://atlas-modelling.pages.dev/api/v1/workspace > workspace-$(date -u +%Y%m%dT%H%M%SZ).json
  ```

## Known limits

- **Single workspace.** The whole product currently serves exactly one shared
  workspace (`DEFAULT_WORKSPACE_ID` in `functions/api/v1/[[path]].ts`) — there is no
  per-user or per-team workspace isolation, and no dev/staging environment separate
  from production (see the browser-local-vs-DB-mode warning in `CONTRIBUTING.md`).
- **Whole-snapshot saves.** `atlas_save_workspace` (the Postgres function backing every
  save) deletes and re-inserts every element/relationship/view/placement/state for the
  workspace in one transaction, guarded by optimistic-concurrency (`revision`). There's
  no per-object patch path at the storage layer — every save, however small the actual
  change, round-trips the entire model. Fine at current scale; revisit if workspace
  size or write frequency grows enough to make that transaction's cost noticeable.
- **No historical audit trail.** Because saves are whole-snapshot and don't persist the
  command log, "who changed what, when" isn't reconstructable from the database itself
  — only from the nightly backup branch's coarse day-to-day diffs, and only back to
  whenever backups started.

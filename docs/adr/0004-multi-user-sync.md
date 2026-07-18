# ADR 0004: Multi-user sync — snapshot persistence + realtime command relay

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

M8 needs live multi-user editing on Supabase without full CRDT (out of scope for v1).

## Decision

- **Persistence**: the normalised schema in `packages/storage-supabase/schema.sql`
  mirrors the file format one-to-one (`rows.ts` mapping is proven byte-identical
  through the canonical serialiser). Saves are whole-object upserts + pruning —
  last-write-wins per object, with per-object `version` columns reserved for
  optimistic-concurrency surfacing.
- **Liveness**: committed commands are relayed over a Supabase Realtime broadcast
  channel (`atlas:<workspace-id>`). Every client applies remote commands through
  its own CommandBus, so remote edits get identical validation and appear in the
  same model layer as local ones (Principle 2). A per-tab `clientId` filters echoes.
- **Authorisation**: RLS via a `workspace_members` role table (`owner/editor/viewer`)
  and a `security definer` membership function; all seven tables are gated on it.
- **File ↔ DB sync**: `exportToFiles()` / `importFromFiles()` go through the same
  canonical serialiser as file mode, so a DB workspace archives to a clean git diff.

## Consequences

- Two clients editing the same *field* concurrently resolve last-write-wins;
  conflicts surface visually (the later command wins on every screen) rather than
  merging. Acceptable for v1; CRDT remains the documented escalation path.
- Command relay assumes commands are self-contained and deterministic — which the
  bus guarantees (ULIDs are generated before dispatch, never inside handlers).
- Wiring the adapter into `apps/web` (auth UI, workspace picker) and verifying the
  two-browser acceptance test requires a provisioned Supabase project, which this
  repo cannot assume; the adapter ships unit-tested with the schema ready to apply.

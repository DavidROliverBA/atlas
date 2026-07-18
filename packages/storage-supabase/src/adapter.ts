/**
 * Supabase storage adapter (M8): loads a workspace from Postgres, persists
 * snapshots, and relays committed commands over Supabase Realtime so every
 * connected client replays the same command stream through its own bus —
 * the same commands the UI and AI use (Principle 2). Conflict strategy:
 * last-write-wins per object with optimistic per-object versions
 * (full CRDT is out of scope for v1, per the brief).
 */

import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { Workspace, workspaceToFiles, workspaceFromFiles, type Command, type FileMap } from "@atlas/core";
import { dataToRows, rowsToData, type WorkspaceRows } from "./rows.js";

export interface RemoteCommandEnvelope {
  /** Random per-tab id so a client ignores its own broadcasts. */
  clientId: string;
  command: Command;
}

export class SupabaseStorageAdapter {
  private channel: RealtimeChannel | null = null;
  readonly clientId = Math.random().toString(36).slice(2);

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly workspaceId: string,
  ) {}

  /** Load the whole workspace from the normalised tables. */
  async load(): Promise<Workspace> {
    const [workspace, elements, relationships, views, placements, states] = await Promise.all([
      this.supabase.from("workspaces").select("*").eq("id", this.workspaceId).single(),
      this.supabase.from("elements").select("*").eq("workspace_id", this.workspaceId),
      this.supabase.from("relationships").select("*").eq("workspace_id", this.workspaceId),
      this.supabase.from("views").select("*").eq("workspace_id", this.workspaceId),
      this.supabase.from("view_placements").select("*"),
      this.supabase.from("states").select("*").eq("workspace_id", this.workspaceId),
    ]);
    const firstError =
      workspace.error ?? elements.error ?? relationships.error ?? views.error ?? placements.error ?? states.error;
    if (firstError) throw new Error(`Supabase load failed: ${firstError.message}`);

    const rows: WorkspaceRows = {
      workspace: workspace.data,
      elements: elements.data ?? [],
      relationships: relationships.data ?? [],
      views: views.data ?? [],
      placements: placements.data ?? [],
      states: states.data ?? [],
    };
    return Workspace.fromData(rowsToData(rows));
  }

  /**
   * Persist the current state. Upserts every row and deletes rows that no
   * longer exist (last-write-wins per object).
   */
  async saveSnapshot(ws: Workspace): Promise<void> {
    const rows = dataToRows(ws.toData(), this.workspaceId);

    const upsert = async (table: string, data: unknown[], onConflict?: string) => {
      if (!data.length) return;
      const { error } = await this.supabase.from(table).upsert(data as never, { onConflict });
      if (error) throw new Error(`Supabase upsert into ${table} failed: ${error.message}`);
    };

    await upsert("workspaces", [rows.workspace]);
    await upsert("elements", rows.elements);
    await upsert("relationships", rows.relationships);
    await upsert("views", rows.views);
    // Placements are replaced wholesale so removals prune correctly.
    if (rows.views.length) {
      const { error } = await this.supabase
        .from("view_placements")
        .delete()
        .in("view_id", rows.views.map((v) => v.id));
      if (error) throw new Error(`Supabase placement prune failed: ${error.message}`);
    }
    await upsert("view_placements", rows.placements, "view_id,element_id");
    await upsert("states", rows.states);

    // Remove rows deleted from the model. Placements first (FK), then the rest.
    const keep = {
      elements: rows.elements.map((r) => r.id),
      relationships: rows.relationships.map((r) => r.id),
      views: rows.views.map((r) => r.id),
      states: rows.states.map((r) => r.id),
    };
    for (const [table, ids] of Object.entries(keep)) {
      const query = this.supabase.from(table).delete().eq("workspace_id", this.workspaceId);
      const { error } = ids.length ? await query.not("id", "in", `(${ids.join(",")})`) : await query;
      if (error) throw new Error(`Supabase prune of ${table} failed: ${error.message}`);
    }
  }

  /** Broadcast a committed command to other clients editing this workspace. */
  async broadcast(command: Command): Promise<void> {
    await this.ensureChannel().send({
      type: "broadcast",
      event: "atlas-command",
      payload: { clientId: this.clientId, command } satisfies RemoteCommandEnvelope,
    });
  }

  /** Subscribe to remote commands; returns an unsubscribe function. */
  onRemoteCommand(handler: (command: Command) => void): () => void {
    const channel = this.ensureChannel();
    channel.on("broadcast", { event: "atlas-command" }, ({ payload }) => {
      const envelope = payload as RemoteCommandEnvelope;
      if (envelope.clientId !== this.clientId) handler(envelope.command);
    });
    channel.subscribe();
    return () => {
      void this.supabase.removeChannel(channel);
      this.channel = null;
    };
  }

  private ensureChannel(): RealtimeChannel {
    this.channel ??= this.supabase.channel(`atlas:${this.workspaceId}`, {
      config: { broadcast: { self: false } },
    });
    return this.channel;
  }

  // ---- file ↔ DB sync (§3.8B bidirectional) ------------------------------

  /** Export the DB workspace to the canonical git-friendly file map. */
  async exportToFiles(): Promise<FileMap> {
    return workspaceToFiles(await this.load());
  }

  /** Import a file workspace into the DB (validates via the file loader first). */
  async importFromFiles(files: FileMap): Promise<void> {
    await this.saveSnapshot(workspaceFromFiles(files));
  }
}

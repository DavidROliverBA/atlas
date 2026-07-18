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

/** Thrown when a guarded save loses an optimistic-concurrency race. */
export class RevisionConflictError extends Error {
  constructor() {
    super("Workspace was modified concurrently — reload and retry");
    this.name = "RevisionConflictError";
  }
}

export class SupabaseStorageAdapter {
  private channel: RealtimeChannel | null = null;
  readonly clientId = Math.random().toString(36).slice(2);

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly workspaceId: string,
  ) {}

  private async readRevision(): Promise<number> {
    const { data, error } = await this.supabase
      .from("workspaces")
      .select("revision")
      .eq("id", this.workspaceId)
      .single();
    if (error) throw new Error(`Supabase revision read failed: ${error.message}`);
    return Number((data as { revision?: number }).revision ?? 0);
  }

  /**
   * Load the workspace plus its optimistic-concurrency revision. The load
   * spans several queries, so the revision is read before and after — a
   * mismatch means a save landed mid-read and the load retries, guaranteeing
   * a consistent snapshot (saves themselves are a single transaction).
   */
  async loadWithRevision(): Promise<{ workspace: Workspace; revision: number }> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await this.readRevision();
      const workspace = await this.load();
      const after = await this.readRevision();
      if (before === after) return { workspace, revision: after };
      await new Promise((resolve) => setTimeout(resolve, 30 + Math.random() * 120));
    }
    throw new Error("Workspace is changing too rapidly to read a consistent snapshot");
  }

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
   * Persist the current state atomically via the `atlas_save_workspace`
   * Postgres function: one transaction, serialised on the workspace row.
   * When `expectedRevision` is given the save aborts with
   * RevisionConflictError if anyone saved since that revision was read.
   */
  async saveSnapshot(ws: Workspace, options: { expectedRevision?: number } = {}): Promise<void> {
    const rows = dataToRows(ws.toData(), this.workspaceId);
    const { error } = await this.supabase.rpc("atlas_save_workspace", {
      p_workspace_id: this.workspaceId,
      p_expected_revision: options.expectedRevision ?? null,
      p_payload: {
        workspace: rows.workspace,
        elements: rows.elements,
        relationships: rows.relationships,
        views: rows.views,
        placements: rows.placements,
        states: rows.states,
      },
    });
    if (error) {
      if (error.message.includes("revision_conflict") || error.code === "40001") {
        throw new RevisionConflictError();
      }
      throw new Error(`Supabase save failed: ${error.message}`);
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

/**
 * UI state store. Owns the Workspace + CommandBus pair; every mutation goes
 * through `dispatch` (the same commands the AI and CLI use). The store keeps
 * a monotonically increasing `rev` so React re-renders when the model
 * changes — components read model data straight from the workspace.
 */

import { create } from "zustand";
import {
  CommandBus,
  Workspace,
  ulidFactory,
  workspaceFromFiles,
  workspaceToFiles,
  type Command,
  type TemporalContext,
  type Ulid,
  type View,
  type ViewKind,
} from "@atlas/core";
import { builtinRegistry } from "@atlas/stencils";
import { buildSeedWorkspace } from "./seed";
import { apiToken, fetchDbWorkspace, pushCommand, pushesSettled } from "./dbsync";

/** All built-in packs, with attribute validation wired into the command bus. */
export const stencilRegistry = builtinRegistry();

/**
 * Pack ids enabled in a workspace manifest ("aws@1" → "aws"). A workspace
 * with no packs recorded (e.g. created via the API) still gets the C4 core
 * vocabulary so the palette is never empty.
 */
export function enabledPackIds(ws: Workspace): string[] {
  const ids = (ws.meta.stencilPacks ?? []).map((ref) => ref.split("@")[0]!);
  return ids.length ? ids : ["c4-core", "generic-tech", "ai-agents"];
}

export const GRID = 20;
/** Default element footprint in grid units. */
export const DEFAULT_W = 9;
export const DEFAULT_H = 5;

export type Selection =
  | { type: "element"; id: Ulid }
  | { type: "relationship"; id: Ulid }
  | null;

const STORAGE_KEY = "atlas.workspace.v1";

function loadPersisted(): Workspace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as Record<string, string>;
    return workspaceFromFiles(new Map(Object.entries(record)));
  } catch (err) {
    console.warn("Could not load persisted workspace; starting from demo.", err);
    return null;
  }
}

function persist(ws: Workspace): void {
  const files = Object.fromEntries(workspaceToFiles(ws));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
}

function firstViewId(ws: Workspace): Ulid {
  const views = [...ws.views.values()];
  const landscape = views.find((v) => v.kind === "landscape");
  const first = landscape ?? views[0];
  if (first) return first.id;
  throw new Error("Workspace has no views");
}

export interface AtlasStore {
  ws: Workspace;
  bus: CommandBus;
  rev: number;
  activeViewId: Ulid;
  selection: Selection;
  error: string | null;
  /** Direction of the last drill navigation, used for the zoom animation. */
  navDirection: "in" | "out" | null;
  /** Full-screen/side overlays (connections ego-view, estate analysis, help). */
  overlay: { type: "connections"; id: Ulid } | { type: "analysis" } | { type: "help" } | null;
  /** Temporal lens applied to every view (§3.6). */
  temporal: TemporalContext;
  /** When set, the canvas renders a state-diff overlay between two contexts. */
  diffPair: { a: TemporalContext; b: TemporalContext } | null;
  /** Tag-based colour overlay (§3.3): elements carrying this tag are highlighted. */
  highlightTag: string | null;
  /** Cost colour overlay (§TCO plan, phase 3): tint nodes by rolled-up annual cost. */
  costOverlay: boolean;
  /** Where the open workspace lives: this browser, or the shared database via the API. */
  source: "local" | "db";
  /** Token used for database mode (cached at connect time). */
  dbToken: string | null;
  /** Whether the ⌘K command palette is open. */
  paletteOpen: boolean;
  /** Consecutive failed `syncDb` calls; resets to 0 on the next success. */
  syncFailureCount: number;
  /** True once 3+ consecutive sync failures have occurred — drives the persistent outage banner. */
  dbOutage: boolean;
  /** Current poll interval for the db-mode sync loop (backs off during an outage). */
  pollIntervalMs: number;
  /** Switch to the shared database workspace (loads it via the API). */
  connectDb(): Promise<void>;
  /** Return to the browser-local workspace. */
  disconnectDb(): void;
  /** Pull the latest database state (no-op in local mode). */
  syncDb(): Promise<void>;
  /** Dispatch a command; returns an error message (also stored) or null on success. */
  dispatch(command: Command): string | null;
  undo(): void;
  redo(): void;
  select(selection: Selection): void;
  setActiveView(id: Ulid): void;
  clearError(): void;
  newId(): Ulid;
  /** Find the drill-down view for an element, creating it (with children placed) if needed. */
  drillInto(elementId: Ulid): Ulid | null;
  resetToDemo(): void;
  replaceWorkspace(ws: Workspace): void;
}

/** Db-mode poll interval steps: fast while healthy, backing off during an outage. */
export const POLL_INTERVAL_MS = 8000;
const POLL_INTERVAL_BACKOFF_MS = 30000;
const POLL_INTERVAL_MAX_MS = 60000;
/** Consecutive sync failures before we stop toasting and show the persistent banner instead. */
const OUTAGE_THRESHOLD = 3;

function pollIntervalForFailures(count: number): number {
  if (count < OUTAGE_THRESHOLD) return POLL_INTERVAL_MS;
  if (count === OUTAGE_THRESHOLD) return POLL_INTERVAL_BACKOFF_MS;
  return POLL_INTERVAL_MAX_MS;
}

const ids = ulidFactory();

function makePair(): { ws: Workspace; bus: CommandBus } {
  const ws = loadPersisted() ?? buildSeedWorkspace(ids);
  return { ws, bus: new CommandBus(ws, { stencils: stencilRegistry }) };
}

export const useAtlas = create<AtlasStore>((set, get) => {
  const { ws, bus } = makePair();

  const bump = () => {
    const { ws, source } = get();
    // Database mode never touches the local backup workspace.
    if (source === "local") persist(ws);
    set((s) => ({ rev: s.rev + 1 }));
  };

  const pushIfDb = (command: Command) => {
    const { source, dbToken } = get();
    if (source === "db" && dbToken) {
      pushCommand(dbToken, command, (message) => {
        set({ error: message });
        void get().syncDb();
      });
    }
  };

  return {
    ws,
    bus,
    rev: 0,
    activeViewId: firstViewId(ws),
    selection: null,
    error: null,
    navDirection: null,
    overlay: null,
    temporal: { type: "all" },
    diffPair: null,
    highlightTag: null,
    costOverlay: false,
    source: "local",
    dbToken: null,
    paletteOpen: false,
    syncFailureCount: 0,
    dbOutage: false,
    pollIntervalMs: POLL_INTERVAL_MS,

    async connectDb() {
      const token = await apiToken();
      if (!token) {
        set({ error: "Sign in with GitHub (or set an API token) to open the shared database" });
        return;
      }
      try {
        const data = await fetchDbWorkspace(token);
        const ws = Workspace.fromData(data);
        const bus = new CommandBus(ws, { stencils: stencilRegistry });
        set({
          source: "db",
          dbToken: token,
          ws,
          bus,
          activeViewId: ws.views.size ? firstViewId(ws) : get().activeViewId,
          selection: null,
          rev: get().rev + 1,
          syncFailureCount: 0,
          dbOutage: false,
          pollIntervalMs: POLL_INTERVAL_MS,
        });
        // A database workspace may legitimately have no views yet.
        if (!ws.views.size) {
          const view: View = {
            id: ids.next(),
            kind: "landscape",
            name: "Landscape",
            scopeId: null,
            placements: [],
          };
          get().dispatch({ type: "createView", view });
          set({ activeViewId: view.id });
        }
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    disconnectDb() {
      const { ws, bus } = makePair();
      set({
        source: "local",
        dbToken: null,
        ws,
        bus,
        activeViewId: firstViewId(ws),
        selection: null,
        rev: get().rev + 1,
        syncFailureCount: 0,
        dbOutage: false,
        pollIntervalMs: POLL_INTERVAL_MS,
      });
    },

    async syncDb() {
      const { source, dbToken, ws, activeViewId, selection } = get();
      if (source !== "db" || !dbToken) return;
      try {
        await pushesSettled();
        const data = await fetchDbWorkspace(dbToken);
        // A successful round-trip ends any outage: clear the banner/counter and
        // restore the fast poll interval, regardless of whether data changed.
        const wasOutage = get().dbOutage || get().syncFailureCount > 0;
        if (JSON.stringify(data) === JSON.stringify(ws.toData())) {
          if (wasOutage) {
            set({ syncFailureCount: 0, dbOutage: false, pollIntervalMs: POLL_INTERVAL_MS });
          }
          return;
        }
        const next = Workspace.fromData(data);
        const bus = new CommandBus(next, { stencils: stencilRegistry });
        set({
          ws: next,
          bus,
          activeViewId: next.views.has(activeViewId)
            ? activeViewId
            : next.views.size
              ? firstViewId(next)
              : activeViewId,
          selection:
            selection?.type === "element" && next.elements.has(selection.id)
              ? selection
              : selection?.type === "relationship" && next.relationships.has(selection.id)
                ? selection
                : null,
          rev: get().rev + 1,
          syncFailureCount: 0,
          dbOutage: false,
          pollIntervalMs: POLL_INTERVAL_MS,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const syncFailureCount = get().syncFailureCount + 1;
        const dbOutage = syncFailureCount >= OUTAGE_THRESHOLD;
        set({
          // Below the threshold: same transient-toast behaviour as before. At/after
          // the threshold: stop re-toasting the same generic error every cycle —
          // the persistent banner takes over instead.
          error: dbOutage ? get().error : message,
          syncFailureCount,
          dbOutage,
          pollIntervalMs: pollIntervalForFailures(syncFailureCount),
        });
      }
    },

    dispatch(command) {
      try {
        get().bus.dispatch(command);
        bump();
        pushIfDb(command);
        return null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ error: message });
        return message;
      }
    },

    undo() {
      const entry = get().bus.peekUndo;
      if (get().bus.undo()) {
        bump();
        if (entry) pushIfDb(entry.undo);
      }
      ensureActiveView(set, get);
    },
    redo() {
      const entry = get().bus.peekRedo;
      if (get().bus.redo()) {
        bump();
        if (entry) pushIfDb(entry.do);
      }
      ensureActiveView(set, get);
    },

    select: (selection) => set({ selection }),
    setActiveView: (id) => set({ activeViewId: id, selection: null }),
    clearError: () => set({ error: null }),
    newId: () => ids.next(),

    drillInto(elementId) {
      const { ws, dispatch } = get();
      const el = ws.elements.get(elementId);
      if (!el) return null;
      if (el.kind !== "system" && el.kind !== "container") return null;

      const existing = [...ws.views.values()].find((v) => v.scopeId === elementId);
      if (existing) return existing.id;

      const kind: ViewKind = el.kind === "system" ? "container" : "component";
      const children = ws.children(elementId).filter((c) => c.kind !== "group");
      const view: View = {
        id: ids.next(),
        kind,
        name: `${el.name} — ${kind === "container" ? "containers" : "components"}`,
        scopeId: elementId,
        placements: children.map((c, i) => ({
          elementId: c.id,
          x: (i % 3) * (DEFAULT_W + 4),
          y: Math.floor(i / 3) * (DEFAULT_H + 4),
        })),
      };
      const error = dispatch({ type: "createView", view });
      return error ? null : view.id;
    },

    resetToDemo() {
      localStorage.removeItem(STORAGE_KEY);
      const ws = buildSeedWorkspace(ids);
      const bus = new CommandBus(ws, { stencils: stencilRegistry });
      set({ ws, bus, activeViewId: firstViewId(ws), selection: null, rev: get().rev + 1 });
      persist(ws);
    },

    replaceWorkspace(ws) {
      const bus = new CommandBus(ws, { stencils: stencilRegistry });
      set({ ws, bus, activeViewId: firstViewId(ws), selection: null, rev: get().rev + 1 });
      persist(ws);
    },
  } as AtlasStore;
});

/** After undo/redo the active view may have been deleted — fall back gracefully. */
function ensureActiveView(
  set: (partial: Partial<AtlasStore>) => void,
  get: () => AtlasStore,
): void {
  const { ws, activeViewId } = get();
  if (!ws.views.has(activeViewId)) {
    set({ activeViewId: firstViewId(ws), selection: null });
  }
}

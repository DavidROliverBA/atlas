/**
 * ⌘K command palette: fuzzy jump-to for every element and view in the
 * workspace. Read-only over the model except for the two actions it fronts —
 * both of which reuse existing, already-validated paths:
 *  - selecting an element/switching view (no model change), and
 *  - "place on current view", the same `placeOnView` dispatch + freeSpot
 *    layout ModelTree.tsx's "+ place" button and Palette.tsx's stencil
 *    buttons already use, gated by the same `VIEW_PLACEMENT` legality table.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { VIEW_PLACEMENT, type ElementKind, type Ulid, type ViewKind } from "@atlas/core";
import { KIND_LABELS, stencilFor } from "../stencils";
import { useAtlas } from "../store";
import { freeSpot } from "./Palette";

const VIEW_KIND_LABELS: Record<ViewKind, string> = {
  landscape: "Landscape",
  context: "System context",
  container: "Container",
  component: "Component",
  custom: "Custom",
};

const MAX_RESULTS = 12;

type ElementResult = {
  type: "element";
  id: Ulid;
  kind: ElementKind;
  name: string;
  breadcrumb: string;
  onActiveView: boolean;
  placeable: boolean;
  score: number;
};

type ViewResult = {
  type: "view";
  id: Ulid;
  kind: ViewKind;
  name: string;
  scopeName: string;
  score: number;
};

type PaletteResult = ElementResult | ViewResult;

/**
 * Substring matches score highest (earlier position and tighter length win);
 * otherwise a loose in-order subsequence match; `null` means no match. No
 * dependency needed — this is deliberately simple per the brief.
 */
function scoreField(query: string, field: string): number | null {
  const q = query.toLowerCase();
  const t = field.toLowerCase();
  const idx = t.indexOf(q);
  if (idx !== -1) return 10_000 - idx * 5 - (t.length - q.length);
  let cursor = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, cursor);
    if (found === -1) return null;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return 4_000 - gaps;
}

function bestScore(query: string, fields: string[]): number | null {
  let best: number | null = null;
  for (const f of fields) {
    if (!f) continue;
    const s = scoreField(query, f);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

export function CommandPalette() {
  const open = useAtlas((s) => s.paletteOpen);
  const ws = useAtlas((s) => s.ws);
  const rev = useAtlas((s) => s.rev);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const select = useAtlas((s) => s.select);
  const setActiveView = useAtlas((s) => s.setActiveView);
  const dispatch = useAtlas((s) => s.dispatch);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => useAtlas.setState({ paletteOpen: false });

  // Reset and autofocus every time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const view = ws.views.get(activeViewId);

  const results = useMemo<PaletteResult[]>(() => {
    if (!open) return [];
    const q = query.trim();

    const elementResult = (id: Ulid, kind: ElementKind, name: string, breadcrumb: string, score: number): ElementResult => {
      const onActiveView = view?.placements.some((p) => p.elementId === id) ?? false;
      const placeable = !!view && !onActiveView && kind !== "group" && VIEW_PLACEMENT[view.kind].includes(kind);
      return { type: "element", id, kind, name, breadcrumb, onActiveView, placeable, score };
    };
    const viewResult = (id: Ulid, kind: ViewKind, name: string, scopeName: string, score: number): ViewResult => ({
      type: "view",
      id,
      kind,
      name,
      scopeName,
      score,
    });

    if (!q) {
      // No query: views first, then top-level elements, both alphabetical.
      const views = [...ws.views.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((v) => viewResult(v.id, v.kind, v.name, v.scopeId ? (ws.elements.get(v.scopeId)?.name ?? "") : "", 0));
      const roots = ws
        .children(null)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => elementResult(e.id, e.kind, e.name, "", 0));
      return [...views, ...roots].slice(0, MAX_RESULTS);
    }

    const scored: PaletteResult[] = [];
    for (const v of ws.views.values()) {
      const scopeName = v.scopeId ? (ws.elements.get(v.scopeId)?.name ?? "") : "";
      const score = bestScore(q, [v.name, VIEW_KIND_LABELS[v.kind], scopeName]);
      if (score !== null) scored.push(viewResult(v.id, v.kind, v.name, scopeName, score));
    }
    for (const e of ws.elements.values()) {
      const breadcrumb = ws
        .ancestors(e.id)
        .reverse()
        .map((a) => a.name)
        .join(" / ");
      const score = bestScore(q, [e.name, KIND_LABELS[e.kind], breadcrumb]);
      if (score !== null) scored.push(elementResult(e.id, e.kind, e.name, breadcrumb, score));
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_RESULTS);
    // `ws`/`view` are mutable instances commands update in place (same
    // pitfall noted in TimelineBar's estateTco memo) — `rev` has to be
    // listed explicitly or results go stale after a live model change
    // (e.g. Tab-placing a result) while the palette stays open.
  }, [open, query, ws, view, rev]);

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(results.length - 1, 0)));
  }, [results.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const runResult = (result: PaletteResult) => {
    if (result.type === "view") {
      setActiveView(result.id);
    } else {
      // Selecting always happens; the store exposes no canvas centring API to
      // pan/zoom to the node even when it is on the active view, so selection
      // (which highlights the node — see Canvas.tsx's `selected` mapping) is
      // as far as this action can go without touching Canvas.tsx.
      select({ type: "element", id: result.id });
    }
    close();
  };

  const placeResult = (result: ElementResult) => {
    if (!view || !result.placeable) return;
    dispatch({
      type: "placeOnView",
      viewId: view.id,
      placement: { elementId: result.id, ...freeSpot(view.placements) },
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const result = results[activeIndex];
      if (result) runResult(result);
    } else if (e.key === "Tab") {
      // Repurposed for the secondary "place on view" action — never lets
      // focus escape the modal.
      e.preventDefault();
      const result = results[activeIndex];
      if (result?.type === "element" && result.placeable) placeResult(result);
    }
  };

  return (
    <div
      data-testid="cmdk"
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 pt-[12vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <input
          ref={inputRef}
          data-testid="cmdk-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to an element or view…"
          className="w-full border-b border-slate-200 px-4 py-3 text-sm text-slate-800 focus:outline-none"
        />
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No matches.</p>}
          {results.map((result, i) => {
            const active = i === activeIndex;
            const key = `${result.type}-${result.id}`;
            const rowClass = `flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm ${
              active ? "bg-blue-50 text-blue-900" : "text-slate-700"
            }`;

            if (result.type === "view") {
              return (
                <div
                  key={key}
                  data-testid="cmdk-result"
                  data-index={i}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => runResult(result)}
                  className={rowClass}
                >
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                    {VIEW_KIND_LABELS[result.kind]} view
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {result.name}
                    {result.scopeName && <span className="ml-1.5 text-xs text-slate-400">of {result.scopeName}</span>}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={key}
                data-testid="cmdk-result"
                data-index={i}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => runResult(result)}
                className={rowClass}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${stencilFor(result.kind).chipClass}`} />
                <span className="min-w-0 flex-1 truncate">
                  {result.name}
                  {result.breadcrumb && <span className="ml-1.5 text-xs text-slate-400">{result.breadcrumb}</span>}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
                  {KIND_LABELS[result.kind]}
                </span>
                {result.onActiveView ? (
                  <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-600">
                    on view
                  </span>
                ) : (
                  result.placeable && (
                    <button
                      data-testid="cmdk-place"
                      title="Place on current view (Tab)"
                      onClick={(e) => {
                        e.stopPropagation();
                        placeResult(result);
                        close();
                      }}
                      className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-300"
                    >
                      + place
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-1.5 text-[11px] text-slate-400">
          <span>↑↓ navigate</span>
          <span>Enter select / switch view</span>
          <span>Tab place on view</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}

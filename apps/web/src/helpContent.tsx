/**
 * In-app user guide content: static per-section copy for the HelpPanel, plus
 * the worked-example "Load demo model" batch used by its Getting-started
 * section. Kept separate from HelpPanel.tsx so the copy can be reviewed
 * without wading through component/layout code.
 */

import type { ReactNode } from "react";
import type { Command, Element, NamedState, Relationship, Ulid, View } from "@atlas/core";

export interface HelpSection {
  id: string;
  title: string;
  body: ReactNode;
}

const ul = "list-disc space-y-1 pl-4";
const code = "rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]";

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    body: (
      <div className="space-y-2">
        <p>
          Atlas is <strong>model-first</strong>: people, systems, containers, components and
          groups exist once in the model, independent of any diagram. Views are just
          projections — placements of existing elements on a canvas. Edit a field in the
          Inspector and every view that shows that element updates.
        </p>
        <p>
          The <strong>model tree</strong> (left sidebar, below the palette) lists the full
          containment hierarchy, including elements not placed on the current view. A small
          orange dot means an element is not on any view yet; hover a tree row for a
          "+ place" shortcut to add it to the current view.
        </p>
        <p>
          The <strong>palette</strong> (left sidebar, top) is grouped by C4 level — Context,
          Container, Component, Boundaries — with a search box and a "Packs…" manager for
          enabling stencil packs (AWS, Azure, GCP, generic tech, and the C4 core shapes).
          Stencils that don't belong on the current view are greyed out; click a usable one to
          drop it onto the canvas.
        </p>
      </div>
    ),
  },
  {
    id: "building",
    title: "Building a model",
    body: (
      <div className="space-y-2">
        <p>Containment rules, enforced everywhere (UI, AI, CLI, API):</p>
        <ul className={ul}>
          <li>Person and Software System — always top level.</li>
          <li>Container — only inside a System.</li>
          <li>Component — only inside a Container.</li>
          <li>Group (boundary) — top level, inside a System, or inside a Container.</li>
        </ul>
        <p>Which view kind each element kind can appear on:</p>
        <ul className={ul}>
          <li>
            <strong>Landscape / Context views</strong> — People, Systems and Groups only.
          </li>
          <li>
            <strong>Container views</strong> — Systems, Containers and Groups.
          </li>
          <li>
            <strong>Component views</strong> — Containers, Components and Groups. Every
            AWS/Azure/GCP stencil creates a Component, so cloud-service shapes only ever
            belong on a Component view.
          </li>
          <li>
            <strong>Custom views</strong> — Systems, Containers and Groups (a free mid-level
            canvas).
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: "canvas",
    title: "Canvas",
    body: (
      <div className="space-y-2">
        <ul className={ul}>
          <li>Drag a box and pink dashed alignment guides appear against nearby boxes' edges and centres.</li>
          <li>
            Hover a box to reveal its 16 connection ports (5 along the top, 5 along the
            bottom, 3 on each side) — drag from a port on one box to a port on another to
            create a relationship pinned to those exact ports.
          </li>
          <li>
            Boxes that line up on the grid get a dead-straight connector automatically
            (facing mid-ports); anything else gets an orthogonal routed line.
          </li>
          <li>
            Once a line is pinned to specific ports, the Inspector's relationship panel shows
            "Reset routing on this view" to release it back to auto-routing.
          </li>
          <li>Box colour and line colour are set in the Inspector, with a "Reset to default" option.</li>
          <li>The minimap (bottom-left of the canvas) is pannable and zoomable.</li>
          <li>
            The toolbar's <strong>Auto-layout</strong> button re-arranges the current view with
            ELK's layered algorithm as one undoable step.
          </li>
          <li>
            The <strong>2D / Iso</strong> toggle (top-right of the canvas) switches the current
            view's render mode between flat 2D and an isometric projection of the same
            coordinates.
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: "inspector",
    title: "Inspector",
    body: (
      <div className="space-y-2">
        <p>Selecting an element or relationship shows its full field set:</p>
        <ul className={ul}>
          <li>Name, short description, and long-form <strong>Markdown documentation</strong> with Write/Preview tabs.</li>
          <li>Status (lifecycle) and criticality; technology and tags as comma-separated lists.</li>
          <li>Box colour (elements) or line colour (relationships).</li>
          <li>Time: validity dates and named-state membership (see the Time section below).</li>
          <li>Costs (see Costs &amp; TCO below).</li>
          <li>
            <strong>Stencil attributes</strong> — for elements created from a stencil pack (e.g.
            an AWS resource), fields are generated from that stencil's JSON Schema, such as an
            account id or region.
          </li>
          <li>Owners, team, external links, and "Appears in" — every view the element is placed on.</li>
          <li>Actions: open the Connections view (all relationships), remove from this view, or delete from the model entirely.</li>
        </ul>
      </div>
    ),
  },
  {
    id: "time",
    title: "Time",
    body: (
      <div className="space-y-2">
        <p>
          Any element, relationship or cost entry can carry a <span className={code}>validFrom</span> /
          <span className={code}>validTo</span> date range, or explicit membership in
          <strong> named states</strong> (e.g. "Current", "Target 2028") — explicit membership
          always wins over dates.
        </p>
        <p>
          Manage states from the timeline bar's "⚙ States" control: add, rename, date or
          delete them. The <strong>scrubber</strong> at the bottom of the screen picks any
          month; the "All time" chip and one chip per named state give one-click jumps.
        </p>
        <p>
          "Compare A → B" (shown once at least two states exist) overlays a diff on the
          canvas — green rings for additions, red dashed for removals, amber for changes —
          plus a text change report and a cost-delta summary underneath.
        </p>
      </div>
    ),
  },
  {
    id: "costs",
    title: "Costs & TCO",
    body: (
      <div className="space-y-2">
        <p>
          Add cost entries from the Inspector's collapsible <strong>Costs</strong> section
          ("+ Add cost"). Each entry has a category, a classification (run / change / acquire
          / retire), and is either:
        </p>
        <ul className={ul}>
          <li><strong>Recurring</strong> — an amount per month or per year.</li>
          <li><strong>One-off</strong> — a lump sum, straight-line amortised over a number of years (3 by default).</li>
        </ul>
        <p>
          Open the toolbar's <strong>Analysis</strong> drawer for the estate-wide TCO table:
          pick a horizon (1/3/5/10 years), export it as CSV, and toggle the
          <strong> cost overlay</strong> to tint canvas boxes red/amber by rolled-up annual
          cost with a small badge in the corner. The timeline bar always shows a run-rate
          chip for the active time context, and adds annual/TCO deltas when comparing two
          states.
        </p>
        <p>Use the button below to load a small worked example with costs already attached.</p>
      </div>
    ),
  },
  {
    id: "analysis",
    title: "Analysis",
    body: (
      <div className="space-y-2">
        <p>The toolbar's <strong>Analysis</strong> drawer has three estate-wide reports, alongside TCO:</p>
        <ul className={ul}>
          <li><strong>Consistency report</strong> (lint) — flags orphaned or inconsistent elements; click an issue to select it.</li>
          <li><strong>Dependency matrix</strong> — relationship counts between top-level systems.</li>
          <li><strong>Impact analysis</strong> — pick any element to list everything downstream of it.</li>
        </ul>
      </div>
    ),
  },
  {
    id: "ai",
    title: "AI assistant",
    body: (
      <div className="space-y-2">
        <p>
          The "AI chat" tab (top-right, next to Inspector) lets you describe changes in plain
          language. It needs either a personal Anthropic API key (stored only in this browser)
          or a signed-in GitHub session on the hosted deployment.
        </p>
        <p>
          The assistant never edits your model directly — it plans against a private clone and
          returns a <strong>proposal</strong>: a numbered summary of every change. Click
          <strong> Apply</strong> to commit the whole proposal as one undoable batch, or
          <strong> Discard</strong> to drop it. It can create elements, relationships and
          views, place elements on a view, update fields, set temporal validity/state
          membership, and set cost entries.
        </p>
      </div>
    ),
  },
  {
    id: "saving",
    title: "Saving & sharing",
    body: (
      <div className="space-y-2">
        <p>
          The toolbar's workspace-source selector switches between <strong>Local workspace</strong>
          (saved to this browser only) and <strong>Shared database</strong> mode, which mirrors a
          server-side workspace through the model REST API and needs a signed-in GitHub
          session; use "Sync" to pull in remote changes.
        </p>
        <p>
          <strong>Export ▾</strong> writes a workspace bundle (.json), the current view as
          SVG/PNG, or the current view as Mermaid C4 / PlantUML C4. <strong>Import</strong>
          reads an Atlas bundle, Structurizr JSON, or ArchiMate Open Exchange XML.
        </p>
        <p>
          Every mutation also goes through the same REST API used by this UI and the AI —
          see the interactive reference at{" "}
          <a href="/api/docs" target="_blank" rel="noreferrer" className="text-blue-600 underline">
            /api/docs
          </a>
          . The full written walkthrough of every feature lives in{" "}
          <a
            href="https://github.com/DavidROliverBA/atlas/blob/main/docs/user-guide.md"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline"
          >
            docs/user-guide.md
          </a>
          .
        </p>
      </div>
    ),
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    body: (
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-400">
            <th className="py-1 pr-2 font-semibold">Shortcut</th>
            <th className="py-1 font-semibold">Action</th>
          </tr>
        </thead>
        <tbody className="align-top">
          <tr>
            <td className="py-1 pr-2 font-mono">⌘Z / Ctrl+Z</td>
            <td className="py-1">Undo the last command (or whole batch)</td>
          </tr>
          <tr>
            <td className="py-1 pr-2 font-mono">⇧⌘Z / Ctrl+Shift+Z</td>
            <td className="py-1">Redo</td>
          </tr>
          <tr>
            <td className="py-1 pr-2 font-mono">Esc</td>
            <td className="py-1">Deselect the current element or relationship</td>
          </tr>
          <tr>
            <td className="py-1 pr-2 font-mono">Delete / Backspace</td>
            <td className="py-1">
              Remove the selected element from this view (stays in the model), or delete the
              selected relationship entirely
            </td>
          </tr>
          <tr>
            <td className="py-1 pr-2 font-mono">Enter (Inspector Name field)</td>
            <td className="py-1">Commit the new name</td>
          </tr>
          <tr>
            <td className="py-1 pr-2 font-mono">Enter (AI chat box)</td>
            <td className="py-1">Send the message (Shift+Enter for a new line)</td>
          </tr>
        </tbody>
      </table>
    ),
  },
];

/**
 * Builds the "Load demo model" worked example as a single command-bus batch
 * (one undo step): a Person, two Systems, a costed Container inside one of
 * them, their relationships, a landscape view laid out left to right, and
 * two named states so the temporal/TCO features have something to show.
 *
 * `nextId` should be the store's `newId`, so ids come from the same ULID
 * factory as everything else in the workspace. Returns the batch command
 * alongside the new landscape view's id, so the caller can switch to it
 * (a `batch` only mutates the model — it doesn't touch UI state like the
 * active view).
 */
export function buildDemoModelCommand(nextId: () => Ulid): { command: Command; viewId: Ulid } {
  const passengerId = nextId();
  const bookingId = nextId();
  const paymentsId = nextId();
  const paymentsApiId = nextId();
  const viewId = nextId();
  const currentStateId = nextId();
  const targetStateId = nextId();

  const passenger: Element = {
    id: passengerId,
    kind: "person",
    name: "Passenger",
    parentId: null,
    description: "Books and manages flights",
    tags: ["external"],
  };
  const booking: Element = {
    id: bookingId,
    kind: "system",
    name: "Booking Engine",
    parentId: null,
    description: "Reservations, ticketing and check-in",
    status: "live",
  };
  const payments: Element = {
    id: paymentsId,
    kind: "system",
    name: "Payments",
    parentId: null,
    description: "Card processing and settlement",
    status: "live",
  };
  const paymentsApi: Element = {
    id: paymentsApiId,
    kind: "container",
    name: "Payments API",
    parentId: paymentsId,
    description: "Authorises and captures card payments",
    technology: ["Node.js", "PostgreSQL"],
    costs: [
      {
        id: nextId(),
        label: "Payment gateway licence",
        category: "licences",
        classification: "run",
        kind: "recurring",
        amount: 42000,
        currency: "GBP",
        period: "annual",
      },
      {
        id: nextId(),
        label: "Platform build",
        category: "change",
        classification: "acquire",
        kind: "one-off",
        amount: 250000,
        currency: "GBP",
        amortiseYears: 3,
      },
    ],
    // Retires ahead of the "Target 2028" state below, so the timeline/diff
    // and TCO views have a real change to show.
    temporal: { validTo: "2027-12-31" },
  };

  const booksVia: Relationship = {
    id: nextId(),
    sourceId: passengerId,
    targetId: bookingId,
    name: "books flights via",
  };
  const takesPayment: Relationship = {
    id: nextId(),
    sourceId: bookingId,
    targetId: paymentsId,
    name: "takes payment via",
    technology: ["HTTPS", "REST"],
  };

  const landscape: View = {
    id: viewId,
    kind: "landscape",
    name: "Landscape",
    scopeId: null,
    placements: [
      { elementId: passengerId, x: 0, y: 4 },
      { elementId: bookingId, x: 16, y: 4 },
      { elementId: paymentsId, x: 32, y: 4 },
    ],
  };

  const today = new Date().toISOString().slice(0, 10);
  const current: NamedState = { id: currentStateId, name: "Current", date: today };
  const target: NamedState = { id: targetStateId, name: "Target 2028", date: "2028-01-01" };

  const commands: Command[] = [
    { type: "createElement", element: passenger },
    { type: "createElement", element: booking },
    { type: "createElement", element: payments },
    { type: "createElement", element: paymentsApi },
    { type: "createRelationship", relationship: booksVia },
    { type: "createRelationship", relationship: takesPayment },
    { type: "createView", view: landscape },
    { type: "createState", state: current },
    { type: "createState", state: target },
  ];

  return { command: { type: "batch", label: "Load demo model", commands }, viewId };
}

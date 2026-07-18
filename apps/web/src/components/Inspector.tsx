import { useState } from "react";
import Markdown from "react-markdown";
import type { Criticality, Element, Lifecycle, Relationship, Ulid } from "@atlas/core";
import { KIND_LABELS } from "../stencils";
import { useAtlas } from "../store";

const STATUSES: Lifecycle[] = ["proposed", "planned", "live", "deprecated", "decommissioned"];
const CRITICALITIES: Criticality[] = ["low", "medium", "high", "critical"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none";

/** Comma-separated list editor mapped to string[] | null. */
function listFrom(value: string): string[] | null {
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : null;
}

function ElementInspector({ element }: { element: Element }) {
  const ws = useAtlas((s) => s.ws);
  const dispatch = useAtlas((s) => s.dispatch);
  const select = useAtlas((s) => s.select);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const setActiveView = useAtlas((s) => s.setActiveView);
  const [docTab, setDocTab] = useState<"write" | "preview">("write");

  const update = (changes: Record<string, unknown>) =>
    dispatch({ type: "updateElement", id: element.id, changes: changes as never });

  const view = ws.views.get(activeViewId);
  const onActiveView = view?.placements.some((p) => p.elementId === element.id) ?? false;
  const appearsIn = ws.viewsContaining(element.id);

  return (
    <div className="flex flex-col gap-3" data-testid="inspector-element">
      <div>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
          {KIND_LABELS[element.kind]}
        </span>
      </div>

      <Field label="Name">
        <input
          key={element.id}
          data-testid="inspector-name"
          className={inputClass}
          defaultValue={element.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== element.name) update({ name });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </Field>

      <Field label="Description">
        <input
          key={element.id}
          data-testid="inspector-description"
          className={inputClass}
          defaultValue={element.description ?? ""}
          placeholder="Short display description"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (element.description ?? "")) update({ description: v || null });
          }}
        />
      </Field>

      <Field label="Documentation (Markdown)">
        <div className="mb-1 flex gap-1">
          {(["write", "preview"] as const).map((tab) => (
            <button
              key={tab}
              data-testid={`doc-tab-${tab}`}
              onClick={() => setDocTab(tab)}
              className={`rounded px-2 py-0.5 text-xs ${
                docTab === tab ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {tab === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
        {docTab === "write" ? (
          <textarea
            key={element.id}
            data-testid="inspector-documentation"
            className={`${inputClass} min-h-24 font-mono text-xs`}
            defaultValue={element.documentation ?? ""}
            placeholder="Long-form documentation in Markdown…"
            onBlur={(e) => {
              const v = e.target.value;
              if (v !== (element.documentation ?? "")) update({ documentation: v || null });
            }}
          />
        ) : (
          <div
            data-testid="doc-preview"
            className="prose prose-sm max-w-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm [&_h2]:mt-0 [&_h2]:text-base"
          >
            <Markdown>{element.documentation ?? "*Nothing documented yet.*"}</Markdown>
          </div>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Status">
          <select
            data-testid="inspector-status"
            className={inputClass}
            value={element.status ?? ""}
            onChange={(e) => update({ status: e.target.value || null })}
          >
            <option value="">—</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Criticality">
          <select
            data-testid="inspector-criticality"
            className={inputClass}
            value={element.criticality ?? ""}
            onChange={(e) => update({ criticality: e.target.value || null })}
          >
            <option value="">—</option>
            {CRITICALITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Technology (comma-separated)">
        <input
          key={element.id}
          data-testid="inspector-technology"
          className={inputClass}
          defaultValue={element.technology?.join(", ") ?? ""}
          onBlur={(e) => update({ technology: listFrom(e.target.value) })}
        />
      </Field>

      <Field label="Tags (comma-separated)">
        <input
          key={element.id}
          data-testid="inspector-tags"
          className={inputClass}
          defaultValue={element.tags?.join(", ") ?? ""}
          onBlur={(e) => update({ tags: listFrom(e.target.value) })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Owners">
          <input
            key={element.id}
            className={inputClass}
            defaultValue={element.owners?.join(", ") ?? ""}
            onBlur={(e) => update({ owners: listFrom(e.target.value) })}
          />
        </Field>
        <Field label="Team">
          <input
            key={element.id}
            className={inputClass}
            defaultValue={element.team ?? ""}
            onBlur={(e) => update({ team: e.target.value.trim() || null })}
          />
        </Field>
      </div>

      <Field label="Links">
        <LinksEditor element={element} />
      </Field>

      <div>
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Appears in
        </span>
        {appearsIn.length === 0 && (
          <div className="text-xs text-orange-500" data-testid="appears-nowhere">
            Not placed on any view yet.
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {appearsIn.map((v) => (
            <button
              key={v.id}
              data-testid={`appears-in-${v.name}`}
              onClick={() => {
                useAtlas.setState({ navDirection: null });
                setActiveView(v.id);
                select({ type: "element", id: element.id });
              }}
              className="truncate rounded bg-slate-100 px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-200"
            >
              {v.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-1.5 border-t border-slate-200 pt-3">
        {onActiveView && (
          <button
            data-testid="remove-from-view"
            onClick={() =>
              dispatch({ type: "removeFromView", viewId: activeViewId, elementId: element.id })
            }
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Remove from this view
          </button>
        )}
        <button
          data-testid="delete-from-model"
          onClick={() => {
            if (
              window.confirm(
                `Delete "${element.name}" from the model? This removes it from every view and deletes its relationships.`,
              )
            ) {
              const error = dispatch({ type: "deleteElement", id: element.id });
              if (!error) select(null);
            }
          }}
          className="rounded-md border border-red-300 px-2 py-1.5 text-sm text-red-700 hover:bg-red-50"
        >
          Delete from model…
        </button>
      </div>
    </div>
  );
}

function LinksEditor({ element }: { element: Element }) {
  const dispatch = useAtlas((s) => s.dispatch);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const links = element.links ?? [];
  const save = (next: typeof links) =>
    dispatch({ type: "updateElement", id: element.id, changes: { links: (next.length ? next : null) as never } });
  return (
    <div className="flex flex-col gap-1">
      {links.map((l, i) => (
        <div key={i} className="flex items-center gap-1 text-xs">
          <a href={l.url} target="_blank" rel="noreferrer" className="truncate text-blue-600 underline">
            {l.title}
          </a>
          <button
            title="Remove link"
            onClick={() => save(links.filter((_, j) => j !== i))}
            className="ml-auto text-slate-400 hover:text-red-500"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex gap-1">
        <input
          className={`${inputClass} text-xs`}
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className={`${inputClass} text-xs`}
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="rounded-md bg-slate-800 px-2 text-xs text-white disabled:opacity-40"
          disabled={!title.trim() || !/^https?:\/\//.test(url)}
          onClick={() => {
            save([...links, { title: title.trim(), url: url.trim() }]);
            setTitle("");
            setUrl("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function RelationshipInspector({ relationship }: { relationship: Relationship }) {
  const ws = useAtlas((s) => s.ws);
  const dispatch = useAtlas((s) => s.dispatch);
  const select = useAtlas((s) => s.select);

  const update = (changes: Record<string, unknown>) =>
    dispatch({ type: "updateRelationship", id: relationship.id, changes: changes as never });

  const source = ws.elements.get(relationship.sourceId);
  const target = ws.elements.get(relationship.targetId);

  return (
    <div className="flex flex-col gap-3" data-testid="inspector-relationship">
      <div className="rounded-md bg-slate-100 px-2 py-1.5 text-xs text-slate-600">
        <span className="font-semibold">{source?.name}</span> →{" "}
        <span className="font-semibold">{target?.name}</span>
      </div>
      <Field label="Name / verb">
        <input
          key={relationship.id}
          data-testid="inspector-rel-name"
          className={inputClass}
          defaultValue={relationship.name ?? ""}
          placeholder="e.g. publishes events to"
          onBlur={(e) => update({ name: e.target.value.trim() || null })}
        />
      </Field>
      <Field label="Description">
        <input
          key={relationship.id}
          className={inputClass}
          defaultValue={relationship.description ?? ""}
          onBlur={(e) => update({ description: e.target.value.trim() || null })}
        />
      </Field>
      <Field label="Protocol / technology (comma-separated)">
        <input
          key={relationship.id}
          data-testid="inspector-rel-technology"
          className={inputClass}
          defaultValue={relationship.technology?.join(", ") ?? ""}
          onBlur={(e) => update({ technology: listFrom(e.target.value) })}
        />
      </Field>
      <Field label="Direction">
        <select
          className={inputClass}
          value={relationship.direction ?? "forward"}
          onChange={(e) => update({ direction: e.target.value === "forward" ? null : e.target.value })}
        >
          <option value="forward">forward</option>
          <option value="bidirectional">bidirectional</option>
        </select>
      </Field>
      <Field label="Tags (comma-separated)">
        <input
          key={relationship.id}
          className={inputClass}
          defaultValue={relationship.tags?.join(", ") ?? ""}
          onBlur={(e) => update({ tags: listFrom(e.target.value) })}
        />
      </Field>
      <button
        data-testid="delete-relationship"
        onClick={() => {
          const error = dispatch({ type: "deleteRelationship", id: relationship.id });
          if (!error) select(null);
        }}
        className="mt-2 rounded-md border border-red-300 px-2 py-1.5 text-sm text-red-700 hover:bg-red-50"
      >
        Delete relationship
      </button>
    </div>
  );
}

export function Inspector() {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const selection = useAtlas((s) => s.selection);

  let body: React.ReactNode;
  if (!selection) {
    body = (
      <p className="text-sm text-slate-400" data-testid="inspector-empty">
        Select an element or relationship to edit it. Objects are shared across every view —
        edits here update the whole model.
      </p>
    );
  } else if (selection.type === "element") {
    const el = ws.elements.get(selection.id as Ulid);
    body = el ? <ElementInspector element={el} /> : null;
  } else {
    const rel = ws.relationships.get(selection.id as Ulid);
    body = rel ? <RelationshipInspector relationship={rel} /> : null;
  }

  return (
    <div className="h-full overflow-y-auto p-3" data-testid="inspector">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Inspector
      </h2>
      {body}
    </div>
  );
}

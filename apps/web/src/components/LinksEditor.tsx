import type { Element, ExternalLink } from "@atlas/core";
import { useAtlas } from "../store";

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none";

/**
 * Itemised "reality links" editor (repos, cloud consoles, docs, ADRs): each
 * row's title/url is independently editable and removable, plus an "Add
 * link" row to append a blank one. Every mutation dispatches a single
 * `updateElement` carrying the complete new `links` array — the same
 * whole-array convention as CostsEditor and the other list fields here.
 */
export function LinksEditor({ element }: { element: Element }) {
  const dispatch = useAtlas((s) => s.dispatch);
  const links = element.links ?? [];

  const commit = (next: ExternalLink[]) =>
    dispatch({
      type: "updateElement",
      id: element.id,
      changes: { links: (next.length ? next : null) as never },
    });

  const updateRow = (i: number, patch: Partial<ExternalLink>) =>
    commit(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-1.5">
      {links.map((l, i) => (
        <div key={`${i}-${l.title}-${l.url}`} data-testid="link-row" className="flex items-center gap-1">
          <input
            data-testid="link-title"
            className={`${inputClass} flex-1`}
            placeholder="Title"
            defaultValue={l.title}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== l.title) updateRow(i, { title: v });
            }}
          />
          <input
            data-testid="link-url"
            type="url"
            className={`${inputClass} flex-[2]`}
            placeholder="https://…"
            defaultValue={l.url}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== l.url) updateRow(i, { url: v });
            }}
          />
          <button
            type="button"
            data-testid="link-remove"
            title="Remove link"
            onClick={() => commit(links.filter((_, j) => j !== i))}
            className="text-slate-400 hover:text-red-500"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid="link-add"
        onClick={() => commit([...links, { title: "", url: "" }])}
        className="self-start rounded-md bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700"
      >
        + Add link
      </button>
    </div>
  );
}

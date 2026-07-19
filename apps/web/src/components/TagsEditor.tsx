const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none";

/**
 * Chip-based tag editor. Existing tags render as removable chips; the text
 * input adds a new tag on Enter or comma. The caller owns the dispatch — it
 * gets the full next array (or `null` once it's empty), the same
 * whole-array-per-command convention as every other list field in the
 * inspector (technology, owners, costs, …).
 */
export function TagsEditor({
  tags,
  onChange,
}: {
  tags: string[] | undefined;
  onChange: (next: string[] | null) => void;
}) {
  const items = tags ?? [];

  const commitDraft = (input: HTMLInputElement, raw: string) => {
    const value = raw.trim();
    input.value = "";
    if (!value || items.includes(value)) return;
    onChange([...items, value]);
  };

  const removeTag = (tag: string) => {
    const next = items.filter((t) => t !== tag);
    onChange(next.length ? next : null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {items.map((tag) => (
          <span
            key={tag}
            data-testid="tag-chip"
            className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
          >
            {tag}
            <button
              type="button"
              title={`Remove ${tag}`}
              onClick={() => removeTag(tag)}
              className="text-slate-400 hover:text-red-500"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        data-testid="tag-input"
        className={inputClass}
        placeholder="Add a tag…"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commitDraft(e.target as HTMLInputElement, (e.target as HTMLInputElement).value);
          }
        }}
        onBlur={(e) => commitDraft(e.target, e.target.value)}
      />
    </div>
  );
}

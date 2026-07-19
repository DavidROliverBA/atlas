/**
 * In-app user guide: a right-hand slide-over drawer (same pattern as
 * AnalysisDrawer) with a collapsible-section tour of every feature, plus a
 * one-click worked example that loads through the same command bus every
 * other mutation path uses (single undo step).
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { buildDemoModelCommand, HELP_SECTIONS } from "../helpContent";
import { useAtlas } from "../store";

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const dispatch = useAtlas((s) => s.dispatch);
  const newId = useAtlas((s) => s.newId);
  const setActiveView = useAtlas((s) => s.setActiveView);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["getting-started"]));

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hasElements = ws.elements.size > 0;

  const loadDemo = () => {
    if (hasElements) return;
    const { command, viewId } = buildDemoModelCommand(newId);
    const error = dispatch(command);
    if (!error) {
      setActiveView(viewId);
      onClose();
    }
  };

  return (
    <motion.aside
      data-testid="help-panel"
      className="absolute inset-y-0 right-0 z-30 flex w-[26rem] flex-col border-l border-slate-200 bg-white shadow-xl"
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">User guide</h2>
        <button
          data-testid="help-close"
          onClick={onClose}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Close
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {HELP_SECTIONS.map((section) => {
          const isOpen = open.has(section.id);
          return (
            <section
              key={section.id}
              data-testid="help-section"
              className="rounded-lg border border-slate-200"
            >
              <button
                type="button"
                data-testid={`help-section-toggle-${section.id}`}
                aria-expanded={isOpen}
                onClick={() => toggle(section.id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {section.title}
                </span>
                <span className="text-slate-400">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && (
                <div className="border-t border-slate-100 px-3 py-2.5 text-xs leading-relaxed text-slate-700">
                  {section.body}
                  {section.id === "getting-started" && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        data-testid="help-load-demo"
                        onClick={loadDemo}
                        disabled={hasElements}
                        title={
                          hasElements
                            ? "Available only on an empty workspace — clear the model first (e.g. Reset demo, then delete everything) to avoid clobbering it or creating duplicate names"
                            : "Load a small worked example: a Person, two Systems, a costed Container, their relationships, a landscape view and two named states"
                        }
                        className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-800"
                      >
                        Load demo model
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </motion.aside>
  );
}

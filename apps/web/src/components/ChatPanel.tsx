/**
 * AI chat panel (§3.7): build or alter the model conversationally. Changes
 * come back as a proposed change set, previewed here, and only touch the
 * model when the user clicks Apply — one batch, one undo step.
 *
 * Chat messages and any unapplied proposal persist to localStorage, keyed by
 * where the open workspace lives (local browser vs shared database) — see
 * `persistedKey`. On mount/restore, a pending proposal is re-validated by
 * dry-running its command batch against a throwaway clone of the current
 * workspace; if the model has since moved on and the batch no longer
 * applies, it's dropped with a visible notice rather than silently failing
 * on Apply.
 */

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { CommandBus, Workspace, type Command } from "@atlas/core";
import { DEFAULT_MODEL, runChatTurn, type ChangeSummaryItem } from "@atlas/ai";
import { stencilRegistry, useAtlas } from "../store";
import { sessionToken } from "../supabase";
import { useSession } from "./AuthGate";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Proposal {
  changeSet: Command;
  summary: ChangeSummaryItem[];
}

const KEY_STORAGE = "atlas.anthropic.apiKey";
const MODEL_STORAGE = "atlas.anthropic.model";

/** Model ids known to work well; "Other…" reveals a free-text field for anything else. */
const KNOWN_MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (default)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
] as const;
const OTHER_CHOICE = "other";

interface PersistedChatState {
  messages: ChatMessage[];
  proposal: Proposal | null;
}

function persistedKey(source: "local" | "db"): string {
  return `atlas.chat.${source}`;
}

function loadPersistedChat(source: "local" | "db"): PersistedChatState | null {
  try {
    const raw = localStorage.getItem(persistedKey(source));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedChatState;
    if (!Array.isArray(parsed.messages)) return null;
    return { messages: parsed.messages, proposal: parsed.proposal ?? null };
  } catch {
    return null;
  }
}

function savePersistedChat(source: "local" | "db", state: PersistedChatState): void {
  try {
    localStorage.setItem(persistedKey(source), JSON.stringify(state));
  } catch {
    // Storage full/unavailable — chat still works, it just won't survive reload.
  }
}

/** Dry-run a persisted proposal's command batch against a throwaway clone; true if it still applies cleanly. */
function proposalStillApplies(ws: Workspace, changeSet: Command): boolean {
  try {
    const clone = Workspace.fromData(structuredClone(ws.toData()));
    const bus = new CommandBus(clone, { stencils: stencilRegistry });
    bus.dispatch(changeSet);
    return true;
  } catch {
    return false;
  }
}

export function ChatPanel() {
  const ws = useAtlas((s) => s.ws);
  const dispatch = useAtlas((s) => s.dispatch);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const newId = useAtlas((s) => s.newId);
  const selection = useAtlas((s) => s.selection);
  const source = useAtlas((s) => s.source);

  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? "");
  const persistedModel = () => localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL;
  const [model, setModel] = useState(persistedModel);
  const [modelChoice, setModelChoice] = useState<string>(() => {
    const m = persistedModel();
    return KNOWN_MODELS.some((k) => k.id === m) ? m : OTHER_CHOICE;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [liveText, setLiveText] = useState("");
  const [toolNames, setToolNames] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const session = useSession();
  /** See the restore effect below — skips one stale save right after a restore. */
  const skipNextSave = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, proposal, busy, liveText]);

  // Restore chat + proposal for the current workspace source; re-validate the
  // proposal against the live model before trusting it's still applicable.
  //
  // `skipNextSave` guards the save effect below against a stale-closure race:
  // this effect's `setMessages`/`setProposal` calls don't take effect until
  // the next render, so without the guard the save effect (which runs in the
  // same pass, right after this one) would fire first with the *previous*
  // render's values — on a fresh mount that's the empty initial state — and
  // clobber the very data this effect just restored.
  useEffect(() => {
    skipNextSave.current = true;
    const persisted = loadPersistedChat(source);
    if (!persisted) {
      setMessages([]);
      setProposal(null);
      return;
    }
    setMessages(persisted.messages);
    if (persisted.proposal && proposalStillApplies(ws, persisted.proposal.changeSet)) {
      setProposal(persisted.proposal);
    } else if (persisted.proposal) {
      setProposal(null);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "⚠️ A previously proposed change no longer applies to the current model and was discarded." },
      ]);
    } else {
      setProposal(null);
    }
    // Restore is keyed on the workspace source only — re-running on every ws
    // change would re-validate (and potentially re-append the notice) on
    // every unrelated edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    savePersistedChat(source, { messages, proposal });
  }, [source, messages, proposal]);

  const send = async () => {
    const userMessage = input.trim();
    if (!userMessage || busy) return;
    // Signed-in users go through the token-secured proxy (no personal key
    // needed); a personal key always takes precedence and calls Anthropic
    // directly from the browser.
    let key = apiKey;
    let baseURL: string | undefined;
    if (!key) {
      const token = await sessionToken();
      if (token) {
        key = token;
        baseURL = `${window.location.origin}/api/anthropic`;
      } else {
        setShowSettings(true);
        return;
      }
    }
    setInput("");
    setProposal(null);
    setMessages((m) => [...m, { role: "user", content: userMessage }]);
    setBusy(true);
    setLiveText("");
    setToolNames([]);
    try {
      const result = await runChatTurn({
        apiKey: key,
        ...(baseURL ? { baseURL } : {}),
        model,
        history: messages,
        userMessage,
        ws,
        ids: { next: newId },
        activeViewId,
        selection,
        stencils: stencilRegistry,
        onText: (delta) => setLiveText((t) => t + delta),
        onTool: (name) => setToolNames((names) => (names.includes(name) ? names : [...names, name])),
      });
      setMessages((m) => [...m, { role: "assistant", content: result.text }]);
      if (result.changeSet) {
        setProposal({ changeSet: result.changeSet, summary: result.summary });
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `⚠️ ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setBusy(false);
      setLiveText("");
      setToolNames([]);
    }
  };

  const apply = () => {
    if (!proposal) return;
    const error = dispatch(proposal.changeSet);
    if (!error) {
      setMessages((m) => [...m, { role: "assistant", content: "✅ Changes applied (one undo step)." }]);
      setProposal(null);
    }
  };

  const discard = () => {
    setProposal(null);
    setMessages((m) => [...m, { role: "assistant", content: "Proposal discarded — nothing was changed." }]);
  };

  const selectModel = (choice: string) => {
    setModelChoice(choice);
    if (choice !== OTHER_CHOICE) {
      setModel(choice);
      localStorage.setItem(MODEL_STORAGE, choice);
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="chat-panel">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI assistant</h2>
        <button
          data-testid="chat-settings"
          onClick={() => setShowSettings((s) => !s)}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200"
        >
          {apiKey ? "Settings" : "Set API key"}
        </button>
      </div>

      {showSettings && (
        <div className="border-b border-slate-200 bg-slate-50 p-3" data-testid="chat-settings-panel">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Anthropic API key (stored locally)
          </label>
          <input
            data-testid="chat-api-key"
            type="password"
            className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={apiKey}
            placeholder="sk-ant-…"
            onChange={(e) => {
              setApiKey(e.target.value);
              localStorage.setItem(KEY_STORAGE, e.target.value);
            }}
          />
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Model
          </label>
          <select
            data-testid="chat-model-select"
            className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={modelChoice}
            onChange={(e) => selectModel(e.target.value)}
          >
            {KNOWN_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value={OTHER_CHOICE}>Other…</option>
          </select>
          {modelChoice === OTHER_CHOICE && (
            <input
              data-testid="chat-model-other"
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={model}
              placeholder="model id"
              onChange={(e) => {
                setModel(e.target.value);
                localStorage.setItem(MODEL_STORAGE, e.target.value);
              }}
            />
          )}
          <p className="mt-1 text-[11px] text-slate-400">
            The key never leaves this browser except to call the Anthropic API directly.
          </p>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" data-testid="chat-messages">
        {messages.length === 0 && (
          <p className="text-xs leading-relaxed text-slate-400">
            Ask for model changes in plain language, e.g. <em>“add a payments system connected to the
            booking engine over Kafka”</em>. Changes are proposed first — nothing is applied until you
            approve.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[95%] rounded-lg px-2.5 py-1.5 text-sm ${
              m.role === "user" ? "ml-auto bg-blue-600 text-white" : "bg-slate-100 text-slate-800"
            }`}
          >
            <Markdown>{m.content}</Markdown>
          </div>
        ))}
        {busy && (
          <div className="max-w-[95%] rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm text-slate-800" data-testid="chat-busy">
            {liveText ? <Markdown>{liveText}</Markdown> : <span className="text-slate-400">Thinking…</span>}
            {toolNames.length > 0 && (
              <div className="mt-1 text-[11px] italic text-slate-400" data-testid="chat-tool-status">
                using tools… {toolNames.join(", ")}
              </div>
            )}
          </div>
        )}
        {proposal && (
          <div
            data-testid="chat-proposal"
            className="rounded-lg border border-amber-300 bg-amber-50 p-2.5"
          >
            <div className="mb-1 text-xs font-semibold text-amber-800">
              Proposed changes ({proposal.summary.length})
            </div>
            <ul className="mb-2 space-y-0.5 text-xs text-amber-900">
              {proposal.summary.map((item, i) => (
                <li key={i}>• {item.description}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                data-testid="proposal-apply"
                onClick={apply}
                className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Apply
              </button>
              <button
                data-testid="proposal-discard"
                onClick={discard}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-2">
        <div className="flex gap-1.5">
          <textarea
            data-testid="chat-input"
            className="max-h-28 min-h-9 flex-1 resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
            placeholder={
              apiKey || session ? "Describe a change…" : "Set your API key first…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            data-testid="chat-send"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="rounded-md bg-slate-800 px-3 text-sm text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

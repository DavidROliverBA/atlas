/**
 * AI chat panel (§3.7): build or alter the model conversationally. Changes
 * come back as a proposed change set, previewed here, and only touch the
 * model when the user clicks Apply — one batch, one undo step.
 */

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { Command } from "@atlas/core";
import { DEFAULT_MODEL, runChatTurn, type ChangeSummaryItem } from "@atlas/ai";
import { useAtlas } from "../store";
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

export function ChatPanel() {
  const ws = useAtlas((s) => s.ws);
  const dispatch = useAtlas((s) => s.dispatch);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const newId = useAtlas((s) => s.newId);

  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? "");
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const session = useSession();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, proposal, busy]);

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
          <input
            data-testid="chat-model"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              localStorage.setItem(MODEL_STORAGE, e.target.value);
            }}
          />
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
          <div className="text-xs text-slate-400" data-testid="chat-busy">
            Thinking…
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

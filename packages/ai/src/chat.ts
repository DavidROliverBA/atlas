/**
 * The AI chat turn (brief §3.7): Anthropic Messages API with tool use, tools
 * mapped 1:1 onto the command bus. Mutating tools queue commands into a
 * ChangeSetBuilder (validated against a planning clone); the result of a turn
 * is assistant text plus a proposed change set the user applies or discards.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Workspace, Command, Ulid, UlidFactory } from "@atlas/core";
import { ChangeSetBuilder, ToolError, type ChangeSummaryItem } from "./changeset.js";
import { buildModelSummary, describeElement } from "./summary.js";

export const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOOL_ITERATIONS = 8;

const SYSTEM_PROMPT = `You are the modelling assistant inside Atlas, a C4 architecture modelling tool. You help the user build and evolve their architecture model conversationally.

Rules:
- The model is the source of truth; diagrams are projections. Elements are reusable objects.
- C4 kinds and containment: person and system live at the top level; container lives inside a system; component lives inside a container; group is a boundary and can nest anywhere (never a relationship endpoint).
- Diagram levels: people appear only on landscape/system-context views; components (including every AWS/Azure/GCP service) only on component views; containers on container/component views; systems on landscape/context/container/custom views; groups anywhere. place_on_view enforces this.
- Use the tools to make changes. Changes are queued as a proposal the user reviews — they are not applied until the user clicks Apply, so make all the changes the user asked for in one turn.
- Refer to existing elements by their exact names. Use query_model when unsure what exists.
- When creating elements that should be visible, also place them on a view (place_on_view defaults to the user's current view).
- Costs for TCO live on elements as cost entries (set_costs). Recurring entries normalise to annual; one-off entries amortise straight-line (default 3 years). Costs roll up through containment, so put a cost on the element that actually incurs it, not on its parent as well.
- delete_elements and delete_relationships remove things from the model entirely (and cascade — deleting an element takes its children, their relationships, and every view placement with it); remove_from_view only takes an element off one diagram and leaves the model untouched. Use the one the user actually means, and for a delete with a large blast radius confirm intent with the user rather than guessing.
- Keep replies short and factual. Summarise what you queued; do not claim changes are applied.`;

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: "query_model",
    description:
      "Inspect the current model. With no arguments returns a compact summary of all elements, relationships, views and states. Pass element_name for full detail on one element. Call this when the answer depends on model contents you have not seen this turn.",
    input_schema: {
      type: "object",
      properties: {
        element_name: { type: "string", description: "Optional element name for full detail" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_elements",
    description:
      "Queue creation of one or more model elements. Kinds: person|system|container|component|group. parent is the containing element's name (required for container→system and component→container).",
    input_schema: {
      type: "object",
      required: ["elements"],
      properties: {
        elements: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "kind"],
            properties: {
              name: { type: "string" },
              kind: { enum: ["person", "system", "container", "component", "group"] },
              parent: { type: "string", description: "Name of the containing element" },
              description: { type: "string" },
              technology: { type: "array", items: { type: "string" } },
              tags: { type: "array", items: { type: "string" } },
              color: { type: "string", description: "Hex box colour, e.g. #0ea5e9" },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "update_elements",
    description:
      "Queue updates to existing elements, referenced by name. Only include fields to change; set a field to null to clear it.",
    input_schema: {
      type: "object",
      required: ["updates"],
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string", description: "Current name of the element" },
              new_name: { type: "string" },
              description: { type: "string" },
              technology: { type: "array", items: { type: "string" } },
              status: { enum: ["proposed", "planned", "live", "deprecated", "decommissioned"] },
              tags: { type: "array", items: { type: "string" } },
              parent: { type: "string", description: "Move under this element (name)" },
              team: { type: "string" },
              color: { type: "string", description: "Hex box colour, e.g. #0ea5e9; null to reset" },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_relationships",
    description:
      "Queue relationships between existing (or just-created) elements, referenced by name. name is the verb phrase, e.g. 'publishes booking events to'.",
    input_schema: {
      type: "object",
      required: ["relationships"],
      properties: {
        relationships: {
          type: "array",
          items: {
            type: "object",
            required: ["source", "target"],
            properties: {
              source: { type: "string" },
              target: { type: "string" },
              name: { type: "string" },
              technology: { type: "array", items: { type: "string" } },
              tags: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_view",
    description: "Queue creation of a new view. scope is the element the view is about (omit for landscape/custom).",
    input_schema: {
      type: "object",
      required: ["name", "kind"],
      properties: {
        name: { type: "string" },
        kind: { enum: ["landscape", "context", "container", "component", "custom"] },
        scope: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "place_on_view",
    description:
      "Queue placement of existing elements onto a view. Omit view to use the user's currently open view. Elements already on the view are skipped.",
    input_schema: {
      type: "object",
      required: ["elements"],
      properties: {
        elements: { type: "array", items: { type: "string" } },
        view: { type: "string", description: "View name; defaults to the current view" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_costs",
    description:
      "Queue replacement of an element's cost entries (TCO). Pass the FULL list — it overwrites any existing entries; pass an empty list to clear. Amounts are positive numbers in whole currency units (GBP unless currency is set). Recurring entries count per period; one-off entries amortise over amortiseYears (default 3). validFrom/validTo/states scope an entry temporally, same as element validity.",
    input_schema: {
      type: "object",
      required: ["element", "costs"],
      properties: {
        element: { type: "string" },
        costs: {
          type: "array",
          items: {
            type: "object",
            required: ["label", "category", "classification", "kind", "amount"],
            properties: {
              label: { type: "string" },
              category: {
                enum: ["licences", "infrastructure", "people", "vendor-services", "change", "decommission", "other"],
              },
              classification: { enum: ["run", "change", "acquire", "retire"] },
              kind: { enum: ["recurring", "one-off"] },
              amount: { type: "number", description: "> 0, whole currency units" },
              currency: { type: "string", description: "ISO 4217, e.g. GBP (default)" },
              period: { enum: ["monthly", "annual"], description: "Recurring only; default annual" },
              amortiseYears: { type: "integer", description: "One-off only; default 3" },
              confidence: { enum: ["estimate", "quoted", "actual"] },
              validFrom: { type: "string", description: "YYYY-MM-DD" },
              validTo: { type: "string", description: "YYYY-MM-DD" },
              states: { type: "array", items: { type: "string" }, description: "Named-state names" },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "delete_elements",
    description:
      "Queue deletion of one or more elements, referenced by name. WARNING: this cascades — deleting an element also deletes everything it contains (children, grandchildren, ...), every relationship touching any of them, and removes all their placements from every view. For anything beyond a single leaf element, confirm the blast radius with the user rather than guessing what they meant; use query_model first if you are not sure what a deletion would take with it.",
    input_schema: {
      type: "object",
      required: ["elements"],
      properties: {
        elements: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "delete_relationships",
    description:
      "Queue deletion of one or more relationships, each identified by its source and target element names. If more than one relationship exists between the same pair, pass name (the verb phrase) to pick the right one; if it's still ambiguous you'll get an error listing the candidates to choose from.",
    input_schema: {
      type: "object",
      required: ["relationships"],
      properties: {
        relationships: {
          type: "array",
          items: {
            type: "object",
            required: ["source", "target"],
            properties: {
              source: { type: "string" },
              target: { type: "string" },
              name: {
                type: "string",
                description: "Verb phrase to disambiguate when several relationships exist between the same pair",
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "remove_from_view",
    description:
      "Queue removal of one or more elements' placements from a view — the elements stay in the model (and on any other views); this only changes this one diagram. Omit view to use the user's currently open view. Use delete_elements instead if the user wants the element gone from the model entirely.",
    input_schema: {
      type: "object",
      required: ["elements"],
      properties: {
        elements: { type: "array", items: { type: "string" } },
        view: { type: "string", description: "View name; defaults to the current view" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "delete_view",
    description:
      "Queue deletion of an entire view (diagram), referenced by name. The elements and relationships shown on it are untouched — only the view and its placements are removed.",
    input_schema: {
      type: "object",
      required: ["view"],
      properties: {
        view: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_temporal_state",
    description:
      "Queue temporal validity on an element: validFrom/validTo ISO dates (YYYY-MM-DD) and/or membership in named states.",
    input_schema: {
      type: "object",
      required: ["element"],
      properties: {
        element: { type: "string" },
        validFrom: { type: "string" },
        validTo: { type: "string" },
        states: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
];

export interface ChatTurnInput {
  apiKey: string;
  model?: string;
  /** Prior conversation (user/assistant text messages only). */
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  ws: Workspace;
  ids: UlidFactory;
  activeViewId: Ulid | null;
  baseURL?: string;
}

export interface ChatTurnResult {
  text: string;
  changeSet: Command | null;
  summary: ChangeSummaryItem[];
}

function executeTool(
  builder: ChangeSetBuilder,
  name: string,
  input: Record<string, unknown>,
): string {
  switch (name) {
    case "query_model": {
      const elementName = input["element_name"] as string | undefined;
      if (elementName) {
        return describeElement(builder.clone, elementName) ?? `No element named "${elementName}".`;
      }
      return buildModelSummary(builder.clone);
    }
    case "create_elements": {
      const created = (input["elements"] as never[]).map((e) => builder.createElement(e));
      return `Queued creation of: ${created.map((e) => e.name).join(", ")}.`;
    }
    case "update_elements": {
      for (const u of input["updates"] as Array<Record<string, unknown>>) {
        const { name: elementName, new_name, parent, ...rest } = u;
        const changes: Record<string, unknown> = { ...rest };
        if (new_name !== undefined) changes["name"] = new_name;
        if (parent !== undefined) {
          changes["parentId"] = parent === null ? null : builder.resolveElement(parent as string).id;
        }
        builder.updateElement(elementName as string, changes as never);
      }
      return "Updates queued.";
    }
    case "create_relationships": {
      const created = (input["relationships"] as never[]).map((r) => builder.createRelationship(r));
      return `Queued ${created.length} relationship(s).`;
    }
    case "create_view": {
      const view = builder.createView(input as never);
      return `Queued view "${view.name}".`;
    }
    case "place_on_view": {
      const view = builder.placeOnView(input["elements"] as string[], input["view"] as string | undefined);
      return `Placements queued on "${view.name}".`;
    }
    case "set_costs": {
      const count = builder.setCosts(input as never);
      return count === 0 ? "Costs cleared." : `Queued ${count} cost entr${count === 1 ? "y" : "ies"}.`;
    }
    case "set_temporal_state": {
      builder.setTemporal(input as never);
      return "Temporal change queued.";
    }
    case "delete_elements": {
      builder.deleteElements(input["elements"] as string[]);
      return "Deletion queued.";
    }
    case "delete_relationships": {
      builder.deleteRelationships(input["relationships"] as never);
      return "Deletion queued.";
    }
    case "remove_from_view": {
      const view = builder.removeFromView(input["elements"] as string[], input["view"] as string | undefined);
      return `Removed from "${view.name}" (elements remain in the model).`;
    }
    case "delete_view": {
      const view = builder.deleteView(input["view"] as string);
      return `Queued deletion of view "${view.name}".`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

/** Run one conversational turn: text in → assistant text + proposed change set out. */
export async function runChatTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
  const client = new Anthropic({
    apiKey: input.apiKey,
    dangerouslyAllowBrowser: true,
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
  });

  const builder = new ChangeSetBuilder(input.ws, input.ids, input.activeViewId);
  const activeViewName = input.activeViewId
    ? input.ws.views.get(input.activeViewId)?.name
    : undefined;

  const messages: Anthropic.MessageParam[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user" as const,
      content: `<model_summary>\n${buildModelSummary(input.ws)}\n</model_summary>\n<current_view>${activeViewName ?? "none"}</current_view>\n\n${input.userMessage}`,
    },
  ];

  let text = "";
  let lastStopReason: Anthropic.Message["stop_reason"] = null;
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: input.model ?? DEFAULT_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: AI_TOOLS,
      messages,
    });
    lastStopReason = response.stop_reason;

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim() || text;

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tool) => {
      try {
        return {
          type: "tool_result",
          tool_use_id: tool.id,
          content: executeTool(builder, tool.name, tool.input as Record<string, unknown>),
        };
      } catch (err) {
        const message =
          err instanceof ToolError || err instanceof Error ? err.message : String(err);
        return { type: "tool_result", tool_use_id: tool.id, content: message, is_error: true };
      }
    });
    messages.push({ role: "user", content: results });
  }

  // The loop only runs out of iterations while the model still wanted to call
  // tools (stop_reason === "tool_use" on the final round) — surface that so
  // the proposal isn't mistaken for a finished answer.
  const cappedNote =
    lastStopReason === "tool_use"
      ? `(Stopped after ${MAX_TOOL_ITERATIONS} tool rounds — the proposal below may be incomplete; ask me to continue.)`
      : "";
  const finalText = [text, cappedNote].filter(Boolean).join("\n\n");

  return {
    text: finalText || "(no reply)",
    changeSet: builder.toBatch("AI proposal"),
    summary: builder.summary,
  };
}

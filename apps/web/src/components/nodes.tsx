import { Handle, type NodeProps, type Node } from "@xyflow/react";
import type { Element } from "@atlas/core";
import { KIND_LABELS, stencilFor } from "../stencils";
import { stencilRegistry } from "../store";
import { PORTS } from "../ports";

/** Mix a #rrggbb colour towards white (amount 0..1) for a soft box fill. */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (255 - c) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** All 16 connection ports (5 top, 5 bottom, 3 per side). */
function NodePorts() {
  return (
    <>
      {PORTS.map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={port.position}
          className="atlas-port"
          style={
            port.side === "top" || port.side === "bottom"
              ? { left: `${port.frac * 100}%` }
              : { top: `${port.frac * 100}%` }
          }
        />
      ))}
    </>
  );
}

export type AtlasNodeData = {
  element: Element;
  drillable: boolean;
  /** Set when a state-diff overlay is active. */
  diffStatus?: "added" | "removed" | "changed";
  /** Set when the tag colour overlay matches this element. */
  tagged?: boolean;
};
export type AtlasNode = Node<AtlasNodeData, "atlas" | "atlasGroup">;

const DIFF_RING: Record<NonNullable<AtlasNodeData["diffStatus"]>, string> = {
  added: "ring-2 ring-emerald-500 ring-offset-2",
  removed: "ring-2 ring-red-500 ring-offset-2 opacity-60",
  changed: "ring-2 ring-amber-500 ring-offset-2",
};

const DIFF_BADGE: Record<NonNullable<AtlasNodeData["diffStatus"]>, { label: string; cls: string }> = {
  added: { label: "added", cls: "bg-emerald-500" },
  removed: { label: "removed", cls: "bg-red-500" },
  changed: { label: "changed", cls: "bg-amber-500" },
};

export function AtlasElementNode({ data, selected }: NodeProps<AtlasNode>) {
  const { element, drillable, diffStatus, tagged } = data;
  const stencil = stencilFor(element.kind);
  const customStyle = element.color
    ? { background: tint(element.color, 0.85), borderColor: element.color }
    : undefined;
  return (
    <div
      data-testid="canvas-node"
      data-elname={element.name}
      data-diff={diffStatus}
      data-tagged={tagged ? "true" : undefined}
      style={customStyle}
      className={`atlas-fade-in relative h-full w-full rounded-xl border-2 px-3 py-2 shadow-sm transition-shadow ${stencil.nodeClass} ${
        selected
          ? "ring-2 ring-blue-500 ring-offset-2"
          : diffStatus
            ? DIFF_RING[diffStatus]
            : tagged
              ? "ring-2 ring-fuchsia-500 ring-offset-2"
              : ""
      }`}
    >
      {diffStatus && (
        <span
          className={`absolute -top-2 right-2 rounded-full px-1.5 text-[9px] font-semibold uppercase tracking-wide text-white ${DIFF_BADGE[diffStatus].cls}`}
        >
          {DIFF_BADGE[diffStatus].label}
        </span>
      )}
      <NodePorts />
      <div className="flex items-start justify-between gap-1">
        {element.stencil && (
          <span
            data-testid="stencil-symbol"
            className="mt-0.5 h-6 w-6 shrink-0 [&_svg]:h-full [&_svg]:w-full"
            dangerouslySetInnerHTML={{
              __html: stencilRegistry.stencil(element.stencil)?.symbol2d ?? "",
            }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">{element.name}</div>
          <div className="text-[10px] uppercase tracking-wide opacity-60">
            {stencilRegistry.stencil(element.stencil ?? { pack: "", stencil: "" })?.name ??
              KIND_LABELS[element.kind]}
            {element.technology?.length ? ` · ${element.technology.join(", ")}` : ""}
          </div>
        </div>
        {drillable && (
          <span
            title="Double-click to zoom in"
            data-testid="drill-affordance"
            className="mt-0.5 shrink-0 rounded-full bg-white/70 px-1 text-[10px] leading-4 shadow-sm"
          >
            🔍
          </span>
        )}
      </div>
      {element.description && (
        <div className="mt-1 line-clamp-2 text-xs opacity-80">{element.description}</div>
      )}
    </div>
  );
}

export function AtlasGroupNode({ data, selected }: NodeProps<AtlasNode>) {
  const { element } = data;
  const stencil = stencilFor("group");
  return (
    <div
      data-testid="canvas-node"
      data-elname={element.name}
      className={`h-full w-full rounded-2xl border-2 px-3 py-1 ${stencil.nodeClass} ${
        selected ? "ring-2 ring-blue-500 ring-offset-2" : ""
      }`}
    >
      <div className="text-xs font-semibold opacity-70">{element.name}</div>
    </div>
  );
}

export const nodeTypes = { atlas: AtlasElementNode, atlasGroup: AtlasGroupNode };

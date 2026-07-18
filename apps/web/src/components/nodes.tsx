import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { Element } from "@atlas/core";
import { KIND_LABELS, stencilFor } from "../stencils";

export type AtlasNodeData = {
  element: Element;
  drillable: boolean;
};
export type AtlasNode = Node<AtlasNodeData, "atlas" | "atlasGroup">;

export function AtlasElementNode({ data, selected }: NodeProps<AtlasNode>) {
  const { element, drillable } = data;
  const stencil = stencilFor(element.kind);
  return (
    <div
      data-testid="canvas-node"
      data-elname={element.name}
      className={`h-full w-full rounded-xl border-2 px-3 py-2 shadow-sm transition-shadow ${stencil.nodeClass} ${
        selected ? "ring-2 ring-blue-500 ring-offset-2" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{element.name}</div>
          <div className="text-[10px] uppercase tracking-wide opacity-60">
            {KIND_LABELS[element.kind]}
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
      <Handle type="source" position={Position.Right} />
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

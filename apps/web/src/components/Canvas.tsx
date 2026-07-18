import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type Node,
} from "@xyflow/react";
import { autoRoute, pinnedPortsAligned, type Box } from "../ports";
import { motion } from "framer-motion";
import {
  diffContexts,
  effectiveElement,
  visibleElements,
  visibleRelationships,
  type Element,
  type StateDiff,
  type Ulid,
} from "@atlas/core";
import { DEFAULT_H, DEFAULT_W, GRID, useAtlas } from "../store";
import { nodeTypes, type AtlasNode } from "./nodes";
import { IsoCanvas } from "./IsoCanvas";

const GROUP_W = 18;
const GROUP_H = 12;

function toNode(
  element: Element,
  x: number,
  y: number,
  w: number | undefined,
  h: number | undefined,
  drillable: boolean,
  diffStatus?: "added" | "removed" | "changed",
): AtlasNode {
  const isGroup = element.kind === "group";
  return {
    id: element.id,
    type: isGroup ? "atlasGroup" : "atlas",
    position: { x: x * GRID, y: y * GRID },
    width: (w ?? (isGroup ? GROUP_W : DEFAULT_W)) * GRID,
    height: (h ?? (isGroup ? GROUP_H : DEFAULT_H)) * GRID,
    zIndex: isGroup ? -1 : 0,
    data: { element, drillable, diffStatus },
  };
}

function elementDiffStatus(diff: StateDiff, id: Ulid): "added" | "removed" | "changed" | undefined {
  if (diff.addedElements.includes(id)) return "added";
  if (diff.removedElements.includes(id)) return "removed";
  if (diff.changedElements.some((c) => c.id === id)) return "changed";
  return undefined;
}

function CanvasInner() {
  const ws = useAtlas((s) => s.ws);
  const rev = useAtlas((s) => s.rev);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const selection = useAtlas((s) => s.selection);
  const dispatch = useAtlas((s) => s.dispatch);
  const select = useAtlas((s) => s.select);
  const newId = useAtlas((s) => s.newId);
  const drillInto = useAtlas((s) => s.drillInto);
  const setActiveView = useAtlas((s) => s.setActiveView);
  const { fitView } = useReactFlow();

  const [nodes, setNodes] = useState<Node[]>([]);

  const temporal = useAtlas((s) => s.temporal);
  const diffPair = useAtlas((s) => s.diffPair);
  const highlightTag = useAtlas((s) => s.highlightTag);

  const derived = useMemo(() => {
    const view = ws.views.get(activeViewId);
    if (!view) return { nodes: [] as AtlasNode[], edges: [] as Edge[] };

    // Temporal lens: plain context filtering, or a two-context diff overlay.
    const diff = diffPair ? diffContexts(ws, diffPair.a, diffPair.b) : null;
    const visA = diffPair ? visibleElements(ws, diffPair.a) : null;
    const visB = diffPair ? visibleElements(ws, diffPair.b) : null;
    const vis = !diffPair && temporal.type !== "all" ? visibleElements(ws, temporal) : null;
    const visRels = vis ? visibleRelationships(ws, temporal, vis) : null;
    const relsA = diffPair && visA ? visibleRelationships(ws, diffPair.a, visA) : null;
    const relsB = diffPair && visB ? visibleRelationships(ws, diffPair.b, visB) : null;

    const elementVisible = (id: Ulid) =>
      diffPair ? (visA?.has(id) ?? false) || (visB?.has(id) ?? false) : vis ? vis.has(id) : true;
    const relationshipVisible = (id: Ulid) =>
      diffPair
        ? (relsA?.has(id) ?? false) || (relsB?.has(id) ?? false)
        : visRels
          ? visRels.has(id)
          : true;
    const displayCtx = diffPair ? diffPair.b : temporal;

    const placed = new Set(view.placements.map((p) => p.elementId));
    // Box geometry in px, for routing decisions.
    const boxes = new Map<Ulid, Box>();
    for (const p of view.placements) {
      const el = ws.elements.get(p.elementId);
      if (!el) continue;
      const isGroup = el.kind === "group";
      boxes.set(p.elementId, {
        x: p.x * GRID,
        y: p.y * GRID,
        w: (p.width ?? (isGroup ? GROUP_W : DEFAULT_W)) * GRID,
        h: (p.height ?? (isGroup ? GROUP_H : DEFAULT_H)) * GRID,
      });
    }
    const nodes = view.placements
      .map((p) => {
        const el = ws.elements.get(p.elementId);
        if (!el || !elementVisible(el.id)) return null;
        const drillable =
          (el.kind === "system" || el.kind === "container") && ws.children(el.id).length > 0;
        const shown =
          diff && elementDiffStatus(diff, el.id) === "removed"
            ? effectiveElement(el, diffPair!.a)
            : effectiveElement(el, displayCtx);
        const node = toNode(shown, p.x, p.y, p.width, p.height, drillable, diff ? elementDiffStatus(diff, el.id) : undefined);
        node.data.tagged = highlightTag !== null && (el.tags?.includes(highlightTag) ?? false);
        return node;
      })
      .filter((n): n is AtlasNode => n !== null);
    const edges: Edge[] = [...ws.relationships.values()]
      .filter(
        (r) =>
          placed.has(r.sourceId) &&
          placed.has(r.targetId) &&
          relationshipVisible(r.id) &&
          elementVisible(r.sourceId) &&
          elementVisible(r.targetId) &&
          !view.hiddenRelationshipIds?.includes(r.id),
      )
      .map((r) => {
        // Routing: pinned ports from the view, else the auto-route rule
        // (aligned boxes → facing mid-ports → straight line).
        const fromBox = boxes.get(r.sourceId)!;
        const toBox = boxes.get(r.targetId)!;
        const pinned = view.edgeAnchors?.[r.id];
        const route = pinned
          ? {
              source: pinned.source,
              target: pinned.target,
              straight: pinnedPortsAligned(fromBox, toBox, pinned.source, pinned.target),
            }
          : autoRoute(fromBox, toBox);
        const stroke = r.color ?? "#64748b";
        const diffStyle = diff
          ? diff.addedRelationships.includes(r.id)
            ? { stroke: "#10b981", strokeWidth: 2 }
            : diff.removedRelationships.includes(r.id)
              ? { stroke: "#ef4444", strokeDasharray: "6 4", strokeWidth: 2 }
              : undefined
          : undefined;
        return {
          id: r.id,
          source: r.sourceId,
          target: r.targetId,
          sourceHandle: route.source,
          targetHandle: route.target,
          label: r.name,
          type: route.straight ? "straight" : "smoothstep",
          selected: selection?.type === "relationship" && selection.id === r.id,
          style: diffStyle ?? (r.color ? { stroke, strokeWidth: 2 } : undefined),
          markerEnd: { type: MarkerType.ArrowClosed, color: diffStyle?.stroke ?? stroke },
          ...(r.direction === "bidirectional"
            ? { markerStart: { type: MarkerType.ArrowClosed, color: diffStyle?.stroke ?? stroke } }
            : {}),
        };
      });
    return { nodes, edges };
  }, [ws, rev, activeViewId, selection, temporal, diffPair, highlightTag]);

  useEffect(() => {
    setNodes(
      derived.nodes.map((n) => ({
        ...n,
        selected: selection?.type === "element" && selection.id === n.id,
      })),
    );
  }, [derived, selection]);

  useEffect(() => {
    // New view → frame its content.
    requestAnimationFrame(() => fitView({ padding: 0.25, duration: 300, maxZoom: 1.2 }));
  }, [activeViewId, fitView]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      dispatch({
        type: "updatePlacement",
        viewId: activeViewId,
        elementId: node.id,
        changes: {
          x: Math.round(node.position.x / GRID),
          y: Math.round(node.position.y / GRID),
        },
      });
    },
    [dispatch, activeViewId],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const id = newId();
      const view = ws.views.get(activeViewId);
      const commands: Parameters<typeof dispatch>[0][] = [
        {
          type: "createRelationship",
          relationship: { id, sourceId: connection.source as Ulid, targetId: connection.target as Ulid, name: "uses" },
        },
      ];
      // Pin the line to the ports the user actually dragged between.
      if (view && connection.sourceHandle && connection.targetHandle) {
        commands.push({
          type: "updateView",
          id: view.id,
          changes: {
            edgeAnchors: {
              ...(view.edgeAnchors ?? {}),
              [id]: { source: connection.sourceHandle, target: connection.targetHandle },
            },
          },
        });
      }
      const error = dispatch(
        commands.length > 1 ? { type: "batch", label: "Connect", commands } : commands[0]!,
      );
      if (!error) select({ type: "relationship", id });
    },
    [dispatch, newId, select, ws, activeViewId],
  );

  const onNodeDoubleClick = useCallback(
    (_e: unknown, node: Node) => {
      const viewId = drillInto(node.id);
      if (viewId) {
        useAtlas.setState({ navDirection: "in" });
        setActiveView(viewId);
      }
    },
    [drillInto, setActiveView],
  );

  return (
    <div className="h-full w-full" data-testid="canvas">
      <ReactFlow
        nodes={nodes}
        edges={derived.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodeClick={(_e, node) => select({ type: "element", id: node.id })}
        onEdgeClick={(_e, edge) => select({ type: "relationship", id: edge.id })}
        onPaneClick={() => select(null)}
        onNodeDoubleClick={onNodeDoubleClick}
        snapToGrid
        snapGrid={[GRID, GRID]}
        connectionMode={ConnectionMode.Loose}
        proOptions={{ hideAttribution: true }}
        fitView
        minZoom={0.2}
      >
        <Background gap={GRID} color="#e2e8f0" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!h-28 !w-44" nodeStrokeWidth={3} />
      </ReactFlow>
    </div>
  );
}

export function Canvas() {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const navDirection = useAtlas((s) => s.navDirection);
  if (ws.views.get(activeViewId)?.renderMode === "isometric") {
    return <IsoCanvas />;
  }
  return (
    <ReactFlowProvider>
      <motion.div
        key={activeViewId}
        className="h-full w-full"
        initial={{ opacity: 0, scale: navDirection === "out" ? 1.12 : navDirection === "in" ? 0.88 : 1 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <CanvasInner />
      </motion.div>
    </ReactFlowProvider>
  );
}

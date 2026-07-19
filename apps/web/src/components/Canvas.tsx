import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type Node,
} from "@xyflow/react";
import { autoRoute, pinnedPortsAligned, type Box } from "../ports";
import { computeGuides, type GuideSegment } from "../guides";
import { motion } from "framer-motion";
import {
  diffContexts,
  effectiveElement,
  visibleElements,
  visibleRelationships,
  type Command,
  type Element,
  type StateDiff,
  type Ulid,
  type Workspace,
} from "@atlas/core";
import { DEFAULT_H, DEFAULT_W, GRID, useAtlas } from "../store";
import { nodeTypes, type AtlasNode } from "./nodes";

// The isometric renderer (framer-motion scene + projection math) is only
// needed once a view is switched into iso mode, so it's split into its own
// chunk instead of loading eagerly with the default 2D canvas.
const IsoCanvas = lazy(() => import("./IsoCanvas").then((m) => ({ default: m.IsoCanvas })));

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

/** Is `candidateId` a descendant of `ancestorId` in the containment tree? */
function isDescendantOf(ws: Workspace, candidateId: Ulid, ancestorId: Ulid): boolean {
  let cursor = ws.elements.get(candidateId)?.parentId ?? null;
  while (cursor !== null) {
    if (cursor === ancestorId) return true;
    cursor = ws.elements.get(cursor)?.parentId ?? null;
  }
  return false;
}

/**
 * The smallest group node whose bounds contain `point` (drag-into-group
 * re-parenting drop target), excluding `excludeId` and its descendants —
 * a node can never be dropped into itself or something it already contains.
 */
function groupUnderPoint(
  point: { x: number; y: number },
  candidates: Node[],
  ws: Workspace,
  excludeId: Ulid,
): Node | undefined {
  const hits = candidates.filter(
    (n) =>
      n.type === "atlasGroup" &&
      n.id !== excludeId &&
      !isDescendantOf(ws, n.id as Ulid, excludeId) &&
      point.x >= n.position.x &&
      point.x <= n.position.x + (n.width ?? GROUP_W * GRID) &&
      point.y >= n.position.y &&
      point.y <= n.position.y + (n.height ?? GROUP_H * GRID),
  );
  hits.sort(
    (a, b) => (a.width ?? GROUP_W * GRID) * (a.height ?? GROUP_H * GRID) -
      (b.width ?? GROUP_W * GRID) * (b.height ?? GROUP_H * GRID),
  );
  return hits[0];
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
  const [guides, setGuides] = useState<GuideSegment[]>([]);
  /** Group node under the dragged node's centre, highlighted as a drop target. */
  const [dropTargetId, setDropTargetId] = useState<Ulid | null>(null);

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

  const onNodeDrag = useCallback(
    (_e: unknown, node: Node) => {
      const w = node.width ?? node.measured?.width ?? DEFAULT_W * GRID;
      const h = node.height ?? node.measured?.height ?? DEFAULT_H * GRID;
      const moving: Box = { x: node.position.x, y: node.position.y, w, h };
      const others = nodes
        .filter((n) => n.id !== node.id)
        .map((n) => ({
          x: n.position.x,
          y: n.position.y,
          w: n.width ?? n.measured?.width ?? DEFAULT_W * GRID,
          h: n.height ?? n.measured?.height ?? DEFAULT_H * GRID,
        }));
      setGuides(computeGuides(moving, others));

      // Drop-target highlight: the smallest group under the node's centre.
      const center = { x: node.position.x + w / 2, y: node.position.y + h / 2 };
      const target = groupUnderPoint(center, nodes, ws, node.id as Ulid);
      setDropTargetId((target?.id as Ulid) ?? null);
    },
    [nodes, ws],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      setGuides([]);
      setDropTargetId(null);

      const w = node.width ?? node.measured?.width ?? DEFAULT_W * GRID;
      const h = node.height ?? node.measured?.height ?? DEFAULT_H * GRID;
      const center = { x: node.position.x + w / 2, y: node.position.y + h / 2 };
      const targetGroup = groupUnderPoint(center, nodes, ws, node.id as Ulid);

      const currentParentId = ws.elements.get(node.id as Ulid)?.parentId ?? null;
      let newParentId: Ulid | null | undefined; // undefined = leave parentId unchanged
      if (targetGroup && targetGroup.id !== currentParentId) {
        // Dragged into a (different) group.
        newParentId = targetGroup.id as Ulid;
      } else if (!targetGroup && currentParentId) {
        // Dragged out of every group: un-nest back to the group's own parent,
        // but only if the current parent is actually a group on this view.
        const currentParent = ws.elements.get(currentParentId);
        const parentIsGroupOnView = currentParent?.kind === "group" && nodes.some((n) => n.id === currentParentId);
        if (parentIsGroupOnView) newParentId = currentParent!.parentId;
      }

      const positionCommand: Command = {
        type: "updatePlacement",
        viewId: activeViewId,
        elementId: node.id as Ulid,
        changes: {
          x: Math.round(node.position.x / GRID),
          y: Math.round(node.position.y / GRID),
        },
      };
      const command: Command =
        newParentId !== undefined
          ? {
              type: "batch",
              label: "Move & re-parent",
              commands: [
                { type: "updateElement", id: node.id as Ulid, changes: { parentId: newParentId } },
                positionCommand,
              ],
            }
          : positionCommand;

      const error = dispatch(command);
      if (error) {
        // Illegal re-parent (containment/cycle rule) — snap back to the
        // pre-drag position; the workspace was never mutated.
        const original = derived.nodes.find((n) => n.id === node.id);
        if (original) {
          setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, position: original.position } : n)));
        }
      }
    },
    [dispatch, activeViewId, nodes, ws, derived],
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

  // Overlay the drag-into-group drop-target highlight without disturbing the
  // controlled node state (position, selection, ...) driving everything else.
  const displayNodes = useMemo(
    () =>
      dropTargetId === null
        ? nodes
        : nodes.map((n) => (n.id === dropTargetId ? { ...n, data: { ...n.data, dropHighlight: true } } : n)),
    [nodes, dropTargetId],
  );

  return (
    <div className="h-full w-full" data-testid="canvas">
      <ReactFlow
        nodes={displayNodes}
        edges={derived.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDrag={onNodeDrag}
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
        {guides.length > 0 && (
          <ViewportPortal>
            <svg
              className="pointer-events-none absolute left-0 top-0"
              style={{ overflow: "visible" }}
              width="1"
              height="1"
            >
              {guides.map((g, i) => (
                <line
                  key={i}
                  data-testid="alignment-guide"
                  x1={g.axis === "v" ? g.pos : g.from}
                  y1={g.axis === "v" ? g.from : g.pos}
                  x2={g.axis === "v" ? g.pos : g.to}
                  y2={g.axis === "v" ? g.to : g.pos}
                  stroke="#ec4899"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
              ))}
            </svg>
          </ViewportPortal>
        )}
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
    return (
      <Suspense fallback={<div className="h-full w-full bg-slate-100" data-testid="iso-canvas-loading" />}>
        <IsoCanvas />
      </Suspense>
    );
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

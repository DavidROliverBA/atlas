import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type Node,
} from "@xyflow/react";
import { motion } from "framer-motion";
import type { Element, Ulid } from "@atlas/core";
import { DEFAULT_H, DEFAULT_W, GRID, useAtlas } from "../store";
import { nodeTypes, type AtlasNode } from "./nodes";

const GROUP_W = 18;
const GROUP_H = 12;

function toNode(element: Element, x: number, y: number, w: number | undefined, h: number | undefined, drillable: boolean): AtlasNode {
  const isGroup = element.kind === "group";
  return {
    id: element.id,
    type: isGroup ? "atlasGroup" : "atlas",
    position: { x: x * GRID, y: y * GRID },
    width: (w ?? (isGroup ? GROUP_W : DEFAULT_W)) * GRID,
    height: (h ?? (isGroup ? GROUP_H : DEFAULT_H)) * GRID,
    zIndex: isGroup ? -1 : 0,
    data: { element, drillable },
  };
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

  const derived = useMemo(() => {
    const view = ws.views.get(activeViewId);
    if (!view) return { nodes: [] as AtlasNode[], edges: [] as Edge[] };
    const placed = new Set(view.placements.map((p) => p.elementId));
    const nodes = view.placements
      .map((p) => {
        const el = ws.elements.get(p.elementId);
        if (!el) return null;
        const drillable =
          (el.kind === "system" || el.kind === "container") && ws.children(el.id).length > 0;
        return toNode(el, p.x, p.y, p.width, p.height, drillable);
      })
      .filter((n): n is AtlasNode => n !== null);
    const edges: Edge[] = [...ws.relationships.values()]
      .filter(
        (r) =>
          placed.has(r.sourceId) &&
          placed.has(r.targetId) &&
          !view.hiddenRelationshipIds?.includes(r.id),
      )
      .map((r) => ({
        id: r.id,
        source: r.sourceId,
        target: r.targetId,
        label: r.name,
        type: "smoothstep",
        selected: selection?.type === "relationship" && selection.id === r.id,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b" },
        ...(r.direction === "bidirectional"
          ? { markerStart: { type: MarkerType.ArrowClosed, color: "#64748b" } }
          : {}),
      }));
    return { nodes, edges };
  }, [ws, rev, activeViewId, selection]);

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
      const error = dispatch({
        type: "createRelationship",
        relationship: { id, sourceId: connection.source as Ulid, targetId: connection.target as Ulid, name: "uses" },
      });
      if (!error) select({ type: "relationship", id });
    },
    [dispatch, newId, select],
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
        proOptions={{ hideAttribution: true }}
        fitView
        minZoom={0.2}
      >
        <Background gap={GRID} color="#e2e8f0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function Canvas() {
  const activeViewId = useAtlas((s) => s.activeViewId);
  const navDirection = useAtlas((s) => s.navDirection);
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

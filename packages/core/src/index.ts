export * from "./ids.js";
export * from "./metamodel/types.js";
export { ModelRuleError, assertLegalContainment, assertLegalEndpoints, assertNoCycle } from "./metamodel/rules.js";
export { Workspace } from "./model/workspace.js";
export type { Command, CommandType } from "./commands/commands.js";
export { CommandBus, type BusEvent, type CommandBusOptions, type HistoryEntry } from "./commands/bus.js";
export {
  StencilRegistry,
  packRef,
  type Stencil,
  type StencilCategory,
  type StencilPack,
} from "./stencils/packs.js";
export { stringifyCanonical, compareKeys, sortedSet, dropEmpty } from "./serialize/canonical.js";
export {
  workspaceToFiles,
  workspaceFromFiles,
  checkIntegrity,
  WorkspaceLoadError,
  MANIFEST_PATH,
  ELEMENTS_DIR,
  RELATIONSHIPS_DIR,
  VIEWS_DIR,
  STATES_DIR,
  type FileMap,
} from "./serialize/files.js";
export { validateFile, schemas, type FileKind } from "./schemas/validate.js";
export {
  isVisible,
  visibleElements,
  visibleRelationships,
  effectiveElement,
  diffContexts,
  diffReport,
  type TemporalContext,
  type StateDiff,
  type AttributeChange,
} from "./temporal/engine.js";
export {
  egoNetwork,
  downstreamOf,
  dependencyMatrix,
  lintWorkspace,
  type EgoNetwork,
  type EgoNetworkOptions,
  type DependencyMatrix,
  type DirectionFilter,
  type LintIssue,
} from "./analysis/graph.js";

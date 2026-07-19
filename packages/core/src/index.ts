export * from "./ids.js";
export * from "./metamodel/types.js";
export { ModelRuleError, VIEW_PLACEMENT, assertLegalContainment, assertLegalEndpoints, assertNoCycle, assertPlaceableOnView } from "./metamodel/rules.js";
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
export { toMermaidC4, toPlantUmlC4 } from "./export/text.js";
export { toSvg } from "./export/svg.js";
export { importStructurizr, type StructurizrWorkspace, type StructurizrImportResult } from "./interop/structurizr.js";
export { importArchimate, type ArchimateImportResult } from "./interop/archimate.js";
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
  type LintSeverity,
} from "./analysis/graph.js";
export {
  costEntryVisible,
  annualisedAmount,
  elementAnnual,
  annualAtYearOffset,
  estateTco,
  subtreeTco,
  tcoDiff,
  type TcoRow,
  type EstateTco,
  type TcoDelta,
  type CurrencyTotals,
  type CurrencyDelta,
} from "./analysis/tco.js";

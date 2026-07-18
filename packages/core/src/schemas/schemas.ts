/**
 * JSON Schemas for every workspace file type. These are the format contract;
 * the same schemas are published in /docs/format/ and used by the CLI's
 * `atlas validate`.
 */

const ULID_PATTERN = "^[0-9A-HJKMNP-TV-Z]{26}$";
const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

const temporal = {
  type: "object",
  additionalProperties: false,
  properties: {
    validFrom: { type: "string", pattern: DATE_PATTERN },
    validTo: { type: "string", pattern: DATE_PATTERN },
    states: { type: "array", items: { type: "string", pattern: ULID_PATTERN }, minItems: 1 },
  },
} as const;

const stringArray = { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 } as const;

const stringMap = {
  type: "object",
  additionalProperties: { type: "string" },
} as const;

const color = { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } as const;

const PORT_PATTERN = "^[tb][0-4]$|^[lr][0-2]$";

export const workspaceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://atlas.dev/schemas/workspace.json",
  title: "Atlas workspace manifest",
  type: "object",
  additionalProperties: false,
  required: ["formatVersion", "name"],
  properties: {
    formatVersion: { const: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    stencilPacks: stringArray,
  },
} as const;

export const elementSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://atlas.dev/schemas/element.json",
  title: "Atlas model element",
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "name", "parentId"],
  properties: {
    id: { type: "string", pattern: ULID_PATTERN },
    kind: { enum: ["person", "system", "container", "component", "group"] },
    name: { type: "string", minLength: 1 },
    parentId: { anyOf: [{ type: "null" }, { type: "string", pattern: ULID_PATTERN }] },
    description: { type: "string" },
    documentation: { type: "string" },
    technology: stringArray,
    owners: stringArray,
    team: { type: "string" },
    status: { enum: ["proposed", "planned", "live", "deprecated", "decommissioned"] },
    criticality: { enum: ["low", "medium", "high", "critical"] },
    tags: stringArray,
    links: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url"],
        properties: { title: { type: "string" }, url: { type: "string", format: "uri" } },
      },
    },
    properties: stringMap,
    color,
    stencil: {
      type: "object",
      additionalProperties: false,
      required: ["pack", "stencil"],
      properties: {
        pack: { type: "string", minLength: 1 },
        stencil: { type: "string", minLength: 1 },
        attributes: { type: "object" },
      },
    },
    temporal,
    stateOverrides: {
      type: "object",
      propertyNames: { pattern: ULID_PATTERN },
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          description: { type: "string" },
          technology: stringArray,
          status: { enum: ["proposed", "planned", "live", "deprecated", "decommissioned"] },
          tags: stringArray,
        },
      },
    },
  },
} as const;

export const relationshipSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://atlas.dev/schemas/relationship.json",
  title: "Atlas relationship",
  type: "object",
  additionalProperties: false,
  required: ["id", "sourceId", "targetId"],
  properties: {
    id: { type: "string", pattern: ULID_PATTERN },
    sourceId: { type: "string", pattern: ULID_PATTERN },
    targetId: { type: "string", pattern: ULID_PATTERN },
    name: { type: "string" },
    description: { type: "string" },
    technology: stringArray,
    direction: { enum: ["forward", "bidirectional"] },
    tags: stringArray,
    properties: stringMap,
    color,
    temporal,
  },
} as const;

export const viewSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://atlas.dev/schemas/view.json",
  title: "Atlas view",
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "name", "scopeId", "placements"],
  properties: {
    id: { type: "string", pattern: ULID_PATTERN },
    kind: { enum: ["landscape", "context", "container", "component", "custom"] },
    name: { type: "string", minLength: 1 },
    scopeId: { anyOf: [{ type: "null" }, { type: "string", pattern: ULID_PATTERN }] },
    description: { type: "string" },
    renderMode: { enum: ["2d", "isometric"] },
    placements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["elementId", "x", "y"],
        properties: {
          elementId: { type: "string", pattern: ULID_PATTERN },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number", exclusiveMinimum: 0 },
          height: { type: "number", exclusiveMinimum: 0 },
        },
      },
    },
    hiddenRelationshipIds: { type: "array", items: { type: "string", pattern: ULID_PATTERN }, minItems: 1 },
    edgeAnchors: {
      type: "object",
      propertyNames: { pattern: ULID_PATTERN },
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["source", "target"],
        properties: {
          source: { type: "string", pattern: PORT_PATTERN },
          target: { type: "string", pattern: PORT_PATTERN },
        },
      },
    },
  },
} as const;

export const stateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://atlas.dev/schemas/state.json",
  title: "Atlas named state",
  type: "object",
  additionalProperties: false,
  required: ["id", "name"],
  properties: {
    id: { type: "string", pattern: ULID_PATTERN },
    name: { type: "string", minLength: 1 },
    date: { type: "string", pattern: DATE_PATTERN },
    description: { type: "string" },
  },
} as const;

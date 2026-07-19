/**
 * OpenAPI 3.1 contract for the Atlas model API, served at
 * GET /api/v1/openapi.json and rendered by Swagger UI at /api/docs.
 */

const ULID = { type: "string", pattern: "^[0-9A-HJKMNP-TV-Z]{26}$", example: "01JGXW5H2M3N4P5Q6R7S8T9V0W" };
const COLOR = { type: "string", pattern: "^#[0-9a-fA-F]{6}$", example: "#0ea5e9" };
const stringArray = { type: "array", items: { type: "string" } };

const Temporal = {
  type: "object",
  properties: {
    validFrom: { type: "string", format: "date" },
    validTo: { type: "string", format: "date" },
    states: { type: "array", items: ULID },
  },
};

const CostEntry = {
  type: "object",
  required: ["id", "label", "category", "classification", "kind", "amount"],
  description:
    "A line of cost for TCO. Recurring entries normalise to an annual figure (amount × 12 when period=monthly); one-off entries amortise straight-line over amortiseYears (default 3). validFrom/validTo/states scope the entry temporally with the same semantics as element validity. Costs roll up through containment.",
  properties: {
    id: { ...ULID, description: "Assigned by the server when omitted on write" },
    label: { type: "string", example: "Enterprise licence" },
    category: { enum: ["licences", "infrastructure", "people", "vendor-services", "change", "decommission", "other"] },
    classification: { enum: ["run", "change", "acquire", "retire"] },
    kind: { enum: ["recurring", "one-off"] },
    amount: { type: "number", exclusiveMinimum: 0, description: "Whole currency units" },
    currency: { type: "string", pattern: "^[A-Z]{3}$", description: "ISO 4217; GBP when omitted" },
    period: { enum: ["monthly", "annual"], description: "Recurring only; annual when omitted" },
    amortiseYears: { type: "integer", minimum: 1, maximum: 50, description: "One-off only; 3 when omitted" },
    confidence: { enum: ["estimate", "quoted", "actual"] },
    validFrom: { type: "string", format: "date" },
    validTo: { type: "string", format: "date" },
    states: { type: "array", items: ULID, description: "Named-state ids the entry belongs to" },
  },
};

const StencilRef = {
  type: "object",
  required: ["pack", "stencil"],
  description:
    "Assigns a stencil-pack symbol to the element (e.g. an AWS/Azure icon). `attributes` are validated against that stencil's own JSON Schema (packages/stencils) — unknown packs are accepted as-is (renders via `kind` alone), but a known pack with an unknown `stencil` id, or `attributes` that violate its schema, returns 400 with the schema validation message.",
  properties: {
    pack: { type: "string", example: "aws" },
    stencil: { type: "string", example: "ec2" },
    attributes: { type: "object", description: "Pack- and stencil-specific; shape defined by that stencil's attributeSchema" },
  },
};

const ElementProps = {
  kind: { enum: ["person", "system", "container", "component", "group"] },
  name: { type: "string" },
  parentId: { oneOf: [ULID, { type: "null" }], description: "Containing element; null = top level" },
  description: { type: "string" },
  documentation: { type: "string", description: "Markdown" },
  technology: stringArray,
  owners: stringArray,
  team: { type: "string" },
  status: { enum: ["proposed", "planned", "live", "deprecated", "decommissioned"] },
  criticality: { enum: ["low", "medium", "high", "critical"] },
  tags: stringArray,
  links: { type: "array", items: { type: "object", required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string", format: "uri" } } } },
  properties: { type: "object", additionalProperties: { type: "string" } },
  color: COLOR,
  costs: { type: "array", items: { $ref: "#/components/schemas/CostEntry" }, description: "TCO cost entries; roll up through containment" },
  stencil: StencilRef,
  temporal: Temporal,
};

const RelationshipProps = {
  sourceId: ULID,
  targetId: ULID,
  name: { type: "string", description: "Verb phrase, e.g. 'publishes events to'" },
  description: { type: "string" },
  technology: stringArray,
  direction: { enum: ["forward", "bidirectional"] },
  tags: stringArray,
  color: COLOR,
  temporal: Temporal,
};

const Placement = {
  type: "object",
  required: ["elementId", "x", "y"],
  properties: {
    elementId: ULID,
    x: { type: "number", description: "Grid units (1 unit = 20px in 2D)" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
  },
};

const ViewProps = {
  kind: { enum: ["landscape", "context", "container", "component", "custom"] },
  name: { type: "string" },
  scopeId: { oneOf: [ULID, { type: "null" }], description: "Element the view is about; null for landscape/custom" },
  description: { type: "string" },
  renderMode: { enum: ["2d", "isometric"] },
  placements: { type: "array", items: Placement },
};

const crud = (tag: string, base: string, notes = "") => ({
  get: {
    tags: [tag],
    summary: `List ${tag}`,
    responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: `#/components/schemas/${base}` } } } } } },
  },
  post: {
    tags: [tag],
    summary: `Create a ${tag.slice(0, -1)}`,
    description: `Validated by the metamodel — illegal input returns 400 with a human-readable message. ${notes}`.trim(),
    requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${base}Input` } } } },
    responses: {
      "201": {
        description: "Created",
        headers: { "x-atlas-revision": { $ref: "#/components/headers/AtlasRevision" } },
        content: { "application/json": { schema: { $ref: `#/components/schemas/${base}` } } },
      },
      "400": { $ref: "#/components/responses/ValidationError" },
    },
  },
});

/**
 * Shared note for every `…Name` resolution parameter (parentName,
 * sourceName, targetName, elementName): the server resolves the unique
 * element with that name (case-insensitive), or returns one of two 400
 * shapes — see `resolveByName` in the router for the exact wording.
 */
const NAME_RESOLUTION_NOTE =
  'Resolved case-insensitively against existing element names — an alternative to passing the id directly. Zero matches: `400 {"error": "No element named \\"<name>\\""}`. More than one element sharing that name (ambiguous): `400 {"error": "Element name \\"<name>\\" is ambiguous"}`.';

const byId = (tag: string, base: string, patchNote = "Set a field to null to clear it.") => ({
  get: {
    tags: [tag],
    summary: `Get one by id`,
    responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: `#/components/schemas/${base}` } } } }, "404": { $ref: "#/components/responses/NotFound" } },
  },
  patch: {
    tags: [tag],
    summary: `Update fields`,
    description: patchNote,
    requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${base}Input` } } } },
    responses: {
      "200": {
        description: "Updated",
        headers: { "x-atlas-revision": { $ref: "#/components/headers/AtlasRevision" } },
        content: { "application/json": { schema: { $ref: `#/components/schemas/${base}` } } },
      },
      "400": { $ref: "#/components/responses/ValidationError" },
    },
  },
  delete: {
    tags: [tag],
    summary: `Delete`,
    responses: {
      "204": { description: "Deleted", headers: { "x-atlas-revision": { $ref: "#/components/headers/AtlasRevision" } } },
      "400": { $ref: "#/components/responses/ValidationError" },
    },
  },
});

/**
 * Per-command JSON-schema map for the raw command bus (POST /commands and
 * GET /commands/schema). Shapes are derived straight from
 * packages/core/src/commands/commands.ts and bus.ts — one entry per
 * CommandType, reusing the same property fragments as the resource
 * endpoints above so the two stay in sync by construction.
 */
export const commandSchemas = {
  createElement: {
    type: "object",
    required: ["type", "element"],
    properties: { type: { const: "createElement" }, element: { $ref: "#/components/schemas/Element" } },
  },
  updateElement: {
    type: "object",
    required: ["type", "id", "changes"],
    properties: {
      type: { const: "updateElement" },
      id: ULID,
      changes: {
        type: "object",
        properties: ElementProps,
        description: "Partial; only id and kind cannot change. Explicit null clears an optional field.",
      },
    },
  },
  deleteElement: {
    type: "object",
    required: ["type", "id"],
    properties: { type: { const: "deleteElement" }, id: ULID },
    description: "Refused while the element still contains children. Cascades relationships and view placements.",
  },
  createRelationship: {
    type: "object",
    required: ["type", "relationship"],
    properties: { type: { const: "createRelationship" }, relationship: { $ref: "#/components/schemas/Relationship" } },
  },
  updateRelationship: {
    type: "object",
    required: ["type", "id", "changes"],
    properties: {
      type: { const: "updateRelationship" },
      id: ULID,
      changes: { type: "object", properties: RelationshipProps },
    },
  },
  deleteRelationship: {
    type: "object",
    required: ["type", "id"],
    properties: { type: { const: "deleteRelationship" }, id: ULID },
  },
  createView: {
    type: "object",
    required: ["type", "view"],
    properties: { type: { const: "createView" }, view: { $ref: "#/components/schemas/View" } },
  },
  updateView: {
    type: "object",
    required: ["type", "id", "changes"],
    properties: {
      type: { const: "updateView" },
      id: ULID,
      changes: {
        type: "object",
        description: "id and placements cannot change here — use placeOnView/updatePlacement/removeFromView.",
        properties: {
          kind: ViewProps.kind,
          name: ViewProps.name,
          scopeId: ViewProps.scopeId,
          description: ViewProps.description,
          renderMode: ViewProps.renderMode,
          hiddenRelationshipIds: { type: "array", items: ULID },
          edgeAnchors: {
            type: "object",
            additionalProperties: { type: "object", properties: { source: { type: "string" }, target: { type: "string" } } },
          },
        },
      },
    },
  },
  deleteView: {
    type: "object",
    required: ["type", "id"],
    properties: { type: { const: "deleteView" }, id: ULID },
  },
  placeOnView: {
    type: "object",
    required: ["type", "viewId", "placement"],
    properties: {
      type: { const: "placeOnView" },
      viewId: ULID,
      placement: { $ref: "#/components/schemas/Placement" },
    },
  },
  updatePlacement: {
    type: "object",
    required: ["type", "viewId", "elementId", "changes"],
    description: "Move/resize an existing placement. The UI and CLI call this 'move'; the bus type is updatePlacement.",
    properties: {
      type: { const: "updatePlacement" },
      viewId: ULID,
      elementId: ULID,
      changes: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } },
      },
    },
  },
  removeFromView: {
    type: "object",
    required: ["type", "viewId", "elementId"],
    description: "Removes a placement only — never deletes the element from the model.",
    properties: { type: { const: "removeFromView" }, viewId: ULID, elementId: ULID },
  },
  createState: {
    type: "object",
    required: ["type", "state"],
    properties: { type: { const: "createState" }, state: { $ref: "#/components/schemas/NamedState" } },
  },
  updateState: {
    type: "object",
    required: ["type", "id", "changes"],
    properties: {
      type: { const: "updateState" },
      id: ULID,
      changes: {
        type: "object",
        properties: { name: { type: "string" }, date: { type: "string", format: "date" }, description: { type: "string" } },
      },
    },
  },
  deleteState: {
    type: "object",
    required: ["type", "id"],
    description: "Cascades: removes the state from any temporal.states / stateOverrides that reference it.",
    properties: { type: { const: "deleteState" }, id: ULID },
  },
  updateWorkspaceMeta: {
    type: "object",
    required: ["type", "changes"],
    properties: {
      type: { const: "updateWorkspaceMeta" },
      changes: {
        type: "object",
        properties: { name: { type: "string" }, description: { type: "string" }, stencilPacks: stringArray },
      },
    },
  },
  batch: {
    type: "object",
    required: ["type", "commands"],
    description: "Atomic: all-or-nothing. Undoes as a single step.",
    properties: {
      type: { const: "batch" },
      label: { type: "string" },
      commands: { type: "array", items: { type: "object", description: "Any command shape from this same map" } },
    },
  },
} as const;

export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Atlas model API",
    version: "1.0.0",
    description:
      "REST API over the Atlas architecture model database. The model is the source of truth; diagrams are projections. Every mutation runs through the Atlas command bus, so the same metamodel rules apply as in the UI: person/system live at the top level, container inside a system, component inside a container; groups are boundaries and cannot be relationship endpoints. Objects created here are immediately available to place on diagrams (views).\n\nIdentity: ULIDs are assigned by the server on create and never change. Where a field accepts `…Name` (parentName, sourceName, targetName, elementName), the server resolves the unique element with that name — handy for scripts and AI agents; ids are always accepted and unambiguous.",
  },
  servers: [{ url: "https://atlas-modelling.pages.dev/api/v1" }],
  security: [{ bearer: [] }, { apiKey: [] }],
  tags: [
    { name: "workspace", description: "Whole-workspace snapshot" },
    { name: "elements", description: "People, systems, containers, components, groups" },
    { name: "relationships", description: "Typed connections between elements" },
    { name: "views", description: "Diagrams: projections of the model with per-view placements" },
    { name: "states", description: "Named temporal states (e.g. Current, Target 2028)" },
    { name: "commands", description: "Raw command batches — full power of the command bus" },
    { name: "analysis", description: "Read-side graph analysis and exports — lint, ego networks, diagram export" },
  ],
  paths: {
    "/workspace": {
      get: {
        tags: ["workspace"],
        summary: "Full workspace snapshot (meta, elements, relationships, views, states)",
        description:
          "Carries an `ETag` (`\"r<revision>\"`) and `x-atlas-revision` header for cheap polling — send the last-seen ETag back via `If-None-Match` to get a bodyless 304 when the workspace hasn't changed. See `HEAD /workspace` to check the revision without fetching the body at all.",
        parameters: [
          { name: "If-None-Match", in: "header", schema: { type: "string" }, description: "Last-seen ETag (`\"r<revision>\"`); an exact match short-circuits to 304." },
        ],
        responses: {
          "200": {
            description: "OK",
            headers: {
              ETag: { $ref: "#/components/headers/WorkspaceETag" },
              "x-atlas-revision": { $ref: "#/components/headers/AtlasRevision" },
            },
            content: { "application/json": { schema: { $ref: "#/components/schemas/WorkspaceData" } } },
          },
          "304": { description: "Not modified — the `If-None-Match` ETag matches the current revision; no body." },
        },
      },
      head: {
        tags: ["workspace"],
        summary: "Workspace ETag/revision only — same headers as GET, no body",
        description: "For polling loops that only need to know whether anything changed. Identical caching semantics to `GET /workspace`, without the transfer cost of the snapshot.",
        parameters: [
          { name: "If-None-Match", in: "header", schema: { type: "string" }, description: "Last-seen ETag (`\"r<revision>\"`); an exact match short-circuits to 304." },
        ],
        responses: {
          "200": {
            description: "OK — headers only",
            headers: {
              ETag: { $ref: "#/components/headers/WorkspaceETag" },
              "x-atlas-revision": { $ref: "#/components/headers/AtlasRevision" },
            },
          },
          "304": { description: "Not modified" },
        },
      },
      post: {
        tags: ["workspace"],
        summary: "Atomic bulk import — replace the whole workspace (restore a backup)",
        description:
          "Restore-a-backup path: pair with `GET /workspace` to snapshot a workspace and later replay it here verbatim — the request body is the exact shape `GET /workspace` returns. Validation is dispatch-free (construct + referential-integrity check + stencil-ref validation, same rules the command bus would eventually enforce) rather than a full command replay, so it's fast even for large workspaces; a validation failure returns 400 and leaves the stored workspace untouched. On success the entire workspace (elements, relationships, views, states, meta) is replaced atomically — this is a destructive overwrite of everything currently stored, not a merge. Use `?dryRun=1` to validate a candidate snapshot without persisting it. Subject to the same optimistic-revision retry as every other mutation.",
        parameters: [
          {
            name: "dryRun",
            in: "query",
            schema: { type: "string", enum: ["1"] },
            description: "When `1`, validate only and return `200 {\"valid\": true}` without persisting anything.",
          },
        ],
        requestBody: {
          required: true,
          description: "A full WorkspaceData snapshot — the same shape GET /workspace returns.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/WorkspaceData" } } },
        },
        responses: {
          "200": {
            description: "Replaced — body is the stored snapshot (or `{valid: true}` when `dryRun=1`)",
            headers: { "x-atlas-revision": { $ref: "#/components/headers/AtlasRevision" } },
            content: {
              "application/json": {
                schema: { oneOf: [{ $ref: "#/components/schemas/WorkspaceData" }, { type: "object", properties: { valid: { const: true } } }] },
              },
            },
          },
          "400": {
            description: "Rejected: dangling reference (checkIntegrity), or a stencil ref with an unknown stencil / attributes that fail its schema",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/elements": {
      ...crud("elements", "Element", "Accepts `parentName` instead of parentId."),
      get: {
        tags: ["elements"],
        summary: "List elements",
        parameters: [{ name: "name", in: "query", schema: { type: "string" }, description: "Case-insensitive exact-name filter" }],
        responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Element" } } } } } },
      },
    },
    "/elements/{id}": { parameters: [{ $ref: "#/components/parameters/id" }], ...byId("elements", "Element") },
    "/elements/{id}/connections": {
      parameters: [{ $ref: "#/components/parameters/id" }],
      get: {
        tags: ["analysis"],
        summary: "Ego network around an element (impact/connections traversal)",
        description:
          "Breadth-first traversal of the whole estate graph outward from this element, the same query the Connections view runs. `depth` bounds how many hops out; `direction` filters which relationship ends are followed.",
        parameters: [
          { name: "depth", in: "query", schema: { type: "integer", minimum: 1, maximum: 3, default: 1 }, description: "Hops from the centre element" },
          { name: "direction", in: "query", schema: { enum: ["both", "out", "in"], default: "both" } },
        ],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/ConnectionsResult" } } } },
          "400": { $ref: "#/components/responses/ValidationError" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/relationships": crud("relationships", "Relationship", "Accepts `sourceName`/`targetName` instead of ids."),
    "/relationships/{id}": { parameters: [{ $ref: "#/components/parameters/id" }], ...byId("relationships", "Relationship") },
    "/views": crud("views", "View"),
    "/views/{id}": { parameters: [{ $ref: "#/components/parameters/id" }], ...byId("views", "View", "Placements are managed via the /placements sub-resource; edgeAnchors/hiddenRelationshipIds may be patched here.") },
    "/views/{id}/placements": {
      parameters: [{ $ref: "#/components/parameters/id" }],
      post: {
        tags: ["views"],
        summary: "Place an element on a view",
        description: "Positions are grid units (1 unit = 20px). Accepts `elementName` instead of elementId. Placing an element already on the view returns 400.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  elementId: ULID,
                  elementName: { type: "string", description: `Resolve the element by unique name (alternative to elementId). ${NAME_RESOLUTION_NOTE}` },
                  x: { type: "number" },
                  y: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Placed",
            headers: { "x-atlas-revision": { $ref: "#/components/headers/AtlasRevision" } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/Placement" } } },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
    "/views/{id}/placements/{elementId}": {
      parameters: [
        { $ref: "#/components/parameters/id" },
        { name: "elementId", in: "path", required: true, schema: ULID },
      ],
      patch: {
        tags: ["views"],
        summary: "Move/resize a placement",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } } } } } },
        responses: {
          "200": {
            description: "Updated",
            headers: { "x-atlas-revision": { $ref: "#/components/headers/AtlasRevision" } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/Placement" } } },
          },
        },
      },
      delete: {
        tags: ["views"],
        summary: "Remove an element from this view (never deletes it from the model)",
        responses: {
          "204": { description: "Removed from view", headers: { "x-atlas-revision": { $ref: "#/components/headers/AtlasRevision" } } },
        },
      },
    },
    "/states": crud("states", "NamedState"),
    "/states/{id}": { parameters: [{ $ref: "#/components/parameters/id" }], ...byId("states", "NamedState") },
    "/commands": {
      post: {
        tags: ["commands"],
        summary: "Apply a batch of raw Atlas commands atomically",
        description:
          "The escape hatch with the full power of the command bus (createElement, updateElement, deleteElement, createRelationship, createView, placeOnView, updateWorkspaceMeta, batch, …). The batch is atomic: any invalid command rolls the whole batch back with a 400. Returns the resulting workspace snapshot. Note: ids inside commands must be valid new ULIDs you generate, or ids of existing objects. Each array entry must match exactly one of the `Cmd_*` schemas below, discriminated by its `type` field — see `GET /commands/schema` for the same shapes as a flat map.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["commands"],
                properties: {
                  label: { type: "string" },
                  commands: {
                    type: "array",
                    items: {
                      oneOf: Object.keys(commandSchemas).map((type) => ({ $ref: `#/components/schemas/Cmd_${type}` })),
                      discriminator: {
                        propertyName: "type",
                        mapping: Object.fromEntries(
                          Object.keys(commandSchemas).map((type) => [type, `#/components/schemas/Cmd_${type}`]),
                        ),
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Applied — body is the resulting workspace snapshot",
            headers: { "x-atlas-revision": { $ref: "#/components/headers/AtlasRevision" } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/WorkspaceData" } } },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },
    "/commands/schema": {
      get: {
        tags: ["commands"],
        summary: "Per-command-type JSON-schema map for POST /commands",
        description:
          "One entry per command type the bus supports, keyed by `type` (createElement, updateElement, deleteElement, createRelationship, updateRelationship, deleteRelationship, createView, updateView, deleteView, placeOnView, updatePlacement, removeFromView, createState, updateState, deleteState, updateWorkspaceMeta, batch). Lets AI agents and scripts validate a command batch client-side before posting it.",
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { type: "object", additionalProperties: { type: "object" }, example: { createElement: "{ type, element }" } } } },
          },
        },
      },
    },
    "/lint": {
      get: {
        tags: ["analysis"],
        summary: "Consistency report: orphan elements, duplicate names, relationships shown on no view",
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/LintIssue" } } } } },
        },
      },
    },
    "/views/{id}/export": {
      parameters: [{ $ref: "#/components/parameters/id" }],
      get: {
        tags: ["analysis"],
        summary: "Export a view as Mermaid, PlantUML or SVG",
        description:
          "Renders the same scene the app's Toolbar export menu produces, straight from the model (no headless browser involved). `format=mermaid`/`plantuml` return a C4-style text diagram; `format=svg` returns a standalone, deterministic SVG.",
        parameters: [{ name: "format", in: "query", required: true, schema: { enum: ["mermaid", "plantuml", "svg"] } }],
        responses: {
          "200": {
            description: "OK",
            content: {
              "text/plain": { schema: { type: "string" }, example: "C4Context\n  title Ops landscape\n  ...\n" },
              "image/svg+xml": { schema: { type: "string" } },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer", description: "GitHub-SSO Supabase session token, or the Atlas service token" },
      apiKey: { type: "apiKey", in: "header", name: "x-api-key", description: "Same tokens, alternative header" },
    },
    parameters: {
      id: { name: "id", in: "path", required: true, schema: ULID },
    },
    headers: {
      AtlasRevision: {
        description: "The new storage revision after this write. Increments by exactly 1 per successful save — poll cheaply by comparing against a previously-seen value instead of diffing whole snapshots.",
        schema: { type: "integer", example: 42 },
      },
      WorkspaceETag: {
        description: 'Strong validator for the current workspace snapshot: `"r<revision>"`. Send back via `If-None-Match` on `GET`/`HEAD /workspace` to get a bodyless 304 when nothing changed.',
        schema: { type: "string", example: '"r42"' },
      },
    },
    responses: {
      ValidationError: {
        description: "Rejected by metamodel/schema validation",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "A Component cannot live at the top level. Legal parents: Container." } } },
      },
      NotFound: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    },
    schemas: {
      Error: { type: "object", properties: { error: { type: "string" } } },
      CostEntry,
      Element: { type: "object", required: ["id", "kind", "name", "parentId"], properties: { id: ULID, ...ElementProps } },
      ElementInput: {
        type: "object",
        required: ["kind", "name"],
        properties: {
          ...ElementProps,
          parentName: { type: "string", description: `Resolve parent by unique name (alternative to parentId). ${NAME_RESOLUTION_NOTE}` },
        },
        description: "On PATCH, include only fields to change; explicit null clears an optional field.",
      },
      Relationship: { type: "object", required: ["id", "sourceId", "targetId"], properties: { id: ULID, ...RelationshipProps } },
      RelationshipInput: {
        type: "object",
        properties: {
          ...RelationshipProps,
          sourceName: { type: "string", description: `Resolve source by unique name (alternative to sourceId). ${NAME_RESOLUTION_NOTE}` },
          targetName: { type: "string", description: `Resolve target by unique name (alternative to targetId). ${NAME_RESOLUTION_NOTE}` },
        },
      },
      Placement,
      View: { type: "object", required: ["id", "kind", "name", "scopeId", "placements"], properties: { id: ULID, ...ViewProps, hiddenRelationshipIds: { type: "array", items: ULID }, edgeAnchors: { type: "object", description: "relationship id → {source, target} connection ports (t0–t4, b0–b4, l0–l2, r0–r2)", additionalProperties: { type: "object", properties: { source: { type: "string" }, target: { type: "string" } } } } } },
      ViewInput: { type: "object", required: ["kind", "name"], properties: ViewProps },
      NamedState: { type: "object", required: ["id", "name"], properties: { id: ULID, name: { type: "string" }, date: { type: "string", format: "date" }, description: { type: "string" } } },
      NamedStateInput: { type: "object", required: ["name"], properties: { name: { type: "string" }, date: { type: "string", format: "date" }, description: { type: "string" } } },
      LintIssue: {
        type: "object",
        required: ["code", "message", "ids"],
        properties: {
          code: { enum: ["orphan-element", "duplicate-name", "unplaced-relationship"] },
          message: { type: "string" },
          ids: { type: "array", items: ULID },
        },
      },
      ConnectionsResult: {
        type: "object",
        required: ["center", "nodes", "edges"],
        description: "The ego network around one element: every element and relationship within `depth` hops.",
        properties: {
          center: ULID,
          nodes: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "kind", "name", "hop"],
              properties: {
                id: ULID,
                kind: { enum: ["person", "system", "container", "component", "group"] },
                name: { type: "string" },
                hop: { type: "integer", minimum: 0, description: "Distance from the centre element (0 = the centre itself)" },
              },
            },
          },
          edges: { type: "array", items: { $ref: "#/components/schemas/Relationship" } },
        },
      },
      WorkspaceData: {
        type: "object",
        properties: {
          meta: { type: "object", properties: { formatVersion: { const: 1 }, name: { type: "string" }, description: { type: "string" }, stencilPacks: stringArray } },
          elements: { type: "array", items: { $ref: "#/components/schemas/Element" } },
          relationships: { type: "array", items: { $ref: "#/components/schemas/Relationship" } },
          views: { type: "array", items: { $ref: "#/components/schemas/View" } },
          states: { type: "array", items: { $ref: "#/components/schemas/NamedState" } },
        },
      },
      // One Cmd_<type> schema per commandSchemas entry, registered so
      // POST /commands' requestBody can `oneOf`/discriminate over $refs
      // instead of a loose `additionalProperties: true` bag.
      ...Object.fromEntries(Object.entries(commandSchemas).map(([type, schema]) => [`Cmd_${type}`, schema])),
    },
  },
} as const;

# Stencil pack manifest format (v1)

Everything drawable comes from a stencil pack: a versioned, data-driven bundle enabled
per workspace (brief §3.2). Packs never add element kinds — each stencil **maps onto**
one of the core kinds (`person | system | container | component | group`), keeping the
metamodel closed while the vocabulary stays open (Principle 7).

## Layout

```
my-pack/
  pack.json          # manifest (below)
  symbols/2d/*.svg   # flat symbols
  symbols/iso/*.svg  # isometric symbols
```

## pack.json

```json
{
  "formatVersion": 1,
  "id": "aws",
  "name": "Amazon Web Services",
  "version": "1.0.0",
  "description": "Core AWS service stencils",
  "categories": [
    { "id": "compute", "name": "Compute" }
  ],
  "stencils": [
    {
      "id": "lambda",
      "name": "Lambda Function",
      "category": "compute",
      "elementType": "container",
      "symbol2d": "symbols/2d/lambda.svg",
      "symbolIso": "symbols/iso/lambda.svg",
      "defaults": { "technology": ["AWS Lambda"] },
      "attributeSchema": {
        "type": "object",
        "properties": {
          "accountId": { "type": "string", "pattern": "^\\d{12}$" },
          "region": { "type": "string" },
          "runtime": { "type": "string" }
        }
      }
    }
  ]
}
```

## Fields

| Field | Req | Notes |
|---|---|---|
| `id` | ✓ | pack-unique, kebab-case; workspaces reference packs as `id@major` |
| `version` | ✓ | semver; major bumps may change attribute schemas (migration note required) |
| `stencils[].id` | ✓ | unique within the pack; stored on elements as `stencil: {pack, stencil}` |
| `stencils[].elementType` | ✓ | the core kind this stencil maps onto — containment/relationship rules come from the kind, never the stencil |
| `stencils[].symbol2d` / `symbolIso` | ✓ | relative SVG paths; iso symbols drawn on a 2:1 dimetric grid, base footprint 1×1 grid unit |
| `stencils[].attributeSchema` | | JSON Schema (2020-12) for pack-specific attributes; validated by core when set on an element |
| `stencils[].defaults` | | initial values applied at creation (technology, tags, …) |

## Semantics

- **Enabling** a pack in a workspace lists `"<id>@<major>"` in the manifest's
  `stencilPacks`; custom packs live in the workspace's `stencils/` directory.
- **Disabling** a pack never deletes elements; their `stencil` ref simply renders with a
  fallback symbol for the underlying kind.
- Attributes validate against `attributeSchema` at command time (same path as all
  metamodel validation), so the AI, UI and CLI get identical errors.
- Custom packs use exactly this format — there is no privileged built-in path:
  C4 Core itself ships as a pack.

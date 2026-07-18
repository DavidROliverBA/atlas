# Research: reference experiences

Findings recorded before implementation, per the build brief (§2). Sources: product
documentation, published demos and prior hands-on knowledge of the three tools.

## IcePanel

What defines the experience, and what Atlas takes from it:

- **Model-first, C4-native.** Objects (systems, apps, stores, components, actors) live in
  a model; diagrams reference them. Deleting from a diagram never deletes from the model —
  the same separation Atlas enforces structurally in `@atlas/core` (views hold only
  `placements` that reference element ids).
- **Zoom as the core navigation.** Each object carries a magnifier affordance; zooming in
  transitions Landscape → System Context → App/Container → Component with an animated
  dive. Breadcrumbs zoom back out. Atlas mirrors this with containment as a model
  property (`parentId`) and per-level views.
- **The detail panel is half the product.** Markdown description, technology, status,
  owner, tags, links out to reality (repos, docs). Atlas's inspector carries the same
  fields (§3.4 of the brief) plus custom properties and stencil attributes.
- **Tags as colour overlays**, **flows** for message animation, **versions** for
  point-in-time snapshots, and **dependency views** generated from the model. Atlas
  generalises versions into named states + date validity (richer: a timeline scrubber and
  state diff), and dependency views into the ego-network "connections view".

## Archi / ArchiMate

- **A typed metamodel with validation.** ArchiMate defines layers (Business, Application,
  Technology, Motivation, Implementation) and legal relationship/containment rules between
  types. Takeaway: validation belongs in the metamodel, not in the drawing layer. Atlas
  encodes containment rules per element kind in `metamodel/rules.ts` and returns
  user-facing error messages from the command bus.
- **The model tree is first-class navigation**; views are explicit projections you can
  open, and one element appears in many views. Atlas's model tree sidebar and
  "appears in" list copy this.
- **coArchi** demonstrates git collaboration on a plain-text model format — and its pain
  points (merge conflicts on monolithic files) motivate Atlas's one-file-per-object
  layout.

## Structurizr

- **One model, many views** — the founding articulation of model/diagram separation for C4.
- **Deterministic, reviewable serialisation.** The Structurizr JSON/DSL formats are
  designed for source control; diagram layout is separate from model content. Atlas
  copies this with: stable key ordering, one property per line, LF endings, ULIDs,
  sorted set-like arrays, omitted empty collections, and a golden-file byte-identity test.
- **Views are scoped** (SystemLandscape, SystemContext, Container, Component) — Atlas's
  `View.kind` + `scopeId` mirror this.

## Synthesis: what Atlas is

IcePanel's interaction model (zoomable C4, polished inspector, tags, states) +
Archi's metamodel rigour (typed elements, legal-relationship validation, model tree) +
Structurizr's serialisation philosophy (one model many views, git-friendly format),
extended with two capabilities none of the three offer together: **isometric rendering of
the same scene graph** and **time as a first-class dimension** (validity dates, named
states, scrubber, diff).

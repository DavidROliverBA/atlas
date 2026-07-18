/**
 * Demo estate seeded on first run (and via "Reset demo"): a small airline
 * landscape with a drillable booking system, built entirely through the
 * command bus.
 */

import {
  CommandBus,
  Workspace,
  type Element,
  type Relationship,
  type UlidFactory,
  type View,
} from "@atlas/core";

export function buildSeedWorkspace(ids: UlidFactory): Workspace {
  const ws = new Workspace({ name: "Demo estate", description: "Seeded demo — replace with your own model" });
  const bus = new CommandBus(ws);

  const el = (partial: Omit<Element, "id">): Element => {
    const element = { id: ids.next(), ...partial };
    bus.dispatch({ type: "createElement", element });
    return element;
  };
  const rel = (partial: Omit<Relationship, "id">): Relationship => {
    const relationship = { id: ids.next(), ...partial };
    bus.dispatch({ type: "createRelationship", relationship });
    return relationship;
  };

  const customer = el({
    kind: "person",
    name: "Customer",
    parentId: null,
    description: "Books and manages trips",
    tags: ["external"],
  });
  const booking = el({
    kind: "system",
    name: "Booking Engine",
    parentId: null,
    description: "Reservations, ticketing and inventory",
    status: "live",
    criticality: "critical",
    owners: ["Commercial IT"],
    tags: ["core"],
    documentation:
      "## Booking Engine\n\nThe **system of record** for reservations.\n\n- Sells seats across all channels\n- Publishes `booking.*` events to the estate\n",
  });
  const payments = el({
    kind: "system",
    name: "Payments",
    parentId: null,
    description: "Card processing and settlement",
    status: "live",
    tags: ["core", "pci"],
  });
  const crm = el({
    kind: "system",
    name: "CRM",
    parentId: null,
    description: "Customer profiles and loyalty",
    status: "live",
  });
  const mainframe = el({
    kind: "system",
    name: "Legacy Mainframe",
    parentId: null,
    description: "Inventory of record — being retired",
    status: "deprecated",
    tags: ["legacy"],
    temporal: { validTo: "2027-12-31" },
  });

  const webApp = el({
    kind: "container",
    name: "Web App",
    parentId: booking.id,
    description: "Customer-facing booking UI",
    technology: ["TypeScript", "React"],
  });
  const api = el({
    kind: "container",
    name: "Booking API",
    parentId: booking.id,
    description: "Core reservations API",
    technology: ["Kotlin", "Spring Boot"],
  });
  const db = el({
    kind: "container",
    name: "Booking DB",
    parentId: booking.id,
    description: "Reservations store",
    technology: ["PostgreSQL"],
  });

  rel({ sourceId: customer.id, targetId: booking.id, name: "books trips using" });
  rel({ sourceId: booking.id, targetId: payments.id, name: "takes payment via", technology: ["HTTPS", "REST"] });
  rel({ sourceId: booking.id, targetId: crm.id, name: "updates loyalty in", technology: ["Kafka"] });
  rel({ sourceId: webApp.id, targetId: api.id, name: "calls", technology: ["JSON/HTTPS"] });
  rel({ sourceId: api.id, targetId: db.id, name: "reads and writes", technology: ["JDBC"] });
  rel({
    sourceId: booking.id,
    targetId: mainframe.id,
    name: "syncs inventory with",
    tags: ["legacy"],
    temporal: { validTo: "2027-12-31" },
  });

  const landscape: View = {
    id: ids.next(),
    kind: "landscape",
    name: "Landscape",
    scopeId: null,
    placements: [
      { elementId: customer.id, x: 0, y: 6 },
      { elementId: booking.id, x: 14, y: 6 },
      { elementId: payments.id, x: 28, y: 0 },
      { elementId: crm.id, x: 28, y: 12 },
      { elementId: mainframe.id, x: 14, y: 16 },
    ],
  };
  bus.dispatch({ type: "createView", view: landscape });

  const containers: View = {
    id: ids.next(),
    kind: "container",
    name: "Booking Engine — containers",
    scopeId: booking.id,
    placements: [
      { elementId: webApp.id, x: 0, y: 0 },
      { elementId: api.id, x: 14, y: 0 },
      { elementId: db.id, x: 28, y: 0 },
    ],
  };
  bus.dispatch({ type: "createView", view: containers });

  // Named states: today's estate vs the 2028 target (mainframe gone, new web stack).
  const current = { id: ids.next(), name: "Current", date: "2026-07-18" };
  const target = { id: ids.next(), name: "Target 2028", date: "2028-01-01" };
  bus.dispatch({ type: "createState", state: current });
  bus.dispatch({ type: "createState", state: target });
  bus.dispatch({
    type: "updateElement",
    id: webApp.id,
    changes: { stateOverrides: { [target.id]: { technology: ["TypeScript", "Next.js"] } } },
  });

  return ws;
}

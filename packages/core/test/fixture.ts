/**
 * Deterministic sample workspace used across the test suite and to generate
 * the committed golden files. Everything is built through the command bus —
 * the same path the UI and AI use.
 */

import { seededUlidFactory, type UlidFactory } from "../src/ids.js";
import { CommandBus } from "../src/commands/bus.js";
import { Workspace } from "../src/model/workspace.js";
import type { Element, NamedState, Relationship, View } from "../src/metamodel/types.js";

export interface Fixture {
  ws: Workspace;
  bus: CommandBus;
  ids: UlidFactory;
  customer: Element;
  booking: Element;
  payments: Element;
  mainframe: Element;
  webApp: Element;
  bookingDb: Element;
  usesRel: Relationship;
  paysRel: Relationship;
  legacyRel: Relationship;
  landscape: View;
  containerView: View;
  current: NamedState;
  target: NamedState;
}

export function buildFixture(): Fixture {
  const ids = seededUlidFactory(42);
  const ws = new Workspace({ name: "Airline estate", description: "Demo estate for tests" });
  const bus = new CommandBus(ws);

  const mk = <T>(value: T): T => value;

  const customer = mk<Element>({
    id: ids.next(),
    kind: "person",
    name: "Customer",
    parentId: null,
    description: "Books and manages trips",
    tags: ["external"],
  });
  const booking = mk<Element>({
    id: ids.next(),
    kind: "system",
    name: "Booking Engine",
    parentId: null,
    description: "Reservations and ticketing",
    status: "live",
    criticality: "critical",
    owners: ["Commercial IT"],
    tags: ["core"],
  });
  const payments = mk<Element>({
    id: ids.next(),
    kind: "system",
    name: "Payments",
    parentId: null,
    status: "live",
    tags: ["core", "pci"],
  });
  const mainframe = mk<Element>({
    id: ids.next(),
    kind: "system",
    name: "Legacy Mainframe",
    parentId: null,
    status: "deprecated",
    tags: ["legacy"],
    temporal: { validTo: "2027-12-31" },
  });

  for (const el of [customer, booking, payments, mainframe]) {
    bus.dispatch({ type: "createElement", element: el });
  }

  const webApp = mk<Element>({
    id: ids.next(),
    kind: "container",
    name: "Web App",
    parentId: booking.id,
    technology: ["TypeScript", "React"],
  });
  const bookingDb = mk<Element>({
    id: ids.next(),
    kind: "container",
    name: "Booking DB",
    parentId: booking.id,
    technology: ["PostgreSQL"],
  });
  bus.dispatch({ type: "createElement", element: webApp });
  bus.dispatch({ type: "createElement", element: bookingDb });

  const usesRel = mk<Relationship>({
    id: ids.next(),
    sourceId: customer.id,
    targetId: booking.id,
    name: "books trips with",
  });
  const paysRel = mk<Relationship>({
    id: ids.next(),
    sourceId: booking.id,
    targetId: payments.id,
    name: "takes payment via",
    technology: ["HTTPS", "REST"],
  });
  const legacyRel = mk<Relationship>({
    id: ids.next(),
    sourceId: booking.id,
    targetId: mainframe.id,
    name: "syncs inventory with",
    tags: ["legacy"],
    temporal: { validTo: "2027-12-31" },
  });
  for (const rel of [usesRel, paysRel, legacyRel]) {
    bus.dispatch({ type: "createRelationship", relationship: rel });
  }

  const landscape = mk<View>({
    id: ids.next(),
    kind: "landscape",
    name: "Estate landscape",
    scopeId: null,
    placements: [],
  });
  const containerView = mk<View>({
    id: ids.next(),
    kind: "container",
    name: "Booking Engine — containers",
    scopeId: booking.id,
    placements: [],
  });
  bus.dispatch({ type: "createView", view: landscape });
  bus.dispatch({ type: "createView", view: containerView });

  bus.dispatch({ type: "placeOnView", viewId: landscape.id, placement: { elementId: customer.id, x: 0, y: 2 } });
  bus.dispatch({ type: "placeOnView", viewId: landscape.id, placement: { elementId: booking.id, x: 4, y: 2 } });
  bus.dispatch({ type: "placeOnView", viewId: landscape.id, placement: { elementId: payments.id, x: 8, y: 0 } });
  bus.dispatch({ type: "placeOnView", viewId: landscape.id, placement: { elementId: mainframe.id, x: 8, y: 4 } });
  bus.dispatch({ type: "placeOnView", viewId: containerView.id, placement: { elementId: webApp.id, x: 0, y: 0 } });
  bus.dispatch({ type: "placeOnView", viewId: containerView.id, placement: { elementId: bookingDb.id, x: 4, y: 0 } });

  const current = mk<NamedState>({ id: ids.next(), name: "Current", date: "2026-07-18" });
  const target = mk<NamedState>({ id: ids.next(), name: "Target 2028", date: "2028-01-01" });
  bus.dispatch({ type: "createState", state: current });
  bus.dispatch({ type: "createState", state: target });

  // In the target state the Web App moves to a new stack.
  bus.dispatch({
    type: "updateElement",
    id: webApp.id,
    changes: { stateOverrides: { [target.id]: { technology: ["TypeScript", "Next.js"] } } },
  });

  return {
    ws,
    bus,
    ids,
    customer,
    booking,
    payments,
    mainframe,
    webApp,
    bookingDb,
    usesRel,
    paysRel,
    legacyRel,
    landscape,
    containerView,
    current,
    target,
  };
}

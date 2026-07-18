import { definePack } from "./lib.js";

/** C4 Core ships as a pack like everything else — no privileged path. */
export const c4CorePack = definePack({
  id: "c4-core",
  name: "C4 Core",
  description: "Person, Software System, Container, Component, Group",
  color: "#0284c7",
  categories: [{ id: "c4", name: "C4" }],
  stencils: [
    ["person", "Person", "c4", "person", "P"],
    ["system", "Software System", "c4", "system", "SYS"],
    ["container", "Container", "c4", "container", "CNT"],
    ["component", "Component", "c4", "component", "CMP"],
    ["group", "Group / Boundary", "c4", "group", "GRP"],
  ],
});

export const genericTechPack = definePack({
  id: "generic-tech",
  name: "Generic Technology",
  description: "Technology-agnostic building blocks",
  color: "#475569",
  categories: [
    { id: "data", name: "Data" },
    { id: "messaging", name: "Messaging" },
    { id: "runtime", name: "Runtime" },
    { id: "network", name: "Network" },
  ],
  stencils: [
    ["database", "Database", "data", "container", "DB"],
    ["file-store", "File Store", "data", "container", "FS"],
    ["cache", "Cache", "data", "container", "$"],
    ["queue", "Queue", "messaging", "container", "Q"],
    ["event-bus", "Event Bus", "messaging", "container", "BUS"],
    ["api", "API", "runtime", "container", "API"],
    ["scheduler", "Scheduler", "runtime", "container", "CRON"],
    ["device", "Device", "runtime", "system", "DEV"],
    ["network-zone", "Network Zone", "network", "group", "NET"],
  ],
});

export const businessPack = definePack({
  id: "business",
  name: "Business",
  description: "Business architecture concepts",
  color: "#9333ea",
  categories: [
    { id: "strategy", name: "Strategy" },
    { id: "operations", name: "Operations" },
  ],
  stencils: [
    ["capability", "Capability", "strategy", "system", "CAP"],
    ["value-stream", "Value Stream", "strategy", "system", "VS"],
    ["kpi", "KPI", "strategy", "component", "KPI"],
    ["process", "Process", "operations", "system", "PRC"],
    ["organisation-unit", "Organisation Unit", "operations", "group", "ORG"],
    ["product", "Product", "operations", "system", "PRD"],
    ["channel", "Channel", "operations", "system", "CHN"],
  ],
});

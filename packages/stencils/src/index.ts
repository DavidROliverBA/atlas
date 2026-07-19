import { StencilRegistry, type StencilPack } from "@atlas/core";
import { aiAgentsPack } from "./ai-agents-pack.js";
import { awsPack, azurePack, gcpPack } from "./cloud-packs.js";
import { businessPack, c4CorePack, genericTechPack } from "./core-packs.js";

export { awsPack, azurePack, gcpPack, businessPack, c4CorePack, genericTechPack, aiAgentsPack };
export { definePack, symbol2d, symbolIso, type PackSpec, type StencilTuple } from "./lib.js";

export const BUILTIN_PACKS: StencilPack[] = [
  c4CorePack,
  genericTechPack,
  businessPack,
  aiAgentsPack,
  awsPack,
  azurePack,
  gcpPack,
];

/** A registry preloaded with every built-in pack. */
export function builtinRegistry(): StencilRegistry {
  const registry = new StencilRegistry();
  for (const pack of BUILTIN_PACKS) registry.register(pack);
  return registry;
}

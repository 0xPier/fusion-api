import type { ModelRef, Provider } from "../../src/providers/base.js";
import { Registry } from "../../src/providers/registry.js";
import type { MockProvider } from "./mockProvider.js";

export interface MakeRegistryOptions {
  namedModels?: Record<string, ModelRef>;
  allow?: string[];
  deny?: string[];
  secrets?: Record<string, string | undefined>;
}

/** Build a Registry backed entirely by mock providers (zero network). */
export function makeMockRegistry(providers: Provider[], opts: MakeRegistryOptions = {}): Registry {
  return new Registry({
    providers: new Map(providers.map((p) => [p.id, p])),
    namedModels: new Map(Object.entries(opts.namedModels ?? {})),
    allow: opts.allow ?? [],
    deny: opts.deny ?? [],
    secrets: opts.secrets ?? {},
  });
}

export type { MockProvider };

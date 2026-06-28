import type { Registry } from "../engine/plugins/Registry";

const modules = import.meta.glob<{ [key: string]: any }>(
  ["./**/*Layer.ts", "../shaders/*Layer.ts"],
  { eager: true }
);

/** Registers the built-in layer types. `registry.register(...)` is the whole contract. */
export function registerBuiltins(registry: Registry): void {
  for (const [, module] of Object.entries(modules)) {
    for (const [, exportValue] of Object.entries(module)) {
      if (exportValue?.type && typeof exportValue.type === "string") {
        registry.register(exportValue);
      }
    }
  }
}

import { uid } from "../core/ids";
import { Composition } from "./Composition";

/**
 * The top-level document. Holds one or more compositions plus project-wide global
 * variables that expressions can read via `global.*` (user-defined controls,
 * shared palettes, external data caches, …).
 */
export class Project {
  readonly id: string;
  name: string;
  compositions: Composition[];
  activeCompositionId: string;
  globals: Record<string, unknown>;
  meta: Record<string, unknown>;

  constructor(init: {
    id?: string;
    name: string;
    compositions: Composition[];
    activeCompositionId?: string;
    globals?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  }) {
    this.id = init.id ?? uid("proj");
    this.name = init.name;
    this.compositions = init.compositions;
    this.activeCompositionId =
      init.activeCompositionId ?? init.compositions[0]?.id ?? "";
    this.globals = init.globals ?? {};
    this.meta = init.meta ?? {};
  }

  activeComposition(): Composition {
    return (
      this.compositions.find((c) => c.id === this.activeCompositionId) ??
      this.compositions[0]
    );
  }

  findComposition(id: string): Composition | undefined {
    return this.compositions.find((c) => c.id === id);
  }

  addComposition(comp: Composition): Composition {
    this.compositions.push(comp);
    return comp;
  }

  toJSON(): unknown {
    return {
      id: this.id,
      name: this.name,
      activeCompositionId: this.activeCompositionId,
      globals: this.globals,
      meta: this.meta,
      compositions: this.compositions.map((c) => c.toJSON()),
    };
  }

  static fromJSON(raw: any): Project {
    return new Project({
      id: raw.id,
      name: raw.name,
      activeCompositionId: raw.activeCompositionId,
      globals: raw.globals ?? {},
      meta: raw.meta ?? {},
      compositions: (raw.compositions ?? []).map((c: any) =>
        Composition.fromJSON(c),
      ),
    });
  }
}

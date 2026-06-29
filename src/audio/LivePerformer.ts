import { Param } from "@/controls/Param";
import type { Plugin } from "@/plugins/Plugin";
import type { Stage } from "@/runtime/Stage";
import type { AudioEngine } from "./AudioEngine";
import type { Instrument, PropertyValue, SonicParams } from "./types";
import { clamp01, norm } from "./instruments/util";
import { createInstrument, instrumentSpec } from "./instruments/registry";

/**
 * Bridges the runtime {@link Stage} and the audio engine. Once per animation frame it looks at the
 * two decks' active plugins, ensures every voiced plugin has an instrument, and pushes that plugin's
 * *live param values* into the instrument — so what you hear is literally driven by what you see.
 * Voices are created/disposed as plugins are loaded/cleared, and a deck's audio presence follows the
 * crossfade (fading a deck out fades its sound).
 *
 * It deliberately does NOT touch the Stage's render path; it only reads its public state per frame.
 */
export class LivePerformer {
  private voices = new Map<Plugin, Instrument>();
  private raf = 0;

  constructor(
    private stage: Stage,
    private audio: AudioEngine,
  ) {}

  start(): void {
    if (this.raf) return;
    const loop = () => {
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick(): void {
    if (!this.audio.started) return;
    const time = nowSec();
    const seen = new Set<Plugin>();

    // Equal-power crossfade → per-deck audio presence (mirrors Stage's visual blend).
    const t = clamp01(this.stage.crossfade);
    const deckA = this.stage.decks["A"].banks.filter((p): p is Plugin => p !== null);
    const deckB = this.stage.decks["B"].banks.filter((p): p is Plugin => p !== null);
    const both = deckA.length > 0 && deckB.length > 0;
    const presA = both ? Math.cos((t * Math.PI) / 2) : deckA.length > 0 ? 1 : 0;
    const presB = both ? Math.sin((t * Math.PI) / 2) : deckB.length > 0 ? 1 : 0;

    for (const plugin of deckA) this.voice(plugin, presA, time, seen);
    for (const plugin of deckB) this.voice(plugin, presB, time, seen);

    // Dispose voices whose plugins left the stage.
    for (const [plugin, inst] of this.voices) {
      if (!seen.has(plugin)) {
        inst.dispose();
        this.voices.delete(plugin);
      }
    }
  }

  private voice(plugin: Plugin | null, presence: number, time: number, seen: Set<Plugin>): void {
    if (!plugin) return;
    const spec = instrumentSpec(plugin.id);
    if (!spec?.create) return; // un-voiced plugin
    seen.add(plugin);

    let inst = this.voices.get(plugin);
    if (!inst) {
      const created = createInstrument(plugin.id, this.audio);
      if (!created) return;
      inst = created;
      this.voices.set(plugin, inst);
      inst.setLevel(0.8);
      inst.setMuted(false);
    }

    const props = paramProps(plugin);
    const sonic: SonicParams = {
      props,
      energy: computeEnergy(plugin.id, props),
      presence: clamp01(presence),
      time,
    };
    inst.update(sonic);
  }

  dispose(): void {
    this.stop();
    for (const inst of this.voices.values()) inst.dispose();
    this.voices.clear();
  }
}

/** A plugin's live control values keyed by their field name — the same numbers the renderer draws with. */
function paramProps(plugin: Plugin): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const p of plugin.params) {
    out[p.name] = p instanceof Param ? p.value : p.on;
  }
  return out;
}

function nowSec(): number {
  return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
}

/** A rough 0..1 "how active is this visual" used to push instruments harder. Per-type heuristic. */
function computeEnergy(type: string, props: Record<string, PropertyValue>): number {
  const n = (k: string, f: number) => (typeof props[k] === "number" ? (props[k] as number) : f);
  switch (type) {
    case "gameOfLife":
      return clamp01(0.6 * norm(n("density", 0.32), 0.01, 0.9) + 0.4 * norm(n("speed", 1), 1, 6));
    case "physarum":
      return clamp01(0.5 * norm(n("deposit", 1), 0.1, 5) + 0.5 * norm(n("gain", 0.6), 0.1, 4));
    case "boids":
      return clamp01(0.7 * norm(n("maxSpeed", 3.5), 0.2, 20) + 0.3 * norm(n("count", 500), 1, 5000));
    case "noise":
      return clamp01(0.5 * norm(Math.abs(n("speed", 0.3)), 0, 4) + 0.5 * norm(n("contrast", 1), 0.1, 6));
    case "harmonograph":
      return clamp01(norm(n("cycles", 12), 1, 60));
    case "plant":
      return clamp01(0.6 * norm(n("iterations", 4), 1, 6) + 0.4 * norm(Math.abs(n("spinSpeed", 0.06)), 0, 0.5));
    case "glyphScatter":
      return clamp01(0.6 * (1 - n("threshold", 0.5)) + 0.4 * norm(Math.abs(n("speed", 0.2)), 0, 3));
    case "shape":
      return clamp01(0.5 * norm(Math.abs(n("spin", 24)), 0, 360) + 0.5 * norm(n("resolution", 28), 8, 80));
    case "landscape":
      return clamp01(0.6 * norm(n("amplitude", 0.55), 0, 1.2) + 0.4 * norm(Math.abs(n("speed", 0.15)), 0, 3));
    case "volumetricCloud":
      return clamp01(0.5 * norm(n("coverage", 0.5), 0.1, 0.9) + 0.3 * norm(n("density", 1.4), 0.2, 4) + 0.2 * norm(Math.abs(n("speed", 0.25)), 0, 3));
    default:
      return 0.4;
  }
}

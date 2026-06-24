import type { Engine, Layer, PropertyValue } from "@/engine";
import type { AudioEngine } from "./AudioEngine";
import type { Instrument } from "./types";
import { clamp01, norm } from "./instruments/util";
import { createInstrument, instrumentSpec } from "./instruments/registry";

interface VoiceEntry {
  inst: Instrument;
  level: number;
  muted: boolean;
}

/**
 * Bridges the visual engine and the audio engine. Once per rendered frame it walks the live
 * composition, ensures every content layer with a registered voice has an instrument, and
 * pushes that layer's *evaluated visual params* into the instrument — so what you hear is
 * literally driven by what you see. Voices are created/disposed as layers come and go.
 *
 * It deliberately does NOT touch the engine's render path; it only listens to "render:frame".
 */
export class LivePerformer {
  private voices = new Map<string, VoiceEntry>();
  private off: (() => void) | null = null;

  constructor(
    private engine: Engine,
    private audio: AudioEngine,
  ) {}

  start(): void {
    if (this.off) return;
    this.off = this.engine.bus.on("render:frame", () => this.tick());
  }

  private tick(): void {
    if (!this.audio.started) return;
    const comp = this.engine.comp;
    const time = this.engine.transport.time;
    const seen = new Set<string>();

    for (const layer of comp.layers) {
      const spec = instrumentSpec(layer.type);
      if (!spec?.create) continue; // container/effect/un-voiced types
      seen.add(layer.id);

      let entry = this.voices.get(layer.id);
      if (!entry) {
        const inst = createInstrument(layer.type, this.audio);
        if (!inst) continue;
        entry = { inst, level: 0.8, muted: false };
        this.voices.set(layer.id, entry);
        entry.inst.setLevel(entry.level);
        entry.inst.setMuted(entry.muted);
      }

      const props = evalProps(layer, time);
      entry.inst.update({
        props,
        energy: computeEnergy(layer.type, props),
        presence: presenceOf(layer, time),
        time,
      });
    }

    // Dispose voices whose layers left the stage.
    for (const [id, entry] of this.voices) {
      if (!seen.has(id)) {
        entry.inst.dispose();
        this.voices.delete(id);
      }
    }
  }

  // ── mixer surface (used by the live UI) ──
  setLayerLevel(id: string, v: number): void {
    const e = this.voices.get(id);
    if (e) {
      e.level = clamp01(v);
      e.inst.setLevel(e.level);
    }
  }
  setLayerMuted(id: string, m: boolean): void {
    const e = this.voices.get(id);
    if (e) {
      e.muted = m;
      e.inst.setMuted(m);
    }
  }
  hasVoice(id: string): boolean {
    return this.voices.has(id);
  }

  dispose(): void {
    this.off?.();
    this.off = null;
    for (const e of this.voices.values()) e.inst.dispose();
    this.voices.clear();
  }
}

/** Evaluate a layer's animatable params at the playhead (ignores expressions — fine for live). */
function evalProps(layer: Layer, time: number): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const p of layer.customProps) out[p.key] = p.valueAt(time);
  return out;
}

/** Stage presence = opacity (fading a layer out fades its sound). */
function presenceOf(layer: Layer, time: number): number {
  const op = layer.transform("opacity").valueAt(time);
  const o = typeof op === "number" ? op / 100 : 1;
  return layer.enabled ? clamp01(o) : 0;
}

/** A rough 0..1 "how active is this visual" used to push instruments harder. Per-type heuristic. */
function computeEnergy(type: string, props: Record<string, PropertyValue>): number {
  const n = (k: string, f: number) => (typeof props[k] === "number" ? (props[k] as number) : f);
  switch (type) {
    case "life":
      return clamp01(0.6 * norm(n("density", 0.32), 0.01, 0.9) + 0.4 * norm(n("speed", 1), 1, 6));
    case "physarum":
      return clamp01(0.5 * norm(n("deposit", 1), 0.1, 5) + 0.5 * norm(n("gain", 0.6), 0.1, 4));
    case "boids":
      return clamp01(0.7 * norm(n("maxSpeed", 3.5), 0.2, 20) + 0.3 * norm(n("count", 500), 1, 5000));
    case "noise":
      return clamp01(0.5 * norm(Math.abs(n("speed", 0.3)), 0, 4) + 0.5 * norm(n("contrast", 1), 0.1, 6));
    case "harmonograph":
      return clamp01(norm(n("cycles", 12), 1, 60));
    default:
      return 0.4;
  }
}

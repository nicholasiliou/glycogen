import { Param } from "@/controls/Param";
import type { Plugin } from "@/plugins/Plugin";
import type { Stage } from "@/runtime/Stage";
import type { AudioEngine } from "./AudioEngine";
import type { Instrument, PropertyValue, SonicParams } from "./types";
import { clamp01 } from "./instruments/util";
import { createInstrument, instrumentSpec } from "./instruments/registry";

/**
 * Bridges the runtime {@link Stage} and the audio engine. Once per animation frame it looks at the
 * loaded banks, ensures every voiced plugin has an instrument, and pushes that plugin's *live param
 * values* into the instrument — so what you hear is literally driven by what you see. Voices are
 * created/disposed as plugins are loaded/cleared, and each layer's audio presence follows its own
 * opacity (fading a layer out fades its sound).
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

    // Per-layer opacity → audio presence (mirrors Stage's visual composite).
    for (const bank of this.stage.banks) {
      if (bank.plugin) this.voice(bank.plugin, clamp01(bank.plugin.opacity.value), time, seen);
    }

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
      // Per-plugin heuristic living on the instrument spec; un-specified voices idle at neutral.
      energy: spec.energy?.(props) ?? 0.4,
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

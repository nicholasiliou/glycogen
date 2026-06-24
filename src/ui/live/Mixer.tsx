import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useEngine, useRevision } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/ui/button";
import { Slider } from "@/ui/components/ui/slider";
import { cn } from "@/ui/lib/cn";
import { FAMILY_META, instrumentSpec } from "@/audio/instruments/registry";
import { useLive } from "./LiveProvider";

/** Per-voice level + mute for everything currently on the stage. */
export function Mixer() {
  const engine = useEngine();
  useRevision();
  const { performer, setActiveLayer, activeLayerId } = useLive();
  const [mix, setMix] = useState<Record<string, { level: number; muted: boolean }>>({});

  const voices = engine.comp.layers.filter((l) => instrumentSpec(l.type)?.create);
  const get = (id: string) => mix[id] ?? { level: 0.8, muted: false };
  const setLevel = (id: string, level: number) => {
    setMix((m) => ({ ...m, [id]: { ...get(id), level } }));
    performer.setLayerLevel(id, level);
  };
  const toggleMute = (id: string) => {
    const next = !get(id).muted;
    setMix((m) => ({ ...m, [id]: { ...get(id), muted: next } }));
    performer.setLayerMuted(id, next);
  };

  if (voices.length === 0) {
    return <p className="text-[11px] text-ink-dim">Add a plugin from the sundial to start a voice.</p>;
  }

  return (
    <div className="space-y-2">
      {voices.map((l) => {
        const spec = instrumentSpec(l.type)!;
        const v = get(l.id);
        return (
          <div key={l.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveLayer(l.id)}
                className={cn("min-w-0 flex-1 truncate text-left", activeLayerId === l.id ? "text-accent" : "text-ink")}
              >
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: FAMILY_META[spec.family].color }}
                />
                {l.name}
              </button>
              <span className="text-[9px] uppercase text-ink-dim">{FAMILY_META[spec.family].label}</span>
              <Button size="icon-sm" variant="ghost" onClick={() => toggleMute(l.id)}>
                {v.muted ? <VolumeX className="h-3.5 w-3.5 text-ink-dim" /> : <Volume2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <Slider min={0} max={1} step={0.01} value={[v.level]} onValueChange={([x]) => setLevel(l.id, x)} />
          </div>
        );
      })}
    </div>
  );
}

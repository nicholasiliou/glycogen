import { useEffect, useState, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import type { Engine } from "@/engine";
import { useEngine } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/ui/button";
import { useLive } from "./LiveProvider";
import { Mixer } from "./Mixer";
import type { ParamBinding } from "./autoMap";

/** ~30fps ticker so the mapped-value readouts animate while the panel is open. */
function useRaf(): void {
  const [, setT] = useState(0);
  useEffect(() => {
    let id = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last > 33) {
        last = now;
        setT((x) => (x + 1) % 1_000_000);
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

/** Current value of a bound param, formatted for display. */
function paramValue(engine: Engine, b: ParamBinding): string {
  const prop = engine.getLayer(b.layerId)?.property(b.propKey);
  if (!prop) return "";
  const v = prop.valueAt(engine.transport.time);
  if (b.options) return b.options.find((o) => String(o.value) === String(v))?.label ?? String(v);
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number") return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
  return String(v);
}

/** The compact live side-panel: device line, the active plugin's live map, and the stage mixer. */
export function LivePanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const engine = useEngine();
  useRaf();
  const { midi, bindings, activeLayerId } = useLive();

  const status = midi.status;
  const device = midi.devices()[0];
  const activeLayer = activeLayerId ? engine.getLayer(activeLayerId) : null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3 text-xs">
      <section className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-ink-dim">MIDI</span>
        {status === "unsupported" ? (
          <span className="text-amber-400">Chrome / Edge only</span>
        ) : device ? (
          <span className="flex items-center gap-1.5 text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {device.name}
          </span>
        ) : (
          <span className="text-ink-dim">no device</span>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onOpenSettings} title="MIDI settings & keymap">
          <Settings2 className="h-3.5 w-3.5" /> Settings
        </Button>
      </section>

      <section>
        <Header>{activeLayer ? `Map · ${activeLayer.name}` : "Map"}</Header>
        {!activeLayer ? (
          <p className="text-ink-dim">Add a plugin — it becomes the mapped instrument.</p>
        ) : bindings.length === 0 ? (
          <p className="text-ink-dim">Move your controls to auto-assign them to this plugin.</p>
        ) : (
          <div className="space-y-0.5">
            {bindings.map((b) => (
              <div key={`${b.controlId}:${b.propKey}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-ink">{b.propName}</span>
                <span className="shrink-0 tabular-nums text-[10px] text-accent">{paramValue(engine, b)}</span>
                <span className="shrink-0 truncate text-[10px] text-ink-dim">{midi.get(b.controlId)?.label ?? b.controlLabel}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <Header>Stage mixer</Header>
        <Mixer />
      </section>
    </div>
  );
}

function Header({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 text-[10px] uppercase tracking-wide text-ink-dim">{children}</h3>;
}

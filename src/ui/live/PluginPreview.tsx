import { useEngine } from "@/ui/engine/EngineProvider";
import { LayerIcon } from "@/ui/components/LayerIcon";
import { instrumentSpec } from "@/audio/instruments/registry";
import { cn } from "@/ui/lib/cn";

/**
 * A restrained, monochrome preview of the plugin currently under the browse cursor — icon,
 * name, sound family and a one-line blurb. Deliberately greyscale so it sits back and lets the
 * stage visuals lead.
 */
export function PluginPreview({ type, className }: { type: string; className?: string }) {
  const engine = useEngine();
  const def = engine.registry.get(type);
  const spec = instrumentSpec(type);
  if (!def) return null;

  return (
    <div className={cn("flex items-center gap-2 px-2 py-1", className)}>
      <LayerIcon name={def.icon} className="h-5 w-5 shrink-0" />
      <div className="min-w-0">
        <div className="truncate text-xs leading-tight text-ink">{def.label ?? type}</div>
      </div>
    </div>
  );
}

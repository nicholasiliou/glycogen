import { useMemo } from "react";
import { Pause, Play, Download, SlidersHorizontal } from "lucide-react";
import { Exporter, RESOLUTION_PRESETS, type ResolutionPreset } from "@/engine";
import { useEngine, useRevision, useTime } from "@/ui/engine/EngineProvider";
import { useMode } from "@/ui/mode/ModeProvider";
import { getRecipe, regenerate } from "@/generator/generate";
import { formatFromPreset } from "@/generator/recipe";
import { Button } from "@/ui/components/ui/button";
import { Separator } from "@/ui/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";

/** Curated social formats for Simple Mode. */
const SIMPLE_FORMATS: ResolutionPreset[] = RESOLUTION_PRESETS.filter((p) =>
  [
    "Instagram Story / Reel",
    "Instagram Post",
    "TikTok",
    "Square 1080",
    "YouTube Thumbnail",
  ].includes(p.label),
);

export function SimpleToolbar() {
  const engine = useEngine();
  useRevision();
  const { playing } = useTime();
  const { setMode } = useMode();
  const exporter = useMemo(() => new Exporter(engine), [engine]);

  const current = `${engine.comp.width}x${engine.comp.height}`;
  // Use label as Select value to avoid duplicate-value collisions
  // (Instagram Story / Reel and TikTok both resolve to 1080x1920).
  const matched = SIMPLE_FORMATS.find((p) => `${p.width}x${p.height}` === current);

  const run = (fn: () => Promise<unknown>) => () =>
    fn().catch((err) => alert((err as Error).message));

  const onFormat = (label: string) => {
    const p = SIMPLE_FORMATS.find((f) => f.label === label);
    if (!p) return;
    engine.setCompositionSettings({ width: p.width, height: p.height });
    // Re-flow the current recipe into the new canvas size.
    const recipe = getRecipe(engine);
    if (recipe) regenerate(engine, { ...recipe, format: formatFromPreset(p) });
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-panel px-3">
      <span className="select-none px-1 text-sm font-semibold tracking-tight text-accent">
        ◇ Marathon
      </span>
      <Separator orientation="vertical" className="mx-1 h-5" />

      <Select value={matched ? matched.label : "custom"} onValueChange={onFormat}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Format">
            {matched ? matched.label : "Custom"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SIMPLE_FORMATS.map((p) => (
            <SelectItem key={p.label} value={p.label}>
              {p.label} · {p.width}×{p.height}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        size="icon-sm"
        variant={playing ? "accent" : "ghost"}
        onClick={() => engine.togglePlay()}
        title="Play / Pause"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <div className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="accent">
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={run(() => exporter.still("png"))}>
            Bild (PNG)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={run(() => exporter.webm())}>
            Video (WebM)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-1 h-5" />
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setMode("pro")}
        title="Alle Optionen anzeigen"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" /> Pro Mode ▸
      </Button>
    </div>
  );
}

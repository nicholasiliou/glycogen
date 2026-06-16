import { useMemo, useRef } from "react";
import {
  ChevronFirst,
  ChevronLast,
  Download,
  FolderOpen,
  LayoutGrid,
  Pause,
  Play,
  Redo2,
  Repeat,
  Save,
  Settings2,
  SkipBack,
  SkipForward,
  Undo2,
} from "lucide-react";
import {
  Exporter,
  RESOLUTION_PRESETS,
  deserializeProject,
  type ResolutionPreset,
} from "@/engine";
import { useEngine, useRevision, useTime } from "@/ui/engine/EngineProvider";
import { useMode } from "@/ui/mode/ModeProvider";
import { formatTimecode } from "@/ui/lib/format";
import { Button } from "@/ui/components/ui/button";
import { Separator } from "@/ui/components/ui/separator";
import { NumberField } from "@/ui/components/controls/NumberField";
import { ColorField } from "@/ui/components/controls/ColorField";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";

export function Toolbar() {
  const engine = useEngine();
  const { setMode } = useMode();
  useRevision();
  const { time, playing } = useTime();
  const comp = engine.comp;
  const exporter = useMemo(() => new Exporter(engine), [engine]);
  const fileRef = useRef<HTMLInputElement>(null);

  const openFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        engine.loadProjectInstance(deserializeProject(JSON.parse(String(reader.result))));
      } catch (err) {
        console.error(err);
        alert(`Could not open project: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
  };

  const run = (fn: () => Promise<unknown>) => () =>
    fn().catch((err) => {
      console.warn(err);
      alert((err as Error).message);
    });

  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-edge bg-panel px-2">
      <span className="select-none px-1 text-sm font-semibold tracking-tight text-accent">◇ Marathon</span>

      <input
        className="w-36 bg-transparent text-xs text-ink-dim outline-none hover:text-ink focus:text-ink"
        value={engine.project.name}
        onChange={(e) => {
          engine.project.name = e.target.value;
          engine.bus.emit("project:changed", undefined);
        }}
      />

      <Separator orientation="vertical" className="mx-1 h-5" />

      <Button size="sm" variant="ghost" onClick={() => setMode("simple")} title="Zurück zum Simple Mode">
        <LayoutGrid className="h-3.5 w-3.5" /> Simple
      </Button>

      <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} title="Open project">
        <FolderOpen className="h-3.5 w-3.5" /> Open
      </Button>
      <Button size="sm" variant="ghost" onClick={() => exporter.exportProjectJSON()} title="Save project JSON">
        <Save className="h-3.5 w-3.5" /> Save
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = "";
        }}
      />

      <CompositionSettings />

      <div className="flex-1" />

      {/* Transport */}
      <div className="flex items-center gap-0.5 rounded border border-edge bg-panel-raised px-1 py-0.5">
        <Button size="icon-sm" variant="ghost" onClick={() => engine.seek(0)} title="Go to start">
          <ChevronFirst className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => engine.step(-1)} title="Previous frame">
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon-sm" variant={playing ? "accent" : "ghost"} onClick={() => engine.togglePlay()} title="Play / Pause (Space)">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => engine.step(1)} title="Next frame">
          <SkipForward className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => engine.seek(comp.duration)} title="Go to end">
          <ChevronLast className="h-4 w-4" />
        </Button>
        <Button
          size="icon-sm"
          variant={engine.transport.loop ? "accent" : "ghost"}
          onClick={() => engine.setLoop(!engine.transport.loop)}
          title="Loop"
        >
          <Repeat className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-w-[112px] rounded border border-edge bg-black px-2 py-1 text-center font-mono text-xs tabular-nums text-accent">
        {formatTimecode(time, comp.fps)}
        <span className="ml-1 text-ink-dim">f{engine.transport.frame}</span>
      </div>

      <div className="flex-1" />

      {/* History */}
      <Button size="icon-sm" variant="ghost" disabled={!engine.history.canUndo} onClick={() => engine.history.undo()} title="Undo (⌘Z)">
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon-sm" variant="ghost" disabled={!engine.history.canRedo} onClick={() => engine.history.redo()} title="Redo (⌘⇧Z)">
        <Redo2 className="h-3.5 w-3.5" />
      </Button>

      <Separator orientation="vertical" className="mx-1 h-5" />

      {/* Export */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="accent">
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Still</DropdownMenuLabel>
          <DropdownMenuItem onSelect={run(() => exporter.still("png"))}>PNG (current frame)</DropdownMenuItem>
          <DropdownMenuItem onSelect={run(() => exporter.still("jpeg"))}>JPEG (current frame)</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Sequence / Video</DropdownMenuLabel>
          <DropdownMenuItem onSelect={run(() => exporter.pngSequence())}>PNG sequence…</DropdownMenuItem>
          <DropdownMenuItem onSelect={run(() => exporter.webm())}>WebM video</DropdownMenuItem>
          <DropdownMenuItem onSelect={run(() => exporter.mp4())}>MP4 video</DropdownMenuItem>
          <DropdownMenuItem onSelect={run(() => exporter.gif())}>GIF…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Project</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => exporter.exportProjectJSON()}>Project JSON</DropdownMenuItem>
          <DropdownMenuItem onSelect={run(() => exporter.exportInteractiveWeb())}>Interactive web app…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function CompositionSettings() {
  const engine = useEngine();
  const comp = engine.comp;

  const byGroup = useMemo(() => {
    const m = new Map<string, ResolutionPreset[]>();
    for (const p of RESOLUTION_PRESETS) {
      if (!m.has(p.group)) m.set(p.group, []);
      m.get(p.group)!.push(p);
    }
    return m;
  }, []);

  const current = `${comp.width}x${comp.height}`;
  const matched = RESOLUTION_PRESETS.find((p) => `${p.width}x${p.height}` === current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" title="Composition settings">
          <Settings2 className="h-3.5 w-3.5" /> {comp.name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-2">
        <DropdownMenuLabel>Resolution</DropdownMenuLabel>
        <Select
          value={matched ? `${matched.width}x${matched.height}` : "custom"}
          onValueChange={(v) => {
            const [w, h] = v.split("x").map(Number);
            if (w && h) engine.setCompositionSettings({ width: w, height: h });
          }}
        >
          <SelectTrigger className="mb-2">
            <SelectValue placeholder="Custom">{matched ? matched.label : "Custom"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[...byGroup.entries()].map(([group, presets]) => (
              <SelectGroup key={group}>
                <SelectLabel className="px-2 py-1 text-[10px] uppercase text-ink-dim">{group}</SelectLabel>
                {presets.map((p) => (
                  <SelectItem key={p.label} value={`${p.width}x${p.height}`}>
                    {p.label} · {p.width}×{p.height}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>

        <div className="grid grid-cols-2 gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <Labeled label="Width">
            <NumberField value={comp.width} min={1} onChange={(v) => engine.setCompositionSettings({ width: Math.round(v) })} />
          </Labeled>
          <Labeled label="Height">
            <NumberField value={comp.height} min={1} onChange={(v) => engine.setCompositionSettings({ height: Math.round(v) })} />
          </Labeled>
          <Labeled label="FPS">
            <NumberField value={comp.fps} min={1} max={120} onChange={(v) => engine.setCompositionSettings({ fps: Math.round(v) })} />
          </Labeled>
          <Labeled label="Duration (s)">
            <NumberField value={comp.duration} min={0.1} step={0.5} onChange={(v) => engine.setCompositionSettings({ duration: v })} />
          </Labeled>
        </div>

        <div className="mt-2">
          <Labeled label="Background">
            <ColorField
              value={comp.background ?? [0, 0, 0, 0]}
              onChange={(v) => engine.setCompositionSettings({ background: v as [number, number, number, number] })}
            />
          </Labeled>
        </div>

        <DropdownMenuSeparator />
        <label className="flex cursor-pointer items-center justify-between px-1 py-1 text-xs text-ink-dim">
          Safe areas / guides
          <input
            type="checkbox"
            checked={comp.guides.showSafeAreas}
            onChange={(e) => {
              comp.guides.showSafeAreas = e.target.checked;
              engine.bus.emit("project:changed", undefined);
              engine.renderNow();
            }}
          />
        </label>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-ink-dim">{label}</span>
      {children}
    </div>
  );
}

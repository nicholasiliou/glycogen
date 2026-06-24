import { useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, Download, Gamepad, MousePointerClick, Play, Plus, Trash2, Upload } from "lucide-react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";
import { cn } from "@/ui/lib/cn";
import { useLive } from "./LiveProvider";
import { PluginPreview } from "./PluginPreview";

/** A tiny monochrome dial that mirrors the browse position across all plugin types. */
function MiniDial({ index, count }: { index: number; count: number }) {
  const S = 34;
  const c = S / 2;
  const r = 13;
  const a = (-90 + (index * 360) / Math.max(1, count)) * (Math.PI / 180);
  return (
    <svg width={S} height={S} className="shrink-0">
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-edge)" strokeWidth={1} />
      <line
        x1={c}
        y1={c}
        x2={c + Math.cos(a) * (r - 2)}
        y2={c + Math.sin(a) * (r - 2)}
        stroke="var(--color-ink)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <circle cx={c} cy={c} r={1.5} fill="var(--color-ink-dim)" />
    </svg>
  );
}

function DeckSlot({ deck, layerId }: { deck: "A" | "B"; layerId: string | null }) {
  const engine = useEngine();
  const name = layerId ? engine.getLayer(layerId)?.name ?? "—" : "empty";
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className={cn("text-[10px] font-semibold", layerId ? "text-ink" : "text-ink-dim")}>{deck}</span>
      <span className="max-w-[120px] truncate text-[11px] text-ink-dim">{name}</span>
    </div>
  );
}

export function HeaderBar({
  activeTab,
  onTabChange,
  controllerMode,
  onControllerModeChange,
}: {
  activeTab: "stage" | "settings";
  onTabChange: (tab: "stage" | "settings") => void;
  controllerMode: "map" | "play";
  onControllerModeChange: (mode: "map" | "play") => void;
}) {
  const engine = useEngine();
  const live = useLive();
  const {
    types, selectedType, setSelectedType, deckA, deckB, loadDeck, crossfade,
    midi, presets, activePreset, controls,
  } = live;

  const fileRef = useRef<HTMLInputElement>(null);
  const idx = Math.max(0, types.indexOf(selectedType));
  const step = (d: number) => types.length && setSelectedType(types[(idx + d + types.length) % types.length]);
  const both = !!deckA && !!deckB;
  const xfadePos = both ? crossfade : deckA ? 0 : deckB ? 1 : 0.5;

  const label = useMemo(() => engine.registry.get(selectedType)?.label ?? selectedType, [engine, selectedType]);

  const bound = controls.filter((c) => c.assignment !== "none" && !c.disabled).length;
  const status = midi.status;
  const devices = midi.devices();

  const doExport = () => {
    const json = live.exportActive();
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(activePreset?.name ?? "midi-preset").replace(/[^\w.-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File) => {
    const text = await file.text();
    if (!live.importPresetJson(text)) window.alert("That file isn't a valid MIDI preset.");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex h-14 shrink-0 items-center border-b border-edge bg-[#0c0c0d] text-ink">
      <div className="flex rounded border border-edge p-0.5">
        <TabButton active={activeTab === "stage"} onClick={() => onTabChange("stage")}>
          Stage
        </TabButton>
        <TabButton active={activeTab === "settings"} onClick={() => onTabChange("settings")}>
          <Gamepad className="h-3.5 w-3.5" />
          Controller
        </TabButton>
      </div>

      {activeTab === "stage" && (
        <div className="flex items-center gap-3 px-3">
          {/* browse: mini dial + preview + load to a deck */}
          <div className="flex items-center gap-1.5" onWheel={(e) => { e.preventDefault(); step(e.deltaY > 0 ? 1 : -1); }}>
            <Button size="icon-sm" variant="ghost" onClick={() => step(-1)} title="Previous plugin">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <MiniDial index={idx} count={types.length} />
            <Button size="icon-sm" variant="ghost" onClick={() => step(1)} title="Next plugin">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <PluginPreview type={selectedType} className="w-52" />
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => loadDeck("A")} title={`Load ${label} → Deck A`}>
              A
            </Button>
            <Button size="sm" variant="outline" onClick={() => loadDeck("B")} title={`Load ${label} → Deck B`}>
              B
            </Button>
          </div>

          <div className="flex-1" />

          {/* decks + crossfade indicator */}
          <div className="flex items-center gap-2">
            <DeckSlot deck="A" layerId={deckA} />
            <div className="relative h-1 w-20 rounded-full bg-edge" title="A / B crossfade">
              <div
                className="absolute top-1/2 h-2.5 w-1 -translate-y-1/2 rounded-full bg-ink"
                style={{ left: `calc(${xfadePos * 100}% - 2px)` }}
              />
            </div>
            <DeckSlot deck="B" layerId={deckB} />
          </div>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="flex flex-wrap items-center gap-2 px-3 text-xs">
          <span className="text-[10px] uppercase tracking-wide text-ink-dim">Preset</span>
          <Select value={activePreset?.id ?? ""} onValueChange={(id) => live.selectPreset(id)}>
            <SelectTrigger className="h-7 w-44">
              <SelectValue placeholder="No preset" />
            </SelectTrigger>
            <SelectContent>
              {presets.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            key={activePreset?.id}
            className="h-7 w-36"
            defaultValue={activePreset?.name ?? ""}
            placeholder="Preset name"
            onBlur={(e) => activePreset && live.renamePreset(activePreset.id, e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <Button size="sm" variant="ghost" onClick={() => live.createNewPreset()} title="New preset">
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
          <Button size="sm" variant="ghost" onClick={() => live.duplicateActive()} title="Duplicate preset">
            Duplicate
          </Button>
          <Button size="sm" variant="ghost" onClick={doExport} title="Export preset as JSON">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} title="Import preset JSON">
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => activePreset && live.deletePreset(activePreset.id)}
            title="Delete preset"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])}
          />

          <div className="flex-1" />

          {/* device info */}
          <span className="text-[10px] uppercase tracking-wide text-ink-dim">Device</span>
          {status === "unsupported" ? (
            <span className="text-amber-400">Web MIDI unavailable</span>
          ) : status === "denied" ? (
            <Button size="sm" variant="ghost" onClick={() => midi.enable()}>
              Access denied — retry
            </Button>
          ) : devices.length === 0 ? (
            <span className="text-ink-dim">No device connected</span>
          ) : (
            devices.map((d) => (
              <span key={d.id} className="flex items-center gap-1.5 text-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {d.name}
              </span>
            ))
          )}
          <span className="text-ink-dim">· {bound} bound</span>

          {/* Map / Play toggle */}
          <div className="flex rounded border border-edge p-0.5">
            <TabButton active={controllerMode === "map"} onClick={() => onControllerModeChange("map")}>
              <MousePointerClick className="h-3.5 w-3.5" />
              Map
            </TabButton>
            <TabButton active={controllerMode === "play"} onClick={() => onControllerModeChange("play")}>
              <Play className="h-3.5 w-3.5" />
              Play
            </TabButton>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-accent text-black" : "text-ink-dim hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

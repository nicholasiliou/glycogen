import { useMemo } from "react";
import { Gamepad } from "lucide-react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/ui/button";
import { cn } from "@/ui/lib/cn";
import { useLive } from "./LiveProvider";
import { PluginPreview } from "./PluginPreview";
import { ExportPanel } from "./ExportPanel";

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
    </svg>
  );
}

/**
 * Minimal per-side bank readout: the side letter, the active bank's plugin name, and three dots
 * for the storage banks — filled when a bank holds a plugin, ringed + bright for the active one.
 */
function DeckSlot({ deck, layerId, banks, active }: {
  deck: "A" | "B";
  layerId: string | null;
  banks: (string | null)[];
  active: number;
}) {
  const engine = useEngine();
  const nameOf = (id: string | null) => (id ? engine.getLayer(id)?.name ?? "—" : null);
  const name = nameOf(layerId) ?? "empty";
  const dots = (
    <div className="flex items-center gap-1">
      {banks.map((bank, i) => {
        const filled = !!bank;
        const isActive = i === active;
        return (
          <span
            key={i}
            title={`Bank ${deck}${i + 1}${bank ? ` · ${nameOf(bank)}` : " · empty"}${isActive ? " (active)" : ""}`}
            className={cn(
              "h-2 w-2 rounded-full border",
              isActive ? "border-accent" : "border-transparent",
              filled ? (isActive ? "bg-accent" : "bg-ink/50") : "bg-edge",
            )}
          />
        );
      })}
    </div>
  );
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className={cn("text-[10px] font-semibold", layerId ? "text-ink" : "text-ink-dim")}>{deck}</span>
      <span className="max-w-[120px] truncate text-[11px] text-ink" title="Active bank (MIDI-controlled)">{name}</span>
      {dots}
    </div>
  );
}

export function HeaderBar({
  controllerOpen,
  onControllerToggle,
}: {
  controllerOpen: boolean;
  onControllerToggle: () => void;
}) {
  const engine = useEngine();
  const live = useLive();
  const { types, selectedType, deckA, deckB, deckBanks, activeBank, crossfade, shaderType } = live;
  const { browseMode, shaders, toggleBrowseMode } = live;

  const shaderMode = browseMode === "shader";
  const list = shaderMode ? shaders : types;
  const current = shaderMode ? shaderType : selectedType;
  const idx = Math.max(0, list.indexOf(current));
  // Drive browse through the shared routing so the header, the surface and MIDI all agree.
  const step = (d: number) => live.driveAssignment("browse", { value: 0, relative: true, delta: d });
  const both = !!deckA && !!deckB;
  const xfadePos = both ? crossfade : deckA ? 0 : deckB ? 1 : 0.5;

  const label = useMemo(() => engine.registry.get(selectedType)?.label ?? selectedType, [engine, selectedType]);

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 px-3 text-ink">

      {/* browse: mini dial + preview + load to a deck */}
      <div className="flex items-center gap-1.5" onWheel={(e) => { e.preventDefault(); step(e.deltaY > 0 ? 1 : -1); }}>
        <MiniDial index={idx} count={list.length} />
      </div>
      {shaderMode ? (
        <div className="flex w-52 items-center rounded border border-edge px-2 py-1 text-[11px] text-ink">
          <span className="text-ink-dim">Shader:&nbsp;</span>
          {current.replace(/^fx\./, "") || "none"}
        </div>
      ) : (
        <PluginPreview type={selectedType} className="w-52" />
      )}

      <div className="flex-1" />

      {/* decks + crossfade indicator */}
      <div className="flex items-center gap-2">
        <DeckSlot deck="A" layerId={deckA} banks={deckBanks.A} active={activeBank.A} />
        <div className="relative h-1 w-20 rounded-full bg-edge" title="A / B crossfade">
          <div
            className="absolute top-1/2 h-2.5 w-1 -translate-y-1/2 rounded-full bg-ink"
            style={{ left: `calc(${xfadePos * 100}% - 2px)` }}
          />
        </div>
        <DeckSlot deck="B" layerId={deckB} banks={deckBanks.B} active={activeBank.B} />
      </div>

      {/* export + controller toggle */}
      <ExportPanel />
      <Button
        size="icon-sm"
        variant={controllerOpen ? "default" : "ghost"}
        onClick={onControllerToggle}
        title={controllerOpen ? "Close controller" : "Open controller"}
      >
        <Gamepad className="h-4 w-4" />
      </Button>
    </div>
  );
}

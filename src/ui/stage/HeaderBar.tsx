import { useMemo } from "react";
import { Gamepad } from "lucide-react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/cn";
import { useLive } from "@/ui/app/LiveProvider";
import { PluginPreview } from "@/ui/stage/PluginPreview";
import { ExportPanel } from "@/ui/export/ExportPanel";

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

function DeckSlot({ deck, layerId, banks, active }: {
  deck: "A" | "B";
  layerId: string | null;
  banks: (string | null)[];
  active: number;
}) {
  const engine = useEngine();
  const nameOf = (id: string | null) => (id ? engine.getLayer(id)?.name ?? "—" : null);
  const name = nameOf(layerId) ?? "";

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="max-w-30 truncate text-[11px] text-ink" title="Active bank (MIDI-controlled)">{name}</span>
      <div className="flex items-center gap-1">
        {banks.map((bank, i) => (
          <span
            key={i}
            title={`Bank ${deck}${i + 1}${bank ? ` · ${nameOf(bank)}` : ""}${i === active ? " (active)" : ""}`}
            className={cn(
              "h-2 w-2 rounded-full border",
              i === active ? "border-accent" : "border-transparent",
              bank ? (i === active ? "bg-accent" : "bg-ink/50") : "bg-edge",
            )}
          />
        ))}
      </div>
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
  const { decks, dispatch } = useLive();
  const { types, selectedType, deckA, deckB, deckBanks, activeBank, crossfade, shaderType } = decks;
  const { browseMode, shaders } = decks;

  const shaderMode = browseMode === "shader";
  const list = shaderMode ? shaders : types;
  const current = shaderMode ? shaderType : selectedType;
  const idx = Math.max(0, list.indexOf(current));
  const step = (d: number) => dispatch.driveAssignment("browse", { value: 0, relative: true, delta: d });
  const both = !!deckA && !!deckB;
  const xfadePos = both ? crossfade : deckA ? 0 : deckB ? 1 : 0.5;

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 px-3 text-ink">
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

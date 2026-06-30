import { Gamepad, Plus } from "lucide-react";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/cn";
import { useLive } from "@/ui/app/LiveProvider";
import { PluginPreview } from "@/ui/stage/PluginPreview";
import { ExportPanel } from "@/ui/export/ExportPanel";
import type { DeckName } from "@/runtime/Stage";

/** The little dial showing the browse position. Click to step forward, wheel to scrub either way. */
function MiniDial({ index, count, onStep }: { index: number; count: number; onStep: (d: number) => void }) {
  const S = 34;
  const c = S / 2;
  const r = 13;
  const a = (-90 + (index * 360) / Math.max(1, count)) * (Math.PI / 180);
  return (
    <button
      type="button"
      onClick={() => onStep(1)}
      onWheel={(e) => onStep(e.deltaY > 0 ? 1 : -1)}
      title="Click to cycle · scroll to scrub"
      className="shrink-0 cursor-pointer rounded-full transition-colors hover:bg-ink/5"
    >
      <svg width={S} height={S} className="block">
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
    </button>
  );
}

function DeckSlot({ deck }: { deck: DeckName }) {
  const { decks, selectBank, load } = useLive();
  const d = decks[deck];
  const layer = d.banks[d.active];
  const name = layer ? layer.constructor.name.replace(/Layer$/, "") : "";

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="max-w-30 truncate text-[11px] text-ink" title="Active bank">{name}</span>
      <div className="flex items-center gap-1">
        {d.banks.map((bank, i) => (
          <button
            key={i}
            type="button"
            // Loaded bank → make it active; empty bank → load the browsed plugin into it.
            onClick={() => (bank ? selectBank(deck, i) : load(deck, i))}
            title={`Bank ${deck}${i + 1}${bank ? " · loaded" : " · empty (click to load)"}${i === d.active ? " (active)" : ""}`}
            className={cn(
              "h-3 w-3 cursor-pointer rounded-full border transition-colors hover:border-accent/70",
              i === d.active ? "border-accent" : "border-transparent",
              bank ? (i === d.active ? "bg-accent" : "bg-ink/50") : "bg-edge",
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
  const { generators, effects, browseMode, selected, selectedIndex, step, crossfade, decks, shaderName, clearShader, lastMidi, load } = useLive();
  const shaderMode = browseMode === "shader";
  const list = shaderMode ? effects : generators;

  const both = !!decks.A.banks[decks.A.active] && !!decks.B.banks[decks.B.active];
  const xfadePos = both ? crossfade : decks.A.banks[decks.A.active] ? 0 : decks.B.banks[decks.B.active] ? 1 : 0.5;

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 px-3 text-ink">
      <MiniDial index={selectedIndex} count={list.length} onStep={step} />
      {shaderMode ? (
        // In shader mode the previewed shader is applied live, so browsing == active.
        <div className="flex w-52 items-center gap-1 rounded border border-edge px-2 py-1 text-[11px]">
          <span className="text-ink-dim/60 shrink-0">shader:</span>
          <span className="min-w-0 truncate text-ink font-medium flex-1">{shaderName ?? <span className="text-ink-dim/40">none</span>}</span>
          {shaderName && (
            <button onClick={clearShader} className="shrink-0 text-ink-dim/40 hover:text-ink leading-none" title="Clear shader (None)">✕</button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <PluginPreview info={selected} className="w-52" />
        </div>
      )}

      <div className="flex-1" />

      {lastMidi && (
        <span className="min-w-0 truncate text-[11px] text-ink-dim" title="Last MIDI action">
          {lastMidi.control} → {lastMidi.target}
        </span>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <DeckSlot deck="A" />
        <div className="relative h-1 w-20 rounded-full bg-edge" title="A / B crossfade">
          <div
            className="absolute top-1/2 h-2.5 w-1 -translate-y-1/2 rounded-full bg-ink"
            style={{ left: `calc(${xfadePos * 100}% - 2px)` }}
          />
        </div>
        <DeckSlot deck="B" />
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

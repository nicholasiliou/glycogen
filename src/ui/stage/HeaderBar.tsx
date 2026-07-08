import { useRef, useState } from "react";
import { Gamepad, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/components/dialog";
import { cn } from "@/ui/lib/cn";
import { useLive } from "@/ui/app/LiveProvider";
import { PluginPreview } from "@/ui/stage/PluginPreview";
import { ExportPanel } from "@/ui/export/ExportPanel";
import type { Plugin } from "@/plugins/Plugin";
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
  const { decks, selectBank, load, clearDeck } = useLive();
  const d = decks[deck];
  const layer = d.banks[d.active];
  const name = layer ? layer.constructor.name.replace(/Layer$/, "") : "";
  const [removing, setRemoving] = useState<number | null>(null);

  const onBankClick = (bank: Plugin | null, i: number) => {
    if (!bank) return load(deck, i);
    if (i === d.active) setRemoving(i);
    else selectBank(deck, i);
  };

  const removingLayer = removing !== null ? d.banks[removing] : null;
  const removingName = removingLayer ? removingLayer.constructor.name.replace(/Layer$/, "") : "";

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="max-w-30 truncate text-[11px] text-ink" title="Active bank">{name}</span>
      <div className="flex items-center gap-1">
        {d.banks.map((bank, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onBankClick(bank, i)}
            title={`Bank ${deck}${i + 1}${bank ? (i === d.active ? " · active (click to remove)" : " · loaded (click to activate)") : " · empty (click to load)"}`}
            className={cn(
              "h-3 w-3 cursor-pointer rounded-full border transition-colors hover:border-accent/70",
              i === d.active ? "border-accent" : "border-transparent",
              bank ? (i === d.active ? "bg-accent" : "bg-ink/50") : "bg-edge",
            )}
          />
        ))}
      </div>

      <Dialog open={removing !== null} onOpenChange={(o: boolean) => !o && setRemoving(null)}>
        <DialogContent className="w-[min(360px,90vw)] bg-panel/10 backdrop-blur-sm shadow-2xl">
          <DialogHeader>
            <DialogTitle>Remove plugin</DialogTitle>
            <DialogDescription>
              Remove <span className="text-ink font-medium">{removingName}</span> from bank {deck}
              {(removing ?? 0) + 1}? This bank will be emptied.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 px-4 pb-4 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (removing !== null) clearDeck(deck, removing);
                setRemoving(null);
              }}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
  const { generators, effects, browseMode, toggleBrowseMode, selected, selectedIndex, step, crossfade, setCrossfade, shaderName, muted, toggleMute, clearShader, lastMidi } = useLive();
  const shaderMode = browseMode === "shader";
  const list = shaderMode ? effects : generators;

  // The header bar always reflects the live crossfade value so the handle tracks dragging.
  const xfadePos = crossfade;

  // Drag anywhere on the crossfade grab zone to scrub A↔B.
  const barRef = useRef<HTMLDivElement>(null);
  const scrub = (clientX: number) => {
    const el = barRef.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    setCrossfade(Math.max(0, Math.min(1, (clientX - left) / width)));
  };
  const onBarDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub(e.clientX);
  };
  const onBarMove = (e: React.PointerEvent) => {
    if (e.buttons) scrub(e.clientX);
  };

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 px-3 text-ink">
      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-ink-dim" title="Toggle shader browsing">
        <span className={cn(!shaderMode && "text-ink")}>gen</span>
        <Switch checked={shaderMode} onCheckedChange={toggleBrowseMode} />
        <span className={cn(shaderMode && "text-ink")}>fx</span>
      </label>
      <MiniDial index={selectedIndex} count={list.length} onStep={step} />
      {/* Both modes share the same preview chip; in shader mode the browsed effect is applied live. */}
      <div className="flex items-center gap-1.5">
        <PluginPreview info={selected} className="w-52" />
        {shaderMode && shaderName && (
          <button onClick={clearShader} className="shrink-0 text-ink-dim/40 hover:text-ink leading-none" title="Clear shader (None)">✕</button>
        )}
      </div>

      <div className="flex-1" />

      {lastMidi && (
        <span className="min-w-0 truncate text-[11px] text-ink-dim" title="Last MIDI action">
          {lastMidi.control} → {lastMidi.target}
        </span>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <DeckSlot deck="A" />
        {/* Full-height grab zone around the thin bar so it's easy to drag; the bar itself is unchanged. */}
        <div
          ref={barRef}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          className="relative flex h-6 w-20 cursor-ew-resize touch-none items-center"
          title="Drag to crossfade A / B"
        >
          <div className="relative h-1 w-full rounded-full bg-edge">
            <div
              className="pointer-events-none absolute top-1/2 h-2.5 w-1 -translate-y-1/2 rounded-full bg-ink"
              style={{ left: `calc(${xfadePos * 100}% - 2px)` }}
            />
          </div>
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
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={toggleMute}
        title={muted ? "Unmute" : "Mute"}
        className={cn(muted && "text-red-400/70")}
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </Button>
    </div>
  );
}

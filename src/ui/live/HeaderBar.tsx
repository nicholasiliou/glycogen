import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, Power, Settings2, SlidersHorizontal } from "lucide-react";
import { useEngine, useTime } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/ui/button";
import { Slider } from "@/ui/components/ui/slider";
import { Separator } from "@/ui/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/components/ui/popover";
import { cn } from "@/ui/lib/cn";
import { SCALE_NAMES, type ScaleName } from "@/audio/scale";
import { useLive } from "./LiveProvider";
import { PluginPreview } from "./PluginPreview";
import { Mixer } from "./Mixer";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

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

export function HeaderBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const engine = useEngine();
  const { playing } = useTime();
  const {
    types, selectedType, setSelectedType, deckA, deckB, loadDeck, crossfade,
    started, startAudio, master, setMaster, bpm, setBpm, root, scale, setKey,
  } = useLive();

  const idx = Math.max(0, types.indexOf(selectedType));
  const step = (d: number) => types.length && setSelectedType(types[(idx + d + types.length) % types.length]);
  const rootIdx = (((root - 48) % 12) + 12) % 12;
  const both = !!deckA && !!deckB;
  const xfadePos = both ? crossfade : deckA ? 0 : deckB ? 1 : 0.5;

  const label = useMemo(() => engine.registry.get(selectedType)?.label ?? selectedType, [engine, selectedType]);

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-edge bg-[#0c0c0d] px-3 text-ink">
      <span className="select-none text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-dim">◇ Live</span>

      {/* transport / audio — tucked into a popover so audio stays understated */}
      <Button size="icon-sm" variant="ghost" onClick={() => engine.togglePlay()} title="Play / Pause (Space)">
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="icon-sm" variant="ghost" title="Tempo · key · audio">
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          {!started ? (
            <Button size="sm" variant="outline" className="w-full" onClick={() => void startAudio()}>
              <Power className="h-3.5 w-3.5" /> Start Audio
            </Button>
          ) : (
            <Row label="Master">
              <Slider className="w-36" min={0} max={1} step={0.01} value={[master]} onValueChange={([v]) => setMaster(v)} />
            </Row>
          )}
          <Row label="BPM">
            <Slider className="w-32" min={60} max={160} step={1} value={[bpm]} onValueChange={([v]) => setBpm(v)} />
            <span className="w-7 text-right tabular-nums">{bpm}</span>
          </Row>
          <Row label="Key">
            <select
              value={rootIdx}
              onChange={(e) => setKey(48 + Number(e.target.value), scale)}
              className="rounded border border-edge bg-panel-raised px-1 py-0.5 text-xs outline-none"
            >
              {NOTE_NAMES.map((nm, i) => (
                <option key={nm} value={i}>{nm}</option>
              ))}
            </select>
            <select
              value={scale}
              onChange={(e) => setKey(root, e.target.value as ScaleName)}
              className="rounded border border-edge bg-panel-raised px-1 py-0.5 text-xs outline-none"
            >
              {SCALE_NAMES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Row>
          <Separator />
          <div className="text-[10px] uppercase tracking-wide text-ink-dim">Voices</div>
          <Mixer />
        </PopoverContent>
      </Popover>

      <Separator orientation="vertical" className="h-6" />

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
          → A
        </Button>
        <Button size="sm" variant="outline" onClick={() => loadDeck("B")} title={`Load ${label} → Deck B`}>
          → B
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

      <Separator orientation="vertical" className="h-6" />
      <Button size="icon-sm" variant="ghost" onClick={onOpenSettings} title="MIDI settings & keymap">
        <Settings2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] uppercase text-ink-dim">{label}</span>
      {children}
    </div>
  );
}

/**
 * The "Claude DJ" surface: a skeuomorphic, MixTrack-style layout of the live editor's MIDI keymap.
 * Two decks (A / B) flank a central mixer. Every element is a real assignment — drag/press it to
 * play the visuals, or switch the surface to map mode to bind hardware controls to it.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { cn } from "@/ui/lib/cn";
import type { Deck } from "@/midi/preset";
import { useLive } from "../LiveProvider";
import {
  BrowsePanel,
  ControllerMode,
  Crossfader,
  Fader,
  JogWheel,
  Knob,
  ModeProvider,
  Pad,
} from "./widgets";

/** ~30fps tick so live meters / "just moved" glows animate while the surface is mounted. */
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="select-none text-[8px] font-semibold uppercase tracking-[0.18em] text-ink-dim/70">{children}</span>;
}

function DeckPanel({ deck }: { deck: Deck }) {
  const engine = useEngine();
  const live = useLive();
  const layerId = deck === "A" ? live.deckA : live.deckB;
  const A = deck === "A";

  const amount = <Fader assignment={`${deck}:amount`} label="Amount" />;
  const stack = (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-center gap-3">
        <Pad assignment={`${deck}:trigger`} label="Reseed" />
        <Pad assignment={`${deck}:toggle`} label="Toggle" />
      </div>
      <JogWheel assignment={`${deck}:evolveX`} label="Evolve" />
      <div className="flex items-end gap-6">
        <Knob assignment={`${deck}:evolveY`} label="Evolve Y" />
        <Knob assignment={`${deck}:toneX`} label="Tone X" />
        <Knob assignment={`${deck}:toneY`} label="Tone Y" />
      </div>
      <Pad assignment={A ? "loadA" : "loadB"} label={`Load → ${deck}`} className="w-24" />
    </div>
  );

  return (
    <div
      className="relative flex flex-col gap-4 rounded-xl p-6"
    >

      <div className="flex items-center justify-between px-1">
        <SectionLabel>Deck {deck}</SectionLabel>
      </div>

      <div className={cn("flex items-stretch gap-8", A ? "flex-row" : "flex-row-reverse")}>
        <div className="flex flex-col items-center justify-center">{amount}</div>
        {stack}
      </div>
    </div>
  );
}

function MixerPanel() {
  return (
    <div className="flex flex-col items-center gap-8 px-8 py-6"
    >
      <BrowsePanel />

      <div className="flex flex-col items-center gap-2">
        <SectionLabel>Crossfade</SectionLabel>
        <Crossfader />
      </div>
    </div>
  );
}

/** The bare surface. `mode` decides whether interaction plays the visuals or binds controls. */
export function Controller({ mode }: { mode: ControllerMode }) {
  useRaf();
  return (
    <ModeProvider value={mode}>
      <div
        className="flex h-full w-full items-center justify-center overflow-auto from-ink to-ink-dim/95"
      >
        <div className="flex items-stretch gap-4 p-4">
          <DeckPanel deck="A" />
          <MixerPanel />
          <DeckPanel deck="B" />
        </div>
      </div>
    </ModeProvider>
  );
}

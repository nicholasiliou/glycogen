/**
 * The "Claude DJ" surface: a skeuomorphic, MixTrack-style layout of the live editor's MIDI keymap.
 * Two decks (A / B) flank a central mixer. Every element is a real assignment — drag/press it to
 * play the visuals, or switch the surface to map mode to bind hardware controls to it.
 */
import { useEffect, useState } from "react";
import type { Deck } from "@/midi/preset";
import {
  BrowsePanel,
  ControllerModeContext,
  Crossfader,
  Fader,
  JogWheel,
  Knob,
  Pad,
  type ControllerMode,
} from "./widgets"; // Knob is used in MixerPanel

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
  const A = deck === "A";

  const stack = (
    <div className="flex flex-col items-center gap-6">
      <JogWheel assignment={`${deck}:evolveX`} label="Evolve" />
      <div className="flex items-center gap-3">
        <Pad assignment={`${deck}:trigger`} label="Reseed" />
        <Pad assignment={`${deck}:toggle`} label="Toggle" />
        <Pad assignment="" className="w-24" />
        <Pad assignment={A ? "swapA" : "swapB"} label="Stash" className="w-24" />
      </div>
    </div>
  );

  return (
    <div className="relative flex flex-col gap-4 rounded-xl p-6">
      <div className="flex items-center justify-between px-1">
        <SectionLabel>Deck {deck}</SectionLabel>
      </div>
      {stack}
    </div>
  );
}

function MixerPanel() {
  return (
    <div className="flex flex-col items-center gap-8 px-8 py-6">


      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center gap-2">
          <Knob assignment="A:evolveY" label="Evolve Y" />
          <Knob assignment="A:toneX" label="Tone X" />
          <Knob assignment="A:toneY" label="Tone Y" />
          <Pad assignment="loadA" label="Load A"/>
        </div>
        <div className="flex flex-col gap-2 border-8 border-mist-950 rounded-2xl p-4">
          <Knob assignment="1" label="test1" />
          <Knob assignment="2" label="test2" />
        <BrowsePanel />
        <Pad assignment="browseMode" label="Browser Toggle" className="h-9 w-16" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <Knob assignment="B:evolveY" label="Evolve Y" />
          <Knob assignment="B:toneX" label="Tone X" />
          <Knob assignment="B:toneY" label="Tone Y" />
          <Pad assignment="loadB" label="Load B"/>
        </div>
      </div>
      <div className="flex flex-row gap-8">
        <div className="flex flex-col items-center gap-2">
          <Fader assignment="A:amount" label="Amount A" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <Fader assignment="B:amount" label="Amount B" />
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <SectionLabel>Crossfade</SectionLabel>
        <Crossfader />
      </div>
    </div>
  );
}

export function Controller({ allowMap = true }: { allowMap?: boolean }) {
  useRaf();
  const [mode] = useState<ControllerMode>("map");
  const effective: ControllerMode = allowMap ? mode : "play";

  return (
    <ControllerModeContext.Provider value={effective}>
      <div className="relative flex h-full w-full flex-col items-center justify-center overflow-auto">
        <div className="flex items-stretch gap-4 p-4">
          <DeckPanel deck="A" />
          <MixerPanel />
          <DeckPanel deck="B" />
        </div>
      </div>
    </ControllerModeContext.Provider>
  );
}

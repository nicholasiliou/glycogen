//A skeuomorphic, MixTrack-style layout of the live control surface.
// Identical layout to before — only the wiring changed: each widget now drives an abstract
// ControlBus slot (assigned here), instead of a learned MIDI assignment.

import { useContext, useEffect, useState } from "react";
import {
  BankControlContext,
  BrowsePanel,
  Circle,
  Crossfader,
  Fader,
  GlobalPad,
  JogWheel,
  Knob,
  Pad,
  SmoothKnob,
} from "./widgets";
import { BANK_COUNT, type DeckName } from "@/runtime/Stage";

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

/**
 * The top row of every deck is global, not plugin-bindable: Del + Bank 1/2/3 for this deck. A bank
 * button selects its bank if loaded, else loads the browsed plugin into it; Del clears the active
 * bank. (The pad slots they replace — pad:0..3 — are reserved away from plugins in the factory.)
 */
function DeckBankRow({ deck }: { deck: DeckName }) {
  const bank = useContext(BankControlContext);
  const s = bank?.state(deck) ?? { loaded: [], active: -1 };
  return (
    <>
      <GlobalPad label="Del" onPress={() => bank?.clear(deck)} loaded={!!s.loaded[s.active]} />
      {Array.from({ length: BANK_COUNT }, (_, i) => (
        <GlobalPad
          key={i}
          label={`Bank ${i + 1}`}
          active={s.active === i && !!s.loaded[i]}
          loaded={!!s.loaded[i]}
          onPress={() => bank?.select(deck, i)}
        />
      ))}
    </>
  );
}

/** A deck. `pad`/`enc`/`jog` are the slot indices for this deck so the two decks don't collide. */
function DeckPanel({ deck, pad, enc, jog }: { deck: DeckName; pad: number; enc: number; jog: number }) {
  const stack = (
    <div className="flex flex-col items-center gap-6">
    <div className="grid grid-cols-4 gap-3">
      {/* top row: global bank/del controls (not plugin slots) */}
      <DeckBankRow deck={deck} />

      <Pad slot={pad + 4}/>
      <SmoothKnob slot={enc + 0}/>
      <SmoothKnob slot={enc + 1}/>
      <SmoothKnob slot={enc + 2}/>

      <Pad slot={pad + 5}/>
      <Pad slot={pad + 6}/>
      <Pad slot={pad + 7}/>
      <Pad slot={pad + 8}/>
    </div>
      <JogWheel slot={jog}/>
      <div className="flex items-center gap-3">
        <Pad slot={pad + 9}/>
        <Pad slot={pad + 10}/>
        <Pad slot={pad + 11}/>
        <Pad slot={pad + 12}/>
      </div>
    </div>
  );

  return (
    <div className="relative flex flex-col gap-4 rounded-xl p-6">
      {stack}
    </div>
  );
}

function MixerPanel({ browse }: { browse?: BrowseProps }) {
  return (
    <div className="flex flex-col items-center gap-8 px-8 py-6">


<div className="grid grid-cols-3 gap-4 gap-x-0 items-top">
  <Knob slot={0}/>
  <Knob slot={1}/>
  <Knob slot={2}/>

  <Knob slot={3}/>
  <Knob slot={4}/>
  <Knob slot={5}/>

  <Knob slot={6}/>
  <BrowsePanel label={browse?.label} onStep={browse?.onStep} />
  <Knob slot={7}/>

  <Circle slot={0}/>
  <div></div>
  <Circle slot={1}/>
  <Pad slot={26}/>
  <Pad slot={27}/>
  <Pad slot={28}/>
  <Fader slot={0}/>
  <Fader slot={1}/>
  <Fader slot={2}/>
  </div>
      <div className="flex flex-col items-center gap-2">
        <SectionLabel>Crossfade</SectionLabel>
        <Crossfader/>
      </div>
    </div>
  );
}

export interface BrowseProps {
  label?: string;
  onStep?: (delta: number) => void;
}

export function Controller({ browse }: { browse?: BrowseProps }) {
  useRaf();

  return (
    // Intrinsic size (no h-full/w-full): the surface sizes to its content so FitBox can scale it
    // uniformly to fit the masked overlay without distorting the components.
    <div className="relative flex flex-col items-center justify-center">
      <div className="flex items-stretch gap-4 p-4">
        <DeckPanel deck="A" pad={0} enc={0} jog={0}/>
        <MixerPanel browse={browse}/>
        <DeckPanel deck="B" pad={13} enc={3} jog={1}/>
      </div>
    </div>
  );
}

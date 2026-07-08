//A skeuomorphic, MixTrack-style layout of the live control surface.
// Identical layout to before — only the wiring changed: each widget now drives an abstract
// ControlBus slot (assigned here), instead of a learned MIDI assignment.

import { useContext, useEffect, useState } from "react";
import {
  BankControlContext,
  BrowsePanel,
  Circle,
  Fader,
  GlobalPad,
  JogWheel,
  Knob,
  Pad,
  SmoothKnob,
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

/**
 * The top row of every panel is global, not plugin-bindable: Del + three of the unified banks
 * (banks are one flat row now — the left panel shows 1–3, the right 4–6). A bank button selects
 * its bank if loaded, else loads the browsed plugin into it; Del clears the active bank.
 */
function BankRow({ from }: { from: number }) {
  const bank = useContext(BankControlContext);
  const s = bank?.state() ?? { loaded: [], active: -1 };
  return (
    <>
      <GlobalPad label="Del" onPress={() => bank?.clear()} loaded={!!s.loaded[s.active]} />
      {Array.from({ length: 3 }, (_, i) => from + i).map((i) => (
        <GlobalPad
          key={i}
          label={`Bank ${i + 1}`}
          active={s.active === i && !!s.loaded[i]}
          loaded={!!s.loaded[i]}
          onPress={() => bank?.select(i)}
        />
      ))}
    </>
  );
}

/** A side panel. `pad`/`enc` are the slot indices for this side; `jog` is its browse wheel. */
function SidePanel({ bankFrom, pad, enc, jog, jogLabel }: { bankFrom: number; pad: number; enc: number; jog: number; jogLabel: string }) {
  const stack = (
    <div className="flex flex-col items-center gap-6">
    <div className="grid grid-cols-4 gap-3">
      {/* top row: global bank/del controls (not plugin slots) */}
      <BankRow from={bankFrom} />

      <Pad slot={pad + 4}/>
      <SmoothKnob slot={enc + 0}/>
      <SmoothKnob slot={enc + 1}/>
      <SmoothKnob slot={enc + 2}/>

      <Pad slot={pad + 5}/>
      <Pad slot={pad + 6}/>
      <Pad slot={pad + 7}/>
      <Pad slot={pad + 8}/>
    </div>
      <JogWheel slot={jog} label={jogLabel}/>
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
  <BrowsePanel label={browse?.plugin.label} onStep={browse?.plugin.onStep} />
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
        <SectionLabel>Shader</SectionLabel>
        <BrowsePanel label={browse?.shader.label ?? "None"} onStep={browse?.shader.onStep} />
      </div>
    </div>
  );
}

interface BrowseDial {
  label?: string;
  onStep?: (delta: number) => void;
}

export interface BrowseProps {
  plugin: BrowseDial;
  shader: BrowseDial;
}

export function Controller({ browse }: { browse?: BrowseProps }) {
  useRaf();

  return (
    // Intrinsic size (no h-full/w-full): the surface sizes to its content so FitBox can scale it
    // uniformly to fit the masked overlay without distorting the components.
    <div className="relative flex flex-col items-center justify-center">
      <div className="flex items-stretch gap-4 p-4">
        <SidePanel bankFrom={0} pad={0} enc={0} jog={0} jogLabel="plugins"/>
        <MixerPanel browse={browse}/>
        <SidePanel bankFrom={3} pad={13} enc={3} jog={1} jogLabel="shaders"/>
      </div>
    </div>
  );
}

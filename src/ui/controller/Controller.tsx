//A skeuomorphic, MixTrack-style layout of the live control surface.
// Identical layout to before — only the wiring changed: each widget now drives an abstract
// ControlBus slot (assigned here), instead of a learned MIDI assignment.

import { useEffect, useState } from "react";
import {
  Circle,
  Fader,
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

/** A side panel. `pad`/`enc` are the slot indices for this side; `jog` is its browse wheel. */
function SidePanel({ pad, enc, jog, jogLabel }: { pad: number; enc: number; jog: number; jogLabel: string }) {
  const stack = (
    <div className="flex flex-col items-center gap-6">
    <div className="grid grid-cols-4 gap-3">
      {/* top row: ordinary pads — the factory action layout puts Clear/Bank 1–6 here */}
      <Pad slot={pad + 0}/>
      <Pad slot={pad + 1}/>
      <Pad slot={pad + 2}/>
      <Pad slot={pad + 3}/>

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
    <div className="relative flex flex-col gap-4 rounded-xl px-2 py-6">
      {stack}
    </div>
  );
}

function MixerPanel() {
  return (
    <div className="flex flex-col items-center gap-8 px-3 py-6">


{/* Real column gaps: the 32px knobs need horizontal room for their (truncated) labels. */}
<div className="grid grid-cols-3 gap-y-4 gap-x-8 items-top">
  <Knob slot={0}/>
  <Knob slot={1}/>
  <Knob slot={2}/>

  <Knob slot={3}/>
  <Knob slot={4}/>
  <Knob slot={5}/>

  <Knob slot={6}/>
  <div></div>
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

  {/* horizontal fader spanning the mixer width, below the three vertical faders */}
  <div className="w-full px-2">
    <Fader slot={3} orient="horizontal"/>
  </div>
    </div>
  );
}

export function Controller() {
  useRaf();

  return (
    // Intrinsic size (no h-full/w-full): the surface sizes to its content so FitBox can scale it
    // uniformly to fit the masked overlay without distorting the components.
    <div className="relative flex flex-col items-center justify-center">
      <div className="flex items-stretch gap-4 p-4">
        <SidePanel pad={0} enc={0} jog={0} jogLabel="plugins"/>
        <MixerPanel/>
        <SidePanel pad={13} enc={3} jog={1} jogLabel="shaders"/>
      </div>
    </div>
  );
}

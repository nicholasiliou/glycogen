/**
 * Skeuomorphic controller widgets — knobs, faders, a jog wheel, pads and a crossfader rendered
 * with pure CSS (gradients + inset shadows, no bitmaps) so the live editor's MIDI keymap can be
 * *seen* and *played* as a physical-looking DJ surface.
 *
 * Hover any widget to reveal its MIDI binding overlay — click to arm learning, right-click to clear.
 * The overlay stays visible while learning is active so you can wiggle the hardware control.
 *
 * Each widget lives in its own file; shared chrome (the play/map context, slot binding, and the
 * label + binding overlay frame) is in ./shared.
 */
export { ControllerModeContext, type ControllerMode } from "./shared";
export { Knob } from "./Knob";
export { SmoothKnob } from "./SmoothKnob";
export { Fader } from "./Fader";
export { Crossfader } from "./Crossfader";
export { JogWheel } from "./JogWheel";
export { Pad } from "./Pad";
export { Circle } from "./Circle";
export { BrowsePanel } from "./BrowsePanel";

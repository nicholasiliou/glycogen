/**
 * Skeuomorphic controller widgets — knobs, faders, jog wheels and pads rendered with
 * pure CSS (gradients + inset shadows, no bitmaps). Each widget is an abstract control slot on the
 * {@link ControlBus}: turning it drives `<kind>:<n>`, and whichever focused plugin bound that slot
 * reacts. A hardware MIDI control maps onto the same slots separately. Shared chrome + the slot
 * binding hook live in ./shared.
 */
export { AssignContext, ControlBusContext, SlotLabelContext, LearnSlotContext, ArmLearnContext, BankControlContext, useBus, useSlot, type AssignCtxType, type AssignPending, type SlotView, type BankControl } from "./shared";
export { Knob } from "./Knob";
export { SmoothKnob } from "./SmoothKnob";
export { Fader } from "./Fader";
export { JogWheel } from "./JogWheel";
export { Pad } from "./Pad";
export { GlobalPad } from "./GlobalPad";
export { Circle } from "./Circle";
export { BrowsePanel } from "./BrowsePanel";

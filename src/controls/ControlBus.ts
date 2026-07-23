import { clamp01, emptySlotLive, type DriveInput, type SlotId, type SlotLive } from "./types";

/**
 * The single source of truth for live control state. Hardware MIDI and the on-screen controller
 * widgets both push activity in via {@link drive} / {@link fire}; plugins (through their `Param`s,
 * polled each frame by the runtime host) read it back out via {@link get}. This is the rebuilt,
 * dependency-free replacement for the engine's deleted keymap dispatch.
 */
export class ControlBus {
  private slots = new Map<SlotId, SlotLive>();
  private subs = new Map<SlotId, Set<(live: SlotLive) => void>>();
  private activitySubs = new Set<() => void>();

  /** Current live state of a slot (a shared empty snapshot for untouched slots). */
  get(slot: SlotId): SlotLive {
    return this.slots.get(slot) ?? EMPTY;
  }

  /** Fires on ANY control activity (any `drive`/`fire`, any slot). For coarse liveness signals —
   *  e.g. the exhibition's inactivity reset — that don't care which control was touched. */
  onActivity(fn: () => void): () => void {
    this.activitySubs.add(fn);
    return () => this.activitySubs.delete(fn);
  }

  private ensure(slot: SlotId): SlotLive {
    let live = this.slots.get(slot);
    if (!live) {
      live = emptySlotLive();
      this.slots.set(slot, live);
    }
    return live;
  }

  /** Push hardware / widget activity into a slot. */
  drive(slot: SlotId, input: DriveInput): void {
    const live = this.ensure(slot);
    if (input.delta !== undefined || input.relative) {
      live.delta = input.delta ?? 0;
      live.relative = true;
    } else {
      live.delta = 0;
      live.relative = false;
    }
    if (input.value !== undefined) live.value = clamp01(input.value);
    if (input.pressed !== undefined) {
      if (input.pressed && !live.pressed) live.presses++;
      live.pressed = input.pressed;
    }
    live.hits++;
    live.lastSeen = now();
    this.emit(slot, live);
  }

  /** One-shot press pulse (a button tapped in the UI, a MIDI note with no explicit note-off). */
  fire(slot: SlotId): void {
    const live = this.ensure(slot);
    live.presses++;
    live.hits++;
    live.lastSeen = now();
    this.emit(slot, live);
  }

  subscribe(slot: SlotId, fn: (live: SlotLive) => void): () => void {
    let set = this.subs.get(slot);
    if (!set) this.subs.set(slot, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  private emit(slot: SlotId, live: SlotLive): void {
    const set = this.subs.get(slot);
    if (set) for (const fn of set) fn(live);
    for (const fn of this.activitySubs) fn();
  }
}

const EMPTY = emptySlotLive();

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// ── minimal Web MIDI typings (not guaranteed present in lib.dom across TS versions) ──

export interface WMMessageEvent {
  data: Uint8Array | null;
}
export interface WMInput {
  id: string;
  name: string | null;
  manufacturer: string | null;
  state: string;
  onmidimessage: ((e: WMMessageEvent) => void) | null;
}
export interface WMOutput {
  id: string;
  name: string | null;
  send(data: number[] | Uint8Array): void;
}
export interface WMAccess {
  inputs: Map<string, WMInput>;
  outputs: Map<string, WMOutput>;
  onstatechange: ((e: unknown) => void) | null;
}
export type RequestMIDIAccess = (opts?: { sysex?: boolean }) => Promise<WMAccess>;

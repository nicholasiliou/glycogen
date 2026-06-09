/**
 * Empty stand-in for p5.sound in the standalone runtime bundle.
 *
 * The runtime is built as a single inlined IIFE, where any bundled module is
 * evaluated eagerly at load — and p5.sound eagerly registers an AudioWorklet, which
 * throws outside a gestured AudioContext. Exported interactive apps don't need the
 * plant's optional oscillator (audio is opt-in/off by default and never captured in
 * exports), so we alias the addon to this no-op for the runtime build only. The
 * editor build keeps the real p5.sound (loaded lazily when audio is enabled).
 */
export {};

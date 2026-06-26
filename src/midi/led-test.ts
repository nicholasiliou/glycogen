/**
 * LED flash test — run this in a browser devtools console or as a standalone script.
 *
 * Usage (browser console):
 *   import('/src/midi/led-test.ts').then(m => m.runLedTest())
 *
 * Or paste the compiled output into devtools while the app is running.
 *
 * What it does:
 *   1. Requests Web MIDI access
 *   2. Logs all connected outputs
 *   3. Sweeps notes 0–127 on channel 0 with velocity 127 (LEDs on), then off
 *   4. Then pulses a few common "all pads lit" notes (36–51) for visibility
 */

export async function runLedTest(): Promise<void> {
  if (!("requestMIDIAccess" in navigator)) {
    console.error("[led-test] Web MIDI not supported in this browser.");
    return;
  }

  const access = await (navigator as unknown as { requestMIDIAccess: (o?: { sysex?: boolean }) => Promise<MIDIAccess> }).requestMIDIAccess({ sysex: false });

  const outputs = [...access.outputs.values()];
  if (outputs.length === 0) {
    console.warn("[led-test] No MIDI outputs found. Is the controller connected?");
    return;
  }

  console.log("[led-test] Found outputs:");
  outputs.forEach((o) => console.log(`  • ${o.name} (${o.id})`));

  // Use the first output
  const out = outputs[0];
  console.log(`[led-test] Sending to: ${out.name}`);

  const CH = 0; // channel 0 (MIDI channel 1)
  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // ── Phase 1: sweep notes 0–127 on, pause, then off ──
  console.log("[led-test] Phase 1: sweeping all notes on (ch 0)...");
  for (let note = 0; note <= 127; note++) {
    out.send([0x90 | CH, note, 127]);
    await delay(10);
  }
  await delay(500);
  for (let note = 0; note <= 127; note++) {
    out.send([0x80 | CH, note, 0]);
    await delay(5);
  }
  await delay(300);

  // ── Phase 2: flash common pad notes (36–51) on ch 0 and ch 9 ──
  const padNotes = [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51];
  console.log("[led-test] Phase 2: flashing pad notes 36-51 on ch 0 and ch 9...");
  for (let i = 0; i < 3; i++) {
    for (const ch of [0, 9]) {
      for (const note of padNotes) {
        out.send([0x90 | ch, note, 127]);
      }
    }
    await delay(300);
    for (const ch of [0, 9]) {
      for (const note of padNotes) {
        out.send([0x80 | ch, note, 0]);
      }
    }
    await delay(300);
  }

  // ── Phase 3: CC sweep (some controllers use CC for button LEDs) ──
  console.log("[led-test] Phase 3: sweeping CC 0–127 with value 127 on ch 0...");
  for (let cc = 0; cc <= 127; cc++) {
    out.send([0xb0 | CH, cc, 127]);
    await delay(10);
  }
  await delay(500);
  for (let cc = 0; cc <= 127; cc++) {
    out.send([0xb0 | CH, cc, 0]);
    await delay(5);
  }

  console.log("[led-test] Done.");
}

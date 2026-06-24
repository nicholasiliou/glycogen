# MIDI Visual Instrument — design (experimental branch)

Branch: `experimental/midi-instrument`. A new core idea, alongside (not replacing) the
After-Effects-style Pro editor and Simple mode: a **playable audiovisual instrument**.
You pick a plugin from a big **sundial/wheel**, drop it onto the **stage**, and it plays
live — generating both visuals and a sound that is *unique to that plugin* and derived
from its on-screen behaviour. A MIDI controller drives the parameters; the UI shows which
control maps to which feature, and adapts to whatever device is connected.

Decisions (confirmed with the user 2026-06-23):
- **Audio:** Tone.js (installed, v15).
- **Character:** one shared musical clock + key. Every instrument quantises rhythm to the
  beat and snaps pitch into the key, so any mix of plugins always sounds intentional.
- **Controller:** auto-detected over Web MIDI. Detected device: **Numark MixTrack Pro**
  (jog wheels, faders, EQ knobs, transport + performance buttons). The system is generic;
  the MixTrack just gets nice defaults.

## Architecture (bounded, deps point down — mirrors engine/plugins/ui)

```
src/midi/    Web MIDI -> normalized controls (continuous vs momentary), monitor/learn.  (no engine dep)
src/audio/   Tone.js: AudioEngine (master bus, sends, BPM clock, key/scale), Instrument
             interface, per-plugin instruments, registry, LivePerformer (drives audio from
             the live scene each frame; instruments self-schedule on Tone.Transport).      (no engine dep)
src/ui/live/ LiveProvider wires MidiManager + AudioEngine + LivePerformer + MappingEngine.
             Sundial selector, Stage (clean canvas), MIDI map panel, transport/BPM/key bar.
```

Key seams reused, not rebuilt:
- Layer params already carry `meta.min/max/step` (Registry `PropertySchema`) — that is the
  signal for "this is a range -> knob/fader" vs boolean/select/trigger -> "button/pad".
- `prop.valueAt(time)` (`Layer.customProps`) gives the live value of every visual param, so
  audio reads the *same* numbers the visuals do -> "tweak a param, the sound changes" is free.
- `engine.addLayer/removeLayers/setPropertyValue/setLayerField` is the whole stage API.
- `engine.bus.on("render:frame")` is the per-frame audio tick.

## Two clocks, on purpose
- **Visual clock**: the engine Transport (unchanged, deterministic/seekable).
- **Musical clock**: `Tone.getTransport()` at a global BPM. Rhythmic instruments (drums,
  arp, pluck, stutter) schedule themselves on musical subdivisions and read their latest
  visual-derived params at trigger time. This is what keeps everything in time regardless of
  frame rate. (Phase 2: expose beat phase as `input.beatPhase` so visuals can pulse on-beat —
  the user's "make some visuals step/pulse" ask.)

## "Never swaps instrument type"
Instrument **family** is pinned per plugin `type` in the registry. Params only modulate the
voice within that family; they never change the synth.

## Instrument assignment (one per plugin — no two the same)
| plugin | family | feel | visual -> sound driver |
|---|---|---|---|
| life (Game of Life) | **drums/percussion** | the rhythm section; stepped already | population density -> kit fullness; births/deaths bursts -> hits/fills; speed -> not pitch |
| physarum (Slime Mold) | **ambient drone/pad** | slow organic wash | decay/gain -> filter+reverb; agent count -> thickness |
| reactionDiffusion | **granular/FM texture** | bubbling chemistry | feed/kill -> FM ratio/index; gain -> level |
| boids | **flocking arp lead** | shimmering motion | maxSpeed -> arp rate; alignment/cohesion -> note spread/gate |
| noise (Noise Field) | **sub/bass drone** | low ground | scale/contrast -> cutoff; bands -> octave |
| harmonograph | **harmonic dyad lead** | bowed, tonal (best 1:1) | freqX1/Y1/X2/Y2 -> intervals; damping -> decay |
| plant (L-system) | **plucked kalimba lead** | melodic plucks (faithful) | iterations -> register; seed -> motif; spin -> tremolo |
| landscape | **wide evolving pad** | airy chords | amplitude -> voicing; drift -> movement |
| shape (3D) | **metallic FM bell** | spinning chime | spin -> tremolo; knotP/Q -> ratio |
| slicer | **rhythmic chord stutter** | stabs | slices -> subdivision; spin -> gate |
| wire | **laser/glide lead** | zap sweep | completion -> pitch glide |
| cloud | **airy noise wash** | breathy | coverage/density -> filter/level |
| model | **glassy pad** | clean | tilt/spin -> stereo motion |
| harmonograph/text/glyph/glyphScatter/solid | small distinct voices (chime/vox-blip/blip/pad/thump) | fill out content layers |

Effects (fx.*) and containers (group/layout/null) make no sound.

## Auto-mapping (controls -> features)
On the selected stage layer: split props into **continuous** (`meta.min!=null` or
number/percent/angle) and **discrete** (boolean/select/trigger). Split discovered MIDI
controls into **continuous** (CC knobs/faders/jogs) and **momentary** (notes/buttons).
Assign continuous->continuous in priority order (the "most musical/expressive" props first),
discrete->momentary. A reserved set of global controls (crossfader = master blend, channel
faders = per-layer level, transport = play, browse/jog = sundial rotation) sits above the
per-plugin map. The panel renders the live assignment so you can see "knob 2 -> Decay".

## Phasing
1. **Foundation (this branch, in progress):** MIDI subsystem + monitor; audio core; 4–5
   instruments; Live mode shell (sundial, stage, MIDI panel, BPM/key, start-audio); per-frame
   performer; first auto-map.
2. Capture exact MixTrack Pro CC/note map via the monitor; set device defaults (jog->sundial,
   crossfader->blend, EQ knobs->macros, transport->play, pads->drum triggers).
3. Remaining instruments; per-plugin "musical mapping" curation.
4. Visual pulse-on-beat (`input.beatPhase`) for stepped plugins; record/export the jam.

## Verify
`npm run dev` -> open in **Chrome** (Web MIDI) -> switch to **Live** -> "Start Audio" (gesture)
-> open MIDI panel, wiggle every control to capture the map -> spin the sundial, add a plugin,
hear it; move a mapped knob and confirm visual+sound change together.

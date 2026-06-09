# Marathon — Unified Composition Engine

A lightweight fusion of **After Effects**, **Figma**, and a **procedural creative‑coding
runtime**. Static graphics, generative systems, animation, simulations and interactive
experiences are all authored as **layers** inside a single composition engine.

The original audio‑reactive L‑system plant sketch is preserved **verbatim** and now ships
as one layer type (`plant`). It is no longer special — it's just the first plugin.

> This repository is a **running vertical slice**: the full core architecture end‑to‑end,
> a working editor UI, and the plant migrated as a plugin. Breadth items (MP4/GIF encoders,
> bezier curve editor, nested‑comp UI) are wired as explicit **integration seams**, marked
> below and in code, rather than faked.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check + runtime bundle + production app
npm run build:runtime  # just the standalone runtime (needed for interactive export)
npm run typecheck
```

> The **interactive‑web export** inlines a prebuilt runtime (`public/marathon-runtime.js`).
> Run `npm run build:runtime` once (or `npm run build`) so the editor can fetch it; the dev
> server then serves it at `/marathon-runtime.js`.

Stack: **Vite + React + TypeScript + Tailwind v4 + Radix/Shadcn‑style primitives + p5 (1.x)**.

---

## Architecture

Three hard‑bounded layers. Dependencies only ever point **down**. Everything talks over an
event bus and a small public API — never sideways into a sibling's internals
(microservice‑inspired separation).

```
src/
  engine/      Headless. No React. The whole system as a library.
    core/        EventBus, ids, shared types (FrameContext, InputSnapshot, …)
    time/        Transport (the composition clock) + Ticker (the only rAF)
    properties/  Property + Keyframe, interpolation (incl. cubic-bezier), Evaluator (expressions)
    scene/       Layer (+ transform/parenting), Composition, Project, resolution presets
    plugins/     Registry — the third-party extension contract
    render/      Compositor (evaluates + composites layers), render types
    inputs/      InputManager (pointer/scroll/keys/orientation/mic → InputSnapshot)
    commands/    History (undo/redo with drag coalescing)
    io/          serialize/deserialize, Exporter
    Engine.ts    Orchestrator — owns every subsystem; the API the UI drives
    runtime.ts   Headless bootstrap used by the interactive-web export
    index.ts     Curated public API barrel (this IS the extensibility surface)

  plugins/     Built-in layer types (each one is exactly what a 3rd party would write)
    plant/  group/  solid/  text/

  ui/          React editor. Talks to the engine only through its public API + event bus.
    engine/      EngineProvider + hooks (useRevision, useTime, useSelection…)
    components/  Shadcn-style primitives (ui/) + reusable controls (controls/)
    panels/      Toolbar, Viewport, LayersPanel, Inspector, Timeline
```

### Time is a first‑class engine concept

Nothing speeds up or slows down any sketch loop. `Transport` is the single source of truth
for "what time is it"; the `Ticker` (rAF) only *pumps* the engine. Every layer renders
against a `FrameContext` it is handed — so playback is deterministic, **scrubbing**,
**seeking**, **reverse** (negative rate) and **frame‑accurate export** all fall out for free,
and export does not depend on the viewport's FPS.

### Properties, keyframes & expressions (one mechanism)

A `Property` holds a static value, an optional **keyframe** track (linear / bezier / smooth /
stepped), and an optional **expression**. The `Evaluator` runs once per frame, memoised and
cycle‑guarded. Expressions reference other layers, the comp, project globals and **live
inputs** through the same sandbox:

```js
layer("Null").rotation * 2        // pickwhip to another layer
input.mouseX                       // bend toward the cursor
linear(input.audioLevel,0,1, value, value*2)   // react to the microphone
wiggle(2, 30)                      // procedural noise
```

A **pickwhip** is just a generated expression string, so no‑code binding and hand‑written
expressions are unified. Timeline animation and interaction‑driven effects **coexist** —
the expression is layered on top of the keyframed `value`.

### Rendering

Each layer type implements one method — `render(frame) → canvas`. The `Compositor` evaluates
the transform, walks the parent chain into a world matrix, and blits the layer's surface with
opacity & blend mode. Plugins never touch transforms. The plant draws into an **offscreen p5
WEBGL buffer**; solids/text use 2D canvases; a future shader layer would hand back a WebGL
canvas — all composited identically.

---

## Extending it (the plugin API)

Register a `LayerTypeDefinition` and a brand‑new visual system appears throughout the editor
(add menu, inspector, timeline, serialization) with **no other changes**:

```ts
engine.registry.register({
  type: "particles",
  label: "Particles",
  category: "Simulation",
  icon: "Sparkles",
  schema: [
    { key: "count", name: "Count", type: "number", default: 200, meta: { min: 0, max: 5000 } },
    { key: "color", name: "Color", type: "color", default: [255, 255, 255, 255] },
  ],
  createRenderer: (layer, host) => ({
    render(frame) {
      // frame.props.count / frame.props.color are already evaluated
      // (keyframes + expressions + live inputs). Return a canvas.
      return myCanvas;
    },
    dispose() {},
  }),
});
```

That same call is all the built‑ins do — there is no privileged path.

---

## Feature status

**Working in this slice**

- Unified composition canvas; multiple compositions; user/preset/custom resolutions (1080p,
  1440p, 4K, square, portrait, social formats); FPS & duration; background; safe‑area guides.
- Plugin registry; built‑in `plant` (seed‑driven), `harmonograph`, `boids`, `solid`, `text`, `group/null` layer types.
- `boids` flocking simulation engineered for performance (spatial hash grid → O(n), typed‑array
  state, single batched `fill()`); deterministic & seekable. ~4000 boids in ≈3.5 ms/frame.
- Layer hierarchy & parenting, grouping, visibility/solo/lock, blend modes, in/out points.
- Selection + direct viewport **move / scale / rotate** handles + drag‑reorder in the layers panel.
- Inspector: per‑property controls (scrubby numbers, sliders, color, point, switch, select),
  keyframe **stopwatch** + diamonds, expression/pickwhip editor with input‑binding presets.
- Timeline: scrubbable ruler/playhead, layer duration bars, draggable keyframes, interpolation menu.
- Undo/redo (command pattern with drag coalescing); event‑driven engine↔UI bridge.
- Serializable project format (save/load JSON).
- Live inputs: pointer, velocity, scroll, keys, device orientation (microphone analysis is
  available at the engine API level — `engine.enableInputAudio()` — but no longer surfaced
  as a toolbar button).
- Export: **PNG / JPEG still, frame‑accurate PNG sequence, WebM (and MP4 where the browser's
  MediaRecorder supports it), project JSON, and a self‑contained interactive‑web app** that
  inlines the runtime so it runs offline with all live behaviour intact.

**Integration seams (architected, not yet implemented — see code comments)**

- GIF encoder (`Exporter.gif`) and **frame‑accurate** video — current video uses MediaRecorder
  (realtime). WebCodecs/ffmpeg.wasm fed by `Exporter.renderFrameAt` is the frame‑exact path.
- Bezier **curve editor** UI (the data model & solver exist; the graph editor does not).
- Nested precomp & time‑remapping **UI** (model hooks exist on Composition/Transport).
- Asset‑backed layers (image/video) and shader layers — drop‑in via the same `createRenderer`.

---

## The plant migration

`src/plugins/plant/plantSketch.ts` is the original `sketch.js` L‑system + turtle, changed only
from p5 global mode to instance mode (`random()` → `p.random()`). The grammar, EGA palette,
`Phi` metrics, thresholds and turtle drawing are **untouched**. `PlantLayer.ts` wraps it in an
offscreen WEBGL buffer driven by `redraw()` (one composition frame = one redraw).

**Behaviour change (by request):** the plant no longer mutates on its own. It is now
**deterministic from a `seed`** — the same seed always yields the same plant — and you make it
evolve by animating `seed` (keyframes or an expression). `autoEvolve` (off by default) advances
the seed with composition time deterministically for the old "always changing" feel, so it still
scrubs and exports frame‑accurately. The audio oscillator is opt‑in (`audioReactive`, off by
default). The root `sketch.js` is left in place as the reference.

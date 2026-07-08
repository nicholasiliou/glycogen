# Relational binding database: schema-driven controls, bindings & presets

## Context

Binding knowledge is currently smeared across three registries that don't know about each other: the keymap in localStorage maps hardware → slot ([src/midi/keymap.ts](src/midi/keymap.ts)), plugins hardcode param → slot in field initialisers (`detail = this.knob(0, {...})` in [src/plugins/Plugin.ts](src/plugins/Plugin.ts)), and the [ControlBus](src/controls/ControlBus.ts) holds live state. There is no reverse lookup, and every new feature reopens the "who owns this mapping" debate.

**The change**: one relational-schema-driven store (`src/db/`) becomes the single source of truth for *structure* — plugins, params, widgets, hardware controls, bindings, presets — while the ControlBus keeps owning per-frame *live state* (the hot path stays untouched). The control panel is redesigned to reflect the database: per-plugin bound-controls list, drag-and-drop remapping, in-place presets. The list-based keymap editor dies entirely.

**Decisions locked in with the user:**
- Typed synchronous in-memory tables persisted to localStorage — no DB engine, works on static GitHub Pages. It must be *immediately obvious* everything is schema-driven: one `schema.ts` declares every table/FK; registering a new function is a typed declaration in code (never hand-written JSON).
- Plugins are the **authors** of params (name, range, intent) but the DB is the **reader**: declarations register read-only `params` rows at boot. Slots become seed data, fully remappable.
- **Adapters, not universality**: each binding row carries an adapter (absolute/relative/toggle/cycle/trigger); legality is derived from param metadata; a 2-option cycle ≡ on/off switch. Illegal drops are rejected or prompt for an adapter.
- **Full replacement** of keymap.ts/useKeymaps/router lookup — no interop shims (midi-live is experimental).

**One normalisation over the original "one row" idea**: hardware↔widget and widget↔param have different lifecycles (device-specific vs per-plugin; on-screen widgets must work with zero hardware). So there are **two binding tables joined on `widgets`** — the user's key property still holds transitively: remap a function to a different widget and both the on-screen control *and* the MIDI key follow.

**Verified codebase facts that shape the design** (from exploration):
- `SLOT_CATALOG` in keymap.ts disagrees with the surface actually rendered by [Controller.tsx](src/ui/controller/Controller.tsx) (e.g. encoders 3–5 on deck B can't be plugin-bound; pads have gaps; knob:8 has no on-screen widget). The new single `WIDGET_CATALOG` seed fixes this by being consumed by both the DB and Controller.tsx.
- `ButtonParam` deliberately has **no declared mode** ([Param.ts:111-115](src/controls/Param.ts#L111-L115)) — intent is expressed by which property the plugin reads, and cycle labels are only captured after the first `pick()` render. Adapter legality **requires declared intent**, so the new API adds `toggle()/trigger()/cycle(options)` declarations while keeping the `.on/.held/.fired/.pick()` read surface. This is an intentional philosophy change.
- Crossfader inversion is hardcoded in [router.ts:39](src/midi/router.ts#L39) → becomes an `invert` flag on the hardware-binding row.
- Params only exist on instances (names harvested post-construction in [registry.ts](src/plugins/registry.ts)) → boot instantiates each plugin class once, harvests params, disposes. Constructors are cheap (verified: canvas + zero-length arrays, no rendering).
- [ControlsPanel.tsx](src/ui/controls/ControlsPanel.tsx) drives params through the bus by slot; once params have no slot it drives them directly (bonus: unbound params become editable for the first time). `ButtonParam` gains `press(n)` for this.

## Schema (`src/db/schema.ts`)

One file declares every table, row type, FK, and index; header doc states the invariant: *all wiring is rows in these tables; nothing else may hold binding state.* `db` is an exported singleton.

**Code-sourced tables** (rebuilt every boot via `replaceAll`, never persisted):

```ts
plugins:    { id /*"boids"*/, label, kind: "generator"|"effect" }
params:     { id /*"boids/perception"*/, pluginId→plugins, name, order,
              control: { type:"number"; min; max; step; default; smooth }
                     | { type:"toggle"; default } | { type:"trigger" }
                     | { type:"cycle"; options: string[] } }
widgets:    { id: SlotId /*"knob:0" — keeps format so ControlBus/remoteChannel untouched*/,
              kind, index, reserved?: "hue"|"crossfade" }
appActions: { id: AppAction, label, momentary }
```

**User-mutable tables** (persisted to `localStorage["marathon.db.<table>.v1"]`):

```ts
hardwareControls: { id /*"cc:0:7"*/, name, kind, disabled, deviceName? }   // learned identity + corrections
hardwareBindings: { id, controlId→hardwareControls (UNIQUE), invert?,
                    target: {type:"widget"; widgetId} | {type:"action"; actionId} }
paramBindings:    { id, pluginId→plugins, widgetId→widgets (UNIQUE per (pluginId,widgetId)),
                    paramId→params (must belong to pluginId), adapter: AdapterSpec, locked? }
presets:          { id, name, createdAt, updatedAt,
                    data: { paramBindings[], hardwareBindings[], hardwareControls[] } }
```

FK policy: deleting a `hardwareControls` row cascades its bindings; boot prunes persisted rows whose FKs no longer resolve (renamed plugin/param) with a console warning.

## Table engine (`src/db/engine.ts` + `src/db/useDb.ts`)

Tiny, synchronous, dependency-free `Table<Row extends {id:string}>` with: `insert/update/delete/replaceAll/get/all`, secondary indexes (`by(index, key)` → O(1) hot-path lookups), FK checks with cascade/restrict, per-row `validate` hook, `version` counter, `subscribe`. Persistence: microtask-batched `localStorage` flush with sanitize-on-load (pattern mirrors `saveKeymaps`/`loadKeymaps` in keymap.ts).

Reactivity: `useTable(table, selector)` on `useSyncExternalStore` keyed off `table.version` — panel re-renders on binding edits. Hot paths (Stage, router) never subscribe; they read indexes and cache against `version`.

Hot-path indexes: `hardwareBindings.by("control", controlId)` (per MIDI message), `paramBindings.by("plugin", pluginId)` (per frame, cached).

## Adapters (`src/controls/adapters.ts`)

Signal classes: `abs` (fader/knob/crossfader), `rel` (encoder/jog), `press` (button/pad). Pure `legalAdapters(paramControl, widgetKind): AdapterKind[]`:
- number ← abs: absolute; rel: relative; press (if step>0): cycle through quantised values
- toggle ← press: toggle/momentary; abs: absolute (>0.5 threshold)
- trigger ← press: trigger
- cycle ← press: cycle; 2 options also toggle

**Execution point**: bus→param boundary, replacing `Param.pull`. Router keeps writing raw signal class into the bus exactly as today — `ControlBus`, `SlotLive`, remote bridge untouched. Per binding row a stateful `ParamDriver` holds what `pull` holds today (`lastHits/lastPresses` move off the params; state resets naturally on rebind). `Param` keeps `set/setNorm/nudge/norm` + gains `tick()` for smoothing (called every frame even unbound); `ButtonParam` keeps `.on/.held/.fired/.pick/.count` + gains `press(n=1)` (queued so `.fired` lasts one frame).

## New plugin API + migration

In [Plugin.ts](src/plugins/Plugin.ts): **delete** the slot literal types and `fader/knob/encoder/jog/button/pad` factories; **add**:

```ts
protected number(o: NumOpts = {}): Param
protected toggle(def = false): ButtonParam
protected trigger(): ButtonParam
protected cycle(options: readonly string[]): ButtonParam   // options declared up front
hue = this.number({ min: -180, max: 180, default: 0 });    // base class, unchanged semantics
```

Mechanical edit per declaration: `this.knob(3, opts)` → `this.number(opts)`; pads/buttons by read pattern (`.on`→toggle, `.fired`→trigger, `.pick`→cycle with its option array moved to the declaration). Removed slot indices are transcribed into the seed file.

**Files to migrate** (~24): `src/plugins/` BoidsLayer, ContourFieldLayer, GameOfLifeLayer, HarmonographLayer, LandscapeLayer, NoiseLayer, PhysarumLayer, PlantLayer, ReactionDiffusionLayer, ShapeLayer, TextLayer, VolumetricCloudLayer, glyph/GlyphLayer, glyph/GlyphScatterLayer; `src/shaders/` AsciiLayer, BayerLayer, ColorLookupLayer, DeepGlowLayer, FisheyeLayer, PixelSortLayer, PixelStretchLayer, PixelateLayer, TrackerLayer, VenetianBlindsLayer; plus `src/runtime/Stage.test.ts`.

Boot harvest (`src/db/boot.ts`): for each registry entry (registry already eagerly imports via `import.meta.glob`), `new ctor()` → walk fields as `registry.create()` does → insert `params` rows → `dispose()`.

## Seeds (`src/db/seeds.ts`)

- `WIDGET_CATALOG`: authoritative surface matching Controller.tsx reality; renumber pads contiguously while everything is data; export deck layout arrays so `DeckPanel`/`MixerPanel` map over the catalog (catalog provably matches JSX).
- `DEFAULT_LAYOUTS`: 1:1 transcription of every plugin's current hardcoded slots → default `paramBindings` (parity is the exit criterion for M3). Adapter defaults = `legalAdapters(...)[0]`.
- `ACTION_SEED`: current `AppAction` list + labels (type and `bankOf` relocate from keymap.ts to schema.ts).
- Boot: `paramBindings` seeded copy-on-first-touch (only for plugins with zero persisted rows) + locked `hue → knob:9` row per plugin. Panel gets a per-plugin "Reset to default" (delete rows, re-seed) so seed improvements stay reachable.

## Reserved slots → runtime validation

`widgets.reserved` + `paramBindings.validate` rejects: reserved widget on a non-`locked` row; param not belonging to the row's plugin; adapter not in `legalAdapters(...)`. Hardware may still bind to `crossfader:0`/`knob:9` (that's how hue/crossfade get hardware control, as today).

## Router + Stage

**[router.ts](src/midi/router.ts)** rewritten (same attach shape): on control event → auto-upsert `hardwareControls` identity for newly seen controls → `hardwareBindings.by("control", id)` → widget target: `bus.drive(widgetId, {value: invert ? 1-v : v, ...})`; action target: momentary run / browse step. `handlers.report` preserved.

**[useMidiRouting.ts](src/ui/app/useMidiRouting.ts)** rewritten: learn flow writes `hardwareBindings` rows; keeps arm state + toast. **useKeymaps.ts dies**; a tiny `useHardwareSync` remains to push `hardwareControls` into `midi.applyOverrides()` at boot/on change (preserves live reinterpretation) + `allLedsOff` housekeeping.

**[Stage.ts](src/runtime/Stage.ts)** (~line 173): replace the per-frame params loop with cached driver resolution:
```ts
// tick(): for (const d of this.resolveDrivers(managed)) d.apply(this.bus.get(d.widgetId));
//         for every loaded plugin: for (const p of plugin.params) p.tick();  // smoothing continues
// resolveDrivers rebuilds from db.paramBindings.by("plugin", id) when table.version changed
```
Stage takes `db` (or a narrow `BindingSource` interface for its test). `LiveProvider.tsx` derives `slotLabels` from the focused plugin's `paramBindings`; remote snapshot shape unchanged.

## Control panel redesign

- **`src/ui/controls/PluginBindingsPanel.tsx`** (replaces ControlsPanel content): for the focused plugin, one row per param — name, live value editor (drives params *directly*: `param.set` / `param.press`), a binding chip (bound widget + adapter, live via `useTable`), drag handle.
- **Drag-and-drop remap**: HTML5 dnd (`application/x-marathon-param`). `SlotFrame` in [widgets/shared.tsx](src/ui/controller/widgets/shared.tsx) gains drop handling via a new `AssignContext`: highlight legal targets on dragover; one legal adapter → upsert (replacing the existing row for that `(pluginId, widgetId)`); several → adapter popover; none → reject flash.
- **Click-to-assign fallback** (and the only path in the pop-out, since HTML5 dnd can't cross windows): clicking a binding chip arms assign mode (same pattern as `LearnSlotContext`); clicking any widget completes. New `RemoteMessage` kinds in [remoteChannel.ts](src/controls/remoteChannel.ts): `assignArm {paramId, legalWidgets}` / `assignCancel` / `assignTo {widgetId}`; [useRemoteBridge.ts](src/ui/app/useRemoteBridge.ts) relays.
- **MIDI learn**: unchanged gesture (right-click widget), now writing `hardwareBindings`. App-action learn moves to a settings "App actions" section listing `appActions` rows.
- **Presets**: panel footer — dropdown, Save/Load, Export/Import JSON (reuse `exportKeymap` download pattern).
- **[MidiSettingsDialog.tsx](src/ui/settings/MidiSettingsDialog.tsx)**: KeymapTab deleted → "Hardware" tab backed by `useTable(db.hardwareControls)` (rename / kind-correct / disable — this capability must survive) + "Auto-assign" (port `autoAssign()` to write `hardwareBindings`).

## Deletions

| Dies | Replaced by |
|---|---|
| `src/midi/keymap.ts` (whole file) | schema/seeds/presets; `AppAction`/`bankOf` relocate to schema.ts |
| `src/midi/keymap.test.ts` | engine/adapter/seed/router tests |
| `src/ui/app/useKeymaps.ts` | `useHardwareSync` (tiny) + db |
| KeymapTab + `KeymapCtx`/`LiveCtx.keymap` | Hardware tab; exported `db` singleton |
| Slot literal types + slot factories in Plugin.ts | new param API |
| `Param.pull`/`relative`, `ButtonParam.pull` press-diffing | `ParamDriver` |
| `marathon.midi.keymaps.v1` / `activeKeymap.v1` keys | `marathon.db.*.v1` (boot deletes stale keys, no migration) |

## Milestones (app runnable at each, except mid-M3)

**M1 — Engine + schema + seeds + adapters, no app wiring.** New `src/db/*`, `src/controls/adapters.ts` + vitest suites (`engine.test.ts`: FK/cascade/indexes/persistence round-trip/sanitize; `adapters.test.ts`: every adapter kind incl. 2-option-cycle≡toggle, full legality matrix). Verify: `npm run test`, typecheck.

**M2 — Hardware side on the DB.** Rewrite router.ts + useMidiRouting.ts; add `useHardwareSync`; Hardware settings tab; delete keymap.ts/useKeymaps.ts/keymap.test.ts. Plugins still declare slots (staged, not a shim — keymap is already fully gone). Verify (manual, `npm run dev`): move a hardware knob → learned row appears in Hardware tab; right-click learn works; reload persists; crossfader direction correct via invert; bank/load/browse actions fire. Unit: router test with fake MidiManager (pattern in old keymap.test.ts).

**M3 — Param side (the big one, land as one milestone).** New Plugin API; migrate all ~24 plugin/shader files + Stage.test.ts; boot harvest; `DEFAULT_LAYOUTS` transcribed 1:1; Stage driver resolution; labels from bindings; ControlsPanel → direct param driving; Param.test.ts rewritten against drivers. **Exit criterion: parity** — every plugin behaves identically to before. Verify: browse through all generators + shaders; each on-screen control drives the same param as before; hue works everywhere; crossfader blends; focus switching swaps labels; smoothing eases; cycle chips show declared options before first press.

**M4 — Panel redesign + presets.** PluginBindingsPanel, dnd remap with adapter prompt, reset-to-default, preset save/load/export/import. Verify: drag a param onto a different knob → label + control move instantly; continuous param on a stepped pad → cycle offered; illegal drop rejected; preset round-trip (save → remap → load restores); export/import; reload persistence.

**M5 — Pop-out + cleanup.** New RemoteMessage kinds, click-to-assign in popup, arm state in snapshot; delete stale localStorage keys; pad renumbering + catalog/Controller unification; schema.ts header docs. Verify: pop out → click chip in host → legal widgets glow in popup → click completes; popup drives still work; `npm run build` clean (GH Pages).

## Critical files

New: `src/db/schema.ts`, `src/db/engine.ts`, `src/db/seeds.ts`, `src/db/boot.ts`, `src/db/useDb.ts`, `src/controls/adapters.ts`, `src/ui/controls/PluginBindingsPanel.tsx`.
Rewritten: `src/midi/router.ts`, `src/ui/app/useMidiRouting.ts`, `src/plugins/Plugin.ts`, `src/controls/Param.ts`, `src/runtime/Stage.ts` (tick region), `src/ui/controls/ControlsPanel.tsx`, `src/ui/settings/MidiSettingsDialog.tsx`.
Touched: all ~24 plugin/shader files, `src/ui/app/LiveProvider.tsx`, `src/controls/remoteChannel.ts`, `src/ui/app/useRemoteBridge.ts`, `src/ui/controller/Controller.tsx` + `widgets/shared.tsx`.

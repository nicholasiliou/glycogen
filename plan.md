# Controller tab = assignment surface; unified one-occupant widgets

## Context

Follow-up simplification on `midi-live`, right after the unified-banks rework. Today the controller
overlay is a live surface + the sidebar mixes value editing with binding chips, and hardware MIDI
has its own settings tab. The user wants a strict split of roles:

- **Main sidebar (controls)** — drives the app: value editors only.
- **Controller overlay** — *assignment only*: an inert map of the surface you drag functions onto.
- **Pop-out controller + main sidebar** — the actual performance surfaces.
- **Hardware tab deleted** — MIDI *learn* stays (right-click a widget, touch hardware); the
  kind-misclassification override and general table visibility move to a new `#db` dev page.

## Agreed decisions (from Q&A)

1. **One assignable slot per widget** — the occupant is either a plugin param (per-plugin) or an
   app function (global). No widget holds both. Since params are per-plugin and actions are global,
   dropping an action **evicts that widget's param bindings across ALL plugins** (evicted params
   reappear as unassigned rows in each plugin's assign sidebar). A param cannot land on an
   action-occupied widget. Actions are press-driven → legal only on press widgets (pads/buttons).
2. **Consumed when assigned** — both params and app functions disappear from the assign sidebar
   once they sit on a widget; the sidebar is the dump of *unassigned* functions.
3. **Unassign = drag off** — drag a widget's occupant back onto the sidebar to unbind it.
4. **Overlay is inert** — overlay widgets never drive the bus; only the pop-out and the main
   sidebar control the app.
5. **Hardware**: keep `MidiManager`/parser/learner/router + right-click learn. Hardware now binds
   **only to widgets** (the action target variant of `HardwareTarget` is deleted — an app function
   reaches hardware *through* the widget it sits on). Hardware tab deleted; overrides live on `#db`.
6. **App actions**: `clear` (clears the active bank's plugin AND shader — collapsed) + `bank0..5`.
   `load`, `clearShader`, `browsePlugin`, `browseShader` actions are deleted (jogs browse; the
   Remove space shortcut that calls `load()` in code; remove header ✕ that calls `clearShader()` in code).
7. **Header click-to-focus**: clicking the gen preview focuses the active bank's plugin half,
   clicking the fx preview focuses its shader half (no dial-cycling needed).

## Schema — `src/db/schema.ts`

- **New `actionBindings` table** `{ id, widgetId, actionId }`, persisted
  (`marathon.db.actionBindings.v1`, sanitizer), uniques on **both** widgetId and actionId, FKs →
  widgets/appActions (cascade). Validate: `WIDGET_SIGNAL[widget.kind] === "press"` and
  `!widget.reserved`.
- `paramBindings.validate` additionally rejects a widget occupied by an actionBinding (cross-table
  lookup, same pattern as the existing `widgets.get` check; actions win — in `applyPreset` insert
  actionBindings **before** paramBindings so conflicting param rows are skipped by `insertEach`).
- New mutation `setActionBinding(actionId, widgetId | null)`: deletes existing rows for both the
  action and the widget, deletes **all** paramBindings rows on that widget (eviction), inserts.
- `setParamBinding`: bail if the widget is action-occupied (defensive; UI filters legality anyway).
- `AppAction` narrows to `"clear" | "bank0".."bank5"`; `AppActionRow` drops `momentary` (all
  actions are press-run now).
- `HardwareBindingRow`: flatten `target` to `widgetId: SlotId` (sanitizer drops old stored
  action-target rows on load). Delete `HardwareTarget`.

## Seeds — `src/db/seeds.ts`

- Widget catalog: add `pad:0..3` and `pad:13..16` as **normal pads** (the old GlobalPad strip
  becomes real widgets).
- `APP_ACTION_SEED`: `clear` ("Clear") + `bank0..5` ("Bank 1–6").
- `DEFAULT_ACTION_LAYOUT`: `pad:0→clear, pad:1..3→bank0..2, pad:14..16→bank3..5` (pad:13 spare).
  Materialised copy-on-first-touch (only when `actionBindings` is empty), from boot alongside
  `seedParamBindings`.

## Runtime

- **`src/midi/router.ts`**: widget-only — delete the action branch and the `step`/`run` handlers
  (`MidiActionHandlers` shrinks to just `report`). Hardware jog → learned onto `jog:0/1` widgets →
  browse via the existing bus subscription.
- **`src/ui/app/useMidiRouting.ts`**: drop the handlers plumbing accordingly.
- **`src/ui/app/LiveProvider.tsx`**:
  - *Action driver*: effect that subscribes to the bus for each `actionBindings` row (rebuilt on
    table version), rising press → run the action (`clear` → `clearBank()`; `bank i` →
    select-if-loaded else load — same logic as today's `bankControl.select`). Works identically
    for pop-out relays and hardware, since both land on the host bus.
  - Provide new **`SlotActionContext`**: `slotId → { label, lit }` (lit = that bank is active) for
    widget labels/lighting.
  - Delete `BankControl` context + its remote messages (`bankSelect`/`bankClear`) — bank pads are
    ordinary bus presses now.

## Controller UI

- **Delete `GlobalPad.tsx`**; top rows render `Pad` slots 0..3 / 13..16. `Pad`/`SlotFrame` read
  `SlotActionContext` for the label + lit state (falls back to param label via `SlotLabelContext`).
- New **`SurfaceModeContext`**: `"live"` (pop-out) vs `"assign"` (overlay). In assign mode:
  widgets attach no drive handlers (inert); frames with an occupant are **draggable** (payload =
  occupant); every frame is a drop target per the pending assignment's legality (existing
  `AssignContext` machinery); click-to-arm/click-to-complete still works.
- `AssignPending` (in `widgets/shared.tsx`) becomes a union:
  `{ type:"param", pluginId, paramId, label, legal }` | `{ type:"action", actionId, label, legal }`;
  `assignTo` in LiveProvider routes to `setParamBinding` / `setActionBinding`.
- **Pop-out** (`RemoteControllerApp.tsx` / `remoteChannel.ts`): mode `"live"`. `RemoteSnapshot`
  replaces `banks` + assign fields with `actions` (the SlotActionContext map); assign highlighting
  is removed from the pop-out (the overlay is now the only assign surface — big message-protocol
  simplification: drive/fire/step/hello/snapshot only).

## Sidebars

- **`src/ui/app/LiveApp.tsx`**: the drawer renders `<AssignPanel/>` while the controller overlay
  is open, `<ControlsPanel/>` otherwise (the existing auto-open/restore logic stays).
- **`ControlsPanel`** (respecting the user's already-trimmed `PluginBindingsPanel.tsx`): focused
  plugin's params with **value editors only** — no chips, no reset. Reuse `ValueEditor`/`ParamFader`.
- **New `src/ui/controls/AssignPanel.tsx`**:
  - "Params" section: the focused plugin's **unassigned** params — whole row draggable (uses the
    existing `pendingFor` legality helper), click-to-arm as fallback.
  - "App" section: **unassigned** app functions, same draggable rows.
  - The panel body is a drop target: dropping a dragged occupant unbinds it (returns to the list).
  - Presets bar moves here (presets snapshot bindings: now `paramBindings + actionBindings +
    hardwareControls + hardwareBindings` in `db/presets.ts`).

## Header — `src/ui/stage/HeaderBar.tsx`

- Wrap the gen and fx `PluginPreview`s in buttons: click → `setFocusPart("plugin" | "shader")`;
  indicate the focused half (accent ring/underline).

## Overlay dialog — `src/ui/settings/MidiSettingsDialog.tsx`

- Strip to: FitBox'd controller (assign mode) + the pop-out button. No tabs, no device status, no
  hardware table. Delete the `Tab` type and LiveApp's `tab` state. Keep `LearnToast` and the
  `lastMidi` header readout (feedback while learning).

## DB dev page

- `src/main.tsx`: route hash `#db` → new **`src/ui/dev/DbPage.tsx`** (alongside `#controller`):
  - Table picker over the named schema exports (plugins, params, widgets, appActions,
    hardwareControls, hardwareBindings, paramBindings, actionBindings, presets), generic row grid
    (pretty JSON), live via `useTable`.
  - Row **delete** on user-mutable tables; a **`kind` select** on hardwareControls rows — this is
    the home of the "learned a jog as a knob" override (drives `useHardwareSync` as today).
  - Small MIDI device-status line.

## Deletions

`src/midi/autoAssign.ts` (+ test) — its button lived in the deleted hardware tab; `GlobalPad.tsx`;
`BankControl` context + messages; `HardwareTarget` action variant; hardware tab UI; `load` /
`clearShader` / browse app actions.

## Tests

- `router.test.ts`: remove action/browse cases; flattened `widgetId` bindings.
- `seeds.test.ts`: add default action layout materialisation; locked opacity test unchanged.
- New schema test: actionBindings uniqueness, press-only validation, param eviction on
  `setActionBinding`, paramBindings rejected on occupied widgets.
- `Stage.test.ts` untouched.

## Verification

1. `npm run typecheck && npm test && npm run build`.
2. `npm run dev` manual pass: load plugins → open overlay → drag params/app functions on/off
   widgets (consume + return in sidebar, eviction across plugins), confirm overlay widgets are
   inert; pop-out drives banks/params/browse; main sidebar edits values; header previews focus
   plugin/shader; `#db` shows all tables and edits a hardware control's kind; right-click learn
   arms as before.

## Migration

None needed: sanitizers/FK-pruning drop old stored action-target hardware rows and any stale
bindings on boot (console warnings only).

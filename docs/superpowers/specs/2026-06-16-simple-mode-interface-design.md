# Simple Mode — Zwei-Modi-Interface für das Marathon Generative Tool

**Datum:** 2026-06-16
**Status:** Genehmigtes Design (bereit für Implementierungsplan)

## Problem

Das Tool ist heute wie Photoshop/After Effects aufgebaut: ein layer-basiertes Kompositions-System mit Toolbar, Layers-Panel, Viewport, Inspector und Timeline. Das ist mächtig, erfordert aber Einarbeitung. Für die Erstellung von Marathon-Werbe-/Social-Media-Content soll es einen niederschwelligen Einstieg geben, der mit minimalem Aufwand „von allein" cool aussehende Visuals erzeugt.

## Ziel

Zwei Modi mit einem Umschalter:

1. **Simple Mode** (Default): reduziertes Interface. Der Nutzer wählt ein paar Element-Typen und stellt **Dynamik** und **Komplexität** ein; das Tool generiert daraus prozedural ein markengerechtes Visual.
2. **Pro Mode**: das heutige, vollständige Interface mit allen Editier-Optionen — aktivierbar über einen Schalter im Simple Mode.

## Designentscheidungen (aus dem Brainstorming)

- **Generierungs-Modell:** prozedurale Rezept-Engine. Nutzer wählt Element-Typen; das Tool komponiert sie mit guten Defaults; „Würfeln" erzeugt Varianten.
- **Modus-Übergang:** gleiche Komposition, nur anderer Editor. Simple Mode baut eine *echte* Komposition in der Engine; Pro Mode zeigt dieselbe Szene mit allen Panels.
- **Branding:** Marathon-Hausstil wird automatisch über jede Generierung gelegt (Palette + Post-FX). Output ist immer on-brand.
- **UI-Layout:** Variante B — breite Live-Vorschau links, schmale Steuer-Sidebar rechts.

## Architektur

Die Engine bleibt **modus-agnostisch und unverändert** (sie ist headless; die UI steuert sie ausschließlich über die public API + Event-Bus). Der Modus ist reine UI-Sache plus ein neues, headless Generator-Modul.

Drei neue, klar abgegrenzte Bausteine:

### 1. `src/generator/` — die Rezept-Engine (headless, kein React)

Bekommt ein `Recipe` + Seed und erzeugt daraus über die public API der Engine (`addLayer`, `setPropertyValue`, …) eine echte Komposition. **Deterministisch:** gleiches Rezept + Seed → exakt dieselbe Szene. Das passt zur bestehenden „alles ist seekbar/deterministisch"-Philosophie der Engine.

Vorgeschlagene Dateien:
- `Recipe.ts` — Typen (`Recipe`, `ElementType`).
- `rng.ts` — seeded RNG (deterministisch, kein `Math.random`).
- `elements.ts` — pro Element-Typ eine `build(recipe, rng) → LayerConfig[]`-Funktion, die Dynamik & Komplexität interpretiert.
- `houseStyle.ts` — Marathon-Palette + Post-FX-Pass.
- `generate.ts` — Orchestrator: Rezept → Engine-Kommandos, in **einer** Undo-Transaktion (`history.execute`) gewrappt.

### 2. UI-Modus-State

- `"simple" | "pro"`, im `EngineProvider`-Context (oder benachbarter Mode-Context).
- Default `simple`.
- Persistiert in `localStorage` **und** im Projekt (serialisiert).

### 3. `App.tsx` verzweigt

`mode === "simple" ? <SimpleApp/> : <ProApp/>`, wobei `<ProApp/>` exakt das heutige Layout ist (unverändert).

## Datenmodell: das Rezept

```ts
type ElementType =
  | "boids" | "noise" | "glyphScatter" | "plant" | "harmonograph"
  | "wire" | "landscape" | "life" | "cloud" | "shape" | "text";

interface Recipe {
  elements: ElementType[];   // gewählte Element-Typen, z.B. ["boids","noise","text"]
  dynamic: number;           // 0..1 → Bewegungsintensität
  complexity: number;        // 0..1 → Dichte & Anzahl Layer/Detail
  seed: number;              // "Würfeln" ändert nur das
  format: ResolutionPreset;  // Social-Format (Story/Post/Square/TikTok …)
}
```

Das Rezept wird **im Projekt mitgespeichert** (serialisiert), damit Simple Mode beim Wiederöffnen editierbar bleibt. Verhalten:
- „Würfeln" → neuer Seed → Neugenerierung.
- Slider bewegen / Elemente ändern → Neugenerierung.
- Jede Neugenerierung ist **eine** Undo-Stufe (in `history.execute` gewrappt) — Würfeln ist undobar.

## Dynamik & Komplexität — Mapping

Jeder Element-Typ bringt eine kleine `build(recipe, rng)`-Funktion mit, die die zwei Regler interpretiert:

- **Dynamik** (`0..1`) → globale Bewegung: Animations-/`autoEvolve`-Tempo, `wiggle`-Amplituden, Boids-Speed, Noise-Evolution, Drift/Rotation. `0` = Standbild-Poster, `1` = energiegeladen.
- **Komplexität** (`0..1`) → Menge & Detail: Anzahl gestapelter Element-Layer aus dem Pool, Partikel-/Boid-Counts, Glyph-Raster-Dichte, Subdivisions/Detail. `0` = ein cleanes Element, `1` = reich geschichtet.

## Marathon-Hausstil (automatisch)

Nach dem Bauen der Element-Layer legt der Generator immer einen **House-Style-Pass** drüber:
- dunkler Hintergrund + Marathon-Palette via `fx.colorLookup` (neu zu definierende Orange/Teal/Magenta/Deep-Blue-Palette; der `colorLookup`-Mechanismus existiert bereits),
- optional ein dezenter Grid-/Glyph-Akzent-Layer.

→ Output sieht **immer** on-brand aus, unabhängig von der Elementwahl.

## Simple-Mode-UI (Layout B)

- **Links:** der bestehende `Viewport` (Canvas) — wiederverwendet, kein Neubau.
- **Rechts, schmale `SimplePanel`-Sidebar:**
  - Element-Chips (kuratierte Auswahl, s. `ElementType` oben),
  - Dynamik-Slider,
  - Komplexität-Slider,
  - **⚄ Würfeln**-Button,
  - **Export**-Button.
- **Oben, schlanke `SimpleToolbar`:** Logo, Social-Format-Quickpick (Story/Post/Square/TikTok …), Play/Pause, und rechts der **„Pro Mode ▸"**-Schalter.
- Export vereinfacht: Bild (PNG) / Video (WebM·MP4) — direkt auf die Social-Formate gemappt (nutzt den bestehenden `Exporter`).
- **Ausgeblendet im Simple Mode:** LayersPanel, Inspector, Timeline.

Vorgeschlagene neue Komponenten:
- `src/ui/SimpleApp.tsx`
- `src/ui/panels/SimplePanel.tsx`
- `src/ui/panels/SimpleToolbar.tsx`
- `src/ui/ProApp.tsx` (= aktueller Inhalt von `App.tsx`, extrahiert)

## Übergang Simple ↔ Pro

- **Simple → Pro:** nur Panels einblenden, dieselbe Szene. Keine Datenumwandlung.
- **Pro → Simple:** Wir tracken, ob die Szene noch „rezept-rein" ist (Flag/Hash, beim Generieren gesetzt, durch jede Pro-Bearbeitung invalidiert).
  - **rein** → Slider/Würfeln arbeiten normal weiter.
  - **dirty (pro-bearbeitet)** → Simple zeigt die aktuelle Szene weiter an, aber beim ersten Slider/Würfeln erscheint eine Warnung: *„Manuelle Pro-Änderungen gehen beim Neugenerieren verloren."* Es wird **nicht** versucht, Pro-Edits in ein Rezept zurückzurechnen (das wäre fragil und unehrlich).

## Testbarkeit

Der Generator ist rein & deterministisch → gut unit-testbar:
- gleiches Rezept + Seed ⇒ identischer serialisierter Layer-Baum (Snapshot-Test),
- Dynamik `0` vs `1` verändert Motion-Parameter messbar,
- Komplexität verändert die Layer-Anzahl,
- House-Style hängt immer `fx.colorLookup` an.
- Component-Test für den Modus-Toggle (Simple ↔ Pro, Persistenz).

## Nicht im Scope (YAGNI / spätere Iterationen)

- Reverse-Engineering von Pro-Edits zurück in ein Rezept.
- Mehrere wählbare Paletten im Simple Mode (Hausstil ist fix als Default — bewusst, für maximale Einfachheit).
- Eigene Rezept-Presets/Speichern über das Projekt hinaus.

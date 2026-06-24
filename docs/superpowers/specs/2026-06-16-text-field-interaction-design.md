# Text-Feld-Interaktion mit Simulationen (RD & Slime Mold)

**Datum:** 2026-06-16
**Status:** Genehmigtes Design (bereit für Implementierungsplan)

## Problem

Der Nutzer möchte Text in generative Simulationen einbetten: Reaction-Diffusion (`reactionDiffusion`) und Slime Mold (`physarum`) sollen Text aufnehmen können, der sich in ihre Muster „einfügt" — z.B. dass das Muster die Buchstabenformen füllt, aus ihnen herauswächst oder zu ihnen hingezogen wird.

## Designentscheidungen (aus dem Brainstorming)

- **Implementierungsstil:** Wie die Ziel-Plugins selbst — rohes Canvas-2D + typisierte Arrays. **Kein p5** im performance-kritischen Sim-Code. (Nur das Plant-Plugin nutzt p5; RD/Physarum/Boids/Life/Noise/Text sind Canvas-2D.) Der Text wird per `fillText` in eine Maske gerastert und in die Sim-Felder injiziert.
- **Mehrere wählbare Modi:** Die Interaktion ist nicht auf einen Effekt festgelegt; pro Simulation wählt der Nutzer den Modus (`off`/`fill`/`grow`/`attract`).
- **Scope v1:** Nur Pro-Editor. Nur RD + Slime Mold erhalten die neuen Properties. Noch nicht im Simple Mode.

## Mechanismus: der bestehende `below`-Seam

Die Engine reicht bereits `frame.below` an jeden Content-Layer weiter, der direkt über einem Layer mit `fieldSource`/`meshSource` liegt (`Compositor.belowSource`, `Compositor.renderContainer` Zeile ~284). Genau dieser Mechanismus (heute: Noise → Landscape/GlyphScatter) trägt das Feature — **kein Compositor-Eingriff nötig**.

- Das **Text-Layer** implementiert neu `fieldSource(props)` + `sourceKey(props)`:
  - Es rastert seinen Text (gleicher Inhalt/Font/Größe/Tracking/Bold wie die sichtbare Darstellung) in einen kleinen Offscreen-Canvas (`fillText`), liest den Alpha-Kanal und liefert einen Sampler `(x, y, z) => number` mit Abdeckung `[0,1]` (1 = innerhalb eines Buchstabens). `z` wird ignoriert. `(x,y)` werden als normalisierte Komp-Koordinaten `0..1` interpretiert.
  - Die Rasterung wird gecacht und nur neu gebaut, wenn sich Text/Font/Größe/Tracking/Bold ändern (`sourceKey`).
- **Anordnung:** Text-Layer direkt UNTER die Simulation legen (konsistent mit Noise → Landscape). Soll der Text zusätzlich sichtbar als Kontur erscheinen, legt der Nutzer ein zweites Text-Layer darüber.

## Wählbare Modi

Jede konsumierende Simulation (RD, Physarum) erhält zwei neue Schema-Properties:

- **`textInfluence`** — `type: "select"`, `animatable: false`, Default `"off"`. Optionen: `off`, `fill`, `grow`, `attract`.
- **`textStrength`** — `type: "percent"`, Default `0.8`, `meta: { min: 0, max: 1, step: 0.01 }`.

Wirkt nur, wenn `textInfluence !== "off"` UND `frame.below?.field` vorhanden ist. Die Sim sampelt das Feld an Gitterzelle bzw. Agentenposition (normalisierte Koordinaten) und injiziert pro Modus:

| Modus | Reaction-Diffusion | Slime Mold (Physarum) |
|---|---|---|
| **fill** | Pro Step: Zellen außerhalb der Maske werden Richtung `U=1, V=0` gedrückt (proportional zu `strength`) → Muster auf die Buchstaben beschränkt. Beim Init V-Saat innerhalb des Texts. | Agenten außerhalb der Maske werden hinein-genudged/respawnt; Deposit nur wo `maske > threshold`. |
| **grow** | Beim Reinit V-reiche Zellen entlang der Maske säen (statt zufälliger Spots) → Muster keimt auf den Buchstaben und breitet sich aus. | Agenten beim Init auf der Maske platzieren (entlang der Buchstaben); sie kriechen heraus. |
| **attract** | Lokales `feed` per `feed_eff = feed + strength · (maske − 0.5) · range` vorspannen → Textregion entwickelt sich sichtbar anders. | Statischer Attraktor `strength · maske` ins gesampelte Trail-Feld addieren → Agenten ziehen zum Text und verstärken ihn. |

Modi sind pro Layer getrennt wählbar → RD und Slime Mold können gleichzeitig (jeweils über eigenem/geteiltem Text-Layer) denselben Text in unterschiedlichen Modi einbetten.

## Determinismus

Die Maske hängt ausschließlich von den evaluierten Text-Properties ab (deterministisch). `fill`/`attract` wirken deterministisch je Simulationsschritt; `grow` sät beim Reinit. Damit bleiben RD und Physarum vollständig **deterministisch, scrubbar und frame-genau** — die Kerngarantie der Engine bleibt erhalten. Backward-Seeks replayen wie bisher von Schritt 0.

## Generischer Bonus

Da die Simulationen das allgemeine `below.field` lesen, funktioniert auch ein Noise-Layer darunter als Leitfeld. Das Feature ist auf Text ausgelegt, der Mechanismus ist aber feld-agnostisch.

## Architektur / Dateien

- **`src/plugins/_shared/textMask.ts`** (neu): rastert Text → Sampler. Isoliert, ohne Engine-Abhängigkeit, unit-testbar.
  - Export z.B. `buildTextMask(opts: { text: string; bold: boolean; tracking: number; fontSizeFrac: number; aspect: number; res?: number }) => (x: number, y: number) => number` und ein `textMaskKey(opts) => string`.
  - Rastert in einen Offscreen-Canvas fester Kantenlänge (`res`, z.B. 256 in der längeren Achse), zentriert, liest `getImageData`, gibt normalisierte Abdeckung zurück (bilineares oder nearest-Sampling).
- **`src/plugins/text/TextLayer.ts`** (modifiziert): `fieldSource(props)` + `sourceKey(props)` ergänzen, beide via `textMask.ts`. Die sichtbare `render`-Methode bleibt unverändert.
- **`src/plugins/reactionDiffusion/ReactionDiffusionLayer.ts`** (modifiziert): `textInfluence` + `textStrength` ins Schema; im Renderer das `frame.below.field` lesen und gemäß Modus in `reinit` (grow/fill-Saat) bzw. `step`/nach dem Step (fill/attract) in die `u`/`v`-Arrays injizieren. Die Maske wird einmal pro Frame auf das aktuelle Grid gesampelt und gecacht (Key aus `below.key` + Gitterdimensionen).
- **`src/plugins/physarum/PhysarumLayer.ts`** (modifiziert): `textInfluence` + `textStrength` ins Schema; Maske auf das Trail-Grid sampeln; `grow`/`fill` bei Agenten-Init/Respawn, `attract`/`fill` im Agenten-Schritt (Sensing/Deposit).

## Tests

- **`textMask.ts`** (unit): deterministisch für gleiche Optionen; ein einzelner Großbuchstabe (z.B. „I") ergibt hohe Abdeckung in der Mitte und niedrige in den Ecken; leerer Text → überall ~0.
- **RD:** `textInfluence: "off"` reproduziert das bisherige Verhalten (gleicher `sceneHash`/Output wie ohne die neuen Props). `fill` mit einer Voll-Maske (`field` ≡ 1) lässt das Muster überall zu; mit einer Null-Maske (`field` ≡ 0) wird außerhalb unterdrückt (Zellen bleiben nahe `V=0`). Da Tests headless ohne Mount laufen, werden die Injektionsfunktionen so faktorisiert, dass sie auf den typisierten Arrays direkt testbar sind (reine Funktion `applyTextField(u, v, cols, rows, sample, mode, strength)`), ohne Canvas/Rendering.
- **Physarum:** analog eine reine Injektionsfunktion auf dem Trail-/Agenten-Array testen (z.B. `attract` erhöht das gesampelte Feld dort, wo die Maske 1 ist).

## Nicht im Scope (YAGNI)

- Simple-Mode-Integration / Preset.
- Weitere Konsumenten (boids, life) — der Seam ist wiederverwendbar, wird aber jetzt nicht verdrahtet.
- SDF/Feather-Kantenglättung der Maske über simples Coverage-Sampling hinaus.
- Mehrzeiliges Auto-Layout über das hinaus, was das Text-Layer ohnehin schon kann.

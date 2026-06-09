import { useEffect, useRef } from "react";
import { Dices, Eraser, FlipHorizontal2, Save, Trash2 } from "lucide-react";
import type { Layer } from "@/engine";
import { useEngine, useRevision } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/ui/button";
import { cn } from "@/ui/lib/cn";
import {
  cloneGlyph,
  emptyGlyph,
  resizeGlyph,
  type GlyphData,
} from "@/plugins/glyph/glyphData";
import { deleteGlyph, saveGlyph, useGlyphLibrary } from "@/glyphs/glyphStore";

const SIZES = [8, 12, 16, 24];

export function GlyphInspector({ layer }: { layer: Layer }) {
  const engine = useEngine();
  useRevision();
  const library = useGlyphLibrary();
  const glyph = (layer.data.glyph as GlyphData) || emptyGlyph();
  const paint = useRef<{ down: boolean; val: number }>({ down: false, val: 1 });

  useEffect(() => {
    const up = () => (paint.current.down = false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const commit = (next: GlyphData, label = "Paint glyph", coalesce = `glyph:${layer.id}`) =>
    engine.setLayerData(layer.id, { ...layer.data, glyph: next }, label, coalesce);

  const setPixel = (idx: number, val: number) => {
    if (glyph.pixels[idx] === val) return;
    const pixels = glyph.pixels.slice();
    pixels[idx] = val;
    commit({ ...glyph, pixels });
  };

  const cellPx = Math.max(8, Math.floor(184 / glyph.w));

  return (
    <div className="mb-2 rounded bg-panel-raised p-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-dim">Glyph Editor</div>

      <div
        className="mx-auto w-fit select-none rounded border border-edge bg-black p-1"
        style={{ display: "grid", gridTemplateColumns: `repeat(${glyph.w}, ${cellPx}px)`, gap: 1 }}
        onPointerLeave={() => (paint.current.down = false)}
      >
        {glyph.pixels.map((on, i) => (
          <div
            key={i}
            style={{ width: cellPx, height: cellPx }}
            className={cn("cursor-pointer", on ? "bg-accent" : "bg-[#1a1a1a] hover:bg-[#2a2a2a]")}
            onPointerDown={(e) => {
              e.preventDefault();
              const val = glyph.pixels[i] ? 0 : 1;
              paint.current = { down: true, val };
              setPixel(i, val);
            }}
            onPointerEnter={() => paint.current.down && setPixel(i, paint.current.val)}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Button size="xs" variant="ghost" title="Clear" onClick={() => commit(emptyGlyph(glyph.w, glyph.h), "Clear glyph", "")}>
          <Eraser className="h-3 w-3" /> Clear
        </Button>
        <Button size="xs" variant="ghost" title="Invert" onClick={() => commit({ ...glyph, pixels: glyph.pixels.map((p) => 1 - p) }, "Invert glyph", "")}>
          <FlipHorizontal2 className="h-3 w-3" /> Invert
        </Button>
        <Button
          size="xs"
          variant="ghost"
          title="Random from library"
          onClick={() => {
            const pick = library[Math.floor(Math.random() * library.length)];
            if (pick) commit(cloneGlyph(pick.glyph), "Random glyph", "");
          }}
        >
          <Dices className="h-3 w-3" /> Random
        </Button>
        <Button
          size="xs"
          variant="outline"
          title="Save as preset"
          onClick={() => {
            const name = window.prompt("Preset name", "My Glyph");
            if (name) saveGlyph(name, glyph);
          }}
        >
          <Save className="h-3 w-3" /> Save
        </Button>
        <select
          className="h-5 rounded border border-edge bg-panel px-1 text-[11px] text-ink outline-none"
          value={glyph.w}
          onChange={(e) => commit(resizeGlyph(glyph, +e.target.value, +e.target.value), "Resize glyph", "")}
        >
          {SIZES.map((s) => (
            <option key={s} value={s}>{s}×{s}</option>
          ))}
        </select>
      </div>

      <div className="mt-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-dim">Library ({library.length})</div>
        <div className="flex flex-wrap gap-1">
          {library.map((p) => (
            <div key={p.id} className="group relative">
              <button
                title={p.name}
                className="rounded border border-edge bg-black p-0.5 hover:border-accent"
                onClick={() => commit(cloneGlyph(p.glyph), `Load ${p.name}`, "")}
              >
                <GlyphThumb glyph={p.glyph} />
              </button>
              {!p.builtin && (
                <button
                  className="absolute -right-1 -top-1 hidden rounded-full bg-red-600 p-0.5 group-hover:block"
                  title="Delete preset"
                  onClick={() => deleteGlyph(p.id)}
                >
                  <Trash2 className="h-2.5 w-2.5 text-white" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GlyphThumb({ glyph }: { glyph: GlyphData }) {
  const px = Math.max(1, Math.floor(28 / glyph.w));
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${glyph.w}, ${px}px)`, gap: 0 }}>
      {glyph.pixels.map((on, i) => (
        <div key={i} style={{ width: px, height: px, background: on ? "var(--color-accent)" : "transparent" }} />
      ))}
    </div>
  );
}

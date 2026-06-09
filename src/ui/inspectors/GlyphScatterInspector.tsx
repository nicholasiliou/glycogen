import { RefreshCw } from "lucide-react";
import type { Layer } from "@/engine";
import { useEngine, useRevision } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/ui/button";
import { cloneGlyph, type GlyphData } from "@/plugins/glyph/glyphData";
import { listGlyphs } from "@/glyphs/glyphStore";

export function GlyphScatterInspector({ layer }: { layer: Layer }) {
  const engine = useEngine();
  useRevision();
  const glyphs = (layer.data.glyphs as GlyphData[] | undefined) ?? [];

  return (
    <div className="mb-2 rounded bg-panel-raised p-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-dim">Glyph Set</div>
      <p className="mb-2 text-[11px] leading-snug text-ink-dim">
        Scatters {glyphs.length} glyph{glyphs.length === 1 ? "" : "s"}, selected per cell by the noise field.
      </p>
      <Button
        size="xs"
        variant="outline"
        onClick={() =>
          engine.setLayerData(
            layer.id,
            { ...layer.data, glyphs: listGlyphs().map((p) => cloneGlyph(p.glyph)) },
            "Refresh scatter glyphs",
          )
        }
      >
        <RefreshCw className="h-3 w-3" /> Use library glyphs ({listGlyphs().length})
      </Button>
    </div>
  );
}

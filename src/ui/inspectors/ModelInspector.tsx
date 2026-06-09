import { useRef } from "react";
import { Upload, X } from "lucide-react";
import type { Layer } from "@/engine";
import { useEngine, useRevision } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/ui/button";
import { loadMeshFromFile, type MeshData } from "@/plugins/slicer/meshLoader";

export function ModelInspector({ layer }: { layer: Layer }) {
  const engine = useEngine();
  useRevision();
  const fileRef = useRef<HTMLInputElement>(null);
  const mesh = layer.data.mesh as MeshData | undefined;
  const version = typeof layer.data.meshVersion === "number" ? layer.data.meshVersion : 0;

  const onFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const m = loadMeshFromFile(file.name, buf);
      if (!m.count) {
        alert("No triangles found in that file.");
        return;
      }
      engine.setLayerData(layer.id, { ...layer.data, mesh: m, meshVersion: version + 1 }, "Load model");
    } catch (err) {
      console.error(err);
      alert(`Could not load model: ${(err as Error).message}`);
    }
  };

  return (
    <div className="mb-2 rounded bg-panel-raised p-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-dim">3D Model</div>
      {mesh ? (
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="min-w-0 truncate text-ink">{mesh.name} · {mesh.count.toLocaleString()} tris</span>
          <Button size="icon-sm" variant="ghost" title="Remove model" onClick={() => engine.setLayerData(layer.id, { ...layer.data, mesh: undefined, meshVersion: version + 1 }, "Remove model")}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <p className="mb-2 text-[11px] leading-snug text-ink-dim">
          Upload an <b>.obj</b> or <b>.stl</b> model. Put a Slicer above this layer to slice it.
        </p>
      )}
      <Button size="xs" variant="outline" className="mt-1.5" onClick={() => fileRef.current?.click()}>
        <Upload className="h-3 w-3" /> {mesh ? "Replace model…" : "Upload .obj / .stl…"}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".obj,.stl"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

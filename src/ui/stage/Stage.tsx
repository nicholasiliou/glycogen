import { useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { useLive } from "@/ui/app/LiveProvider";
import { useExportSettings } from "@/ui/export/ExportContext";
import { masksFor } from "@/runtime/export";
import { readPngText } from "@/runtime/export/exporters/pngMeta";
import { applyScene, parseScene, SCENE_PNG_KEYWORD } from "@/runtime/scene";
import { asset } from "@/lib/asset";

/**
 * The stage viewport. Mounts the runtime {@link Stage}'s canvas into a 16:9-masked host and overlays
 * the export framing guide — the chosen aspect-ratio crop, dimmed letterbox, and a live mask preview
 * — so the operator always sees exactly what an export will capture. Same look as before, now backed
 * by the plugin-stack runtime instead of the engine compositor.
 */
export function Stage() {
  const { stage } = useLive();
  const ex = useExportSettings();
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [dropNote, setDropNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dropping an exported PNG back on the stage restores the scene baked into its metadata.
  const flashNote = (msg: string) => {
    setDropNote(msg);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setDropNote(null), 2500);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void file.arrayBuffer().then((buf) => {
      const json = readPngText(new Uint8Array(buf), SCENE_PNG_KEYWORD);
      const scene = json ? parseScene(json) : null;
      if (scene) {
        applyScene(stage, scene);
        flashNote("Scene restored");
      } else {
        flashNote("No marathon scene in this file");
      }
    });
  };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = stage.canvas;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.boxShadow = "0 0 80px rgba(0,0,0,0.6)";
    host.style.maskImage = `url(${asset("/masks/16x9/1.svg")})`;
    host.style.maskSize = "100% 100%";
    host.style.maskPosition = "0 0";
    host.style.maskRepeat = "no-repeat";
    host.appendChild(canvas);

    const resize = () => {
      stage.resize(host.clientWidth, host.clientHeight);
      setSize({ w: host.clientWidth, h: host.clientHeight });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    return () => {
      ro.disconnect();
      if (canvas.parentElement === host) host.removeChild(canvas);
    };
  }, [stage]);

  // Export crop, computed over the full viewport (the canvas fills the host).
  const ratioWH = ex.ratio.width / ex.ratio.height;
  const canvasWH = size.w / size.h;
  const cropW = ratioWH > canvasWH ? size.w : size.h * ratioWH;
  const cropH = ratioWH > canvasWH ? size.w / ratioWH : size.h;
  const cropX = (size.w - cropW) / 2;
  const cropY = (size.h - cropH) / 2;

  let maskUrl: string | undefined;
  if (ex.maskEnabled) {
    const variant = masksFor(ex.ratioId)[ex.maskVariant];
    if (variant) maskUrl = variant.url.endsWith(".svg") ? variant.url : `${variant.url}/1.svg`;
  }

  return (
    <div
      ref={hostRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="relative h-full w-full touch-none overflow-visible bg-black"
    >
      {dropNote && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-[11px] text-ink">
          {dropNote}
        </div>
      )}
      <div
        className="pointer-events-none absolute z-5"
        style={{
          left: cropX,
          top: cropY,
          width: cropW,
          height: cropH,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
        }}
      />
      {maskUrl && (
        <div
          className="pointer-events-none absolute z-4"
          style={{
            left: cropX,
            top: cropY,
            width: cropW,
            height: cropH,
            WebkitMaskImage: `url(${maskUrl})`,
            maskImage: `url(${maskUrl})`,
            WebkitMaskSize: "100% 100%",
            maskSize: "100% 100%",
            borderRadius: "4px",
          }}
        />
      )}
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEngine, useRevision } from "@/ui/engine/EngineProvider";
import { useExportSettings } from "./ExportContext";
import { masksFor } from "@/engine";

/**
 * The live stage: mounts the engine canvas, fit + centered, with no editor chrome. Pointer
 * input is forwarded into the engine (so plugins that read the cursor stay interactive).
 */
export function Stage() {
  const engine = useEngine();
  useRevision();
  const ex = useExportSettings();
  const comp = engine.comp;
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Mount the shared engine canvas + forward input.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = engine.canvas;
    if (!host || !canvas) return;
    canvas.style.position = "absolute";
    canvas.style.pointerEvents = "none";
    canvas.style.boxShadow = "0 0 80px rgba(0,0,0,0.6)";
    host.style.maskImage = "url(/mask.svg)";
    host.style.maskSize = "100% 100%";
    host.style.maskPosition = "0 0";
    host.style.maskRepeat = "no-repeat";
    host.appendChild(canvas);
    engine.input.attach(host);
    return () => {
      if (canvas.parentElement === host) host.removeChild(canvas);
      engine.input.detach();
    };
  }, [engine]);

  const margin = 0;
  const z = Math.max(0.02, Math.max((size.w - margin) / comp.width, (size.h - margin) / comp.height));
  const dispW = comp.width * z;
  const dispH = comp.height * z;
  const ox = (size.w - dispW) / 2;
  const oy = (size.h - dispH) / 2;

  useEffect(() => {
    const canvas = engine.canvas;
    if (!canvas) return;
    canvas.style.left = `${ox}px`;
    canvas.style.top = `${oy}px`;
    canvas.style.width = `${dispW}px`;
    canvas.style.height = `${dispH}px`;
  }, [engine, ox, oy, dispW, dispH]);

  // Export-framing preview: the centered crop rect of the chosen aspect ratio inscribed in the
  // displayed canvas (matches the exporter's cover-crop), with the export mask shown when enabled.
  const ratioWH = ex.ratio.width / ex.ratio.height;
  const canvasWH = dispW / dispH;
  const cropW = ratioWH > canvasWH ? dispW : dispH * ratioWH;
  const cropH = ratioWH > canvasWH ? dispW / ratioWH : dispH;
  const cropX = ox + (dispW - cropW) / 2;
  const cropY = oy + (dispH - cropH) / 2;
  const maskUrl = ex.maskEnabled ? masksFor(ex.ratioId)[ex.maskVariant]?.url : undefined;

  return (
    <div ref={hostRef} className="relative h-full w-full touch-none overflow-visible bg-black">
      {/* dim the area outside the export crop */}
      <div
        className="pointer-events-none absolute z-5 border border-white/40"
        style={{
          left: cropX,
          top: cropY,
          width: cropW,
          height: cropH,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
        }}
      />
      {/* export mask overlay (on top of the shadow, not affecting it) */}
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

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEngine, useRevision } from "@/ui/engine/EngineProvider";

/**
 * The live stage: mounts the engine canvas, fit + centered, with no editor chrome. Pointer
 * input is forwarded into the engine (so plugins that read the cursor stay interactive).
 */
export function Stage() {
  const engine = useEngine();
  useRevision();
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

  return <div ref={hostRef} className="relative h-full w-full touch-none overflow-visible bg-black" />;
}

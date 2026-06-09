import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { Layer } from "@/engine";
import { useEngine, useRevision, useSelection, useTime } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/ui/button";

interface Pt {
  x: number;
  y: number;
}

export function Viewport() {
  const engine = useEngine();
  useRevision();
  useTime(); // re-render overlay as animated transforms move
  const selection = useSelection();
  const comp = engine.comp;

  const containerRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [userZoom, setUserZoom] = useState<number | null>(null);

  // Measure the viewport area.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const margin = 32;
  const fit = Math.min((size.w - margin) / comp.width, (size.h - margin) / comp.height);
  const z = userZoom ?? Math.max(0.02, fit);
  const dispW = comp.width * z;
  const dispH = comp.height * z;
  const ox = (size.w - dispW) / 2;
  const oy = (size.h - dispH) / 2;

  // Mount the engine canvas once.
  useEffect(() => {
    const host = containerRef.current;
    const canvas = engine.canvas;
    if (!host || !canvas) return;
    canvas.style.position = "absolute";
    canvas.style.pointerEvents = "none";
    canvas.style.imageRendering = "auto";
    canvas.style.boxShadow = "0 0 0 1px #000, 0 8px 40px rgba(0,0,0,0.5)";
    host.appendChild(canvas);
    return () => {
      if (canvas.parentElement === host) host.removeChild(canvas);
    };
  }, [engine]);

  // Position/scale the canvas to the current zoom & offset.
  useEffect(() => {
    const canvas = engine.canvas;
    if (!canvas) return;
    canvas.style.left = `${ox}px`;
    canvas.style.top = `${oy}px`;
    canvas.style.width = `${dispW}px`;
    canvas.style.height = `${dispH}px`;
  }, [engine, ox, oy, dispW, dispH]);

  // Feed pointer/scroll/keys into the engine in composition space.
  useEffect(() => {
    const el = interactionRef.current;
    if (!el) return;
    engine.input.attach(el);
    return () => engine.input.detach();
  }, [engine]);

  const primary = engine.selectedLayers[0];

  const toComp = (clientX: number, clientY: number): Pt => {
    const r = interactionRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    const p = toComp(e.clientX, e.clientY);
    // Hit-test top → bottom.
    const hit = comp.layers.find((l) => l.enabled && !l.locked && pointInLayer(l, p, engine.transport.time));
    if (!hit) {
      engine.clearSelection();
      return;
    }
    engine.select([hit.id]);
    beginMove(engine, hit, e, z);
  };

  return (
    <div className="relative flex h-full flex-col bg-[#0e0e0e]">
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        style={{
          backgroundImage:
            "linear-gradient(45deg,#161616 25%,transparent 25%),linear-gradient(-45deg,#161616 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#161616 75%),linear-gradient(-45deg,transparent 75%,#161616 75%)",
          backgroundSize: "24px 24px",
          backgroundPosition: "0 0,0 12px,12px -12px,-12px 0",
        }}
      >
        {/* Interaction + overlay layer, exactly over the canvas box */}
        <div
          ref={interactionRef}
          className="absolute touch-none"
          style={{ left: ox, top: oy, width: dispW, height: dispH }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onBackgroundPointerDown(e);
          }}
        >
          {comp.guides.showSafeAreas && <SafeAreas />}
          {primary && selection.length === 1 && (
            <SelectionOverlay layer={primary} z={z} />
          )}
        </div>
      </div>

      {/* Zoom toolbar */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded border border-edge bg-panel/90 p-0.5">
        <Button size="icon-sm" variant="ghost" onClick={() => setUserZoom(Math.max(0.02, z / 1.2))}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-10 text-center text-[10px] tabular-nums text-ink-dim">{Math.round(z * 100)}%</span>
        <Button size="icon-sm" variant="ghost" onClick={() => setUserZoom(z * 1.2)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon-sm" variant="ghost" title="Fit" onClick={() => setUserZoom(null)}>
          <Maximize className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="absolute bottom-2 right-2 rounded border border-edge bg-panel/90 px-2 py-0.5 text-[10px] text-ink-dim">
        {comp.width}×{comp.height} · {comp.fps}fps
      </div>
    </div>
  );
}

function SafeAreas() {
  const engine = useEngine();
  const g = engine.comp.guides;
  const box = (inset: number) => ({
    left: `${inset * 100}%`,
    top: `${inset * 100}%`,
    right: `${inset * 100}%`,
    bottom: `${inset * 100}%`,
  });
  return (
    <>
      <div className="pointer-events-none absolute border border-accent/30" style={box(g.actionSafe)} />
      <div className="pointer-events-none absolute border border-accent/30" style={box(g.titleSafe)} />
    </>
  );
}

function SelectionOverlay({ layer, z }: { layer: Layer; z: number }) {
  const engine = useEngine();
  const t = engine.transport.time;
  const corners = layerCorners(layer, t).map((c) => ({ x: c.x * z, y: c.y * z }));
  const center = transformPoint(localMatrix(baseTransform(layer, t)), anchorOf(layer, t));
  const centerPx = { x: center.x * z, y: center.y * z };
  const topMid = mid(corners[0], corners[1]);
  const dir = norm(sub(topMid, centerPx));
  const rotateHandle = add(topMid, scale(dir, 26));

  const poly = corners.map((c) => `${c.x},${c.y}`).join(" ");

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <polygon points={poly} fill="none" stroke="var(--color-accent)" strokeWidth={1} opacity={0.9} />
      <line x1={topMid.x} y1={topMid.y} x2={rotateHandle.x} y2={rotateHandle.y} stroke="var(--color-accent)" strokeWidth={1} opacity={0.6} />
      {/* Rotate handle */}
      <circle
        cx={rotateHandle.x}
        cy={rotateHandle.y}
        r={5}
        className="pointer-events-auto cursor-grab"
        fill="var(--color-panel)"
        stroke="var(--color-accent)"
        onPointerDown={(e) => {
          e.stopPropagation();
          beginRotate(engine, layer, e, z);
        }}
      />
      {/* Scale corners */}
      {corners.map((c, i) => (
        <rect
          key={i}
          x={c.x - 4}
          y={c.y - 4}
          width={8}
          height={8}
          className="pointer-events-auto cursor-nwse-resize"
          fill="var(--color-panel)"
          stroke="var(--color-accent)"
          onPointerDown={(e) => {
            e.stopPropagation();
            beginScale(engine, layer, e, z);
          }}
        />
      ))}
    </svg>
  );
}

// ───────────────────── transform maths (mirrors the compositor) ─────────────────────

function baseTransform(layer: Layer, time: number) {
  const v = (k: "position" | "anchor" | "scale" | "rotation") => layer.transform(k).valueAt(time);
  return {
    position: v("position") as number[],
    anchor: v("anchor") as number[],
    scale: v("scale") as number[],
    rotation: v("rotation") as number,
  };
}

function anchorOf(layer: Layer, time: number): Pt {
  const a = layer.transform("anchor").valueAt(time) as number[];
  return { x: a[0] ?? 0, y: a[1] ?? 0 };
}

function localMatrix(t: ReturnType<typeof baseTransform>): DOMMatrix {
  const m = new DOMMatrix();
  m.translateSelf(t.position[0] ?? 0, t.position[1] ?? 0);
  m.rotateSelf(t.rotation ?? 0);
  m.scaleSelf((t.scale[0] ?? 100) / 100, (t.scale[1] ?? 100) / 100);
  m.translateSelf(-(t.anchor[0] ?? 0), -(t.anchor[1] ?? 0));
  return m;
}

function transformPoint(m: DOMMatrix, p: Pt): Pt {
  const r = m.transformPoint(new DOMPoint(p.x, p.y));
  return { x: r.x, y: r.y };
}

function layerCorners(layer: Layer, time: number): Pt[] {
  const [w, h] = layer.size;
  const m = localMatrix(baseTransform(layer, time));
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ].map((p) => transformPoint(m, p));
}

function pointInLayer(layer: Layer, p: Pt, time: number): boolean {
  const c = layerCorners(layer, time);
  return pointInQuad(p, c);
}

function pointInQuad(p: Pt, q: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const s = Math.sign(cross);
    if (s !== 0) {
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

// ───────────────────── drag gestures ─────────────────────

function dragLoop(onMove: (e: PointerEvent) => void) {
  const up = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
}

function beginMove(engine: ReturnType<typeof useEngine>, layer: Layer, e: React.PointerEvent, z: number) {
  const start = { x: e.clientX, y: e.clientY };
  const prop = layer.transform("position");
  const startVal = prop.valueAt(engine.transport.time) as number[];
  dragLoop((ev) => {
    const dx = (ev.clientX - start.x) / z;
    const dy = (ev.clientY - start.y) / z;
    engine.setPropertyValue(layer.id, prop.id, [startVal[0] + dx, startVal[1] + dy], true);
  });
}

function beginRotate(engine: ReturnType<typeof useEngine>, layer: Layer, e: React.PointerEvent, z: number) {
  const time = engine.transport.time;
  const prop = layer.transform("rotation");
  const startRot = prop.valueAt(time) as number;
  const center = transformPoint(localMatrix(baseTransform(layer, time)), anchorOf(layer, time));
  const rect = (e.currentTarget as Element).closest("svg")!.getBoundingClientRect();
  const angleOf = (cx: number, cy: number) =>
    (Math.atan2((cy - rect.top) / z - center.y, (cx - rect.left) / z - center.x) * 180) / Math.PI;
  const startAngle = angleOf(e.clientX, e.clientY);
  dragLoop((ev) => {
    engine.setPropertyValue(layer.id, prop.id, startRot + (angleOf(ev.clientX, ev.clientY) - startAngle), true);
  });
}

function beginScale(engine: ReturnType<typeof useEngine>, layer: Layer, e: React.PointerEvent, z: number) {
  const time = engine.transport.time;
  const prop = layer.transform("scale");
  const startScale = prop.valueAt(time) as number[];
  const center = transformPoint(localMatrix(baseTransform(layer, time)), anchorOf(layer, time));
  const rect = (e.currentTarget as Element).closest("svg")!.getBoundingClientRect();
  const distOf = (cx: number, cy: number) =>
    Math.hypot((cx - rect.left) / z - center.x, (cy - rect.top) / z - center.y) || 1;
  const startDist = distOf(e.clientX, e.clientY);
  dragLoop((ev) => {
    const f = distOf(ev.clientX, ev.clientY) / startDist;
    engine.setPropertyValue(layer.id, prop.id, [startScale[0] * f, startScale[1] * f], true);
  });
}

// vector helpers
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const norm = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};

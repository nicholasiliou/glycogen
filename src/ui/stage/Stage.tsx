import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { useLive } from "@/ui/app/LiveProvider";
import { useExportSettings } from "@/ui/export/ExportContext";
import { masksFor } from "@/runtime/export";
import { readPngText } from "@/runtime/export/exporters/pngMeta";
import { applyScene, parseScene, SCENE_PNG_READ_KEYWORDS } from "@/runtime/scene";
import { asset } from "@/lib/asset";

/**
 * The stage viewport. Mounts the runtime {@link Stage}'s canvas into a 16:9-masked host and overlays
 * the export framing guide  -  the chosen aspect-ratio crop, dimmed letterbox, and a live mask preview
 *  -  so the operator always sees exactly what an export will capture. Same look as before, now backed
 * by the plugin-stack runtime instead of the engine compositor.
 *
 * With export preview enabled the canvas renders at the true export resolution (ratio × quality
 * scale) and letterboxes into the host (`contain`), so framing AND pixel quality match the output;
 * otherwise it tracks the viewport 1:1 and cover-fits as before.
 */
export function Stage({ fadingOut = false, onFadeOutDone }: { fadingOut?: boolean; onFadeOutDone?: () => void } = {}) {
  const { stage } = useLive();
  const ex = useExportSettings();
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [fadeIn, setFadeIn] = useState(true);
  // Preview is always-on: render at the true export resolution so framing and pixel quality match.
  const outputSize = { width: ex.pixelWidth, height: ex.pixelHeight };
  const previewRef = useRef<{ width: number; height: number }>(outputSize);
  previewRef.current = outputSize;
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
      const bytes = new Uint8Array(buf);
      const json = SCENE_PNG_READ_KEYWORDS.reduce<string | null>((found, kw) => found ?? readPngText(bytes, kw), null);
      const scene = json ? parseScene(json) : null;
      if (scene) {
        applyScene(stage, scene);
        flashNote("Scene restored");
      } else {
        flashNote("No glycogen scene in this file");
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
    // Normally the canvas pixel size tracks the host 1:1, but during a video export the render
    // size is locked to the export resolution  -  cover keeps the live view undistorted meanwhile.
    canvas.style.objectFit = "cover";
    canvas.style.pointerEvents = "none";
    canvas.style.boxShadow = "0 0 80px rgba(0,0,0,0.6)";
    host.style.maskSize = "100% 100%";
    host.style.maskPosition = "0 0";
    host.style.maskRepeat = "no-repeat";
    host.appendChild(canvas);

    // Layout resizes (the drawer sliding, window drags) fire the observer continuously; the CSS
    // cover-fit above lets the old render scale smoothly meanwhile. The real pixel resize is
    // debounced until the size settles, then the previous frame crossfades out over the re-fitted
    // render instead of snapping.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = true;

    const applyResize = () => {
      // Render size is always pinned to the export output resolution  -  viewport resizes only
      // re-fit the CSS box, so skip the (expensive) pixel resize when the target is unchanged.
      const preview = previewRef.current;
      const w = preview.width;
      const h = preview.height;
      if (canvas.width === w && canvas.height === h) {
        first = false;
        return;
      }
      if (canvas.width > 0 && canvas.height > 0 && !first) {
        const snap = document.createElement("canvas");
        snap.width = canvas.width;
        snap.height = canvas.height;
        snap.getContext("2d")?.drawImage(canvas, 0, 0);
        Object.assign(snap.style, {
          position: "absolute",
          inset: "0",
          width: "100%",
          height: "100%",
          objectFit: canvas.style.objectFit || "cover",
          pointerEvents: "none",
          transition: "all 400ms ease-in-out"
        } satisfies Partial<CSSStyleDeclaration>);
        host.appendChild(snap);
        requestAnimationFrame(() => (snap.style.opacity = "0"));
        setTimeout(() => snap.remove(), 300);
      }
      first = false;
      stage.resize(w, h);
    };

    const resize = () => {
      setSize({ w: host.clientWidth, h: host.clientHeight });
      if (timer) clearTimeout(timer);
      if (first) applyResize();
      else timer = setTimeout(applyResize, 240); // just past the drawer's 220ms slide
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
      if (canvas.parentElement === host) host.removeChild(canvas);
    };
  }, [stage]);

  // Reacts to output resolution changes (quality/ratio edits): letterboxes the canvas to contain.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = stage.canvas;
    canvas.style.objectFit = "contain";
    const { width: w, height: h } = previewRef.current;
    if (canvas.width !== w || canvas.height !== h) stage.resize(w, h);
  }, [stage, ex.pixelWidth, ex.pixelHeight]);

  // Reactive host mask: follows the selected export ratio and maskEnabled toggle.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!ex.maskEnabled) {
      host.style.maskImage = "";
      return;
    }
    const variant = masksFor(ex.ratioId)[0];
    const url = variant ? (variant.url.endsWith(".svg") ? variant.url : `${variant.url}/1.svg`) : asset("/masks/16x9/1.svg");
    host.style.maskImage = `url(${url})`;
  }, [ex.ratioId, ex.maskEnabled]);

  // Export crop, computed over the full viewport (the canvas fills the host).
  const ratioWH = ex.pixelWidth / ex.pixelHeight;
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

  // Fade in from black on initial mount  -  one rAF tick so the black frame is actually painted first.
  useEffect(() => {
    const id = requestAnimationFrame(() => setFadeIn(false));
    return () => cancelAnimationFrame(id);
  }, []);

  const [maskOutlineUrl, setMaskOutlineUrl] = useState<string | undefined>();
  useEffect(() => {
    if (!maskUrl) { setMaskOutlineUrl(undefined); return; }
    let cancelled = false;
    fetch(maskUrl)
      .then((r) => r.text())
      .then((svg) => {
        if (cancelled) return;
        const stroked = svg
          .replace(/fill="white"/g, 'fill="none"')
          .replace(/<path /, '<path stroke="rgba(255,255,255,0.18)" stroke-width="4" ');
        setMaskOutlineUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(stroked)}`);
      })
      .catch(() => { if (!cancelled) setMaskOutlineUrl(undefined); });
    return () => { cancelled = true; };
  }, [maskUrl]);

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
      {maskOutlineUrl && (
        <img
          className="pointer-events-none absolute z-6"
          src={maskOutlineUrl}
          style={{
            left: cropX,
            top: cropY,
            width: cropW,
            height: cropH,
            display: "block",
          }}
          aria-hidden
        />
      )}
      <div
        className="pointer-events-none absolute inset-0 z-5 bg-black"
        style={{
          opacity: fadeIn || fadingOut ? 1 : 0,
          transition: fadeIn ? "none" : "opacity 380ms ease-in-out",
        }}
        onTransitionEnd={() => { if (fadingOut) onFadeOutDone?.(); }}
      />
    </div>
  );
}

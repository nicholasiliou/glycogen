// ── fader — presentation only (no slot / bus) ─────────────────────────────────────────────────
import * as React from "react";

/**
 * The raw skeuomorphic fader look (recessed slot + sliding cap), with no control-bus logic. Both
 * the slot-bound controller {@link Fader} and the Controls-tab parameter slider render this so the
 * two surfaces stay visually identical; each supplies its own drag/drive behaviour around it.
 *
 * `norm` is the cap position 0..1 (0 = min end, 1 = max end). `orient` picks vertical (controller)
 * or horizontal (settings list). `length` is the track's long axis in px.
 */
export function FaderVisual({
  norm,
  orient = "vertical",
  length = 160,
  trackRef,
  onPointerDown,
  onClick,
}: {
  norm: number;
  orient?: "vertical" | "horizontal";
  length?: number;
  trackRef?: React.Ref<HTMLDivElement>;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const CAP = 16;
  const THICK = 24;
  const vertical = orient === "vertical";
  // Vertical tracks are a fixed pixel length (pixel cap offset); horizontal tracks fill their
  // container (percentage cap offset) so they flow in the settings list at any width.
  const travel = length - 8 - CAP;
  const topOffset = 4 + (1 - norm) * travel;
  const leftPct = `calc(4px + ${norm} * (100% - ${8 + CAP}px))`;

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={`relative touch-none rounded ${vertical ? "cursor-ns-resize" : "cursor-ew-resize"}`}
      style={{ width: vertical ? THICK : "100%", height: vertical ? length : THICK }}
    >
      {/* recessed slot */}
      <div
        className={
          "absolute rounded-full " +
          (vertical ? "bottom-1 left-1/2 top-1 w-[5px] -translate-x-1/2" : "left-1 right-1 top-1/2 h-[5px] -translate-y-1/2")
        }
        style={{ background: "#18181c", boxShadow: "inset 0 0 4px rgba(0,0,0,.9)" }}
      />
      {/* cap */}
      <div
        className={"absolute rounded-sm " + (vertical ? "left-1/2 -translate-x-1/2" : "top-1/2 -translate-y-1/2")}
        style={{
          ...(vertical ? { top: topOffset } : { left: leftPct }),
          width: vertical ? 20 : CAP,
          height: vertical ? CAP : 20,
          background: "linear-gradient(#54575c, #2a2c2f 55%, #171819)",
          border: "1px solid #050505",
          boxShadow: "inset 0 1px 1px rgba(255,255,255,.22), 0 2px 3px rgba(0,0,0,.6)",
        }}
      >
        <div
          className={
            "absolute bg-black/60 " +
            (vertical ? "left-1 right-1 top-1/2 h-[1px] -translate-y-1/2" : "top-1 bottom-1 left-1/2 w-[1px] -translate-x-1/2")
          }
        />
      </div>
    </div>
  );
}

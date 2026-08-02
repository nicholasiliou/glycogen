import { useRef, useState, useCallback, useEffect } from "react";
import { Dices, Gamepad, GripVertical, Trash2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/ui/components/button";
import { ConfirmDialog } from "@/ui/components/confirm-dialog";
import { cn } from "@/ui/lib/cn";
import { isAdmin } from "@/db/appDefaults";
import { labelOf } from "@/plugins/registry";
import { useLive } from "@/ui/app/LiveProvider";
import { LayerIcon } from "@/ui/components/LayerIcon";
import { ExportPanel } from "@/ui/export/ExportPanel";

/** Per-plugin icon for the browse preview — kept local to avoid a cross-file dep. */
const ICONS: Record<string, string> = {
  shape: "Shapes", noise: "Waves", boids: "Bird", gameOfLife: "Grid3x3",
  physarum: "Waypoints", reactionDiffusion: "Droplets", landscape: "Mountain",
  harmonograph: "Spline", volumetricCloud: "Cloudy", text: "Type",
  contourField: "LayoutGrid", glyph: "Hash", glyphScatter: "LayoutDashboard",
  plant: "Sprout",
  none: "Ban", pixelate: "Aperture", bayer: "Grid2x2", ascii: "Hash",
deepGlow: "Crosshair", fisheye: "Aperture",
  pixelSort: "ArrowDownUp", pixelStretch: "MoveHorizontal",
  venetianBlinds: "AlignJustify", tracker: "Crosshair",
};

const ITEM_H = 32; // px height per row
const VISIBLE = 3; // rows shown (prev · active · next)
// How many extra items to render above and below so the strip never shows empty slots while dragging
const RENDER_EXTRA = 2;

/**
 * Vertical drag-wheel picker.
 *
 * Interaction model:
 * - Drag up/down: continuous pixel-level offset during the drag; commits steps on release.
 * - Scroll wheel: one step per tick.
 * - External index change (MIDI jog): animates a brief slide in the direction of the change.
 *
 * The strip renders VISIBLE + 2×RENDER_EXTRA rows centred on the active index so there's always
 * something to show while dragging, then clips to VISIBLE rows.
 */
function WheelPicker<T extends { id: string; label: string; kind?: string }>({
  items,
  index,
  onStep,
  jogPx = 0,
  width = 160,
}: {
  items: T[];
  index: number;
  onStep: (d: number) => void;
  /** Raw sub-step offset in px from an external source (jog wheel). Applied when not dragging. */
  jogPx?: number;
  width?: number;
}) {
  // Sub-row remainder in px during mouse drag.
  const [dragOffset, setDragOffset] = useState(0);
  const [snapping, setSnapping] = useState(false);

  const isDragging = useRef(false);
  const remainder = useRef(0);

  // ── Mouse drag ────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging.current = true;
    remainder.current = 0;
    setSnapping(false);
    setDragOffset(0);

    let lastY = e.clientY;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const delta = lastY - ev.clientY;
      lastY = ev.clientY;
      if (delta !== 0) moved = true;

      remainder.current += delta;
      const steps = Math.trunc(remainder.current / ITEM_H);
      if (steps !== 0) {
        remainder.current -= steps * ITEM_H;
        onStep(steps);
      }
      setDragOffset(remainder.current);
    };

    const onUp = () => {
      isDragging.current = false;
      // A click with no movement → step forward by 1.
      if (!moved) onStep(1);
      setSnapping(true);
      setDragOffset(0);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [onStep]);

  // Non-passive wheel handler so we can call preventDefault.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      onStep(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [onStep]);

  // Visual offset: drag takes priority; otherwise show live jog sub-step progress.
  const visualOffset = isDragging.current ? dragOffset : jogPx;

  const n = items.length;
  // Build the list of row offsets to render: -RENDER_EXTRA … +RENDER_EXTRA
  const offsets = Array.from({ length: VISIBLE + RENDER_EXTRA * 2 }, (_, i) => i - RENDER_EXTRA - 1);

  return (
    <div
      ref={rootRef}
      style={{ width, height: ITEM_H * VISIBLE, cursor: "ns-resize", userSelect: "none" }}
      className="relative overflow-hidden"
      onMouseDown={onMouseDown}
    >
      {/* Edge fades */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-linear-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-linear-to-t from-black/70 to-transparent" />

      {/* Active row bracket */}
      <div
        className="pointer-events-none absolute inset-x-0 z-10 border-t border-b border-edge/50"
        style={{ top: ITEM_H, height: ITEM_H }}
      />

      {/* Scrolling track */}
      <div
        style={{
          transform: `translateY(${-RENDER_EXTRA * ITEM_H - visualOffset}px)`,
          transition: snapping ? "transform 180ms cubic-bezier(0.25,0,0,1)" : "none",
          willChange: "transform",
        }}
      >
        {offsets.map((offset) => {
          const itemIdx = ((index + offset) % n + n) % n;
          const item = items[itemIdx];
          const isActive = offset === 0;
          const icon = ICONS[item.id] ?? (item.kind === "effect" ? "Layers" : "Shapes");
          return (
            <div
              key={`${offset}:${itemIdx}`}
              style={{ height: ITEM_H }}
              className={cn(
                "flex items-center gap-2 px-2",
                isActive ? "opacity-100" : "opacity-20",
              )}
            >
              <LayerIcon name={icon} className="h-4 w-4 shrink-0" />
              {isActive && (
                <span className="truncate text-xs leading-tight text-ink">{item.label}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A 1×1 transparent PNG used to hide the browser's default drag ghost for the bank pills. */
const EMPTY_DRAG_IMAGE =
  typeof Image !== "undefined"
    ? Object.assign(new Image(), {
        src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      })
    : (undefined as unknown as HTMLImageElement);

/**
 * Pick black or white text for a `#rrggbb` fill via WCAG relative luminance — keeps the plugin
 * name legible inside the active pill whatever color the layer wears.
 */
function contrastInk(hex: string): "#000" | "#fff" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? "#000" : "#fff";
}

interface BankDragState {
  dragFrom: number | null;
  setDragFrom: (i: number | null) => void;
  overTrash: boolean;
  setOverTrash: (b: boolean) => void;
}

/** Trash drop target — rendered in the right action area, receives drag state from HeaderBar. */
function TrashTarget({ drag }: { drag: BankDragState }) {
  const { banks, clearBank } = useLive();
  const { dragFrom, setDragFrom, overTrash, setOverTrash } = drag;
  return (
    <button
      type="button"
      onDragOver={(e) => {
        if (dragFrom === null || !banks[dragFrom].plugin) return;
        e.preventDefault();
        setOverTrash(true);
      }}
      onDragLeave={() => setOverTrash(false)}
      onDrop={(e) => {
        e.preventDefault();
        if (dragFrom !== null && banks[dragFrom].plugin) clearBank(dragFrom);
        setDragFrom(null);
        setOverTrash(false);
      }}
      title="Drag a bank here to remove its plugin"
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded transition-opacity duration-300 ease-out",
        dragFrom !== null && banks[dragFrom].plugin ? "opacity-100" : "pointer-events-none opacity-0",
        overTrash ? "bg-red-500/20 text-red-400 ring-1 ring-red-400/60" : "text-ink-dim",
      )}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

/**
 * The unified bank strip: one pill per bank — load, activate, or remove the browsed plugin. The
 * active bank swells into a labelled pill (name + drag handle); the rest stay compact dots. Drag a
 * pill over another to reorder (with a live preview of the resulting order) or onto the trash to
 * empty it.
 */
function BankStrip({ drag }: { drag: BankDragState }) {
  const { banks, activeBank, selectBank, moveBank, load, clearBank } = useLive();
  const [removing, setRemoving] = useState<number | null>(null);
  const { dragFrom, setDragFrom, setOverTrash } = drag;
  const [dragOver, setDragOver] = useState<number | null>(null);
  // The pills row is the single drop zone: every pill carries a data-index so a pointer anywhere in
  // the strip (pills, carets, gaps) resolves to an insertion slot — no more releases landing on a
  // gap with no handler and silently doing nothing.
  const rowRef = useRef<HTMLDivElement>(null);

  /** Insertion slot (0..N) for a pointer X: which side of the nearest pill's midpoint it's on. */
  const slotAt = (clientX: number): number => {
    const pills = rowRef.current?.querySelectorAll<HTMLElement>("[data-bank]");
    if (!pills?.length) return 0;
    for (let k = 0; k < pills.length; k++) {
      const r = pills[k].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return k;
    }
    return pills.length;
  };

  const onBankClick = (i: number) => {
    if (!banks[i].plugin) return load(i);
    if (i === activeBank) setRemoving(i);
    else selectBank(i);
  };

  // `dragOver` holds the target *insertion slot* (0..N, the gap the caret sits in). `moveBank`'s
  // `to` is a post-removal index, so a slot past the source shifts left by one. Dropping into the
  // source's own two adjacent slots is a no-op.
  const dropTo =
    dragFrom !== null && dragOver !== null && dragOver !== dragFrom && dragOver !== dragFrom + 1
      ? dragOver > dragFrom
        ? dragOver - 1
        : dragOver
      : null;

  const removingLayer = removing !== null ? banks[removing].plugin : null;
  const removingName = removingLayer ? labelOf(removingLayer.id) : "";

  // The drop position is shown as a fixed-width caret *between* pills — nothing resizes during the
  // drag, so the geometry under the cursor never shifts (which is what caused the rapid layout
  // oscillation). The caret sits in `dragOver`'s slot whenever the drop would actually move.
  const caretAt = dropTo !== null ? dragOver : null;

  const Caret = ({ at }: { at: number }) => (
    <div
      aria-hidden
      className={cn(
        "h-5 w-0.5 shrink-0 rounded-full bg-ink transition-opacity duration-150",
        caretAt === at ? "opacity-80" : "opacity-0",
      )}
    />
  );

  return (
    <div className="flex min-w-0 items-center">
      {/* The whole row is the drop zone, so a release anywhere in it resolves to a slot. */}
      <div
        ref={rowRef}
        className="flex items-center gap-0.5"
        onDragOver={(e) => {
          if (dragFrom === null) return;
          e.preventDefault();
          setOverTrash(false);
          setDragOver(slotAt(e.clientX));
        }}
        onDrop={(e) => {
          e.preventDefault();
          const to =
            dragFrom !== null
              ? (() => {
                  const s = slotAt(e.clientX);
                  return s !== dragFrom && s !== dragFrom + 1 ? (s > dragFrom ? s - 1 : s) : null;
                })()
              : null;
          if (dragFrom !== null && to !== null) moveBank(dragFrom, to);
          setDragFrom(null);
          setDragOver(null);
        }}
      >
        <Caret at={0} />
        {banks.map((bank, i) => {
          const active = i === activeBank;
          const color = bank.plugin?.displayColor();
          const dragging = dragFrom === i;
          return (
            <div key={i} className="flex items-center gap-0.5">
              <button
                type="button"
                data-bank={i}
                onClick={() => onBankClick(i)}
                // Pills drag to reorder the row (bank order is composite order).
                draggable
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = "move";
                  // Suppress the native drag ghost (its opaque box shows black edges); the dimmed
                  // source pill + the caret already communicate the drag.
                  e.dataTransfer.setDragImage(EMPTY_DRAG_IMAGE, 0, 0);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                  setOverTrash(false);
                }}
                title={`Bank ${i + 1}${bank.plugin ? (active ? " · active (click to remove)" : " · loaded (click to activate)") : " · empty (click to load)"} · drag to reorder or onto the trash to remove`}
                // Loaded banks wear their layer's color (the tint, else the plugin's native color).
                style={color ? { backgroundColor: color, color: contrastInk(color) } : undefined}
                className={cn(
                  "flex h-6 cursor-pointer items-center overflow-hidden rounded-full transition-opacity",
                  active && bank.plugin ? "gap-0.5 px-2 text-[0.6875rem] font-medium" : "h-3 w-3 justify-center",
                  !bank.plugin && "bg-edge",
                  dragging && "opacity-30",
                )}
              >
                {active && bank.plugin && (
                  <>
                    <GripVertical className="-ml-0.5 h-3 w-3 shrink-0 opacity-60" />
                    <span className="max-w-30 truncate">{labelOf(bank.plugin.id)}</span>
                  </>
                )}
              </button>
              <Caret at={i + 1} />
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove plugin"
        description={
          <>
            Remove <span className="text-ink font-medium">{removingName}</span> from bank{" "}
            {(removing ?? 0) + 1}? This bank will be emptied.
          </>
        }
        confirmLabel="Remove"
        confirmVariant="danger"
        onConfirm={() => {
          if (removing !== null) clearBank(removing);
        }}
      />
    </div>
  );
}

export function HeaderBar({
  controllerOpen,
  onControllerToggle,
  stageRect,
}: {
  controllerOpen: boolean;
  onControllerToggle: () => void;
  stageRect: { left: number; width: number } | null;
}) {
  const {
    generators,
    effects,
    selectedPluginIndex,
    selectedShaderIndex,
    stepPlugin,
    stepShader,
    jogPluginPx,
    jogShaderPx,
    muted,
    toggleMute,
    lastMidi,
  } = useLive();

  // Drag state lives here so TrashTarget (right side) and BankStrip (center) share it.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overTrash, setOverTrash] = useState(false);
  const drag: BankDragState = { dragFrom, setDragFrom, overTrash, setOverTrash };

  return (
    <div className="relative flex h-14 shrink-0 items-center overflow-hidden px-4 text-ink">
      {/* Center: plugin wheel · banks · shader wheel — pinned over the live canvas column. */}
      <div
        className="pointer-events-none absolute inset-y-0 flex items-center justify-center"
        style={stageRect ? { left: stageRect.left, width: stageRect.width } : { left: 0, right: 0 }}
      >
        <div className="pointer-events-auto flex items-center gap-2">
          <WheelPicker items={generators} index={selectedPluginIndex} onStep={stepPlugin} jogPx={jogPluginPx} width={148} />
          <div className="mx-1 h-6 w-px shrink-0 self-center bg-edge/40" />
          <BankStrip drag={drag} />
          <div className="mx-1 h-6 w-px shrink-0 self-center bg-edge/40" />
          <WheelPicker items={effects} index={selectedShaderIndex} onStep={stepShader} jogPx={jogShaderPx} width={120} />
        </div>
      </div>

      {/* Raw routing readout — dev hint, admin only */}
      {isAdmin() && lastMidi && (
        <span className="shrink-0 truncate text-[0.6875rem] text-ink-dim" title="Last MIDI action">
          {lastMidi.control} → {lastMidi.target}
        </span>
      )}

      {/* Right actions: trash (drag target) · export · controller · mute · shuffle */}
      <div className="ml-auto flex items-center gap-3">
        <TrashTarget drag={drag} />
        <ExportPanel />
        <Button
          size="icon-sm"
          variant={controllerOpen ? "default" : "ghost"}
          onClick={onControllerToggle}
          title={controllerOpen ? "Close controller" : "Open controller"}
        >
          <Gamepad className="h-4 w-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={toggleMute}
          title={muted ? "Unmute" : "Mute"}
          className={cn(muted && "text-red-400/70")}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </Button>
        <Button size="icon-sm" variant="ghost" title="Shuffle scene" onClick={() => window.location.reload()}>
          <Dices className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

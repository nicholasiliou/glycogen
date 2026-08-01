import { useRef, useState } from "react";
import { Dices, Gamepad, GripVertical, Trash2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/ui/components/button";
import { ConfirmDialog } from "@/ui/components/confirm-dialog";
import { cn } from "@/ui/lib/cn";
import { isAdmin } from "@/db/appDefaults";
import { labelOf } from "@/plugins/registry";
import { useLive } from "@/ui/app/LiveProvider";
import { PluginPreview } from "@/ui/stage/PluginPreview";
import { ExportPanel } from "@/ui/export/ExportPanel";

/** The little dial showing the browse position. Click to step forward, wheel to scrub either way. */
function MiniDial({ index, count, onStep }: { index: number; count: number; onStep: (d: number) => void }) {
  // rem-sized so it scales with the viewport-driven root font-size like the rest of the chrome.
  const S = "2.125rem"; // 34px at the 16px baseline
  const c = "50%";
  const r = "38%"; // ~13/34 of the viewbox
  const vb = 34; // internal coordinate space for the pointer line math
  const a = (-90 + (index * 360) / Math.max(1, count)) * (Math.PI / 180);
  return (
    <button
      type="button"
      onClick={() => onStep(1)}
      onWheel={(e) => onStep(e.deltaY > 0 ? 1 : -1)}
      title="Click to cycle · scroll to scrub"
      className="shrink-0 cursor-pointer rounded-full transition-colors hover:bg-ink/5"
    >
      <svg width={S} height={S} viewBox={`0 0 ${vb} ${vb}`} className="block">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-edge)" strokeWidth={1} />
        <line
          x1={vb / 2}
          y1={vb / 2}
          x2={vb / 2 + Math.cos(a) * (vb / 2 - 4)}
          y2={vb / 2 + Math.sin(a) * (vb / 2 - 4)}
          stroke="var(--color-ink)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
    </button>
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

/**
 * The unified bank strip: one pill per bank — load, activate, or remove the browsed plugin. The
 * active bank swells into a labelled pill (name + drag handle); the rest stay compact dots. Drag a
 * pill over another to reorder (with a live preview of the resulting order) or onto the trash to
 * empty it.
 */
function BankStrip() {
  const { banks, activeBank, selectBank, moveBank, load, clearBank } = useLive();
  const [removing, setRemoving] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [overTrash, setOverTrash] = useState(false);
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
    <div className="flex min-w-0 items-center gap-1.5">
      {/* Trash target: drag a bank here to empty it. Only interactive mid-drag. */}
      <button
        type="button"
        onDragOver={(e) => {
          if (dragFrom === null || !banks[dragFrom].plugin) return;
          e.preventDefault();
          setDragOver(null);
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
}: {
  controllerOpen: boolean;
  onControllerToggle: () => void;
}) {
  const {
    generators,
    effects,
    selectedPlugin,
    selectedPluginIndex,
    selectedShader,
    selectedShaderIndex,
    stepPlugin,
    stepShader,
    banks,
    activeBank,
    focusPart,
    setFocusPart,
    muted,
    toggleMute,
    clearShader,
    lastMidi,
  } = useLive();

  const shaderLoaded = !!banks[activeBank]?.shader;
  // Clicking a preview focuses that half of the active bank (which one the controls drive).
  const focusRing = (part: "plugin" | "shader") =>
    focusPart === part ? "rounded opacity-100" : "rounded opacity-40 hover:opacity-60";

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 px-8 text-ink">
      {/* Plugins and shaders browse side by side — one dial each, no mode switch. */}
      <div className="flex items-center gap-1.5" title="Browse plugins · click the preview to focus the plugin">
        <MiniDial index={selectedPluginIndex} count={generators.length} onStep={stepPlugin} />
        <button type="button" onClick={() => setFocusPart("plugin")} className={focusRing("plugin")}>
          <PluginPreview info={selectedPlugin} className="w-44" />
        </button>
      </div>
      <div className="flex items-center gap-1.5" title="Browse shaders (applies to the active bank) · click the preview to focus the shader">
        <MiniDial index={selectedShaderIndex} count={effects.length} onStep={stepShader} />
        <button type="button" onClick={() => setFocusPart("shader")} className={focusRing("shader")}>
          <PluginPreview info={selectedShader} className="w-32" />
        </button>
      </div>

      <div className="flex-1" />

      {/* Raw routing readout (e.g. "CC 25 → jog:0") — a dev hint, only on the #admin surface. */}
      {isAdmin() && lastMidi && (
        <span className="min-w-0 truncate text-[0.6875rem] text-ink-dim" title="Last MIDI action">
          {lastMidi.control} → {lastMidi.target}
        </span>
      )}

      <div className="flex-1" />

      <BankStrip />

      {/* Divider: plugin-scoped controls (banks · trash) on the left, global actions on the right. */}
      <div className="mx-1 h-6 w-px shrink-0 self-center bg-edge" />

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
  );
}

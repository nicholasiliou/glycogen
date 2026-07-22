import { useState } from "react";
import { Gamepad, RotateCw, Volume2, VolumeX } from "lucide-react";
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

/** The unified bank strip: one dot per bank — load, activate, or remove the browsed plugin. */
function BankStrip() {
  const { banks, activeBank, selectBank, moveBank, load, clearBank } = useLive();
  const layer = banks[activeBank]?.plugin;
  const name = layer ? labelOf(layer.id) : "";
  const [removing, setRemoving] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const onBankClick = (i: number) => {
    if (!banks[i].plugin) return load(i);
    if (i === activeBank) setRemoving(i);
    else selectBank(i);
  };

  const removingLayer = removing !== null ? banks[removing].plugin : null;
  const removingName = removingLayer ? labelOf(removingLayer.id) : "";

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="max-w-30 truncate text-[0.6875rem] text-ink" title="Active bank">{name}</span>
      <div className="flex items-center gap-1">
        {banks.map((bank, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onBankClick(i)}
            // Dots drag to reorder the row (bank order is composite order).
            draggable
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (dragFrom !== null) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null && dragFrom !== i) moveBank(dragFrom, i);
              setDragFrom(null);
            }}
            onDragEnd={() => setDragFrom(null)}
            title={`Bank ${i + 1}${bank.plugin ? (i === activeBank ? " · active (click to remove)" : " · loaded (click to activate)") : " · empty (click to load)"} · drag to reorder`}
            // Loaded banks wear their layer's color (the tint, else the plugin's native color).
            style={bank.plugin ? { backgroundColor: bank.plugin.displayColor() } : undefined}
            className={cn(
              "h-3 w-3 cursor-pointer rounded-full transition-colors",
              bank.plugin ? (i === activeBank ? "" : "opacity-50") : "bg-edge",
              dragFrom === i && "ring-1 ring-ink/60",
            )}
          />
        ))}
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
      <Button size="icon-sm" variant="ghost" title="Refresh page" onClick={() => window.location.reload()}>
        <RotateCw className="h-4 w-4" />
      </Button>
    </div>
  );
}

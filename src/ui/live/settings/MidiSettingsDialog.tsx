import { useEffect, useRef, useState } from "react";
import {
  Circle,
  Crosshair,
  Disc3,
  Download,
  Plus,
  RotateCcw,
  RotateCw,
  Square,
  SlidersVertical,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Separator } from "@/ui/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/components/ui/select";
import { cn } from "@/ui/lib/cn";
import type { ControlKind } from "@/midi/types";
import {
  CONTROL_KINDS,
  KIND_META,
  PERFORMANCE_ROLES,
  type EffectiveControl,
  type PerformanceRole,
} from "@/midi/preset";
import { useLive } from "../LiveProvider";

const KIND_ICON: Record<ControlKind, LucideIcon> = {
  fader: SlidersVertical,
  knob: Circle,
  encoder: RotateCw,
  jog: Disc3,
  button: Square,
};

/** ~30fps tick so live meters animate + the "just moved" flash decays while the dialog is open. */
function useRaf(active: boolean): void {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last > 33) {
        last = now;
        setT((x) => (x + 1) % 1_000_000);
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}

export function MidiSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  useRaf(open);
  const live = useLive();
  const { midi, presets, activePreset, controls } = live;

  const status = midi.status;
  const devices = midi.devices();

  // controlId -> performance role, for the badge on each row.
  const roleByControl = new Map<string, PerformanceRole>();
  if (activePreset) {
    for (const { role } of PERFORMANCE_ROLES) {
      const id = activePreset.roles[role];
      if (id) roleByControl.set(id, role);
    }
  }

  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const json = live.exportActive();
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(activePreset?.name ?? "midi-preset").replace(/[^\w.-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File) => {
    const text = await file.text();
    if (!live.importPresetJson(text)) window.alert("That file isn't a valid MIDI preset.");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>MIDI Settings</DialogTitle>
          <DialogDescription>
            Name each control and correct its input type, then save it as a reusable preset. Retyping a
            control changes how it's read (e.g. encoder vs. potentiometer), not just its label.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 overflow-y-auto p-4 text-xs">
          {/* preset bar */}
          <section className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-ink-dim">Preset</span>
            <Select value={activePreset?.id ?? ""} onValueChange={(id) => live.selectPreset(id)}>
              <SelectTrigger className="h-7 w-52">
                <SelectValue placeholder="No preset" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              key={activePreset?.id}
              className="h-7 w-44"
              defaultValue={activePreset?.name ?? ""}
              placeholder="Preset name"
              onBlur={(e) => activePreset && live.renamePreset(activePreset.id, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => live.createNewPreset()} title="New preset">
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
            <Button size="sm" variant="ghost" onClick={() => live.duplicateActive()} title="Duplicate preset">
              Duplicate
            </Button>
            <Button size="sm" variant="ghost" onClick={doExport} title="Export preset as JSON">
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} title="Import preset JSON">
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => activePreset && live.deletePreset(activePreset.id)}
              title="Delete preset"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])}
            />
          </section>

          {/* device */}
          <section className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-wide text-ink-dim">Device</span>
            {status === "unsupported" ? (
              <span className="text-amber-400">Web MIDI unavailable — open in Chrome or Edge.</span>
            ) : status === "denied" ? (
              <Button size="sm" variant="ghost" onClick={() => midi.enable()}>
                Access denied — retry
              </Button>
            ) : devices.length === 0 ? (
              <span className="text-ink-dim">No device — connect one and touch a control.</span>
            ) : (
              devices.map((d) => (
                <span key={d.id} className="flex items-center gap-1.5 text-ink">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {d.name}
                </span>
              ))
            )}
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => live.forgetDevice()} title="Forget learned controls">
              <RotateCcw className="h-3.5 w-3.5" /> Reset learned
            </Button>
          </section>

          <Separator />

          {/* performance roles */}
          <RolesSection />

          <Separator />

          {/* controls table */}
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-[10px] uppercase tracking-wide text-ink-dim">Controls</h3>
              <span className="text-[10px] text-ink-dim">{controls.length} learned · move one to identify it</span>
            </div>
            {controls.length === 0 ? (
              <p className="py-6 text-center text-ink-dim">Twist a knob or press a pad on your controller…</p>
            ) : (
              <div className="space-y-1">
                {controls.map((c) => (
                  <ControlRow key={c.id} ctl={c} role={roleByControl.get(c.id)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ControlRow({ ctl, role }: { ctl: EffectiveControl; role?: PerformanceRole }) {
  const { renameControl, setControlKind, resetControl } = useLive();
  const active = !!ctl.live && performance.now() - ctl.live.lastSeen < 450;
  const fill = ctl.live ? (ctl.live.pressed ? 1 : ctl.live.value) : 0;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded border px-2 py-1 transition-colors",
        active ? "border-accent/60 bg-accent/5" : "border-transparent",
        !ctl.live && "opacity-60",
      )}
    >
      {/* activity meter */}
      <div className="relative h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-edge" title={ctl.continuous ? "value" : "pressed"}>
        <div className="absolute inset-y-0 left-0 bg-accent/70" style={{ width: `${fill * 100}%` }} />
      </div>

      {/* name */}
      <Input
        key={ctl.id}
        className="h-6 flex-1"
        defaultValue={ctl.name}
        onBlur={(e) => renameControl(ctl.id, e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />

      {/* kind */}
      <Select value={ctl.kind} onValueChange={(k) => setControlKind(ctl.id, k as ControlKind)}>
        <SelectTrigger className="h-6 w-40">
          <KindLabel kind={ctl.kind} />
        </SelectTrigger>
        <SelectContent>
          {CONTROL_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              <KindLabel kind={k} withHint />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {role && (
        <span className="shrink-0 rounded bg-accent/20 px-1 text-[9px] uppercase text-accent">{role}</span>
      )}
      <span className="w-16 shrink-0 truncate text-right font-mono text-[10px] text-ink-dim" title={ctl.id}>
        {ctl.id}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={!ctl.known}
        onClick={() => resetControl(ctl.id)}
        title="Reset name + type to auto-detected"
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
    </div>
  );
}

function KindLabel({ kind, withHint }: { kind: ControlKind; withHint?: boolean }) {
  const Icon = KIND_ICON[kind];
  const meta = KIND_META[kind];
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-ink-dim" />
      <span>{meta.label}</span>
      {withHint && <span className="text-[10px] text-ink-dim">· {meta.hint}</span>}
    </span>
  );
}

/** Assign the reserved performance controls (jog → sundial, add / remove). Stored in the preset. */
function RolesSection() {
  const { activePreset, learning, setLearning, setRole, controls } = useLive();
  const nameOf = new Map(controls.map((c) => [c.id, c.name] as const));

  return (
    <section>
      <h3 className="mb-2 text-[10px] uppercase tracking-wide text-ink-dim">Performance controls</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        {PERFORMANCE_ROLES.map(({ role, label, hint, continuous }) => {
          const id = activePreset?.roles[role];
          const assigned = id ? nameOf.get(id) ?? id : null;
          const isLearning = learning === role;
          return (
            <div key={role} className="rounded border border-edge bg-panel-raised p-2">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-ink">{label}</span>
                {assigned && (
                  <button
                    type="button"
                    className="text-ink-dim hover:text-red-400"
                    title="Clear"
                    onClick={() => setRole(role, null)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="mb-1.5 truncate text-[10px] text-ink-dim">{assigned ?? hint}</div>
              <Button
                size="sm"
                variant={isLearning ? "accent" : "outline"}
                className="w-full"
                onClick={() => setLearning(isLearning ? null : role)}
              >
                <Crosshair className="h-3.5 w-3.5" />
                {isLearning ? (continuous ? "move a control…" : "press a control…") : "Learn"}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

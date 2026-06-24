import { useRef } from "react";
import { Download, ExternalLink, Plus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { REMOTE_HASH } from "../liveChannel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";
import { Controller } from "../controller/Controller";
import { useLive } from "../LiveProvider";

export function MidiSettingsDialog({ onClose }: { onClose: () => void }) {
  const live = useLive();
  const { midi, presets, activePreset, controls } = live;

  const status = midi.status;
  const devices = midi.devices();
  const fileRef = useRef<HTMLInputElement>(null);
  const bound = controls.filter((c) => c.assignment !== "none" && !c.disabled).length;

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

  // Pop the on-screen DJ surface out into its own window (drives this session over BroadcastChannel).
  const openControllerWindow = () => {
    const url = `${window.location.origin}${window.location.pathname}${REMOTE_HASH}`;
    window.open(url, "marathon-controller", "width=1100,height=680");
  };

  return (
    <div className="flex h-full flex-col bg-black">
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-3 text-xs">
        <span className="text-[10px] uppercase tracking-wide text-ink-dim">Preset</span>
        <Select value={activePreset?.id ?? ""} onValueChange={(id) => live.selectPreset(id)}>
          <SelectTrigger className="h-7 w-44">
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
          className="h-7 w-36"
          defaultValue={activePreset?.name ?? ""}
          placeholder="Preset name"
          onBlur={(e) => activePreset && live.renamePreset(activePreset.id, e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <Button size="sm" variant="ghost" onClick={() => live.createNewPreset()} title="New preset">
          <Plus className="h-3.5 w-3.5" /> New
        </Button>
        <Button size="sm" variant="ghost" onClick={() => live.duplicateActive()} title="Duplicate preset">
          Duplicate
        </Button>
        <Button size="sm" variant="ghost" onClick={doExport} title="Export preset as JSON">
          <Download className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} title="Import preset JSON">
          <Upload className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={openControllerWindow}
          title="Open the digital controller in a separate window (no MIDI hardware needed)"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Window
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

        <div className="flex-1" />

        {/* device info */}
        <span className="text-[10px] uppercase tracking-wide text-ink-dim">Device</span>
        {status === "unsupported" ? (
          <span className="text-amber-400">Web MIDI unavailable</span>
        ) : status === "denied" ? (
          <Button size="sm" variant="ghost" onClick={() => midi.enable()}>
            Access denied — retry
          </Button>
        ) : devices.length === 0 ? (
          <span className="text-ink-dim">No device connected</span>
        ) : (
          devices.map((d) => (
            <span key={d.id} className="flex items-center gap-1.5 text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {d.name}
            </span>
          ))
        )}
        <span className="text-ink-dim">· {bound} bound</span>

        <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close controller">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* controller surface */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-8">
        <Controller />
        {devices.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 backdrop-blur-xs">
            <div className="flex flex-col items-center gap-4">
              <div className="max-w-xs bg-black/80 p-6 text-center">
                <p className="mb-4 text-sm text-ink-dim">No MIDI controller connected</p>
                <p className="mb-6 text-xs text-ink-dim/70">Either connect a hardware controller or use the digital controller</p>
                <Button size="sm" onClick={openControllerWindow}>
                  Open Digital Controller
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

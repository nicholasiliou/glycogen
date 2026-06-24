import { useRef } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";
import { Controller } from "../controller/Controller";
import type { ControllerMode } from "../controller/widgets";
import { useLive } from "../LiveProvider";

export function MidiSettingsDialog({
  mode,
}: {
  mode: ControllerMode;
}) {
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

  return (
    <div className="flex h-full flex-col bg-black">
      {/* controller area */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <Controller mode={mode} />
      </div>
    </div>
  );
}

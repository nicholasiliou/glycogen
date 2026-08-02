import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Image as ImageIcon, Link, Link2Off, Video, X } from "lucide-react";
import { Exporter, isPrintRatio, masksFor, PRINT_RATIO_LIST, SCREEN_RATIO_LIST, supportedVideoFormats } from "@/runtime/export";
import { useLive } from "@/ui/app/LiveProvider";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/components/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/components/select";
import { useExportSettings } from "@/ui/export/ExportContext";
import type { AspectRatioId } from "@/runtime/export";

const MIN_PX = 480;

/** Controlled number input that shows a live-typed value and commits on blur/Enter. */
function PxInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const n = parseInt(raw, 10);
    if (!isNaN(n)) onChange(Math.max(MIN_PX, n));
    setDraft(null);
  };

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] uppercase tracking-wide text-ink-dim/50">{label}</span>
      <input
        ref={ref}
        type="number"
        min={MIN_PX}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onFocus={() => setDraft(String(value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit((e.target as HTMLInputElement).value); ref.current?.blur(); }
          if (e.key === "Escape") { setDraft(null); ref.current?.blur(); }
        }}
        className="w-16 rounded border border-edge bg-transparent px-1 py-0.5 text-center font-mono text-[11px] outline-none focus:border-accent/60"
      />
    </div>
  );
}

export function ExportPanel() {
  const { stage } = useLive();
  const exporter = useMemo(() => new Exporter(stage), [stage]);
  const ex = useExportSettings();

  const [videoSec, setVideoSec] = useState(10);
  const [busy, setBusy] = useState<null | "still" | "video">(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const variants = masksFor(ex.ratioId);
  const videoFormats = useMemo(() => supportedVideoFormats(), []);
  const print = isPrintRatio(ex.ratioId);

  useEffect(() => {
    stage.watermark = ex.watermarkEnabled;
    stage.exportRatio = ex.pixelWidth / ex.pixelHeight;
  }, [stage, ex.watermarkEnabled, ex.pixelWidth, ex.pixelHeight]);

  const run = async (kind: "still" | "video") => {
    if (busy || (kind === "video" && print)) return;
    setError(null);
    setBusy(kind);
    setProgress(0);
    try {
      if (kind === "still") await exporter.still(ex.settings());
      else await exporter.video(ex.settings(videoSec), { onProgress: (p) => setProgress(p.fraction) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" title="Export">
          <Download className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 text-[11px] text-ink">

        {/* ── ratio preset ──────────────────────────────────────────────────── */}
        <Select
          value={ex.ratioId}
          onValueChange={(v) => ex.setRatioId(v as AspectRatioId)}
        >
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ex.ratioId === "custom" && <SelectItem value="custom">Custom</SelectItem>}
            {SCREEN_RATIO_LIST.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
            {PRINT_RATIO_LIST.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* ── W × H + link + fps ────────────────────────────────────────────── */}
        <div className="flex items-end gap-1.5">
          <PxInput value={ex.pixelWidth} onChange={ex.setPixelWidth} label="W" />

          {/* link toggle */}
          <button
            onClick={() => ex.setLinked(!ex.linked)}
            title={ex.linked ? "Unlink aspect ratio" : "Link aspect ratio"}
            className={
              "mb-0.5 rounded p-0.5 transition-colors " +
              (ex.linked ? "text-ink hover:text-ink-dim" : "text-ink-dim/40 hover:text-ink-dim")
            }
          >
            {ex.linked
              ? <Link className="h-3.5 w-3.5" />
              : <Link2Off className="h-3.5 w-3.5" />
            }
          </button>

          <PxInput value={ex.pixelHeight} onChange={ex.setPixelHeight} label="H" />

          <div className="flex flex-col items-center gap-0.5 ml-1">
            <span className="text-[9px] uppercase tracking-wide text-ink-dim/50">FPS</span>
            <input
              type="number"
              min={1}
              max={120}
              value={ex.fps}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!isNaN(n)) ex.setFps(n);
              }}
              className="w-12 rounded border border-edge bg-transparent px-1 py-0.5 text-center font-mono text-[11px] outline-none focus:border-accent/60"
            />
          </div>
        </div>

        {/* ── actions ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 border-t border-edge/40 pt-2">
          <Button size="sm" variant="outline" className="flex-1 gap-1" disabled={!!busy} onClick={() => void run("still")}>
            <ImageIcon className="h-3.5 w-3.5" /> Still
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1"
            disabled={!!busy || print}
            title={print ? "Poster sizes export as stills" : undefined}
            onClick={() => void run("video")}
          >
            <Video className="h-3.5 w-3.5" /> Video
          </Button>
        </div>

        {busy === "video" && (
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-edge">
              <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <button
              onClick={() => exporter.cancel()}
              title="Cancel export"
              className="text-ink-dim/60 hover:text-ink transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {busy === "still" && <div className="text-ink-dim/60">Rendering…</div>}
        {error && <div className="text-red-400">{error}</div>}

        {/* ── advanced ──────────────────────────────────────────────────────── */}
        <div className="border-t border-edge/40 pt-1">
          <button
            onClick={() => setAdvancedOpen((o) => !o)}
            className="flex w-full items-center gap-1 text-[10px] text-ink-dim/60 hover:text-ink-dim transition-colors"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            Advanced
          </button>

          {advancedOpen && (
            <div className="mt-2 space-y-2">
              {/* mask */}
              <div className="flex items-center justify-between">
                <span className="text-ink-dim">Mask</span>
                <Switch checked={ex.maskEnabled} onCheckedChange={ex.setMaskEnabled} disabled={variants.length === 0} />
              </div>
              {variants.length === 0 && <div className="text-[10px] text-ink-dim/50">No mask for this ratio</div>}
              {ex.maskEnabled && variants.length > 1 && (
                <select
                  value={ex.maskVariant}
                  onChange={(e) => ex.setMaskVariant(Number(e.target.value))}
                  className="w-full rounded border border-edge bg-transparent px-1 py-0.5 text-[11px]"
                >
                  {variants.map((v, i) => <option key={v.id} value={i}>{v.label}</option>)}
                </select>
              )}

              {/* watermark */}
              <div className="flex items-center justify-between">
                <span className="text-ink-dim">Watermark</span>
                <Switch checked={ex.watermarkEnabled} onCheckedChange={ex.setWatermarkEnabled} />
              </div>

              {/* format */}
              {videoFormats.length > 1 && !print && (
                <div className="flex items-center justify-between">
                  <span className="text-ink-dim">Format</span>
                  <div className="flex rounded border border-edge overflow-hidden">
                    {videoFormats.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => ex.setVideoFormat(f.id)}
                        className={
                          "px-2 py-0.5 text-[10px] transition-colors " +
                          (ex.videoFormat === f.id ? "bg-panel-raised text-ink" : "text-ink-dim hover:text-ink")
                        }
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* duration */}
              {!print && (
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-ink-dim">Duration</span>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    step={1}
                    value={videoSec}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!isNaN(n)) setVideoSec(Math.max(1, Math.min(15, n)));
                    }}
                    className="w-14 rounded border border-edge bg-transparent px-1 py-0.5 text-right font-mono text-[11px] outline-none focus:border-accent/60"
                  />
                  <span className="text-ink-dim/60">s</span>
                </div>
              )}
            </div>
          )}
        </div>

      </PopoverContent>
    </Popover>
  );
}

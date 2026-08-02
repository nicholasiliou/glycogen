import { useEffect, useMemo, useState } from "react";
import { Download, Image as ImageIcon, Video } from "lucide-react";
import { Exporter, isPrintRatio, masksFor, PRINT_RATIO_LIST, SCREEN_RATIO_LIST, supportedVideoFormats, VIDEO_QUALITIES, VIDEO_QUALITY_LIST } from "@/runtime/export";
import { useLive } from "@/ui/app/LiveProvider";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/components/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/components/select";
import { useExportSettings } from "@/ui/export/ExportContext";

/**
 * Export panel: ratio + quality selects, plain duration input, format inline beside Video button.
 * All settings visible by default — no collapsible disclosure.
 */
export function ExportPanel() {
  const { stage } = useLive();
  const exporter = useMemo(() => new Exporter(stage), [stage]);
  const ex = useExportSettings();

  const [videoSec, setVideoSec] = useState(10);
  const [busy, setBusy] = useState<null | "still" | "video">(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const variants = masksFor(ex.ratioId);
  const videoFormats = useMemo(() => supportedVideoFormats(), []);
  const print = isPrintRatio(ex.ratioId);

  useEffect(() => {
    stage.watermark = ex.watermarkEnabled;
    stage.exportRatio = ex.ratio.width / ex.ratio.height;
  }, [stage, ex.watermarkEnabled, ex.ratio]);

  const run = async (kind: "still" | "video") => {
    if (busy || (kind === "video" && print)) return;
    setError(null);
    setBusy(kind);
    setProgress(0);
    try {
      if (kind === "still") await exporter.still(ex.settings(), "png");
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

        {/* ── ratio ─────────────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Select value={ex.ratioId} onValueChange={(v) => ex.setRatioId(v as typeof ex.ratioId)}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom</SelectItem>
                {SCREEN_RATIO_LIST.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                {PRINT_RATIO_LIST.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* resolved pixel dimensions pill */}
            <span className="shrink-0 rounded bg-panel-raised px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
              {ex.outputSize.width}×{ex.outputSize.height}
            </span>
          </div>

          {/* custom ratio inputs */}
          {ex.ratioId === "custom" && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={ex.custom.width}
                min={1}
                onChange={(e) => ex.setCustom({ ...ex.custom, width: Math.max(1, Number(e.target.value) || 1) })}
                className="w-16 rounded border border-edge bg-transparent px-1 py-0.5 text-[11px]"
              />
              <span>:</span>
              <input
                type="number"
                value={ex.custom.height}
                min={1}
                onChange={(e) => ex.setCustom({ ...ex.custom, height: Math.max(1, Number(e.target.value) || 1) })}
                className="w-16 rounded border border-edge bg-transparent px-1 py-0.5 text-[11px]"
              />
            </div>
          )}
        </div>

        {/* ── quality ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-ink-dim">Quality</span>
          <Select value={ex.videoQuality} onValueChange={(v) => ex.setVideoQuality(v as typeof ex.videoQuality)}>
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {VIDEO_QUALITY_LIST.map((q) => (
                <SelectItem key={q.id} value={q.id}>{q.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="shrink-0 text-ink-dim/60">{VIDEO_QUALITIES[ex.videoQuality].fps}fps</span>
        </div>

        {/* ── mask + watermark ──────────────────────────────────────────────── */}
        <div className="space-y-2 border-t border-edge/40 pt-2">
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
          <div className="flex items-center justify-between">
            <span className="text-ink-dim">Watermark</span>
            <Switch checked={ex.watermarkEnabled} onCheckedChange={ex.setWatermarkEnabled} />
          </div>
        </div>

        {/* ── video duration + format ───────────────────────────────────────── */}
        {!print && (
          <div className="flex items-center gap-2 border-t border-edge/40 pt-2">
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

        {/* ── actions ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 border-t border-edge/40 pt-2">
          <Button size="sm" variant="outline" className="flex-1 gap-1" disabled={!!busy} onClick={() => void run("still")}>
            <ImageIcon className="h-3.5 w-3.5" /> Still
          </Button>
          <div className="flex flex-1 items-center gap-1">
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
            {/* format toggle — only when multiple formats are available, shown inline */}
            {videoFormats.length > 1 && !print && (
              <div className="flex rounded border border-edge">
                {videoFormats.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => ex.setVideoFormat(f.id)}
                    className={
                      "px-1.5 py-0.5 text-[10px] first:rounded-l last:rounded-r transition-colors " +
                      (ex.videoFormat === f.id ? "bg-panel-raised text-ink" : "text-ink-dim hover:text-ink")
                    }
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {busy === "video" && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-edge">
            <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {busy === "still" && <div className="text-ink-dim/60">Rendering…</div>}
        {error && <div className="text-red-400">{error}</div>}

      </PopoverContent>
    </Popover>
  );
}

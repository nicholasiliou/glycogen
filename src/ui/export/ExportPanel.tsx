import { useEffect, useMemo, useState } from "react";
import { Download, Image as ImageIcon, Video } from "lucide-react";
import { Exporter, ASPECT_RATIO_LIST, masksFor, supportedVideoFormats, VIDEO_QUALITIES, VIDEO_QUALITY_LIST } from "@/runtime/export";
import { useLive } from "@/ui/app/LiveProvider";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/components/popover";
import { useExportSettings } from "@/ui/export/ExportContext";
import { Slider } from "@/ui/components/slider";

/** Lean export: pick an aspect ratio (+ custom size), toggle the mask, export a still or video. */
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

  // The watermark is baked into the live canvas (that's what makes it export by default), so the
  // switch drives the Stage directly — stills and recorded video simply see what the canvas shows.
  useEffect(() => {
    stage.watermark = ex.watermarkEnabled;
    stage.exportRatio = ex.ratio.width / ex.ratio.height;
  }, [stage, ex.watermarkEnabled, ex.ratio]);

  const run = async (kind: "still" | "video") => {
    if (busy) return;
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
      <PopoverContent align="end" className="w-64 space-y-3 text-[11px] text-ink">
        {/* aspect ratio */}
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            {ASPECT_RATIO_LIST.map((r) => (
              <button
                key={r.id}
                onClick={() => ex.setRatioId(r.id)}
                className={`rounded border px-1.5 py-0.5 ${ex.ratioId === r.id ? "border-ink text-ink" : "border-edge text-ink-dim"}`}
              >
                {r.id}
              </button>
            ))}
            <button
              onClick={() => ex.setRatioId("custom")}
              className={`rounded border px-1.5 py-0.5 ${ex.ratioId === "custom" ? "border-ink text-ink" : "border-edge text-ink-dim"}`}
            >
              custom
            </button>
          </div>
          {ex.ratioId === "custom" && (
            <div className="flex items-center gap-1 pt-1">
              {/* A relative ratio (w:h) — the exporter resolves it to pixels (short side 1080). */}
              <input
                type="number"
                value={ex.custom.width}
                min={1}
                onChange={(e) => ex.setCustom({ ...ex.custom, width: Math.max(1, Number(e.target.value) || 1) })}
                className="w-16 rounded border border-edge bg-transparent px-1 py-0.5"
              />
              <span className="text-ink">:</span>
              <input
                type="number"
                value={ex.custom.height}
                min={1}
                onChange={(e) => ex.setCustom({ ...ex.custom, height: Math.max(1, Number(e.target.value) || 1) })}
                className="w-16 rounded border border-edge bg-transparent px-1 py-0.5"
              />
              <span className="text-ink-dim/60">{ex.ratio.width}×{ex.ratio.height}</span>
            </div>
          )}
        </div>

        {/* mask toggle + variant */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-ink">Mask</span>
            <Switch checked={ex.maskEnabled} onCheckedChange={ex.setMaskEnabled} disabled={variants.length === 0} />
          </div>
          {ex.maskEnabled && variants.length > 1 && (
            <select
              value={ex.maskVariant}
              onChange={(e) => ex.setMaskVariant(Number(e.target.value))}
              className="w-full rounded border border-edge bg-transparent px-1 py-0.5"
            >
              {variants.map((v, i) => (
                <option key={v.id} value={i}>
                  {v.label}
                </option>
              ))}
            </select>
          )}
          {variants.length === 0 && <div className="text-ink-dim/60">No mask for this ratio</div>}
        </div>

        {/* watermark toggle */}
        <div className="flex items-center justify-between">
          <span className="text-ink">Watermark</span>
          <Switch checked={ex.watermarkEnabled} onCheckedChange={ex.setWatermarkEnabled} />
        </div>

        {/* video duration slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-ink">Video length</span>
            <span className="text-ink">{videoSec}s</span>
          </div>
          <Slider min={1} max={15} step={1} value={[videoSec]} onValueChange={([v]) => setVideoSec(v)} />
        </div>

        {/* quality — the resolution scale applies to stills and video; fps is video-only */}
        <div className="space-y-1">
          <span className="text-ink">Quality</span>
          <div className="flex gap-1">
            {VIDEO_QUALITY_LIST.map((q) => (
              <button
                key={q.id}
                onClick={() => ex.setVideoQuality(q.id)}
                className={`flex-1 rounded border px-1.5 py-0.5 ${ex.videoQuality === q.id ? "border-ink text-ink" : "border-edge text-ink-dim"}`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="text-ink-dim/60">
            {(() => {
              const q = VIDEO_QUALITIES[ex.videoQuality];
              const w = Math.round(ex.ratio.width * q.scale);
              const h = Math.round(ex.ratio.height * q.scale);
              return `${w}×${h} · ${q.fps}fps`;
            })()}
          </div>
        </div>

        {/* video format — only shown when the browser can record more than one container */}
        {videoFormats.length > 1 && (
          <div className="space-y-1">
            <span className="text-ink">Video format</span>
            <div className="flex gap-1">
              {videoFormats.map((f) => (
                <button
                  key={f.id}
                  onClick={() => ex.setVideoFormat(f.id)}
                  className={`flex-1 rounded border px-1.5 py-0.5 ${ex.videoFormat === f.id ? "border-ink text-ink" : "border-edge text-ink-dim"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* actions */}
        <div className="flex gap-1.5 pt-1">
          <Button size="sm" variant="outline" className="flex-1 gap-1" disabled={!!busy} onClick={() => void run("still")}>
            <ImageIcon className="h-3.5 w-3.5" /> Still
          </Button>
          <Button size="sm" variant="outline" className="flex-1 gap-1" disabled={!!busy} onClick={() => void run("video")}>
            <Video className="h-3.5 w-3.5" /> Video
          </Button>
        </div>

        {busy === "video" && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-edge">
            <div className="h-full bg-ink" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {busy === "still" && <div className="text-ink-dim">Rendering…</div>}
        {error && <div className="text-red-400">{error}</div>}
      </PopoverContent>
    </Popover>
  );
}

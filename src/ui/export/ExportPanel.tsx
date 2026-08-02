import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Image as ImageIcon, Video } from "lucide-react";
import { Exporter, isPrintRatio, masksFor, PRINT_RATIO_LIST, SCREEN_RATIO_LIST, supportedVideoFormats, VIDEO_QUALITIES, VIDEO_QUALITY_LIST } from "@/runtime/export";
import { useLive } from "@/ui/app/LiveProvider";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/components/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/components/select";
import { useExportSettings } from "@/ui/export/ExportContext";

export function ExportPanel() {
  const { stage } = useLive();
  const exporter = useMemo(() => new Exporter(stage), [stage]);
  const ex = useExportSettings();

  const [videoSec, setVideoSec] = useState(10);
  const [busy, setBusy] = useState<null | "still" | "video">(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Inline ratio editing state
  const [ratioEditing, setRatioEditing] = useState<{ w: string; h: string } | null>(null);
  const ratioWRef = useRef<HTMLInputElement>(null);

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

  // Commit inline ratio edit
  const commitRatioEdit = () => {
    if (!ratioEditing) return;
    const w = Math.max(1, parseInt(ratioEditing.w, 10) || 1);
    const h = Math.max(1, parseInt(ratioEditing.h, 10) || 1);
    ex.setRatioId("custom");
    ex.setCustom({ width: w, height: h });
    setRatioEditing(null);
  };

  // Start inline ratio edit from the pill
  const startRatioEdit = () => {
    const current = ex.ratioId === "custom"
      ? { w: String(ex.custom.width), h: String(ex.custom.height) }
      : { w: String(ex.ratio.width), h: String(ex.ratio.height) };
    setRatioEditing(current);
    setTimeout(() => ratioWRef.current?.select(), 0);
  };

  const q = VIDEO_QUALITIES[ex.videoQuality];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" title="Export">
          <Download className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 text-[11px] text-ink">

        {/* ── ratio ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <Select
            value={ex.ratioId === "custom" ? "custom" : ex.ratioId}
            onValueChange={(v) => {
              setRatioEditing(null);
              ex.setRatioId(v as typeof ex.ratioId);
            }}
          >
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ex.ratioId === "custom" && <SelectItem value="custom">Custom</SelectItem>}
              {SCREEN_RATIO_LIST.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
              {PRINT_RATIO_LIST.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* editable size pill — click to go custom */}
          {ratioEditing ? (
            <div className="flex items-center gap-0.5 rounded bg-panel-raised px-1 py-0.5 font-mono text-[10px]">
              <input
                ref={ratioWRef}
                type="number"
                min={1}
                value={ratioEditing.w}
                onChange={(e) => setRatioEditing({ ...ratioEditing, w: e.target.value })}
                onBlur={commitRatioEdit}
                onKeyDown={(e) => { if (e.key === "Enter") commitRatioEdit(); if (e.key === "Escape") setRatioEditing(null); }}
                className="w-10 bg-transparent text-center outline-none"
              />
              <span className="text-ink-dim">×</span>
              <input
                type="number"
                min={1}
                value={ratioEditing.h}
                onChange={(e) => setRatioEditing({ ...ratioEditing, h: e.target.value })}
                onBlur={commitRatioEdit}
                onKeyDown={(e) => { if (e.key === "Enter") commitRatioEdit(); if (e.key === "Escape") setRatioEditing(null); }}
                className="w-10 bg-transparent text-center outline-none"
              />
            </div>
          ) : (
            <button
              onClick={startRatioEdit}
              title="Click to set custom size"
              className="shrink-0 rounded bg-panel-raised px-1.5 py-0.5 font-mono text-[10px] text-ink-dim hover:text-ink transition-colors cursor-text"
            >
              {ex.outputSize.width}×{ex.outputSize.height}
            </button>
          )}
        </div>

        {/* ── quality ───────────────────────────────────────────────────────── */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-ink-dim">Quality</span>
            <div className="flex flex-1 rounded border border-edge overflow-hidden">
              {VIDEO_QUALITY_LIST.map((qp) => (
                <button
                  key={qp.id}
                  onClick={() => ex.setVideoQuality(qp.id)}
                  className={
                    "flex-1 py-0.5 text-[10px] transition-colors " +
                    (ex.videoQuality === qp.id ? "bg-panel-raised text-ink" : "text-ink-dim hover:text-ink")
                  }
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>
          <div className="pl-14 text-[10px] text-ink-dim/60">
            {q.fps} fps · {ex.outputSize.width}×{ex.outputSize.height}px{q.scale > 1 ? ` (${q.scale}× super)` : ""}
          </div>
        </div>

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
          </div>
        </div>

        {busy === "video" && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-edge">
            <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
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

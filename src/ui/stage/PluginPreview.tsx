import { LayerIcon } from "@/ui/components/LayerIcon";
import { cn } from "@/ui/lib/cn";
import type { PluginInfo } from "@/plugins/registry";

/** Per-plugin icon for the browse preview. */
const ICONS: Record<string, string> = {
  // generators
  shape: "Shapes",
  noise: "Waves",
  boids: "Bird",
  gameOfLife: "Grid3x3",
  physarum: "Waypoints",
  reactionDiffusion: "Droplets",
  landscape: "Mountain",
  harmonograph: "Spline",
  volumetricCloud: "Cloudy",
  text: "Type",
  contourField: "LayoutGrid",
  glyph: "Hash",
  glyphScatter: "LayoutDashboard",
  plant: "Sprout",
  // effects
  pixelate: "Aperture",
  bayer: "Grid2x2",
  ascii: "Hash",
  colorLookup: "Palette",
  deepGlow: "Crosshair",
  fisheye: "Aperture",
  pixelSort: "Layers",
  pixelStretch: "Layers",
  venetianBlinds: "Layers",
  tracker: "Crosshair",
};

export function PluginPreview({ info, className }: { info?: PluginInfo; className?: string }) {
  if (!info) return null;
  const icon = ICONS[info.id] ?? (info.kind === "effect" ? "Layers" : "Shapes");

  return (
    <div className={cn("flex items-center gap-2 px-2 py-1", className)}>
      <LayerIcon name={icon} className="h-5 w-5 shrink-0" />
      <div className="min-w-0">
        <div className="truncate text-xs leading-tight text-ink">{info.label}</div>
      </div>
    </div>
  );
}

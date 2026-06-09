import {
  Aperture,
  Bird,
  Box,
  Boxes,
  Cloudy,
  CloudFog,
  Crosshair,
  Folder,
  Grid2x2,
  Grid3x3,
  Hash,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Mountain,
  Palette,
  Shapes,
  Spline,
  Sprout,
  Square,
  Type,
  Waves,
  type LucideProps,
} from "lucide-react";

const MAP: Record<string, React.ComponentType<LucideProps>> = {
  Sprout, Square, Type, Folder, Waves, Bird, Cloudy, Layers, Crosshair, Aperture,
  Hash, Grid3x3, Grid2x2, Spline, LayoutGrid, Shapes, Mountain, Boxes, Palette,
  LayoutDashboard, CloudFog,
};

export function LayerIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && MAP[name]) || Box;
  return <Icon className={className} />;
}

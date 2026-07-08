import {
  AlignJustify,
  Aperture,
  ArrowDownUp,
  Ban,
  Bird,
  Box,
  Boxes,
  Cloudy,
  CloudFog,
  Crosshair,
  Droplets,
  Folder,
  Grid2x2,
  Grid3x3,
  Hash,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  MoveHorizontal,
  Mountain,
  Palette,
  Shapes,
  Spline,
  Sprout,
  Square,
  Type,
  Waves,
  Waypoints,
  type LucideProps,
} from "lucide-react";

const MAP: Record<string, React.ComponentType<LucideProps>> = {
  Sprout, Square, Type, Folder, Waves, Bird, Cloudy, Layers, Crosshair, Aperture,
  Hash, Grid3x3, Grid2x2, Spline, LayoutGrid, Shapes, Mountain, Boxes, Palette,
  LayoutDashboard, CloudFog, Droplets, Waypoints,
  Ban, AlignJustify, ArrowDownUp, MoveHorizontal,
};

export function LayerIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && MAP[name]) || Box;
  return <Icon className={className} strokeWidth={1} />;
}

import { Bird, Box, Cloudy, Folder, Layers, Sprout, Square, Type, Waves, type LucideProps } from "lucide-react";

const MAP: Record<string, React.ComponentType<LucideProps>> = {
  Sprout,
  Square,
  Type,
  Folder,
  Waves,
  Bird,
  Cloudy,
  Layers,
};

export function LayerIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && MAP[name]) || Box;
  return <Icon className={className} />;
}

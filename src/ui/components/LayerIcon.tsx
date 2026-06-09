import { Bird, Box, Folder, Sprout, Square, Type, Waves, type LucideProps } from "lucide-react";

const MAP: Record<string, React.ComponentType<LucideProps>> = {
  Sprout,
  Square,
  Type,
  Folder,
  Waves,
  Bird,
};

export function LayerIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && MAP[name]) || Box;
  return <Icon className={className} />;
}

import { Box, Folder, Sprout, Square, Type, type LucideProps } from "lucide-react";

const MAP: Record<string, React.ComponentType<LucideProps>> = {
  Sprout,
  Square,
  Type,
  Folder,
};

export function LayerIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && MAP[name]) || Box;
  return <Icon className={className} />;
}

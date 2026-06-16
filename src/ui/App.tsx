import { useMode } from "@/ui/mode/ModeProvider";
import { ProApp } from "@/ui/ProApp";
import { SimpleApp } from "@/ui/SimpleApp";

export default function App() {
  const { mode } = useMode();
  return mode === "simple" ? <SimpleApp /> : <ProApp />;
}

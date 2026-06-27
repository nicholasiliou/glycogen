import { useRevision } from "@/ui/engine/EngineProvider";
import { type TextSetting, textSettingOf } from "@/plugins/_shared/textField";
import type { Engine } from "@/engine";

export function useTextMode(engine: Engine, deckA: string | null, deckB: string | null): TextSetting {
  useRevision();
  const textLayer = engine.comp.layers.find((l) => l.type === "text" && l.enabled);
  if (textLayer) return textSettingOf(textLayer.property("textInfluence")?.valueAt(engine.transport.time));
  for (const id of [deckA, deckB]) {
    if (!id) continue;
    const prop = engine.getLayer(id)?.property("textInfluence");
    if (prop) return textSettingOf(prop.valueAt(engine.transport.time));
  }
  return "attract";
}

/**
 * Legality helpers for the assignment surface: turn a param or app-function row into a ready-to-arm
 * {@link AssignPending}, whose `legal` map is what highlights drop targets on the overlay. The same
 * rules the db validators enforce, precomputed for the pointer:
 *   • params land on any non-reserved widget with a legal adapter that isn't action-occupied;
 *   • actions are press-driven — any non-reserved press widget (dropping one evicts params there).
 */
import { legalAdapters, WIDGET_SIGNAL } from "@/controls/adapters";
import { actionBindings, widgets, type AppActionRow, type ParamRow } from "@/db/schema";
import type { AssignPending } from "@/ui/controller/widgets";

export function pendingForParam(row: ParamRow): AssignPending {
  const legal: AssignPending["legal"] = {};
  for (const w of widgets.all()) {
    if (w.reserved) continue;
    if (actionBindings.by("widget", w.id).length > 0) continue; // actions win the widget
    const kinds = legalAdapters(row.control, w.kind);
    if (kinds.length) legal[w.id] = kinds;
  }
  return { type: "param", pluginId: row.pluginId, paramId: row.id, label: row.name, legal };
}

export function pendingForAction(row: AppActionRow): AssignPending {
  const legal: AssignPending["legal"] = {};
  for (const w of widgets.all()) {
    if (w.reserved || WIDGET_SIGNAL[w.kind] !== "press") continue;
    legal[w.id] = ["action"];
  }
  return { type: "action", actionId: row.id, label: row.label, legal };
}

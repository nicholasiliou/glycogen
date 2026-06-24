/**
 * Public engine API — the stable surface the UI and third-party modules import.
 * The headless engine has zero React/DOM-UI dependencies; it only touches the DOM
 * for canvas/render concerns. Keep this barrel curated: it IS the extensibility API.
 */

// Core
export { Engine } from "./Engine";
export type { EngineEvents, AddLayerOptions } from "./Engine";
export { Emitter } from "./core/EventBus";
export * from "./core/types";
export { uid } from "./core/ids";

// Time
export { Transport } from "./time/Transport";
export { Ticker } from "./time/Ticker";

// Properties / expressions
export { Property } from "./properties/Property";
export type { Keyframe, PropertyInit } from "./properties/Property";
export * from "./properties/interpolation";
export { Evaluator, bindingExpression } from "./properties/expression";

// Scene
export { Layer, BLEND_TO_COMPOSITE } from "./scene/Layer";
export type { BlendMode, LayerInit, TransformValues } from "./scene/Layer";
export { Composition } from "./scene/Composition";
export type { CompositionInit, GuideSettings } from "./scene/Composition";
export { Project } from "./scene/Project";
export { RESOLUTION_PRESETS, PREVIEW_QUALITIES } from "./scene/presets";
export type { ResolutionPreset } from "./scene/presets";

// Plugins / registry (extension API)
export { Registry } from "./plugins/Registry";
export type { LayerTypeDefinition, PropertySchema } from "./plugins/Registry";

// Render
export { Compositor } from "./render/Compositor";
export type { LayerRenderer, RenderFrame, RenderHost, CanvasSource } from "./render/types";

// Commands
export { History } from "./commands/History";
export type { Command } from "./commands/History";

// IO / export
export { serializeProject, deserializeProject, PROJECT_FORMAT, PROJECT_VERSION } from "./io/serialize";
export type { ProjectFile } from "./io/serialize";
export { Exporter } from "./io/Exporter";
export type { StillFormat, ExportProgress } from "./io/Exporter";

// Inputs
export { InputManager } from "./inputs/InputManager";

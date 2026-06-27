import type { Registry } from "../engine/plugins/Registry";
import { groupLayerType, nullLayerType } from "./group/GroupLayer";
import { layoutLayerType } from "./layout/LayoutLayer";
import { solidLayerType } from "./solid/SolidLayer";
import { textLayerType } from "./text/TextLayer";
import { plantLayerType } from "./plant/PlantLayer";
import { harmonographLayerType } from "./harmonograph/HarmonographLayer";
import { boidsLayerType } from "./boids/BoidsLayer";
import { noiseLayerType } from "./noise/NoiseLayer";
import { slicerLayerType } from "./slicer/SlicerLayer";
import { shapeLayerType } from "./shape/ShapeLayer";
import { modelLayerType } from "./model/ModelLayer";
import { landscapeLayerType } from "./landscape/LandscapeLayer";
import { gameOfLifeLayerType } from "./life/GameOfLifeLayer";
import { reactionDiffusionLayerType } from "./reactionDiffusion/ReactionDiffusionLayer";
import { physarumLayerType } from "./physarum/PhysarumLayer";
import { wireLayerType } from "./wire/WireLayer";
import { glyphLayerType } from "./glyph/GlyphLayer";
import { glyphScatterLayerType } from "./glyph/GlyphScatterLayer";
import { cloudLayerType } from "./cloud/VolumetricCloudLayer";
import { fisheyeLayerType, asciiLayerType } from "./shaders/EffectLayers";
import { colorLookupLayerType } from "./shaders/ColorLookupLayer";
import { contourFieldLayerType } from "./contourefield/contourefield";
import { glitchEffectLayerType } from "./shaders/GlitchEffect";

/** Registers the built-in layer types. `registry.register(...)` is the whole contract. */
export function registerBuiltins(registry: Registry): void {
  // Organize / containers
  registry.register(groupLayerType);
  registry.register(layoutLayerType);
  registry.register(nullLayerType);
  // Content
  //registry.register(solidLayerType);
  registry.register(textLayerType);
  registry.register(glyphLayerType);
  // Generators
  registry.register(plantLayerType);
  registry.register(harmonographLayerType);
  registry.register(noiseLayerType);
  registry.register(cloudLayerType);
  //registry.register(wireLayerType);
  registry.register(glyphScatterLayerType);
  registry.register(contourFieldLayerType)
  // 3D
  registry.register(shapeLayerType);
  //registry.register(modelLayerType);
  registry.register(landscapeLayerType);
  //registry.register(slicerLayerType);
  // Simulation
  registry.register(boidsLayerType);
  registry.register(gameOfLifeLayerType);
  registry.register(reactionDiffusionLayerType);
  registry.register(physarumLayerType);
  // Effects (distort the layers below)
  registry.register(fisheyeLayerType);
  registry.register(asciiLayerType);
  registry.register(colorLookupLayerType);
  registry.register(glitchEffectLayerType)
}

export {
  groupLayerType,
  nullLayerType,
  layoutLayerType,
  solidLayerType,
  textLayerType,
  plantLayerType,
  harmonographLayerType,
  boidsLayerType,
  noiseLayerType,
  slicerLayerType,
  shapeLayerType,
  modelLayerType,
  landscapeLayerType,
  gameOfLifeLayerType,
  reactionDiffusionLayerType,
  physarumLayerType,
  wireLayerType,
  glyphLayerType,
  glyphScatterLayerType,
  cloudLayerType,
  fisheyeLayerType,
  asciiLayerType,
  colorLookupLayerType,
  contourFieldLayerType,
  glitchEffectLayerType,
};

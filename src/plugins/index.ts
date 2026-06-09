import type { Registry } from "../engine/plugins/Registry";
import { groupLayerType } from "./group/GroupLayer";
import { solidLayerType } from "./solid/SolidLayer";
import { textLayerType } from "./text/TextLayer";
import { plantLayerType } from "./plant/PlantLayer";
import { harmonographLayerType } from "./harmonograph/HarmonographLayer";
import { boidsLayerType } from "./boids/BoidsLayer";
import { noiseLayerType } from "./noise/NoiseLayer";
import { slicerLayerType } from "./slicer/SlicerLayer";

/**
 * Registers the built-in layer types. Third-party modules do the exact same thing
 * with their own definitions — this function has no privileged access; it just calls
 * `registry.register(...)`, which is the entire extension contract.
 */
export function registerBuiltins(registry: Registry): void {
  registry.register(groupLayerType);
  registry.register(solidLayerType);
  registry.register(textLayerType);
  registry.register(plantLayerType);
  registry.register(harmonographLayerType);
  registry.register(boidsLayerType);
  registry.register(noiseLayerType);
  registry.register(slicerLayerType);
}

export {
  groupLayerType,
  solidLayerType,
  textLayerType,
  plantLayerType,
  harmonographLayerType,
  boidsLayerType,
  noiseLayerType,
  slicerLayerType,
};

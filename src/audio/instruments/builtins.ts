/**
 * Phase-1 instrument voices. Each is a distinct synth design pinned to one plugin type, so
 * the plugin always sounds like itself. Rhythmic voices schedule on the shared Tone transport
 * (so they stay locked to tempo) and read the latest visual params at trigger time; tonal
 * voices snap pitch into the shared key via `engine.freqOfDegree`.
 *
 * Each voice now lives in its own file; this barrel preserves the original import path.
 */
export { createLifeDrums } from "./lifeDrums";
export { createPhysarumPad } from "./physarumPad";
export { createHarmonographLead } from "./harmonographLead";
export { createBoidsArp } from "./boidsArp";
export { createNoiseBass } from "./noiseBass";
export { createPlantPluck } from "./plantPluck";
export { createGlyphMallet } from "./glyphMallet";
export { createShapeChime } from "./shapeChime";
export { createCloudPad } from "./cloudPad";
export { createLandscapePad } from "./landscapePad";

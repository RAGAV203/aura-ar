import type { InstrumentEngine, InstrumentId, InstrumentParameters } from "@/types/instruments";
import { AuroraInstrument } from "./engines/aurora";
import { CosmicGardenModel } from "./engines/cosmicGarden";
import { InkFlowInstrument } from "./engines/inkflow";
import { LightTrailsInstrument } from "./engines/lightTrails";
import { BowedInstrument } from "./engines/bowed";
import { DrumKitInstrument } from "./engines/drumKit";
import { GuitarInstrument } from "./engines/guitar";
import { HandpanInstrument } from "./engines/handpan";
import { SitarInstrument, VeenaInstrument } from "./engines/indianStrings";
import { KalimbaInstrument } from "./engines/kalimba";
import { MarimbaInstrument } from "./engines/marimba";
import { PitchGridInstrument } from "./engines/pitchGrid";
import { TablaInstrument } from "./engines/tabla";
import { ThereminInstrument } from "./engines/theremin";
import { FreestyleDrumsInstrument } from "./engines/freestyleDrums";
import { MagneticFieldInstrument } from "./engines/magneticField";
import { OrchestraInstrument } from "./engines/orchestra";
import { PianoInstrument } from "./engines/piano";
import { FluteInstrument, TrumpetInstrument } from "./engines/winds";
import { ParticleBloomInstrument } from "./engines/particleBloom";
import { RipplePondInstrument } from "./engines/ripplePond";
import { StringHarpInstrument } from "./engines/stringHarp";

/** Creates a Canvas 2D instrument bound to the given canvas. */
export function createCanvasEngine(id: Exclude<InstrumentId, "cosmic-garden">, canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number): InstrumentEngine {
  switch (id) {
    case "aurora":
      return new AuroraInstrument(canvas, parameters, seed);
    case "inkflow":
      return new InkFlowInstrument(canvas, parameters, seed);
    case "light-trails":
      return new LightTrailsInstrument(canvas, parameters, seed);
    case "particle-bloom":
      return new ParticleBloomInstrument(canvas, parameters, seed);
    case "string-harp":
      return new StringHarpInstrument(canvas, parameters, seed);
    case "ripple-pond":
      return new RipplePondInstrument(canvas, parameters, seed);
    case "magnetic-field":
      return new MagneticFieldInstrument(canvas, parameters, seed);
    case "piano":
      return new PianoInstrument(canvas, parameters, seed);
    case "flute":
      return new FluteInstrument(canvas, parameters, seed);
    case "trumpet":
      return new TrumpetInstrument(canvas, parameters, seed);
    case "orchestra":
      return new OrchestraInstrument(canvas, parameters, seed);
    case "drum-kit":
      return new DrumKitInstrument(canvas, parameters, seed);
    case "freestyle-drums":
      return new FreestyleDrumsInstrument(canvas, parameters, seed);
    case "guitar":
      return new GuitarInstrument(canvas, parameters, seed);
    case "veena":
      return new VeenaInstrument(canvas, parameters, seed);
    case "sitar":
      return new SitarInstrument(canvas, parameters, seed);
    case "violin":
      return new BowedInstrument(canvas, parameters, seed);
    case "theremin":
      return new ThereminInstrument(canvas, parameters, seed);
    case "handpan":
      return new HandpanInstrument(canvas, parameters, seed);
    case "marimba":
      return new MarimbaInstrument(canvas, parameters, seed);
    case "tabla":
      return new TablaInstrument(canvas, parameters, seed);
    case "kalimba":
      return new KalimbaInstrument(canvas, parameters, seed);
    case "pitch-grid":
      return new PitchGridInstrument(canvas, parameters, seed);
  }
}

export function createCosmicGardenModel(parameters: InstrumentParameters, seed: number): CosmicGardenModel {
  return new CosmicGardenModel(parameters, seed);
}

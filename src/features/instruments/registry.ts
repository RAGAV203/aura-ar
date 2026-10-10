import type { InstrumentDefinition, InstrumentId, InstrumentParameters, ParameterSpec } from "@/types/instruments";
import { clamp, isFiniteNumber } from "@/lib/math";

const PENTATONIC = [0, 2, 4, 7, 9];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

const hue = (defaultValue: number): ParameterSpec => ({
  key: "hue",
  label: "Colour",
  min: 0,
  max: 360,
  step: 1,
  defaultValue,
  description: "Base hue of the palette.",
});

export const INSTRUMENTS: readonly InstrumentDefinition[] = [
  {
    id: "aurora",
    name: "Aurora",
    tagline: "Flowing curtains of light",
    description: "Luminous ribbons drift like northern lights. Move to steer them, raise your hand to brighten the sky, and spread both hands to widen the curtain.",
    renderer: "canvas2d",
    tracking: ["hands", "pose"],
    persistentCanvas: false,
    parameters: [
      hue(165),
      { key: "flow", label: "Flow", min: 0.1, max: 2, step: 0.05, defaultValue: 0.7, description: "How fast the ribbons drift." },
      { key: "spread", label: "Spread", min: 0.1, max: 1, step: 0.05, defaultValue: 0.45, description: "Resting width of the curtain." },
      { key: "glow", label: "Glow", min: 0.2, max: 1, step: 0.05, defaultValue: 0.7, description: "Intensity of the light." },
    ],
    presets: [
      { id: "polar-night", name: "Polar Night", parameters: { hue: 165, flow: 0.7, spread: 0.45, glow: 0.7 } },
      { id: "violet-dawn", name: "Violet Dawn", parameters: { hue: 270, flow: 0.5, spread: 0.6, glow: 0.8 } },
      { id: "ember-veil", name: "Ember Veil", parameters: { hue: 335, flow: 1.1, spread: 0.35, glow: 0.6 } },
    ],
    gestureMappings: [
      { input: "Move hand left / right", effect: "Steers the ribbons" },
      { input: "Raise or lower hand", effect: "Brightens or dims the sky and sound" },
      { input: "Spread two hands apart", effect: "Widens the curtain" },
      { input: "Hold an open palm", effect: "Shifts the colour palette" },
    ],
    touchMappings: [
      { input: "Drag", effect: "Steers and brightens the ribbons" },
      { input: "Two-finger spread", effect: "Widens the curtain" },
      { input: "Double tap", effect: "Shifts the colour palette" },
    ],
    audio: { palette: "ambient-pad", rootNote: 50, scale: PENTATONIC },
    exportFormats: ["png", "json", "video"],
    palette: ["#55E7FF", "#9B7CFF", "#7CFFB2"],
  },
  {
    id: "inkflow",
    name: "InkFlow",
    tagline: "Paint with liquid colour",
    description: "Ink bleeds and curls from your fingertip. Pinch closed for a fine line, open your fingers for a wide brush. Open your palm to lift the brush.",
    renderer: "canvas2d",
    tracking: ["hands"],
    persistentCanvas: true,
    parameters: [
      hue(300),
      { key: "size", label: "Brush size", min: 2, max: 40, step: 1, defaultValue: 14, description: "Base width of the brush." },
      { key: "bleed", label: "Bleed", min: 0, max: 1, step: 0.05, defaultValue: 0.55, description: "How far ink spreads and curls." },
      { key: "fade", label: "Fade", min: 0, max: 1, step: 0.05, defaultValue: 0, description: "How quickly old ink fades away. Zero keeps every stroke." },
    ],
    presets: [
      { id: "sumi", name: "Sumi Bloom", parameters: { hue: 300, size: 14, bleed: 0.55, fade: 0 } },
      { id: "tidepool", name: "Tidepool", parameters: { hue: 190, size: 22, bleed: 0.8, fade: 0.1 } },
      { id: "calligraphy", name: "Calligraphy", parameters: { hue: 40, size: 6, bleed: 0.2, fade: 0 } },
    ],
    gestureMappings: [
      { input: "Move index finger", effect: "Draws ink" },
      { input: "Pinch closed / open", effect: "Thin or wide brush" },
      { input: "Hold an open palm", effect: "Lifts the brush" },
    ],
    touchMappings: [
      { input: "Drag", effect: "Draws ink" },
      { input: "Brush size slider", effect: "Changes the brush width" },
      { input: "Tap", effect: "Drops a splash of ink" },
    ],
    audio: { palette: "soft-percussion", rootNote: 57, scale: DORIAN },
    exportFormats: ["png", "json", "video"],
    palette: ["#FF79CF", "#9B7CFF", "#55E7FF"],
  },
  {
    id: "light-trails",
    name: "Light Trails",
    tagline: "Draw with long exposures",
    description: "Every movement leaves a glowing trail, like a long-exposure photograph. Move faster for brighter sparks; pinch or double tap to change colour. Each sweep plays a note.",
    renderer: "canvas2d",
    tracking: ["hands"],
    persistentCanvas: true,
    parameters: [
      hue(45),
      { key: "persistence", label: "Persistence", min: 0.9, max: 1, step: 0.002, defaultValue: 0.992, description: "How long trails linger." },
      { key: "sparks", label: "Sparks", min: 0, max: 1, step: 0.05, defaultValue: 0.6, description: "Amount of particles shed by fast movement." },
      { key: "width", label: "Trail width", min: 1, max: 12, step: 0.5, defaultValue: 4, description: "Width of the light trail." },
    ],
    presets: [
      { id: "city-night", name: "City Night", parameters: { hue: 45, persistence: 0.992, sparks: 0.6, width: 4 } },
      { id: "neon-script", name: "Neon Script", parameters: { hue: 320, persistence: 0.995, sparks: 0.3, width: 3 } },
      { id: "comet", name: "Comet", parameters: { hue: 195, persistence: 0.96, sparks: 1, width: 7 } },
    ],
    gestureMappings: [
      { input: "Move hand", effect: "Paints a light trail" },
      { input: "Move faster", effect: "More sparks and brighter notes" },
      { input: "Pinch", effect: "Changes colour" },
      { input: "Height of hand", effect: "Pitch of melodic accents" },
    ],
    touchMappings: [
      { input: "Drag", effect: "Paints a light trail" },
      { input: "Fast swipe", effect: "More sparks and notes" },
      { input: "Double tap", effect: "Changes colour" },
    ],
    audio: { palette: "pluck", rootNote: 55, scale: PENTATONIC },
    exportFormats: ["png", "json", "video"],
    palette: ["#FFC86B", "#FF79CF", "#55E7FF"],
  },
  {
    id: "particle-bloom",
    name: "Particle Bloom",
    tagline: "Make light blossom",
    description: "Pinch or tap to make particles bloom. Hold to keep them flowing, and move two hands apart to push the blooms outward.",
    renderer: "canvas2d",
    tracking: ["hands", "pose"],
    persistentCanvas: false,
    parameters: [
      hue(280),
      { key: "density", label: "Density", min: 0.1, max: 1, step: 0.05, defaultValue: 0.6, description: "Particles per bloom." },
      { key: "expansion", label: "Expansion", min: 0.2, max: 2, step: 0.05, defaultValue: 1, description: "How far blooms travel." },
      { key: "gravity", label: "Drift", min: -1, max: 1, step: 0.05, defaultValue: -0.15, description: "Upward or downward drift of petals." },
    ],
    presets: [
      { id: "night-garden", name: "Night Garden", parameters: { hue: 280, density: 0.6, expansion: 1, gravity: -0.15 } },
      { id: "firework", name: "Firework", parameters: { hue: 20, density: 0.9, expansion: 1.6, gravity: 0.5 } },
      { id: "pollen", name: "Pollen", parameters: { hue: 90, density: 0.35, expansion: 0.5, gravity: -0.4 } },
    ],
    gestureMappings: [
      { input: "Pinch", effect: "Triggers a bloom" },
      { input: "Hold the pinch", effect: "Keeps particles flowing" },
      { input: "Pinch openness", effect: "Particle size" },
      { input: "Two hands apart", effect: "Pushes blooms outward" },
    ],
    touchMappings: [
      { input: "Tap", effect: "Triggers a bloom" },
      { input: "Press and drag", effect: "Keeps particles flowing" },
      { input: "Two-finger spread", effect: "Pushes blooms outward" },
    ],
    audio: { palette: "texture", rootNote: 62, scale: LYDIAN },
    exportFormats: ["png", "json", "video"],
    palette: ["#9B7CFF", "#FF79CF", "#FFC86B"],
  },
  {
    id: "cosmic-garden",
    name: "Cosmic Garden",
    tagline: "Grow a garden of stars",
    description: "Drift through a three-dimensional field of stars and glowing orbs. Move to change your viewpoint, pinch or tap to plant an orb, and spread two hands to grow the garden.",
    renderer: "webgl",
    tracking: ["hands"],
    persistentCanvas: false,
    parameters: [
      hue(220),
      { key: "drift", label: "Drift", min: 0, max: 1, step: 0.05, defaultValue: 0.35, description: "Speed of the flowing field." },
      { key: "scale", label: "Scale", min: 0.5, max: 2, step: 0.05, defaultValue: 1, description: "Resting size of the garden." },
      { key: "starDensity", label: "Stars", min: 0.2, max: 1, step: 0.05, defaultValue: 0.7, description: "Density of the star field." },
    ],
    presets: [
      { id: "deep-field", name: "Deep Field", parameters: { hue: 220, drift: 0.35, scale: 1, starDensity: 0.7 } },
      { id: "nebula", name: "Nebula", parameters: { hue: 300, drift: 0.6, scale: 1.4, starDensity: 0.9 } },
      { id: "still-orbit", name: "Still Orbit", parameters: { hue: 170, drift: 0.1, scale: 0.8, starDensity: 0.4 } },
    ],
    gestureMappings: [
      { input: "Move hand", effect: "Turns the viewpoint" },
      { input: "Pinch", effect: "Plants a glowing orb" },
      { input: "Two hands apart", effect: "Grows the garden" },
      { input: "Hold an open palm", effect: "Makes the garden pulse" },
    ],
    touchMappings: [
      { input: "Drag", effect: "Turns the viewpoint" },
      { input: "Tap", effect: "Plants a glowing orb" },
      { input: "Two-finger spread", effect: "Grows the garden" },
      { input: "Double tap", effect: "Makes the garden pulse" },
    ],
    audio: { palette: "drone", rootNote: 45, scale: LYDIAN },
    exportFormats: ["png", "json", "video"],
    palette: ["#55E7FF", "#9B7CFF", "#FF79CF"],
  },
  {
    id: "string-harp",
    name: "String Harp",
    tagline: "Pluck strings of light",
    description: "Glowing strings hang in the air in front of you. Sweep a hand or finger across them to pluck — faster sweeps ring louder. Open your palm to strum every string.",
    renderer: "canvas2d",
    tracking: ["hands"],
    persistentCanvas: false,
    parameters: [
      hue(40),
      { key: "strings", label: "Strings", min: 4, max: 16, step: 1, defaultValue: 10, description: "Number of strings across the view." },
      { key: "sustain", label: "Sustain", min: 0, max: 1, step: 0.05, defaultValue: 0.6, description: "How long each string rings." },
      { key: "tension", label: "Tension", min: 0.4, max: 2, step: 0.05, defaultValue: 1, description: "How fast the strings visibly vibrate." },
      { key: "spread", label: "Colour spread", min: 0, max: 30, step: 1, defaultValue: 10, description: "Hue difference between neighbouring strings." },
    ],
    presets: [
      { id: "golden-lyre", name: "Golden Lyre", parameters: { hue: 40, strings: 10, sustain: 0.6, tension: 1, spread: 10 } },
      { id: "laser-harp", name: "Laser Harp", parameters: { hue: 150, strings: 8, sustain: 0.8, tension: 1.6, spread: 25 } },
      { id: "koto", name: "Koto", parameters: { hue: 330, strings: 13, sustain: 0.35, tension: 0.7, spread: 4 } },
    ],
    gestureMappings: [
      { input: "Sweep across a string", effect: "Plucks it" },
      { input: "Sweep speed", effect: "Loudness" },
      { input: "Height of the pluck", effect: "Brighter near the ends" },
      { input: "Spread two hands apart", effect: "Adds shimmer" },
      { input: "Hold an open palm", effect: "Strums every string" },
    ],
    touchMappings: [
      { input: "Swipe across strings", effect: "Plucks them" },
      { input: "Tap", effect: "Plucks the nearest string" },
      { input: "Double tap", effect: "Strums every string" },
    ],
    audio: { palette: "harp", rootNote: 55, scale: PENTATONIC },
    exportFormats: ["png", "json", "video"],
    palette: ["#FFC86B", "#7CFFB2", "#55E7FF"],
  },
  {
    id: "ripple-pond",
    name: "Ripple Pond",
    tagline: "Touch the surface of light",
    description: "A pane of water floats in front of you. Pinch or tap to drop a stone, move through it to leave a wake, and open your palm to make it rain. Ripples cross and interfere like real water.",
    renderer: "canvas2d",
    tracking: ["hands"],
    persistentCanvas: false,
    parameters: [
      hue(195),
      { key: "calm", label: "Reach", min: 0, max: 1, step: 0.05, defaultValue: 0.5, description: "How far ripples travel before settling." },
      { key: "wake", label: "Wake", min: 0, max: 1, step: 0.05, defaultValue: 0.6, description: "How strongly movement disturbs the water." },
      { key: "glint", label: "Glint", min: 0.2, max: 1, step: 0.05, defaultValue: 0.7, description: "Brightness of light on the ripples." },
    ],
    presets: [
      { id: "moon-pool", name: "Moon Pool", parameters: { hue: 195, calm: 0.5, wake: 0.6, glint: 0.7 } },
      { id: "koi-garden", name: "Koi Garden", parameters: { hue: 25, calm: 0.75, wake: 0.8, glint: 0.85 } },
      { id: "still-lake", name: "Still Lake", parameters: { hue: 250, calm: 0.2, wake: 0.35, glint: 0.55 } },
    ],
    gestureMappings: [
      { input: "Pinch", effect: "Drops a stone" },
      { input: "Move your hand", effect: "Leaves a wake" },
      { input: "Spread two hands apart", effect: "Ripples travel further" },
      { input: "Hold an open palm", effect: "Rain shower" },
    ],
    touchMappings: [
      { input: "Tap", effect: "Drops a stone" },
      { input: "Drag", effect: "Leaves a wake" },
      { input: "Double tap", effect: "Rain shower" },
    ],
    audio: { palette: "water", rootNote: 60, scale: [0, 2, 4, 7, 9, 11] },
    exportFormats: ["png", "json", "video"],
    palette: ["#55E7FF", "#9B7CFF", "#7CFFB2"],
  },
  {
    id: "magnetic-field",
    name: "Magnetic Field",
    tagline: "Bend invisible forces",
    description: "A field of glowing filings surrounds you. Your hands push them aside; pinch to pull them in. The lines trace the shape of the force, and surges ring like bells.",
    renderer: "canvas2d",
    tracking: ["hands", "pose"],
    persistentCanvas: false,
    parameters: [
      hue(200),
      { key: "strength", label: "Strength", min: 0.1, max: 1, step: 0.05, defaultValue: 0.6, description: "How strongly hands push the field." },
      { key: "radius", label: "Reach", min: 0.05, max: 0.5, step: 0.01, defaultValue: 0.2, description: "Size of each hand's area of influence." },
      { key: "spring", label: "Snap back", min: 0, max: 1, step: 0.05, defaultValue: 0.5, description: "How quickly filings return home." },
      { key: "polarity", label: "Push or pull", min: -1, max: 1, step: 2, defaultValue: 1, description: "1 pushes filings away, -1 pulls them in." },
    ],
    presets: [
      { id: "aurora-flux", name: "Aurora Flux", parameters: { hue: 200, strength: 0.6, radius: 0.2, spring: 0.5, polarity: 1 } },
      { id: "gravity-well", name: "Gravity Well", parameters: { hue: 280, strength: 0.8, radius: 0.3, spring: 0.3, polarity: -1 } },
      { id: "iron-sand", name: "Iron Sand", parameters: { hue: 30, strength: 0.45, radius: 0.12, spring: 0.8, polarity: 1 } },
    ],
    gestureMappings: [
      { input: "Move your hand", effect: "Pushes the field" },
      { input: "Pinch", effect: "Pulls filings in" },
      { input: "Spread two hands apart", effect: "Widens your reach" },
      { input: "Hold an open palm", effect: "Sends a shockwave" },
    ],
    touchMappings: [
      { input: "Drag", effect: "Pushes the field" },
      { input: "Hold two fingers", effect: "Pulls filings in" },
      { input: "Tap / double tap", effect: "Pulse / shockwave" },
    ],
    audio: { palette: "chime", rootNote: 64, scale: [0, 2, 4, 6, 9] },
    exportFormats: ["png", "json", "video"],
    palette: ["#55E7FF", "#FF79CF", "#9B7CFF"],
  },
  {
    id: "piano",
    name: "Piano",
    tagline: "Play a keyboard of light",
    description: "A glass keyboard floats in front of you. Tap the keys, or pinch over a key in the air; slide to glide across them. Every note rises as a bar of light, so your melody draws itself.",
    renderer: "canvas2d",
    tracking: ["hands"],
    persistentCanvas: false,
    parameters: [
      hue(260),
      { key: "keys", label: "White keys", min: 8, max: 29, step: 1, defaultValue: 15, description: "How many white keys fit across the view." },
      { key: "octave", label: "Octave", min: 2, max: 6, step: 1, defaultValue: 4, description: "Octave of the leftmost C." },
      { key: "sustain", label: "Sustain pedal", min: 0, max: 1, step: 0.05, defaultValue: 0.3, description: "How long notes ring after you let go." },
      { key: "rainbow", label: "Note colours", min: 0, max: 1, step: 0.05, defaultValue: 0.6, description: "Give each pitch its own colour." },
    ],
    presets: [
      { id: "grand", name: "Grand", parameters: { hue: 260, keys: 15, octave: 4, sustain: 0.3, rainbow: 0.6 } },
      { id: "concert-hall", name: "Concert Hall", parameters: { hue: 210, keys: 22, octave: 3, sustain: 0.8, rainbow: 0.3 } },
      { id: "music-box", name: "Music Box", parameters: { hue: 320, keys: 10, octave: 5, sustain: 0.15, rainbow: 1 } },
    ],
    gestureMappings: [
      { input: "Pinch over a key", effect: "Plays it" },
      { input: "Slide while pinching", effect: "Glides across keys" },
      { input: "Two hands", effect: "Chords and duets" },
      { input: "Hold an open palm", effect: "Glissando" },
    ],
    touchMappings: [
      { input: "Tap or press a key", effect: "Plays it" },
      { input: "Slide across keys", effect: "Glissando" },
      { input: "Several fingers", effect: "Chords" },
      { input: "Double tap", effect: "Glissando run" },
    ],
    audio: { palette: "piano-room", rootNote: 48, scale: [0, 2, 4, 5, 7, 9, 11] },
    exportFormats: ["png", "json", "video"],
    palette: ["#B39CFF", "#55E7FF", "#FF79CF"],
  },
  {
    id: "flute",
    name: "Flute",
    tagline: "Breathe a melody",
    description: "Hold or pinch to blow. Move left and right to choose notes, which glide smoothly into each other, and raise your hand for more breath. A wave of light shows your pitch. Open your palm for a trill.",
    renderer: "canvas2d",
    tracking: ["hands"],
    persistentCanvas: false,
    parameters: [
      hue(175),
      { key: "range", label: "Notes", min: 5, max: 15, step: 1, defaultValue: 10, description: "How many notes span the view." },
      { key: "scale", label: "Scale", min: 0, max: 2, step: 1, defaultValue: 0, description: "0 major, 1 minor, 2 pentatonic." },
      { key: "octave", label: "Octave", min: 4, max: 6, step: 1, defaultValue: 5, description: "Register of the lowest note." },
      { key: "glide", label: "Glide", min: 0, max: 1, step: 0.05, defaultValue: 0.4, description: "How smoothly notes slide into each other." },
    ],
    presets: [
      { id: "concert-flute", name: "Concert Flute", parameters: { hue: 175, range: 10, scale: 0, octave: 5, glide: 0.4 } },
      { id: "shakuhachi", name: "Bamboo", parameters: { hue: 95, range: 8, scale: 2, octave: 5, glide: 0.8 } },
      { id: "piccolo", name: "Piccolo", parameters: { hue: 200, range: 12, scale: 0, octave: 6, glide: 0.15 } },
    ],
    gestureMappings: [
      { input: "Pinch", effect: "Blows a note" },
      { input: "Move left / right", effect: "Changes note (legato)" },
      { input: "Raise your hand", effect: "More breath, louder" },
      { input: "Hold an open palm", effect: "Trill" },
    ],
    touchMappings: [
      { input: "Press and hold", effect: "Blows a note" },
      { input: "Slide sideways", effect: "Changes note" },
      { input: "Slide up / down", effect: "Breath and loudness" },
      { input: "Double tap", effect: "Trill" },
    ],
    audio: { palette: "flute-air", rootNote: 72, scale: [0, 2, 4, 5, 7, 9, 11] },
    exportFormats: ["png", "json", "video"],
    palette: ["#55E7FF", "#7CFFB2", "#B39CFF"],
  },
  {
    id: "trumpet",
    name: "Trumpet",
    tagline: "Blast golden fanfares",
    description: "Hold or pinch to play. Each new note is tongued with a bright brassy attack, and golden rings flare from your hand. Raise your hand to play louder, and open your palm for a fanfare.",
    renderer: "canvas2d",
    tracking: ["hands"],
    persistentCanvas: false,
    parameters: [
      hue(42),
      { key: "range", label: "Notes", min: 5, max: 15, step: 1, defaultValue: 8, description: "How many notes span the view." },
      { key: "scale", label: "Scale", min: 0, max: 2, step: 1, defaultValue: 0, description: "0 major, 1 minor, 2 pentatonic." },
      { key: "octave", label: "Octave", min: 3, max: 5, step: 1, defaultValue: 4, description: "Register of the lowest note." },
      { key: "key", label: "Key", min: -6, max: 6, step: 1, defaultValue: -2, description: "Transpose in semitones (trumpets love B♭)." },
    ],
    presets: [
      { id: "fanfare", name: "Fanfare", parameters: { hue: 42, range: 8, scale: 0, octave: 4, key: -2 } },
      { id: "jazz-club", name: "Jazz Club", parameters: { hue: 20, range: 10, scale: 1, octave: 4, key: 3 } },
      { id: "mariachi", name: "Mariachi", parameters: { hue: 0, range: 8, scale: 2, octave: 5, key: 0 } },
    ],
    gestureMappings: [
      { input: "Pinch", effect: "Plays a note" },
      { input: "Move left / right", effect: "Tongues a new note" },
      { input: "Raise your hand", effect: "Louder and brighter" },
      { input: "Hold an open palm", effect: "Fanfare" },
    ],
    touchMappings: [
      { input: "Press and hold", effect: "Plays a note" },
      { input: "Quick taps", effect: "Staccato notes" },
      { input: "Slide sideways", effect: "Changes note" },
      { input: "Double tap", effect: "Fanfare" },
    ],
    audio: { palette: "brass-hall", rootNote: 58, scale: [0, 2, 4, 5, 7, 9, 11] },
    exportFormats: ["png", "json", "video"],
    palette: ["#FFC86B", "#FF79CF", "#FFE7A0"],
  },
  {
    id: "orchestra",
    name: "Orchestra",
    tagline: "Conduct a full ensemble",
    description: "You are the conductor. Beat time with downward strokes, taps or pinches and the orchestra plays through the progression at your tempo. Raise your hand for forte, point to bring a section forward, and open your palm to cut everyone off.",
    renderer: "canvas2d",
    tracking: ["hands", "pose"],
    persistentCanvas: false,
    parameters: [
      hue(45),
      { key: "mood", label: "Mood", min: 0, max: 2, step: 1, defaultValue: 0, description: "0 Heroic, 1 Nocturne, 2 Hymn." },
      { key: "transpose", label: "Transpose", min: -6, max: 6, step: 1, defaultValue: 0, description: "Shift the key in semitones." },
      { key: "sensitivity", label: "Beat sensitivity", min: 0.5, max: 2, step: 0.1, defaultValue: 1, description: "How big a stroke counts as a beat (higher needs bigger strokes)." },
    ],
    presets: [
      { id: "heroic", name: "Heroic", parameters: { hue: 45, mood: 0, transpose: 0, sensitivity: 1 } },
      { id: "nocturne", name: "Nocturne", parameters: { hue: 250, mood: 1, transpose: 0, sensitivity: 1 } },
      { id: "hymn", name: "Hymn", parameters: { hue: 160, mood: 2, transpose: 0, sensitivity: 1 } },
    ],
    gestureMappings: [
      { input: "Downward stroke or pinch", effect: "Beat — sets the tempo" },
      { input: "Raise or lower your hand", effect: "Dynamics, piano to forte" },
      { input: "Point left / centre / right", effect: "Strings / woodwinds / brass" },
      { input: "Spread two hands", effect: "Widens the ensemble" },
      { input: "Hold an open palm", effect: "Cut-off" },
    ],
    touchMappings: [
      { input: "Tap or downward swipe", effect: "Beat" },
      { input: "Drag up / down", effect: "Dynamics" },
      { input: "Drag left / right", effect: "Feature a section" },
      { input: "Double tap", effect: "Cut-off" },
    ],
    audio: { palette: "orchestra-hall", rootNote: 48, scale: [0, 2, 4, 5, 7, 9, 11] },
    exportFormats: ["png", "json", "video"],
    palette: ["#FFC86B", "#FF79CF", "#7CFFB2"],
  },
  {
    id: "drum-kit",
    name: "Drum Kit",
    tagline: "Play a kit made of light",
    description: "Nine pads laid out like a real kit: kick, snare, hi-hats, three toms, crash and ride. Tap them, or strike down through a pad with your hand like a stick — harder strikes hit louder. Your groove scrolls past at the top.",
    renderer: "canvas2d",
    tracking: ["hands"],
    persistentCanvas: false,
    parameters: [
      { key: "size", label: "Pad size", min: 0.7, max: 1.4, step: 0.05, defaultValue: 1, description: "Size of the drum pads." },
      { key: "sensitivity", label: "Strike sensitivity", min: 0.5, max: 2, step: 0.1, defaultValue: 1, description: "How fast a hand strike must be (higher needs faster strikes)." },
      { key: "volume", label: "Kit volume", min: 0.3, max: 1, step: 0.05, defaultValue: 0.85, description: "Overall loudness of the drums." },
    ],
    presets: [
      { id: "studio-kit", name: "Studio Kit", parameters: { size: 1, sensitivity: 1, volume: 0.85 } },
      { id: "big-pads", name: "Big Pads", parameters: { size: 1.3, sensitivity: 0.8, volume: 0.85 } },
      { id: "quiet-practice", name: "Quiet Practice", parameters: { size: 1, sensitivity: 1, volume: 0.45 } },
    ],
    gestureMappings: [
      { input: "Strike down through a pad", effect: "Hits it" },
      { input: "Strike speed", effect: "Loudness" },
      { input: "Pinch over a pad", effect: "Gentle hit" },
      { input: "Hold an open palm", effect: "Kick + crash finish" },
    ],
    touchMappings: [
      { input: "Tap a pad", effect: "Hits it" },
      { input: "Slide across pads", effect: "Rolls" },
      { input: "Several fingers", effect: "Hit together" },
      { input: "Double tap", effect: "Kick + crash finish" },
    ],
    audio: { palette: "drum-room", rootNote: 36, scale: [0, 2, 4, 5, 7, 9, 11] },
    exportFormats: ["png", "json", "video"],
    palette: ["#55E7FF", "#FF79CF", "#FFC86B"],
  },
  {
    id: "freestyle-drums",
    name: "Freestyle Drums",
    tagline: "Air-drum anywhere, loop your groove",
    description: "No pads — strike anywhere. High hits are cymbals, then hi-hats, toms and snare across the middle, kick at the bottom. The looper records your hits into a two-bar loop at your tempo so you can layer a beat.",
    renderer: "canvas2d",
    tracking: ["hands"],
    persistentCanvas: false,
    parameters: [
      { key: "tempo", label: "Tempo", min: 50, max: 180, step: 1, defaultValue: 96, description: "Loop speed in beats per minute." },
      { key: "looper", label: "Looper", min: 0, max: 1, step: 1, defaultValue: 1, description: "1 records and replays your hits; 0 plays freely." },
      { key: "quantize", label: "Quantize", min: 0, max: 1, step: 0.05, defaultValue: 0.5, description: "How strongly looped hits snap to sixteenth notes." },
      { key: "sensitivity", label: "Strike sensitivity", min: 0.5, max: 2, step: 0.1, defaultValue: 1, description: "How fast a hand strike must be (higher needs faster strikes)." },
      { key: "volume", label: "Kit volume", min: 0.3, max: 1, step: 0.05, defaultValue: 0.85, description: "Overall loudness." },
    ],
    presets: [
      { id: "jam", name: "Jam Session", parameters: { tempo: 96, looper: 1, quantize: 0.5, sensitivity: 1, volume: 0.85 } },
      { id: "free-play", name: "Free Play", parameters: { tempo: 96, looper: 0, quantize: 0, sensitivity: 1, volume: 0.85 } },
      { id: "breakbeat", name: "Breakbeat", parameters: { tempo: 140, looper: 1, quantize: 0.9, sensitivity: 0.9, volume: 0.9 } },
    ],
    gestureMappings: [
      { input: "Strike anywhere", effect: "Plays the drum for that zone" },
      { input: "Strike speed", effect: "Loudness" },
      { input: "Height of the hit", effect: "Cymbals → hats → toms → kick" },
      { input: "Hold an open palm", effect: "Clears the loop" },
    ],
    touchMappings: [
      { input: "Tap anywhere", effect: "Plays the drum for that zone" },
      { input: "Several fingers", effect: "Hits together" },
      { input: "Double tap", effect: "Clears the loop" },
    ],
    audio: { palette: "drum-loop", rootNote: 36, scale: [0, 2, 4, 5, 7, 9, 11] },
    exportFormats: ["png", "json", "video"],
    palette: ["#FF79CF", "#55E7FF", "#FFC86B"],
  },
];

export const INSTRUMENT_IDS = INSTRUMENTS.map((i) => i.id);

export function isInstrumentId(value: unknown): value is InstrumentId {
  return typeof value === "string" && (INSTRUMENT_IDS as string[]).includes(value);
}

export function getInstrument(id: InstrumentId): InstrumentDefinition {
  const definition = INSTRUMENTS.find((i) => i.id === id);
  if (!definition) throw new Error(`Unknown instrument: ${id}`);
  return definition;
}

export function defaultParameters(definition: InstrumentDefinition): InstrumentParameters {
  return Object.fromEntries(definition.parameters.map((p) => [p.key, p.defaultValue]));
}

/**
 * Coerces arbitrary parameter input (e.g. from an imported file) into a
 * complete, in-range parameter set. Unknown keys are dropped.
 */
export function sanitizeParameters(definition: InstrumentDefinition, input: Record<string, unknown>): InstrumentParameters {
  const result: InstrumentParameters = {};
  for (const spec of definition.parameters) {
    const value = input[spec.key];
    result[spec.key] = isFiniteNumber(value) ? clamp(value, spec.min, spec.max) : spec.defaultValue;
  }
  return result;
}

/** Returns a list of problems with an instrument definition (empty when valid). */
export function validateInstrumentDefinition(definition: InstrumentDefinition): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const spec of definition.parameters) {
    if (keys.has(spec.key)) problems.push(`duplicate parameter ${spec.key}`);
    keys.add(spec.key);
    if (!(spec.min < spec.max)) problems.push(`${spec.key}: min must be below max`);
    if (spec.defaultValue < spec.min || spec.defaultValue > spec.max) problems.push(`${spec.key}: default out of range`);
    if (spec.step <= 0) problems.push(`${spec.key}: step must be positive`);
  }
  if (definition.presets.length === 0) problems.push("needs at least one preset");
  const presetIds = new Set<string>();
  for (const preset of definition.presets) {
    if (presetIds.has(preset.id)) problems.push(`duplicate preset ${preset.id}`);
    presetIds.add(preset.id);
    for (const [key, value] of Object.entries(preset.parameters)) {
      const spec = definition.parameters.find((p) => p.key === key);
      if (!spec) problems.push(`preset ${preset.id}: unknown parameter ${key}`);
      else if (value < spec.min || value > spec.max) problems.push(`preset ${preset.id}: ${key} out of range`);
    }
  }
  if (definition.gestureMappings.length === 0 || definition.touchMappings.length === 0) problems.push("needs gesture and touch mappings");
  if (definition.gestureMappings.length > 5) problems.push("too many gesture mappings for a discoverable vocabulary");
  if (definition.audio.scale.length === 0) problems.push("audio scale is empty");
  return problems;
}

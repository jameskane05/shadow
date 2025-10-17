/**
 * SFX Data Structure (Howler.js format)
 *
 * Each sound effect contains:
 * - id: Unique identifier for the sound
 * - src: Path to the audio file (or array of paths for fallbacks)
 * - volume: Default volume for this sound (0-1), optional, defaults to 1.0
 * - loop: Whether the sound should loop, optional, defaults to false
 * - preload: Whether to preload this sound (default: true)
 * - rate: Playback speed (1.0 = normal), optional
 * - criteria: Optional object with key-value pairs that must match game state for sound to play
 *   - Simple equality: { currentState: GAME_STATES.PHONE_BOOTH_RINGING }
 *   - Comparison operators: { currentState: { $gte: GAME_STATES.INTRO, $lt: GAME_STATES.DRIVE_BY } }
 *   - Multiple conditions: { currentState: GAME_STATES.INTRO, testCondition: true }
 *   - Operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin
 *   - If criteria matches and sound is not playing → play it
 *   - If criteria doesn't match and sound is playing → stop it
 * - playOnce: If true, sound only plays once per game session (for one-shots triggered by state)
 * - delay: Delay in seconds before playing after state conditions are met (default: 0)
 *
 * For 3D spatial audio, also include:
 * - spatial: true to indicate this is a 3D positioned sound
 * - position: {x, y, z} position in 3D space (applied via howl.pos() method)
 * - pannerAttr: Spatial audio properties (applied via howl.pannerAttr() method)
 *   - panningModel: 'equalpower' or 'HRTF' (default: 'HRTF')
 *   - refDistance: Reference distance for rolloff (default: 1)
 *   - rolloffFactor: How quickly sound fades with distance (default: 1)
 *   - distanceModel: 'linear', 'inverse', or 'exponential' (default: 'inverse')
 *   - maxDistance: Maximum distance sound is audible (default: 10000)
 *   - coneInnerAngle: Inner cone angle in degrees (default: 360)
 *   - coneOuterAngle: Outer cone angle in degrees (default: 360)
 *   - coneOuterGain: Gain outside outer cone (default: 0)
 *
 * For audio-reactive lighting, also include:
 * - reactiveLight: Configuration for a light that responds to audio amplitude
 *   - enabled: true to enable the reactive light
 *   - type: THREE.js light type ('PointLight', 'SpotLight', 'DirectionalLight')
 *   - color: Light color in hex (e.g., 0xff0000 for red)
 *   - position: {x, y, z} OFFSET from sound position (e.g., {x: 0, y: 3, z: 0} for 3 units above)
 *   - baseIntensity: Intensity when audio is silent (default: 0)
 *   - reactivityMultiplier: How much audio affects intensity (default: 10)
 *   - distance: Light distance (PointLight only)
 *   - decay: Light decay (PointLight only)
 *   - smoothing: Smoothing factor for intensity changes (0-1, default: 0.5)
 *   - frequencyRange: Which frequencies to react to ('bass', 'mid', 'high', 'full')
 *   - maxIntensity: Maximum light intensity (default: 100)
 *   - noiseFloor: Ignore audio below this threshold to prevent flicker (default: 0.1)
 *
 * Usage:
 * import { sfxSounds } from './sfxData.js';
 *
 * // Create Howl with constructor options only
 * const soundData = sfxSounds['phone-ring'];
 * const howl = new Howl({
 *   src: soundData.src,
 *   loop: soundData.loop,
 *   volume: soundData.volume,
 *   preload: soundData.preload
 * });
 *
 * // Apply spatial properties AFTER creation (if spatial)
 * if (soundData.spatial) {
 *   howl.pos(soundData.position.x, soundData.position.y, soundData.position.z);
 *   howl.pannerAttr(soundData.pannerAttr);
 * }
 *
 * sfxManager.registerSound('phone-ring', howl, soundData.volume);
 *
 * // In collider data (colliderData.js):
 * onEnter: [
 *   { type: "sfx", data: { sound: "phone-ring", volume: 0.8 } }
 * ]
 */

import { GAME_STATES } from "./gameData.js";
import { sceneObjects } from "./sceneData.js";

export const sfxSounds = {
  // Phone booth ringing (3D spatial audio)
  "phone-ring": {
    id: "phone-ring",
    src: ["/audio/sfx/phone-ringing.mp3"],
    volume: 1,
    loop: true,
    spatial: true,
    position: {
      x: sceneObjects.phonebooth.position.x,
      y: 0.9,
      z: sceneObjects.phonebooth.position.z,
    },
    pannerAttr: {
      panningModel: "HRTF",
      refDistance: 10,
      rolloffFactor: 2,
      distanceModel: "inverse",
      maxDistance: 100,
    },
    preload: true,
    criteria: {
      currentState: {
        $gte: GAME_STATES.PHONE_BOOTH_RINGING,
        $lt: GAME_STATES.ANSWERED_PHONE,
      },
    },
    // Audio-reactive light configuration
    reactiveLight: {
      enabled: true,
      type: "PointLight", // THREE.js light type
      color: 0xff0000, // Dramatic red light
      position: { x: 0, y: 1.7, z: 0 }, // Offset from sound position (above phone booth)
      baseIntensity: 0.0, // Completely off when silent
      reactivityMultiplier: 50.0, // Much more dramatic
      distance: 20, // Wider reach
      decay: 2,
      smoothing: 0.6, // Slightly more responsive
      frequencyRange: "full", // 'bass', 'mid', 'high', 'full'
      maxIntensity: 250.0, // Higher peak intensity
      noiseFloor: 0.125, // Ignore audio below 10% to prevent reverb flicker
    },
  },

  "footsteps-gravel": {
    id: "footsteps-gravel",
    src: ["/audio/sfx/gravel-steps.ogg"],
    volume: 0.7,
    loop: true,
    spatial: false,
    preload: true,
  },

  // Ambient sounds (non-spatial)
  "city-ambiance": {
    id: "city-ambiance",
    src: ["/audio/sfx/city-ambiance.mp3"],
    volume: 0.3,
    loop: true,
    spatial: false,
    preload: true,
    criteria: { currentState: { $gte: GAME_STATES.START_SCREEN } },
  },

  // One-shot effects
  "phone-pickup": {
    id: "phone-pickup",
    src: ["/audio/sfx/phone-pickup.mp3"],
    volume: 0.8,
    loop: false,
    spatial: true,
    position: {
      x: sceneObjects.phonebooth.position.x,
      y: sceneObjects.phonebooth.position.y,
      z: sceneObjects.phonebooth.position.z,
    },
    pannerAttr: {
      panningModel: "HRTF",
      refDistance: 2,
      rolloffFactor: 1.5,
      distanceModel: "inverse",
      maxDistance: 15,
    },
    preload: true,
    criteria: { currentState: GAME_STATES.ANSWERED_PHONE },
    playOnce: true, // One-shot sound triggered by state
  },

  "engine-and-gun": {
    id: "engine-and-gun",
    src: ["/audio/sfx/engine-and-gun.mp3"],
    volume: 0.9,
    loop: false,
    spatial: false, // Non-spatial for dramatic effect
    preload: true,
    criteria: { currentState: GAME_STATES.DRIVE_BY },
    playOnce: true, // One-shot sound triggered by state
  },

  // Typewriter sounds for dialog choices
  "typewriter-keystroke-00": {
    id: "typewriter-keystroke-00",
    src: ["/audio/sfx/typewriter-keystroke-00.mp3"],
    volume: 0.6,
    loop: false,
    spatial: false,
    preload: true,
  },

  "typewriter-keystroke-01": {
    id: "typewriter-keystroke-01",
    src: ["/audio/sfx/typewriter-keystroke-01.mp3"],
    volume: 0.4,
    loop: false,
    spatial: false,
    preload: true,
  },

  "typewriter-keystroke-02": {
    id: "typewriter-keystroke-02",
    src: ["/audio/sfx/typewriter-keystroke-02.mp3"],
    volume: 0.4,
    loop: false,
    spatial: false,
    preload: true,
  },

  "typewriter-keystroke-03": {
    id: "typewriter-keystroke-03",
    src: ["/audio/sfx/typewriter-keystroke-03.mp3"],
    volume: 0.4,
    loop: false,
    spatial: false,
    preload: true,
  },

  "typewriter-return": {
    id: "typewriter-return",
    src: ["/audio/sfx/typewriter-return.mp3"],
    volume: 0.3,
    loop: false,
    spatial: false,
    preload: true,
  },

  "punch-sound": {
    id: "punch-sound",
    src: ["/audio/sfx/punch.mp3"],
    volume: 0.7,
    loop: false,
    spatial: false,
    preload: true,
    criteria: { currentState: GAME_STATES.PUNCH_OUT },
    playOnce: true,
    delay: 0.35,
  },

  "body-fall": {
    id: "body-fall",
    src: ["/audio/sfx/body-fall.mp3"],
    volume: 0.7,
    loop: false,
    spatial: false,
    preload: true,
    criteria: { currentState: { $gte: GAME_STATES.PUNCH_OUT } },
    playOnce: true,
    delay: 1.5,
  },

  // Radio audio (3D spatial audio with reactive light)
  radio: {
    id: "radio",
    src: ["/audio/music/radio-mooch.mp3"], // Radio playing classical music
    volume: 0.6,
    loop: true,
    spatial: true,
    position: sceneObjects.radio.position,
    pannerAttr: {
      panningModel: "HRTF",
      refDistance: 6,
      rolloffFactor: 1,
      distanceModel: "linear",
      maxDistance: 12,
    },
    preload: true,
    criteria: {
      currentState: { $gte: GAME_STATES.NEAR_RADIO },
    },
    // Audio-reactive light configuration
    reactiveLight: {
      enabled: true,
      type: "PointLight",
      color: 0xfff,
      position: { x: 0, y: 1.2, z: 0 },
      baseIntensity: 1.0,
      reactivityMultiplier: 20.0,
      distance: 15,
      decay: 1,
      smoothing: 0.7, // Smooth transitions for music
      frequencyRange: "mid", // React to mid-range frequencies (vocals/melody)
      maxIntensity: 100.0,
      noiseFloor: 0.1, // Ignore quiet audio to prevent flicker
    },
  },
};

/**
 * Helper function to get sound data by ID
 * @param {string} id - Sound ID
 * @returns {Object|null} Sound data or null if not found
 */
export function getSoundData(id) {
  return sfxSounds[id] || null;
}

/**
 * Helper function to get all sound IDs
 * @returns {Array<string>} Array of all sound IDs
 */
export function getAllSoundIds() {
  return Object.keys(sfxSounds);
}

/**
 * Helper function to get all spatial sound IDs
 * @returns {Array<string>} Array of spatial sound IDs
 */
export function getSpatialSoundIds() {
  return Object.keys(sfxSounds).filter((id) => sfxSounds[id].spatial === true);
}

/**
 * Helper function to get all looping sound IDs
 * @returns {Array<string>} Array of looping sound IDs
 */
export function getLoopingSoundIds() {
  return Object.keys(sfxSounds).filter((id) => sfxSounds[id].loop === true);
}

export default sfxSounds;

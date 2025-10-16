import { GAME_STATES, startScreen } from "./gameData.js";
import { sceneObjects } from "./sceneData.js";

/**
 * DebugSpawner - Debug utility for spawning into specific game states
 *
 * Usage:
 * - Add ?gameState=<STATE_NAME> to URL (e.g., ?gameState=DRIVE_BY)
 * - All managers will initialize with correct state (music, SFX, dialogs, scenes)
 * - Any state name from GAME_STATES in gameData.js is automatically supported
 * - Custom overrides can be defined in stateOverrides for specific positioning/settings
 */

/**
 * Custom overrides for specific states that need non-default settings
 */
const stateOverrides = {
  START_SCREEN: {
    controlEnabled: false,
    // No playerPosition - use main.js default
  },

  TITLE_SEQUENCE: {
    controlEnabled: false,
    // No playerPosition - use main.js default
  },

  TITLE_SEQUENCE_COMPLETE: {
    controlEnabled: true,
    // No playerPosition - use main.js default
  },

  INTRO_COMPLETE: {
    isPlaying: true,
    controlEnabled: true,
    // No playerPosition - use main.js default
  },

  PHONE_BOOTH_RINGING: {
    isPlaying: true,
    controlEnabled: true,
    playerPosition: {
      x: sceneObjects.phonebooth.position.x + 5,
      y: 0.9,
      z: sceneObjects.phonebooth.position.z - 8,
    },
  },

  ANSWERED_PHONE: {
    isPlaying: true,
    controlEnabled: true,
    playerPosition: {
      x: sceneObjects.phonebooth.position.x,
      y: 0.9,
      z: sceneObjects.phonebooth.position.z,
    },
  },

  DIALOG_CHOICE_1: {
    isPlaying: true,
    controlEnabled: true,
  },

  DRIVE_BY_PREAMBLE: {
    isPlaying: true,
    controlEnabled: true,
  },

  DRIVE_BY: {
    isPlaying: true,
    controlEnabled: true,
  },
};

/**
 * Generate a default preset for any game state
 * @param {number} stateValue - The GAME_STATES value
 * @returns {Object} State preset
 */
function createDefaultPreset(stateValue) {
  return {
    ...startScreen, // Includes playerPosition: {x:0, y:0, z:0} from startScreen
    currentState: stateValue,
    controlEnabled: true,
    // playerPosition can be overridden to undefined to use main.js default
  };
}

/**
 * Get state preset - dynamically supports all GAME_STATES
 * @param {string} stateName - Name of the state (e.g., "DRIVE_BY")
 * @returns {Object} State preset
 */
function getStatePreset(stateName) {
  // Check if this is a valid GAME_STATE
  if (!(stateName in GAME_STATES)) {
    return null;
  }

  const stateValue = GAME_STATES[stateName];
  const defaultPreset = createDefaultPreset(stateValue);
  const overrides = stateOverrides[stateName] || {};

  return {
    ...defaultPreset,
    ...overrides,
  };
}

/**
 * Debug state presets - dynamically generated for all GAME_STATES
 */
export const debugStatePresets = new Proxy(
  {},
  {
    get(target, prop) {
      if (typeof prop === "string" && prop in GAME_STATES) {
        return getStatePreset(prop);
      }
      return undefined;
    },
    has(target, prop) {
      return typeof prop === "string" && prop in GAME_STATES;
    },
    ownKeys() {
      return Object.keys(GAME_STATES);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string" && prop in GAME_STATES) {
        return {
          enumerable: true,
          configurable: true,
        };
      }
      return undefined;
    },
  }
);

/**
 * Parse URL and get debug state preset
 * @returns {Object|null} State preset if debug spawn is requested, null otherwise
 */
export function getDebugSpawnState() {
  const urlParams = new URLSearchParams(window.location.search);
  const gameStateParam = urlParams.get("gameState");

  if (!gameStateParam) {
    return null;
  }

  // Try to find matching preset
  const preset = debugStatePresets[gameStateParam];

  if (!preset) {
    console.warn(
      `DebugSpawner: Unknown gameState "${gameStateParam}". Available states:`,
      Object.keys(debugStatePresets)
    );
    return null;
  }

  console.log(`DebugSpawner: Spawning into state "${gameStateParam}"`);
  return { ...preset };
}

/**
 * Check if debug spawn is active
 * @returns {boolean}
 */
export function isDebugSpawnActive() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.has("gameState");
}

/**
 * Get the name of the current debug spawn state
 * @returns {string|null}
 */
export function getDebugSpawnStateName() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("gameState");
}

/**
 * Apply character position from debug state
 * @param {Object} character - Physics character/rigid body
 * @param {Object} debugState - Debug state preset
 */
export function applyDebugCharacterPosition(character, debugState) {
  if (!character || !debugState || !debugState.playerPosition) {
    return;
  }

  const pos = debugState.playerPosition;
  character.translation.x = pos.x;
  character.translation.y = pos.y;
  character.translation.z = pos.z;

  console.log(
    `DebugSpawner: Set character position to (${pos.x}, ${pos.y}, ${pos.z})`
  );
}

export default {
  getDebugSpawnState,
  isDebugSpawnActive,
  getDebugSpawnStateName,
  applyDebugCharacterPosition,
  debugStatePresets,
};

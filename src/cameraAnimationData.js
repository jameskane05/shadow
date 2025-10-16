/**
 * Camera Animation Data Structure
 *
 * Defines camera animations, lookats, and character movements triggered by game state changes.
 *
 * Common properties:
 * - id: Unique identifier
 * - type: "animation", "lookat", or "moveTo"
 * - description: Human-readable description
 * - criteria: Optional object with key-value pairs that must match game state
 *   - Simple equality: { currentState: GAME_STATES.INTRO }
 *   - Comparison operators: { currentState: { $gte: GAME_STATES.INTRO, $lt: GAME_STATES.PHONE_BOOTH_RINGING } }
 *   - Operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin
 * - priority: Higher priority animations are checked first (default: 0)
 * - playOnce: If true, only plays once per game session (default: false)
 * - delay: Delay in seconds before playing after state conditions are met (default: 0)
 *
 * Type-specific properties:
 *
 * For type "animation" or "jsonAnimation":
 * - path: Path to the animation JSON file
 * - syncController: If true, sync character controller yaw/pitch to final camera pose (default: true)
 * - restoreInput: If true, restore input controls when complete (default: true)
 * - scaleY: Optional Y-axis scale multiplier for animation (default: 1.0)
 *   - Values < 1.0 compress vertical motion, > 1.0 expand it
 *   - Example: 0.8 would reduce vertical movement by 20%
 *
 * For type "lookat":
 * - position: {x, y, z} world position to look at
 * - transitionTime: Time for the initial look-at transition in seconds (default: 2.0)
 * - returnToOriginalView: If true, return to original view before restoring control (default: false)
 * - returnTransitionTime: Time for the return transition in seconds (default: same as transitionTime)
 *   Note: Only used if returnToOriginalView is true. Can be different from initial transition.
 * - enableZoom: If true, enable zoom/DoF effect (default: false)
 * - zoomOptions: Optional zoom configuration
 *   - zoomFactor: Camera zoom multiplier (e.g., 2.0 for 2x zoom)
 *   - minAperture: DoF effect strength at peak
 *   - maxAperture: DoF effect strength at rest
 *   - transitionStart: When to start zoom (0-1, fraction of transitionTime)
 *   - transitionDuration: How long zoom IN and OUT transitions take in seconds
 *   - holdDuration: How long to hold at target. If returnToOriginalView=true, holds before return
 *                   (DoF/zoom reset DURING the return animation). If returnToOriginalView=false, holds
 *                   after lookat completes, then zoom/DoF transitions back over transitionDuration.
 * - onComplete: Optional callback when lookat completes. Receives gameManager as parameter.
 *   Example: onComplete: (gameManager) => { gameManager.setState({...}); }
 *
 * Input control: Always disabled during lookat. Restored when complete, or if zoom is enabled without
 *                returnToOriginalView, restored after holdDuration + transitionDuration.
 *
 * For type "moveTo":
 * - position: {x, y, z} world position to move character to
 * - rotation: {yaw, pitch} target rotation in radians (optional)
 * - transitionTime: Time for the movement transition in seconds (default: 2.0)
 * - inputControl: What input to disable during movement
 *   - disableMovement: Disable movement input (default: true)
 *   - disableRotation: Disable rotation input (default: true)
 * - onComplete: Optional callback when movement completes (no parameters passed)
 *
 * For type "fade":
 * - color: THREE.Color or {r, g, b} color to fade to (default: white {r:1, g:1, b:1})
 * - fadeInTime: Time to fade in (go to full opacity) in seconds (default: 0.1)
 * - holdTime: Time to hold at full opacity in seconds (default: 0)
 * - fadeOutTime: Time to fade out (go to zero opacity) in seconds (default: 1.0)
 * - maxOpacity: Maximum opacity to reach (0-1, default: 1.0)
 * - onComplete: Optional callback when fade completes (no parameters passed)
 *
 * Usage:
 * import { cameraAnimations, getCameraAnimationForState } from './cameraAnimationData.js';
 */

import { GAME_STATES } from "./gameData.js";
import { checkCriteria } from "./criteriaHelper.js";
import { videos } from "./videoData.js";
import { sceneObjects } from "./sceneData.js";

export const cameraAnimations = {
  phoneBoothLookat: {
    id: "phoneBoothLookat",
    type: "lookat",
    description: "Look at phone booth when it starts ringing",
    position: {
      x: sceneObjects.phonebooth.position.x,
      y: 0.9,
      z: sceneObjects.phonebooth.position.z,
    },
    transitionTime: 1,
    enableZoom: true, // Enable dramatic zoom/DoF when looking at phone booth
    zoomOptions: {
      zoomFactor: 2.0, // More dramatic 2x zoom
      minAperture: 0.2, // Stronger DoF effect
      maxAperture: 0.4,
      transitionStart: 0.5, // Start zooming earlier (60% of look-at)
      transitionDuration: 2.5, // Slower, more dramatic transition
      holdDuration: 2.0, // Hold the zoom longer for dramatic effect
    },
    criteria: { currentState: GAME_STATES.PHONE_BOOTH_RINGING },
    priority: 100,
    playOnce: true,
    delay: 0.25, // Wait 0.5 seconds before looking at phone booth
  },

  phoneBoothMoveTo: {
    id: "phoneBoothMoveTo",
    type: "moveTo",
    description: "Move character into phone booth when player enters trigger",
    position: {
      x: sceneObjects.phonebooth.position.x,
      y: 0.4,
      z: sceneObjects.phonebooth.position.z - 0.2,
    },
    rotation: {
      yaw: Math.PI, // Face the phone (90 degrees)
      pitch: 0,
    },
    transitionTime: 1.5,
    inputControl: {
      disableMovement: true, // Disable movement
      disableRotation: false, // Allow rotation (player can look around)
    },
    criteria: { currentState: GAME_STATES.ANSWERED_PHONE },
    priority: 100,
    playOnce: true,
    // Note: Movement stays disabled until manually restored (e.g., after phone interaction)
  },

  catLookat: {
    id: "catLookat",
    type: "lookat",
    description: "Look at cat video when player hears cat sound",
    position: videos.cat.position,
    transitionTime: 0.75,
    returnToOriginalView: true,
    returnTransitionTime: 1.25,
    enableZoom: true,
    zoomOptions: {
      zoomFactor: 1.8,
      minAperture: 0.15,
      maxAperture: 0.35,
      transitionStart: 0.7,
      transitionDuration: 2.0,
      holdDuration: 3.25,
    },
    criteria: { heardCat: true },
    playOnce: true,
    priority: 100,
    onComplete: (gameManager) => {
      gameManager.setState({ currentState: GAME_STATES.CAT_DIALOG_CHOICE });
    },
  },

  carLookat: {
    id: "carLookat",
    type: "lookat",
    description: "Look at car from within phone booth",
    position: { x: -5.9, y: 0.76, z: 68.35 },
    transitionTime: 1,
    enableZoom: true, // Enable dramatic zoom/DoF when looking at phone booth
    zoomOptions: {
      zoomFactor: 2.0, // More dramatic 2x zoom
      minAperture: 0.2, // Stronger DoF effect
      maxAperture: 0.4,
      transitionStart: 0.5, // Start zooming earlier (60% of look-at)
      transitionDuration: 2.5, // Slower, more dramatic transition
      holdDuration: 2.0, // Hold the zoom longer for dramatic effect
    },
    criteria: { currentState: GAME_STATES.DRIVE_BY_PREAMBLE },
    inputControl: {
      disableMovement: true, // Disable movement
      disableRotation: true, // Allow rotation (player can look around)
    },
    priority: 100,
    playOnce: true,
    delay: 0, // Wait 0.5 seconds before looking at phone booth
  },

  lookAndJump: {
    id: "lookAndJump",
    type: "jsonAnimation",
    path: "/json/look-and-jump.json",
    description: "Camera animation for drive-by sequence",
    criteria: { currentState: GAME_STATES.DRIVE_BY },
    priority: 100,
    playOnce: true,
    syncController: true,
    restoreInput: true,
    delay: 1.5, // Wait 2 seconds after DRIVE_BY state before animation
    scaleY: 0.8, // Optional: reduce vertical motion by 20%
  },

  shoulderTap: {
    id: "shoulderTap",
    type: "lookat",
    position: videos.punch.position,
    transitionTime: 0.75,
    criteria: { currentState: GAME_STATES.SHOULDER_TAP },
    priority: 100,
    playOnce: true,
    onComplete: (gameManager) => {
      gameManager.setState({ currentState: GAME_STATES.PUNCH_OUT });
    },
  },

  punchOut: {
    id: "punchOut",
    type: "jsonAnimation",
    path: "/json/punchout.json",
    description: "Camera animation for punch-out sequence",
    criteria: { currentState: GAME_STATES.PUNCH_OUT },
    priority: 100,
    playOnce: true,
    syncController: false, // Don't sync controller - leave camera where it lands
    restoreInput: false, // Don't restore input - leave player frozen
    delay: 0.1,
    scaleY: 0.4,
    onComplete: (gameManager) => {
      gameManager.setState({ currentState: GAME_STATES.FALLEN });
    },
  },

  punchWhiteout: {
    id: "punchWhiteout",
    type: "fade",
    description: "Whiteout effect when punch impacts",
    color: { r: 1, g: 1, b: 1 }, // White
    fadeInTime: 0.05, // Very fast flash to white
    holdTime: 0.01, // Brief hold
    fadeOutTime: 1.5, // Slower fade back to normal
    maxOpacity: 0.8, // Full whiteout
    criteria: { currentState: GAME_STATES.PUNCH_OUT },
    priority: 100,
    playOnce: true,
    delay: 0.15, // Sync with video punch impact
  },

  fallenBlackout: {
    id: "fallenBlackout",
    type: "fade",
    description: "Blackout effect after falling",
    color: { r: 0, g: 0, b: 0 }, // Black
    fadeInTime: 3.0, // Slow fade to black
    holdTime: 10, // Long hold in darkness
    fadeOutTime: 1.5, // Fade back to normal
    maxOpacity: 1.0, // Full blackout
    criteria: { currentState: GAME_STATES.FALLEN },
    priority: 100,
    playOnce: true,
    delay: 1.5, // Delay after falling
  },
};

/**
 * Get all camera animations that should play for the current game state
 * @param {Object} gameState - Current game state
 * @param {Set} playedAnimations - Set of animation IDs that have already been played (for playOnce check)
 * @returns {Array} Array of matching camera animation data
 */
export function getCameraAnimationsForState(
  gameState,
  playedAnimations = new Set()
) {
  // Convert to array and sort by priority (highest first)
  const animations = Object.values(cameraAnimations).sort(
    (a, b) => (b.priority || 0) - (a.priority || 0)
  );

  console.log(
    `CameraAnimationData: Checking ${animations.length} animations for state:`,
    gameState
  );

  const matchingAnimations = [];

  // Find all animations matching criteria that haven't been played yet
  for (const animation of animations) {
    if (!animation.criteria) {
      console.log(
        `CameraAnimationData: Animation '${animation.id}' has no criteria, skipping`
      );
      continue;
    }

    const matches = checkCriteria(gameState, animation.criteria);
    console.log(
      `CameraAnimationData: Animation '${animation.id}' criteria:`,
      animation.criteria,
      `matches:`,
      matches
    );

    if (matches) {
      // Check playOnce - skip if already played
      if (animation.playOnce && playedAnimations.has(animation.id)) {
        console.log(
          `CameraAnimationData: Animation '${animation.id}' matches but already played (playOnce), skipping...`
        );
        continue;
      }
      matchingAnimations.push(animation);
    }
  }

  console.log(
    `CameraAnimationData: Found ${matchingAnimations.length} matching animation(s)`
  );
  return matchingAnimations;
}

/**
 * Get the camera animation that should play for the current game state
 * @param {Object} gameState - Current game state
 * @param {Set} playedAnimations - Set of animation IDs that have already been played (for playOnce check)
 * @returns {Object|null} Camera animation data or null if none match
 * @deprecated Use getCameraAnimationsForState to get all matching animations
 */
export function getCameraAnimationForState(
  gameState,
  playedAnimations = new Set()
) {
  const animations = getCameraAnimationsForState(gameState, playedAnimations);
  return animations.length > 0 ? animations[0] : null;
}

export default cameraAnimations;

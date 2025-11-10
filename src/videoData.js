/**
 * Video Data Structure
 *
 * Each video contains:
 * - id: Unique identifier for the video
 * - videoPath: Path to the video file (WebM with alpha channel)
 * - preload: If true, load during loading screen; if false, load after (default: false)
 * - position: {x, y, z} position in 3D space OR function(gameManager) => {x, y, z} for dynamic positioning
 * - rotation: {x, y, z} rotation in radians
 * - scale: {x, y, z} scale multipliers
 * - loop: Whether the video should loop
 * - muted: Whether the video should be muted (default: true)
 * - volume: Volume level 0.0-1.0 (default: 1.0)
 * - playbackRate: Playback speed multiplier (default: 1.0, 0.5 = half speed, 2.0 = double speed)
 * - spatial: Enable 3D spatial audio (default: false) - preferred over spatialAudio
 * - spatialAudio: Enable 3D spatial audio (default: false) - legacy, use spatial instead
 * - audioPositionOffset: {x, y, z} offset from video position for audio source (default: {x:0, y:0, z:0})
 * - pannerAttr: Web Audio API PannerNode attributes (default: HRTF, inverse distance)
 *   - panningModel: 'equalpower' or 'HRTF' (default: 'HRTF')
 *   - refDistance: Reference distance for rolloff (default: 1)
 *   - rolloffFactor: How quickly sound fades with distance (default: 1)
 *   - distanceModel: 'linear', 'inverse', or 'exponential' (default: 'inverse')
 *   - maxDistance: Maximum distance sound is audible (default: 10000)
 *   - coneInnerAngle: Inner cone angle in degrees (default: 360)
 *   - coneOuterAngle: Outer cone angle in degrees (default: 360)
 *   - coneOuterGain: Gain outside outer cone (default: 0)
 *
 * For 3D spatial audio, use the same structure as SFX sounds:
 * - spatial: true to indicate this is a 3D positioned sound
 * - audioPositionOffset: {x, y, z} offset from video position (optional, defaults to {x:0, y:0, z:0})
 * - pannerAttr: Spatial audio properties (same as SFX)
 * - Note: muted must be false for spatial audio to work
 *
 * - billboard: Whether the video should always face the camera
 * - criteria: Optional object with key-value pairs that must match game state for video to play
 *   - Simple equality: { currentState: GAME_STATES.INTRO }
 *   - Comparison operators: { currentState: { $gte: GAME_STATES.INTRO, $lt: GAME_STATES.DRIVE_BY } }
 *   - Operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin
 *   - If criteria matches → video should play
 *   - If criteria doesn't match → video should stop
 * - spawnCriteria: Optional separate criteria for when to spawn/show the video (mesh appears)
 *   - If provided without playCriteria: video spawns, then plays after `delay` seconds (time-based)
 *   - If provided with playCriteria: video spawns, then plays when playCriteria match (state-based)
 *   - If not provided, uses criteria for both spawning and playing (original behavior)
 * - playCriteria: Optional separate criteria for when to play the video (after it's spawned)
 *   - Only used if spawnCriteria is also provided
 *   - When provided: enables state-based playback (waits for playCriteria state to match)
 *   - When omitted: uses time-based playback (plays after delay seconds from spawn)
 * - autoPlay: If true, automatically play when criteria are met (default: false)
 * - delay: Delay in seconds before playing the video when criteria are met (default: 0)
 * - once: If true, only play once (tracked automatically)
 * - priority: Higher priority videos are checked first (default: 0)
 * - gizmo: If true, enable debug gizmo for positioning visual objects (G=move, R=rotate, S=scale)
 * - onComplete: Optional function called when video ends, receives gameManager
 * - playNext: Chain to another video after this one completes (supported for non-looping videos)
 *   - Can be a video object (e.g., videos.nextVideo) or string ID (e.g., "nextVideo")
 *   - Allows creating video sequences without requiring game state changes between videos
 *   - The chained video's delay and criteria properties are respected
 *   - Note: Loop videos never trigger playNext since they never end
 *   - Example: playNext: "nextVideo" or playNext: videos.nextVideo
 *
 * Usage:
 * import { videos } from './videoData.js';
 * videoManager.playVideo('drive-by');
 * // or reference directly: videos.driveBy.position
 */

import { GAME_STATES, DIALOG_RESPONSE_TYPES } from "./gameData.js";
import { checkCriteria } from "./utils/criteriaHelper.js";
import { Logger } from "./utils/logger.js";

const logger = new Logger("VideoData", false);

export const videos = {
  shadowGlimpse: {
    id: "shadowGlimpse",
    videoPath: "/video/shadow-glimpse.webm",
    preload: false, // Load after loading screen
    position: { x: -17.95, y: 1.22, z: 39.24 },
    rotation: { x: 0.0, y: 1.4075, z: 0.0 },
    scale: { x: 0.95, y: 0.88, z: 1.0 },
    loop: false,
    muted: true,
    billboard: true,
    criteria: {
      shadowGlimpse: true,
    },
    autoPlay: true,
    once: true,
    priority: 0,
    platform: "!safari", // Don't load on Safari (use shadowGlimpseSafari instead)
  },
  shadowGlimpseSafari: {
    id: "shadowGlimpseSafari",
    videoPath: "/video/mov/shadow-glimpse.mov",
    preload: false, // Load after loading screen
    position: { x: -17.95, y: 1.22, z: 39.24 },
    rotation: { x: 0.0, y: 1.4075, z: 0.0 },
    scale: { x: 0.95, y: 0.88, z: 1.0 },
    loop: false,
    muted: true,
    billboard: true,
    criteria: {
      shadowGlimpse: true,
    },
    autoPlay: true,
    once: true,
    priority: 0,
    platform: "safari", // Only load on Safari
  },
  cat: {
    id: "cat",
    videoPath: "/video/cat.webm",
    preload: false, // Load after loading screen
    position: { x: -24.13, y: -1.48, z: 21.46 },
    rotation: { x: 0.0, y: 1.5708, z: 0.0 },
    scale: { x: 1, y: 1, z: 1 },
    loop: false,
    muted: false,
    billboard: true,
    criteria: {
      heardCat: true,
    },
    autoPlay: true,
    once: true,
    priority: 0,
    platform: "!safari", // Don't load on Safari (use catSafari instead)
  },
  catSafari: {
    id: "catSafari",
    videoPath: "/video/mov/cat-1-hvec.mov",
    preload: false, // Load after loading screen
    position: { x: -24.13, y: -1.48, z: 21.46 },
    rotation: { x: 0.0, y: 1.5708, z: 0.0 },
    scale: { x: 1, y: 1, z: 1 },
    loop: false,
    muted: false,
    billboard: true,
    criteria: {
      heardCat: true,
      currentState: {
        $gte: GAME_STATES.INTRO,
      },
    },
    autoPlay: true,
    once: true,
    priority: 0,
    platform: "safari", // Only load on Safari (all Safari users, not just iOS)
  },
  cat2: {
    id: "cat2",
    videoPath: "/video/cat-2.webm",
    gizmo: false,
    preload: false, // Load after loading screen
    position: { x: -1.39, y: 1.91, z: 81.48 },
    rotation: { x: 0.0, y: -0.8856, z: 0.0 },
    scale: { x: 0.12, y: 0.21, z: 1.31 },
    loop: false,
    muted: false,
    billboard: true,
    criteria: {
      currentState: {
        $gte: GAME_STATES.POST_VIEWMASTER,
        $lte: GAME_STATES.EDISON,
      },
    },
    autoPlay: true,
    once: true,
    priority: 0,
    delay: 3.5,
    platform: "!safari", // Don't load on Safari (use cat2Safari instead)
  },
  cat2Safari: {
    id: "cat2Safari",
    videoPath: "/video/mov/cat-2-paws.mov",
    gizmo: false,
    preload: false, // Load after loading screen
    position: { x: -1.39, y: 1.91, z: 81.48 },
    rotation: { x: 0.0, y: -0.8856, z: 0.0 },
    scale: { x: 0.12, y: 0.21, z: 1.31 },
    loop: false,
    muted: false,
    billboard: true,
    criteria: {
      currentState: {
        $gte: GAME_STATES.POST_VIEWMASTER,
        $lte: GAME_STATES.EDISON,
      },
    },
    autoPlay: true,
    once: true,
    priority: 0,
    delay: 3.5,
    platform: "safari", // Only load on Safari
  },

  punch: {
    id: "punch",
    videoPath: "/video/punch.webm",
    preload: false, // Load after loading screen
    position: (gameManager) => {
      if (!gameManager?.characterController) {
        logger.warn("Cannot get player position, using origin");
        return { x: 0, y: 1.8, z: 0 };
      }

      return gameManager.characterController.getPosition({
        x: 0,
        y: 1.5,
        z: 1.35,
      });
    },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 0.79, y: 0.79, z: 0.79 },
    loop: false,
    muted: true,
    billboard: true,
    once: true,
    priority: 0,
    spawnCriteria: {
      currentState: {
        $gte: GAME_STATES.SHOULDER_TAP,
        $lt: GAME_STATES.LIGHTS_OUT,
      },
    },
    autoPlay: true,
    delay: 0.2,
    platform: "!safari", // Don't load on Safari (use punchSafari instead)
  },
  punchSafari: {
    id: "punchSafari",
    videoPath: "/video/mov/shadow-punch.mov",
    preload: false, // Load after loading screen
    position: (gameManager) => {
      if (!gameManager?.characterController) {
        logger.warn("Cannot get player position, using origin");
        return { x: 0, y: 1.8, z: 0 };
      }

      return gameManager.characterController.getPosition({
        x: 0,
        y: 1.5,
        z: 1.35,
      });
    },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 0.79, y: 0.79, z: 0.79 },
    loop: false,
    muted: true,
    billboard: true,
    once: true,
    priority: 0,
    spawnCriteria: {
      currentState: {
        $gte: GAME_STATES.SHOULDER_TAP,
        $lt: GAME_STATES.LIGHTS_OUT,
      },
    },
    autoPlay: true,
    delay: 0.2,
    platform: "safari", // Only load on Safari
  },

  hesTiedUsUp: {
    id: "hesTiedUsUp",
    videoPath: "/video/cole-hes-tied-us-up.webm",
    preload: false, // Load after loading screen
    position: { x: -4.28, y: 5.94, z: 75.77 },
    rotation: { x: 0.0, y: 0.0, z: 0.0 },
    scale: { x: 0.39, y: 0.67, z: 0.81 },
    autoPlay: true,
    loop: false,
    billboard: true,
    muted: false,
    delay: 6.0,
    once: true,
    criteria: {
      currentState: {
        $gte: GAME_STATES.WAKING_UP,
      },
    },
    platform: "!safari", // Don't load on Safari (use hesTiedUsUpSafari instead)
  },
  hesTiedUsUpSafari: {
    id: "hesTiedUsUpSafari",
    videoPath: "/video/mov/leclaire-hes-tied-us-up.mov",
    preload: false, // Load after loading screen
    position: { x: -4.28, y: 5.94, z: 75.77 },
    rotation: { x: 0.0, y: 0.0, z: 0.0 },
    scale: { x: 0.39, y: 0.67, z: 0.81 },
    autoPlay: true,
    loop: false,
    billboard: true,
    muted: false,
    delay: 6.0,
    once: true,
    criteria: {
      currentState: {
        $gte: GAME_STATES.WAKING_UP,
      },
    },
    platform: "safari", // Only load on Safari
  },

  soUnkind: {
    id: "soUnkind",
    videoPath: "/video/shadow-unkind.webm",
    preload: false, // Load after loading screen
    position: { x: -12.7, y: 1.52, z: 79.28 },
    rotation: { x: 0.0, y: 1.3344, z: 0.0 },
    scale: { x: 1.22, y: 0.91, z: 3.04 },
    autoPlay: true,
    loop: false,
    billboard: false,
    muted: false,
    delay: 6.0,
    criteria: {
      currentState: {
        $eq: GAME_STATES.WAKING_UP,
      },
      // Only play if player did NOT choose empathetic response to dialog choice 2
      dialogChoice2: {
        $ne: DIALOG_RESPONSE_TYPES.EMPATH,
      },
    },
    spatial: true,
    audioPositionOffset: { x: 0, y: 0, z: 0 },
    pannerAttr: {
      panningModel: "HRTF",
      refDistance: 5,
      rolloffFactor: 1,
      distanceModel: "inverse",
      maxDistance: 100,
    },
    playNext: "shadowAmplifications",
    platform: "!safari", // Don't load on Safari (use soUnkindSafari instead)
  },
  soUnkindSafari: {
    id: "soUnkindSafari",
    videoPath: "/video/mov/shadow-so-unkind.mov",
    preload: false, // Load after loading screen
    position: { x: -12.7, y: 1.52, z: 79.28 },
    rotation: { x: 0.0, y: 1.3344, z: 0.0 },
    scale: { x: 1.22, y: 0.91, z: 3.04 },
    autoPlay: true,
    loop: false,
    billboard: false,
    muted: false,
    delay: 6.0,
    criteria: {
      currentState: {
        $eq: GAME_STATES.WAKING_UP,
      },
      // Only play if player did NOT choose empathetic response to dialog choice 2
      dialogChoice2: {
        $ne: DIALOG_RESPONSE_TYPES.EMPATH,
      },
    },
    spatial: true,
    audioPositionOffset: { x: 0, y: 0, z: 0 },
    pannerAttr: {
      panningModel: "HRTF",
      refDistance: 5,
      rolloffFactor: 1,
      distanceModel: "inverse",
      maxDistance: 100,
    },
    playNext: "shadowAmplificationsSafari",
    platform: "safari", // Only load on Safari
  },

  shadowQuietTheGirl: {
    id: "shadowQuietTheGirl",
    videoPath: "/video/shadow-quiet-the-girl.webm",
    preload: false, // Load after loading screen
    position: { x: -12.7, y: 1.52, z: 79.28 },
    rotation: { x: 0.0, y: 1.3344, z: 0.0 },
    scale: { x: 1.22, y: 0.91, z: 3.04 },
    autoPlay: true,
    loop: false,
    billboard: false,
    muted: false,
    delay: 8.0,
    criteria: {
      currentState: {
        $eq: GAME_STATES.WAKING_UP,
      },
      // Only play if player chose empathetic response to dialog choice 2
      dialogChoice2: DIALOG_RESPONSE_TYPES.EMPATH,
    },
    spatial: true,
    audioPositionOffset: { x: 0, y: 0, z: 0 },
    pannerAttr: {
      panningModel: "HRTF",
      refDistance: 5,
      rolloffFactor: 1,
      distanceModel: "inverse",
      maxDistance: 100,
    },
    playNext: "shadowAmplifications",
    platform: "!safari", // Don't load on Safari (use shadowQuietTheGirlSafari instead)
  },
  shadowQuietTheGirlSafari: {
    id: "shadowQuietTheGirlSafari",
    videoPath: "/video/mov/shadow-quiet-the-girl.mov",
    preload: false, // Load after loading screen
    position: { x: -12.7, y: 1.52, z: 79.28 },
    rotation: { x: 0.0, y: 1.3344, z: 0.0 },
    scale: { x: 1.22, y: 0.91, z: 3.04 },
    autoPlay: true,
    loop: false,
    billboard: false,
    muted: false,
    delay: 8.0,
    criteria: {
      currentState: {
        $eq: GAME_STATES.WAKING_UP,
      },
      // Only play if player chose empathetic response to dialog choice 2
      dialogChoice2: DIALOG_RESPONSE_TYPES.EMPATH,
    },
    spatial: true,
    audioPositionOffset: { x: 0, y: 0, z: 0 },
    pannerAttr: {
      panningModel: "HRTF",
      refDistance: 5,
      rolloffFactor: 1,
      distanceModel: "inverse",
      maxDistance: 100,
    },
    playNext: "shadowAmplificationsSafari",
    platform: "safari", // Only load on Safari
  },

  shadowAmplifications: {
    id: "shadowAmplifications",
    videoPath: "/video/shadow-amplifications-2.webm",
    preload: false, // Load after loading screen
    position: { x: -8.47, y: 1.96, z: 75.51 },
    rotation: { x: 0.0, y: -0.2291, z: 0.0 },
    scale: { x: 0.94, y: 0.91, z: 3.04 },
    autoPlay: false,
    loop: false,
    billboard: false,
    muted: false,
    delay: 1.0,
    onComplete: (gameManager) => {
      console.log("shadowAmplifications complete");
      gameManager.setState({
        currentState: GAME_STATES.SHADOW_AMPLIFICATIONS,
        isViewmasterEquipped: true,
        viewmasterManuallyRemoved: false,
        viewmasterOverheatDialogIndex: null,
      });
    },
    platform: "!safari", // Don't load on Safari (use shadowAmplificationsSafari instead)
  },
  shadowAmplificationsSafari: {
    id: "shadowAmplificationsSafari",
    videoPath: "/video/mov/shadow-amplifications.mov",
    preload: false, // Load after loading screen
    position: { x: -8.47, y: 1.96, z: 75.51 },
    rotation: { x: 0.0, y: -0.2291, z: 0.0 },
    scale: { x: 0.94, y: 0.91, z: 3.04 },
    autoPlay: false,
    loop: false,
    billboard: false,
    muted: false,
    delay: 1.0,
    onComplete: (gameManager) => {
      console.log("shadowAmplifications complete");
      gameManager.setState({
        currentState: GAME_STATES.SHADOW_AMPLIFICATIONS,
        isViewmasterEquipped: true,
        viewmasterManuallyRemoved: false,
        viewmasterOverheatDialogIndex: null,
      });
    },
    platform: "safari", // Only load on Safari
  },

  catChew: {
    id: "catChew",
    videoPath: "/video/cat-3-wire.webm",
    preload: false,
    position: { x: -2.1, y: 1.26, z: 80.85 },
    rotation: { x: 0.0, y: -0.5905, z: 0.0 },
    scale: { x: 0.18, y: 0.28, z: 3.04 },
    autoPlay: true,
    loop: false,
    billboard: true,
    muted: false,
    delay: 0.0,
    once: true,
    criteria: {
      currentState: {
        $gte: GAME_STATES.CAT_SAVE,
      },
    },
    platform: "!safari", // Don't load on Safari (use catChewSafari instead)
  },
  catChewSafari: {
    id: "catChewSafari",
    videoPath: "/video/mov/cat-3-wire.mov",
    preload: false,
    position: { x: -2.1, y: 1.26, z: 80.85 },
    rotation: { x: 0.0, y: -0.5905, z: 0.0 },
    scale: { x: 0.18, y: 0.28, z: 3.04 },
    autoPlay: true,
    loop: false,
    billboard: true,
    muted: false,
    delay: 0.0,
    once: true,
    criteria: {
      currentState: {
        $gte: GAME_STATES.CAT_SAVE,
      },
    },
    platform: "safari", // Only load on Safari
  },

  shadowTrance: {
    id: "shadowTrance",
    videoPath: "/video/shadow-trance.webm",
    preload: false,
    position: { x: -10.42, y: 2.2, z: 81.94 },
    rotation: { x: 0.0, y: 1.4047, z: 0.0 },
    scale: { x: 1.07, y: 1.52, z: 1.52 },
    autoPlay: true,
    loop: true,
    billboard: true,
    muted: false,
    delay: 0.0,
    criteria: {
      currentState: { $in: [GAME_STATES.CURSOR, GAME_STATES.CURSOR_FINAL] },
    },
    platform: "!safari", // Don't load on Safari (use shadowTranceSafari instead)
  },
  shadowTranceSafari: {
    id: "shadowTranceSafari",
    videoPath: "/video/mov/shadow-trance.mov",
    preload: false,
    position: { x: -10.42, y: 2.2, z: 81.94 },
    rotation: { x: 0.0, y: 1.4047, z: 0.0 },
    scale: { x: 1.07, y: 1.52, z: 1.52 },
    autoPlay: true,
    loop: true,
    billboard: true,
    muted: false,
    delay: 0.0,
    criteria: {
      currentState: { $in: [GAME_STATES.CURSOR, GAME_STATES.CURSOR_FINAL] },
    },
    platform: "safari", // Only load on Safari
  },
};

/**
 * Get videos that match current game state
 * @param {Object} gameState - Current game state
 * @returns {Array} Array of matching video configurations
 */
export function getVideosForState(gameState) {
  return Object.values(videos).filter((video) => {
    // Check if video has criteria
    if (!video.criteria) {
      return false;
    }

    // Check if criteria match current state
    const shouldPlay = checkCriteria(gameState, video.criteria);
    logger.log(
      `Checking video "${video.id}" - currentState: ${gameState.currentState}, criteria:`,
      video.criteria,
      `shouldPlay: ${shouldPlay}`
    );

    return shouldPlay;
  });
}

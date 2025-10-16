/**
 * Collider Data Structure
 *
 * Each collider defines a trigger zone that can emit events when the player enters or exits.
 * These events are passed to the GameManager which can then trigger dialog, music, UI, etc.
 *
 * Collider properties:
 * - id: Unique identifier for the collider
 * - type: Shape type - "box", "sphere", or "capsule"
 * - position: {x, y, z} world position
 * - rotation: {x, y, z} rotation in DEGREES (converted to quaternion internally)
 * - dimensions: Shape-specific dimensions
 *   - box: {x, y, z} half-extents (full size is 2x these values)
 *   - sphere: {radius}
 *   - capsule: {halfHeight, radius}
 * - onEnter: Array of events to emit when player enters
 *   - Each event: { type: "event-type", data: {...} }
 * - onExit: Array of events to emit when player exits
 * - once: If true, only trigger once then deactivate (default: false)
 * - enabled: If false, collider is inactive (default: true)
 * - criteria: Optional object with key-value pairs that must match game state
 *   - Simple equality: { introComplete: true, chapter: 1 }
 *   - Comparison operators: { currentState: { $gte: GAME_STATES.INTRO, $lt: GAME_STATES.DRIVE_BY } }
 *   - Operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin
 * - gizmo: If true, indicates this collider is part of gizmo authoring mode (blocks idle behaviors)
 *
 * Event Types:
 * - "dialog": Trigger a dialog sequence
 *   - data: { dialogId: "sequence-name", onComplete: "optional-event-id" }
 * - "music": Change music track
 *   - data: { track: "track-name", fadeTime: 2.0 }
 * - "sfx": Play a sound effect
 *   - data: { sound: "sound-name", volume: 1.0 }
 * - "ui": Show/hide UI elements
 *   - data: { action: "show|hide", element: "element-name" }
 * - "state": Set game state
 *   - data: { key: "state-key", value: any }
 * - "camera-lookat": Trigger camera look-at (DEPRECATED - use cameraAnimationData.js instead)
 *   - data: { position: {x, y, z}, duration: 2.0, enableZoom: false }
 *   - OR with targetMesh: { targetMesh: {objectId: "object-id", childName: "MeshName"}, duration: 2.0, enableZoom: true }
 *   - Optional zoomOptions: { zoomFactor: 1.5, minAperture: 0.15, maxAperture: 0.35, transitionStart: 0.8, transitionDuration: 2.0, holdDuration: 2.0 }
 *   - Input is always disabled during lookat and restored when complete (or after zoom if enabled without returnToOriginalView)
 * - "camera-animation": Play a camera animation
 *   - data: { animation: "path/to/animation.json", onComplete: optional-callback }
 * - "custom": Emit custom event for game-specific logic
 *   - data: { eventName: "name", payload: {...} }
 *
 * Note: Camera lookats and character moveTos should be defined in cameraAnimationData.js
 * with state-based criteria, not as collider events.
 */

import { GAME_STATES } from "./gameData.js";
import { sceneObjects } from "./sceneData.js";

export const colliders = [
  {
    id: "trigger-phonebooth-ring",
    type: "box",
    position: sceneObjects.phonebooth.position,
    rotation: { x: 0, y: 0, z: 0 },
    dimensions: { x: 10, y: 4, z: 10 },
    onEnter: [
      {
        type: "state",
        data: { key: "currentState", value: GAME_STATES.PHONE_BOOTH_RINGING },
      },
    ],
    onExit: [],
    once: true, // Triggers once then cleans itself up
    enabled: true,
    criteria: {
      currentState: {
        $gte: GAME_STATES.TITLE_SEQUENCE_COMPLETE,
        $lt: GAME_STATES.PHONE_BOOTH_RINGING,
      },
    },
  },

  // Phonebooth interaction - only available after hearing the phone ring
  {
    id: "phonebooth-answer",
    type: "box",
    position: {
      x: sceneObjects.phonebooth.position.x,
      y: 1,
      z: sceneObjects.phonebooth.position.z,
    },
    rotation: { x: 0, y: 0, z: 0 },
    dimensions: { x: 1, y: 4, z: 1 },
    onEnter: [
      {
        type: "state",
        data: { key: "currentState", value: GAME_STATES.ANSWERED_PHONE },
      },
    ],
    onExit: [],
    once: true,
    enabled: true,
    criteria: { currentState: GAME_STATES.PHONE_BOOTH_RINGING }, // Only activates after phone starts ringing
  },

  {
    id: "cat",
    type: "box",
    position: { x: -0.5, y: 0.4, z: 18.6 },
    rotation: { x: 0, y: 0, z: 0 },
    dimensions: { x: 2.5, y: 1.0, z: 2.5 },
    onEnter: [
      {
        type: "state",
        data: { key: "heardCat", value: true },
      },
    ],
    onExit: [],
    once: false,
    enabled: true,
  },

  // {
  //   id: "shoulderTap",
  //   type: "box",
  //   position: { x: 0, y: 1, z: 5 },
  //   rotation: { x: 0, y: 0, z: 0 },
  //   dimensions: { x: 5, y: 3, z: 2 },
  //   onEnter: [
  //     {
  //       type: "state",
  //       data: { key: "currentState", value: GAME_STATES.SHOULDER_TAP },
  //     },
  //   ],
  //   onExit: [],
  // },

  // Add your colliders here...
];

export default colliders;

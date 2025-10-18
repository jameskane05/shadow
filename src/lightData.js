import { sceneObjects } from "./sceneData.js";
import { GAME_STATES } from "./gameData.js";

/**
 * Light Data - Defines all lights in the scene
 *
 * Supports both regular Three.js lights and Spark splat lights
 *
 * Each light can have criteria to control when it's active based on game state.
 * Criteria uses the same format as sceneData.js (see criteriaHelper.js)
 */

export const lights = {
  // Standard Three.js Lights
  ambient: {
    id: "ambient",
    type: "AmbientLight",
    color: 0xffffff,
    intensity: 0.5,
  },

  mainDirectional: {
    id: "main-directional",
    type: "DirectionalLight",
    color: 0xffffff,
    intensity: 0.8,
    position: { x: 10, y: 20, z: 10 },
    castShadow: true,
  },

  // Splat-based Lights (using SplatEditSdf)
  streetLight: {
    id: "street-light",
    type: "SplatLight",
    splatType: "SPHERE",
    color: { r: 0.9, g: 0.9, b: 0.9 },
    position: { x: -0.84, y: 0.99, z: 64.97 },
    rotation: { x: -Math.PI / 2, y: 0, z: 0 }, // Point downward (-90° rotation from +Z to -Y)
    radius: 3, // Half-angle = π/4 × 0.8 ≈ 36° (72° total cone - typical streetlight)
    opacity: 0.05, // With ADD_RGBA, 0 opacity gives best falloff
    rgbaBlendMode: "ADD_RGBA",
    sdfSmooth: 0.1,
    softEdge: 3, // Larger soft edge for gradual streetlight falloff
    threeLightDuplicate: true, // Creates a Three.js PointLight at the same position
  },

  streetLight2: {
    id: "street-light-2",
    type: "SplatLight",
    splatType: "INFINITE_CONE",
    color: { r: 0.9, g: 0.9, b: 0.9 },
    position: { x: 11.07, y: 5.05, z: 82.97 },
    rotation: { x: -Math.PI / 2, y: 0, z: 0 }, // Point downward (-90° rotation from +Z to -Y)
    radius: 0.8, // Half-angle = π/4 × 0.8 ≈ 36° (72° total cone - typical streetlight)
    opacity: 0.05, // With ADD_RGBA, 0 opacity gives best falloff
    rgbaBlendMode: "ADD_RGBA",
    sdfSmooth: 0.5,
    softEdge: 2.0, // Larger soft edge for gradual streetlight falloff
  },

  // Car headlights (parented to GLTF node "Old_Car_01" inside scene object id "car")
  carHeadlightL: {
    id: "car-headlight-L",
    type: "SplatLight",
    splatType: "INFINITE_CONE",
    color: { r: 0.9, g: 0.9, b: 0.9 },
    // Attach under the car's GLTF root so lights move with the car animation
    attachTo: { objectId: "car", childName: "Old_Car_01" },
    // Local offsets from car origin (origin is ground center per your screenshot)
    position: { x: 0, y: 1, z: 0 },
    // Aim forward and downward (x: -0.26 ≈ -15° down, y: forward with slight outward angle)
    rotation: { x: 0.12, y: Math.PI + 0.06, z: -1 },
    radius: 0.25,
    opacity: 0.00000005, // Extremely subtle
    rgbaBlendMode: "ADD_RGBA",
    softEdge: 2.5,
    // Add Two Three.js lights: PointLight for backlight, SpotLight for dramatic cone
    threeLightDuplicate: [
      {
        type: "PointLight",
        intensity: 200,
        distance: 50,
        castShadow: false,
        position: { x: 0, y: 0.7, z: 3 },
      },
      {
        type: "SpotLight",
        intensity: 3000,
        distance: 100,
        angle: Math.PI / 6, // 30 degree cone
        penumbra: 0.1,
        decay: 2,
        castShadow: true,
        position: { x: 0, y: 1, z: 4 },
      },
    ],
    criteria: {
      currentState: {
        $gte: GAME_STATES.DRIVE_BY_PREAMBLE,
        $lte: GAME_STATES.POST_DRIVE_BY,
      },
    },
  },
};

export default lights;

import { sceneObjects } from "./sceneData.js";

/**
 * Light Data - Defines all lights in the scene
 *
 * Supports both regular Three.js lights and Spark splat lights
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
    opacity: 0.1, // With ADD_RGBA, 0 opacity gives best falloff
    rgbaBlendMode: "ADD_RGBA",
    sdfSmooth: 0.1,
    softEdge: 3, // Larger soft edge for gradual streetlight falloff
  },

  streetLight2: {
    id: "street-light-2",
    type: "SplatLight",
    splatType: "INFINITE_CONE",
    color: { r: 0.9, g: 0.9, b: 0.9 },
    position: { x: 11.07, y: 5.05, z: 82.97 },
    rotation: { x: -Math.PI / 2, y: 0, z: 0 }, // Point downward (-90° rotation from +Z to -Y)
    radius: 0.8, // Half-angle = π/4 × 0.8 ≈ 36° (72° total cone - typical streetlight)
    opacity: 0.15, // With ADD_RGBA, 0 opacity gives best falloff
    rgbaBlendMode: "ADD_RGBA",
    sdfSmooth: 0.5,
    softEdge: 2.0, // Larger soft edge for gradual streetlight falloff
  },
};

export default lights;

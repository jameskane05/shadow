import * as THREE from "three";
import {
  SplatEdit,
  SplatEditSdf,
  SplatEditSdfType,
  SplatEditRgbaBlendMode,
} from "@sparkjsdev/spark";
import AudioReactiveLight from "./vfx/audioReactiveLight.js";
import { lights } from "./lightData.js";

/**
 * LightManager - Manages all lights in the scene
 *
 * Features:
 * - Create and manage static lights (Three.js and Splat-based)
 * - Create and manage audio-reactive lights
 * - Load lights from data file
 * - Centralized light control
 *
 * Usage:
 * const lightManager = new LightManager(scene);
 * lightManager.loadLightsFromData(lightsData);
 * lightManager.createReactiveLight('phone-light', howl, config);
 */

class LightManager {
  constructor(scene) {
    this.scene = scene;
    this.lights = new Map(); // Map of id -> THREE.Light or SplatEdit
    this.reactiveLights = new Map(); // Map of id -> { light, audioReactive }
    this.splatLayers = new Map(); // Map of id -> SplatEdit layer

    // Automatically load lights from data on initialization
    this.loadLightsFromData(lights);
  }

  /**
   * Load and create all lights from data
   * @param {Object} lightsData - Object containing light definitions
   */
  loadLightsFromData(lightsData) {
    console.log("LightManager: Loading lights from data...");

    for (const [key, config] of Object.entries(lightsData)) {
      try {
        if (config.type === "SplatLight") {
          this.createSplatLight(config);
        } else {
          // Regular Three.js light
          this.createLight(config);
        }
      } catch (error) {
        console.error(`LightManager: Error creating light "${key}":`, error);
      }
    }

    console.log(`LightManager: Created ${this.lights.size} light(s)`);
  }

  /**
   * Create a light from config (dispatches to specific creator)
   * @param {Object} config - Light configuration
   * @returns {THREE.Light}
   */
  createLight(config) {
    switch (config.type) {
      case "AmbientLight":
        return this.createAmbientLight(config);
      case "DirectionalLight":
        return this.createDirectionalLight(config);
      case "PointLight":
        return this.createPointLight(config);
      case "SpotLight":
        return this.createSpotLight(config);
      default:
        console.warn(`LightManager: Unknown light type "${config.type}"`);
        return null;
    }
  }

  /**
   * Create a splat-based light
   * @param {Object} config - Splat light configuration
   * @returns {SplatEdit}
   */
  createSplatLight(config) {
    // Create lighting layer for the splat light
    const layer = new SplatEdit({
      rgbaBlendMode:
        SplatEditRgbaBlendMode[config.rgbaBlendMode] ||
        SplatEditRgbaBlendMode.ADD_RGBA,
      sdfSmooth: config.sdfSmooth ?? 0.1,
      softEdge: config.softEdge ?? 1.2,
    });
    this.scene.add(layer);

    // Create the splat light using SplatEditSdf
    const splatType =
      SplatEditSdfType[config.splatType] || SplatEditSdfType.SPHERE;
    const splatLight = new SplatEditSdf({
      type: splatType,
      color: new THREE.Color(config.color.r, config.color.g, config.color.b),
      radius: config.radius ?? 1,
      opacity: config.opacity ?? 0,
    });

    if (config.position) {
      splatLight.position.set(
        config.position.x ?? 0,
        config.position.y ?? 0,
        config.position.z ?? 0
      );
    }

    if (config.rotation) {
      splatLight.rotation.set(
        config.rotation.x ?? 0,
        config.rotation.y ?? 0,
        config.rotation.z ?? 0
      );
    }

    layer.add(splatLight);

    // Store references
    if (config.id) {
      this.lights.set(config.id, splatLight);
      this.splatLayers.set(config.id, layer);
    }

    console.log(
      `LightManager: Created splat light "${config.id}" at (${config.position.x}, ${config.position.y}, ${config.position.z})`
    );
    return layer;
  }

  /**
   * Create a Three.js light duplicate for a splat light
   * @param {Object} config - Splat light configuration
   * @returns {THREE.Light|null}
   */
  createThreeLightDuplicate(config) {
    // Get duplicate configuration (can be boolean true or an object with overrides)
    const duplicateConfig =
      typeof config.threeLightDuplicate === "object"
        ? config.threeLightDuplicate
        : {};

    // Convert splat color to hex
    const colorHex = new THREE.Color(
      config.color.r,
      config.color.g,
      config.color.b
    ).getHex();

    // Default to PointLight
    const lightType = duplicateConfig.type || "PointLight";

    // Build Three.js light config
    const threeLightConfig = {
      id: `${config.id}-three-duplicate`,
      type: lightType,
      color: duplicateConfig.color ?? colorHex,
      intensity: duplicateConfig.intensity ?? 1.0,
      position: duplicateConfig.position ?? config.position,
      distance: duplicateConfig.distance ?? 0,
      decay: duplicateConfig.decay ?? 2,
      castShadow: duplicateConfig.castShadow ?? false,
    };

    // Create the light
    const light = this.createLight(threeLightConfig);

    if (light) {
      console.log(
        `LightManager: Created Three.js duplicate light for "${config.id}"`
      );
    }

    return light;
  }

  /**
   * Create an ambient light
   * @param {Object} config - Light configuration
   * @returns {THREE.AmbientLight}
   */
  createAmbientLight(config = {}) {
    const light = new THREE.AmbientLight(
      config.color ?? 0xffffff,
      config.intensity ?? 1.0
    );

    if (config.id) {
      this.lights.set(config.id, light);
    }

    this.scene.add(light);
    return light;
  }

  /**
   * Create a directional light
   * @param {Object} config - Light configuration
   * @returns {THREE.DirectionalLight}
   */
  createDirectionalLight(config = {}) {
    const light = new THREE.DirectionalLight(
      config.color ?? 0xffffff,
      config.intensity ?? 1.0
    );

    if (config.position) {
      light.position.set(
        config.position.x ?? 0,
        config.position.y ?? 0,
        config.position.z ?? 0
      );
    }

    if (config.castShadow !== undefined) {
      light.castShadow = config.castShadow;
    }

    if (config.id) {
      this.lights.set(config.id, light);
    }

    this.scene.add(light);
    return light;
  }

  /**
   * Create a point light
   * @param {Object} config - Light configuration
   * @returns {THREE.PointLight}
   */
  createPointLight(config = {}) {
    const light = new THREE.PointLight(
      config.color ?? 0xffffff,
      config.intensity ?? 1.0,
      config.distance ?? 0,
      config.decay ?? 2
    );

    if (config.position) {
      light.position.set(
        config.position.x ?? 0,
        config.position.y ?? 0,
        config.position.z ?? 0
      );
    }

    if (config.castShadow !== undefined) {
      light.castShadow = config.castShadow;
    }

    if (config.id) {
      this.lights.set(config.id, light);
    }

    this.scene.add(light);
    return light;
  }

  /**
   * Create a spot light
   * @param {Object} config - Light configuration
   * @returns {THREE.SpotLight}
   */
  createSpotLight(config = {}) {
    const light = new THREE.SpotLight(
      config.color ?? 0xffffff,
      config.intensity ?? 1.0,
      config.distance ?? 0,
      config.angle ?? Math.PI / 3,
      config.penumbra ?? 0,
      config.decay ?? 2
    );

    if (config.position) {
      light.position.set(
        config.position.x ?? 0,
        config.position.y ?? 0,
        config.position.z ?? 0
      );
    }

    if (config.target) {
      light.target.position.set(
        config.target.x ?? 0,
        config.target.y ?? 0,
        config.target.z ?? 0
      );
      this.scene.add(light.target);
    }

    if (config.castShadow !== undefined) {
      light.castShadow = config.castShadow;
    }

    if (config.id) {
      this.lights.set(config.id, light);
    }

    this.scene.add(light);
    return light;
  }

  /**
   * Create an audio-reactive light
   * @param {string} id - Unique identifier for this light
   * @param {Howl} howl - Howl instance to analyze
   * @param {Object} config - Light and reactivity configuration
   * @returns {Object} { light, audioReactive }
   */
  createReactiveLight(id, howl, config) {
    try {
      // Create THREE.js light based on type
      let light;
      switch (config.type) {
        case "PointLight":
          light = this.createPointLight({
            ...config,
            id: null, // Don't double-register
            intensity: config.baseIntensity ?? 1.0,
          });
          break;
        case "SpotLight":
          light = this.createSpotLight({
            ...config,
            id: null,
            intensity: config.baseIntensity ?? 1.0,
          });
          break;
        case "DirectionalLight":
          light = this.createDirectionalLight({
            ...config,
            id: null,
            intensity: config.baseIntensity ?? 1.0,
          });
          break;
        default:
          console.warn(
            `LightManager: Unknown light type "${config.type}" for "${id}"`
          );
          return null;
      }

      // Create audio-reactive controller
      const audioReactive = new AudioReactiveLight(light, howl, {
        baseIntensity: config.baseIntensity,
        reactivityMultiplier: config.reactivityMultiplier,
        smoothing: config.smoothing,
        frequencyRange: config.frequencyRange,
        minIntensity: config.minIntensity,
        maxIntensity: config.maxIntensity,
        noiseFloor: config.noiseFloor,
      });

      // Store references
      this.lights.set(id, light);
      this.reactiveLights.set(id, { light, audioReactive });

      console.log(`LightManager: Created reactive light "${id}"`);
      return { light, audioReactive };
    } catch (error) {
      console.error(
        `LightManager: Error creating reactive light "${id}":`,
        error
      );
      return null;
    }
  }

  /**
   * Get a light by ID
   * @param {string} id - Light ID
   * @returns {THREE.Light|null}
   */
  getLight(id) {
    return this.lights.get(id) || null;
  }

  /**
   * Get reactive light data by ID
   * @param {string} id - Light ID
   * @returns {Object|null} { light, audioReactive }
   */
  getReactiveLight(id) {
    return this.reactiveLights.get(id) || null;
  }

  /**
   * Remove a light by ID
   * @param {string} id - Light ID
   */
  removeLight(id) {
    const light = this.lights.get(id);
    if (light) {
      this.scene.remove(light);
      this.lights.delete(id);
    }

    // Remove splat layer if present
    const splatLayer = this.splatLayers.get(id);
    if (splatLayer) {
      this.scene.remove(splatLayer);
      this.splatLayers.delete(id);
    }

    // Also remove from reactive lights if present
    const reactive = this.reactiveLights.get(id);
    if (reactive) {
      reactive.audioReactive.destroy();
      this.reactiveLights.delete(id);
    }
  }

  /**
   * Update all audio-reactive lights
   * Call this in your animation loop
   * @param {number} dt - Delta time (not used, but kept for consistency)
   */
  updateReactiveLights(dt) {
    for (const { audioReactive } of this.reactiveLights.values()) {
      audioReactive.update();
    }
  }

  /**
   * Enable/disable a reactive light
   * @param {string} id - Light ID
   * @param {boolean} enabled - Enable or disable
   */
  setReactiveLightEnabled(id, enabled) {
    const reactive = this.reactiveLights.get(id);
    if (reactive) {
      if (enabled) {
        reactive.audioReactive.enable();
      } else {
        reactive.audioReactive.disable();
      }
    }
  }

  /**
   * Get all light IDs
   * @returns {Array<string>}
   */
  getLightIds() {
    return Array.from(this.lights.keys());
  }

  /**
   * Get all reactive light IDs
   * @returns {Array<string>}
   */
  getReactiveLightIds() {
    return Array.from(this.reactiveLights.keys());
  }

  /**
   * Clean up all lights
   */
  destroy() {
    // Clean up reactive lights
    for (const [id, { light, audioReactive }] of this.reactiveLights) {
      audioReactive.destroy();
      if (light.parent === this.scene) {
        this.scene.remove(light);
      }
    }
    this.reactiveLights.clear();

    // Clean up splat layers
    for (const [id, layer] of this.splatLayers) {
      if (layer.parent === this.scene) {
        this.scene.remove(layer);
      }
    }
    this.splatLayers.clear();

    // Clean up regular lights
    for (const [id, light] of this.lights) {
      if (light.parent === this.scene) {
        this.scene.remove(light);
      }
    }
    this.lights.clear();
  }
}

export default LightManager;

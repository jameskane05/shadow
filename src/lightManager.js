import * as THREE from "three";
import {
  SplatEdit,
  SplatEditSdf,
  SplatEditSdfType,
  SplatEditRgbaBlendMode,
} from "@sparkjsdev/spark";
import AudioReactiveLight from "./vfx/audioReactiveLight.js";
import { lights } from "./lightData.js";
import { checkCriteria } from "./criteriaHelper.js";

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
  constructor(scene, sceneManager = null, gameManager = null) {
    this.scene = scene;
    this.sceneManager = sceneManager; // Optional, used for parenting lights under scene objects
    this.gameManager = gameManager; // Optional, used for criteria checking
    this.lights = new Map(); // Map of id -> THREE.Light or SplatEdit
    this.reactiveLights = new Map(); // Map of id -> { light, audioReactive }
    this.splatLayers = new Map(); // Map of id -> SplatEdit layer
    this.pendingAttachments = new Map(); // Map of id -> { object3D, config }

    // Automatically load lights from data on initialization
    const gameState = gameManager?.getState();
    this.loadLightsFromData(lights, gameState);
  }

  /**
   * Resolve the parent Object3D for a light based on config
   * @param {Object} config
   * @returns {THREE.Object3D}
   */
  _resolveParent(config) {
    // Default to scene when no sceneManager or no parent specified
    if (!this.sceneManager) return this.scene;

    // Support either { parentId, childName } or nested attachTo: { objectId, childName }
    const parentId = config?.parentId || config?.attachTo?.objectId;
    const childName = config?.childName || config?.attachTo?.childName;

    if (!parentId) return this.scene;

    // If a child name is provided, try to attach to that specific child
    if (childName && typeof this.sceneManager.findChildByName === "function") {
      const child = this.sceneManager.findChildByName(parentId, childName);
      if (child) return child;
    }

    // Otherwise attach to the parent object root
    if (typeof this.sceneManager.getObject === "function") {
      const parentObj = this.sceneManager.getObject(parentId);
      if (parentObj) return parentObj;
    }

    // Fallback to scene if not found
    return this.scene;
  }

  /**
   * Track objects that requested parenting but whose parent isn't loaded yet
   * @param {string} id
   * @param {THREE.Object3D} object3D
   * @param {Object} config
   */
  _maybeTrackPendingAttachment(id, object3D, config, parent) {
    const wantsParent = !!(config?.parentId || config?.attachTo);
    if (wantsParent && parent === this.scene && id) {
      this.pendingAttachments.set(id, { object3D, config });
      const parentId = config?.parentId || config?.attachTo?.objectId;
      console.log(
        `⏸️ LightManager: "${id}" waiting for parent "${parentId}" to load`
      );
    }
  }

  /**
   * Try to resolve any lights that couldn't find their parent at creation time
   */
  _tryResolvePendingAttachments() {
    if (!this.sceneManager || this.pendingAttachments.size === 0) return;

    for (const [id, entry] of Array.from(this.pendingAttachments.entries())) {
      const { object3D, config } = entry;
      const parent = this._resolveParent(config);
      if (parent !== this.scene) {
        // Reparent without preserving world transform so config local offsets apply
        if (object3D.parent) {
          object3D.parent.remove(object3D);
        }
        parent.add(object3D);
        this.pendingAttachments.delete(id);
        console.log(
          `✅ LightManager: Reattached "${id}" under resolved parent`
        );
      }
    }

    // Log pending attachments for debugging
    if (this.pendingAttachments.size > 0) {
      const pendingIds = Array.from(this.pendingAttachments.keys());
      console.log(
        `⏳ LightManager: Still waiting for parents: ${pendingIds.join(", ")}`
      );
    }
  }

  /**
   * Load and create all lights from data
   * @param {Object} lightsData - Object containing light definitions
   * @param {Object} gameState - Current game state for criteria checking
   */
  loadLightsFromData(lightsData, gameState = null) {
    console.log("LightManager: Loading lights from data...");

    for (const [key, config] of Object.entries(lightsData)) {
      // Check criteria if gameState is provided
      if (gameState && config.criteria) {
        if (!checkCriteria(gameState, config.criteria)) {
          console.log(
            `⏭️ LightManager: Skipping light "${key}" - criteria not met`
          );
          continue;
        }
      }

      console.log(
        `🔦 LightManager: Processing light "${key}" (type: ${config.type})`
      );
      try {
        if (config.type === "SplatLight") {
          this.createSplatLight(config);
        } else {
          // Regular Three.js light
          this.createLight(config);
        }
      } catch (error) {
        console.error(`❌ LightManager: Error creating light "${key}":`, error);
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
    const parent = this._resolveParent(config);
    parent.add(layer);
    this._maybeTrackPendingAttachment(config.id, layer, config, parent);

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

    // Create Three.js light duplicate(s) if requested
    if (config.threeLightDuplicate) {
      // Support both single object and array of objects
      const duplicates = Array.isArray(config.threeLightDuplicate)
        ? config.threeLightDuplicate
        : [config.threeLightDuplicate];

      duplicates.forEach((dupConfig, index) => {
        this.createThreeLightDuplicate(config, dupConfig, index);
      });
    }

    console.log(
      `LightManager: Created splat light "${config.id}" at (${config.position.x}, ${config.position.y}, ${config.position.z})`
    );
    return layer;
  }

  /**
   * Create a Three.js light duplicate for a splat light
   * @param {Object} config - Splat light configuration
   * @param {Object} duplicateConfig - Duplicate light configuration
   * @param {number} index - Index of this duplicate (for unique ID)
   * @returns {THREE.Light|null}
   */
  createThreeLightDuplicate(config, duplicateConfig = {}, index = 0) {
    // Handle boolean true case
    if (duplicateConfig === true) {
      duplicateConfig = {};
    }

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
      id: `${config.id}-three-duplicate${index > 0 ? `-${index}` : ""}`,
      type: lightType,
      color: duplicateConfig.color ?? colorHex,
      intensity: duplicateConfig.intensity ?? 1.0,
      position: duplicateConfig.position ?? config.position,
      distance: duplicateConfig.distance ?? 0,
      decay: duplicateConfig.decay ?? 2,
      castShadow: duplicateConfig.castShadow ?? false,
    };

    // Add SpotLight-specific parameters
    if (lightType === "SpotLight") {
      threeLightConfig.angle = duplicateConfig.angle ?? Math.PI / 3;
      threeLightConfig.penumbra = duplicateConfig.penumbra ?? 0;
      if (duplicateConfig.target) {
        threeLightConfig.target = duplicateConfig.target;
      }
    }

    // Propagate parenting so the duplicate attaches to the same parent
    if (config.parentId) threeLightConfig.parentId = config.parentId;
    if (config.childName) threeLightConfig.childName = config.childName;
    if (config.attachTo) threeLightConfig.attachTo = { ...config.attachTo };

    // Create the light
    const light = this.createLight(threeLightConfig);

    if (light) {
      console.log(
        `LightManager: Created Three.js duplicate light for "${config.id}" (${lightType})`
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

    const parent = this._resolveParent(config);
    parent.add(light);
    this._maybeTrackPendingAttachment(config.id, light, config, parent);
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

    const parent = this._resolveParent(config);
    parent.add(light);
    this._maybeTrackPendingAttachment(config.id, light, config, parent);
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

    const parent = this._resolveParent(config);
    parent.add(light);
    this._maybeTrackPendingAttachment(config.id, light, config, parent);
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

    console.log(
      `🔦 Creating SpotLight "${config.id}" with intensity ${light.intensity}, distance ${light.distance}, angle ${light.angle}`
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

    const parent = this._resolveParent(config);
    parent.add(light);
    console.log(
      `  SpotLight parent: ${parent.type || parent.constructor.name}`
    );

    // Set up target after parenting so it can be relative to the parent
    if (config.target) {
      light.target.position.set(
        config.target.x ?? 0,
        config.target.y ?? 0,
        config.target.z ?? 0
      );
      // Add target to the same parent so it moves with the light
      parent.add(light.target);
      console.log(
        `  SpotLight target at (${light.target.position.x}, ${light.target.position.y}, ${light.target.position.z})`
      );
    } else {
      // Default: point forward along parent's +Z axis
      light.target.position.set(0, 0, 10);
      parent.add(light.target);
      console.log(`  SpotLight target at default (0, 0, 10)`);
    }

    this._maybeTrackPendingAttachment(config.id, light, config, parent);
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
      if (light.parent) {
        light.parent.remove(light);
      } else {
        this.scene.remove(light);
      }
      this.lights.delete(id);
    }

    // Remove splat layer if present
    const splatLayer = this.splatLayers.get(id);
    if (splatLayer) {
      if (splatLayer.parent) {
        splatLayer.parent.remove(splatLayer);
      } else {
        this.scene.remove(splatLayer);
      }
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
    // Attempt to resolve any deferred attachments (parents that loaded later)
    this._tryResolvePendingAttachments();

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
      if (light.parent) {
        light.parent.remove(light);
      } else {
        this.scene.remove(light);
      }
    }
    this.reactiveLights.clear();

    // Clean up splat layers
    for (const [id, layer] of this.splatLayers) {
      if (layer.parent) {
        layer.parent.remove(layer);
      } else {
        this.scene.remove(layer);
      }
    }
    this.splatLayers.clear();

    // Clean up regular lights
    for (const [id, light] of this.lights) {
      if (light.parent) {
        light.parent.remove(light);
      } else {
        this.scene.remove(light);
      }
    }
    this.lights.clear();
  }
}

export default LightManager;

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SplatMesh } from "@sparkjsdev/spark";
import { checkCriteria } from "./criteriaHelper.js";

/**
 * SceneManager - Manages scene objects (splats, GLTF models, etc.)
 *
 * Features:
 * - Load and manage splat meshes
 * - Load and manage GLTF models
 * - Centralized scene object registration
 * - Automatic cleanup and unloading
 *
 * Usage Example:
 *
 * import SceneManager from './sceneManager.js';
 * import { sceneObjects } from './sceneData.js';
 *
 * // Create manager
 * const sceneManager = new SceneManager(scene);
 *
 * // Load all objects from data
 * await sceneManager.loadFromData(sceneObjects);
 *
 * // Or load individual objects
 * await sceneManager.loadObject(sceneObjects.exterior);
 * await sceneManager.loadObject(sceneObjects.phonebooth);
 *
 * // Access loaded objects
 * const phonebooth = sceneManager.getObject('phonebooth');
 *
 * // Cleanup
 * sceneManager.destroy();
 */

class SceneManager {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.gizmoManager = options.gizmoManager || null; // For debug positioning
    this.loadingScreen = options.loadingScreen || null; // For progress tracking
    this.objects = new Map(); // Map of id -> THREE.Object3D
    this.objectData = new Map(); // Map of id -> original config data (for gizmo flag)
    this.gltfLoader = new GLTFLoader();
    this.loadingPromises = new Map(); // Track loading promises

    // Animation management
    this.animationMixers = new Map(); // Map of objectId -> THREE.AnimationMixer
    this.animationActions = new Map(); // Map of animationId -> THREE.AnimationAction
    this.animationData = new Map(); // Map of animationId -> animation data config
    this.playedAnimations = new Set(); // Track animations that have been played once (for playOnce)

    // Event listeners
    this.eventListeners = {};

    // Asset loading progress tracking
    this.assetProgress = new Map(); // Map of asset id -> { loaded, total }
  }

  /**
   * Add event listener
   * @param {string} event - Event name
   * @param {function} callback - Callback function
   */
  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }

  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {...any} args - Arguments to pass to callbacks
   */
  emit(event, ...args) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach((callback) => callback(...args));
    }
  }

  /**
   * Load all objects from scene data
   * @param {Object} sceneData - Scene data object (from sceneData.js)
   * @returns {Promise<void>}
   */
  async loadFromData(sceneData) {
    const loadPromises = Object.values(sceneData).map((objectData) =>
      this.loadObject(objectData)
    );
    await Promise.all(loadPromises);
  }

  /**
   * Load objects based on current game state
   * @param {Array<Object>} objectsToLoad - Array of scene object data from getSceneObjectsForState()
   * @returns {Promise<void>}
   */
  async loadObjectsForState(objectsToLoad) {
    if (!objectsToLoad || objectsToLoad.length === 0) {
      console.log("SceneManager: No objects to load for current state");
      return;
    }

    console.log(
      `SceneManager: Loading ${objectsToLoad.length} objects for current state`
    );

    let foundGizmo = false;
    const loadPromises = objectsToLoad.map((objectData) =>
      this.loadObject(objectData)
        .catch((error) => {
          console.error(
            `SceneManager: Failed to load object "${objectData.id}":`,
            error
          );
          // Continue loading other objects even if one fails
          return null;
        })
        .then((obj) => {
          if (objectData && objectData.gizmo === true) foundGizmo = true;
          return obj;
        })
    );

    await Promise.all(loadPromises);

    // Set global gizmo-in-data flag on gameManager if any object declares gizmo
    try {
      if (
        foundGizmo &&
        window?.gameManager &&
        typeof window.gameManager.setState === "function"
      ) {
        window.gameManager.setState({ hasGizmoInData: true });
      }
    } catch {}
  }

  /**
   * Load a single scene object
   * @param {Object} objectData - Object data from sceneData.js
   * @returns {Promise<THREE.Object3D>}
   */
  async loadObject(objectData) {
    const { id, type } = objectData;

    // Check if already loading
    if (this.loadingPromises.has(id)) {
      return this.loadingPromises.get(id);
    }

    // Check if already loaded
    if (this.objects.has(id)) {
      console.warn(`SceneManager: Object "${id}" is already loaded`);
      return this.objects.get(id);
    }

    let loadPromise;

    switch (type) {
      case "splat":
        loadPromise = this._loadSplat(objectData);
        break;
      case "gltf":
        loadPromise = this._loadGLTF(objectData);
        break;
      default:
        console.error(`SceneManager: Unknown object type "${type}"`);
        return null;
    }

    this.loadingPromises.set(id, loadPromise);

    try {
      const object = await loadPromise;
      this.objects.set(id, object);
      this.objectData.set(id, objectData); // Store original config
      this.loadingPromises.delete(id);
      console.log(`SceneManager: Loaded "${id}" (${type})`);

      // Register with gizmo manager if gizmo flag is set
      if (objectData.gizmo && this.gizmoManager && object) {
        this.gizmoManager.registerObject(object, id, type);
      }

      return object;
    } catch (error) {
      this.loadingPromises.delete(id);
      console.error(`SceneManager: Error loading "${id}":`, error);
      throw error;
    }
  }

  /**
   * Load a splat mesh
   * @param {Object} objectData - Splat object data
   * @returns {Promise<SplatMesh>}
   * @private
   */
  async _loadSplat(objectData) {
    const { id, path, position, rotation, scale, quaternion } = objectData;

    // Register with loading screen if available
    if (this.loadingScreen) {
      this.loadingScreen.registerTask(`splat_${id}`, 100);
    }

    const splatMesh = new SplatMesh({
      url: path,
      onProgress: (progress) => {
        // Progress is a number between 0 and 1
        if (this.loadingScreen) {
          const percentage = Math.round(progress * 100);
          this.loadingScreen.updateTask(`splat_${id}`, percentage, 100);
        }
      },
    });

    // Set quaternion if provided
    if (quaternion) {
      splatMesh.quaternion.set(
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w
      );
    } else if (rotation) {
      splatMesh.rotation.set(rotation.x, rotation.y, rotation.z);
    }

    // Set position
    if (position) {
      splatMesh.position.set(position.x, position.y, position.z);
    }

    // Set scale
    if (scale) {
      if (typeof scale === "object" && "x" in scale) {
        splatMesh.scale.set(scale.x, scale.y, scale.z);
      } else if (typeof scale === "number") {
        splatMesh.scale.setScalar(scale);
      }
    }

    this.scene.add(splatMesh);

    // Wait for splat to initialize
    await splatMesh.initialized;

    // Mark as complete
    if (this.loadingScreen) {
      this.loadingScreen.completeTask(`splat_${id}`);
    }

    return splatMesh;
  }

  /**
   * Load a GLTF model
   * @param {Object} objectData - GLTF object data
   * @returns {Promise<THREE.Object3D>}
   * @private
   */
  _loadGLTF(objectData) {
    return new Promise((resolve, reject) => {
      const { id, path, position, rotation, scale, options, animations } =
        objectData;

      // Register with loading screen if available
      if (this.loadingScreen) {
        this.loadingScreen.registerTask(`gltf_${id}`, 100);
      }

      this.gltfLoader.load(
        path,
        (gltf) => {
          // Mark as complete
          if (this.loadingScreen) {
            this.loadingScreen.completeTask(`gltf_${id}`);
          }

          const model = gltf.scene;

          // Traverse all children and ensure materials are visible
          // Also remove any lights from the GLTF (we manage lights separately)
          const lightsToRemove = [];
          model.traverse((child) => {
            if (child.isMesh) {
              if (child.material) {
                child.material.needsUpdate = true;
              }
            }
            // Collect lights to remove (can't remove during traversal)
            if (child.isLight) {
              lightsToRemove.push(child);
            }
          });

          // Remove collected lights
          lightsToRemove.forEach((light) => {
            if (light.parent) {
              light.parent.remove(light);
            }
          });

          // Create container group if requested
          let finalObject;
          if (options && options.useContainer) {
            const container = new THREE.Group();
            container.add(model);
            finalObject = container;
          } else {
            finalObject = model;
          }

          // Set position
          if (position) {
            finalObject.position.set(position.x, position.y, position.z);
          }

          // Set rotation
          if (rotation) {
            finalObject.rotation.set(rotation.x, rotation.y, rotation.z);
          }

          // Set scale
          if (scale) {
            if (typeof scale === "object" && "x" in scale) {
              finalObject.scale.set(scale.x, scale.y, scale.z);
            } else if (typeof scale === "number") {
              finalObject.scale.setScalar(scale);
            }
          }

          // Setup animations if available
          if (
            animations &&
            animations.length > 0 &&
            gltf.animations &&
            gltf.animations.length > 0
          ) {
            this._setupAnimations(id, model, gltf.animations, animations);
          }

          this.scene.add(finalObject);
          resolve(finalObject);
        },
        (xhr) => {
          // Progress callback
          if (xhr.lengthComputable && this.loadingScreen) {
            const percentage = Math.round((xhr.loaded / xhr.total) * 100);
            this.loadingScreen.updateTask(`gltf_${id}`, percentage, 100);
          }
        },
        (error) => {
          reject(error);
        }
      );
    });
  }

  /**
   * Setup animations for a GLTF model
   * @param {string} objectId - Object ID
   * @param {THREE.Object3D} model - The loaded model
   * @param {Array} clips - Animation clips from GLTF
   * @param {Array} animationConfigs - Animation configurations from sceneData
   * @private
   */
  _setupAnimations(objectId, model, clips, animationConfigs) {
    const mixer = new THREE.AnimationMixer(model);
    this.animationMixers.set(objectId, mixer);

    // Listen for animation finished events
    mixer.addEventListener("finished", (e) => {
      const action = e.action;
      // Find which animation config this action belongs to
      for (const [animId, storedAction] of this.animationActions) {
        if (storedAction === action) {
          console.log(`SceneManager: Animation "${animId}" finished`);
          this.emit("animation:finished", animId);
          break;
        }
      }
    });

    // Log available clips for debugging
    console.log(
      `SceneManager: Available animation clips for "${objectId}":`,
      clips.map((c) => c.name)
    );

    animationConfigs.forEach((config) => {
      // Find the clip
      let clip;
      if (config.clipName) {
        clip = clips.find((c) => c.name === config.clipName);
        if (!clip) {
          console.warn(
            `SceneManager: Animation clip "${config.clipName}" not found for "${config.id}". Available:`,
            clips.map((c) => c.name)
          );
        }
      } else {
        // Use first clip if no name specified
        clip = clips[0];
      }

      if (!clip) {
        console.warn(
          `SceneManager: No animation clip found for "${config.id}"`
        );
        return;
      }

      // Create action
      const action = mixer.clipAction(clip);
      action.loop = config.loop ? THREE.LoopRepeat : THREE.LoopOnce;
      action.timeScale = config.timeScale || 1.0;
      action.clampWhenFinished = !config.loop;

      // Store action and config
      this.animationActions.set(config.id, action);
      this.animationData.set(config.id, config);

      console.log(
        `SceneManager: Registered animation "${config.id}" for object "${objectId}"`
      );
    });
  }

  /**
   * Get a loaded object by ID
   * @param {string} id - Object ID
   * @returns {THREE.Object3D|null}
   */
  getObject(id) {
    return this.objects.get(id) || null;
  }

  /**
   * Find a child mesh by name within a loaded object
   * @param {string} objectId - Parent object ID
   * @param {string} childName - Name of child mesh to find
   * @returns {THREE.Object3D|null}
   */
  findChildByName(objectId, childName) {
    const object = this.getObject(objectId);
    if (!object) {
      console.warn(`SceneManager: Object "${objectId}" not found`);
      return null;
    }

    let foundChild = null;
    object.traverse((child) => {
      if (child.name === childName) {
        foundChild = child;
      }
    });

    if (!foundChild) {
      console.warn(
        `SceneManager: Child "${childName}" not found in "${objectId}"`
      );
    }

    return foundChild;
  }

  /**
   * Reparent a child mesh from one object to another
   * @param {string} sourceObjectId - Source object ID
   * @param {string} childName - Name of child to reparent
   * @param {THREE.Object3D} targetParent - New parent object
   * @param {Object} localTransform - Optional local transform { position, rotation, scale }
   * @returns {THREE.Object3D|null} The reparented child, or null if failed
   */
  reparentChild(sourceObjectId, childName, targetParent) {
    const child = this.findChildByName(sourceObjectId, childName);
    if (!child) {
      return null;
    }

    // Use THREE.js attach() method to preserve world transform
    // This automatically handles the math to maintain world position/rotation/scale
    targetParent.attach(child);

    return child;
  }

  /**
   * Reparent a child mesh and apply a local transform
   * (legacy method, kept for compatibility)
   * @param {string} sourceObjectId - ID of object containing the child
   * @param {string} childName - Name of child mesh to reparent
   * @param {THREE.Object3D} targetParent - New parent object
   * @param {Object} localTransform - Local transform to apply after reparenting
   * @returns {THREE.Object3D|null} The reparented child, or null if not found
   */
  reparentChildWithTransform(
    sourceObjectId,
    childName,
    targetParent,
    localTransform = null
  ) {
    const child = this.findChildByName(sourceObjectId, childName);
    if (!child) {
      return null;
    }

    // Remove from current parent
    if (child.parent) {
      child.parent.remove(child);
    }

    // Add to new parent
    targetParent.add(child);

    // Apply local transform if provided
    if (localTransform) {
      if (localTransform.position) {
        child.position.set(
          localTransform.position.x,
          localTransform.position.y,
          localTransform.position.z
        );
      }
      if (localTransform.rotation) {
        child.rotation.set(
          localTransform.rotation.x,
          localTransform.rotation.y,
          localTransform.rotation.z
        );
      }
      if (localTransform.scale) {
        if (
          typeof localTransform.scale === "object" &&
          "x" in localTransform.scale
        ) {
          child.scale.set(
            localTransform.scale.x,
            localTransform.scale.y,
            localTransform.scale.z
          );
        } else if (typeof localTransform.scale === "number") {
          child.scale.setScalar(localTransform.scale);
        }
      }
    }

    console.log(
      `SceneManager: Reparented "${childName}" from "${sourceObjectId}" to new parent`
    );

    return child;
  }

  /**
   * Remove an object from the scene
   * @param {string} id - Object ID
   */
  removeObject(id) {
    const object = this.objects.get(id);
    if (object) {
      this.scene.remove(object);
      // Dispose of geometries and materials
      object.traverse((child) => {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((material) => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.objects.delete(id);
      console.log(`SceneManager: Removed "${id}"`);
    }
  }

  /**
   * Check if an object is loaded
   * @param {string} id - Object ID
   * @returns {boolean}
   */
  hasObject(id) {
    return this.objects.has(id);
  }

  /**
   * Check if an object is currently loading
   * @param {string} id - Object ID
   * @returns {boolean}
   */
  isLoading(id) {
    return this.loadingPromises.has(id);
  }

  /**
   * Get all loaded object IDs
   * @returns {Array<string>}
   */
  getObjectIds() {
    return Array.from(this.objects.keys());
  }

  /**
   * Play an animation by ID
   * @param {string} animationId - Animation ID from sceneData
   */
  playAnimation(animationId) {
    const action = this.animationActions.get(animationId);
    if (action) {
      action.reset();
      action.play();
      console.log(`SceneManager: Playing animation "${animationId}"`);
    } else {
      console.warn(`SceneManager: Animation "${animationId}" not found`);
    }
  }

  /**
   * Stop an animation by ID
   * @param {string} animationId - Animation ID from sceneData
   */
  stopAnimation(animationId) {
    const action = this.animationActions.get(animationId);
    if (action) {
      action.stop();
      console.log(`SceneManager: Stopped animation "${animationId}"`);
    }
  }

  /**
   * Check if an animation is currently playing
   * @param {string} animationId - Animation ID
   * @returns {boolean}
   */
  isAnimationPlaying(animationId) {
    const action = this.animationActions.get(animationId);
    return action ? action.isRunning() : false;
  }

  /**
   * Update all animation mixers
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    for (const mixer of this.animationMixers.values()) {
      mixer.update(dt);
    }
  }

  /**
   * Update animations based on game state
   * Uses criteria to determine whether animations should play or stop
   * @param {Object} gameState - Current game state
   */
  updateAnimationsForState(gameState) {
    if (!gameState || !gameState.currentState) return;

    for (const [animationId, config] of this.animationData) {
      if (!config.autoPlay) continue;

      // Check if animation has criteria
      if (!config.criteria) continue;

      const matchesCriteria = checkCriteria(gameState, config.criteria);
      const isPlaying = this.isAnimationPlaying(animationId);
      const hasPlayedOnce = this.playedAnimations.has(animationId);

      // If criteria matches and animation is not playing
      if (matchesCriteria && !isPlaying) {
        // Check playOnce - skip if already played
        if (config.playOnce && hasPlayedOnce) {
          continue;
        }

        // Play the animation
        this.playAnimation(animationId);
        if (config.playOnce) {
          this.playedAnimations.add(animationId);
        }
      }
      // If criteria doesn't match and animation is playing, stop it
      else if (!matchesCriteria && isPlaying) {
        this.stopAnimation(animationId);
      }
    }
  }

  /**
   * Clean up all scene objects
   */
  destroy() {
    // Stop all animations
    for (const action of this.animationActions.values()) {
      action.stop();
    }

    // Clear animation data
    this.animationMixers.clear();
    this.animationActions.clear();
    this.animationData.clear();

    // Remove all objects
    for (const id of this.objects.keys()) {
      this.removeObject(id);
    }
    this.objects.clear();
    this.loadingPromises.clear();
  }
}

export default SceneManager;

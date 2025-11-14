import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SplatMesh } from "@sparkjsdev/spark";
import { checkCriteria } from "./utils/criteriaHelper.js";
import { createHeadlightBeamShader } from "./vfx/shaders/headlightBeamShader.js";
import { ContactShadow } from "./vfx/contactShadow.js";
import { Logger } from "./utils/logger.js";

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
    this.renderer = options.renderer || null; // For contact shadows
    this.sparkRenderer = options.sparkRenderer || null; // For environment mapping
    this.gizmoManager = options.gizmoManager || null; // For debug positioning
    this.loadingScreen = options.loadingScreen || null; // For progress tracking
    this.physicsManager = options.physicsManager || null; // For creating physics colliders
    this.gameManager = options.gameManager || null; // For state-based updates
    this.colliderManager = null; // Will be set by setColliderManager() for trigger colliders
    this.pendingTriggerColliders = null; // Map of id -> zoneMeshes for deferred registration
    this.objects = new Map(); // Map of id -> THREE.Object3D
    this.objectData = new Map(); // Map of id -> original config data (for gizmo flag)
    this.gltfLoader = new GLTFLoader();
    // Create a loading manager to track all GLTF assets (including textures)
    this.gltfLoadingManager = new THREE.LoadingManager();
    this.gltfLoader.manager = this.gltfLoadingManager;
    this.loadingPromises = new Map(); // Track loading promises
    this.physicsColliderObjects = new Set(); // Track which objects have physics colliders
    this.objectsNotInScene = new Set(); // Track objects loaded but not added to scene (deferred loading)

    // Animation management
    this.animationMixers = new Map(); // Map of objectId -> THREE.AnimationMixer
    this.animationActions = new Map(); // Map of animationId -> THREE.AnimationAction
    this.animationData = new Map(); // Map of animationId -> animation data config
    this.animationToObject = new Map(); // Map of animationId -> objectId

    // Contact shadow management
    this.contactShadows = new Map(); // Map of objectId -> ContactShadow instance
    this.contactShadowCriteria = new Map(); // Map of objectId -> criteria config

    // Material render order management
    this.materialRenderOrders = new Map(); // Map of objectId -> { materialName: { renderOrder, criteria, meshes: [] } }
    this.materialRenderOrderState = new Map(); // Track previous state to avoid spam logging
    this.contactShadowState = new Map(); // Track previous shadow state to avoid spam logging

    // Environment map cache (stores promises to ensure only one render per position)
    this.envMapCache = new Map(); // Map of cacheKey -> Promise<envMap texture>

    // Event listeners
    this.eventListeners = {};

    // Asset loading progress tracking
    this.assetProgress = new Map(); // Map of asset id -> { loaded, total }

    // Logger for debug messages
    this.logger = new Logger("SceneManager", false); // Enable logging for debugging

    // Listen for state changes if gameManager provided
    if (this.gameManager) {
      this.gameManager.on("state:changed", (newState) => {
        this.updateContactShadowsForState(newState);
        this.updateMaterialRenderOrdersForState(newState);
      });
      this.logger.log(
        "Listening for game state changes (contact shadows, material render orders)"
      );
    }
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
   * @param {boolean} skipAddToScene - If true, load but don't add to scene (for deferred loading)
   * @returns {Promise<void>}
   */
  async loadObjectsForState(objectsToLoad, skipAddToScene = false) {
    if (!objectsToLoad || objectsToLoad.length === 0) {
      this.logger.log("No objects to load for current state");
      return;
    }

    // Sort by priority (descending) to ensure high-priority objects load first
    const sortedObjects = [...objectsToLoad].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );

    this.logger.log(
      `Loading ${sortedObjects.length} objects for current state (in priority order)`
    );

    let foundGizmo = false;

    // Load objects sequentially in priority order
    for (const objectData of sortedObjects) {
      try {
        const obj = await this.loadObject(objectData, skipAddToScene);
        if (objectData && objectData.gizmo === true) foundGizmo = true;
        // Track objects that aren't in scene
        if (skipAddToScene && obj) {
          this.objectsNotInScene.add(objectData.id);
        }
      } catch (error) {
        this.logger.error(`Failed to load object "${objectData.id}":`, error);
        // Continue loading other objects even if one fails
      }
    }

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
   * @param {boolean} skipAddToScene - If true, load but don't add to scene (for deferred loading)
   * @returns {Promise<THREE.Object3D>}
   */
  async loadObject(objectData, skipAddToScene = false) {
    const { id, type } = objectData;

    // Check if already loading
    if (this.loadingPromises.has(id)) {
      return this.loadingPromises.get(id);
    }

    // Check if already loaded
    if (this.objects.has(id)) {
      this.logger.warn(`Object "${id}" is already loaded`);
      return this.objects.get(id);
    }

    let loadPromise;

    switch (type) {
      case "splat":
        loadPromise = this._loadSplat(objectData, skipAddToScene);
        break;
      case "gltf":
        loadPromise = this._loadGLTF(objectData, skipAddToScene);
        break;
      default:
        this.logger.error(`Unknown object type "${type}"`);
        return null;
    }

    this.loadingPromises.set(id, loadPromise);

    try {
      const object = await loadPromise;
      this.objects.set(id, object);
      this.objectData.set(id, objectData); // Store original config
      this.loadingPromises.delete(id);

      if (skipAddToScene) {
        this.objectsNotInScene.add(id);
        this.logger.log(
          `Loaded "${id}" (${type}) - not added to scene (deferred)`
        );
      } else {
        this.logger.log(`Loaded "${id}" (${type})`);
      }

      // Handle parenting if specified
      if (objectData.parent) {
        const parentId = objectData.parent;
        let parentObject = this.objects.get(parentId);

        // Wait for parent if it's still loading
        if (!parentObject && this.loadingPromises.has(parentId)) {
          this.logger.log(`Waiting for parent "${parentId}" to load...`);
          parentObject = await this.loadingPromises.get(parentId);
        }

        if (parentObject) {
          // Remove from scene if it was added there
          if (object.parent === this.scene) {
            this.scene.remove(object);
          }
          // Add to parent
          parentObject.add(object);
          this.logger.log(`Parented "${id}" to "${parentId}"`);
        } else {
          this.logger.warn(`Parent "${parentId}" not found for "${id}"`);
        }
      }

      // Register with gizmo manager if gizmo flag is set
      if (objectData.gizmo && this.gizmoManager && object) {
        this.gizmoManager.registerObject(object, id, type);
      }

      return object;
    } catch (error) {
      this.loadingPromises.delete(id);
      this.logger.error(`Error loading "${id}":`, error);
      throw error;
    }
  }

  /**
   * Load a splat mesh
   * @param {Object} objectData - Splat object data
   * @param {boolean} skipAddToScene - If true, load but don't add to scene
   * @returns {Promise<SplatMesh>}
   * @private
   */
  async _loadSplat(objectData, skipAddToScene = false) {
    const { id, path, position, rotation, scale, quaternion } = objectData;

    // Register with loading screen only if preload is true
    // Treat undefined preload as false (deferred)
    const shouldPreload = objectData.preload === true;
    const shouldTrackProgress = shouldPreload && this.loadingScreen;
    if (shouldTrackProgress) {
      this.loadingScreen.registerTask(`splat_${id}`, 1);
    }

    // Track download progress for UI feedback
    let downloadProgress = 0;

    const splatMesh = new SplatMesh({
      url: path,
      editable: false, // Don't apply SplatEdit operations to scene splats (only fog)
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

    // Set position (support functions for dynamic positioning)
    if (position) {
      const resolvedPosition =
        typeof position === "function" ? position(this.gameManager) : position;
      splatMesh.position.set(
        resolvedPosition.x,
        resolvedPosition.y,
        resolvedPosition.z
      );
    }

    // Set scale
    if (scale) {
      if (typeof scale === "object" && "x" in scale) {
        splatMesh.scale.set(scale.x, scale.y, scale.z);
      } else if (typeof scale === "number") {
        splatMesh.scale.setScalar(scale);
      }
    }

    if (!skipAddToScene) {
      this.scene.add(splatMesh);
    }

    // Wait for initialization - this is the primary indicator that the asset is ready
    // The initialized promise only resolves when the asset is fully downloaded and processed
    // This ensures the browser has fully loaded the asset into memory before we continue
    await splatMesh.initialized;
    
    // Update progress to 100% if tracking (in case progress callback didn't fire or stopped early)
    // The initialized promise resolving means the asset is ready, so we can safely mark as complete
    if (shouldTrackProgress) {
      // Ensure progress shows 100% even if callback didn't reach it
      if (downloadProgress < 1.0) {
        this.loadingScreen.updateTask(`splat_${id}`, downloadProgress);
      }
    }

    // Mark as complete only if tracking progress
    if (shouldTrackProgress) {
      this.loadingScreen.completeTask(`splat_${id}`);
    }

    return splatMesh;
  }

  /**
   * Load a GLTF model
   * @param {Object} objectData - GLTF object data
   * @param {boolean} skipAddToScene - If true, load but don't add to scene
   * @returns {Promise<THREE.Object3D>}
   * @private
   */
  _loadGLTF(objectData, skipAddToScene = false) {
    return new Promise((resolve, reject) => {
      const { id, path, position, rotation, scale, options, animations } =
        objectData;

      // Register with loading screen only if preload is true
      // Treat undefined preload as false (deferred)
      const shouldPreload = objectData.preload === true;
      const shouldTrackProgress = shouldPreload && this.loadingScreen;
      if (shouldTrackProgress) {
        this.loadingScreen.registerTask(`gltf_${id}`, 1);
      }

      this.gltfLoader.load(
        path,
        async (gltf) => {
          const model = gltf.scene;

          // For preload assets, wait for all textures to be fully loaded
          // GLTFLoader callback fires when the GLTF file is loaded, but textures may still be loading
          if (shouldTrackProgress) {
            await this._waitForGLTFTextures(model);
          }

          // Traverse all children and ensure materials are visible
          // Also remove any lights from the GLTF (we manage lights separately)
          const lightsToRemove = [];
          model.traverse((child) => {
            if (child.isMesh) {
              if (child.material) {
                // Handle arrays of materials
                const materials = Array.isArray(child.material)
                  ? child.material
                  : [child.material];

                materials.forEach((material, index) => {
                  // Special handling for headlight beams - custom shader with Z-based fade
                  if (material.name === "headlightbeams") {
                    const customMaterial = createHeadlightBeamShader(material);
                    // Replace the material on this mesh
                    if (Array.isArray(child.material)) {
                      child.material[index] = customMaterial;
                    } else {
                      child.material = customMaterial;
                    }
                    // Set render order to ensure it renders before splats (SparkRenderer is 9998)
                    // This allows splats to properly occlude the beam
                    child.renderOrder = 9999;
                  } else {
                    material.needsUpdate = true;
                  }
                });
              }

              // Configure shadow casting/receiving
              // If contactShadow is enabled, automatically enable shadows
              if (options && options.contactShadow) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
              // Allow explicit shadow configuration
              if (options && options.castShadow !== undefined) {
                child.castShadow = options.castShadow;
              }
              if (options && options.receiveShadow !== undefined) {
                child.receiveShadow = options.receiveShadow;
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

          // Set position (support functions for dynamic positioning)
          if (position) {
            const resolvedPosition =
              typeof position === "function"
                ? position(this.gameManager)
                : position;
            finalObject.position.set(
              resolvedPosition.x,
              resolvedPosition.y,
              resolvedPosition.z
            );
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

          // Set visibility
          if (options && options.visible === false) {
            finalObject.visible = false;
            this.logger.log(`Set "${id}" to invisible`);
          }

          // Apply debug material if requested
          if (options && options.debugMaterial) {
            this._applyDebugMaterial(id, finalObject);
          }

          // Apply shadow blocker material if requested (depth-only rendering to block contact shadows)
          if (options && options.shadowBlocker) {
            this._applyShadowBlockerMaterial(id, finalObject);
          }

          // Create contact shadow if requested
          if (options && options.contactShadow && this.renderer) {
            const shadowConfig = {
              ...options.contactShadow,
              name: `${id}_contactShadow`,
              sparkRenderer: this.sparkRenderer, // Pass sparkRenderer to disable during rendering
            };
            // Map 'static' to 'isStatic' for backward compatibility
            if (shadowConfig.static !== undefined) {
              shadowConfig.isStatic = shadowConfig.static;
              delete shadowConfig.static;
            }
            const contactShadow = new ContactShadow(
              this.renderer,
              this.scene,
              finalObject,
              shadowConfig
            );
            this.contactShadows.set(id, contactShadow);

            // Store criteria if provided (optional)
            if (options.contactShadow.criteria) {
              this.contactShadowCriteria.set(
                id,
                options.contactShadow.criteria
              );
              this.logger.log(
                `Created contact shadow for "${id}" with criteria`
              );
            } else {
              this.logger.log(
                `Created contact shadow for "${id}" (always enabled)`
              );
            }
          } else if (options && options.contactShadow && !this.renderer) {
            this.logger.warn(
              `Cannot create contact shadow for "${id}" - renderer not provided to SceneManager`
            );
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

          // Setup material render orders if specified
          if (options && options.materialRenderOrder) {
            this._setupMaterialRenderOrders(
              id,
              finalObject,
              options.materialRenderOrder
            );
          }

          if (!skipAddToScene) {
            this.scene.add(finalObject);
          }

          // Create physics collider if flag is set
          if (options && options.physicsCollider && this.physicsManager) {
            this._createPhysicsCollider(id, finalObject, position, rotation);
          }

          // Create trigger colliders from child meshes if flag is set
          if (options && options.triggerColliders && this.physicsManager) {
            this.logger.log(`Creating trigger colliders for "${id}"`);
            this._createTriggerColliders(id, model, objectData);
          } else if (options && options.triggerColliders) {
            this.logger.warn(
              `Cannot create trigger colliders for "${id}" - physicsManager not available`
            );
          }

          // Apply environment mapping if requested
          if (options && options.envMap) {
            if (this.sparkRenderer) {
              // Debug: log what finalObject is BEFORE async envMap
              if (id === "candlestickPhone") {
                this.logger.log(
                  `PRE-ENVMAP: finalObject type: ${finalObject.type}, name: "${
                    finalObject.name || "unnamed"
                  }", children: ${finalObject.children.length}`
                );
                const logHierarchy = (obj, depth = 0) => {
                  const indent = "  ".repeat(depth);
                  this.logger.log(
                    `${indent}${obj.type} "${obj.name || "unnamed"}" (${
                      obj.children.length
                    } children)${obj.isMesh ? " [MESH]" : ""}`
                  );
                  if (depth < 3) {
                    obj.children.forEach((child) =>
                      logHierarchy(child, depth + 1)
                    );
                  }
                };
                logHierarchy(finalObject);
              }
              this.logger.log(
                `Starting environment map application for "${id}"`
              );
              this._applyEnvMap(id, finalObject, options.envMap).catch(
                (error) => {
                  this.logger.error(
                    `Failed to apply environment map to "${id}":`,
                    error
                  );
                }
              );
            } else {
              this.logger.warn(
                `Cannot apply environment map to "${id}" - sparkRenderer not provided to SceneManager`
              );
            }
          }

          // Mark as complete only if tracking progress (after textures are loaded)
          if (shouldTrackProgress) {
            this.loadingScreen.completeTask(`gltf_${id}`);
          }

          resolve(finalObject);
        },
        (xhr) => {
          // Progress callback
          if (xhr.lengthComputable && shouldTrackProgress) {
            const percentage = Math.round((xhr.loaded / xhr.total) * 100);
            this.loadingScreen.updateTask(`gltf_${id}`, percentage, 1);
          }
        },
        (error) => {
          // Complete task even on error to prevent loading screen from hanging
          if (shouldTrackProgress) {
            this.loadingScreen.completeTask(`gltf_${id}`);
          }
          reject(error);
        }
      );
    });
  }

  /**
   * Wait for all textures in a GLTF model to be fully loaded
   * @param {THREE.Object3D} model - The loaded GLTF model
   * @returns {Promise<void>}
   * @private
   */
  async _waitForGLTFTextures(model) {
    const texturePromises = [];

    model.traverse((child) => {
      if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];

        materials.forEach((material) => {
          // Check all texture properties
          const textureProperties = [
            "map",
            "normalMap",
            "roughnessMap",
            "metalnessMap",
            "aoMap",
            "emissiveMap",
            "bumpMap",
            "displacementMap",
            "alphaMap",
            "lightMap",
            "envMap",
          ];

          textureProperties.forEach((prop) => {
            const texture = material[prop];
            if (texture && texture instanceof THREE.Texture) {
              // Check if texture image is loaded
              if (texture.image) {
                if (texture.image instanceof Image) {
                  // Wait for image to load
                  if (!texture.image.complete) {
                    texturePromises.push(
                      new Promise((resolve) => {
                        texture.image.onload = resolve;
                        texture.image.onerror = resolve; // Resolve on error too to prevent hanging
                      })
                    );
                  }
                } else if (texture.image instanceof HTMLCanvasElement) {
                  // Canvas is already ready
                } else if (texture.image instanceof ImageData) {
                  // ImageData is already ready
                }
              }
            }
          });
        });
      }
    });

    // Wait for all textures to load
    if (texturePromises.length > 0) {
      await Promise.all(texturePromises);
    }
  }

  /**
   * Apply a debug material to visualize collision meshes
   * @param {string} id - Object ID
   * @param {THREE.Object3D} object - The loaded THREE.js object
   * @private
   */
  _applyDebugMaterial(id, object) {
    const debugMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
      wireframeLinewidth: 2,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
    });

    object.traverse((child) => {
      if (child.isMesh) {
        child.material = debugMaterial;
        // Set high render order so it renders on top
        child.renderOrder = 9999;
      }
    });

    this.logger.log(`Applied debug material to "${id}"`);
  }

  /**
   * Apply shadow blocker material (depth-only, no color) to block contact shadows
   * Renders after splats (9998) but before shadows (9999) to create depth mask
   * @param {string} id - Object ID
   * @param {THREE.Object3D} object - The loaded THREE.js object
   * @private
   */
  _applyShadowBlockerMaterial(id, object) {
    // Create shader material that writes depth but outputs transparent color
    const shadowBlockerMaterial = new THREE.ShaderMaterial({
      vertexShader: `
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        void main() {
          // Output fully transparent - no color, but depth is written
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      `,
      side: THREE.DoubleSide, // Double-sided as suggested by rendering engine author
      depthTest: true,
      depthWrite: true, // Write to depth buffer to block shadows
      transparent: true,
      // Shader outputs transparent color, so no color is written to framebuffer
    });

    object.traverse((child) => {
      if (child.isMesh) {
        child.material = shadowBlockerMaterial;
        // Render after splats (9998) but before shadows (9999)
        // Use 9998.1 to ensure it renders after splats but before shadows
        child.renderOrder = 9998.1;
      }
    });

    // Make object visible so it renders (even though it's transparent)
    object.visible = true;

    this.logger.log(`Applied shadow blocker material to "${id}"`);
  }

  /**
   * Apply environment mapping to a GLTF object
   * @param {string} id - Object ID
   * @param {THREE.Object3D} object - The loaded THREE.js object
   * @param {Object} envMapConfig - Environment map configuration
   * @returns {Promise<void>}
   * @private
   */
  async _applyEnvMap(id, object, envMapConfig) {
    if (!this.sparkRenderer) {
      this.logger.warn(`Cannot apply env map - sparkRenderer not available`);
      return;
    }

    // IMPORTANT: Collect all meshes and materials NOW before async operations
    // Other scripts might reparent or modify the object during the async waits
    const meshesToProcess = [];
    object.traverse((child) => {
      if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        meshesToProcess.push({ mesh: child, materials });
      }
    });
    this.logger.log(
      `Collected ${meshesToProcess.length} meshes before async operations`
    );

    // Wait for all objects that are currently loading to finish
    // This ensures splat scenes that are loading in parallel are ready
    this.logger.log(`Waiting for all loading objects to complete...`);
    const loadingPromises = Array.from(this.loadingPromises.entries());
    if (loadingPromises.length > 0) {
      this.logger.log(`  ${loadingPromises.length} object(s) still loading`);
      await Promise.all(
        loadingPromises.map(([objId, promise]) => {
          this.logger.log(`  Waiting for "${objId}"...`);
          return promise.catch(() => {
            // Ignore errors, we just want to wait
          });
        })
      );
      this.logger.log(`  All loading objects complete ✓`);
    }

    // Now wait for all splat meshes to be fully initialized before rendering envMap
    this.logger.log(`Waiting for splat scenes to initialize before envMap...`);
    const splatWaitPromises = [];
    for (const [objId, obj] of this.objects) {
      // Check if this is a SplatMesh (has initialized property)
      if (obj.initialized && typeof obj.initialized.then === "function") {
        this.logger.log(`  Waiting for splat "${objId}" to initialize...`);
        splatWaitPromises.push(
          obj.initialized.then(() => {
            this.logger.log(`  Splat "${objId}" initialized ✓`);
          })
        );
      }
    }

    if (splatWaitPromises.length > 0) {
      await Promise.all(splatWaitPromises);
      this.logger.log(
        `All ${splatWaitPromises.length} splat(s) initialized, proceeding with envMap`
      );
    } else {
      this.logger.warn(
        `No splat meshes found - envMap may not capture environment correctly`
      );
    }

    // Get world center from the splat scene's envMapWorldCenter property
    const worldCenter = new THREE.Vector3();
    let worldCenterFound = false;

    // Look for a splat with envMapWorldCenter defined
    for (const [splatId, splatObj] of this.objects) {
      const splatData = this.objectData.get(splatId);
      if (splatData && splatData.envMapWorldCenter) {
        worldCenter.set(
          splatData.envMapWorldCenter.x,
          splatData.envMapWorldCenter.y,
          splatData.envMapWorldCenter.z
        );
        worldCenterFound = true;
        this.logger.log(`  Using envMapWorldCenter from splat "${splatId}"`);
        break;
      }
    }

    // Fallback to object position if no splat defines envMapWorldCenter
    if (!worldCenterFound) {
      object.getWorldPosition(worldCenter);
      this.logger.log(
        `  No splat with envMapWorldCenter found, using object position`
      );
    }

    // Build list of objects to hide (defaults to this object)
    const hideObjects = [];
    if (envMapConfig.hideObjects) {
      // Convert object IDs to actual THREE.Object3D references
      for (const objId of envMapConfig.hideObjects) {
        const obj = this.getObject(objId);
        if (obj) {
          hideObjects.push(obj);
        } else {
          this.logger.warn(
            `EnvMap hideObjects: object "${objId}" not found, skipping`
          );
        }
      }
    } else {
      // Default: hide this object
      hideObjects.push(object);
    }

    // Create cache key from worldCenter position (rounded to avoid floating point issues)
    const cacheKey = `${worldCenter.x.toFixed(2)}_${worldCenter.y.toFixed(
      2
    )}_${worldCenter.z.toFixed(2)}`;

    this.logger.log(`Environment map for "${id}":`);
    this.logger.log(
      `  World center: (${worldCenter.x.toFixed(2)}, ${worldCenter.y.toFixed(
        2
      )}, ${worldCenter.z.toFixed(2)})`
    );

    try {
      let envMap;

      // Check if we already have a cached envMap promise for this position
      if (this.envMapCache.has(cacheKey)) {
        this.logger.log(`  ⏳ Waiting for cached envMap (key: ${cacheKey})`);
        envMap = await this.envMapCache.get(cacheKey);
        this.logger.log(`  ✓ Using cached envMap (key: ${cacheKey})`);
      } else {
        // Start rendering and immediately cache the promise
        // This ensures only the first object renders, others will wait
        this.logger.log(`  🎨 Rendering new envMap (key: ${cacheKey})...`);
        this.logger.log(
          `  Hiding ${hideObjects.length} object(s) during render`
        );

        // Defer environment map rendering to avoid "Only one sort at a time" error
        // Wait for next animation frame to ensure SparkRenderer isn't busy with main render
        const renderPromise = new Promise((resolve, reject) => {
          requestAnimationFrame(async () => {
            try {
              const envMapTexture = await this.sparkRenderer.renderEnvMap({
                scene: this.scene,
                worldCenter: worldCenter,
                hideObjects: hideObjects,
                update: true, // Guard against first-render issues
              });
              resolve(envMapTexture);
            } catch (error) {
              this.logger.error(`EnvMap render failed for "${id}":`, error);
              reject(error);
            }
          });
        });

        // Cache the promise immediately (before awaiting)
        // This prevents other objects from starting their own render
        this.envMapCache.set(cacheKey, renderPromise);

        envMap = await renderPromise;
        this.logger.log(`  ✓ EnvMap rendered and cached (key: ${cacheKey})`);
      }

      // Apply envMap to materials
      const defaultMetalness =
        envMapConfig.metalness !== undefined ? envMapConfig.metalness : 1.0;
      const defaultRoughness =
        envMapConfig.roughness !== undefined ? envMapConfig.roughness : 0.02;
      const defaultEnvMapIntensity =
        envMapConfig.envMapIntensity !== undefined
          ? envMapConfig.envMapIntensity
          : 1.0;
      const materialNames = envMapConfig.materials || null; // null = all materials
      const excludeMaterials = envMapConfig.excludeMaterials || [];
      const materialOverrides = envMapConfig.materialOverrides || {};

      let appliedCount = 0;

      // Process the meshes we collected earlier (before async operations)
      this.logger.log(`Processing ${meshesToProcess.length} collected meshes`);

      meshesToProcess.forEach(({ mesh, materials }) => {
        this.logger.log(`  Processing mesh: "${mesh.name || "unnamed"}"`);

        materials.forEach((material) => {
          // Debug: log material type and properties for candlestickPhone
          if (id === "candlestickPhone") {
            this.logger.log(
              `    Material debug: name="${material.name || "NONE"}", type="${
                material.type
              }", uuid="${material.uuid.substring(0, 8)}"`
            );
          }

          // Skip contact shadow shader materials (but not regular materials with "Shader" in the name)
          if (
            material.name &&
            (material.name.includes("BlurShader") ||
              material.name.includes("ContactShadow"))
          ) {
            this.logger.log(`  ✗ Skipped "${material.name}" (shader material)`);
            return;
          }

          // Skip excluded materials
          if (excludeMaterials.includes(material.name)) {
            this.logger.log(`  ✗ Skipped "${material.name}" (excluded)`);
            return;
          }

          // Check if we should apply to this specific material
          if (
            !materialNames ||
            materialNames.includes(material.name) ||
            materialNames.length === 0
          ) {
            // Check for material-specific overrides
            const override = materialOverrides[material.name];
            const metalness = override?.metalness ?? defaultMetalness;
            const roughness = override?.roughness ?? defaultRoughness;
            const envMapIntensity =
              override?.envMapIntensity ?? defaultEnvMapIntensity;

            // Store original color if not already stored (and material has color)
            if (!material.userData) material.userData = {};
            if (!material.userData.original_color && material.color) {
              material.userData.original_color = material.color.clone();
            }

            material.envMap = envMap;
            material.metalness = metalness;
            material.roughness = roughness;
            material.envMapIntensity = envMapIntensity;
            material.needsUpdate = true;
            appliedCount++;

            const colorHex = material.color
              ? material.color.getHexString()
              : "no-color";
            const overrideNote = override ? " [OVERRIDE]" : "";
            this.logger.log(
              `  ✓ "${
                material.name || "unnamed"
              }" | color: #${colorHex} | M=${metalness.toFixed(
                2
              )} R=${roughness.toFixed(2)} I=${envMapIntensity.toFixed(
                1
              )}${overrideNote}`
            );
          }
        });
      });

      this.logger.log(
        `✓ Applied environment map to ${appliedCount} material(s) on "${id}"`
      );
      this.logger.log(
        `  Default settings: metalness=${defaultMetalness}, roughness=${defaultRoughness}, envMapIntensity=${defaultEnvMapIntensity}`
      );
      if (Object.keys(materialOverrides).length > 0) {
        this.logger.log(
          `  Material overrides: ${Object.keys(materialOverrides).join(", ")}`
        );
      }
      if (excludeMaterials.length > 0) {
        this.logger.log(`  Excluded materials: ${excludeMaterials.join(", ")}`);
      }
      if (envMap) {
        this.logger.log(
          `  EnvMap texture: ✓ Created (${envMap.image?.width || "unknown"}x${
            envMap.image?.height || "unknown"
          })`
        );
      } else {
        this.logger.error(`  EnvMap texture: ✗ Failed to create`);
      }
    } catch (error) {
      this.logger.error(`Error rendering environment map for "${id}":`, error);
      throw error;
    }
  }

  /**
   * Create trigger colliders from child meshes in a GLTF model
   * Looks for meshes matching "ZoneCollider-*" pattern and registers them as trimesh trigger colliders
   * @param {string} id - Object ID
   * @param {THREE.Object3D} model - The loaded GLTF model
   * @param {Object} objectData - Object data from sceneData.js
   * @private
   */
  _createTriggerColliders(id, model, objectData) {
    this.logger.log(`_createTriggerColliders called for "${id}"`);
    if (!this.physicsManager) {
      this.logger.warn(
        `Cannot create trigger colliders for "${id}" - physicsManager not available`
      );
      return;
    }

    // Map mesh names to zone names
    const meshNameToZone = {
      "ZoneCollider-AlleyIntro": "alleyIntro",
      "ZoneCollider-AlleyNavigable": "alleyNavigable",
      "ZoneCollider-FourWay": "fourWay",
      "ZoneCollider-ThreeWay": "threeWay",
      "ZoneCollider-ThreeWay2": "threeWay2",
      "ZoneCollider-Plaza": "plaza",
    };

    // Find all meshes matching ZoneCollider-* pattern
    const zoneMeshes = [];
    model.traverse((child) => {
      if (child.isMesh && child.name.startsWith("ZoneCollider-")) {
        const zoneName = meshNameToZone[child.name];
        if (zoneName) {
          zoneMeshes.push({ mesh: child, zoneName });
          this.logger.log(
            `Found ZoneCollider mesh "${child.name}" -> mapped to zone "${zoneName}"`
          );
        } else {
          this.logger.warn(
            `Found ZoneCollider mesh "${
              child.name
            }" but no zone mapping defined. Available mappings: ${Object.keys(
              meshNameToZone
            ).join(", ")}`
          );
        }
      }
    });

    if (zoneMeshes.length === 0) {
      this.logger.warn(
        `No ZoneCollider meshes found in "${id}" - expected meshes matching "ZoneCollider-*" pattern`
      );
      return;
    }

    this.logger.log(
      `Found ${zoneMeshes.length} ZoneCollider mesh(es) in "${id}"`
    );

    // Register each mesh as a trimesh trigger collider
    // Note: ColliderManager needs to be accessible - it's set via setColliderManager
    if (!this.colliderManager) {
      this.logger.warn(
        `Cannot register trigger colliders for "${id}" - colliderManager not set. Call sceneManager.setColliderManager(colliderManager) first. Storing for later registration.`
      );
      // Store for later registration
      if (!this.pendingTriggerColliders) {
        this.pendingTriggerColliders = new Map();
      }
      this.pendingTriggerColliders.set(id, zoneMeshes);
      this.logger.log(
        `Stored ${zoneMeshes.length} zone mesh(es) for "${id}" in pendingTriggerColliders`
      );
      return;
    }

    // Import GAME_STATES for criteria
    import("./gameData.js").then(({ GAME_STATES }) => {
      // Register each zone mesh as a trigger collider
      for (const { mesh, zoneName } of zoneMeshes) {
        // Make zone collider meshes invisible and remove materials (they're just for collision detection)
        mesh.visible = false;
        if (mesh.material) {
          // Dispose of materials to free memory
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          materials.forEach((mat) => {
            if (mat.dispose) mat.dispose();
          });
          mesh.material = null;
        }

        const colliderId = `zone-${zoneName}`;
        const colliderData = {
          id: colliderId,
          // Don't set state on enter/exit - let ColliderManager call addActiveZone/removeActiveZone directly
          // This prevents feedback loops and state-based zone switching
          once: false, // Allow entering/exiting multiple times
          enabled: true,
          criteria: {
            currentState: { $lt: GAME_STATES.OFFICE_INTERIOR },
          },
        };

        const success = this.colliderManager.registerTrimeshTriggerCollider(
          colliderId,
          mesh,
          colliderData
        );

        if (success) {
          this.logger.log(
            `Registered trigger collider "${colliderId}" from mesh "${mesh.name}" -> zone "${zoneName}"`
          );
        } else {
          this.logger.warn(
            `Failed to register trigger collider "${colliderId}" from mesh "${mesh.name}"`
          );
        }
      }
    });
  }

  /**
   * Set collider manager reference (for registering trigger colliders from GLTF meshes)
   * @param {ColliderManager} colliderManager - ColliderManager instance
   */
  setColliderManager(colliderManager) {
    this.colliderManager = colliderManager;
    this.logger.log(`ColliderManager set on SceneManager`);

    // Register any pending trigger colliders
    if (this.pendingTriggerColliders && this.pendingTriggerColliders.size > 0) {
      this.logger.log(
        `Registering ${
          this.pendingTriggerColliders.size
        } pending trigger collider set(s): ${Array.from(
          this.pendingTriggerColliders.keys()
        ).join(", ")}`
      );
      for (const [id, zoneMeshes] of this.pendingTriggerColliders) {
        const objectData = this.objectData.get(id);
        if (objectData && objectData.options?.triggerColliders) {
          const model = this.objects.get(id);
          if (model) {
            // Find the actual model (might be wrapped in container)
            const actualModel =
              model.children.length > 0 && model.children[0]?.type === "Scene"
                ? model.children[0]
                : model;
            this.logger.log(
              `Registering pending trigger colliders for "${id}"`
            );
            this._createTriggerColliders(id, actualModel, objectData);
          } else {
            this.logger.warn(
              `Cannot register pending trigger colliders for "${id}" - model not found`
            );
          }
        } else {
          this.logger.warn(
            `Cannot register pending trigger colliders for "${id}" - objectData or triggerColliders option not found`
          );
        }
      }
      this.pendingTriggerColliders.clear();
    } else {
      this.logger.log(`No pending trigger colliders to register`);
    }

    // Also check all already-loaded objects for triggerColliders option
    // This handles the case where objects were loaded before colliderManager was set
    this.logger.log(
      `Checking ${this.objects.size} already-loaded objects for triggerColliders`
    );
    for (const [id, model] of this.objects) {
      const objectData = this.objectData.get(id);
      if (objectData && objectData.options?.triggerColliders) {
        // Check if colliders were already registered (would be in colliderManager.colliders)
        const zoneColliders = this.colliderManager.colliders.filter((c) =>
          c.id.startsWith(`zone-`)
        );
        const alreadyRegistered = zoneColliders.length > 0;

        if (!alreadyRegistered) {
          this.logger.log(
            `Found already-loaded object "${id}" with triggerColliders option - creating trigger colliders now`
          );
          // Find the actual model (might be wrapped in container)
          const actualModel =
            model.children.length > 0 && model.children[0]?.type === "Scene"
              ? model.children[0]
              : model;
          this._createTriggerColliders(id, actualModel, objectData);
        } else {
          this.logger.log(
            `Trigger colliders already registered (${zoneColliders.length} zone colliders found)`
          );
        }
      }
    }
  }

  /**
   * Create a physics collider for a loaded object
   * @param {string} id - Object ID
   * @param {THREE.Object3D} object - The loaded THREE.js object
   * @param {Object} position - Position from objectData
   * @param {Object} rotation - Rotation from objectData (Euler angles in radians)
   * @private
   */
  _createPhysicsCollider(id, object, position, rotation) {
    try {
      // Convert Euler rotation to quaternion for Rapier
      const euler = new THREE.Euler(
        rotation?.x || 0,
        rotation?.y || 0,
        rotation?.z || 0
      );
      const quat = new THREE.Quaternion().setFromEuler(euler);

      const result = this.physicsManager.createTrimeshCollider(
        id,
        object,
        position || { x: 0, y: 0, z: 0 },
        { x: quat.x, y: quat.y, z: quat.z, w: quat.w }
      );

      if (result) {
        this.physicsColliderObjects.add(id);
        this.logger.log(`Created physics trimesh collider for "${id}"`);
      } else {
        this.logger.error(`Failed to create physics collider for "${id}"`);
      }
    } catch (error) {
      this.logger.error(`Error creating physics collider for "${id}":`, error);
    }
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
          this.logger.log(`Animation "${animId}" finished`);

          // Get the animation config
          const config = this.animationData.get(animId);

          // Call onComplete callback if provided
          if (config && config.onComplete && this.gameManager) {
            try {
              config.onComplete(this.gameManager);
            } catch (error) {
              this.logger.error(
                `Error in onComplete callback for animation "${animId}":`,
                error
              );
            }
          }

          // Emit animation:finished event
          this.emit("animation:finished", animId);

          // Check if we should remove the object after animation finishes
          if (config && config.removeObjectOnFinish) {
            const objectId = this.animationToObject.get(animId);
            if (objectId) {
              this.logger.log(
                `Removing object "${objectId}" after animation "${animId}" finished`
              );
              this.removeObject(objectId);
            }
          }
          break;
        }
      }
    });

    // Log available clips for debugging
    this.logger.log(
      `Available animation clips for "${objectId}":`,
      clips.map((c) => c.name)
    );

    animationConfigs.forEach((config) => {
      // Find the clip
      let clip;
      if (config.clipName) {
        clip = clips.find((c) => c.name === config.clipName);
        if (!clip) {
          this.logger.warn(
            `Animation clip "${config.clipName}" not found for "${config.id}". Available:`,
            clips.map((c) => c.name)
          );
        }
      } else {
        // Use first clip if no name specified
        clip = clips[0];
      }

      if (!clip) {
        this.logger.warn(`No animation clip found for "${config.id}"`);
        return;
      }

      // Create action
      const action = mixer.clipAction(clip);
      action.loop = config.loop ? THREE.LoopRepeat : THREE.LoopOnce;
      action.timeScale = config.timeScale || 1.0;
      action.clampWhenFinished = !config.loop;

      // Store action, config, and object mapping
      this.animationActions.set(config.id, action);
      this.animationData.set(config.id, config);
      this.animationToObject.set(config.id, objectId);

      this.logger.log(
        `Registered animation "${config.id}" for object "${objectId}"`
      );
    });
  }

  /**
   * Setup material render orders for a GLTF object
   * @param {string} objectId - Object ID
   * @param {THREE.Object3D} object - The loaded object
   * @param {Object} materialRenderOrderConfig - Material render order configuration
   * @private
   */
  _setupMaterialRenderOrders(objectId, object, materialRenderOrderConfig) {
    const configMap = new Map();

    for (const [materialName, config] of Object.entries(
      materialRenderOrderConfig
    )) {
      const meshes = [];

      object.traverse((child) => {
        if (child.isMesh && child.material) {
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];

          materials.forEach((material) => {
            if (material.name === materialName) {
              meshes.push(child);
            }
          });
        }
      });

      if (meshes.length > 0) {
        configMap.set(materialName, {
          renderOrder: config.renderOrder,
          criteria: config.criteria,
          meshes: meshes,
        });

        this.logger.log(
          `Found ${meshes.length} mesh(es) with material "${materialName}" for object "${objectId}"`
        );

        if (!config.criteria) {
          meshes.forEach((mesh) => {
            mesh.renderOrder = config.renderOrder;
          });
          this.logger.log(
            `Applied renderOrder ${config.renderOrder} to material "${materialName}" (no criteria)`
          );
        } else {
          this.logger.log(
            `Material "${materialName}" renderOrder will be applied when criteria match`
          );
        }
      } else {
        this.logger.warn(
          `Material "${materialName}" not found in object "${objectId}"`
        );
      }
    }

    if (configMap.size > 0) {
      this.materialRenderOrders.set(objectId, configMap);
    }
  }

  /**
   * Update material render orders based on game state
   * @param {Object} gameState - Current game state
   */
  updateMaterialRenderOrdersForState(gameState) {
    if (this.materialRenderOrders.size === 0) return;

    for (const [objectId, materialMap] of this.materialRenderOrders) {
      for (const [materialName, config] of materialMap) {
        if (!config.criteria) continue;

        const matches = checkCriteria(gameState, config.criteria);
        const stateKey = `${objectId}:${materialName}`;
        const previousState = this.materialRenderOrderState.get(stateKey);

        // Only log if state actually changed
        if (previousState !== matches) {
          config.meshes.forEach((mesh) => {
            if (matches) {
              mesh.renderOrder = config.renderOrder;
            } else {
              mesh.renderOrder = 0;
            }
          });

          this.logger.log(
            `Material "${materialName}" on "${objectId}": renderOrder ${
              matches ? config.renderOrder : 0
            } (state=${gameState.currentState}, criteria ${
              matches ? "matched" : "not matched"
            })`
          );
          this.materialRenderOrderState.set(stateKey, matches);
        } else {
          // Still update renderOrder even if logging is skipped
          config.meshes.forEach((mesh) => {
            if (matches) {
              mesh.renderOrder = config.renderOrder;
            } else {
              mesh.renderOrder = 0;
            }
          });
        }
      }
    }
  }

  /**
   * Add an object to the scene (for objects that were loaded but not added due to deferred loading)
   * @param {string} id - Object ID
   */
  addObjectToScene(id) {
    const object = this.objects.get(id);
    if (!object) {
      this.logger.warn(`Cannot add object "${id}" to scene - object not found`);
      return false;
    }

    // Check if object is already in scene
    if (object.parent === this.scene || this.scene.children.includes(object)) {
      this.objectsNotInScene.delete(id);
      return true; // Already in scene
    }

    // Add to scene
    this.scene.add(object);
    this.objectsNotInScene.delete(id);
    this.logger.log(`Added deferred object "${id}" to scene`);
    return true;
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
      this.logger.warn(`Object "${objectId}" not found`);
      return null;
    }

    let foundChild = null;
    object.traverse((child) => {
      if (child.name === childName) {
        foundChild = child;
      }
    });

    if (!foundChild) {
      this.logger.warn(`Child "${childName}" not found in "${objectId}"`);
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

    this.logger.log(
      `Reparented "${childName}" from "${sourceObjectId}" to new parent`
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
      // Force visibility to false before removal
      object.visible = false;
      // Clean up animations for this object
      const mixer = this.animationMixers.get(id);
      if (mixer) {
        // Stop all actions in this mixer
        mixer.stopAllAction();
        // Remove all animation actions associated with this object
        for (const [animId, action] of this.animationActions.entries()) {
          // Check if this action belongs to this mixer
          if (action.getMixer() === mixer) {
            this.animationActions.delete(animId);
            this.animationData.delete(animId);
            this.animationToObject.delete(animId);
          }
        }
        // Remove the mixer
        this.animationMixers.delete(id);
      }

      // Clean up contact shadow if this object has one
      const contactShadow = this.contactShadows.get(id);
      if (contactShadow) {
        contactShadow.dispose();
        this.contactShadows.delete(id);
        this.logger.log(`Removed contact shadow for "${id}"`);
      }

      // Clean up contact shadow criteria
      if (this.contactShadowCriteria.has(id)) {
        this.contactShadowCriteria.delete(id);
      }

      // Clean up contact shadow state tracking
      if (this.contactShadowState.has(id)) {
        this.contactShadowState.delete(id);
      }

      // Clean up material render orders if this object has any
      if (this.materialRenderOrders.has(id)) {
        this.materialRenderOrders.delete(id);
        this.logger.log(`Removed material render orders for "${id}"`);
      }

      // Clean up material render order state tracking (entries are keyed as "objectId:materialName")
      for (const [stateKey] of this.materialRenderOrderState.entries()) {
        if (stateKey.startsWith(`${id}:`)) {
          this.materialRenderOrderState.delete(stateKey);
        }
      }

      // Clean up physics collider if this object has one
      if (this.physicsColliderObjects.has(id) && this.physicsManager) {
        const removed = this.physicsManager.removeTrimeshCollider(id);
        if (removed) {
          this.physicsColliderObjects.delete(id);
          this.logger.log(`Removed physics collider for "${id}"`);
        }
      }

      // Clean up pending trigger colliders if this object has any
      if (
        this.pendingTriggerColliders &&
        this.pendingTriggerColliders.has(id)
      ) {
        this.pendingTriggerColliders.delete(id);
      }

      // Dispose SplatMesh if this is a splat (frees buffers via packedSplats)
      if (object instanceof SplatMesh) {
        object.dispose();
        this.logger.log(`Disposed SplatMesh buffers for "${id}"`);
      }

      // Force visibility to false and remove from scene
      object.visible = false;
      if (object.parent) {
        object.parent.remove(object);
      }
      this.scene.remove(object);

      // Dispose of geometries and materials (for GLTF objects)
      // Note: SplatMesh disposal is handled above, but traverse is safe to call
      object.traverse((child) => {
        child.visible = false; // Hide all children
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
      this.objectData.delete(id);
      this.objectsNotInScene.delete(id); // Clean up deferred loading tracking
      this.logger.log(`Removed "${id}"`);
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
      this.logger.log(`Playing animation "${animationId}"`);
    } else {
      this.logger.warn(`Animation "${animationId}" not found`);
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
      this.logger.log(`Stopped animation "${animationId}"`);
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
   * Update all contact shadows
   * Call this in your animation loop to render contact shadows
   * @param {number} deltaTime - Time since last frame in seconds
   */
  updateContactShadows(deltaTime = 0) {
    // Early exit if no contact shadows (performance optimization)
    if (this.contactShadows.size === 0) return;

    for (const contactShadow of this.contactShadows.values()) {
      contactShadow.update(deltaTime); // Update fade animations
      contactShadow.render();
    }
  }

  /**
   * Update contact shadow enabled state based on game state
   * Uses criteria to determine whether shadows should be enabled
   * Called automatically on state changes if gameManager is available
   * @param {Object} gameState - Current game state
   */
  updateContactShadowsForState(gameState) {
    // Only run if we have criteria to check
    if (this.contactShadowCriteria.size === 0) return;

    for (const [id, criteria] of this.contactShadowCriteria) {
      const contactShadow = this.contactShadows.get(id);
      if (!contactShadow) continue;

      const matches = checkCriteria(gameState, criteria);
      const previousState = this.contactShadowState.get(id);

      // Only log if state actually changed
      if (previousState !== matches) {
        // Use enable/disable methods to trigger fade animations
        if (matches) {
          contactShadow.enable();
        } else {
          contactShadow.disable();
        }

        this.logger.log(
          `Contact shadow "${id}" ${matches ? "enabled" : "disabled"} (state=${
            gameState.currentState
          }, criteria check ${matches ? "passed" : "failed"})`
        );
        this.contactShadowState.set(id, matches);
      }
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
      const action = this.animationActions.get(animationId);

      // If criteria matches and animation is not playing
      if (matchesCriteria && !isPlaying) {
        // For non-looping animations, check if they've already finished
        // (if action exists but not running, it means it finished)
        if (!config.loop && action && action.time > 0) {
          continue; // Animation finished, don't restart
        }

        // Play the animation
        this.playAnimation(animationId);
      }
      // If criteria doesn't match and animation is playing, stop it
      else if (!matchesCriteria && isPlaying) {
        this.stopAnimation(animationId);
      }
    }
  }

  /**
   * Capture an environment map at a specific position and optionally download it
   * Useful for debugging and creating reusable environment map assets
   *
   * @param {Object} options - Capture options
   * @param {THREE.Vector3|Object} options.position - World position to capture from (default: {x:0, y:0, z:0})
   * @param {Array<string>} options.hideObjectIds - Array of object IDs to hide during capture
   * @param {boolean} options.download - Whether to download the resulting texture (default: true)
   * @param {string} options.filename - Filename for download (default: "envmap.png")
   * @returns {Promise<THREE.Texture>} The captured environment map texture
   */
  async captureEnvMap(options = {}) {
    if (!this.sparkRenderer) {
      throw new Error(
        "SparkRenderer not available - cannot capture environment map"
      );
    }

    // Parse options
    const position = options.position || { x: 0, y: 0, z: 0 };
    const worldCenter = new THREE.Vector3(position.x, position.y, position.z);
    const hideObjectIds = options.hideObjectIds || [];
    const shouldDownload = options.download !== false; // Default true
    const filename = options.filename || "envmap.png";

    // Convert object IDs to THREE.Object3D references
    const hideObjects = [];
    for (const objId of hideObjectIds) {
      const obj = this.getObject(objId);
      if (obj) {
        hideObjects.push(obj);
      } else {
        this.logger.warn(`captureEnvMap: object "${objId}" not found`);
      }
    }

    this.logger.log(
      `Capturing environment map at position (${worldCenter.x.toFixed(
        2
      )}, ${worldCenter.y.toFixed(2)}, ${worldCenter.z.toFixed(2)})`
    );
    if (hideObjects.length > 0) {
      this.logger.log(
        `  Hiding ${hideObjects.length} object(s): ${hideObjectIds.join(", ")}`
      );
    }

    // Wait for all loading to complete
    const loadingPromises = Array.from(this.loadingPromises.values());
    if (loadingPromises.length > 0) {
      this.logger.log(
        `  Waiting for ${loadingPromises.length} object(s) to finish loading...`
      );
      await Promise.all(loadingPromises.map((p) => p.catch(() => {})));
    }

    // Wait for splat initialization
    const splatWaitPromises = [];
    for (const [objId, obj] of this.objects) {
      if (obj.initialized && typeof obj.initialized.then === "function") {
        splatWaitPromises.push(obj.initialized);
      }
    }
    if (splatWaitPromises.length > 0) {
      await Promise.all(splatWaitPromises);
    }

    // Render the environment map
    this.logger.log(`  Rendering environment map...`);

    // Defer to next frame to avoid "Only one sort at a time" error
    const envMap = await new Promise((resolve, reject) => {
      requestAnimationFrame(async () => {
        try {
          const texture = await this.sparkRenderer.renderEnvMap({
            scene: this.scene,
            worldCenter: worldCenter,
            hideObjects: hideObjects,
            update: true,
          });
          resolve(texture);
        } catch (error) {
          reject(error);
        }
      });
    });

    this.logger.log(
      `  ✓ Environment map captured (${envMap.image?.width || "unknown"}x${
        envMap.image?.height || "unknown"
      })`
    );

    // Download if requested
    if (shouldDownload) {
      await this._downloadTexture(envMap, filename);
    }

    return envMap;
  }

  /**
   * Download a rendered view of the scene using SparkRenderer
   * Captures the splat scene from the envMapWorldCenter position
   * @param {THREE.Texture} texture - Texture (unused, we render fresh from scene)
   * @param {string} filename - Filename for download
   * @private
   */
  async _downloadTexture(texture, filename) {
    if (!this.renderer) {
      this.logger.error("THREE.WebGLRenderer not available");
      return;
    }

    // Create shader to convert cube/PMREM texture to equirectangular
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      #include <common>
      varying vec2 vUv;
      uniform samplerCube envMap;
      
      void main() {
        vec2 uv = vUv;
        float theta = uv.x * PI * 2.0;
        float phi = uv.y * PI;
        
        vec3 dir = vec3(
          sin(phi) * cos(theta),
          cos(phi),
          sin(phi) * sin(theta)
        );
        
        gl_FragColor = textureCube(envMap, dir);
      }
    `;

    // Create render target
    const width = 2048;
    const height = 1024;
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    // Create scene with plane
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        envMap: { value: texture },
      },
    });

    const plane = new THREE.Mesh(geometry, material);
    scene.add(plane);

    // Render to target
    this.renderer.setRenderTarget(renderTarget);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);

    // Read pixels
    const buffer = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(
      renderTarget,
      0,
      0,
      width,
      height,
      buffer
    );

    // Create canvas and draw pixels
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(buffer);
    ctx.putImageData(imageData, 0, 0);

    // Download
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      this.logger.log(`  ✓ Downloaded equirectangular map as "${filename}"`);
    }, "image/png");

    // Cleanup
    geometry.dispose();
    material.dispose();
    renderTarget.dispose();
  }

  /**
   * Move the camera to an envMapWorldCenter position for manual screenshot capture
   * @param {string} sceneId - ID of scene object with envMapWorldCenter (e.g., "interior")
   */
  moveCameraToEnvMapCenter(sceneId) {
    const sceneData = this.objectData.get(sceneId);
    if (!sceneData || !sceneData.envMapWorldCenter) {
      this.logger.error(
        `Scene "${sceneId}" not found or doesn't have envMapWorldCenter`
      );
      return;
    }

    const pos = sceneData.envMapWorldCenter;
    if (window.camera) {
      window.camera.position.set(pos.x, pos.y, pos.z);
      this.logger.log(
        `✓ Camera moved to envMapWorldCenter: (${pos.x}, ${pos.y}, ${pos.z})`
      );
      this.logger.log(
        "Take a screenshot now! This is what your environment map sees."
      );
    } else {
      this.logger.error("window.camera not available");
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
    this.animationToObject.clear();

    // Dispose all contact shadows
    for (const contactShadow of this.contactShadows.values()) {
      contactShadow.dispose();
    }
    this.contactShadows.clear();

    // Clear environment map cache
    this.envMapCache.clear();

    // Remove all physics colliders
    if (this.physicsManager) {
      for (const id of this.physicsColliderObjects) {
        this.physicsManager.removeTrimeshCollider(id);
      }
      this.physicsColliderObjects.clear();
    }

    // Remove all objects
    for (const id of this.objects.keys()) {
      this.removeObject(id);
    }
    this.objects.clear();
    this.loadingPromises.clear();
  }
}

export default SceneManager;

import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

/**
 * GizmoManager - Debug tool for positioning assets in 3D space
 *
 * Features:
 * - Auto-creates gizmo for each object with gizmo: true
 * - Multiple simultaneous gizmos supported (multi-gizmo mode)
 * - Drag gizmo arrows/rings to move/rotate/scale any object
 * - Switch between translate/rotate/scale modes (affects all gizmos)
 * - Log position/rotation/scale on release
 * - Works with meshes, splats, video planes, and colliders
 * - Spawn gizmos dynamically with P key (when ?gizmo URL param present)
 *
 * Usage:
 * - Set gizmo: true in object data (videoData.js, sceneData.js, colliderData.js, etc.)
 * - Gizmo appears automatically for each enabled object
 * - Add ?gizmo to URL to enable P key spawning (blocks pointer lock & idle)
 * - Click object to focus it for logging
 * - P = spawn gizmo 5m in front of camera (only with ?gizmo param)
 * - G = translate, R = rotate, S = scale (all gizmos)
 * - W = world space, L = local space (all gizmos)
 * - H = toggle visibility (all gizmos)
 * - F = cycle through gizmos and teleport character 5m in front of each
 * - Drag any gizmo to manipulate, release to log position
 */
class GizmoManager {
  constructor(scene, camera, renderer, sceneManager = null) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.enabled = false;

    // Configurable objects - now supports multiple simultaneous gizmos
    this.objects = []; // Objects that can be selected
    this.controls = new Map(); // Map of object -> TransformControls
    this.controlHelpers = new Map(); // Map of object -> helper Object3D
    this.isGizmoDragging = false;
    this.isGizmoHovering = false;
    this.isVisible = true;
    this.hasGizmoInDefinitions = false; // from data definitions (even if not instantiated)
    this.hasGizmoURLParam = false; // if gizmo URL param is present
    this.currentMode = "translate"; // Current gizmo mode (applies to all)
    this.currentSpace = "world"; // Current space (applies to all)
    // Integration targets for standardized global effects
    this.idleHelper = null;
    this.inputManager = null;
    this.activeObject = null; // Most recently interacted object
    this.spawnedGizmoCounter = 0; // Counter for spawned gizmos
    this.currentGizmoIndex = 0; // For cycling through gizmos with F key

    // Raycaster for object picking
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Check for gizmo URL parameter
    this.checkGizmoURLParam();

    // Always enable (will only affect objects with gizmo: true)
    this.enable();

    // Register any already-loaded scene objects if sceneManager provided
    if (sceneManager) {
      this.registerSceneObjects(sceneManager);
    }
  }

  /**
   * Check if gizmo URL parameter is present
   */
  checkGizmoURLParam() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      this.hasGizmoURLParam = urlParams.has("gizmo");
      console.log("GizmoManager: Checking URL params");
      console.log("  - URL search string:", window.location.search);
      console.log("  - Has 'gizmo' param:", this.hasGizmoURLParam);
      if (this.hasGizmoURLParam) {
        console.log(
          "GizmoManager: ✓ gizmo URL parameter detected - P key spawning enabled"
        );
      } else {
        console.log(
          "GizmoManager: No gizmo URL parameter - P key spawning disabled"
        );
      }
    } catch (e) {
      console.warn("GizmoManager: Failed to check URL params:", e);
      this.hasGizmoURLParam = false;
    }
  }

  /**
   * Wire integrations so gizmo presence can standardize global effects
   * @param {Object} idleHelper
   * @param {Object} inputManager
   */
  setIntegration(idleHelper, inputManager) {
    this.idleHelper = idleHelper || null;
    this.inputManager = inputManager || null;
    this.updateGlobalBlocks();
  }

  /**
   * Apply or clear global blocks based on whether any gizmo objects are registered
   */
  updateGlobalBlocks() {
    const hasGizmoRuntime = this.objects && this.objects.length > 0;
    const hasGizmo =
      this.hasGizmoInDefinitions || hasGizmoRuntime || this.hasGizmoURLParam;
    if (
      this.idleHelper &&
      typeof this.idleHelper.setGlobalDisable === "function"
    ) {
      this.idleHelper.setGlobalDisable(hasGizmo);
    }
    if (
      this.inputManager &&
      typeof this.inputManager.setPointerLockBlocked === "function"
    ) {
      this.inputManager.setPointerLockBlocked(hasGizmo);
    }
  }

  /**
   * Evaluate gizmo flags directly from data definitions (scene/video/etc.)
   * and standardize global side-effects regardless of instantiation status
   * @param {Object} options
   * @param {Object|Array} options.sceneDefs - map or array of scene defs
   * @param {Object|Array} options.videoDefs - map or array of video defs
   * @param {Object|Array} options.colliderDefs - map or array of collider defs
   * @param {Object|Array} options.lightDefs - map or array of light defs
   */
  applyGlobalBlocksFromDefinitions({
    sceneDefs = null,
    videoDefs = null,
    colliderDefs = null,
    lightDefs = null,
  } = {}) {
    const collect = (defs) => {
      if (!defs) return [];
      if (Array.isArray(defs)) return defs;
      if (typeof defs === "object") return Object.values(defs);
      return [];
    };
    const all = [
      ...collect(sceneDefs),
      ...collect(videoDefs),
      ...collect(colliderDefs),
      ...collect(lightDefs),
    ];
    this.hasGizmoInDefinitions = all.some((d) => d && d.gizmo === true);
    // Inform gameManager (if available via window) so all managers share the same flag
    try {
      if (
        window?.gameManager &&
        typeof window.gameManager.setState === "function"
      ) {
        window.gameManager.setState({
          hasGizmoInData: this.hasGizmoInDefinitions,
        });
      }
    } catch {}
    this.updateGlobalBlocks();
  }

  /**
   * Register all gizmo-enabled scene objects from a SceneManager
   * @param {Object} sceneManager - Instance of SceneManager
   */
  registerSceneObjects(sceneManager) {
    if (!sceneManager || !sceneManager.objects || !sceneManager.objectData) {
      return;
    }
    try {
      sceneManager.objects.forEach((obj, id) => {
        const data = sceneManager.objectData.get(id);
        if (data && data.gizmo) {
          this.registerObject(obj, id, data.type || "scene");
        }
      });
    } catch (e) {
      console.warn("GizmoManager: registerSceneObjects failed:", e);
    }
  }

  /**
   * Register all gizmo-enabled lights from a LightManager
   * @param {Object} lightManager - Instance of LightManager
   * @param {Object} lightData - Light data definitions
   */
  registerLights(lightManager, lightData) {
    if (!lightManager || !lightData) {
      return;
    }
    try {
      // Iterate through light data definitions
      for (const [key, config] of Object.entries(lightData)) {
        if (config.gizmo) {
          // Get the light object from lightManager
          const lightObj = lightManager.getLight(config.id);
          if (lightObj) {
            this.registerObject(lightObj, config.id, "light");
          }
        }
      }
    } catch (e) {
      console.warn("GizmoManager: registerLights failed:", e);
    }
  }

  /**
   * Check whether any scene object is gizmo-enabled
   * @param {Object} sceneManager - Instance of SceneManager
   * @returns {boolean}
   */
  hasAnyGizmoObjects(sceneManager) {
    try {
      const values = Array.from(sceneManager?.objectData?.values() || []);
      return values.some((d) => d && d.gizmo === true);
    } catch {
      return false;
    }
  }

  /**
   * If any gizmo-enabled object exists, disable idle behaviors globally
   * @param {Object} idleHelper - Instance of IdleHelper
   * @param {Object} sceneManager - Instance of SceneManager
   */
  applyIdleBlockIfNeeded(idleHelper, sceneManager) {
    if (!idleHelper) return;
    if (this.hasAnyGizmoObjects(sceneManager)) {
      if (typeof idleHelper.setGlobalDisable === "function") {
        idleHelper.setGlobalDisable(true);
        console.log(
          "IdleHelper: Globally disabled due to gizmo-enabled object(s)"
        );
      }
    }
  }

  /**
   * If any gizmo-enabled object exists, block pointer lock for easier gizmo manipulation
   * @param {Object} inputManager - Instance of InputManager
   * @param {Object} sceneManager - Instance of SceneManager
   */
  applyPointerLockBlockIfNeeded(inputManager, sceneManager) {
    if (
      !inputManager ||
      typeof inputManager.setPointerLockBlocked !== "function"
    )
      return;
    const shouldBlock = this.hasAnyGizmoObjects(sceneManager);
    inputManager.setPointerLockBlocked(shouldBlock);
    if (shouldBlock) {
      console.log(
        "InputManager: Pointer lock blocked due to gizmo-enabled object(s)"
      );
    }
  }

  /**
   * Enable the gizmo system
   */
  enable() {
    if (this.enabled) return;
    this.enabled = true;

    // Setup event listeners (controls created per-object in registerObject)
    this.setupEventListeners();

    console.log("GizmoManager: Enabled (multi-gizmo mode)");
  }

  /**
   * Disable the gizmo system
   */
  disable() {
    if (!this.enabled) return;
    this.enabled = false;

    // Dispose all controls
    for (const control of this.controls.values()) {
      if (control) {
        control.dispose();
      }
    }
    this.controls.clear();

    // Remove all helpers
    for (const helper of this.controlHelpers.values()) {
      if (helper && helper.parent) {
        helper.parent.remove(helper);
      }
    }
    this.controlHelpers.clear();

    this.removeEventListeners();
  }

  /**
   * Register an object that can be selected and manipulated
   * Creates and shows a gizmo immediately (multi-gizmo mode)
   * @param {THREE.Object3D} object - The object to register
   * @param {string} id - Optional identifier for logging
   * @param {string} type - Optional type (mesh, splat, video)
   */
  registerObject(object, id = null, type = "object") {
    if (!object) {
      console.warn("GizmoManager: Attempted to register null object");
      return;
    }

    const item = {
      object,
      id: id || object.name || "unnamed",
      type,
    };

    this.objects.push(item);

    // Create a TransformControls for this object
    const control = new TransformControls(
      this.camera,
      this.renderer.domElement
    );
    control.setMode(this.currentMode);
    control.setSpace(this.currentSpace);
    control.attach(object);

    // Add the visual helper Object3D
    if (typeof control.getHelper === "function") {
      const helper = control.getHelper();
      if (helper) {
        this.scene.add(helper);
        helper.visible = this.isVisible;
        this.controlHelpers.set(object, helper);
      }
    }

    // Setup event listeners for this control
    control.addEventListener("dragging-changed", (event) => {
      if (event.value) {
        this.isGizmoDragging = true;
        this.activeObject = item;
        console.log(`GizmoManager: Dragging "${item.id}"`);
      } else {
        this.isGizmoDragging = false;
        console.log(`GizmoManager: Drag ended "${item.id}"`);
        this.logObjectTransform(item);
      }
    });

    control.addEventListener("hoveron", () => {
      this.isGizmoHovering = true;
    });

    control.addEventListener("hoveroff", () => {
      this.isGizmoHovering = false;
    });

    this.controls.set(object, control);

    console.log(
      `GizmoManager: Registered "${item.id}" (${type}) with gizmo`,
      object
    );
    console.log(`  Total registered objects: ${this.objects.length}`);

    // Standardize side-effects when any gizmo is present
    this.updateGlobalBlocks();
  }

  /**
   * Select an already-registered object by id (sets it as active for logging)
   * @param {string} id
   */
  selectObjectById(id) {
    if (!id) return;
    const item = this.objects.find((it) => it.id === id);
    if (item) {
      this.activeObject = item;
      console.log(`GizmoManager: Set active object to "${id}"`);
    }
  }

  /**
   * Unregister an object and remove its gizmo
   * @param {THREE.Object3D} object - The object to unregister
   */
  unregisterObject(object) {
    const index = this.objects.findIndex((item) => item.object === object);
    if (index !== -1) {
      this.objects.splice(index, 1);
    }

    // Dispose the control
    const control = this.controls.get(object);
    if (control) {
      control.dispose();
      this.controls.delete(object);
    }

    // Remove the helper
    const helper = this.controlHelpers.get(object);
    if (helper && helper.parent) {
      helper.parent.remove(helper);
    }
    this.controlHelpers.delete(object);

    // Update global effects when gizmo set changes
    this.updateGlobalBlocks();
  }

  /**
   * Setup event listeners for gizmo interaction
   */
  setupEventListeners() {
    // Mouse click for object selection/focusing
    this.onMouseDown = this.handleMouseDown.bind(this);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);

    // Mouse up for logging position
    this.onMouseUp = this.handleMouseUp.bind(this);
    this.renderer.domElement.addEventListener("mouseup", this.onMouseUp);

    // Keyboard shortcuts
    this.onKeyDown = this.handleKeyDown.bind(this);
    window.addEventListener("keydown", this.onKeyDown);

    // Note: drag/hover events are set per-control in registerObject()
  }

  /**
   * Returns true if pointer is interacting with the gizmo (hovering or dragging)
   */
  isPointerOverGizmo() {
    return this.isGizmoHovering || this.isGizmoDragging;
  }

  /**
   * Remove event listeners
   */
  removeEventListeners() {
    if (this.onMouseDown) {
      this.renderer.domElement.removeEventListener(
        "mousedown",
        this.onMouseDown
      );
    }
    if (this.onMouseUp) {
      this.renderer.domElement.removeEventListener("mouseup", this.onMouseUp);
    }
    if (this.onKeyDown) {
      window.addEventListener("keydown", this.onKeyDown);
    }
  }

  /**
   * Handle mouse down for object focusing (sets active for keyboard shortcuts)
   */
  handleMouseDown(event) {
    // Ignore if any gizmo is being dragged
    const anyDragging = Array.from(this.controls.values()).some(
      (ctrl) => ctrl.dragging
    );
    if (anyDragging) return;

    // Calculate mouse position in normalized device coordinates
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast to find intersected objects
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Get all selectable objects
    const selectableObjects = this.objects.map((item) => item.object);
    const intersects = this.raycaster.intersectObjects(selectableObjects, true);

    if (intersects.length > 0) {
      // Find the top-level registered object
      let focusedObj = null;
      for (const item of this.objects) {
        if (
          intersects[0].object === item.object ||
          intersects[0].object.parent === item.object ||
          item.object.children.includes(intersects[0].object)
        ) {
          focusedObj = item;
          break;
        }
      }

      if (focusedObj) {
        this.activeObject = focusedObj;
        console.log(
          `GizmoManager: Focused "${focusedObj.id}" (${focusedObj.type})`
        );
      }
    }
  }

  /**
   * Handle mouse up
   */
  handleMouseUp(event) {
    // Position logging is handled in per-control dragging-changed events
  }

  /**
   * Handle keyboard shortcuts (applies to all gizmos)
   */
  handleKeyDown(event) {
    if (!this.enabled) {
      console.log("GizmoManager: handleKeyDown called but not enabled");
      return;
    }

    // Ignore if typing in an input
    if (
      document.activeElement.tagName === "INPUT" ||
      document.activeElement.tagName === "TEXTAREA"
    ) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case "p":
        console.log(
          "GizmoManager: P key pressed, hasGizmoURLParam:",
          this.hasGizmoURLParam
        );
        // Spawn gizmo if URL param is present
        if (this.hasGizmoURLParam) {
          this.spawnGizmoInFrontOfCamera();
        } else {
          console.log(
            "GizmoManager: P key pressed but gizmo URL param not present"
          );
        }
        break;
      case "g":
        if (this.controls.size === 0) return;
        this.currentMode = "translate";
        for (const control of this.controls.values()) {
          control.setMode("translate");
        }
        console.log("GizmoManager: Mode = Translate (all gizmos)");
        break;
      case "r":
        if (this.controls.size === 0) return;
        this.currentMode = "rotate";
        for (const control of this.controls.values()) {
          control.setMode("rotate");
        }
        console.log("GizmoManager: Mode = Rotate (all gizmos)");
        break;
      case "s":
        if (this.controls.size === 0) return;
        this.currentMode = "scale";
        for (const control of this.controls.values()) {
          control.setMode("scale");
        }
        console.log("GizmoManager: Mode = Scale (all gizmos)");
        break;
      case "w":
        if (this.controls.size === 0) return;
        this.currentSpace = "world";
        for (const control of this.controls.values()) {
          control.setSpace("world");
        }
        console.log("GizmoManager: Space = World (all gizmos)");
        break;
      case "l":
        if (this.controls.size === 0) return;
        this.currentSpace = "local";
        for (const control of this.controls.values()) {
          control.setSpace("local");
        }
        console.log("GizmoManager: Space = Local (all gizmos)");
        break;
      case "h":
        if (this.controls.size === 0) return;
        this.setVisible(!this.isVisible);
        console.log(
          `GizmoManager: ${this.isVisible ? "Shown" : "Hidden"} (all gizmos)`
        );
        break;
      case "f":
        this.cycleAndTeleportToNextGizmo();
        break;
      case "escape":
        if (this.activeObject) {
          console.log(
            `GizmoManager: Cleared focus from "${this.activeObject.id}"`
          );
          this.activeObject = null;
        }
        break;
    }
  }

  /**
   * Spawn a gizmo 5 meters in front of the camera
   */
  spawnGizmoInFrontOfCamera() {
    if (!this.camera) {
      console.warn("GizmoManager: Cannot spawn gizmo - no camera reference");
      return;
    }

    // Create a small sphere mesh to attach the gizmo to
    const geometry = new THREE.SphereGeometry(0.1, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      wireframe: true,
    });
    const sphere = new THREE.Mesh(geometry, material);

    // Calculate position 5 meters in front of camera
    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);

    const spawnPosition = new THREE.Vector3();
    spawnPosition.copy(this.camera.position);
    spawnPosition.addScaledVector(cameraDirection, 5);

    sphere.position.copy(spawnPosition);
    this.scene.add(sphere);

    // Generate unique ID for this spawned gizmo
    this.spawnedGizmoCounter++;
    const gizmoId = `spawned-gizmo-${this.spawnedGizmoCounter}`;

    // Register the sphere with the gizmo manager
    this.registerObject(sphere, gizmoId, "spawned");

    console.log(`GizmoManager: Spawned gizmo "${gizmoId}" at`, spawnPosition);
  }

  /**
   * Cycle to next gizmo and teleport character to it
   */
  cycleAndTeleportToNextGizmo() {
    if (this.objects.length === 0) {
      console.log("GizmoManager: No gizmo objects available");
      return;
    }

    if (this.objects.length === 1) {
      // Only one gizmo, just teleport to it
      this.activeObject = this.objects[0];
      this.teleportCharacterToObject(this.objects[0]);
      return;
    }

    // Multiple gizmos - cycle through them
    this.currentGizmoIndex = (this.currentGizmoIndex + 1) % this.objects.length;
    const nextGizmo = this.objects[this.currentGizmoIndex];
    this.activeObject = nextGizmo;

    console.log(
      `GizmoManager: Cycling to gizmo ${this.currentGizmoIndex + 1}/${
        this.objects.length
      } ("${nextGizmo.id}")`
    );

    this.teleportCharacterToObject(nextGizmo);
  }

  /**
   * Teleport character to 5 meters in front of an object
   * @param {Object} item - Gizmo item with object reference
   */
  teleportCharacterToObject(item) {
    if (!item || !item.object) {
      console.warn("GizmoManager: Cannot teleport - no object specified");
      return;
    }

    // Get character controller and physics manager from window globals
    const characterController = window.characterController;
    const physicsManager = characterController?.physicsManager;

    if (!characterController) {
      console.warn(
        "GizmoManager: Cannot teleport - character controller not found"
      );
      return;
    }

    const obj = item.object;

    // Calculate the object's forward direction (-Z in local space)
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(obj.quaternion);
    forward.normalize();

    // Calculate position 5 meters in front of object
    const teleportPosition = new THREE.Vector3();
    teleportPosition.copy(obj.position);
    teleportPosition.addScaledVector(forward, 5);

    // Ensure Y position is at least 0.9 (character controller minimum height)
    teleportPosition.y = Math.max(0.9, teleportPosition.y);

    // Teleport character controller
    if (characterController.character) {
      const character = characterController.character;

      // Update character position (physics body)
      character.setTranslation(
        {
          x: teleportPosition.x,
          y: teleportPosition.y,
          z: teleportPosition.z,
        },
        true
      );

      console.log(
        `GizmoManager: Teleported character to 5m in front of "${item.id}"`
      );
      console.log(`  Object position:`, obj.position);
      console.log(`  Object forward:`, forward);
      console.log(`  Teleport position:`, teleportPosition);
    } else {
      console.warn(
        "GizmoManager: Cannot teleport - character physics body not found"
      );
    }
  }

  /**
   * Show/hide all gizmo visuals and interaction
   */
  setVisible(visible) {
    this.isVisible = !!visible;

    // Update all helpers
    for (const helper of this.controlHelpers.values()) {
      if (helper) {
        helper.visible = this.isVisible;
      }
    }

    // Update all controls
    for (const control of this.controls.values()) {
      if (control) {
        control.enabled = this.isVisible;
      }
    }
  }

  /**
   * Select an object (sets it as active for logging/interaction)
   * In multi-gizmo mode, all gizmos are always visible
   */
  selectObject(item) {
    this.activeObject = item;
    console.log(`GizmoManager: Selected "${item.id}" (${item.type})`);
    this.logObjectTransform(item);
  }

  /**
   * Deselect current object (clears active focus)
   */
  deselectObject() {
    if (this.activeObject) {
      console.log(`GizmoManager: Deselected "${this.activeObject.id}"`);
      this.activeObject = null;
    }
  }

  /**
   * Log an object's transform
   * @param {Object} item - Optional item to log (defaults to activeObject)
   */
  logObjectTransform(item = null) {
    const target = item || this.activeObject;
    if (!target) return;

    const obj = target.object;
    const pos = obj.position;
    const rot = obj.rotation;
    const scale = obj.scale;

    console.log(`\n=== ${target.id} (${target.type}) ===`);
    console.log(
      `position: { x: ${pos.x.toFixed(2)}, y: ${pos.y.toFixed(
        2
      )}, z: ${pos.z.toFixed(2)} },`
    );
    console.log(
      `rotation: { x: ${rot.x.toFixed(4)}, y: ${rot.y.toFixed(
        4
      )}, z: ${rot.z.toFixed(4)} },`
    );
    console.log(
      `scale: { x: ${scale.x.toFixed(2)}, y: ${scale.y.toFixed(
        2
      )}, z: ${scale.z.toFixed(2)} },`
    );
    console.log("");
  }

  /**
   * Update method (call in animation loop if needed)
   */
  update(dt) {
    // TransformControls handles its own updates
  }

  /**
   * Clean up
   */
  destroy() {
    this.disable();
    this.objects = [];
  }
}

export default GizmoManager;

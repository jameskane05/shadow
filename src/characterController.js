import * as THREE from "three";
import { Howl } from "howler";
import BreathingSystem from "./wip/breathingSystem.js";

class CharacterController {
  constructor(
    character,
    camera,
    renderer,
    inputManager,
    sfxManager = null,
    sparkRenderer = null,
    idleHelper = null,
    initialRotation = null
  ) {
    this.character = character;
    this.camera = camera;
    this.renderer = renderer;
    this.inputManager = inputManager;
    this.sfxManager = sfxManager;
    this.sparkRenderer = sparkRenderer;
    this.idleHelper = idleHelper;

    // Camera rotation (use provided initial rotation or default to -180 degrees)
    const defaultYaw = THREE.MathUtils.degToRad(-180);
    this.yaw = initialRotation
      ? THREE.MathUtils.degToRad(initialRotation.y)
      : defaultYaw;
    this.pitch = initialRotation
      ? THREE.MathUtils.degToRad(initialRotation.x || 0)
      : 0;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;

    // Body rotation - separate from camera, only updates during movement
    this.bodyYaw = this.yaw; // Body faces same direction as initial camera

    // Camera look-at system
    this.isLookingAt = false;
    this.lookAtTarget = null;
    this.lookAtDuration = 0;
    this.lookAtProgress = 0;
    this.lookAtStartQuat = new THREE.Quaternion();
    this.lookAtEndQuat = new THREE.Quaternion();
    this.lookAtOnComplete = null;
    this.lookAtDisabledInput = false;
    this.inputDisabled = false;
    this.cameraSyncDisabled = false; // When true, camera won't sync to physics body
    this.frozenCameraBasePosition = new THREE.Vector3(); // Base position when camera is frozen
    this.lookAtReturnToOriginalView = false;
    this.lookAtReturnDuration = 0;
    this.lookAtReturning = false;
    this.lookAtHolding = false;
    this.lookAtHoldTimer = 0;
    this.lookAtHoldDuration = 0;

    // Character move-to system
    this.isMovingTo = false;
    this.moveToStartPos = new THREE.Vector3();
    this.moveToTargetPos = new THREE.Vector3();
    this.moveToStartYaw = 0;
    this.moveToTargetYaw = 0;
    this.moveToStartPitch = 0;
    this.moveToTargetPitch = 0;
    this.moveToDuration = 0;
    this.moveToProgress = 0;
    this.moveToOnComplete = null;
    this.moveToInputControl = null;

    // Depth of Field system
    this.dofEnabled = true; // Can be controlled externally
    this.baseApertureSize = 0.01; // Base aperture from options menu
    this.baseFocalDistance = 6.0; // Base focal distance from options menu
    this.currentFocalDistance = this.baseFocalDistance;
    this.currentApertureSize = this.baseApertureSize;
    this.targetFocalDistance = this.baseFocalDistance;
    this.targetApertureSize = this.baseApertureSize;
    this.dofTransitioning = false;
    this.lookAtDofActive = false; // Track if we're in look-at DoF mode
    this.dofHoldTimer = 0; // Time to hold DoF after look-at completes
    this.dofHoldDuration = 2.0; // Hold DoF for 2 seconds
    this.dofTransitionStartProgress = 0.8; // Start DoF transition at 80% of look-at animation
    this.dofTransitionDuration = 2; // How long the DoF transition takes in seconds
    this.dofTransitionProgress = 0; // Current progress of DoF transition (0 to 1)
    this.returnTransitionDuration = null; // Override transition duration during return-to-original

    // FOV Zoom system (synced with DoF)
    this.baseFov = null; // Will be set from camera's initial FOV
    this.currentFov = null;
    this.targetFov = null;
    this.startFov = null; // Captured at start of each transition
    this.zoomTransitioning = false;
    this.zoomTransitionProgress = 0; // Separate progress for zoom
    this.zoomFactor = 1.5; // 15% zoom
    this.lookAtZoomActive = false;

    // Headbob state
    this.headbobTime = 0;
    this.headbobIntensity = 0;
    this.idleHeadbobTime = 0;
    this.headbobEnabled = true;

    // Idle glance system
    this.glanceEnabled = true; // Enable idle look-around behavior
    this.glanceState = null; // null, 'glancing', 'returning'
    this.glanceProgress = 0; // 0 to 1
    this.glanceDuration = 5.0; // Duration of one glance animation (set randomly per glance)
    this.glanceTimer = 0; // Time until next glance (0 = start immediately when idle)
    this.wasIdleAllowed = false; // Track previous idle state for edge detection
    this.glanceStartYaw = 0;
    this.glanceTargetYaw = 0;
    this.glanceStartPitch = 0;
    this.glanceTargetPitch = 0;
    this.glanceStartRoll = 0;
    this.glanceTargetRoll = 0;
    this.currentRoll = 0; // Current head tilt

    // Audio
    this.audioListener = new THREE.AudioListener();
    this.camera.add(this.audioListener);
    this.footstepSound = null;
    this.isPlayingFootsteps = false;

    // Breathing system
    this.breathingSystem = new BreathingSystem(this.audioListener.context, {
      idleBreathRate: 0.17, // Slower, deeper breathing - 10 breaths per minute
      activeBreathRate: 0.5, // 30 breaths per minute when moving
      volume: 0.8, // Louder breathing
    });

    // First-person body model
    // Master toggle: set to true to enable loading/animating first-person body, false to disable all body code
    this.enableFirstPersonBody = false;
    this.bodyModel = null; // The loaded GLTF scene
    this.bodyModelGroup = null; // Container for the body model (from scene manager)
    this.bodyAnimationMixer = null; // Animation mixer for the body
    this.walkAnimation = null; // The walk animation action
    this.idleAnimation = null; // The idle animation action
    this.currentBodyAnimation = null; // Track which animation is currently active
    this.sceneManager = null; // Will be set via setSceneManager()

    // Neck rotation limits (in radians)
    this.neckRotationLimit = Math.PI / 6; // 30 degrees max neck rotation (more sensitive)

    // Character container - holds the body, positioned/rotated with character
    // Camera remains separate but follows this container
    this.characterContainer = new THREE.Group();
    // Body will be positioned at (0, bodyOffsetY, 0) relative to container

    // Settings
    this.baseSpeed = 2.5;
    this.sprintMultiplier = 1.75; // Reduced from 2.0 (30% slower sprint)
    this.cameraHeight = 0.8; // Distance from capsule center (0.8 = top of capsule, 0.7 = eye height)
    this.cameraSmoothingFactor = 0.15;

    // Initialize FOV from camera
    this.baseFov = this.camera.fov;
    this.currentFov = this.baseFov;
    this.targetFov = this.baseFov;

    this.loadFootstepAudio();
  }

  /**
   * Set the scene manager reference (called after initialization)
   * @param {SceneManager} sceneManager - The scene manager instance
   */
  setSceneManager(sceneManager) {
    this.sceneManager = sceneManager;

    // Add character container to scene
    if (this.sceneManager.scene && this.characterContainer) {
      this.sceneManager.scene.add(this.characterContainer);
      console.log("CharacterController: Character container added to scene");
    }

    // Try to attach the body model if it's already loaded
    this.attachFirstPersonBody();
  }

  /**
   * Attach the first-person body model from scene manager to camera
   * Called automatically when scene manager is set, or can be called manually
   */
  attachFirstPersonBody() {
    if (!this.enableFirstPersonBody) {
      return; // Body system disabled
    }

    if (!this.sceneManager) {
      console.warn("CharacterController: Scene manager not set yet");
      return;
    }

    // Get the body model from scene manager
    const bodyObject = this.sceneManager.getObject("firstPersonBody");

    if (!bodyObject) {
      console.warn(
        "CharacterController: First-person body not loaded yet (will retry)"
      );
      // Try again in a moment (model might still be loading)
      setTimeout(() => this.attachFirstPersonBody(), 100);
      return;
    }

    console.log("CharacterController: Attaching first-person body to camera");
    console.log("  - Body object:", bodyObject);
    console.log("  - Body visible:", bodyObject.visible);
    console.log("  - Body world position:", bodyObject.position);

    // The bodyObject is the container group from scene manager
    this.bodyModelGroup = bodyObject;

    // Find the actual model inside the container
    this.bodyModel = null;
    bodyObject.traverse((child) => {
      // Find the root mesh group (first non-container object with children)
      if (!this.bodyModel && child !== bodyObject && child.type === "Group") {
        this.bodyModel = child;
      }
    });

    if (!this.bodyModel) {
      // Fallback: if no group found, the bodyObject itself might be the model
      this.bodyModel = bodyObject;
    }

    // Hide head meshes for first-person view
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;
    let headMeshFound = false;

    this.bodyModel.traverse((child) => {
      if (child.isMesh) {
        console.log(`  - Mesh: ${child.name}`);

        // Try to automatically hide the head mesh
        // Common naming patterns for head meshes
        const lowerName = child.name.toLowerCase();
        if (
          lowerName.includes("head") ||
          lowerName.includes("hair") ||
          lowerName.includes("face") ||
          lowerName.includes("skull")
        ) {
          child.visible = false;
          headMeshFound = true;
          console.log(`    (Hidden - head mesh)`);
        }

        // Calculate bounding box to understand model dimensions
        if (child.geometry) {
          child.geometry.computeBoundingBox();
          const box = child.geometry.boundingBox;
          if (box) {
            minX = Math.min(minX, box.min.x);
            maxX = Math.max(maxX, box.max.x);
            minY = Math.min(minY, box.min.y);
            maxY = Math.max(maxY, box.max.y);
            minZ = Math.min(minZ, box.min.z);
            maxZ = Math.max(maxZ, box.max.z);
          }
        }
      }
    });

    const width = maxX - minX;
    const height = maxY - minY;
    const depth = maxZ - minZ;

    console.log(`  - Body Model 3D Bounds:`);
    console.log(
      `    X: ${minX.toFixed(2)} to ${maxX.toFixed(2)} (width: ${width.toFixed(
        2
      )})`
    );
    console.log(
      `    Y: ${minY.toFixed(2)} to ${maxY.toFixed(
        2
      )} (height: ${height.toFixed(2)})`
    );
    console.log(
      `    Z: ${minZ.toFixed(2)} to ${maxZ.toFixed(2)} (depth: ${depth.toFixed(
        2
      )})`
    );
    if (headMeshFound) {
      console.log(`  - Head mesh(es) automatically hidden`);
    }

    // Parent body to character container
    // Body will be offset below the container origin
    this.bodyModelGroup.position.set(0, -0.85, 0.165); // Below character center
    this.bodyModelGroup.rotation.set(0, Math.PI, 0); // Rotate 180 degrees to face forward
    this.characterContainer.add(this.bodyModelGroup);

    console.log(
      "CharacterController: Body parented to character container at offset (0, -0.8, 0)"
    );

    // Setup animations
    this.setupBodyAnimations();
  }

  /**
   * Setup animations for the first-person body model
   * @private
   */
  setupBodyAnimations() {
    if (!this.enableFirstPersonBody) return; // Body system disabled

    if (!this.bodyModel || !this.bodyModelGroup) return;

    // Check if SceneManager already created a mixer for this object
    const existingMixer =
      this.sceneManager?.animationMixers.get("firstPersonBody");

    console.log("CharacterController: Setting up body animations");
    console.log(
      "  - Existing mixer from SceneManager:",
      existingMixer ? "YES" : "NO"
    );

    if (existingMixer) {
      // Use SceneManager's existing mixer - get the action for manual control
      this.bodyAnimationMixer = existingMixer;
      const actions = Array.from(
        this.sceneManager.animationActions.entries()
      ).filter(([id]) => id.startsWith("firstPersonBody"));

      console.log("  - Found actions from SceneManager:", actions.length);

      // Log all available actions for debugging
      console.log("  - Available actions:");
      actions.forEach(([id, action]) => {
        console.log(`    * "${id}"`);
      });

      // Find walk and idle animations
      for (const [id, action] of actions) {
        if (id.includes("walk")) {
          this.walkAnimation = action;
          console.log(`  - Using walk animation: "${id}"`);
        } else if (id.includes("idle")) {
          this.idleAnimation = action;
          console.log(`  - Using idle animation: "${id}"`);
        }
      }

      if (this.walkAnimation && this.idleAnimation) {
        // Setup walk animation
        this.walkAnimation.loop = THREE.LoopRepeat;
        this.walkAnimation.clampWhenFinished = false;
        this.walkAnimation.setEffectiveWeight(0); // Start with no weight
        this.walkAnimation.play();

        // Setup idle animation
        this.idleAnimation.loop = THREE.LoopRepeat;
        this.idleAnimation.clampWhenFinished = false;
        this.idleAnimation.setEffectiveWeight(1.0); // Start with full weight (idle by default)
        this.idleAnimation.play();

        this.currentBodyAnimation = this.idleAnimation;

        console.log(
          `CharacterController: Setup animation blending:`,
          "Walk:",
          this.walkAnimation.isRunning(),
          "Idle:",
          this.idleAnimation.isRunning()
        );
      } else {
        console.warn(
          "CharacterController: Could not find all animations (walk/idle). Found:",
          actions.map(([id]) => id)
        );
      }
    } else {
      // No sceneData animations - find them in the loaded GLTF
      console.log(
        "  - No SceneManager mixer, searching for animations in GLTF..."
      );
      let animations = null;
      this.bodyModel.traverse((node) => {
        if (node.animations?.length > 0) animations = node.animations;
      });

      if (!animations?.length) {
        console.warn("CharacterController: No animations found in body model");
        return;
      }

      console.log(`  - Found ${animations.length} animation(s) in GLTF`);

      // Create our own mixer for manual control
      this.bodyAnimationMixer = new THREE.AnimationMixer(this.bodyModel);
      const walkClip = animations[0];
      this.walkAnimation = this.bodyAnimationMixer.clipAction(walkClip);
      this.walkAnimation.loop = THREE.LoopRepeat;
      this.walkAnimation.play();
      this.walkAnimation.paused = false; // Start playing immediately for testing
      this.walkAnimation.timeScale = 1.0;

      console.log(
        "CharacterController: Created animation mixer for body:",
        walkClip.name
      );
    }
  }

  /**
   * Set the idle helper reference (called after initialization)
   * @param {IdleHelper} idleHelper - The idle helper instance
   */
  setIdleHelper(idleHelper) {
    this.idleHelper = idleHelper;
  }

  /**
   * Set game manager and register event listeners
   * @param {GameManager} gameManager - The game manager instance
   */
  setGameManager(gameManager) {
    this.gameManager = gameManager;

    // Listen for camera:lookat events
    this.gameManager.on("camera:lookat", (data) => {
      // Check if control is enabled
      if (!this.gameManager.isControlEnabled()) return;

      const targetPos = new THREE.Vector3(
        data.position.x,
        data.position.y,
        data.position.z
      );
      const onComplete = data.onComplete || null;
      const enableZoom =
        data.enableZoom !== undefined ? data.enableZoom : false;
      const zoomOptions = data.zoomOptions || {};
      const returnToOriginalView = data.returnToOriginalView || false;
      const returnDuration = data.returnDuration || data.duration;

      this.lookAt(
        targetPos,
        data.duration,
        onComplete,
        enableZoom,
        zoomOptions,
        true, // Always disable input during lookat
        returnToOriginalView,
        returnDuration
      );
    });

    // Listen for character:moveto events
    this.gameManager.on("character:moveto", (data) => {
      // Check if control is enabled
      if (!this.gameManager.isControlEnabled()) return;

      const targetPos = new THREE.Vector3(
        data.position.x,
        data.position.y,
        data.position.z
      );

      // Parse rotation if provided
      let targetRotation = null;
      if (data.rotation) {
        targetRotation = {
          yaw: data.rotation.yaw,
          pitch: data.rotation.pitch || 0,
        };
      }

      // Parse input control settings (what to disable: movement, rotation, or both)
      const inputControl = data.inputControl || {
        disableMovement: true,
        disableRotation: true,
      };

      const onComplete = data.onComplete || null;

      this.moveTo(
        targetPos,
        targetRotation,
        data.duration,
        onComplete,
        inputControl
      );
    });

    console.log("CharacterController: Event listeners registered");
  }

  /**
   * Enable breathing (call when character controller becomes active)
   */
  enableBreathing() {
    if (this.breathingSystem) {
      this.breathingSystem.start();
    }
  }

  /**
   * Disable breathing
   */
  disableBreathing() {
    if (this.breathingSystem) {
      this.breathingSystem.stop();
    }
  }

  loadFootstepAudio() {
    // Load footstep audio using Howler.js
    this.footstepSound = new Howl({
      src: ["./audio/sfx/gravel-steps.ogg"],
      loop: true,
      volume: 0.2,
      preload: true,
      onload: () => {
        console.log("Footstep audio loaded successfully");
      },
      onloaderror: (id, error) => {
        console.warn("Failed to load footstep audio:", error);
      },
    });

    // Register with SFX manager if available
    if (this.sfxManager) {
      this.sfxManager.registerSound("footsteps", this.footstepSound, 0.2);
    }

    // Register breathing system volume control with SFX manager
    if (this.sfxManager && this.breathingSystem) {
      // Create a proxy object that implements the setVolume interface
      const breathingVolumeControl = {
        setVolume: (volume) => {
          this.breathingSystem.setVolume(volume * 0.2); // Scale to appropriate range (louder)
        },
      };
      this.sfxManager.registerSound("breathing", breathingVolumeControl, 1.0);
    }
  }

  /**
   * Start camera look-at sequence
   * @param {THREE.Vector3} targetPosition - World position to look at
   * @param {number} duration - Time to complete the look-at in seconds
   * @param {Function} onComplete - Optional callback when complete
   * @param {boolean} enableZoom - Whether to enable zoom/DoF effects (default: false)
   * @param {Object} zoomOptions - Zoom/DoF configuration options
   * @param {boolean} disableInput - Whether to disable input during lookAt (default: true)
   * @param {boolean} returnToOriginalView - If true, return to original view before restoring control (default: false)
   * @param {number} returnDuration - Duration of the return animation in seconds (default: same as duration)
   */
  lookAt(
    targetPosition,
    duration = 1.0,
    onComplete = null,
    enableZoom = false,
    zoomOptions = {},
    disableInput = true,
    returnToOriginalView = false,
    returnDuration = null
  ) {
    this.isLookingAt = true;
    this.lookAtTarget = targetPosition.clone();
    this.lookAtDuration = duration;
    this.lookAtProgress = 0;
    this.lookAtOnComplete = onComplete;
    this.lookAtDisabledInput = disableInput; // Store whether we disabled input
    this.lookAtReturnToOriginalView = returnToOriginalView;
    this.lookAtReturnDuration = returnDuration || duration;
    this.lookAtReturning = false;
    this.lookAtHolding = false;
    this.lookAtHoldTimer = 0;

    // Parse zoom options with defaults
    const {
      zoomFactor = 1.5, // 1.5x zoom (FOV reduction)
      minAperture = 0.15, // Minimum aperture (less blur at distance)
      maxAperture = 0.35, // Maximum aperture (more blur close-up)
      transitionStart = 0.8, // When to start DoF transition (0-1)
      transitionDuration = 2.0, // How long the DoF transition takes
      holdDuration = 2.0, // How long to hold DoF after look-at completes (or before return if returnToOriginal)
    } = zoomOptions;

    // If returning to original view, use holdDuration to pause before returning
    if (returnToOriginalView && enableZoom) {
      this.lookAtHoldDuration = holdDuration;
    } else {
      this.lookAtHoldDuration = 0;
    }

    // Store zoom config for this look-at
    this.currentZoomConfig = {
      zoomFactor,
      minAperture,
      maxAperture,
      transitionStart,
      transitionDuration,
      holdDuration,
    };

    // Only disable input if requested (e.g., if not being managed by moveTo)
    if (disableInput) {
      this.inputDisabled = true;
      this.inputManager.disable();
    }

    // Store current camera orientation as quaternion
    this.lookAtStartQuat.setFromEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, "YXZ")
    );

    // Calculate target orientation
    const direction = new THREE.Vector3()
      .subVectors(targetPosition, this.camera.position)
      .normalize();

    // Calculate target yaw and pitch from direction
    const targetYaw = Math.atan2(-direction.x, -direction.z);
    const targetPitch = Math.asin(direction.y);

    // Create target quaternion from target euler angles
    this.lookAtEndQuat.setFromEuler(
      new THREE.Euler(targetPitch, targetYaw, 0, "YXZ")
    );

    // Ensure we take the shorter rotation path
    // If dot product is negative, negate the target quaternion
    if (this.lookAtStartQuat.dot(this.lookAtEndQuat) < 0) {
      this.lookAtEndQuat.x *= -1;
      this.lookAtEndQuat.y *= -1;
      this.lookAtEndQuat.z *= -1;
      this.lookAtEndQuat.w *= -1;
    }

    // Calculate DoF values based on distance to target (but don't start transition yet)
    if (enableZoom && this.sparkRenderer && this.dofEnabled) {
      const distance = this.camera.position.distanceTo(targetPosition);

      // Calculate target DoF settings
      const targetFocalDistance = distance;

      // Calculate aperture size for dramatic DoF effect using configured values
      // Larger aperture = more blur, smaller = less blur
      const { minAperture, maxAperture } = this.currentZoomConfig;

      // Scale aperture based on distance (closer = more DoF, further = less)
      // Clamp distance between 2 and 20 meters for sensible scaling
      const normalizedDistance = Math.max(2, Math.min(20, distance));
      const apertureScale = 1 - (normalizedDistance - 2) / 18; // 1.0 at 2m, 0.0 at 20m
      const targetApertureSize =
        minAperture + (maxAperture - minAperture) * apertureScale;

      // Store target values but don't start transition yet
      // Transition will start based on look-at progress
      this.targetFocalDistance = targetFocalDistance;
      this.targetApertureSize = targetApertureSize;
      this.lookAtDofActive = true;
      this.dofHoldTimer = 0; // Reset hold timer
      this.dofTransitionProgress = 0; // Reset progress

      console.log(
        `CharacterController: DoF ready - Distance: ${distance.toFixed(
          2
        )}m, Aperture: ${targetApertureSize.toFixed(
          3
        )} (min: ${minAperture.toFixed(3)}, max: ${maxAperture.toFixed(
          3
        )}) (will transition at ${(
          this.currentZoomConfig.transitionStart * 100
        ).toFixed(0)}% over ${this.currentZoomConfig.transitionDuration}s)`
      );
    }

    // Set up zoom transition (synced with DoF)
    if (enableZoom) {
      this.startFov = this.currentFov; // Capture current FOV as start
      this.targetFov = this.baseFov / this.currentZoomConfig.zoomFactor; // Zoom in by reducing FOV
      this.lookAtZoomActive = true;
      this.zoomTransitionProgress = 0; // Reset zoom progress

      console.log(
        `CharacterController: Looking at target over ${duration}s (zoom: ${this.baseFov.toFixed(
          1
        )}° → ${this.targetFov.toFixed(
          1
        )}° [${this.currentZoomConfig.zoomFactor.toFixed(2)}x])`
      );
    } else {
      console.log(
        `CharacterController: Looking at target over ${duration}s (no zoom)`
      );
    }
  }

  /**
   * Cancel the look-at and restore player control
   * @param {boolean} updateYawPitch - If true, update yaw/pitch to match current camera orientation
   */
  cancelLookAt(updateYawPitch = true) {
    if (!this.isLookingAt) return;

    this.isLookingAt = false;

    // Re-enable input manager only if we disabled it
    if (this.lookAtDisabledInput) {
      this.inputDisabled = false;
      this.inputManager.enable();
    }

    // Reset glance state
    this.glanceState = null;
    this.glanceTimer = 0;
    this.wasIdleAllowed = false;
    this.currentRoll = 0; // Reset head tilt

    if (updateYawPitch) {
      // Update yaw and pitch to match current camera orientation
      const euler = new THREE.Euler().setFromQuaternion(
        this.camera.quaternion,
        "YXZ"
      );
      this.yaw = euler.y;
      this.pitch = euler.x;
      this.targetYaw = this.yaw;
      this.targetPitch = this.pitch;
    }

    // Return DoF to base if it was active
    if (this.sparkRenderer && this.lookAtDofActive) {
      this.targetFocalDistance = this.baseFocalDistance;
      this.targetApertureSize = this.baseApertureSize;
      this.lookAtDofActive = false;
      this.dofTransitioning = true;
      this.dofTransitionProgress = 0; // Reset for return transition
      console.log(`CharacterController: Returning DoF to base (cancelled)`);
    }

    // Return zoom to base if it was active
    if (this.lookAtZoomActive) {
      this.startFov = this.currentFov; // Capture current FOV as start
      this.targetFov = this.baseFov;
      this.lookAtZoomActive = false;
      this.zoomTransitioning = true;
      this.zoomTransitionProgress = 0; // Reset for return transition
      console.log(`CharacterController: Returning zoom to base (cancelled)`);
    }

    console.log("CharacterController: Look-at cancelled, control restored");
  }

  /**
   * Start character move-to sequence
   * Smoothly moves character to target position and rotation
   * @param {THREE.Vector3} targetPosition - World position to move to
   * @param {Object} targetRotation - Target rotation {yaw: radians, pitch: radians} (optional)
   * @param {number} duration - Time to complete the move in seconds
   * @param {Function} onComplete - Optional callback when complete
   * @param {Object} inputControl - Control what input to disable {disableMovement: true/false, disableRotation: true/false}
   */
  moveTo(
    targetPosition,
    targetRotation = null,
    duration = 2.0,
    onComplete = null,
    inputControl = { disableMovement: true, disableRotation: true }
  ) {
    this.isMovingTo = true;
    this.moveToDuration = duration;
    this.moveToProgress = 0;
    this.moveToOnComplete = onComplete;
    this.moveToInputControl = inputControl; // Store for restoration later

    // Disable input based on inputControl settings
    // Only set inputDisabled if BOTH movement and rotation are disabled
    if (inputControl.disableMovement && inputControl.disableRotation) {
      // Disable everything
      this.inputDisabled = true;
      this.inputManager.disable();
    } else if (inputControl.disableMovement) {
      // Disable only movement, keep rotation
      // Don't set inputDisabled - let inputManager handle selective blocking
      this.inputManager.disableMovement();
    } else if (inputControl.disableRotation) {
      // Disable only rotation, keep movement
      // Don't set inputDisabled - let inputManager handle selective blocking
      this.inputManager.disableRotation();
    }
    // If neither is disabled, don't change anything

    // Store current position (get from physics body)
    const currentPos = this.character.translation();
    this.moveToStartPos.set(currentPos.x, currentPos.y, currentPos.z);
    this.moveToTargetPos.copy(targetPosition);

    // Store current rotation
    this.moveToStartYaw = this.yaw;
    this.moveToStartPitch = this.pitch;

    // Set target rotation (if provided, otherwise keep current)
    if (targetRotation) {
      this.moveToTargetYaw =
        targetRotation.yaw !== undefined ? targetRotation.yaw : this.yaw;
      this.moveToTargetPitch =
        targetRotation.pitch !== undefined ? targetRotation.pitch : this.pitch;
    } else {
      this.moveToTargetYaw = this.yaw;
      this.moveToTargetPitch = this.pitch;
    }

    console.log(
      `CharacterController: Moving to position (${targetPosition.x.toFixed(
        2
      )}, ${targetPosition.y.toFixed(2)}, ${targetPosition.z.toFixed(
        2
      )}) over ${duration}s`
    );
  }

  /**
   * Cancel the move-to and restore player control
   */
  cancelMoveTo() {
    if (!this.isMovingTo) return;

    this.isMovingTo = false;

    // Restore input based on what was disabled
    if (this.moveToInputControl) {
      if (
        this.moveToInputControl.disableMovement &&
        this.moveToInputControl.disableRotation
      ) {
        // Both were disabled, enable everything
        this.inputDisabled = false;
        this.inputManager.enable();
      }
      // NOTE: Selective disables (only movement or only rotation) are NOT restored
      // They must be manually restored by calling enableMovement() or enableRotation()
      this.moveToInputControl = null;
    } else {
      // Fallback: enable everything if inputControl wasn't stored
      this.inputDisabled = false;
      this.inputManager.enable();
    }

    console.log("CharacterController: Move-to cancelled, control restored");
  }

  getForwardRightVectors() {
    const forward = new THREE.Vector3(0, 0, -1)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)
      .setY(0)
      .normalize();
    const right = new THREE.Vector3().crossVectors(
      forward,
      new THREE.Vector3(0, 1, 0)
    );
    return { forward, right };
  }

  /**
   * Disable all character input (movement + rotation)
   * Convenience method for other systems (dialogs, cutscenes, etc.)
   */
  disableInput() {
    this.inputDisabled = true;
    this.inputManager.disable();
  }

  /**
   * Enable all character input (movement + rotation)
   * Convenience method for other systems
   */
  enableInput() {
    this.inputDisabled = false;
    this.cameraSyncDisabled = false; // Re-enable camera sync when input is enabled
    this.inputManager.enable();
  }

  /**
   * Disable camera syncing to physics body (leaves camera frozen in place)
   * Use this for animations that should leave the camera where it lands
   */
  disableCameraSync() {
    this.cameraSyncDisabled = true;
    // Store current camera position as base for idle breathing
    this.frozenCameraBasePosition.copy(this.camera.position);
  }

  /**
   * Re-enable camera syncing to physics body
   */
  enableCameraSync() {
    this.cameraSyncDisabled = false;
  }

  /**
   * Disable only movement input (rotation still works)
   */
  disableMovement() {
    this.inputManager.disableMovement();
  }

  /**
   * Enable movement input
   */
  enableMovement() {
    this.inputManager.enableMovement();
  }

  /**
   * Disable only rotation input (movement still works)
   */
  disableRotation() {
    this.inputManager.disableRotation();
  }

  /**
   * Enable rotation input
   */
  enableRotation() {
    this.inputManager.enableRotation();
  }

  /**
   * Disable character controller physics collisions
   * Useful when you want the character to not be pushed by physics objects
   */
  disablePhysicsCollisions() {
    if (!this.character) return;

    // Get all colliders attached to the character controller
    const numColliders = this.character.numColliders();
    for (let i = 0; i < numColliders; i++) {
      const collider = this.character.collider(i);
      if (collider) {
        // Set collision groups to only collide with environment (group 3)
        // This prevents phone cord (group 2) from pushing the character
        collider.setCollisionGroups(0x00040001); // Group 1, only collides with group 3 (environment)
      }
    }
    console.log(
      "CharacterController: Physics collisions limited to environment only"
    );
  }

  /**
   * Enable character controller physics collisions (restore default)
   * Restores normal collision behavior with all physics objects
   */
  enablePhysicsCollisions() {
    if (!this.character) return;

    // Get all colliders attached to the character controller
    const numColliders = this.character.numColliders();
    for (let i = 0; i < numColliders; i++) {
      const collider = this.character.collider(i);
      if (collider) {
        // Restore default collision groups (collides with everything)
        collider.setCollisionGroups(0xffffffff); // Collide with all groups
      }
    }
    console.log("CharacterController: Physics collisions restored to default");
  }

  /**
   * Debug helper: Adjust first-person body position
   * Can be called from browser console:
   * window.characterController.adjustBodyPosition(0, -1.4, -0.3)
   * window.characterController.adjustBodyRotation(0, Math.PI, 0)
   * window.characterController.adjustBodyScale(1.0)
   */
  adjustBodyPosition(x, y, z) {
    if (this.bodyModelGroup) {
      this.bodyModelGroup.position.set(x, y, z);
      console.log(
        `Body position (relative to character container) set to: ${x}, ${y}, ${z}`
      );
    } else {
      console.warn("Body model not loaded yet");
    }
  }

  adjustBodyRotation(x, y, z) {
    if (this.bodyModelGroup) {
      this.bodyModelGroup.rotation.set(x, y, z);
      console.log(`Body rotation set to: ${x}, ${y}, ${z}`);
    } else {
      console.warn("Body model not loaded yet");
    }
  }

  adjustBodyScale(scale) {
    if (this.bodyModelGroup) {
      this.bodyModelGroup.scale.setScalar(scale);
      console.log(`Body scale set to: ${scale}`);
    } else {
      console.warn("Body model not loaded yet");
    }
  }

  /**
   * Toggle body model visibility (for debugging)
   * window.characterController.toggleBodyVisibility()
   */
  toggleBodyVisibility() {
    if (this.bodyModelGroup) {
      this.bodyModelGroup.visible = !this.bodyModelGroup.visible;
      console.log(
        `Body model visibility: ${this.bodyModelGroup.visible ? "ON" : "OFF"}`
      );
    } else {
      console.warn("Body model not loaded yet");
    }
  }

  /**
   * Check animation state (for debugging)
   * window.characterController.checkAnimationState()
   */
  checkAnimationState() {
    console.log("=== Body Animation State ===");
    console.log("Body model group:", this.bodyModelGroup ? "YES" : "NO");
    console.log("Body model:", this.bodyModel ? "YES" : "NO");
    console.log("Animation mixer:", this.bodyAnimationMixer ? "YES" : "NO");
    console.log("Walk animation:", this.walkAnimation ? "YES" : "NO");

    if (this.walkAnimation) {
      console.log("  - Is running:", this.walkAnimation.isRunning());
      console.log("  - Is paused:", this.walkAnimation.paused);
      console.log("  - Time scale:", this.walkAnimation.timeScale);
      console.log("  - Time:", this.walkAnimation.time);
    }

    if (this.sceneManager) {
      const mixer = this.sceneManager.animationMixers.get("firstPersonBody");
      console.log(
        "SceneManager has mixer for firstPersonBody:",
        mixer ? "YES" : "NO"
      );

      const actions = Array.from(
        this.sceneManager.animationActions.entries()
      ).filter(([id]) => id.startsWith("firstPersonBody"));
      console.log("SceneManager actions:", actions.length);
      actions.forEach(([id, action]) => {
        console.log(
          `  - ${id}: running=${action.isRunning()}, paused=${action.paused}`
        );
      });
    }
  }

  /**
   * Enable wireframe mode on body model (for debugging)
   * window.characterController.setBodyWireframe(true)
   */
  setBodyWireframe(enabled) {
    if (this.bodyModel) {
      this.bodyModel.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.wireframe = enabled;
        }
      });
      console.log(`Body wireframe: ${enabled ? "ON" : "OFF"}`);
    } else {
      console.warn("Body model not loaded yet");
    }
  }

  /**
   * Log body model 3D bounds (for debugging)
   * window.characterController.logBodyBounds()
   */
  logBodyBounds() {
    if (!this.bodyModel) {
      console.warn("Body model not loaded yet");
      return;
    }

    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;
    let meshCount = 0;

    this.bodyModel.traverse((child) => {
      if (child.isMesh && child.geometry) {
        meshCount++;
        child.geometry.computeBoundingBox();
        const box = child.geometry.boundingBox;
        if (box) {
          minX = Math.min(minX, box.min.x);
          maxX = Math.max(maxX, box.max.x);
          minY = Math.min(minY, box.min.y);
          maxY = Math.max(maxY, box.max.y);
          minZ = Math.min(minZ, box.min.z);
          maxZ = Math.max(maxZ, box.max.z);
        }
      }
    });

    const width = maxX - minX;
    const height = maxY - minY;
    const depth = maxZ - minZ;

    console.log("=== Body Model 3D Bounds ===");
    console.log(`Meshes analyzed: ${meshCount}`);
    console.log(
      `X: ${minX.toFixed(2)} to ${maxX.toFixed(2)} (width: ${width.toFixed(2)})`
    );
    console.log(
      `Y: ${minY.toFixed(2)} to ${maxY.toFixed(2)} (height: ${height.toFixed(
        2
      )})`
    );
    console.log(
      `Z: ${minZ.toFixed(2)} to ${maxZ.toFixed(2)} (depth: ${depth.toFixed(2)})`
    );
    console.log(
      `\nBody offset in character container: (${this.bodyModelGroup.position.x.toFixed(
        2
      )}, ${this.bodyModelGroup.position.y.toFixed(
        2
      )}, ${this.bodyModelGroup.position.z.toFixed(2)})`
    );

    // Calculate where the bottom and top of the body are relative to the character
    const bottomY = minY + this.bodyModelGroup.position.y;
    const topY = maxY + this.bodyModelGroup.position.y;
    console.log(`\nRelative to character container:`);
    console.log(`  Bottom: y = ${bottomY.toFixed(2)}`);
    console.log(`  Top: y = ${topY.toFixed(2)}`);
    console.log(`  Height: ${height.toFixed(2)}`);
  }

  /**
   * Debug helper: Log current player position and rotation
   * Can be called from browser console: window.characterController.logPosition()
   */
  logPosition() {
    const physicsPos = this.character.translation();
    const yawDeg = THREE.MathUtils.radToDeg(this.yaw);
    const pitchDeg = THREE.MathUtils.radToDeg(this.pitch);
    const bodyYawDeg = THREE.MathUtils.radToDeg(this.bodyYaw);

    console.log("=== Physics Body (Capsule Collider Center) ===");
    console.log(
      `Position: { x: ${physicsPos.x.toFixed(2)}, y: ${physicsPos.y.toFixed(
        2
      )}, z: ${physicsPos.z.toFixed(2)} }`
    );
    console.log(
      `Rotation: { yaw: ${yawDeg.toFixed(2)}°, pitch: ${pitchDeg.toFixed(2)}° }`
    );

    // Character container (holds the body, rotates separately from camera)
    if (this.characterContainer) {
      console.log("\n=== Character Container ===");
      const cp = this.characterContainer.position;
      const cr = this.characterContainer.rotation;
      console.log(
        `Position: { x: ${cp.x.toFixed(2)}, y: ${cp.y.toFixed(
          2
        )}, z: ${cp.z.toFixed(2)} }`
      );
      console.log(
        `Body Yaw: ${bodyYawDeg.toFixed(2)}° (rotation.y: ${cr.y.toFixed(
          2
        )} rad)`
      );
    }

    // Camera position
    console.log("\n=== Camera ===");
    const camPos = this.camera.position;
    console.log(
      `Position: { x: ${camPos.x.toFixed(2)}, y: ${camPos.y.toFixed(
        2
      )}, z: ${camPos.z.toFixed(2)} }`
    );
    console.log(
      `Rotation: { yaw: ${yawDeg.toFixed(2)}°, pitch: ${pitchDeg.toFixed(2)}° }`
    );
    console.log(
      `Height offset from physics center: ${this.cameraHeight.toFixed(2)}`
    );

    // Also log body model position if loaded
    if (this.bodyModelGroup) {
      console.log(
        "\n=== First-Person Body Model (local offset in container) ==="
      );
      const bp = this.bodyModelGroup.position;
      const br = this.bodyModelGroup.rotation;
      console.log(
        `Local Position: { x: ${bp.x.toFixed(2)}, y: ${bp.y.toFixed(
          2
        )}, z: ${bp.z.toFixed(2)} }`
      );
      console.log(
        `Local Rotation: { x: ${br.x.toFixed(2)}, y: ${br.y.toFixed(
          2
        )}, z: ${br.z.toFixed(2)} }`
      );
    }

    return {
      position: { x: physicsPos.x, y: physicsPos.y, z: physicsPos.z },
      rotation: { yaw: this.yaw, pitch: this.pitch },
    };
  }

  /**
   * Check if a given position is visible in the camera frustum
   * @param {THREE.Vector3} position - World position to check
   * @returns {boolean} True if position is visible in camera frustum
   */
  isPositionInFrustum(position) {
    // Create frustum from camera's projection and view matrices
    const frustum = new THREE.Frustum();
    const projectionMatrix = this.camera.projectionMatrix;
    const viewMatrix = this.camera.matrixWorldInverse;

    // Combine matrices to get the frustum
    const matrix = new THREE.Matrix4();
    matrix.multiplyMatrices(projectionMatrix, viewMatrix);
    frustum.setFromProjectionMatrix(matrix);

    // Check if position is in frustum
    return frustum.containsPoint(position);
  }

  /**
   * Set DoF enabled state (called by options menu)
   * @param {boolean} enabled - Whether DoF is enabled
   */
  setDofEnabled(enabled) {
    this.dofEnabled = enabled;
    console.log(`CharacterController: DoF ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Update depth of field parameters
   * @param {number} dt - Delta time
   */
  updateDepthOfField(dt) {
    if (!this.sparkRenderer || !this.dofEnabled) return;

    // Handle DoF hold timer
    if (this.dofHoldTimer > 0) {
      this.dofHoldTimer -= dt;
      if (this.dofHoldTimer <= 0) {
        // Hold period over, start transitioning back to base
        this.dofHoldTimer = 0;
        this.targetFocalDistance = this.baseFocalDistance;
        this.targetApertureSize = this.baseApertureSize;
        this.lookAtDofActive = false;
        this.dofTransitioning = true;
        this.dofTransitionProgress = 0; // Reset for return transition

        // Also return zoom to base
        this.startFov = this.currentFov; // Capture current FOV as start
        this.targetFov = this.baseFov;
        this.lookAtZoomActive = false;
        this.zoomTransitioning = true;
        this.zoomTransitionProgress = 0; // Reset for return transition

        console.log(
          `CharacterController: Hold complete, returning DoF and zoom to base - Aperture: ${this.baseApertureSize.toFixed(
            3
          )}`
        );
      }
    }

    if (!this.dofTransitioning) return;

    // Update transition progress based on configured duration
    // Use returnTransitionDuration during return-to-original if set
    const transitionDuration =
      this.returnTransitionDuration ||
      this.currentZoomConfig?.transitionDuration ||
      this.dofTransitionDuration;
    this.dofTransitionProgress += dt / transitionDuration;
    const t = Math.min(1.0, this.dofTransitionProgress);

    // Use ease-out for smooth transition
    const eased = 1 - Math.pow(1 - t, 3);

    // Calculate start values (where we're transitioning from)
    const startFocalDistance = this.lookAtDofActive
      ? this.baseFocalDistance
      : this.currentFocalDistance;
    const startApertureSize = this.lookAtDofActive
      ? this.baseApertureSize
      : this.currentApertureSize;

    // Interpolate values
    this.currentFocalDistance =
      startFocalDistance +
      (this.targetFocalDistance - startFocalDistance) * eased;
    this.currentApertureSize =
      startApertureSize + (this.targetApertureSize - startApertureSize) * eased;

    // Update spark renderer
    const apertureAngle =
      2 *
      Math.atan((0.5 * this.currentApertureSize) / this.currentFocalDistance);
    this.sparkRenderer.apertureAngle = apertureAngle;
    this.sparkRenderer.focalDistance = this.currentFocalDistance;

    // Check if transition is complete
    if (t >= 1.0) {
      this.currentFocalDistance = this.targetFocalDistance;
      this.currentApertureSize = this.targetApertureSize;
      this.dofTransitioning = false;
      this.dofTransitionProgress = 0;
    }
  }

  /**
   * Update FOV zoom (synced with DoF transitions)
   * @param {number} dt - Delta time
   */
  updateZoom(dt) {
    if (!this.zoomTransitioning) return;

    // Update zoom transition progress (using configured duration, same as DoF)
    // Use returnTransitionDuration during return-to-original if set
    const transitionDuration =
      this.returnTransitionDuration ||
      this.currentZoomConfig?.transitionDuration ||
      this.dofTransitionDuration;
    this.zoomTransitionProgress += dt / transitionDuration;
    const t = Math.min(1.0, this.zoomTransitionProgress);

    // Use ease-out for smooth transition (matching DoF)
    const eased = 1 - Math.pow(1 - t, 3);

    // Interpolate FOV from captured start to target
    this.currentFov = this.startFov + (this.targetFov - this.startFov) * eased;

    // Update camera FOV
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();

    // Check if transition is complete
    if (t >= 1.0) {
      this.currentFov = this.targetFov;
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
      this.zoomTransitioning = false;
      this.zoomTransitionProgress = 0;
    }
  }

  calculateIdleHeadbob() {
    // Gentle breathing/idle animation - half strength of walking
    const idleFrequency = 0.8; // Slow breathing rate
    const idleVerticalAmp = 0.002; // Half of walk vertical (0.04)
    const idleHorizontalAmp = 0.001; // Half of walk horizontal (0.03)

    const verticalBob =
      Math.sin(this.idleHeadbobTime * idleFrequency * Math.PI * 2) *
      idleVerticalAmp;
    const horizontalBob =
      Math.sin(this.idleHeadbobTime * idleFrequency * Math.PI) *
      idleHorizontalAmp;

    return {
      vertical: verticalBob,
      horizontal: horizontalBob,
    };
  }

  /**
   * Start a glance animation (look left/right and slightly up/down with head tilt)
   */
  startGlance() {
    this.glanceState = "glancing";
    this.glanceProgress = 0;
    this.glanceStartYaw = this.yaw;
    this.glanceStartPitch = this.pitch;
    this.glanceStartRoll = this.currentRoll;

    // Random duration for this glance (3-7 seconds)
    this.glanceDuration = 3.0 + Math.random() * 4.0;

    // Random horizontal direction and angle
    const horizontalDir = Math.random() > 0.5 ? 1 : -1;
    const glanceAngle = (Math.random() * 0.3 + 0.2) * horizontalDir; // 0.2 to 0.5 radians (~11 to 29 degrees)
    this.glanceTargetYaw = this.yaw + glanceAngle;

    // Random vertical angle (slight up or down)
    const verticalAngle = Math.random() * 0.15 - 0.075; // -0.075 to 0.075 radians (~-4 to 4 degrees)
    this.glanceTargetPitch = this.pitch + verticalAngle;

    // Subtle head tilt (roll) that follows the horizontal direction
    // Tilt slightly in the direction of the glance for natural head movement
    const rollAngle = (Math.random() * 0.3 + 0.04) * horizontalDir; // 0.04 to 0.12 radians (~2 to 7 degrees)
    this.glanceTargetRoll = rollAngle;

    // Clamp pitch to valid range
    this.glanceTargetPitch = Math.max(
      -Math.PI / 2 + 0.01,
      Math.min(Math.PI / 2 - 0.01, this.glanceTargetPitch)
    );
  }

  /**
   * Update idle glance system
   * @param {number} dt - Delta time
   * @param {boolean} isMoving - Whether the player is moving
   */
  updateIdleGlance(dt, isMoving) {
    // Skip if glance system is disabled or no idle helper
    if (!this.glanceEnabled || !this.idleHelper) return;

    // Use IdleHelper to check if idle behaviors should be allowed
    const shouldAllowIdle = this.idleHelper.shouldAllowIdleBehavior();

    // Detect when idle state becomes allowed (edge trigger)
    if (shouldAllowIdle && !this.wasIdleAllowed) {
      // Just became idle - start glance immediately
      this.glanceTimer = 0;
    }

    // Update previous idle state
    this.wasIdleAllowed = shouldAllowIdle;

    // Reset and stop glance if not allowed or if moving
    if (!shouldAllowIdle || isMoving || this.inputDisabled) {
      this.glanceState = null;
      this.glanceTimer = 0; // Reset timer for next idle period
      this.currentRoll = 0; // Reset head tilt
      return;
    }

    // Update glance animation if glancing
    if (this.glanceState === "glancing") {
      this.glanceProgress += dt / this.glanceDuration;

      if (this.glanceProgress >= 1.0) {
        // Glance complete - start return to start
        this.glanceProgress = 0;
        this.glanceState = "returning";
      } else {
        // Animate glance with ease-in-out
        const t = this.glanceProgress;
        const easedT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        // Interpolate yaw, pitch, and roll
        this.targetYaw =
          this.glanceStartYaw +
          (this.glanceTargetYaw - this.glanceStartYaw) * easedT;
        this.targetPitch =
          this.glanceStartPitch +
          (this.glanceTargetPitch - this.glanceStartPitch) * easedT;
        this.currentRoll =
          this.glanceStartRoll +
          (this.glanceTargetRoll - this.glanceStartRoll) * easedT;
      }
    } else if (this.glanceState === "returning") {
      // Return to start position at the same speed
      this.glanceProgress += dt / this.glanceDuration;

      if (this.glanceProgress >= 1.0) {
        // Return complete - reset state
        this.glanceProgress = 1.0;
        this.glanceState = null;
        this.glanceTimer = 5.0 + Math.random() * 3.0; // Next glance in 5-8 seconds

        // Ensure we're back at start
        this.targetYaw = this.glanceStartYaw;
        this.targetPitch = this.glanceStartPitch;
        this.currentRoll = 0; // Return to no tilt
      } else {
        // Animate return with ease-in-out
        const t = this.glanceProgress;
        const easedT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        // Interpolate back to start
        this.targetYaw =
          this.glanceTargetYaw +
          (this.glanceStartYaw - this.glanceTargetYaw) * easedT;
        this.targetPitch =
          this.glanceTargetPitch +
          (this.glanceStartPitch - this.glanceTargetPitch) * easedT;
        this.currentRoll =
          this.glanceTargetRoll + (0 - this.glanceTargetRoll) * easedT; // Return to 0 tilt
      }
    } else {
      // Count down to next glance (only when idle is allowed)
      this.glanceTimer -= dt;

      if (this.glanceTimer <= 0) {
        this.startGlance();
      }
    }
  }

  calculateHeadbob(isSprinting) {
    // Different parameters for walking vs sprinting
    const walkFrequency = 2.2; // Steps per second
    const sprintFrequency = 2.6; // Reduced from 3.5 for less rapid bobbing
    const walkVerticalAmp = 0.01; // Vertical bobbing amplitude (reduced from 0.04)
    const sprintVerticalAmp = 0.02; // Reduced from 0.08
    const walkHorizontalAmp = 0.0075; // Horizontal swaying amplitude (reduced from 0.03)
    const sprintHorizontalAmp = 0.03; // Reduced from 0.06

    const frequency = isSprinting ? sprintFrequency : walkFrequency;
    const verticalAmp = isSprinting ? sprintVerticalAmp : walkVerticalAmp;
    const horizontalAmp = isSprinting ? sprintHorizontalAmp : walkHorizontalAmp;

    // Vertical bob: double frequency for realistic step pattern
    const verticalBob =
      Math.sin(this.headbobTime * frequency * Math.PI * 2) * verticalAmp;

    // Horizontal sway: half frequency for subtle side-to-side motion
    const horizontalBob =
      Math.sin(this.headbobTime * frequency * Math.PI) * horizontalAmp;

    // Apply intensity smoothing
    return {
      vertical: verticalBob * this.headbobIntensity,
      horizontal: horizontalBob * this.headbobIntensity,
    };
  }

  update(dt) {
    // Update depth of field (always active during transitions)
    this.updateDepthOfField(dt);

    // Update zoom (synced with DoF, always active during transitions)
    this.updateZoom(dt);

    // Handle camera look-at sequence
    if (this.isLookingAt) {
      // Handle holding phase (pause before returning to original)
      if (this.lookAtHolding) {
        this.lookAtHoldTimer += dt;

        if (this.lookAtHoldTimer >= this.lookAtHoldDuration) {
          // Hold complete, start return phase
          this.lookAtHolding = false;
          this.lookAtReturning = true;
          this.lookAtProgress = 0;
          console.log(
            `CharacterController: Hold complete, starting return to original view (${this.lookAtReturnDuration}s)`
          );

          // Start DoF/zoom reset immediately (so they return to normal as camera returns)
          if (this.sparkRenderer && this.lookAtDofActive) {
            // Manually trigger the reset transition
            this.dofHoldTimer = 0;
            this.targetFocalDistance = this.baseFocalDistance;
            this.targetApertureSize = this.baseApertureSize;
            this.lookAtDofActive = false;
            this.dofTransitioning = true;
            this.dofTransitionProgress = 0; // Reset for return transition

            // Also reset zoom
            this.startFov = this.currentFov; // Capture current FOV for smooth transition
            this.targetFov = this.baseFov;
            this.zoomTransitioning = true;
            this.zoomTransitionProgress = 0; // Reset zoom progress

            // Override transition duration to match return duration
            this.returnTransitionDuration = this.lookAtReturnDuration;

            console.log(
              `CharacterController: Starting DoF/zoom reset during return (${this.lookAtReturnDuration}s)`
            );
          }

          // Swap start and end quaternions for return journey
          const temp = this.lookAtStartQuat.clone();
          this.lookAtStartQuat.copy(this.lookAtEndQuat);
          this.lookAtEndQuat.copy(temp);
        }
        // Stay at target orientation while holding (no need to update quaternion)
        return; // Skip rest of lookat update during hold
      }

      // Use appropriate duration based on current phase
      const currentDuration = this.lookAtReturning
        ? this.lookAtReturnDuration
        : this.lookAtDuration;
      this.lookAtProgress += dt / currentDuration;

      // Start DoF and zoom transitions when we reach the configured threshold (only during initial lookat, not return)
      if (!this.lookAtReturning) {
        const transitionStart =
          this.currentZoomConfig?.transitionStart ||
          this.dofTransitionStartProgress;
        if (
          this.lookAtDofActive &&
          !this.dofTransitioning &&
          this.lookAtProgress >= transitionStart
        ) {
          this.dofTransitioning = true;
          this.startFov = this.currentFov; // Capture current FOV as start for zoom
          this.zoomTransitioning = true;
          console.log(
            `CharacterController: Starting DoF and zoom transitions at ${(
              this.lookAtProgress * 100
            ).toFixed(0)}% (threshold: ${(transitionStart * 100).toFixed(0)}%)`
          );
        }
      }

      if (this.lookAtProgress >= 1.0) {
        this.lookAtProgress = 1.0;

        // Check if we need to return to original view
        if (this.lookAtReturnToOriginalView && !this.lookAtReturning) {
          // Check if we should hold before returning
          if (this.lookAtHoldDuration > 0) {
            // Start holding phase
            this.lookAtHolding = true;
            this.lookAtHoldTimer = 0;
            console.log(
              `CharacterController: Holding at target for ${this.lookAtHoldDuration}s before returning`
            );
          } else {
            // No hold, start return immediately
            this.lookAtReturning = true;
            this.lookAtProgress = 0;
            console.log(
              `CharacterController: Starting return to original view (${this.lookAtReturnDuration}s)`
            );

            // Start DoF/zoom reset immediately (so they return to normal as camera returns)
            if (this.sparkRenderer && this.lookAtDofActive) {
              // Manually trigger the reset transition
              this.dofHoldTimer = 0;
              this.targetFocalDistance = this.baseFocalDistance;
              this.targetApertureSize = this.baseApertureSize;
              this.lookAtDofActive = false;
              this.dofTransitioning = true;
              this.dofTransitionProgress = 0; // Reset for return transition

              // Also reset zoom
              this.startFov = this.currentFov; // Capture current FOV for smooth transition
              this.targetFov = this.baseFov;
              this.zoomTransitioning = true;
              this.zoomTransitionProgress = 0; // Reset zoom progress

              // Override transition duration to match return duration
              this.returnTransitionDuration = this.lookAtReturnDuration;

              console.log(
                `CharacterController: Starting DoF/zoom reset during return (${this.lookAtReturnDuration}s)`
              );
            }

            // Swap start and end quaternions for return journey
            const temp = this.lookAtStartQuat.clone();
            this.lookAtStartQuat.copy(this.lookAtEndQuat);
            this.lookAtEndQuat.copy(temp);
          }
        } else {
          // Look-at complete (or return complete)
          this.isLookingAt = false;
          this.lookAtReturning = false;
          this.lookAtHolding = false;
          this.returnTransitionDuration = null; // Clear return transition override

          // Reset glance state
          this.glanceState = null;
          this.glanceTimer = 0;
          this.wasIdleAllowed = false;
          this.currentRoll = 0; // Reset head tilt

          // Start DoF/zoom reset timer (only if NOT returning to original view)
          // If returnToOriginalView was true, the reset already happened during the return phase
          if (
            this.sparkRenderer &&
            this.lookAtDofActive &&
            !this.lookAtReturnToOriginalView
          ) {
            const resetDuration =
              this.currentZoomConfig?.holdDuration || this.dofHoldDuration;
            this.dofHoldTimer = resetDuration;
            console.log(
              `CharacterController: Holding DoF for ${resetDuration}s before resetting`
            );
          }

          // Call completion callback if provided (should handle input restoration)
          if (this.lookAtOnComplete) {
            this.lookAtOnComplete();
            this.lookAtOnComplete = null;
          }
        }
      }

      // Slerp between start and end quaternions
      const t = Math.min(this.lookAtProgress, 1.0);
      // Apply easing for smoother motion
      const easedT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      const currentQuat = new THREE.Quaternion();
      currentQuat.slerpQuaternions(
        this.lookAtStartQuat,
        this.lookAtEndQuat,
        easedT
      );

      // Apply quaternion to camera
      this.camera.quaternion.copy(currentQuat);

      // Update yaw/pitch for smooth handoff to normal control
      const euler = new THREE.Euler().setFromQuaternion(currentQuat, "YXZ");
      this.yaw = euler.y;
      this.pitch = euler.x;
      this.targetYaw = this.yaw;
      this.targetPitch = this.pitch;
    }

    // Handle character move-to sequence
    if (this.isMovingTo) {
      this.moveToProgress += dt / this.moveToDuration;

      if (this.moveToProgress >= 1.0) {
        // Move complete
        this.moveToProgress = 1.0;
        this.isMovingTo = false;

        // Set final position and rotation
        this.character.setTranslation(
          {
            x: this.moveToTargetPos.x,
            y: this.moveToTargetPos.y,
            z: this.moveToTargetPos.z,
          },
          true
        );
        this.yaw = this.moveToTargetYaw;
        this.pitch = this.moveToTargetPitch;
        this.targetYaw = this.yaw;
        this.targetPitch = this.pitch;
        this.bodyYaw = this.yaw; // Update body yaw to match

        // Restore input based on what was disabled
        if (this.moveToInputControl) {
          if (
            this.moveToInputControl.disableMovement &&
            this.moveToInputControl.disableRotation
          ) {
            // Both were disabled, enable everything
            this.inputDisabled = false;
            this.inputManager.enable();
            console.log(
              "CharacterController: Move-to complete, restored full input"
            );
          }
          // NOTE: Selective disables (only movement or only rotation) are NOT restored
          // They must be manually restored by calling enableMovement() or enableRotation()
          this.moveToInputControl = null;
        }

        // Call completion callback if provided
        if (this.moveToOnComplete) {
          this.moveToOnComplete();
          this.moveToOnComplete = null;
        }

        console.log("CharacterController: Move-to complete");
      } else {
        // Interpolate position and rotation
        const t = Math.min(this.moveToProgress, 1.0);
        // Apply ease-in-out for smooth motion
        const easedT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        // Lerp position
        const currentPos = new THREE.Vector3();
        currentPos.lerpVectors(
          this.moveToStartPos,
          this.moveToTargetPos,
          easedT
        );

        // Update physics body position
        this.character.setTranslation(
          { x: currentPos.x, y: currentPos.y, z: currentPos.z },
          true
        );

        // Interpolate rotation
        this.yaw =
          this.moveToStartYaw +
          (this.moveToTargetYaw - this.moveToStartYaw) * easedT;
        this.pitch =
          this.moveToStartPitch +
          (this.moveToTargetPitch - this.moveToStartPitch) * easedT;
        this.targetYaw = this.yaw;
        this.targetPitch = this.pitch;

        // Also update body yaw during scripted movement
        this.bodyYaw = this.yaw;
      }
    }

    if (!this.isLookingAt && !this.inputDisabled) {
      // Normal camera control
      // Get camera input from input manager
      const cameraInput = this.inputManager.getCameraInput(dt);

      // Check if there's any manual camera input and cancel glance if so
      const hasManualInput =
        Math.abs(cameraInput.x) > 0.0001 || Math.abs(cameraInput.y) > 0.0001;
      if (hasManualInput && this.glanceState !== null) {
        // Cancel the glance and reset to current position
        this.glanceState = null;
        this.glanceTimer = 5.0 + Math.random() * 3.0; // Next glance in 5-8 seconds
        this.currentRoll = 0; // Reset head tilt immediately
        console.log(
          "CharacterController: Manual camera input detected, cancelling glance"
        );
      }

      // Apply camera rotation differently based on input source
      if (cameraInput.hasGamepad) {
        // Gamepad: Apply directly to yaw/pitch for immediate response
        // (no target/smoothing to avoid "chasing" behavior)
        this.yaw -= cameraInput.x;
        this.pitch -= cameraInput.y;
        this.pitch = Math.max(
          -Math.PI / 2 + 0.01,
          Math.min(Math.PI / 2 - 0.01, this.pitch)
        );

        // Keep targets in sync
        this.targetYaw = this.yaw;
        this.targetPitch = this.pitch;
      } else if (hasManualInput) {
        // Mouse: Apply to targets with smoothing for precise control (only if there's input)
        this.targetYaw -= cameraInput.x;
        this.targetPitch -= cameraInput.y;
        this.targetPitch = Math.max(
          -Math.PI / 2 + 0.01,
          Math.min(Math.PI / 2 - 0.01, this.targetPitch)
        );

        // Smooth camera rotation to reduce jitter
        this.yaw += (this.targetYaw - this.yaw) * this.cameraSmoothingFactor;
        this.pitch +=
          (this.targetPitch - this.pitch) * this.cameraSmoothingFactor;
      } else {
        // No manual input, still apply smoothing if there's a difference
        this.yaw += (this.targetYaw - this.yaw) * this.cameraSmoothingFactor;
        this.pitch +=
          (this.targetPitch - this.pitch) * this.cameraSmoothingFactor;
      }

      // Reset frame input after processing
      this.inputManager.resetFrameInput();
    }

    // Input -> desired velocity in XZ plane (disabled during look-at)
    let isMoving = false;
    let isSprinting = false;
    if (!this.inputDisabled) {
      const { forward, right } = this.getForwardRightVectors();
      const movementInput = this.inputManager.getMovementInput();
      isSprinting = this.inputManager.isSprinting();
      const moveSpeed = isSprinting
        ? this.baseSpeed * this.sprintMultiplier
        : this.baseSpeed;
      const desired = new THREE.Vector3();

      // Apply movement input (y is forward/back, x is left/right)
      desired.add(forward.clone().multiplyScalar(movementInput.y));
      desired.add(right.clone().multiplyScalar(movementInput.x));

      isMoving = desired.lengthSq() > 1e-6;
      if (isMoving) {
        desired.normalize().multiplyScalar(moveSpeed);

        // When moving, body gradually aligns with camera for smooth turning
        const angleDiff = this.yaw - this.bodyYaw;
        const normalizedDiff = Math.atan2(
          Math.sin(angleDiff),
          Math.cos(angleDiff)
        );
        // Smoother rotation while moving (0.15)
        this.bodyYaw += normalizedDiff * 0.15;
      }

      // Always check neck limit (whether moving or not)
      let cameraBodyDiff = this.yaw - this.bodyYaw;
      cameraBodyDiff = Math.atan2(
        Math.sin(cameraBodyDiff),
        Math.cos(cameraBodyDiff)
      );

      // If not moving and beyond neck limit, turn body to catch up
      // Use moderate speed so body turns smoothly
      if (!isMoving && Math.abs(cameraBodyDiff) > this.neckRotationLimit) {
        this.bodyYaw += cameraBodyDiff * 0.06; // Balanced speed for smooth rotation
      }

      // Apply velocity: preserve current Y velocity (gravity)
      const linvel = this.character.linvel();
      // If not moving (or movement disabled), explicitly clear horizontal velocity
      if (!isMoving || !this.inputManager.isMovementEnabled()) {
        this.character.setLinvel({ x: 0, y: linvel.y, z: 0 }, true);
      } else {
        this.character.setLinvel(
          { x: desired.x, y: linvel.y, z: desired.z },
          true
        );
      }
    } else {
      // Stop movement when input is disabled
      const linvel = this.character.linvel();
      this.character.setLinvel({ x: 0, y: linvel.y, z: 0 }, true);
    }

    // Update idle glance system (before headbob so it can affect targetYaw)
    this.updateIdleGlance(dt, isMoving);

    // Update headbob state
    const targetIntensity = this.headbobEnabled ? (isMoving ? 1.0 : 0.0) : 0.0;
    this.headbobIntensity += (targetIntensity - this.headbobIntensity) * 0.15; // Smooth transition

    // Always update idle headbob time for breathing animation
    this.idleHeadbobTime += dt;

    if (isMoving && this.headbobEnabled) {
      this.headbobTime += dt; // Accumulate time only when moving
    }

    // Update breathing system
    const movementIntensity = isSprinting ? 1.0 : 0.5;
    this.breathingSystem.update(dt, isMoving, movementIntensity);

    // Update first-person body animation with blending
    if (
      this.enableFirstPersonBody &&
      this.bodyAnimationMixer &&
      this.walkAnimation &&
      this.idleAnimation
    ) {
      // Don't update the mixer if it belongs to SceneManager (it updates its own mixers)
      // Only update if we created our own mixer
      const isOurMixer =
        !this.sceneManager?.animationMixers.has("firstPersonBody");
      if (isOurMixer) {
        this.bodyAnimationMixer.update(dt);
      }

      // Blend between walk/idle animations
      const blendSpeed = 0.1; // How fast to blend between animations

      if (isMoving) {
        // Moving: Blend to walk animation
        const targetTimeScale = isSprinting ? 1.5 : 1.0;

        // Walk weight up, idle down
        const currentWalkWeight = this.walkAnimation.getEffectiveWeight();
        const newWalkWeight = Math.min(1.0, currentWalkWeight + blendSpeed);
        this.walkAnimation.setEffectiveWeight(newWalkWeight);
        this.idleAnimation.setEffectiveWeight(1.0 - newWalkWeight);

        // Adjust walk animation speed
        this.walkAnimation.timeScale = targetTimeScale;
      } else {
        // Idle: Blend to idle animation
        const currentIdleWeight = this.idleAnimation.getEffectiveWeight();
        const newIdleWeight = Math.min(1.0, currentIdleWeight + blendSpeed);
        this.idleAnimation.setEffectiveWeight(newIdleWeight);
        this.walkAnimation.setEffectiveWeight(1.0 - newIdleWeight);
      }
    } else if (
      this.enableFirstPersonBody &&
      this.bodyModelGroup &&
      !this.bodyAnimationMixer
    ) {
      // Log once that we don't have an animation mixer
      if (!this.loggedNoAnimation) {
        console.warn("CharacterController: No animation mixer found for body");
        this.loggedNoAnimation = true;
      }
    }

    // Update footstep audio
    if (this.footstepSound) {
      // Resume audio context if it's suspended (browser autoplay policy)
      if (this.audioListener.context.state === "suspended") {
        this.audioListener.context.resume();
      }

      if (isMoving && !this.isPlayingFootsteps) {
        this.footstepSound.play();
        this.isPlayingFootsteps = true;
      } else if (!isMoving && this.isPlayingFootsteps) {
        this.footstepSound.stop();
        this.isPlayingFootsteps = false;
      }

      // Adjust playback rate based on sprint
      if (this.isPlayingFootsteps) {
        const playbackRate = isSprinting ? 1.5 : 1.0;
        this.footstepSound.rate(playbackRate);
      }
    }

    // Get physics body position (needed for character container update below)
    const p = this.character.translation();

    // Sync camera to physics body position (unless camera sync is disabled)
    if (!this.cameraSyncDisabled) {
      // Calculate headbob offset (movement + idle)
      const movementHeadbob = this.headbobEnabled
        ? this.calculateHeadbob(isSprinting)
        : { vertical: 0, horizontal: 0 };
      const idleHeadbob = this.headbobEnabled
        ? this.calculateIdleHeadbob()
        : { vertical: 0, horizontal: 0 };
      const { forward: fwd, right: rgt } = this.getForwardRightVectors();

      // Camera follow: position slightly behind and above the character with headbob
      const cameraOffset = new THREE.Vector3(0, this.cameraHeight, 0);
      const camFollow = new THREE.Vector3(p.x, p.y, p.z).add(cameraOffset);

      // Apply combined headbob: vertical (Y) and horizontal (side-to-side relative to view direction)
      camFollow.y += movementHeadbob.vertical + idleHeadbob.vertical;
      camFollow.add(
        rgt
          .clone()
          .multiplyScalar(movementHeadbob.horizontal + idleHeadbob.horizontal)
      );

      this.camera.position.copy(camFollow);
    } else {
      // Camera sync is disabled (frozen state), but still apply idle breathing
      if (this.headbobEnabled) {
        const idleHeadbob = this.calculateIdleHeadbob();
        const { right: rgt } = this.getForwardRightVectors();

        // Apply idle breathing relative to frozen base position (amplified 3x for labored breathing)
        this.camera.position.copy(this.frozenCameraBasePosition);
        this.camera.position.y += idleHeadbob.vertical * 3.0;
        this.camera.position.add(
          rgt.clone().multiplyScalar(idleHeadbob.horizontal * 3.0)
        );
      }
    }

    // Update character container position and rotation
    // Body is a child of this container, so it follows automatically
    // Use bodyYaw (not this.yaw) so idle glances don't rotate the body
    if (this.characterContainer) {
      this.characterContainer.position.set(p.x, p.y, p.z);
      this.characterContainer.rotation.set(0, this.bodyYaw, 0);
    }

    // Build look direction from yaw/pitch (only when not in look-at mode and camera sync is enabled)
    if (!this.isLookingAt && !this.cameraSyncDisabled) {
      const lookDir = new THREE.Vector3(0, 0, -1).applyEuler(
        new THREE.Euler(this.pitch, this.yaw, this.currentRoll, "YXZ")
      );
      const lookTarget = new THREE.Vector3()
        .copy(this.camera.position)
        .add(lookDir);
      this.camera.lookAt(lookTarget);
    }
  }
}

export default CharacterController;

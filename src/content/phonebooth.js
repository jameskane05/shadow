import * as THREE from "three";
import { GAME_STATES } from "../gameData.js";

/**
 * PhoneBooth - Manages phonebooth-specific interactions and animations
 *
 * Features:
 * - Receiver reparenting and lerp animation
 * - Physics-based telephone cord simulation
 * - Audio-reactive light integration
 * - Phone booth state management
 * - Animation callbacks
 */
class PhoneBooth {
  constructor(options = {}) {
    this.sceneManager = options.sceneManager;
    this.lightManager = options.lightManager;
    this.sfxManager = options.sfxManager;
    this.physicsManager = options.physicsManager;
    this.scene = options.scene;
    this.camera = options.camera;
    this.characterController = options.characterController; // Reference to character controller

    // Receiver animation state
    this.receiverLerp = null;
    this.receiverDropLerp = null; // Lerp for dropping animation
    this.receiver = null;
    this.receiverOriginalWorldPos = null; // Original world position on load
    this.receiverOriginalWorldRot = null; // Original world rotation on load
    this.cordAttach = null;
    this.receiverPositionLocked = false;
    this.lockedReceiverPos = null;
    this.lockedReceiverRot = null;

    // Phone cord physics simulation
    this.cordLinks = []; // Array of { rigidBody, mesh, joint }
    this.cordLineMesh = null; // Visual line representation
    this.receiverAnchor = null; // Kinematic body that follows the receiver
    this.receiverRigidBody = null; // Dynamic rigid body for dropped receiver
    this.receiverCollider = null; // Collider for dropped receiver

    // Configuration
    this.config = {
      receiverTargetPos: new THREE.Vector3(-0.3, 0, -0.3), // Position relative to camera
      receiverTargetRot: new THREE.Euler(-0.5, -0.5, -Math.PI / 2),
      receiverTargetScale: new THREE.Vector3(1.0, 1.0, 1.0), // Scale when held (1.0 = original size)
      receiverLerpDuration: 1.5,
      receiverLerpEase: (t) => 1 - Math.pow(1 - t, 3), // Cubic ease-out

      // Cord configuration
      cordSegments: 12, // Number of links in the chain
      cordSegmentLength: 0.05, // Length of each segment (longer for slack)
      cordSegmentRadius: 0.002, // Radius of each segment (very slender)
      cordMass: 0.002, // Mass of each segment (lighter for natural droop)
      cordDamping: 8.0, // Linear damping (high to prevent wild movement)
      cordAngularDamping: 8.0, // Angular damping (high to prevent spinning)
      cordDroopAmount: 2, // How much the cord droops in the middle (0 = straight, 1+ = more droop)
      cordRigidSegments: 1, // Number of initial segments that use fixed joints (rigid at phone booth end)

      // Collision groups: 0x00040002
      // - Belongs to group 2 (0x0002) - Phone cord/receiver
      // - Collides with group 3 (0x0004) - Environment only
      // - Does NOT collide with group 1 (character controller)
      cordCollisionGroup: 0x00040002,

      // Receiver physics configuration (for when dropped)
      receiverColliderHeight: 0.215, // Height of cylindrical collider in meters
      receiverColliderRadius: 0.05, // Radius of cylindrical collider in meters
      receiverMass: 0.15, // Mass in kg (phone receivers are ~150g)
      receiverDamping: 0.8, // Linear damping
      receiverAngularDamping: 1.0, // Angular damping
    };
  }

  /**
   * Initialize the phonebooth
   * Sets up event listeners and creates the phone cord
   */
  initialize(gameManager = null) {
    if (!this.sceneManager) {
      console.warn("PhoneBooth: No SceneManager provided");
      return;
    }

    this.gameManager = gameManager;

    // Listen for animation finished events
    this.sceneManager.on("animation:finished", (animId) => {
      if (animId === "phonebooth-ring") {
        this.handleAnimationFinished();
      }
    });

    // Listen for game state changes
    if (this.gameManager) {
      this.gameManager.on("state:changed", (newState, oldState) => {
        // When leaving ANSWERED_PHONE state
        if (
          oldState.currentState === GAME_STATES.ANSWERED_PHONE &&
          newState.currentState !== GAME_STATES.ANSWERED_PHONE
        ) {
          // Stop receiver lerp at current position
          this.stopReceiverLerp();

          // If receiver is attached to camera, lock its local position
          if (this.receiver && this.receiver.parent === this.camera) {
            console.log(
              "PhoneBooth: Locking receiver position relative to camera"
            );
            // Store the current local position to prevent any transform updates
            const lockedPos = this.receiver.position.clone();
            const lockedRot = this.receiver.rotation.clone();

            // Set a flag to prevent position updates
            this.receiverPositionLocked = true;
            this.lockedReceiverPos = lockedPos;
            this.lockedReceiverRot = lockedRot;
          }
        }

        // When entering DRIVE_BY state, drop the receiver with physics
        if (newState.currentState === GAME_STATES.DRIVE_BY) {
          this.dropReceiverWithPhysics();
        }
      });
    }

    // Find the CordAttach and Receiver meshes
    this.cordAttach = this.sceneManager.findChildByName(
      "phonebooth",
      "CordAttach"
    );
    this.receiver = this.sceneManager.findChildByName("phonebooth", "Receiver");

    // Store receiver's original world position and rotation for drop animation
    if (this.receiver) {
      this.receiverOriginalWorldPos = new THREE.Vector3();
      this.receiverOriginalWorldRot = new THREE.Quaternion();
      this.receiver.getWorldPosition(this.receiverOriginalWorldPos);
      this.receiver.getWorldQuaternion(this.receiverOriginalWorldRot);
      console.log(
        "PhoneBooth: Stored receiver original position:",
        this.receiverOriginalWorldPos.toArray()
      );

      // If starting in DRIVE_BY or later, position receiver in dropped state
      if (
        this.gameManager &&
        this.gameManager.state &&
        this.gameManager.state.currentState >= GAME_STATES.DRIVE_BY
      ) {
        console.log(
          "PhoneBooth: Starting in DRIVE_BY or later state, positioning receiver in dropped state"
        );
        this.initializeReceiverInDroppedState();
      }
    }

    if (this.cordAttach && this.receiver && this.physicsManager) {
      // Create the phone cord chain
      this.createPhoneCord();
    } else {
      console.warn(
        "PhoneBooth: Cannot create phone cord - missing CordAttach, Receiver, or PhysicsManager"
      );
    }

    console.log("PhoneBooth: Initialized");
  }

  /**
   * Create the physics-based phone cord
   * Creates a chain of rigid bodies connected by spherical joints
   */
  createPhoneCord() {
    if (!this.physicsManager || !this.cordAttach || !this.receiver) {
      console.warn("PhoneBooth: Cannot create cord - missing components");
      return;
    }

    const world = this.physicsManager.world;
    const RAPIER = this.physicsManager.RAPIER;

    // Get world positions of cord attachment points
    const cordAttachPos = new THREE.Vector3();
    const receiverPos = new THREE.Vector3();
    this.cordAttach.getWorldPosition(cordAttachPos);
    this.receiver.getWorldPosition(receiverPos);

    // Calculate cord direction
    const cordDirection = new THREE.Vector3()
      .subVectors(receiverPos, cordAttachPos)
      .normalize();
    const segmentLength = this.config.cordSegmentLength;

    // Calculate total cord length (longer than straight distance for natural droop)
    const straightDistance = cordAttachPos.distanceTo(receiverPos);
    const totalCordLength = this.config.cordSegments * segmentLength;
    const slackFactor = totalCordLength / straightDistance;

    console.log(
      "PhoneBooth: Creating phone cord with",
      this.config.cordSegments,
      "segments"
    );
    console.log(
      "  Slack factor:",
      slackFactor.toFixed(2),
      "(>1 means cord will droop)"
    );
    console.log(
      "  CordAttach position (phone booth):",
      cordAttachPos.toArray()
    );
    console.log("  Receiver position:", receiverPos.toArray());
    console.log(
      "  Rigid segments:",
      this.config.cordRigidSegments,
      "at PHONE BOOTH end"
    );

    // Create cord segments with initial droop/curve
    for (let i = 0; i < this.config.cordSegments; i++) {
      let pos = new THREE.Vector3();

      // For the FIRST rigid segments (at phone booth), position them to stick out with smooth curve
      if (i < this.config.cordRigidSegments) {
        // Stick out from phone booth with gradual downward curve
        const rigidStep = (i + 1) / this.config.cordRigidSegments;
        pos.copy(cordAttachPos);
        // Extend horizontally outward from phone booth (positive X = right)
        pos.x += rigidStep * segmentLength * this.config.cordRigidSegments; // Extend right
        // Add smooth downward curve (quadratic easing)
        const curveFactor = rigidStep * rigidStep; // Accelerating curve downward
        pos.y -= curveFactor * segmentLength * 2; // Gradual drop
        console.log(`  Segment ${i} (RIGID): position`, pos.toArray());
      } else {
        // For flexible segments, calculate position from end of rigid section to receiver
        const flexibleSegmentIndex = i - this.config.cordRigidSegments;
        const totalFlexibleSegments =
          this.config.cordSegments - this.config.cordRigidSegments;
        const flexT = (flexibleSegmentIndex + 0.5) / totalFlexibleSegments;

        // Start position is end of rigid section (with curve)
        const rigidEndPos = new THREE.Vector3().copy(cordAttachPos);
        rigidEndPos.x += segmentLength * this.config.cordRigidSegments; // Full horizontal extension
        rigidEndPos.y -= segmentLength * 2; // Match the curve drop at the end

        // Lerp from end of rigid section to receiver
        pos.lerpVectors(rigidEndPos, receiverPos, flexT);

        // Add vertical droop in the middle (parabolic curve) for natural hanging
        // Maximum droop at flexT=0.5 (middle of flexible cord)
        const droopCurve = Math.sin(flexT * Math.PI); // 0 at ends, 1 at middle
        const droopOffset = droopCurve * this.config.cordDroopAmount;
        pos.y -= droopOffset; // Pull down by droop amount
      }

      // Create rigid body for this segment
      // For rigid segments at phone booth, make them KINEMATIC (unaffected by gravity)
      let rigidBodyDesc;
      if (i < this.config.cordRigidSegments) {
        rigidBodyDesc =
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
            pos.x,
            pos.y,
            pos.z
          );
        console.log(`  Segment ${i} is KINEMATIC (won't fall)`);
      } else {
        rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setLinearDamping(this.config.cordDamping)
          .setAngularDamping(this.config.cordAngularDamping);
      }

      const rigidBody = world.createRigidBody(rigidBodyDesc);

      // Create collider (small sphere)
      const colliderDesc = RAPIER.ColliderDesc.ball(
        this.config.cordSegmentRadius
      )
        .setMass(this.config.cordMass)
        .setCollisionGroups(this.config.cordCollisionGroup);

      world.createCollider(colliderDesc, rigidBody);

      // No visual mesh per segment - we'll use the line renderer instead
      const mesh = null;

      // Create joint to previous segment or anchor point
      let joint = null;
      if (i === 0) {
        // First segment - attach to CordAttach with a FIXED joint (rigid at phone booth)
        // We'll create a "virtual" kinematic body at the cord attach point
        const anchorBodyDesc =
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
            cordAttachPos.x,
            cordAttachPos.y,
            cordAttachPos.z
          );

        // Rotate anchor body to point horizontally right (same as rigid segments)
        const anchorRotation = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          -Math.PI / 2 // -90 degrees (pointing right)
        );
        anchorBodyDesc.setRotation({
          x: anchorRotation.x,
          y: anchorRotation.y,
          z: anchorRotation.z,
          w: anchorRotation.w,
        });

        const anchorBody = world.createRigidBody(anchorBodyDesc);

        // Create FIXED joint for first segment (kinematic segments don't need special joint config)
        const params = RAPIER.JointData.fixed(
          { x: 0, y: 0, z: 0 }, // Anchor on the fixed point
          { w: 1.0, x: 0, y: 0, z: 0 }, // Rotation at anchor
          { x: 0, y: 0, z: 0 }, // Anchor on the segment
          { w: 1.0, x: 0, y: 0, z: 0 } // Rotation at segment
        );

        joint = world.createImpulseJoint(params, anchorBody, rigidBody, true);

        // Store anchor body reference
        this.cordLinks.push({
          rigidBody: anchorBody,
          mesh: null,
          joint: null,
          isAnchor: true,
        });
      } else if (i < this.config.cordRigidSegments) {
        // First N segments after anchor - use FIXED joints (kinematic segments stay in place)
        const prevLink = this.cordLinks[this.cordLinks.length - 1];

        const params = RAPIER.JointData.fixed(
          { x: 0, y: 0, z: 0 }, // Anchor on previous segment
          { w: 1.0, x: 0, y: 0, z: 0 }, // Rotation at previous
          { x: 0, y: 0, z: 0 }, // Anchor on current segment
          { w: 1.0, x: 0, y: 0, z: 0 } // Rotation at current
        );

        joint = world.createImpulseJoint(
          params,
          prevLink.rigidBody,
          rigidBody,
          true
        );
      } else {
        // Remaining segments - use rope joints (strict max length)
        const prevLink = this.cordLinks[this.cordLinks.length - 1];

        // Use a rope joint with very tight max length (only 5% slack)
        const params = RAPIER.JointData.rope(
          segmentLength * 1.05, // Max length (only 5% slack)
          { x: 0, y: 0, z: 0 }, // Center of previous segment
          { x: 0, y: 0, z: 0 } // Center of current segment
        );

        joint = world.createImpulseJoint(
          params,
          prevLink.rigidBody,
          rigidBody,
          true
        );
      }

      this.cordLinks.push({
        rigidBody,
        mesh,
        joint,
        isAnchor: false,
      });
    }

    // Create receiver anchor (kinematic body that will follow the receiver)
    const receiverAnchorDesc =
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        receiverPos.x,
        receiverPos.y,
        receiverPos.z
      );
    this.receiverAnchor = world.createRigidBody(receiverAnchorDesc);

    // Attach last segment to receiver anchor with rope joint (flexible at receiver)
    const lastLink = this.cordLinks[this.cordLinks.length - 1];
    const lastJointParams = RAPIER.JointData.rope(
      segmentLength * 1.05, // Max length (only 5% slack)
      { x: 0, y: 0, z: 0 }, // Last segment center
      { x: 0, y: 0, z: 0 } // Receiver anchor center
    );
    const lastJoint = world.createImpulseJoint(
      lastJointParams,
      lastLink.rigidBody,
      this.receiverAnchor,
      true
    );

    // Store reference to last joint
    this.cordLinks.push({
      rigidBody: this.receiverAnchor,
      mesh: null,
      joint: lastJoint,
      isAnchor: true,
      isReceiverAnchor: true,
    });

    // Create visual line to represent the cord
    this.createCordLine();

    console.log("PhoneBooth: Phone cord created successfully");
  }

  /**
   * Create a visual line mesh for the phone cord
   */
  createCordLine() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((this.config.cordSegments + 2) * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    // Use TubeGeometry for a thicker, 3D cord
    const material = new THREE.MeshStandardMaterial({
      color: 0x808080, // Grey color
      metalness: 0.3,
      roughness: 0.8,
      wireframe: false, // Ensure solid mesh, not wireframe
    });

    // We'll update this to use a tube in the update method
    // For now, create a basic mesh that we'll replace with tube geometry
    this.cordLineMesh = new THREE.Mesh(geometry, material);
    this.cordLineMesh.renderOrder = 1; // Render after most objects
    this.scene.add(this.cordLineMesh);
  }

  /**
   * Update the visual line to match physics simulation
   */
  updateCordLine() {
    if (!this.cordLineMesh || !this.cordAttach || !this.receiver) return;

    // Collect all points along the cord
    const points = [];

    // Start point (CordAttach)
    const cordAttachPos = new THREE.Vector3();
    this.cordAttach.getWorldPosition(cordAttachPos);
    points.push(cordAttachPos.clone());

    // Cord segments (skip the anchor, start from actual segments)
    for (let i = 1; i < this.cordLinks.length; i++) {
      const link = this.cordLinks[i];
      if (link.isAnchor) continue;

      const translation = link.rigidBody.translation();
      points.push(
        new THREE.Vector3(translation.x, translation.y, translation.z)
      );
    }

    // End point (Receiver)
    const receiverPos = new THREE.Vector3();
    this.receiver.getWorldPosition(receiverPos);
    points.push(receiverPos.clone());

    // Create a smooth curve through the points
    const curve = new THREE.CatmullRomCurve3(points);

    // Create tube geometry along the curve
    const tubeGeometry = new THREE.TubeGeometry(
      curve,
      points.length * 2, // segments
      0.008, // radius (thicker than the physics collider)
      8, // radial segments
      false // not closed
    );

    // Replace the old geometry
    if (this.cordLineMesh.geometry) {
      this.cordLineMesh.geometry.dispose();
    }
    this.cordLineMesh.geometry = tubeGeometry;
  }

  /**
   * Destroy the phone cord physics and visuals
   */
  destroyPhoneCord() {
    if (!this.physicsManager) return;

    const world = this.physicsManager.world;

    // Remove all cord links
    for (const link of this.cordLinks) {
      if (link.joint) {
        world.removeImpulseJoint(link.joint, true);
      }
      if (link.rigidBody) {
        world.removeRigidBody(link.rigidBody);
      }
      if (link.mesh) {
        this.scene.remove(link.mesh);
        link.mesh.geometry.dispose();
        link.mesh.material.dispose();
      }
    }

    this.cordLinks = [];
    this.receiverAnchor = null;

    // Remove line mesh
    if (this.cordLineMesh) {
      this.scene.remove(this.cordLineMesh);
      this.cordLineMesh.geometry.dispose();
      this.cordLineMesh.material.dispose();
      this.cordLineMesh = null;
    }

    console.log("PhoneBooth: Phone cord destroyed");
  }

  /**
   * Handle phonebooth animation finished
   * Called when the phone booth ring animation completes
   */
  handleAnimationFinished() {
    console.log("PhoneBooth: Ring animation finished, reparenting receiver");

    // Keep the cord - it will follow the receiver as it moves
    this.reparentReceiver();
  }

  /**
   * Reparent the receiver from the phone booth to the camera
   * Preserves world position and smoothly lerps to target position
   */
  reparentReceiver() {
    if (!this.sceneManager || !this.camera) {
      console.warn("PhoneBooth: Cannot reparent receiver - missing managers");
      return;
    }

    // Reparent the "Receiver" mesh from phonebooth to camera
    // This preserves world position using THREE.js attach()
    this.receiver = this.sceneManager.reparentChild(
      "phonebooth",
      "Receiver",
      this.camera
    );

    if (this.receiver) {
      // Log receiver transform info for debugging
      const worldPos = new THREE.Vector3();
      this.receiver.getWorldPosition(worldPos);

      console.log("PhoneBooth: Receiver successfully attached to camera");
      console.log("  Local position:", this.receiver.position.toArray());
      console.log(
        "  Local rotation:",
        this.receiver.rotation.toArray().slice(0, 3)
      );
      console.log("  Local scale:", this.receiver.scale.toArray());
      console.log("  World position:", worldPos.toArray());
      console.log("  Parent:", this.receiver.parent?.type || "none");

      // Disable character physics collisions to prevent cord from pushing character
      if (this.characterController) {
        this.characterController.disablePhysicsCollisions();
      }

      // Start lerp animation to move receiver to target position
      this.startReceiverLerp();
    } else {
      console.warn("PhoneBooth: Failed to attach receiver to camera");
    }
  }

  /**
   * Start the receiver lerp animation
   * Smoothly moves receiver from its current position to the target position
   */
  startReceiverLerp() {
    if (!this.receiver) {
      console.warn("PhoneBooth: Cannot start lerp - no receiver");
      return;
    }

    // Convert Euler to Quaternion for smooth interpolation
    const startQuat = this.receiver.quaternion.clone();
    const targetQuat = new THREE.Quaternion().setFromEuler(
      this.config.receiverTargetRot
    );

    this.receiverLerp = {
      object: this.receiver,
      startPos: this.receiver.position.clone(),
      targetPos: this.config.receiverTargetPos,
      startQuat: startQuat,
      targetQuat: targetQuat,
      startScale: this.receiver.scale.clone(),
      targetScale: this.config.receiverTargetScale,
      duration: this.config.receiverLerpDuration,
      elapsed: 0,
    };

    console.log("PhoneBooth: Starting receiver lerp animation");
  }

  /**
   * Stop the receiver lerp animation
   * Keeps receiver attached to camera and physics following it
   */
  stopReceiverLerp() {
    if (this.receiverLerp) {
      console.log("PhoneBooth: Stopping receiver lerp");
      // Stop the lerp at its current position
      this.receiverLerp = null;
    }
  }

  /**
   * Start the receiver drop animation
   * Moves receiver to hang below the rigid cord section
   */
  startReceiverDropLerp() {
    if (
      !this.receiver ||
      !this.receiverOriginalWorldPos ||
      !this.receiverOriginalWorldRot ||
      !this.cordAttach
    ) {
      console.warn(
        "PhoneBooth: Cannot start drop lerp - no receiver or original position"
      );
      return;
    }

    // Current state (where the receiver is now in world space, detached from camera)
    const startPos = this.receiver.position.clone();
    const startQuat = this.receiver.quaternion.clone();

    // Target: Below the end of the rigid cord section
    const cordAttachPos = new THREE.Vector3();
    this.cordAttach.getWorldPosition(cordAttachPos);

    const targetPos = cordAttachPos.clone();
    // Position at end of rigid section
    targetPos.x +=
      this.config.cordSegmentLength * this.config.cordRigidSegments;
    targetPos.y -= this.config.cordSegmentLength * 2; // Match curve
    targetPos.y -= 0.3; // Hang below the rigid section

    // Flip the original rotation upside down (180 degrees on X axis)
    const targetQuat = this.receiverOriginalWorldRot.clone();
    const flipRotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI // 180 degrees
    );
    targetQuat.multiply(flipRotation);

    this.receiverDropLerp = {
      object: this.receiver,
      startPos: startPos,
      targetPos: targetPos,
      startQuat: startQuat,
      targetQuat: targetQuat,
      duration: 0.8, // 0.8 seconds for the drop
      elapsed: 0,
    };

    console.log(
      "PhoneBooth: Starting receiver drop animation (below rigid cord section)"
    );
    console.log("  Target position:", targetPos.toArray());
  }

  /**
   * Update receiver drop lerp animation
   * @param {number} dt - Delta time in seconds
   */
  updateReceiverDropLerp(dt) {
    if (!this.receiverDropLerp) return;

    this.receiverDropLerp.elapsed += dt;
    const t = Math.min(
      1,
      this.receiverDropLerp.elapsed / this.receiverDropLerp.duration
    );

    // Apply easing (cubic ease-in for falling motion)
    const eased = t * t * t;

    // Lerp position
    this.receiverDropLerp.object.position.lerpVectors(
      this.receiverDropLerp.startPos,
      this.receiverDropLerp.targetPos,
      eased
    );

    // Lerp rotation (using quaternion slerp for smooth interpolation)
    this.receiverDropLerp.object.quaternion.slerpQuaternions(
      this.receiverDropLerp.startQuat,
      this.receiverDropLerp.targetQuat,
      eased
    );

    // Complete animation
    if (t >= 1) {
      console.log("PhoneBooth: Receiver drop animation complete");
      this.receiverDropLerp = null;
    }
  }

  /**
   * Drop the receiver with physics
   * Detaches from camera and adds a dynamic rigid body so it falls and hangs by the cord
   */
  dropReceiverWithPhysics() {
    if (!this.receiver || !this.physicsManager || !this.receiverAnchor) {
      console.warn(
        "PhoneBooth: Cannot drop receiver - missing receiver, physics manager, or anchor"
      );
      return;
    }

    console.log("PhoneBooth: Detaching receiver from camera (no physics)");

    // Unlock position so we can move it
    this.receiverPositionLocked = false;
    this.lockedReceiverPos = null;
    this.lockedReceiverRot = null;

    // Get current world position and rotation before reparenting
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    this.receiver.getWorldPosition(worldPos);
    this.receiver.getWorldQuaternion(worldQuat);

    console.log(
      "PhoneBooth: Receiver current parent:",
      this.receiver.parent?.name || "none"
    );
    console.log(
      "PhoneBooth: Receiver world position before detach:",
      worldPos.toArray()
    );

    // Detach from camera and add to scene using THREE.js attach method
    // This preserves world transform
    this.scene.attach(this.receiver);

    console.log(
      "PhoneBooth: Receiver detached from camera, new parent:",
      this.receiver.parent?.name || "none"
    );
    console.log(
      "PhoneBooth: Receiver world position after detach:",
      this.receiver.position.toArray()
    );

    // Start drop animation: move 1m down and flip upside down
    this.startReceiverDropLerp();

    // Re-enable character physics collisions now that receiver is dropped
    if (this.characterController) {
      this.characterController.enablePhysicsCollisions();
    }
  }

  /**
   * Update receiver lerp animation
   * @param {number} dt - Delta time in seconds
   */
  updateReceiverLerp(dt) {
    if (!this.receiverLerp) return;

    this.receiverLerp.elapsed += dt;
    const t = Math.min(
      1,
      this.receiverLerp.elapsed / this.receiverLerp.duration
    );

    // Apply easing
    const eased = this.config.receiverLerpEase(t);

    // Lerp position
    this.receiverLerp.object.position.lerpVectors(
      this.receiverLerp.startPos,
      this.receiverLerp.targetPos,
      eased
    );

    // Lerp rotation (using quaternion slerp for smooth interpolation)
    this.receiverLerp.object.quaternion.slerpQuaternions(
      this.receiverLerp.startQuat,
      this.receiverLerp.targetQuat,
      eased
    );

    // Lerp scale
    this.receiverLerp.object.scale.lerpVectors(
      this.receiverLerp.startScale,
      this.receiverLerp.targetScale,
      eased
    );

    // Complete animation
    if (t >= 1) {
      console.log("PhoneBooth: Receiver lerp animation complete");
      this.receiverLerp = null;
    }
  }

  /**
   * Update method - call in animation loop
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    this.updateReceiverLerp(dt);
    this.updateReceiverDropLerp(dt);

    // If receiver position is locked, enforce it (prevents animation system from moving it)
    if (
      this.receiverPositionLocked &&
      this.receiver &&
      this.lockedReceiverPos
    ) {
      this.receiver.position.copy(this.lockedReceiverPos);
      this.receiver.rotation.copy(this.lockedReceiverRot);
    }

    // If receiver has its own physics body, sync mesh with physics
    if (this.receiverRigidBody && this.receiver) {
      const translation = this.receiverRigidBody.translation();
      const rotation = this.receiverRigidBody.rotation();

      this.receiver.position.set(translation.x, translation.y, translation.z);
      this.receiver.quaternion.set(
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w
      );
    }
    // Otherwise, update kinematic anchor to follow the receiver
    else if (this.receiverAnchor && this.receiver && !this.receiverRigidBody) {
      const receiverPos = new THREE.Vector3();
      this.receiver.getWorldPosition(receiverPos);
      this.receiverAnchor.setTranslation(
        { x: receiverPos.x, y: receiverPos.y, z: receiverPos.z },
        true
      );
    }

    // Update the visual cord (no individual meshes to update)
    if (this.cordLinks.length > 0) {
      this.updateCordLine();
    }
  }

  /**
   * Set receiver target position
   * @param {THREE.Vector3} position - Target position relative to camera
   */
  setReceiverTargetPosition(position) {
    this.config.receiverTargetPos.copy(position);
  }

  /**
   * Set receiver target rotation
   * @param {THREE.Euler} rotation - Target rotation relative to camera (Euler angles)
   */
  setReceiverTargetRotation(rotation) {
    this.config.receiverTargetRot.copy(rotation);
  }

  /**
   * Set receiver target scale
   * @param {THREE.Vector3} scale - Target scale (1.0 = original size)
   */
  setReceiverTargetScale(scale) {
    this.config.receiverTargetScale.copy(scale);
  }

  /**
   * Set receiver lerp duration
   * @param {number} duration - Duration in seconds
   */
  setReceiverLerpDuration(duration) {
    this.config.receiverLerpDuration = duration;
  }

  /**
   * Get receiver object
   * @returns {THREE.Object3D|null}
   */
  getReceiver() {
    return this.receiver;
  }

  /**
   * Check if receiver is attached to camera
   * @returns {boolean}
   */
  isReceiverAttached() {
    return this.receiver !== null && this.receiver.parent === this.camera;
  }

  /**
   * Initialize receiver in dropped state (for debug spawning into DRIVE_BY or later)
   * Positions the receiver in its final dangling position without animation
   */
  initializeReceiverInDroppedState() {
    if (
      !this.receiver ||
      !this.receiverOriginalWorldPos ||
      !this.receiverOriginalWorldRot ||
      !this.cordAttach
    ) {
      console.warn(
        "PhoneBooth: Cannot initialize dropped state - missing receiver or original position"
      );
      return;
    }

    // Detach from phonebooth and add to scene
    this.scene.attach(this.receiver);

    // Position below the end of the rigid cord section
    const cordAttachPos = new THREE.Vector3();
    this.cordAttach.getWorldPosition(cordAttachPos);

    const droppedPos = cordAttachPos.clone();
    // Position at end of rigid section
    droppedPos.x +=
      this.config.cordSegmentLength * this.config.cordRigidSegments;
    droppedPos.y -= this.config.cordSegmentLength * 2; // Match curve
    droppedPos.y -= 0.3; // Hang below the rigid section

    // Flip the original rotation upside down (180 degrees on X axis)
    const droppedQuat = this.receiverOriginalWorldRot.clone();
    const flipRotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI
    );
    droppedQuat.multiply(flipRotation);

    // Apply transform
    this.receiver.position.copy(droppedPos);
    this.receiver.quaternion.copy(droppedQuat);

    console.log(
      "PhoneBooth: Receiver initialized in dropped state below rigid cord at:",
      droppedPos.toArray()
    );

    // Re-enable character physics collisions (they would have been disabled when held)
    if (this.characterController) {
      this.characterController.enablePhysicsCollisions();
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.destroyPhoneCord();

    if (this.receiver && this.receiver.parent) {
      this.receiver.parent.remove(this.receiver);
    }
    this.receiver = null;
    this.receiverLerp = null;
    this.receiverDropLerp = null;
    this.cordAttach = null;
    this.receiverAnchor = null;
  }
}

export default PhoneBooth;

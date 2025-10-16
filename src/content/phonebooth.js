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
    this.receiver = null;
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
      cordSegmentLength: 0.12, // Length of each segment (longer for slack)
      cordSegmentRadius: 0.002, // Radius of each segment (very slender)
      cordMass: 10, // Mass of each segment (lighter for natural droop)
      cordDamping: 1.5, // Linear damping
      cordAngularDamping: 1.5, // Angular damping
      cordDroopAmount: 2, // How much the cord droops in the middle (0 = straight, 1+ = more droop)

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

    // Create cord segments with initial droop/curve
    for (let i = 0; i < this.config.cordSegments; i++) {
      // Calculate position along the cord with a catenary-like curve for natural droop
      const t = (i + 0.5) / this.config.cordSegments;

      // Base position along straight line
      const pos = new THREE.Vector3().lerpVectors(
        cordAttachPos,
        receiverPos,
        t
      );

      // Add vertical droop in the middle (parabolic curve)
      // Maximum droop at t=0.5 (middle of cord)
      const droopCurve = Math.sin(t * Math.PI); // 0 at ends, 1 at middle
      const droopOffset = droopCurve * this.config.cordDroopAmount;
      pos.y -= droopOffset; // Pull down by droop amount

      // Create rigid body for this segment
      const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinearDamping(this.config.cordDamping)
        .setAngularDamping(this.config.cordAngularDamping);

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
        // First segment - attach to CordAttach with a fixed anchor
        // We'll create a "virtual" kinematic body at the cord attach point
        const anchorBodyDesc =
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
            cordAttachPos.x,
            cordAttachPos.y,
            cordAttachPos.z
          );
        const anchorBody = world.createRigidBody(anchorBodyDesc);

        // Create FIXED joint for first segment (rigid connection, sticks out from phone)
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
      } else if (i === 1) {
        // Second segment - connect to first (rigid) segment with rope joint
        // This is where the flexible part starts
        const prevLink = this.cordLinks[this.cordLinks.length - 1];

        const params = RAPIER.JointData.rope(
          segmentLength * 1.2, // Max length (20% longer than segment for slack)
          { x: 0, y: 0, z: 0 }, // Center of previous segment
          { x: 0, y: 0, z: 0 } // Center of current segment
        );

        joint = world.createImpulseJoint(
          params,
          prevLink.rigidBody,
          rigidBody,
          true
        );
      } else {
        // Connect remaining segments with rope joints
        const prevLink = this.cordLinks[this.cordLinks.length - 1];

        // Use a rope joint (distance constraint with max length only)
        const params = RAPIER.JointData.rope(
          segmentLength * 1.2, // Max length (20% longer than segment for slack)
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

    // Attach last segment to receiver anchor with rope joint
    const lastLink = this.cordLinks[this.cordLinks.length - 1];
    const lastJointParams = RAPIER.JointData.rope(
      segmentLength * 1.2, // Max length (20% longer for slack)
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

    console.log("PhoneBooth: Dropping receiver with physics");

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

    // Get RAPIER physics world
    const world = this.physicsManager.world;
    if (!world) {
      console.error("PhoneBooth: Physics world not available");
      return;
    }

    // Import RAPIER from physics manager
    const RAPIER = this.physicsManager.RAPIER;

    // Get updated world position after reparenting (in case attach changed local coords)
    this.receiver.getWorldPosition(worldPos);
    this.receiver.getWorldQuaternion(worldQuat);

    // Create a dynamic rigid body for the receiver
    const receiverBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(worldPos.x, worldPos.y, worldPos.z)
      .setRotation({
        w: worldQuat.w,
        x: worldQuat.x,
        y: worldQuat.y,
        z: worldQuat.z,
      })
      .setLinearDamping(this.config.receiverDamping)
      .setAngularDamping(this.config.receiverAngularDamping);

    this.receiverRigidBody = world.createRigidBody(receiverBodyDesc);

    // Create cylindrical collider (Y-axis aligned by default)
    const colliderDesc = RAPIER.ColliderDesc.cylinder(
      this.config.receiverColliderHeight / 2, // Half-height
      this.config.receiverColliderRadius
    )
      .setMass(this.config.receiverMass)
      .setCollisionGroups(this.config.cordCollisionGroup);

    this.receiverCollider = world.createCollider(
      colliderDesc,
      this.receiverRigidBody
    );

    console.log(
      `PhoneBooth: Created receiver rigid body with cylinder collider (h=${this.config.receiverColliderHeight}m, r=${this.config.receiverColliderRadius}m, mass=${this.config.receiverMass}kg)`
    );

    // Find the last joint connecting to the receiver anchor
    const lastLinkIndex = this.cordLinks.findIndex(
      (link) => link.rigidBody === this.receiverAnchor
    );

    if (lastLinkIndex > 0) {
      // Get the second-to-last link (the last cord segment before the anchor)
      const secondToLastLink = this.cordLinks[lastLinkIndex - 1];

      // Remove old joint to the kinematic anchor (if it exists)
      if (secondToLastLink.joint) {
        world.removeImpulseJoint(secondToLastLink.joint, true);
        secondToLastLink.joint = null;
      }

      // Create new rope joint connecting last cord segment to receiver rigid body
      const jointParams = RAPIER.JointData.rope(
        this.config.cordSegmentLength * 1.2, // Max length with slack
        { x: 0, y: 0, z: 0 }, // Anchor on cord segment
        { x: 0, y: 0, z: 0 } // Anchor on receiver
      );

      const newJoint = world.createImpulseJoint(
        jointParams,
        secondToLastLink.rigidBody,
        this.receiverRigidBody,
        true
      );

      secondToLastLink.joint = newJoint;

      console.log("PhoneBooth: Reconnected cord to receiver rigid body");

      // Remove the old kinematic anchor from physics and cordLinks
      world.removeRigidBody(this.receiverAnchor);
      this.cordLinks.splice(lastLinkIndex, 1);

      // Replace receiverAnchor reference with new rigid body
      this.receiverAnchor = this.receiverRigidBody;
    } else {
      console.warn("PhoneBooth: Could not find receiver anchor in cord links");
    }

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
   * Clean up resources
   */
  destroy() {
    this.destroyPhoneCord();

    if (this.receiver && this.receiver.parent) {
      this.receiver.parent.remove(this.receiver);
    }
    this.receiver = null;
    this.receiverLerp = null;
    this.cordAttach = null;
    this.receiverAnchor = null;
  }
}

export default PhoneBooth;

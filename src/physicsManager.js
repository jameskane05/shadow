const RAPIER = await import("@dimforge/rapier3d");
import * as THREE from "three";

class PhysicsManager {
  constructor() {
    this.RAPIER = RAPIER; // Store RAPIER reference for external use
    this.gravity = { x: 0.0, y: -9.81, z: 0.0 };
    this.world = new RAPIER.World(this.gravity);
    this.createFloor();
  }

  createFloor() {
    const floorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    const floor = this.world.createRigidBody(floorDesc);
    const floorColliderDesc = RAPIER.ColliderDesc.cuboid(
      1000,
      0.1,
      1000
    ).setFriction(1.0);
    this.world.createCollider(floorColliderDesc, floor);
    return floor;
  }

  createCharacter(
    position = { x: 0, y: 0, z: 0 },
    rotation = { x: 0, y: 0, z: 0 }
  ) {
    // Convert Euler angles in DEGREES to quaternion
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(rotation.x),
      THREE.MathUtils.degToRad(rotation.y),
      THREE.MathUtils.degToRad(rotation.z)
    );
    const quat = new THREE.Quaternion().setFromEuler(euler);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinearDamping(0.2);
    const body = this.world.createRigidBody(bodyDesc);
    // Capsule with full height 1.6m: 2*halfHeight + 2*radius = 1.6 => halfHeight=0.5, radius=0.3
    const colliderDesc = RAPIER.ColliderDesc.capsule(0.6, 0.3)
      .setFriction(0.9)
      .setMass(60);
    this.world.createCollider(colliderDesc, body);
    return body;
  }

  /**
   * Create a sensor box collider descriptor (trigger, no physics interaction)
   * @param {number} hx - Half-extent X
   * @param {number} hy - Half-extent Y
   * @param {number} hz - Half-extent Z
   * @returns {Object} Collider descriptor
   */
  createSensorBox(hx, hy, hz) {
    return RAPIER.ColliderDesc.cuboid(hx, hy, hz).setSensor(true);
  }

  /**
   * Create a sensor sphere collider descriptor (trigger, no physics interaction)
   * @param {number} radius - Sphere radius
   * @returns {Object} Collider descriptor
   */
  createSensorSphere(radius) {
    return RAPIER.ColliderDesc.ball(radius).setSensor(true);
  }

  /**
   * Create a sensor capsule collider descriptor (trigger, no physics interaction)
   * @param {number} halfHeight - Half height of the cylindrical part
   * @param {number} radius - Capsule radius
   * @returns {Object} Collider descriptor
   */
  createSensorCapsule(halfHeight, radius) {
    return RAPIER.ColliderDesc.capsule(halfHeight, radius).setSensor(true);
  }

  /**
   * Create a collider from a descriptor
   * @param {Object} colliderDesc - Collider descriptor
   * @returns {Object} Collider
   */
  createColliderFromDesc(colliderDesc) {
    return this.world.createCollider(colliderDesc);
  }

  /**
   * Check if two colliders are intersecting
   * @param {Object} collider1 - First collider
   * @param {Object} collider2 - Second collider
   * @returns {boolean} True if intersecting
   */
  checkIntersection(collider1, collider2) {
    return this.world.intersectionPair(collider1, collider2);
  }

  step() {
    this.world.step();
  }
}

export default PhysicsManager;

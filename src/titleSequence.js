import * as THREE from "three";

/**
 * Manages a sequenced intro/outro animation for text particles
 */
export class TitleSequence {
  constructor(texts, options = {}) {
    this.texts = texts;
    this.introDuration = options.introDuration || 2.0; // seconds
    this.holdDuration = options.holdDuration || 4.0; // seconds
    this.outroDuration = options.outroDuration || 2.0; // seconds
    this.staggerDelay = options.staggerDelay || 1.0; // delay between texts
    this.disperseDistance = options.disperseDistance || 5.0;
    this.onComplete = options.onComplete || null; // Callback when sequence completes

    this.time = 0;
    this.completed = false; // Track if completion callback has been called
    this.totalDuration =
      this.introDuration +
      this.staggerDelay * (texts.length - 1) +
      this.holdDuration +
      this.outroDuration;

    // Calculate when outro should start (same for all texts)
    this.outroStartTime =
      this.introDuration +
      this.staggerDelay * (texts.length - 1) +
      this.holdDuration;

    // Initialize particle animation data for each text
    this.texts.forEach((text, i) => {
      text._startTime = i * this.staggerDelay;
      text._textIndex = i;

      // Pre-calculate random values for each particle
      if (text.particles) {
        text.particles.forEach((particle) => {
          particle._hash1 = this.hash(
            particle.id * 0.05,
            particle.id * 0.03,
            0.0
          );
          particle._hash2 = this.hash(
            particle.id * 0.11,
            particle.id * 0.22,
            particle.id * 0.33
          );
          particle._hash3 = this.hash(
            particle.id * 0.44,
            particle.id * 0.55,
            particle.id * 0.66
          );
          particle._hash4 = this.hash(
            particle.id * 0.77,
            particle.id * 0.88,
            particle.id * 0.99
          );
          particle._hash5 = this.hash(
            particle.id * 0.7,
            particle.id * 0.8,
            particle.id * 0.9
          );
          particle._turbulence1 = this.hash(
            particle.id * 0.1,
            particle.id * 0.2,
            particle.id * 0.3
          );
          particle._turbulence2 = this.hash(
            particle.id * 0.3,
            particle.id * 0.4,
            particle.id * 0.5
          );
          particle._turbulence3 = this.hash(
            particle.id * 0.5,
            particle.id * 0.6,
            particle.id * 0.7
          );
        });
      }
    });
  }

  /**
   * Simple hash function for pseudo-random values
   */
  hash(x, y, z) {
    x = (x * 0.1031) % 1.0;
    y = (y * 0.1031) % 1.0;
    z = (z * 0.1031) % 1.0;
    const t = x + y + z;
    return ((t * 12.9898 + 78.233) * 43758.5453123) % 1.0;
  }

  /**
   * Smooth easing function
   */
  easeInOut(t) {
    return t * t * (3.0 - 2.0 * t);
  }

  /**
   * Animate a single particle based on the current time
   */
  animateParticle(particle, text, globalTime) {
    // Position-based delay for left-to-right reveal (1.5 seconds total)
    const positionDelay = particle.normalizedX * 1.5;

    // Small wave offset for visual interest
    const waveOffset = particle._hash1 * 0.1; // Reduced from 0.3 for tighter sync

    // Both intro and outro use left-to-right progression
    const localTime = globalTime - text._startTime - positionDelay - waveOffset;
    const outroTime =
      globalTime - this.outroStartTime - positionDelay - waveOffset;

    let phase = 0; // 0=pre-intro, 1=intro, 2=hold, 3=outro, 4=post-outro
    let t = 0.0;

    if (localTime < 0.0) {
      phase = 0;
    } else if (localTime < this.introDuration) {
      phase = 1;
      t = localTime / this.introDuration;
    } else if (outroTime < 0.0) {
      // Hold phase: fully visible
      phase = 2;
      t = 1.0;
    } else if (outroTime < this.outroDuration) {
      // Outro phase: fade out with wave
      phase = 3;
      t = 1.0 - outroTime / this.outroDuration;
    } else {
      phase = 4;
    }

    // Calculate dispersion - wind-driven effect
    // Intro (phase 1): particles start LEFT (-1.0) and move to center
    // Outro (phase 3): particles exit RIGHT (1.0)
    const windDir = new THREE.Vector3(
      phase === 3 ? 1.0 : -1.0, // Reversed: intro from left, outro to right
      0.3,
      phase === 3 ? 0.5 : -0.5
    );

    // Add turbulence per particle
    const turbulence = new THREE.Vector3(
      particle._turbulence1 * 0.4 - 0.2,
      particle._turbulence2 * 0.4 - 0.2,
      particle._turbulence3 * 0.4 - 0.2
    );

    // ID-based offset
    const idOffset = new THREE.Vector3(
      particle._hash2 * 2.0 - 1.0,
      particle._hash3 * 2.0 - 1.0,
      particle._hash4 * 2.0 - 1.0
    ).multiplyScalar(0.2);

    // Combine: strong wind + turbulence + ID-based offset
    const disperseDir = windDir.add(turbulence).add(idOffset).normalize();

    // Add random distance variation per particle
    const randomDist = 0.7 + particle._hash5 * 0.6;

    const easedT = this.easeInOut(Math.max(0, Math.min(1, t)));

    // Calculate disperse factor
    let disperseFactor = 1.0;
    if (phase === 1) {
      disperseFactor = 1.0 - easedT;
    } else if (phase === 3) {
      disperseFactor = 1.0 - easedT;
    } else if (phase === 0 || phase === 4) {
      disperseFactor = 1.0;
    } else {
      disperseFactor = 0.0;
    }

    // Update particle position
    const offset = disperseDir.multiplyScalar(
      this.disperseDistance * randomDist * disperseFactor
    );
    particle.position.copy(particle.originalPosition).add(offset);

    // Scale effect
    if (phase === 1) {
      particle.scale = 0.2 + (1.0 - 0.2) * easedT;
    } else if (phase === 0 || phase === 4) {
      particle.scale = 0.2;
    } else if (phase === 3) {
      particle.scale = 1.0 - (1.0 - 0.2) * (1.0 - easedT);
    } else {
      particle.scale = 1.0;
    }

    // Opacity
    if (phase === 1) {
      particle.opacity = easedT;
    } else if (phase === 0 || phase === 4) {
      particle.opacity = 0.0;
    } else if (phase === 3) {
      particle.opacity = easedT;
    } else {
      particle.opacity = 1.0;
    }
  }

  update(dt) {
    this.time += dt;

    // Update all texts
    this.texts.forEach((text) => {
      if (!text.particles || !text.mesh) return;

      // Get geometry attributes
      const positions = text.mesh.geometry.attributes.position;
      const sizes = text.mesh.geometry.attributes.size;
      const opacities = text.mesh.geometry.attributes.opacity;

      // Animate each particle
      text.particles.forEach((particle, i) => {
        this.animateParticle(particle, text, this.time);

        // Update geometry attributes
        positions.array[i * 3] = particle.position.x;
        positions.array[i * 3 + 1] = particle.position.y;
        positions.array[i * 3 + 2] = particle.position.z;

        sizes.array[i] = 0.15 * particle.scale;
        opacities.array[i] = particle.opacity;
      });

      // Mark attributes as needing update
      positions.needsUpdate = true;
      sizes.needsUpdate = true;
      opacities.needsUpdate = true;

      // Update individual text animations (floating/rotation)
      if (text.update) {
        text.update(this.time * 1000);
      }
    });

    // Check if sequence just completed
    if (this.isComplete() && !this.completed) {
      this.completed = true;
      if (this.onComplete) {
        this.onComplete();
      }
    }
  }

  isComplete() {
    return this.time >= this.totalDuration;
  }

  hasOutroStarted() {
    return this.time >= this.outroStartTime && this.time < this.totalDuration;
  }

  reset() {
    this.time = 0;
    this.completed = false;

    // Reset all particles to their original state
    this.texts.forEach((text) => {
      if (!text.particles || !text.mesh) return;

      const positions = text.mesh.geometry.attributes.position;
      const sizes = text.mesh.geometry.attributes.size;
      const opacities = text.mesh.geometry.attributes.opacity;

      text.particles.forEach((particle, i) => {
        particle.position.copy(particle.originalPosition);
        particle.scale = 0.2;
        particle.opacity = 0.0;

        positions.array[i * 3] = particle.position.x;
        positions.array[i * 3 + 1] = particle.position.y;
        positions.array[i * 3 + 2] = particle.position.z;

        sizes.array[i] = 0.15 * particle.scale;
        opacities.array[i] = particle.opacity;
      });

      positions.needsUpdate = true;
      sizes.needsUpdate = true;
      opacities.needsUpdate = true;
    });
  }
}

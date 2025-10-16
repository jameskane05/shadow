import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

/**
 * Cloud Particles System
 * Creates a slow drifting fog animation using Gaussian splats for proper depth sorting
 * Based on the Spark.js particle animation example
 */

class CloudParticles {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.camera = options.camera || null; // Camera reference for player position tracking
    this.spawnPosition = options.spawnPosition || null; // Initial spawn position for particle distribution
    this.options = {
      particleCount: options.particleCount || 1000,
      cloudSize: options.cloudSize || 50, // Defines spawn volume and cull distance
      particleSize: options.particleSize || 0.12,
      particleSizeMin:
        options.particleSizeMin !== undefined ? options.particleSizeMin : 0.5, // Minimum size multiplier
      particleSizeMax:
        options.particleSizeMax !== undefined ? options.particleSizeMax : 1.5, // Maximum size multiplier
      windSpeed: options.windSpeed || -0.3,
      opacity: options.opacity || 0.4,
      color: options.color || 0xffffff,
      fluffiness: options.fluffiness || 0.5,
      turbulence: options.turbulence || 0.3,
      // Ground fog parameters
      groundLevel:
        options.groundLevel !== undefined ? options.groundLevel : 0.0,
      fogHeight: options.fogHeight || 3.0,
      fogFalloff: options.fogFalloff || 2.0,
      // Noise parameters for realistic fog movement
      octaves: options.octaves || 4,
      frequency: options.frequency || 0.3,
      amplitude: options.amplitude || 0.5,
      lacunarity: options.lacunarity || 2.0,
      persistence: options.persistence || 0.5,
      phase: options.phase || 0.1,
      ...options,
    };

    this.splatMesh = null;
    this.splatCount = 0; // Store actual splat count
    this.time = 0;
    this.lastPlayerPos = new THREE.Vector3();
    this.currentWindSpeed = this.options.windSpeed; // Track current wind speed for smooth transitions
    this.worldOrigin = null; // Fixed world space origin for coordinate system (set on init)

    // Transition state
    this.isTransitioning = false;
    this.transitionStartTime = 0;
    this.transitionDuration = 0;
    this.transitionStartValues = {};
    this.transitionTargetValues = {};

    this.init();
  }

  // fBM noise implementation from the Spark example
  noise(x, y, z, t) {
    let value = 0;
    let amp = this.options.amplitude;
    let freq = this.options.frequency;

    for (let i = 0; i < this.options.octaves; i++) {
      const to = t * this.options.phase * (i + 1);

      // 3D grid of sines
      value +=
        amp *
        Math.sin(x * freq + to) *
        Math.sin(y * freq + to) *
        Math.sin(z * freq + to);

      freq *= this.options.lacunarity;
      amp *= this.options.persistence;
    }

    return value;
  }

  wrap(val, min, max) {
    const range = max - min;
    return ((((val - min) % range) + range) % range) + min;
  }

  init() {
    console.log("🌫️ Initializing CPU-based fog system (cloudParticles.js)");
    const actualParticleCount = this.options.particleCount;

    // Store the actual count for external access
    this.splatCount = actualParticleCount;

    // Allocate per-particle param arrays for deterministic motion
    this.uCoord = new Float32Array(actualParticleCount); // upwind axis coordinate
    this.vCoord = new Float32Array(actualParticleCount); // lateral axis coordinate
    this.heightT = new Float32Array(actualParticleCount); // 0..1 height factor
    this.phase = new Float32Array(actualParticleCount); // per-particle phase
    this.lateralSpeed = new Float32Array(actualParticleCount); // lateral drift speed (units/s)
    this.lateralFreq = new Float32Array(actualParticleCount); // lateral drift frequency (Hz)
    this.verticalAmp = new Float32Array(actualParticleCount); // vertical oscillation amplitude (units)
    this.verticalFreq = new Float32Array(actualParticleCount); // vertical oscillation frequency (Hz)
    this.baseOpacity = new Float32Array(actualParticleCount); // base opacity factor per particle (0-1)

    const color = new THREE.Color(this.options.color);

    // Create SplatMesh using constructSplats and onFrame
    this.splatMesh = new SplatMesh({
      maxSplats: actualParticleCount,
      constructSplats: (splats) => {
        this.createCloudSplats(splats, actualParticleCount, color);
      },
      onFrame: ({ mesh, time, deltaTime }) => {
        this.animateCloudSplats(mesh, time, deltaTime);
      },
    });

    this.scene.add(this.splatMesh);
  }

  createCloudSplats(splats, particleCount, color) {
    const center = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const now = this.time * 0.2;

    // Get initial player position - prefer spawn position for debug spawning support
    // Store this as fixed world origin so fog doesn't follow player
    if (this.spawnPosition) {
      this.worldOrigin = new THREE.Vector3(
        this.spawnPosition.x,
        this.spawnPosition.y,
        this.spawnPosition.z
      );
    } else if (this.camera) {
      this.worldOrigin = this.camera.position.clone();
    } else {
      this.worldOrigin = new THREE.Vector3(0, 0, 0);
    }
    const playerPos = this.worldOrigin;

    // Establish wind-aligned basis from base wind
    let baseWX = this.options.windSpeed * 0.3;
    let baseWZ = this.options.windSpeed * 1.0;
    let baseWMag = Math.sqrt(baseWX * baseWX + baseWZ * baseWZ);
    if (baseWMag < 1e-5) {
      baseWX = -0.3;
      baseWZ = -1.0;
      baseWMag = Math.sqrt(baseWX * baseWX + baseWZ * baseWZ);
    }
    const upX0 = -baseWX / baseWMag;
    const upZ0 = -baseWZ / baseWMag;
    const perpX0 = -upZ0;
    const perpZ0 = upX0;

    for (let i = 0; i < particleCount; i++) {
      // Generate consistent randomness per particle (prevents flickering)
      const seed = i * 0.12345;
      const random = {
        x: Math.abs((Math.sin(seed * 12.9898) * 43758.5453) % 1),
        y: Math.abs((Math.sin(seed * 78.233) * 43758.5453) % 1),
        z: Math.abs((Math.sin(seed * 37.719) * 43758.5453) % 1),
        w: Math.abs((Math.sin(seed * 93.989) * 43758.5453) % 1),
      };

      // Vary particle size using configured min/max multipliers
      const sizeVariation = THREE.MathUtils.lerp(
        this.options.particleSizeMin,
        this.options.particleSizeMax,
        random.w
      );
      const particleSize = this.options.particleSize * sizeVariation;
      const scales = new THREE.Vector3(
        particleSize,
        particleSize * 0.6, // Flatter for ground fog
        particleSize
      );

      // Use exponential distribution for height - more fog near ground
      const heightBias = Math.pow(random.y, this.options.fogFalloff);

      // Spawn particles uniformly in wind-aligned rectangular box (matches wrapping volume exactly)
      // This prevents density drift over time
      const u0 = (random.x - 0.5) * 2 * this.options.cloudSize; // -cloudSize to +cloudSize
      const v0 = (random.z - 0.5) * 2 * this.options.cloudSize; // -cloudSize to +cloudSize

      let x = playerPos.x + upX0 * u0 + perpX0 * v0;
      let y = THREE.MathUtils.lerp(
        this.options.groundLevel,
        this.options.groundLevel + this.options.fogHeight,
        heightBias
      );
      let z = playerPos.z + upZ0 * u0 + perpZ0 * v0;

      // Apply small initial vertical variation only (horizontal handled by oscillation)
      const fluffiness =
        Math.sin(random.w * Math.PI * 2) * this.options.fluffiness * 0.1;
      y += fluffiness;

      // Clamp Y to keep fog on ground
      y = Math.max(
        this.options.groundLevel,
        Math.min(this.options.groundLevel + this.options.fogHeight, y)
      );

      // Opacity falloff with height - denser at bottom, thinner at top
      const heightFactor =
        (y - this.options.groundLevel) / this.options.fogHeight;
      const heightOpacity = Math.pow(heightFactor, 0.5); // Gradual falloff

      // Store base opacity factor (0-1) for per-particle variation
      const opacityFactor = heightOpacity * (0.7 + 0.3 * random.w);
      this.baseOpacity[i] = Math.max(0.05, opacityFactor);

      const opacity = this.options.opacity * this.baseOpacity[i];

      center.set(x, y, z);

      // Seed deterministic coordinates directly (already calculated in wind frame)
      this.uCoord[i] = u0;
      this.vCoord[i] = v0;
      this.heightT[i] = heightBias;
      this.phase[i] = random.w * Math.PI * 2;
      this.lateralSpeed[i] = THREE.MathUtils.lerp(0.2, 0.8, random.x);
      this.lateralFreq[i] = THREE.MathUtils.lerp(0.05, 0.2, random.y);
      this.verticalAmp[i] =
        THREE.MathUtils.lerp(0.05, 0.35, random.z) *
        this.options.fluffiness *
        0.5;
      this.verticalFreq[i] = THREE.MathUtils.lerp(0.05, 0.18, random.w);
      splats.pushSplat(center, scales, quaternion, opacity, color);
    }
  }

  animateCloudSplats(mesh, time, deltaTime) {
    // Update internal time
    this.time = time;
    const now = time * 0.2;

    // Handle transitions
    if (this.isTransitioning) {
      const elapsed = time - this.transitionStartTime;
      const t = Math.min(elapsed / this.transitionDuration, 1.0);

      // Debug: log transition progress every 0.5 seconds
      if (Math.floor(elapsed * 2) !== Math.floor((elapsed - deltaTime) * 2)) {
        console.log(
          `Transition progress: ${(t * 100).toFixed(1)}% (${elapsed.toFixed(
            2
          )}s / ${this.transitionDuration}s)`
        );
      }

      // Lerp runtime parameters (only windSpeed and opacity)
      if ("windSpeed" in this.transitionTargetValues) {
        this.options.windSpeed = THREE.MathUtils.lerp(
          this.transitionStartValues.windSpeed,
          this.transitionTargetValues.windSpeed,
          t
        );
        // Debug: log wind speed changes
        if (Math.floor(elapsed * 2) !== Math.floor((elapsed - deltaTime) * 2)) {
          console.log(`  windSpeed: ${this.options.windSpeed.toFixed(3)}`);
        }
      }

      if ("opacity" in this.transitionTargetValues) {
        this.options.opacity = THREE.MathUtils.lerp(
          this.transitionStartValues.opacity,
          this.transitionTargetValues.opacity,
          t
        );
        // Debug: log opacity changes
        if (Math.floor(elapsed * 2) !== Math.floor((elapsed - deltaTime) * 2)) {
          console.log(`  opacity: ${this.options.opacity.toFixed(4)}`);
        }
      }

      // End transition
      if (t >= 1.0) {
        console.log("Fog transition complete");
        this.isTransitioning = false;
      }
    }

    // Use current wind speed
    this.currentWindSpeed = this.options.windSpeed;

    // Use fixed world origin for coordinate system (fog stays in world space)
    const originPos = this.worldOrigin || new THREE.Vector3(0, 0, 0);
    const cullDistanceSq = this.options.cloudSize * this.options.cloudSize; // legacy (no longer used for respawn)

    // Compute wind-aligned wrapping basis (XZ plane)
    let windDirX = this.currentWindSpeed * 0.3;
    let windDirZ = this.currentWindSpeed * 1.0;
    let windMag = Math.sqrt(windDirX * windDirX + windDirZ * windDirZ);
    if (windMag < 1e-5) {
      // Fallback direction when wind is near zero to avoid NaNs
      windDirX = -0.3;
      windDirZ = -1.0;
      windMag = Math.sqrt(windDirX * windDirX + windDirZ * windDirZ);
    }
    // Upwind points opposite the wind movement
    const upX = -windDirX / windMag;
    const upZ = -windDirZ / windMag;
    // Perpendicular vector for lateral axis
    const perpX = -upZ;
    const perpZ = upX;
    // Define half-extents of the wrapping volume along upwind and lateral axes
    const halfDepth = this.options.cloudSize; // upwind/downwind extent
    const halfWidth = this.options.cloudSize; // lateral extent

    mesh.packedSplats.forEachSplat(
      (index, center, scales, quaternion, opacity, color) => {
        // Deterministic advection in wind-aligned frame (no x/z noise)
        // ALL particles move at same wind speed to prevent bunching
        const duBase = (windDirX * upX + windDirZ * upZ) * deltaTime; // ~ -|wind|
        const du = duBase; // No per-particle speed variation
        const dv =
          this.lateralSpeed[index] *
          Math.sin(this.phase[index] + time * this.lateralFreq[index]) *
          deltaTime;

        // Continuous toroidal wrapping using proper modulo (no discrete wrap events)
        // This maintains perfectly uniform density by eliminating synchronization
        this.uCoord[index] += du;
        this.vCoord[index] += dv;

        // Wrap to toroidal space [-halfDepth, halfDepth] using existing wrap helper
        this.uCoord[index] = this.wrap(
          this.uCoord[index],
          -halfDepth,
          halfDepth
        );
        this.vCoord[index] = this.wrap(
          this.vCoord[index],
          -halfWidth,
          halfWidth
        );

        // Reconstruct world position (relative to fixed origin, not player)
        center.x =
          originPos.x + upX * this.uCoord[index] + perpX * this.vCoord[index];
        center.z =
          originPos.z + upZ * this.uCoord[index] + perpZ * this.vCoord[index];

        // Vertical motion: deterministic gentle oscillation around seeded height
        const yBase = THREE.MathUtils.lerp(
          this.options.groundLevel,
          this.options.groundLevel + this.options.fogHeight,
          this.heightT[index]
        );
        const yOffset =
          this.verticalAmp[index] *
          Math.sin(this.phase[index] + time * this.verticalFreq[index]);
        center.y = Math.max(
          this.options.groundLevel,
          Math.min(
            this.options.groundLevel + this.options.fogHeight,
            yBase + yOffset
          )
        );

        // Update opacity in real-time (multiply base opacity by current global opacity)
        const currentOpacity = this.options.opacity * this.baseOpacity[index];

        mesh.packedSplats.setSplat(
          index,
          center,
          scales,
          quaternion,
          currentOpacity,
          color
        );
      }
    );

    mesh.packedSplats.needsUpdate = true;
    mesh.needsUpdate = true;
  }

  respawnParticle(index, center, playerPos, now, currentWindSpeed) {
    // Generate semi-random position based on particle index (but different from initial)
    const seed = (index * 0.12345 + now * 0.01) % 1;
    const random = {
      x: Math.abs((Math.sin(seed * 12.9898 + now) * 43758.5453) % 1),
      y: Math.abs((Math.sin(seed * 78.233 + now) * 43758.5453) % 1),
      z: Math.abs((Math.sin(seed * 37.719 + now) * 43758.5453) % 1),
      w: Math.abs((Math.sin(seed * 93.989 + now) * 43758.5453) % 1),
    };

    // Spawn particles on the upwind face of the bounding volume
    // Wind pushes particles in direction (windSpeed * 0.3, windSpeed * 1.0)
    // Since windSpeed is negative, particles move in (-X, -Z) direction
    // So spawn upwind in (+X, +Z) direction - opposite of wind

    // Normalize the wind direction vector for proper angle calculation
    const windDirX = currentWindSpeed * 0.3;
    const windDirZ = currentWindSpeed * 1.0;
    const windMagnitude = Math.sqrt(windDirX * windDirX + windDirZ * windDirZ);
    const windNormX = windDirX / windMagnitude;
    const windNormZ = windDirZ / windMagnitude;

    // Upwind is opposite direction
    const upwindX = -windNormX;
    const upwindZ = -windNormZ;

    // Base position: half cloudSize away (not full distance)
    const baseDistance = this.options.cloudSize * 0.5;

    // Create perpendicular vector for lateral spread
    // For 2D vector (x, z), perpendicular is (-z, x)
    const perpX = -upwindZ;
    const perpZ = upwindX;

    // Distribute particles across entire upwind face
    // Lateral: random position across the full width (use full cloudSize for coverage)
    const lateralOffset = (random.x - 0.5) * 2 * this.options.cloudSize; // Full width
    // Depth: slight variation to avoid flat plane
    const depthVariation = (random.w - 0.5) * baseDistance * 0.4; // ±20% depth variation

    const heightBias = Math.pow(random.y, this.options.fogFalloff);

    center.x =
      playerPos.x +
      upwindX * (baseDistance + depthVariation) +
      perpX * lateralOffset;
    center.y = THREE.MathUtils.lerp(
      this.options.groundLevel,
      this.options.groundLevel + this.options.fogHeight,
      heightBias
    );
    center.z =
      playerPos.z +
      upwindZ * (baseDistance + depthVariation) +
      perpZ * lateralOffset;

    // Add some variation
    const fluffiness =
      Math.sin(random.w * Math.PI * 2) * this.options.fluffiness;
    center.y += fluffiness;

    center.y = Math.max(
      this.options.groundLevel,
      Math.min(this.options.groundLevel + this.options.fogHeight, center.y)
    );
  }

  update(deltaTime = 0.016) {
    // SplatMesh handles updates via onFrame callback, no manual update needed
    // Just increment time for noise calculations
    this.time += deltaTime;
  }

  setColor(color) {
    // Color changes require recreating the splat mesh
    // For now, store the new color for next recreation
    this.options.color = color;
  }

  setOpacity(opacity) {
    // Opacity changes require recreating the splat mesh
    this.options.opacity = opacity;
  }

  setSize(size) {
    // Size changes require recreating the splat mesh
    this.options.particleSize = size;
  }

  transitionTo(targetParams, duration) {
    console.log(
      "Starting fog transition:",
      targetParams,
      "over",
      duration,
      "seconds"
    );
    this.isTransitioning = true;
    this.transitionStartTime = this.time;
    this.transitionDuration = duration;
    this.transitionStartValues = {};
    this.transitionTargetValues = {};

    // Store start and target values for all parameters (only windSpeed and opacity)
    const animatableParams = ["windSpeed", "opacity"];

    animatableParams.forEach((param) => {
      if (param in targetParams) {
        this.transitionStartValues[param] = this.options[param];
        this.transitionTargetValues[param] = targetParams[param];
        console.log(
          `  ${param}: ${this.options[param]} → ${targetParams[param]}`
        );
      }
    });
  }

  recreateMesh() {
    console.log("Recreating fog mesh with:", {
      particleCount: this.options.particleCount,
      particleSize: this.options.particleSize,
    });

    // Remove old mesh
    if (this.splatMesh) {
      this.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
    }

    // Reinitialize with new particle count/size
    const actualParticleCount = this.options.particleCount;
    this.splatCount = actualParticleCount;

    // Reallocate arrays
    this.uCoord = new Float32Array(actualParticleCount);
    this.vCoord = new Float32Array(actualParticleCount);
    this.heightT = new Float32Array(actualParticleCount);
    this.phase = new Float32Array(actualParticleCount);
    this.lateralSpeed = new Float32Array(actualParticleCount);
    this.lateralFreq = new Float32Array(actualParticleCount);
    this.verticalAmp = new Float32Array(actualParticleCount);
    this.verticalFreq = new Float32Array(actualParticleCount);
    this.baseOpacity = new Float32Array(actualParticleCount);

    const color = new THREE.Color(this.options.color);

    // Create new mesh
    this.splatMesh = new SplatMesh({
      maxSplats: actualParticleCount,
      constructSplats: (splats) => {
        this.createCloudSplats(splats, actualParticleCount, color);
      },
      onFrame: ({ mesh, time, deltaTime }) => {
        this.animateCloudSplats(mesh, time, deltaTime);
      },
    });

    this.scene.add(this.splatMesh);
  }

  dispose() {
    if (this.splatMesh) {
      this.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
    }
  }
}

// Factory function to create and return a cloud particle system
export function createCloudParticles(scene, options = {}) {
  return new CloudParticles(scene, options);
}

// Utility function to create multiple cloud layers
export function createCloudLayers(scene, layerCount = 3, options = {}) {
  const clouds = [];

  for (let i = 0; i < layerCount; i++) {
    const layerOptions = {
      particleCount: 300 + i * 200,
      cloudSize: 30 + i * 20,
      particleSize: 0.05 + i * 0.03,
      windSpeed: 0.0005 + i * 0.0003,
      opacity: 0.3 + i * 0.1,
      color: options.colors ? options.colors[i] : 0xffffff,
      ...options,
    };

    const cloud = new CloudParticles(scene, layerOptions);
    cloud.splatMesh.position.y = i * 10;
    clouds.push(cloud);
  }

  return clouds;
}

// Export the CloudParticles class as default
export default CloudParticles;

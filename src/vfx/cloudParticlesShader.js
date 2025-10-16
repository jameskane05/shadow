import * as THREE from "three";
import { SplatMesh, dyno } from "@sparkjsdev/spark";

/**
 * Cloud Particles System (Shader-based)
 * Creates a slow drifting fog animation using Gaussian splats with GPU-based animation
 * Uses the dyno shader system for high-performance particle updates
 */

class CloudParticlesShader {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.camera = options.camera || null;
    this.spawnPosition = options.spawnPosition || null;
    this.options = {
      particleCount: options.particleCount || 1000,
      cloudSize: options.cloudSize || 50,
      particleSize: options.particleSize || 0.12,
      particleSizeMin:
        options.particleSizeMin !== undefined ? options.particleSizeMin : 0.5,
      particleSizeMax:
        options.particleSizeMax !== undefined ? options.particleSizeMax : 1.5,
      windSpeed: options.windSpeed || -0.3,
      opacity: options.opacity || 0.4,
      color: options.color || 0xffffff,
      fluffiness: options.fluffiness || 0.5,
      turbulence: options.turbulence || 0.3,
      groundLevel:
        options.groundLevel !== undefined ? options.groundLevel : 0.0,
      fogHeight: options.fogHeight || 3.0,
      fogFalloff: options.fogFalloff || 2.0,
      ...options,
    };

    this.splatMesh = null;
    this.splatCount = 0;
    this.time = 0;
    this.worldOrigin = null;

    // Dyno uniforms for shader animation
    this.dynoTime = dyno.dynoFloat(0);
    this.dynoWindSpeed = dyno.dynoFloat(this.options.windSpeed);
    this.dynoOpacity = dyno.dynoFloat(this.options.opacity);
    this.dynoCloudSize = dyno.dynoFloat(this.options.cloudSize);
    this.dynoFluffiness = dyno.dynoFloat(this.options.fluffiness);
    this.dynoGroundLevel = dyno.dynoFloat(this.options.groundLevel);
    this.dynoFogHeight = dyno.dynoFloat(this.options.fogHeight);
    this.dynoOriginX = dyno.dynoFloat(0);
    this.dynoOriginY = dyno.dynoFloat(0);
    this.dynoOriginZ = dyno.dynoFloat(0);
    this.dynoParticleCount = dyno.dynoFloat(this.options.particleCount);

    // Transition state
    this.isTransitioning = false;
    this.transitionStartTime = 0;
    this.transitionDuration = 0;
    this.transitionStartValues = {};
    this.transitionTargetValues = {};

    this.init();
  }

  init() {
    console.log(
      "⚡ Initializing GPU shader-based fog system (cloudParticlesShader.js)"
    );
    const actualParticleCount = this.options.particleCount;
    this.splatCount = actualParticleCount;

    // Determine world origin for coordinate system
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

    // Update dyno origin values
    this.dynoOriginX.value = this.worldOrigin.x;
    this.dynoOriginY.value = this.worldOrigin.y;
    this.dynoOriginZ.value = this.worldOrigin.z;

    const color = new THREE.Color(this.options.color);

    // Create SplatMesh with onFrame callback - transformations auto-detected, no updateVersion needed
    this.splatMesh = new SplatMesh({
      maxSplats: actualParticleCount,
      constructSplats: (splats) => {
        this.createCloudSplats(splats, actualParticleCount, color);
      },
      onFrame: ({ mesh, time, deltaTime }) => {
        // Update time uniform
        this.time = time;
        this.dynoTime.value = time;

        // Handle transitions
        this.handleTransitions(time);

        // For dyno shader modifications, we DO need updateVersion()
        // (different from simple transformations)
        mesh.updateVersion();
      },
    });

    // Apply shader-based animation
    this.setupSplatModifier();

    this.scene.add(this.splatMesh);
  }

  createCloudSplats(splats, particleCount, color) {
    const center = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const playerPos = this.worldOrigin;

    // Establish wind-aligned basis
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
      // Generate consistent randomness per particle
      const seed = i * 0.12345;
      const random = {
        x: Math.abs((Math.sin(seed * 12.9898) * 43758.5453) % 1),
        y: Math.abs((Math.sin(seed * 78.233) * 43758.5453) % 1),
        z: Math.abs((Math.sin(seed * 37.719) * 43758.5453) % 1),
        w: Math.abs((Math.sin(seed * 93.989) * 43758.5453) % 1),
      };

      // Vary particle size
      const sizeVariation = THREE.MathUtils.lerp(
        this.options.particleSizeMin,
        this.options.particleSizeMax,
        random.w
      );
      const particleSize = this.options.particleSize * sizeVariation;
      const scales = new THREE.Vector3(
        particleSize,
        particleSize * 0.6,
        particleSize
      );

      // Use exponential distribution for height
      const heightBias = Math.pow(random.y, this.options.fogFalloff);

      // Spawn particles uniformly in wind-aligned rectangular box
      const u0 = (random.x - 0.5) * 2 * this.options.cloudSize;
      const v0 = (random.z - 0.5) * 2 * this.options.cloudSize;

      let x = playerPos.x + upX0 * u0 + perpX0 * v0;
      let y = THREE.MathUtils.lerp(
        this.options.groundLevel,
        this.options.groundLevel + this.options.fogHeight,
        heightBias
      );
      let z = playerPos.z + upZ0 * u0 + perpZ0 * v0;

      // Apply small initial vertical variation
      const fluffiness =
        Math.sin(random.w * Math.PI * 2) * this.options.fluffiness * 0.1;
      y += fluffiness;

      // Clamp Y
      y = Math.max(
        this.options.groundLevel,
        Math.min(this.options.groundLevel + this.options.fogHeight, y)
      );

      // Opacity falloff with height
      const heightFactor =
        (y - this.options.groundLevel) / this.options.fogHeight;
      const heightOpacity = Math.pow(heightFactor, 0.5);
      const opacityFactor = heightOpacity * (0.7 + 0.3 * random.w);
      const baseOpacity = Math.max(0.05, opacityFactor);
      const opacity = this.options.opacity * baseOpacity;

      // Encode particle index into color's blue channel (will extract in shader)
      // Normalize index to 0-1 range for encoding
      const indexEncoded = i / particleCount;
      const colorWithIndex = new THREE.Color(color.r, color.g, indexEncoded);

      center.set(x, y, z);
      splats.pushSplat(center, scales, quaternion, opacity, colorWithIndex);
    }
  }

  setupSplatModifier() {
    this.splatMesh.objectModifier = dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            t: "float",
            windSpeed: "float",
            opacity: "float",
            cloudSize: "float",
            fluffiness: "float",
            groundLevel: "float",
            fogHeight: "float",
            originX: "float",
            originY: "float",
            originZ: "float",
            particleCount: "float",
          },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
              // Hash function for deterministic per-particle randomness
              vec4 hash4(float seed) {
                vec4 p = vec4(
                  fract(sin(seed * 12.9898) * 43758.5453),
                  fract(sin(seed * 78.233) * 43758.5453),
                  fract(sin(seed * 37.719) * 43758.5453),
                  fract(sin(seed * 93.989) * 43758.5453)
                );
                return abs(p);
              }

              // Wrapping function for toroidal space
              float wrapCoord(float val, float minVal, float maxVal) {
                float range = maxVal - minVal;
                return mod(mod(val - minVal, range) + range, range) + minVal;
              }

              // 2D rotation matrix
              mat2 rot2D(float angle) {
                float s = sin(angle);
                float c = cos(angle);
                return mat2(c, -s, s, c);
              }
            `),
          ],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
            ${outputs.gsplat} = ${inputs.gsplat};
            
            // Extract particle index from blue channel (encoded during creation)
            float indexNormalized = ${inputs.gsplat}.rgba.b;
            float particleIndex = indexNormalized * ${inputs.particleCount};
            float seed = particleIndex * 0.12345;
            vec4 random = hash4(seed);
            
            // Restore original white color
            ${outputs.gsplat}.rgba.b = 1.0;
            
            // Store original opacity for height-based modulation
            float baseOpacity = ${inputs.gsplat}.rgba.a;
            
            // Get initial position (spawned randomly in volume)
            vec3 initialPos = ${inputs.gsplat}.center;
            vec3 origin = vec3(${inputs.originX}, ${inputs.originY}, ${inputs.originZ});
            vec3 localPos = initialPos - origin;
            
            // Per-particle motion parameters
            float lateralSpeed = mix(0.2, 0.8, random.x);
            float lateralFreq = mix(0.05, 0.2, random.y);
            float verticalAmp = mix(0.05, 0.35, random.z) * ${inputs.fluffiness} * 0.5;
            float verticalFreq = mix(0.05, 0.18, random.w);
            float phase = random.w * 6.28318; // 2*PI
            
            float time = ${inputs.t};
            
            // Apply wind drift
            vec3 windDirection = vec3(${inputs.windSpeed} * 0.3, 0.0, ${inputs.windSpeed} * 1.0);
            localPos += windDirection * time;
            
            // Add lateral oscillation
            float lateralOffset = lateralSpeed * sin(phase + time * lateralFreq);
            localPos.x += lateralOffset;
            
            // Add vertical oscillation
            float verticalOffset = verticalAmp * sin(phase + time * verticalFreq);
            localPos.y += verticalOffset;
            
            // Wrap position to keep particles in volume
            float cloudSize = ${inputs.cloudSize};
            localPos.x = wrapCoord(localPos.x, -cloudSize, cloudSize);
            localPos.z = wrapCoord(localPos.z, -cloudSize, cloudSize);
            
            // Clamp Y to fog layer
            localPos.y = clamp(
              localPos.y,
              ${inputs.groundLevel} - origin.y,
              ${inputs.groundLevel} + ${inputs.fogHeight} - origin.y
            );
            
            // Reconstruct world position
            ${outputs.gsplat}.center = origin + localPos;
            
            // Update opacity
            ${outputs.gsplat}.rgba.a = baseOpacity * ${inputs.opacity} / 0.035;
          `),
        });

        gsplat = d.apply({
          gsplat,
          t: this.dynoTime,
          windSpeed: this.dynoWindSpeed,
          opacity: this.dynoOpacity,
          cloudSize: this.dynoCloudSize,
          fluffiness: this.dynoFluffiness,
          groundLevel: this.dynoGroundLevel,
          fogHeight: this.dynoFogHeight,
          originX: this.dynoOriginX,
          originY: this.dynoOriginY,
          originZ: this.dynoOriginZ,
          particleCount: this.dynoParticleCount,
        }).gsplat;

        return { gsplat };
      }
    );

    this.splatMesh.updateGenerator();
  }

  handleTransitions(time) {
    if (!this.isTransitioning) return;

    const elapsed = time - this.transitionStartTime;
    const t = Math.min(elapsed / this.transitionDuration, 1.0);

    // Lerp runtime parameters
    if ("windSpeed" in this.transitionTargetValues) {
      this.options.windSpeed = THREE.MathUtils.lerp(
        this.transitionStartValues.windSpeed,
        this.transitionTargetValues.windSpeed,
        t
      );
      this.dynoWindSpeed.value = this.options.windSpeed;
    }

    if ("opacity" in this.transitionTargetValues) {
      this.options.opacity = THREE.MathUtils.lerp(
        this.transitionStartValues.opacity,
        this.transitionTargetValues.opacity,
        t
      );
      this.dynoOpacity.value = this.options.opacity;
    }

    // End transition
    if (t >= 1.0) {
      console.log("Fog transition complete (shader)");
      this.isTransitioning = false;
    }
  }

  update(deltaTime = 0.016) {
    // Not needed - onFrame callback handles everything
    // Transformations are auto-detected, no updateVersion() required
  }

  transitionTo(targetParams, duration) {
    console.log(
      "Starting fog transition (shader):",
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

  setColor(color) {
    this.options.color = color;
  }

  setOpacity(opacity) {
    this.options.opacity = opacity;
    this.dynoOpacity.value = opacity;
  }

  setSize(size) {
    this.options.particleSize = size;
  }

  recreateMesh() {
    console.log("Recreating fog mesh (shader) with:", {
      particleCount: this.options.particleCount,
      particleSize: this.options.particleSize,
    });

    // Remove old mesh
    if (this.splatMesh) {
      this.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
    }

    // Reinitialize
    const actualParticleCount = this.options.particleCount;
    this.splatCount = actualParticleCount;

    const color = new THREE.Color(this.options.color);

    this.splatMesh = new SplatMesh({
      maxSplats: actualParticleCount,
      constructSplats: (splats) => {
        this.createCloudSplats(splats, actualParticleCount, color);
      },
    });

    this.setupSplatModifier();
    this.scene.add(this.splatMesh);
  }

  dispose() {
    if (this.splatMesh) {
      this.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
    }
  }
}

// Factory function
export function createCloudParticlesShader(scene, options = {}) {
  return new CloudParticlesShader(scene, options);
}

// Export class as default
export default CloudParticlesShader;

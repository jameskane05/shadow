import * as THREE from "three";
import { SplatMesh, dyno } from "@sparkjsdev/spark";

/**
 * Cloud Particles System (Shader-based)
 * Creates a slow drifting fog animation using Gaussian splats with GPU-based animation
 * Uses the dyno shader system for high-performance particle updates
 */

class CloudParticlesShader {
  constructor(scene, camera = null) {
    this.scene = scene;
    this.camera = camera;
    this.spawnPosition = null;

    // Fog settings - edit these directly
    this.particleCount = 16000;
    this.cloudSize = 80;
    this.particleSize = 2;
    this.particleSizeMin = 0.75;
    this.particleSizeMax = 1.5;
    this.windSpeed = -0.5;
    this.opacity = 0.03;
    this.color = 0xffffff;
    this.fluffiness = 8;
    this.turbulence = 3;
    this.groundLevel = -1;
    this.fogHeight = 7.0;
    this.fogFalloff = 2;

    // Gust model (analytic, avoids reversal/jumps)
    this.gustAmplitude = 0.3; // speed variation amplitude
    this.gustPeriod = 12.0; // seconds per full cycle

    this.splatMesh = null;
    this.splatCount = 0;
    this.time = 0;
    this.worldOrigin = null;
    this._lastWindLogSecond = -1; // debug: throttle wind speed logs

    // Dyno uniforms for shader animation
    this.dynoTime = dyno.dynoFloat(0);
    this.dynoWindSpeed = dyno.dynoFloat(this.windSpeed);
    this.dynoGustAmplitude = dyno.dynoFloat(this.gustAmplitude);
    this.dynoGustPeriod = dyno.dynoFloat(this.gustPeriod);
    this.dynoOpacity = dyno.dynoFloat(this.opacity);
    this.dynoCloudSize = dyno.dynoFloat(this.cloudSize);
    this.dynoFluffiness = dyno.dynoFloat(this.fluffiness);
    this.dynoGroundLevel = dyno.dynoFloat(this.groundLevel);
    this.dynoFogHeight = dyno.dynoFloat(this.fogHeight);
    this.dynoOriginX = dyno.dynoFloat(0);
    this.dynoOriginY = dyno.dynoFloat(0);
    this.dynoOriginZ = dyno.dynoFloat(0);
    this.dynoParticleCount = dyno.dynoFloat(this.particleCount);
    this.dynoCameraX = dyno.dynoFloat(0);
    this.dynoCameraY = dyno.dynoFloat(0);
    this.dynoCameraZ = dyno.dynoFloat(0);

    // Transition state
    this.isTransitioning = false;
    this.transitionStartTime = 0;
    this.transitionDuration = 0;
    this.transitionStartValues = {};
    this.transitionTargetValues = {};

    // Wind variation state
    this.baseWindSpeed = this.windSpeed; // Store initial wind speed
    this.windVariationEnabled = false; // Can be enabled - set to true to enable automatic wind shifts
    this.windVariationMin = -1.0; // Minimum wind speed (more negative = stronger wind)
    this.windVariationMax = -0.3; // Maximum wind speed (less negative = weaker wind)
    this.windTransitionDurationMin = 8; // Min seconds for wind transition
    this.windTransitionDurationMax = 12; // Max seconds for wind transition
    this.windHoldTimeMin = 5; // Min seconds to hold wind speed before next change
    this.windHoldTimeMax = 15; // Max seconds to hold wind speed before next change
    this.nextWindChangeTime = 5; // When to trigger next wind change
    this.windTransitionStart = 0;
    this.windTransitionDuration = 10;
    this.windTransitionStartValue = this.windSpeed;
    this.windTransitionTargetValue = this.windSpeed;
    this.isTransitioningWind = false;

    // Opacity variation state (this works great because opacity doesn't accumulate over time!)
    this.baseOpacity = this.opacity; // Store initial opacity
    this.opacityVariationEnabled = false;
    this.opacityVariationMin = 0.95; // Min multiplier (e.g., 0.5 = 50% of base)
    this.opacityVariationMax = 1.05; // Max multiplier (e.g., 1.5 = 150% of base)
    this.opacityVariationHoldTimeMin = 5; // Min seconds to wait before next change
    this.opacityVariationHoldTimeMax = 15; // Max seconds to wait before next change
    this.nextOpacityChangeTime =
      this.opacityVariationHoldTimeMin +
      Math.random() *
        (this.opacityVariationHoldTimeMax - this.opacityVariationHoldTimeMin);
    this.opacityTransitionStart = 0;
    this.opacityTransitionDuration = 6; // How long to transition in seconds
    this.opacityTransitionStartValue = this.opacity;
    this.opacityTransitionTargetValue = this.opacity;
    this.isTransitioningOpacity = false;

    this.init();
  }

  init() {
    console.log(
      "⚡ Initializing GPU shader-based fog system (cloudParticlesShader.js)"
    );
    this.splatCount = this.particleCount;

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

    const color = new THREE.Color(this.color);

    // Create SplatMesh with onFrame callback - transformations auto-detected, no updateVersion needed
    this.splatMesh = new SplatMesh({
      maxSplats: this.particleCount,
      constructSplats: (splats) => {
        this.createCloudSplats(splats, this.particleCount, color);
      },
      onFrame: ({ mesh, time, deltaTime }) => {
        // Update time uniform
        this.time = time;
        this.dynoTime.value = time;

        // Update camera position for near-camera culling
        if (this.camera) {
          this.dynoCameraX.value = this.camera.position.x;
          this.dynoCameraY.value = this.camera.position.y;
          this.dynoCameraZ.value = this.camera.position.z;
        }

        // Handle transitions
        this.handleTransitions(time);

        // Handle wind variation
        this.handleWindVariation(time);

        // Handle opacity variation
        this.handleOpacityVariation(time);

        // Debug: log effective wind speed once per second
        const logSec = Math.floor(time);
        if (logSec !== this._lastWindLogSecond) {
          this._lastWindLogSecond = logSec;
          const omega = (Math.PI * 2) / Math.max(this.gustPeriod, 0.1);
          const effectiveWind =
            this.windSpeed + this.gustAmplitude * Math.sin(omega * time);
          console.log(
            `🌬️ wind(t=${logSec}s): base=${this.windSpeed.toFixed(
              2
            )}, gustAmp=${this.gustAmplitude.toFixed(
              2
            )}, period=${this.gustPeriod.toFixed(
              1
            )}s, effective=${effectiveWind.toFixed(2)}`
          );
        }

        // For objectModifier with position changes, we need updateVersion()
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
    let baseWX = this.windSpeed * 0.3;
    let baseWZ = this.windSpeed * 1.0;
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
        this.particleSizeMin,
        this.particleSizeMax,
        random.w
      );
      const particleSize = this.particleSize * sizeVariation;
      const scales = new THREE.Vector3(
        particleSize,
        particleSize * 0.6,
        particleSize
      );

      // Use exponential distribution for height
      const heightBias = Math.pow(random.y, this.fogFalloff);

      // Spawn particles uniformly in wind-aligned rectangular box
      const u0 = (random.x - 0.5) * 2 * this.cloudSize;
      const v0 = (random.z - 0.5) * 2 * this.cloudSize;

      let x = playerPos.x + upX0 * u0 + perpX0 * v0;
      let y = THREE.MathUtils.lerp(
        this.groundLevel,
        this.groundLevel + this.fogHeight,
        heightBias
      );
      let z = playerPos.z + upZ0 * u0 + perpZ0 * v0;

      // Apply small initial vertical variation
      const fluffiness =
        Math.sin(random.w * Math.PI * 2) * this.fluffiness * 0.1;
      y += fluffiness;

      // Clamp Y
      y = Math.max(
        this.groundLevel,
        Math.min(this.groundLevel + this.fogHeight, y)
      );

      // Opacity falloff with height
      const heightFactor = (y - this.groundLevel) / this.fogHeight;
      const heightOpacity = Math.pow(heightFactor, 0.5);
      const opacityFactor = heightOpacity * (0.7 + 0.3 * random.w);
      const baseOpacity = Math.max(0.05, opacityFactor);
      const opacity = this.opacity * baseOpacity;

      center.set(x, y, z);
      splats.pushSplat(center, scales, quaternion, opacity, color);
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
            gustAmplitude: "float",
            gustPeriod: "float",
            opacity: "float",
            cloudSize: "float",
            fluffiness: "float",
            groundLevel: "float",
            fogHeight: "float",
            originX: "float",
            originY: "float",
            originZ: "float",
            particleCount: "float",
            cameraX: "float",
            cameraY: "float",
            cameraZ: "float",
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
            
            // Get initial position and generate per-particle seed (deterministic)
            vec3 initialPos = ${inputs.gsplat}.center;
            float seed = dot(initialPos, vec3(12.9898, 78.233, 37.719));
            vec4 random = hash4(seed);
            
            // Store original opacity for height-based modulation
            float baseOpacity = ${inputs.gsplat}.rgba.a;
            
            // Calculate local position relative to origin
            vec3 origin = vec3(${inputs.originX}, ${inputs.originY}, ${inputs.originZ});
            vec3 localPos = initialPos - origin;
            
            // Per-particle motion parameters
            float lateralSpeed = mix(0.2, 0.8, random.x);
            float lateralFreq = mix(0.05, 0.2, random.y);
            float verticalAmp = mix(0.05, 0.35, random.z) * ${inputs.fluffiness} * 0.5;
            float verticalFreq = mix(0.05, 0.18, random.w);
            float phase = random.w * 6.28318; // 2*PI
            
            float time = ${inputs.t};

            // Analytic gust model: speed(t) = base + A*sin(omega*t)
            // Distance(t) = base*t - (A/omega)*cos(omega*t) + (A/omega)
            // We subtract cos term so distance starts at 0 when t=0
            float baseSpeed = ${inputs.windSpeed};
            float A = ${inputs.gustAmplitude};
            float period = max(${inputs.gustPeriod}, 0.1);
            float omega = 6.2831853 / period; // 2*PI / T
            float dist = baseSpeed * time - (A / omega) * cos(omega * time) + (A / omega);

            // Wrap distance to keep particles bounded
            float wrapLen = ${inputs.cloudSize} * 2.0; // along wind axis
            dist = mod(dist + wrapLen, 2.0 * wrapLen) - wrapLen;

            // Apply wind axis (x,z)
            vec3 windDir = normalize(vec3(0.3, 0.0, 1.0));
            localPos += windDir * dist;
            
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
            vec3 worldPos = origin + localPos;
            ${outputs.gsplat}.center = worldPos;
            
            // Calculate distance from camera for near-camera culling
            vec3 cameraPos = vec3(${inputs.cameraX}, ${inputs.cameraY}, ${inputs.cameraZ});
            float distToCamera = length(worldPos - cameraPos);
            
            // Fade out particles near camera (0 opacity within 2 units, full opacity beyond 4 units)
            float nearCameraFade = smoothstep(3.0, 5.0, distToCamera);
            
            // Update opacity with near-camera fade
            ${outputs.gsplat}.rgba.a = baseOpacity * ${inputs.opacity} / 0.035 * nearCameraFade;
          `),
        });

        gsplat = d.apply({
          gsplat,
          t: this.dynoTime,
          windSpeed: this.dynoWindSpeed,
          gustAmplitude: this.dynoGustAmplitude,
          gustPeriod: this.dynoGustPeriod,
          opacity: this.dynoOpacity,
          cloudSize: this.dynoCloudSize,
          fluffiness: this.dynoFluffiness,
          groundLevel: this.dynoGroundLevel,
          fogHeight: this.dynoFogHeight,
          originX: this.dynoOriginX,
          originY: this.dynoOriginY,
          originZ: this.dynoOriginZ,
          particleCount: this.dynoParticleCount,
          cameraX: this.dynoCameraX,
          cameraY: this.dynoCameraY,
          cameraZ: this.dynoCameraZ,
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

    // Lerp runtime parameters (but skip windSpeed - handled by handleWindVariation)
    if ("windSpeed" in this.transitionTargetValues) {
      this.windSpeed = THREE.MathUtils.lerp(
        this.transitionStartValues.windSpeed,
        this.transitionTargetValues.windSpeed,
        t
      );
      this.dynoWindSpeed.value = this.windSpeed;
      // Update base wind speed for manual transitions
      if (t >= 1.0) {
        this.baseWindSpeed = this.windSpeed;
      }
    }

    if ("opacity" in this.transitionTargetValues) {
      this.opacity = THREE.MathUtils.lerp(
        this.transitionStartValues.opacity,
        this.transitionTargetValues.opacity,
        t
      );
      this.dynoOpacity.value = this.opacity;
    }

    // End transition
    if (t >= 1.0) {
      console.log("Fog transition complete (shader)");
      this.isTransitioning = false;
    }
  }

  handleOpacityVariation(time) {
    if (!this.opacityVariationEnabled) return;

    // Check if we need to start a new opacity change
    if (
      !this.isTransitioningOpacity &&
      !this.isTransitioning &&
      time >= this.nextOpacityChangeTime
    ) {
      // Pick a new target opacity based on configured multipliers
      const minOpacity = Math.max(
        0.1,
        this.baseOpacity * this.opacityVariationMin
      );
      const maxOpacity = this.baseOpacity * this.opacityVariationMax;
      this.opacityTransitionTargetValue =
        minOpacity + Math.random() * (maxOpacity - minOpacity);

      console.log(
        `💨 Fog opacity change: ${this.opacity.toFixed(
          2
        )} → ${this.opacityTransitionTargetValue.toFixed(
          2
        )} over ${this.opacityTransitionDuration.toFixed(
          1
        )}s (base: ${this.baseOpacity.toFixed(2)})`
      );
      this.opacityTransitionStart = time;
      this.opacityTransitionStartValue = this.opacity;
      this.isTransitioningOpacity = true;
    }

    // Lerp opacity towards target if transitioning
    if (this.isTransitioningOpacity) {
      const elapsed = time - this.opacityTransitionStart;
      const t = Math.min(elapsed / this.opacityTransitionDuration, 1.0);

      this.opacity = THREE.MathUtils.lerp(
        this.opacityTransitionStartValue,
        this.opacityTransitionTargetValue,
        t
      );
      this.dynoOpacity.value = this.opacity;

      // Check if transition is complete
      if (t >= 1.0) {
        this.isTransitioningOpacity = false;
        console.log(
          `  Fog opacity transition complete at ${this.opacity.toFixed(2)}`
        );
        // Schedule next opacity change
        const holdTime =
          this.opacityVariationHoldTimeMin +
          Math.random() *
            (this.opacityVariationHoldTimeMax -
              this.opacityVariationHoldTimeMin);
        this.nextOpacityChangeTime = time + holdTime;
        console.log(`  Next opacity change in ${holdTime.toFixed(1)}s`);
      }
    }
  }

  handleWindVariation(time) {
    if (!this.windVariationEnabled) return;

    // Check if we need to start a new wind change (only when not currently transitioning or manually transitioning)
    if (
      !this.isTransitioningWind &&
      !this.isTransitioning &&
      time >= this.nextWindChangeTime
    ) {
      // Pick a new target wind speed within configured min/max range
      const minSpeed = this.windVariationMin; // More negative (stronger wind)
      const maxSpeed = this.windVariationMax; // Less negative (weaker wind)
      const targetSpeed = minSpeed + Math.random() * (maxSpeed - minSpeed);

      this.windTransitionTargetValue = targetSpeed;

      // Pick a random transition duration
      this.windTransitionDuration =
        this.windTransitionDurationMin +
        Math.random() *
          (this.windTransitionDurationMax - this.windTransitionDurationMin);

      console.log(
        `🌬️ Wind change: ${this.windSpeed.toFixed(
          2
        )} → ${this.windTransitionTargetValue.toFixed(
          2
        )} over ${this.windTransitionDuration.toFixed(
          1
        )}s (range: ${minSpeed.toFixed(2)} to ${maxSpeed.toFixed(2)})`
      );
      this.windTransitionStart = time;
      this.windTransitionStartValue = this.windSpeed;
      this.isTransitioningWind = true;
    }

    // Lerp wind speed towards target if transitioning
    if (this.isTransitioningWind) {
      const elapsed = time - this.windTransitionStart;
      const t = Math.min(elapsed / this.windTransitionDuration, 1.0);

      this.windSpeed = THREE.MathUtils.lerp(
        this.windTransitionStartValue,
        this.windTransitionTargetValue,
        t
      );
      this.dynoWindSpeed.value = this.windSpeed;

      // Debug: log transition progress every second
      if (Math.floor(elapsed) !== Math.floor(elapsed - 0.016)) {
        console.log(
          `  Wind lerp progress: t=${t.toFixed(
            2
          )}, speed=${this.windSpeed.toFixed(2)}`
        );
      }

      // Check if transition is complete
      if (t >= 1.0) {
        this.isTransitioningWind = false;
        console.log(
          `  Wind transition complete at ${this.windSpeed.toFixed(2)}`
        );
        // Schedule next wind change using configured hold time range
        const holdTime =
          this.windHoldTimeMin +
          Math.random() * (this.windHoldTimeMax - this.windHoldTimeMin);
        this.nextWindChangeTime = time + holdTime;
        console.log(`  Next wind change in ${holdTime.toFixed(1)}s`);
      }
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
        this.transitionStartValues[param] = this[param];
        this.transitionTargetValues[param] = targetParams[param];
        console.log(`  ${param}: ${this[param]} → ${targetParams[param]}`);
      }
    });
  }

  setColor(color) {
    this.color = color;
  }

  setOpacity(opacity) {
    this.opacity = opacity;
    this.dynoOpacity.value = opacity;
  }

  setSize(size) {
    this.particleSize = size;
  }

  dispose() {
    if (this.splatMesh) {
      this.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
    }
  }
}

// Factory function
export function createCloudParticlesShader(scene, camera = null) {
  return new CloudParticlesShader(scene, camera);
}

// Export class as default
export default CloudParticlesShader;

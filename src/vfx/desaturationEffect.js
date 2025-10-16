import * as THREE from "three";

/**
 * DesaturationEffect - Post-processing shader for animating color to grayscale
 *
 * Usage:
 *   const desat = new DesaturationEffect(renderer);
 *   desat.enable(); // Enable for color scenes
 *   desat.animateToGrayscale(); // Animate to B&W
 *   desat.render(scene, camera); // Call instead of renderer.render()
 */
export class DesaturationEffect {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = false;
    this.progress = 0; // 0 = color, 1 = grayscale
    this.animating = false;
    this.animationTarget = 0;
    this.animationDuration = 5.0; // Single duration value for all transitions
    this.animationSpeed = 0;
    this.currentState = 0; // Track current state: 0 = color, 1 = grayscale

    // Transition properties
    this.transitionMode = "bleed"; // 'fade', 'wipe', 'bleed'
    this.wipeDirection = "vertical"; // For wipe mode: 'horizontal' = vertical line moving L/R, 'vertical' = horizontal line moving up/down
    this.wipeSoftness = 0.002; // Very sharp line for hard wipe
    this.bleedScale = 3; // Scale of noise pattern
    this.bleedSoftness = 0.2; // Softness of bleed edges

    // Create desaturation shader
    this.shader = {
      uniforms: {
        tDiffuse: { value: null },
        desatAmount: { value: 0.0 },
        animProgress: { value: 0.0 },
        transitionMode: { value: 2.0 }, // 0=fade, 1=wipe, 2=bleed
        wipePosition: { value: 0.0 },
        wipeDirection: { value: 0.0 },
        wipeSoftness: { value: this.wipeSoftness },
        // Wipe control
        goingToGray: { value: 0.0 }, // 1 when transitioning to grayscale
        wipeFromTop: { value: 1.0 }, // 1 = top->bottom, 0 = bottom->top
        bleedScale: { value: this.bleedScale },
        bleedSoftness: { value: this.bleedSoftness },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float desatAmount;
        uniform float animProgress;
        uniform float transitionMode;
        uniform float wipePosition;
        uniform float wipeDirection;
        uniform float wipeSoftness;
        uniform float goingToGray;
        uniform float wipeFromTop;
        uniform float bleedScale;
        uniform float bleedSoftness;
        varying vec2 vUv;
        
        // Constants
        const vec3 LUMA_WEIGHTS = vec3(0.299, 0.587, 0.114);
        const int NOISE_OCTAVES = 4;
        const float NOISE_INITIAL_AMPLITUDE = 0.5;
        const float NOISE_FREQUENCY_MULT = 2.0;
        const float NOISE_AMPLITUDE_MULT = 0.5;
        
        // Simple 2D noise function
        float noise(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
        }
        
        // Smooth noise (interpolated)
        float smoothNoise(vec2 st) {
          vec2 i = floor(st);
          vec2 f = fract(st);
          
          // Four corners
          float a = noise(i);
          float b = noise(i + vec2(1.0, 0.0));
          float c = noise(i + vec2(0.0, 1.0));
          float d = noise(i + vec2(1.0, 1.0));
          
          // Smooth Hermite interpolation
          vec2 u = f * f * (3.0 - 2.0 * f);
          
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }
        
        // Fractal noise (multiple octaves)
        float fractalNoise(vec2 st) {
          float value = 0.0;
          float amplitude = NOISE_INITIAL_AMPLITUDE;
          float frequency = 1.0;
          
          for(int i = 0; i < NOISE_OCTAVES; i++) {
            value += amplitude * smoothNoise(st * frequency);
            frequency *= NOISE_FREQUENCY_MULT;
            amplitude *= NOISE_AMPLITUDE_MULT;
          }
          
          return value;
        }
        
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          
          // Calculate luminance (proper grayscale conversion)
          float gray = dot(color.rgb, LUMA_WEIGHTS);
          
          float desatAmountFinal = desatAmount;
          
          // Mode 1: Wipe transition (disabled by default, use mode: 'wipe')
          if (transitionMode > 0.5 && transitionMode < 1.5) {
            float coord = mix(vUv.x, vUv.y, wipeDirection);
            // Compute line position based on desired entry side
            float thresholdTop = 1.0 - wipePosition;
            float thresholdBottom = wipePosition;
            float threshold = mix(thresholdBottom, thresholdTop, wipeFromTop);

            // Edge mask: smooth transition across wipe line
            float wipeEdge = smoothstep(
              threshold - wipeSoftness,
              threshold + wipeSoftness,
              coord
            );

            // Mix between current state and target state
            float targetState = 1.0 - desatAmount;
            desatAmountFinal = mix(desatAmount, targetState, wipeEdge);
          }
          // Mode 2: Bleed transition (noise-based) - default
          else if (transitionMode > 1.5 || transitionMode < 0.5) {
            // Generate noise pattern [0, 1]
            float noiseValue = fractalNoise(vUv * bleedScale);
            
            // Map noise to threshold range that uses full progress [0, 1]
            // Early pixels (noise=0) transition at start, late pixels (noise=1) at end
            float edgeMargin = bleedSoftness * 0.5;
            float pixelThreshold = edgeMargin + noiseValue * (1.0 - bleedSoftness);
            
            // Smooth transition around each pixel's threshold
            float bleedMask = smoothstep(
              pixelThreshold - edgeMargin,
              pixelThreshold + edgeMargin,
              animProgress
            );
            
            desatAmountFinal = bleedMask;
          }
          
          // Lerp between color and grayscale
          vec3 result = mix(color.rgb, vec3(gray), desatAmountFinal);
          
          gl_FragColor = vec4(result, color.a);
        }
      `,
    };

    // Create render target for post-processing
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    // Create post-processing scene and camera
    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postMaterial = new THREE.ShaderMaterial(this.shader);
    this.postQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.postMaterial
    );
    this.postScene.add(this.postQuad);
  }

  /**
   * Enable/disable the desaturation effect
   * @param {boolean} enabled
   */
  enable(enabled = true) {
    this.enabled = enabled;
  }

  /**
   * Disable the desaturation effect
   */
  disable() {
    this.enabled = false;
  }

  /**
   * Set desaturation amount instantly (no animation)
   * @param {number} amount - 0 = color, 1 = grayscale
   */
  setAmount(amount) {
    this.progress = THREE.MathUtils.clamp(amount, 0, 1);
    this.currentState = this.progress;
    this.animating = false;
  }

  /**
   * Animate to a target desaturation amount
   * @param {number} targetAmount - 0 = color, 1 = grayscale
   * @param {Object} options - Transition settings:
   *   - mode: 'fade' | 'wipe' | 'bleed' (default: 'bleed')
   *   - direction: 'horizontal' | 'vertical' (for wipe mode, default: 'vertical')
   *     'horizontal' = vertical line moving left/right
   *     'vertical' = horizontal line moving top/bottom
   */
  animateTo(targetAmount, options = {}) {
    if (!this.enabled) {
      console.warn(
        "DesaturationEffect: Effect is disabled. Call enable() first."
      );
      return;
    }

    this.animationTarget = THREE.MathUtils.clamp(targetAmount, 0, 1);
    this.animationSpeed = 1.0 / this.animationDuration;
    this.animating = true;

    // Configure transition mode (default to noise-based bleed)
    const mode = options.mode || "bleed";
    this.transitionMode = mode;

    if (mode === "wipe") {
      const direction = options.direction || this.wipeDirection;
      this.postMaterial.uniforms.transitionMode.value = 1.0;
      this.postMaterial.uniforms.wipeDirection.value =
        direction === "vertical" ? 1.0 : 0.0;
      this.postMaterial.uniforms.wipeSoftness.value = this.wipeSoftness;

      // Configure wipe entry side per requested behavior:
      // - Color -> Grayscale: wipe from bottom to top
      // - Grayscale -> Color: wipe from top to bottom
      const goingToGray = this.animationTarget > this.currentState ? 1.0 : 0.0;
      this.postMaterial.uniforms.goingToGray.value = goingToGray;
      this.postMaterial.uniforms.wipeFromTop.value =
        goingToGray < 0.5 ? 1.0 : 0.0;
    } else if (mode === "bleed") {
      this.postMaterial.uniforms.transitionMode.value = 2.0;
      this.postMaterial.uniforms.bleedScale.value = this.bleedScale;
      this.postMaterial.uniforms.bleedSoftness.value = this.bleedSoftness;
    } else {
      // Fade mode (default)
      this.postMaterial.uniforms.transitionMode.value = 0.0;
    }
  }

  /**
   * Animate to grayscale
   * @param {Object} options - Transition settings (see animateTo)
   */
  animateToGrayscale(options = {}) {
    this.animateTo(1.0, options);
  }

  /**
   * Animate to color
   * @param {Object} options - Transition settings (see animateTo)
   */
  animateToColor(options = {}) {
    this.animateTo(0.0, options);
  }

  /**
   * Toggle between color and grayscale
   * @param {Object} options - Transition settings (see animateTo)
   */
  toggle(options = {}) {
    const target = this.currentState < 0.5 ? 1.0 : 0.0;
    this.animateTo(target, options);
  }

  /**
   * Update animation (call each frame)
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    if (!this.animating) return;

    // Move toward target
    const distance = this.animationTarget - this.progress;
    const step = Math.sign(distance) * this.animationSpeed * deltaTime;

    if (Math.abs(distance) <= Math.abs(step)) {
      // Reached target
      this.progress = this.animationTarget;
      this.animating = false;

      // Update current state when animation completes
      this.currentState = this.animationTarget;
    } else {
      // Continue animating
      this.progress += step;

      // For non-wipe modes, update currentState with progress
      if (this.transitionMode !== "wipe") {
        this.currentState = this.progress;
      }
    }

    // Update shader uniform for wipe mode (noop for non-wipe)
    if (this.transitionMode === "wipe") {
      const goingToGray = this.animationTarget > this.currentState;
      const wipePos = goingToGray ? this.progress : 1.0 - this.progress;
      this.postMaterial.uniforms.wipePosition.value = wipePos;
      this.postMaterial.uniforms.goingToGray.value = goingToGray ? 1.0 : 0.0;
      this.postMaterial.uniforms.wipeFromTop.value = goingToGray ? 0.0 : 1.0;
    }
  }

  /**
   * Resize the render target (call when window resizes)
   * @param {number} width
   * @param {number} height
   */
  setSize(width, height) {
    this.renderTarget.setSize(width, height);
  }

  /**
   * Render the scene with desaturation effect
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  render(scene, camera) {
    // Render through post-processing when:
    // - Currently in desaturated state (currentState > 0)
    // - Or currently animating
    // - Or progress > 0 (for fade/bleed modes)
    const shouldRender =
      this.enabled &&
      (this.currentState > 0 || this.animating || this.progress > 0);

    if (shouldRender) {
      // Render scene to texture
      this.renderer.setRenderTarget(this.renderTarget);
      this.renderer.render(scene, camera);

      // Apply desaturation shader
      this.postMaterial.uniforms.tDiffuse.value = this.renderTarget.texture;

      // Pass animation progress to drive transitions
      this.postMaterial.uniforms.desatAmount.value = this.currentState;
      this.postMaterial.uniforms.animProgress.value = this.progress;

      // Render to screen
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.postScene, this.postCamera);
    } else {
      // No desaturation, render normally
      this.renderer.render(scene, camera);
    }
  }

  /**
   * Dispose of resources
   */
  dispose() {
    this.renderTarget.dispose();
    this.postMaterial.dispose();
  }
}

export default DesaturationEffect;

import * as THREE from "three";
import { Howl, Howler } from "howler";

/**
 * AudioReactiveLight - Makes a THREE.js light react to audio analysis
 *
 * Uses Web Audio API to analyze a Howl sound's frequency/amplitude
 * and adjusts a light's intensity in real-time.
 *
 * Usage:
 * const light = new THREE.PointLight(0xff0000, 1.0);
 * const howl = new Howl({ src: ['sound.mp3'] });
 * const reactiveLight = new AudioReactiveLight(light, howl, {
 *   baseIntensity: 1.0,
 *   reactivityMultiplier: 3.0
 * });
 *
 * // In animation loop
 * reactiveLight.update();
 */

class AudioReactiveLight {
  constructor(light, howl, options = {}) {
    this.light = light;
    this.howl = howl;

    // Configuration
    this.baseIntensity = options.baseIntensity ?? light.intensity;
    this.reactivityMultiplier = options.reactivityMultiplier ?? 2.0;
    this.smoothing = options.smoothing ?? 0.8; // 0-1, higher = smoother
    this.minIntensity = options.minIntensity ?? 0;
    this.maxIntensity = options.maxIntensity ?? 10.0;
    this.frequencyRange = options.frequencyRange ?? "full"; // 'bass', 'mid', 'high', 'full'
    this.noiseFloor = options.noiseFloor ?? 0.0; // 0-1, audio below this is ignored
    this.enabled = options.enabled ?? true;

    // Web Audio API setup
    this.analyser = null;
    this.dataArray = null;
    this.audioContext = null;
    this.connected = false;

    // Smoothed volume value
    this.smoothedVolume = 0;

    // Initialize if howl is already loaded
    if (howl.state() === "loaded") {
      this.setupAnalyser();
    } else {
      // Wait for load
      howl.once("load", () => {
        this.setupAnalyser();
      });
    }
  }

  /**
   * Set up Web Audio API analyser for the Howl instance
   */
  setupAnalyser() {
    try {
      // Get Howler's audio context
      this.audioContext = Howler.ctx;

      if (!this.audioContext) {
        console.warn("AudioReactiveLight: No audio context available");
        return;
      }

      // Create analyser node
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256; // Power of 2, determines frequency resolution
      this.analyser.smoothingTimeConstant = 0.8;

      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);

      // Connect the Howl's audio node to the analyser
      // Howler uses a single master gain node
      const soundId = this.howl._sounds[0]?._id;
      if (soundId !== undefined) {
        const sound = this.howl._soundById(soundId);
        if (sound && sound._node) {
          // Connect sound node -> analyser -> destination
          sound._node.disconnect();
          sound._node.connect(this.analyser);
          this.analyser.connect(Howler.masterGain);
          this.connected = true;
          console.log("AudioReactiveLight: Connected to audio stream");
        }
      }
    } catch (error) {
      console.error("AudioReactiveLight: Error setting up analyser:", error);
    }
  }

  /**
   * Get frequency range indices based on configuration
   * @returns {Object} { start, end } indices for dataArray
   */
  getFrequencyRange() {
    const length = this.dataArray.length;

    switch (this.frequencyRange) {
      case "bass":
        return { start: 0, end: Math.floor(length * 0.1) }; // Low frequencies
      case "mid":
        return {
          start: Math.floor(length * 0.1),
          end: Math.floor(length * 0.5),
        };
      case "high":
        return { start: Math.floor(length * 0.5), end: length }; // High frequencies
      case "full":
      default:
        return { start: 0, end: length };
    }
  }

  /**
   * Calculate average volume from frequency data
   * @returns {number} Normalized volume (0-1)
   */
  getAverageVolume() {
    if (!this.analyser || !this.dataArray) {
      return 0;
    }

    // Get frequency data
    this.analyser.getByteFrequencyData(this.dataArray);

    // Calculate average for specified frequency range
    const range = this.getFrequencyRange();
    let sum = 0;
    let count = 0;

    for (let i = range.start; i < range.end; i++) {
      sum += this.dataArray[i];
      count++;
    }

    // Normalize to 0-1 (dataArray values are 0-255)
    const normalizedVolume = count > 0 ? sum / count / 255 : 0;

    // Apply noise floor - treat anything below threshold as 0
    if (normalizedVolume < this.noiseFloor) {
      return 0;
    }

    // Remap volume above noise floor to 0-1 range
    const remappedVolume =
      (normalizedVolume - this.noiseFloor) / (1.0 - this.noiseFloor);
    return Math.max(0, Math.min(1, remappedVolume));
  }

  /**
   * Update light intensity based on audio analysis
   */
  update() {
    if (!this.enabled || !this.connected) {
      return;
    }

    // Check if sound is actually playing
    if (!this.howl.playing()) {
      // Smoothly return to base intensity when not playing
      this.smoothedVolume = THREE.MathUtils.lerp(
        this.smoothedVolume,
        0,
        1 - this.smoothing
      );
    } else {
      // Get current audio volume
      const currentVolume = this.getAverageVolume();

      // Apply smoothing
      this.smoothedVolume = THREE.MathUtils.lerp(
        this.smoothedVolume,
        currentVolume,
        1 - this.smoothing
      );
    }

    // Calculate target intensity
    const reactiveIntensity =
      this.baseIntensity + this.smoothedVolume * this.reactivityMultiplier;

    // Clamp to min/max
    const clampedIntensity = THREE.MathUtils.clamp(
      reactiveIntensity,
      this.minIntensity,
      this.maxIntensity
    );

    // Apply to light
    this.light.intensity = clampedIntensity;
  }

  /**
   * Enable audio reactivity
   */
  enable() {
    this.enabled = true;
  }

  /**
   * Disable audio reactivity (light returns to base intensity)
   */
  disable() {
    this.enabled = false;
    this.light.intensity = this.baseIntensity;
  }

  /**
   * Set base intensity (intensity when no audio is playing)
   * @param {number} intensity
   */
  setBaseIntensity(intensity) {
    this.baseIntensity = intensity;
  }

  /**
   * Set reactivity multiplier (how much audio affects intensity)
   * @param {number} multiplier
   */
  setReactivityMultiplier(multiplier) {
    this.reactivityMultiplier = multiplier;
  }

  /**
   * Reconnect to audio source (call if sound restarts)
   */
  reconnect() {
    this.connected = false;
    this.setupAnalyser();
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.analyser && this.connected) {
      try {
        this.analyser.disconnect();
      } catch (e) {
        // Already disconnected
      }
    }
    this.analyser = null;
    this.dataArray = null;
    this.connected = false;
  }
}

export default AudioReactiveLight;

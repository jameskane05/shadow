/**
 * BreathingSystem - Generates procedural breathing sounds using Web Audio API
 *
 * Features:
 * - Procedurally generated breathing sounds
 * - Syncs with character movement state
 * - Adjustable breathing rate and intensity
 * - Uses noise and filters to create realistic breath sounds
 */

class BreathingSystem {
  constructor(audioContext, options = {}) {
    this.audioContext = audioContext;
    this.isActive = false;
    this.breathingTime = 0;

    // Breathing parameters
    this.idleBreathRate = options.idleBreathRate || 0.25; // Breaths per second (15 per minute)
    this.activeBreathRate = options.activeBreathRate || 0.5; // Faster when moving (30 per minute)
    this.volume = options.volume || 0.15;

    // Audio nodes
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.audioContext.destination);

    // Noise buffer for breath texture
    this.noiseBuffer = this.createNoiseBuffer();

    // Current breath state
    this.currentBreathSource = null;
    this.breathPhase = 0; // 0-1, where breath occurs around 0
  }

  /**
   * Create pink noise buffer for breath texture
   */
  createNoiseBuffer() {
    const bufferSize = this.audioContext.sampleRate * 2; // 2 seconds of noise
    const buffer = this.audioContext.createBuffer(
      1,
      bufferSize,
      this.audioContext.sampleRate
    );
    const output = buffer.getChannelData(0);

    // Generate pink noise (more natural than white noise)
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      output[i] *= 0.11; // Scale down
      b6 = white * 0.115926;
    }

    return buffer;
  }

  /**
   * Trigger a single breath sound
   */
  triggerBreath(intensity = 1.0) {
    // Clean up previous breath
    if (this.currentBreathSource) {
      this.currentBreathSource.stop();
    }

    const now = this.audioContext.currentTime;
    const breathDuration = 1.2; // Longer breath duration for deeper breaths

    // Create noise source
    const noiseSource = this.audioContext.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;
    noiseSource.loop = false;

    // Band-pass filter for breath character (300-3000 Hz)
    const filter = this.audioContext.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 800;
    filter.Q.value = 1.5;

    // Low-pass filter for softness
    const lpFilter = this.audioContext.createBiquadFilter();
    lpFilter.type = "lowpass";
    lpFilter.frequency.value = 2000;
    lpFilter.Q.value = 1.0;

    // Envelope for breath shape
    const breathGain = this.audioContext.createGain();
    breathGain.gain.value = 0;

    // Breath envelope: quick attack, slow release (inhale/exhale)
    breathGain.gain.setValueAtTime(0, now);
    breathGain.gain.linearRampToValueAtTime(
      this.volume * intensity * 0.3,
      now + 0.1
    ); // Inhale
    breathGain.gain.linearRampToValueAtTime(
      this.volume * intensity * 0.5,
      now + 0.3
    ); // Peak
    breathGain.gain.exponentialRampToValueAtTime(0.001, now + breathDuration); // Exhale

    // Connect the chain
    noiseSource.connect(filter);
    filter.connect(lpFilter);
    lpFilter.connect(breathGain);
    breathGain.connect(this.masterGain);

    // Start and schedule stop
    noiseSource.start(now);
    noiseSource.stop(now + breathDuration);

    this.currentBreathSource = noiseSource;
  }

  /**
   * Start breathing system
   */
  start() {
    if (this.isActive) return;
    this.isActive = true;
    this.masterGain.gain.setValueAtTime(1.0, this.audioContext.currentTime);
  }

  /**
   * Stop breathing system
   */
  stop() {
    if (!this.isActive) return;
    this.isActive = false;
    this.masterGain.gain.setValueAtTime(0, this.audioContext.currentTime);

    if (this.currentBreathSource) {
      this.currentBreathSource.stop();
      this.currentBreathSource = null;
    }
  }

  /**
   * Update breathing based on character state
   * @param {number} dt - Delta time in seconds
   * @param {boolean} isMoving - Whether character is moving
   * @param {number} intensity - Movement intensity (0-1)
   */
  update(dt, isMoving = false, intensity = 0) {
    if (!this.isActive) return;

    // Determine breath rate based on movement
    const breathRate = isMoving ? this.activeBreathRate : this.idleBreathRate;

    // Update breath phase
    const previousPhase = this.breathPhase;
    this.breathPhase = (this.breathPhase + dt * breathRate) % 1.0;

    // Trigger breath when phase crosses 0 (once per cycle)
    if (previousPhase > this.breathPhase) {
      // Breathing intensity based on movement
      const breathIntensity = isMoving ? 0.5 + intensity * 0.5 : 1.2; // Louder idle breathing
      this.triggerBreath(breathIntensity);
    }
  }

  /**
   * Set breathing volume
   * @param {number} volume - Volume (0-1)
   */
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Set idle breathing rate
   * @param {number} rate - Breaths per second
   */
  setIdleBreathRate(rate) {
    this.idleBreathRate = rate;
  }

  /**
   * Set active breathing rate
   * @param {number} rate - Breaths per second
   */
  setActiveBreathRate(rate) {
    this.activeBreathRate = rate;
  }

  /**
   * Clean up
   */
  destroy() {
    this.stop();
    this.masterGain.disconnect();
  }
}

export default BreathingSystem;

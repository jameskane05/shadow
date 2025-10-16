import { Howl, Howler } from "howler";

/**
 * MusicManager - Audio manager for background music with fade transitions
 *
 * Usage Example:
 *
 * import MusicManager from './musicManager.js';
 *
 * // Create manager
 * const musicManager = new MusicManager({ defaultVolume: 0.7 });
 *
 * // Add tracks
 * musicManager.addTrack('menu', './audio/music/menu.mp3');
 * musicManager.addTrack('gameplay', ['./audio/music/gameplay.webm', './audio/music/gameplay.mp3']);
 * musicManager.addTrack('boss', './audio/music/boss.mp3', { loop: true });
 *
 * // Play music with 2 second fade
 * musicManager.changeMusic('menu', 2.0);
 *
 * // Switch to gameplay music with 3 second crossfade
 * musicManager.changeMusic('gameplay', 3.0);
 *
 * // Control playback
 * musicManager.pauseMusic();
 * musicManager.resumeMusic();
 * musicManager.stopMusic();
 *
 * // Change volume with fade
 * musicManager.setVolume(0.5, 2.0); // Fade to 50% over 2 seconds
 *
 * // In your animation loop
 * function animate(time) {
 *   const dt = getDeltaTime();
 *   musicManager.update(dt);
 *   // ... rest of your update code
 * }
 */

class MusicManager {
  constructor(options = {}) {
    this.defaultVolume = options.defaultVolume || 1.0;
    this.tracks = {}; // Store Howl instances by name
    this.currentTrack = null;
    this.isTransitioning = false;

    // Fade state
    this.fadeState = {
      active: false,
      trackName: null,
      startVolume: 0,
      targetVolume: 0,
      duration: 0,
      startTime: 0,
      fadeIn: true,
      resolve: null,
    };

    // Volume change state
    this.volumeChangeState = {
      active: false,
      startVolume: 0,
      targetVolume: 0,
      duration: 0,
      startTime: 0,
    };

    // Event listeners
    this.eventListeners = {
      "music:change": [],
      "music:stop": [],
      "music:pause": [],
      "music:resume": [],
      "music:volume": [],
    };

    // Bind methods
    this.changeMusic = this.changeMusic.bind(this);
    this.stopMusic = this.stopMusic.bind(this);
    this.stopAllMusic = this.stopAllMusic.bind(this);
    this.pauseMusic = this.pauseMusic.bind(this);
    this.resumeMusic = this.resumeMusic.bind(this);
    this.setVolume = this.setVolume.bind(this);

    this.gameManager = null;
  }

  /**
   * Set game manager and register event listeners
   * @param {GameManager} gameManager - The game manager instance
   */
  setGameManager(gameManager) {
    this.gameManager = gameManager;

    // Import getMusicForState
    import("./musicData.js").then(({ getMusicForState }) => {
      // Listen for state changes
      this.gameManager.on("state:changed", (newState, oldState) => {
        const track = getMusicForState(newState);
        if (!track) return;

        // Only change music if it's different from current track
        if (this.getCurrentTrack() !== track.id) {
          console.log(
            `MusicManager: Changing music to "${track.id}" (${track.description})`
          );
          this.changeMusic(track.id, track.fadeTime || 0);
        }
      });

      console.log("MusicManager: Event listeners registered");
    });
  }

  /**
   * Add a music track to the manager
   * @param {string} name - Name/ID for this track
   * @param {string|string[]} src - Path or array of paths to audio files
   * @param {object} options - Additional Howler options
   */
  addTrack(name, src, options = {}) {
    this.tracks[name] = new Howl({
      src: Array.isArray(src) ? src : [src],
      loop: options.loop !== undefined ? options.loop : true,
      volume:
        options.volume !== undefined ? options.volume : this.defaultVolume,
      ...options,
    });
    return this.tracks[name];
  }

  /**
   * Change to a different music track with optional fade
   * @param {string} trackName - Name of the track to play
   * @param {number} fadeIn - Duration of fade in seconds (0 for instant)
   */
  changeMusic(trackName, fadeIn = 0.0) {
    if (this.isTransitioning || !this.tracks[trackName]) {
      console.warn(
        `MusicManager: Track "${trackName}" not found or transitioning`
      );
      return;
    }

    this.isTransitioning = true;
    const previousTrack = this.currentTrack;
    this.currentTrack = trackName;

    // Fade out and stop any currently playing tracks
    Object.keys(this.tracks).forEach((name) => {
      if (name !== trackName && this.tracks[name].playing()) {
        const startVolume = this.tracks[name].volume();
        this._fadeOut(name, startVolume, fadeIn).then(() => {
          this.tracks[name].stop();
        });
      }
    });

    if (fadeIn > 0) {
      // If there's a previous track playing, fade it out
      if (previousTrack && this.tracks[previousTrack].playing()) {
        const startVolume = this.tracks[previousTrack].volume();
        this._fadeOut(previousTrack, startVolume, fadeIn)
          .then(() => {
            this.tracks[previousTrack].stop();
            // Start new track with fade in
            this.tracks[trackName].volume(0);
            this.tracks[trackName].play();
            return this._fadeIn(trackName, this.defaultVolume, fadeIn);
          })
          .then(() => {
            this.isTransitioning = false;
          });
      } else {
        // No previous track, just fade in the new one
        this.tracks[trackName].volume(0);
        this.tracks[trackName].play();
        this._fadeIn(trackName, this.defaultVolume, fadeIn).then(() => {
          this.isTransitioning = false;
        });
      }
    } else {
      // Immediate change without fading
      if (previousTrack && this.tracks[previousTrack]) {
        this.tracks[previousTrack].stop();
      }
      this.tracks[trackName].volume(this.defaultVolume);
      this.tracks[trackName].play();
      this.isTransitioning = false;
    }
  }

  /**
   * Fade in a track
   * @param {string} trackName - Name of the track
   * @param {number} targetVolume - Target volume
   * @param {number} duration - Duration in seconds
   * @returns {Promise}
   */
  _fadeIn(trackName, targetVolume, duration) {
    return new Promise((resolve) => {
      const track = this.tracks[trackName];
      this.fadeState = {
        active: true,
        trackName: trackName,
        startVolume: track.volume(),
        targetVolume: targetVolume,
        duration: duration,
        startTime: Date.now(),
        fadeIn: true,
        resolve: resolve,
      };
    });
  }

  /**
   * Fade out a track
   * @param {string} trackName - Name of the track
   * @param {number} startVolume - Starting volume
   * @param {number} duration - Duration in seconds
   * @returns {Promise}
   */
  _fadeOut(trackName, startVolume, duration) {
    return new Promise((resolve) => {
      this.fadeState = {
        active: true,
        trackName: trackName,
        startVolume: startVolume,
        targetVolume: 0,
        duration: duration,
        startTime: Date.now(),
        fadeIn: false,
        resolve: resolve,
      };
    });
  }

  /**
   * Stop the current music track
   */
  stopMusic() {
    if (this.currentTrack && this.tracks[this.currentTrack]) {
      this.tracks[this.currentTrack].stop();
      this.currentTrack = null;
    }
  }

  /**
   * Stop all music tracks immediately
   */
  stopAllMusic() {
    Object.keys(this.tracks).forEach((name) => {
      if (this.tracks[name].playing()) {
        this.tracks[name].stop();
      }
    });
    this.currentTrack = null;
    this.isTransitioning = false;
  }

  /**
   * Pause the current music track
   */
  pauseMusic() {
    if (this.currentTrack && this.tracks[this.currentTrack]) {
      this.tracks[this.currentTrack].pause();
    }
  }

  /**
   * Resume the current music track
   */
  resumeMusic() {
    if (this.currentTrack && this.tracks[this.currentTrack]) {
      this.tracks[this.currentTrack].play();
    }
  }

  /**
   * Set music volume with optional fade (affects only music tracks)
   * @param {number} volume - Target volume (0-1)
   * @param {number} fadeDuration - Duration of fade in seconds
   */
  setVolume(volume, fadeDuration = 0) {
    this.defaultVolume = volume;

    if (fadeDuration > 0) {
      this.volumeChangeState = {
        active: true,
        startVolume: this.currentTrack
          ? this.tracks[this.currentTrack].volume()
          : 0,
        targetVolume: volume,
        duration: fadeDuration,
        startTime: Date.now(),
      };
    } else {
      // Immediately set volume for current track
      if (this.currentTrack && this.tracks[this.currentTrack]) {
        this.tracks[this.currentTrack].volume(volume);
      }
    }
  }

  /**
   * Get the currently playing track name
   * @returns {string|null} Current track name or null
   */
  getCurrentTrack() {
    return this.currentTrack;
  }

  /**
   * Check if a track is currently playing
   * @param {string} trackName - Name of the track
   * @returns {boolean} True if the track is playing
   */
  isTrackPlaying(trackName) {
    return this.currentTrack === trackName && this.tracks[trackName]?.playing();
  }

  /**
   * Update method - call this in your animation loop
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    // Handle fade operations
    if (this.fadeState.active) {
      const elapsed = (Date.now() - this.fadeState.startTime) / 1000;
      const t = Math.min(elapsed / this.fadeState.duration, 1);
      const track = this.tracks[this.fadeState.trackName];

      if (track) {
        const newVolume = this._lerp(
          this.fadeState.startVolume,
          this.fadeState.targetVolume,
          t
        );
        track.volume(newVolume);

        if (t >= 1) {
          this.fadeState.active = false;
          if (this.fadeState.resolve) {
            this.fadeState.resolve();
          }
        }
      }
    }

    // Handle volume change operations
    if (this.volumeChangeState.active) {
      const elapsed = (Date.now() - this.volumeChangeState.startTime) / 1000;
      const t = Math.min(elapsed / this.volumeChangeState.duration, 1);

      const newVolume = this._lerp(
        this.volumeChangeState.startVolume,
        this.volumeChangeState.targetVolume,
        t
      );

      // Apply to current track only
      if (this.currentTrack && this.tracks[this.currentTrack]) {
        this.tracks[this.currentTrack].volume(newVolume);
      }

      if (t >= 1) {
        this.volumeChangeState.active = false;
      }
    }
  }

  /**
   * Linear interpolation helper
   * @param {number} a - Start value
   * @param {number} b - End value
   * @param {number} t - Interpolation factor (0-1)
   * @returns {number}
   */
  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Add event listener (for compatibility with event-based systems)
   * @param {string} event - Event name
   * @param {function} callback - Callback function
   */
  on(event, callback) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].push(callback);
    }
  }

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {function} callback - Callback function
   */
  off(event, callback) {
    if (this.eventListeners[event]) {
      const index = this.eventListeners[event].indexOf(callback);
      if (index > -1) {
        this.eventListeners[event].splice(index, 1);
      }
    }
  }

  /**
   * Emit an event (for internal use or external triggering)
   * @param {string} event - Event name
   * @param  {...any} args - Arguments to pass to callbacks
   */
  emit(event, ...args) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach((callback) => callback(...args));
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stopAllMusic();
    Object.keys(this.tracks).forEach((name) => {
      this.tracks[name].unload();
    });
    this.tracks = {};
    this.eventListeners = {};
  }
}

export default MusicManager;

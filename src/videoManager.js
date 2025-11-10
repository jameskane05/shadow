import * as THREE from "three";
import { videos } from "./videoData.js";
import { checkCriteria } from "./utils/criteriaHelper.js";
import { Logger } from "./utils/logger.js";

/**
 * VideoManager - Manages video playback with state-based control
 *
 * Features:
 * - State-based video playback
 * - WebM alpha channel support
 * - Multiple video instances
 * - Billboard mode to face camera
 */
class VideoManager {
  constructor(options = {}) {
    this.scene = options.scene;
    this.gameManager = options.gameManager;
    this.camera = options.camera;
    this.gizmoManager = options.gizmoManager; // For debug positioning
    this.loadingScreen = options.loadingScreen || null; // For checking if loading is complete
    this.logger = new Logger("VideoManager", false);

    // Track active video players
    this.videoPlayers = new Map(); // id -> VideoPlayer instance
    this.playedOnce = new Set(); // Track videos that have played once
    this.pendingDelays = new Map(); // id -> setTimeout handle for delayed playback

    // Track deferred videos (preload: false) that haven't been loaded yet
    this.deferredVideos = new Set(); // Set of video IDs that should be deferred

    // Track if we should unlock videos when they're created (set during gesture context)
    this.shouldUnlockOnCreate = false;

    // Listen for game state changes
    if (this.gameManager) {
      this.gameManager.on("state:changed", (newState, oldState) => {
        this.updateVideosForState(newState);
      });

      // Handle initial state (defer to next tick to allow gizmoManager to be set)
      setTimeout(() => {
        const currentState = this.gameManager.getState();
        this.updateVideosForState(currentState);
      }, 0);
    }
  }

  /**
   * Resolve a video by ID from videoData
   * @param {string} videoId - Video ID
   * @returns {Object|null} Video config or null if not found
   */
  async resolveVideoById(videoId) {
    // Try direct lookup first
    if (videos[videoId]) {
      return videos[videoId];
    }

    // Fallback: import and check (in case videos wasn't imported yet)
    try {
      const { videos: videoData } = await import("./videoData.js");
      if (videoData[videoId]) {
        return videoData[videoId];
      }
    } catch (e) {
      // Ignore import errors
    }

    return null;
  }

  /**
   * Handle playNext chaining for a video
   * @param {Object} completedVideoConfig - Video config that just completed
   * @private
   */
  async _handlePlayNext(completedVideoConfig) {
    if (!completedVideoConfig || !completedVideoConfig.playNext) {
      return;
    }

    this.logger.log(`Chaining to next video from "${completedVideoConfig.id}"`);

    // Resolve the next video (could be an object or string ID)
    let nextVideo;
    if (typeof completedVideoConfig.playNext === "string") {
      nextVideo = await this.resolveVideoById(completedVideoConfig.playNext);
    } else {
      nextVideo = completedVideoConfig.playNext;
    }

    if (nextVideo) {
      // Check if video should play based on criteria
      if (this.gameManager) {
        const currentState = this.gameManager.getState();
        const playCriteria = nextVideo.playCriteria || nextVideo.criteria;

        if (playCriteria && !checkCriteria(currentState, playCriteria)) {
          this.logger.log(
            `Next video "${nextVideo.id}" criteria not met, skipping playNext`
          );
          return;
        }

        // Check if video was already played once (if once flag is set)
        if (nextVideo.once && this.playedOnce.has(nextVideo.id)) {
          this.logger.log(
            `Next video "${nextVideo.id}" already played once, skipping playNext`
          );
          return;
        }
      }

      // Mark the next video as played if it has "once" flag
      if (nextVideo.once) {
        this.playedOnce.add(nextVideo.id);
        this.logger.log(`Marked chained video "${nextVideo.id}" as played`);
      }

      // Check if next video has a delay
      const delay = nextVideo.delay || 0;
      if (delay > 0) {
        this.logger.log(`Chaining to "${nextVideo.id}" with ${delay}s delay`);
        setTimeout(() => {
          this.playVideo(nextVideo.id);
        }, delay * 1000);
      } else {
        // Play immediately
        this.playVideo(nextVideo.id);
      }
    } else {
      this.logger.warn(
        `playNext video not found for "${completedVideoConfig.id}": ${completedVideoConfig.playNext}`
      );
    }
  }

  /**
   * Check if a video should be loaded on the current platform
   * @param {Object} videoConfig - Video configuration
   * @returns {boolean} True if video should be loaded on current platform
   * @private
   */
  _shouldLoadOnPlatform(videoConfig) {
    if (!videoConfig.platform) {
      return true; // No platform restriction, load on all platforms
    }

    const state = this.gameManager?.getState() || {};
    const isIOS = state.isIOS || false;
    const isSafari = state.isSafari || false;

    // Support both old "ios" and new "safari" platform values for backwards compatibility
    if (videoConfig.platform === "ios" || videoConfig.platform === "safari") {
      return videoConfig.platform === "ios" ? isIOS : isSafari;
    } else if (
      videoConfig.platform === "!ios" ||
      videoConfig.platform === "!safari"
    ) {
      return videoConfig.platform === "!ios" ? !isIOS : !isSafari;
    }

    return true; // Unknown platform value, default to loading
  }

  /**
   * Update all videos based on current game state
   * Checks criteria for each video and plays/stops accordingly
   * Supports separate spawnCriteria and playCriteria for advanced control
   * @param {Object} state - Current game state
   */
  async updateVideosForState(state) {
    // In debug mode, check if we should force preload for matching videos
    let isDebugMode = false;
    try {
      const { isDebugSpawnActive } = await import("./utils/debugSpawner.js");
      isDebugMode = isDebugSpawnActive();
    } catch (e) {
      // Import might fail if module not available, ignore
    }

    // Check all videos defined in videoData
    for (const [videoId, videoConfig] of Object.entries(videos)) {
      // Skip videos that shouldn't load on current platform
      if (!this._shouldLoadOnPlatform(videoConfig)) {
        // If video exists but shouldn't be on this platform, remove it
        const player = this.videoPlayers.get(videoId);
        if (player) {
          player.destroy();
          this.videoPlayers.delete(videoId);
          this.logger.log(
            `Removed video "${videoId}" (not supported on current platform)`
          );
        }
        continue;
      }
      // Determine spawn criteria (when video mesh should exist)
      const spawnCriteria = videoConfig.spawnCriteria || videoConfig.criteria;
      const matchesSpawnCriteria = spawnCriteria
        ? checkCriteria(state, spawnCriteria)
        : true;

      // Determine play criteria (when video should play)
      // If spawnCriteria is provided but playCriteria is not, use time-based delay instead
      const hasExplicitPlayCriteria = videoConfig.playCriteria !== undefined;
      const playCriteria = videoConfig.playCriteria || videoConfig.criteria;
      const matchesPlayCriteria = playCriteria
        ? checkCriteria(state, playCriteria)
        : true;

      const player = this.videoPlayers.get(videoId);
      const exists = player !== undefined;
      const isPlaying = player && player.isPlaying;
      const hasPlayedOnce = this.playedOnce.has(videoId);
      const hasPendingDelay = this.pendingDelays.has(videoId);

      // Handle spawn criteria (video existence)
      if (matchesSpawnCriteria) {
        // In debug mode, force preload if video matches spawn criteria
        // Otherwise, check preload flag
        const shouldPreload =
          isDebugMode && matchesSpawnCriteria
            ? true
            : videoConfig.preload !== false; // Default to true
        const isLoadingComplete =
          !this.loadingScreen || this.loadingScreen.isLoadingComplete();

        // Skip creating video if preload is false and loading screen is still active (unless debug mode)
        if (!shouldPreload && !isLoadingComplete) {
          this.deferredVideos.add(videoId);
          this.logger.log(
            `Deferred loading for video "${videoId}" (preload: false)`
          );
          continue;
        }

        // Video should exist - create player if it doesn't exist yet
        if (!exists) {
          // Check if we should delay playback
          const hasDelay = videoConfig.autoPlay && (videoConfig.delay || 0) > 0;

          // Create player without playing if autoPlay is false
          if (!videoConfig.autoPlay) {
            this.createVideoPlayer(videoId);
          } else {
            this.playVideo(videoId); // Creates player and plays
          }

          // If we have spawnCriteria but no explicit playCriteria, schedule delayed play
          const useTimedDelay =
            videoConfig.spawnCriteria && !hasExplicitPlayCriteria;

          if (useTimedDelay && videoConfig.autoPlay) {
            // Time-based delay: play X seconds after spawning
            const delay = videoConfig.delay || 0;
            const newPlayer = this.videoPlayers.get(videoId);

            if (newPlayer && newPlayer.video) {
              // Play briefly to render first frame, then pause
              newPlayer.video
                .play()
                .then(() => {
                  requestAnimationFrame(async () => {
                    await newPlayer.pause();
                    newPlayer.video.currentTime = 0;

                    // Schedule delayed playback
                    if (delay > 0) {
                      const timeoutId = setTimeout(() => {
                        this.pendingDelays.delete(videoId);
                        this.playVideo(videoId);
                      }, delay * 1000);

                      this.pendingDelays.set(videoId, timeoutId);
                      this.logger.log(
                        `Spawned video "${videoId}" (paused), will play in ${delay}s`
                      );
                    } else {
                      // No delay, play immediately
                      this.logger.log(
                        `Spawned video "${videoId}" (paused, first frame visible)`
                      );
                      this.playVideo(videoId);
                    }
                  });
                })
                .catch(async (err) => {
                  if (err.name !== "AbortError") {
                    this.logger.warn(
                      `Failed to render first frame for "${videoId}":`,
                      err
                    );
                  }
                  await newPlayer.pause();
                });
            }
          }
          // State-based play: pause and wait for playCriteria
          // Only render first frame if autoPlay is true (videos with autoPlay: false should stay hidden)
          else if (!matchesPlayCriteria && videoConfig.autoPlay) {
            const newPlayer = this.videoPlayers.get(videoId);
            if (newPlayer && newPlayer.video) {
              // Play briefly to render first frame, then pause
              newPlayer.video
                .play()
                .then(() => {
                  requestAnimationFrame(async () => {
                    await newPlayer.pause();
                    newPlayer.video.currentTime = 0;
                    this.logger.log(
                      `Spawned video "${videoId}" (paused, waiting for play criteria)`
                    );
                  });
                })
                .catch(async (err) => {
                  if (err.name !== "AbortError") {
                    this.logger.warn(
                      `Failed to render first frame for "${videoId}":`,
                      err
                    );
                  }
                  await newPlayer.pause();
                });
            }
          }
          // If autoPlay is false, just create the player and keep it paused (no first frame rendering)
          else if (!matchesPlayCriteria && !videoConfig.autoPlay) {
            this.logger.log(
              `Spawned video "${videoId}" (paused, autoPlay=false, waiting for play criteria)`
            );
          }
          // State-based play WITH delay: pause and schedule delayed playback
          // Only if autoPlay is true (videos with autoPlay: false shouldn't auto-play)
          else if (
            matchesPlayCriteria &&
            hasDelay &&
            !useTimedDelay &&
            videoConfig.autoPlay
          ) {
            const newPlayer = this.videoPlayers.get(videoId);
            if (newPlayer && newPlayer.video) {
              // Pause the video that was just auto-played
              (async () => {
                await newPlayer.pause();
                newPlayer.video.currentTime = 0;

                // Schedule delayed playback
                const delay = videoConfig.delay || 0;
                const timeoutId = setTimeout(() => {
                  this.pendingDelays.delete(videoId);
                  this.playVideo(videoId);
                }, delay * 1000);

                this.pendingDelays.set(videoId, timeoutId);
                this.logger.log(
                  `Spawned video "${videoId}" (paused), will play in ${delay}s`
                );
              })();
            }
          }
        }

        // Handle play criteria (video playback) - only for state-based play
        // Skip this logic if using timed delay (handled during spawn)
        const useTimedDelay =
          videoConfig.spawnCriteria && !hasExplicitPlayCriteria;

        if (
          !useTimedDelay &&
          matchesPlayCriteria &&
          !isPlaying &&
          !hasPendingDelay
        ) {
          // Check once - skip if already played
          if (videoConfig.once && hasPlayedOnce) {
            continue;
          }

          // Auto-play video if configured (with optional delay)
          if (videoConfig.autoPlay) {
            const delay = videoConfig.delay || 0;

            if (delay > 0) {
              // Schedule delayed playback
              const timeoutId = setTimeout(() => {
                this.pendingDelays.delete(videoId);
                this.playVideo(videoId);
              }, delay * 1000); // Convert to milliseconds

              this.pendingDelays.set(videoId, timeoutId);
              this.logger.log(
                `Scheduled video "${videoId}" to play in ${delay}s`
              );
            } else {
              // Play immediately
              this.playVideo(videoId);
            }
          }
        }
        // If play criteria don't match, pause the video (only for state-based play)
        else if (!useTimedDelay && !matchesPlayCriteria && isPlaying) {
          this.stopVideo(videoId);
        }
      }
      // If spawn criteria doesn't match, remove video entirely
      else if (!matchesSpawnCriteria) {
        // Cancel pending delay if exists
        if (hasPendingDelay) {
          clearTimeout(this.pendingDelays.get(videoId));
          this.pendingDelays.delete(videoId);
          this.logger.log(`Cancelled delayed playback for "${videoId}"`);
        }

        // Stop and remove video if it exists.
        // Keep videos for Safari around that are preloaded and neeed to stick
        // around until needed.
        if (exists && videoConfig.platform !== 'safari') {
          player.destroy();
          this.videoPlayers.delete(videoId);
          this.logger.log(
            `Removed video "${videoId}" (spawn criteria no longer met)`
          );
        }
      }
    }
  }

  /**
   * Create a video player instance without playing it
   * @param {string} videoId - Video ID from videoData.js
   * @returns {VideoPlayer|null} Created player or null if video not found
   * @private
   */
  createVideoPlayer(videoId) {
    const videoConfig = videos[videoId];
    if (!videoConfig) {
      this.logger.warn(`Video not found: ${videoId}`);
      return null;
    }

    // Check if player already exists
    if (this.videoPlayers.has(videoId)) {
      return this.videoPlayers.get(videoId);
    }

    // Resolve position (support functions for dynamic positioning)
    const position =
      typeof videoConfig.position === "function"
        ? videoConfig.position(this.gameManager)
        : videoConfig.position;

    const player = new VideoPlayer({
      scene: this.scene,
      gameManager: this.gameManager,
      camera: this.camera,
      videoPath: videoConfig.videoPath,
      position: position,
      rotation: videoConfig.rotation,
      scale: videoConfig.scale,
      loop: videoConfig.loop,
      muted: videoConfig.muted,
      volume: videoConfig.volume,
      playbackRate: videoConfig.playbackRate,
      spatialAudio: videoConfig.spatial || videoConfig.spatialAudio,
      audioPositionOffset: videoConfig.audioPositionOffset,
      pannerAttr: videoConfig.pannerAttr,
      billboard: videoConfig.billboard,
    });

    player.initialize();
    this.videoPlayers.set(videoId, player);

    // If autoPlay is false, hide the video until it's explicitly played
    if (!videoConfig.autoPlay) {
      player.setVisible(false);
      this.logger.log(`Created video "${videoId}" (hidden, autoPlay=false)`);
    }

    // Unlock video for iOS Safari if flag is set (set during START button gesture context)
    // This ensures videos created after START button click can still be unlocked
    if (this.shouldUnlockOnCreate && player.video && !player.video.muted) {
      const state = this.gameManager?.getState() || {};
      const isIOS = state.isIOS || false;
      const isSafari = state.isSafari || false;

      if (isIOS || isSafari) {
        // Try to unlock immediately when created (we're still in gesture context from START)
        try {
          const playPromise = player.video.play();
          if (playPromise && typeof playPromise.then === "function") {
            playPromise
              .then(() => {
                // Let it play for 1 frame to ensure it's actually unlocked
                requestAnimationFrame(() => {
                  player.video.pause();
                  player.video.currentTime = 0;
                  this.logger.log(`Unlocked video "${videoId}" on creation`);
                });
              })
              .catch((error) => {
                // Ignore - might not be in gesture context anymore
                this.logger.warn(
                  `Failed to unlock video "${videoId}" on creation:`,
                  error
                );
              });
          }
        } catch (error) {
          // Ignore - might not be in gesture context anymore
          this.logger.warn(
            `Error unlocking video "${videoId}" on creation:`,
            error
          );
        }
      }
    }

    // Register with gizmo manager if gizmo flag is set
    if (videoConfig.gizmo) {
      // Disable billboard for gizmo-enabled videos to avoid conflict
      player.config.billboard = false;
      this.logger.log(`Disabled billboard for "${videoId}" (gizmo enabled)`);

      if (this.gizmoManager && player.videoMesh) {
        this.gizmoManager.registerObject(player.videoMesh, videoId, "video");
        // Attach immediately so the helper is visible without click
        if (typeof this.gizmoManager.selectObjectById === "function") {
          this.gizmoManager.selectObjectById(videoId);
        }
      } else if (!this.gizmoManager) {
        // Store for later registration
        player._needsGizmoRegistration = true;
      }

      // Set global gizmo-in-data flag on gameManager if any video declares gizmo
      try {
        if (
          this.gameManager &&
          typeof this.gameManager.setState === "function"
        ) {
          this.gameManager.setState({ hasGizmoInData: true });
        }
      } catch (e) {
        this.logger.error("Failed to set hasGizmoInData:", e);
      }
    }

    // Handle video end
    player.video.addEventListener("ended", async () => {
      if (videoConfig.once) {
        this.playedOnce.add(videoId);
      }

      if (videoConfig.onComplete) {
        videoConfig.onComplete(this.gameManager);
      }

      // Handle playNext chaining (only if video doesn't loop - loop videos never end)
      if (!videoConfig.loop && videoConfig.playNext) {
        await this._handlePlayNext(videoConfig);
      }
    });

    // Retry gizmo registration if it was delayed
    if (
      player._needsGizmoRegistration &&
      this.gizmoManager &&
      player.videoMesh
    ) {
      // Disable billboard for gizmo-enabled videos to avoid conflict
      player.config.billboard = false;

      this.logger.log(
        `Retry registering "${videoId}" with gizmo and selecting it`
      );
      this.gizmoManager.registerObject(player.videoMesh, videoId, "video");
      if (typeof this.gizmoManager.selectObjectById === "function") {
        this.gizmoManager.selectObjectById(videoId);
      }
      player._needsGizmoRegistration = false;
    }

    return player;
  }

  /**
   * Play a video by ID
   * @param {string} videoId - Video ID from videoData.js
   */
  playVideo(videoId) {
    const videoConfig = videos[videoId];
    if (!videoConfig) {
      this.logger.warn(`Video not found: ${videoId}`);
      return;
    }

    // Skip videos that shouldn't load on current platform
    if (!this._shouldLoadOnPlatform(videoConfig)) {
      this.logger.warn(
        `Video "${videoId}" is not supported on current platform`
      );
      return;
    }

    // Check if video should be deferred (preload: false and loading screen still active)
    const shouldPreload = videoConfig.preload !== false; // Default to true
    const isLoadingComplete =
      !this.loadingScreen || this.loadingScreen.isLoadingComplete();

    // If video is deferred and loading screen is still active, defer it
    if (!shouldPreload && !isLoadingComplete) {
      this.deferredVideos.add(videoId);
      this.logger.log(
        `Deferred loading for video "${videoId}" (preload: false, playVideo called)`
      );
      return;
    }

    // Get or create video player
    let player = this.videoPlayers.get(videoId);

    if (!player) {
      // Remove from deferred set if it was deferred
      this.deferredVideos.delete(videoId);

      player = this.createVideoPlayer(videoId);
      if (!player) {
        return; // Video not found or creation failed
      }
    }

    // Make sure video is visible when playing
    player.setVisible(true);
    player.play();

    // Emit event when video starts playing (for animations/other systems)
    if (this.gameManager) {
      this.gameManager.emit(`video:play:${videoId}`, videoId);
    }
  }

  /**
   * Stop a video by ID
   * @param {string} videoId - Video ID
   */
  stopVideo(videoId) {
    const player = this.videoPlayers.get(videoId);
    if (player) {
      player.stop();
    }
  }

  /**
   * Stop all videos
   */
  stopAllVideos() {
    this.videoPlayers.forEach((player) => player.stop());
  }

  /**
   * Get video player by ID (for external syncing)
   * @param {string} videoId - Video ID
   * @returns {VideoPlayer|null} Video player instance or null if not found
   */
  getVideoPlayer(videoId) {
    return this.videoPlayers.get(videoId) || null;
  }

  /**
   * Unlock video playback for iOS Safari
   * Calls play() and pause() on all existing video elements to "unlock" them
   * This must be called during a user gesture context (e.g., START button click)
   */
  unlockVideoPlayback() {
    const state = this.gameManager?.getState() || {};
    const isIOS = state.isIOS || false;
    const isSafari = state.isSafari || false;

    if (!isIOS && !isSafari) {
      return; // Not needed on other platforms
    }

    this.logger.log("Unlocking video playback for iOS Safari");

    // Set flag to unlock videos when they're created (for videos created after this call)
    this.shouldUnlockOnCreate = true;

    // Unlock all existing video elements by calling play() and pause() during gesture context
    // This "registers" them with iOS Safari so they can play later without user gesture
    let unlockedCount = 0;
    this.videoPlayers.forEach((player, videoId) => {
      if (player.video && !player.video.muted) {
        try {
          // Call play() to unlock, then let it play for 1 frame before pausing
          // iOS Safari may need the video to actually start playing to unlock it
          const playPromise = player.video.play();
          if (playPromise && typeof playPromise.then === "function") {
            playPromise
              .then(() => {
                // Let it play for 1 frame to ensure it's actually unlocked
                requestAnimationFrame(() => {
                  player.video.pause();
                  player.video.currentTime = 0; // Reset to beginning
                  unlockedCount++;
                  this.logger.log(`Unlocked video "${videoId}" for playback`);
                });
              })
              .catch((error) => {
                // Ignore errors - video might not be ready yet
                this.logger.warn(`Failed to unlock video "${videoId}":`, error);
              });
          } else {
            // play() returned undefined/null, try pause anyway
            player.video.pause();
            player.video.currentTime = 0;
          }
        } catch (error) {
          // Ignore errors - video might not be ready yet
          this.logger.warn(`Error unlocking video "${videoId}":`, error);
        }
      }
    });

    if (unlockedCount > 0) {
      this.logger.log(
        `Unlocked ${unlockedCount} video(s) for iOS Safari playback`
      );
    }
  }

  /**
   * Retry gizmo registration for videos that need it
   * @private
   */
  _retryGizmoRegistrations() {
    if (!this.gizmoManager) return;

    this.videoPlayers.forEach((player, videoId) => {
      const videoConfig = videos[videoId];
      if (!videoConfig || !videoConfig.gizmo) return;

      // Check if already registered by looking for the object in gizmo manager
      const isRegistered = this.gizmoManager.objects?.some(
        (obj) => obj.id === videoId && obj.object === player.videoMesh
      );

      // If not registered and video mesh exists, register it
      if (!isRegistered && player.videoMesh) {
        player.config.billboard = false;
        this.logger.log(`Retrying gizmo registration for "${videoId}"`);
        this.gizmoManager.registerObject(player.videoMesh, videoId, "video");
        if (typeof this.gizmoManager.selectObjectById === "function") {
          this.gizmoManager.selectObjectById(videoId);
        }
        player._needsGizmoRegistration = false;
      }
    });
  }

  /**
   * Update all active videos (call in animation loop)
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    const currentTime = performance.now() * 0.001;

    // Batch spatial audio listener updates - only update once per frame for all videos
    let spatialAudioListenerUpdated = false;
    let spatialAudioContext = null;
    let spatialAudioListener = null;

    this.videoPlayers.forEach((player) => {
      // Update player with current time for throttling
      player.update(dt, currentTime);

      // Collect spatial audio context for batching (all videos share the same context)
      if (
        player.config.spatialAudio &&
        player.isPlaying &&
        player.cachedVisible &&
        !spatialAudioListenerUpdated
      ) {
        if (player.audioContext && player.audioContext.listener) {
          spatialAudioContext = player.audioContext;
          spatialAudioListener = player.audioContext.listener;
          spatialAudioListenerUpdated = true;
        }
      }
    });

    // Update spatial audio listener once for all videos (if any video needs it)
    if (spatialAudioListenerUpdated && spatialAudioContext && this.camera) {
      this._updateSpatialAudioListener(
        spatialAudioContext,
        spatialAudioListener
      );
    }

    // Retry gizmo registrations in case gizmo manager became available after video creation
    this._retryGizmoRegistrations();
  }

  /**
   * Update spatial audio listener position/orientation once per frame for all videos
   * @private
   */
  _updateSpatialAudioListener(audioContext, listener) {
    if (!this.camera || !audioContext || !listener) return;

    // Update listener position
    if (listener.positionX) {
      // Modern API
      listener.positionX.setValueAtTime(
        this.camera.position.x,
        audioContext.currentTime
      );
      listener.positionY.setValueAtTime(
        this.camera.position.y,
        audioContext.currentTime
      );
      listener.positionZ.setValueAtTime(
        this.camera.position.z,
        audioContext.currentTime
      );
    } else {
      // Legacy API
      listener.setPosition(
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z
      );
    }

    // Update listener orientation
    const cameraDirection = this.camera.getWorldDirection(new THREE.Vector3());

    if (listener.forwardX) {
      // Modern API
      listener.forwardX.setValueAtTime(
        cameraDirection.x,
        audioContext.currentTime
      );
      listener.forwardY.setValueAtTime(
        cameraDirection.y,
        audioContext.currentTime
      );
      listener.forwardZ.setValueAtTime(
        cameraDirection.z,
        audioContext.currentTime
      );
      listener.upX.setValueAtTime(this.camera.up.x, audioContext.currentTime);
      listener.upY.setValueAtTime(this.camera.up.y, audioContext.currentTime);
      listener.upZ.setValueAtTime(this.camera.up.z, audioContext.currentTime);
    } else {
      // Legacy API
      listener.setOrientation(
        cameraDirection.x,
        cameraDirection.y,
        cameraDirection.z,
        this.camera.up.x,
        this.camera.up.y,
        this.camera.up.z
      );
    }
  }

  /**
   * Load deferred videos (preload: false) - fetch all of them regardless of state
   * Called after loading screen completes
   */
  loadDeferredVideos() {
    // Find all videos with preload: false
    const deferredVideoIds = [];
    for (const [videoId, videoConfig] of Object.entries(videos)) {
      // Skip videos that shouldn't load on current platform
      if (!this._shouldLoadOnPlatform(videoConfig)) {
        continue;
      }

      const shouldPreload = videoConfig.preload !== false; // Default to true
      if (!shouldPreload) {
        deferredVideoIds.push(videoId);
      }
    }

    if (deferredVideoIds.length === 0) {
      return;
    }

    this.logger.log(`Loading ${deferredVideoIds.length} deferred videos`);

    // Create video players for all deferred videos (even if they were already created)
    // Also ensure existing players start fetching if they haven't already
    for (const videoId of deferredVideoIds) {
      const videoConfig = videos[videoId];
      if (!videoConfig) continue;

      let player = this.videoPlayers.get(videoId);

      if (!player) {
        // Create the player (this will trigger the fetch via preload="auto" + load())
        player = this.createVideoPlayer(videoId);
        if (player) {
          // Hide the video and keep it paused until criteria match
          player.setVisible(false);
          this.logger.log(
            `Preloaded deferred video "${videoId}" (hidden, paused)`
          );
        }
      } else {
        // Player already exists (created by updateVideosForState before loadDeferredVideos ran)
        // Ensure it's fetching - check if video element exists and call load() if needed
        if (player.video && player.video.readyState === 0) {
          // Video hasn't started loading yet (readyState 0 = HAVE_NOTHING), trigger it
          player.video.load();
          this.logger.log(
            `Triggered fetch for already-created deferred video "${videoId}"`
          );
        }
      }
    }

    // Clear the deferred set since we've loaded them all
    this.deferredVideos.clear();
  }

  /**
   * Clean up all videos
   */
  destroy() {
    // Clear all pending delays
    this.pendingDelays.forEach((timeoutId) => clearTimeout(timeoutId));
    this.pendingDelays.clear();

    // Destroy all video players
    this.videoPlayers.forEach((player) => player.destroy());
    this.videoPlayers.clear();
    this.playedOnce.clear();
    this.deferredVideos.clear();
  }
}

/**
 * VideoPlayer - Individual video instance
 * (Internal class used by VideoManager)
 */
class VideoPlayer {
  constructor(options = {}) {
    this.scene = options.scene;
    this.gameManager = options.gameManager;
    this.camera = options.camera;
    this.logger = new Logger("VideoPlayer", false);

    // Video configuration
    this.config = {
      videoPath: options.videoPath,
      position: options.position || { x: 0, y: 0, z: 0 },
      rotation: options.rotation || { x: 0, y: 0, z: 0 },
      scale: options.scale || { x: 1, y: 1, z: 1 },
      loop: options.loop !== undefined ? options.loop : false,
      muted: options.muted !== undefined ? options.muted : true,
      volume: options.volume !== undefined ? options.volume : 1.0,
      playbackRate:
        options.playbackRate !== undefined ? options.playbackRate : 1.0,
      spatialAudio: options.spatialAudio || false,
      audioPositionOffset: options.audioPositionOffset || { x: 0, y: 0, z: 0 },
      pannerAttr: options.pannerAttr || {
        panningModel: "HRTF",
        refDistance: 1,
        rolloffFactor: 1,
        distanceModel: "inverse",
        maxDistance: 10000,
      },
      billboard: options.billboard !== undefined ? options.billboard : false,
    };

    // Video elements
    this.video = null;
    this.canvas = null;
    this.canvasContext = null;
    this.videoTexture = null;
    this.videoMesh = null;
    this.videoMaterial = null;
    this.isPlaying = false;
    this.isInitialized = false;
    this.canvasReady = false;
    this.isDestroying = false;
    this.playPromise = null;
    this.intendedVisible = true; // Track intended visibility (before viewmaster check)
    this.viewmasterRevealTimeout = null; // Timeout for delayed visibility when viewmaster is removed
    this.wasViewmasterEquipped = false; // Track previous frame's viewmaster state
    this.cachedVisible = true; // Cache visibility state to avoid redundant work
    this.lastBillboardUpdate = 0; // Track last billboard update time
    this.lastCameraPosition = new THREE.Vector3(); // Cache camera position for billboard throttling
    this.billboardUpdateThreshold = 0.1; // Update billboard if camera moved this much
    this.billboardUpdateInterval = 0.033; // Update billboard at most every 33ms (30fps)

    // Web Audio API for spatial audio
    this.audioContext = null;
    this.audioSource = null;
    this.audioPanner = null;
    this.audioGain = null;
  }

  /**
   * Initialize the video player
   */
  initialize() {
    if (this.isInitialized) return;

    // Create video element
    this.video = document.createElement("video");
    this.video.src = this.config.videoPath;
    this.video.crossOrigin = "anonymous";
    this.video.loop = this.config.loop;
    this.video.playsInline = true;
    this.video.preload = "auto"; // Browser will fetch metadata and possibly video data
    this.video.playbackRate = this.config.playbackRate;

    // Explicitly trigger loading to start the fetch immediately
    // This ensures the video starts downloading even if it's not playing
    this.video.load();

    // Set up spatial audio if enabled
    const useSpatialAudio = this.config.spatialAudio && !this.config.muted;
    if (useSpatialAudio) {
      this.setupSpatialAudio();
    } else {
      // Use regular video volume if not spatial
      this.video.muted = this.config.muted;
      this.video.volume = this.config.volume;
    }

    // Create canvas for WebM alpha extraction
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1920;
    this.canvas.height = 1080;
    this.canvasContext = this.canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: false,
    });

    // Don't create texture yet - wait for video to load
    this.videoTexture = null;

    // Create material with transparent support for WebM alpha
    const material = new THREE.MeshBasicMaterial({
      map: this.videoTexture,
      transparent: true,
      side: THREE.FrontSide,
      toneMapped: false,
      depthTest: true,
      depthWrite: true, // allow videos to write to depth so splats can occlude them
      alphaTest: 0.05, // discard near-fully-transparent pixels to improve depth sorting
    });

    // Create plane geometry
    const geometry = new THREE.PlaneGeometry(3, 3);

    // Create mesh
    this.videoMesh = new THREE.Mesh(geometry, material);
    this.videoMesh.position.set(
      this.config.position.x,
      this.config.position.y,
      this.config.position.z
    );
    this.videoMesh.rotation.set(
      this.config.rotation.x,
      this.config.rotation.y,
      this.config.rotation.z
    );
    this.videoMesh.scale.set(
      this.config.scale.x,
      this.config.scale.y,
      this.config.scale.z
    );
    // Do not force render order; let depth test handle occlusion with splats

    // Store material reference
    this.videoMaterial = material;

    // Initialize viewmaster state tracking
    const initialState = this.gameManager?.getState();
    this.wasViewmasterEquipped = initialState?.isViewmasterEquipped || false;

    // Apply initial visibility (respects viewmaster state)
    this.applyVisibility();
    this.videoMesh.name = "video-player";

    // Store initial rotation for billboarding offset
    this.initialRotation = {
      x: this.config.rotation.x,
      y: this.config.rotation.y,
      z: this.config.rotation.z,
    };

    // Initialize camera position cache for billboard throttling
    if (this.camera) {
      this.lastCameraPosition.copy(this.camera.position);
    }

    // Add to scene
    if (this.scene) {
      this.scene.add(this.videoMesh);
    }

    // Video event listeners
    this.video.addEventListener("loadeddata", () => {
      // Resize canvas to match video dimensions
      if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;

        // Create texture now that canvas has proper dimensions
        if (!this.videoTexture) {
          this.videoTexture = new THREE.CanvasTexture(this.canvas);
          this.videoTexture.minFilter = THREE.LinearFilter;
          this.videoTexture.magFilter = THREE.LinearFilter;
          this.videoTexture.colorSpace = THREE.SRGBColorSpace;

          // Update material with texture
          if (this.videoMesh && this.videoMesh.material) {
            this.videoMesh.material.map = this.videoTexture;
            this.videoMesh.material.needsUpdate = true;
          }
        }

        this.canvasReady = true;

        // If video is already playing, draw the first frame immediately
        // (This handles the case where play() was called before loadeddata)
        if (
          this.isPlaying &&
          this.video.readyState >= this.video.HAVE_CURRENT_DATA
        ) {
          this.canvasContext.clearRect(
            0,
            0,
            this.canvas.width,
            this.canvas.height
          );
          this.canvasContext.drawImage(this.video, 0, 0);
          this.videoTexture.needsUpdate = true;
        }
      }
    });

    this.video.addEventListener("error", (e) => {
      if (!this.isDestroying) {
        this.logger.error("Video error:", e);
        this.logger.error("Video error code:", this.video.error?.code);
        this.logger.error("Video error message:", this.video.error?.message);
      }
    });

    this.video.addEventListener("ended", () => {
      this.isPlaying = false;
    });

    this.video.addEventListener("play", () => {
      this.isPlaying = true;

      // Force texture update
      if (this.videoTexture) {
        this.videoTexture.needsUpdate = true;
      }

      // Force material update
      if (this.videoMaterial) {
        this.videoMaterial.needsUpdate = true;
      }
    });

    this.video.addEventListener("pause", () => {
      this.isPlaying = false;
    });

    // Use requestVideoFrameCallback for efficient frame updates (only draw when new frame available)
    if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
      this.useVideoFrameCallback = true;
      this.pendingVideoFrame = false;
    } else {
      this.useVideoFrameCallback = false;
    }

    this.isInitialized = true;
  }

  /**
   * Play the video
   */
  async play() {
    if (!this.video) return;

    try {
      // Only reset to beginning if video has ended
      if (this.video.ended) {
        this.video.currentTime = 0;
      }

      this.playPromise = this.video.play();
      await this.playPromise;
      this.playPromise = null;

      // Start video frame callback loop if supported
      if (this.useVideoFrameCallback && !this.pendingVideoFrame) {
        this.scheduleVideoFrameCallback();
      }
    } catch (error) {
      this.playPromise = null;
      if (error.name !== "AbortError") {
        this.logger.error("Failed to play video", error);
      }
    }
  }

  /**
   * Schedule next video frame callback
   */
  scheduleVideoFrameCallback() {
    if (!this.video || !this.useVideoFrameCallback) return;

    this.pendingVideoFrame = true;
    this.video.requestVideoFrameCallback(() => {
      this.pendingVideoFrame = false;

      // Draw the new frame
      if (
        this.canvasReady &&
        this.isPlaying &&
        this.video.readyState >= this.video.HAVE_CURRENT_DATA
      ) {
        this.canvasContext.clearRect(
          0,
          0,
          this.canvas.width,
          this.canvas.height
        );
        this.canvasContext.drawImage(this.video, 0, 0);
        this.videoTexture.needsUpdate = true;
      }

      // Schedule next frame if still playing
      if (this.isPlaying) {
        this.scheduleVideoFrameCallback();
      }
    });
  }

  /**
   * Pause the video
   */
  async pause() {
    if (this.video) {
      if (this.playPromise) {
        await this.playPromise.catch(() => {});
      }
      this.video.pause();
    }
  }

  /**
   * Stop the video
   */
  async stop() {
    if (this.video) {
      if (this.playPromise) {
        await this.playPromise.catch(() => {});
      }
      this.video.pause();
      this.video.currentTime = 0;
      this.isPlaying = false;
      this.pendingVideoFrame = false; // Cancel any pending frame callback
    }
  }

  /**
   * Set video position
   */
  setPosition(x, y, z) {
    if (this.videoMesh) {
      this.videoMesh.position.set(x, y, z);
    }
  }

  /**
   * Set video rotation
   */
  setRotation(x, y, z) {
    if (this.videoMesh) {
      this.videoMesh.rotation.set(x, y, z);
    }
  }

  /**
   * Set video scale
   */
  setScale(x, y, z) {
    if (this.videoMesh) {
      this.videoMesh.scale.set(x, y, z);
    }
  }

  /**
   * Show/hide video mesh
   */
  setVisible(visible) {
    this.intendedVisible = visible;
    // Actual visibility will be applied in update() with viewmaster check
    this.applyVisibility();
  }

  /**
   * Apply visibility based on intended state and viewmaster equipped state
   * @returns {boolean} True if video is visible, false otherwise
   */
  applyVisibility() {
    if (!this.videoMesh) {
      this.cachedVisible = false;
      return false;
    }
    const isViewmasterEquipped =
      this.gameManager?.getState()?.isViewmasterEquipped || false;

    // Check if viewmaster was just removed (transition from equipped to not equipped)
    if (this.wasViewmasterEquipped && !isViewmasterEquipped) {
      // Clear any existing timeout
      if (this.viewmasterRevealTimeout) {
        clearTimeout(this.viewmasterRevealTimeout);
      }

      // Keep video hidden and schedule reveal after 0.5s delay
      this.videoMesh.visible = false;
      this.cachedVisible = false;
      this.viewmasterRevealTimeout = setTimeout(() => {
        this.viewmasterRevealTimeout = null;
        // Re-apply visibility now that delay is complete
        if (this.videoMesh && !this.isDestroying) {
          const currentState = this.gameManager?.getState();
          const currentlyEquipped = currentState?.isViewmasterEquipped || false;
          this.cachedVisible = this.intendedVisible && !currentlyEquipped;
          this.videoMesh.visible = this.cachedVisible;
        }
      }, 500);
      // Update previous state before returning
      this.wasViewmasterEquipped = isViewmasterEquipped;
      return false;
    }

    // Viewmaster was just put on - clear any pending reveal timeout
    if (!this.wasViewmasterEquipped && isViewmasterEquipped) {
      if (this.viewmasterRevealTimeout) {
        clearTimeout(this.viewmasterRevealTimeout);
        this.viewmasterRevealTimeout = null;
      }
      this.videoMesh.visible = false;
      this.cachedVisible = false;
      this.wasViewmasterEquipped = isViewmasterEquipped;
      return false;
    }

    // Apply visibility based on current state
    let visible;
    if (isViewmasterEquipped) {
      // Viewmaster is on - always hide
      visible = false;
    } else if (this.viewmasterRevealTimeout) {
      // Viewmaster is off but reveal delay is still pending - keep hidden
      visible = false;
    } else {
      // Viewmaster is off and no delay pending - show if intended
      visible = this.intendedVisible;
    }

    // Only update if changed to avoid unnecessary work
    if (this.cachedVisible !== visible) {
      this.videoMesh.visible = visible;
      this.cachedVisible = visible;
    }

    // Update previous state
    this.wasViewmasterEquipped = isViewmasterEquipped;
    return visible;
  }

  /**
   * Update method - call in animation loop
   */
  update(dt, currentTime = performance.now() * 0.001) {
    // Apply visibility (respects viewmaster equipped state)
    const isVisible = this.applyVisibility();

    // Early exit if video is not visible - skip all rendering work
    if (!isVisible) {
      return;
    }

    // Early exit if video is not playing or not ready
    if (!this.isPlaying || !this.video || !this.canvasReady) {
      return;
    }

    // Draw video to canvas only if not using video frame callback
    // (If using callback, frames are drawn in scheduleVideoFrameCallback instead)
    if (!this.useVideoFrameCallback) {
      if (this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
        this.canvasContext.clearRect(
          0,
          0,
          this.canvas.width,
          this.canvas.height
        );
        this.canvasContext.drawImage(this.video, 0, 0);
        this.videoTexture.needsUpdate = true;
      }
    }

    // Note: Spatial audio listener updates are now batched in VideoManager.update()
    // to avoid redundant updates when multiple videos use spatial audio

    // Billboard to camera if enabled (Y-axis only)
    // Throttle updates to reduce CPU overhead
    if (this.config.billboard && this.videoMesh && this.camera) {
      const timeSinceLastUpdate = currentTime - this.lastBillboardUpdate;
      const cameraMoved = this.lastCameraPosition.distanceTo(
        this.camera.position
      );

      // Update if enough time has passed OR camera moved significantly
      if (
        timeSinceLastUpdate >= this.billboardUpdateInterval ||
        cameraMoved >= this.billboardUpdateThreshold
      ) {
        // Calculate angle to camera in XZ plane only
        const dx = this.camera.position.x - this.videoMesh.position.x;
        const dz = this.camera.position.z - this.videoMesh.position.z;
        const angle = Math.atan2(dx, dz);

        // Apply only Y rotation, preserve original X and Z rotations
        this.videoMesh.rotation.y = angle;

        // Cache values for next frame
        this.lastBillboardUpdate = currentTime;
        this.lastCameraPosition.copy(this.camera.position);
      }
    }
  }

  /**
   * Set up spatial audio using Web Audio API
   */
  setupSpatialAudio() {
    try {
      // Create or reuse global audio context
      if (!window.videoAudioContext) {
        window.videoAudioContext = new (window.AudioContext ||
          window.webkitAudioContext)();
      }
      this.audioContext = window.videoAudioContext;

      // Create audio source from video element
      this.audioSource = this.audioContext.createMediaElementSource(this.video);

      // Create panner node for spatial audio
      this.audioPanner = this.audioContext.createPanner();

      // Apply panner attributes
      const attr = this.config.pannerAttr;
      this.audioPanner.panningModel = attr.panningModel || "HRTF";
      this.audioPanner.refDistance = attr.refDistance || 1;
      this.audioPanner.rolloffFactor = attr.rolloffFactor || 1;
      this.audioPanner.distanceModel = attr.distanceModel || "inverse";
      this.audioPanner.maxDistance = attr.maxDistance || 10000;
      this.audioPanner.coneInnerAngle = attr.coneInnerAngle || 360;
      this.audioPanner.coneOuterAngle = attr.coneOuterAngle || 360;
      this.audioPanner.coneOuterGain = attr.coneOuterGain || 0;

      // Calculate world audio position (video position + offset)
      const videoPos = this.config.position;
      const offset = this.config.audioPositionOffset;
      const audioWorldPos = {
        x: videoPos.x + offset.x,
        y: videoPos.y + offset.y,
        z: videoPos.z + offset.z,
      };

      // Set panner position
      this.audioPanner.positionX.setValueAtTime(
        audioWorldPos.x,
        this.audioContext.currentTime
      );
      this.audioPanner.positionY.setValueAtTime(
        audioWorldPos.y,
        this.audioContext.currentTime
      );
      this.audioPanner.positionZ.setValueAtTime(
        audioWorldPos.z,
        this.audioContext.currentTime
      );

      // Create gain node for volume control
      this.audioGain = this.audioContext.createGain();
      this.audioGain.gain.setValueAtTime(
        this.config.volume,
        this.audioContext.currentTime
      );

      // Connect: source -> panner -> gain -> destination
      this.audioSource.connect(this.audioPanner);
      this.audioPanner.connect(this.audioGain);
      this.audioGain.connect(this.audioContext.destination);

      // Video element must not be muted for Web Audio to work
      this.video.muted = false;
      // Volume is controlled by gain node, set video to max
      this.video.volume = 1.0;

      this.logger.log(
        `Spatial audio enabled at world position [${audioWorldPos.x}, ${audioWorldPos.y}, ${audioWorldPos.z}] (video pos + offset)`
      );
    } catch (error) {
      this.logger.error("Failed to set up spatial audio:", error);
      // Fall back to regular audio
      this.video.muted = this.config.muted;
      this.video.volume = this.config.volume;
    }
  }

  /**
   * Update listener position for spatial audio
   * @param {THREE.Camera} camera - Camera to use as listener
   */
  updateSpatialAudio(camera) {
    if (!this.audioContext || !camera) return;

    const listener = this.audioContext.listener;

    // Update listener position
    if (listener.positionX) {
      // Modern API
      listener.positionX.setValueAtTime(
        camera.position.x,
        this.audioContext.currentTime
      );
      listener.positionY.setValueAtTime(
        camera.position.y,
        this.audioContext.currentTime
      );
      listener.positionZ.setValueAtTime(
        camera.position.z,
        this.audioContext.currentTime
      );
    } else {
      // Legacy API
      listener.setPosition(
        camera.position.x,
        camera.position.y,
        camera.position.z
      );
    }

    // Update listener orientation
    const cameraDirection = camera.getWorldDirection(new THREE.Vector3());

    if (listener.forwardX) {
      // Modern API
      listener.forwardX.setValueAtTime(
        cameraDirection.x,
        this.audioContext.currentTime
      );
      listener.forwardY.setValueAtTime(
        cameraDirection.y,
        this.audioContext.currentTime
      );
      listener.forwardZ.setValueAtTime(
        cameraDirection.z,
        this.audioContext.currentTime
      );
      listener.upX.setValueAtTime(camera.up.x, this.audioContext.currentTime);
      listener.upY.setValueAtTime(camera.up.y, this.audioContext.currentTime);
      listener.upZ.setValueAtTime(camera.up.z, this.audioContext.currentTime);
    } else {
      // Legacy API
      listener.setOrientation(
        cameraDirection.x,
        cameraDirection.y,
        cameraDirection.z,
        camera.up.x,
        camera.up.y,
        camera.up.z
      );
    }
  }

  /**
   * Clean up
   */
  destroy() {
    this.isDestroying = true;
    this.stop();

    // Clear viewmaster reveal timeout
    if (this.viewmasterRevealTimeout) {
      clearTimeout(this.viewmasterRevealTimeout);
      this.viewmasterRevealTimeout = null;
    }

    // Clean up Web Audio API nodes
    if (this.audioSource) {
      try {
        this.audioSource.disconnect();
      } catch (e) {
        // Already disconnected
      }
      this.audioSource = null;
    }

    if (this.audioPanner) {
      try {
        this.audioPanner.disconnect();
      } catch (e) {
        // Already disconnected
      }
      this.audioPanner = null;
    }

    if (this.audioGain) {
      try {
        this.audioGain.disconnect();
      } catch (e) {
        // Already disconnected
      }
      this.audioGain = null;
    }

    // Note: Don't close audioContext as it's shared globally

    if (this.videoMesh) {
      if (this.videoMesh.parent) {
        this.videoMesh.parent.remove(this.videoMesh);
      }
      if (this.videoMesh.geometry) {
        this.videoMesh.geometry.dispose();
      }
      if (this.videoMesh.material) {
        this.videoMesh.material.dispose();
      }
    }

    if (this.videoTexture) {
      this.videoTexture.dispose();
    }

    if (this.video) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
      this.video = null;
    }
  }
}

export default VideoManager;

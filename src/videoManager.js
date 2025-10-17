import * as THREE from "three";
import { videos } from "./videoData.js";
import { checkCriteria } from "./criteriaHelper.js";

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

    // Track active video players
    this.videoPlayers = new Map(); // id -> VideoPlayer instance
    this.playedOnce = new Set(); // Track videos that have played once
    this.pendingDelays = new Map(); // id -> setTimeout handle for delayed playback

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
   * Update all videos based on current game state
   * Checks criteria for each video and plays/stops accordingly
   * Supports separate spawnCriteria and playCriteria for advanced control
   * @param {Object} state - Current game state
   */
  updateVideosForState(state) {
    // Check all videos defined in videoData
    for (const [videoId, videoConfig] of Object.entries(videos)) {
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
        // Video should exist - create player if it doesn't exist yet
        if (!exists) {
          this.playVideo(videoId); // Creates player

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
                  requestAnimationFrame(() => {
                    newPlayer.video.pause();
                    newPlayer.video.currentTime = 0;
                    newPlayer.isPlaying = false;

                    // Schedule delayed playback
                    if (delay > 0) {
                      const timeoutId = setTimeout(() => {
                        this.pendingDelays.delete(videoId);
                        this.playVideo(videoId);
                      }, delay * 1000);

                      this.pendingDelays.set(videoId, timeoutId);
                      console.log(
                        `VideoManager: Spawned video "${videoId}" (paused), will play in ${delay}s`
                      );
                    } else {
                      // No delay, play immediately
                      console.log(
                        `VideoManager: Spawned video "${videoId}" (paused, first frame visible)`
                      );
                      this.playVideo(videoId);
                    }
                  });
                })
                .catch((err) => {
                  console.warn(
                    `VideoManager: Failed to render first frame for "${videoId}":`,
                    err
                  );
                  newPlayer.video.pause();
                  newPlayer.isPlaying = false;
                });
            }
          }
          // State-based play: pause and wait for playCriteria
          else if (!matchesPlayCriteria) {
            const newPlayer = this.videoPlayers.get(videoId);
            if (newPlayer && newPlayer.video) {
              // Play briefly to render first frame, then pause
              newPlayer.video
                .play()
                .then(() => {
                  requestAnimationFrame(() => {
                    newPlayer.video.pause();
                    newPlayer.video.currentTime = 0;
                    newPlayer.isPlaying = false;
                    console.log(
                      `VideoManager: Spawned video "${videoId}" (paused, waiting for play criteria)`
                    );
                  });
                })
                .catch((err) => {
                  console.warn(
                    `VideoManager: Failed to render first frame for "${videoId}":`,
                    err
                  );
                  newPlayer.video.pause();
                  newPlayer.isPlaying = false;
                });
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
              console.log(
                `VideoManager: Scheduled video "${videoId}" to play in ${delay}s`
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
          console.log(
            `VideoManager: Cancelled delayed playback for "${videoId}"`
          );
        }

        // Stop and remove video if it exists
        if (exists) {
          this.stopVideo(videoId);
        }
      }
    }
  }

  /**
   * Play a video by ID
   * @param {string} videoId - Video ID from videoData.js
   */
  playVideo(videoId) {
    const videoConfig = videos[videoId];
    if (!videoConfig) {
      console.warn(`VideoManager: Video not found: ${videoId}`);
      return;
    }

    // Get or create video player
    let player = this.videoPlayers.get(videoId);

    if (!player) {
      player = new VideoPlayer({
        scene: this.scene,
        gameManager: this.gameManager,
        camera: this.camera,
        videoPath: videoConfig.videoPath,
        position: videoConfig.position,
        rotation: videoConfig.rotation,
        scale: videoConfig.scale,
        loop: videoConfig.loop,
        muted: videoConfig.muted,
        volume: videoConfig.volume,
        playbackRate: videoConfig.playbackRate,
        spatialAudio: videoConfig.spatialAudio,
        audioPositionOffset: videoConfig.audioPositionOffset,
        pannerAttr: videoConfig.pannerAttr,
        billboard: videoConfig.billboard,
      });

      player.initialize();
      this.videoPlayers.set(videoId, player);

      // Register with gizmo manager if gizmo flag is set
      if (videoConfig.gizmo) {
        // Disable billboard for gizmo-enabled videos to avoid conflict
        player.config.billboard = false;
        console.log(
          `VideoManager: Disabled billboard for "${videoId}" (gizmo enabled)`
        );

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
          console.error("VideoManager: Failed to set hasGizmoInData:", e);
        }
      }

      // Handle video end
      player.video.addEventListener("ended", () => {
        if (videoConfig.once) {
          this.playedOnce.add(videoId);
        }

        if (videoConfig.onComplete) {
          videoConfig.onComplete(this.gameManager);
        }
      });
    }

    // Retry gizmo registration if it was delayed
    if (
      player._needsGizmoRegistration &&
      this.gizmoManager &&
      player.videoMesh
    ) {
      // Disable billboard for gizmo-enabled videos to avoid conflict
      player.config.billboard = false;

      console.log(
        `VideoManager: Retry registering "${videoId}" with gizmo and selecting it`
      );
      this.gizmoManager.registerObject(player.videoMesh, videoId, "video");
      if (typeof this.gizmoManager.selectObjectById === "function") {
        this.gizmoManager.selectObjectById(videoId);
      }
      player._needsGizmoRegistration = false;
    }

    player.play();
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
   * Update all active videos (call in animation loop)
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    this.videoPlayers.forEach((player) => player.update(dt));
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
    this.video.preload = "auto";
    this.video.playbackRate = this.config.playbackRate;

    // Set up spatial audio if enabled
    if (this.config.spatialAudio && !this.config.muted) {
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
    this.videoMesh.name = "video-player";

    // Store initial rotation for billboarding offset
    this.initialRotation = {
      x: this.config.rotation.x,
      y: this.config.rotation.y,
      z: this.config.rotation.z,
    };

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
      console.error("VideoPlayer: Video error:", e);
      console.error("VideoPlayer: Video error code:", this.video.error?.code);
      console.error(
        "VideoPlayer: Video error message:",
        this.video.error?.message
      );
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

      await this.video.play();

      // Start video frame callback loop if supported
      if (this.useVideoFrameCallback && !this.pendingVideoFrame) {
        this.scheduleVideoFrameCallback();
      }
    } catch (error) {
      console.error("VideoPlayer: Failed to play video", error);
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
  pause() {
    if (this.video) {
      this.video.pause();
    }
  }

  /**
   * Stop the video
   */
  stop() {
    if (this.video) {
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
    if (this.videoMesh) {
      this.videoMesh.visible = visible;
    }
  }

  /**
   * Update method - call in animation loop
   */
  update(dt) {
    // Draw video to canvas only if not using video frame callback
    // (If using callback, frames are drawn in scheduleVideoFrameCallback instead)
    if (!this.useVideoFrameCallback) {
      if (
        this.canvasReady &&
        this.isPlaying &&
        this.video &&
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

    // Update spatial audio listener position
    if (this.config.spatialAudio && this.isPlaying) {
      this.updateSpatialAudio(this.camera);
    }

    // Billboard to camera if enabled (Y-axis only)
    if (this.config.billboard && this.videoMesh && this.camera) {
      // Calculate angle to camera in XZ plane only
      const dx = this.camera.position.x - this.videoMesh.position.x;
      const dz = this.camera.position.z - this.videoMesh.position.z;
      const angle = Math.atan2(dx, dz);

      // Apply only Y rotation, preserve original X and Z rotations
      this.videoMesh.rotation.y = angle;
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

      console.log(
        `VideoPlayer: Spatial audio enabled at world position [${audioWorldPos.x}, ${audioWorldPos.y}, ${audioWorldPos.z}] (video pos + offset)`
      );
    } catch (error) {
      console.error("VideoPlayer: Failed to set up spatial audio:", error);
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
    this.stop();

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
      this.video.src = "";
      this.video.load();
    }
  }
}

export default VideoManager;

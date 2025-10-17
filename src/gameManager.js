import { getSceneObjectsForState } from "./sceneData.js";
import { startScreen, GAME_STATES } from "./gameData.js";
import { getDebugSpawnState, isDebugSpawnActive } from "./debugSpawner.js";
import PhoneBooth from "./content/phonebooth.js";
import VideoManager from "./videoManager.js";

/**
 * GameManager - Central game state and event management
 *
 * Features:
 * - Manage game state
 * - Trigger events
 * - Coordinate between different systems
 */

class GameManager {
  constructor() {
    // Check for debug spawn state first
    const debugState = getDebugSpawnState();
    this.state = debugState ? { ...debugState } : { ...startScreen };
    this.isDebugMode = isDebugSpawnActive();

    if (this.isDebugMode) {
      console.log("GameManager: Debug mode active", this.state);
    }

    this.eventListeners = {};
    this.dialogManager = null;
    this.musicManager = null;
    this.sfxManager = null;
    this.uiManager = null;
    this.sceneManager = null;
    this.phoneBooth = null;

    // Track loaded scene objects
    this.loadedScenes = new Set();

    // Parse URL parameters on construction
    this.urlParams = this.parseURLParams();
  }

  /**
   * Parse URL parameters
   * @returns {Object} Object with URL parameters
   */
  parseURLParams() {
    const params = {};
    const searchParams = new URLSearchParams(window.location.search);

    for (const [key, value] of searchParams) {
      params[key] = value;
    }

    console.log("GameManager: URL params:", params);
    return params;
  }

  /**
   * Get a URL parameter value
   * @param {string} key - Parameter name
   * @returns {string|null} Parameter value or null if not found
   */
  getURLParam(key) {
    return this.urlParams[key] || null;
  }

  /**
   * Get the debug spawn character position if in debug mode
   * @returns {Object|null} Position {x, y, z} or null
   */
  getDebugSpawnPosition() {
    if (!this.isDebugMode || !this.state.playerPosition) {
      return null;
    }
    return { ...this.state.playerPosition };
  }

  /**
   * Initialize with managers
   * @param {Object} managers - Object containing manager instances
   */
  async initialize(managers = {}) {
    this.dialogManager = managers.dialogManager;
    this.musicManager = managers.musicManager;
    this.sfxManager = managers.sfxManager;
    this.uiManager = managers.uiManager;
    this.characterController = managers.characterController;
    this.cameraAnimationManager = managers.cameraAnimationManager;
    this.sceneManager = managers.sceneManager;
    this.lightManager = managers.lightManager;
    this.inputManager = managers.inputManager;
    this.camera = managers.camera; // Store camera reference
    // Add other managers as needed

    // Set up internal event handlers
    this.setupEventHandlers();

    // Load initial scene objects based on starting state
    if (this.sceneManager) {
      await this.updateSceneForState();
      // Trigger initial animation check after loading
      this.sceneManager.updateAnimationsForState(this.state);
    }

    // Initialize content-specific systems AFTER scene is loaded
    this.phoneBooth = new PhoneBooth({
      sceneManager: this.sceneManager,
      lightManager: this.lightManager,
      sfxManager: this.sfxManager,
      physicsManager: managers.physicsManager,
      scene: managers.scene,
      camera: this.camera,
      characterController: this.characterController,
    });
    this.phoneBooth.initialize(this);

    // Initialize video manager with state-based playback
    this.videoManager = new VideoManager({
      scene: managers.scene,
      gameManager: this,
      camera: this.camera,
    });

    // Note: Music, dialogs, SFX, and videos are now handled by their respective managers via state:changed events
    // They handle initial state when their listeners are set up
  }

  /**
   * Set up internal event handlers for game-level logic
   * Note: Individual managers (CharacterController, CameraAnimationManager,
   * MusicManager, DialogManager, SFXManager) now handle their own events directly
   */
  setupEventHandlers() {
    // Listen for character controller enable/disable to manage input
    this.on("character-controller:enabled", () => {
      if (this.inputManager) {
        this.inputManager.enable();
        this.inputManager.showTouchControls();
      }
    });

    this.on("character-controller:disabled", () => {
      if (this.inputManager) {
        this.inputManager.disable();
        this.inputManager.hideTouchControls();
      }
    });
  }

  /**
   * Set game state
   * @param {Object} newState - State updates to apply
   */
  setState(newState) {
    const oldState = { ...this.state };
    this.state = { ...this.state, ...newState };

    // Log state changes
    if (
      newState.currentState !== undefined &&
      newState.currentState !== oldState.currentState
    ) {
      console.log(
        `GameManager: State changed from ${oldState.currentState} to ${newState.currentState}`
      );
    }
    if (Object.keys(newState).length > 0) {
      console.log("GameManager: setState called with:", newState);
    }

    this.emit("state:changed", this.state, oldState);

    // Update scene objects based on new state (load new objects if needed)
    if (this.sceneManager && newState.currentState !== oldState.currentState) {
      this.updateSceneForState();
    }

    // Update scene animations based on new state
    if (this.sceneManager) {
      this.sceneManager.updateAnimationsForState(this.state);
    }

    // Update character controller based on new state
    this.updateCharacterController();
  }

  /**
   * Get current state
   * @returns {Object}
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Update character controller based on current game state
   */
  updateCharacterController() {
    if (!this.characterController) return;

    // Enable character controller when controlEnabled state is true
    if (this.state.controlEnabled === true) {
      console.log("GameManager: Enabling character controller");
      this.characterController.headbobEnabled = true;
      this.emit("character-controller:enabled");
    } else if (this.state.controlEnabled === false) {
      console.log("GameManager: Disabling character controller");
      this.characterController.headbobEnabled = false;
      this.emit("character-controller:disabled");
    }
  }

  /**
   * Update scene objects based on current game state
   * Loads new objects that match current state conditions
   */
  async updateSceneForState() {
    if (!this.sceneManager) return;

    const objectsToLoad = getSceneObjectsForState(this.state);

    // Filter out objects that are already loaded
    const newObjects = objectsToLoad.filter(
      (obj) => !this.loadedScenes.has(obj.id)
    );

    if (newObjects.length > 0) {
      console.log(
        `GameManager: Loading ${newObjects.length} new scene objects for state`
      );
      await this.sceneManager.loadObjectsForState(newObjects);

      // Track loaded objects
      newObjects.forEach((obj) => this.loadedScenes.add(obj.id));
    }
  }

  /**
   * Check if character controller is enabled
   * @returns {boolean}
   */
  isControlEnabled() {
    return this.state.controlEnabled === true;
  }

  /**
   * Pause the game
   */
  pause() {
    this.setState({ isPaused: true });
    this.emit("game:paused");
  }

  /**
   * Resume the game
   */
  resume() {
    this.setState({ isPaused: false });
    this.emit("game:resumed");
  }

  /**
   * Start the game
   */
  start() {
    this.setState({ isPlaying: true, isPaused: false });
    this.emit("game:started");
  }

  /**
   * Stop the game
   */
  stop() {
    this.setState({ isPlaying: false, isPaused: false });
    this.emit("game:stopped");
  }

  /**
   * Add event listener
   * @param {string} event - Event name
   * @param {function} callback - Callback function
   */
  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
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
   * Emit an event
   * @param {string} event - Event name
   * @param {...any} args - Arguments to pass to callbacks
   */
  emit(event, ...args) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach((callback) => callback(...args));
    }
  }

  /**
   * Update method - call in animation loop if needed
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    // Update content-specific systems
    if (this.phoneBooth) {
      this.phoneBooth.update(dt);
    }

    // Add any per-frame game logic here
    this.emit("game:update", dt);
  }
}

export default GameManager;

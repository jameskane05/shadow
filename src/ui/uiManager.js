/**
 * UIManager - Centralized UI management system
 *
 * Features:
 * - Manages z-index layers for all UI elements
 * - Handles UI stack (what's on top)
 * - Integrates with GameManager
 * - Prevents UI conflicts and overlap issues
 * - Instantiates and manages UI components
 */

import { IdleHelper } from "./idleHelper.js";
import { FullscreenButton } from "./fullscreenButton.js";
// import { SplatCounter } from "./splatCounter.js";
import { uiElements } from "./uiData.js";

export class UIManager {
  constructor(gameManager = null) {
    this.gameManager = gameManager;

    // Z-index layer definitions (higher = more on top)
    this.layers = {
      BACKGROUND: 1000, // Background UI elements
      GAME_HUD: 2000, // In-game HUD elements
      MAIN_MENU: 3000, // Main menu, intro screen
      PAUSE_MENU: 4000, // Pause/options menus
      DIALOG: 5000, // Dialog/subtitle overlays
      MODAL: 6000, // Modal dialogs
      TOOLTIP: 7000, // Tooltips and notifications
      DEBUG: 9000, // Debug overlays
    };

    // Track active UI elements
    this.activeElements = new Map();

    // Stack of open UIs (top of stack = visible/active)
    this.uiStack = [];

    // Reference to registered UI components
    this.components = {
      introScreen: null,
      optionsMenu: null,
      dialogManager: null,
      idleHelper: null,
      fullscreenButton: null,
      splatCounter: null,
      // Add more as needed
    };

    // Detect platform and set game state
    this.detectPlatform();
  }

  /**
   * Detect platform capabilities and update game state
   */
  detectPlatform() {
    // Detect iOS (which doesn't support fullscreen API)
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPad with iOS 13+

    // Check if any fullscreen API is available
    const isFullscreenSupported =
      !isIOS &&
      (document.fullscreenEnabled ||
        document.webkitFullscreenEnabled ||
        document.mozFullScreenEnabled ||
        document.msFullscreenEnabled);

    // Update game state
    if (this.gameManager) {
      this.gameManager.setState({
        isIOS: isIOS,
        isFullscreenSupported: isFullscreenSupported,
      });
    }

    console.log(
      `UIManager: Platform detected - iOS: ${isIOS}, Fullscreen supported: ${isFullscreenSupported}`
    );
  }

  /**
   * Initialize UI components that depend on other managers
   * Call this after all managers are created
   * @param {Object} dependencies - Required manager dependencies
   */
  initializeComponents(dependencies = {}) {
    const {
      dialogManager,
      cameraAnimationManager,
      dialogChoiceUI,
      inputManager,
      characterController,
      sparkRenderer,
    } = dependencies;

    // Initialize idle helper (shows WASD controls when player is idle)
    this.components.idleHelper = new IdleHelper(
      dialogManager,
      cameraAnimationManager,
      dialogChoiceUI,
      this.gameManager,
      inputManager,
      characterController
    );

    // Wire up idle helper to character controller for glance system
    if (characterController) {
      characterController.setIdleHelper(this.components.idleHelper);
    }

    // Initialize fullscreen button (visible by default)
    this.components.fullscreenButton = new FullscreenButton({
      uiManager: this,
      gameManager: this.gameManager,
      config: uiElements.FULLSCREEN_BUTTON,
    });
  }

  /**
   * Create a DOM element from uiData config
   * @param {Object} config - UI element configuration
   * @returns {HTMLElement}
   */
  createElementFromConfig(config) {
    const element = document.createElement("div");
    element.id = config.id;

    // Apply styles
    if (config.style) {
      Object.assign(element.style, config.style);
    }

    // Apply position
    if (config.position) {
      Object.entries(config.position).forEach(([key, value]) => {
        element.style[key] = value;
      });
    }

    // Add to DOM
    document.body.appendChild(element);

    // Register with UI manager
    this.registerElement(config.id, element, config.layer, {
      blocksInput: config.blocksInput,
      pausesGame: config.pausesGame,
    });

    return element;
  }

  /**
   * Register a UI component
   * @param {string} name - Component name
   * @param {Object} component - Component instance
   */
  registerComponent(name, component) {
    this.components[name] = component;

    // Set up component's UI manager reference
    if (component.setUIManager) {
      component.setUIManager(this);
    }
  }

  /**
   * Get a registered component
   * @param {string} name - Component name
   * @returns {Object|null}
   */
  getComponent(name) {
    return this.components[name] || null;
  }

  /**
   * Register a UI element with proper z-index
   * @param {string} id - Unique identifier
   * @param {HTMLElement} element - The DOM element
   * @param {string} layer - Layer name from this.layers
   * @param {Object} options - Additional options
   */
  registerElement(id, element, layer = "MAIN_MENU", options = {}) {
    const zIndex = this.layers[layer] || this.layers.MAIN_MENU;

    element.style.zIndex = zIndex;

    this.activeElements.set(id, {
      element,
      layer,
      zIndex,
      isVisible: !element.classList.contains("hidden"),
      blocksInput: options.blocksInput !== false, // default true
      pausesGame: options.pausesGame || false,
    });

    return zIndex;
  }

  /**
   * Unregister a UI element
   * @param {string} id - Element identifier
   */
  unregisterElement(id) {
    this.activeElements.delete(id);
    this.removeFromStack(id);
  }

  /**
   * Show a UI element and add to stack
   * @param {string} id - Element identifier
   * @param {Object} options - Show options
   */
  show(id, options = {}) {
    const uiData = this.activeElements.get(id);
    if (!uiData) {
      console.warn(`UIManager: Element "${id}" not registered`);
      return;
    }

    // Hide element currently on top if it should be hidden
    if (options.hideOthers && this.uiStack.length > 0) {
      const topId = this.uiStack[this.uiStack.length - 1];
      this.hide(topId);
    }

    // Show the element
    uiData.element.classList.remove("hidden");
    uiData.isVisible = true;

    // Add to stack if not already there
    if (!this.uiStack.includes(id)) {
      this.uiStack.push(id);
    }

    // Handle game pause
    if (
      uiData.pausesGame &&
      this.gameManager &&
      !this.gameManager.state.isPaused
    ) {
      this.gameManager.pause();
    }

    // Emit event
    this.emit("ui:shown", id);
  }

  /**
   * Hide a UI element and remove from stack
   * @param {string} id - Element identifier
   * @param {Object} options - Hide options
   */
  hide(id, options = {}) {
    const uiData = this.activeElements.get(id);
    if (!uiData) return;

    // Hide the element
    uiData.element.classList.add("hidden");
    uiData.isVisible = false;

    // Remove from stack
    this.removeFromStack(id);

    // Handle game resume if no other pausing UI is active
    if (
      uiData.pausesGame &&
      this.gameManager &&
      this.gameManager.state.isPaused
    ) {
      // Check if any other visible UI pauses the game
      const anyPausingUIVisible = Array.from(this.activeElements.values()).some(
        (ui) => ui.isVisible && ui.pausesGame && ui !== uiData
      );

      if (!anyPausingUIVisible) {
        this.gameManager.resume();
      }
    }

    // Emit event
    this.emit("ui:hidden", id);
  }

  /**
   * Toggle a UI element
   * @param {string} id - Element identifier
   */
  toggle(id) {
    const uiData = this.activeElements.get(id);
    if (!uiData) return;

    if (uiData.isVisible) {
      this.hide(id);
    } else {
      this.show(id);
    }
  }

  /**
   * Remove element from UI stack
   * @param {string} id - Element identifier
   */
  removeFromStack(id) {
    const index = this.uiStack.indexOf(id);
    if (index > -1) {
      this.uiStack.splice(index, 1);
    }
  }

  /**
   * Get the currently active (top) UI element
   * @returns {string|null}
   */
  getActiveUI() {
    return this.uiStack.length > 0
      ? this.uiStack[this.uiStack.length - 1]
      : null;
  }

  /**
   * Check if input is currently blocked by UI
   * @returns {boolean}
   */
  isInputBlocked() {
    // Check if any visible UI blocks input
    for (const [id, uiData] of this.activeElements) {
      if (uiData.isVisible && uiData.blocksInput) {
        return true;
      }
    }
    return false;
  }

  /**
   * Hide all UI elements
   * @param {Array} except - IDs to exclude from hiding
   */
  hideAll(except = []) {
    for (const [id, uiData] of this.activeElements) {
      if (!except.includes(id) && uiData.isVisible) {
        this.hide(id);
      }
    }
  }

  /**
   * Get z-index for a layer
   * @param {string} layer - Layer name
   * @returns {number}
   */
  getLayerZIndex(layer) {
    return this.layers[layer] || this.layers.MAIN_MENU;
  }

  /**
   * Emit event to game manager
   * @param {string} event - Event name
   * @param {...any} args - Event arguments
   */
  emit(event, ...args) {
    if (this.gameManager && this.gameManager.emit) {
      this.gameManager.emit(event, ...args);
    }
  }

  /**
   * Update method - call each frame if needed
   * @param {number} dt - Delta time
   */
  update(dt) {
    // Update splat counter every frame
    if (this.components.splatCounter) {
      this.components.splatCounter.update();
    }
  }

  /**
   * Clean up
   */
  destroy() {
    this.activeElements.clear();
    this.uiStack = [];
    this.components = {};
  }
}

export default UIManager;

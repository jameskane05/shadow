/**
 * FullscreenButton - Manages fullscreen toggle button
 *
 * Features:
 * - Bottom-left corner placement
 * - Toggles fullscreen mode
 * - Integrates with UIManager
 * - Handles fullscreen change events
 */

export class FullscreenButton {
  constructor(options = {}) {
    this.uiManager = options.uiManager || null;
    this.gameManager = options.gameManager || null;
    this.config = options.config || {};

    // Create the button element
    this.createButton();

    // Listen for fullscreen changes to update button state
    this.bindFullscreenEvents();
  }

  /**
   * Create the fullscreen button element
   */
  createButton() {
    // Add keyframe animation for pulsing effect
    this.addPulseAnimation();

    // Create button container
    this.button = document.createElement("div");
    this.button.id = this.config.id || "fullscreen-button";

    // Create button image
    this.image = document.createElement("img");
    this.image.src = this.config.image || "/images/fullscreen.png";
    this.image.alt = "Toggle Fullscreen";
    this.image.style.cssText = `
      width: 100%;
      height: 100%;
      display: block;
      user-select: none;
      -webkit-user-drag: none;
      object-fit: contain;
      image-orientation: from-image;
    `;

    this.button.appendChild(this.image);

    // Apply base styles
    this.button.style.cssText = `
      position: fixed;
      bottom: ${this.config.position?.bottom || "20px"};
      left: ${this.config.position?.left || "20px"};
      width: ${this.config.size?.width || "48px"};
      height: ${this.config.size?.height || "48px"};
      cursor: ${this.config.style?.cursor || "pointer"};
      opacity: ${this.config.style?.opacity || "0.7"};
      transition: ${
        this.config.style?.transition ||
        "opacity 0.3s ease, transform 0.2s ease"
      };
      pointer-events: ${this.config.style?.pointerEvents || "all"};
      z-index: 2000;
    `;

    // Add hover effects with pulsing animation
    this.button.addEventListener("mouseenter", () => {
      this.button.style.animation =
        "fullscreenButtonPulse 1.5s ease-in-out infinite";
    });

    this.button.addEventListener("mouseleave", () => {
      this.button.style.animation = "none";
      this.button.style.opacity = this.config.style?.opacity || "1.0";
      this.button.style.transform = "scale(1)";
    });

    // Add click handler
    this.button.addEventListener("click", () => {
      this.toggleFullscreen();
    });

    // Add to document
    document.body.appendChild(this.button);

    // Register with UI manager if available
    if (this.uiManager) {
      this.uiManager.registerElement(
        this.config.id || "fullscreen-button",
        this.button,
        this.config.layer || "GAME_HUD",
        {
          blocksInput:
            this.config.blocksInput !== undefined
              ? this.config.blocksInput
              : false,
          pausesGame: this.config.pausesGame || false,
        }
      );
    }

    // Button is visible by default - fullscreen should always be available
    // (The button element is already added to the DOM above)
  }

  /**
   * Add CSS keyframe animation for pulsing effect
   */
  addPulseAnimation() {
    // Check if animation already exists
    const styleId = "fullscreen-button-pulse-animation";
    if (document.getElementById(styleId)) {
      return;
    }

    // Create style element with keyframe animation
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes fullscreenButtonPulse {
        0% {
          transform: scale(1);
          opacity: 1.0;
        }
        50% {
          transform: scale(1.15);
          opacity: 1.15;
        }
        100% {
          transform: scale(1);
          opacity: 1.0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Toggle fullscreen mode
   */
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      // Enter fullscreen
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn("Error attempting to enable fullscreen:", err);
      });
    } else {
      // Exit fullscreen
      document.exitFullscreen();
    }
  }

  /**
   * Bind fullscreen change events
   */
  bindFullscreenEvents() {
    document.addEventListener("fullscreenchange", () => {
      this.updateButtonState();
    });

    document.addEventListener("webkitfullscreenchange", () => {
      this.updateButtonState();
    });

    document.addEventListener("mozfullscreenchange", () => {
      this.updateButtonState();
    });

    document.addEventListener("MSFullscreenChange", () => {
      this.updateButtonState();
    });

    // Listen for resize events to detect F11 fullscreen
    window.addEventListener("resize", () => {
      this.updateButtonState();
    });

    // Check initial state
    this.updateButtonState();
  }

  /**
   * Check if browser is in fullscreen mode (including F11)
   */
  isInFullscreen() {
    // Check Fullscreen API first
    if (document.fullscreenElement) {
      return true;
    }

    // Check for browser-level fullscreen (F11)
    // Compare window dimensions to screen dimensions
    const isWindowFullscreen =
      window.innerHeight === screen.height &&
      window.innerWidth === screen.width;

    return isWindowFullscreen;
  }

  /**
   * Update button appearance based on fullscreen state
   */
  updateButtonState() {
    const isFullscreen = this.isInFullscreen();

    // Update game manager state
    if (this.gameManager) {
      this.gameManager.setState({ isFullscreen });
    }

    // Hide button when in fullscreen, show when not
    if (isFullscreen) {
      this.hide();
    } else {
      this.show();
    }

    // Update tooltip
    if (isFullscreen) {
      this.button.title = "Exit Fullscreen (ESC or F11)";
    } else {
      this.button.title = "Enter Fullscreen";
    }
  }

  /**
   * Show the button
   */
  show() {
    this.button.style.display = "block";
    if (this.uiManager) {
      this.uiManager.show(this.config.id || "fullscreen-button");
    }
  }

  /**
   * Hide the button
   */
  hide() {
    this.button.style.display = "none";
    if (this.uiManager) {
      this.uiManager.hide(this.config.id || "fullscreen-button");
    }
  }

  /**
   * Set UI manager reference
   * @param {UIManager} uiManager
   */
  setUIManager(uiManager) {
    this.uiManager = uiManager;
  }

  /**
   * Clean up
   */
  destroy() {
    if (this.button && this.button.parentNode) {
      this.button.parentNode.removeChild(this.button);
    }

    if (this.uiManager) {
      this.uiManager.unregisterElement(this.config.id || "fullscreen-button");
    }
  }
}

export default FullscreenButton;

/**
 * TouchJoystick - Virtual joystick for mobile touch controls
 *
 * Creates a visual joystick that responds to touch input within a range of motion.
 * Returns normalized values (-1 to 1) for X and Y axes.
 */

export class TouchJoystick {
  constructor(options = {}) {
    this.side = options.side || "left"; // 'left' or 'right'
    this.size = options.size || 120; // Outer circle diameter in pixels
    this.stickSize = options.stickSize || 50; // Inner stick diameter in pixels
    this.maxDistance = (this.size - this.stickSize) / 2; // Max stick travel distance
    this.deadzone = options.deadzone || 0.15; // Dead zone (0-1)

    // State
    this.active = false;
    this.touchId = null;
    this.centerX = 0;
    this.centerY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.deltaX = 0;
    this.deltaY = 0;

    // Create DOM elements
    this.createElements();
    this.setupEventListeners();

    // Only show on touch devices
    this.checkTouchSupport();
  }

  /**
   * Create the joystick DOM elements
   */
  createElements() {
    // Container
    this.container = document.createElement("div");
    this.container.className = `touch-joystick touch-joystick-${this.side}`;
    this.container.style.cssText = `
      position: fixed;
      ${this.side}: 30px;
      bottom: 30px;
      width: ${this.size}px;
      height: ${this.size}px;
      background: rgba(255, 255, 255, 0.1);
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      touch-action: none;
      user-select: none;
      z-index: 1000;
      display: none;
      opacity: 0.6;
      transition: opacity 0.2s;
    `;

    // Stick
    this.stick = document.createElement("div");
    this.stick.className = "touch-joystick-stick";
    this.stick.style.cssText = `
      position: absolute;
      width: ${this.stickSize}px;
      height: ${this.stickSize}px;
      background: rgba(255, 255, 255, 0.5);
      border: 2px solid rgba(255, 255, 255, 0.8);
      border-radius: 50%;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      transition: background 0.2s;
    `;

    this.container.appendChild(this.stick);
    document.body.appendChild(this.container);
  }

  /**
   * Check if device supports touch and show/hide accordingly
   * Note: Starts hidden by default, will be shown when controls are enabled
   */
  checkTouchSupport() {
    this.isTouchDevice =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;

    // Always start hidden - will be shown when character controller is enabled
    this.container.style.display = "none";
  }

  /**
   * Set up touch event listeners
   */
  setupEventListeners() {
    // Touch start
    this.container.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();

        if (this.active) return; // Already handling a touch

        const touch = e.changedTouches[0];
        this.touchId = touch.identifier;

        const rect = this.container.getBoundingClientRect();
        this.centerX = rect.left + rect.width / 2;
        this.centerY = rect.top + rect.height / 2;

        this.active = true;
        this.container.style.opacity = "1";
        this.stick.style.background = "rgba(255, 255, 255, 0.8)";

        this.updatePosition(touch.clientX, touch.clientY);
      },
      { passive: false }
    );

    // Touch move
    window.addEventListener(
      "touchmove",
      (e) => {
        if (!this.active) return;

        // Find our touch
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i];
          if (touch.identifier === this.touchId) {
            e.preventDefault();
            this.updatePosition(touch.clientX, touch.clientY);
            break;
          }
        }
      },
      { passive: false }
    );

    // Touch end
    const handleTouchEnd = (e) => {
      if (!this.active) return;

      // Check if our touch ended
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.touchId) {
          this.reset();
          break;
        }
      }
    };

    window.addEventListener("touchend", handleTouchEnd, { passive: false });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: false });
  }

  /**
   * Update stick position based on touch coordinates
   */
  updatePosition(touchX, touchY) {
    // Calculate delta from center
    let dx = touchX - this.centerX;
    let dy = touchY - this.centerY;

    // Calculate distance and constrain to max
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > this.maxDistance) {
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * this.maxDistance;
      dy = Math.sin(angle) * this.maxDistance;
    }

    // Update stick visual position
    this.stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // Store current position
    this.currentX = dx;
    this.currentY = dy;

    // Calculate normalized delta (-1 to 1)
    this.deltaX = dx / this.maxDistance;
    this.deltaY = dy / this.maxDistance;

    // Apply deadzone
    const magnitude = Math.sqrt(
      this.deltaX * this.deltaX + this.deltaY * this.deltaY
    );
    if (magnitude < this.deadzone) {
      this.deltaX = 0;
      this.deltaY = 0;
    } else {
      // Remap from [deadzone, 1] to [0, 1]
      const scale =
        (magnitude - this.deadzone) / (1 - this.deadzone) / magnitude;
      this.deltaX *= scale;
      this.deltaY *= scale;
    }
  }

  /**
   * Reset joystick to center
   */
  reset() {
    this.active = false;
    this.touchId = null;
    this.currentX = 0;
    this.currentY = 0;
    this.deltaX = 0;
    this.deltaY = 0;

    // Reset visual
    this.stick.style.transform = "translate(-50%, -50%)";
    this.container.style.opacity = "0.6";
    this.stick.style.background = "rgba(255, 255, 255, 0.5)";
  }

  /**
   * Get current joystick values
   * @returns {{x: number, y: number}} Normalized values (-1 to 1)
   */
  getValue() {
    return {
      x: this.deltaX,
      y: -this.deltaY, // Invert Y for game coordinates (up = positive)
    };
  }

  /**
   * Check if joystick is currently active
   * @returns {boolean}
   */
  isActive() {
    return this.active;
  }

  /**
   * Show the joystick (only on touch devices)
   */
  show() {
    if (this.isTouchDevice) {
      this.container.style.display = "block";
    }
  }

  /**
   * Hide the joystick
   */
  hide() {
    this.container.style.display = "none";
    this.reset();
  }

  /**
   * Destroy the joystick and remove from DOM
   */
  destroy() {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}

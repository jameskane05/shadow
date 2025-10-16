/**
 * OptionsMenu - Manages the in-game options/settings menu
 *
 * Features:
 * - Opens/closes with short Escape key press (< 200ms)
 * - Music volume slider
 * - Pause game when open
 * - Save settings to localStorage
 */

class OptionsMenu {
  constructor(options = {}) {
    this.musicManager = options.musicManager || null;
    this.sfxManager = options.sfxManager || null;
    this.gameManager = options.gameManager || null;
    this.sparkRenderer = options.sparkRenderer || null;
    this.uiManager = options.uiManager || null;
    this.characterController = options.characterController || null;
    this.startScreen = options.startScreen || null;
    this.isOpen = false;

    // Settings with defaults
    this.settings = {
      musicVolume: 0.6,
      sfxVolume: 0.5,
      dofEnabled: true,
      ...this.loadSettings(),
    };

    // Escape key tracking
    this.escapeKeyDownTime = null;

    // Create menu elements
    this.menuElement = this.createMenuHTML();
    this.bindEvents();
    this.bindKeyboardEvents();

    // Apply initial settings (includes updateUI)
    this.applySettings();

    // Register with UI manager if available
    if (this.uiManager) {
      this.uiManager.registerElement(
        "options-menu",
        this.menuElement,
        "PAUSE_MENU",
        {
          blocksInput: true,
          pausesGame: true,
        }
      );

      // Listen for UI manager events to sync isOpen state
      if (this.uiManager.gameManager) {
        this.uiManager.gameManager.on("ui:shown", (id) => {
          if (id === "options-menu") {
            this.isOpen = true;
            this.updateUI();
            // Request pointer lock release
            if (document.pointerLockElement) {
              document.exitPointerLock();
            }
          }
        });

        this.uiManager.gameManager.on("ui:hidden", (id) => {
          if (id === "options-menu") {
            this.isOpen = false;
          }
        });
      }
    }
  }

  /**
   * Create the HTML structure for the options menu
   */
  createMenuHTML() {
    const menu = document.createElement("div");
    menu.id = "options-menu";
    menu.className = "options-menu hidden";

    menu.innerHTML = `
      <div class="options-overlay"></div>
      <div class="options-container">
        <div class="options-header">
          <h2 class="options-title">OPTIONS</h2>
          <button class="close-button" id="close-button" aria-label="Close">×</button>
        </div>
        
        <div class="options-content">
          <!-- Music Volume -->
          <div class="option-group">
            <label class="option-label" for="music-volume">
              Music Volume
              <span class="option-value" id="music-volume-value">60%</span>
            </label>
            <input 
              type="range" 
              id="music-volume" 
              class="option-slider"
              min="0" 
              max="100" 
              value="60"
            >
          </div>

          <!-- SFX Volume -->
          <div class="option-group">
            <label class="option-label" for="sfx-volume">
              SFX & Dialog Volume
              <span class="option-value" id="sfx-volume-value">50%</span>
            </label>
            <input 
              type="range" 
              id="sfx-volume" 
              class="option-slider"
              min="0" 
              max="100" 
              value="50"
            >
          </div>

          <!-- DoF Enable Checkbox -->
          <div class="option-group">
            <label class="option-label checkbox-label" for="dof-enabled">
              Depth of Field
              <input 
                type="checkbox" 
                id="dof-enabled" 
                class="option-checkbox"
                checked
              >
            </label>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(menu);
    return menu;
  }

  /**
   * Bind keyboard event listeners (ESC key)
   */
  bindKeyboardEvents() {
    // Global escape key handler (only works when game is active, not during intro)
    // Track ESC key press time to distinguish between quick press (menu) and held (exit fullscreen)
    this.keydownHandler = (e) => {
      if (
        e.key === "Escape" &&
        (!this.startScreen || !this.startScreen.isActive)
      ) {
        // Record when ESC was first pressed (ignore repeat events)
        if (!e.repeat && this.escapeKeyDownTime === null) {
          this.escapeKeyDownTime = Date.now();
        }
      }
    };

    this.keyupHandler = (e) => {
      if (
        e.key === "Escape" &&
        (!this.startScreen || !this.startScreen.isActive)
      ) {
        e.preventDefault();

        // Only toggle menu if ESC was pressed for less than 200ms (short press)
        if (this.escapeKeyDownTime !== null) {
          const pressDuration = Date.now() - this.escapeKeyDownTime;

          if (pressDuration < 200) {
            this.toggle();
          }

          this.escapeKeyDownTime = null;
        }
      }
    };

    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("keyup", this.keyupHandler);
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Music volume slider
    const musicSlider = document.getElementById("music-volume");
    const musicValue = document.getElementById("music-volume-value");

    musicSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      musicValue.textContent = `${value}%`;
      musicSlider.style.setProperty("--value", `${value}%`);
      this.settings.musicVolume = value / 100;
      this.applyMusicVolume();
    });

    musicSlider.addEventListener("change", () => {
      this.saveSettings();
    });

    // SFX volume slider
    const sfxSlider = document.getElementById("sfx-volume");
    const sfxValue = document.getElementById("sfx-volume-value");

    sfxSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      sfxValue.textContent = `${value}%`;
      sfxSlider.style.setProperty("--value", `${value}%`);
      this.settings.sfxVolume = value / 100;
      this.applySfxVolume();
    });

    sfxSlider.addEventListener("change", () => {
      this.saveSettings();
    });

    // DoF Enable checkbox
    const dofEnabledCheckbox = document.getElementById("dof-enabled");

    dofEnabledCheckbox.addEventListener("change", (e) => {
      this.settings.dofEnabled = e.target.checked;
      this.applyDepthOfField();
      this.saveSettings();
    });

    // Close button
    const closeButton = document.getElementById("close-button");
    if (closeButton) {
      closeButton.addEventListener("click", (e) => {
        e.stopPropagation();
        this.close();
      });
    } else {
      console.error("Close button not found!");
    }

    // Click overlay to close
    this.menuElement
      .querySelector(".options-overlay")
      .addEventListener("click", () => {
        this.close();
      });
  }

  /**
   * Open the options menu
   */
  open() {
    if (this.isOpen) return;

    this.isOpen = true;

    // Use UI manager if available, otherwise handle directly
    if (this.uiManager) {
      this.uiManager.show("options-menu");
    } else {
      this.menuElement.classList.remove("hidden");
      // Pause game if game manager exists
      if (this.gameManager && this.gameManager.pause) {
        this.gameManager.pause();
      }
    }

    // Request pointer lock release
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // Update UI to reflect current settings
    this.updateUI();
  }

  /**
   * Close the options menu
   */
  close() {
    if (!this.isOpen) return;

    this.isOpen = false;

    // Use UI manager if available, otherwise handle directly
    if (this.uiManager) {
      this.uiManager.hide("options-menu");
    } else {
      this.menuElement.classList.add("hidden");
      // Resume game if game manager exists
      if (this.gameManager && this.gameManager.resume) {
        this.gameManager.resume();
      }
    }
  }

  /**
   * Toggle menu open/close
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Update UI elements to reflect current settings
   */
  updateUI() {
    const musicSlider = document.getElementById("music-volume");
    const musicValue = document.getElementById("music-volume-value");
    const sfxSlider = document.getElementById("sfx-volume");
    const sfxValue = document.getElementById("sfx-volume-value");
    const dofEnabledCheckbox = document.getElementById("dof-enabled");

    const musicPercent = Math.round(this.settings.musicVolume * 100);
    const sfxPercent = Math.round(this.settings.sfxVolume * 100);

    musicSlider.value = musicPercent;
    musicValue.textContent = `${musicPercent}%`;
    musicSlider.style.setProperty("--value", `${musicPercent}%`);

    sfxSlider.value = sfxPercent;
    sfxValue.textContent = `${sfxPercent}%`;
    sfxSlider.style.setProperty("--value", `${sfxPercent}%`);

    dofEnabledCheckbox.checked = this.settings.dofEnabled;
  }

  /**
   * Apply music volume setting
   */
  applyMusicVolume() {
    if (this.musicManager && this.musicManager.setVolume) {
      this.musicManager.setVolume(this.settings.musicVolume, 0.1);
    }
  }

  /**
   * Apply SFX volume setting
   */
  applySfxVolume() {
    // Apply to all sound effects through SFX manager
    if (this.sfxManager) {
      this.sfxManager.setMasterVolume(this.settings.sfxVolume);
    }
  }

  /**
   * Apply depth of field settings
   */
  applyDepthOfField() {
    // Notify character controller of DoF enabled state
    if (this.characterController && this.characterController.setDofEnabled) {
      this.characterController.setDofEnabled(this.settings.dofEnabled);
    }
  }

  /**
   * Apply all settings
   */
  applySettings() {
    this.applyMusicVolume();
    this.applySfxVolume();
    this.applyDepthOfField();
    this.updateUI();
  }

  /**
   * Save settings to localStorage
   */
  saveSettings() {
    try {
      localStorage.setItem("gameSettings", JSON.stringify(this.settings));
    } catch (e) {
      console.warn("Failed to save settings:", e);
    }
  }

  /**
   * Load settings from localStorage
   */
  loadSettings() {
    try {
      const saved = localStorage.getItem("gameSettings");
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.warn("Failed to load settings:", e);
      return {};
    }
  }

  /**
   * Get current settings
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Clean up
   */
  destroy() {
    // Remove keyboard event listeners
    if (this.keydownHandler) {
      window.removeEventListener("keydown", this.keydownHandler);
    }
    if (this.keyupHandler) {
      window.removeEventListener("keyup", this.keyupHandler);
    }

    if (this.menuElement && this.menuElement.parentNode) {
      this.menuElement.parentNode.removeChild(this.menuElement);
    }
  }
}

export default OptionsMenu;

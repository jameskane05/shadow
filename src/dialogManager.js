import { Howl } from "howler";
import * as THREE from "three";

/**
 * DialogManager - Handles dialog audio playback with synchronized captions
 *
 * Features:
 * - Play dialog audio files
 * - Display synchronized captions (HTML)
 * - Event-based triggering
 * - Queue multiple dialog sequences
 * - Callback support for dialog completion
 */

class DialogManager {
  constructor(options = {}) {
    this.scene = options.scene || null;
    this.camera = options.camera || null;
    this.sfxManager = options.sfxManager || null;
    this.gameManager = options.gameManager || null;
    this.dialogChoiceUI = options.dialogChoiceUI || null;

    // Caption display (HTML)
    this.captionElement = options.captionElement || this.createCaptionElement();

    // Apply custom caption styling if provided, otherwise use defaults
    if (options.captionStyle) {
      this.setCaptionStyle(options.captionStyle);
    } else {
      this.applyDefaultCaptionStyle();
    }

    this.baseVolume = options.audioVolume || 0.8;
    this.audioVolume = this.baseVolume;
    this.currentDialog = null;
    this.currentAudio = null;
    this.captionQueue = [];
    this.captionIndex = 0;
    this.captionTimer = 0;
    this.isPlaying = false;
    this.onCompleteCallback = null;

    // Delayed playback support
    this.pendingDialogs = new Map(); // Map of dialogId -> { dialogData, onComplete, timer, delay }

    // Update volume based on SFX manager if available
    if (this.sfxManager) {
      this.audioVolume = this.baseVolume * this.sfxManager.getMasterVolume();
    }

    // Event listeners
    this.eventListeners = {
      "dialog:play": [],
      "dialog:stop": [],
      "dialog:complete": [],
      "dialog:caption": [],
    };

    // Set up state change listener if gameManager is provided
    if (this.gameManager) {
      this.setupStateListener();
    }
  }

  /**
   * Set game manager and register event listeners
   * @param {GameManager} gameManager - The game manager instance
   */
  setGameManager(gameManager) {
    this.gameManager = gameManager;
    this.setupStateListener();
  }

  /**
   * Set up state change listener for auto-playing dialogs
   */
  setupStateListener() {
    if (!this.gameManager) return;

    // Track played dialogs for "once" functionality
    this.playedDialogs = new Set();

    // Import getDialogsForState
    import("./dialogData.js").then(({ getDialogsForState }) => {
      // Listen for state changes
      this.gameManager.on("state:changed", (newState, oldState) => {
        const matchingDialogs = getDialogsForState(
          newState,
          this.playedDialogs
        );

        // If there are matching dialogs for the new state
        if (matchingDialogs.length > 0) {
          const dialog = matchingDialogs[0];

          // Cancel any pending dialogs if we have a higher priority one
          if (this.hasDialogsPending()) {
            console.log(
              `DialogManager: Canceling pending dialogs for new dialog "${dialog.id}"`
            );
            this.cancelAllDelayedDialogs();
          }

          console.log(`DialogManager: Auto-playing dialog "${dialog.id}"`);

          // Track that this dialog has been played
          this.playedDialogs.add(dialog.id);

          // Emit event for tracking
          this.gameManager.emit("dialog:trigger", dialog.id, dialog);

          // Play the dialog
          this.playDialog(dialog, (completedDialog) => {
            this.gameManager.emit("dialog:finished", completedDialog);
          });
        }
      });

      console.log("DialogManager: Event listeners registered");
    });
  }

  /**
   * Create default caption element if none provided
   */
  createCaptionElement() {
    const caption = document.createElement("div");
    caption.id = "dialog-caption";
    caption.style.cssText = `
      position: fixed;
      bottom: 6.5%;
      left: 50%;
      transform: translateX(-50%);
      background: transparent;
      color: white;
      padding: 20px 40px;
      font-family: Arial, sans-serif;
      font-size: clamp(18px, 3vw, 28px);
      max-width: 90%;
      width: auto;
      text-align: center;
      display: none;
      z-index: 1000;
      pointer-events: none;
      line-height: 1.4;
      box-sizing: border-box;
      text-shadow: 2px 2px 8px rgba(0, 0, 0, 0.9), 0 0 20px rgba(0, 0, 0, 0.7);
    `;
    document.body.appendChild(caption);
    return caption;
  }

  /**
   * Play a dialog sequence (cancels any currently playing dialog)
   * @param {Object} dialogData - Dialog data object with audio and captions
   * @param {Function} onComplete - Optional callback when dialog finishes
   */
  playDialog(dialogData, onComplete = null) {
    // Cancel any currently playing dialog
    if (this.isPlaying) {
      console.log(
        `DialogManager: Canceling current dialog "${this.currentDialog?.id}" for new dialog "${dialogData.id}"`
      );
      this.stopDialog();
    }

    // Cancel any pending delayed dialog with the same ID
    if (this.pendingDialogs.has(dialogData.id)) {
      this.cancelDelayedDialog(dialogData.id);
    }

    // Check if this dialog has a delay
    const delay = dialogData.delay || 0;

    if (delay > 0) {
      // Schedule delayed playback
      this.scheduleDelayedDialog(dialogData, onComplete, delay);
      return;
    }

    // Play immediately
    this._playDialogImmediate(dialogData, onComplete);
  }

  /**
   * Schedule a dialog to play after a delay
   * @param {Object} dialogData - Dialog data object
   * @param {Function} onComplete - Optional callback
   * @param {number} delay - Delay in seconds
   * @private
   */
  scheduleDelayedDialog(dialogData, onComplete, delay) {
    console.log(
      `DialogManager: Scheduling dialog "${dialogData.id}" with ${delay}s delay`
    );

    this.pendingDialogs.set(dialogData.id, {
      dialogData,
      onComplete,
      timer: 0,
      delay,
    });
  }

  /**
   * Cancel a pending delayed dialog
   * @param {string} dialogId - Dialog ID to cancel
   */
  cancelDelayedDialog(dialogId) {
    if (this.pendingDialogs.has(dialogId)) {
      console.log(`DialogManager: Cancelled delayed dialog "${dialogId}"`);
      this.pendingDialogs.delete(dialogId);
    }
  }

  /**
   * Cancel all pending delayed dialogs
   */
  cancelAllDelayedDialogs() {
    if (this.pendingDialogs.size > 0) {
      console.log(
        `DialogManager: Cancelling ${this.pendingDialogs.size} pending dialog(s)`
      );
      this.pendingDialogs.clear();
    }
  }

  /**
   * Immediately play a dialog (internal method)
   * @param {Object} dialogData - Dialog data object
   * @param {Function} onComplete - Optional callback
   * @private
   */
  _playDialogImmediate(dialogData, onComplete) {
    this.currentDialog = dialogData;
    this.onCompleteCallback = onComplete;
    this.captionQueue = dialogData.captions || [];
    this.captionIndex = 0;
    this.captionTimer = 0;
    this.isPlaying = true;

    // Load and play audio
    if (dialogData.audio) {
      this.currentAudio = new Howl({
        src: [dialogData.audio],
        volume: this.audioVolume,
        onend: () => {
          this.handleDialogComplete();
        },
        onloaderror: (id, error) => {
          console.error("DialogManager: Failed to load audio", error);
          this.handleDialogComplete();
        },
      });

      this.currentAudio.play();
    }

    // Start first caption if available
    if (this.captionQueue.length > 0) {
      this.showCaption(this.captionQueue[0]);
    }

    this.emit("dialog:play", dialogData);
  }

  /**
   * Stop current dialog
   */
  stopDialog() {
    if (this.currentAudio) {
      this.currentAudio.stop();
      this.currentAudio.unload();
      this.currentAudio = null;
    }

    this.hideCaption();
    this.isPlaying = false;
    this.currentDialog = null;
    this.captionQueue = [];
    this.captionIndex = 0;
    this.captionTimer = 0;

    this.emit("dialog:stop");
  }

  /**
   * Show a caption
   * @param {Object} caption - Caption object with text and duration
   */
  showCaption(caption) {
    // HTML caption
    this.captionElement.textContent = caption.text;
    this.captionElement.style.display = "block";

    this.captionTimer = 0;
    this.emit("dialog:caption", caption);
  }

  /**
   * Hide caption
   */
  hideCaption() {
    this.captionElement.style.display = "none";
  }

  /**
   * Handle dialog completion
   */
  handleDialogComplete() {
    this.hideCaption();
    this.isPlaying = false;

    const completedDialog = this.currentDialog;
    this.currentDialog = null;
    this.currentAudio = null;

    // Check if this dialog should trigger choices
    if (completedDialog && this.dialogChoiceUI) {
      // Import dialogChoiceData dynamically to check for choices
      import("./dialogChoiceData.js").then((module) => {
        const choiceConfig = module.getChoiceForDialog(completedDialog.id);

        if (choiceConfig) {
          console.log(
            `DialogManager: Showing choices for dialog "${completedDialog.id}"`
          );
          const choiceData = module.buildChoiceData(choiceConfig);
          this.dialogChoiceUI.showChoices(choiceData);
        } else {
          // No choices, call onComplete if available
          this.handleOnComplete(completedDialog);
        }
      });
    } else {
      // No choice UI, call onComplete if available
      this.handleOnComplete(completedDialog);
    }

    this.emit("dialog:complete", completedDialog);

    if (this.onCompleteCallback) {
      this.onCompleteCallback(completedDialog);
      this.onCompleteCallback = null;
    }
  }

  /**
   * Handle onComplete callback for dialog
   * @param {Object} dialog - Completed dialog
   */
  handleOnComplete(dialog) {
    if (dialog && dialog.onComplete && this.gameManager) {
      if (typeof dialog.onComplete === "function") {
        try {
          console.log(
            `DialogManager: Calling onComplete for dialog "${dialog.id}"`
          );
          dialog.onComplete(this.gameManager);
        } catch (error) {
          console.error(
            `DialogManager: Error in onComplete for dialog "${dialog.id}":`,
            error
          );
        }
      }
    }
  }

  /**
   * Update method - call in animation loop
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    // Update pending delayed dialogs
    if (this.pendingDialogs.size > 0) {
      for (const [dialogId, pending] of this.pendingDialogs) {
        pending.timer += dt;

        // Check if delay has elapsed and no dialog is currently playing
        if (pending.timer >= pending.delay && !this.isPlaying) {
          console.log(`DialogManager: Playing delayed dialog "${dialogId}"`);
          this.pendingDialogs.delete(dialogId);
          this._playDialogImmediate(pending.dialogData, pending.onComplete);
          break; // Only play one dialog per frame
        }
      }
    }

    // Update current dialog captions
    if (!this.isPlaying || this.captionQueue.length === 0) {
      return;
    }

    this.captionTimer += dt;

    const currentCaption = this.captionQueue[this.captionIndex];
    if (currentCaption && this.captionTimer >= currentCaption.duration) {
      // Move to next caption
      this.captionIndex++;

      if (this.captionIndex < this.captionQueue.length) {
        this.showCaption(this.captionQueue[this.captionIndex]);
      } else {
        // No more captions - hide the last one
        this.hideCaption();
      }
    }
  }

  /**
   * Set caption styling
   * @param {Object} styles - CSS style object
   */
  setCaptionStyle(styles) {
    Object.assign(this.captionElement.style, styles);
  }

  /**
   * Apply default caption styling
   */
  applyDefaultCaptionStyle() {
    this.setCaptionStyle({
      fontFamily: "LePorsche, Arial, sans-serif",
      fontSize: "28px",
      background: "transparent",
      padding: "20px 40px",
      color: "#ffffff",
      textShadow: "2px 2px 8px rgba(0, 0, 0, 0.9), 0 0 20px rgba(0, 0, 0, 0.7)",
      maxWidth: "90%",
      lineHeight: "1.4",
    });
  }

  /**
   * Set audio volume
   * @param {number} volume - Volume level (0-1)
   */
  setVolume(volume) {
    const clamped = Math.max(0, Math.min(1, volume));
    this.baseVolume = clamped;
    this.updateVolume();
  }

  /**
   * Update volume based on SFX manager
   */
  updateVolume() {
    if (this.sfxManager) {
      this.audioVolume = this.baseVolume * this.sfxManager.getMasterVolume();
    } else {
      this.audioVolume = this.baseVolume;
    }

    if (this.currentAudio) {
      this.currentAudio.volume(this.audioVolume);
    }
  }

  /**
   * Check if dialog is currently playing
   * @returns {boolean}
   */
  isDialogPlaying() {
    return this.isPlaying;
  }

  /**
   * Check if a dialog is pending (scheduled with delay)
   * @param {string} dialogId - Dialog ID to check
   * @returns {boolean}
   */
  isDialogPending(dialogId) {
    return this.pendingDialogs.has(dialogId);
  }

  /**
   * Check if any dialog is pending
   * @returns {boolean}
   */
  hasDialogsPending() {
    return this.pendingDialogs.size > 0;
  }

  /**
   * Add event listener
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
   * Clean up resources
   */
  destroy() {
    this.stopDialog();

    // Clear pending dialogs
    this.pendingDialogs.clear();

    if (this.captionElement && this.captionElement.parentNode) {
      this.captionElement.parentNode.removeChild(this.captionElement);
    }

    this.eventListeners = {};
  }
}

export default DialogManager;

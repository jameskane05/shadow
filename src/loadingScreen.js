/**
 * LoadingScreen - Minimal loading screen that tracks asset loading progress
 * Shows before main.js initialization and hides when all assets are loaded
 */

export class LoadingScreen {
  constructor() {
    this.container = null;
    this.progressBar = null;
    this.progressText = null;
    this.loadingTasks = new Map(); // task name -> { loaded: number, total: number }
    this.isVisible = true;
    this.isComplete = false;

    this.createUI();
  }

  createUI() {
    // Create container
    this.container = document.createElement("div");
    this.container.id = "loading-screen";
    this.container.className = "loading-screen";

    // Create content wrapper
    const content = document.createElement("div");
    content.className = "loading-content";

    // Create title
    const title = document.createElement("div");
    title.className = "loading-title";
    title.textContent = "LOADING";

    // Create progress bar container
    const progressContainer = document.createElement("div");
    progressContainer.className = "loading-progress-container";

    // Create progress bar
    this.progressBar = document.createElement("div");
    this.progressBar.className = "loading-progress-bar";

    // Create progress text
    this.progressText = document.createElement("div");
    this.progressText.className = "loading-progress-text";
    this.progressText.textContent = "0%";

    // Assemble UI
    progressContainer.appendChild(this.progressBar);
    content.appendChild(title);
    content.appendChild(progressContainer);
    content.appendChild(this.progressText);
    this.container.appendChild(content);

    // Add to document
    document.body.appendChild(this.container);
  }

  /**
   * Register a loading task
   * @param {string} taskName - Unique name for the task
   * @param {number} total - Total number of items to load (default 1)
   */
  registerTask(taskName, total = 1) {
    this.loadingTasks.set(taskName, { loaded: 0, total });
    this.updateProgress();
  }

  /**
   * Update progress for a specific task
   * @param {string} taskName - Name of the task
   * @param {number} loaded - Number of items loaded
   * @param {number} total - Total items (optional, updates total if provided)
   */
  updateTask(taskName, loaded, total = null) {
    const task = this.loadingTasks.get(taskName);
    if (task) {
      task.loaded = loaded;
      if (total !== null) {
        task.total = total;
      }
      this.updateProgress();
    }
  }

  /**
   * Mark a task as complete
   * @param {string} taskName - Name of the task
   */
  completeTask(taskName) {
    const task = this.loadingTasks.get(taskName);
    if (task) {
      task.loaded = task.total;
      this.updateProgress();
    }
  }

  /**
   * Calculate and update overall progress
   */
  updateProgress() {
    let totalLoaded = 0;
    let totalItems = 0;

    for (const task of this.loadingTasks.values()) {
      totalLoaded += task.loaded;
      totalItems += task.total;
    }

    const progress = totalItems > 0 ? (totalLoaded / totalItems) * 100 : 0;

    // Update UI
    if (this.progressBar) {
      this.progressBar.style.width = `${progress}%`;
    }
    if (this.progressText) {
      this.progressText.textContent = `${Math.round(progress)}%`;
    }

    // Check if complete
    if (progress >= 100 && !this.isComplete) {
      this.isComplete = true;
    }
  }

  /**
   * Hide the loading screen with a fade-out animation
   * @param {number} duration - Fade duration in seconds (default 0.5)
   */
  hide(duration = 0.5) {
    if (!this.isVisible || !this.container) return;

    this.isVisible = false;
    this.container.style.transition = `opacity ${duration}s ease-out`;
    this.container.style.opacity = "0";

    // Remove from DOM after fade completes
    setTimeout(() => {
      if (this.container && this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }
    }, duration * 1000);
  }

  /**
   * Show the loading screen
   */
  show() {
    if (this.container) {
      this.container.style.opacity = "1";
      this.isVisible = true;
    }
  }

  /**
   * Check if loading is complete
   */
  isLoadingComplete() {
    return this.isComplete;
  }

  /**
   * Get current progress (0-100)
   */
  getProgress() {
    let totalLoaded = 0;
    let totalItems = 0;

    for (const task of this.loadingTasks.values()) {
      totalLoaded += task.loaded;
      totalItems += task.total;
    }

    return totalItems > 0 ? (totalLoaded / totalItems) * 100 : 0;
  }
}

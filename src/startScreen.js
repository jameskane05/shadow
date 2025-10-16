import * as THREE from "three";
import { createParticleText } from "./titleText.js";
import { TitleSequence } from "./titleSequence.js";
import { GAME_STATES } from "./gameData.js";
import "./styles/startScreen.css";

/**
 * StartScreen - Manages the intro camera animation and start button
 */
export class StartScreen {
  constructor(camera, scene, options = {}) {
    this.camera = camera;
    this.scene = scene;
    this.isActive = true;
    this.hasStarted = false;
    this.transitionProgress = 0;
    this.uiManager = options.uiManager || null;

    // Additional state
    this.introStartTriggered = false;
    this.titleSequence = null;
    this.title = null;
    this.byline = null;

    // Circle animation settings
    this.circleCenter = options.circleCenter || new THREE.Vector3(0, 0, 0);
    this.circleRadius = options.circleRadius || 15;
    this.circleHeight = options.circleHeight || 10;
    this.circleSpeed = options.circleSpeed || 0.3;
    this.circleTime = 0;

    // Target position (where camera should end up)
    this.targetPosition =
      options.targetPosition || new THREE.Vector3(10, 1.6, 15);
    this.targetRotation = options.targetRotation || {
      yaw: THREE.MathUtils.degToRad(-210),
      pitch: 0,
    };

    // Transition settings
    this.transitionDuration = options.transitionDuration || 2.0; // seconds

    // Store initial camera state for transition
    this.startPosition = new THREE.Vector3();
    this.startLookAt = new THREE.Vector3();

    // Create start button
    this.createStartButton();

    // Create title text particles
    const { title, byline } = this.createTitleText();
    this.title = title;
    this.byline = byline;
  }

  /**
   * Create the start button overlay
   */
  createStartButton() {
    // Create overlay container
    this.overlay = document.createElement("div");
    this.overlay.id = "intro-overlay";

    // Create tagline
    this.tagline = document.createElement("div");
    this.tagline.className = "intro-tagline";
    this.tagline.innerHTML = `In this town<br>it's hard to stray far from...`;

    // Create start button
    this.startButton = document.createElement("button");
    this.startButton.className = "intro-button";
    this.startButton.textContent = "START";

    // Click handler for start button
    this.startButton.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent click from reaching canvas
      this.startGame();

      // Request pointer lock when game starts (input will be disabled until control is enabled)
      const canvas = document.querySelector("canvas");
      if (canvas && canvas.requestPointerLock) {
        canvas.requestPointerLock();
      }
    });

    // Create options button
    this.optionsButton = document.createElement("button");
    this.optionsButton.className = "intro-button";
    this.optionsButton.textContent = "OPTIONS";

    // Click handler for options button
    this.optionsButton.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent click from reaching canvas
      if (this.uiManager) {
        this.uiManager.show("options-menu");
      }
    });

    this.overlay.appendChild(this.tagline);
    this.overlay.appendChild(this.startButton);
    this.overlay.appendChild(this.optionsButton);
    document.body.appendChild(this.overlay);

    // Register with UI manager if available
    if (this.uiManager) {
      this.uiManager.registerElement(
        "intro-screen",
        this.overlay,
        "MAIN_MENU",
        {
          blocksInput: true,
          pausesGame: false, // Game hasn't started yet
        }
      );
    }
  }

  /**
   * Create title text particles for the start screen
   */
  createTitleText() {
    // Create a separate scene for title text particles to render on top
    this.textScene = new THREE.Scene();
    // Optimized near/far planes for text particles at z: -10 with disperseDistance: 5
    // This provides much better depth precision and reduces jittering
    this.textCamera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1.0, // Near plane: text can be as close as ~5 units (10 - 5)
      20.0 // Far plane: text can be as far as ~15 units (10 + 5)
    );

    // Create first title text (particle-based)
    const textData1 = createParticleText(this.textScene, {
      text: "THE SHADOW\nof the Czar",
      font: "LePorsche",
      fontSize: 120,
      color: new THREE.Color(0xffffff), // White
      position: { x: 0, y: 0, z: -2.5 }, // Base position for animation
      scale: 2.5 / 80, // Increased from 1.0/80 for larger text
      animate: true,
      particleDensity: 0.5, // Higher density for better text quality
    });
    this.textScene.remove(textData1.mesh);
    this.textCamera.add(textData1.mesh);
    this.textScene.add(this.textCamera);
    textData1.mesh.userData.baseScale = 1.0 / 80;
    textData1.mesh.visible = false; // Hide initially

    // Create a wrapper object that includes particles
    const title = {
      mesh: textData1.mesh,
      particles: textData1.particles,
      update: textData1.update,
    };

    // Create second title text (positioned below first)
    const textData2 = createParticleText(this.textScene, {
      text: "by JAMES C. KANE",
      font: "LePorsche",
      fontSize: 30,
      color: new THREE.Color(0xffffff), // White
      position: { x: 0, y: -0.5, z: -2 }, // Base position lower for animation
      scale: 2.5 / 80, // Increased from 1.0/80 to match first text
      animate: true,
      particleDensity: 0.5, // Higher density for better text quality
    });
    this.textScene.remove(textData2.mesh);
    this.textCamera.add(textData2.mesh);
    textData2.mesh.userData.baseScale = 1.0 / 80;
    textData2.mesh.visible = false; // Hide initially

    // Create a wrapper object that includes particles
    const byline = {
      mesh: textData2.mesh,
      particles: textData2.particles,
      update: textData2.update,
    };

    return { title, byline };
  }

  /**
   * Start the game - begin transition
   */
  startGame() {
    if (this.hasStarted) return;

    this.hasStarted = true;

    // Flip high-level state from startScreen -> titleSequence
    if (this.uiManager && this.uiManager.gameManager) {
      this.uiManager.gameManager.setState({
        currentState: GAME_STATES.TITLE_SEQUENCE,
      });
    }

    // Store current camera position as transition start
    this.startPosition.copy(this.camera.position);

    // Calculate where camera is currently looking
    const lookDirection = new THREE.Vector3(0, 0, -1);
    lookDirection.applyQuaternion(this.camera.quaternion);
    this.startLookAt.copy(this.camera.position).add(lookDirection);

    // Immediately fade out start menu
    this.overlay.style.opacity = "0";
    this.overlay.style.transition = "opacity 0.15s ease";
    setTimeout(() => {
      this.overlay.style.display = "none";
      if (this.uiManager) {
        this.uiManager.hide("intro-screen");
      }
    }, 150);
  }

  /**
   * Update camera position for circling or transition
   * @param {number} dt - Delta time in seconds
   * @returns {boolean} - True if still active, false if complete
   */
  update(dt) {
    // Sync text camera with main camera
    if (this.textCamera) {
      this.textCamera.position.copy(this.camera.position);
      this.textCamera.quaternion.copy(this.camera.quaternion);
      this.textCamera.aspect = this.camera.aspect;
      this.textCamera.updateProjectionMatrix();
    }

    if (!this.hasStarted) {
      // Circle animation
      this.circleTime += dt * this.circleSpeed;

      const x =
        this.circleCenter.x + Math.cos(this.circleTime) * this.circleRadius;
      const z =
        this.circleCenter.z + Math.sin(this.circleTime) * this.circleRadius;
      const y = this.circleHeight;

      this.camera.position.set(x, y, z);

      // Calculate forward direction (tangent to circle)
      // Derivative of circle: dx/dt = -sin(t), dz/dt = cos(t)
      const forwardX = -Math.sin(this.circleTime);
      const forwardZ = Math.cos(this.circleTime);

      // Look forward along the circular path
      const lookTarget = new THREE.Vector3(
        x + forwardX,
        y, // Same height
        z + forwardZ
      );
      this.camera.lookAt(lookTarget);

      return true;
    } else if (this.transitionProgress < 1.0) {
      // Transition from circle to start position
      this.transitionProgress += dt / this.transitionDuration;
      const t = Math.min(this.transitionProgress, 1.0);

      // Smooth easing (ease-in-out)
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      // Interpolate position
      this.camera.position.lerpVectors(
        this.startPosition,
        this.targetPosition,
        eased
      );

      // Interpolate look direction
      const currentLookAt = new THREE.Vector3();
      const targetLookDirection = new THREE.Vector3(0, 0, -1).applyEuler(
        new THREE.Euler(
          this.targetRotation.pitch,
          this.targetRotation.yaw,
          0,
          "YXZ"
        )
      );
      const targetLookAt = this.targetPosition.clone().add(targetLookDirection);

      currentLookAt.lerpVectors(this.startLookAt, targetLookAt, eased);
      this.camera.lookAt(currentLookAt);

      if (this.transitionProgress >= 1.0) {
        this.isActive = false;
        this.cleanup();
        return false;
      }

      return true;
    }

    this.isActive = false;
    return false;
  }

  /**
   * Check if intro is complete
   */
  isComplete() {
    return !this.isActive;
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }

  /**
   * Monitor start screen for start button click and trigger title sequence
   */
  checkIntroStart(sfxManager, gameManager) {
    if (!this.hasStarted) return; // Skip if start button not clicked

    if (this.hasStarted && !this.introStartTriggered) {
      this.introStartTriggered = true;

      // Ensure ambiance is on and attempt playback on first interaction
      if (sfxManager && !sfxManager.isPlaying("city-ambiance")) {
        sfxManager.play("city-ambiance");
      }

      // Make text visible before starting sequence
      this.title.mesh.visible = true;
      this.byline.mesh.visible = true;

      this.titleSequence = new TitleSequence([this.title, this.byline], {
        introDuration: 4.0,
        staggerDelay: 3.0,
        holdDuration: 4.0,
        outroDuration: 2.0,
        disperseDistance: 5.0,
        onComplete: () => {
          console.log("Title sequence complete");
          gameManager.setState({
            currentState: GAME_STATES.TITLE_SEQUENCE_COMPLETE,
          });
        },
      });

      // Update game state - intro is ending, transitioning to gameplay
      gameManager.setState({
        currentState: GAME_STATES.TITLE_SEQUENCE,
      });
    }
  }

  /**
   * Get the title sequence
   */
  getTitleSequence() {
    return this.titleSequence;
  }

  /**
   * Get the text scene and camera for separate rendering
   */
  getTextRenderInfo() {
    return {
      scene: this.textScene,
      camera: this.textCamera,
    };
  }
}

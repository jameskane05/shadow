import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { Howler } from "howler";
import PhysicsManager from "./physicsManager.js";
import CharacterController from "./characterController.js";
import InputManager from "./inputManager.js";
import MusicManager from "./musicManager.js";
import SFXManager from "./sfxManager.js";
import LightManager from "./lightManager.js";
import OptionsMenu from "./ui/optionsMenu.js";
import DialogManager from "./dialogManager.js";
import DialogChoiceUI from "./ui/dialogChoiceUI.js";
import GameManager from "./gameManager.js";
import UIManager from "./ui/uiManager.js";
import ColliderManager from "./colliderManager.js";
import SceneManager from "./sceneManager.js";
import colliders from "./colliderData.js";
import { musicTracks } from "./musicData.js";
import { sceneObjects } from "./sceneData.js";
import { videos } from "./videoData.js";
import { lights } from "./lightData.js";
import { StartScreen } from "./startScreen.js";
import { GAME_STATES } from "./gameData.js";
import CameraAnimationManager from "./cameraAnimationManager.js";
import cameraAnimations from "./cameraAnimationData.js";
import GizmoManager from "./gizmoManager.js";
import { createCloudParticles } from "./vfx/cloudParticles.js";
import { createCloudParticlesShader } from "./vfx/cloudParticlesShader.js";
import DesaturationEffect from "./vfx/desaturationEffect.js";
import { LoadingScreen } from "./loadingScreen.js";
import GUI from "lil-gui";
import "./styles/optionsMenu.css";
import "./styles/dialog.css";
import "./styles/loadingScreen.css";

// Initialize loading screen immediately (before any asset loading)
const loadingScreen = new LoadingScreen();

// Register loading tasks (scene assets and audio files will register themselves as they load)
loadingScreen.registerTask("initialization", 1);

// Toggle between CPU-based and shader-based fog systems
// false = CPU-based (original), true = shader-based (GPU)
const USE_SHADER_FOG = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 5, 0);
scene.add(camera); // Add camera to scene so its children render

const renderer = new THREE.WebGLRenderer({ alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.opacity = "0"; // Hide renderer until loading is complete
document.body.appendChild(renderer.domElement);

// Create desaturation post-processing effect
const desaturationEffect = new DesaturationEffect(renderer);
// Enable for testing (normally you'd enable this when color scenes load)
desaturationEffect.enable();

// Handle window resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  desaturationEffect.setSize(window.innerWidth, window.innerHeight);
});

// Create a SparkRenderer with depth of field effect
const apertureSize = 0.01; // Very small aperture for subtle DoF
const focalDistance = 6.0;
const apertureAngle = 2 * Math.atan((0.5 * apertureSize) / focalDistance);

const spark = new SparkRenderer({
  renderer,
  apertureAngle: apertureAngle,
  focalDistance: focalDistance,
});
scene.add(spark);

// Initialize scene manager (objects will be loaded by gameManager based on state)
// Pass loadingScreen for progress tracking
const sceneManager = new SceneManager(scene, { loadingScreen });

// Make scene manager globally accessible for mesh lookups
window.sceneManager = sceneManager;

// Note: gizmoManager will be passed to sceneManager after initialization

// Make desaturation effect globally accessible
window.desaturationEffect = desaturationEffect;

// Initialize the physics manager
const physicsManager = new PhysicsManager();

// Initialize game manager early to check for debug spawn
const gameManager = new GameManager();

// Create character rigid body (capsule)
// Capsule: halfHeight=0.5, radius=0.3, total height = 1.6m
// Floor top at Y=0.1, character center at Y=0.9 (rests on ground)
// Camera at top of capsule: Y=0.9+0.8=1.7 (1.6m off ground)
// Use debug spawn position if available, otherwise default

const defaultSpawnPos = {
  x: 0,
  y: 0.9,
  z: 0,
};

const defaultSpawnRot = {
  x: 0,
  y: 180,
  z: 0,
};

const spawnPos = gameManager.getDebugSpawnPosition() || defaultSpawnPos;
const character = physicsManager.createCharacter(spawnPos, defaultSpawnRot);
// Removed visual mesh for character;

// Sync camera to character spawn position BEFORE creating particles
// This prevents particles from being immediately culled due to camera/character position mismatch
camera.position.set(
  spawnPos.x,
  spawnPos.y + 0.8, // Character Y + camera height offset
  spawnPos.z
);

// Determine fog spawn position based on game state
// If START_SCREEN, use phonebooth position (where camera circles)
// Otherwise use character spawn position (supports debug spawning)
const fogSpawnPosition =
  gameManager.state.currentState === GAME_STATES.START_SCREEN
    ? {
        x: sceneObjects.phonebooth.position.x,
        y: sceneObjects.phonebooth.position.y,
        z: sceneObjects.phonebooth.position.z,
      }
    : spawnPos;

// Create rolling fog effect using Gaussian splats for proper depth sorting
// IMPORTANT: Created BEFORE light manager so splat lights can affect the fog particles
// Pass fogSpawnPosition so particles initialize around camera's initial location
const fogOptions = {
  camera: camera,
  spawnPosition: fogSpawnPosition, // Use appropriate position based on game state
  particleCount: 4000, // Final particle count
  cloudSize: 40, // Particles spawn within this radius and are culled beyond it
  particleSize: 1.5, // Final particle size
  particleSizeMin: 1, // Min size multiplier (0.5x base size)
  particleSizeMax: 1.5, // Max size multiplier (1.5x base size)
  windSpeed: -0.5, // Starting wind speed (will transition to -1)
  opacity: 0.035,
  color: 0xffffff, // Darker gray so splat lights are more visible
  fluffiness: 10, // More vertical variation for rolling effect
  turbulence: 1, // More horizontal variation for swirling
  // Ground fog parameters
  groundLevel: -1, // Base ground level
  fogHeight: 6.0, // Height of fog layer
  fogFalloff: 1.3, // How quickly fog dissipates with height
};

const cloudParticles = USE_SHADER_FOG
  ? createCloudParticlesShader(scene, fogOptions)
  : createCloudParticles(scene, fogOptions);

console.log(
  `Fog system loaded: ${
    USE_SHADER_FOG ? "GPU Shader-based ⚡" : "CPU-based 🌫️"
  }`
);

// Debug GUI for cloud particle parameters
const debugGUI = new GUI({ title: "Cloud Particles Debug" });

const windFolder = debugGUI.addFolder("Wind");
windFolder
  .add(cloudParticles.options, "windSpeed", -5, 0, 0.1)
  .name("Wind Speed");

const movementFolder = debugGUI.addFolder("Movement");
movementFolder
  .add(cloudParticles.options, "fluffiness", 0, 10, 0.1)
  .name("Fluffiness");
movementFolder
  .add(cloudParticles.options, "turbulence", 0, 5, 0.1)
  .name("Turbulence");

const areaFolder = debugGUI.addFolder("Area");
areaFolder
  .add(cloudParticles.options, "cloudSize", 10, 100, 5)
  .name("Cloud Size")
  .onChange(() => {
    console.warn("cloudSize change requires respawn to take full effect");
  });
areaFolder
  .add(cloudParticles.options, "groundLevel", -5, 5, 0.1)
  .name("Ground Level");
areaFolder
  .add(cloudParticles.options, "fogHeight", 1, 20, 0.5)
  .name("Fog Height");
areaFolder
  .add(cloudParticles.options, "fogFalloff", 0.1, 5, 0.1)
  .name("Fog Falloff");

// Close folders by default for cleaner UI
windFolder.close();
movementFolder.close();
areaFolder.close();

// Make debug GUI and cloud particles globally accessible
window.debugGUI = debugGUI;
window.cloudParticles = cloudParticles;

// Hide debug GUI
debugGUI.hide();

// Manual trigger example (call from console):
// cloudParticles.transitionTo({ windSpeed: -1, opacity: 0.01 }, 4.0)

// Initialize light manager (automatically loads lights from lightData.js)
// Created AFTER cloud particles so splat lights render on top additively
const lightManager = new LightManager(scene);

// Initialize SFX manager (pass lightManager for audio-reactive lights)
const sfxManager = new SFXManager({
  masterVolume: 0.5,
  lightManager: lightManager,
  loadingScreen: loadingScreen,
});

// Initialize input manager (handles keyboard, mouse, and gamepad)
// Note: Pass gameManager so inputManager can check game state before allowing pointer lock
const inputManager = new InputManager(renderer.domElement, gameManager);

// Disable input initially - will be enabled when game starts
inputManager.disable();

// Initialize character controller (will be disabled until intro completes)
const characterController = new CharacterController(
  character,
  camera,
  renderer,
  inputManager,
  sfxManager,
  spark, // Pass spark renderer for DoF control
  null, // idleHelper (set later)
  defaultSpawnRot // Initial rotation from spawn data
);

// Register SFX from data
import { sfxSounds } from "./sfxData.js";
sfxManager._data = sfxSounds; // Keep a reference to definitions for state-based autoplay/stop
sfxManager.registerSoundsFromData(sfxSounds);

// Make character controller and input manager globally accessible for options menu
window.characterController = characterController;
window.inputManager = inputManager;

// Initialize camera animation manager now that all dependencies exist
const cameraAnimationManager = new CameraAnimationManager(
  camera,
  characterController,
  gameManager,
  { loadingScreen: loadingScreen }
);

// Load camera animations from data
cameraAnimationManager.loadAnimationsFromData(cameraAnimations);

// Make it globally accessible for debugging/scripting
window.cameraAnimationManager = cameraAnimationManager;

// Initialize lighting system
//const lightingSystem = new LightingSystem(scene);

// Initialize UI manager (manages all UI elements and z-index)
const uiManager = new UIManager(gameManager);

// Initialize music manager and load tracks from musicData
const musicManager = new MusicManager({
  defaultVolume: 0.6,
  loadingScreen: loadingScreen,
});

// Load only preload tracks during loading screen
Object.values(musicTracks).forEach((track) => {
  musicManager.addTrack(track.id, track.path, {
    preload: track.preload,
    loop: track.loop !== undefined ? track.loop : true,
  });
});

// Initialize start screen only if we're in START_SCREEN state
let startScreen = null;
if (gameManager.state.currentState === GAME_STATES.START_SCREEN) {
  // Calculate camera target position based on actual character spawn
  const cameraTargetPos = new THREE.Vector3(
    spawnPos.x,
    spawnPos.y + characterController.cameraHeight, // Character Y + camera offset
    spawnPos.z
  );

  startScreen = new StartScreen(camera, scene, {
    circleCenter: new THREE.Vector3(
      sceneObjects.phonebooth.position.x,
      sceneObjects.phonebooth.position.y,
      sceneObjects.phonebooth.position.z - 10
    ), // Center point of the circular path
    circleRadius: 6,
    circleHeight: 5,
    circleSpeed: 0.05,
    targetPosition: cameraTargetPos,
    targetRotation: {
      yaw: THREE.MathUtils.degToRad(defaultSpawnRot.y),
      pitch: 0,
    },
    transitionDuration: 8.0,
    uiManager: uiManager,
  });
}

// Initialize options menu
const optionsMenu = new OptionsMenu({
  musicManager: musicManager,
  sfxManager: sfxManager,
  gameManager: gameManager,
  uiManager: uiManager,
  sparkRenderer: spark,
  characterController: characterController,
  startScreen: startScreen,
});

// Initialize dialog choice UI
const dialogChoiceUI = new DialogChoiceUI({
  gameManager: gameManager,
  sfxManager: sfxManager,
});

// Initialize dialog manager with HTML captions
const dialogManager = new DialogManager({
  audioVolume: 1.0,
  useSplats: false, // Use HTML instead of text splats
  sfxManager: sfxManager, // Link to SFX manager for volume control
  gameManager: gameManager, // Link to game manager for state updates
  dialogChoiceUI: dialogChoiceUI, // Link to dialog choice UI
  loadingScreen: loadingScreen, // For progress tracking
});

// Preload dialog audio files
import { dialogTracks } from "./dialogData.js";
dialogManager.preloadDialogs(dialogTracks);

// Link dialog manager to choice UI
dialogChoiceUI.dialogManager = dialogManager;

// Register dialog manager with SFX manager
sfxManager.registerDialogManager(dialogManager);

// Register dialog volume control with SFX manager
if (sfxManager && dialogManager) {
  // Create a proxy object that implements the setVolume interface
  const dialogVolumeControl = {
    setVolume: (volume) => {
      dialogManager.setVolume(volume);
    },
  };
  // Boost dialog base volume so it is louder relative to SFX master
  sfxManager.registerSound("dialog", dialogVolumeControl, 2.0);
}

// Initialize gameManager with all managers (async - loads initial scene objects)
await gameManager.initialize({
  dialogManager: dialogManager,
  musicManager: musicManager,
  sfxManager: sfxManager,
  uiManager: uiManager,
  characterController: characterController,
  cameraAnimationManager: cameraAnimationManager,
  sceneManager: sceneManager,
  lightManager: lightManager,
  physicsManager: physicsManager,
  inputManager: inputManager,
  scene: scene,
  camera: camera,
});
loadingScreen.completeTask("initialization");

// Set up event listeners for managers
characterController.setGameManager(gameManager);
characterController.setSceneManager(sceneManager); // For first-person body attachment
musicManager.setGameManager(gameManager);
sfxManager.setGameManager(gameManager);

// Initialize UI components (idleHelper, fullscreenButton, splatCounter)
uiManager.initializeComponents({
  dialogManager,
  cameraAnimationManager,
  dialogChoiceUI,
  inputManager,
  characterController,
  sparkRenderer: spark,
});

// Initialize gizmo manager for debug positioning
const gizmoManager = new GizmoManager(scene, camera, renderer);

// Initialize collider manager with scene and sceneManager references
const colliderManager = new ColliderManager(
  physicsManager,
  gameManager,
  colliders,
  scene,
  sceneManager,
  gizmoManager
);

// Make collider manager globally accessible for debugging
window.colliderManager = colliderManager;

// Pass gizmo manager to scene manager and video manager
sceneManager.gizmoManager = gizmoManager;
if (gameManager.videoManager) {
  gameManager.videoManager.gizmoManager = gizmoManager;
}

// Register any already-loaded scene objects with gizmo manager
gizmoManager.registerSceneObjects(sceneManager);

// Register lights with gizmo manager
gizmoManager.registerLights(lightManager, lights);

// Make gizmo manager globally accessible for debugging
window.gizmoManager = gizmoManager;
// Make game manager globally accessible for gizmoManager setState integration
window.gameManager = gameManager;

// Standardize global effects via managers (sceneManager/videoManager set game state)

// Force gizmo detection from definitions regardless of state
gizmoManager.applyGlobalBlocksFromDefinitions({
  sceneDefs: sceneObjects,
  videoDefs: videos,
  colliderDefs: colliders,
  lightDefs: lights,
});

// Standardize: let gizmo manager own global side-effects from now on
// IMPORTANT: Set integration BEFORE applyGlobalBlocksFromDefinitions so inputManager is available
gizmoManager.setIntegration(uiManager?.components?.idleHelper, inputManager);

// Allow InputManager to detect gizmo hover/drag to enable drag-to-look when not over gizmo
if (typeof inputManager.setGizmoProbe === "function") {
  inputManager.setGizmoProbe(() => gizmoManager.isPointerOverGizmo());
}

// Hide loading screen and show renderer
if (loadingScreen.isLoadingComplete()) {
  loadingScreen.hide(0.5);
  // Fade in renderer
  renderer.domElement.style.transition = "opacity 0.5s ease-in";
  setTimeout(() => {
    renderer.domElement.style.opacity = "1";
  }, 100);

  // Load deferred assets after loading screen hides
  setTimeout(() => {
    console.log("Loading deferred assets...");
    musicManager.loadDeferredTracks();
    sfxManager.loadDeferredSounds();
    dialogManager.loadDeferredDialogs();
    cameraAnimationManager.loadDeferredAnimations();
    // TODO: Load deferred videos (if needed)
  }, 600); // Start loading after fade completes
}

let lastTime;
renderer.setAnimationLoop(function animate(time) {
  const t = time * 0.001;
  const dt = Math.min(0.033, t - (lastTime ?? t));
  lastTime = t;

  // Update start screen (camera animation and transition)
  if (startScreen && startScreen.isActive) {
    startScreen.update(dt);
    startScreen.checkIntroStart(sfxManager, gameManager);
  }

  // Don't update most game logic if options menu is open or start screen is active
  if (!optionsMenu.isOpen && (!startScreen || !startScreen.isActive)) {
    // Update input manager (gamepad state)
    inputManager.update(dt);

    // Update camera animation manager
    cameraAnimationManager.update(dt);

    // Update character controller (handles input, physics, camera, headbob)
    if (gameManager.isControlEnabled() && !cameraAnimationManager.playing) {
      characterController.update(dt);
    }

    // Physics step
    physicsManager.step();

    // Update collider manager (check for trigger intersections)
    if (gameManager.isControlEnabled()) {
      colliderManager.update(character);
    }

    // (moved below) Video manager is updated unconditionally so videos render during START_SCREEN too

    // Update Howler listener position for spatial audio
    Howler.pos(camera.position.x, camera.position.y, camera.position.z);

    // Update Howler listener orientation (forward and up vectors)
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    Howler.orientation(
      cameraDirection.x,
      cameraDirection.y,
      cameraDirection.z,
      camera.up.x,
      camera.up.y,
      camera.up.z
    );
  }

  // Always update video manager (billboarding and texture updates need to run during START_SCREEN)
  if (gameManager.videoManager) {
    gameManager.videoManager.update(dt);
  }

  // Update title sequence (pass dt in seconds)
  const titleSequence = startScreen ? startScreen.getTitleSequence() : null;
  if (titleSequence) {
    titleSequence.update(dt);

    // Enable character controller when the title outro begins
    if (!gameManager.isControlEnabled() && titleSequence.hasOutroStarted()) {
      gameManager.setState({ controlEnabled: true });
    }
  }

  // Always update music manager (handles fades)
  musicManager.update(dt);

  // Always update SFX manager (handles delayed sound playback)
  sfxManager.update(dt);

  // Always update dialog manager (handles caption timing)
  dialogManager.update(dt);

  // Always update scene manager (handles GLTF animations)
  sceneManager.update(dt);

  // Always update game manager (handles receiver lerp, etc.)
  gameManager.update(dt);

  // Always update audio-reactive lights
  lightManager.updateReactiveLights(dt);

  // Update cloud particles (shader-based version requires update call)
  if (USE_SHADER_FOG) {
    cloudParticles.update(dt);
  }

  // Update desaturation effect animation
  desaturationEffect.update(dt);

  // Update lighting
  //lightingSystem.updateFlickering(t);

  // Update UI manager (updates splat counter and other UI components)
  uiManager.update(dt);

  // Render with desaturation effect
  desaturationEffect.render(scene, camera);

  // Render text splats on top (separate scene for title sequence)
  if (startScreen && startScreen.getTextRenderInfo) {
    const textInfo = startScreen.getTextRenderInfo();
    if (textInfo && textInfo.scene && textInfo.camera) {
      renderer.autoClear = false;
      renderer.render(textInfo.scene, textInfo.camera);
      renderer.autoClear = true;
    }
  }
});

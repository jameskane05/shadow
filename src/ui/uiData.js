/**
 * UI Data - Centralized UI element definitions
 *
 * This file contains configuration for various UI elements that are
 * managed by the UIManager system.
 */

export const uiElements = {
  FULLSCREEN_BUTTON: {
    id: "fullscreen-button",
    layer: "GAME_HUD",
    image: "/images/fullscreen.png",
    position: {
      bottom: "5%",
      left: "5%",
    },
    size: {
      width: "144px",
      height: "144px",
    },
    style: {
      cursor: "pointer",
      opacity: "1.0",
      transition: "opacity 0.3s ease, transform 0.2s ease",
      pointerEvents: "all",
    },
    hoverStyle: {
      opacity: "1.0",
      transform: "scale(1.15)",
    },
    blocksInput: false,
    pausesGame: false,
  },

  // SPLAT_COUNTER: {
  //   id: "splat-counter",
  //   layer: "DEBUG",
  //   position: {
  //     top: "10px",
  //     left: "10px",
  //   },
  //   style: {
  //     position: "fixed",
  //     color: "white",
  //     fontFamily: "monospace",
  //     fontSize: "14px",
  //     backgroundColor: "rgba(0, 0, 0, 0.5)",
  //     padding: "8px 12px",
  //     borderRadius: "4px",
  //     pointerEvents: "none",
  //   },
  //   blocksInput: false,
  //   pausesGame: false,
  // },
};

export default uiElements;

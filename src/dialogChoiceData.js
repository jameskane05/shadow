/**
 * Dialog Choice Data
 *
 * Defines which dialog options to present as choices for each DIALOG_CHOICE state.
 * This keeps dialog data clean and separates choice configuration.
 *
 * Structure:
 * - triggerDialog: Dialog object that triggers this choice moment (e.g., dialogTracks.bonneSoiree)
 * - choiceStateKey: The game state key to store the selected response type
 * - prompt: Optional prompt text shown above choices
 * - choices: Array of choice objects:
 *   - text: Button text (what player sees)
 *   - responseType: Response type to store in game state (from DIALOG_RESPONSE_TYPES)
 *   - dialog: Dialog object to play from dialogData.js (e.g., dialogTracks.dialogChoice1Empath)
 * - onSelect: Callback when any choice is selected
 *   - Receives: (gameManager, selectedChoice)
 *   - Should return: object with state updates (e.g., { currentState: GAME_STATES.NEXT })
 *   - Returns are merged with choiceStateKey to apply all updates at once
 */

import { GAME_STATES, DIALOG_RESPONSE_TYPES } from "./gameData.js";
import { dialogTracks } from "./dialogData.js";
import { checkCriteria } from "./criteriaHelper.js";

export const dialogChoices = {
  // First choice moment - after phone call
  choice1: {
    id: "choice1",
    criteria: { currentState: GAME_STATES.ANSWERED_PHONE },
    triggerDialog: dialogTracks.bonneSoiree, // Dialog that triggers this choice
    choiceStateKey: "dialogChoice1",
    prompt: null, // Optional prompt above choices
    choices: [
      {
        text: "Someone who made a mistake.",
        responseType: DIALOG_RESPONSE_TYPES.EMPATH,
        dialog: dialogTracks.dialogChoice1Empath,
      },
      {
        text: "Someone who was never taught better.",
        responseType: DIALOG_RESPONSE_TYPES.PSYCHOLOGIST,
        dialog: dialogTracks.dialogChoice1Psychologist,
      },
      {
        text: "Someone with stolen property.",
        responseType: DIALOG_RESPONSE_TYPES.LAWFUL,
        dialog: dialogTracks.dialogChoice1Lawful,
      },
    ],
    onSelect: (gameManager, selectedChoice) => {
      // Return state updates instead of calling setState directly
      // This prevents multiple setState calls that would retrigger autoplay
      return { currentState: GAME_STATES.DIALOG_CHOICE_1 };
    },
  },

  // Cat reaction choice - appears after cat lookat completes
  catChoice: {
    id: "catChoice",
    criteria: { currentState: GAME_STATES.CAT_DIALOG_CHOICE },
    triggerDialog: null, // No trigger dialog, choice appears immediately after camera animation
    choiceStateKey: "catDialogChoice",
    prompt: null,
    choices: [
      {
        text: "Good kitty.",
        responseType: DIALOG_RESPONSE_TYPES.CAT_GOOD_KITTY,
        dialog: dialogTracks.coleGoodKitty,
      },
      {
        text: "Damn cats.",
        responseType: DIALOG_RESPONSE_TYPES.CAT_DAMN_CATS,
        dialog: dialogTracks.coleDamnCats,
      },
    ],
    onSelect: (gameManager, selectedChoice) => {
      // Stay in CAT_DIALOG_CHOICE state, just set the choice
      // The dialog will play based on the catDialogChoice state
      return {};
    },
  },

  // Example: Second choice moment
  // choice2: {
  //   id: "choice2",
  //   criteria: { currentState: GAME_STATES.SOME_OTHER_STATE },
  //   triggerDialog: dialogTracks.someOtherDialog,
  //   choiceStateKey: "dialogChoice2",
  //   prompt: "What do you do?",
  //   choices: [
  //     {
  //       text: "Option A",
  //       responseType: "optionA",
  //       dialog: dialogTracks.optionAResponse,
  //     },
  //     {
  //       text: "Option B",
  //       responseType: "optionB",
  //       dialog: dialogTracks.optionBResponse,
  //     },
  //   ],
  //   onSelect: (gameManager, selectedChoice) => {
  //     // selectedChoice contains: { text, responseType, responseDialog, onSelect }
  //     return { currentState: GAME_STATES.NEXT_STATE };
  //   },
  // },
};

/**
 * Get choice configuration for a specific dialog
 * @param {Object|string} dialog - Dialog object or dialog ID that just completed
 * @returns {Object|null} Choice configuration or null if no choices
 */
export function getChoiceForDialog(dialog) {
  const dialogId = typeof dialog === "string" ? dialog : dialog?.id;

  for (const choice of Object.values(dialogChoices)) {
    const triggerDialogId =
      typeof choice.triggerDialog === "string"
        ? choice.triggerDialog
        : choice.triggerDialog?.id;

    if (triggerDialogId === dialogId) {
      return choice;
    }
  }
  return null;
}

/**
 * Build choice data with actual dialog objects
 * @param {Object} choiceConfig - Choice configuration
 * @returns {Object} Choice data ready for DialogChoiceUI
 */
export function buildChoiceData(choiceConfig) {
  return {
    id: choiceConfig.id,
    prompt: choiceConfig.prompt || null,
    stateKey: choiceConfig.choiceStateKey,
    choices: choiceConfig.choices.map((choice) => ({
      text: choice.text,
      responseType: choice.responseType,
      responseDialog: choice.dialog || null,
      onSelect: choiceConfig.onSelect, // Use the shared onSelect from config
    })),
  };
}

/**
 * Get dialog choices that should be shown for the current game state
 * @param {Object} gameState - Current game state
 * @param {Set} shownChoices - Set of choice IDs that have already been shown
 * @returns {Array} Array of choice configurations that match conditions
 */
export function getChoicesForState(gameState, shownChoices = new Set()) {
  const choiceConfigs = Object.values(dialogChoices);

  const matchingChoices = [];

  for (const config of choiceConfigs) {
    // Skip if already shown
    if (shownChoices.has(config.id)) {
      continue;
    }

    // Check criteria
    if (config.criteria) {
      if (!checkCriteria(gameState, config.criteria)) {
        continue;
      }
    }

    // If we get here, all conditions passed
    // Build the choice data ready for display
    matchingChoices.push(buildChoiceData(config));
  }

  return matchingChoices;
}

export default dialogChoices;

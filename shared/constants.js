/**
 * Constants shared by the server and the browser client.
 * Plain ES module with no dependencies so both runtimes can import it.
 */

/** Seat colours in clockwise turn order (top-left, top-right, bottom-right, bottom-left). */
export const COLORS = Object.freeze(['red', 'green', 'yellow', 'blue']);

export const COLOR_LABELS = Object.freeze({
  red: 'Red',
  green: 'Green',
  yellow: 'Yellow',
  blue: 'Blue',
});

export const TOKENS_PER_PLAYER = 4;

/** Token position encoding (relative to the token's own colour). */
export const POS = Object.freeze({
  YARD: -1,          // waiting in the yard (base)
  START: 0,          // the colour's own starting square
  LAST_TRACK: 50,    // last square on the shared track before turning into the home column
  HOME_COLUMN: 51,   // first square of the private home column (51..55)
  HOME: 56,          // reached the centre triangle - finished
});

export const TRACK_LENGTH = 52;

/** Message types for the WebSocket protocol. */
export const MSG = Object.freeze({
  // client -> server
  HELLO: 'hello',
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  TAKE_SEAT: 'take_seat',
  ADD_BOT: 'add_bot',
  KICK: 'kick',
  SET_MODE: 'set_mode',
  SET_OPTION: 'set_option',
  SWAP_SEAT: 'swap_seat',
  SWAP_RESPONSE: 'swap_response',
  START_GAME: 'start_game',
  ROLL: 'roll',
  MOVE: 'move',
  REMATCH: 'rematch',
  EMOTE: 'emote',

  // server -> client
  WELCOME: 'welcome',
  ERROR: 'error',
  ROOM: 'room',
  GAME: 'game',
  LEFT: 'left',
  EMOTE_BROADCAST: 'emote_broadcast',
  SWAP_REQUEST: 'swap_request',
  NOTICE: 'notice',
});

/** Game event types emitted by the engine and animated by the client. */
export const EVT = Object.freeze({
  ROLL: 'roll',
  MOVE: 'move',
  NO_MOVES: 'no-moves',
  FORFEIT: 'forfeit',
  EXTRA_TURN: 'extra-turn',
  FINISH: 'finish',
  TURN: 'turn',
  GAME_OVER: 'game-over',
});

export const EMOTES = Object.freeze(['👍', '😂', '😮', '😡', '🎉', '🙏']);

/** Animation timing contract shared by server (bot pacing) and client (animations). */
export const TIMING = Object.freeze({
  DICE_MS: 750,
  STEP_MS: 280,
  CAPTURE_MS: 650,
  EVENT_GAP_MS: 120,
});

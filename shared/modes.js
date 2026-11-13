/**
 * Game modes and rule sets.
 *
 * BASE_RULES are the original/traditional Ludo rules. Each mode only changes
 * how the game is set up and how it is won - never the core movement rules.
 */

export const MODES = Object.freeze({
  CLASSIC: 'classic',
  TEAM: 'team',
  QUICK: 'quick',
});

export const BASE_RULES = Object.freeze({
  /** Dice values that release a token from the yard onto its start square. */
  enterRolls: [6],
  /** Rolling a 6 grants another roll. */
  sixGivesExtraTurn: true,
  /** Rolling this many sixes in a row forfeits the turn (the third six is not played). */
  maxConsecutiveSixes: 3,
  /** Capturing an opponent grants another roll. */
  captureGivesExtraTurn: true,
  /** Bringing a token into home grants another roll. */
  homeGivesExtraTurn: true,
  /**
   * Blockade rule: two or more tokens of one colour on a square form a block that
   * opponents cannot pass or land on. Traditional (Parcheesi-lineage) rule, but many
   * popular Ludo rule sets omit it, so it is a host option in the lobby (default off).
   */
  blocks: false,
  /** Start squares and star squares cannot be captured on. */
  safeSquares: true,
});

export const MODE_CONFIG = Object.freeze({
  [MODES.CLASSIC]: {
    id: MODES.CLASSIC,
    label: 'Classic',
    icon: '♛',
    tagline: '2–4 players · every token home',
    description:
      'The original game. Roll a 6 to leave the yard, race all four tokens around the board and into home. Play continues until every place is decided.',
    minPlayers: 2,
    maxPlayers: 4,
    teams: false,
    tokensToFinish: 4,
    tokensStartOnBoard: 0,
    endOnFirstFinish: false,
    turnSeconds: 30,
    rules: {},
  },
  [MODES.TEAM]: {
    id: MODES.TEAM,
    label: 'Team',
    icon: '⚑',
    tagline: '2 vs 2 · partners sit opposite',
    description:
      'Red & Yellow vs Green & Blue. Partners cannot capture each other and share squares. A player who finishes uses their rolls to move their partner’s tokens. First team fully home wins.',
    minPlayers: 4,
    maxPlayers: 4,
    teams: true,
    tokensToFinish: 4,
    tokensStartOnBoard: 0,
    endOnFirstFinish: false,
    turnSeconds: 30,
    rules: {},
  },
  [MODES.QUICK]: {
    id: MODES.QUICK,
    label: 'Quick',
    icon: '⚡',
    tagline: '2–4 players · first to 2 home',
    description:
      'Same original rules, shorter race: each player starts with one token already on the board and the first to bring two tokens home wins. Faster turn timer.',
    minPlayers: 2,
    maxPlayers: 4,
    teams: false,
    tokensToFinish: 2,
    tokensStartOnBoard: 1,
    endOnFirstFinish: true,
    turnSeconds: 15,
    rules: {},
  },
});

export function getModeConfig(mode) {
  const cfg = MODE_CONFIG[mode];
  if (!cfg) throw new Error(`Unknown mode: ${mode}`);
  return cfg;
}

export function getRules(mode) {
  return { ...BASE_RULES, ...getModeConfig(mode).rules };
}

/** Team index for a colour in team mode: partners sit opposite each other. */
export const teamOf = (color) => (color === 'red' || color === 'yellow' ? 0 : 1);
export const TEAM_NAMES = Object.freeze(['Red & Yellow', 'Green & Blue']);
export const TEAM_LABELS = Object.freeze(['Team A', 'Team B']);
/** Seats belonging to each team (partners sit opposite each other). */
export const TEAM_SEATS = Object.freeze([['red', 'yellow'], ['green', 'blue']]);

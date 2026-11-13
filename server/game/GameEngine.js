/**
 * GameEngine - authoritative, framework-free implementation of the Ludo rules.
 *
 * The engine holds no timers and does no I/O. Every action returns a list of
 * events describing exactly what happened, which the room broadcasts and the
 * client animates. This keeps the rules unit-testable in isolation.
 *
 * Original rules implemented:
 *  - A token leaves the yard only on a 6, onto its own start square.
 *  - Tokens move clockwise 51 squares around the track, then 5 squares up
 *    their private home column, then into home (56 steps total).
 *  - An exact roll is needed to reach home; overshooting is not allowed.
 *  - Rolling a 6 gives another roll; three 6s in a row forfeit the turn.
 *  - Landing on a single opponent token captures it (sent back to its yard)
 *    and earns another roll. Reaching home also earns another roll.
 *  - Start squares and star squares are safe: no captures there.
 *  - Optional blockade rule (host toggle): two or more tokens of one colour
 *    form a block that opponents can neither pass nor land on.
 *  - If no move is possible the turn passes (a 6 still earns its re-roll).
 */
import { COLORS, POS, TOKENS_PER_PLAYER, EVT } from '../../shared/constants.js';
import { toAbsolute, isSafeSquare } from '../../shared/board.js';
import { getModeConfig, getRules, teamOf } from '../../shared/modes.js';
import { randomInt } from 'node:crypto';

/** Fair die: cryptographically secure, uniform 1-6, identical for every seat, human or bot. */
const secureDie = () => randomInt(1, 7);

export class GameError extends Error {}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export class GameEngine {
  /**
   * @param {object} opts
   * @param {string} opts.mode       classic | team | quick
   * @param {Array<{id:string,name:string,color:string,isBot?:boolean}>} opts.players
   * @param {object} [opts.options]   room options, e.g. { blocks: boolean }
   * @param {() => number} [opts.rollDie] die source returning 1-6 (injectable for tests)
   * @param {number} [opts.firstTurn] seat index to start (default: random, so no seat is favoured)
   */
  constructor({ mode, players, options = {}, rollDie = secureDie, firstTurn }) {
    this.mode = mode;
    this.config = getModeConfig(mode);
    this.rules = getRules(mode);
    if (typeof options.blocks === 'boolean') this.rules.blocks = options.blocks;
    this.rollDie = rollDie;

    if (players.length < this.config.minPlayers || players.length > this.config.maxPlayers) {
      throw new GameError(`${this.config.label} needs ${this.config.minPlayers}–${this.config.maxPlayers} players`);
    }

    this.players = players
      .slice()
      .sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color))
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isBot: !!p.isBot,
        team: this.config.teams ? teamOf(p.color) : null,
        tokens: Array.from({ length: TOKENS_PER_PLAYER }, (_, i) =>
          i < this.config.tokensStartOnBoard ? POS.START : POS.YARD,
        ),
        rank: null,
      }));

    if (this.config.teams) {
      for (const team of [0, 1]) {
        if (this.players.filter((p) => p.team === team).length !== 2) {
          throw new GameError('Team mode needs two players on each team');
        }
      }
    }

    this.turn = firstTurn ?? randomInt(0, this.players.length);
    this.phase = 'roll'; // roll | move | ended
    this.dice = null;
    this.sixCount = 0;
    this.legalMoves = [];
    this.rankings = [];
    this.winners = null;
    this.turnNumber = 1;
    this.over = false;
  }

  // ---------------------------------------------------------------- queries

  get current() {
    return this.players[this.turn];
  }

  playerById(id) {
    return this.players.find((p) => p.id === id);
  }

  playerByColor(color) {
    return this.players.find((p) => p.color === color);
  }

  homeCount(player) {
    return player.tokens.filter((t) => t === POS.HOME).length;
  }

  isFinished(player) {
    return this.homeCount(player) >= this.config.tokensToFinish;
  }

  partnerOf(player) {
    if (!this.config.teams) return null;
    return this.players.find((p) => p !== player && p.team === player.team) ?? null;
  }

  isFriendly(a, b) {
    return a === b || (this.config.teams && a.team === b.team);
  }

  /** The player whose tokens `player` moves this turn (partner once finished, in team mode). */
  controlledPlayer(player) {
    if (this.config.teams && this.isFinished(player)) {
      const partner = this.partnerOf(player);
      if (partner && !this.isFinished(partner)) return partner;
    }
    return player;
  }

  /** Whether a player still takes turns. */
  canPlay(player) {
    if (!this.isFinished(player)) return true;
    return this.controlledPlayer(player) !== player;
  }

  /** Tokens on the shared track at an absolute index. */
  occupantsAt(absIndex) {
    const out = [];
    for (const p of this.players) {
      p.tokens.forEach((t, index) => {
        if (t >= POS.START && t <= POS.LAST_TRACK && toAbsolute(p.color, t) === absIndex) {
          out.push({ player: p, index });
        }
      });
    }
    return out;
  }

  /** True if an opponent block (2+ tokens of one opposing colour) sits on this square. */
  isBlockedFor(mover, absIndex) {
    if (!this.rules.blocks) return false;
    const counts = {};
    for (const o of this.occupantsAt(absIndex)) {
      if (this.isFriendly(o.player, mover)) continue;
      counts[o.player.color] = (counts[o.player.color] ?? 0) + 1;
      if (counts[o.player.color] >= 2) return true;
    }
    return false;
  }

  /**
   * Compute the move for one token with a given roll, or null if illegal.
   * @returns {null | {color, index, from, to, path:number[], captures:Array}}
   */
  computeMove(owner, index, roll) {
    const from = owner.tokens[index];
    if (from === POS.HOME) return null;

    let to;
    let path;
    if (from === POS.YARD) {
      if (!this.rules.enterRolls.includes(roll)) return null;
      to = POS.START;
      path = [POS.START];
    } else {
      to = from + roll;
      if (to > POS.HOME) return null; // exact roll needed to reach home
      path = range(from + 1, to);
    }

    // Blocks cannot be passed or landed on (only relevant on the shared track).
    for (const step of path) {
      if (step <= POS.LAST_TRACK && this.isBlockedFor(owner, toAbsolute(owner.color, step))) return null;
    }

    let captures = [];
    if (to <= POS.LAST_TRACK) {
      const abs = toAbsolute(owner.color, to);
      if (!(this.rules.safeSquares && isSafeSquare(abs))) {
        captures = this.occupantsAt(abs)
          .filter((o) => !this.isFriendly(o.player, owner))
          .map((o) => ({ color: o.player.color, index: o.index, from: o.player.tokens[o.index] }));
      }
    }

    return { color: owner.color, index, from, to, path, captures };
  }

  computeLegalMoves(roll) {
    const owner = this.controlledPlayer(this.current);
    const moves = [];
    owner.tokens.forEach((_, i) => {
      const m = this.computeMove(owner, i, roll);
      if (m) moves.push(m);
    });
    return moves;
  }

  /** Legal moves that lead to genuinely different outcomes (tokens stacked together are equivalent). */
  distinctMoves() {
    const seen = new Set();
    return this.legalMoves.filter((m) => {
      const key = `${m.color}:${m.from}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ---------------------------------------------------------------- actions

  assertTurn(playerId, phase) {
    if (this.over) throw new GameError('The game is over');
    if (this.current.id !== playerId) throw new GameError('It is not your turn');
    if (this.phase !== phase) throw new GameError(phase === 'roll' ? 'You must move a token first' : 'Roll the dice first');
  }

  /**
   * Roll the dice for the current player.
   * @param {string} playerId
   * @param {number} [forced] fixed value (tests only)
   */
  roll(playerId, forced) {
    this.assertTurn(playerId, 'roll');
    const value = forced ?? this.rollDie();
    const player = this.current;
    const events = [{ type: EVT.ROLL, color: player.color, value }];

    this.dice = value;
    this.sixCount = value === 6 ? this.sixCount + 1 : 0;

    if (value === 6 && this.sixCount >= this.rules.maxConsecutiveSixes) {
      events.push({ type: EVT.FORFEIT, color: player.color, reason: 'three-sixes' });
      this.advanceTurn(events);
      return events;
    }

    this.legalMoves = this.computeLegalMoves(value);

    if (this.legalMoves.length === 0) {
      events.push({ type: EVT.NO_MOVES, color: player.color });
      if (value === 6 && this.rules.sixGivesExtraTurn) {
        this.phase = 'roll';
        this.dice = null;
        events.push({ type: EVT.EXTRA_TURN, color: player.color, reason: 'six' });
      } else {
        this.advanceTurn(events);
      }
      return events;
    }

    this.phase = 'move';
    return events;
  }

  /** Move one of the controllable tokens using the current dice value. */
  move(playerId, tokenIndex) {
    this.assertTurn(playerId, 'move');
    const move = this.legalMoves.find((m) => m.index === tokenIndex);
    if (!move) throw new GameError('That token cannot move');

    const player = this.current;
    const owner = this.playerByColor(move.color);
    owner.tokens[move.index] = move.to;
    for (const c of move.captures) this.playerByColor(c.color).tokens[c.index] = POS.YARD;

    const events = [{ type: EVT.MOVE, by: player.color, ...move }];

    if (owner.rank === null && this.isFinished(owner)) {
      this.rankings.push(owner.color);
      owner.rank = this.rankings.length;
      events.push({ type: EVT.FINISH, color: owner.color, rank: owner.rank });
    }

    if (this.checkGameOver(events)) return events;

    let bonus = null;
    if (this.dice === 6 && this.rules.sixGivesExtraTurn) bonus = 'six';
    else if (move.captures.length && this.rules.captureGivesExtraTurn) bonus = 'capture';
    else if (move.to === POS.HOME && this.rules.homeGivesExtraTurn) bonus = 'home';

    if (bonus && this.canPlay(player)) {
      this.phase = 'roll';
      this.dice = null;
      this.legalMoves = [];
      // Only consecutive sixes count towards the forfeit.
      if (bonus !== 'six') this.sixCount = 0;
      events.push({ type: EVT.EXTRA_TURN, color: player.color, reason: bonus });
    } else {
      this.advanceTurn(events);
    }
    return events;
  }

  /** Remove a player mid-game is not allowed by the rules; rooms swap in a bot instead. */
  replaceWithBot(playerId, botName) {
    const p = this.playerById(playerId);
    if (p) {
      p.isBot = true;
      p.name = botName;
    }
  }

  // ---------------------------------------------------------------- internals

  advanceTurn(events) {
    this.sixCount = 0;
    this.dice = null;
    this.legalMoves = [];
    this.phase = 'roll';
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (this.turn + i) % n;
      if (this.canPlay(this.players[idx])) {
        this.turn = idx;
        break;
      }
    }
    this.turnNumber++;
    events.push({ type: EVT.TURN, color: this.current.color });
  }

  checkGameOver(events) {
    let winners = null;

    if (this.config.teams) {
      for (const team of [0, 1]) {
        const members = this.players.filter((p) => p.team === team);
        if (members.every((m) => this.isFinished(m))) {
          winners = members.map((m) => m.color);
          break;
        }
      }
    } else {
      const remaining = this.players.filter((p) => !this.isFinished(p));
      if ((this.config.endOnFirstFinish && this.rankings.length > 0) || remaining.length <= 1) {
        winners = [this.rankings[0]];
      }
    }

    if (!winners) return false;

    this.over = true;
    this.phase = 'ended';
    this.winners = winners;
    this.legalMoves = [];
    this.dice = null;
    events.push({ type: EVT.GAME_OVER, winners, standings: this.getStandings() });
    return true;
  }

  /** Finished players by rank, then everyone else by progress. */
  getStandings() {
    const progress = (p) => p.tokens.reduce((sum, t) => sum + (t === POS.YARD ? 0 : t + 1), 0);
    const ranked = this.rankings.map((c) => this.playerByColor(c));
    const rest = this.players
      .filter((p) => !ranked.includes(p))
      .sort((a, b) => progress(b) - progress(a));
    return [...ranked, ...rest].map((p, i) => ({
      color: p.color,
      name: p.name,
      team: p.team,
      place: i + 1,
      home: this.homeCount(p),
      finished: this.isFinished(p),
    }));
  }

  /** Serializable snapshot sent to clients. */
  getState() {
    const controlled = this.over ? null : this.controlledPlayer(this.current);
    return {
      mode: this.mode,
      blocks: this.rules.blocks,
      tokensToFinish: this.config.tokensToFinish,
      teams: this.config.teams,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isBot: p.isBot,
        team: p.team,
        tokens: p.tokens.slice(),
        rank: p.rank,
        home: this.homeCount(p),
      })),
      turn: this.current.color,
      controlledColor: controlled?.color ?? null,
      phase: this.phase,
      dice: this.dice,
      sixCount: this.sixCount,
      legalMoves: this.legalMoves.map(({ color, index, from, to, captures }) => ({
        color, index, from, to, captures: captures.length,
      })),
      rankings: this.rankings.slice(),
      winners: this.winners,
      standings: this.over ? this.getStandings() : null,
      over: this.over,
      turnNumber: this.turnNumber,
    };
  }
}

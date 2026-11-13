/**
 * Room - a lobby with four colour seats that hosts one game at a time.
 *
 * Responsibilities: seating, bots, host controls, starting/restarting the
 * GameEngine, turn timers, pacing bot moves to match client animations, and
 * broadcasting state. All rule decisions are delegated to GameEngine.
 */
import { COLORS, MSG, EVT, TIMING } from '../../shared/constants.js';
import { MODE_CONFIG, MODES, getModeConfig } from '../../shared/modes.js';
import { GameEngine, GameError } from '../game/GameEngine.js';
import { chooseMove, randomBotName } from '../game/BotPlayer.js';
import { config } from '../config.js';
import { newId } from '../utils/ids.js';

/** Estimated client animation time for a batch of events (keeps bots in sync with what players see). */
function animationMs(events) {
  let ms = 0;
  for (const e of events) {
    ms += TIMING.EVENT_GAP_MS;
    if (e.type === EVT.ROLL) ms += TIMING.DICE_MS;
    if (e.type === EVT.MOVE) {
      ms += e.path.length * TIMING.STEP_MS;
      if (e.captures.length) ms += TIMING.CAPTURE_MS;
    }
  }
  return ms;
}

export class Room {
  constructor(code, mode, manager) {
    this.code = code;
    this.mode = MODE_CONFIG[mode] ? mode : MODES.CLASSIC;
    this.manager = manager;
    /** @type {Record<string, null | {id, name, isBot, sessionId?}>} */
    this.seats = Object.fromEntries(COLORS.map((c) => [c, null]));
    this.hostId = null;
    this.status = 'lobby'; // lobby | playing | ended
    /** Host-adjustable house rules. */
    this.options = { blocks: false };
    /** Pending seat-swap requests: targetSessionId -> { from, fromColor, toColor, at } */
    this.swapRequests = new Map();
    this.engine = null;
    this.timer = null;
    this.turnDeadline = null;
    this.createdAt = Date.now();
  }

  // ------------------------------------------------------------ membership

  get members() {
    return COLORS.map((c) => this.seats[c]).filter(Boolean);
  }

  get humans() {
    return this.members.filter((m) => !m.isBot);
  }

  colorOf(sessionId) {
    return COLORS.find((c) => this.seats[c]?.sessionId === sessionId) ?? null;
  }

  session(sessionId) {
    return this.manager.sessions.get(sessionId);
  }

  isConnected(member) {
    if (member.isBot) return true;
    return !!this.session(member.sessionId)?.socket;
  }

  addHuman(session) {
    if (this.colorOf(session.id)) return; // already seated (reconnect)
    if (this.status === 'playing') throw new GameError('This game has already started');
    const color = this.preferredFreeSeat();
    if (!color) throw new GameError('Room is full');
    this.seats[color] = { id: session.id, sessionId: session.id, name: session.name, isBot: false };
    if (!this.hostId) this.hostId = session.id;
    session.roomCode = this.code;
  }

  /** Fill opposite corners first so two players face each other. */
  preferredFreeSeat() {
    return ['red', 'yellow', 'green', 'blue'].find((c) => !this.seats[c]) ?? null;
  }

  removeHuman(sessionId) {
    const color = this.colorOf(sessionId);
    if (!color) return;
    const member = this.seats[color];

    if (this.status === 'playing') {
      // The rules have no way to remove a colour mid-game: a bot takes over.
      const botName = randomBotName(this.members.map((m) => m.name));
      this.seats[color] = { id: member.id, name: botName, isBot: true };
      this.engine.replaceWithBot(member.id, botName);
    } else {
      this.seats[color] = null;
    }

    if (this.hostId === sessionId) this.hostId = this.humans[0]?.sessionId ?? null;
    const session = this.session(sessionId);
    if (session) session.roomCode = null;

    if (this.status === 'playing') this.scheduleTurn(0);
  }

  // ------------------------------------------------------------ lobby actions

  assertHost(sessionId) {
    if (sessionId !== this.hostId) throw new GameError('Only the host can do that');
  }

  assertLobby() {
    if (this.status === 'playing') throw new GameError('Game in progress');
  }

  takeSeat(sessionId, color) {
    this.assertLobby();
    if (!COLORS.includes(color)) throw new GameError('Unknown seat');
    if (this.seats[color]) throw new GameError('Seat taken');
    const current = this.colorOf(sessionId);
    if (!current) throw new GameError('You are not in this room');
    this.seats[color] = this.seats[current];
    this.seats[current] = null;
  }

  /**
   * Swap your seat with another one (this is how players change team).
   * Empty seats and bots swap instantly; the host can swap with anyone.
   * Otherwise the other player gets a request to accept or decline.
   */
  swapSeat(sessionId, targetColor) {
    this.assertLobby();
    if (!COLORS.includes(targetColor)) throw new GameError('Unknown seat');
    const myColor = this.colorOf(sessionId);
    if (!myColor) throw new GameError('You are not in this room');
    if (myColor === targetColor) return;
    const target = this.seats[targetColor];

    if (!target || target.isBot || sessionId === this.hostId) {
      this.doSwap(myColor, targetColor);
      return;
    }
    const me = this.seats[myColor];
    this.swapRequests.set(target.sessionId, { from: sessionId, fromColor: myColor, toColor: targetColor, at: Date.now() });
    this.manager.send(this.session(target.sessionId), MSG.SWAP_REQUEST, {
      fromName: me.name, fromColor: myColor, toColor: targetColor, mode: this.mode,
    });
    this.manager.send(this.session(sessionId), MSG.NOTICE, { message: `Swap request sent to ${target.name}` });
  }

  respondSwap(sessionId, accept) {
    const req = this.swapRequests.get(sessionId);
    this.swapRequests.delete(sessionId);
    if (!req) return;
    const requester = this.session(req.from);
    const me = this.seats[req.toColor];
    // Seats must still be as they were when the request was made.
    const valid = this.status !== 'playing'
      && me?.sessionId === sessionId
      && this.seats[req.fromColor]?.sessionId === req.from
      && Date.now() - req.at < 60_000;
    if (!valid) {
      this.manager.send(this.session(sessionId), MSG.NOTICE, { message: 'That swap request expired' });
      return;
    }
    if (accept) {
      this.doSwap(req.fromColor, req.toColor);
      this.manager.send(requester, MSG.NOTICE, { message: `${me.name} accepted the swap` });
    } else {
      this.manager.send(requester, MSG.NOTICE, { message: `${me.name} declined the swap` });
    }
  }

  doSwap(a, b) {
    [this.seats[a], this.seats[b]] = [this.seats[b], this.seats[a]];
  }

  addBot(sessionId, color) {
    this.assertHost(sessionId);
    this.assertLobby();
    const seat = color && COLORS.includes(color) ? color : this.preferredFreeSeat();
    if (!seat || this.seats[seat]) throw new GameError('No free seat');
    const name = randomBotName(this.members.map((m) => m.name));
    this.seats[seat] = { id: newId('bot'), name, isBot: true };
  }

  kick(sessionId, color) {
    this.assertHost(sessionId);
    this.assertLobby();
    const member = this.seats[color];
    if (!member) return;
    if (member.sessionId === sessionId) throw new GameError('You cannot remove yourself');
    this.seats[color] = null;
    if (!member.isBot) {
      const s = this.session(member.sessionId);
      if (s) {
        s.roomCode = null;
        this.manager.send(s, MSG.LEFT, { reason: 'You were removed by the host' });
      }
    }
  }

  setMode(sessionId, mode) {
    this.assertHost(sessionId);
    this.assertLobby();
    if (!MODE_CONFIG[mode]) throw new GameError('Unknown mode');
    this.mode = mode;
  }

  setOption(sessionId, key, value) {
    this.assertHost(sessionId);
    this.assertLobby();
    if (!(key in this.options)) throw new GameError('Unknown option');
    this.options[key] = !!value;
  }

  start(sessionId) {
    this.assertHost(sessionId);
    this.assertLobby();
    const cfg = getModeConfig(this.mode);
    const players = COLORS.filter((c) => this.seats[c]).map((color) => ({
      id: this.seats[color].id,
      name: this.seats[color].name,
      color,
      isBot: this.seats[color].isBot,
    }));
    if (players.length < cfg.minPlayers) {
      throw new GameError(
        cfg.teams ? 'Team mode needs all 4 seats filled (add bots)' : `Need at least ${cfg.minPlayers} players`,
      );
    }
    this.engine = new GameEngine({ mode: this.mode, players, options: this.options });
    this.gameId = (this.gameId ?? 0) + 1;
    this.status = 'playing';
    this.broadcastRoom();
    this.broadcastGame([{ type: EVT.TURN, color: this.engine.current.color }]);
    this.scheduleTurn(600);
  }

  rematch(sessionId) {
    this.assertHost(sessionId);
    if (this.status !== 'ended') throw new GameError('The game is not over yet');
    this.status = 'lobby';
    this.start(sessionId);
  }

  backToLobby() {
    this.clearTimer();
    this.status = 'lobby';
    this.engine = null;
    this.turnDeadline = null;
  }

  // ------------------------------------------------------------ game actions

  roll(sessionId) {
    this.assertPlaying();
    const events = this.engine.roll(this.memberIdFor(sessionId));
    this.afterAction(events);
  }

  move(sessionId, tokenIndex) {
    this.assertPlaying();
    const events = this.engine.move(this.memberIdFor(sessionId), Number(tokenIndex));
    this.afterAction(events);
  }

  assertPlaying() {
    if (this.status !== 'playing' || !this.engine) throw new GameError('No game in progress');
  }

  memberIdFor(sessionId) {
    const color = this.colorOf(sessionId);
    if (!color) throw new GameError('You are not playing in this room');
    return this.seats[color].id;
  }

  afterAction(events) {
    this.clearTimer();
    if (this.engine.over) {
      this.status = 'ended';
      this.turnDeadline = null;
      this.broadcastGame(events);
      this.broadcastRoom();
      return;
    }
    const delay = animationMs(events);
    this.broadcastGame(events);
    this.scheduleTurn(delay);
  }

  /**
   * Decide what happens next for the current player:
   * - bots / disconnected players act automatically after a short delay;
   * - if only one distinct move exists it is played automatically;
   * - otherwise a human gets a turn timer, after which the bot logic plays for them.
   */
  scheduleTurn(animDelay) {
    this.clearTimer();
    if (!this.engine || this.engine.over) return;

    const color = this.engine.current.color;
    const member = this.seats[color];
    const auto = member.isBot || !this.isConnected(member);
    const phase = this.engine.phase;

    if (auto) {
      const think = member.isBot ? config.botThinkMs : config.disconnectedActMs;
      this.turnDeadline = null;
      this.timer = setTimeout(() => this.autoAct(), animDelay + think);
      return;
    }

    if (phase === 'move' && this.engine.distinctMoves().length === 1) {
      this.turnDeadline = null;
      this.timer = setTimeout(() => this.autoAct(), animDelay + config.autoMoveMs);
      return;
    }

    const turnMs = getModeConfig(this.mode).turnSeconds * 1000;
    this.turnDeadline = Date.now() + animDelay + turnMs;
    this.timer = setTimeout(() => this.autoAct(), animDelay + turnMs);
  }

  autoAct() {
    this.timer = null;
    if (!this.engine || this.engine.over) return;
    const player = this.engine.current;
    try {
      if (this.engine.phase === 'roll') {
        this.afterAction(this.engine.roll(player.id));
      } else {
        const choice = chooseMove(this.engine);
        this.afterAction(this.engine.move(player.id, choice.index));
      }
    } catch (err) {
      console.error(`[room ${this.code}] auto action failed`, err);
    }
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------ broadcasting

  roomSnapshot() {
    return {
      code: this.code,
      mode: this.mode,
      options: { ...this.options },
      status: this.status,
      hostId: this.hostId,
      seats: Object.fromEntries(
        COLORS.map((c) => {
          const m = this.seats[c];
          return [c, m ? { id: m.id, name: m.name, isBot: m.isBot, connected: this.isConnected(m) } : null];
        }),
      ),
    };
  }

  gameSnapshot() {
    if (!this.engine) return null;
    const state = this.engine.getState();
    for (const p of state.players) {
      const m = this.seats[p.color];
      p.connected = m ? this.isConnected(m) : false;
    }
    state.gameId = this.gameId;
    state.turnDeadline = this.turnDeadline;
    state.serverNow = Date.now();
    state.turnSeconds = getModeConfig(this.mode).turnSeconds;
    return state;
  }

  broadcast(type, payload) {
    for (const m of this.humans) {
      const s = this.session(m.sessionId);
      if (s) this.manager.send(s, type, payload);
    }
  }

  broadcastRoom() {
    this.broadcast(MSG.ROOM, this.roomSnapshot());
  }

  broadcastGame(events = []) {
    this.broadcast(MSG.GAME, { events, state: this.gameSnapshot() });
  }

  /** Send the full current picture to one (re)connecting session. */
  syncSession(session) {
    this.manager.send(session, MSG.ROOM, this.roomSnapshot());
    if (this.engine) this.manager.send(session, MSG.GAME, { events: [], state: this.gameSnapshot(), sync: true });
  }

  /** Called when a seated human connects or drops so others see the status and timers adapt. */
  onPresenceChange() {
    this.broadcastRoom();
    if (this.status === 'playing') {
      const current = this.seats[this.engine.current.color];
      if (current && !current.isBot) this.scheduleTurn(0);
      this.broadcastGame([]);
    }
  }

  destroy() {
    this.clearTimer();
  }
}


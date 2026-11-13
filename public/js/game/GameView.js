/**
 * GameView - plays server events as animations, then renders the
 * authoritative state. Messages are queued so animations never overlap and
 * the board always ends up exactly matching the server.
 */
import { $, h, sleep } from '../core/dom.js';
import { Emitter } from '../core/Emitter.js';
import { sound } from '../core/Sound.js';
import { toast } from '../ui/Toast.js';
import { BoardRenderer } from './BoardRenderer.js';
import { TokenLayer } from './TokenLayer.js';
import { PlayerPanels } from './PlayerPanels.js';
import { Effects } from './Effects.js';
import { COLORS, COLOR_LABELS, EVT, POS, TIMING, EMOTES } from '/shared/constants.js';
import { positionToPoint } from '/shared/board.js';
import { getModeConfig, TEAM_LABELS } from '/shared/modes.js';
import { YARD_ORIGIN } from '/shared/board.js';

const CENTER = { x: 7.5, y: 7.5 };

export class GameView extends Emitter {
  constructor() {
    super();
    this.root = $('[data-screen="game"]');
    this.boardEl = $('#board');
    this.rotor = $('#board-rotor');
    this.info = $('#game-info');

    this.board = new BoardRenderer($('#board-svg'));
    this.tokens = new TokenLayer($('#tokens'));
    this.panels = new PlayerPanels(this.root, { onRoll: () => this.requestRoll() });

    const fxLayer = h('div', { class: 'fx-layer' });
    this.boardEl.append(fxLayer);
    this.effects = new Effects(fxLayer);

    this.queue = [];
    this.busy = false;
    this.state = null;
    this.gameId = null;
    this.me = null;
    this.awaiting = false; // sent an action, waiting for the server

    this.tokens.on('select', ({ index }) => this.requestMove(index));

    $('#emote-bar').replaceChildren(
      ...EMOTES.map((e) => h('button', { type: 'button', 'aria-label': `Send ${e}`, text: e, onclick: () => this.emit('emote', e) })),
    );

    document.addEventListener('keydown', (e) => {
      if (this.root.hidden || e.target.closest('input')) return;
      if (e.code === 'Space' || e.key === 'Enter') {
        if (this.canRoll()) {
          e.preventDefault();
          this.requestRoll();
        }
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && this.canMove()) {
        const move = this.state.legalMoves.find((m) => m.index === n - 1);
        if (move) this.requestMove(move.index);
      }
    });
  }

  get myColor() {
    return this.state?.players.find((p) => p.id === this.me)?.color ?? null;
  }

  canRoll() {
    const s = this.state;
    return !!s && !this.busy && !this.awaiting && !s.over && s.turn === this.myColor && s.phase === 'roll';
  }

  canMove() {
    const s = this.state;
    return !!s && !this.busy && !this.awaiting && !s.over && s.turn === this.myColor && s.phase === 'move';
  }

  requestRoll() {
    if (!this.canRoll()) return;
    this.awaiting = true;
    this.panels.diceOf(this.myColor)?.setState('waiting');
    this.emit('roll');
  }

  requestMove(index) {
    if (!this.canMove()) return;
    this.awaiting = true;
    this.tokens.setMovable([]);
    this.emit('move', index);
  }

  /** Called by the app if the server rejects an action. */
  actionFailed() {
    this.awaiting = false;
    if (this.state) this.render(this.state);
  }

  // ---------------------------------------------------------------- queue

  handle(payload, me) {
    this.me = me;
    payload.receivedAt = performance.now();
    const { state } = payload;
    if (!state) return;
    if (payload.sync || state.gameId !== this.gameId) {
      // New game or resync: drop pending animations and snap to the state.
      this.queue = [];
      this.setup(state);
    }
    this.queue.push(payload);
    this.pump();
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const msg = this.queue.shift();
      const fast = document.hidden || this.queue.length > 3;
      if (!fast) {
        for (const e of msg.events) {
          try {
            await this.play(e, msg.state);
          } catch (err) {
            console.error(err);
          }
        }
      }
      this.awaiting = false;
      this.render(msg.state, msg.receivedAt);
      if (msg.state.over && msg.events.some((e) => e.type === EVT.GAME_OVER)) this.emit('over', msg.state);
    }
    this.busy = false;
  }

  // ---------------------------------------------------------------- setup / render

  setup(state) {
    this.gameId = state.gameId;
    this.state = state;
    const me = state.players.find((p) => p.id === this.me);
    // Rotate so my colour sits bottom-left (visual corner 3).
    const rotation = me ? (3 - COLORS.indexOf(me.color) + 4) % 4 : 0;
    this.rotation = rotation;
    this.rotor.style.setProperty('--rot', `${rotation * 90}deg`);
    this.rotor.style.setProperty('--counter-rot', `${-rotation * 90}deg`);
    this.effects.rotation = rotation;
    this.tokens.clear();
    this.tokens.sync(state);
    this.panels.setup(state, rotation);
    this.renderTeamBadges(state);
  }

  /** In team mode, label each yard with its team so partners are obvious on the board. */
  renderTeamBadges(state) {
    this.boardEl.querySelectorAll('.yard-badge').forEach((el) => el.remove());
    if (!state.teams) return;
    for (const p of state.players) {
      const [r, c] = YARD_ORIGIN[p.color];
      const pos = this.effects.toScreen({ x: c + 3, y: r + 3 }); // centre of the yard, between the 4 token spots
      const mine = p.team === state.players.find((x) => x.id === this.me)?.team;
      this.boardEl.querySelector('.fx-layer').append(
        h('span', { class: `yard-badge team-badge team-badge--${p.team ? 'b' : 'a'}${mine ? ' is-mine' : ''}`, style: pos, title: TEAM_LABELS[p.team], text: p.team ? 'B' : 'A' }),
      );
    }
  }

  render(state, receivedAt = performance.now()) {
    this.state = state;
    this.tokens.sync(state);

    const myTurn = !state.over && state.turn === this.myColor;
    this.tokens.setMovable(myTurn && state.phase === 'move' && !this.awaiting ? state.legalMoves : []);
    this.board.highlightYard(state.over ? null : state.turn);

    let timer = null;
    if (state.turnDeadline) {
      const spent = performance.now() - receivedAt;
      timer = {
        totalMs: state.turnSeconds * 1000,
        remainingMs: Math.min(state.turnSeconds * 1000, state.turnDeadline - state.serverNow - spent),
      };
    }
    this.panels.update(state, { myColor: this.myColor, timer });
    this.renderInfo(state);
  }

  renderInfo(state) {
    const cfg = getModeConfig(state.mode);
    const current = state.players.find((p) => p.color === state.turn);
    const myTurn = state.turn === this.myColor;
    let title;
    let sub;
    if (state.over) {
      title = 'Game over';
      sub = cfg.label;
    } else if (myTurn) {
      title = state.phase === 'roll' ? 'Your turn — roll!' : 'Pick a token';
      if (state.controlledColor && state.controlledColor !== this.myColor) sub = `Moving your partner’s ${state.controlledColor} tokens`;
      else sub = state.phase === 'roll' ? 'Tap the dice or press Space' : `You rolled ${state.dice}`;
    } else {
      title = h('span', {}, h('b', { text: current?.name ?? '' }), '’s turn');
      const mate = state.teams && current?.team === state.players.find((p) => p.id === this.me)?.team;
      sub = state.phase === 'move' ? `Rolled ${state.dice}` : `${cfg.icon} ${cfg.label}`;
      if (state.teams && current) {
        const team = `${TEAM_LABELS[current.team]}${mate ? ' · your partner' : ''}`;
        sub = state.phase === 'move' ? `${team} · ${sub}` : team;
      }
    }
    const banner = h('div', { class: `turn-banner${myTurn && !state.over ? ' is-me' : ''}`, dataset: { color: state.turn } },
      title, h('span', { class: 'turn-banner__sub', text: sub }));
    this.info.replaceChildren(banner);
  }

  // ---------------------------------------------------------------- event animations

  nameOf(color, state) {
    const p = state.players.find((x) => x.color === color);
    return color === this.myColor ? 'You' : p?.name ?? COLOR_LABELS[color];
  }

  async play(e, state) {
    switch (e.type) {
      case EVT.ROLL: {
        const dice = this.panels.diceOf(e.color);
        sound.dice();
        await dice?.roll(e.value);
        break;
      }
      case EVT.MOVE: {
        this.tokens.setMovable([]);
        await this.tokens.animateMove(e);
        const landing = positionToPoint(e.color, e.to, e.index);
        if (e.from === POS.YARD) this.effects.ring(landing, e.color);
        if (e.captures.length) {
          sound.capture();
          this.boardEl.classList.remove('is-shaking');
          void this.boardEl.offsetWidth;
          this.boardEl.classList.add('is-shaking');
          this.effects.burst(landing, e.captures[0].color, 14);
          this.effects.label(landing, 'Captured!', e.color);
          await Promise.all(e.captures.map((c) => this.tokens.animateCapture(c)));
        }
        if (e.to === POS.HOME) {
          sound.home();
          this.effects.burst(landing, e.color, 16);
          this.effects.label(CENTER, 'Home!', e.color);
        }
        break;
      }
      case EVT.NO_MOVES:
        if (e.color === this.myColor) toast('No moves possible', { color: e.color, ms: 1400 });
        await sleep(350);
        break;
      case EVT.FORFEIT:
        sound.bad();
        toast(`Three 6s in a row — ${this.nameOf(e.color, state) === 'You' ? 'you lose' : `${this.nameOf(e.color, state)} loses`} the turn`, { type: 'error', color: e.color });
        await sleep(500);
        break;
      case EVT.EXTRA_TURN: {
        const text = { six: 'Rolled 6 — roll again!', capture: 'Capture bonus roll!', home: 'Home bonus roll!' }[e.reason];
        if (e.color === this.myColor && e.reason !== 'six') this.effects.label(CENTER, '+1 Roll', e.color);
        if (e.color === this.myColor) toast(text, { color: e.color, ms: 1400 });
        break;
      }
      case EVT.FINISH: {
        const who = this.nameOf(e.color, state);
        toast(`${who} finished ${ordinal(e.rank)}! 🎉`, { type: 'success', color: e.color, ms: 2600 });
        break;
      }
      case EVT.TURN:
        if (e.color === this.myColor) sound.turn();
        break;
      case EVT.GAME_OVER:
        await sleep(300);
        break;
      default:
        break;
    }
    await sleep(TIMING.EVENT_GAP_MS);
  }

  emote(color, emoji) {
    this.panels.emote(color, emoji);
  }

  reset() {
    this.queue = [];
    this.gameId = null;
    this.state = null;
    this.awaiting = false;
  }
}

export function ordinal(n) {
  return `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;
}

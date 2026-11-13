/**
 * App bootstrap: wires the socket, views and screen routing together.
 */
import { $, h } from './core/dom.js';
import { Socket } from './core/Socket.js';
import { storage } from './core/storage.js';
import { sound } from './core/Sound.js';
import { toast } from './ui/Toast.js';
import { confetti } from './ui/Confetti.js';
import { HomeView } from './ui/HomeView.js';
import { LobbyView } from './ui/LobbyView.js';
import { GameView, ordinal } from './game/GameView.js';
import { MSG, COLOR_LABELS } from '/shared/constants.js';
import { TEAM_NAMES, TEAM_LABELS, teamOf } from '/shared/modes.js';

class App {
  constructor() {
    this.me = storage.get('session');
    this.room = null;
    this.screen = null;
    this.pendingJoin = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? null;

    this.home = new HomeView();
    this.lobby = new LobbyView();
    this.game = new GameView();

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new Socket(`${proto}://${location.host}/ws`);

    this.bindSocket();
    this.bindViews();
    this.bindGlobal();
    this.show('home');
    if (this.pendingJoin) this.home.prefillCode(this.pendingJoin);
  }

  send(type, payload) {
    this.socket.send(type, payload);
  }

  // ------------------------------------------------------------ routing

  show(screen) {
    if (this.screen === screen) return;
    this.screen = screen;
    for (const el of document.querySelectorAll('[data-screen]')) el.hidden = el.dataset.screen !== screen;
    $('#stats-btn').hidden = screen !== 'game';
    window.scrollTo({ top: 0 });
  }

  setUrlRoom(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    history.replaceState(null, '', url);
  }

  // ------------------------------------------------------------ socket

  bindSocket() {
    const s = this.socket;
    const conn = $('.conn');
    s.on('status', (status) => {
      conn.dataset.conn = status;
      $('.conn__label', conn).textContent = { connecting: 'Connecting…', online: 'Online', offline: 'Reconnecting…' }[status];
    });

    s.on('open', () => {
      this.send(MSG.HELLO, { sessionId: storage.get('session'), name: storage.get('name', '') });
    });

    s.on(MSG.WELCOME, ({ sessionId, roomCode }) => {
      this.me = sessionId;
      storage.set('session', sessionId);
      if (!roomCode) {
        this.room = null;
        this.updateExit();
        if (this.pendingJoin && storage.get('name')) {
          this.send(MSG.JOIN_ROOM, { code: this.pendingJoin, name: storage.get('name') });
        } else if (this.screen !== 'home') {
          this.show('home');
        }
      }
      this.pendingJoin = null;
    });

    s.on(MSG.ROOM, (room) => this.onRoom(room));
    s.on(MSG.GAME, (payload) => {
      this.game.handle(payload, this.me);
      if (this.room?.status !== 'lobby') this.show('game');
      // Reconnected after the game ended: show the final standings straight away.
      if (payload.sync && payload.state?.over) this.showResults(payload.state);
    });
    s.on(MSG.LEFT, ({ reason }) => {
      this.room = null;
      this.updateExit();
      this.game.reset();
      this.hideModal('results-modal');
      this.setUrlRoom(null);
      this.show('home');
      if (reason) toast(reason, { type: 'error' });
    });
    s.on(MSG.ERROR, ({ message }) => {
      toast(message, { type: 'error' });
      sound.bad();
      this.game.actionFailed();
      if (/not found/i.test(message)) this.setUrlRoom(null);
    });
    s.on(MSG.NOTICE, ({ message }) => toast(message));
    s.on(MSG.SWAP_REQUEST, (req) => this.showSwapRequest(req));
    s.on(MSG.EMOTE_BROADCAST, ({ color, emote }) => this.game.emote(color, emote));
  }

  onRoom(room) {
    const prev = this.room;
    this.room = room;
    this.setUrlRoom(room.code);
    this.updateExit();

    if (room.status === 'playing') {
      this.hideModal('results-modal');
      this.show('game');
    } else if (room.status === 'lobby' || (room.status === 'ended' && this.screen === 'lobby')) {
      this.show('lobby');
    } else if (room.status === 'ended' && this.screen !== 'game') {
      this.show('lobby');
    }
    this.lobby.render(room, this.me);
    $('#rematch-btn').hidden = room.hostId !== this.me;
    if (!prev && room.status === 'lobby') toast(`Joined room ${room.code}`, { type: 'success' });
  }

  // ------------------------------------------------------------ views

  bindViews() {
    this.home.on('create', ({ name, mode }) => this.send(MSG.CREATE_ROOM, { name, mode }));
    this.home.on('join', ({ name, code }) => this.send(MSG.JOIN_ROOM, { name, code }));
    this.home.on('solo', ({ name, mode }) => {
      // Messages are processed in order on one socket, so this is safe to pipeline.
      this.send(MSG.CREATE_ROOM, { name, mode });
      for (let i = 0; i < 3; i++) this.send(MSG.ADD_BOT, {});
      this.send(MSG.START_GAME);
    });

    this.lobby.on('seat', (color) => this.send(MSG.TAKE_SEAT, { color }));
    this.lobby.on('bot', (color) => this.send(MSG.ADD_BOT, { color }));
    this.lobby.on('kick', (color) => this.send(MSG.KICK, { color }));
    this.lobby.on('swap', (color) => this.send(MSG.SWAP_SEAT, { color }));
    this.lobby.on('mode', (mode) => this.send(MSG.SET_MODE, { mode }));
    this.lobby.on('start', () => this.send(MSG.START_GAME));
    this.lobby.on('copy', () => this.copyInvite());

    this.game.on('roll', () => this.send(MSG.ROLL));
    this.game.on('move', (tokenIndex) => this.send(MSG.MOVE, { tokenIndex }));
    this.game.on('emote', (emote) => this.send(MSG.EMOTE, { emote }));
    this.lobby.on('option', ({ key, value }) => this.send(MSG.SET_OPTION, { key, value }));
    this.game.on('over', (state) => this.showResults(state));
  }

  bindGlobal() {
    document.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      switch (action) {
        case 'home':
          // Never hard-navigate away from a running room; the logo only returns home when idle.
          e.preventDefault();
          if (!this.room) this.show('home');
          else toast('Leave the room first to go back home');
          break;
        case 'exit':
          this.confirmExit();
          break;
        case 'exit-no':
          this.hideModal('exit-modal');
          break;
        case 'swap-yes':
        case 'swap-no':
          this.hideModal('swap-modal');
          clearTimeout(this.swapTimer);
          this.send(MSG.SWAP_RESPONSE, { accept: action === 'swap-yes' });
          break;
        case 'exit-yes':
          this.hideModal('exit-modal');
          this.exitToHome();
          break;
        case 'stats':
          this.showStats();
          break;
        case 'rules':
          this.showModal('rules-modal');
          break;
        case 'close-modal':
          e.target.closest('.modal').hidden = true;
          break;
        case 'sound': {
          const on = sound.toggle();
          e.target.textContent = on ? '🔊' : '🔇';
          break;
        }
        case 'rematch':
          this.send(MSG.REMATCH);
          break;
        case 'to-home':
          this.exitToHome();
          break;
        case 'to-lobby':
          this.hideModal('results-modal');
          this.show('lobby');
          if (this.room) this.lobby.render(this.room, this.me);
          break;
        default:
          break;
      }
    });
    document.querySelectorAll('.modal').forEach((m) =>
      m.addEventListener('click', (e) => {
        if (e.target === m && m.id !== 'results-modal') m.hidden = true;
      }),
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideModal('rules-modal');
        this.hideModal('exit-modal');
        this.hideModal('stats-modal');
      }
    });
    $('[data-action="sound"]').textContent = sound.enabled ? '🔊' : '🔇';
    // Browsers require a gesture before audio can start.
    document.addEventListener('pointerdown', () => sound.ensure(), { once: true });
  }

  showSwapRequest({ fromName, fromColor, toColor, mode }) {
    const teams = mode === 'team';
    const dest = teams
      ? `${TEAM_LABELS[teamOf(fromColor)]} (${COLOR_LABELS[fromColor]})`
      : COLOR_LABELS[fromColor];
    $('#swap-title').textContent = `${fromName} wants to swap seats`;
    $('#swap-text').textContent = teams && teamOf(fromColor) !== teamOf(toColor)
      ? `You would move to ${dest}, and ${fromName} would join your team.`
      : `You would move to ${dest}.`;
    this.showModal('swap-modal');
    clearTimeout(this.swapTimer);
    // Auto-decline if ignored, so the requester isn't left waiting.
    this.swapTimer = setTimeout(() => {
      if (!$('#swap-modal').hidden) {
        this.hideModal('swap-modal');
        this.send(MSG.SWAP_RESPONSE, { accept: false });
      }
    }, 30_000);
  }

  confirmExit() {
    const playing = this.room?.status === 'playing';
    $('#exit-text').textContent = playing
      ? 'You’ll leave this match and go back to the home page. A bot will take over your tokens.'
      : 'You’ll leave this room and go back to the home page.';
    this.showModal('exit-modal');
    $('[data-action="exit-no"]').focus();
  }

  exitToHome() {
    if (this.room) this.send(MSG.LEAVE_ROOM);
    // Go home immediately; the server's LEFT reply just confirms it.
    this.room = null;
    this.game.reset();
    this.hideModal('results-modal');
    this.setUrlRoom(null);
    this.updateExit();
    this.show('home');
  }

  updateExit() {
    $('#exit-btn').hidden = !this.room;
  }

  showModal(id) {
    $(`#${id}`).hidden = false;
  }

  hideModal(id) {
    $(`#${id}`).hidden = true;
  }

  async copyInvite() {
    const link = `${location.origin}/?room=${this.room?.code ?? ''}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied!', { type: 'success' });
    } catch {
      prompt('Copy this invite link:', link);
    }
  }

  /** Show how often each face came up for every player, so anyone can see the dice are fair. */
  showStats() {
    const state = this.game.state;
    if (!state) return;
    const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
    const total = [0, 0, 0, 0, 0, 0];
    const rows = state.players.map((p) => {
      const rolls = p.rolls ?? [0, 0, 0, 0, 0, 0];
      rolls.forEach((n, i) => { total[i] += n; });
      return this.statsRow(p.name + (p.id === this.me ? ' (you)' : ''), p.color, rolls, pct);
    });
    const all = total.reduce((a, b) => a + b, 0);
    $('#stats-body').replaceChildren(
      ...rows,
      this.statsRow('All players', null, total, pct),
      h('p', { class: 'stats__note', text: all
        ? `Over ${all} rolls, a 6 came up ${pct(total[5], all)} of the time. A fair die averages 16.7% for each face — short games naturally swing a few % either way, for everyone equally.`
        : 'No rolls yet.' }),
    );
    this.showModal('stats-modal');
  }

  statsRow(name, color, rolls, pct) {
    const n = rolls.reduce((a, b) => a + b, 0);
    const max = Math.max(1, ...rolls);
    return h('div', { class: `stats__row${color ? '' : ' stats__row--total'}`, dataset: { color: color ?? '' } },
      h('div', { class: 'stats__head' },
        h('span', { class: 'stats__dot' }),
        h('b', { text: name }),
        h('small', { text: `${n} roll${n === 1 ? '' : 's'} · 6s: ${rolls[5]} (${pct(rolls[5], n)})` })),
      h('div', { class: 'stats__bars' }, rolls.map((c, i) =>
        h('div', { class: 'stats__bar', title: `${i + 1}: ${c} (${pct(c, n)})` },
          h('span', { class: 'stats__count', text: String(c) }),
          h('i', { style: { height: `${(c / max) * 100}%` } }),
          h('span', { class: 'stats__face', text: String(i + 1) })))));
  }

  showResults(state) {
    const myColor = state.players.find((p) => p.id === this.me)?.color;
    const iWon = state.winners?.includes(myColor);
    let title;
    if (state.teams) title = `Team ${TEAM_NAMES[state.players.find((p) => p.color === state.winners[0]).team]} wins!`;
    else {
      const winner = state.players.find((p) => p.color === state.winners[0]);
      title = winner.color === myColor ? 'You win!' : `${winner.name} wins!`;
    }
    $('#results-title').textContent = title;
    $('#results-list').replaceChildren(
      ...state.standings.map((s, i) =>
        h('li', { dataset: { color: s.color }, style: { animationDelay: `${i * 0.1}s` } },
          h('span', { class: 'place', text: state.winners.includes(s.color) ? '🥇' : ordinal(s.place) }),
          h('span', { class: 'who' }, s.name + (s.color === myColor ? ' (you)' : ''),
            h('small', { text: `${s.home} token${s.home === 1 ? '' : 's'} home` })),
        ),
      ),
    );
    $('#rematch-btn').hidden = this.room?.hostId !== this.me;
    this.showModal('results-modal');
    if (iWon) {
      sound.win();
      confetti();
    } else sound.bad();
  }
}

new App();

/**
 * Lobby screen: seats, bots, mode selection and start.
 */
import { $, h } from '../core/dom.js';
import { Emitter } from '../core/Emitter.js';
import { COLORS, COLOR_LABELS } from '/shared/constants.js';
import { MODE_CONFIG, getModeConfig, teamOf, TEAM_NAMES, TEAM_LABELS, TEAM_SEATS } from '/shared/modes.js';

export class LobbyView extends Emitter {
  constructor() {
    super();
    this.root = $('[data-screen="lobby"]');
    this.seatsEl = $('#seats');
    this.modesEl = $('#lobby-modes');
    this.room = null;
    this.me = null;
    this.blocksToggle = $('#blocks-toggle');
    this.blocksToggle.addEventListener('change', () =>
      this.emit('option', { key: 'blocks', value: this.blocksToggle.checked }));

    this.root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const { action, color, mode } = el.dataset;
      if (action === 'sit') this.emit('seat', color);
      if (action === 'bot') this.emit('bot', color);
      if (action === 'kick') this.emit('kick', color);
      if (action === 'swap') this.emit('swap', color);
      if (action === 'mode') this.emit('mode', mode);
      if (action === 'start') this.emit('start');
      if (action === 'copy-link') this.emit('copy');
    });
  }

  render(room, me) {
    this.room = room;
    this.me = me;
    const isHost = room.hostId === me;
    const cfg = getModeConfig(room.mode);

    $('#lobby-code').textContent = room.code;
    $('#lobby-mode-hint').textContent = isHost ? '' : '(host picks)';
    $('#lobby-mode-desc').textContent = cfg.description;

    this.modesEl.replaceChildren(
      ...Object.values(MODE_CONFIG).map((m) =>
        h('button', {
          class: 'mode-tab',
          role: 'tab',
          'aria-selected': String(m.id === room.mode),
          disabled: !isHost,
          dataset: { action: 'mode', mode: m.id },
          text: `${m.icon} ${m.label}`,
        }),
      ),
    );

    this.blocksToggle.checked = !!room.options?.blocks;
    this.blocksToggle.disabled = !isHost;
    $('#blocks-option').classList.toggle('is-locked', !isHost);

    const mySeat = COLORS.find((c) => room.seats[c]?.id === me);
    const ctx = { isHost, mySeat, cfg };
    this.seatsEl.classList.toggle('seats--teams', cfg.teams);
    if (cfg.teams) {
      // Group partners together so it's obvious who plays with whom.
      this.seatsEl.replaceChildren(
        ...TEAM_SEATS.map((colors, team) => {
          const mine = colors.includes(mySeat);
          return h('div', { class: `team-group team-group--${team ? 'b' : 'a'}${mine ? ' is-mine' : ''}` },
            h('div', { class: 'team-group__head' },
              h('span', { class: `team-badge team-badge--${team ? 'b' : 'a'}`, text: TEAM_LABELS[team] }),
              h('span', { class: 'team-group__colors', text: TEAM_NAMES[team] }),
              mine ? h('span', { class: 'tag', text: 'Your team' }) : null),
            h('div', { class: 'team-group__seats' }, colors.map((c) => this.seatCard(c, room, ctx))));
        }),
      );
    } else {
      this.seatsEl.replaceChildren(...COLORS.map((color) => this.seatCard(color, room, ctx)));
    }

    const filled = COLORS.filter((c) => room.seats[c]).length;
    let status;
    if (filled < cfg.minPlayers) {
      const need = cfg.minPlayers - filled;
      status = cfg.teams
        ? `Team mode needs all 4 seats — ${need} more (add bots or invite friends).`
        : `Waiting for ${need} more player${need > 1 ? 's' : ''}…`;
    } else {
      status = isHost ? `${filled} players ready. Start when you like!` : 'Waiting for the host to start…';
    }
    $('#lobby-status').textContent = status;
    const startBtn = $('#start-btn');
    startBtn.hidden = !isHost;
    startBtn.disabled = filled < cfg.minPlayers;
  }

  seatCard(color, room, { isHost, mySeat, cfg }) {
    const seat = room.seats[color];
    const isMe = seat?.id === this.me;
    const children = [];

    if (seat) {
      const tags = [];
      if (isMe) tags.push(h('span', { class: 'tag', text: 'You' }));
      if (seat.id === room.hostId) tags.push(h('span', { class: 'tag tag--host', text: 'Host' }));
      if (seat.isBot) tags.push(h('span', { class: 'tag', text: 'Bot' }));
      if (!seat.connected) tags.push(h('span', { class: 'tag tag--off', text: 'Offline' }));
      children.push(
        h('div', { class: 'seat__top' },
          h('span', { class: 'seat__dot', text: seat.name.charAt(0).toUpperCase() }),
          h('div', { style: { minWidth: 0 } },
            h('div', { class: 'seat__name', text: seat.name }),
            h('div', { class: 'seat__meta' }, tags),
          ),
        ),
      );
      if (mySeat && !isMe) {
        const otherTeam = cfg.teams && teamOf(color) !== teamOf(mySeat);
        const label = otherTeam ? `⇄ Join ${TEAM_LABELS[teamOf(color)]}` : '⇄ Swap seats';
        const hint = seat.isBot || isHost ? 'Swaps instantly' : `Asks ${seat.name} to swap`;
        children.push(h('div', { class: 'seat__actions' },
          h('button', { class: 'btn btn--ghost btn--sm', title: hint, dataset: { action: 'swap', color }, text: label })));
      }
      if (isHost && !isMe) {
        children.push(h('button', { class: 'icon-btn seat__kick', title: 'Remove', 'aria-label': `Remove ${seat.name}`, dataset: { action: 'kick', color }, text: '✕' }));
      }
    } else {
      children.push(
        h('div', { class: 'seat__top' },
          h('span', { class: 'seat__dot', style: { opacity: 0.5 } }),
          h('div', { class: 'seat__name', style: { color: 'var(--muted)' }, text: `${COLOR_LABELS[color]} — open` }),
        ),
      );
      const actions = [];
      if (mySeat) {
        const otherTeam = cfg.teams && teamOf(color) !== teamOf(mySeat);
        actions.push(h('button', { class: 'btn btn--ghost btn--sm', dataset: { action: 'sit', color }, text: otherTeam ? `Join ${TEAM_LABELS[teamOf(color)]}` : 'Sit here' }));
      }
      if (isHost) actions.push(h('button', { class: 'btn btn--ghost btn--sm', dataset: { action: 'bot', color }, text: '+ Bot' }));
      children.push(h('div', { class: 'seat__actions' }, actions));
    }

    return h('div', { class: `seat${seat ? ' is-filled' : ''}${isMe ? ' is-me' : ''}`, dataset: { color } }, children);
  }
}

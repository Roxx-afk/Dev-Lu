/**
 * Player panels in the four corners around the board: avatar, turn timer,
 * home progress, status tags, dice and emotes.
 */
import { $, h } from '../core/dom.js';
import { Dice } from './Dice.js';
import { COLORS } from '/shared/constants.js';
import { TEAM_LABELS } from '/shared/modes.js';

export class PlayerPanels {
  constructor(root, { onRoll }) {
    this.root = root;
    this.onRoll = onRoll;
    this.panels = new Map(); // color -> { el, dice, refs }
    this.urgentTimer = null;
  }

  /** Build panels for the players in this game and place them in visual corners. */
  setup(state, rotation) {
    for (const slot of this.root.querySelectorAll('.panel-slot')) slot.replaceChildren();
    this.panels.clear();
    for (const p of state.players) {
      const dice = new Dice({ onRoll: this.onRoll });
      const timer = h('span', { class: 'panel__avatar' });
      timer.innerHTML = '<svg class="panel__timer" viewBox="0 0 46 46"><circle class="track" cx="23" cy="23" r="21"/><circle class="bar" cx="23" cy="23" r="21"/></svg>';
      const initial = h('span', { class: 'panel__initial' });
      timer.append(initial);
      const name = h('div', { class: 'panel__name' });
      const meta = h('div', { class: 'panel__meta' });
      const el = h('div', { class: 'panel', dataset: { color: p.color } },
        timer,
        h('div', { class: 'panel__body' }, name, meta),
        h('div', { class: 'dice-slot' }, dice.el),
      );
      const corner = (COLORS.indexOf(p.color) + rotation) % 4;
      $(`.panel-slot[data-corner="${corner}"]`, this.root).append(el);
      this.panels.set(p.color, { el, dice, initial, name, meta, bar: timer.querySelector('.bar') });
    }
  }

  get(color) {
    return this.panels.get(color);
  }

  diceOf(color) {
    return this.panels.get(color)?.dice;
  }

  update(state, { myColor, timer }) {
    for (const p of state.players) {
      const panel = this.panels.get(p.color);
      if (!panel) continue;
      const active = !state.over && state.turn === p.color;
      const out = p.rank !== null && !(state.teams && state.controlledColor && active);

      panel.el.classList.toggle('is-active', active);
      panel.el.classList.toggle('is-out', out && !active);
      panel.el.classList.toggle('is-offline', !p.connected && !p.isBot);
      panel.initial.textContent = p.name.replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?';
      panel.name.textContent = p.name;

      const pips = h('span', { class: 'home-pips', title: `${p.home}/${state.tokensToFinish} home` },
        ...Array.from({ length: state.tokensToFinish }, (_, i) => h('i', { class: i < p.home ? 'on' : '' })));
      const tags = [pips];
      if (p.rank) tags.push(h('span', { class: 'panel__rank', text: `#${p.rank}` }));
      if (p.color === myColor) tags.push(h('span', { class: 'tag', text: 'You' }));
      if (state.teams) {
        const partner = state.players.find((o) => o.team === p.team && o.color !== p.color);
        tags.unshift(h('span', { class: `team-badge team-badge--${p.team ? 'b' : 'a'}`, title: `Partner: ${partner?.name ?? '?'}`, text: TEAM_LABELS[p.team] }));
        if (partner) tags.push(h('span', { class: 'panel__partner', text: `w/ ${partner.name}` }));
      }
      if (!p.connected && !p.isBot) tags.push(h('span', { class: 'tag tag--off', text: 'Offline' }));
      if (active && state.teams && state.controlledColor && state.controlledColor !== p.color) {
        tags.push(h('span', { class: 'tag', text: `Moving ${state.controlledColor}` }));
      }
      panel.meta.replaceChildren(...tags);

      const dice = panel.dice;
      if (active && state.dice) dice.show(state.dice);
      const canRoll = active && p.color === myColor && state.phase === 'roll';
      dice.setState(canRoll ? 'ready' : active ? 'waiting' : 'idle');

      this.setTimer(panel, active ? timer : null);
    }
  }

  /** Drive the circular countdown around the active player's avatar. */
  setTimer(panel, timer) {
    const { el, bar } = panel;
    el.classList.remove('is-timing', 'is-urgent');
    if (!timer || timer.remainingMs <= 0) return;
    const total = timer.totalMs;
    const elapsed = Math.max(0, total - timer.remainingMs);
    el.style.setProperty('--t', `${total}ms`);
    bar.style.animationDelay = `-${elapsed}ms`;
    void bar.getBoundingClientRect(); // restart the CSS animation
    el.classList.add('is-timing');
    clearTimeout(this.urgentTimer);
    const untilUrgent = timer.remainingMs - 5000;
    this.urgentTimer = setTimeout(() => el.classList.add('is-urgent'), Math.max(0, untilUrgent));
  }

  emote(color, emoji) {
    const panel = this.panels.get(color);
    if (!panel) return;
    const bubble = h('span', { class: 'panel__emote', text: emoji });
    panel.el.append(bubble);
    bubble.addEventListener('animationend', () => bubble.remove(), { once: true });
  }
}

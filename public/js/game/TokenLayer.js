/**
 * Renders the 16 (or fewer) tokens as absolutely-positioned buttons over the
 * board and animates them square-by-square.
 */
import { h, sleep, nextFrame } from '../core/dom.js';
import { Emitter } from '../core/Emitter.js';
import { sound } from '../core/Sound.js';
import { POS, TIMING } from '/shared/constants.js';
import { positionToPoint } from '/shared/board.js';

const pct = (v) => `${(v / 15) * 100}%`;

/** Offsets (as % of token size) and scale for N tokens sharing a square. */
const STACK_LAYOUT = {
  1: { s: 1, o: [[0, 0]] },
  2: { s: 0.78, o: [[-28, -10], [28, 10]] },
  3: { s: 0.68, o: [[-30, -24], [30, -24], [0, 28]] },
  4: { s: 0.62, o: [[-30, -30], [30, -30], [-30, 30], [30, 30]] },
};

export class TokenLayer extends Emitter {
  constructor(container) {
    super();
    this.el = container;
    /** @type {Map<string, HTMLButtonElement>} */
    this.tokens = new Map();
    this.positions = new Map(); // key -> relative position

    this.el.addEventListener('click', (e) => {
      const t = e.target.closest('.token.is-movable');
      if (t) this.emit('select', { color: t.dataset.color, index: Number(t.dataset.index) });
    });
    this.el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.token.is-movable')) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  key(color, index) {
    return `${color}:${index}`;
  }

  get(color, index) {
    return this.tokens.get(this.key(color, index));
  }

  place(el, point) {
    el.style.left = pct(point.x);
    el.style.top = pct(point.y);
  }

  /** Make DOM tokens match a state snapshot exactly (no step animation). */
  sync(state) {
    const wanted = new Set();
    for (const p of state.players) {
      p.tokens.forEach((pos, i) => {
        const k = this.key(p.color, i);
        wanted.add(k);
        let el = this.tokens.get(k);
        if (!el) {
          el = h('button', {
            class: 'token',
            type: 'button',
            tabindex: '-1',
            'aria-label': `${p.color} token ${i + 1}`,
            dataset: { color: p.color, index: String(i) },
          }, h('span', { class: 'token__body' }));
          this.el.append(el);
          this.tokens.set(k, el);
        }
        this.positions.set(k, pos);
        this.place(el, positionToPoint(p.color, pos, i));
      });
    }
    for (const [k, el] of this.tokens) {
      if (!wanted.has(k)) {
        el.remove();
        this.tokens.delete(k);
        this.positions.delete(k);
      }
    }
    this.layoutStacks();
  }

  /** Spread out tokens that share a square so each stays visible and tappable. */
  layoutStacks() {
    const groups = new Map();
    for (const [k, pos] of this.positions) {
      const el = this.tokens.get(k);
      if (pos === POS.YARD || pos === POS.HOME) {
        this.setStack(el, 0, 0, pos === POS.HOME ? 0.62 : 1);
        continue;
      }
      const g = `${el.style.left}|${el.style.top}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(el);
    }
    for (const els of groups.values()) {
      const layout = STACK_LAYOUT[Math.min(els.length, 4)];
      els.forEach((el, i) => {
        const [dx, dy] = layout.o[i % layout.o.length];
        this.setStack(el, dx, dy, layout.s);
      });
    }
  }

  setStack(el, dx, dy, s) {
    el.style.setProperty('--dx', `${dx}%`);
    el.style.setProperty('--dy', `${dy}%`);
    el.style.setProperty('--s', s);
  }

  setMovable(moves = []) {
    const keys = new Set(moves.map((m) => this.key(m.color, m.index)));
    for (const [k, el] of this.tokens) {
      const on = keys.has(k);
      el.classList.toggle('is-movable', on);
      el.tabIndex = on ? 0 : -1;
    }
  }

  /** Step a token along its path, one hop per square. */
  async animateMove(move) {
    const el = this.get(move.color, move.index);
    if (!el) return;
    const k = this.key(move.color, move.index);
    this.setStack(el, 0, 0, 1);
    el.classList.add('is-moving');

    const isEntry = move.from === POS.YARD;
    const stepMs = isEntry ? TIMING.STEP_MS * 1.8 : TIMING.STEP_MS;
    el.style.setProperty('--move-ms', `${stepMs}ms`);

    for (const pos of move.path) {
      this.place(el, positionToPoint(move.color, pos, move.index));
      // restart hop animation
      el.classList.remove('is-moving');
      void el.offsetWidth;
      el.classList.add('is-moving');
      isEntry ? sound.enter() : sound.step();
      await sleep(stepMs);
    }
    el.classList.remove('is-moving');
    el.style.removeProperty('--move-ms');
    this.positions.set(k, move.to);
    if (move.to === POS.HOME) {
      el.classList.add('is-home');
      setTimeout(() => el.classList.remove('is-home'), 700);
    }
    this.layoutStacks();
  }

  /** Send a captured token flying back to its yard. */
  async animateCapture(capture) {
    const el = this.get(capture.color, capture.index);
    if (!el) return;
    el.classList.add('is-captured');
    el.style.setProperty('--move-ms', `${TIMING.CAPTURE_MS}ms`);
    await nextFrame();
    this.place(el, positionToPoint(capture.color, POS.YARD, capture.index));
    this.positions.set(this.key(capture.color, capture.index), POS.YARD);
    this.layoutStacks();
    await sleep(TIMING.CAPTURE_MS);
    el.classList.remove('is-captured');
    el.style.removeProperty('--move-ms');
  }

  clear() {
    this.el.replaceChildren();
    this.tokens.clear();
    this.positions.clear();
  }
}

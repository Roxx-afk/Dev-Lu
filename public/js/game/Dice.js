/**
 * 3D CSS dice. Each roll adds full spins so the cube always tumbles before
 * landing on the server-provided value.
 */
import { h, sleep } from '../core/dom.js';
import { TIMING } from '/shared/constants.js';

const PIPS = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

/** Cube rotation [x, y] that shows each face to the viewer. */
const FACE_ROTATION = {
  1: [0, 0],
  2: [0, -90],
  3: [-90, 0],
  4: [90, 0],
  5: [0, 90],
  6: [0, 180],
};

export class Dice {
  constructor({ onRoll } = {}) {
    this.spins = 0;
    this.value = 1;
    this.cube = h('div', { class: 'dice__cube' },
      ...[1, 2, 3, 4, 5, 6].map((n) =>
        h('div', { class: `dice__face dice__face--${n}` },
          ...PIPS[n].map((cell) => h('i', { style: { gridRow: String(Math.ceil(cell / 3)), gridColumn: String(((cell - 1) % 3) + 1) } })),
        ),
      ),
    );
    this.el = h('button', { class: 'dice is-idle', type: 'button', 'aria-label': 'Roll dice', disabled: true }, this.cube);
    this.el.style.setProperty('--roll-ms', `${TIMING.DICE_MS}ms`);
    this.el.addEventListener('click', () => {
      if (this.el.classList.contains('is-ready')) onRoll?.();
    });
    this.show(1, false);
  }

  show(value, tilt = true) {
    this.value = value;
    const [x, y] = FACE_ROTATION[value];
    this.cube.style.setProperty('--rx', `${x - 360 * this.spins + (tilt ? -12 : 0)}deg`);
    this.cube.style.setProperty('--ry', `${y + 360 * this.spins + (tilt ? 12 : 0)}deg`);
    this.el.classList.toggle('is-six', value === 6);
  }

  async roll(value) {
    this.spins += 2;
    this.setState('rolling');
    this.el.classList.add('is-rolling');
    this.show(value);
    await sleep(TIMING.DICE_MS);
    this.el.classList.remove('is-rolling');
  }

  /** idle | ready (my turn, tap to roll) | waiting (someone's turn) | rolling */
  setState(state) {
    this.el.classList.toggle('is-idle', state === 'idle');
    this.el.classList.toggle('is-ready', state === 'ready');
    this.el.disabled = state !== 'ready';
    this.el.setAttribute('aria-label', state === 'ready' ? 'Roll dice (Space)' : `Dice showing ${this.value}`);
  }
}

/**
 * Visual effects drawn above the board (bursts, rings, floating labels).
 * The layer is NOT rotated with the board so text stays upright; points are
 * converted from board coordinates using the current rotation.
 */
import { h } from '../core/dom.js';

const COLOR_VAR = { red: 'var(--red)', green: 'var(--green)', yellow: 'var(--yellow)', blue: 'var(--blue)' };

export class Effects {
  constructor(layer) {
    this.layer = layer;
    this.rotation = 0; // quarter turns clockwise
  }

  /** Rotate a board point by the board's rotation around the centre. */
  toScreen({ x, y }) {
    let p = { x, y };
    for (let i = 0; i < this.rotation; i++) p = { x: 15 - p.y, y: p.x };
    return { left: `${(p.x / 15) * 100}%`, top: `${(p.y / 15) * 100}%` };
  }

  add(el, ms) {
    this.layer.append(el);
    setTimeout(() => el.remove(), ms);
  }

  burst(point, color, count = 12) {
    const el = h('div', { class: 'fx-burst', style: { ...this.toScreen(point), '--c': COLOR_VAR[color] } });
    el.style.setProperty('--c', COLOR_VAR[color] ?? '#fff');
    for (let i = 0; i < count; i++) {
      const dot = h('i');
      dot.style.setProperty('--a', `${(360 / count) * i}deg`);
      el.append(dot);
    }
    this.add(el, 800);
  }

  ring(point, color) {
    const el = h('div', { class: 'fx-ring', style: this.toScreen(point) });
    el.style.setProperty('--c', COLOR_VAR[color] ?? '#fff');
    this.add(el, 800);
  }

  label(point, text, color) {
    const el = h('div', { class: 'fx-label', style: this.toScreen(point), text });
    el.style.setProperty('--c', COLOR_VAR[color] ?? '#000');
    this.add(el, 1200);
  }
}

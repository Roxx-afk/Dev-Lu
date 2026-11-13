import { $, h } from '../core/dom.js';

const MAX = 3;

/** Show a short message at the top of the screen. */
export function toast(message, { type = 'info', color = null, ms = 2200 } = {}) {
  const root = $('#toasts');
  const el = h('div', { class: `toast toast--${type}`, dataset: color ? { color } : undefined, text: message });
  root.append(el);
  while (root.children.length > MAX) root.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

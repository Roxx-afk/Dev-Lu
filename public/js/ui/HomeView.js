/**
 * Home screen: name, mode picker, create / solo / join.
 */
import { $, h } from '../core/dom.js';
import { storage } from '../core/storage.js';
import { MODE_CONFIG, MODES } from '/shared/modes.js';
import { Emitter } from '../core/Emitter.js';

export class HomeView extends Emitter {
  constructor() {
    super();
    this.root = $('[data-screen="home"]');
    this.nameInput = $('#name-input');
    this.codeInput = $('#code-input');
    this.modeGrid = $('#mode-grid');
    this.mode = storage.get('mode', MODES.CLASSIC);

    this.nameInput.value = storage.get('name', '');
    this.nameInput.addEventListener('change', () => storage.set('name', this.name));

    this.renderModes();

    this.root.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'create') this.emit('create', { name: this.name, mode: this.mode });
      if (action === 'solo') this.emit('solo', { name: this.name, mode: this.mode });
    });

    $('#join-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = this.codeInput.value.trim().toUpperCase();
      if (code.length < 4) {
        this.codeInput.focus();
        return;
      }
      this.emit('join', { name: this.name, code });
    });
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
  }

  get name() {
    const n = this.nameInput.value.trim();
    storage.set('name', n);
    return n || `Player ${Math.floor(100 + Math.random() * 900)}`;
  }

  renderModes() {
    this.modeGrid.replaceChildren(
      ...Object.values(MODE_CONFIG).map((m) =>
        h(
          'button',
          {
            class: 'mode-card',
            type: 'button',
            role: 'radio',
            'aria-checked': String(m.id === this.mode),
            title: m.description,
            onclick: () => {
              this.mode = m.id;
              storage.set('mode', m.id);
              this.renderModes();
            },
          },
          h('span', { class: 'mode-card__icon', text: m.icon }),
          h('span', { class: 'mode-card__name', text: m.label }),
          h('span', { class: 'mode-card__tag', text: m.tagline }),
        ),
      ),
    );
  }

  prefillCode(code) {
    this.codeInput.value = code;
  }
}

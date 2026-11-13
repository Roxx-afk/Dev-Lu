/**
 * Draws the static 15x15 Ludo board as SVG (1 unit = 1 cell), so it scales
 * crisply to any screen size.
 */
import { svg } from '../core/dom.js';
import { COLORS } from '/shared/constants.js';
import {
  TRACK, START_INDEX, STAR_INDICES, HOME_COLUMNS, YARD_ORIGIN, YARD_SPOTS,
} from '/shared/board.js';

function starPath(cx, cy, outer = 0.36, inner = 0.15) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(3)},${(cy + r * Math.sin(a)).toFixed(3)}`);
  }
  return pts.join(' ');
}

export class BoardRenderer {
  constructor(svgEl) {
    this.svg = svgEl;
    this.yardGlows = {};
    this.draw();
  }

  draw() {
    const s = this.svg;
    s.replaceChildren();
    s.append(svg('rect', { x: 0, y: 0, width: 15, height: 15, rx: 0.25, fill: '#ffffff' }));

    // Yards
    for (const color of COLORS) {
      const [r, c] = YARD_ORIGIN[color];
      s.append(svg('rect', { class: `yard yard--${color}`, x: c, y: r, width: 6, height: 6, rx: 0.2 }));
      s.append(svg('rect', { class: 'yard-inner', x: c + 0.9, y: r + 0.9, width: 4.2, height: 4.2, rx: 0.12 }));
      for (const p of YARD_SPOTS[color]) {
        s.append(svg('circle', { class: `yard-spot yard-spot--${color}`, cx: p.x, cy: p.y, r: 0.62 }));
      }
      const glow = svg('rect', { class: 'yard-glow', x: c + 0.15, y: r + 0.15, width: 5.7, height: 5.7, rx: 0.4 });
      this.yardGlows[color] = glow;
      s.append(glow);
    }

    // Track squares
    const startColorAt = Object.fromEntries(Object.entries(START_INDEX).map(([c, i]) => [i, c]));
    TRACK.forEach(([r, c], i) => {
      const startColor = startColorAt[i];
      s.append(svg('rect', { class: `cell${startColor ? ` cell--${startColor}` : ''}`, x: c, y: r, width: 1, height: 1 }));
      if (STAR_INDICES.has(i)) s.append(svg('polygon', { class: `star${startColor ? ' star--on-color' : ''}`, points: starPath(c + 0.5, r + 0.5) }));
    });

    // Entry arrows: on the square where each colour turns off the track, point into its home column.
    for (const color of COLORS) {
      const [r, c] = TRACK[(START_INDEX[color] + 50) % TRACK.length];
      const [hr, hc] = HOME_COLUMNS[color][0];
      const angle = (Math.atan2(hr - r, hc - c) * 180) / Math.PI;
      const g = svg('g', { class: `arrow arrow--${color}`, transform: `rotate(${angle} ${c + 0.5} ${r + 0.5})` });
      g.append(svg('path', { d: `M ${c + 0.22} ${r + 0.5} H ${c + 0.76} M ${c + 0.54} ${r + 0.3} L ${c + 0.78} ${r + 0.5} L ${c + 0.54} ${r + 0.7}` }));
      s.append(g);
    }

    // Home columns
    for (const color of COLORS) {
      for (const [r, c] of HOME_COLUMNS[color]) {
        s.append(svg('rect', { class: `cell cell--${color}`, x: c, y: r, width: 1, height: 1 }));
      }
    }

    // Centre home triangles
    const tri = {
      red: '6,6 6,9 7.5,7.5',
      green: '6,6 9,6 7.5,7.5',
      yellow: '9,6 9,9 7.5,7.5',
      blue: '6,9 9,9 7.5,7.5',
    };
    for (const color of COLORS) s.append(svg('polygon', { class: `tri tri--${color}`, points: tri[color] }));
  }

  highlightYard(color) {
    for (const [c, el] of Object.entries(this.yardGlows)) el.classList.toggle('is-active', c === color);
  }
}

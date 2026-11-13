/**
 * Board geometry for a standard 15x15 Ludo board.
 *
 * Coordinates are [row, col] on the 15x15 grid. Points used for drawing are
 * {x, y} in "cell units" where the centre of cell (r, c) is (c + 0.5, r + 0.5).
 *
 * Layout (clockwise):  red = top-left, green = top-right,
 *                      yellow = bottom-right, blue = bottom-left.
 */
import { POS, TRACK_LENGTH } from './constants.js';

/** The 52 shared track squares, starting from red's start square, clockwise. */
export const TRACK = Object.freeze([
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0],
]);

/** Absolute track index of each colour's starting square. */
export const START_INDEX = Object.freeze({ red: 0, green: 13, yellow: 26, blue: 39 });

/**
 * Safe squares: the four starting squares and the four star squares
 * (8 squares ahead of each start). Tokens here cannot be captured.
 */
export const SAFE_INDICES = Object.freeze(new Set([0, 8, 13, 21, 26, 34, 39, 47]));
export const STAR_INDICES = Object.freeze(new Set([8, 21, 34, 47]));

/** Private home column for each colour (5 squares, outermost first). */
export const HOME_COLUMNS = Object.freeze({
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
});

/** Yard (base) regions as [row, col] of the top-left cell; each is 6x6. */
export const YARD_ORIGIN = Object.freeze({
  red: [0, 0],
  green: [0, 9],
  yellow: [9, 9],
  blue: [9, 0],
});

/** Centres of the four token spots inside each yard, in cell units. */
export const YARD_SPOTS = Object.freeze(
  Object.fromEntries(
    Object.entries(YARD_ORIGIN).map(([color, [r, c]]) => [
      color,
      [
        { x: c + 2, y: r + 2 },
        { x: c + 4, y: r + 2 },
        { x: c + 2, y: r + 4 },
        { x: c + 4, y: r + 4 },
      ],
    ]),
  ),
);

/** Where finished tokens rest inside the centre triangle of their colour. */
export const HOME_SPOTS = Object.freeze({
  red: { x: 6.55, y: 7.5 },
  green: { x: 7.5, y: 6.55 },
  yellow: { x: 8.45, y: 7.5 },
  blue: { x: 7.5, y: 8.45 },
});

export const cellCenter = ([r, c]) => ({ x: c + 0.5, y: r + 0.5 });

/** Convert a relative track position (0..50) into an absolute track index (0..51). */
export function toAbsolute(color, rel) {
  if (rel < POS.START || rel > POS.LAST_TRACK) return null;
  return (START_INDEX[color] + rel) % TRACK_LENGTH;
}

export const isSafeSquare = (absIndex) => SAFE_INDICES.has(absIndex);

/** Grid cell occupied by a token at a relative position, or null for yard/home. */
export function positionToCell(color, rel) {
  if (rel >= POS.START && rel <= POS.LAST_TRACK) return TRACK[toAbsolute(color, rel)];
  if (rel >= POS.HOME_COLUMN && rel < POS.HOME) return HOME_COLUMNS[color][rel - POS.HOME_COLUMN];
  return null;
}

/** Drawing point for a token. Yard and home use per-token resting spots. */
export function positionToPoint(color, rel, tokenIndex = 0) {
  if (rel === POS.YARD) return { ...YARD_SPOTS[color][tokenIndex] };
  if (rel === POS.HOME) {
    const base = HOME_SPOTS[color];
    const spread = [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]][tokenIndex];
    return { x: base.x + spread[0] * 0.8, y: base.y + spread[1] * 0.8 };
  }
  return cellCenter(positionToCell(color, rel));
}

/**
 * Simple heuristic bot. Scores every legal move and picks the best one.
 * Used for bot seats, disconnected players and turn timeouts.
 */
import { POS, TRACK_LENGTH } from '../../shared/constants.js';
import { toAbsolute, isSafeSquare } from '../../shared/board.js';

/** Number of opponent tokens that could reach `absIndex` with a single roll (1-6). */
function threatsAt(engine, mover, absIndex) {
  if (absIndex === null || isSafeSquare(absIndex)) return 0;
  let threats = 0;
  for (const p of engine.players) {
    if (engine.isFriendly(p, mover)) continue;
    for (const t of p.tokens) {
      if (t < POS.START || t > POS.LAST_TRACK) continue;
      const opAbs = toAbsolute(p.color, t);
      const dist = (absIndex - opAbs + TRACK_LENGTH) % TRACK_LENGTH;
      // Opponent must not have passed its own home entry to reach the square.
      if (dist >= 1 && dist <= 6 && t + dist <= POS.LAST_TRACK) threats++;
    }
  }
  return threats;
}

function scoreMove(engine, move) {
  const owner = engine.playerByColor(move.color);
  const fromAbs = toAbsolute(owner.color, move.from);
  const toAbs = toAbsolute(owner.color, move.to);
  let score = 0;

  for (const c of move.captures) score += 120 + Math.max(c.from, 0) * 2;
  if (move.to === POS.HOME) score += 90;
  if (move.from === POS.YARD) score += 70;
  if (move.from <= POS.LAST_TRACK && move.to >= POS.HOME_COLUMN && move.from !== POS.YARD) score += 45;
  if (toAbs !== null && isSafeSquare(toAbs)) score += 25;

  // Forming a block with a friendly token.
  if (toAbs !== null && engine.occupantsAt(toAbs).some((o) => o.player === owner)) score += 15;

  const dangerBefore = move.from === POS.YARD ? 0 : threatsAt(engine, owner, fromAbs);
  const dangerAfter = threatsAt(engine, owner, toAbs);
  score += dangerBefore * 30 * (1 + move.from / 50);
  score -= dangerAfter * 35 * (1 + Math.max(move.to, 0) / 50);

  score += move.to * 0.6; // general progress
  return score + Math.random() * 2; // tiny jitter so bots are less predictable
}

export function chooseMove(engine) {
  const moves = engine.legalMoves;
  if (!moves.length) return null;
  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const s = scoreMove(engine, m);
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}

const BOT_NAMES = ['Ava', 'Kiran', 'Milo', 'Zara', 'Ravi', 'Luna', 'Theo', 'Isha', 'Leo', 'Maya'];

export function randomBotName(taken = []) {
  const free = BOT_NAMES.filter((n) => !taken.includes(`${n} 🤖`));
  const pick = free.length ? free[Math.floor(Math.random() * free.length)] : `Bot ${Math.floor(Math.random() * 99)}`;
  return `${pick} 🤖`;
}

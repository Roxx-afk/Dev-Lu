import { randomUUID, randomInt } from 'node:crypto';

export const newId = (prefix = 'id') => `${prefix}_${randomUUID()}`;

/** Unambiguous characters for room codes (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function roomCode(length = 5) {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Trim, strip control characters and cap the length of a display name. */
export function sanitizeName(raw, fallback = 'Player') {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 16);
  return name || fallback;
}

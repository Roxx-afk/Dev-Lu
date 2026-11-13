/** Server configuration (override with environment variables). */
export const config = Object.freeze({
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  /** Delay before a bot rolls or moves, on top of the client animation time. */
  botThinkMs: 650,
  /** Delay before auto-playing for a disconnected player. */
  disconnectedActMs: 2500,
  /** Delay before auto-playing a forced (single option) move. */
  autoMoveMs: 450,
  /** How long a disconnected session keeps its seat. */
  sessionGraceMs: 5 * 60 * 1000,
  /** Rooms with no connected humans are removed after this long. */
  emptyRoomTtlMs: 2 * 60 * 1000,
  maxPayloadBytes: 4 * 1024,
  heartbeatMs: 30 * 1000,
});

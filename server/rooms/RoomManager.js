/**
 * RoomManager - owns sessions and rooms and routes protocol messages.
 *
 * A session is a browser identity that survives reconnects (the client stores
 * the sessionId the server issued). Sockets come and go; seats belong to
 * sessions, so a refresh or flaky network does not lose your place.
 */
import { MSG, EMOTES } from '../../shared/constants.js';
import { MODES } from '../../shared/modes.js';
import { GameError } from '../game/GameEngine.js';
import { Room } from './Room.js';
import { config } from '../config.js';
import { newId, roomCode, sanitizeName } from '../utils/ids.js';

export class RoomManager {
  constructor() {
    /** @type {Map<string, {id, name, socket, roomCode, lastSeen, lastEmote?}>} */
    this.sessions = new Map();
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this.sweeper = setInterval(() => this.sweep(), 15_000);
    this.sweeper.unref?.();
  }

  // ------------------------------------------------------------ transport

  send(session, type, payload = {}) {
    const ws = session?.socket;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, payload }));
  }

  sendError(session, message) {
    this.send(session, MSG.ERROR, { message });
  }

  /** Entry point for every raw socket message. */
  handleMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};

    if (msg.type === MSG.HELLO) return this.onHello(ws, payload);

    const session = ws.sessionId && this.sessions.get(ws.sessionId);
    if (!session) return;
    session.lastSeen = Date.now();

    try {
      this.route(session, msg.type, payload);
    } catch (err) {
      if (err instanceof GameError) this.sendError(session, err.message);
      else {
        console.error('[ws] handler error', err);
        this.sendError(session, 'Something went wrong');
      }
    }
  }

  route(session, type, p) {
    const room = session.roomCode ? this.rooms.get(session.roomCode) : null;
    const needRoom = () => {
      if (!room) throw new GameError('You are not in a room');
      return room;
    };

    switch (type) {
      case MSG.CREATE_ROOM:
        return this.createRoom(session, p);
      case MSG.JOIN_ROOM:
        return this.joinRoom(session, p);
      case MSG.LEAVE_ROOM:
        return this.leaveRoom(session);
      case MSG.TAKE_SEAT:
        needRoom().takeSeat(session.id, p.color);
        return room.broadcastRoom();
      case MSG.ADD_BOT:
        needRoom().addBot(session.id, p.color);
        return room.broadcastRoom();
      case MSG.KICK:
        needRoom().kick(session.id, p.color);
        return room.broadcastRoom();
      case MSG.SET_MODE:
        needRoom().setMode(session.id, p.mode);
        return room.broadcastRoom();
      case MSG.SWAP_SEAT:
        needRoom().swapSeat(session.id, p.color);
        return room.broadcastRoom();
      case MSG.SWAP_RESPONSE:
        needRoom().respondSwap(session.id, !!p.accept);
        return room.broadcastRoom();
      case MSG.SET_OPTION:
        needRoom().setOption(session.id, p.key, p.value);
        return room.broadcastRoom();
      case MSG.START_GAME:
        return needRoom().start(session.id);
      case MSG.ROLL:
        return needRoom().roll(session.id);
      case MSG.MOVE:
        return needRoom().move(session.id, p.tokenIndex);
      case MSG.REMATCH:
        return needRoom().rematch(session.id);
      case MSG.EMOTE:
        return this.emote(session, needRoom(), p.emote);
      default:
        return undefined;
    }
  }

  // ------------------------------------------------------------ sessions

  onHello(ws, { sessionId, name }) {
    let session = sessionId && this.sessions.get(sessionId);
    if (session) {
      // Resume: replace any stale socket.
      if (session.socket && session.socket !== ws) {
        try {
          session.socket.close(4000, 'Replaced by a new connection');
        } catch { /* ignore */ }
      }
      if (name) session.name = sanitizeName(name, session.name);
    } else {
      session = { id: newId('s'), name: sanitizeName(name), socket: null, roomCode: null, lastSeen: Date.now() };
      this.sessions.set(session.id, session);
    }
    session.socket = ws;
    session.lastSeen = Date.now();
    ws.sessionId = session.id;

    this.send(session, MSG.WELCOME, { sessionId: session.id, name: session.name, roomCode: session.roomCode });

    const room = session.roomCode && this.rooms.get(session.roomCode);
    if (room && room.colorOf(session.id)) {
      room.syncSession(session);
      room.onPresenceChange();
    } else {
      session.roomCode = null;
    }
  }

  onDisconnect(ws) {
    const session = ws.sessionId && this.sessions.get(ws.sessionId);
    if (!session || session.socket !== ws) return;
    session.socket = null;
    session.lastSeen = Date.now();
    const room = session.roomCode && this.rooms.get(session.roomCode);
    if (room) room.onPresenceChange();
  }

  // ------------------------------------------------------------ rooms

  createRoom(session, { name, mode }) {
    if (name) session.name = sanitizeName(name, session.name);
    this.leaveRoom(session, { silent: true });

    let code;
    do code = roomCode();
    while (this.rooms.has(code));

    const room = new Room(code, Object.values(MODES).includes(mode) ? mode : MODES.CLASSIC, this);
    this.rooms.set(code, room);
    room.addHuman(session);
    room.broadcastRoom();
    return room;
  }

  joinRoom(session, { code, name }) {
    if (name) session.name = sanitizeName(name, session.name);
    const key = String(code ?? '').trim().toUpperCase();
    const room = this.rooms.get(key);
    if (!room) throw new GameError(`Room ${key || '?'} not found`);
    if (session.roomCode === key && room.colorOf(session.id)) {
      room.syncSession(session);
      return;
    }
    this.leaveRoom(session, { silent: true });
    room.addHuman(session);
    room.broadcastRoom();
  }

  leaveRoom(session, { silent = false } = {}) {
    const room = session.roomCode && this.rooms.get(session.roomCode);
    session.roomCode = null;
    if (!room) return;
    room.removeHuman(session.id);
    if (!silent) this.send(session, MSG.LEFT, { reason: null });

    if (room.humans.length === 0) {
      this.closeRoom(room);
    } else {
      room.broadcastRoom();
      if (room.engine) room.broadcastGame([]);
    }
  }

  closeRoom(room) {
    room.destroy();
    this.rooms.delete(room.code);
  }

  emote(session, room, emote) {
    if (!EMOTES.includes(emote)) return;
    const now = Date.now();
    if (session.lastEmote && now - session.lastEmote < 1500) return;
    session.lastEmote = now;
    const color = room.colorOf(session.id);
    if (color) room.broadcast(MSG.EMOTE_BROADCAST, { color, emote });
  }

  /** Drop expired sessions and abandoned rooms. */
  sweep() {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (!session.socket && now - session.lastSeen > config.sessionGraceMs) {
        if (session.roomCode) this.leaveRoom(session, { silent: true });
        this.sessions.delete(session.id);
      }
    }
    for (const room of this.rooms.values()) {
      const anyoneOnline = room.humans.some((m) => this.sessions.get(m.sessionId)?.socket);
      if (anyoneOnline) room.idleSince = null;
      else {
        room.idleSince ??= now;
        if (now - room.idleSince > config.emptyRoomTtlMs) {
          for (const m of room.humans) {
            const s = this.sessions.get(m.sessionId);
            if (s) s.roomCode = null;
          }
          this.closeRoom(room);
        }
      }
    }
  }

  stats() {
    return { rooms: this.rooms.size, sessions: this.sessions.size };
  }
}
